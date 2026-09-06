/* ============================================
   鑫钱包 · 前端通用工具（纯函数，可在 Node 中单元测试）
   ============================================ */

// tt(key, fallback)：带兜底的翻译取值。
// utils.js 在 Node 单测中也会被 require，且加载顺序上可能早于 i18n.js，
// 所以这里不能直接依赖全局 I18N —— 缺失时返回 fallback（中文原文），保证零崩溃。
// ⛔ 别改成直接 I18N.t()：Node 测试环境无 window，会 ReferenceError。
function tt(key, fallback) {
    if (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') {
        const v = window.I18N.t(key);
        // t() 找不到 key 时会原样返回 key 本身，此时退回 fallback 更友好
        if (v && v !== key) return v;
    }
    return fallback !== undefined ? fallback : key;
}

// 统一确认框：文案走字典，避免各 manager 里散落硬编码中文 confirm()
// 用法：if (!confirmT('modal.confirmDelete', '确定删除？此操作不可恢复。')) return;
function confirmT(key, fallback) {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
    return window.confirm(tt(key, fallback));
}

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

// 紧凑货币格式：窄列场景下压缩数量级，避免长数字被截断
// 中文界面按「万 / 亿」：¥1,110,800.00 → ¥111.08万 ；¥123,456,789.00 → ¥1.23亿
// 英文界面按「K / M / B」：¥1,110,800.00 → ¥1.11M（万/亿对英文读者无意义）
// 仅 CNY 做压缩，其他货币退化为 fmt 避免语义偏差。
function fmtCompact(n, currency = 'CNY') {
    const cur = String(currency || 'CNY').toUpperCase();
    if (cur !== 'CNY') return fmt(n, cur);
    const v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    // 语言判定：无 window（Node 单测）时按中文处理，保持既有断言
    const isZh = !(typeof window !== 'undefined' && window.I18N && window.I18N.isZh && !window.I18N.isZh());
    if (isZh) {
        if (abs >= 1e8) return sign + '¥' + _getFmt('zh-CN').format(abs / 1e8) + '亿';
        if (abs >= 1e4) return sign + '¥' + _getFmt('zh-CN').format(abs / 1e4) + '万';
        return sign + '¥' + _getFmt('zh-CN').format(abs);
    }
    if (abs >= 1e9) return sign + '¥' + _getFmt('en-US').format(abs / 1e9) + 'B';
    if (abs >= 1e6) return sign + '¥' + _getFmt('en-US').format(abs / 1e6) + 'M';
    if (abs >= 1e3) return sign + '¥' + _getFmt('en-US').format(abs / 1e3) + 'K';
    return sign + '¥' + _getFmt('en-US').format(abs);
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
        fr.onerror = () => reject(new Error(tt('common.err.audioRead', '读取音频失败')));
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
        if (ahead < 60_000) return tt('time.soon', '即将');
        if (ahead < 3_600_000) return tt('time.inMinutes', '约 {n} 分钟后').replace('{n}', Math.round(ahead / 60_000));
        if (ahead < 86_400_000) return tt('time.inHours', '约 {n} 小时后').replace('{n}', Math.round(ahead / 3_600_000));
    }
    if (diffMs < 60_000) return tt('time.justNow', '刚刚');
    if (diffMs < 3_600_000) return tt('time.minutesAgo', '{n} 分钟前').replace('{n}', Math.round(diffMs / 60_000));
    if (diffMs < 86_400_000) return tt('time.hoursAgo', '{n} 小时前').replace('{n}', Math.round(diffMs / 3_600_000));
    if (diffMs < 30 * 86_400_000) return tt('time.daysAgo', '{n} 天前').replace('{n}', Math.round(diffMs / 86_400_000));
    try { return new Date(t).toISOString().slice(0, 10); } catch (_) { return String(iso); }
}

// ==========================================
// 统一 API 调用（auth.js + app.js 共用）
// 支持 token 自动注入、401 触发登录层、silent 模式不弹 toast
// ==========================================
/* ============================================================
   预置分类多语言
   系统预置分类 / 理财类型在库里存的是中文名，但带稳定 code
   （E0100 餐饮 / I0101 工资薪水 / T0101 银行转账 / V0101 银行存款）。
   英文态下把服务端返回的中文名换成字典里的 cat.<code>，用户无需逐个改名。

   设计取舍：
   - 仅非中文态生效：中文态保持服务端原名，尊重用户对系统分类的改名。
   - code 优先：命中 /^[EITV]\d{4}$/ 且字典有值时才改，用户自建分类无 code，不受影响。
   - 名称兜底：报表/图表聚合结果常只有 { name:'餐饮' } 而无 code，
     此时按「中文名 → 英文名」精确匹配替换（映射由 zh-CN / en-US 两份字典实时生成，
     不额外维护一份硬编码表）。
   ============================================================ */
const SYS_CODE_RE = /^[EITV]\d{4}$/;
// 允许按名称兜底替换的字段：避免把备注、商家名等恰好同名的自由文本也翻掉
const SYS_NAME_KEYS = new Set(['name', 'category', 'category_name', 'categoryName', 'cat', 'label', 'labels']);
let _sysMaps = null;

/**
 * 由 zh-CN / en-US 两份字典实时生成双向映射，不额外维护硬编码表。
 * 双向的意义：切回中文时能把英文名还原，无需重新请求服务端。
 */
