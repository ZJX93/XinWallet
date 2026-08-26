/**
 * AI 智能记账 v0.2 · 预测闭环前端（web）
 * ----------------------------------------------------------------
 * 链路：一句话文本 → POST /ai/transactions/parse（产出不可变预测快照）
 *      → 用户在确认区核对/修正 → POST /ai/predictions/:id/commit（事务内原子落账）
 *      或 POST /ai/predictions/:id/discard（弃置，不形成负向学习）。
 *
 * 与 legacy 通道的关系：
 *   ai-recognition.js 的 OCR / 账单导入仍走「前端循环 POST /transactions」直写，
 *   本模块是并行新增的独立通道，不改动 legacy 行为。
 *
 * 设计约束（对齐后端 server/modules/ai/validation/result-validator.js）：
 *   1. 裁决权在后端。前端【禁止】拿 overall_confidence 跟阈值比较来自行判定，
 *      一律以 needs_confirmation / verdict 为准；字段级高亮同样取后端 validation.per_txn。
 *   2. 用户手工修正过的字段，置信度提升为 1.0、evidence 标记 user_corrected，
 *      使 final_diff 与后续学习信号反映「人工已确认」这一事实。
 *   3. idempotency_key 在进入确认区时生成并固定，网络重试不会重复落账。
 * ----------------------------------------------------------------
 */

// 与后端 result-validator.js 的 DECISIVE_FIELDS 对齐；merchant 记录但不参与裁决
const DECISIVE_FIELDS = ['amount', 'type', 'category', 'date'];

const FIELD_LABEL = {
    amount: '金额', type: '类型', category: '分类',
    date: '日期', currency: '币种', merchant: '商户'
};

