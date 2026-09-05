/* ============================================
   鑫钱包 · 多币种 P2-3c 集成测试
   覆盖：交易路由的 currency 透出链（POST/PUT/列表/单条/summary）
   兜底链：body.currency → 关联账户 currency → 'CNY'
   旧数据 currency=NULL 也会经 JOIN accounts 兜底（路由层 SELECT t.* 已自动带回 currency）
   运行前置：需 PostgreSQL 连接（通过 .env 或默认 localhost:5432）
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

// 加载 .env 配置
require('dotenv').config({ path: __dirname + '/../.env' });

const db = require('../server/db');
const transactionsRouter = require('../server/routes/transactions');

// ==========================================
// 测试工具：每个测试用独立测试用户 + 隔离子账户
// ==========================================
const TEST_USER_PREFIX = 't_mc_user_';

async function createTestUser() {
    const username = TEST_USER_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const result = await db.query(
        'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
        [username, 'test_hash_' + Math.random(), '多币种测试用户']
    );
    const userId = Number(result.insertId);
    const bookId = await db.ensureDefaultBookId(userId);
    return { id: userId, bookId, username };
}

async function cleanupTestUser(userId) {
    // 事务关联删除（应用层维护一致性）
    await db.query('DELETE FROM transactions WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM transfers WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM accounts WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM categories WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM tags WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM books WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
}

async function createTestAccount(userId, bookId, name, currency = 'CNY', openingBalance = 0) {
    const result = await db.query(
        `INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, status, currency)
         VALUES (?, ?, ?, 'cash', '💰', ?, ?, 'active', ?)`,
        [userId, bookId, name, openingBalance, openingBalance, currency]
    );
    return Number(result.insertId);
}

async function getCategoryId(userId, name, type = 'expense') {
    let cat = await db.queryOne(
        'SELECT id FROM categories WHERE name = ? AND type = ? AND user_id IS NULL LIMIT 1',
        [name, type]
    );
    return cat ? cat.id : null;
}

// ==========================================
// 套件前置：构建 express app + 注入 mock req.userId / req.bookId
// ==========================================
let app;
let server;
let baseUrl;

function buildApp(userId, bookId) {
    const a = express();
    a.use(express.json());
    // mock 鉴权中间件：测试时直接注入 userId / bookId
    a.use((req, _res, next) => {
        req.userId = userId;
        req.bookId = bookId;
        next();
    });
    a.use('/api/transactions', transactionsRouter);
    return a;
}

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

function httpJson(method, urlPath, body) {
    return new Promise((resolve, reject) => {
        const http = require('node:http');
        const data = body ? JSON.stringify(body) : '';
        const url = new URL(baseUrl + urlPath);
        const req = http.request({
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let chunks = '';
            res.on('data', c => chunks += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
                } catch (e) {
                    resolve({ status: res.statusCode, body: chunks });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

test.before(async () => {
    try {
        const probe = await Promise.race([
            db.queryOne('SELECT 1 AS ok'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('连接超时（5s）')), 5000))
        ]);
        if (probe && probe.ok === 1) dbAvailable = true;
        console.log('[multi-currency] 数据库连接成功');
    } catch (err) {
        console.warn('[multi-currency] 数据库不可用，相关测试将跳过:', err.message);
    }
});

test.after(async () => {
    if (server) {
        await new Promise(r => server.close(r));
    }
    if (dbAvailable) {
        try { await db.pool.end(); } catch (_) { /* 也许已关闭 */ }
    }
});

