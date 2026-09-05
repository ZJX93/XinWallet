/* ============================================
   鑫钱包 · 前端通用工具（纯函数，可在 Node 中单元测试）
   ============================================ */

// HTML 转义：防止用户可控字段（账户名、备注、标签名等）在 innerHTML 中造成存储型 XSS
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// 货币格式化（多币种 P2-2a）：按 currency（ISO 4217）选 locale 与符号，去除硬编码 ¥
// 负数标准格式：符号在前、负号在最前，例如 -74.14 USD → "-$74.14"
const _currencyLocale = { CNY: 'zh-CN', USD: 'en-US', EUR: 'en-IE', HKD: 'en-US', JPY: 'ja-JP', GBP: 'en-GB', AUD: 'en-AU', CAD: 'en-CA' };
const _currencySymbol = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$', JPY: '¥', GBP: '£', AUD: 'A$', CAD: 'C$' };
const _supportedCurrencies = Object.keys(_currencyLocale); // ['CNY','USD','EUR','HKD','JPY','GBP','AUD','CAD']
const _fmtCache = {};
function _getFmt(locale) {
    if (!_fmtCache[locale]) _fmtCache[locale] = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return _fmtCache[locale];
}
function _resolveCur(currency) {
    const cur = String(currency || 'CNY').toUpperCase();
    return { cur, locale: _currencyLocale[cur] || 'en-US', symbol: _currencySymbol[cur] || (cur + ' ') };
}
function fmt(n, currency = 'CNY') {
    const v = Number(n);
    if (!isFinite(v)) return _resolveCur(currency).symbol + '0.00';
    const { locale, symbol } = _resolveCur(currency);
    return (v < 0 ? '-' : '') + symbol + _getFmt(locale).format(Math.abs(v));
}

// 紧凑货币格式：窄列场景下按中文习惯压缩为「万 / 亿」，避免长数字被截断
// ¥1,110,800.00 → ¥111.08万 ；¥123,456,789.00 → ¥1.23亿 ；¥1,234.56 → ¥1,234.56（原样）
// 仅 CNY 用万/亿压缩（中文单位），其他货币退化为 fmt 避免语义偏差。
function fmtCompact(n, currency = 'CNY') {
    const cur = String(currency || 'CNY').toUpperCase();
    if (cur !== 'CNY') return fmt(n, cur);
    const v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    if (abs >= 1e8) return sign + '¥' + _getFmt('zh-CN').format(abs / 1e8) + '亿';
    if (abs >= 1e4) return sign + '¥' + _getFmt('zh-CN').format(abs / 1e4) + '万';
    return sign + '¥' + _getFmt('zh-CN').format(abs);
}

// 多币种 P2-2d：合计 breakdown 智能格式化
// 输入：breakdown { CNY: 1000, USD: 50 }
// 输出：
//   空 / 全零 → fmt(0, baseCurrency)
//   单货币 → 直接 fmt(value, currency)
//   多货币 + 主货币 == baseCurrency → 主值 + 括号附注其他货币明细（"¥1,000.00 ($50.00)"）
//   多货币 + 主货币 != baseCurrency 且 FxManager 可用 → 全部折算到 baseCurrency 显示
//   多货币 + 主货币 != baseCurrency 且无 FxManager → 降级主货币 + 附注
function fmtMix(breakdown, baseCurrency = 'CNY') {
    if (!breakdown || typeof breakdown !== 'object') return fmt(0, baseCurrency || 'CNY');
    const base = String(baseCurrency || 'CNY').toUpperCase();
    const entries = Object.entries(breakdown).filter(([, v]) => Math.abs(parseFloat(v) || 0) > 0.001);
    if (entries.length === 0) return fmt(0, base);
    if (entries.length === 1) {
        const [cur, val] = entries[0];
        return fmt(val, cur);
    }
    // 多货币：选主货币（amount 绝对值最大）
    const [primary, primaryVal] = entries.reduce((a, b) => Math.abs(parseFloat(b[1])) > Math.abs(parseFloat(a[1])) ? b : a);
    const fx = (typeof window !== 'undefined' && window.FxManager) ? window.FxManager : null;
    if (primary === base) {
        // 主货币 == base：主值 + 括号附注其他货币明细
        const others = entries.filter(([c]) => c !== primary).map(([c, v]) => fmt(v, c)).join(' + ');
        return fmt(primaryVal, primary) + (others ? ` (${others})` : '');
    }
    // 主货币 != base：有 fxManager → 折算到 base 显示
    if (fx && typeof fx.convert === 'function') {
        const baseSum = entries.reduce((sum, [c, v]) => {
            const num = parseFloat(v) || 0;
            return sum + (c === base ? num : (fx.convert(num, c, base) || 0));
        }, 0);
        const others = entries.filter(([c]) => c !== base).map(([c, v]) => fmt(v, c)).join(' + ');
        return fmt(baseSum, base) + (others ? ` (${others})` : '');
    }
    // 无 fxManager：降级主货币 + 附注其他
    const others = entries.filter(([c]) => c !== primary).map(([c, v]) => fmt(v, c)).join(' + ');
    return fmt(primaryVal, primary) + (others ? ` (${others})` : '');
}

