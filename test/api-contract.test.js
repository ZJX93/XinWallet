/* public/js/utils.js 的 api() 响应契约归一测试
 *
 * 背景：后端 AI 端点存在两种历史契约 —— 业务接口是 `{ success, data }`，
 * AI v2 运维/事件类接口是 `{ ok: true, ... }`（无包装）。前端曾因此在
 * ai-tools / ai-chat / ai-insights 里各自复制一份 fetch 封装（_req）。
 * 现已收敛到 api() 统一出口做归一，本测试守住这个行为，防止回归。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { api } = require(path.join(__dirname, '..', 'public', 'js', 'utils.js'));

/** 用假的 fetch 替换全局，返回指定 status + JSON 体 */
function stubFetch(status, body) {
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        return {
            status,
            ok: status >= 200 && status < 300,
            statusText: `HTTP ${status}`,
            async json() { return body; },
        };
    };
    return calls;
}

test.afterEach(() => { delete global.fetch; });

/* ============ { success, data } 契约（业务接口）============ */

test('success 契约：解包 data 字段返回', async () => {
    stubFetch(200, { success: true, data: { balance: 42 } });
    const r = await api('/accounts');
    assert.deepStrictEqual(r, { balance: 42 });
});

test('success 契约：success:false 抛错并带 status', async () => {
    stubFetch(422, { success: false, message: '金额无效' });
    await assert.rejects(
        () => api('/transactions', 'POST', { amount: -1 }, { silent: true }),
        (err) => {
            assert.strictEqual(err.message, '金额无效');
            assert.strictEqual(err.status, 422);
            return true;
        }
    );
});

/* ============ { ok } 契约（AI v2 运维/事件接口）============ */

test('⛔ ok 契约：ok:true 必须整体返回，不得当成失败', async () => {
    /*  归一前 api() 见 data.success===undefined 会误判失败抛错，
        这正是当年 ai-tools 不得不自建 _req 的原因。 */
    stubFetch(200, { ok: true, event: { id: 7, type: 'transaction.created' } });
    const r = await api('/ai/events/emit', 'POST', { event_type: 'transaction.created' }, { silent: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.event.id, 7);
});

test('ok 契约：ok:false 抛错，error 字段作为消息', async () => {
    stubFetch(400, { ok: false, error: 'event_type 必填' });
    await assert.rejects(
        () => api('/ai/events/emit', 'POST', {}, { silent: true }),
        (err) => {
            assert.strictEqual(err.message, 'event_type 必填');
            assert.strictEqual(err.status, 400);
            return true;
        }
    );
});

test('⛔ ok:false 时 err.payload 必须挂原始响应体', async () => {
    /*  catch 分支靠 err.payload 判断「已由业务分支报过错」，
        缺失会导致二次 toast。 */
    stubFetch(400, { ok: false, error: '参数错误' });
    await assert.rejects(
        () => api('/ai/events/emit', 'POST', {}, { silent: true }),
        (err) => {
            assert.ok(err.payload, 'err.payload 不得为空');
            assert.strictEqual(err.payload.error, '参数错误');
            return true;
        }
    );
});

/* ============ 两种契约的边界不得互相污染 ============ */

test('⛔ success 与 ok 同时存在时以 success 为准', async () => {
    /*  /ai/providers/test 返回 success 包装里嵌 { ok:false }（连接测试失败），
        绝不能被归一分支当成「请求失败」抛错 —— 那是业务结果不是传输错误。 */
    stubFetch(200, { success: true, data: { ok: false, error: '连接超时' } });
    const r = await api('/ai/providers/test', 'POST', {}, { silent: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, '连接超时');
});

test('ok 为非布尔值时不走归一分支', async () => {
    stubFetch(200, { success: true, data: { ok: 'yes' } });
    const r = await api('/whatever', 'GET', null, { silent: true });
    assert.strictEqual(r.ok, 'yes');
});

/* ============ 请求构造 ============ */

test('⛔ GET 请求不得携带 body（否则 fetch 直接 TypeError）', async () => {
    const calls = stubFetch(200, { success: true, data: null });
    await api('/transactions', 'GET', { limit: 10 }, { silent: true });
    assert.strictEqual(calls[0].opts.body, undefined);
});

test('POST 请求序列化 body', async () => {
    const calls = stubFetch(200, { success: true, data: null });
    await api('/transactions', 'POST', { amount: 12.5 }, { silent: true });
    assert.strictEqual(calls[0].opts.body, JSON.stringify({ amount: 12.5 }));
});