// ==========================================
// P2-3c 核心：currency 兜底链
// ==========================================
/** 在每个测试内启动 server，finally 里关掉。返回 baseUrl。 */
async function startServer(userId, bookId) {
    app = buildApp(userId, bookId);
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    return `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
    if (server) {
        await new Promise(r => server.close(r));
        server = null;
    }
}

dbTest('POST /transactions 不传 currency → 写入关联账户币种（默认 CNY）', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, '现金账户', 'CNY', 10000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        const res = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'expense',
            amount: 50, note: '午餐', date: '2026-09-01'
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);

        // 验证 DB 行 currency
        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [res.body.data.id]);
        assert.strictEqual(tx.currency, 'CNY');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('POST /transactions 不传 currency → 关联 USD 账户时写入 USD（兜底链 level 2）', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, '美元现金账户', 'USD', 1000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        const res = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'expense',
            amount: 30, note: 'New York dinner', date: '2026-09-01'
        });
        assert.strictEqual(res.status, 200);

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [res.body.data.id]);
        assert.strictEqual(tx.currency, 'USD');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('POST /transactions 显式传 currency → 写入 body.currency（兜底链 level 1，跨账户币种）', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        // CNY 账户下手动记一笔 JPY 餐费（混币种账本下常见：去日本出差用 CNY 卡付日元）
        const res = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'expense',
            amount: 3000, currency: 'JPY', note: '东京拉面', date: '2026-09-01'
        });
        assert.strictEqual(res.status, 200);

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [res.body.data.id]);
        assert.strictEqual(tx.currency, 'JPY');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('POST /transactions currency 小写自动转大写', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, '现金', 'CNY', 5000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        const res = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'expense',
            amount: 100, currency: 'eur', date: '2026-09-01'
        });
        assert.strictEqual(res.status, 200);

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [res.body.data.id]);
        assert.strictEqual(tx.currency, 'EUR');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

// ==========================================
// GET 列表/单条透出
// ==========================================
dbTest('GET /transactions 列表返回的每条记录带 currency 字段', async () => {
    const user = await createTestUser();
    try {
        const accCny = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const accUsd = await createTestAccount(user.id, user.bookId, 'USD 账户', 'USD', 1000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        // 写两笔不同币种的交易
        await httpJson('POST', '/api/transactions', {
            account_id: accCny, category_id: catId, type: 'expense', amount: 50, date: '2026-09-01'
        });
        await httpJson('POST', '/api/transactions', {
            account_id: accUsd, category_id: catId, type: 'expense', amount: 10, date: '2026-09-02'
        });

        const res = await httpJson('GET', '/api/transactions');
        assert.strictEqual(res.status, 200);
        const list = res.body.data;
        assert.ok(Array.isArray(list) && list.length >= 2, '应至少 2 条交易');
        for (const tx of list) {
            assert.ok(tx.currency, `每条交易都应带 currency，实际: ${JSON.stringify(tx)}`);
            assert.ok(['CNY', 'USD'].includes(tx.currency), `currency 必须是已知币种，实际: ${tx.currency}`);
        }
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('GET /transactions/:id 返回的记录带 currency 字段', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, 'HKD 账户', 'HKD', 5000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        const createRes = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'expense', amount: 200, date: '2026-09-03'
        });
        const txId = createRes.body.data.id;

        const getRes = await httpJson('GET', `/api/transactions/${txId}`);
        assert.strictEqual(getRes.status, 200);
        assert.strictEqual(getRes.body.data.currency, 'HKD');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

// ==========================================
// PUT 编辑：保留老 currency 兜底
// ==========================================
dbTest('PUT /transactions/:id 不传 currency 时跟随新账户币种（兜底链 level 3：新关联账户 currency）', async () => {
    const user = await createTestUser();
    try {
        const accCny = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const accUsd = await createTestAccount(user.id, user.bookId, 'USD 账户', 'USD', 1000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        // 创建时显式传 USD
        const createRes = await httpJson('POST', '/api/transactions', {
            account_id: accCny, category_id: catId, type: 'expense',
            amount: 50, currency: 'USD', date: '2026-09-01'
        });
        const txId = createRes.body.data.id;

        // 编辑时不传 currency 但切换到 USD 账户 → 跟随 USD 账户（设计选择：
        // 编辑表单切账户时 currency 自动跟随，避免「CNY 账户下记 USD」的隐式数据残留）
        await httpJson('PUT', `/api/transactions/${txId}`, {
            account_id: accUsd, category_id: catId, type: 'expense',
            amount: 60, note: '切到美元账户', date: '2026-09-01'
        });

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [txId]);
        assert.strictEqual(tx.currency, 'USD');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('PUT /transactions/:id 不传 currency 且不切账户 → 跟随当前账户币种', async () => {
    const user = await createTestUser();
    try {
        const accCny = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const catId = await getCategoryId(user.id, '餐饮', 'expense');
        baseUrl = await startServer(user.id, user.bookId);

        // 创建时显式传 USD 但账户是 CNY（混币种账本下常见：CNY 账户记 USD）
        const createRes = await httpJson('POST', '/api/transactions', {
            account_id: accCny, category_id: catId, type: 'expense',
            amount: 50, currency: 'USD', date: '2026-09-01'
        });
        const txId = createRes.body.data.id;

        // 编辑时账户保持 CNY + 不传 currency → 跟随 CNY 账户（设计：编辑表单应显示当前账户币种）
        await httpJson('PUT', `/api/transactions/${txId}`, {
            account_id: accCny, category_id: catId, type: 'expense',
            amount: 60, note: '改一下金额', date: '2026-09-01'
        });

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [txId]);
        assert.strictEqual(tx.currency, 'CNY');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('PUT /transactions/:id 显式传 currency → 覆盖为新币种', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const catId = await getCategoryId(user.id, '工资薪水', 'income');
        baseUrl = await startServer(user.id, user.bookId);

        const createRes = await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: catId, type: 'income', amount: 5000, date: '2026-09-01'
        });
        const txId = createRes.body.data.id;

        // 编辑时改币种为 USD（汇率折算场景）
        await httpJson('PUT', `/api/transactions/${txId}`, {
            account_id: accId, category_id: catId, type: 'income',
            amount: 700, currency: 'USD', date: '2026-09-01'
        });

        const tx = await db.queryOne('SELECT currency FROM transactions WHERE id = ?', [txId]);
        assert.strictEqual(tx.currency, 'USD');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

// ==========================================
// GET /summary：breakdown + primary currency
// ==========================================
dbTest('GET /transactions/summary 返回 incomeBreakdown / expenseBreakdown / currency 按币种分组', async () => {
    const user = await createTestUser();
    try {
        const accCny = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const accUsd = await createTestAccount(user.id, user.bookId, 'USD 账户', 'USD', 1000);
        const expCat = await getCategoryId(user.id, '餐饮', 'expense');
        const incCat = await getCategoryId(user.id, '工资薪水', 'income');
        baseUrl = await startServer(user.id, user.bookId);

        // 9 月：CNY 支出 100 + 200；USD 支出 50 + USD 收入 1000
        await httpJson('POST', '/api/transactions', {
            account_id: accCny, category_id: expCat, type: 'expense', amount: 100, date: '2026-09-05'
        });
        await httpJson('POST', '/api/transactions', {
            account_id: accCny, category_id: expCat, type: 'expense', amount: 200, date: '2026-09-10'
        });
        await httpJson('POST', '/api/transactions', {
            account_id: accUsd, category_id: expCat, type: 'expense', amount: 50, date: '2026-09-06'
        });
        await httpJson('POST', '/api/transactions', {
            account_id: accUsd, category_id: incCat, type: 'income', amount: 1000, date: '2026-09-07'
        });

        const res = await httpJson('GET', '/api/transactions/summary?month=2026-09');
        assert.strictEqual(res.status, 200);
        const data = res.body.data;

        // breakdown 字段存在且按币种分组
        assert.ok(data.incomeBreakdown, '应返回 incomeBreakdown');
        assert.ok(data.expenseBreakdown, '应返回 expenseBreakdown');
        assert.strictEqual(data.incomeBreakdown.USD, 1000, 'USD 收入 1000');
        assert.strictEqual(data.expenseBreakdown.CNY, 300, 'CNY 支出 100+200=300');
        assert.strictEqual(data.expenseBreakdown.USD, 50, 'USD 支出 50');

        // primary 选 amount 绝对值最大者（USD 1000 > CNY 300 > USD 50）
        assert.strictEqual(data.currency, 'USD');
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});

dbTest('GET /transactions/summary 单币种账本：breakdown 只有 CNY 一项', async () => {
    const user = await createTestUser();
    try {
        const accId = await createTestAccount(user.id, user.bookId, 'CNY 账户', 'CNY', 10000);
        const expCat = await getCategoryId(user.id, '餐饮', 'expense');
        const incCat = await getCategoryId(user.id, '工资薪水', 'income');
        baseUrl = await startServer(user.id, user.bookId);

        await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: expCat, type: 'expense', amount: 100, date: '2026-09-05'
        });
        await httpJson('POST', '/api/transactions', {
            account_id: accId, category_id: incCat, type: 'income', amount: 5000, date: '2026-09-07'
        });

        const res = await httpJson('GET', '/api/transactions/summary?month=2026-09');
        const data = res.body.data;

        assert.deepStrictEqual(Object.keys(data.incomeBreakdown), ['CNY']);
        assert.deepStrictEqual(Object.keys(data.expenseBreakdown), ['CNY']);
        assert.strictEqual(data.currency, 'CNY');
        assert.strictEqual(data.incomeBreakdown.CNY, 5000);
        assert.strictEqual(data.expenseBreakdown.CNY, 100);
    } finally {
        await stopServer();
        await cleanupTestUser(user.id);
    }
});