// CSV 单元格转义：含逗号/引号/换行的字段用双引号包裹并转义内部引号
function csvCell(v) {
    const s = String(v == null ? '' : v);
    // CSV 公式注入防护：以 = + - @ Tab CR 开头时前缀单引号，避免被表格软件当作公式执行。
    const dangerous = /^[=+\-@\t\r]/;
    const safe = dangerous.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

// Blob → base64（不含 data:* 前缀），用于语音转写把录音文件发给后端
// 仅浏览器侧使用（依赖 FileReader），Node 测试时不挂
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('读取音频失败'));
        fr.onload = () => {
            const s = String(fr.result || '');
            // data:audio/webm;base64,XXXX → 取逗号之后
            const i = s.indexOf(',');
            resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        fr.readAsDataURL(blob);
    });
}

/**
 * 把 ISO8601 时间格式化为「刚刚 / 3 分钟前 / 2 小时前 / 3 天前 / YYYY-MM-DD」相对文案。
 * 用于 ai-advice / ai-rules 等页面的 generatedAt 展示。
 */
function formatRelativeTime(iso) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (isNaN(t)) return String(iso);
    const diffMs = Date.now() - t;
    if (diffMs < 0) {
        // 服务端时间略晚于客户端时钟，倒数 30 分钟内算"即将"
        const ahead = -diffMs;
        if (ahead < 60_000) return '即将';
        if (ahead < 3_600_000) return `约 ${Math.round(ahead / 60_000)} 分钟后`;
        if (ahead < 86_400_000) return `约 ${Math.round(ahead / 3_600_000)} 小时后`;
    }
    if (diffMs < 60_000) return '刚刚';
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)} 分钟前`;
    if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)} 小时前`;
    if (diffMs < 30 * 86_400_000) return `${Math.round(diffMs / 86_400_000)} 天前`;
    try { return new Date(t).toISOString().slice(0, 10); } catch (_) { return String(iso); }
}

// ==========================================
// 统一 API 调用（auth.js + app.js 共用）
// 支持 token 自动注入、401 触发登录层、silent 模式不弹 toast
// ==========================================
async function api(path, method = 'GET', body = null, opts = {}) {
    const { silent = false } = opts;
    const headers = { 'Content-Type': 'application/json' };
    const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('xin_token') : null;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    // 多账本：携带当前账本 ID（后端据此做数据隔离）
    const bid = (typeof localStorage !== 'undefined') ? localStorage.getItem('xin_book_id') : null;
    if (bid) headers['X-Book-Id'] = bid;

    const reqOpts = { method, headers };
    // GET/HEAD 规范禁止带 body；调用方常常把筛选参数塞进第 3 参（如 {limit:10}），
    // 这里主动忽略避免 TypeError: Request with GET/HEAD method cannot have body
    const upper = String(method || 'GET').toUpperCase();
    if (body && upper !== 'GET' && upper !== 'HEAD') reqOpts.body = JSON.stringify(body);

    try {
        const res = await fetch(`${(typeof window !== 'undefined' ? (window.XIN_API_BASE || '/api') : '/api')}${path}`, reqOpts);
        let data = null;
        try { data = await res.json(); } catch (e) { data = { success: res.ok, message: res.statusText || `HTTP ${res.status}` }; }

        if (res.status === 401) {
            // 未授权：通知登录层弹出
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('auth:unauthorized'));
            if (!silent && typeof showToast === 'function') showToast(data.message || '登录已过期', 'error');
            const err = new Error(data.message || '未授权');
            err.payload = data;
            err.status = res.status;
            throw err;
        }
        if (!data.success) {
            if (!silent && typeof showToast === 'function') showToast(data.message || '请求失败', 'error');
            const err = new Error(data.message || `HTTP ${res.status}`);
            err.payload = data;
            // 暴露 HTTP 状态码：调用方据此判定 409（状态冲突）/ 422（校验失败）等分支，
            // 避免退化成脆弱的错误文案字符串匹配
            err.status = res.status;
            throw err;
        }
        return data.data;
    } catch (err) {
        if (!silent && typeof showToast === 'function' && !err.payload) showToast(err.message || '网络错误', 'error');
        throw err;
    }
}

// 暴露到全局：浏览器中挂 window.api，Node 测试中挂 module.exports
if (typeof window !== 'undefined') {
    window.api = api;
    window.escapeHtml = escapeHtml;
    window.fmt = fmt;
    window.fmtMix = fmtMix;
    window.supportedCurrencies = _supportedCurrencies;
    window.csvCell = csvCell;
    window.blobToBase64 = blobToBase64;
    window.formatRelativeTime = formatRelativeTime;
    // 生产环境静默调试日志（console.log），保留 warn/error 用于真实错误。
    // 仅在本地/调试态（localhost 或 window.XIN_DEBUG=true）才打印，避免生产 console 噪声。
    // 注：utils.js 以经典脚本先于各模块执行，故此处覆盖对全应用 console.log 生效；
    // Node 测试环境（无 window）不走此分支，断言用 console 不受影响。
    if (!(window.XIN_DEBUG === true || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        console.log = function () {};
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, fmt, fmtMix, fmtCompact, csvCell, api, blobToBase64, formatRelativeTime, supportedCurrencies: _supportedCurrencies };
}
