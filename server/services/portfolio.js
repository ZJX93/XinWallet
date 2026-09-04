/* ============================================
   鑫钱包 · 理财组合计算服务
   持仓收益率、年化、集中度、预期收益加权等纯函数

   修复审核报告 M3（金额精度）：
     金额类计算（成本/市值/浮盈）改用整数分内核，消除浮点累加分位漂移。
     比率类指标（年化、收益率）本身是浮点语义，保留浮点但统一四舍五入位数。
   ============================================ */

const { sumAmounts, subtractAmounts, toCents, fromCents, percentOf } = require('./money');

/**
 * 单持仓年化收益率（基于买入日持有期的【复合年化 / 复利 CAGR】）
 * 公式: ((当前值/成本)^(365/持有天数) - 1) * 100
 *
 * 说明：复合年化是金融标准算法，长期持有更精确（如 90 天 +5% → 22.13%，
 * 与教科书一致）。代价是在极短持有期会把小幅收益外推成极大值（如 9 天 +9%
 * → 4194%），这是复利年化的数学本征，前端对超过 ±100000% 的展示为 '--'。
 *
 * 可靠性约束：
 *  - 成本/市值非正、买入日缺失或非法 → null
 *  - 当天或未来买入（尚无持有期） → null
 *  - 持有不足 7 天（样本太短） → null
 *  - 计算结果超出 ±100000%（极端外推，超出前端展示上限） → null
 */
function annualizedRate(totalCost, currentValue, buyDate) {
  const cost = parseFloat(totalCost);
  const value = parseFloat(currentValue);
  if (!(cost > 0) || !(value > 0) || !buyDate) return null;

  const start = new Date(buyDate);
  if (isNaN(start.getTime())) return null;

  const days = (Date.now() - start.getTime()) / 86400000;
  if (days <= 0) return null;          // 当天/未来买入：无持有期
  if (days < 7) return null;           // 持有过短：年化无意义

  const ann = (Math.pow(value / cost, 365 / days) - 1) * 100;
  if (!isFinite(ann) || Math.abs(ann) > 100000) return null;
  return Math.round(ann * 100) / 100;
}

/**
 * 组合进阶指标
 * @param {Array} investments - 持仓记录数组（含 total_cost, current_value, buy_date, expected_rate）
 * @returns {{ totalCost: number, totalValue: number, totalProfit: number, annualizedRate: number, concentration: number, expectedRateAvg: number }}
 */
function calcPortfolioMetrics(investments) {
  if (!investments || investments.length === 0) {
    return {
      totalCost: 0, totalValue: 0, totalProfit: 0,
      annualizedRate: 0, concentration: 0, expectedRateAvg: 0
    };
  }

  // 金额精度（M3）：整数分累加，替代原 parseFloat 浮点 reduce
  const tCost = sumAmounts(investments, i => i.total_cost);
  const tVal  = sumAmounts(investments, i => i.current_value);

  // 最早买入日期（用于年化计算）；顺带过滤 Invalid Date，避免污染比较
  const earliest = investments.reduce((min, i) => {
    const d = i.buy_date ? new Date(i.buy_date) : null;
    if (!d || isNaN(d.getTime())) return min;
    return (!min || d < min) ? d : min;
  }, null);

  const days = earliest ? Math.max((Date.now() - earliest.getTime()) / 86400000, 1) : 0;
  // 组合年化同样采用复合年化（复利 CAGR），与单持仓保持一致
  const rawAnn = (tCost > 0 && tVal > 0 && days > 0)
    ? (Math.pow(tVal / tCost, 365 / days) - 1) * 100
    : null;
  // 组合年化受极端值约束：超出 ±100000%（前端展示上限）视为不可信，返回 null（前端显示 '--'）
  const annualized = (rawAnn != null && isFinite(rawAnn) && Math.abs(rawAnn) <= 100000)
    ? Math.round(rawAnn * 100) / 100
    : null;

  // 集中度：最大持仓占比（用整数分取最大值，消除浮点比较误差）
  const maxHoldingCents = investments.reduce((m, i) => {
    const c = toCents(i.current_value);
    return Number.isSafeInteger(c) && c > m ? c : m;
  }, 0);

  // 预期收益加权平均：权重（金额）在分域相乘，避免浮点累乘误差
  let weightedSum = 0;
  for (const i of investments) {
    const rate = parseFloat(i.expected_rate || 0);
    if (!Number.isFinite(rate)) continue;
    weightedSum += toCents(i.total_cost) * rate;
  }
  const expectedRateAvg = tCost > 0 ? weightedSum / toCents(tCost) : 0;

  return {
    totalCost: tCost,
    totalValue: tVal,
    totalProfit: subtractAmounts(tVal, tCost),
    annualizedRate: annualized,
    concentration: percentOf(fromCents(maxHoldingCents), tVal, 1),
    expectedRateAvg: Math.round(expectedRateAvg * 100) / 100
  };
}

module.exports = {
  annualizedRate,
  calcPortfolioMetrics
};
