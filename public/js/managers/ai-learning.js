/**
 * AI 学习统计页（web）
 * ----------------------------------------------------------------
 * 调用链：页面 load → GET /ai/learning/stats
 *        → 渲染 5 个区块：反馈与记忆 / 规则冲突 / 在线指标 / 调用用量 / 熔断器
 *
 * 响应结构（server/routes/ai.js:1424 → aiModule.*）：
 *   - evidence:   { feedback_events:{event_type:{count,score}}, rules:{status:count}, memory:{kind:count} }
 *   - contradictions: [{ match_key, variants, samples }]  同一商家命中多个高置信类目，需用户裁定
 *   - metrics:    在线指标（0~1 比率 + 计数 + 微元成本）
 *   - usage:      近 30 天调用用量（cost-tracker.usageMetrics）
 *   - breakers:   { [routeId]: { failures, open, opened_at } }
 *
 * 设计要点：所有字段做空值兜底，缺表/缺数据时降级为「暂无数据」而非报错。
 */
const AILearning = {
    busy: false,
    _eventsBound: false,
    data: null,

    init() {
        if (!document.getElementById('aiLearningRefreshBtn')) return;
        this._bindEvents();
    },

    // 懒加载时 init 可能错过，切页 refresh 时补绑
    refresh() {
        if (document.getElementById('aiLearningRefreshBtn') && !this._eventsBound) this._bindEvents();
        this.load();
    },

    _bindEvents() {
        this._eventsBound = true;
        const btn = document.getElementById('aiLearningRefreshBtn');
        if (btn) btn.addEventListener('click', () => this.load());
    },

    async load() {
        if (this.busy) return;
        this.busy = true;
        this._showError('');
        this._showLoading(true);
        try {
            const r = await api('/ai/learning/stats', 'GET');
            if (r && r.evidence) {
                this.data = r;
                this._render();
            } else {
                this._showError((r && r.message) || tt('aiLearn.err.loadFail', '加载学习统计失败'));
            }
        } catch (e) {
            this._showError(e.message || tt('aiLearn.err.network', '网络异常'));
        } finally {
            this.busy = false;
            this._showLoading(false);
        }
    },

    _pct(n) {
        const v = Number(n);
        if (!isFinite(v)) return '—';
        return (v * 100).toFixed(1) + '%';
    },
    _num(n) {
        const v = Number(n);
        return isFinite(v) ? v.toLocaleString('zh-CN') : '0';
    },

    _section(title, icon, bodyHtml) {
        return `<div class="ai-learn-section">
            <h4 class="ai-learn-section-title">${icon} ${escapeHtml(title)}</h4>
            <div class="ai-learn-section-body">${bodyHtml}</div>
        </div>`;
    },

    // 把对象渲染成「键 → 值」网格；值为对象时展开成 "k: v" 列表
    _kvGrid(obj, labelMap) {
        if (!obj || typeof obj !== 'object' || !Object.keys(obj).length) {
            return `<p class="empty-desc">${escapeHtml(tt('aiLearn.empty.data', '暂无数据'))}</p>`;
        }
        const rows = Object.keys(obj).map(k => {
            const label = (labelMap && labelMap[k]) || k;
            const v = obj[k];
            let disp;
            if (v && typeof v === 'object') {
                disp = Object.keys(v)
                    .map(kk => `${escapeHtml(kk)}: ${escapeHtml(String(v[kk]))}`)
                    .join(' · ');
            } else {
                // 0~1 之间的字段当成比率展示为百分比
                const nv = Number(v);
                disp = (isFinite(nv) && nv > 0 && nv < 1 && /rate|ratio/i.test(k))
                    ? `${escapeHtml(String(v))}${escapeHtml(tt('aiLearn.rate.note', '（{pct}）')).replace('{pct}', this._pct(v))}`
                    : escapeHtml(String(v));
            }
            return `<div class="ai-kv"><span class="ai-kv-k">${escapeHtml(label)}</span><span class="ai-kv-v">${disp}</span></div>`;
        });
        return `<div class="ai-kv-grid">${rows.join('')}</div>`;
    },

    _render() {
        const body = document.getElementById('aiLearningBody');
        if (!body) return;
        const d = this.data || {};
        const parts = [];

        // 1. 反馈与记忆
        const ev = d.evidence || {};
        let evHtml = this._kvGrid(ev.feedback_events, {
            explicit_confirmation: tt('aiLearn.fb.explicitConfirmation', '显式确认'),
            explicit_correction: tt('aiLearn.fb.explicitCorrection', '显式修正'),
            discard: tt('aiLearn.fb.discard', '弃置'),
        });
        evHtml += `<div class="ai-learn-sub">${escapeHtml(tt('aiLearn.sub.rules', '规则状态分布'))}</div>` + this._kvGrid(ev.rules, {
            verified: tt('aiLearn.rule.verified', '已生效'),
            trusted: tt('aiLearn.rule.trusted', '高可信'),
            candidate: tt('aiLearn.rule.candidate', '候选'),
            disabled: tt('aiLearn.rule.disabled', '已禁用'),
        });
        evHtml += `<div class="ai-learn-sub">${escapeHtml(tt('aiLearn.sub.memory', '记忆条目分布'))}</div>` + this._kvGrid(ev.memory, {});
        parts.push(this._section(tt('aiLearn.section.feedback', '反馈与记忆'), '', evHtml));

        // 2. 规则冲突
        const cons = Array.isArray(d.contradictions) ? d.contradictions : [];
        let consHtml = cons.length
            ? cons.map(c => `<div class="ai-cons-row">
                    <span class="ai-cons-key">${escapeHtml(c.match_key || '')}</span>
                    <span class="ai-cons-meta">${escapeHtml(tt('aiLearn.cons.count', '{a} 个类目 · {b} 样本')).replace('{a}', this._num(c.variants)).replace('{b}', this._num(c.samples))}</span>
                    <span class="ai-cons-flag">${escapeHtml(tt('aiLearn.cons.flag', '需裁定'))}</span>
                </div>`).join('')
            : `<p class="empty-desc">${escapeHtml(tt('aiLearn.empty.cons', '无规则冲突，学习方向一致'))}</p>`;
        parts.push(this._section(tt('aiLearn.section.cons', '规则冲突（需用户裁定）'), '⚠️', consHtml));

        // 3. 在线指标
        parts.push(this._section(tt('aiLearn.section.metrics', '在线指标'), '',
            this._kvGrid(d.metrics, {
                confirmation_rate: tt('aiLearn.metric.confirmationRate', '确认率'),
                correction_rate: tt('aiLearn.metric.correctionRate', '修正率'),
                discard_rate: tt('aiLearn.metric.discardRate', '弃置率'),
                rule_hit_rate: tt('aiLearn.metric.ruleHitRate', '规则命中率'),
                llm_call_rate: tt('aiLearn.metric.llmCallRate', 'LLM 调用率'),
                fallback_rate: tt('aiLearn.metric.fallbackRate', '兜底率'),
                cost_per_prediction_micro: tt('aiLearn.metric.costPerPrediction', '单笔成本(微元)'),
                total_predictions: tt('aiLearn.metric.totalPredictions', '预测总数'),
            })));

        // 4. 调用用量
        parts.push(this._section(tt('aiLearn.section.usage', '调用用量（近 30 天）'), '',
            this._kvGrid(d.usage, {
                total_predictions: tt('aiLearn.usage.totalPredictions', '调用总数'),
                local_count: tt('aiLearn.usage.local', '本地路由'),
                llm_count: tt('aiLearn.usage.llm', 'LLM 路由'),
                fallback_count: tt('aiLearn.usage.fallback', '兜底路由'),
                llm_call_rate: tt('aiLearn.metric.llmCallRate', 'LLM 调用率'),
                fallback_rate: tt('aiLearn.metric.fallbackRate', '兜底率'),
                total_cost_micro_cny: tt('aiLearn.usage.totalCost', '总成本(微元)'),
                cost_per_prediction_micro: tt('aiLearn.metric.costPerPrediction', '单笔成本(微元)'),
                avg_latency_ms: tt('aiLearn.usage.avgLatency', '平均时延(ms)'),
            })));

        // 5. 熔断器
        const b = d.breakers || {};
        const bState = {}, bFail = {};
        Object.keys(b).forEach(id => {
            const s = b[id] || {};
            bState[id] = s.open ? tt('aiLearn.breaker.open', '🔴 已打开') : tt('aiLearn.breaker.normal', '🟢 正常');
            bFail[id] = this._num(s.failures);
        });
        let bHtml = this._kvGrid(bState, {});
        bHtml += `<div class="ai-learn-sub">${escapeHtml(tt('aiLearn.sub.breakerFail', '失败计数'))}</div>` + this._kvGrid(bFail, {});
        parts.push(this._section(tt('aiLearn.section.breaker', '模型熔断器'), '', bHtml));

        body.innerHTML = parts.join('');
    },

    _showLoading(on) {
        const ld = document.getElementById('aiLearningLoading');
        if (ld) ld.style.display = on ? 'block' : 'none';
    },

    _showError(msg) {
        const bar = document.getElementById('aiLearningError');
        if (!bar) return;
        if (!msg) { bar.style.display = 'none'; return; }
        const prefix = tt('aiLearn.err.prefix', '⚠️');
        bar.textContent = prefix + ' ' + msg;
        bar.style.display = 'block';
        setTimeout(() => { if (bar.textContent.startsWith(prefix + ' ' + msg)) bar.style.display = 'none'; }, 4000);
    },
};

window.AILearning = AILearning;
export default AILearning;
