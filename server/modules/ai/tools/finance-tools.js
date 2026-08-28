/* ============================================
   AI 财务分析工具（只读）
   ------------------------------------------------
     让对话式 AI 能按需查询账本【全量】数据 —— 交易/债务/预算/理财/储蓄，
     从而具备「分析 + 给出决策」的能力。

   ⛔ 与既有代码的关系（避免重复造轮子）：
     - 计算口径一律沿用【路由层既有实现】的单一真相：
         · 预算执行率  ← routes/budgets.js（按 t.budget_id 关联，非时间范围）
         · 债务本月应还/逾期 ← services/debt-summary.js（信用卡按账单周期、贷款按 FIFO）
         · 理财收益    ← services/portfolio.js（成本/市值用整数分内核）
      本模块只做「查询 + 组装」，不重新实现这些算法。

   ⛔ 安全约束：
   1. 全部 SELECT，绝不写库。分析类工具没有写权限。
   2. 每条 SQL 必须同时带 user_id + book_id —— 缺 book_id 会跨账本串数据。
      （历史教训：已删除的 tool-registry.js 实现就没有 book_id 过滤。）
   3. SQL 必须 PostgreSQL / MySQL 双方言兼容：
      禁用 TO_CHAR / DATE_TRUNC / CURDATE()-INTERVAL，
      月度筛选统一用 CAST(date AS CHAR(10)) LIKE 'YYYY-MM%'。

   ⛔ 与已删除的 tools/tool-registry.js 的关系：
   它是同领域工具，但字段名与 schema 不符（trans_date/period/category_id）、
   require 路径错误、无 book_id 隔离，从未被任何路由调用（消费链为空），
   已于 2026-08-29 删除。本模块是其可用的替代实现。
   ============================================ */

const { calcDebtDueSummary } = require('../../../services/debt-summary');
const { calcPortfolioMetrics } = require('../../../services/portfolio');

/** 金额统一 2 位小数，避免浮点尾数（如 638.4000000000001）污染 LLM 输入 */
function round2(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
}

