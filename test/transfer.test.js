/* ============================================
   鑫钱包 · 转账事务一致性回归测试
   覆盖（审计 P3-4 测试缺口）：
   1) 合法转账：双账户余额原子更新、生成两条腿（transfer_out / transfer_in）。
   2) 非法转账（转入账户不存在）：必须整体回滚 —— 不产生任何 transfer 记录、
      不产生任何交易腿、转出账户余额不变（证明 db.transaction 回滚生效）。
   运行前置：需 PostgreSQL（与 CI postgres:16 服务一致）
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

require('dotenv').config({ path: __dirname + '/../.env' });

const db = require('../server/db');
const transfersRouter = require('../server/routes/transfers');

let server, base;
let user, bookId;

async function createTestUser() {
    const username = 't_xfer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const r = await db.query(
        'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
        [username, 'test_hash_' + Math.random(), '转账测试']
    );
    const userId = Number(r.insertId);
    const bid = await db.ensureDefaultBookId(userId);
    return { id: userId, bookId: bid, username };
}

async function cleanupTestUser(userId) {
    await db.query('DELETE FROM transactions WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM transfers WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM accounts WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM categories WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM books WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
}

async function createAccount(name, opening) {
    const r = await db.query(
        `INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, status)
         VALUES (?, ?, ?, 'cash', '💰', ?, ?, 'active')`,
        [user.id, bookId, name, opening, opening]
    );
    return Number(r.insertId);
}

async function setBalance(accountId, bal) {
    await db.query('UPDATE accounts SET balance = ?, opening_balance = ? WHERE id = ?', [bal, bal, accountId]);
}

async function getBalance(accountId) {
    const row = await db.queryOne('SELECT balance FROM accounts WHERE id = ?', [accountId]);
    return Number(row.balance);
}

async function listen() {
    return new Promise((resolve) => {
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

const app = express();
app.use(express.json());
// 测试桩：注入 userId / bookId（真实链路由 auth + 账本解析中间件完成）
app.use((req, res, next) => { req.userId = user.id; req.bookId = bookId; next(); });
app.use('/api/transfers', transfersRouter);

async function req(method, path, body) {
    const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

test.before(async () => {
    user = await createTestUser();
    bookId = user.bookId;
    await listen();
});

test.after(async () => {
    try { await cleanupTestUser(user.id); } catch (_) {}
    if (server) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
    }
    try { await db.pool.end(); } catch (_) {}
});

test('合法转账：双账户余额原子更新并生成两条腿', async () => {
    const A = await createAccount('转出', 1000);
    const B = await createAccount('转入', 0);

    const r = await req('POST', '/api/transfers', { from_account_id: A, to_account_id: B, amount: 300 });
    assert.strictEqual(r.json.success, true, '转账应成功');
    const tid = r.json.data.id;
    assert.ok(tid > 0, '应返回转账记录 id');

    // 余额推导正确（复式记账 single source of truth）
    assert.strictEqual(await getBalance(A), 700, '转出账户应为 700');
    assert.strictEqual(await getBalance(B), 300, '转入账户应为 300');

    // 必须生成两条腿：transfer_out / transfer_in
    const legs = await db.query(
        'SELECT type FROM transactions WHERE transfer_id = ? AND user_id = ?',
        [tid, user.id]
    );
    const types = legs.map(l => l.type).sort();
    assert.deepStrictEqual(types, ['transfer_in', 'transfer_out'], '应生成 in/out 两条腿');
});

test('非法转账（转入账户不存在）：整体回滚，零残留', async () => {
    const A = await createAccount('转出2', 1000);
    const B = await createAccount('转入2', 0);
    const beforeA = await getBalance(A);
    const beforeB = await getBalance(B);

    const r = await req('POST', '/api/transfers', { from_account_id: A, to_account_id: 99999999, amount: 100 });
    assert.strictEqual(r.json.success, false, '转入账户不存在应失败');
    assert.ok(r.status >= 400, '应返回错误状态码');

    // 回滚验证：转出账户余额不变、不产生任何 transfer 记录、不产生任何交易腿
    assert.strictEqual(await getBalance(A), beforeA, '回滚后转出账户余额必须不变');
    assert.strictEqual(await getBalance(B), beforeB, '回滚后转入账户余额必须不变');

    const transfers = await db.query('SELECT id FROM transfers WHERE from_account_id = ?', [A]);
    assert.strictEqual(transfers.length, 0, '回滚后不得残留 transfer 记录');

    const legs = await db.query('SELECT id FROM transactions WHERE account_id = ? AND type LIKE ?', [A, 'transfer_%']);
    assert.strictEqual(legs.length, 0, '回滚后不得残留交易腿（事务未提交）');
});

test('相同账户互转：业务校验拒绝，不产生任何写入', async () => {
    const A = await createAccount('自转', 500);
    const before = await getBalance(A);

    const r = await req('POST', '/api/transfers', { from_account_id: A, to_account_id: A, amount: 100 });
    assert.strictEqual(r.json.success, false, '同账户互转应被拒绝');
    assert.strictEqual(await getBalance(A), before, '拒绝后余额不变');

    const legs = await db.query('SELECT id FROM transactions WHERE account_id = ? AND type LIKE ?', [A, 'transfer_%']);
    assert.strictEqual(legs.length, 0, '不得产生交易腿');
});
