/* ============================================
   鑫钱包 · 综合统计路由模块
   包含：仪表盘数据、仪表盘卡片明细
   ============================================ */

const express = require('express');
const db = require('../db');
const { success, fail, handleServerError, fmtDateOnly, calcDebtDueSummary, ensureWeeklySnapshots, sumAmounts, addAmounts, subtractAmounts, roundAmount, percentOf } = require('./_helpers');
// 组合指标统一走共享服务（修复 m2 重复实现）
const { calcPortfolioMetrics } = require('../services/portfolio');

const router = express.Router();

// ==========================================
// 多币种 P2-2d 辅助函数：rows → breakdown 字典，主货币按 amount 绝对值最大选
// ==========================================
function _rowsToBreakdown(rows, valueKey) {
    const out = {};
    (rows || []).forEach(r => {
        const cur = r.currency || 'CNY';
        out[cur] = parseFloat(r[valueKey] || 0);
    });
    return out;
}

function _rowsToBreakdownMulti(rows, valueKeys) {
    const out = {};
    (rows || []).forEach(r => {
        const cur = r.currency || 'CNY';
        out[cur] = out[cur] || {};
        valueKeys.forEach(k => { out[cur][k] = parseFloat(r[k] || 0); });
    });
    return out;
}

function _pickPrimaryCurrency(breakdown) {
    let primary = 'CNY', max = -1;
    Object.entries(breakdown).forEach(([cur, v]) => {
        let total = 0;
        if (typeof v === 'object' && v !== null) {
            total = Math.abs(v.income || 0) + Math.abs(v.expense || 0)
                  + Math.abs(v.total_value || 0) + Math.abs(v.total_cost || 0)
                  + Math.abs(v.total_income || 0) + Math.abs(v.total_expense || 0);
        } else {
            total = Math.abs(v);
        }
        if (total > max) { max = total; primary = cur; }
    });
    return primary;
}

// 从 breakdown 取主货币值（如 weekBreakdown['CNY'].income）
function _primaryValue(breakdown, key) {
    const cur = _pickPrimaryCurrency(breakdown);
    const v = breakdown[cur];
    if (typeof v === 'object' && v !== null) return parseFloat(v[key] || 0);
    return parseFloat(v || 0);
}

// months 数组按月分组：[{month, currency, income, expense}] → [{month, breakdown:{CNY:{income,expense},...}}]
function _groupMonthsByCurrency(rows) {
    const map = {};
    (rows || []).forEach(r => {
        if (!map[r.month]) map[r.month] = {};
        map[r.month][r.currency || 'CNY'] = {
            income: parseFloat(r.income || 0),
            expense: parseFloat(r.expense || 0)
        };
    });
    return Object.entries(map).map(([month, breakdown]) => ({ month, breakdown })).sort((a, b) => b.month.localeCompare(a.month));
}

// 解析 budget 子查询返回的 JSON 字符串为 breakdown；兼容 PG/MySQL（key 已是字符串）
function _parseJsonBreakdown(jsonStr) {
    if (!jsonStr) return { CNY: 0 };
    try {
        const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => { out[k] = parseFloat(v) || 0; });
        return Object.keys(out).length ? out : { CNY: 0 };
    } catch (e) {
        return { CNY: 0 };
    }
}

// ==========================================
// 综合统计 API
// ==========================================

