/* ============================================
   Prompt Builder 单元测试
   —— 把「用户记账习惯」翻译成大模型能懂的自然语言
   ============================================ */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildMemoryHints,
    MAX_HABITS, MAX_NEGATED, MAX_MERCHANTS,
} = require('../server/modules/ai/providers/prompt-builder');

/* ─────────── 空记忆：必须完全不注入（回归保护） ─────────── */

test('buildMemoryHints: memory=null → 空串', () => {
    assert.equal(buildMemoryHints({ memory: null, categories: [], accounts: [] }), '');
});

test('buildMemoryHints: 不传任何参数 → 空串', () => {
    assert.equal(buildMemoryHints(), '');
});

test('buildMemoryHints: 新用户（无任何记忆）→ 不出现习惯/否证/商家区块', () => {
    // 关键回归保护：新用户没有历史时，绝不能输出「【用户记账习惯】」这种
    // 后面跟着空内容的标题 —— 那会误导模型，也白白多烧 token。
    // 但【可用账户】来自 ctx.accounts（确定事实，非记忆），仍应给出 ——
    // 这恰好补齐了旧 prompt 连账户列表都没有的缺口。
    const emptyMemory = {
        candidates: [], negated: [], keys: [], frequent_merchants: [],
        layers: { procedural: 0, semantic: 0, semantic_induced: 0, episodic: 0, negative: 0 },
    };
    const r = buildMemoryHints({
        memory: emptyMemory,
        categories: [{ id: 35, name: '居家' }],
        accounts: [{ id: 1, name: '花呗' }],
    });
    assert.doesNotMatch(r, /【用户记账习惯】/, '无历史时不该出现习惯标题');
    assert.doesNotMatch(r, /【已被用户纠正/, '无历史时不该出现否证区块');
    assert.doesNotMatch(r, /【该用户常消费的商家】/, '无历史时不该出现商家区块');
    assert.match(r, /【可用账户】/, '账户是确定事实，仍应给出');
});

test('buildMemoryHints: 只有账户表、无记忆 → 只给账户白名单', () => {
    const r = buildMemoryHints({
        memory: { candidates: [], negated: [], frequent_merchants: [] },
        categories: [{ id: 35, name: '居家' }],
        accounts: [{ id: 1, name: '花呗' }, { id: 2, name: '现金' }],
    });
    assert.match(r, /【可用账户】/);
    assert.match(r, /1:花呗/);
    assert.doesNotMatch(r, /【用户记账习惯】/, '无习惯时不该出现习惯标题');
});

/* ─────────── 习惯格式化 ─────────── */

test('buildMemoryHints: 类目 id 映射成名称（模型对 id 无感）', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [{
                layer: 'procedural', source: 'manual_rule', match_key: '永升物业',
                field: 'category', category_id: 35, confidence: 0.97, support: 12,
            }],
            negated: [], frequent_merchants: [],
        },
        categories: [{ id: 35, name: '居家', type: 'expense' }],
        accounts: [],
    });
    assert.match(r, /【用户记账习惯】/);
    assert.match(r, /「永升物业」/);
    assert.match(r, /类目「居家」/, '应该显示类目名称而非 id 35');
    assert.match(r, /历史 12 笔/);
    assert.doesNotMatch(r, /类目「35」/, '不应把裸 id 暴露给模型');
});

test('buildMemoryHints: 账户 id 映射成名称', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [{
                layer: 'procedural', source: 'manual_rule', match_key: '永升物业',
                field: 'account', category_id: 35, account_id: 7, confidence: 0.94,
            }],
            negated: [], frequent_merchants: [],
        },
        categories: [{ id: 35, name: '居家' }],
        accounts: [{ id: 7, name: '支付宝 花呗' }],
    });
    assert.match(r, /账户「支付宝 花呗」/);
});

test('buildMemoryHints: 方向 type 翻译成中文', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [{
                layer: 'procedural', match_key: '工资', field: 'type',
                type: 'income', confidence: 0.9,
            }],
            negated: [], frequent_merchants: [],
        },
        categories: [], accounts: [],
    });
    assert.match(r, /方向「收入」/, 'income 应翻译为「收入」');
});

test('buildMemoryHints: 无信息量的候选被跳过（无类目/账户/方向）', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [{ layer: 'episodic', match_key: '某商家', confidence: 0.5 }],
            negated: [], frequent_merchants: [],
        },
        categories: [], accounts: [],
    });
    assert.doesNotMatch(r, /【用户记账习惯】/, '无类目/账户/方向的候选对模型无信息量');
});

