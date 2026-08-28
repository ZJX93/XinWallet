/* ============================================
   鑫钱包 · 账户资金明细回归测试
   覆盖：GET /accounts/:id/transactions 不再因引用不存在的列崩溃。
   回归点：还款流水 SQL 曾写 `d.icon as debt_icon`（debts 表无 icon 列），
           导致任何账户点"资金明细"都 500（column d.icon does not exist）。
           修复：改为常量图标，不再引用不存在的列。
   运行前置：需 PostgreSQL（与 CI postgres:16 服务一致）
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

require('dotenv').config({ path: __dirname + '/../.env' });

const db = require('../server/db');
const accountsRouter = require('../server/routes/accounts');

const TEST_USER_ID = 987654;
let testBookId = null;
const app = express();
app.use(express.json());
// mock 鉴权：注入固定 userId + bookId（本测试不验证鉴权本身，但需模拟多账本 resolveBookContext）
app.use((req, res, next) => { req.userId = TEST_USER_ID; req.bookId = testBookId; next(); });
app.use('/api/accounts', accountsRouter);

let server;
let base;
let accId;

async function listen() {
    return new Promise(resolve => {
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
    await listen();
    // 模拟多账本 resolveBookContext：为测试用户确保默认账本并注入 bookId
    testBookId = await db.ensureDefaultBookId(TEST_USER_ID);
    const create = await req('POST', '/api/accounts', {
        name: '回归测试账户', type: 'cash', icon: '💵', balance: 0, opening_balance: 0
    });
    accId = create.json.data && create.json.data.id;
    assert.ok(accId, '测试账户应创建成功并拿到 id');
});

test.after(async () => {
    try { await db.query('DELETE FROM accounts WHERE user_id = ?', [TEST_USER_ID]); } catch (_) {}
    try { await db.query('DELETE FROM books WHERE user_id = ?', [TEST_USER_ID]); } catch (_) {}
    if (server) {
        // fetch 默认 keep-alive，close() 只停止接收新连接，必须先断开存量连接
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
    }
    // 关闭连接池：MySQL 方言下空闲连接会留到 idleTimeout（60s）才回收，
    // 进程因此无法自行退出，node --test 会把整个文件判为顶层超时。
    try { await db.pool.end(); } catch (_) { /* 也许已关闭 */ }
});

test('账户资金明细接口返回 200（回归 column d.icon does not exist 500）', async () => {
    const r = await req('GET', `/api/accounts/${accId}/transactions`);
    assert.strictEqual(r.status, 200, '修复前会因 debts.icon 不存在返回 500');
    assert.ok(r.json.success, '响应应标记为成功');
    assert.ok(Array.isArray(r.json.data.transactions), '应返回 transactions 数组');
});

test('无关联数据的账户可彻底删除，有关联数据则拒绝（409）', async () => {
    // 1) usage 接口对空账户应返回 total=0
    const usageBefore = await req('GET', `/api/accounts/${accId}/usage`);
    assert.strictEqual(usageBefore.status, 200);
    assert.strictEqual(usageBefore.json.data.total, 0, '新账户不应有关联数据');

    // 2) 无关联数据 -> 彻底删除成功
    const del = await req('DELETE', `/api/accounts/${accId}`);
    assert.strictEqual(del.status, 200, '无关联数据应可彻底删除');
    assert.ok(del.json.success, '应返回成功');

    // 3) 重新建账户并写入一笔交易，usage 应统计到，删除应被 409 拒绝
    const create2 = await req('POST', '/api/accounts', {
        name: '有关联的账户', type: 'cash', icon: '💵', balance: 0, opening_balance: 0
    });
    const acc2 = create2.json.data && create2.json.data.id;
    assert.ok(acc2, '第二个测试账户应创建成功');

    // 借用投资/交易表需要完整结构，这里用 savings_goals 作为"关联数据"代理（结构简单且无外键约束）
    await db.query(
        'INSERT INTO savings_goals (user_id, name, target_amount, current_amount, account_id) VALUES (?, ?, 100, 0, ?)',
        [TEST_USER_ID, '关联储蓄目标', acc2]
    );
    const usageAfter = await req('GET', `/api/accounts/${acc2}/usage`);
    assert.strictEqual(usageAfter.status, 200);
    assert.ok(usageAfter.json.data.total > 0, '有关联储蓄目标时 usage.total 应 > 0');

    const del2 = await req('DELETE', `/api/accounts/${acc2}`);
    assert.strictEqual(del2.status, 409, '有关联数据应拒绝彻底删除');
    assert.ok(!del2.json.success, '应返回失败');
    assert.ok(/关联数据/.test(del2.json.message || ''), '错误信息应提示存在关联数据');

    // 清理：删除关联目标与账户（避免遗留），账户此时仍可被关闭/保留
    await db.query('DELETE FROM savings_goals WHERE user_id = ? AND account_id = ?', [TEST_USER_ID, acc2]);
});
