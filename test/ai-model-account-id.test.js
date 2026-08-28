/* ============================================
   模型建议账户（account_id）全链路测试
   ------------------------------------------------
     背景：v2 prompt 之前，模型【没有能力】建议账户 ——
       prompt 没提、清洗层没留字段、合并层没这个 key，
       所以账户永远只能靠本地正则猜（渠道关键词）或兜底。
     本文件守护三处打通：prompt → 清洗（白名单）→ 合并（保守覆盖）
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── mock services/ai（provider-gateway 是 lazy require，注入 cache 即可）──
const aiServicePath = require.resolve('../server/services/ai');
let capturedMessages = null;
let nextModelReply = null;

require.cache[aiServicePath] = {
    id: aiServicePath,
    filename: aiServicePath,
    loaded: true,
    exports: {
        getActiveProvider: async () => ({
            id: 1, api_type: 'openai', base_url: 'http://x',
            api_key: 'k', model: 'test-model',
        }),
        callProvider: async (provider, messages) => {
            capturedMessages = messages;
            return typeof nextModelReply === 'function'
                ? nextModelReply()
                : nextModelReply;
        },
    },
};

const { reviewWithModel } = require('../server/modules/ai/providers/provider-gateway');

const PROVIDER = { id: 1, api_type: 'openai', base_url: 'http://x', api_key: 'k', model: 'm' };
const CATEGORIES = [
    { id: 35, name: '居家', type: 'expense' },
    { id: 12, name: '餐饮', type: 'expense' },
];
const ACCOUNTS = [{ id: 7, name: '支付宝 花呗' }, { id: 8, name: '现金' }];
const CANDIDATES = [{
    seq: 1, type: 'expense', amount: 638.4, category_id: null,
    category_name: null, date: '2026-08-25', merchant: '永升物业', note: '',
}];

function replyWith(txns) {
    return JSON.stringify({ transactions: txns });
}

beforeEach(() => {
    capturedMessages = null;
    nextModelReply = null;
});

/* ─────────── 清洗层：account_id 白名单校验 ─────────── */

test('清洗：模型给出白名单内的 account_id → 保留', async () => {
    nextModelReply = replyWith([{
        seq: 1, amount: 638.4, account_id: 7, category_id: 35,
        conf: { account_id: 0.85, category_id: 0.9 },
    }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
    });
    assert.equal(r.ok, true);
    assert.equal(r.transactions[0].account_id, 7);
    assert.equal(r.transactions[0].conf.account_id, 0.85);
});

test('清洗：模型臆造的 account_id（不在白名单）→ 丢弃', async () => {
    nextModelReply = replyWith([{
        seq: 1, amount: 638.4, account_id: 999, category_id: 35,
    }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
    });
    assert.equal(r.ok, true);
    assert.equal(
        r.transactions[0].account_id,
        undefined,
        '账户与类目一样：臆造 id 必须丢弃，否则会污染余额'
    );
});

test('清洗：没传 accounts 时，任何 account_id 都丢弃', async () => {
    nextModelReply = replyWith([{ seq: 1, amount: 638.4, account_id: 7 }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
        // 不传 accounts
    });
    assert.equal(r.ok, true);
    assert.equal(r.transactions[0].account_id, undefined);
});

/* ─────────── 清洗层：日期支持到秒 ─────────── */

test('清洗：秒级日期 YYYY-MM-DD HH:MM:SS → 保留', async () => {
    nextModelReply = replyWith([{ seq: 1, amount: 638.4, date: '2026-08-25 10:30:45' }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.equal(r.transactions[0].date, '2026-08-25 10:30:45');
});

test('清洗：纯日期 YYYY-MM-DD → 补齐到秒（后端兜底，避免缺时分秒）', async () => {
    // 模型常常只给日期不听话。与其让前端显示「2026-08-26」这种不带时分秒的脏值，
    // 不如后端直接补齐：历史日期补 12:00:00（不把晚餐变凌晨），今天补当前时刻。
    nextModelReply = replyWith([{ seq: 1, amount: 638.4, date: '2026-08-25' }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.equal(r.transactions[0].date, '2026-08-25 12:00:00');
});

test('清洗：今天的日期 → 补当前时刻（而非 12:00:00）', async () => {
    const today = new Date().toISOString().slice(0, 10);
    nextModelReply = replyWith([{ seq: 1, amount: 20, date: today }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '买咖啡 20',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.match(r.transactions[0].date, new RegExp(`^${today} \\d{2}:\\d{2}:\\d{2}$`));
});

test('清洗：非法日期 → 丢弃', async () => {
    nextModelReply = replyWith([{ seq: 1, amount: 638.4, date: '1002-81-93' }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.equal(r.transactions[0].date, undefined);
});

/* ─────────── 回归保护：conf 键名不被归一化破坏 ─────────── */

test('清洗：conf 用原始字段名（category_id/account_id），供合并层按 f 读取', async () => {
    nextModelReply = replyWith([{
        seq: 1, amount: 638.4, category_id: 35, account_id: 7,
        conf: { type: 0.95, amount: 0.98, category_id: 0.9, account_id: 0.75, merchant: 0.8 },
    }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
    });
    const conf = r.transactions[0].conf;
    // ⚠️ 合并层此前用 conf['category'] 取类目置信度，恒为 undefined
    //    （模型的类目置信度被静默丢弃）。此处锁定键名为原始字段名。
    assert.equal(conf.category_id, 0.9, 'conf 必须用 category_id 而非 category');
    assert.equal(conf.account_id, 0.75, 'conf 必须用 account_id 而非 account');
    assert.equal(conf.amount, 0.98);
});

/* ─────────── prompt 版本追溯 ─────────── */

test('request 记录 prompt_version，便于事后回溯与 A/B', async () => {
    nextModelReply = replyWith([{ seq: 1, amount: 638.4 }]);
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.ok(r.request.prompt_version, 'request 应含 prompt_version');
    assert.equal(r.request.prompt_version, 'v1', '未配置环境变量时默认 v1');
});
