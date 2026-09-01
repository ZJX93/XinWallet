/* ============================================
   鑫钱包 · SSRF 防护模块
   校验外发 URL 拒绝指向内网/链路本地地址的请求。
   适用场景：AI Provider base_url 由用户配置，可能被恶意指向
   云实例元数据服务（169.254.169.254）、本地数据库、内网服务等。
   ============================================ */

const dns = require('dns').promises;
const net = require('net');

// IPv4 私有/回环/链路本地段（采用 start & mask 模式匹配，避免对大数值做位运算时溢出/出错）
const PRIVATE_RANGES_V4 = [
    [ipToLongSafe('10.0.0.0'), 0xff000000],          // 10.0.0.0/8
    [ipToLongSafe('127.0.0.0'), 0xff000000],          // 127.0.0.0/8 (loopback)
    [ipToLongSafe('169.254.0.0'), 0xffff0000],        // 169.254.0.0/16 (link-local + AWS metadata!)
    [ipToLongSafe('172.16.0.0'), 0xfff00000],         // 172.16.0.0/12
    [ipToLongSafe('192.168.0.0'), 0xffff0000],        // 192.168.0.0/16
    [ipToLongSafe('0.0.0.0'), 0xff000000],           // 0.0.0.0/8
    [ipToLongSafe('100.64.0.0'), 0xffc00000],        // 100.64.0.0/10 (CGN)
    [ipToLongSafe('224.0.0.0'), 0xf0000000],         // 224.0.0.0/4 (multicast)
    [ipToLongSafe('240.0.0.0'), 0xf0000000],         // 240.0.0.0/4 (reserved/broadcast)
];

function ipToLongSafe(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        throw new Error(`非法 IP 字面量: ${ip}`);
    }
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip) {
    try {
        const long = ipToLongSafe(ip);
        return PRIVATE_RANGES_V4.some(([base, mask]) => (long & mask) === (base & mask));
    } catch {
        return true; // 解析不出按最严格处理
    }
}

function isPrivateIPv6(ip) {
    const norm = ip.toLowerCase();
    // ::1（IPv6 loopback）
    if (norm === '::1' || norm === '0:0:0:0:0:0:0:1') return true;
    // fe80::/10（链路本地）
    if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true;
    // fc00::/7（唯一本地）
    if (/^f[cd]/.test(norm)) return true;
    // ::ffff:0:0/96（IPv4 映射地址）—— 转入 IPv4 链路本地/私网段同样危险
    const v4Mapped = norm.match(/^::ffff:([0-9.]+)$/);
    if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);
    return false;
}

function isLinkLocalIPv4(ip) {
    try {
        const long = ipToLongSafe(ip);
        return (long & 0xffff0000) === (ipToLongSafe('169.254.0.0') & 0xffff0000);
    } catch {
        return true;
    }
}

function isLinkLocalIPv6(ip) {
    const norm = ip.toLowerCase();
    return norm === 'fe80::' || norm.startsWith('fe80:');
}

/**
 * 异步校验 URL：协议白名单 + 拒绝内网地址。
 * 域名需 DNS 解析后再次校验（防 DNS rebinding 与字母绕过）。
 *
 * @param {string} urlStr 用户输入的外发 URL
 * @param {object} [opts] 选项
 * @param {boolean} [opts.allowLoopback] 是否放行回环地址（localhost / 127.0.0.1 / ::1）。
 *   用于用户本地部署的服务商（如本机 Ollama）—— 这是用户明确配置的自身服务，
 *   不属于 SSRF 风险。
 * @param {boolean} [opts.allowPrivate] 是否放行私有内网地址（10/8、172.16/12、192.168/16 等）。
 *   用于用户自定义的局域网 AI 服务商（如家中另一台机器部署的 FreeLLMAPI）。
 *   注意：链路本地 169.254.0.0/16（含云 metadata）始终拦截，不受此选项影响。
 * @returns {Promise<URL>} 通过校验的 URL 对象
 * @throws 协议非法或地址指向内网/链路本地
 */
