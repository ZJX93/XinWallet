/**
 * AI 洞察（统一聚合「看账」入口）
 *
 * page-ai-insights 内有 Tab 栏 + 五个子容器：
 *   #page-ai-advice     data-lazy="pages/ai-advice.html"    → AIAdvice
 *   #page-ai-learning   data-lazy="pages/ai-learning.html"  → AILearning
 *   #page-ai-cashflow   内联，由本 Manager 直接拉 /ai/forecast/cashflow
 *   #page-ai-profile     内联，由本 Manager 直接拉 /ai/profile
 *   #page-ai-evaluation  data-lazy="pages/ai-evaluation.html" → AIEvaluation
 *
 * Tab 切换 → PageLoader 注入懒加载子页（建议/学习/评测）或直连内联面板（现金流/画像）
 *   → 转发 refresh 给原 Manager / 本 Manager 自拉。
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
        this._loadAlerts();
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
     * AI v2 类端点返回 `{ ok: true, ... }`，与全局 api() 的 `{ success, data }` 不同。
     * 这里单独走一层轻封装，避免 data.success 为 undefined 误判失败。
     */
    async _req(path, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('xin_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const bid = localStorage.getItem('xin_book_id');
        if (bid) headers['X-Book-Id'] = bid;
        const opts = { method, headers };
        if (body && method !== 'GET') opts.body = JSON.stringify(body);
        const res = await window.fetch(`${window.XIN_API_BASE || '/api'}${path}`, opts);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
        if (data && data.success === true && data.data !== undefined) return data.data;
        return data;
    },

    /**
     * 激活某个 Tab
     * @param {string} tab 'advice' | 'learning' | 'cashflow' | 'profile' | 'evaluation'
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
        show('page-ai-cashflow', tab === 'cashflow');
        show('page-ai-profile', tab === 'profile');
        show('page-ai-evaluation', tab === 'evaluation');

        // 3) 懒加载子页片段（PageLoader 自带缓存，不会重复注入）
        const pageMap = {
            advice: 'page-ai-advice',
            learning: 'page-ai-learning',
            cashflow: 'page-ai-cashflow',
            profile: 'page-ai-profile',
            evaluation: 'page-ai-evaluation',
        };
        const pageId = pageMap[tab];
        if (window.PageLoader && pageId) await window.PageLoader.ensureLoaded(pageId);

        // 4) 转发刷新给原 Manager / 本 Manager 自拉
        const mgrMap = { advice: 'AIAdvice', learning: 'AILearning', evaluation: 'AIEvaluation' };
        const selfMap = { cashflow: '_loadCashflow', profile: '_loadProfile' };
        if (forceRefresh) {
            const mgr = window[mgrMap[tab]];
            if (mgr && typeof mgr.refresh === 'function') {
                await mgr.refresh();
            } else if (selfMap[tab] && typeof this[selfMap[tab]] === 'function') {
                await this[selfMap[tab]]();
            }
        }
    },

    async _loadCashflow() {
        const el = document.getElementById('aiCashflowBody');
        if (!el) return;
        try {
            const data = await this._req('/ai/forecast/cashflow?months=3');
            if (data && data.predicted) {
                const p = data.predicted;
                const cell = (label, val) => `<div><span class="ai-tools-card-header">${label}</span><div class="ai-cashflow-val">¥${(Number(val) || 0).toFixed(0)}</div></div>`;
                el.innerHTML = `<div class="ai-cashflow-grid">` +
                    cell('未来 3 月流入', p.inflow) +
                    cell('未来 3 月流出', p.outflow) +
                    (p.balance ? cell('期末余额', p.balance) : '') +
                    `</div>`;
            } else {
                el.innerHTML = '<p class="card-desc">现金流数据不足，先记录一段时间账单吧</p>';
            }
        } catch (e) {
            el.innerHTML = '<p class="card-desc">加载失败：' + escapeHtml(e.message) + '</p>';
        }
    },

    async _loadProfile() {
        const el = document.getElementById('aiProfileBody');
        if (!el) return;
        try {
            const data = await this._req('/ai/profile');
            const p = (data && data.profile) ? data.profile : data;
            if (!p || Object.keys(p).length === 0) {
                el.innerHTML = '<p class="card-desc">暂无画像数据，多用 AI 记账后会逐渐学习</p>';
                return;
            }
            el.innerHTML = Object.entries(p)
                .filter(([k]) => !['user_id', 'id', 'created_at', 'updated_at'].includes(k))
                .map(([k, v]) => {
                    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
                    return `<span class="tag-badge">${escapeHtml(k)}: ${escapeHtml(val)}</span>`;
                })
                .join('') || 'N/A';
        } catch (e) {
            el.innerHTML = '<p class="card-desc">加载失败：' + escapeHtml(e.message) + '</p>';
        }
    },

    /**
     * 主动告警卡片：聚合 /ai/advice 返回的 insights 中 warning/danger/error 级，
     * 让用户在「看账」入口第一时间看到风险（超支、逾期、储蓄滞后等）。
     */
    async _loadAlerts() {
        const el = document.getElementById('aiInsightsAlerts');
        if (!el) return;
        try {
            const data = await this._req('/ai/advice', 'POST', {});
            const ins = (data && data.insights) || [];
            const alerts = ins.filter(i => i.level === 'warning' || i.level === 'danger' || i.level === 'error');
            if (!alerts.length) { el.style.display = 'none'; return; }
            el.style.display = '';
            el.innerHTML = alerts.map(a =>
                `<div class="ai-alert ai-alert-${a.level}"><span class="ai-alert-dot"></span><div><div class="ai-alert-title">${escapeHtml(a.title || '')}</div><div class="ai-alert-desc">${escapeHtml(a.description || '')}</div></div></div>`
            ).join('');
        } catch (e) {
            el.style.display = 'none';
        }
    },
};

export default AIInsights;
