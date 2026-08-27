/* ============================================
   Tool Registry
   ------------------------------------------------
   所有 LLM 可调用的 Tool 的注册表。

   设计原则：
     - 复用现有 service 层，不重复造轮子
     - 每个 Tool 是纯函数，输入/输出均为可序列化对象
     - Tool 名 = {domain}_{action}，命名空间隔离
     - description 供 LLM 理解何时调用、传什么参数
     - 每个 Tool 独立 try-catch，失败返回 {error} 而不污染主流程

   Tool 列表（共 9 个）：
     accounts_get_balance    账户余额查询
     accounts_list          账户列表
     transactions_search    交易搜索
     transactions_stats     收支统计
     budgets_status         预算状态
     debt_summary           债务汇总
     portfolio_metrics      投资组合指标
     savings_analysis       储蓄分析
     insights_recent        最近洞察（用户可见）
   ============================================ */

const db = require('../../../db');

// ============================================
// Tool 定义
// ============================================

const TOOLS = [
  // ---------- 账户工具 ----------
  {
    name: 'accounts_get_balance',
    description: '查询指定账户的当前余额。输入 {account_id}（整数），返回 {balance}（元，2位小数）和账户名称。',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'integer', description: '账户 ID' },
      },
      required: ['account_id'],
    },
    fn: accountsGetBalance,
  },
  {
    name: 'accounts_list',
    description: '列出用户所有账户（支持 type 过滤）。输入 {user_id}（可选，默认当前用户），返回账户列表含余额和类型。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选）' },
        type: { type: 'string', description: '账户类型过滤：cash/bank/credit_card/wallet/investment（可选）' },
        status: { type: 'string', description: '状态过滤：active/frozen/closed（默认 active）' },
      },
    },
    fn: accountsList,
  },

  // ---------- 交易工具 ----------
  {
    name: 'transactions_search',
    description: '搜索交易记录。输入 {user_id, keyword(可选), category_id(可选), start_date(可选), end_date(可选), limit(默认50)}。返回匹配的交易列表。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
        keyword: { type: 'string', description: '商家名/备注关键词模糊搜索（可选）' },
        category_id: { type: 'integer', description: '类目 ID（可选）' },
        account_id: { type: 'integer', description: '账户 ID（可选）' },
        type: { type: 'string', description: '交易类型：income/expense/transfer（可选）' },
        start_date: { type: 'string', format: 'date', description: '起始日期 YYYY-MM-DD（可选）' },
        end_date: { type: 'string', format: 'date', description: '截止日期 YYYY-MM-DD（可选）' },
        limit: { type: 'integer', description: '返回条数上限（默认 50，最大 200）' },
      },
    },
    fn: transactionsSearch,
  },
  {
    name: 'transactions_stats',
    description: '获取指定时间范围的收支统计（收入/支出/结余）。输入 {user_id, start_date, end_date}，返回 {income, expense, balance, transaction_count}。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
        start_date: { type: 'string', format: 'date', description: '起始日期 YYYY-MM-DD（必填）' },
        end_date: { type: 'string', format: 'date', description: '截止日期 YYYY-MM-DD（必填）' },
        group_by: { type: 'string', description: '分组维度：category/month/merchant（可选）' },
      },
      required: ['start_date', 'end_date'],
    },
    fn: transactionsStats,
  },

  // ---------- 预算工具 ----------
  {
    name: 'budgets_status',
    description: '查询所有活跃预算的当前使用状态。输入 {user_id}（可选），返回各预算的 {budget_amount, spent, remaining, usage_pct}。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
      },
    },
    fn: budgetsStatus,
  },

  // ---------- 债务工具 ----------
  {
    name: 'debt_summary',
    description: '计算债务汇总：当期应还、逾期金额、利率。输入 {user_id}（可选），返回 {due_this_month, overdue_amount, total_debt, debt_count}。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
      },
    },
    fn: debtSummary,
  },

  // ---------- 投资组合工具 ----------
  {
    name: 'portfolio_metrics',
    description: '获取投资组合整体指标：总成本、总市值、总盈亏、持仓收益率。输入 {user_id}（可选），返回 {total_cost, total_value, total_profit, annualized_rate}。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
      },
    },
    fn: portfolioMetrics,
  },

  // ---------- 储蓄分析工具 ----------
  {
    name: 'savings_analysis',
    description: '分析用户储蓄能力：月均收入、月均支出、月均结余、当前储蓄率。输入 {user_id, months(可选，默认6)}，返回 {monthly_income_avg, monthly_expense_avg, monthly_savings_avg, savings_rate}。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
        months: { type: 'integer', description: '统计月数（默认 6，最大 24）' },
      },
    },
    fn: savingsAnalysis,
  },

  // ---------- 洞察工具 ----------
  {
    name: 'insights_recent',
    description: '获取用户最近生成的 AI 洞察（供 AI 回复时引用）。输入 {user_id, limit(默认5)}，返回最近的重要洞察列表。',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'integer', description: '用户 ID（可选，默认当前用户）' },
        limit: { type: 'integer', description: '返回条数（默认 5，最大 20）' },
        status: { type: 'string', description: '状态过滤：generated/read/dismissed（默认 generated）' },
      },
    },
    fn: insightsRecent,
  },
];

