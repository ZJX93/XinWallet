/* ============================================
   reviewWithModel 集成测试
   —— 验证「用户记账习惯」确实被注入到大模型 prompt 里
   —— 关键回归保护：无记忆时 prompt 必须与"无 few-shot 的 v3 基线"一致
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// mock 掉 services/ai（provider-gateway 是 lazy require，注入 cache 即可生效）
const aiServicePath = require.resolve('../server/services/ai');
let capturedMessages = null;
let capturedModel = null;

require.cache[aiServicePath] = {
    id: aiServicePath,
    filename: aiServicePath,
    loaded: true,
    exports: {
        getActiveProvider: async () => null,
        callProvider: async (provider, messages) => {
            capturedMessages = messages;
            capturedModel = provider.model;
            return JSON.stringify({
                transactions: [{
                    seq: 1, type: 'expense', amount: 638.4, category_id: 35,
                    merchant: '永升物业', note: '物业维修',
                    conf: { amount: 0.98, category_id: 0.9 },
                }],
            });
        },
    },
};

const { reviewWithModel } = require('../server/modules/ai/providers/provider-gateway');
const { buildParserMessages } = require('../server/modules/ai/prompts/parser-prompt');

const PROVIDER = { id: 1, api_type: 'openai', base_url: 'http://x', api_key: 'k', model: 'm' };
const CATEGORIES = [
    { id: 35, name: '居家', type: 'expense' },
    { id: 40, name: '房屋租赁', type: 'expense' },
    { id: 12, name: '餐饮', type: 'expense' },
];
const ACCOUNTS = [{ id: 7, name: '支付宝 花呗' }, { id: 8, name: '现金' }];
const CANDIDATES = [{
    seq: 1, type: 'expense', amount: 638.4, category_id: null,
    category_name: null, date: '2026-08-25', merchant: '永升物业', note: '',
}];

/**
 * 注入习惯之前的基线 system prompt，用于回归比对。
 * 关注点隔离：本文件只守护"习惯注入行为"，prompt 文本本身由
 * ai-parser-prompt.test.js 守护，故这里用同版本函数动态生成基线。
 */
function baseSystemPrompt(accounts) {
    return buildParserMessages({
        text: '物业维修 638.4元', candidates: CANDIDATES,
        categories: CATEGORIES, accounts: accounts || [], version: 'v3',
    }).messages[0].content;
}

beforeEach(() => {
    capturedMessages = null;
    capturedModel = null;
});

/* ─────────── 回归保护：无记忆时行为完全不变 ─────────── */

test('reviewWithModel: 不传 memory 且不传 accounts → prompt 与基线一致', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.equal(r.ok, true, 'mock provider 应返回成功');
    assert.equal(
        capturedMessages[0].content,
        baseSystemPrompt([]),
        '无记忆且无账户时 system prompt 必须与基线完全一致（不能多一个换行）'
    );
});

test('reviewWithModel: 传空记忆对象 → 无 accounts 时 prompt 仍与基线一致', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
        accounts: [],                       // 空账户 → 不生成账户白名单
        memory: { candidates: [], negated: [], frequent_merchants: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(capturedMessages[0].content, baseSystemPrompt([]));
    assert.equal(r.request.memory_hints_injected, false, '空记忆应标记为未注入');
});

/* ─────────── 有记忆时确实注入 ─────────── */

test('reviewWithModel: 有习惯记忆 → system prompt 里出现【用户记账习惯】', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
        memory: {
            candidates: [{
                layer: 'procedural', source: 'manual_rule', match_key: '永升物业',
                field: 'category', category_id: 35, account_id: 7,
                confidence: 0.97, support: 12,
            }],
            negated: [{ match_key: '物业维修', category_id: 40 }],
            frequent_merchants: ['永升物业', '星巴克'],
        },
    });

    assert.equal(r.ok, true);
    const sys = capturedMessages[0].content;

    // 旧内容必须原样保留（是"追加"而非"替换"）
    assert.ok(sys.startsWith(baseSystemPrompt(ACCOUNTS)), '基线 prompt 内容必须原样保留在前');

    // 新注入的内容
    assert.match(sys, /【用户记账习惯】/);
    assert.match(sys, /「永升物业」 → 类目「居家」 \+ 账户「支付宝 花呗」（历史 12 笔）/);
    assert.match(sys, /【已被用户纠正，不要重犯】/);
    assert.match(sys, /「物业维修」不要归到「房屋租赁」/);
    assert.match(sys, /【可用账户】.*7:支付宝 花呗/);
    assert.match(sys, /【该用户常消费的商家】永升物业、星巴克/);

    // 审计字段
    assert.equal(r.request.memory_hints_injected, true);
    assert.ok(r.request.memory_hints_length > 0);
});

test('reviewWithModel: 只传 accounts（无记忆）→ 只追加账户白名单', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
        memory: null,
    });
    assert.equal(r.ok, true);
    const sys = capturedMessages[0].content;
    assert.ok(sys.startsWith(baseSystemPrompt(ACCOUNTS)));
    assert.match(sys, /【可用账户】只能从这些里选，不得臆造 id：7:支付宝 花呗, 8:现金/);
    // 仅验证"未注入记忆习惯区块"：v3 本体的账户规则里本就含"【用户记账习惯】"字样，
    // 故不能用该词判断；以记忆专属的【该用户常消费的商家】区块作为未注入依据。
    assert.doesNotMatch(sys, /【该用户常消费的商家】/);
    assert.equal(r.request.memory_hints_injected, true, '账户白名单也算注入');
});

/* ─────────── 正常解析不受影响 ─────────── */

test('reviewWithModel: 注入习惯后仍能正常解析模型返回', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'strong-m', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
        memory: { candidates: [], negated: [], frequent_merchants: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].amount, 638.4);
    assert.equal(r.transactions[0].category_id, 35, '合法类目 id 应被保留');
    assert.equal(capturedModel, 'strong-m', 'model 应原样传给 provider');
});

test('reviewWithModel: 模型臆造的非法类目 id 仍被丢弃（安全铁律不受注入影响）', async () => {
    require.cache[aiServicePath].exports.callProvider = async () => JSON.stringify({
        transactions: [{ seq: 1, type: 'expense', amount: 638.4, category_id: 999 }],
    });

    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
        memory: { candidates: [], negated: [], frequent_merchants: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(
        r.transactions[0].category_id,
        undefined,
        '非法类目 id 必须丢弃（保留本地值），注入习惯不应绕过此铁律'
    );
});
