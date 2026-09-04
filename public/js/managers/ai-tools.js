/**
 * AI 运维工具管理（对应无消费者后端 API 的管理入口）
 * ----------------------------------------------------------------
 * 管理页面：ai-tools
 * 功能：系统状态、健康指标、功能开关、对话会话、AI 画像、财务模拟、API 调试
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
        document.getElementById('aiToolsApiSend')?.addEventListener('click', () => this._sendApi());
        document.getElementById('aiToolsApiMethod')?.addEventListener('change', () => {
            const body = document.getElementById('aiToolsApiBody');
            body.style.display = document.getElementById('aiToolsApiMethod').value === 'POST' ? '' : 'none';
        });
    },

    async refresh() {
        this.init();
        // 并行加载所有数据
        await Promise.all([
            this._loadStatus().catch(() => {}),
            this._loadMetrics().catch(() => {}),
            this._loadFeatures().catch(() => {}),
            this._loadConversations().catch(() => {}),
            this._loadProfile().catch(() => {}),
            this._loadCashflow().catch(() => {}),
        ]);
    },

    async _loadStatus() {
        const data = await this._req('/ai/v2/status');
        if (!data) return;
        const el = id => document.getElementById(id);
        el('aiToolsEventBus').textContent = data.event_bus
            ? `订阅者 ${data.event_bus.subscribers || 0} · 已处理 ${data.event_bus.processed || 0}`
            : 'N/A';
        el('aiToolsPendingFeedback').textContent = data.pending_feedback != null ? `${data.pending_feedback} 条` : 'N/A';
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

    async _loadConversations() {
        const data = await this._req('/ai/conversations');
        if (!data || !data.conversations) return;
        const convs = data.conversations.slice(0, 10);
        const el = document.getElementById('aiToolsConversations');
        if (convs.length === 0) {
            el.textContent = '暂无对话';
            return;
        }
        el.innerHTML = convs.map(c =>
            `<div style="padding:4px 0;border-bottom:1px solid var(--border-subtle)">` +
            `<span style="font-weight:var(--fw-medium)">${escapeHtml(c.title || '未命名')}</span>` +
            `<span style="color:var(--text-tertiary);font-size:12px;margin-left:8px">${c.model_used || ''} · ${c.message_count || 0} 条消息</span>` +
            `</div>`
        ).join('');
    },

    async _loadProfile() {
        const data = await this._req('/ai/profile');
        if (!data || !data.profile) return;
        const p = data.profile;
        document.getElementById('aiToolsProfile').innerHTML = Object.entries(p)
            .filter(([k]) => !['user_id', 'id', 'created_at', 'updated_at'].includes(k))
            .map(([k, v]) => {
                const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
                return `<span class="tag-badge">${k}: ${escapeHtml(val)}</span>`;
            })
            .join('') || 'N/A';
    },

    async _loadCashflow() {
        const data = await this._req('/ai/forecast/cashflow?months=3');
        if (!data) return;
        const el = document.getElementById('aiToolsCashflow');
        if (data.predicted) {
            el.innerHTML = `<span>预测未来 3 个月：${data.predicted.inflow ? '入 ¥' + Number(data.predicted.inflow).toFixed(0) : ''} ` +
                `${data.predicted.outflow ? '出 ¥' + Number(data.predicted.outflow).toFixed(0) : ''} ` +
                `${data.predicted.balance ? '余额 ¥' + Number(data.predicted.balance).toFixed(0) : ''}</span>`;
        } else {
            el.textContent = '现金流数据不足';
        }
    },

    async _runCleanup() {
        try {
            const btn = document.getElementById('aiToolsRunCleanup');
            btn.disabled = true;
            btn.textContent = '清理中...';
            const data = await this._req('/ai/v2/cleanup', 'POST');
            showToast(data?.message || '清理完成', 'success');
        } catch (err) {
            showToast('清理失败: ' + err.message, 'error');
        } finally {
            const btn = document.getElementById('aiToolsRunCleanup');
            btn.disabled = false;
            btn.textContent = '运行清理';
        }
    },

    async _emitTestEvent() {
        try {
            const data = await this._req('/ai/events/emit', 'POST', {
                event_type: 'transaction.created',
                payload: { test: true }
            });
            if (data.ok) {
                showToast('测试事件已触发', 'success');
                this._loadStatus();
            }
        } catch (err) {
            showToast('触发事件失败: ' + err.message, 'error');
        }
    },

    async _sendApi() {
        const endpoint = document.getElementById('aiToolsApiEndpoint').value.trim();
        const method = document.getElementById('aiToolsApiMethod').value;
        const bodyText = document.getElementById('aiToolsApiBody').value.trim();
        const responseEl = document.getElementById('aiToolsApiResponse');
        const sendBtn = document.getElementById('aiToolsApiSend');

        if (!endpoint) { showToast('请输入 API 端点路径', 'warning'); return; }
        sendBtn.disabled = true;
        responseEl.textContent = '请求中...';

        try {
            let body = null;
            if (method === 'POST' && bodyText) {
                try { body = JSON.parse(bodyText); } catch (e) { showToast('JSON 格式错误', 'error'); sendBtn.disabled = false; return; }
            }
            const data = await this._req(endpoint, method, body);
            responseEl.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            responseEl.textContent = '请求失败: ' + (err.message || '未知错误');
        } finally {
            sendBtn.disabled = false;
        }
    }
};

export default AITools;