// ============================================
// Tool 实现（均为纯函数，无副作用）
// ============================================

async function accountsGetBalance({ account_id }) {
  try {
    const acc = await db.queryOne(
      `SELECT id, name, balance, type FROM accounts WHERE id = ?`,
      [account_id]
    );
    if (!acc) return { error: `账户 ${account_id} 不存在` };
    return {
      account_id: acc.id,
      name: acc.name,
      type: acc.type,
      balance: parseFloat(acc.balance),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function accountsList({ user_id, type, status = 'active' } = {}) {
  try {
    const sql = type
      ? `SELECT id, name, balance, type, status FROM accounts WHERE user_id = ? AND type = ? AND status = ? ORDER BY id`
      : `SELECT id, name, balance, type, status FROM accounts WHERE user_id = ? AND status = ? ORDER BY id`;
    const params = type ? [user_id, type, status] : [user_id, status];
    const rows = await db.query(sql, params);
    return { accounts: rows.map(r => ({ ...r, balance: parseFloat(r.balance) })) };
  } catch (err) {
    return { error: err.message };
  }
}

async function transactionsSearch({
  user_id, keyword, category_id, account_id, type,
  start_date, end_date, limit = 50,
} = {}) {
  try {
    const userCond = user_id ? `a.user_id = ?` : `1=1`;
    const params = user_id ? [user_id] : [];
    if (keyword) { params.push(`%${keyword}%`); }
    if (category_id) { params.push(category_id); }
    if (account_id) { params.push(account_id); }
    if (type) { params.push(type); }
    if (start_date) { params.push(start_date); }
    if (end_date) { params.push(end_date); }

    const where = [
      `a.user_id = COALESCE(?, a.user_id)`,
      keyword ? `t.merchant ILIKE ? OR t.note ILIKE ?` : null,
      category_id ? `t.category_id = ?` : null,
      account_id ? `t.account_id = ?` : null,
      type ? `t.type = ?` : null,
      start_date ? `t.trans_date >= ?` : null,
      end_date ? `t.trans_date <= ?` : null,
    ].filter(Boolean).join(' AND ');

    const finalLimit = Math.min(parseInt(limit, 10) || 50, 200);
    params.push(finalLimit);

    const sql = `
      SELECT t.id, t.trans_date, t.type, t.amount, t.merchant,
             t.category_id, c.name AS category_name, t.note, t.account_id
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE ${where}
      ORDER BY t.trans_date DESC, t.id DESC
      LIMIT ?`;

    // keyword 需要加两次（merchant + note）
    const finalParams = user_id ? [user_id] : [];
    if (keyword) {
      finalParams.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (category_id) finalParams.push(category_id);
    if (account_id) finalParams.push(account_id);
    if (type) finalParams.push(type);
    if (start_date) finalParams.push(start_date);
    if (end_date) finalParams.push(end_date);
    finalParams.push(finalLimit);

    const rows = await db.query(sql, finalParams);
    return { transactions: rows, count: rows.length };
  } catch (err) {
    return { error: err.message };
  }
}

async function transactionsStats({ user_id, start_date, end_date, group_by } = {}) {
  try {
    const params = [user_id, start_date, end_date];
    let sql = `
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN ABS(t.amount) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END), 0) AS expense,
        COUNT(t.id) AS transaction_count
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = ? AND t.trans_date BETWEEN ? AND ?`;

    const rows = await db.query(sql, params);
    const r = rows[0] || {};
    const income = parseFloat(r.income) || 0;
    const expense = parseFloat(r.expense) || 0;
    return {
      income,
      expense,
      balance: income - expense,
      transaction_count: parseInt(r.transaction_count, 10) || 0,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function budgetsStatus({ user_id } = {}) {
  try {
    const sql = `
      SELECT b.id, b.name, b.amount AS budget_amount, b.period,
             COALESCE(SUM(ABS(t.amount)), 0) AS spent
      FROM budgets b
      LEFT JOIN transactions t ON t.category_id = b.category_id
        AND t.type = 'expense'
        AND t.trans_date >= b.start_date
        AND (b.end_date IS NULL OR t.trans_date <= b.end_date)
      WHERE b.user_id = ? AND b.status = 'active'
      GROUP BY b.id
      ORDER BY b.created_at DESC`;

    const rows = await db.query(sql, [user_id]);
    return {
      budgets: rows.map(r => {
        const spent = parseFloat(r.spent) || 0;
        const amount = parseFloat(r.budget_amount) || 0;
        return {
          id: r.id,
          name: r.name,
          period: r.period,
          budget_amount: amount,
          spent,
          remaining: amount - spent,
          usage_pct: amount > 0 ? Math.round((spent / amount) * 100) : 0,
        };
      }),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function debtSummary({ user_id } = {}) {
  try {
    const { calcDebtDueSummary } = require('../services/debt-summary');
    const debts = await db.query(
      `SELECT * FROM debts WHERE user_id = ? AND status = 'active'`,
      [user_id]
    );

    const repaymentsByDebt = {};
    for (const d of debts) {
      const reps = await db.query(
        `SELECT amount, paid_at FROM debt_repayments WHERE debt_id = ? ORDER BY paid_at ASC`,
        [d.id]
      );
      repaymentsByDebt[d.id] = reps;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const summary = calcDebtDueSummary(debts, repaymentsByDebt, todayStr);

    return {
      due_this_month: summary.dueThisMonth,
      overdue_amount: summary.overdueAmount,
      total_debt: debts.reduce((s, d) => s + parseFloat(d.remaining || 0), 0),
      debt_count: debts.length,
      detail: debts.map(d => ({
        id: d.id, name: d.name, type: d.type,
        remaining: parseFloat(d.remaining || 0),
        interest_rate: parseFloat(d.interest_rate || 0),
      })),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function portfolioMetrics({ user_id } = {}) {
  try {
    const { calcPortfolioMetrics } = require('../services/portfolio');
    const investments = await db.query(
      `SELECT * FROM investments WHERE user_id = ? AND status = 'active'`,
      [user_id]
    );
    const metrics = calcPortfolioMetrics(investments);
    return {
      total_cost: metrics.totalCost,
      total_value: metrics.totalValue,
      total_profit: metrics.totalProfit,
      annualized_rate: metrics.annualizedRate,
      investment_count: investments.length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function savingsAnalysis({ user_id, months = 6 } = {}) {
  try {
    const m = Math.min(parseInt(months, 10) || 6, 24);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - m);
    const startStr = startDate.toISOString().slice(0, 10);

    const sql = `
      SELECT
        DATE_TRUNC('month', t.trans_date) AS month,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN ABS(t.amount) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END), 0) AS expense
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = ? AND t.trans_date >= ?
      GROUP BY 1
      ORDER BY 1 ASC`;

    const rows = await db.query(sql, [user_id, startStr]);
    if (rows.length === 0) {
      return { monthly_income_avg: 0, monthly_expense_avg: 0, monthly_savings_avg: 0, savings_rate: 0, months_analyzed: 0 };
    }

    const incomeAvg = rows.reduce((s, r) => s + (parseFloat(r.income) || 0), 0) / rows.length;
    const expenseAvg = rows.reduce((s, r) => s + (parseFloat(r.expense) || 0), 0) / rows.length;
    const savingsAvg = incomeAvg - expenseAvg;
    const savingsRate = incomeAvg > 0 ? Math.round((savingsAvg / incomeAvg) * 100) : 0;

    return {
      monthly_income_avg: Math.round(incomeAvg * 100) / 100,
      monthly_expense_avg: Math.round(expenseAvg * 100) / 100,
      monthly_savings_avg: Math.round(savingsAvg * 100) / 100,
      savings_rate: savingsRate,
      months_analyzed: rows.length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function insightsRecent({ user_id, limit = 5, status = 'generated' } = {}) {
  try {
    const rows = await db.query(
      `SELECT id, insight_type, importance, title, content, created_at
         FROM ai_insights
         WHERE user_id = ? AND status = ?
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`,
      [user_id, status, Math.min(parseInt(limit, 10) || 5, 20)]
    );
    return { insights: rows };
  } catch (err) {
    // 表可能尚未创建（首次部署时）
    if (/relation.*does not exist|ER_NO_SUCH_TABLE/i.test(err.message)) {
      return { insights: [] };
    }
    return { error: err.message };
  }
}

// ============================================
// Tool Registry 核心
// ============================================

/**
 * 获取所有 Tool 定义（供 LLM 调用 tool_calls 时使用）
 * 返回 OpenAI tool_calls 格式
 */
function getToolDefinitions() {
  return TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * 执行单个 Tool（供 LLM 的 tool_calls 结果处理）
 * @param {string} toolName
 * @param {object} args Tool 输入参数
 * @returns {Promise<object>} Tool 执行结果
 */
async function executeTool(toolName, args) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) {
    return { error: `Tool "${toolName}" 不存在` };
  }
  try {
    return await tool.fn(args || {});
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 批量执行多个 Tool（供 v2 Chat 处理 parallel tool_calls）
 * @param {Array<{name, args}>} calls
 * @returns {Promise<Array<{name, result}>>}
 */
async function executeTools(calls) {
  return Promise.all(
    (calls || []).map(async call => ({
      name: call.name,
      result: await executeTool(call.name, call.args || {}),
    }))
  );
}

module.exports = {
  TOOLS,
  getToolDefinitions,
  executeTool,
  executeTools,
};
