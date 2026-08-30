/* ============================================
   Few-shot 样例选择器测试
   ============================================ */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    selectFewShotExamples, diceSimilarity, isFewShotEnabled,
    MIN_SIMILARITY, DEFAULT_LIMIT,
} = require('../server/modules/ai/memory/few-shot-selector');
const { formatFewShot, buildParserMessages } = require('../server/modules/ai/prompts/parser-prompt');

/* ─────────── 相似度算法 ─────────── */

test('diceSimilarity: 完全相同 = 1', () => {
    assert.equal(diceSimilarity('物业维修', '物业维修'), 1);
});

test('diceSimilarity: 完全无关 ≈ 0', () => {
    assert.ok(diceSimilarity('物业维修', '星巴克咖啡') < 0.1);
});

test('diceSimilarity: 部分重合介于 0~1', () => {
    const s = diceSimilarity('物业维修费', '物业费维修');
    assert.ok(s > 0.3 && s < 1, `实际 ${s}`);
});

test('diceSimilarity: 空串安全', () => {
    assert.equal(diceSimilarity('', 'abc'), 0);
    assert.equal(diceSimilarity('abc', ''), 0);
    assert.equal(diceSimilarity(null, null), 0);
});

test('diceSimilarity: 对中文无需分词即可工作', () => {
    // 中文没有空格，bigram 能捕捉字符级重合
    assert.ok(diceSimilarity('永升物业樾溪臺', '永升物业') > 0.4);
});

/* ─────────── 开关（隐私） ─────────── */

beforeEach(() => { delete process.env.AI_FEWSHOT_ENABLED; });
afterEach(() => { delete process.env.AI_FEWSHOT_ENABLED; });

test('默认开启（能力全集的一部分）', () => {
    // 默认即最佳：Few-shot 是账户/类目匹配准确率的主要增量。
    // 隐私权衡见 few-shot-selector.js:isFewShotEnabled 的注释。
    assert.equal(isFewShotEnabled(), true);
});

test('显式关闭时不启用：不查库、返回空（历史消费明细不发给第三方）', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'false';
    let queried = false;
    const db = { query: async () => { queried = true; return []; } };
    const r = await selectFewShotExamples(db, mkWm(), { text: '物业维修 638元' });
    assert.deepEqual(r, []);
    assert.equal(queried, false, '开关关闭时不应访问数据库');
    assert.equal(isFewShotEnabled(), false);
});

test('AI_FEWSHOT_ENABLED=true 显式开启', () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    assert.equal(isFewShotEnabled(), true);
});

test('AI_FEWSHOT_ENABLED=0 / no 均视为关闭', () => {
    for (const v of ['0', 'no', 'false']) {
        process.env.AI_FEWSHOT_ENABLED = v;
        assert.equal(isFewShotEnabled(), false, `${v} 应视为关闭`);
    }
});

/* ─────────── 挑选逻辑 ─────────── */

const HISTORY = [
    { id: 1, note: '物业维修-永升物业樾溪臺', amount: '638.40', type: 'expense', date: '2026-05-25', category_id: 35, category_name: '居家', account_id: 7, account_name: '支付宝 花呗' },
    { id: 2, note: '物业费-永升物业', amount: '320.00', type: 'expense', date: '2026-06-25', category_id: 35, category_name: '居家', account_id: 7, account_name: '支付宝 花呗' },
    { id: 3, note: '午餐-公司楼下', amount: '28.00', type: 'expense', date: '2026-08-20', category_id: 12, category_name: '餐饮', account_id: 8, account_name: '现金' },
    { id: 4, note: '星巴克咖啡', amount: '35.00', type: 'expense', date: '2026-08-21', category_id: 12, category_name: '餐饮', account_id: 8, account_name: '现金' },
    { id: 5, note: '物业维修-永升物业樾溪臺', amount: '600.00', type: 'expense', date: '2026-07-25', category_id: null, category_name: null, account_id: null, account_name: null },
    { id: 6, note: '', amount: '10.00', type: 'expense', date: '2026-08-01', category_id: 12, category_name: '餐饮', account_id: 8, account_name: '现金' },
];

function mkDb(rows = HISTORY) {
    return {
        query: async (sql, params) => {
            if (sql.includes('LIKE')) {
                const key = String(params[3] || '').replace(/%/g, '');
                return rows.filter(r => r.note && r.note.includes(key)).slice(0, 40);
            }
            return rows.filter(r => r.note).slice(0, 200);
        },
    };
}

function mkWm(over = {}) {
    return { userId: 1, bookId: 1, refDate: new Date('2026-08-28T10:00:00Z'), ...over };
}

test('挑选：相似的历史排在最前', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    const r = await selectFewShotExamples(mkDb(), mkWm(), {
        text: '物业维修 638.4元', merchants: ['永升物业'],
    });
    assert.ok(r.length > 0, '应挑出样例');
    assert.match(r[0].note, /物业/, '最相似的必须是物业相关');
});

