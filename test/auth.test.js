/* ============================================
   鑫钱包 · 认证中间件负路径回归测试
   覆盖：authMiddleware 对「无 token / 伪造 token / refresh token 越权」必须 401，
   且合法 token 能正确注入 req.userId。
   不启动服务、不依赖数据库（纯中间件单元）。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');

const { authMiddleware, signToken, signRefreshToken } = require('../server/auth');

function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.body = null;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.body = obj; return res; };
    return res;
}

function run(req) {
    const res = mockRes();
    let nextCalled = false;
    authMiddleware(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
}

const UID = 424242;

test('无 Authorization 头 → 401 未授权', () => {
    const { res, nextCalled } = run({ headers: {} });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nextCalled, false);
    assert.match(res.body.message, /未授权/);
});

test('伪造 / 非法 token → 401 登录过期', () => {
    const { res, nextCalled } = run({ headers: { authorization: 'Bearer not-a-real-jwt' } });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nextCalled, false);
    assert.match(res.body.message, /重新登录|过期/);
});

test('refresh token 当作 access 使用 → 401 拒绝访问', () => {
    // refresh token 由独立 refresh 密钥签发，access 中间件用 access 密钥验签必然失败
    // → 落入「登录已过期」分支返回 401，绝不放行（即便有人拿 refresh token 当 access 用）。
    const refresh = signRefreshToken({ id: UID });
    const { res, nextCalled } = run({ headers: { authorization: 'Bearer ' + refresh } });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nextCalled, false);
});

test('合法 access token → 通过并注入 req.userId', () => {
    const token = signToken({ id: UID, username: 'u' });
    const req = { headers: { authorization: 'Bearer ' + token } };
    const { res, nextCalled } = run(req);
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.userId, UID);
    assert.strictEqual(res.statusCode, 200);
});

test('Authorization 非 Bearer 方案 → 视为无 token → 401', () => {
    const { res, nextCalled } = run({ headers: { authorization: 'Basic abcdef' } });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nextCalled, false);
});
