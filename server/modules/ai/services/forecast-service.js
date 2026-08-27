/* ============================================
   Forecast & Simulation 服务
   ------------------------------------------------
   功能模块：
     1. forecastCashflow   — 现金流预测（基于历史趋势）
     2. simulateBudget     — 预算调整模拟
     3. simulateSavingsGoal — 储蓄目标路径模拟
     4. simulateDebtPayoff — 债务还款计划模拟

   设计原则：
     - 计算可靠：金额/统计/预测由代码/SQL 计算，LLM 只负责推理解释
     - 所有模拟结果标记"情景假设"，不混入真实账本数据
   ============================================ */

const db = require('../../../db');

// ============================================
// 1. 现金流预测
// ============================================

/**
 * 预测未来 N 个月的现金流
 *
 * @param {number} userId
 * @param {number} [months=6]  预测月数（默认 6，最大 24）
 * @returns {Promise<{forecast: Array, trend: string, confidence: number}>}
 *
 * 算法：基于过去 6 个月历史数据，计算月均收入/支出/结余，
 *       然后用线性回归估算趋势（增幅/降幅），生成未来预测。
 */
async function forecastCashflow(userId, { months = 6 } = {}) {
    const lookbackMonths = Math.min(Math.max(parseInt(months, 10) || 6, 1), 24);

    // 读取历史数据
    const history = await db.query(`
        SELECT
            DATE_TRUNC('month', trans_date) AS month,
            COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END), 0) AS expense
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = ?
          AND t.trans_date >= CURDATE() - INTERVAL ${lookbackMonths + 2} MONTH
        GROUP BY 1
        ORDER BY 1 ASC
    `, [userId]);

    if (history.length < 2) {
        return {
            forecast: [],
            trend: 'insufficient_data',
            confidence: 0,
            message: '历史数据不足，无法进行预测（至少需要 2 个月数据）',
        };
    }

    // 计算月均值
    const incomeSeries = history.map(r => parseFloat(r.income));
    const expenseSeries = history.map(r => parseFloat(r.expense));
    const balanceSeries = history.map((r, i) => incomeSeries[i] - expenseSeries[i]);

    const avgIncome = mean(incomeSeries);
    const avgExpense = mean(expenseSeries);
    const avgBalance = mean(balanceSeries);

    // 线性回归求趋势斜率
    const incomeTrend = linearSlope(incomeSeries);
    const expenseTrend = linearSlope(expenseSeries);

    // 趋势判断
    const incomeTrendPct = avgIncome > 0 ? (incomeTrend.slope / avgIncome) * 100 : 0;
    const expenseTrendPct = avgExpense > 0 ? (expenseTrend.slope / avgExpense) * 100 : 0;

    let trend = 'stable';
    if (incomeTrendPct > 3) trend = 'income_rising';
    else if (incomeTrendPct < -3) trend = 'income_falling';
    if (expenseTrendPct > 3) trend = trend === 'stable' ? 'expense_rising' : trend + '_expense_rising';
    else if (expenseTrendPct < -3) trend = trend === 'stable' ? 'expense_falling' : trend + '_expense_falling';

    // 生成预测（指数加权，越近的月份权重越高）
    const lastMonth = new Date(history[history.length - 1].month);
    const forecast = [];
    let runningBalance = avgBalance; // 从当前月均结余起步

    for (let i = 1; i <= lookbackMonths; i++) {
        const projectedMonth = addMonths(lastMonth, i);
        const weight = i / lookbackMonths; // 越远权重越低（预测不确定性增加）

        const projectedIncome = Math.max(0, avgIncome + incomeTrend.slope * i * weight);
        const projectedExpense = Math.max(0, avgExpense + expenseTrend.slope * i * weight);
        const projectedBalance = runningBalance + projectedIncome - projectedExpense;

        forecast.push({
            month: projectedMonth.toISOString().slice(0, 7), // YYYY-MM
            projected_income: Math.round(projectedIncome * 100) / 100,
            projected_expense: Math.round(projectedExpense * 100) / 100,
            projected_balance: Math.round(projectedBalance * 100) / 100,
            confidence: Math.max(0.3, 0.9 - i * 0.08).toFixed(2), // 置信度随月数递减
        });

        runningBalance = projectedBalance;
    }

    // 整体置信度（基于历史数据量和趋势稳定性）
    const dataPoints = history.length;
    const trendStability = 1 - Math.min(Math.abs(incomeTrendPct) + Math.abs(expenseTrendPct), 50) / 50;
    const confidence = Math.max(0.3, Math.min(0.9, (dataPoints / 12) * 0.4 + trendStability * 0.6));

    return {
        forecast,
        trend,
        confidence: Math.round(confidence * 100) / 100,
        avg_monthly_income: Math.round(avgIncome * 100) / 100,
        avg_monthly_expense: Math.round(avgExpense * 100) / 100,
        avg_monthly_balance: Math.round(avgBalance * 100) / 100,
        history_months: history.length,
    };
}

