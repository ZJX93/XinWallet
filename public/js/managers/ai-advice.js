/**
 * AI 财务建议页（web）
 * ----------------------------------------------------------------
 * 调用链：页面 load → POST /ai/advice → 渲染三档优先级建议
 *
 * 与 insight 的关系：
 *   - insight 是「本月发生了什么」观察型输出（3-5 条结构化提醒）
 *   - advice 是「下个月怎么做」建议型输出（3-5 条可执行建议，含 impact 量化）
 *   两端都需已激活服务商，否则服务端 400「请先在服务商配置中激活至少一个对话服务商」
 *
 * 设计要点（参考 server/routes/ai.js:163-272 的 /advice handler）：
 *   - priority 三态 high/medium/low，对应红/蓝/灰配色（与 insight 三级配色一致）
 *   - title/impact/action 三段（服务端固定 schema），前端只渲染不擅自改写文案
 *   - generatedAt 是 ISO8601，需要格式化展示
 *   - 加载失败 + 「服务商未配置」关键词 → 引导去 ai-config 页（用 showToast 而非跳转）
 */
const AIAdvice = {
    busy: false,
    _eventsBound: false,
    items: [],
    generatedAt: '',
    lastError: '',

    init() {
        if (!document.getElementById('aiAdviceRefreshBtn')) return;
        this._bindEvents();
    },

    refresh() {
        if (document.getElementById('aiAdviceRefreshBtn') && !this._eventsBound) this._bindEvents();
        this.load();
    },

    _bindEvents() {
        this._eventsBound = true;
        const btn = document.getElementById('aiAdviceRefreshBtn');
        if (btn) btn.addEventListener('click', () => this.load());
    },

    async load() {
        if (this.busy) return;
        this.busy = true;
        this._showLoading(true);
        this.lastError = '';
        try {
            const r = await api('/ai/advice', 'POST', {});
            if (r && r.success && r.data) {
                this.items = Array.isArray(r.data.advice) ? r.data.advice : [];
                this.generatedAt = r.data.generatedAt || r.data.generated_at || '';
                this._render();
            } else {
                this.lastError = (r && r.message) || '获取建议失败';
                if (/服务商|未配置|未激活/.test(this.lastError)) {
                    this._showProviderMissing();
                } else {
                    this._showError(this.lastError);
                }
            }
        } catch (e) {
            this.lastError = e.message || '网络异常';
            this._showError(this.lastError);
        } finally {
            this.busy = false;
            this._showLoading(false);
        }
    },

    _render() {
        const list = document.getElementById('aiAdviceList');
        const meta = document.getElementById('aiAdviceMeta');
        if (!list) return;
        list.innerHTML = '';
        if (!this.items.length) {
            list.innerHTML = `<div class="empty-state">
                <p class="empty-title">本月没有可执行的建议</p>
                <p class="empty-desc">记账样本不足，AI 暂时无法量化建议。多记几笔后再来看看</p>
            </div>`;
        } else {
            for (const a of this.items) {
                list.appendChild(this._renderCard(a));
            }
        }
        if (meta) {
            meta.innerHTML = this.generatedAt
                ? `生成于 ${formatRelativeTime(this.generatedAt)}`
                : '';
        }
    },

    _renderCard(a) {
        const card = document.createElement('div');
        const priority = String(a.priority || 'medium').toLowerCase();
        card.className = `glass-card ai-advice-card priority-${escapeHtml(priority)}`;
        const title = escapeHtml(a.title || '');
        const content = escapeHtml(a.content || '');
        const impact = escapeHtml(a.impact || '');
        const action = escapeHtml(a.action || '');
        card.innerHTML = `
            <div class="ai-advice-priority-tag">${escapeHtml(this._priorityLabel(priority))}</div>
            <h3 class="ai-advice-title">${title}</h3>
            <p class="ai-advice-content">${content}</p>
            ${impact ? `<p class="ai-advice-impact">💡 影响：${impact}</p>` : ''}
            ${action ? `<p class="ai-advice-action">▶ 行动：${action}</p>` : ''}
        `;
        return card;
    },

    _priorityLabel(p) {
        return p === 'high' ? '高优先' : p === 'medium' ? '中优先' : '低优先';
    },

    _showLoading(on) {
        const ld = document.getElementById('aiAdviceLoading');
        if (ld) ld.style.display = on ? 'block' : 'none';
    },

    _showError(msg) {
        const list = document.getElementById('aiAdviceList');
        if (!list) return;
        list.innerHTML = `<div class="empty-state">
            <p class="empty-title">⚠️ ${escapeHtml(msg)}</p>
            <p class="empty-desc">点击右上角刷新重试，或稍后再试</p>
        </div>`;
    },

    _showProviderMissing() {
        const list = document.getElementById('aiAdviceList');
        if (!list) return;
        list.innerHTML = `<div class="empty-state">
            <p class="empty-title">💡 请先配置对话服务商</p>
            <p class="empty-desc">AI 建议需要至少激活一个对话服务商（OpenAI/Claude/国产）</p>
            <button class="btn btn-primary" onclick="showPage('ai-config')">前往配置</button>
        </div>`;
    }
};

window.AIAdvice = AIAdvice;
export default AIAdvice;
