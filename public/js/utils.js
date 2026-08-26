/* ============================================
   鑫钱包 · 前端通用工具（纯函数，可在 Node 中单元测试）
   ============================================ */

// HTML 转义：防止用户可控字段（账户名、备注、标签名等）在 innerHTML 中造成存储型 XSS
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// 货币格式化（统一：使用 Intl.NumberFormat，兼容大量数字）
// 负数标准格式：-¥X.XX（负号在货币符号前），例如 -74.14 → "-¥74.14"
const _moneyFmt = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(n) {
    const v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    return (v < 0 ? '-' : '') + '¥' + _moneyFmt.format(Math.abs(v));
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
    if (body) reqOpts.body = JSON.stringify(body);

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
    window.csvCell = csvCell;
    window.blobToBase64 = blobToBase64;
    window.formatRelativeTime = formatRelativeTime;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, fmt, csvCell, api, blobToBase64, formatRelativeTime };
}