/** 当前月 YYYY-MM */
function currentMonth(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/* ════════════════════════════════════════════════════════════
   1. 财务全景 —— AI 做决策建议的起点
   ════════════════════════════════════════════════════════════ */

/**
 * 资产 / 负债 / 净资产 / 本月收支 / 偿债压力。
 *
 * 口径说明（与 routes/ai/advice.js 保持一致，避免两处算出不同的"负债率"）：
 *   资产 = 活跃账户余额合计 + 在持理财市值
 *   负债 = 未结清（status <> 'paid_off'）债务的 remaining 合计
 *   净资产 = 资产 - 负债
 * 信用卡账户的 balance 本身为负（欠款），已自然体现在账户余额合计里，
 * 故不在此处重复扣减，避免与 debts 表重复计负债。
 */
async function getFinancialOverview(db, { userId, bookId, month } = {}) {
    const ym = month || currentMonth();

    const [accRows, invRows, debtRows, monthRows] = await Promise.all([
        db.query(
            `SELECT COALESCE(SUM(balance), 0) AS total
               FROM accounts
              WHERE user_id = ? AND book_id = ? AND status = 'active'`,
            [userId, bookId]
        ),
        db.query(
            `SELECT COALESCE(SUM(current_value), 0) AS total
               FROM investments
              WHERE user_id = ? AND book_id = ? AND status = 'holding'`,
            [userId, bookId]
        ),
        db.query(
            `SELECT COALESCE(SUM(remaining), 0) AS total,
                    COALESCE(SUM(monthly_payment), 0) AS monthly
               FROM debts
              WHERE user_id = ? AND book_id = ? AND status <> 'paid_off'`,
            [userId, bookId]
        ),
        db.query(
            `SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
               FROM transactions
              WHERE user_id = ? AND book_id = ?
                AND CAST(date AS CHAR(10)) LIKE ?`,
            [userId, bookId, `${ym}%`]
        ),
    ]);

    const cashAssets = round2(accRows[0]?.total);
    const investAssets = round2(invRows[0]?.total);
    const totalAssets = round2(cashAssets + investAssets);
    const totalDebt = round2(debtRows[0]?.total);
    const monthlyPayment = round2(debtRows[0]?.monthly);
    const netWorth = round2(totalAssets - totalDebt);

    const income = round2(monthRows[0]?.income);
    const expense = round2(monthRows[0]?.expense);
    const balance = round2(income - expense);

    return {
        ok: true,
        month: ym,
        资产: {
            账户余额: cashAssets,
            理财市值: investAssets,
            合计: totalAssets,
        },
        负债: {
            未结清总额: totalDebt,
            月供合计: monthlyPayment,
        },
        净资产: netWorth,
        本月: {
            收入: income,
            支出: expense,
            结余: balance,
            储蓄率: income > 0 ? Math.round((balance / income) * 100) : null,
        },
        偿债压力: {
            负债率: totalAssets > 0 ? round2((totalDebt / totalAssets) * 100) : null,
            月供占收入比: income > 0 ? round2((monthlyPayment / income) * 100) : null,
        },
    };
}

/* ════════════════════════════════════════════════════════════
   2. 债务
   ════════════════════════════════════════════════════════════ */

/**
 * 债务明细 + 本月应还 / 逾期（计算交给 services/debt-summary.js）。
 * 信用卡按账单日/还款日判断周期，贷款按 FIFO 逐期冲抵 —— 不要在这里重写。
 */
async function listDebts(db, { userId, bookId } = {}) {
    const debts = await db.query(
        `SELECT id, name, type, direction, creditor, principal, remaining,
                interest_rate, monthly_payment, start_date, due_date,
                billing_day, payment_day, min_payment, status
           FROM debts
          WHERE user_id = ? AND book_id = ? AND status <> 'paid_off'
          ORDER BY remaining DESC`,
        [userId, bookId]
    );

    if (debts.length === 0) {
        return { ok: true, debts: [], 汇总: { 未结清笔数: 0, 剩余总额: 0, 本月应还: 0, 逾期: 0 } };
    }

    // 逐笔取还款记录喂给 calcDebtDueSummary（它要求 { [debtId]: [{amount, paid_at}] }）
    const repaymentsByDebt = {};
    for (const d of debts) {
        repaymentsByDebt[d.id] = await db.query(
            `SELECT amount, paid_at FROM debt_repayments
              WHERE debt_id = ? AND user_id = ? AND book_id = ?
              ORDER BY paid_at ASC`,
            [d.id, userId, bookId]
        );
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const summary = calcDebtDueSummary(debts, repaymentsByDebt, todayStr);

    return {
        ok: true,
        // ⚠️ 字段名易错：calcDebtDueSummary 返回的 dueThisMonth / overdue 是【笔数】，
        //    dueAmount / overdueAmount 才是【金额】。二者不可混用。
        汇总: {
            未结清笔数: debts.length,
            剩余总额: round2(debts.reduce((s, d) => s + (Number(d.remaining) || 0), 0)),
            本月应还: round2(summary.dueAmount),
            本月应还笔数: summary.dueThisMonth,
            逾期: round2(summary.overdueAmount),
            逾期笔数: summary.overdue,
        },
        debts: debts.map(d => ({
            id: d.id,
            名称: d.name,
            类型: d.type === 'credit_card' ? '信用卡'
                : d.type === 'loan' ? '贷款'
                    : d.type === 'personal' ? '个人借贷' : '其他',
            方向: d.direction === 'receivable' ? '应收(别人欠我)' : '应付(我欠别人)',
            剩余: round2(d.remaining),
            利率: d.interest_rate != null ? round2(d.interest_rate) : null,
            月供: d.monthly_payment != null ? round2(d.monthly_payment) : null,
            到期日: d.due_date ? String(d.due_date).slice(0, 10) : null,
            状态: d.status === 'overdue' ? '逾期' : '正常',
        })),
    };
}

/* ════════════════════════════════════════════════════════════
   3. 预算
   ════════════════════════════════════════════════════════════ */

/**
 * 预算执行率。
 * ⚠️ 口径严格照搬 routes/budgets.js：按 transactions.budget_id 关联统计支出，
 *    而不是按时间范围（budgets 表没有 category_id，时间范围法会重复计入）。
 */
async function listBudgets(db, { userId, bookId } = {}) {
    const rows = await db.query(
        `SELECT b.id, b.name, b.period_type, b.start_date, b.end_date, b.amount,
                COALESCE(SUM(t.amount), 0) AS actual
           FROM budgets b
           LEFT JOIN transactions t
             ON b.id = t.budget_id AND t.type = 'expense' AND t.book_id = ?
          WHERE b.user_id = ? AND b.book_id = ?
          GROUP BY b.id, b.name, b.period_type, b.start_date, b.end_date, b.amount
          ORDER BY b.start_date DESC`,
        [bookId, userId, bookId]
    );

    return {
        ok: true,
        budgets: rows.map(r => {
            const amount = round2(r.amount);
            const spent = round2(r.actual);
            return {
                id: r.id,
                名称: r.name,
                周期: r.period_type,
                起止: `${String(r.start_date).slice(0, 10)} ~ ${String(r.end_date).slice(0, 10)}`,
                预算额: amount,
                已用: spent,
                剩余: round2(amount - spent),
                执行率: amount > 0 ? Math.round((spent / amount) * 100) : 0,
                超支: spent > amount,
            };
        }),
    };
}

/* ════════════════════════════════════════════════════════════
   4. 理财
   ════════════════════════════════════════════════════════════ */

/** 持仓明细 + 组合指标（收益计算交给 services/portfolio.js 的整数分内核） */
async function listInvestments(db, { userId, bookId } = {}) {
    const rows = await db.query(
        // expected_rate 是 calcPortfolioMetrics 算「组合预期收益率」的输入，必须查出
        `SELECT i.id, i.name, i.code, i.total_cost, i.current_value, i.buy_date,
                i.expected_rate, i.status, i.risk_level, it.name AS type_name, it.category
           FROM investments i
           LEFT JOIN investment_types it ON i.investment_type_id = it.id
          WHERE i.user_id = ? AND i.book_id = ?
          ORDER BY i.current_value DESC`,
        [userId, bookId]
    );

    const holding = rows.filter(r => r.status === 'holding');
    const metrics = calcPortfolioMetrics(holding);

    return {
        ok: true,
        汇总: {
            持仓笔数: holding.length,
            总成本: round2(metrics.totalCost),
            总市值: round2(metrics.totalValue),
            总盈亏: round2(metrics.totalProfit),
            组合年化: metrics.annualizedRate,
        },
        investments: rows.map(r => {
            const cost = round2(r.total_cost);
            const value = round2(r.current_value);
            return {
                id: r.id,
                名称: r.name,
                类型: r.type_name || null,
                成本: cost,
                市值: value,
                盈亏: round2(value - cost),
                收益率: cost > 0 ? round2(((value - cost) / cost) * 100) : null,
                买入日: r.buy_date ? String(r.buy_date).slice(0, 10) : null,
                风险: r.risk_level || null,
                状态: r.status,
            };
        }),
    };
}

/* ════════════════════════════════════════════════════════════
   5. 储蓄目标
   ════════════════════════════════════════════════════════════ */

async function listSavingsGoals(db, { userId, bookId } = {}) {
    const rows = await db.query(
        `SELECT id, name, target_amount, current_amount, status, icon
           FROM savings_goals
          WHERE user_id = ? AND book_id = ?
          ORDER BY status, current_amount DESC`,
        [userId, bookId]
    );

    return {
        ok: true,
        goals: rows.map(g => {
            const target = round2(g.target_amount);
            const current = round2(g.current_amount);
            return {
                id: g.id,
                名称: g.name,
                目标额: target,
                当前额: current,
                缺口: round2(Math.max(0, target - current)),
                进度: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
                状态: g.status === 'completed' ? '已达成' : g.status === 'archived' ? '已归档' : '进行中',
            };
        }),
    };
}

module.exports = {
    getFinancialOverview,
    listDebts,
    listBudgets,
    listInvestments,
    listSavingsGoals,
    round2,
    currentMonth,
};
