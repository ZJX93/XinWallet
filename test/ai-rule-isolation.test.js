/* ============================================
   鑫钱包 · AI 规则读取隔离回归测试
   ------------------------------------------------
   守护「规则读取必须按 user_id + (book_id OR 全局) 隔离」这一不变量，
   防止出现【跨账本 / 跨用户】读取 ai_rules 的越权或串档。

   设计：
   - 不连真实数据库，用内存 mock db 按查询参数真实模拟「按 user_id + book_id 过滤」。
   - 同时断言 retrieveRules 生成的 SQL 文本确实包含
       `user_id = ?` 与 `(book_id = ? OR book_id IS NULL)` 隔离条件，
     这样若有人移除 book_id 隔离（改为只按 user_id 过滤），测试立即失败。

   场景数据（同一 match_key='星巴克'）：
     id=1  用户 U / 账本 B1      → 本次查询应命中
     id=2  用户 U / 账本 B2      → 同用户其它账本，应排除
     id=3  用户 OTHER / 账本 B1  → 其它用户，应排除
     id=4  用户 U / 账本 NULL    → 全局规则，应命中
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const { retrieveRules } = require('../server/modules/ai/rules/rule-store');

const U = 70001, B1 = 80001, B2 = 80002, OTHER = 70002;

function baseRule(over) {
    return Object.assign({
        id: 0, user_id: U, book_id: B1, rule_type: 'merchant_category',
        match_key: '星巴克', target_category_id: 10, target_account_id: null,
        target_type: null, origin: 'learned', status: 'trusted',
        evidence_score: 10, accuracy_rate: 1, sample_count: 5,
        last_confirmed_at: null, last_matched_at: null, created_at: 0, updated_at: 0,
    }, over);
}

function makeDb() {
    const table = [
        baseRule({ id: 1, user_id: U, book_id: B1 }),
        baseRule({ id: 2, user_id: U, book_id: B2 }),
        baseRule({ id: 3, user_id: OTHER, book_id: B1 }),
        baseRule({ id: 4, user_id: U, book_id: null }), // 全局规则
    ];
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/FROM ai_rules/.test(sql)) {
                const userId = params[0];
                const bookId = params[1];
                const rows = table.filter(
                    r => r.user_id === userId && (r.book_id === bookId || r.book_id === null)
                );
                // 两种查询都可能需要 k 字段（findConflictedMerchantKeys 用 r.k）
                return rows.map(r => ({ ...r, k: String(r.match_key).toLowerCase() }));
            }
            return [];
        },
    };
}

test('retrieveRules 仅返回「当前用户+当前账本」与全局规则', async () => {
    const db = makeDb();
    const rules = await retrieveRules(db, { userId: U, bookId: B1, refDate: new Date() }, ['星巴克']);
    const ids = rules.map(r => r.id).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [1, 4], '应命中本账本(1)与全局(4)，排除其它账本(2)与其它用户(3)');
});

test('切换到另一账本后，绝不泄漏原账本规则', async () => {
    const db = makeDb();
    const rules = await retrieveRules(db, { userId: U, bookId: B2, refDate: new Date() }, ['星巴克']);
    const ids = rules.map(r => r.id).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [2, 4], '应命中账本 B2(2)与全局(4)，排除账本 B1(1)与其它用户(3)');
});

test('生成的 SQL 必须带 user_id 与 (book_id OR NULL) 隔离条件', async () => {
    const db = makeDb();
    await retrieveRules(db, { userId: U, bookId: B1, refDate: new Date() }, ['星巴克']);
    const mainQuery = db.calls.find(c => /FROM ai_rules/.test(c.sql) && /user_id/.test(c.sql));
    assert.ok(mainQuery, '应存在对 ai_rules 的隔离查询');
    assert.match(mainQuery.sql, /user_id\s*=\s*\?/, 'SQL 必须按 user_id 过滤');
    assert.match(mainQuery.sql, /book_id\s*=\s*\?/, 'SQL 必须按 book_id 过滤');
    assert.match(mainQuery.sql, /book_id\s+IS\s+NULL/, 'SQL 必须允许 book_id IS NULL 的全局规则');
    // 参数顺序：user_id 在前，book_id 其次，且值正确
    assert.strictEqual(mainQuery.params[0], U);
    assert.strictEqual(mainQuery.params[1], B1);
});
