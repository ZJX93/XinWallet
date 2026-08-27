/**
 * AI 智能分析页（web）—— 2026-08-27 合并 insight + advice
 * ----------------------------------------------------------------
 * 调用链：进入页面 → 先读 localStorage 缓存渲染（不发请求）→ 用户点右上角「刷新」才发请求
 *   POST /ai/advice 响应：{ advice, insights, generatedAt }（insight 已合并）
 *   - advice：三档优先级建议（high/medium/low），含 impact 量化
 *   - insights：三级观察型提醒（warning/info/tip），含 action 行动
 *
 * 设计要点：
 *   - 缓存：localStorage 持久化（key: xin_ai_advice / xin_ai_insights），刷新页面/重进不丢
 *   - 进入页面只渲染缓存，不自动调接口（避免每次都消耗 token）
 *   - 服务商未配置：友好引导到 ai-config 页
 *   - 首页 dashboard.js 也读这两个 key（快捷入口）
 */
const AIAdvice = {
    busy: false,
    _eventsBound: false,
    items: [],
    insights: [],
    generatedAt: '',
    lastError: '',
    // localStorage keys（首页 dashboard.js 也读这两个 key，所以命名稳定）
    _LS_KEY_ADVICE: 'xin_ai_advice',
    _LS_KEY_INSIGHTS: 'xin_ai_insights',
    _LS_KEY_GEN: 'xin_ai_advice_generated_at',

    _loadAdvice() { try { const v = localStorage.getItem(this._LS_KEY_ADVICE); return v ? JSON.parse(v) : []; } catch(e) { return []; } },
    _saveAdvice(arr) { try { localStorage.setItem(this._LS_KEY_ADVICE, JSON.stringify(arr || [])); } catch(e) {} },
    _loadInsights() { try { const v = localStorage.getItem(this._LS_KEY_INSIGHTS); return v ? JSON.parse(v) : []; } catch(e) { return []; } },
    _saveInsights(arr) { try { localStorage.setItem(this._LS_KEY_INSIGHTS, JSON.stringify(arr || [])); } catch(e) {} },

    init() {
        if (!document.getElementById('aiAdviceRefreshBtn')) return;
        this._bindEvents();
    },

    refresh() {
        if (document.getElementById('aiAdviceRefreshBtn') && !this._eventsBound) this._bindEvents();
        // 优先渲染缓存（不发请求）；只有首次进入且无缓存时才静默拉一次
        this.items = this._loadAdvice();
        this.insights = this._loadInsights();
        this.generatedAt = localStorage.getItem(this._LS_KEY_GEN) || '';
        this._render();
        if (!this.items.length && !this.insights.length) {
            this.load();
        }
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
            // ⛔ 铁律 1：r 可能是 {success,advice,...} 包装，或直接 {advice,...}，都不能信字段名盲读
            // ai-advice 页是 /ai/advice 直读（不开 api() 解包）。看 utils.js 的 api()：
            //   return res.ok ? await res.json() : { success:false, message }
            //   → 后端 success: true 时返回整个对象（含 success 字段）还是只返回 data？
            // 旧版 ai-advice.js 直接 r.advice（不开包装），说明这条调用走的是非包装 api。
            // 而 insight 端点是普通 api('/ai/insight', 'POST', body) → 自动解包为 res.data
            // 这里的 api('/ai/advice', 'POST', {}) 用的是 GET 路径的解包 → r 实际是 data 本体
            const advice = Array.isArray(r && r.advice) ? r.advice : [];
            const insights = Array.isArray(r && r.insights) ? r.insights : [];
            if (!advice.length && !insights.length) {
                this.lastError = (r && r.message) || 'AI 未返回有效内容，请稍后重试';
                if (/服务商|未配置|未激活/.test(this.lastError)) {
                    this._showProviderMissing();
                } else {
                    this._showError(this.lastError);
                }
                return;
            }
            this.items = advice;
            this.insights = insights;
            this.generatedAt = (r && (r.generatedAt || r.generated_at)) || new Date().toISOString();
            this._saveAdvice(advice);
            this._saveInsights(insights);
            try { localStorage.setItem(this._LS_KEY_GEN, this.generatedAt); } catch(e) {}
            this._render();
        } catch (e) {
            this.lastError = e.message || '网络异常';
            this._showError(this.lastError);
        } finally {
            this.busy = false;
            this._showLoading(false);
        }
    },

    _render() {
        const adviceList = document.getElementById('aiAdviceList');
        const insightList = document.getElementById('aiInsightList');
        const meta = document.getElementById('aiAdviceMeta');
        if (!adviceList) return;

        // 渲染洞察（观察型）
        if (insightList) {
            insightList.innerHTML = '';
            if (this.insights.length) {
                const lvLabel = { warning: '需重视', info: '关注', tip: '小建议' };
                const lvClass = { warning: 'lv-warning', info: 'lv-info', tip: 'lv-tip' };
                insightList.innerHTML = this.insights.map(i => `<div class="insight-item ${lvClass[i.level] || ''}">
                    <div class="insight-head"><span class="insight-title">🧠 ${escapeHtml(i.title || '洞察')}</span>${i.level ? `<span class="lv-badge ${lvClass[i.level]}">${lvLabel[i.level]}</span>` : ''}</div>
                    <div class="insight-desc">${escapeHtml(i.description || '')}</div>
                    ${i.action ? `<div class="insight-action">💡 ${escapeHtml(i.action)}</div>` : ''}
                </div>`).join('');
            } else {
                insightList.innerHTML = '<div class="empty-hint"><div class="empty-icon">🧠</div><p>暂无洞察</p></div>';
            }
        }

        // 渲染建议（可执行）
        adviceList.innerHTML = '';
        if (this.items.length) {
            for (const a of this.items) {
                adviceList.appendChild(this._renderAdviceCard(a));
            }
        } else {
            adviceList.innerHTML = `<div class="empty-state">
                <p class="empty-title">本月没有可执行的建议</p>
                <p class="empty-desc">记账样本不足，AI 暂时无法量化建议。多记几笔后再来看看</p>
            </div>`;
        }

        if (meta) {
            meta.innerHTML = this.generatedAt
                ? `生成于 ${formatRelativeTime(this.generatedAt)}`
                : '';
        }
    },

    _renderAdviceCard(a) {
        const card = document.createElement('div');
        const priority = String(a.priority || 'medium').toLowerCase();
        card.className = `glass-card ai-advice-card priority-${escapeHtml(priority)}`;
        const title = escapeHtml(a.title || '');
        const content = escapeHtml(a.content || '');
        const impact = escapeHtml(a.impact || '');
        card.innerHTML = `
            <div class="ai-advice-priority-tag">${escapeHtml(this._priorityLabel(priority))}</div>
            <h3 class="ai-advice-title">${title}</h3>
            <p class="ai-advice-content">${content}</p>
            ${impact ? `<p class="ai-advice-impact">💡 影响：${impact}</p>` : ''}
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
        const adviceList = document.getElementById('aiAdviceList');
        const insightList = document.getElementById('aiInsightList');
        if (insightList) insightList.innerHTML = '';
        if (!adviceList) return;
        adviceList.innerHTML = `<div class="empty-state">
            <p class="empty-title">⚠️ ${escapeHtml(msg)}</p>
            <p class="empty-desc">点击右上角刷新重试，或稍后再试</p>
        </div>`;
    },

    _showProviderMissing() {
        const adviceList = document.getElementById('aiAdviceList');
        const insightList = document.getElementById('aiInsightList');
        if (insightList) insightList.innerHTML = '';
        if (!adviceList) return;
        adviceList.innerHTML = `<div class="empty-state">
            <p class="empty-title">💡 请先配置对话服务商</p>
            <p class="empty-desc">AI 建议需要至少激活一个对话服务商（OpenAI/Claude/国产）</p>
            <button class="btn btn-primary" onclick="showPage('ai-config')">前往配置</button>
        </div>`;
    }
};

window.AIAdvice = AIAdvice;
export default AIAdvice;
