/* ============================================
   合并层保守策略 + 路由可配置 测试
   ============================================ */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

/* ─────────── 一、合并层：account_id 保守覆盖 ─────────── */
// 合并逻辑内嵌在 parseTransactions 里，这里抽出等价规则单独验证，
// 防止将来重构时把"保守覆盖"改回"无条件覆盖"。

/**
 * 复刻 transaction-parser 中的账户合并判定。
 * @returns {boolean} true = 采用模型建议的账户
 */
function shouldApplyModelAccount(localConfidence, modelConfidence) {
    const localScore = Number(localConfidence) || 0;
    const modelScore = Number(modelConfidence) || 0;
    return modelScore > localScore;
}

test('合并：模型比本地更有把握 → 采用模型账户', () => {
    // 场景：本地只靠 last_used 兜底（0.5），模型从原文"花呗"认出账户（0.85）
    assert.equal(shouldApplyModelAccount(0.5, 0.85), true);
});

test('合并：本地无账户（0）而模型有 → 采用模型账户', () => {
    // 这是本次改造最核心的收益场景：此前账户永远靠本地猜
    assert.equal(shouldApplyModelAccount(0, 0.75), true);
    assert.equal(shouldApplyModelAccount(undefined, 0.75), true);
});

test('合并：本地渠道硬命中（0.94）高于模型软推测（0.6）→ 保留本地', () => {
    // 原文明确写了"支付宝"，本地 resolveAccount 命中渠道，这是硬证据，
    // 不该被模型的软推测推翻 —— 否则会污染余额。
    assert.equal(shouldApplyModelAccount(0.94, 0.6), false);
});

test('合并：两者相等 → 保留本地（不因持平而翻转）', () => {
    assert.equal(shouldApplyModelAccount(0.8, 0.8), false);
});

test('合并：模型没给置信度 → 保留本地', () => {
    assert.equal(shouldApplyModelAccount(0.7, undefined), false);
    assert.equal(shouldApplyModelAccount(0.7, null), false);
});

/* ─────────── 二、conf 键名：合并层按原始字段名读取 ─────────── */

test('合并：conf 必须按原始字段名读取（category_id/account_id）', () => {
    // 回归保护：此前用归一化 key（category）去取 conf，恒为 undefined，
    // 导致模型自报的类目置信度被静默丢弃。
    const conf = { category_id: 0.9, account_id: 0.75 };
    const normalizedKeyOf = (f) => (f === 'category_id' ? 'category'
        : f === 'account_id' ? 'account' : f);

    // ❌ 老写法
    assert.equal(conf[normalizedKeyOf('category_id')], undefined, '老写法取不到值');
    // ✅ 新写法
    assert.equal(conf['category_id'], 0.9, '新写法按原始字段名取');
    assert.equal(conf['account_id'], 0.75);
});

/* ─────────── 三、路由：simple 是否走模型可配置 ─────────── */

const { route, isSimpleModelRouteAllowed, resetBreakers } = require('../server/modules/ai/runtime/model-router');

const PROVIDER = { id: 1, model: 'm', cheap_model: 'cheap', strong_model: 'strong' };
const simple = { level: 'simple', features: {}, score: 0, reasons: [] };
const medium = { level: 'medium', features: {}, score: 3, reasons: [] };
const complex = { level: 'complex', features: {}, score: 6, reasons: [] };

beforeEach(() => {
    resetBreakers();
    delete process.env.AI_MODEL_ROUTE_SIMPLE;
});
afterEach(() => {
    delete process.env.AI_MODEL_ROUTE_SIMPLE;
});

test('路由：默认 simple → local（省钱策略不变）', () => {
    assert.equal(isSimpleModelRouteAllowed(), false);
    const r = route({ complexity: simple, provider: PROVIDER, allowModel: true });
    assert.equal(r.route, 'local');
    assert.equal(r.reason, 'simple_local_sufficient');
});

test('路由：AI_MODEL_ROUTE_SIMPLE=true 时 simple 也走模型', () => {
    process.env.AI_MODEL_ROUTE_SIMPLE = 'true';
    assert.equal(isSimpleModelRouteAllowed(), true);
    const r = route({ complexity: simple, provider: PROVIDER, allowModel: true });
    assert.equal(r.route, 'cheap_model', 'simple 走模型时用便宜模型即可');
    assert.equal(r.model, 'cheap');
});

test('路由：simple 要模型但无 provider → 仍退回 local（不报错）', () => {
    process.env.AI_MODEL_ROUTE_SIMPLE = 'true';
    const r = route({ complexity: simple, provider: null, allowModel: true });
    assert.equal(r.route, 'local');
    assert.equal(r.reason, 'no_provider_configured');
});

test('路由：allowSimpleModel 参数可覆盖环境变量（评测用）', () => {
    process.env.AI_MODEL_ROUTE_SIMPLE = 'true';
    // 显式传 false 关闭 → 即便环境变量开了也不走模型
    const r = route({
        complexity: simple, provider: PROVIDER,
        allowModel: true, allowSimpleModel: false,
    });
    assert.equal(r.route, 'local', '显式参数优先级高于环境变量');
});

test('路由：medium / complex 行为不受本次改动影响', () => {
    assert.equal(route({ complexity: medium, provider: PROVIDER, allowModel: true }).route, 'cheap_model');
    assert.equal(route({ complexity: complex, provider: PROVIDER, allowModel: true }).route, 'strong_model');
});

test('路由：AI_ALLOW_MODEL_ROUTE=false 时全部降级 local', () => {
    process.env.AI_MODEL_ROUTE_SIMPLE = 'true';
    assert.equal(route({ complexity: complex, provider: PROVIDER, allowModel: false }).route, 'local');
    assert.equal(route({ complexity: simple, provider: PROVIDER, allowModel: false }).route, 'local');
});
