/* ============================================
   Parser Prompt 版本化测试
   —— v1 必须字节级冻结（保底基线）
   —— v2 必须覆盖：OCR 噪音剔除 / account_id / 秒级日期 / 语义备注
   ============================================ */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildParserMessages, getParserPromptVersion, VERSIONS,
} = require('../server/modules/ai/prompts/parser-prompt');

const CATEGORIES = [
    { id: 35, name: '居家', type: 'expense' },
    { id: 12, name: '餐饮', type: 'expense' },
    { id: 90, name: '工资', type: 'income' },
    { id: 88, name: '转账', type: 'transfer' },   // 应被过滤掉
];
const ACCOUNTS = [{ id: 7, name: '支付宝 花呗' }, { id: 8, name: '现金' }];
const CANDIDATES = [{
    seq: 1, type: 'expense', amount: 638.4, category_id: null,
    category_name: null, date: '2026-08-25', merchant: '永升物业', note: '',
}];
const TEXT = '物业维修 638.4元 永升物业樾溪臺';

/** v1 的 system prompt 已被字节级冻结，任何改动都必须开新版本 */
const V1_FROZEN_SYSTEM = [
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
    '可用类目：35:居家(expense), 12:餐饮(expense), 90:工资(income)',
].join('\n');

/* ─────────── 版本选择 ─────────── */

test('getParserPromptVersion: 未配置环境变量 → v1（保底，行为不变）', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    delete process.env.AI_PARSER_PROMPT_VERSION;
    try {
        assert.equal(getParserPromptVersion(), 'v1');
    } finally {
        if (saved !== undefined) process.env.AI_PARSER_PROMPT_VERSION = saved;
    }
});

test('getParserPromptVersion: 配了 v2 → v2', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    process.env.AI_PARSER_PROMPT_VERSION = 'v2';
    try {
        assert.equal(getParserPromptVersion(), 'v2');
    } finally {
        if (saved === undefined) delete process.env.AI_PARSER_PROMPT_VERSION;
        else process.env.AI_PARSER_PROMPT_VERSION = saved;
    }
});

test('getParserPromptVersion: 未知版本 → 回退 v1（防止配错导致全站异常）', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    process.env.AI_PARSER_PROMPT_VERSION = 'v99-does-not-exist';
    try {
        assert.equal(getParserPromptVersion(), 'v1');
    } finally {
        if (saved === undefined) delete process.env.AI_PARSER_PROMPT_VERSION;
        else process.env.AI_PARSER_PROMPT_VERSION = saved;
    }
});

/* ─────────── v1：字节级冻结 ─────────── */

test('v1: system prompt 字节级冻结（与外置前完全一致）', () => {
    const { messages, version } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v1',
    });
    assert.equal(version, 'v1');
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, V1_FROZEN_SYSTEM);
});

test('v1: 不注入账户列表（账户能力是 v2 才有的）', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v1',
    });
    assert.doesNotMatch(messages[0].content, /可用账户/);
    assert.doesNotMatch(messages[0].content, /account_id/);
});

test('v1: user message 与外置前一致', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: 'v1',
    });
    assert.match(messages[1].content, /^原文：物业维修 638\.4元 永升物业樾溪臺\n本地候选：\[/);
    assert.match(messages[1].content, /"amount":638\.4/);
});

/* ─────────── v2：增强能力 ─────────── */

test('v2: 提示模型输出 account_id 并给出可用账户白名单', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v2',
    });
    const sys = messages[0].content;
    assert.match(sys, /account_id/);
    assert.match(sys, /可用账户：7:支付宝 花呗, 8:现金/);
    assert.match(sys, /从【可用账户】里选最贴切的一个/);
});

test('v2: 要求剔除 OCR 界面噪声（K/s、订单号、余额）', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: 'v2',
    });
    const sys = messages[0].content;
    assert.match(sys, /K\/s/);
    assert.match(sys, /订单号/);
    assert.match(sys, /余额/);
    assert.match(sys, /不是交易，必须剔除/);
});

test('v2: 日期要求精确到秒', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: 'v2',
    });
    assert.match(messages[0].content, /HH:MM:SS/);
    assert.match(messages[0].content, /"date":"2026-08-25 10:30:00"/);
});

test('v2: 要求语义化备注', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: 'v2',
    });
    assert.match(messages[0].content, /消费目的-对象/);
});

test('v2: 负数金额要正确判方向（微信 -8.00）', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: 'v2',
    });
    assert.match(messages[0].content, /-8\.00/);
    assert.match(messages[0].content, /退款或收入/);
});

test('v2: 无账户时明确提示填 null', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: [], version: 'v2',
    });
    assert.match(messages[0].content, /该用户暂无账户，account_id 一律填 null/);
});

test('v2: 习惯提示追加在末尾', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, memoryHints: '【用户记账习惯】\n- 「永升物业」 → 类目「居家」',
        version: 'v2',
    });
    const sys = messages[0].content;
    assert.ok(sys.endsWith('【用户记账习惯】\n- 「永升物业」 → 类目「居家」'));
});

/* ─────────── 两版本都要满足的公共契约 ─────────── */

test('所有版本：类目清单只含 income/expense，过滤掉 transfer', () => {
    for (const v of Object.keys(VERSIONS)) {
        const { messages } = buildParserMessages({
            text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: v,
        });
        assert.doesNotMatch(
            messages[0].content,
            /88:转账/,
            `${v} 不应把 transfer 类目给模型（交易只能是 income/expense）`
        );
        assert.match(messages[0].content, /35:居家/, `${v} 应包含 expense 类目`);
    }
});

test('所有版本：都要求只输出 JSON', () => {
    for (const v of Object.keys(VERSIONS)) {
        const { messages } = buildParserMessages({
            text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: v,
        });
        assert.match(messages[0].content, /只输出 JSON/, `${v} 应要求只输出 JSON`);
    }
});

test('所有版本：messages 结构为 [system, user]', () => {
    for (const v of Object.keys(VERSIONS)) {
        const { messages } = buildParserMessages({
            text: TEXT, candidates: CANDIDATES, categories: CATEGORIES, version: v,
        });
        assert.equal(messages.length, 2, `${v} 应有 system + user 两条消息`);
        assert.equal(messages[0].role, 'system');
        assert.equal(messages[1].role, 'user');
    }
});

test('VERSIONS 注册表：v1 与 v2 都有 build 与描述', () => {
    assert.ok(VERSIONS.v1 && typeof VERSIONS.v1.build === 'function');
    assert.ok(VERSIONS.v2 && typeof VERSIONS.v2.build === 'function');
    assert.ok(VERSIONS.v1.description && VERSIONS.v2.description);
});
