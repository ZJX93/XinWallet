/**
 * AI 规则管理页（web）
 * ----------------------------------------------------------------
 * 调用链：
 *   - GET /ai/rules?status=&limit=&offset= → 列表 + 总数 + 服务端阈值（schema 演进中不强类型化）
 *   - POST /ai/rules body {match_key, rule_type, target_*} → 新建
 *   - POST /ai/rules/:id/disable body {reason} → 禁用（不可逆，不复活样本）
 *   - POST /ai/rules/:id/enable → 启用（回到 candidate 重攒证据）
 *   - GET /ai/rules/:id/evidence?limit= → 证据流水
 *
 * 设计要点：
 *   - 状态过滤用顶部 chip（全部 / 已生效 verified / 高可信 trusted / 候选 candidate / 已禁用 disabled）
 *   - 行内操作：启用 ⇄ 禁用 switch + 查看证据（弹窗/抽屉） + 删除（仅已禁用）
 *   - disable 不可逆：弹窗二次确认 + 红字警告文案（"关联样本不会复活"）
 *   - threshold 从服务端拿，不在前端硬编码 —— v0.2 验收铁律
 *   - 用户可手动新增规则：弹窗输入 match_key + rule_type + target_id（任一即可）
 */
const AIRules = {
    busy: false,
    _eventsBound: false,
    rules: [],
    total: 0,
    thresholds: {},
    errorMsg: '',
    toast: '',
    activeFilter: null,     // null = 全部
    pendingId: -1,          // 正在处理的 rule id
    showAddDialog: false,
    evidenceOpenForId: -1,  // 抽屉打开的规则 id
    evidenceItems: [],

    init() {
        if (!document.getElementById('aiRulesRefreshBtn')) return;
        this._bindEvents();
    },

    refresh() {
        if (document.getElementById('aiRulesRefreshBtn') && !this._eventsBound) this._bindEvents();
        this.load();
    },

    _bindEvents() {
        this._eventsBound = true;
        const refresh = document.getElementById('aiRulesRefreshBtn');
        if (refresh) refresh.addEventListener('click', () => this.load());

        document.querySelectorAll('[data-ai-rules-filter]').forEach(chip => {
            chip.addEventListener('click', () => {
                const v = chip.getAttribute('data-ai-rules-filter');
                this.activeFilter = (v === 'all' || !v) ? null : v;
                this._render();
                document.querySelectorAll('[data-ai-rules-filter]').forEach(c => c.classList.toggle('active', c.getAttribute('data-ai-rules-filter') === (v || 'all')));
            });
        });

        const add = document.getElementById('aiRulesAddBtn');
        if (add) add.addEventListener('click', () => this._openAddDialog());
        const closeAdd = document.getElementById('aiRulesAddCloseBtn');
        if (closeAdd) closeAdd.addEventListener('click', () => this._closeAddDialog());
        const submitAdd = document.getElementById('aiRulesAddSubmitBtn');
        if (submitAdd) submitAdd.addEventListener('click', () => this._submitNewRule());

        const closeEv = document.getElementById('aiRulesEvidenceCloseBtn');
        if (closeEv) closeEv.addEventListener('click', () => this._closeEvidenceDrawer());

        // 委托事件：每个 row 内的按钮
        const list = document.getElementById('aiRulesList');
        if (list) list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-ai-rule-action]');
            if (!btn) return;
            const id = parseInt(btn.getAttribute('data-id'), 10);
            const action = btn.getAttribute('data-ai-rule-action');
            if (action === 'disable') this.disable(id);
            else if (action === 'enable') this.enable(id);
            else if (action === 'evidence') this.openEvidence(id);
            else if (action === 'delete') this.deleteRule(id);
        });
    },

    async load() {
        if (this.busy) return;
        this.busy = true;
        this._showLoading(true);
        this.errorMsg = '';
        try {
            const r = await api('/ai/rules', 'GET');
            if (r && Array.isArray(r.rules)) {
                this.rules = r.rules;
                this.total = r.total || this.rules.length;
                this.thresholds = r.thresholds || {};
                this._render();
            } else {
                this.errorMsg = (r && r.message) || '加载规则失败';
                this._renderError();
            }
        } catch (e) {
            this.errorMsg = e.message || '网络异常';
            this._renderError();
        } finally {
            this.busy = false;
            this._showLoading(false);
        }
    },

    async disable(id, reason = 'user_disabled') {
        if (this.pendingId !== -1) return;
        if (!confirm('禁用后该规则不会复活，关联样本也不会恢复。\n\n确定要禁用吗？')) return;
        this.pendingId = id;
        try {
            const r = await api(`/ai/rules/${id}/disable`, 'POST', { reason });
            if (r && r.success) { this.toast = '已禁用'; }
            else this.errorMsg = (r && r.message) || '禁用失败';
        } catch (e) {
            this.errorMsg = e.message || '网络异常';
        } finally {
            this.pendingId = -1;
            await this.load();
        }
    },

    async enable(id) {
        if (this.pendingId !== -1) return;
        this.pendingId = id;
        try {
            const r = await api(`/ai/rules/${id}/enable`, 'POST', {});
            if (r && r.success) { this.toast = '已启用，从候选重新攒证据'; }
            else this.errorMsg = (r && r.message) || '启用失败';
        } catch (e) {
            this.errorMsg = e.message || '网络异常';
        } finally {
            this.pendingId = -1;
            await this.load();
        }
    },

    async deleteRule(id) {
        if (this.pendingId !== -1) return;
        if (!confirm('确定要永久删除这条规则吗？删除后不可恢复。')) return;
        this.pendingId = id;
        try {
            const r = await api(`/ai/rules/${id}`, 'DELETE', {});
            if (r && r.success) { this.toast = '规则已删除'; }
            else this.errorMsg = (r && r.message) || '删除失败';
        } catch (e) {
            this.errorMsg = e.message || '网络异常';
        } finally {
            this.pendingId = -1;
            await this.load();
        }
    },

    async openEvidence(id) {
        this.evidenceOpenForId = id;
        this.evidenceItems = [];
        this._openEvidenceDrawer();
        try {
            const r = await api(`/ai/rules/${id}/evidence`, 'GET');
            if (r && Array.isArray(r.evidence)) {
                this.evidenceItems = r.evidence;
            } else {
                this.evidenceItems = [];
                this.errorMsg = (r && r.message) || '加载证据失败';
            }
        } catch (e) {
            this.evidenceItems = [];
            this.errorMsg = e.message || '网络异常';
        } finally {
            this._renderEvidenceDrawer();
        }
    },

    _openEvidenceDrawer() {
        const d = document.getElementById('aiRulesEvidenceDrawer');
        if (d) d.style.display = 'flex';
    },

    _closeEvidenceDrawer() {
        const d = document.getElementById('aiRulesEvidenceDrawer');
        if (d) d.style.display = 'none';
        this.evidenceOpenForId = -1;
        this.evidenceItems = [];
    },

    _renderEvidenceDrawer() {
        const body = document.getElementById('aiRulesEvidenceBody');
        if (!body) return;
        if (!this.evidenceItems.length) {
            body.innerHTML = '<p class="empty-desc">暂无证据</p>';
            return;
        }
        body.innerHTML = this.evidenceItems.map(ev => {
            const occurred = ev.occurred_at || ev.created_at || '';
            const action = String(ev.user_action || ev.action || '');
            const actionClass = ['confirmed', 'corrected', 'rejected'].includes(action) ? action : 'other';
            const amount = typeof ev.amount === 'number' ? ev.amount.toFixed(2) : (ev.amount || '0.00');
            const merchant = escapeHtml(ev.merchant || ev.merchant_key || '无商家');
            const cat = escapeHtml(ev.category_name || ev.category || '未知类目');
            const note = ev.note ? `<div class="ai-rules-ev-note">备注：${escapeHtml(ev.note)}</div>` : '';
            return `<div class="ai-rules-ev-row">
                <div class="ai-rules-ev-head">
                    <span class="ai-rules-ev-date">${escapeHtml(formatRelativeTime(occurred) || occurred)}</span>
                    <span class="ai-rules-ev-action action-${actionClass}">${escapeHtml(this._actionLabel(action))}</span>
                </div>
                <div class="ai-rules-ev-body">
                    ${merchant} → ${cat} · ¥${amount}
                </div>
                ${note}
            </div>`;
        }).join('');
    },

    _actionLabel(a) {
        return a === 'confirmed' ? '确认' : a === 'corrected' ? '修正' : a === 'rejected' ? '拒绝' : a;
    },

    _openAddDialog() {
        this.showAddDialog = true;
        const d = document.getElementById('aiRulesAddDialog');
        if (d) d.style.display = 'flex';
        // 首次显示时清空
        ['matchKey', 'ruleType', 'targetCategoryId', 'targetAccountId', 'targetType'].forEach(id => {
            const el = document.getElementById('aiRulesAdd' + id);
            if (el) el.value = '';
        });
    },

    _closeAddDialog() {
        this.showAddDialog = false;
        const d = document.getElementById('aiRulesAddDialog');
        if (d) d.style.display = 'none';
    },

    async _submitNewRule() {
        const matchKey = (document.getElementById('aiRulesAddmatchKey') || {}).value || '';
        const ruleType = (document.getElementById('aiRulesAddruleType') || {}).value || 'merchant_category';
        const targetCategoryId = parseInt((document.getElementById('aiRulesAddtargetCategoryId') || {}).value || '', 10) || null;
        const targetType = (document.getElementById('aiRulesAddtargetType') || {}).value || null;

        if (!matchKey.trim()) { this.errorMsg = 'match_key 不能为空'; this._renderError(); return; }
        if (!targetCategoryId && !targetType) {
            this.errorMsg = '至少需要一个 target（类目/收支方向）';
            this._renderError();
            return;
        }

        const payload = { match_key: matchKey.trim(), rule_type: ruleType };
        if (targetCategoryId) payload.target_category_id = targetCategoryId;
        if (targetType) payload.target_type = targetType;

        try {
            const r = await api('/ai/rules', 'POST', payload);
            if (r && r.success) {
                this.toast = '规则已新增';
                this._closeAddDialog();
                await this.load();
            } else {
                this.errorMsg = (r && r.message) || '新增失败';
                this._renderError();
            }
        } catch (e) {
            this.errorMsg = e.message || '网络异常';
            this._renderError();
        }
    },

    _showLoading(on) {
        const ld = document.getElementById('aiRulesLoading');
        if (ld) ld.style.display = on ? 'block' : 'none';
    },

    _render() {
        const list = document.getElementById('aiRulesList');
        const meta = document.getElementById('aiRulesMeta');
        if (!list) return;

        // 阈值展示
        if (meta) {
            const v = this.thresholds.verified || {};
            const tScore = v.score != null ? v.score : 8;
            const tAcc = v.accuracy != null ? Math.round(v.accuracy * 100) + '%' : '60%';
            const tSample = v.min_sample != null ? v.min_sample : 2;
            meta.innerHTML = `共 ${this.total} 条规则 · verified 阈值: score≥${tScore} · accuracy≥${tAcc} · sample≥${tSample}`;
        }

        list.innerHTML = '';

        const filtered = this.activeFilter
            ? this.rules.filter(r => String(r.status) === this.activeFilter)
            : this.rules;

        if (!filtered.length) {
            list.innerHTML = `<div class="empty-state">
                <p class="empty-title">${this.activeFilter ? '此状态下没有规则' : '还没有 AI 规则'}</p>
                <p class="empty-desc">${this.activeFilter ? '切换其他过滤查看' : '记账几次后 AI 会自动学习，或手动新增规则'}</p>
            </div>`;
            return;
        }

        for (const r of filtered) {
            list.appendChild(this._renderRow(r));
        }
        this._showToastIfAny();
        this._showErrorIfAny();
    },

    _renderRow(r) {
        const card = document.createElement('div');
        card.className = 'glass-card ai-rules-card';
        const status = String(r.status || '').toLowerCase();
        const isPending = this.pendingId === r.id;
        const statusLabel = this._statusLabel(status);
        const isDisabled = status === 'disabled';

        card.innerHTML = `
            <div class="ai-rules-head">
                <div class="ai-rules-key">${escapeHtml(r.match_key || '')}</div>
                <span class="ai-rules-status status-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="ai-rules-meta">
                <span>类型 ${escapeHtml(r.rule_type || 'merchant_category')}</span>
                <span>Score ${Number(r.evidence_score != null ? r.evidence_score : (r.score || 0)).toFixed(1)}</span>
                <span>Accuracy ${Math.round(Number(r.accuracy_rate != null ? r.accuracy_rate : (r.accuracy || 0)) * 100)}%</span>
                <span>样本 ${Number(r.sample_count || 0)}</span>
            </div>
            ${r.target_category_id ? `<div class="ai-rules-target">目标类目 #${r.target_category_id}</div>` : ''}
            ${r.target_account_id ? `<div class="ai-rules-target">目标账户 #${r.target_account_id}</div>` : ''}
            ${r.target_type ? `<div class="ai-rules-target">目标类型 ${escapeHtml(r.target_type)}</div>` : ''}
            <div class="ai-rules-actions">
                <button class="btn btn-ghost btn-ai" data-ai-rule-action="evidence" data-id="${r.id}">查看证据</button>
                ${isDisabled
                    ? `<button class="btn btn-ghost btn-ai" data-ai-rule-action="enable" data-id="${r.id}" ${isPending ? 'disabled' : ''}>${isPending ? '处理中...' : '启用'}</button>
                        <button class="btn btn-danger-outline btn-ai" data-ai-rule-action="delete" data-id="${r.id}" ${isPending ? 'disabled' : ''}>删除</button>`
                    : `<button class="btn btn-danger btn-ai" data-ai-rule-action="disable" data-id="${r.id}" ${isPending ? 'disabled' : ''}>${isPending ? '处理中...' : '禁用'}</button>`
                }
            </div>
        `;
        return card;
    },

    _statusLabel(s) {
        if (s === 'trusted') return '高可信';
        if (s === 'verified') return '已生效';
        if (s === 'candidate') return '候选';
        if (s === 'disabled') return '已禁用';
        return s;
    },

    _renderError() {
        if (!this.errorMsg) return;
        const bar = document.getElementById('aiRulesErrorBar');
        if (bar) {
            bar.textContent = '⚠️ ' + this.errorMsg;
            bar.style.display = 'block';
            setTimeout(() => { bar.style.display = 'none'; this.errorMsg = ''; }, 4000);
        }
    },

    _showToastIfAny() {
        if (!this.toast) return;
        if (typeof showToast === 'function') showToast(this.toast, 'success');
        this.toast = '';
    },

    _showErrorIfAny() { this._renderError(); }
};

window.AIRules = AIRules;
export default AIRules;
