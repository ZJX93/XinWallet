/**
 * AI 洞察（原「AI 建议」+「学习统计」合并页）
 *
 * page-ai-insights 内有 Tab 栏 + 两个懒加载子容器：
 *   #page-ai-advice   data-lazy="pages/ai-advice.html"
 *   #page-ai-learning data-lazy="pages/ai-learning.html"
 *
 * Tab 切换 → PageLoader.ensureLoaded 注入子页片段 → 转发 refresh 给原
 * AIAdvice / AILearning。复用原页面 HTML 与 Manager，不复制实现，避免
 * 双份逻辑漂移（例如日期秒级规则只在一处维护）。
 */
const AIInsights = {
    activeTab: 'advice',
    _tabsBound: false,

    init() {
        if (!document.getElementById('aiInsightsTabs') || this._tabsBound) return;
        this._bindTabs();
    },

    refresh() {
        if (!document.getElementById('aiInsightsTabs')) return;
        if (!this._tabsBound) this._bindTabs();
        this._activate(this.activeTab, true);
    },

    _bindTabs() {
        this._tabsBound = true;
        document.querySelectorAll('#aiInsightsTabs .ai-insights-tab').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.activeTab = btn.dataset.tab;
                this._activate(this.activeTab, true);
            });
        });
    },

    /**
     * 激活某个 Tab
     * @param {string} tab 'advice' | 'learning'
     * @param {boolean} forceRefresh 切换时强制刷新子页数据（保证数据新鲜）
     */
    async _activate(tab, forceRefresh) {
        // 1) Tab 高亮与 aria
        document.querySelectorAll('#aiInsightsTabs .ai-insights-tab').forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        // 2) 面板显隐
        const show = (id, on) => {
            const el = document.getElementById(id);
            if (el) el.style.display = on ? '' : 'none';
        };
        show('page-ai-advice', tab === 'advice');
        show('page-ai-learning', tab === 'learning');

        // 3) 懒加载子页片段（PageLoader 自带缓存，不会重复注入）
        const pageId = tab === 'advice' ? 'page-ai-advice' : 'page-ai-learning';
        if (window.PageLoader) await window.PageLoader.ensureLoaded(pageId);

        // 4) 转发刷新给原 Manager（补绑事件 + 拉取数据）
        const m = window[tab === 'advice' ? 'AIAdvice' : 'AILearning'];
        if (m && typeof m.refresh === 'function' && forceRefresh) {
            await m.refresh();
        }
    },
};

export default AIInsights;
