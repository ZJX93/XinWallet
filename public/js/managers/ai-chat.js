/**
 * AI 助手对话框（全站悬浮气泡 FAB）
 * ----------------------------------------------------------------
 * 2026-09 重构：原识别页内嵌卡片抽出为右下角悬浮气泡，所有页面可用。
 * 调用 POST /ai/chat，维护前端消息历史，渲染对话气泡。
 * 端点返回 { reply, transactions }（success 包装），AI 仅做只读咨询 + 改删已存在交易。
 *
 * DOM（注入在 body 末尾，layout 之外，跨页面常驻）：
 *   #aiFabBtn        悬浮按钮（右下角圆点）
 *   #aiFabPanel      浮层对话框容器（默认隐藏）
 *   #aiFabMessages   消息列表
 *   #aiFabInput      输入框
 *   #aiFabSend       发送按钮
 *   #aiFabClose      关闭按钮
 */
const AIChat = {
    _initialized: false,
    _open: false,
    messages: [],

    init() {
        const btn = document.getElementById('aiFabBtn');
        const panel = document.getElementById('aiFabPanel');
        if (!btn || !panel || this._initialized) return;
        this._initialized = true;

        // FAB 按钮 → 切换浮层
        btn.addEventListener('click', () => this.toggle());
        document.getElementById('aiFabClose')?.addEventListener('click', () => this.close());

        // 输入框 + 发送按钮
        const send = document.getElementById('aiFabSend');
        send?.addEventListener('click', () => this._send());
        const input = document.getElementById('aiFabInput');
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
        });

        // 快捷 chips
        document.querySelectorAll('.ai-fab-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                if (input) { input.value = chip.dataset.q || ''; input.focus(); }
            });
        });
    },

    refresh() { this.init(); },

    toggle() { this._open ? this.close() : this.open(); },

    open() {
        const panel = document.getElementById('aiFabPanel');
        const btn = document.getElementById('aiFabBtn');
        if (!panel) return;
        panel.removeAttribute('hidden');
        panel.classList.add('ai-fab-panel-open');
        btn?.classList.add('ai-fab-btn-active');
        this._open = true;
        // 自动聚焦输入框
        setTimeout(() => document.getElementById('aiFabInput')?.focus(), 60);
    },

    close() {
        const panel = document.getElementById('aiFabPanel');
        const btn = document.getElementById('aiFabBtn');
        if (!panel) return;
        panel.classList.remove('ai-fab-panel-open');
        btn?.classList.remove('ai-fab-btn-active');
        // 等 CSS transition 走完再 hidden（避免内容瞬间消失）
        setTimeout(() => panel.setAttribute('hidden', ''), 200);
        this._open = false;
    },

    async _send() {
        const input = document.getElementById('aiFabInput');
        const text = (input && input.value || '').trim();
        if (!text) return;
        if (input) input.value = '';
        this.messages.push({ role: 'user', content: text });
        this._render();
        this._setLoading(true);
        try {
            const data = await api('/ai/chat', 'POST', { messages: this.messages.slice(-12) }, { silent: true });
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
        const box = document.getElementById('aiFabMessages');
        if (!box) return;
        box.innerHTML = this.messages.map(m => {
            const cls = 'ai-fab-bubble ai-fab-' + m.role;
            return `<div class="${cls}">${escapeHtml(m.content)}</div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    },

    _setLoading(on) {
        const btn = document.getElementById('aiFabSend');
        if (btn) btn.disabled = on;
    }
};

export default AIChat;