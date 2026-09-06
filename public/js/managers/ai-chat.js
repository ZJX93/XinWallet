/**
 * AI 助手对话框（识别页内嵌）
 * ------------------------------------------------
 * 调用 POST /ai/chat，维护前端消息历史，渲染对话气泡。
 * 端点返回 { reply, transactions }（success 包装），AI 仅做只读咨询 + 改删已存在交易。
 */
const AIChat = {
    _initialized: false,
    messages: [],

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

    init() {
        const sendBtn = document.getElementById('aiChatSend');
        if (!sendBtn || this._initialized) return;
        this._initialized = true;
        sendBtn.addEventListener('click', () => this._send());
        const input = document.getElementById('aiChatInput');
        if (input) input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
        });
        document.querySelectorAll('.ai-chat-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                if (input) { input.value = chip.dataset.q || ''; input.focus(); }
            });
        });
    },

    refresh() {
        this.init();
    },

    async _send() {
        const input = document.getElementById('aiChatInput');
        const text = (input && input.value || '').trim();
        if (!text) return;
        if (input) input.value = '';
        this.messages.push({ role: 'user', content: text });
        this._render();
        this._setLoading(true);
        try {
            const data = await this._req('/ai/chat', 'POST', { messages: this.messages.slice(-12) });
            const reply = (data && data.reply) || tt('aiChat.fallback.empty', '（暂时没有回复）');
            this.messages.push({ role: 'assistant', content: reply });
            if (data && Array.isArray(data.transactions) && data.transactions.length) {
                const summary = data.transactions.map(t => {
                    const verb = t.action === 'deleted' ? tt('aiChat.action.deleted', '删除') : tt('aiChat.action.updated', '更新');
                    const amt = t.amount != null ? tt('aiChat.summary.amt', '¥{n}').replace('{n}', Number(t.amount).toFixed(2)) : '';
                    return `${verb}：${t.categoryName || ''}${t.accountName || ''} ${amt}`;
                }).join('；');
                this.messages.push({ role: 'system', content: summary });
            }
        } catch (e) {
            this.messages.push({ role: 'assistant', content: tt('aiChat.fallback.error', '出错了：{msg}').replace('{msg}', e.message || e) });
        } finally {
            this._setLoading(false);
            this._render();
        }
    },

    _render() {
        const box = document.getElementById('aiChatMessages');
        if (!box) return;
        box.innerHTML = this.messages.map(m => {
            const cls = 'ai-chat-bubble ai-chat-' + m.role;
            return `<div class="${cls}">${escapeHtml(m.content)}</div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    },

    _setLoading(on) {
        const btn = document.getElementById('aiChatSend');
        if (btn) btn.disabled = on;
    }
};

export default AIChat;