async function assertPublicUrl(urlStr, opts = {}) {
    const allowLoopback = !!opts.allowLoopback;
    const allowPrivate = !!opts.allowPrivate;
    let u;
    try {
        u = new URL(urlStr);
    } catch {
        throw new Error('URL 格式无效');
    }
    if (!['http:', 'https:'].includes(u.protocol)) {
        throw new Error('仅支持 HTTP/HTTPS 协议');
    }

    // 剥去 IPv6 字面量的方括号（http://[::1]/ 这种写法）
    let host = u.hostname.replace(/^\[|\]$/g, '');
    if (!host) throw new Error('URL 缺少主机名');

    // 回环地址：allowLoopback 时放行（本地 Ollama 等）；否则仍按原策略拒绝，
    // 链路本地 169.254.0.0/16（含云 metadata 169.254.169.254）始终拦截，不在此分支
    const isLoopback = host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1'
        || (net.isIP(host) === 4 && host.startsWith('127.'));
    if (isLoopback) {
        if (!allowLoopback) throw new Error('禁止访问 localhost');
        // ⚠️ SSRF 闭环：返回锁定后的连接目标，调用方直连该地址且不再二次 DNS 解析，
        // 杜绝 DNS Rebinding 时序绕过（TOCTOU）。回环地址即原 host。
        return { url: u, host: u.hostname, ip: host };
    }
    if (net.isIP(host) === 4) {
        if (isLinkLocalIPv4(host)) throw new Error(`禁止访问链路本地地址: ${host}`);
        if (!allowPrivate && isPrivateIPv4(host)) throw new Error(`禁止访问内网地址: ${host}`);
        return { url: u, host: u.hostname, ip: host };
    }
    if (net.isIP(host) === 6) {
        if (isLinkLocalIPv6(host)) throw new Error(`禁止访问链路本地地址: ${host}`);
        if (!allowPrivate && isPrivateIPv6(host)) throw new Error(`禁止访问内网地址: ${host}`);
        return { url: u, host: u.hostname, ip: host };
    }

    // 域名：解析所有 A/AAAA 记录，任意一条指向内网即拒绝。
    // ⚠️ SSRF 闭环：校验通过后锁定一个「通过校验」的 IP（chosen），调用方必须用它直连并带
    // Host/SNI，禁止再次 DNS 解析，否则攻击者可借 DNS Rebinding 在「校验(公网)」与「连接(内网)」之间
    // 切换地址，绕过上面全部拦截。只要解析结果含任一内网/链路本地地址即整体拒绝（强防护）。
    try {
        const records = await dns.lookup(host, { all: true });
        if (!records.length) throw new Error(`域名无法解析: ${host}`);
        let chosen = null;
        for (const r of records) {
            if (net.isIPv4(r.address)) {
                if (isLinkLocalIPv4(r.address)) throw new Error(`域名 ${host} 解析到链路本地地址: ${r.address}`);
                if (!allowPrivate && isPrivateIPv4(r.address)) throw new Error(`域名 ${host} 解析到内网地址: ${r.address}`);
                if (!chosen) chosen = r.address;
            }
            if (net.isIPv6(r.address)) {
                if (isLinkLocalIPv6(r.address)) throw new Error(`域名 ${host} 解析到链路本地地址: ${r.address}`);
                if (!allowPrivate && isPrivateIPv6(r.address)) throw new Error(`域名 ${host} 解析到内网地址: ${r.address}`);
                if (!chosen) chosen = r.address;
            }
        }
        if (!chosen) throw new Error(`域名 ${host} 无可用的 IP 地址`);
        return { url: u, host: u.hostname, ip: chosen };
    } catch (err) {
        if (err.code === 'ENOTFOUND') throw new Error(`域名无法解析: ${host}`);
        throw err;
    }
}

module.exports = { assertPublicUrl, isPrivateIPv4, isPrivateIPv6 };
