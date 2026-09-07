/**
 * AI 洞察（2026-09 整页重构）
 *
 * 整合为单页连续结构（不再分"消费洞察 / 财务建议 / 告警"三个块）：
 *   ① 一句话总评（风险/建议数量摘要 + 生成时间）
 *   ② KPI 横排（未来余额 / 风险项 / 可执行项 / 净流入）
 *   ③ 现金流预测（3 单元格横排）
 *   ④ AI 解读统一卡片流（insights + advice 融合 + 按严重度排序）
 *
 * 数据源（与旧版相同）：
 *   - GET  /ai/forecast/cashflow?months=3 → 现金流预测
 *   - POST /ai/advice                       → { advice, insights, generatedAt }
 *
 * localStorage 复用（与 AIAdvice / dashboard.js 共享，key 保持稳定）：
 *   xin_ai_advice / xin_ai_insights / xin_ai_advice_generated_at
 *
 * 刷新策略：
 *   - refresh()：渲染本地缓存（如有）；后台静默拉取（不闪烁，不阻塞）
 *   - regenerate({silent:false})：用户点刷新按钮触发，强制重新生成
 *
 * 与旧版差异：
 *   - 自给自足渲染整页，不再依赖 window.AIAdvice.refresh()
 *   - 告警独立区块已废弃（warning 级洞察直接进卡片流，色条+徽章强提示）
 */
