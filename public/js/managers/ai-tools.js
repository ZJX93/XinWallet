/**
 * AI 系统状态管理（原运维页瘦身：仅系统级监控/运维）
 * ----------------------------------------------------------------
 * 管理页面：ai-status（顶栏齿轮进入）
 * 功能：系统状态、健康指标、功能开关、运维操作（清理/触发事件）
 * 对话会话 / AI 画像 / 现金流预测已迁入「洞察」页
 * ----------------------------------------------------------------
 */
const AITools = {
    _initialized: false,

    init() {
        if (this._initialized) return;
        const el = document.getElementById('aiToolsRefreshBtn');
        if (!el) return;
        this._initialized = true;
        el.addEventListener('click', () => this.refresh());
        document.getElementById('aiToolsRunCleanup')?.addEventListener('click', () => this._runCleanup());
        document.getElementById('aiToolsEmitEvent')?.addEventListener('click', () => this._emitTestEvent());
    },

    async refresh() {
        this.init();
        // 并行加载所有系统级数据
        await Promise.all([
            this._loadStatus().catch(() => {}),
            this._loadMetrics().catch(() => {}),
            this._loadFeatures().catch(() => {}),
        ]);
    },

    async _loadStatus() {
        const data = await api('/ai/v2/status', 'GET', null, { silent: true });
        if (!data) return;
        const el = id => document.getElementById(id);
        el('aiToolsEventBus').textContent = data.event_bus
            ? tt('aiTools.status.subscribers', '订阅者 {subs} · 已处理 {proc}')
                .replace('{subs}', String(data.event_bus.subscribers || 0))
                .replace('{proc}', String(data.event_bus.processed || 0))
            : 'N/A';
        el('aiToolsPendingFeedback').textContent = data.pending_feedback != null
            ? tt('aiTools.status.pending', '{n} 条').replace('{n}', String(data.pending_feedback))
            : 'N/A';
        el('aiToolsVersion').textContent = data.version || 'N/A';
    },

    async _loadMetrics() {
        const data = await api('/ai/v2/metrics', 'GET', null, { silent: true });
        if (!data) return;
        const el = id => document.getElementById(id);
        if (data.health) {
            const h = data.health;
            el('aiToolsHealth').innerHTML = Object.entries(h)
                .map(([k, v]) => `<span class="tag-badge">${k}: ${JSON.stringify(v)}</span>`)
                .join('') || 'N/A';
        }
        if (data.cost) {
            const c = data.cost;
            el('aiToolsCost').innerHTML = Object.entries(c)
                .map(([k, v]) => `<span class="tag-badge">${k}: ${typeof v === 'number' ? v.toFixed(2) : JSON.stringify(v)}</span>`)
                .join('') || 'N/A';
        }
    },

    async _loadFeatures() {
        const data = await api('/ai/v2/features', 'GET', null, { silent: true });
        if (!data || !data.features) return;
        document.getElementById('aiToolsFeatures').innerHTML = Object.entries(data.features)
            .map(([k, v]) => `<span class="tag-badge">${k}: ${v ? '✅' : '❌'}</span>`)
            .join('') || 'N/A';
    },

    async _runCleanup() {
        try {
            const btn = document.getElementById('aiToolsRunCleanup');
            btn.disabled = true;
            btn.textContent = tt('aiTools.cleanup.running', '清理中...');
            const data = await api('/ai/v2/cleanup', 'POST', null, { silent: true });
            showToast(data?.message || tt('aiTools.cleanup.done', '清理完成'), 'success');
        } catch (err) {
            showToast(tt('aiTools.cleanup.fail', '清理失败: {msg}').replace('{msg}', err.message || ''), 'error');
        } finally {
            const btn = document.getElementById('aiToolsRunCleanup');
            btn.disabled = false;
            btn.textContent = tt('aiTools.cleanup.runBtn', '运行清理');
        }
    },

    async _emitTestEvent() {
        try {
            // 该端点是 `{ ok, event }` 契约，api() 已在统一出口归一：ok:false 直接抛错，
            // 走到这里必然成功，无须再判 data.ok
            await api('/ai/events/emit', 'POST', {
                event_type: 'transaction.created',
                payload: { test: true }
            }, { silent: true });
            showToast(tt('aiTools.event.testDone', '测试事件已触发'), 'success');
            this._loadStatus();
        } catch (err) {
            showToast(tt('aiTools.event.testFail', '触发事件失败: {msg}').replace('{msg}', err.message || ''), 'error');
        }
    }
};

export default AITools;
