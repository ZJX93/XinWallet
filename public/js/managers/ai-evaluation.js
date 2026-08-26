/**
 * AI 评测中心页（web）
 * ----------------------------------------------------------------
 * 调用链：
 *   - POST /ai/evaluation/run   → 离线跑批（纯本地 CPU，不调模型），自动与最近一次基线对比
 *   - GET  /ai/evaluation/runs  → 历史跑批列表
 *
 * 响应结构（server/routes/ai.js:1455 / 1492）：
 *   run  → { run_id, metrics, summary:{total_cases,passed_cases,dataset_version},
 *           baseline_run_id, regression:{has_baseline,deltas,regressions[],improvements[]},
 *           failed_cases[] }
 *   runs → { runs:[{id,label,dataset_version,engine_version,total_cases,passed_cases,
 *                    metrics, baseline_run_id, regression, created_at}], dataset_version }
 *
 * 指标 metrics 为 12 个计数器（字段对 _total / _hit）：count/amount/type/category/date/verdict。
 * 设计要点：跑批默认 persist=true 落库；耗时数秒，按钮进入 loading 态防连点。
 */
const AIEvaluation = {
    busy: false,
    _eventsBound: false,
    data: null,

    init() {
        if (!document.getElementById('aiEvalRunBtn')) return;
        this._bindEvents();
    },

    refresh() {
        if (document.getElementById('aiEvalRunBtn') && !this._eventsBound) this._bindEvents();
        this.loadHistory();
    },

    _bindEvents() {
        this._eventsBound = true;
        const run = document.getElementById('aiEvalRunBtn');
        if (run) run.addEventListener('click', () => this.run());
    },

    async run() {
        if (this.busy) return;
        this.busy = true;
        this._setBtn(true);
        this._showError('');
        this._showLoading(true);
        try {
            const r = await api('/ai/evaluation/run', 'POST', { label: 'web-manual', persist: true });
            if (r && r.success && r.data) {
                this.data = r.data;
                this._renderResult(r.data);
                await this.loadHistory();
                showToast('评测完成', 'success');
            } else {
                this._showError((r && r.message) || '评测失败');
            }
        } catch (e) {
            this._showError(e.message || '网络异常');
        } finally {
            this.busy = false;
            this._setBtn(false);
            this._showLoading(false);
        }
    },

    async loadHistory() {
        try {
            const r = await api('/ai/evaluation/runs', 'GET');
            if (r && r.success && r.data) this._renderHistory(r.data.runs || []);
        } catch (e) {
            // 历史失败不阻断主流程
            const el = document.getElementById('aiEvalHistory');
            if (el) el.innerHTML = '<p class="empty-desc">历史加载失败</p>';
        }
    },

    _num(n) { const v = Number(n); return isFinite(v) ? v.toLocaleString('zh-CN') : '0'; },
    _pctOf(hit, total) {
        const t = Number(total), h = Number(hit);
        if (!t) return '—';
        return (h / t * 100).toFixed(1) + '%';
    },

    _metricGrid(metrics) {
        if (!metrics || typeof metrics !== 'object') return '<p class="empty-desc">无指标</p>';
        // 服务端 runner.js:148-156 直接暴露每个维度的准确率（0~1），不需要前端再做 total/hit 计算
        const pairs = [
            ['transaction_count_accuracy', '笔数识别'],
            ['amount_accuracy', '金额'],
            ['type_accuracy', '类型'],
            ['category_accuracy', '类目'],
            ['date_accuracy', '日期'],
            ['verdict_accuracy', '裁决'],
        ];
        const cards = pairs.map(([k, label]) => {
            const acc = Number(metrics[k]);
            const pct = isFinite(acc) ? (acc * 100).toFixed(1) + '%' : '—';
            return `<div class="ai-eval-metric">
                <div class="ai-eval-metric-label">${escapeHtml(label)}</div>
                <div class="ai-eval-metric-acc">${pct}</div>
                <div class="ai-eval-metric-sub">case_pass_rate: ${isFinite(Number(metrics.case_pass_rate)) ? (Number(metrics.case_pass_rate) * 100).toFixed(1) + '%' : '—'}</div>
            </div>`;
        });
        return `<div class="ai-eval-metric-grid">${cards.join('')}</div>`;
    },

    _renderResult(d) {
        const el = document.getElementById('aiEvalResult');
        if (!el) return;
        const summary = d.summary || {};
        const reg = d.regression || {};
        let html = `<div class="ai-eval-summary">
            <div class="ai-eval-summary-main">通过 <b>${this._num(summary.passed_cases)}</b> / ${this._num(summary.total_cases)} 例 · 数据集 v${escapeHtml(String(summary.dataset_version || '?'))}</div>
            ${d.baseline_run_id ? `<div class="ai-eval-baseline">基线跑批 #${d.baseline_run_id}</div>` : ''}
        </div>`;
        html += this._metricGrid(d.metrics);

        if (reg.has_baseline) {
            const regs = Array.isArray(reg.regressions) ? reg.regressions : [];
            if (regs.length) {
                html += '<div class="ai-eval-reg"><div class="ai-eval-reg-title">⚠️ 回归项</div>' + regs.map(g =>
                    `<div class="ai-eval-reg-row">${escapeHtml(g.metric)}: ${(Number(g.from) * 100).toFixed(1)}% → ${(Number(g.to) * 100).toFixed(1)}%</div>`
                ).join('') + '</div>';
            } else {
                html += '<div class="ai-eval-reg ok">✅ 相较基线无回归</div>';
            }
        } else {
            html += '<div class="ai-eval-reg neutral">ℹ️ 暂无基线，本次作为首条基线</div>';
        }

        const failed = Array.isArray(d.failed_cases) ? d.failed_cases : [];
        if (failed.length) {
            html += '<div class="ai-eval-failed"><div class="ai-eval-reg-title">❌ 失败用例 (' + failed.length + ')</div>' +
                failed.map(c => `<div class="ai-eval-failed-row"><b>${escapeHtml(String(c.case_id || ''))}</b> ${escapeHtml(c.scenario || '')}<div class="ai-eval-failed-input">${escapeHtml(c.input_text || '')}</div></div>`).join('') +
                '</div>';
        }
        el.innerHTML = html;
    },

    _renderHistory(runs) {
        const el = document.getElementById('aiEvalHistory');
        if (!el) return;
        if (!runs.length) { el.innerHTML = '<p class="empty-desc">暂无历史跑批</p>'; return; }
        el.innerHTML = runs.map(r => {
            const created = r.created_at ? formatRelativeTime(r.created_at) : '';
            return `<div class="ai-eval-hist-row">
                <div class="ai-eval-hist-main">#${r.id} ${escapeHtml(r.label || '')}</div>
                <div class="ai-eval-hist-sub">${this._num(r.passed_cases)}/${this._num(r.total_cases)} · ${escapeHtml(String(r.dataset_version || ''))} · ${created}</div>
            </div>`;
        }).join('');
    },

    _setBtn(busy) {
        const b = document.getElementById('aiEvalRunBtn');
        if (b) { b.disabled = busy; b.textContent = busy ? '⏳ 跑批中...' : '▶ 运行评测'; }
    },
    _showLoading(on) {
        const ld = document.getElementById('aiEvalLoading');
        if (ld) ld.style.display = on ? 'block' : 'none';
    },
    _showError(msg) {
        const bar = document.getElementById('aiEvalError');
        if (!bar) return;
        if (!msg) { bar.style.display = 'none'; return; }
        bar.textContent = '⚠️ ' + msg;
        bar.style.display = 'block';
        setTimeout(() => { if (bar.textContent.startsWith('⚠️ ' + msg)) bar.style.display = 'none'; }, 4000);
    },
};

window.AIEvaluation = AIEvaluation;
export default AIEvaluation;