test('buildMemoryHints: 相同 key + 相同结论 去重', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [
                { layer: 'procedural', match_key: '星巴克', category_id: 12, confidence: 0.97 },
                { layer: 'semantic', match_key: '星巴克', category_id: 12, confidence: 0.86 },
            ],
            negated: [], frequent_merchants: [],
        },
        categories: [{ id: 12, name: '餐饮' }],
        accounts: [],
    });
    const occurrences = (r.match(/「星巴克」/g) || []).length;
    assert.equal(occurrences, 1, '重复习惯只应出现一次');
});

test('buildMemoryHints: 习惯条数受 MAX_HABITS 限制', () => {
    const many = [];
    for (let i = 0; i < 50; i++) {
        many.push({
            layer: 'episodic', match_key: `商家${i}`, category_id: 12, confidence: 0.6,
        });
    }
    const r = buildMemoryHints({
        memory: { candidates: many, negated: [], frequent_merchants: [] },
        categories: [{ id: 12, name: '餐饮' }],
        accounts: [],
    });
    const lines = r.split('\n').filter(l => l.startsWith('- '));
    assert.equal(lines.length, MAX_HABITS, `习惯最多 ${MAX_HABITS} 条`);
});

/* ─────────── 否证项 ─────────── */

test('buildMemoryHints: 否证项格式化成「不要归到」', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [],
            negated: [{ match_key: '物业维修', category_id: 40 }],
            frequent_merchants: [],
        },
        categories: [{ id: 40, name: '房屋租赁' }],
        accounts: [],
    });
    assert.match(r, /【已被用户纠正，不要重犯】/);
    assert.match(r, /「物业维修」不要归到「房屋租赁」/);
});

test('buildMemoryHints: 否证项条数受 MAX_NEGATED 限制', () => {
    const negated = [];
    for (let i = 0; i < 20; i++) negated.push({ match_key: `key${i}`, category_id: 40 });
    const r = buildMemoryHints({
        memory: { candidates: [], negated, frequent_merchants: [] },
        categories: [{ id: 40, name: '房屋租赁' }],
        accounts: [],
    });
    const lines = r.split('\n').filter(l => l.includes('不要归到'));
    assert.equal(lines.length, MAX_NEGATED);
});

/* ─────────── 常用商家 ─────────── */

test('buildMemoryHints: 常用商家列出且限量', () => {
    const merchants = [];
    for (let i = 0; i < 100; i++) merchants.push(`商家${i}`);
    const r = buildMemoryHints({
        memory: { candidates: [], negated: [], frequent_merchants: merchants },
        categories: [], accounts: [],
    });
    assert.match(r, /【该用户常消费的商家】/);
    const listed = r.match(/商家\d+/g) || [];
    assert.equal(listed.length, MAX_MERCHANTS);
});

/* ─────────── 完整组合：模拟真实场景 ─────────── */

test('buildMemoryHints: 用户截图场景的完整输出（物业维修 + 花呗）', () => {
    const r = buildMemoryHints({
        memory: {
            candidates: [{
                layer: 'procedural', source: 'manual_rule', match_key: '永升物业',
                field: 'category', category_id: 35, account_id: 7,
                confidence: 0.97, support: 12,
            }],
            negated: [{ match_key: '物业维修', category_id: 40 }],
            frequent_merchants: ['永升物业', '星巴克', '美团外卖'],
        },
        categories: [{ id: 35, name: '居家' }, { id: 40, name: '房屋租赁' }],
        accounts: [{ id: 7, name: '支付宝 花呗' }, { id: 8, name: '现金' }],
    });

    // 四个区块都要在
    assert.match(r, /【用户记账习惯】/);
    assert.match(r, /【已被用户纠正，不要重犯】/);
    assert.match(r, /【可用账户】/);
    assert.match(r, /【该用户常消费的商家】/);

    // 具体内容正确
    assert.match(r, /「永升物业」 → 类目「居家」 \+ 账户「支付宝 花呗」（历史 12 笔）/);
    assert.match(r, /「物业维修」不要归到「房屋租赁」/);
    assert.match(r, /7:支付宝 花呗/);
    assert.match(r, /永升物业、星巴克、美团外卖/);
});