router.get('/dashboard', async (req, res) => {
    try {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const currentYear = now.getFullYear().toString();

        // 计算本周起止（周一 ~ 周日）
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周日修正
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        const weekStart = monday.toISOString().slice(0, 10);
        const weekEnd = today;

        // 当前月区间（下方预算查询需要，提前计算以便并入并发批次）
        const monthStart = currentMonth + '-01';
        const [msYear, msMonth] = currentMonth.split('-').map(Number);
        const monthEnd = `${currentMonth}-${String(new Date(msYear, msMonth, 0).getDate()).padStart(2, '0')}`;

        /* 性能优化（对应审核报告"性能"维度，与 reports.js 同一套并发化方案）：
           本接口原有 13 次相互独立的 await db.query 串行执行，总延迟 = 各次之和。
           改为 Promise.all 并发下发，总延迟降为"最慢的那一次"。
           注意：db 连接池 max=10，此处并发 13 条中会有少量排队，但仍远优于全串行。
           savings_transactions 表可能尚未创建，单独用 .catch 兜底，避免整批 reject。 */
        const [
            todayData, weekData, monthData, yearData, months,
            accounts, invSummary, budgetRows, goalRows, holdingRows,
            recentTrans, debtSum, lifetimeTotals, activeDebts, allReps, debtCount,
            savingsData
        ] = await Promise.all([
            // 今日支出（多币种 P2-2d：按账户币种 GROUP BY，前端折算 baseCurrency）
            db.query(
                `SELECT a.currency AS currency,
                    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
       FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND t.date = ?
       GROUP BY a.currency`,
                [req.userId, req.bookId, today]
            ),
            // 本周收支（周一~今天，多币种 P2-2d）
            db.query(
                `SELECT a.currency AS currency,
                    COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
       FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND t.date >= ? AND t.date <= ?
       GROUP BY a.currency`,
                [req.userId, req.bookId, weekStart, weekEnd]
            ),
            // 本月收支（多币种 P2-2d）
            db.query(
                `SELECT a.currency AS currency,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
       FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ?
       GROUP BY a.currency`,
                [req.userId, req.bookId, currentMonth + '%']
            ),
            // 本年收支（多币种 P2-2d）
            db.query(
                `SELECT a.currency AS currency,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
       FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ?
       GROUP BY a.currency`,
                [req.userId, req.bookId, currentYear + '%']
            ),
            // 最近6月趋势（多币种 P2-2d：month × currency 双维度分组）
            db.query(
                `SELECT LEFT(CAST(t.date AS CHAR(10)), 7) AS month, a.currency AS currency,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
       FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ?
       GROUP BY month, a.currency ORDER BY month DESC LIMIT 60`,
                [req.userId, req.bookId]
            ),
            // 账户总览
            db.query(
                'SELECT * FROM accounts WHERE user_id = ? AND book_id = ? AND status = \'active\' ORDER BY sort_order',
                [req.userId, req.bookId]
            ),
            // 理财总资产（多币种 P2-2d：按 investments.currency GROUP BY）
            db.query(
                `SELECT currency,
                    COALESCE(SUM(total_cost), 0) AS total_cost,
                    COALESCE(SUM(current_value), 0) AS total_value
       FROM investments WHERE user_id = ? AND book_id = ? AND status = 'holding'
       GROUP BY currency`,
                [req.userId, req.bookId]
            ),
            // 预算执行（多币种 P2-2d：actual 子查询按账户币种 GROUP BY 拆分 JSON 行；JS 端解析为 actual_breakdown）
            db.query(
                `SELECT b.*,
                    (SELECT COALESCE(JSON_OBJECTAGG(a.currency, sums.cnt), JSON_OBJECT('CNY', 0))
                       FROM (SELECT t.account_id, SUM(t.amount) AS cnt FROM transactions t
                             LEFT JOIN categories c ON t.category_id = c.id
                             WHERE t.user_id = b.user_id AND t.book_id = b.book_id AND t.type = 'expense'
                               AND DATE(t.date) BETWEEN b.start_date AND b.end_date
                               AND (t.budget_id = b.id OR (c.name = b.name AND c.type = 'expense'))
                             GROUP BY t.account_id) sums
                       LEFT JOIN accounts a ON sums.account_id = a.id) AS actual_breakdown_json
             FROM budgets b
             WHERE b.user_id = ? AND b.book_id = ? AND b.start_date <= ? AND b.end_date >= ?
             ORDER BY b.start_date`,
                [req.userId, req.bookId, monthEnd, monthStart]
            ),
            // 储蓄目标（active）
            db.query(
                `SELECT id, name, icon, target_amount, current_amount, status
             FROM savings_goals WHERE user_id = ? AND book_id = ? AND status = 'active'
             ORDER BY (current_amount / NULLIF(target_amount, 0)) DESC`,
                [req.userId, req.bookId]
            ),
            // 理财持仓（holding）
            db.query(
                `SELECT i.name, i.code, i.total_cost, i.current_value,
                    (i.current_value - i.total_cost) as profit,
                    it.icon as type_icon, it.name as type_name
             FROM investments i
             JOIN investment_types it ON i.investment_type_id = it.id
             WHERE i.user_id = ? AND i.book_id = ? AND i.status = 'holding'
             ORDER BY i.current_value DESC`,
                [req.userId, req.bookId]
            ),
            // 最近交易
            db.query(
                `SELECT t.*, c.name as cat_name, c.icon as cat_icon,
        a.name as acc_name, a.icon as acc_icon
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND t.type IN ('expense','income','transfer_in','transfer_out')
       ORDER BY t.date DESC, t.id DESC LIMIT 8`,
                [req.userId, req.bookId]
            ),
            // 债务汇总（多币种 P2-2d：按 debts.currency GROUP BY 返回 breakdown）
            db.query(
                `SELECT currency,
                    COALESCE(SUM(remaining), 0) AS total_remaining,
                    COALESCE(SUM(CASE WHEN status != 'paid_off' THEN monthly_payment ELSE 0 END), 0) AS total_monthly
             FROM debts WHERE user_id = ? AND book_id = ? AND status != 'paid_off'
             GROUP BY currency`,
                [req.userId, req.bookId]
            ),
            // 全部历史累计收入/支出（多币种 P2-2d：按账户币种 GROUP BY）
            db.query(
                `SELECT a.currency AS currency,
              COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS total_income,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_expense
             FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ?
             GROUP BY a.currency`,
                [req.userId, req.bookId]
            ),
            // 活跃债务（多币种 P2-2d：SELECT 加 currency，calcDebtDueSummary 按货币分组）
            db.query(
                'SELECT id, currency, monthly_payment, remaining, payment_day, billing_day, min_payment, start_date, type FROM debts WHERE user_id = ? AND book_id = ? AND status = \'active\'',
                [req.userId, req.bookId]
            ),
            // 全部还款记录
            db.query(
                'SELECT debt_id, amount, paid_at FROM debt_repayments WHERE user_id = ? AND book_id = ?',
                [req.userId, req.bookId]
            ),
            // 债务计数
            db.queryOne(
                `SELECT COUNT(*) as cnt, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_cnt FROM debts WHERE user_id = ? AND book_id = ?`,
                [req.userId, req.bookId]
            ),
            // 本月储蓄净额（savings_transactions 表可能还未创建，单独兜底不拖垮整批）
            db.queryOne(
                `SELECT COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE -amount END), 0) as net_savings
                 FROM savings_transactions WHERE user_id = ? AND book_id = ? AND CAST(date AS CHAR(10)) LIKE ?`,
                [req.userId, req.bookId, currentMonth + '%']
            ).catch(err => {
                console.warn('⚠️ 仪表盘储蓄净额查询失败（savings_transactions 可能未创建）:', err.message);
                return null;
            })
        ]);

        // 多币种 P2-2d：把各 SUM 数组结果转 breakdown + 选主货币
        const todayExpenseBreakdown = _rowsToBreakdown(todayData, 'expense');
        const weekBreakdown = _rowsToBreakdownMulti(weekData, ['income', 'expense']);
        const monthBreakdown = _rowsToBreakdownMulti(monthData, ['income', 'expense']);
        const yearBreakdown = _rowsToBreakdownMulti(yearData, ['income', 'expense']);
        const lifetimeBreakdown = _rowsToBreakdownMulti(lifetimeTotals, ['total_income', 'total_expense']);
        const invBreakdown = _rowsToBreakdownMulti(invSummary, ['total_cost', 'total_value']);
        const monthsGrouped = _groupMonthsByCurrency(months);

        const todayCurrency = _pickPrimaryCurrency(todayExpenseBreakdown);
        const weekCurrency = _pickPrimaryCurrency(weekBreakdown);
        const monthCurrency = _pickPrimaryCurrency(monthBreakdown);
        const yearCurrency = _pickPrimaryCurrency(yearBreakdown);
        const lifetimeCurrency = _pickPrimaryCurrency(lifetimeBreakdown);
        const invCurrency = _pickPrimaryCurrency(invBreakdown);

        // 多币种 P2-2d：债务余额/月供按 currency GROUP BY
        const debtRemainingBreakdown = _rowsToBreakdown(debtSum, 'total_remaining');
        const debtMonthlyBreakdown = _rowsToBreakdown(debtSum, 'total_monthly');
        const debtCurrency = _pickPrimaryCurrency(debtRemainingBreakdown);
        const debtTotalRemaining = debtRemainingBreakdown[debtCurrency] || 0;
        const debtTotalMonthly = debtMonthlyBreakdown[debtCurrency] || 0;

        const todayExpense = todayExpenseBreakdown[todayCurrency] || 0;
        const weekIncome = (weekBreakdown[weekCurrency] && weekBreakdown[weekCurrency].income) || 0;
        const weekExpense = (weekBreakdown[weekCurrency] && weekBreakdown[weekCurrency].expense) || 0;
        const monthIncome = (monthBreakdown[monthCurrency] && monthBreakdown[monthCurrency].income) || 0;
        const monthExpense = (monthBreakdown[monthCurrency] && monthBreakdown[monthCurrency].expense) || 0;
        const yearIncome = (yearBreakdown[yearCurrency] && yearBreakdown[yearCurrency].income) || 0;
        const yearExpense = (yearBreakdown[yearCurrency] && yearBreakdown[yearCurrency].expense) || 0;
        const totalIncome = (lifetimeBreakdown[lifetimeCurrency] && lifetimeBreakdown[lifetimeCurrency].total_income) || 0;
        const totalExpense = (lifetimeBreakdown[lifetimeCurrency] && lifetimeBreakdown[lifetimeCurrency].total_expense) || 0;
        const invTotalCost = (invBreakdown[invCurrency] && invBreakdown[invCurrency].total_cost) || 0;
        const invTotalValue = (invBreakdown[invCurrency] && invBreakdown[invCurrency].total_value) || 0;

        // 趋势增强：储蓄额/储蓄率 + 与上月环比（按月×主货币）
        const monthsAsc = [...monthsGrouped].sort((a, b) => a.month.localeCompare(b.month));
        let prevMonth = null;
        const monthsEnhanced = monthsAsc.map(m => {
            const primaryCur = _pickPrimaryCurrency(m.breakdown);
            const income = (m.breakdown[primaryCur] && m.breakdown[primaryCur].income) || 0;
            const expense = (m.breakdown[primaryCur] && m.breakdown[primaryCur].expense) || 0;
            // 金额精度（M3）：月度储蓄额与储蓄率走整数分域
            const savings = subtractAmounts(income, expense);
            const rec = {
                month: m.month, currency: primaryCur, income, expense, savings,
                incomeBreakdown: m.breakdown, expenseBreakdown: m.breakdown,
                savingsRate: percentOf(savings, income, 1),
                incomeMoM: null, expenseMoM: null, balanceMoM: null
            };
            if (prevMonth) {
                rec.incomeMoM = prevMonth.income > 0 ? ((income - prevMonth.income) / prevMonth.income * 100) : null;
                rec.expenseMoM = prevMonth.expense > 0 ? ((expense - prevMonth.expense) / prevMonth.expense * 100) : null;
                const prevBal = subtractAmounts(prevMonth.income, prevMonth.expense);
                const bal = savings;
                rec.balanceMoM = prevBal !== 0 ? ((bal - prevBal) / Math.abs(prevBal) * 100) : null;
            }
            prevMonth = { income, expense };
            return rec;
        });
        const monthsOut = monthsEnhanced.reverse();

        // 金额精度（M3）：总资产 = 账户余额 + 投资市值（主货币值；前端 kpiHero 已用 FxManager 折算 baseCurrency）
        const totalAssets = addAmounts(sumAmounts(accounts, a => a.balance), invTotalValue);

        const budgetMonthLastDay = parseInt(monthEnd.slice(8, 10));
        const budgetDayOfMonth = now.getDate();
        const budgetDaysLeft = Math.max(budgetMonthLastDay - budgetDayOfMonth, 0);

        const budgets = budgetRows.map(b => {
            const amount = parseFloat(b.amount);
            const actualBreakdown = _parseJsonBreakdown(b.actual_breakdown_json);
            const actualPrimary = _pickPrimaryCurrency(actualBreakdown);
            const actual = actualBreakdown[actualPrimary] || 0;
            const ratio = amount > 0 ? Math.min(actual / amount * 100, 999) : 0;
            const remain = Math.max(amount - actual, 0);
            const over = actual > amount;
            const dailyAvg = budgetDayOfMonth > 0 ? actual / budgetDayOfMonth : 0;
            const projectedMonthEnd = dailyAvg * budgetMonthLastDay;
            const willOver = !over && amount > 0 && projectedMonthEnd > amount;
            const overBy = willOver ? projectedMonthEnd - amount : (over ? actual - amount : 0);
            const safeDaily = budgetDaysLeft > 0 ? remain / budgetDaysLeft : 0;
            let alertLevel = 'safe';
            if (over || willOver) alertLevel = 'danger';
            else if (ratio >= 80) alertLevel = 'warning';
            return {
                name: b.name, amount, actual,
                currency: actualPrimary,
                actualBreakdown,
                ratio: Math.round(ratio * 10) / 10,
                remain, over,
                daysLeft: budgetDaysLeft, daysTotal: budgetMonthLastDay,
                dailyAvg: Math.round(dailyAvg * 100) / 100,
                projectedMonthEnd: Math.round(projectedMonthEnd * 100) / 100,
                willOver, overBy: Math.round(overBy * 100) / 100,
                safeDaily: Math.round(safeDaily * 100) / 100,
                alertLevel
            };
        });

        const savingsGoals = goalRows.map(g => {
            const target = parseFloat(g.target_amount);
            const current = parseFloat(g.current_amount);
            return { id: g.id, name: g.name, icon: g.icon, target_amount: target, current_amount: current, currency: g.currency || 'CNY', ratio: target > 0 ? Math.round(current / target * 1000) / 10 : 0 };
        });

        const investmentHoldings = holdingRows.map(h => {
            const cost = parseFloat(h.total_cost);
            const value = parseFloat(h.current_value);
            const profit = parseFloat(h.profit);
            return { name: h.name, code: h.code, total_cost: cost, current_value: value, profit, currency: h.currency || 'CNY', profit_rate: cost > 0 ? Math.round(profit / cost * 1000) / 10 : 0, type_icon: h.type_icon, type_name: h.type_name };
        });

        const repaymentsByDebt = {};
        allReps.forEach(r => {
            (repaymentsByDebt[r.debt_id] = repaymentsByDebt[r.debt_id] || []).push({
                amount: parseFloat(r.amount),
                paid_at: fmtDateOnly(r.paid_at)
            });
        });
        const dueSummary = calcDebtDueSummary(activeDebts, repaymentsByDebt, today);

        // 本月储蓄净额（查询已并入上方 Promise.all，失败时返回 null 并已记录警告，
        // 修复报告 m4「空 catch 吞异常」——不再静默丢弃错误）
        const monthNetSavings = savingsData ? parseFloat(savingsData.net_savings || 0) : 0;
        // 金额精度（M3）：储蓄率用整数分域计算比值，避免浮点除法误差
        const savingsRate = percentOf(monthNetSavings, monthIncome, 1);

        res.json(success({
            currentMonth,
            today: { expense: todayExpense, currency: todayCurrency, expenseBreakdown: todayExpenseBreakdown },
            week: {
                income: weekIncome, expense: weekExpense, currency: weekCurrency,
                incomeBreakdown: weekBreakdown, expenseBreakdown: weekBreakdown,
                start: weekStart, end: weekEnd
            },
            month: {
                income: monthIncome, expense: monthExpense, currency: monthCurrency,
                incomeBreakdown: monthBreakdown, expenseBreakdown: monthBreakdown,
                balance: subtractAmounts(monthIncome, monthExpense),
                savings: roundAmount(monthNetSavings),
                savingsRate
            },
            year: {
                income: yearIncome, expense: yearExpense, currency: yearCurrency,
                incomeBreakdown: yearBreakdown, expenseBreakdown: yearBreakdown,
                balance: subtractAmounts(yearIncome, yearExpense)
            },
            // 净资产 = 总资产 - 债务余额，首屏核心指标，精确计算（主货币值；前端 kpiHero 已用 FxManager 折算 baseCurrency）
            netWorth: subtractAmounts(totalAssets, debtTotalRemaining),
            income: monthIncome, expense: monthExpense, currency: monthCurrency,
            balance: subtractAmounts(monthIncome, monthExpense),
            // 全部历史累计金额（前端用于储蓄率 = 累计净储蓄 / 总资产）
            totalIncome, totalExpense, currency: lifetimeCurrency,
            totalIncomeBreakdown: lifetimeBreakdown, totalExpenseBreakdown: lifetimeBreakdown,
            totalSavings: subtractAmounts(totalIncome, totalExpense),
            months: monthsOut,
            accounts: accounts.map(a => ({ ...a, balance: parseFloat(a.balance) })),
            totalAssets,
            budgets,
            savingsGoals,
            investments: {
                totalCost: invTotalCost, totalValue: invTotalValue, currency: invCurrency,
                totalCostBreakdown: invBreakdown, totalValueBreakdown: invBreakdown,
                // 金额精度（M3）：浮盈 = 市值 - 成本，整数分精确减法
                totalProfit: subtractAmounts(invTotalValue, invTotalCost),
                holdings: investmentHoldings
            },
            recentTransactions: recentTrans.map(t => ({
                id: t.id, type: t.type, amount: parseFloat(t.amount), date: t.date,
                note: t.note, transfer_id: t.transfer_id,
                category: { id: t.category_id, name: t.cat_name, icon: t.cat_icon },
                account: { id: t.account_id, name: t.acc_name, icon: t.acc_icon }
            })),
            debts: {
                totalRemaining: debtTotalRemaining,
                totalMonthly: debtTotalMonthly,
                currency: debtCurrency,
                totalRemainingBreakdown: debtRemainingBreakdown,
                totalMonthlyBreakdown: debtMonthlyBreakdown,
                dueThisMonth: dueSummary.dueThisMonth,
                dueAmount: dueSummary.dueAmount,
                dueAmountBreakdown: dueSummary.dueAmountBreakdown || {},
                overdue: dueSummary.overdue,
                overdueAmount: dueSummary.overdueAmount,
                overdueAmountBreakdown: dueSummary.overdueAmountBreakdown || {},
                count: parseInt(debtCount.cnt),
                activeCount: parseInt(debtCount.active_cnt)
            }
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 仪表盘卡片点击明细
router.get('/dashboard/detail', async (req, res) => {
    try {
        const { type } = req.query;
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const currentYear = now.getFullYear().toString();

        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        const weekStart = monday.toISOString().slice(0, 10);

        let dateCondition, dateParams = [];
        switch (type) {
            case 'today':
                dateCondition = 't.date = ?';
                dateParams = [today];
                break;
            case 'week':
                dateCondition = 't.date >= ? AND t.date <= ?';
                dateParams = [weekStart, today];
                break;
            case 'month':
                dateCondition = 'CAST(t.date AS CHAR(10)) LIKE ?';
                dateParams = [currentMonth + '%'];
                break;
            case 'year':
                dateCondition = 'CAST(t.date AS CHAR(10)) LIKE ?';
                dateParams = [currentYear + '%'];
                break;
            case 'assets':
                const accounts = await db.query(
                    `SELECT a.*, COALESCE(SUM(i.current_value), 0) as inv_value
           FROM accounts a
           LEFT JOIN investments i ON i.account_id = a.id AND i.user_id = a.user_id AND i.book_id = a.book_id AND i.status = 'holding'
           WHERE a.user_id = ? AND a.book_id = ? AND a.status = 'active'
           GROUP BY a.id ORDER BY a.sort_order`,
                    [req.userId, req.bookId]
                );
                // 金额精度（M3）：资产明细求和与占比走整数分域
                // 总资产 = 账户余额 + 投资市值；单账户占比按「余额 + 关联投资市值」计算
                const accountTotal = sumAmounts(accounts, a => a.balance);
                const investTotal = sumAmounts(accounts, a => a.inv_value);
                const totalAssets = addAmounts(accountTotal, investTotal);
                return res.json(success({
                    type: 'assets', title: '总资产明细',
                    total: totalAssets,
                    accounts: accounts.map(a => ({
                        name: a.name, icon: a.icon, type: a.type,
                        balance: parseFloat(a.balance),
                        inv_value: parseFloat(a.inv_value),
                        ratio: percentOf(addAmounts(a.balance, a.inv_value), totalAssets, 10)
                    }))
                }));
            default: return res.status(400).json(fail('无效的明细类型'));
        }

        const rows = await db.query(
            `SELECT t.*, c.name as cat_name, c.icon as cat_icon, a.name as acc_name, a.icon as acc_icon
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       WHERE t.user_id = ? AND t.book_id = ? AND ${dateCondition}
       ORDER BY t.date DESC, t.id DESC`,
            [req.userId, req.bookId, ...dateParams]
        );

        // 金额精度（M3）：交易明细汇总用整数分累加。
        // 此处逐笔累加交易金额，是全项目最容易积累浮点误差的场景之一
        // （一年上千笔交易，浮点 reduce 的偏差会直接显示在"本年收支"上）
        const totalExpense = sumAmounts(rows.filter(r => r.type === 'expense'), r => r.amount);
        const totalIncome = sumAmounts(rows.filter(r => r.type === 'income'), r => r.amount);

        const titleMap = {
            today: '今日交易明细', week: '本周交易明细',
            month: '本月交易明细', year: '本年交易明细'
        };

        res.json(success({
            type, title: titleMap[type],
            totalExpense, totalIncome,
            balance: subtractAmounts(totalIncome, totalExpense),
            transactions: rows.map(t => ({
                id: t.id, type: t.type, amount: parseFloat(t.amount),
                date: t.date, note: t.note || '',
                transfer_id: t.transfer_id,
                category: { id: t.category_id, name: t.cat_name, icon: t.cat_icon },
                account: { id: t.account_id, name: t.acc_name, icon: t.acc_icon }
            }))
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 理财组合进阶指标：年化、集中度、预期收益加权
// 修复 m2：原先此处与 investments.js 各自复制了一份逐字节相同的实现
// （且 services/portfolio.js 早已提供同名函数却无人使用），
// 现统一改用共享服务，避免三份实现各自漂移。

// 理财趋势数据（折线图：各持仓市值变化 + 柱状图：按类型投入 vs 市值）
router.get('/investments', async (req, res) => {
    try {
        const investments = await db.query(
            `SELECT i.*, it.name as type_name, it.icon as type_icon
             FROM investments i JOIN investment_types it ON i.investment_type_id = it.id
             WHERE i.user_id = ? AND i.book_id = ? AND i.status = 'holding'
             ORDER BY i.current_value DESC`,
            [req.userId, req.bookId]
        );

        await ensureWeeklySnapshots(req.userId, investments);

        // 性能修复（审核报告 M5 · N+1）：原实现在 for 循环内逐持仓查询快照，
        // 持仓数 N 就是 N 次串行 DB 往返。改为一次性取回全部快照后在内存按持仓分组。
        const trendSeries = [];
        const totalTrend = [];
        if (investments.length > 0) {
            const invIds = investments.map(i => i.id);
            const { sql: invSql, params: invParams } = db.buildInClause(invIds);
            const allSnaps = await db.query(
                `SELECT investment_id, nav_date, total_value, total_cost
                   FROM investment_snapshots
                  WHERE user_id = ? AND book_id = ? AND investment_id ${invSql}
                  ORDER BY nav_date ASC`,
                [req.userId, req.bookId, ...invParams]
            );
            const snapsByInv = new Map();
            for (const s of allSnaps) {
                const key = Number(s.investment_id);
                if (!snapsByInv.has(key)) snapsByInv.set(key, []);
                snapsByInv.get(key).push({
                    date: s.nav_date instanceof Date ? s.nav_date.toISOString().slice(0, 10) : String(s.nav_date).slice(0, 10),
                    value: parseFloat(s.total_value)
                });
            }

            for (const inv of investments) {
                const points = snapsByInv.get(Number(inv.id)) || [];
                if (points.length > 0) {
                    trendSeries.push({
                        id: inv.id, name: inv.name, type_name: inv.type_name, type_icon: inv.type_icon,
                        total_cost: parseFloat(inv.total_cost), current_value: parseFloat(inv.current_value),
                        profit_rate: parseFloat(inv.total_cost) > 0
                            ? ((parseFloat(inv.current_value) - parseFloat(inv.total_cost)) / parseFloat(inv.total_cost) * 100) : 0,
                        points
                    });
                }
            }

            // 总市值趋势：按日期汇总所有持仓市值，前端只画一条总市值线
            const totalByDate = new Map();
            for (const s of allSnaps) {
                const d = s.nav_date instanceof Date ? s.nav_date.toISOString().slice(0, 10) : String(s.nav_date).slice(0, 10);
                totalByDate.set(d, (totalByDate.get(d) || 0) + parseFloat(s.total_value));
            }
            for (const d of [...totalByDate.keys()].sort()) {
                totalTrend.push({ date: d, value: totalByDate.get(d) });
            }
        }

        const byType = {};
        investments.forEach(i => {
            const key = i.type_name;
            if (!byType[key]) byType[key] = { type_name: key, icon: i.type_icon, total_cost: 0, total_value: 0, count: 0 };
            byType[key].total_cost += parseFloat(i.total_cost);
            byType[key].total_value += parseFloat(i.current_value);
            byType[key].count++;
        });

        res.json(success({
            trendSeries,
            totalTrend,
            byType: Object.values(byType).sort((a, b) => b.total_value - a.total_value),
            summary: calcPortfolioMetrics(investments)
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 日历月汇总：首页日历视图用
// 入参：year(必填)，month(必填，1-12)。返回 monthDays[ {date, expense, income, hasRecord} ] + monthSummary {income, expense}。
// 日期为字符串 YYYY-MM-DD（按服务端时区切分，避开 PG tz 误差）。
router.get('/calendar', async (req, res) => {
    try {
        const y = parseInt(req.query.year);
        const m = parseInt(req.query.month);
        if (!y || !m || m < 1 || m > 12) return res.status(400).json(fail('year/month 必填且 month 范围 1-12'));

        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

        const rows = await db.query(
            `SELECT CAST(date AS CHAR(10)) as date,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
             FROM transactions
             WHERE user_id = ? AND book_id = ? AND CAST(date AS CHAR(10)) >= ? AND CAST(date AS CHAR(10)) <= ?
             GROUP BY CAST(date AS CHAR(10))`,
            [req.userId, req.bookId, monthStart, monthEnd]
        );

        const monthDays = rows.map(r => {
            const income = parseFloat(r.income);
            const expense = parseFloat(r.expense);
            return {
                date: r.date,
                income,
                expense,
                hasRecord: income > 0 || expense > 0
            };
        });

        const totalIncome = monthDays.reduce((s, d) => s + d.income, 0);
        const totalExpense = monthDays.reduce((s, d) => s + d.expense, 0);

        res.json(success({
            year: y,
            month: m,
            monthStart,
            monthEnd,
            monthSummary: { income: totalIncome, expense: totalExpense },
            monthDays
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

module.exports = router;
