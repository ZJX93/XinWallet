// ==========================================
// DebtManager — 债权债务管理
// 应付账款 (Payable) + 应收账款 (Receivable)
// ==========================================

const DebtManager = {
    _currentDir: 'payable',     // 模态框选中的方向
    _filter: 'all',              // 列表筛选
    _listCache: [],              // 最近一次拉到的全量列表（供 repay 模态查 direction）
    _autoCalcLock: false,        // 日期/期数自动推导互锁，防循环

    init() {
        document.getElementById('addDebtBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('debtModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('debtCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('debtForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        // 列表上方 Tab 切换
        document.querySelectorAll('[data-debt-dir]').forEach(el => {
            el.addEventListener('click', () => { this._filter = el.dataset.debtDir; this.refresh(); });
        });
        // 模态框内方向 Tab
        document.querySelectorAll('[data-form-dir]').forEach(el => {
            el.addEventListener('click', () => { this._currentDir = el.dataset.formDir; this.onDirChange(); });
        });
        // 收/还款模态框
        document.getElementById('repayModalClose').addEventListener('click', () => this.closeRepayModal());
        document.getElementById('repayCancelBtn').addEventListener('click', () => this.closeRepayModal());
        document.getElementById('repayForm').addEventListener('submit', (e) => { e.preventDefault(); this.saveRepay(); });
        // 明细模态框
        document.getElementById('repayHistoryModalClose').addEventListener('click', () => this.closeRepayHistory());
        document.getElementById('repayHistoryModal').addEventListener('click', (e) => { if (e.target === document.getElementById('repayHistoryModal')) this.closeRepayHistory(); });
        // 科目类别 → 信用卡字段显隐
        document.getElementById('debtType').addEventListener('change', () => this.onTypeChange());
        // 起息日 / 到期日 / 贷款期数 三选二自动推第三
        ['debtStart', 'debtDue', 'debtTerm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this._autoCalcDates(id));
        });
        // 月供实时预览（对齐银行计算）
        ['debtPrincipal', 'debtRate', 'debtTerm', 'debtMethod', 'debtMonthly'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this._updateMonthlyPreview());
        });
    },

    // 等额本息/等额本金/先息后本 月供（与后端 calcMonthlyPayment 一致的央行公式）
    _calcMonthlyPayment(P, annualRate, n, method) {
        P = parseFloat(P) || 0;
        const r = (parseFloat(annualRate) || 0) / 100 / 12;
        n = parseInt(n) || 0;
        if (P <= 0) return 0;
        if (method === 'equal_installment') {
            if (n <= 0) return 0;
            if (r === 0) return P / n;
            const pow = Math.pow(1 + r, n);
            return (P * r * pow) / (pow - 1);
        }
        if (method === 'equal_principal') {
            if (n <= 0) return 0;
            return P / n + P * r; // 首期月供
        }
        if (method === 'interest_only') return P * r;
        return 0;
    },

    // 由实际月供反推银行实际执行年利率（牛顿迭代），返回百分数
    _calcImpliedRate(P, n, monthly) {
        P = parseFloat(P) || 0; n = parseInt(n) || 0; monthly = parseFloat(monthly) || 0;
        if (P <= 0 || n <= 0 || monthly <= 0) return null;
        if (monthly <= P / n) return 0;
        let r = 0.005;
        for (let i = 0; i < 80; i++) {
            const one = 1 + r;
            const pow = Math.pow(one, n);
            const f = P * r * pow / (pow - 1) - monthly;
            const df = P * (pow * (pow - 1) - r * n * pow) / Math.pow(pow - 1, 2);
            if (Math.abs(df) < 1e-15) break;
            const rNext = r - f / df;
            if (Math.abs(rNext - r) < 1e-16) { r = rNext; break; }
            r = rNext;
        }
        if (!(r > 0)) return null;
        return r * 12 * 100;
    },

    // 实时预览：理论月供 + 等效利率（当实际月供与公式不符时反推，仅作参考）
    _updateMonthlyPreview() {
        const hint = document.getElementById('debtMonthlyHint');
        if (!hint) return;
        const methodEl = document.getElementById('debtMethod');
        const method = methodEl ? methodEl.value : 'manual';
        const auto = ['equal_installment', 'equal_principal', 'interest_only'].includes(method);
        if (!auto) { hint.textContent = '手动还款类：月供以“每期应还”为准'; return; }
        const P = parseFloat(document.getElementById('debtPrincipal').value);
        const rate = parseFloat(document.getElementById('debtRate').value);
        const term = parseInt(document.getElementById('debtTerm').value);
        if (!(P > 0) || !(term > 0)) { hint.textContent = '填写本金与期数后自动测算月供'; return; }
        const m = this._calcMonthlyPayment(P, rate, term, method);
        let txt = `按公式理论月供 ≈ ¥${m.toFixed(2)}`;
        const actual = parseFloat(document.getElementById('debtMonthly').value);
        if (document.getElementById('debtMonthly').value !== '' && actual > 0 && method === 'equal_installment') {
            if (Math.abs(actual - m) > 0.005) {
                const implied = this._calcImpliedRate(P, term, actual);
                if (implied != null) txt += ` ｜ 等效利率 ≈ ${implied.toFixed(4)}%（实际仍按上方利率计息）`;
            } else {
                txt += '（与公式一致）';
            }
        }
        hint.textContent = txt;
    },

    async refresh() {
        const container = document.getElementById('debtList');
        showSkeleton(container, 4, 'grid');
        try {
        const res = await api('/debts');
        if (!res) { showEmpty(container, '加载失败，请检查网络'); return; }
        const s = res.summary || {};
        this._listCache = res.debts || [];

        // Tab 高亮
        document.querySelectorAll('[data-debt-dir]').forEach(el => {
            el.classList.toggle('active', el.dataset.debtDir === this._filter);
        });

        // 4 个 KPI
        const totalEl = document.getElementById('debtTotalRemaining');
        const monthlyEl = document.getElementById('debtTotalMonthly');
        const dueEl = document.getElementById('debtDueThisMonth');
        const dueFootEl = document.getElementById('debtDueThisMonthFoot');
        const overdueEl = document.getElementById('debtOverdue');
        const overdueFootEl = document.getElementById('debtOverdueFoot');
        const countEl = document.getElementById('debtCount');
        if (totalEl) totalEl.textContent = fmt(s.netDebt !== undefined ? s.netDebt : (s.totalRemaining || 0));
        if (monthlyEl) monthlyEl.textContent = fmt((s.payable && s.payable.monthly) || s.totalMonthly || 0);
        if (dueEl) dueEl.textContent = (s.payable ? s.payable.dueThisMonth : s.dueThisMonth || 0) + ' 笔';
        if (dueFootEl) dueFootEl.textContent = '共 ' + fmt((s.payable ? s.payable.dueAmount : s.dueAmount) || 0);
        if (overdueEl) overdueEl.textContent = (s.payable ? s.payable.overdue : s.overdue || 0) + ' 笔';
        if (overdueFootEl) overdueFootEl.textContent = '共 ' + fmt((s.payable ? s.payable.overdueAmount : s.overdueAmount) || 0);
        if (countEl) countEl.textContent = `总计 ${s.count || 0} 项（活动 ${s.activeCount || 0} 项）`;

        // 应收/应付余额（并入顶部汇总区 KPI）
        const p = s.payable || {}, r = s.receivable || {};
        const payRemEl = document.getElementById('debtPayableRemaining');
        const recvRemEl = document.getElementById('debtReceivableRemaining');
        const payFootEl = document.getElementById('debtPayableFoot');
        const recvFootEl = document.getElementById('debtReceivableFoot');
        if (payRemEl) payRemEl.textContent = fmt(p.remaining || 0);
        if (recvRemEl) recvRemEl.textContent = fmt(r.remaining || 0);
        if (payFootEl) payFootEl.textContent = `${p.count || 0} 笔${p.overdue ? ' · 逾期 ' + p.overdue : ''}`;
        if (recvFootEl) recvFootEl.textContent = `${r.count || 0} 笔${r.overdue ? ' · 逾期 ' + r.overdue : ''}`;

        // 应收/应付余额占比条（渲染进顶部汇总区 #debtRatioBar）
        const compEl = document.getElementById('debtRatioBar');
        if (compEl) compEl.innerHTML = this._renderComposition(s);

        // 列表
        const debts = this._listCache.filter(d => this._filter === 'all' || d.direction === this._filter);
        if (!debts.length) {
            const msg = this._filter === 'receivable' ? '暂无应收账款记录' : this._filter === 'payable' ? '暂无应付账款记录' : '暂无债权债务记录';
            showEmpty(container, msg);
            return;
        }
        container.innerHTML = debts.map(d => this._renderRow(d)).join('');
        container.querySelectorAll('[data-action="repay-debt"]').forEach(b => b.addEventListener('click', () => this.openRepayModal(parseInt(b.dataset.id))));
        container.querySelectorAll('[data-action="repay-history"]').forEach(b => b.addEventListener('click', () => this.openRepayHistory(parseInt(b.dataset.id))));
        container.querySelectorAll('[data-action="edit-debt"]').forEach(b => { b.addEventListener('click', () => { const d = this._listCache.find(x => x.id === parseInt(b.dataset.id)); if (d) this.openEditModal(d); }); });
        container.querySelectorAll('[data-action="delete-debt"]').forEach(b => b.addEventListener('click', () => this.delete(parseInt(b.dataset.id))));
        } catch (err) {
            console.error('DebtManager.refresh error:', err);
            showEmpty(container, '加载失败：' + (err.message || '未知错误'));
        }
    },

    // 应收/应付余额占比条（渲染进顶部汇总区 #debtRatioBar，不再重复数字）
    _renderComposition(s) {
        const p = s.payable || {}, r = s.receivable || {};
        const pRem = p.remaining || 0, rRem = r.remaining || 0;
        const total = pRem + rRem || 1;
        const pPct = Math.max(2, Math.min(98, Math.round(pRem / total * 100)));
        const rPct = 100 - pPct;
        const pLbl = pPct >= 12 ? `<span>${pPct}% 应付</span>` : '';
        const rLbl = rPct >= 12 ? `<span>${rPct}% 应收</span>` : '';
        return `
        <div class="dc-bar" role="img" aria-label="应付与应收账款余额占比">
            <div class="dc-bar-seg dc-bar-pay" style="width:${pPct}%">${pLbl}</div>
            <div class="dc-bar-seg dc-bar-recv" style="width:${rPct}%">${rLbl}</div>
        </div>`;
    },

    // 列表行：直接复用项目全局 goal-card 类（与预算卡片完全一致的 HTML 结构）
    _renderRow(d) {
        const isRecv = d.direction === 'receivable';
        const deptLabel = isRecv ? '应收' : '应付';
        const typeName = ({ credit_card: '信用卡', loan: '长期借款', personal: '自然人借贷', other: '其他' })[d.type] || d.type;
        const methodName = ({ equal_installment: '等额本息', equal_principal: '等额本金', interest_only: '按期付息到期还本', minimum: '最低还款', lump_sum: '一次性还本', manual: '手动' })[d.method] || d.method;
        const stLabel = ({ active: '正常', paid_off: '已结清', overdue: '逾期' })[d.status] || d.status;
        // 自动同步出来的信用卡/信用支付债务 principal 恒为 0，欠款全部记在 remaining 上。
        // 若继续拿 principal 当分母，进度恒为 0%、金额全显示 ¥0.00 —— 卡片上看不到任何欠款。
        // 统一以「剩余 + 已还」作本金基数，两类债务都能正确体现金额。
        const paidTotal = parseFloat(d.paid_total) || 0;
        const remain = Math.max(0, parseFloat(d.remaining) || 0);
        const base = (parseFloat(d.principal) || 0) > 0 ? (parseFloat(d.principal) || 0) : (remain + paidTotal);
        const pct = base > 0 ? Math.min(100, Math.round(paidTotal / base * 100)) : 0;
        const stTag = d.status === 'paid_off'
            ? '<span class="goal-status done">已结清</span>'
            : d.status === 'overdue'
                ? '<span class="goal-status overdue">逾期</span>'
                : `<span class="goal-status type">${deptLabel} · ${typeName}</span>`;
        const acc = (d.account_id && (cache.accounts || []).find(a => a.id === d.account_id)) || null;
        const acctLine = acc ? `<div class="goal-sub">${escapeHtml(acc.icon || '')} ${escapeHtml(acc.name)}</div>` : '';
        const term = parseInt(d.term_months) || 0;
        const paidTimes = term > 0 ? Math.round(term * pct / 100) : 0;
        const leftLabel = isRecv ? '已收回' : '已偿付';
        const rightLabel = isRecv ? '待收' : '剩余';
        const leftVal = paidTotal;
        const rightVal = remain;
        const actBtn = isRecv
            ? `<button class="btn btn-primary btn-sm" data-action="repay-debt" data-id="${d.id}">收款</button>`
            : `<button class="btn btn-primary btn-sm" data-action="repay-debt" data-id="${d.id}">还款</button>`;
        const metaLeft = `${pct}% 进度`;
        // 自动同步出来的信用卡/花呗债务：本身是「消费账单」不是「贷款」，
        // method='minimum' 是后端默认值（不代表用户选的还款方式），直接显示「最低还款」会很突兀。
        // 按状态分流：已结清留空、未结清显示账单类型提示、逾期提示逾期计息。
        // 真实利率仅当用户在还款里填了利息、由详情接口反推后在明细弹窗展示。
        const isAutoSync = String(d.note || '').startsWith('自动同步');
        let metaRight;
        if (isAutoSync) {
            if (d.status === 'paid_off') {
                metaRight = ''; // 已结清由右上角标签体现，无需重复信息
            } else if (d.status === 'overdue') {
                metaRight = '逾期计息';
            } else {
                metaRight = d.type === 'credit_card' ? '信用卡账单' : '信用支付';
            }
        } else {
            metaRight = d.interest_rate ? `年利率 ${d.interest_rate}%` : methodName;
        }
        return `
        <div class="goal-card ${d.status === 'paid_off' ? 'completed' : ''} ${d.status === 'overdue' ? 'overdue' : ''}">
            <div class="goal-head">
                <div class="goal-head-text">
                    <div class="goal-title">${escapeHtml(d.name || '')}${d.creditor ? ' · ' + escapeHtml(d.creditor) : ''}</div>
                    ${acctLine}
                </div>
                ${stTag}
            </div>
            <div class="goal-amounts"><span>${leftLabel} ${fmt(leftVal, d.currency)}</span><span>${rightLabel} ${fmt(rightVal, d.currency)}</span></div>
            <div class="goal-progress"><div class="goal-progress-fill ${d.status === 'overdue' ? 'danger' : ''}" style="width:${Math.min(pct, 100)}%"></div></div>
            <div class="goal-amounts"><span class="goal-pct">${metaLeft}</span><span>${metaRight}</span></div>
            <div class="goal-actions">
                ${actBtn}
                <button class="btn btn-ghost btn-sm" data-action="repay-history" data-id="${d.id}">明细</button>
                <button class="btn btn-ghost btn-sm" data-action="edit-debt" data-id="${d.id}">编辑</button>
                <button class="btn btn-ghost btn-sm" data-action="delete-debt" data-id="${d.id}">删除</button>
            </div>
        </div>`;
    },

    onTypeChange() {
        const type = document.getElementById('debtType').value;
        const ccBlock = document.querySelector('.debt-cc-fields');
        if (ccBlock) ccBlock.style.display = type === 'credit_card' ? '' : 'none';
    },

    // 起息日 / 到期日 / 贷款期数：知道任意两个，自动算第三个
    _autoCalcDates(changedId) {
        if (this._autoCalcLock) return;
        const startEl = document.getElementById('debtStart');
        const dueEl = document.getElementById('debtDue');
        const termEl = document.getElementById('debtTerm');
        if (!startEl || !dueEl || !termEl) return;

        const start = startEl.value ? new Date(startEl.value + 'T00:00:00') : null;
        const due = dueEl.value ? new Date(dueEl.value + 'T00:00:00') : null;
        const term = termEl.value === '' ? null : parseInt(termEl.value, 10);
        if (start && !isNaN(start.getTime()) && due && !isNaN(due.getTime())) {
            // 起息 + 到期 -> 期数（按整月差；跨日不足一月按自然月边界计）
            const months = (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth());
            if (months >= 0 && changedId !== 'debtTerm') {
                this._autoCalcLock = true;
                termEl.value = months;
                this._autoCalcLock = false;
            }
            return;
        }
        if (start && term != null && term >= 0 && (changedId === 'debtStart' || changedId === 'debtTerm')) {
            // 起息 + 期数 -> 到期
            const y = start.getFullYear();
            const m = start.getMonth() + term;
            const d = start.getDate();
            const next = new Date(y, m, d);
            // 若目标月没有该日期（如 1.31 + 1 月），回退到目标月最后一天
            if (next.getDate() !== d) next.setDate(0);
            this._autoCalcLock = true;
            dueEl.value = this._fmtDate(next);
            this._autoCalcLock = false;
            return;
        }
        if (due && term != null && term >= 0 && (changedId === 'debtDue' || changedId === 'debtTerm')) {
            // 到期 - 期数 -> 起息
            const y = due.getFullYear();
            const m = due.getMonth() - term;
            const d = due.getDate();
            const prev = new Date(y, m, d);
            if (prev.getDate() !== d) prev.setDate(0);
            this._autoCalcLock = true;
            startEl.value = this._fmtDate(prev);
            this._autoCalcLock = false;
        }
    },

    _fmtDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    // 填充账户下拉（新增/编辑债务时可选关联账户）
    _populateAccountSelect(selId, selectedId) {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const current = selectedId != null && selectedId !== '' ? String(selectedId) : sel.value;
        sel.innerHTML = '<option value="">— 不关联 —</option>';
        (cache.accounts || []).forEach(a => {
            sel.innerHTML += `<option value="${a.id}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)}</option>`;
        });
        if (current) sel.value = current;
    },

    // 多币种 P2-2c：填充债务币种下拉（沿用 supportedCurrencies，与账户货币一致）
    _populateCurrencySelect(selId, selected) {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const list = window.supportedCurrencies || ['CNY','USD','EUR','HKD','JPY','GBP','AUD','CAD'];
        const cur = (selected || 'CNY').toUpperCase();
        sel.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
        if (list.includes(cur)) sel.value = cur;
        else sel.value = 'CNY';
    },

    onDirChange() {
        const isRecv = this._currentDir === 'receivable';
        const editId = document.getElementById('debtEditId').value;
        const title = document.getElementById('debtModalTitle');
        if (title) title.textContent = (editId ? '编辑' : '新增') + (isRecv ? '应收账款' : '应付账款');
        // 切换对方标签
        const cpLabel = document.querySelector('[data-counterparty-label]');
        if (cpLabel) cpLabel.textContent = isRecv ? '债务人（对方）' : '债权人（对方）';
        // 同步模态框 Tab 高亮
        document.querySelectorAll('[data-form-dir]').forEach(el => {
            el.classList.toggle('active', el.dataset.formDir === this._currentDir);
        });
        // 同步隐藏字段
        const hidden = document.getElementById('debtDirection');
        if (hidden) hidden.value = this._currentDir;
    },

    openAddModal() {
        document.getElementById('debtModal').classList.add('show');
        document.getElementById('debtEditId').value = '';
        ['debtName','debtType','debtCreditor','debtPrincipal','debtRate','debtTerm','debtMethod','debtMonthly','debtStart','debtDue','debtBillingDay','debtPaymentDay','debtMinPayment','debtNote','debtAccount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this._updateMonthlyPreview();
        document.getElementById('debtType').value = 'loan';
        document.getElementById('debtMethod').value = 'manual';
        // 默认沿用当前列表的筛选方向
        this._currentDir = this._filter === 'receivable' ? 'receivable' : 'payable';
        this.onDirChange();
        this.onTypeChange();
        this._populateAccountSelect('debtAccount', '');
        this._populateCurrencySelect('debtCurrency', 'CNY');
    },

    openEditModal(d) {
        document.getElementById('debtModal').classList.add('show');
        document.getElementById('debtEditId').value = d.id;
        document.getElementById('debtName').value = d.name || '';
        document.getElementById('debtType').value = d.type || 'loan';
        document.getElementById('debtCreditor').value = d.creditor || '';
        document.getElementById('debtPrincipal').value = d.principal || '';
        document.getElementById('debtRate').value = d.interest_rate || '';
        document.getElementById('debtTerm').value = d.term_months || '';
        document.getElementById('debtMethod').value = d.method || 'manual';
        document.getElementById('debtMonthly').value = d.monthly_payment || '';
        document.getElementById('debtStart').value = d.start_date || '';
        document.getElementById('debtDue').value = d.due_date || '';
        document.getElementById('debtBillingDay').value = d.billing_day || '';
        document.getElementById('debtPaymentDay').value = d.payment_day || '';
        document.getElementById('debtMinPayment').value = d.min_payment || '';
        document.getElementById('debtNote').value = d.note || '';
        this._currentDir = d.direction || 'payable';
        this.onDirChange();
        this.onTypeChange();
        this._populateAccountSelect('debtAccount', d.account_id || '');
        this._populateCurrencySelect('debtCurrency', d.currency || 'CNY');
    },

    closeModal() { document.getElementById('debtModal').classList.remove('show'); },

    async save() {
        const editId = document.getElementById('debtEditId').value;
        const payload = {
            direction: this._currentDir,
            name: document.getElementById('debtName').value.trim(),
            type: document.getElementById('debtType').value,
            creditor: document.getElementById('debtCreditor').value.trim(),
            principal: parseFloat(document.getElementById('debtPrincipal').value) || 0,
            interest_rate: parseFloat(document.getElementById('debtRate').value) || 0,
            term_months: parseInt(document.getElementById('debtTerm').value) || 0,
            method: document.getElementById('debtMethod').value,
            monthly_payment: parseFloat(document.getElementById('debtMonthly').value) || 0,
            start_date: document.getElementById('debtStart').value || null,
            due_date: document.getElementById('debtDue').value || null,
            billing_day: parseInt(document.getElementById('debtBillingDay').value) || null,
            payment_day: parseInt(document.getElementById('debtPaymentDay').value) || null,
            min_payment: parseFloat(document.getElementById('debtMinPayment').value) || 0,
            account_id: document.getElementById('debtAccount').value || null,
            // 多币种 P2-2c：债务币种（独立于关联账户币种）
            currency: document.getElementById('debtCurrency').value || 'CNY',
            note: document.getElementById('debtNote').value.trim()
        };
        if (!payload.name) { showToast('请填写项目名称', 'error'); return; }
        if (payload.principal <= 0) { showToast('请填写有效本金', 'error'); return; }
        try {
            if (editId) {
                await api(`/debts/${editId}`, 'PUT', payload);
                showToast('已保存', 'success');
            } else {
                await api('/debts', 'POST', payload);
                showToast(payload.direction === 'receivable' ? '应收账款已记录' : '应付账款已记录', 'success');
            }
            this.closeModal();
            await this.refresh();
        } catch (e) { showToast('保存失败：' + (e.message || '未知错误'), 'error'); }
    },

    async delete(id) {
        if (!confirm('确定删除该条债权/债务及其全部明细吗？')) return;
        try {
            await api(`/debts/${id}`, 'DELETE');
            showToast('已删除', 'success');
            await this.refresh();
        } catch (err) { showToast('删除失败：' + (err.message || '未知错误'), 'error'); }
    },

    openRepayModal(id, rep = null) {
        document.getElementById('repayModal').classList.add('show');
        document.getElementById('repayDebtId').value = id;
        const debt = this._listCache.find(d => d.id === id);
        const isRecv = debt && debt.direction === 'receivable';
        // 编辑模式：预填原还款记录
        if (rep) {
            this._editingRepay = { debtId: id, rid: rep.id };
            document.getElementById('repayAmount').value = rep.amount || '';
            document.getElementById('repayPrincipal').value = (rep.principal_part != null ? rep.principal_part : '');
            document.getElementById('repayInterest').value = (rep.interest_part != null ? rep.interest_part : '');
            document.getElementById('repayDate').value = rep.paid_at ? fmtDateTimeLocal(rep.paid_at) : fmtDateTimeLocal();
            document.getElementById('repayNote').value = rep.note || '';
        } else {
            this._editingRepay = null;
            ['repayAmount','repayPrincipal','repayInterest','repayNote'].forEach(rid => { const el = document.getElementById(rid); if (el) el.value = ''; });
            document.getElementById('repayDate').value = fmtDateTimeLocal();
        }
        const titleEl = document.getElementById('repayModalTitle');
        if (titleEl) titleEl.textContent = rep ? '修改还款记录' : (isRecv ? '登记应收账款回款' : '登记应付账款偿付');
        const submitBtn = document.getElementById('repaySubmitBtn');
        if (submitBtn) submitBtn.textContent = rep ? '保存修改' : (isRecv ? '确认收款' : '确认还款');
        const accLabel = document.querySelector('[data-repay-account-label]');
        if (accLabel) accLabel.textContent = (isRecv ? '收款' : '付款') + '账户 *';
        const sel = document.getElementById('repayAccount');
        sel.innerHTML = '<option value="">-- 请选择账户 * --</option>';
        (cache.accounts || []).forEach(a => { sel.innerHTML += `<option value="${a.id}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)}</option>`; });
        const debtAcc = (cache.accounts || []).find(a => String(a.id) === String(debt && debt.account_id));
        const isCreditAcc = !!debtAcc && (debtAcc.type === 'credit_card'
            || (debtAcc.type === 'electronic_payment' && parseFloat(debtAcc.credit_limit) > 0));
        // 编辑模式优先用还款记录自身的账户；否则预填债务关联账户（授信账户不预填）
        if (rep && rep.account_id) sel.value = rep.account_id;
        else if (debt && debt.account_id && !isCreditAcc) sel.value = debt.account_id;
        else sel.value = '';
        const hintEl = document.getElementById('repayAccountHint');
        if (hintEl) {
            if (!isRecv && isCreditAcc) {
                hintEl.textContent = `选择实际出钱的账户，还款后「${debtAcc.name}」的已用额度会同步恢复`;
                hintEl.style.display = '';
            } else {
                hintEl.textContent = '';
                hintEl.style.display = 'none';
            }
        }
    },

    closeRepayModal() {
        const editing = this._editingRepay;
        document.getElementById('repayModal').classList.remove('show');
        this._editingRepay = null;
        // 编辑模式（从明细弹窗进入）关闭后，重新拉起明细弹窗以刷新内容
        if (editing && editing.debtId) this.openRepayHistory(editing.debtId);
    },

    async saveRepay() {
        try {
            const debtId = document.getElementById('repayDebtId').value;
            const amount = parseFloat(document.getElementById('repayAmount').value) || 0;
            if (amount <= 0) { showToast('请输入有效金额', 'error'); return; }
            const ppVal = document.getElementById('repayPrincipal').value;
            const ipVal = document.getElementById('repayInterest').value;
            const accId = document.getElementById('repayAccount').value;
            if (!accId) { showToast('请选择账户', 'error'); return; }
            const payload = {
                amount,
                paid_at: document.getElementById('repayDate').value,
                note: document.getElementById('repayNote').value.trim(),
                account_id: accId,
                principal_part: ppVal !== '' ? parseFloat(ppVal) : undefined,
                interest_part: ipVal !== '' ? parseFloat(ipVal) : undefined
            };
            if (this._editingRepay) {
                const { debtId: did, rid } = this._editingRepay;
                await api(`/debts/${did}/repayments/${rid}`, 'PUT', payload);
                showToast('还款记录已更新', 'success');
                this.closeRepayModal();
                await this.refresh();
                await this.syncAccountsAfterRepayChange();
                return;
            }
            const debt = this._listCache.find(d => d.id === parseInt(debtId));
            const isRecv = debt && debt.direction === 'receivable';
            await api(`/debts/${debtId}/repayments`, 'POST', payload);
            showToast(isRecv ? '收款已登记' : '还款已登记', 'success');
            this.closeRepayModal();
            await this.refresh();
            await this.syncAccountsAfterRepayChange();
        } catch (e) { showToast('保存失败：' + (e.message || '未知错误'), 'error'); }
    },

    /**
     * 登记 / 修改还款后的账户侧统一刷新（与「删除还款」那条分支保持对称）。
     *
     * 还款会从付款账户扣款、收款方向入账，后端已重算账户余额。
     * 只刷债务列表的话，账户页卡片余额与 Dashboard KPI 仍是旧值（要切页才自愈）。
     */
    async syncAccountsAfterRepayChange() {
        await initCache();
        if (window.AccountManager) await window.AccountManager.refresh();
        if (window.DashboardManager) await window.DashboardManager.refresh();
    },

    // 明细弹窗（保持原结构）
    async openRepayHistory(id) {
        const modal = document.getElementById('repayHistoryModal');
        const body = document.getElementById('repayHistoryBody');
        modal.classList.add('show');
        body.innerHTML = '<div class="empty-state">加载中…</div>';
        const res = await api(`/debts/${id}`);
        if (!res) { body.innerHTML = '<div class="empty-state">加载失败，请检查网络</div>'; return; }
        const d = res.debt || {};
        const list = res.repayments || [];
        const isRecv = d.direction === 'receivable';
        // 防 U+FFFD（数据库里历史脏数据）—— 整字段全是替换字符视为空
        const isGarbled = (s) => typeof s === 'string' && s.length > 0 && /^\uFFFD+$/.test(s);
        const safe = (s, fallback = '<空>') => (!s || isGarbled(s)) ? fallback : s;
        const safeNote = (s) => (!s || isGarbled(s)) ? '' : s;
        // 仅有真实利息记录时才展示「已产生利息 + 等效年化」，避免凭空显示利率上限
        const interestPaid = parseFloat(d.interest_paid_total) || 0;
        const interestLine = interestPaid > 0
            ? `<div class="rh-sub">📈 已产生利息 ${fmt(interestPaid, d.currency)} · 等效年化 ≈ ${d.effective_rate != null ? d.effective_rate.toFixed(2) : '—'}%</div>`
            : '';
        const head = `<div class="rh-head">
            <div class="rh-debt">${escapeHtml(safe(d.name))} · ${isRecv ? '应收账款' : '应付账款'}</div>
            <div class="rh-sub">对方：${escapeHtml(safe(d.creditor, '—'))} · ${isRecv ? '待收' : '剩余'}本金 ${fmt(d.remaining || 0, d.currency)} · 累计${isRecv ? '已收' : '已偿'} ${fmt(d.paid_total || 0, d.currency)} · 共 ${list.length} 笔</div>
            ${interestLine}
        </div>`;
        if (!list.length) {
            body.innerHTML = head + `<div class="empty-state">暂无${isRecv ? '收款' : '还款'}记录</div>`;
            return;
        }
        const rows = list.map(r => `
            <div class="rh-item" data-repay-id="${r.id}">
                <div class="rh-row1">
                    <span class="rh-amount">${fmt(r.amount, d.currency)}</span>
                    <span class="rh-date">${r.paid_at || ''}</span>
                    <span class="rh-actions">
                        <button class="rh-edit-btn" data-repay-id="${r.id}" data-debt-id="${id}">修改</button>
                        <button class="rh-del-btn" data-repay-id="${r.id}" data-debt-id="${id}">删除</button>
                    </span>
                </div>
                <div class="rh-row2">
                    <span class="rh-tag">本金 ${fmt(r.principal_part, d.currency)} / 利息 ${fmt(r.interest_part, d.currency)}</span>
                    ${r.account_name ? `<span class="rh-acc">${escapeHtml(r.account_icon || '')} ${escapeHtml(r.account_name)}</span>` : ''}
                </div>
                ${safeNote(r.note) ? `<div class="rh-note">📝 ${escapeHtml(safeNote(r.note))}</div>` : ''}
            </div>`).join('');
        body.innerHTML = head + `<div class="rh-list">${rows}</div>`;
        // 修改：复用登记弹窗预填，保存走 PUT /debts/:debtId/repayments/:rid
        body.querySelectorAll('.rh-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rid = parseInt(btn.dataset.repayId);
                const did = parseInt(btn.dataset.debtId);
                const rec = list.find(x => x.id === rid);
                if (!rec) return;
                // 先隐藏明细弹窗，避免与修改弹窗重叠被遮挡
                this.closeRepayHistory();
                this.openRepayModal(did, rec);
            });
        });
        // 删除：调 DELETE /debts/:debtId/repayments/:rid，后端级联删双腿 + 还款记录并回滚余额
        body.querySelectorAll('.rh-del-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const rid = parseInt(btn.dataset.repayId);
                const did = parseInt(btn.dataset.debtId);
                if (!confirm('确定要删除这条还款记录吗？\n\n会同时撤销该笔产生的两条流水、回滚账户余额与债务剩余本金。此操作不可撤销。')) return;
                try {
                    await api(`/debts/${did}/repayments/${rid}`, 'DELETE');
                    showToast('还款记录已删除', 'warning');
                    await this.openRepayHistory(did);
                    await this.refresh();
                    // 还款回滚了账户余额（后端已重算），需刷新账户缓存/账户列表/Dashboard
                    await initCache();
                    if (window.AccountManager) await window.AccountManager.refresh();
                    if (window.DashboardManager) await window.DashboardManager.refresh();
                } catch (err) { /* api() 已 toast */ }
            });
        });
    },

    closeRepayHistory() { document.getElementById('repayHistoryModal').classList.remove('show'); }
};

export default DebtManager;
