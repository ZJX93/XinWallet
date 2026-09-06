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

    /**
     * AI v2 运维/会话/画像/模拟类端点返回的是 `{ ok: true, ... }`（历史契约），
     * 与全局 api() 期望的 `{ success, data }` 不同 —— 直接用 api() 会因
     * data.success 为 undefined 而误判失败抛错。故这里单独走一层轻封装。
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
        // 兼容两种契约：{ ok, ...} 与 { success, data }
        if (data && data.success === true && data.data !== undefined) return data.data;
        return data;
    },

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
        const data = await this._req('/ai/v2/status');
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
        const data = await this._req('/ai/v2/metrics');
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
        const data = await this._req('/ai/v2/features');
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
            const data = await this._req('/ai/v2/cleanup', 'POST');
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
            const data = await this._req('/ai/events/emit', 'POST', {
                event_type: 'transaction.created',
                payload: { test: true }
            });
            if (data.ok) {
                showToast(tt('aiTools.event.testDone', '测试事件已触发'), 'success');
                this._loadStatus();
            }
        } catch (err) {
            showToast(tt('aiTools.event.testFail', '触发事件失败: {msg}').replace('{msg}', err.message || ''), 'error');
        }
    }
};

export default AITools;
