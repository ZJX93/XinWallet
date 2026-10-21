/* ============================================
   鑫钱包 · 余额重算一致性测试网（审计 N+1 深度批处理前置）
   目标：在重构「逐账户余额重算 7 处重复模式」之前，先把现状锁死：
     1) 正确性 —— 用独立预期值（期初 ± 金额）断言账户余额，不等价于任何内部函数；
     2) 漂移   —— 断言落库的 accounts.balance 严格等于 canonical 重算
                  computeAccountBalance（重构若让某条路径偏离单一真相，此处必红）。
   覆盖：transactions 新增/删除、transfers 转账（双账户）。
   运行前置：需 PostgreSQL（同 CI postgres:16）。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

require('dotenv').config({ path: __dirname + '/../.env' });

const db = require('../server/db');
const { computeAccountBalance } = require('../server/routes/_helpers');
const transactionsRouter = require('../server/routes/transactions');
const transfersRouter = require('../server/routes/transfers');

let dbAvailable = false;
function dbTest(name, fn) {
    return test(name, async (t) => {
        if (!dbAvailable) {
            t.skip('数据库不可用，跳过（运行 `docker compose up -d db` 启动后重试）');
            return;
        }
        await fn(t);
    });
}

let server, base;
let user, bookId;

async function createTestUser() {
    const username = 't_bal_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const r = await db.query(
        'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
        [username, 'test_hash_' + Math.random(), '余额重算测试']
    );
    const userId = Number(r.insertId);
    const bid = await db.ensureDefaultBookId(userId);
    return { id: userId, bookId: bid, username };
}

async function cleanupTestUser(userId) {
    for (const tbl of ['transactions', 'transfers', 'accounts', 'savings_goals',
        'budgets', 'categories', 'tags', 'debts', 'investments', 'books', 'users']) {
        try { await db.query(`DELETE FROM ${tbl} WHERE user_id = ?`, [userId]); } catch (_) {}
    }
}

async function createAccount(name, opening) {
    const r = await db.query(
        `INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, status)
         VALUES (?, ?, ?, 'cash', '💰', ?, ?, 'active')`,
        [user.id, bookId, name, opening, opening]
    );
    return Number(r.insertId);
}

async function getBalance(accountId) {
    const row = await db.queryOne('SELECT balance FROM accounts WHERE id = ?', [accountId]);
    return Number(row.balance);
}

async function getAnyCategory(type) {
    const row = await db.queryOne(
        'SELECT id FROM categories WHERE user_id IS NULL AND type = ? LIMIT 1', [type]
    );
    return row ? Number(row.id) : null;
}

const app = express();
app.use(express.json());
// 测试桩：注入 userId / bookId（真实链路由 auth + 账本解析中间件完成）
app.use((req, res, next) => { req.userId = user.id; req.bookId = bookId; next(); });
app.use('/api/transactions', transactionsRouter);
app.use('/api/transfers', transfersRouter);

async function listen() {
    return new Promise((resolve) => {
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

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
    try {
        const probe = await Promise.race([
            db.queryOne('SELECT 1 AS ok'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('连接超时（5s）')), 5000)),
        ]);
        if (probe && probe.ok === 1) dbAvailable = true;
    } catch (_) { dbAvailable = false; }

    if (!dbAvailable) return;
    user = await createTestUser();
    bookId = user.bookId;
    await listen();
});

test.after(async () => {
    if (dbAvailable && user) {
        try { await cleanupTestUser(user.id); } catch (_) {}
    }
    if (server) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
    }
    try { await db.pool.end(); } catch (_) {}
});

// ───────────────────────── 交易：新增/删除 余额重算 ─────────────────────────
dbTest('交易·支出：余额 = 期初 − 金额，且等于 canonical 重算', async () => {
    const cat = await getAnyCategory('expense');
    assert.ok(cat, '需存在系统支出分类');
    const acc = await createAccount('工资卡', 1000);

    const r = await req('POST', '/api/transactions', {
        account_id: acc, category_id: cat, type: 'expense', amount: 200,
    });
    assert.strictEqual(r.json.success, true, '支出交易应成功');

    assert.strictEqual(await getBalance(acc), 800, '期初 1000 − 支出 200 应得 800（独立预期）');
    assert.strictEqual(
        await getBalance(acc),
        await computeAccountBalance(db, user.id, acc, bookId),
        '落库余额必须等于 canonical 重算（防漂移）'
    );
});

dbTest('交易·收入：余额累加正确，且等于 canonical 重算', async () => {
    const cat = await getAnyCategory('income');
    assert.ok(cat, '需存在系统收入分类');
    const acc = await createAccount('余额宝', 1000);

    await req('POST', '/api/transactions', { account_id: acc, category_id: cat, type: 'income', amount: 500 });
    assert.strictEqual(await getBalance(acc), 1500, '1000 + 收入 500 应得 1500（独立预期）');
    assert.strictEqual(await getBalance(acc), await computeAccountBalance(db, user.id, acc, bookId));
});

dbTest('交易·删除：余额回滚到期初，且等于 canonical 重算', async () => {
    const cat = await getAnyCategory('expense');
    const acc = await createAccount('信用卡', 1000);

    const r = await req('POST', '/api/transactions', { account_id: acc, category_id: cat, type: 'expense', amount: 200 });
    const txId = r.json.data.id;
    assert.ok(txId > 0, '应返回交易 id');

    const del = await req('DELETE', `/api/transactions/${txId}`);
    assert.strictEqual(del.json.success, true, '删除应成功');

    assert.strictEqual(await getBalance(acc), 1000, '删除后余额应回滚到期初 1000（独立预期）');
    assert.strictEqual(await getBalance(acc), await computeAccountBalance(db, user.id, acc, bookId));
});

// ───────────────────────── 转账：双账户余额重算 ─────────────────────────
dbTest('转账：双账户余额原子更新，且都等于 canonical 重算', async () => {
    const A = await createAccount('转出', 1000);
    const B = await createAccount('转入', 0);

    const r = await req('POST', '/api/transfers', { from_account_id: A, to_account_id: B, amount: 300 });
    assert.strictEqual(r.json.success, true, '转账应成功');

    assert.strictEqual(await getBalance(A), 700, '转出账户应为 700（独立预期）');
    assert.strictEqual(await getBalance(B), 300, '转入账户应为 300（独立预期）');
    assert.strictEqual(await getBalance(A), await computeAccountBalance(db, user.id, A, bookId));
    assert.strictEqual(await getBalance(B), await computeAccountBalance(db, user.id, B, bookId));
});

// ───────────────────────── 批量写回 helper 单测 ─────────────────────────
dbTest('writeAccountBalances：批量写回且仅影响给定账户', async () => {
    const A = await createAccount('批量甲', 100);
    const B = await createAccount('批量乙', 200);
    const C = await createAccount('批量丙', 999); // 不应被改动

    const { writeAccountBalances } = require('../server/routes/_helpers');
    await writeAccountBalances(db, user.id, bookId, { [A]: 111, [B]: 222 });

    assert.strictEqual(await getBalance(A), 111, 'A 应被批量改写为 111');
    assert.strictEqual(await getBalance(B), 222, 'B 应被批量改写为 222');
    assert.strictEqual(await getBalance(C), 999, '未传入的 C 余额必须保持不变');

    // 严格按 user+book 隔离：不同账本的账户不会被误改
    const ins = await db.query(
        'INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, bookId + 999999, '异账本账户', 'cash', 'x', 0, 0, 'active']
    );
    const otherId = Number(ins.insertId);
    await writeAccountBalances(db, user.id, bookId, { [otherId]: 555 });
    assert.strictEqual(await getBalance(otherId), 0, '异账本账户不应被改写');
});
