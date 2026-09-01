/* ============================================
   鑫钱包 · url-guard SSRF 防护回归测试
   ------------------------------------------------
   验证 assertPublicUrl 在各类地址下的放行 / 拒绝行为，
   以及「校验后锁定连接 IP、返回 {url, host, ip}」的 SSRF 闭环
   （防 DNS Rebinding 时序绕过 / TOCTOU）。

   全部用例离线可跑（IP 字面量 + 无效域名），仅「真实公网域名」用例
   依赖网络，无网络时自动跳过。不连数据库。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const dns = require('dns');
const { assertPublicUrl } = require('../server/services/url-guard');

// 探测网络（仅用于决定是否运行真实公网域名用例）
async function hasNetwork() {
    try { await dns.promises.lookup('example.com'); return true; } catch { return false; }
}

test('回环 IP 在 allowLoopback 下放行并锁定 IP', async () => {
    const v = await assertPublicUrl('http://127.0.0.1:11434', { allowLoopback: true, allowPrivate: true });
    assert.strictEqual(v.ip, '127.0.0.1');
    assert.strictEqual(v.host, '127.0.0.1');
    assert.ok(v.url instanceof URL);
});

test('localhost 在 allowLoopback 下放行并锁定 host', async () => {
    const v = await assertPublicUrl('http://localhost:11434', { allowLoopback: true, allowPrivate: true });
    assert.strictEqual(v.host, 'localhost');
    assert.ok(v.url instanceof URL);
});

test('局域网 IPv4 在 allowPrivate 下放行', async () => {
    const v = await assertPublicUrl('http://192.168.1.100:11434', { allowLoopback: true, allowPrivate: true });
    assert.strictEqual(v.ip, '192.168.1.100');
});

test('局域网 10.x 在 allowPrivate 下放行', async () => {
    const v = await assertPublicUrl('http://10.0.0.5:8080', { allowLoopback: true, allowPrivate: true });
    assert.strictEqual(v.ip, '10.0.0.5');
});

test('公网 IP 放行并锁定 IP', async () => {
    const v = await assertPublicUrl('http://8.8.8.8', { allowLoopback: true, allowPrivate: true });
    assert.strictEqual(v.ip, '8.8.8.8');
});

test('链路本地地址始终拒绝（即使 allowPrivate）', async () => {
    await assert.rejects(
        () => assertPublicUrl('http://169.254.169.254/', { allowLoopback: true, allowPrivate: true }),
        /链路本地/
    );
});

test('无法解析的域名被拒绝（防 DNS 失败绕过）', async () => {
    await assert.rejects(
        () => assertPublicUrl('http://this-domain-must-not-resolve-xyz.invalid', { allowLoopback: true, allowPrivate: true }),
        /域名无法解析/
    );
});

test('默认严格模式拒绝局域网', async () => {
    await assert.rejects(
        () => assertPublicUrl('http://192.168.1.100', {}),
        /内网/
    );
});

test('默认严格模式拒绝回环', async () => {
    await assert.rejects(
        () => assertPublicUrl('http://127.0.0.1', {}),
        /localhost/
    );
});

test('真实公网域名放行：锁定解析 IP，Host/SNI 用原域名', async (t) => {
    if (!(await hasNetwork())) t.skip('无网络，跳过真实域名用例');
    const v = await assertPublicUrl('https://example.com', { allowLoopback: true, allowPrivate: true });
    assert.ok(v.ip, '应锁定一个解析到的 IP');
    assert.strictEqual(v.host, 'example.com'); // Host/SNI 用原域名，而非直连 IP
    assert.ok(v.url instanceof URL);
});
