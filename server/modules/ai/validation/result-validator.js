/* ============================================
   AI v0.2 · 结果验证器（Result Validator）
   ------------------------------------------------
   落实 v0.2 §5：【禁止只看整体 confidence】。
   即便 overall=0.85，只要 category=0.55 也必须 needs_confirmation。
   overall 仅作展示用，裁决完全由「最低字段是否达标」决定。

   裁决三态：
     invalid            —— 结构性缺失（无金额/金额非法/类目 id 缺失），不可提交
     needs_confirmation —— 可提交但必须用户确认
     ready              —— 全字段达标（前端仍建议二次确认）
   ============================================ */

// §6 字段级阈值。金额最严（错了直接污染账本），商家最松（仅备注用途）。
const FIELD_THRESHOLDS = {
    amount: 0.9,
    type: 0.8,
    category: 0.7,
    date: 0.8,
    merchant: 0.5,
};

// 参与裁决的字段（currency 不参与：默认 CNY 已足够安全）
const DECISIVE_FIELDS = ['amount', 'type', 'category', 'date'];

const MAX_AMOUNT = 1e10; // 与 validate.js 的 toAmount 上限一致

/**
 * 校验单笔候选交易。
 * @returns {{verdict:string, per_field:object, overall:number, reasons:string[]}}
 */
function validateTransaction(txn, thresholds = FIELD_THRESHOLDS) {
    const reasons = [];
    const perField = {};
    const conf = txn.confidence || {};

    // ---- 结构性硬校验（先于置信度：数据非法时置信度再高也无意义） ----
    let structurallyInvalid = false;

    if (txn.amount === null || txn.amount === undefined) {
        reasons.push('未能识别金额');
        structurallyInvalid = true;
    } else if (!Number.isFinite(txn.amount) || txn.amount <= 0) {
        reasons.push(`金额非法（${txn.amount}）`);
        structurallyInvalid = true;
    } else if (txn.amount > MAX_AMOUNT) {
        reasons.push(`金额超出上限（${txn.amount} > ${MAX_AMOUNT}）`);
        structurallyInvalid = true;
    }

    if (!['income', 'expense', 'transfer'].includes(txn.type)) {
        reasons.push(`交易类型非法（${txn.type}）`);
        structurallyInvalid = true;
    }

    // 类目 id 缺失 → 无法落账（transfer 由 commit 侧解析转账类目，此处豁免）
    if (txn.type !== 'transfer' && !txn.category_id) {
        reasons.push('未能匹配到有效类目（category_id 缺失）');
        structurallyInvalid = true;
    }

    if (!txn.date || !/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
        reasons.push(`日期格式非法（${txn.date}）`);
        structurallyInvalid = true;
    }

    // ---- 字段级置信度校验 ----
    let allPass = true;
    for (const f of DECISIVE_FIELDS) {
        const score = typeof conf[f] === 'number' ? conf[f] : 0;
        const th = thresholds[f];
        const ok = score >= th;
        perField[f] = { score, threshold: th, ok };
        if (!ok) {
            allPass = false;
            reasons.push(`${f} 置信度 ${score.toFixed(2)} 低于阈值 ${th}`);
        }
    }
    // merchant 记录但不参与裁决
    perField.merchant = {
        score: typeof conf.merchant === 'number' ? conf.merchant : 0,
        threshold: thresholds.merchant,
        ok: (conf.merchant || 0) >= thresholds.merchant,
        decisive: false,
    };

    // overall 仅供展示：取决策字段均值（明确标注不用于裁决）
    const scores = DECISIVE_FIELDS.map(f => (typeof conf[f] === 'number' ? conf[f] : 0));
    const overall = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)) : 0;

    const verdict = structurallyInvalid ? 'invalid' : (allPass ? 'ready' : 'needs_confirmation');
    return { verdict, per_field: perField, overall, reasons };
}

/**
 * 校验整个候选集（多笔）。
 * 汇总规则（保守优先）：
 *   任一笔 invalid → 整体 invalid（不允许「部分落账」造成账目残缺）
 *   任一笔 needs_confirmation → 整体 needs_confirmation
 *   全部 ready → ready
 */
function validateResult(transactions, thresholds = FIELD_THRESHOLDS) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
        return {
            verdict: 'invalid',
            overall: 0,
            reasons: ['未能从输入中识别出任何交易'],
            per_txn: [],
            per_field: {},
        };
    }

    const perTxn = transactions.map(t => ({ seq: t.seq, ...validateTransaction(t, thresholds) }));

    const hasInvalid = perTxn.some(v => v.verdict === 'invalid');
    const hasNeeds = perTxn.some(v => v.verdict === 'needs_confirmation');
    const verdict = hasInvalid ? 'invalid' : (hasNeeds ? 'needs_confirmation' : 'ready');

    const overall = Number(
        (perTxn.reduce((a, v) => a + v.overall, 0) / perTxn.length).toFixed(4)
    );

    // 汇总原因，带笔序前缀便于前端定位
    const reasons = [];
    for (const v of perTxn) {
        for (const r of v.reasons) {
            reasons.push(perTxn.length > 1 ? `第${v.seq}笔：${r}` : r);
        }
    }

    return {
        verdict,
        overall,
        reasons,
        per_txn: perTxn,
        // 便捷视图：首笔字段明细（单笔场景前端直接用）
        per_field: perTxn[0] ? perTxn[0].per_field : {},
        thresholds,
    };
}

module.exports = { validateResult, validateTransaction, FIELD_THRESHOLDS, DECISIVE_FIELDS };
