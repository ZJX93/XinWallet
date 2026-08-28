/* ============================================
   LLM-first（模型主抽取）测试
   ------------------------------------------------
     验证「以模型结果为主、本地仅兜底」的合并语义，
     以及开关默认关闭、模型空结果时回退等安全行为。
   ============================================ */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { isLlmFirstEnabled } = require('../server/modules/ai/runtime/model-router');
const { mergeLlmFirst } = require('../server/modules/ai/parser/transaction-parser');

const ROUTING = { route: 'strong_model' };

/** 本地抽取结果（模拟确定性抽取器的输出形态） */
const LOCAL = [{
    seq: 1,
    type: 'expense',
    amount: 638.4,
    currency: 'CNY',
    merchant: null,
    category_id: null,
    account_id: null,
    date: '2026-08-28 00:00:00',
    note: 'K/s-76.3 K/s 物业维修 永升物业樾溪臺',
    raw_segment: 'K/s-76.3 K/s 物业维修 638.4元 永升物业樾溪臺',
    confidence: { amount: 0.98, type: 0.93, category: 0.55, date: 0.3, currency: 0.95, merchant: 0, account: 0 },
    evidence: { amount: 'currency_unit', type: 'expense_keyword', category: 'fallback_other', date: 'default_today_now' },
}];

beforeEach(() => { delete process.env.AI_LLM_FIRST; });
afterEach(() => { delete process.env.AI_LLM_FIRST; });

/* ─────────── 开关 ─────────── */

test('默认关闭：保持「本地主抽取 + 模型复核」', () => {
    assert.equal(isLlmFirstEnabled(), false);
});

test('AI_LLM_FIRST=true 才启用', () => {
    process.env.AI_LLM_FIRST = 'true';
    assert.equal(isLlmFirstEnabled(), true);
});

/* ─────────── mergeLlmFirst ─────────── */

test('模型返回空 → 返回空数组（调用方据此回退传统链路）', () => {
    assert.deepEqual(mergeLlmFirst([], LOCAL, 'x', ROUTING), []);
    assert.deepEqual(mergeLlmFirst(null, LOCAL, 'x', ROUTING), []);
    assert.deepEqual(mergeLlmFirst(undefined, LOCAL, 'x', ROUTING), []);
});

test('以模型结果为主：笔数由模型决定（模型能拆出本地漏掉的笔）', () => {
    // 本地只抽出 1 笔，模型识别出实际是 2 笔 —— 这是 LLM-first 的核心收益
    const modelTxns = [
        { seq: 1, type: 'expense', amount: 638.4, category_id: 35, date: '2026-08-25', merchant: '永升物业', note: '物业维修' },
        { seq: 2, type: 'expense', amount: 28, category_id: 12, date: '2026-08-25', merchant: '楼下便利店', note: '午餐' },
    ];
    const r = mergeLlmFirst(modelTxns, LOCAL, '原文', ROUTING);
    assert.equal(r.length, 2, '笔数应由模型决定，而非本地的 1 笔');
    assert.equal(r[0].amount, 638.4);
    assert.equal(r[1].amount, 28);
});

test('模型未给出的字段用本地值兜底', () => {
    // 模型只给了类目和账户，其余字段缺失
    const modelTxns = [{ seq: 1, category_id: 35, account_id: 7 }];
    const r = mergeLlmFirst(modelTxns, LOCAL, '原文', ROUTING);
    assert.equal(r[0].category_id, 35, '用模型给的类目');
    assert.equal(r[0].account_id, 7, '用模型给的账户');
    assert.equal(r[0].amount, 638.4, '金额模型没给 → 回退本地');
    assert.equal(r[0].type, 'expense', '类型模型没给 → 回退本地');
    assert.equal(r[0].currency, 'CNY', '币种模型没给 → 回退本地');
    assert.equal(r[0].note, LOCAL[0].note, '备注模型没给 → 回退本地');
});

test('无本地结果可兜底时，缺失字段为默认安全值', () => {
    const r = mergeLlmFirst([{ seq: 1, category_id: 35 }], [], '原文', ROUTING);
    assert.equal(r[0].type, 'expense', '无本地值时退到 expense 默认');
    assert.equal(r[0].amount, null, '金额无来源 → null（交给 validator 判 invalid）');
    assert.equal(r[0].raw_segment, '原文');
});

test('置信度：模型自报为准，缺失时沿用本地', () => {
    const modelTxns = [{
        seq: 1, amount: 638.4, category_id: 35, account_id: 7,
        conf: { amount: 0.95, category_id: 0.88, account_id: 0.7 },
    }];
    const r = mergeLlmFirst(modelTxns, LOCAL, '原文', ROUTING);
    assert.equal(r[0].confidence.amount, 0.95, '模型自报的金额置信度');
    assert.equal(r[0].confidence.category, 0.88, 'category_id 的 conf 应映射到 category');
    assert.equal(r[0].confidence.account, 0.7, 'account_id 的 conf 应映射到 account');
    assert.equal(r[0].confidence.currency, 0.95, '模型没报 currency → 沿用本地');
});

test('置信度：模型未报的字段归 0（让 validator 判 invalid 而非假装可信）', () => {
    const r = mergeLlmFirst([{ seq: 1, amount: 100 }], [], '原文', ROUTING);
    assert.equal(r[0].confidence.amount, 0, '模型没自报 → 0，不能假装高置信');
    assert.equal(r[0].confidence.category, 0);
});

test('evidence 标记为模型主抽取，便于「识别依据」展示与审计', () => {
    const r = mergeLlmFirst([{ seq: 1, amount: 100, category_id: 35 }], LOCAL, '原文', ROUTING);
    for (const k of ['amount', 'type', 'category', 'account', 'date', 'merchant']) {
        assert.equal(r[0].evidence[k], 'model_first_strong_model', `${k} 应标记为模型主抽取`);
    }
});

test('seq 缺失时按数组下标补上，保证下游能配对', () => {
    const r = mergeLlmFirst([{ amount: 10 }, { amount: 20 }], [], '原文', ROUTING);
    assert.equal(r[0].seq, 1);
    assert.equal(r[1].seq, 2);
});

test('seq 存在时保持模型给定的值（按 seq 找本地兜底）', () => {
    const local = [
        { seq: 1, amount: 100, currency: 'CNY', confidence: {}, evidence: {} },
        { seq: 2, amount: 200, currency: 'CNY', confidence: {}, evidence: {} },
    ];
    // 模型只给了 seq=2，应正确配到本地的第 2 条来兜底
    const r = mergeLlmFirst([{ seq: 2, category_id: 12 }], local, '原文', ROUTING);
    assert.equal(r[0].seq, 2);
    assert.equal(r[0].amount, 200, '应按 seq=2 配到本地第 2 条');
});

test('模型的 amount=0 不应被当成「没给」而回退（0 是有意义的值）', () => {
    // m.amount != null 的判定：0 是有效数字，不应回退到本地的 638.4
    const r = mergeLlmFirst([{ seq: 1, amount: 0 }], LOCAL, '原文', ROUTING);
    assert.equal(r[0].amount, 0, '0 应被保留而非回退成本地值');
});
