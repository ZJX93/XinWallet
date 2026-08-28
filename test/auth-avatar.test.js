/* ============================================
   鑫钱包 · 头像持久化回归测试
   覆盖：注册/登录/资料接口必须返回并持久化 avatar。
   回归点：登录 SELECT 曾漏掉 avatar 字段，导致退出再登录头像回退默认且"改了留不住"。
   运行前置：需 PostgreSQL（与 CI postgres:16 服务一致）
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

require('dotenv').config({ path: __dirname + '/../.env' });

const db = require('../server/db');
const authRouter = require('../server/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

let server;
let base;
const USERNAME = 't_avatar_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
const PASSWORD = 'Test1234';

async function listen() {
    return new Promise(resolve => {
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

async function req(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

test.before(async () => { await listen(); });

test.after(async () => {
    try { await db.query('DELETE FROM users WHERE username = ?', [USERNAME]); } catch (_) {}
    if (server) {
        // fetch 默认 keep-alive，close() 只停止接收新连接，必须先断开存量连接
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close();
    }
    // 关闭连接池，否则 MySQL 方言下空闲连接会让进程一直不退出
    try { await db.pool.end(); } catch (_) { /* 也许已关闭 */ }
});

test('注册响应必须返回默认头像', async () => {
    const r = await req('POST', '/api/auth/register', { username: USERNAME, password: PASSWORD, nickname: '头像测试' });
    assert.strictEqual(r.json.success, true, '注册应成功');
    assert.ok(
        typeof r.json.data.user.avatar === 'string' && r.json.data.user.avatar.length > 0,
        '注册响应应返回非空 avatar'
    );
});

test('登录响应必须返回 avatar（否则退出再登录会回退默认）', async () => {
    const r = await req('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
    assert.strictEqual(r.json.success, true, '登录应成功');
    assert.strictEqual(r.json.data.user.avatar, '👤', '登录响应必须携带 avatar，缺失会导致头像回退默认');
});

test('修改头像后重新登录仍保留（核心回归）', async () => {
    const login = await req('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
    const token = login.json.data.token;

    const upd = await req('PUT', '/api/auth/profile', { avatar: '🐱' }, token);
    assert.strictEqual(upd.json.success, true, '资料更新应成功');
    assert.strictEqual(upd.json.data.user.avatar, '🐱', 'PUT /profile 应保存新头像');

    // 关键：重新登录必须返回已持久化的头像，而非回退默认
    const relogin = await req('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
    assert.strictEqual(relogin.json.data.user.avatar, '🐱', '重新登录必须返回已保存头像（头像 bug 回归）');
});