const AIInsights = {
    _bound: false,
    busy: false,

    // 当前页面渲染用的统一卡片流（insights + advice 融合）
    items: [],
    cashflow: null,         // { inflow, outflow, balance }
    generatedAt: '',

    _LS_KEY_ADVICE:   'xin_ai_advice',
    _LS_KEY_INSIGHTS: 'xin_ai_insights',
    _LS_KEY_GEN:      'xin_ai_advice_generated_at',

    init() {
        const btn = document.getElementById('aiInsightsRefreshBtn');
        if (!btn || this._bound) return;
        this._bound = true;
        btn.addEventListener('click', () => this.regenerate());
    },

    /** 进入页面：先渲染缓存（如有），后台静默拉取 */
    refresh() {
        if (document.getElementById('aiInsightsRefreshBtn') && !this._bound) this.init();

        const cachedAdvice   = this._load(this._LS_KEY_ADVICE);
        const cachedInsights = this._load(this._LS_KEY_INSIGHTS);
        const hasCache = (cachedAdvice && cachedAdvice.length) || (cachedInsights && cachedInsights.length);

        this.generatedAt = localStorage.getItem(this._LS_KEY_GEN) || '';

        if (hasCache) {
            this.items = this._merge(cachedInsights, cachedAdvice);
            this._renderAll();
        }
        // 后台静默拉取（不阻塞、不重 loading）
        return this.regenerate({ silent: true }).catch(() => {});
    },

    /** 刷新按钮触发：强制重新生成 */
    async regenerate({ silent = false } = {}) {
        if (this.busy && !silent) return;
        this.busy = true;

        const btn = document.getElementById('aiInsightsRefreshBtn');
        if (!silent && btn) btn.disabled = true;
        if (!silent) this._showLoading(true);

        try {
            // 并行拉现金流预测 + AI 建议
            const [cashflowRes, adviceRes] = await Promise.all([
                api('/ai/forecast/cashflow?months=3', 'GET', null, { silent: true }).catch(() => null),
                api('/ai/advice', 'POST', {}, { silent: true }).catch(() => null),
            ]);

            if (cashflowRes && cashflowRes.predicted) {
                this.cashflow = cashflowRes.predicted;
            }

            if (adviceRes) {
                const advice   = Array.isArray(adviceRes.advice)   ? adviceRes.advice   : [];
                const insights = Array.isArray(adviceRes.insights) ? adviceRes.insights : [];
                this.generatedAt = (adviceRes.generatedAt || adviceRes.generated_at) || new Date().toISOString();
                // 写入共享 localStorage（dashboard.js / 旧 AIAdvice 仍读这些 key）
                this._save(this._LS_KEY_ADVICE, advice);
                this._save(this._LS_KEY_INSIGHTS, insights);
                try { localStorage.setItem(this._LS_KEY_GEN, this.generatedAt); } catch (e) {}
                this.items = this._merge(insights, advice);
            }

            this._renderAll();
        } finally {
            this.busy = false;
            if (!silent) this._showLoading(false);
            if (!silent && btn) btn.disabled = false;
        }
    },

    // ====================================================
    //  数据融合 + 排序
    // ====================================================

    /**
     * 把后端返回的 insights（观察型）+ advice（可执行型）融合为统一卡片项。
     * 排序规则：严重度降序（同级别 advice 排在 insight 之前，更突出"下一步动作"）。
     */
    _merge(insights, advice) {
        const SEV = { warning: 3, danger: 3, error: 3, high: 3, info: 2, medium: 2, tip: 1, low: 1 };
        const LV_LABEL = {
            warning: tt('aiAdvice.lv.warning',    '需重视'),
            danger:  tt('aiAdvice.lv.warning',    '需重视'),
            error:   tt('aiAdvice.lv.warning',    '需重视'),
            high:    tt('aiAdvice.priority.high', '高优先'),
            info:    tt('aiAdvice.lv.info',       '关注'),
            medium:  tt('aiAdvice.priority.medium', '中优先'),
            tip:     tt('aiAdvice.lv.tip',        '小建议'),
            low:     tt('aiAdvice.priority.low',  '低优先'),
        };

        const items = [];
        for (const i of (insights || [])) {
            const level = i.level || 'info';
            items.push({
                kind: 'insight',
                title: i.title || tt('aiAdvice.fallback.insightTitle', '洞察'),
                body: i.description || '',
                meta: i.action || '',
                level,
                levelLabel: LV_LABEL[level] || LV_LABEL.info,
                sev: SEV[level] || 2,
            });
        }
        for (const a of (advice || [])) {
            const level = a.priority || 'medium';
            items.push({
                kind: 'advice',
                title: a.title || tt('aiAdvice.fallback.adviceTitle', '建议'),
                body: a.content || '',
                meta: a.impact || '',
                level,
                levelLabel: LV_LABEL[level] || LV_LABEL.medium,
                sev: SEV[level] || 2,
            });
        }
        items.sort((a, b) => (b.sev - a.sev) || (a.kind === 'advice' ? -1 : 1));
        return items;
    },

    _severityCounts() {
        const c = { warning: 0, danger: 0, error: 0, info: 0, tip: 0, high: 0, medium: 0, low: 0 };
        for (const it of this.items) if (c[it.level] != null) c[it.level]++;
        return c;
    },

    // ====================================================
    //  渲染：四段连续（总评 → KPI → 现金流 → 卡片流）
    // ====================================================

    _renderAll() {
        this._renderSummary();
        this._renderKpi();
        this._renderCashflow();
        this._renderReadout();
    },

    _renderSummary() {
        const el = document.getElementById('aiInsightsSummary');
        if (!el) return;
        if (!this.items.length) {
            el.innerHTML = `<span>${escapeHtml(tt('aiInsights.summary.empty', '本月财务数据不足，建议继续记账后再来生成洞察'))}</span>`;
            return;
        }
        const c = this._severityCounts();
        const risk    = c.warning + c.danger + c.error + c.high;
        const actions = c.info + c.tip + c.medium + c.low;

        let main;
        if (risk > 0) {
            main = tt('aiInsights.summary.risk', '本月发现 {n} 项需重视的洞察，{m} 项可执行建议')
                .replace('{n}', String(risk))
                .replace('{m}', String(actions));
        } else {
            main = tt('aiInsights.summary.ok', '本月暂无重大风险，{n} 项建议值得关注')
                .replace('{n}', String(actions));
        }
        const meta = this.generatedAt
            ? escapeHtml(tt('aiAdvice.meta.generated', '生成于 {time}')).replace('{time}', formatRelativeTime(this.generatedAt))
            : '';
        el.innerHTML = `<strong>${escapeHtml(main)}</strong>${meta ? `<span class="ai-summary-meta"> · ${meta}</span>` : ''}`;
    },

    _renderKpi() {
        const el = document.getElementById('aiInsightsKpi');
        if (!el) return;

        const c = this._severityCounts();
        const risk    = c.warning + c.danger + c.error + c.high;
        const actions = c.info + c.tip + c.medium + c.low;
        const kpis = [];

        // 1. 未来 3 月期末余额（最关键预测）
        if (this.cashflow && this.cashflow.balance != null) {
            const bal = Number(this.cashflow.balance) || 0;
            kpis.push({
                label:   tt('aiInsights.kpi.futureBalance', '未来 3 月期末余额'),
                val:     '¥' + bal.toFixed(0),
                caption: tt('aiInsights.kpi.futureBalanceCap', '基于历史 + 订阅 / 债务'),
                cls:     bal < 0 ? 'danger' : (risk > 0 ? 'warn' : ''),
            });
        }
        // 2. 风险项数
        kpis.push({
            label:   tt('aiInsights.kpi.riskCount', '需重视项'),
            val:     String(risk),
            caption: tt('aiInsights.kpi.riskCountCap', 'warning + danger + 高优先'),
            cls:     risk > 0 ? 'warn' : '',
        });
        // 3. 可执行项数
        kpis.push({
            label:   tt('aiInsights.kpi.actionCount', '可执行项'),
            val:     String(actions),
            caption: tt('aiInsights.kpi.actionCountCap', '关注 + 小建议 + 中低优先'),
            cls:     '',
        });
        // 4. 未来 3 月净流入
        if (this.cashflow && this.cashflow.inflow != null && this.cashflow.outflow != null) {
            const net = (Number(this.cashflow.inflow) || 0) - (Number(this.cashflow.outflow) || 0);
            kpis.push({
                label:   tt('aiInsights.kpi.netFlow', '未来 3 月净流入'),
                val:     (net >= 0 ? '+' : '') + '¥' + net.toFixed(0),
                caption: tt('aiInsights.kpi.netFlowCap', '流入 - 流出'),
                cls:     net < 0 ? 'warn' : '',
            });
        }

        el.innerHTML = kpis.map(k => `
            <div class="ai-kpi-card ${k.cls}">
                <span class="ai-kpi-label">${escapeHtml(k.label)}</span>
                <span class="ai-kpi-val">${escapeHtml(k.val)}</span>
                <span class="ai-kpi-caption">${escapeHtml(k.caption)}</span>
            </div>
        `).join('');
    },

    _renderCashflow() {
        const el = document.getElementById('aiCashflowBody');
        if (!el) return;
        if (!this.cashflow) {
            el.innerHTML = `<div class="ai-readout-empty">${escapeHtml(tt('aiInsights.cashflow.empty', '现金流数据不足，先记录一段时间账单吧'))}</div>`;
            return;
        }
        const p = this.cashflow;
        const cell = (label, val) => `<div class="ai-cashflow-item"><span class="ai-cashflow-label">${escapeHtml(label)}</span><div class="ai-cashflow-val">¥${(Number(val) || 0).toFixed(0)}</div></div>`;
        el.innerHTML = cell(tt('aiInsights.cashflow.inflow',  '未来 3 月流入'),  p.inflow)
                     + cell(tt('aiInsights.cashflow.outflow', '未来 3 月流出'),  p.outflow)
                     + (p.balance != null ? cell(tt('aiInsights.cashflow.balance', '期末余额'), p.balance) : '');
    },

    _renderReadout() {
        const el = document.getElementById('aiReadoutList');
        if (!el) return;
        if (!this.items.length) {
            el.innerHTML = `<div class="ai-readout-empty">${escapeHtml(tt('aiInsights.readout.empty', '暂无洞察'))}</div>`;
            return;
        }
        el.innerHTML = this.items.map(it => `
            <div class="ai-readout-item ${escapeHtml(it.level)}">
                <div class="ai-readout-bar"></div>
                <div class="ai-readout-body">
                    <div class="ai-readout-head">
                        <span class="ai-readout-title">${escapeHtml(it.title)}</span>
                        <span class="ai-readout-badge">${escapeHtml(it.levelLabel)}</span>
                    </div>
                    <div class="ai-readout-desc">${escapeHtml(it.body)}</div>
                    ${it.meta ? `<div class="ai-readout-action">${escapeHtml(it.meta)}</div>` : ''}
                </div>
            </div>
        `).join('');
    },

    // ====================================================
    //  localStorage helpers（与 AIAdvice 共享 key，保持 dashboard.js 兼容）
    // ====================================================
    _load(key) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : []; } catch (e) { return []; }
    },
    _save(key, arr) {
        try { localStorage.setItem(key, JSON.stringify(arr || [])); } catch (e) {}
    },

    _showLoading(on) {
        const ld = document.getElementById('aiAdviceLoading');
        if (ld) ld.style.display = on ? 'block' : 'none';
    },
};

window.AIInsights = AIInsights;
export default AIInsights;