function sysNameMaps() {
    if (_sysMaps) return _sysMaps;
    const zh2en = new Map();
    const en2zh = new Map();
    const dicts = (typeof window !== 'undefined') ? window.I18N_DICT : null;
    const zh = dicts && dicts['zh-CN'];
    const en = dicts && dicts['en-US'];
    if (zh && en) {
        for (const k of Object.keys(zh)) {
            if (k.indexOf('cat.') !== 0) continue;
            const z = zh[k];
            const e = en[k];
            if (typeof z === 'string' && typeof e === 'string' && z !== e) {
                zh2en.set(z, e);
                en2zh.set(e, z);
            }
        }
    }
    _sysMaps = { zh2en, en2zh };
    return _sysMaps;
}

function localizeSystemNames(node, depth) {
    if (typeof window === 'undefined' || !window.I18N || !window.I18N_DICT) return node;
    return localizeNode(node, depth || 0);
}

/**
 * 按「中文名 ⇄ 英文名」精确匹配替换，未命中一律原样保留 —— 因此：
 *   - 用户改过名的系统分类不会被字典覆盖；
 *   - 用户自建分类恰好同名时也会跟着走，符合直觉。
 * 非枚举的 __orig 之类字段一概不写，避免污染回传给服务端的 payload。
 */
function localizeNode(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return node;
    const maps = sysNameMaps();
    const wantEn = (typeof window.I18N.isZh === 'function') ? !window.I18N.isZh() : false;
    const map = wantEn ? maps.zh2en : maps.en2zh;
    if (!map.size) return node;

    const swap = (s) => (typeof s === 'string' && map.has(s)) ? map.get(s) : s;

    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const v = node[i];
            if (typeof v === 'string') node[i] = swap(v);
            else if (v && typeof v === 'object') localizeNode(v, depth + 1);
        }
        return node;
    }

    for (const k of Object.keys(node)) {
        const v = node[k];
        if (v === null || v === undefined) continue;

        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
                const item = v[i];
                // 图表 labels 类字符串数组；其余数组只下钻对象
                if (typeof item === 'string') { if (SYS_NAME_KEYS.has(k)) v[i] = swap(item); }
                else if (item && typeof item === 'object') localizeNode(item, depth + 1);
            }
            continue;
        }

        if (typeof v !== 'object') {
            if (typeof v === 'string' && SYS_NAME_KEYS.has(k)) node[k] = swap(v);
            continue;
        }

        // 分类 / 理财类型对象：带预置 code 的按 code 归属，否则按字段名兜底
        if (typeof v.name === 'string') {
            const isPreset = typeof v.code === 'string' && SYS_CODE_RE.test(v.code);
            if (isPreset || SYS_NAME_KEYS.has(k)) v.name = swap(v.name);
        }
        localizeNode(v, depth + 1);
    }
    return node;
}

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
            if (!silent && typeof showToast === 'function') showToast(data.message || tt('toast.sessionExpired', '登录已过期'), 'error');
            const err = new Error(data.message || tt('toast.unauthorized', '未授权'));
            err.payload = data;
            err.status = res.status;
            throw err;
        }
        if (data.success === undefined && typeof data.ok === 'boolean') {
            // AI v2 运维/会话/画像/预测类端点是历史契约 `{ ok: true, ... }`（无 success/data 包装）。
            // 在统一出口做契约归一，免得每个 AI manager 各自复制一份 fetch 封装
            // （ai-tools / ai-chat / ai-insights 曾各有一份逐字重复的 _req）。
            if (!data.ok) {
                const msg = data.error || data.message || `HTTP ${res.status}`;
                if (!silent && typeof showToast === 'function') showToast(msg, 'error');
                const err = new Error(msg);
                err.payload = data;
                err.status = res.status;
                throw err;
            }
            return localizeSystemNames(data, 0);
        }
        if (!data.success) {
            if (!silent && typeof showToast === 'function') showToast(data.message || tt('toast.requestFailed', '请求失败'), 'error');
            const err = new Error(data.message || `HTTP ${res.status}`);
            err.payload = data;
            // 暴露 HTTP 状态码：调用方据此判定 409（状态冲突）/ 422（校验失败）等分支，
            // 避免退化成脆弱的错误文案字符串匹配
            err.status = res.status;
            throw err;
        }
        // 统一出口做预置分类多语言：所有业务数据都经 api() 返回，
        // 无需在几十处渲染点逐个改（新增接口也自动生效）。
        return localizeSystemNames(data.data, 0);
    } catch (err) {
        if (!silent && typeof showToast === 'function' && !err.payload) showToast(err.message || tt('toast.networkError', '网络错误'), 'error');
        throw err;
    }
}

// 暴露到全局：浏览器中挂 window.api，Node 测试中挂 module.exports
if (typeof window !== 'undefined') {
    window.api = api;
    window.tt = tt;
    window.localizeSystemNames = localizeSystemNames;
    window.confirmT = confirmT;
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
    module.exports = { escapeHtml, fmt, fmtMix, fmtCompact, csvCell, api, blobToBase64, formatRelativeTime, tt, confirmT, localizeSystemNames, supportedCurrencies: _supportedCurrencies };
}
