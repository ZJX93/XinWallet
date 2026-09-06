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
            const data = await api('/ai/forecast/cashflow?months=3', 'GET', null, { silent: true });
            if (data && data.predicted) {
                const p = data.predicted;
                const cell = (label, val) => `<div><span class="ai-tools-card-header">${escapeHtml(label)}</span><div class="ai-cashflow-val">¥${(Number(val) || 0).toFixed(0)}</div></div>`;
                el.innerHTML = `<div class="ai-cashflow-grid">` +
                    cell(tt('aiInsights.cashflow.inflow', '未来 3 月流入'), p.inflow) +
                    cell(tt('aiInsights.cashflow.outflow', '未来 3 月流出'), p.outflow) +
                    (p.balance ? cell(tt('aiInsights.cashflow.balance', '期末余额'), p.balance) : '') +
                    `</div>`;
            } else {
                el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.cashflow.empty', '现金流数据不足，先记录一段时间账单吧'))}</p>`;
            }
        } catch (e) {
            el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.cashflow.err', '加载失败：{msg}')).replace('{msg}', e.message)}</p>`;
        }
    },

    async _loadProfile() {
        const el = document.getElementById('aiProfileBody');
        if (!el) return;
        try {
            const data = await api('/ai/profile', 'GET', null, { silent: true });
            const p = (data && data.profile) ? data.profile : data;
            if (!p || Object.keys(p).length === 0) {
                el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.profile.empty', '暂无画像数据，多用 AI 记账后会逐渐学习'))}</p>`;
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
            el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.profile.err', '加载失败：{msg}')).replace('{msg}', e.message)}</p>`;
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
            const data = await api('/ai/advice', 'POST', {}, { silent: true });
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