// ============================================
// 2. 预算调整模拟
// ============================================

/**
 * 模拟调整某类目预算后的效果
 *
 * @param {number} userId
 * @param {number} categoryId  要调整的类目 ID
 * @param {number} newBudget   新的月预算上限
 * @param {number} [months=3] 模拟月数
 *
 * 返回：调整前后对比 + 超支风险评估
 */
async function simulateBudget(userId, categoryId, newBudget, { months = 3 } = {}) {
    // 获取历史月均消费
    const history = await db.query(`
        SELECT
            DATE_TRUNC('month', trans_date) AS month,
            SUM(ABS(amount)) AS spent
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = ?
          AND t.category_id = ?
          AND t.type = 'expense'
          AND t.trans_date >= CURDATE() - INTERVAL ${parseInt(months, 10) + 1} MONTH
        GROUP BY 1
        ORDER BY 1 ASC
    `, [userId, categoryId]);

    const category = await db.queryOne(
        `SELECT name FROM categories WHERE id = ?`,
        [categoryId]
    );

    const avgSpent = history.length > 0 ? mean(history.map(r => parseFloat(r.spent))) : 0;
    const excessRisk = avgSpent > newBudget ? Math.min(1, (avgSpent - newBudget) / newBudget + 0.5) : 0;

    const scenarios = [];
    for (let i = 1; i <= Math.min(parseInt(months, 10), 6); i++) {
        const projectedSpent = Math.min(avgSpent, newBudget); // 保守估计
        scenarios.push({
            month: addMonths(new Date(), i).toISOString().slice(0, 7),
            projected_spent: Math.round(projectedSpent * 100) / 100,
            budget: newBudget,
            surplus: Math.round((newBudget - projectedSpent) * 100) / 100,
        });
    }

    return {
        category_id: categoryId,
        category_name: category?.name || '未知类目',
        current_avg_spent: Math.round(avgSpent * 100) / 100,
        new_budget: newBudget,
        excess_risk: Math.round(excessRisk * 100) / 100, // 0=无风险, 1=高风险
        excess_risk_label: excessRisk < 0.3 ? '低风险' : excessRisk < 0.6 ? '中风险' : '高风险',
        scenarios,
        assumption: '假设月均消费维持历史均值，新预算限制下未来消费行为不变',
    };
}

// ============================================
// 3. 储蓄目标模拟
// ============================================

/**
 * 模拟储蓄目标实现路径
 *
 * @param {number} userId
 * @param {number} targetAmount  目标金额（元）
 * @param {number} [months=12]   计划月数
 * @param {number} [monthlySave] 月存金额（可选，不填则自动估算）
 *
 * 返回：逐月路径 + 达标概率评估
 */
async function simulateSavingsGoal(userId, targetAmount, { months = 12, monthlySave = null } = {}) {
    // 获取历史月均结余
    const history = await db.query(`
        SELECT
            DATE_TRUNC('month', trans_date) AS month,
            COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(amount) ELSE 0 END), 0) AS balance
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = ?
          AND t.trans_date >= NOW() - INTERVAL 12 MONTH
        GROUP BY 1
        ORDER BY 1 ASC
    `, [userId]);

    const avgMonthlySurplus = history.length > 0 ? mean(history.map(r => parseFloat(r.balance))) : 0;
    const recommendedMonthlySave = monthlySave ?? Math.max(0, avgMonthlySurplus);

    const plan = [];
    let current = 0;

    for (let i = 1; i <= Math.min(parseInt(months, 10), 60); i++) {
        current += recommendedMonthlySave;
        const remaining = Math.max(0, targetAmount - current);
        plan.push({
            month: i,
            balance: Math.round(current * 100) / 100,
            remaining: Math.round(remaining * 100) / 100,
            on_track: current >= (targetAmount * i / months),
        });
        if (current >= targetAmount) break;
    }

    const monthsNeeded = current > 0 ? Math.ceil(targetAmount / recommendedMonthlySave) : Infinity;
    const achievable = current >= targetAmount;
    const completionPct = current > 0 ? Math.min(100, Math.round((current / targetAmount) * 100)) : 0;

    return {
        target_amount: targetAmount,
        recommended_monthly_save: Math.round(recommendedMonthlySave * 100) / 100,
        months_needed: monthsNeeded === Infinity ? null : monthsNeeded,
        achievable,
        completion_pct: completionPct,
        monthly_surplus_avg: Math.round(avgMonthlySurplus * 100) / 100,
        plan: plan.slice(0, Math.min(plan.length, 24)), // 最多返回 24 个月
        assumption: achievable
            ? '假设月存金额维持推荐值，历史月均结余可实现目标'
            : '月均结余不足以实现目标，建议提高月存金额或延长计划时间',
    };
}

