// ==========================================
// SavingsGoalManager — 储蓄目标管理
// 拆分自 public/js/app.js
// 原始位置: 第 4441 行 — 第 4682 行 (const SavingsGoalManager = { ... };)
// 整合理财模块，参考 Firefly III piggy banks
// ==========================================

const SavingsGoalManager = {
    init() {
        if (this._initialized) return;
        this.goals = [];
        this.pending = null;
        const form = document.getElementById('goalForm');
        if (!form) return;
        this._initialized = true;
        document.getElementById('addGoalBtn').addEventListener('click', () => this.openModal());
        document.getElementById('goalModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('goalCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('goalForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        // 金额输入弹窗
        document.getElementById('goalAmountClose').addEventListener('click', () => this.closeAmountModal());
        document.getElementById('goalAmountCancel').addEventListener('click', () => this.closeAmountModal());
        document.getElementById('goalAmountForm').addEventListener('submit', (e) => { e.preventDefault(); this.confirmAmount(); });
        // 储蓄流水弹窗
        document.getElementById('savingsHistoryClose').addEventListener('click', () => document.getElementById('savingsHistoryModal').classList.remove('show'));
        document.getElementById('savingsHistoryModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) document.getElementById('savingsHistoryModal').classList.remove('show'); });
        document.getElementById('savingsGoalList').addEventListener('click', (e) => {
            const a = e.target.closest('[data-alloc]'); if (a) { this.openAmountModal(parseInt(a.dataset.alloc), 'allocate'); return; }
            const w = e.target.closest('[data-withdraw]'); if (w) { this.openAmountModal(parseInt(w.dataset.withdraw), 'withdraw'); return; }
            const h = e.target.closest('[data-history]'); if (h) { this.showHistory(parseInt(h.dataset.history)); return; }
            const ed = e.target.closest('[data-edit]'); if (ed) { this.edit(parseInt(ed.dataset.edit)); return; }
            const d = e.target.closest('[data-del]'); if (d) { this.remove(parseInt(d.dataset.del)); }
        });
    },
    openModal() {
        document.getElementById('goalEditId').value = '';
        document.getElementById('goalModalTitle').textContent = tt('goal.modal.addTitle', '新建储蓄目标');
        document.getElementById('goalName').value = '';
        document.getElementById('goalTarget').value = '';
        document.getElementById('goalIcon').value = '🎯';
        document.getElementById('goalNote').value = '';
        this.populateAccounts();
        this.populateSourceAccounts();
        document.getElementById('goalAccount').value = '';
        document.getElementById('goalSource').value = '';
        document.getElementById('goalModal').classList.add('show');
    },
    populateAccounts() {
        const sel = document.getElementById('goalAccount');
        sel.innerHTML = `<option value="">${escapeHtml(tt('goal.select.savingsAccount', '请选择储蓄账户 *'))}</option>` + (cache.accounts || []).map(a => `<option value="${a.id}">${escapeHtml(a.icon || "")} ${escapeHtml(a.name)} (${fmt(a.balance, a.currency || 'CNY')})</option>`).join('');
    },
    populateSourceAccounts() {
        const sel = document.getElementById('goalSource');
        sel.innerHTML = `<option value="">${escapeHtml(tt('goal.select.sourceAccount', '请选择来源账户 *'))}</option>` + (cache.accounts || []).map(a => `<option value="${a.id}">${escapeHtml(a.icon || "")} ${escapeHtml(a.name)} (${fmt(a.balance, a.currency || 'CNY')})</option>`).join('');
    },
    edit(id) {
        const g = (this.goals || []).find(x => x.id === id);
        if (!g) { showToast(tt('goal.toast.notFound', '目标不存在'), 'error'); return; }
        document.getElementById('goalEditId').value = g.id;
        document.getElementById('goalModalTitle').textContent = tt('goal.modal.editTitle', '编辑储蓄目标');
        document.getElementById('goalName').value = g.name;
        document.getElementById('goalTarget').value = g.target_amount;
        document.getElementById('goalIcon').value = g.icon || '🎯';
        document.getElementById('goalNote').value = g.note || '';
        this.populateAccounts();
        this.populateSourceAccounts();
        document.getElementById('goalAccount').value = g.account_id || '';
        document.getElementById('goalSource').value = g.source_account_id || '';
        document.getElementById('goalModal').classList.add('show');
    },
    closeModal() { document.getElementById('goalModal').classList.remove('show'); },
    async save() {
        const editId = document.getElementById('goalEditId').value;
        const body = {
            name: document.getElementById('goalName').value.trim(),
            target_amount: parseFloat(document.getElementById('goalTarget').value) || 0,
            account_id: document.getElementById('goalAccount').value ? parseInt(document.getElementById('goalAccount').value) : null,
            source_account_id: document.getElementById('goalSource').value ? parseInt(document.getElementById('goalSource').value) : null,
            icon: document.getElementById('goalIcon').value || '🎯',
            note: document.getElementById('goalNote').value
        };
        if (!body.name) { showToast(tt('goal.toast.nameRequired', '请输入目标名称'), 'error'); return; }
        if (!body.target_amount || body.target_amount <= 0) { showToast(tt('goal.toast.targetRequired', '请输入有效目标金额'), 'error'); return; }
        if (!body.account_id) { showToast(tt('goal.toast.accountRequired', '请选择储蓄账户'), 'error'); return; }
        if (!body.source_account_id) { showToast(tt('goal.toast.sourceRequired', '请选择来源账户'), 'error'); return; }
        if (body.source_account_id === body.account_id) { showToast(tt('goal.toast.sourceSameAsAccount', '来源账户不能与储蓄账户相同'), 'error'); return; }
        if (editId) {
            try {
                await api(`/savings-goals/${editId}`, 'PUT', body);
                showToast(tt('goal.toast.updated', '储蓄目标已更新'), 'success');
            } catch (err) {
                // api() 已显示错误 toast
                return;
            }
        } else {
            try {
                await api('/savings-goals', 'POST', body);
                showToast(tt('goal.toast.created', '储蓄目标已创建'), 'success');
            } catch (err) {
                // api() 已显示错误 toast
                return;
            }
        }
        this.closeModal();
        await this.refresh();
    },
    openAmountModal(id, type) {
        const g = (this.goals || []).find(x => x.id === id);
        if (!g) return;
        if (!g.account_id) { showToast(tt('goal.toast.noAccount', '该目标未关联储蓄账户，请先在编辑中选择储蓄账户'), 'error'); return; }
        this.pending = { id, type };
        const cur = parseFloat(g.current_amount) || 0;
        const target = parseFloat(g.target_amount) || 0;
        const remaining = Math.max(0, target - cur);
        const isAlloc = type === 'allocate';
        document.getElementById('goalAmountTitle').textContent = isAlloc
            ? tt('goal.amount.depositTitle', '存入金额')
            : tt('goal.amount.withdrawTitle', '取回金额');
        document.getElementById('goalAmountLabel').textContent = isAlloc
            ? tt('goal.amount.depositLabel', '存入金额')
            : tt('goal.amount.withdrawLabel', '取回金额');
        document.getElementById('goalAmountMeta').innerHTML =
            `<div>${escapeHtml(g.icon || '🎯')} <strong>${escapeHtml(g.name)}</strong></div>` +
            `<div>${escapeHtml(tt('goal.amount.progress', '已存 {cur} / 目标 {target}（缺口 {gap}）')
                .replace('{cur}', fmt(cur)).replace('{target}', fmt(target)).replace('{gap}', fmt(remaining)))}</div>`;
        const input = document.getElementById('goalAmountInput');
        const errEl = document.getElementById('goalAmountError');
        input.value = '';
        input.classList.remove('input-error');
        errEl.style.display = 'none';
        errEl.textContent = '';
        document.getElementById('goalAmountConfirm').disabled = false;
        input.oninput = () => this.validateAmount(cur, isAlloc);
        // 填充账户下拉（排除目标自身关联的储蓄账户，避免存入/取回时选到它自己）
        const accSel = document.getElementById('goalAmountAccount');
        accSel.innerHTML = `<option value="">${escapeHtml(tt('goal.amount.selectAccount', '-- 请选择账户 * --'))}</option>` +
            (cache.accounts || []).filter(a => Number(a.id) !== Number(g.account_id)).map(a => `<option value="${a.id}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)} (${fmt(a.balance, a.currency || 'CNY')})</option>`).join('');
        // 默认带出目标的来源账户（存入时即默认来源；取回时默认回到来源账户）
        if (g.source_account_id && Number(g.source_account_id) !== Number(g.account_id)) accSel.value = g.source_account_id;
        const quick = document.getElementById('goalQuickAmounts');
        const presets = isAlloc
            ? [100, 500, 1000, { label: tt('goal.amount.fillGap', '填满缺口'), value: remaining }]
            : [100, 500, { label: tt('goal.amount.withdrawAll', '全部取回'), value: cur }];
        quick.innerHTML = presets.map(p => {
            const isObj = typeof p === 'object';
            const label = isObj ? p.label : fmt(p);
            const value = isObj ? (p.value > 0 ? Number(p.value).toFixed(2) : '') : String(p);
            return `<button type="button" class="quick-amount" data-val="${value}">${label}</button>`;
        }).join('');
        quick.querySelectorAll('.quick-amount').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.dataset.val;
                if (v) { input.value = v; this.validateAmount(cur, isAlloc); }
            });
        });
        document.getElementById('goalAmountModal').classList.add('show');
        setTimeout(() => document.getElementById('goalAmountInput').focus(), 50);
    },
    validateAmount(cur, isAlloc) {
        const input = document.getElementById('goalAmountInput');
        const errEl = document.getElementById('goalAmountError');
        const confirmBtn = document.getElementById('goalAmountConfirm');
        const amt = parseFloat(input.value);
        if (!amt || amt <= 0) {
            input.classList.remove('input-error');
            errEl.style.display = 'none';
            errEl.textContent = '';
            confirmBtn.disabled = false;
            return true;
        }
        if (!isAlloc && amt > cur) {
            input.classList.add('input-error');
            errEl.textContent = tt('goal.amount.overLimit', '取回金额不能超过已存金额（{amt}）').replace('{amt}', fmt(cur));
            errEl.style.display = 'block';
            confirmBtn.disabled = true;
            return false;
        }
        input.classList.remove('input-error');
        errEl.style.display = 'none';
        errEl.textContent = '';
        confirmBtn.disabled = false;
        return true;
    },
    async confirmAmount() {
        if (!this.pending) return;
        const g = (this.goals || []).find(x => x.id === this.pending.id);
        const cur = g ? (parseFloat(g.current_amount) || 0) : 0;
        const amt = parseFloat(document.getElementById('goalAmountInput').value);
        if (!amt || amt <= 0) { showToast(tt('goal.toast.amountRequired', '请输入有效金额'), 'error'); return; }
        if (this.pending.type !== 'allocate' && amt > cur) { showToast(tt('goal.toast.overLimit', '取回金额不能超过已存金额'), 'error'); return; }
        const accountId = parseInt(document.getElementById('goalAmountAccount').value) || null;
        if (!accountId) { showToast(tt('goal.toast.pickAccount', '请选择关联账户'), 'error'); return; }
        const { id, type } = this.pending;
        const endpoint = type === 'allocate' ? `/savings-goals/${id}/allocate` : `/savings-goals/${id}/withdraw`;
        await api(endpoint, 'POST', { amount: amt, account_id: accountId });
        showToast(type === 'allocate' ? tt('goal.toast.deposited', '已存入目标') : tt('goal.toast.withdrawn', '已取回'), 'success');
        this.closeAmountModal();
        await initCache();
        await this.refresh();
        // 存入/取回会真实划转账户资金（账户余额已变），账户卡片与 Dashboard KPI 需同步
        if (window.AccountManager) await window.AccountManager.refresh();
        if (window.DashboardManager) await window.DashboardManager.refresh();
    },
    async showHistory(id) {
        const g = (this.goals || []).find(x => x.id === id);
        if (!g) return;
        const data = await api(`/savings-goals/${id}/transactions`);
        if (!data) return;
        const rows = (data.transactions || []).map(t => `
            <tr>
                <td>${t.date}</td>
                <td class="${t.type === 'deposit' ? 'income' : 'expense'}">${t.type === 'deposit' ? '+' : '-'}${fmt(t.amount)}</td>
                <td>${escapeHtml(t.type === 'deposit' ? tt('savings.deposit', '存入') : tt('savings.withdraw', '取出'))}</td>
                <td>${escapeHtml(t.account_name || '-')}</td>
                <td>${escapeHtml(t.note || '')}</td>
            </tr>
        `).join('');
        // 创建弹窗
        const modal = document.getElementById('savingsHistoryModal');
        modal.querySelector('.sh-goal-name').textContent = g.icon + ' ' + g.name;
        modal.querySelector('.sh-deposit').textContent = tt('savings.history.depositN', '存入 {amt}').replace('{amt}', fmt(data.summary.deposit));
        modal.querySelector('.sh-withdraw').textContent = tt('savings.history.withdrawN', '取出 {amt}').replace('{amt}', fmt(data.summary.withdraw));
        modal.querySelector('.sh-net').textContent = tt('savings.history.netN', '净储蓄 {amt}').replace('{amt}', fmt(data.summary.net));
        modal.querySelector('.sh-body').innerHTML = rows
            ? `<table class="report-table"><thead><tr>
                <th>${escapeHtml(tt('savings.history.col.date', '日期'))}</th>
                <th>${escapeHtml(tt('savings.history.col.amount', '金额'))}</th>
                <th>${escapeHtml(tt('savings.history.col.type', '类型'))}</th>
                <th>${escapeHtml(tt('savings.history.col.account', '账户'))}</th>
                <th>${escapeHtml(tt('savings.history.col.note', '备注'))}</th>
              </tr></thead><tbody>${rows}</tbody></table>`
            : `<div class="empty-hint"><p>${escapeHtml(tt('savings.history.empty', '暂无存取记录'))}</p></div>`;
        modal.classList.add('show');
    },

    closeAmountModal() {
        document.getElementById('goalAmountModal').classList.remove('show');
        this.pending = null;
    },
    async remove(id) {
        if (!confirmT('confirm.deleteSavingsGoal', '确定删除该储蓄目标？关联账户中的资金不会被清空，仍保留在该账户内。')) return;
        try {
            await api(`/savings-goals/${id}`, 'DELETE');
            showToast(tt('goal.toast.deleted', '目标已删除'), 'warning');
            await this.refresh();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    async refresh() {
        this.init();  // init 被 null-guard 跳过时，在 refresh 补上
        const container = document.getElementById('savingsGoalList');
        showSkeleton(container, 3, 'grid');
        const goals = await api('/savings-goals');
        this.goals = goals || [];
        if (!goals || goals.length === 0) { showEmpty(container, tt('goal.empty', '还没有储蓄目标，点击「新建目标」开始积累吧')); return; }
        container.innerHTML = goals.map(g => {
            const cur = parseFloat(g.current_amount) || 0;
            const target = parseFloat(g.target_amount) || 0;
            const pct = target > 0 ? Math.min(100, Math.round(cur / target * 100)) : 0;
            const done = g.status === 'completed' || cur >= target;
            // 关联/来源账户说明：中英语序不同，走整句插值键
            const linkText = g.acc_name
                ? tt('goal.card.linked', '关联 {name}').replace('{name}', escapeHtml(g.acc_name))
                : escapeHtml(tt('goal.card.unlinked', '未关联账户'));
            const fromText = g.source_acc_name
                ? ' · ' + tt('goal.card.from', '来源 {name}').replace('{name}', escapeHtml(g.source_acc_name))
                : '';
            return `
            <div class="goal-card ${done ? 'completed' : ''}" data-id="${g.id}">
                <div class="goal-head">
                    <div class="goal-icon">${escapeHtml(g.icon || "🎯")}</div>
                    <div class="goal-title">${escapeHtml(g.name)}</div>
                    ${done ? `<span class="goal-status">${escapeHtml(tt('goal.done', '已达成'))}</span>` : ''}
                </div>
                <div class="goal-amounts"><span>${tt('goal.card.saved', '已存 <strong>{amt}</strong>').replace('{amt}', fmt(cur))}</span><span>${escapeHtml(tt('goal.card.target', '目标 {amt}').replace('{amt}', fmt(target)))}</span></div>
                <div class="goal-progress"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
                <div class="goal-amounts"><span class="goal-pct">${pct}%</span><span>${linkText}${fromText}</span></div>
                ${g.note ? `<div class="goal-note">${escapeHtml(g.note)}</div>` : ''}
                <div class="goal-actions">
                    <button class="btn btn-primary" data-alloc="${g.id}">${escapeHtml(tt('goal.action.deposit', '存入'))}</button>
                    <button class="btn btn-ghost" data-withdraw="${g.id}">${escapeHtml(tt('goal.action.withdraw', '取回'))}</button>
                    <button class="btn btn-ghost" data-history="${g.id}">${escapeHtml(tt('goal.action.history', '流水'))}</button>
                    <button class="btn btn-ghost" data-edit="${g.id}">${escapeHtml(tt('common.edit', '编辑'))}</button>
                    <button class="btn btn-ghost" data-del="${g.id}">${escapeHtml(tt('common.delete', '删除'))}</button>
                </div>
            </div>`;
        }).join('');
    }
};

export default SavingsGoalManager;