const AISmartEntry = {
    predictionId: null,
    original: [],        // parse 返回的原始候选（只读基准，用于 diff 与「未修改」判定）
    items: [],           // 可编辑副本
    validation: null,    // 后端完整裁决对象（needs_confirmation 时才拉取）
    verdict: null,
    reasons: [],
    overall: null,
    idemKey: null,
    busy: false,
    _eventsBound: false,

    init() {
        if (!document.getElementById('aiSmartParseBtn')) return;  // 页面惰加载，可能尚未插入 DOM
        this._bindEvents();
    },

    // 惰加载时 init 可能错过，切页 refresh 时补绑
    refresh() {
        if (document.getElementById('aiSmartParseBtn') && !this._eventsBound) this._bindEvents();
    },

    _bindEvents() {
        this._eventsBound = true;
        document.getElementById('aiSmartParseBtn').addEventListener('click', () => this.parse());
        document.getElementById('aiSmartCommitBtn').addEventListener('click', () => this.commit());
        document.getElementById('aiSmartDiscardBtn').addEventListener('click', () => this.discard());

        // 🎙 语音：单击切到录音态，再单击停止；最长 60 秒（防误触长开）
        const voiceBtn = document.getElementById('aiSmartVoiceBtn');
        if (voiceBtn) voiceBtn.addEventListener('click', () => this._toggleVoice());

        const input = document.getElementById('aiSmartText');
        // Ctrl/Cmd + Enter 快捷解析；单独回车留给多行输入
        input.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.parse(); }
        });

        document.querySelectorAll('#aiSmartExamples [data-example]').forEach(chip => {
            chip.addEventListener('click', () => {
                input.value = chip.dataset.example;
                input.focus();
            });
        });
    },

    /* ========== 步骤 0：语音转写（点击开始 / 再点击停止） ==========
     * 浏览器侧 MediaRecorder 录 webm/opus，base64 后 POST /ai/transcribe。
     * 成功后把转写文本灌回 #aiSmartText（不清空用户已输内容，append 模式），
     * 用户再点 🪄 解析走原有链路。最长 60 秒（达到上限自动停止）。 */
    _voice: { recorder: null, chunks: [], mime: '', stopped: false, maxTimer: null },

    async _toggleVoice() {
        const btn = document.getElementById('aiSmartVoiceBtn');
        if (!btn) return;
        if (this._voice.recorder && this._voice.recorder.state === 'recording') {
            this._voice.stopped = true;
            clearTimeout(this._voice.maxTimer);
            this._voice.recorder.stop();
            btn.textContent = '⏳ 转写中...';
            btn.disabled = true;
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('当前浏览器不支持麦克风录制', 'error'); return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // 优先 webm/opus（Chrome/Edge），Safari 用 mp4/m4a 兜底
            const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
            this._voice.recorder = mime
                ? new MediaRecorder(stream, { mimeType: mime })
                : new MediaRecorder(stream);
            this._voice.mime = this._voice.recorder.mimeType || mime || 'audio/webm';
            this._voice.chunks = [];
            this._voice.stopped = false;

            this._voice.recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this._voice.chunks.push(e.data);
            };
            this._voice.recorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());   // 关麦克风（关键：不解锁红灯）
                const blob = new Blob(this._voice.chunks, { type: this._voice.mime });
                await this._sendTranscribe(blob);
            };
            this._voice.recorder.start();
            btn.textContent = '⏹ 停止';
            btn.classList.add('is-recording');
            // 60 秒上限自动停
            this._voice.maxTimer = setTimeout(() => {
                if (this._voice.recorder && this._voice.recorder.state === 'recording') {
                    showToast('已达最长录音时长，自动停止', 'info');
                    this._voice.recorder.stop();
                }
            }, 60_000);
        } catch (e) {
            // getUserMedia 失败：权限拒绝 / 设备占用 / 不安全上下文（http）
            const msg = (e && (e.message || e.name)) || '无法访问麦克风';
            showToast(`录音失败：${msg}（https 站点才可授权）`, 'error');
        }
    },

    async _sendTranscribe(blob) {
        const btn = document.getElementById('aiSmartVoiceBtn');
        try {
            const b64 = await blobToBase64(blob);
            const res = await api('/ai/transcribe', 'POST', {
                audio: b64,
                mime: blob.type || this._voice.mime
            });
            const text = (res && (res.text || res.transcript)) || '';
            const input = document.getElementById('aiSmartText');
            if (!text) {
                showToast('未识别到语音内容，请重试', 'warning');
            } else {
                // append 模式：已有内容时换行追加；空时直接填入
                input.value = input.value.trim() ? `${input.value.trim()}\n${text}` : text;
                input.focus();
                showToast('已填入转写文本，可点「🪄 解析」', 'success');
            }
        } catch (err) {
            // 服务端 422 / 502 时仍可保留已录内容，下次再试
            showToast((err && err.payload && err.payload.message) || '语音转写失败', 'error');
        } finally {
            btn.textContent = '🎙 按住说话';
            btn.classList.remove('is-recording');
            btn.disabled = false;
            this._voice = { recorder: null, chunks: [], mime: '', stopped: false, maxTimer: null };
        }
    },

    // ========== 步骤 1：解析 ==========
    async parse() {
        if (this.busy) return;
        const input = document.getElementById('aiSmartText');
        const text = (input.value || '').trim();
        if (!text) { showToast('请先输入要记账的内容', 'warning'); return; }
        if (text.length > 2000) { showToast('文本过长（最多 2000 字）', 'warning'); return; }

        this._setBusy(true, 'parse');
        this._hide('aiSmartConfirm');
        this._show('aiSmartLoading');

        try {
            // context.account_id 给后端做默认账户兜底；date 让后端以本地「今天」为基准而非服务器时区
            // 注意：source 表示【输入通道】（parse/chat/ocr/voice），受 schema CHECK 约束；
            //      客户端平台放 context.platform，不要塞进 source。
            const context = { platform: 'web' };
            const defAcc = (cache.accounts || [])[0];
            if (defAcc) context.account_id = defAcc.id;
            context.date = fmtDate(new Date());

            const res = await api('/ai/transactions/parse', 'POST', { text, context, source: 'parse' });

            this.predictionId = res.prediction_id;
            this.original = JSON.parse(JSON.stringify(res.transactions || []));
            this.items = JSON.parse(JSON.stringify(res.transactions || []));
            this.verdict = res.verdict;
            this.reasons = res.reasons || [];
            this.overall = res.overall_confidence;
            this.validation = null;
            // 幂等键在此刻固定：后续提交失败重试均复用，保证不会重复落账
            this.idemKey = this._newIdemKey(res.prediction_id);

            // 需要确认时再拉完整快照，取 validation.per_txn 做精确字段级高亮，
            // 避免在前端复制一份阈值表造成双份事实来源
            if (res.needs_confirmation) {
                try {
                    const full = await api(`/ai/predictions/${this.predictionId}`, 'GET', null, { silent: true });
                    this.validation = full && full.validation ? full.validation : null;
                } catch (e) {
                    this.validation = null;  // 拉不到就退化为不高亮，不阻塞主流程
                }
            }

            this._hide('aiSmartLoading');
            this._render();
        } catch (err) {
            this._hide('aiSmartLoading');
            // api() 已弹过 toast，这里只补充 422（无法识别）的引导话术
            if (err.payload && err.payload.message && /未能从文本中识别/.test(err.payload.message)) {
                showToast('试试写明金额，例如「星巴克咖啡 35.5」', 'info');
            }
        } finally {
            this._setBusy(false, 'parse');
        }
    },

    // ========== 步骤 2：渲染确认区 ==========
    _render() {
        if (!this.items.length) { this._hide('aiSmartConfirm'); return; }
        this._show('aiSmartConfirm');

        const needsConfirm = this.verdict !== 'ready';

        // 裁决横幅：以后端 verdict 为唯一依据
        const banner = document.getElementById('aiSmartVerdict');
        const pct = this.overall == null ? '' : `（综合置信度 ${(this.overall * 100).toFixed(0)}%）`;
        banner.className = 'ai-smart-verdict ' + (needsConfirm ? 'is-warn' : 'is-ok');
        banner.innerHTML = needsConfirm
            ? `<div class="ai-smart-verdict-head">⚠️ 有字段置信度偏低，请核对后提交${escapeHtml(pct)}</div>`
              + (this.reasons.length
                  ? `<ul class="ai-smart-reasons">${this.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
                  : '')
            : `<div class="ai-smart-verdict-head">✅ 各字段置信度达标，仍建议核对后提交${escapeHtml(pct)}</div>`;

        document.getElementById('aiSmartList').innerHTML =
            this.items.map((item, i) => this._renderRow(item, i)).join('');

        this._bindRowEvents();
        this._syncCommitLabel();
    },

    _renderRow(item, i) {
        const accounts = cache.accounts || [];
        const cats = cache.categories || [];
        const isTransfer = item.type === 'transfer';
        const catList = cats.filter(c => c.type === (item.type === 'income' ? 'income' : 'expense'));
        const perField = this._perField(item.seq);

        const accOpts = (selId) => accounts.map(a =>
            `<option value="${a.id}" ${a.id === selId ? 'selected' : ''}>${escapeHtml(a.icon || '🏦')} ${escapeHtml(a.name)}</option>`
        ).join('');

        // 转账走「转出 → 转入」双账户，普通收支走单账户
        const accountCell = isTransfer
            ? `<div class="ai-smart-cell" data-w="acc2">
                   ${this._label('转出 → 转入', perField, null)}
                   <div class="ai-smart-transfer-accs">
                       <select data-field="from_account_id" data-idx="${i}"><option value="">选择转出</option>${accOpts(item.from_account_id)}</select>
                       <span class="ai-smart-arrow">→</span>
                       <select data-field="to_account_id" data-idx="${i}"><option value="">选择转入</option>${accOpts(item.to_account_id)}</select>
                   </div>
               </div>`
            : `<div class="ai-smart-cell" data-w="acc">
                   ${this._label('账户', perField, null)}
                   <select data-field="account_id" data-idx="${i}"><option value="">选择账户</option>${accOpts(item.account_id)}</select>
               </div>`;

        // 转账无需类目（后端用系统「转账」类目），故隐去分类列
        const categoryCell = isTransfer ? '' : `
            <div class="ai-smart-cell" data-w="cat">
                ${this._label('分类', perField, 'category')}
                <select data-field="category_id" data-idx="${i}">
                    <option value="">未识别</option>
                    ${catList.map(c => `<option value="${c.id}" ${c.id === item.category_id ? 'selected' : ''}>${escapeHtml(c.icon || '📌')} ${escapeHtml(c.name)}</option>`).join('')}
                </select>
            </div>`;

        const evidence = this._evidenceText(item);

        return `<div class="ai-smart-row" data-idx="${i}">
            <div class="ai-smart-row-head">
                <span class="ai-smart-seq">第 ${item.seq} 笔</span>
                ${item.merchant ? `<span class="ai-smart-merchant">${escapeHtml(item.merchant)}</span>` : ''}
                ${item.raw_segment ? `<span class="ai-smart-raw" title="原文片段">「${escapeHtml(item.raw_segment)}」</span>` : ''}
                <button class="ai-smart-del" data-del="${i}" title="移除此笔">✕</button>
            </div>
            <div class="ai-smart-row-body">
                <div class="ai-smart-cell" data-w="type">
                    ${this._label('类型', perField, 'type')}
                    <select data-field="type" data-idx="${i}">
                        <option value="expense" ${item.type === 'expense' ? 'selected' : ''}>支出</option>
                        <option value="income" ${item.type === 'income' ? 'selected' : ''}>收入</option>
                        <option value="transfer" ${isTransfer ? 'selected' : ''}>转账</option>
                    </select>
                </div>
                ${accountCell}
                ${categoryCell}
                <div class="ai-smart-cell" data-w="amt">
                    ${this._label('金额', perField, 'amount')}
                    <input type="number" step="0.01" min="0.01" value="${Number(item.amount || 0).toFixed(2)}" data-field="amount" data-idx="${i}">
                </div>
                <div class="ai-smart-cell" data-w="date">
                    ${this._label('日期', perField, 'date')}
                    <input type="date" value="${escapeHtml(item.date || '')}" data-field="date" data-idx="${i}">
                </div>
                <div class="ai-smart-cell" data-w="note">
                    ${this._label('备注', perField, null)}
                    <input type="text" value="${escapeHtml(item.note || '')}" placeholder="备注" data-field="note" data-idx="${i}">
                </div>
            </div>
            ${evidence ? `<div class="ai-smart-evidence">${escapeHtml(evidence)}</div>` : ''}
        </div>`;
    },

    // 字段标签 + 置信度徽标（低于阈值标红；数据源为后端 validation，前端不做阈值判断）
    _label(text, perField, field) {
        if (!field || !perField || !perField[field]) {
            return `<label class="ai-smart-flabel">${escapeHtml(text)}</label>`;
        }
        const f = perField[field];
        const cls = f.ok ? 'is-ok' : 'is-low';
        const score = Math.round((f.score || 0) * 100);
        const tip = `置信度 ${score}%，阈值 ${Math.round((f.threshold || 0) * 100)}%`;
        return `<label class="ai-smart-flabel">${escapeHtml(text)}`
            + `<span class="ai-smart-conf ${cls}" title="${escapeHtml(tip)}">${score}%</span></label>`;
    },

    // 取某笔的字段级裁决明细；validation 缺失（ready 或拉取失败）时返回 null
    _perField(seq) {
        const v = this.validation;
        if (!v || !Array.isArray(v.per_txn)) return null;
        const hit = v.per_txn.find(t => t.seq === seq);
        return hit ? hit.per_field : null;
    },

    // 证据链摘要：告诉用户「为什么这么判」
    _evidenceText(item) {
        const ev = item.evidence;
        if (!ev) return '';
        const parts = DECISIVE_FIELDS
            .filter(f => ev[f] && ev[f] !== 'missing')
            .map(f => `${FIELD_LABEL[f]}=${ev[f]}`);
        return parts.length ? `识别依据：${parts.join('  ·  ')}` : '';
    },

    _bindRowEvents() {
        document.querySelectorAll('#aiSmartList [data-field]').forEach(el => {
            el.addEventListener('change', () => {
                const idx = parseInt(el.dataset.idx, 10);
                const field = el.dataset.field;
                const item = this.items[idx];
                if (!item) return;

                if (field === 'amount') {
                    item.amount = parseFloat(el.value) || 0;
                } else if (field === 'category_id' || field === 'account_id'
                        || field === 'from_account_id' || field === 'to_account_id') {
                    item[field] = el.value ? parseInt(el.value, 10) : null;
                    if (field === 'category_id') {
                        const opt = el.options[el.selectedIndex];
                        item.category_name = el.value ? (opt.textContent || '').trim().replace(/^\S+\s/, '') : null;
                    }
                } else if (field === 'type') {
                    item.type = el.value;
                    // 类型切换会改变分类候选集与账户结构，旧类目必然失效
                    item.category_id = null;
                    item.category_name = null;
                    this._markCorrected(item, 'type');
                    this._render();   // 整行结构变化，重绘
                    return;
                } else {
                    item[field] = el.value;
                }

                this._markCorrected(item, this._confKeyOf(field));
                this._syncCommitLabel();
            });
        });

        document.querySelectorAll('#aiSmartList [data-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.del, 10);
                this.items.splice(idx, 1);
                if (!this.items.length) {
                    // 全部移除等价于放弃这次预测
                    showToast('已移除全部候选，将弃置本次识别', 'info');
                    this.discard('用户移除了全部候选');
                    return;
                }
                this._render();
            });
        });
    },

    // 编辑字段名 → confidence/evidence 的键名映射
    _confKeyOf(field) {
        if (field === 'amount') return 'amount';
        if (field === 'type') return 'type';
        if (field === 'date') return 'date';
        if (field === 'category_id') return 'category';
        if (field === 'account_id' || field === 'from_account_id' || field === 'to_account_id') return null;
        return null;  // note / merchant 不参与裁决
    },

    // 人工修正 ⇒ 该字段置信度置为 1.0，证据标记 user_corrected
    _markCorrected(item, confKey) {
        if (!confKey) return;
        if (!item.confidence) item.confidence = {};
        if (!item.evidence) item.evidence = {};
        item.confidence[confKey] = 1.0;
        item.evidence[confKey] = 'user_corrected';
    },

    // 是否相对 parse 原始快照有改动（决定 action = confirmed / corrected）
    _isDirty() {
        if (this.items.length !== this.original.length) return true;
        const KEYS = ['type', 'amount', 'category_id', 'account_id',
                      'from_account_id', 'to_account_id', 'date', 'note'];
        for (let i = 0; i < this.items.length; i++) {
            const a = this.items[i], b = this.original[i];
            if (!b || a.seq !== b.seq) return true;
            for (const k of KEYS) {
                const av = a[k] == null ? null : a[k];
                const bv = b[k] == null ? null : b[k];
                if (k === 'amount') {
                    if (Math.abs(Number(av || 0) - Number(bv || 0)) > 1e-9) return true;
                } else if (String(av) !== String(bv)) {
                    return true;
                }
            }
        }
        return false;
    },

    _syncCommitLabel() {
        const btn = document.getElementById('aiSmartCommitBtn');
        if (!btn) return;
        const n = this.items.length;
        btn.textContent = this._isDirty() ? `✅ 按修正后提交（${n} 笔）` : `✅ 确认并记账（${n} 笔）`;
    },

    // ========== 步骤 3：提交 ==========
    async commit() {
        if (this.busy || !this.predictionId) return;
        if (!this.items.length) { showToast('没有可提交的交易', 'warning'); return; }

        // 前置自检：给出比服务端 422 更具体的定位提示，避免用户来回猜
        for (const it of this.items) {
            const tag = `第 ${it.seq} 笔`;
            if (!(Number(it.amount) > 0)) { showToast(`${tag}金额无效`, 'warning'); return; }
            if (it.type === 'transfer') {
                if (!it.from_account_id || !it.to_account_id) { showToast(`${tag}请选择转出与转入账户`, 'warning'); return; }
                if (it.from_account_id === it.to_account_id) { showToast(`${tag}转出与转入账户不能相同`, 'warning'); return; }
            } else if (!it.account_id) {
                showToast(`${tag}请选择账户`, 'warning'); return;
            }
        }

        const dirty = this._isDirty();
        this._setBusy(true, 'commit');
        try {
            const body = {
                action: dirty ? 'corrected' : 'confirmed',
                idempotency_key: this.idemKey
            };
            // action=confirmed 时不回传 transactions，由后端直接采用不可变快照
            if (dirty) body.transactions = this.items;

            const res = await api(`/ai/predictions/${this.predictionId}/commit`, 'POST', body, { silent: true });
            const n = (res && res.transactions) ? res.transactions.length : this.items.length;
            showToast(`${(res && res.message) || '提交成功'} · ${n} 笔已记账`, 'success');

            this._reset();
            await initCache();
            if (window.DashboardManager) await DashboardManager.refresh();
        } catch (err) {
            const p = err.payload || {};
            const msg = p.message || err.message || '提交失败';
            // 409：预测已被提交或已弃置（状态机单向不可逆），本地状态已过期，
            // 清空避免用户反复点击。以状态码判定而非错误文案，后端改文案不会失效。
            if (err.status === 409) {
                showToast(msg + '，已重置识别结果', 'warning');
                this._reset();
            } else {
                showToast(msg, 'error');
                // 422 校验失败会带 details（完整 revalidation），刷新高亮帮助用户定位
                if (p.details && p.details.per_txn) {
                    this.validation = p.details;
                    this.verdict = p.details.verdict;
                    this.reasons = p.details.reasons || [];
                    this._render();
                }
            }
        } finally {
            this._setBusy(false, 'commit');
        }
    },

    // ========== 步骤 3'：弃置 ==========
    async discard(reason) {
        if (this.busy || !this.predictionId) { this._reset(); return; }
        this._setBusy(true, 'discard');
        try {
            await api(`/ai/predictions/${this.predictionId}/discard`, 'POST',
                { reason: reason || 'user_discarded' }, { silent: true });
            showToast('已弃置本次识别', 'info');
        } catch (err) {
            // 弃置失败不影响用户继续使用，仅提示
            showToast((err.payload && err.payload.message) || '弃置失败', 'warning');
        } finally {
            this._setBusy(false, 'discard');
            this._reset();
        }
    },

    // ========== 内部工具 ==========
    _reset() {
        this.predictionId = null;
        this.original = [];
        this.items = [];
        this.validation = null;
        this.verdict = null;
        this.reasons = [];
        this.overall = null;
        this.idemKey = null;
        this._hide('aiSmartConfirm');
        const input = document.getElementById('aiSmartText');
        if (input) input.value = '';
    },

    _newIdemKey(pid) {
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        return `web-${pid}-${rand}`.slice(0, 64);   // 后端限制 64 字符
    },

    _setBusy(busy, which) {
        this.busy = busy;
        const map = { parse: 'aiSmartParseBtn', commit: 'aiSmartCommitBtn', discard: 'aiSmartDiscardBtn' };
        Object.values(map).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = busy;
        });
        const btn = document.getElementById(map[which]);
        if (btn) btn.classList.toggle('is-loading', busy);
    },

    _show(id) { const el = document.getElementById(id); if (el) el.style.display = 'block'; },
    _hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
};

export default AISmartEntry;
