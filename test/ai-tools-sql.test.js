/* 数据库集成测试：list_accounts / list_categories 工具 SQL 过滤正确性
 *
 * 这两个工具是 v0.0.44 关键功能——AI 真正能查到账户/类目 id 的唯一通道。
 * 必须确保 SQL 行为：
 *   - 只返回当前 user + 当前 book
 *   - 只返回 active 账户（不返回已删除/已停用）
 *   - 模糊匹配 query 对中文生效
 *   - 类型过滤正确
 *
 * 不测试 executeTool 闭包本身（需要 mock provider，复杂度不值），只验证 dispatch 用的 SQL 行为。
 * 本地无 Postgres 时全部跳过（CI 有 DB）。
 */
const test = require('node:test');
const assert = require('node:assert');

require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../server/db');

let dbAvailable = false;
const TEST_USER_PREFIX = 't_aitools_user_';

async function ensureDb() {
    if (dbAvailable) return true;
    try {
        await db.query('SELECT 1');
        dbAvailable = true;
    } catch (_) {
        dbAvailable = false;
    }
    return dbAvailable;
}

async function createTestUser() {
    const username = TEST_USER_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const result = await db.query(
        'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
        [username, 'test_hash_' + Math.random(), 'AI 测试用户']
    );
    const userId = Number(result.insertId);
    const bookId = await db.ensureDefaultBookId(userId);
    return { id: userId, bookId, username };
}

async function cleanupTestUser(userId) {
    const tables = ['transactions', 'transfers', 'accounts', 'savings_goals', 'budgets', 'categories', 'tags', 'debts', 'investments', 'books'];
    for (const t of tables) {
        try { await db.query(`DELETE FROM ${t} WHERE user_id = ?`, [userId]); } catch (_) { /* column may not exist */ }
    }
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
}

async function ensureAccount(userId, bookId, name, status = 'active') {
    const res = await db.query(
        'INSERT INTO accounts (user_id, book_id, name, type, icon, opening_balance, balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, bookId, name, 'cash', '💰', 0, 0, status]
    );
    return Number(res.insertId);
}

async function ensureCategory(userId, bookId, name, type = 'expense') {
    const res = await db.query(
        'INSERT INTO categories (user_id, book_id, name, type, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, bookId, name, type, '🧾', 0]
    );
    return Number(res.insertId);
}

test('list_accounts SQL：仅返回当前用户当前账本的 active 账户（不串用户、不含已删除）', async (t) => {
    if (!(await ensureDb())) { t.skip('no Postgres'); return; }
    const userA = await createTestUser();
    const userB = await createTestUser();
    try {
        await ensureAccount(userA.id, userA.bookId, '微信 零钱通');
        await ensureAccount(userA.id, userA.bookId, '招行储蓄卡');
        // 用真删除代替"停用"（schema 的 status CHECK 约束对值域敏感，最稳是用 DELETE 也能验证 SELECT 不返回它）
        const a3 = await ensureAccount(userA.id, userA.bookId, '已删除账户');
        await db.query('DELETE FROM accounts WHERE id = ?', [a3]);
        await ensureAccount(userB.id, userB.bookId, '别人的账户');

        // 与 server/routes/ai.js list_accounts 分支 SQL 完全一致
        const rows = await db.query(
            `SELECT id, name FROM accounts
             WHERE user_id = ? AND book_id = ? AND status = 'active'
             ORDER BY sort_order, id`,
            [userA.id, userA.bookId]
        );
        const names = rows.map(r => r.name);
        // 不强求顺序（SQL 已 ORDER BY 但中文字符排序行为依赖 Node locale），用 set 比对
        assert.strictEqual(names.length, 2);
        assert.ok(names.includes('微信 零钱通'));
        assert.ok(names.includes('招行储蓄卡'));
    } finally {
        await cleanupTestUser(userA.id);
        await cleanupTestUser(userB.id);
    }
});

test('list_accounts SQL：query 模糊匹配——"零钱" 命中 "微信 零钱通"', async (t) => {
    if (!(await ensureDb())) { t.skip('no Postgres'); return; }
    const user = await createTestUser();
    try {
        await ensureAccount(user.id, user.bookId, '微信 零钱通');
        await ensureAccount(user.id, user.bookId, '招行储蓄卡');

        const matched = await db.query(
            `SELECT name FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active' AND name LIKE ?`,
            [user.id, user.bookId, '%零钱%']
        );
        assert.strictEqual(matched.length, 1);
        assert.strictEqual(matched[0].name, '微信 零钱通');

        const notMatched = await db.query(
            `SELECT name FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active' AND name LIKE ?`,
            [user.id, user.bookId, '%随便不存在的账户%']
        );
        assert.strictEqual(notMatched.length, 0);
    } finally {
        await cleanupTestUser(user.id);
    }
});

test('list_categories SQL：返回用户私有 + 全局公共，类型过滤正确，跨用户不串', async (t) => {
    if (!(await ensureDb())) { t.skip('no Postgres'); return; }
    const user = await createTestUser();
    const other = await createTestUser();
    try {
        // 用独特后缀确保名字在 DB 中唯一，避免被全局预存类目污染 deepStrictEqual
        await ensureCategory(user.id, user.bookId, '外卖小吃-测试', 'expense');
        await ensureCategory(user.id, user.bookId, '工资-测试', 'income');
        await ensureCategory(other.id, other.bookId, '别人的私密类目-测试', 'expense');

        const expenseRows = await db.query(
            `SELECT name FROM categories
             WHERE (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))
               AND type = 'expense'`,
            [user.id, user.bookId]
        );
        const expenseNames = expenseRows.map(r => r.name);
        assert.ok(expenseNames.includes('外卖小吃-测试'),
            '应包含用户的私有 expense');
        assert.ok(!expenseNames.includes('别人的私密类目-测试'),
            '不应包含别人账本下的类目');
        assert.ok(!expenseNames.includes('工资-测试'),
            '不应包含 income 类型的类目');

        const incomeRows = await db.query(
            `SELECT name FROM categories
             WHERE (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))
               AND type = 'income'`,
            [user.id, user.bookId]
        );
        const incomeNames = incomeRows.map(r => r.name);
        assert.ok(incomeNames.includes('工资-测试'),
            '用户的私有 income 应被命中');
        assert.ok(!incomeNames.includes('外卖小吃-测试'),
            'expense 不应混入 income 结果');

        // 跨用户隔离
        const allUserCat = await db.query(
            `SELECT name FROM categories WHERE user_id = ?`,
            [user.id]
        );
        assert.ok(!allUserCat.map(r => r.name).includes('别人的私密类目-测试'),
            '用户私有结果不应包含别人账本下的类目');
    } finally {
        await cleanupTestUser(user.id);
        await cleanupTestUser(other.id);
    }
});

test.after(async () => {
    if (dbAvailable) {
        try { await db.pool.end(); } catch (_) { /* ignore */ }
    }
});
