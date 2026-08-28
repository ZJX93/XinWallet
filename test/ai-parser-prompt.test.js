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
// 与 context-builder.js 的 SELECT id, name, type 保持一致
const ACCOUNTS = [
    { id: 7, name: '支付宝 花呗', type: 'credit' },
    { id: 8, name: '现金', type: 'cash' },
];
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

test('getParserPromptVersion: 未配置环境变量 → v3（能力全集，默认即最佳）', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    delete process.env.AI_PARSER_PROMPT_VERSION;
    try {
        // ⚠️ 默认必须是 v3（能力全集）：
        //    v1 的 buildV1 不接收 accounts，模型拿不到账户列表就无法匹配账户；
        //    v3 在此基础上再加用户历史先例。版本选择已收敛，默认即最佳。
        assert.equal(getParserPromptVersion(), 'v3');
    } finally {
        if (saved !== undefined) process.env.AI_PARSER_PROMPT_VERSION = saved;
    }
});

test('getParserPromptVersion: 显式配 v1 仍可回退（保留旧行为开关）', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    process.env.AI_PARSER_PROMPT_VERSION = 'v1';
    try {
        assert.equal(getParserPromptVersion(), 'v1');
    } finally {
        if (saved === undefined) delete process.env.AI_PARSER_PROMPT_VERSION;
        else process.env.AI_PARSER_PROMPT_VERSION = saved;
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

test('getParserPromptVersion: 未知版本 → 回退默认版 v3（防止配错导致全站异常）', () => {
    const saved = process.env.AI_PARSER_PROMPT_VERSION;
    process.env.AI_PARSER_PROMPT_VERSION = 'v99-does-not-exist';
    try {
        assert.equal(getParserPromptVersion(), 'v3');
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
    // 账户须带 type：仅凭名字模型分不清「招行储蓄卡」与「招行信用卡」
    assert.match(sys, /可用账户：7:支付宝 花呗\(credit\), 8:现金\(cash\)/);
    // 账户只认本次账单原文，不是"从列表里挑个顺眼的"
    assert.match(sys, /只认【本次账单原文】里写明的账户证据/);
    // 猜错的代价必须讲清楚，否则模型倾向于"填一个总比留空好"
    assert.match(sys, /猜错账户会静默污染余额/);
});

test('v2: 明令禁止「商家 → 账户」推断（账户只认账单原文）', () => {
    // ⚠️ 这是本文件最重要的回归保护之一。
    //    商家与账户之间没有稳定映射：同一个商家今天用支付宝、明天用微信、
    //    下次刷信用卡。若 prompt 里暗示"参考该商家的历史账户"，模型就会用
    //    历史归类覆盖账单上明写的支付渠道，造成静默错账
    //    （账单写着"微信支付"，却被记到花呗）。
    for (const v of ['v2', 'v3']) {
        const { messages } = buildParserMessages({
            text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
            accounts: ACCOUNTS, version: v,
        });
        const sys = messages[0].content;
        assert.match(sys, /严禁反过来用「商家 → 账户」的习惯去猜账户/, `${v} 必须禁止商家→账户`);
        // 历史账户只能作为【最后】手段，且措辞必须是"谨慎参考"而非"优先遵循"
        assert.match(sys, /仅当上面两条都无迹可寻时才可谨慎参考/, `${v} 须将历史账户降权`);
    }
});

test('v3: 先例区块把账户降权为弱参考，类目仍优先', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v3',
        fewShot: [{ note: '物业费-永升物业', amount: '320.00', category_name: '居家', account_name: '支付宝 花呗' }],
    });
    const sys = messages[0].content;
    // 先例的价值在【类目】
    assert.match(sys, /用于判断【类目】/);
    // 账户必须显式降权，否则模型会拿先例覆盖账单上明写的渠道
    assert.match(sys, /其中的【账户】只是弱参考/);
    assert.match(sys, /先例不得覆盖它/);
});

test('v2: 字段按「抄 / 猜」分组，账单客观信息不得发挥', () => {
    // 智能化只应用于账单【没有】写的字段（类目、备注）；
    // 时间、账户、金额是账单上的一次性事实，照抄即可，编造就是静默错账。
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v2',
    });
    const sys = messages[0].content;

    assert.match(sys, /客观信息：账单上【写明】的一次性事实，照抄即可，不要发挥/);
    assert.match(sys, /语义信息：账单上【没有】写的，这才是需要你智能判断的部分/);

    // 三个客观字段必须落在"客观信息"分组内（金额/日期/账户）
    const objective = sys.slice(sys.indexOf('客观信息'), sys.indexOf('语义信息'));
    assert.match(objective, /- amount：/);
    assert.match(objective, /- date：/);
    assert.match(objective, /- account_id：/);
    // 两个语义字段必须落在"语义信息"分组内
    const semantic = sys.slice(sys.indexOf('语义信息'));
    assert.match(semantic, /- category_id：/);
    assert.match(semantic, /- note：/);
});

test('v2: 时间不得编造 —— 账单只给日期时只输出日期', () => {
    // 后端 normalizeModelDate 本就会补齐时刻（今天→当前时刻、历史→12:00:00），
    // 让模型"补上合理的时分秒"只会引入编造值，打乱按时间排序的账目。
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: ACCOUNTS, version: 'v2',
    });
    const sys = messages[0].content;
    // 仍要求精确到秒的【输出格式】（账单给了时刻时要照抄）
    assert.match(sys, /YYYY-MM-DD HH:MM:SS/);
    // 但账单没给时刻时，明确禁止编造
    assert.match(sys, /只给了日期、没给时刻 → 只输出 YYYY-MM-DD/);
    assert.match(sys, /不要自己编造时分秒/);
});

test('v2: 账户缺失 type 时降级为 other（不出现 undefined）', () => {
    const { messages } = buildParserMessages({
        text: TEXT, candidates: CANDIDATES, categories: CATEGORIES,
        accounts: [{ id: 7, name: '支付宝 花呗' }], version: 'v2',
    });
    const sys = messages[0].content;
    assert.match(sys, /可用账户：7:支付宝 花呗\(other\)/);
    assert.doesNotMatch(sys, /undefined/);
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
