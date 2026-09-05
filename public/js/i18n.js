/* ============================================
   鑫钱包 · 轻量国际化（i18n）框架
   适用：纯前端 vanilla JS，无构建依赖。
   - 字典以 <script> 注入方式加载 public/locales/<lang>.js（挂到 window.I18N_DICT，
     规避静态托管下 fetch JSON 的 CORS / file:// 限制，且加载顺序可控）。
   - HTML 声明式：data-i18n="key" 设文本，data-i18n-ph="key" 设 placeholder。
   - JS 命令式：I18N.t('key', {name}) 取值（支持 {name} 插值）。
   - 语言优先级：显式存储 > 调用方注入(preferences.language) > 浏览器 navigator.language。
   - 持久化：localStorage 即时生效；可选 persistPref 回调写入后端 preferences。
   ============================================ */
(function (global) {
    'use strict';

    const SUPPORTED = ['zh-CN', 'en-US'];
    const STORAGE_KEY = 'xinwallet.lang';
    let currentLang = 'zh-CN';
    let dict = {};
    let loaded = false;

    function detectLang() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && SUPPORTED.includes(stored)) return stored;
        } catch (e) { /* localStorage 不可用时忽略 */ }
        const nav = (global.navigator && global.navigator.language) || 'zh-CN';
        return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
    }

    function loadDict(lang) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = `locales/${lang}.js?t=${Date.now()}`;
            el.onload = () => resolve((global.I18N_DICT && global.I18N_DICT[lang]) || {});
            el.onerror = () => reject(new Error('i18n load failed: ' + lang));
            document.head.appendChild(el);
        });
    }

    function t(key, params) {
        const str = (dict[key] !== undefined) ? dict[key] : key;
        if (params && typeof str === 'string') {
            return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
        }
        return str;
    }

    function applyDOM(root) {
        root = root || document;
        root.querySelectorAll('[data-i18n]').forEach((n) => {
            const key = n.getAttribute('data-i18n');
            if (key) n.textContent = t(key);
        });
        root.querySelectorAll('[data-i18n-ph]').forEach((n) => {
            const key = n.getAttribute('data-i18n-ph');
            if (key) n.setAttribute('placeholder', t(key));
        });
    }

    async function setLang(lang, opts) {
        if (!SUPPORTED.includes(lang)) lang = 'zh-CN';
        currentLang = lang;
        try {
            dict = await loadDict(lang);
        } catch (e) {
            console.warn('[i18n] 加载字典失败，回退中文', e);
            try { dict = await loadDict('zh-CN'); } catch (_) { dict = {}; }
        }
        loaded = true;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
        if (opts && typeof opts.persistPref === 'function') {
            try { await opts.persistPref(lang); } catch (e) { /* 后端写入失败不阻断前端 */ }
        }
        applyDOM();
        document.documentElement.lang = lang;
        if (typeof global.dispatchEvent === 'function') {
            global.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
        }
        return lang;
    }

    async function init(opts) {
        opts = opts || {};
        currentLang = (opts.lang && SUPPORTED.includes(opts.lang)) ? opts.lang : detectLang();
        await setLang(currentLang, opts);
        return currentLang;
    }

    global.I18N = {
        SUPPORTED,
        init,
        setLang,
        t,
        applyDOM,
        get lang() { return currentLang; },
        get loaded() { return loaded; },
        isZh: () => currentLang.startsWith('zh'),
    };
})(window);
