/**
 * AI 运维管理（原 AI 系统状态改名，从顶栏齿轮迁到 AI 实验室侧栏）
 * ----------------------------------------------------------------
 * 管理页面：ai-status（AI 实验室侧栏 → 运维）
 * 功能：
 *   - 系统状态、健康指标、功能开关、运维操作（清理/触发事件）
 *   - 学习统计（2026-09 迁入）：复用 AILearning 类，DOM 内嵌避免再创建独立 page
 *   - 画像设置（2026-09 迁入）：直接 PATCH /ai/profile，无独立 Manager
 *
 * 2026-09 前：对话会话 / 现金流预测 / 学习统计 / 画像均分散在「洞察」页或独立页面。
 * 现在统一收纳到本页，让「洞察」只保留 AI 建议 + 现金流预测两个核心 tab。
 * 2026-09 改名：从顶栏齿轮入口迁到 AI 实验室侧栏，title 改为「运维」。
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
        // 学习统计刷新按钮（AILearning 类自己绑定 aiLearningRefreshBtn，这里不需要重复绑）
        // 画像设置保存按钮
        document.getElementById('aiProfileSaveBtn')?.addEventListener('click', () => this._saveProfile());
    },

    async refresh() {
        this.init();
        // 并行加载所有系统级数据
        await Promise.all([
            this._loadStatus().catch(() => {}),
            this._loadMetrics().catch(() => {}),
            this._loadFeatures().catch(() => {}),
            this._loadProfile().catch(() => {}),
            // 学习统计由 AILearning 类承载（已有 167 行复用，不重写）
            window.AILearning ? window.AILearning.refresh().catch(() => {}) : Promise.resolve(),
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
        if (!data || !data.flags) return;
        this._renderFeatures(data);
    },

    /**
     * 渲染 toggle 列表（i18n label + 描述 + ENV/覆写/生效 三态 meta + 清除覆写按钮）
     * @param {{features:object, overrides:object, env:object, flags:Array, gray_percent:number}} data
     */
    _renderFeatures(data) {
        const container = document.getElementById('aiToolsFeatures');
        if (!container) return;
        const flags = data.flags || [];
        const features = data.features || {};
        const overrides = data.overrides || {};
        const env = data.env || {};
        const gray = data.gray_percent;

        if (!flags.length) {
            container.innerHTML = '<span class="ai-feature-empty">N/A</span>';
            return;
        }

        // meta 前缀走 i18n（中英文环境一致）
        const T = (k, fallback) => (typeof tt === 'function' && tt(k, fallback)) || fallback;
        const metaEnv = T('aiStatus.feature.meta.env', 'ENV');
        const metaOverride = T('aiStatus.feature.meta.override', 'Override');
        const metaEffective = T('aiStatus.feature.meta.effective', 'Effective');
        const metaGray = T('aiStatus.feature.meta.grayPercent', 'Gray');
        const resetTitle = T('aiStatus.feature.reset', 'Clear override');

        const rows = flags.map(({ key }) => {
            const effective = !!features[key];
            const envVal = !!env[key];
            const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
            const overrideVal = overrides[key];
            const labelKey = `aiStatus.feature.${key}`;
            const descKey = `aiStatus.featureDesc.${key}`;
            const label = (typeof tt === 'function' && tt(labelKey, key)) || key;
            const desc = (typeof tt === 'function' && tt(descKey, '')) || '';

            const envTxt = envVal ? '1' : '0';
            const overrideTxt = hasOverride
                ? (overrideVal ? '1' : '0')
                : '—';
            const overrideClass = hasOverride ? 'meta-override has-value' : 'meta-override';
            const resetDisabled = hasOverride ? '' : 'disabled';

            // 安全：所有 key 都来自后端 FLAG_KEYS 白名单，但仍 escape 一次防意外 XSS
            const safeKey = String(key).replace(/[^\w]/g, '');
            return `
                <div class="ai-feature-row" data-flag="${safeKey}">
                    <div class="ai-feature-info">
                        <span class="ai-feature-label">${escapeHtml(label)}</span>
                        ${desc ? `<span class="ai-feature-desc">${escapeHtml(desc)}</span>` : ''}
                        <span class="ai-feature-meta">
                            <span class="meta-env">${escapeHtml(metaEnv)}:${envTxt}</span>
                            <span class="${overrideClass}">${escapeHtml(metaOverride)}:${overrideTxt}</span>
                            <span class="meta-effective">${escapeHtml(metaEffective)}:${effective ? '✅' : '❌'}</span>
                            <span class="meta-gray">${escapeHtml(metaGray)}:${gray}%</span>
                        </span>
                    </div>
                    <div class="ai-feature-actions">
                        <button class="ai-feature-reset" data-flag="${safeKey}" ${resetDisabled} title="${escapeHtml(resetTitle)}">↺</button>
                        <label class="toggle-switch" title="${escapeHtml(label)}">
                            <input type="checkbox" data-flag="${safeKey}" ${effective ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = `<div class="ai-feature-list">${rows}</div>`;

        // 事件：toggle 切换
        container.querySelectorAll('input[type="checkbox"][data-flag]').forEach(input => {
            input.addEventListener('change', (e) => this._toggleFeature(e.target));
        });
        // 事件：清除覆写
        container.querySelectorAll('button.ai-feature-reset[data-flag]').forEach(btn => {
            btn.addEventListener('click', (e) => this._resetFeature(e.currentTarget));
        });
    },

    async _toggleFeature(input) {
        const flag = input.dataset.flag;
        const value = input.checked;
        const row = input.closest('.ai-feature-row');
        // 乐观更新：浏览器原生 checkbox 已切换；请求失败再回滚
        const prev = !value;
        try {
            row?.classList.add('is-saving');
            input.disabled = true;
            const resp = await api('/ai/v2/features', 'PUT', { key: flag, value }, { silent: true });
            if (!resp) throw new Error('empty response');
            // 用后端权威值整体重渲染（同步覆写/生效/清除按钮状态）
            await this._loadFeatures();
            showToast(typeof tt === 'function' ? tt('aiStatus.feature.saved', '已保存') : '已保存', 'success');
        } catch (err) {
            input.checked = prev;
            console.error('toggle feature failed:', err);
            showToast(typeof tt === 'function' ? tt('aiStatus.feature.saveFailed', '保存失败') : '保存失败', 'error');
        } finally {
            input.disabled = false;
            row?.classList.remove('is-saving');
        }
    },

    async _resetFeature(btn) {
        const flag = btn.dataset.flag;
        const row = btn.closest('.ai-feature-row');
        try {
            row?.classList.add('is-saving');
            btn.disabled = true;
            const resp = await api('/ai/v2/features', 'PUT', { key: flag, clear: true }, { silent: true });
            if (!resp) throw new Error('empty response');
            // 重渲染整个 toggle 列表，让 input.checked 同步到 ENV 决定的有效值
            await this._loadFeatures();
            showToast(typeof tt === 'function' ? tt('aiStatus.feature.saved', '已保存') : '已保存', 'success');
        } catch (err) {
            console.error('reset feature failed:', err);
            showToast(typeof tt === 'function' ? tt('aiStatus.feature.saveFailed', '保存失败') : '保存失败', 'error');
        } finally {
            row?.classList.remove('is-saving');
            btn.disabled = false;
        }
    },

    /**
     * 加载画像设置到表单控件（GET /ai/profile）
     */
    async _loadProfile() {
        const data = await api('/ai/profile', 'GET', null, { silent: true });
        if (!data) return;
        const profile = data.profile || data;
        if (!profile || typeof profile !== 'object') return;

        const set = (id, v) => { const e = document.getElementById(id); if (e != null && v != null) e.value = v; };
        const setBool = (id, v) => { const e = document.getElementById(id); if (e != null && v != null) e.checked = !!v; };

        set('aiProfileInteractionStyle', profile.interaction_style || 'balanced');
        setBool('aiProfileNotification', profile.notification_enabled !== false);
        set('aiProfileFrequency', profile.insight_frequency || 'daily');
        set('aiProfileThreshold', profile.insight_rank_threshold != null ? profile.insight_rank_threshold : 0.5);
    },

    /**
     * 保存画像设置（PATCH /ai/profile）
     */
    async _saveProfile() {
        const get = id => document.getElementById(id);
        const payload = {
            interaction_style: get('aiProfileInteractionStyle')?.value,
            notification_enabled: !!get('aiProfileNotification')?.checked,
            insight_frequency: get('aiProfileFrequency')?.value,
            insight_rank_threshold: parseFloat(get('aiProfileThreshold')?.value),
        };
        const btn = get('aiProfileSaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = tt('aiProfile.saving', '保存中...'); }
        try {
            await api('/ai/profile', 'PATCH', payload, { silent: true });
            showToast(tt('aiProfile.saved', '画像已保存'), 'success');
        } catch (e) {
            showToast(tt('aiProfile.saveFail', '保存失败：{msg}').replace('{msg}', e.message || ''), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = tt('aiProfile.save', '保存'); }
        }
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