// ============================================
// 4. 债务还款模拟
// ============================================

/**
 * 模拟债务还款计划
 *
 * @param {number} userId
 * @param {number} [debtId]  特定债务 ID（可选，不填则模拟全部债务）
 * @param {number} [extraMonthlyPayment]  每月额外还款金额
 *
 * 返回：还款计划表（每月本金/利息/剩余/累计还款）
 */
async function simulateDebtPayoff(userId, { debtId = null, extraMonthlyPayment = 0 } = {}) {
    const sql = debtId
        ? `SELECT * FROM debts WHERE id = ? AND user_id = ? AND status = 'active'`
        : `SELECT * FROM debts WHERE user_id = ? AND status = 'active'`;
    const params = debtId ? [debtId, userId] : [userId];

    const debts = await db.query(sql, params);
    if (debts.length === 0) {
        return { plans: [], message: '暂无活跃债务记录' };
    }

    const plans = [];
    for (const debt of debts) {
        const plan = simulateSingleDebt({
            principal: parseFloat(debt.remaining || debt.total || 0),
            annualRate: parseFloat(debt.interest_rate || 0),
            minPayment: parseFloat(debt.min_payment || 0),
            extraMonthlyPayment,
        });
        plans.push({
            debt_id: debt.id,
            debt_name: debt.name,
            debt_type: debt.type,
            original_amount: parseFloat(debt.total || 0),
            ...plan,
        });
    }

    return {
        plans,
        total_debt: plans.reduce((s, p) => s + p.principal, 0),
        total_interest_saved: plans.reduce((s, p) => s + (p.interest_without_extra - p.interest_with_extra), 0),
        months_saved: plans.reduce((s, p) => s + (p.months_without_extra - p.months_with_extra), 0),
        extra_monthly_payment: extraMonthlyPayment,
    };
}

/**
 * 单笔债务还款模拟核心算法
 */
function simulateSingleDebt({ principal, annualRate, minPayment, extraMonthlyPayment }) {
    if (principal <= 0 || annualRate < 0) {
        return { principal: 0, months_with_extra: 0, months_without_extra: 0, interest_with_extra: 0, interest_without_extra: 0, schedule: [] };
    }

    const monthlyRate = annualRate / 100 / 12;

    // 基准还款计划（只还最低额）
    const { months: monthsWithout, interest: interestWithout } =
        simulateRepayment(principal, monthlyRate, minPayment, 0);

    // 额外还款计划
    const totalPayment = minPayment + extraMonthlyPayment;
    const { months: monthsWith, interest: interestWith, schedule } =
        simulateRepayment(principal, monthlyRate, totalPayment, 360);

    return {
        principal,
        annual_rate: annualRate,
        min_payment: minPayment,
        months_without_extra: monthsWithout,
        months_with_extra: monthsWith,
        interest_without_extra: Math.round(interestWithout * 100) / 100,
        interest_with_extra: Math.round(interestWith * 100) / 100,
        months_saved: monthsWithout - monthsWith,
        schedule: schedule.slice(0, 60), // 最多返回 60 期
    };
}

function simulateRepayment(principal, monthlyRate, monthlyPayment, maxMonths) {
    let balance = principal;
    let month = 0;
    let totalInterest = 0;
    const schedule = [];

    while (balance > 0.01 && month < maxMonths) {
        month++;
        const interest = balance * monthlyRate;
        totalInterest += interest;
        const principalPaid = Math.min(balance, monthlyPayment - interest);
        balance = Math.max(0, balance - principalPaid);
        schedule.push({
            month,
            payment: Math.min(monthlyPayment, balance + interest),
            principal: Math.round(principalPaid * 100) / 100,
            interest: Math.round(interest * 100) / 100,
            balance: Math.round(balance * 100) / 100,
        });
    }

    return { months: month, interest: totalInterest, schedule };
}

// ============================================
// 工具函数
// ============================================

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * 简单线性回归斜率
 * @returns {{slope: number, intercept: number}}
 */
function linearSlope(arr) {
    if (arr.length < 2) return { slope: 0, intercept: arr[0] || 0 };
    const n = arr.length;
    const xs = arr.map((_, i) => i);
    const xMean = mean(xs);
    const yMean = mean(arr);
    let numerator = 0, denominator = 0;
    for (let i = 0; i < n; i++) {
        numerator += (xs[i] - xMean) * (arr[i] - yMean);
        denominator += (xs[i] - xMean) ** 2;
    }
    const slope = denominator !== 0 ? numerator / denominator : 0;
    return { slope, intercept: yMean - slope * xMean };
}

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

module.exports = {
    forecastCashflow,
    simulateBudget,
    simulateSavingsGoal,
    simulateDebtPayoff,
};
