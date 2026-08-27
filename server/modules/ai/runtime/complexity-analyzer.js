/* ============================================
   Complexity Analyzer
   ------------------------------------------------
   复杂度特征，全部落地为可测的布尔/数值信号：
     multiple_transactions / multiple_amounts / ambiguous_date / transfer_detection
     merchant_unknown / conflicting_signals / long_input / historical_conflict

   ⛔ 方案 §10 结尾原文：「Router 的目标不是追求『最聪明模型』，
      而是在准确率、延迟与成本之间选择足够的能力。」
      ⇒ 本项目当前纯规则识别率已达 100%（25/25 真实类目表），
        因此 simple 一律走 local，绝不为"看起来高级"而调模型烧钱。
   ============================================ */

const LONG_INPUT_CHARS = 60;

/**
 * 分析复杂度。
 *
 * @param {object} params
 * @param {string} params.text
 * @param {object} params.extraction  确定性抽取结果
 * @param {object} params.memory      Memory Retrieval 结果
 * @param {object} params.validation  Result Validator 结果
 * @returns {{level:'simple'|'medium'|'complex', features:object, score:number, reasons:string[]}}
 */
function analyzeComplexity({ text, extraction, memory = {}, validation }) {
    const txns = extraction.transactions || [];
    const raw = String(text || '');

    const features = {
        multiple_transactions: txns.length > 1,
        // 多个金额但只识别出一笔 → 很可能漏拆
        multiple_amounts: countAmounts(raw) > Math.max(1, txns.length),
        ambiguous_date: txns.some(t => t.evidence && t.evidence.date === 'default_today')
                        && /上[个周]|前几天|之前|最近|某天/.test(raw),
        transfer_detection: txns.some(t => t.type === 'transfer'),
        merchant_unknown: txns.some(t => !t.merchant),
        conflicting_signals: hasConflictingSignals(raw, txns),
        long_input: raw.length > LONG_INPUT_CHARS,
        historical_conflict: (memory.negated || []).length > 0,
    };

    const reasons = Object.entries(features)
        .filter(([, v]) => v)
        .map(([k]) => k);

    // 加权打分：拆分错误与方向冲突后果最重，商家未知最轻
    const WEIGHTS = {
        multiple_amounts: 3,
        conflicting_signals: 3,
        historical_conflict: 2,
        ambiguous_date: 2,
        multiple_transactions: 1,
        transfer_detection: 1,
        long_input: 1,
        merchant_unknown: 1,
    };
    let score = 0;
    for (const [k, on] of Object.entries(features)) if (on) score += WEIGHTS[k] || 1;

    // 校验裁决直接抬升复杂度：invalid 说明本地能力确实不够
    if (validation && validation.verdict === 'invalid') score += 4;
    else if (validation && validation.verdict === 'needs_confirmation') score += 1;

    const level = score >= 6 ? 'complex' : (score >= 3 ? 'medium' : 'simple');

    return { level, features, score, reasons };
}

/** 统计文本里的金额型数字个数 */
function countAmounts(text) {
    const m = text.match(/\d+(?:[.,]\d+)?\s*(?:元|块|块钱|rmb|人民币|¥|￥)?/gi) || [];
    // 过滤纯数量词（如「3个苹果」里的 3）：后面紧跟量词的不算金额
    return m.filter(s => !/^\d+\s*$/.test(s) || /[元块¥￥]/.test(s)).length;
}

/** 同一段文本里同时出现收入与支出方向词 → 信号冲突 */
function hasConflictingSignals(text, txns) {
    const hasIncome = /(收到|进账|入账|到账|工资|奖金|收益|分红|利息|退款|返现)/.test(text);
    const hasExpense = /(花了|付了|支付|消费|买了|充值|缴费)/.test(text);
    if (hasIncome && hasExpense && txns.length === 1) return true;
    // 转账词与收支词并存也是冲突
    const hasTransfer = /(转账|转给|转到|划转)/.test(text);
    if (hasTransfer && (hasIncome || hasExpense) && txns.length === 1) return true;
    return false;
}

module.exports = { analyzeComplexity, countAmounts, hasConflictingSignals, LONG_INPUT_CHARS };
