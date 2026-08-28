/* ============================================
   reviewWithModel 集成测试
   —— 验证「用户记账习惯」确实被注入到大模型 prompt 里
   —— 关键回归保护：无记忆时 prompt 必须与改动前【字节级一致】
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

// ⚠️ 本文件固定用 v1 作为比对基线：它守护的是「用户记账习惯注入」这一功能，
//    与 prompt 版本演进是正交的两件事。LEGACY_SYSTEM_PROMPT 是 v1 的字节级快照，
//    不锁版本的话，一旦默认版本抬到 v2/v3，这些无关测试就会因 prompt 文本变化而红。
//    关注点隔离：prompt 版本由 ai-parser-prompt.test.js 守护。
process.env.AI_PARSER_PROMPT_VERSION = 'v1';

const { reviewWithModel } = require('../server/modules/ai/providers/provider-gateway');

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

/** 改动前的 system prompt（注入习惯之前的原始版本），用于字节级回归比对 */
const LEGACY_SYSTEM_PROMPT = [
    '你是记账助手的 AI 解析器。任务：基于用户原文，对本地规则引擎给出的候选交易做【语义理解与补全】。',
    '你可以且应当：',
    '1. 修正本地抽错的类型/金额/类目/日期/商家；',
    '2. 补全本地没抽出来的字段（例如把"中午吃了碗面"归到餐饮类目、给出商家名、写入语义备注 note）；',
    '3. 对口语化、模糊表述做合理推断（如"发了工资"→income、"还了信用卡"→transfer/expense）。',
    '严格约束：',
    '1. category_id 必须从下面给出的类目清单里选，不得臆造 id；拿不准时填 null。',
    '2. 每个字段都要给 conf（0~1 置信度）：有把握≥0.9，推测 0.7~0.89，不确定填 0 或省略。',
    '3. 金额/类型这种错了会污染账本的字段，没把握就保留本地值（不要乱改）。',
    '4. 只输出 JSON，禁止额外文本。格式：',
    '{"transactions":[{"seq":1,"type":"expense","amount":12.5,"category_id":33,',
    '"date":"2026-08-25","merchant":"星巴克","note":"午餐","conf":{"type":0.95,"amount":0.98,"category_id":0.9,"date":0.95,"merchant":0.7}}]}',
    '备注 note 用于记录消费目的/场景，便于后续洞察。',
    '可用类目：35:居家(expense), 40:房屋租赁(expense), 12:餐饮(expense)',
].join('\n');

beforeEach(() => {
    capturedMessages = null;
    capturedModel = null;
});

/* ─────────── 回归保护：无记忆时行为完全不变 ─────────── */

test('reviewWithModel: 不传 memory 且不传 accounts → prompt 与改动前字节级一致', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
    });
    assert.equal(r.ok, true, 'mock provider 应返回成功');
    assert.equal(
        capturedMessages[0].content,
        LEGACY_SYSTEM_PROMPT,
        '无记忆时 system prompt 必须与旧版完全一致（不能多一个换行）'
    );
});

test('reviewWithModel: 传空记忆对象 → 无 accounts 时 prompt 仍与旧版一致', async () => {
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES,
        accounts: [],                       // 空账户 → 不生成账户白名单
        memory: { candidates: [], negated: [], frequent_merchants: [] },
    });
    assert.equal(r.ok, true);
    assert.equal(capturedMessages[0].content, LEGACY_SYSTEM_PROMPT);
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
    assert.ok(sys.startsWith(LEGACY_SYSTEM_PROMPT), '旧 prompt 内容必须原样保留在前');

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
    // 这补齐了旧 prompt 连账户列表都没有的缺口：
    // 模型此前根本不知道用户有哪些账户，自然无法建议用哪张卡。
    const r = await reviewWithModel({
        provider: PROVIDER, model: 'm', text: '物业维修 638.4元',
        candidates: CANDIDATES, categories: CATEGORIES, accounts: ACCOUNTS,
        memory: null,
    });
    assert.equal(r.ok, true);
    const sys = capturedMessages[0].content;
    assert.ok(sys.startsWith(LEGACY_SYSTEM_PROMPT));
    assert.match(sys, /【可用账户】只能从这些里选，不得臆造 id：7:支付宝 花呗, 8:现金/);
    assert.doesNotMatch(sys, /【用户记账习惯】/);
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
    // 换一个返回非法 category_id 的 mock，验证清洗逻辑没被注入破坏
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
