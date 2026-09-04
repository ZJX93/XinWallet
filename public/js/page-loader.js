/* ============================================
   鑫钱包 · 页面片段按需加载器
   ============================================
   设计目标：
   - index.html 内联主要常用页面（dashboard, accounts, transfers, transactions）
   - 重量级页面（investments, ai-recognition, reports, ai-advice 等）改为按需 fetch
   - 减少首屏 DOM 节点，提升首屏加载速度

   使用方法：
     1. 在 index.html 把要抽离的 <section> 替换为:
        <section class="page" id="page-investments" data-lazy="pages/investments.html"></section>
     2. 切换页面时，PageLoader 会自动检测并按需加载
*/

const PageLoader = {
    cache: new Map(),    // 已加载的页面缓存
    loading: new Map(),  // 正在加载的页面（去重）

    /**
     * 检查并加载页面片段（如果需要）
     * @param {string} pageId - 页面元素 id，如 'page-investments'
     * @returns {Promise<boolean>} 是否加载成功
     */
    async ensureLoaded(pageId) {
        const el = document.getElementById(pageId);
        if (!el) return false;
        const src = el.dataset.lazy;
        if (!src) return true;  // 非懒加载，无需处理

        // 已注入过 → 不再重复注入（避免销毁已绑定的事件监听器）
        if (el.dataset.loaded === 'true') return true;

        // 已有缓存 → 注入并标记
        if (this.cache.has(src)) {
            el.innerHTML = this.cache.get(src);
            el.dataset.loaded = 'true';
            return true;
        }

        // 正在加载 → 复用 in-flight Promise
        if (this.loading.has(src)) {
            await this.loading.get(src);
            if (this.cache.has(src) && el.dataset.loaded !== 'true') {
                el.innerHTML = this.cache.get(src);
                el.dataset.loaded = 'true';
            }
            return this.cache.has(src);
        }

        // 首次加载：fetch 原始 HTML
        let rawHtml;
        const p = this.fetchPage(src).then(html => {
            rawHtml = html;
            this.loading.delete(src);
        }).catch(err => {
            console.error(`[PageLoader] Failed to load ${src}:`, err);
            this.loading.delete(src);
        });
        this.loading.set(src, p);
        await p;

        if (rawHtml) {
            // 剥离外层的 <section> 标签：page fragment 本身是完整的 <section class="page" ...>，
            // 但 index.html 中已经有一个包装 section（通过 data-lazy 属性指定）。
            // 容忍前置 HTML 注释（ai-*.html 顶部带说明性注释）—— 否则 section 正则失配，
            // 会把整个外层 section 注入到现有 section 里造成嵌套双 section / 双 id，主体空白。
            const inner = rawHtml
                .replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/i, '')
                .replace(/^\s*<section[^>]*>/i, '')
                .replace(/<\/section>\s*$/i, '');
            this.cache.set(src, inner);
            // 并发防护：若在 await 期间已被其他调用方注入（dataset.loaded 已置位），
            // 不再重复写入 innerHTML，否则会重置已注入节点的 DOM、造成事件监听器丢失 / 嵌套双 section
            if (el.dataset.loaded !== 'true') {
                el.innerHTML = inner;
                el.dataset.loaded = 'true';
            }
            return true;
        }
        return false;
    },

    /**
     * 真正发起 fetch
     */
    async fetchPage(src) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    },

    /**
     * 预加载：进入特定页面时预加载关联页面
     */
    async prefetch(pageIds) {
        return Promise.all(pageIds.map(id => this.ensureLoaded(id)));
    }
};

// 暴露到全局
if (typeof window !== 'undefined') {
    window.PageLoader = PageLoader;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageLoader;
}
