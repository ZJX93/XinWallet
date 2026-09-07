/**
 * AI 助手对话框（全站悬浮气泡 FAB）
 * ----------------------------------------------------------------
 * 2026-09 重构：原识别页内嵌卡片抽出为右下角悬浮气泡，所有页面可用。
 * 「发送」按钮调用 POST /ai/chat，维护前端消息历史，渲染对话气泡。
 * 端点返回 { reply, transactions }（success 包装），AI 仅做只读咨询 + 改删已存在交易。
 * 2026-09 扩：AI 助手对话框支持「一句话记账」——输入框单入口自动分流：
 *   优先 POST /ai/transactions/parse 识别记账，识别不出（422）回落 POST /ai/chat 问答，
 *   对齐安卓 AI 记账页 sendText(preferParse=true)。识别成功则切到智能记账确认区（v0.2 原则：必经确认）。
 *
 * DOM（注入在 body 末尾，layout 之外，跨页面常驻）：
 *   #aiFabBtn        悬浮按钮（右下角圆点）
 *   #aiFabPanel      浮层对话框容器（默认隐藏）
 *   #aiFabMessages   消息列表
 *   #aiFabInput      输入框
 *   #aiFabSend       发送按钮（单入口：parse 优先，422 回落 chat）
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

        // 输入框 + 发送按钮（单入口：先识别记账、失败回落对话，对齐安卓 AI 记账页）
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

    // 单入口（对齐安卓 sendText(preferParse=true)）：
    // 一句话文本优先走 /ai/transactions/parse 识别记账；识别不出（422）回落 /ai/chat 问答。
    async _send() {
        const input = document.getElementById('aiFabInput');
        const text = (input && input.value || '').trim();
        if (!text) return;
        if (input) input.value = '';
        this.messages.push({ role: 'user', content: text });
        this._render();
        this._setLoading(true);
        try {
            await this._sendRecord(text);
        } finally {
            this._setLoading(false);
            this._render();
        }
    },

    async _sendChat() {
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
        }
    },

    // 一句话文本优先走 /ai/transactions/parse（对齐安卓 sendText(preferParse=true)）：
    //   - 识别成功 ⇒ 切到 ai-recognition 页，复用 AISmartEntry._loadExternal() 进确认区
    //     （v0.2 原则：AI 不经用户确认绝不落账）
    //   - 422 /「未能从文本中识别」⇒ 回落 /ai/chat 保留咨询能力
    //   - 其他错误（网络/鉴权）⇒ 直接暴露给用户
    async _sendRecord(text) {
        let parsed;
        try {
            const defAcc = (cache.accounts || [])[0];
            const context = { platform: 'web' };
            if (defAcc) context.account_id = defAcc.id;
            context.date = fmtDate(new Date());

            parsed = await api('/ai/transactions/parse', 'POST', { text, context, source: 'chat' }, { silent: true });
        } catch (err) {
            // 后端 422「未能从文本中识别」等识别失败：保留用户原文，回落到对话路径
            this.messages.push({ role: 'system', content: tt('aiChat.record.fallback', '未识别为记账，已转为普通对话') });
            await this._sendChat();
            return;
        }

        if (!parsed || !parsed.prediction_id || !Array.isArray(parsed.transactions) || !parsed.transactions.length) {
            this.messages.push({ role: 'system', content: tt('aiChat.record.empty', '未能识别为交易，已转为普通对话') });
            await this._sendChat();
            return;
        }

        // 切到 ai-recognition 页（确认区在那里）；切页 + 灌入确认区需要等 PageLoader 注入 DOM
        if (typeof window.getCurrentPage === 'function' && window.getCurrentPage() !== 'ai-recognition') {
            if (typeof window.switchPage === 'function') window.switchPage('ai-recognition');
            await this._waitFor('#aiSmartConfirm', 2000);
        }

        if (window.AISmartEntry && typeof window.AISmartEntry._loadExternal === 'function') {
            await window.AISmartEntry._loadExternal(parsed, { emptyHint: tt('aiChat.record.empty', '未能识别为交易') });
            document.getElementById('aiSmartConfirm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.messages.push({ role: 'system', content: tt('aiChat.record.okHint', '已转入智能记账确认区，请核对后提交') });
            this.close();
            showToast(tt('aiChat.record.okToast', '已识别为记账，请在确认区核对后落账'), 'success');
        } else {
            // 智能记账模块未加载（极少见）→ 退回 chat 路径兑底
            this.messages.push({ role: 'system', content: tt('aiChat.record.noModule', '智能记账模块未加载，已转为普通对话') });
            await this._sendChat();
        }
    },

    // 等待 PageLoader 注入指定选择器（最多 timeoutMs，超时放行）
    _waitFor(selector, timeoutMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                if (document.querySelector(selector)) return resolve(true);
                if (Date.now() - start >= timeoutMs) return resolve(false);
                setTimeout(tick, 100);
            };
            tick();
        });
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