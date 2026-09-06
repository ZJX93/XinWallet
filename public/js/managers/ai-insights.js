/**
 * AI 洞察（2026-09 整体重构）
 *
 * 由「Tab 切换（AI 建议 / 现金流预测）」改为单页连续整合：
 *   现金流预测快照 + 主动告警 + 消费洞察 + 财务建议 一屏展示。
 *
 * 职责分工：
 *   - 现金流预测：本 Manager 直接拉取 /ai/forecast/cashflow，渲染到 #aiCashflowBody
 *   - 主动告警：聚合 /ai/advice 中 warning/danger/error 级洞察，渲染到 #aiInsightsAlerts
 *   - 消费洞察 / 财务建议：复用 AIAdvice 管理器的渲染（DOM id 保持不变）
 *
 * 刷新策略：
 *   - 进入页面 refresh()：渲染 AIAdvice 本地缓存（无缓存才静默拉一次），后台拉现金流与告警
 *   - 点击「刷新」按钮 regenerate()：强制重新生成建议（AIAdvice.load）+ 重拉现金流与告警
 */
const AIInsights = {
    _bound: false,

    init() {
        const btn = document.getElementById('aiInsightsRefreshBtn');
        if (!btn || this._bound) return;
        this._bound = true;
        btn.addEventListener('click', () => this.regenerate());
    },

    refresh() {
        if (document.getElementById('aiInsightsRefreshBtn') && !this._bound) this.init();
        // AIAdvice.refresh() 内部：渲染缓存 → 无缓存才 load（不发重复请求）
        return Promise.all([
            this._loadCashflow(),
            this._loadAlerts(),
            window.AIAdvice ? window.AIAdvice.refresh() : Promise.resolve(),
        ]);
    },

    /** 点击刷新按钮：强制重新生成 */
    async regenerate() {
        const btn = document.getElementById('aiInsightsRefreshBtn');
        if (btn) btn.disabled = true;
        try {
            await Promise.all([
                this._loadCashflow(),
                this._loadAlerts(),
                window.AIAdvice ? window.AIAdvice.load() : Promise.resolve(),
            ]);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _loadCashflow() {
        const el = document.getElementById('aiCashflowBody');
        if (!el) return;
        try {
            const data = await api('/ai/forecast/cashflow?months=3', 'GET', null, { silent: true });
            if (data && data.predicted) {
                const p = data.predicted;
                const cell = (label, val) => `<div class="ai-cashflow-item"><span class="ai-cashflow-label">${escapeHtml(label)}</span><div class="ai-cashflow-val">¥${(Number(val) || 0).toFixed(0)}</div></div>`;
                el.innerHTML = '' +
                    cell(tt('aiInsights.cashflow.inflow', '未来 3 月流入'), p.inflow) +
                    cell(tt('aiInsights.cashflow.outflow', '未来 3 月流出'), p.outflow) +
                    (p.balance != null ? cell(tt('aiInsights.cashflow.balance', '期末余额'), p.balance) : '');
            } else {
                el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.cashflow.empty', '现金流数据不足，先记录一段时间账单吧'))}</p>`;
            }
        } catch (e) {
            el.innerHTML = `<p class="card-desc">${escapeHtml(tt('aiInsights.cashflow.err', '加载失败：{msg}')).replace('{msg}', e.message)}</p>`;
        }
    },

    /**
     * 主动告警卡片：聚合 /ai/advice 返回的 insights 中 warning/danger/error 级，
     * 让用户一屏看到风险（超支、逾期、储蓄滞后等）。
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