test('挑选：丢弃低于相似度阈值的无关历史', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    // 用一段与所有历史都不相关的文本
    const r = await selectFewShotExamples(mkDb(), mkWm(), { text: 'zzzz 量子纠缠实验器材' });
    assert.equal(r.length, 0, `不相关时不应给样例（阈值 ${MIN_SIMILARITY}）`);
});

test('挑选：相同备注只保留一条（去重）', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    // id 1 与 id 5 备注完全相同
    const r = await selectFewShotExamples(mkDb(), mkWm(), {
        text: '物业维修', merchants: ['永升物业'],
    });
    const notes = r.map(x => x.note.toLowerCase());
    assert.equal(new Set(notes).size, notes.length, '备注不应重复');
});

test('挑选：有类目的样例优先于无类目的', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    // id 5 备注与 id 1 相同但无类目 —— 去重后应保留有类目的那条
    const r = await selectFewShotExamples(mkDb([HISTORY[4], HISTORY[0]]), mkWm(), {
        text: '物业维修', merchants: ['永升物业'],
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].category_id, 35, '应保留有类目的那条（示范价值更高）');
});

test('挑选：条数受 limit 限制', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    const r = await selectFewShotExamples(mkDb(), mkWm(), {
        text: '物业维修 餐饮 咖啡', limit: 2,
    });
    assert.ok(r.length <= 2);
});

test('挑选：默认条数为 DEFAULT_LIMIT', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    const many = [];
    for (let i = 0; i < 30; i++) {
        many.push({ id: 100 + i, note: `物业维修第${i}期`, amount: '100.00', type: 'expense', date: '2026-08-01', category_id: 35, category_name: '居家', account_id: 7, account_name: '花呗' });
    }
    const r = await selectFewShotExamples(mkDb(many), mkWm(), { text: '物业维修' });
    assert.equal(r.length, DEFAULT_LIMIT);
});

test('挑选：只输出必要字段，不泄漏交易 id', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    const r = await selectFewShotExamples(mkDb(), mkWm(), { text: '物业维修', merchants: ['永升物业'] });
    for (const e of r) {
        assert.equal(e.id, undefined, '不得把交易 id 发给第三方模型');
        assert.equal(e.book_id, undefined);
        assert.equal(e.user_id, undefined);
    }
    const keys = Object.keys(r[0]).sort();
    assert.deepEqual(keys, ['account_id', 'account_name', 'amount', 'category_id', 'category_name', 'date', 'note', 'score', 'type']);
});

test('挑选：数据库异常时降级为空，不影响记账链路', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    const badDb = { query: async () => { throw new Error('DB down'); } };
    const r = await selectFewShotExamples(badDb, mkWm(), { text: '物业维修' });
    assert.deepEqual(r, []);
});

test('挑选：db 或 wm 缺失时返回空', async () => {
    process.env.AI_FEWSHOT_ENABLED = 'true';
    assert.deepEqual(await selectFewShotExamples(null, mkWm(), { text: 'x' }), []);
    assert.deepEqual(await selectFewShotExamples(mkDb(), null, { text: 'x' }), []);
});

/* ─────────── 格式化 ─────────── */

test('formatFewShot: 空数组 → 空串', () => {
    assert.equal(formatFewShot([]), '');
    assert.equal(formatFewShot(null), '');
});

test('formatFewShot: 含类目与账户', () => {
    const s = formatFewShot([{
        note: '物业维修-永升物业樾溪臺', amount: 638.4,
        category_name: '居家', account_name: '支付宝 花呗',
    }]);
    assert.match(s, /【该用户过往的真实记账先例】/);
    assert.match(s, /1\. 备注「物业维修-永升物业樾溪臺」638\.4元 → 类目「居家」、账户「支付宝 花呗」/);
});

test('formatFewShot: 无类目时标注未记类目', () => {
    const s = formatFewShot([{ note: '某笔', amount: 10, category_name: null, account_name: null }]);
    assert.match(s, /未记类目/);
});

/* ─────────── v3 prompt ─────────── */

test('v3: 注入 few-shot 区块', () => {
    const { messages, version } = buildParserMessages({
        text: '物业维修 638.4元',
        candidates: [],
        categories: [{ id: 35, name: '居家', type: 'expense' }],
        accounts: [{ id: 7, name: '支付宝 花呗' }],
        fewShot: [{ note: '物业费-永升物业', amount: 320, category_name: '居家', account_name: '支付宝 花呗' }],
        version: 'v3',
    });
    assert.equal(version, 'v3');
    assert.match(messages[0].content, /【该用户过往的真实记账先例】/);
    assert.match(messages[0].content, /物业费-永升物业/);
});

test('v3: 无 few-shot 时不注入先例区块（冷启动用户）', () => {
    const common = {
        text: '物业维修 638.4元',
        candidates: [],
        categories: [{ id: 35, name: '居家', type: 'expense' }],
        accounts: [{ id: 7, name: '支付宝 花呗' }],
    };
    const v3 = buildParserMessages({ ...common, fewShot: [], version: 'v3' });
    assert.doesNotMatch(
        v3.messages[0].content, /【该用户过往的真实记账先例】/,
        '无先例时 v3 不应注入先例区块'
    );
});
