// ============================================================
// QuickAdd —— 快速记账模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 3960 行 ~ 第 4070 行（共 111 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、getExpCats、getIncCats、getTransferCats、
//                    showToast、initCache、DashboardManager、TransactionManager、
//                    cache（cache.accounts）、DOM 元素（quickAddBtn、quickAddForm、
//                    quickAddModal、quickCategory、quickAccount、quickAmount、
//                    quickNote、quickBudget、quickFromAcc、quickToAcc、
//                    quickTransferAmount、quickDate、quickNormalFields、
//                    quickTransferFields 等）
// ============================================================

const QuickAdd = {
    init() {
        document.getElementById('quickAddBtn').addEventListener('click', () => this.open());
        document.getElementById('quickAddClose').addEventListener('click', () => this.close());
        document.getElementById('quickCancelBtn').addEventListener('click', () => this.close());
        // 类型切换：支出 / 收入 / 转账
        document.querySelectorAll('#quickAddForm .type-btn').forEach(b => b.addEventListener('click', () => {
            document.querySelectorAll('#quickAddForm .type-btn').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
            b.classList.add('active');
            b.setAttribute('aria-pressed','true');
            this.switchType(b.dataset.type);
        }));
        document.getElementById('quickAddForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    },
    switchType(type) {
        const normal = document.getElementById('quickNormalFields');
        const transfer = document.getElementById('quickTransferFields');
        if (type === 'transfer') {
            normal.style.display = 'none';
            transfer.style.display = '';
            this.updateAccSelects();
            this.updateCatSelect('transfer');
        } else {
            normal.style.display = '';
            transfer.style.display = 'none';
            this.updateCatSelect(type);
            this.updateAccSelect();
        }
    },
    updateCatSelect(type) {
        // 转账有自己的分类（一般转账 / 还信用卡 / 取现 …）
        const cats = type === 'transfer' ? getTransferCats() : (type === 'expense' ? getExpCats() : getIncCats());
        const parents = cats.filter(c => !c.parent_id);
        const children = cats.filter(c => c.parent_id);
        const sel = document.getElementById('quickCategory');
        sel.innerHTML = parents.map(p => {
            const subs = children.filter(c => c.parent_id === p.id);
            if (subs.length > 0) {
                return `<optgroup label="${escapeHtml(p.icon || "📌")} ${escapeHtml(p.name)}">${subs.map(s => `<option value="${s.id}">${escapeHtml(s.icon || "📌")} ${escapeHtml(s.name)}</option>`).join('')}</optgroup>`;
            }
            return `<option value="${p.id}">${escapeHtml(p.icon || "📌")} ${escapeHtml(p.name)}</option>`;
        }).join('');
        // 没有可用分类时给出可提交占位并摘掉 required，让服务端兜底归类
        // （空 select + required 会让表单永远 invalid，记一笔直接卡住）
        const hasCats = sel.options.length > 0;
        sel.required = hasCats;
        if (!hasCats) sel.innerHTML = `<option value="">${escapeHtml(tt('quick.noCatPlaceholder', '（暂无类别，将由系统自动归类）'))}</option>`;
    },
    updateAccSelect() {
        document.getElementById('quickAccount').innerHTML = cache.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`).join('');
    },
    updateAccSelects() {
        const opts = cache.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`).join('');
        document.getElementById('quickFromAcc').innerHTML = opts;
        document.getElementById('quickToAcc').innerHTML = opts;
    },
    async loadBudgets() {
        try {
            const budgets = await api('/budgets');
            if (budgets && budgets.length) {
                document.getElementById('quickBudget').innerHTML =
                    `<option value="">${escapeHtml(tt('trans.form.noBudget', '不关联'))}</option>` +
                    budgets.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (${fmt(b.amount)})</option>`).join('');
            }
        } catch (_) { /* 预算加载失败不影响记账 */ }
    },
    open() {
        document.getElementById('quickAddModal').classList.add('show');
        // 默认选中支出，重置所有字段
        document.querySelectorAll('#quickAddForm .type-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); if (b.dataset.type === 'expense') { b.classList.add('active'); b.setAttribute('aria-pressed','true'); } });
        this.switchType('expense');
        document.getElementById('quickAmount').value = '';
        document.getElementById('quickNote').value = '';
        document.getElementById('quickTransferAmount').value = '';
        // 日期时间默认当前（精确到秒）
        // quickDate 是 datetime-local step="1"，必须给到秒（见 app.js 的 fmtDateTimeLocal）
        document.getElementById('quickDate').value = fmtDateTimeLocal();
        this.updateCatSelect('expense');
        this.updateAccSelect();
        this.loadBudgets();
    },
    close() { document.getElementById('quickAddModal').classList.remove('show'); },
    async save() {
        const type = document.querySelector('#quickAddForm .type-btn.active').dataset.type;

        if (type === 'transfer') {
            // ---- 转账模式 ----
            const fromId = parseInt(document.getElementById('quickFromAcc').value);
            const toId = parseInt(document.getElementById('quickToAcc').value);
            const amount = parseFloat(document.getElementById('quickTransferAmount').value);
            const note = document.getElementById('quickNote').value;
            const date = document.getElementById('quickDate').value;
            if (!amount || amount <= 0) { showToast(tt('quick.toast.invalidAmount', '请输入有效金额'), 'error'); return; }
            if (fromId === toId) { showToast(tt('quick.toast.sameAccount', '转出和转入不能是同一账户'), 'error'); return; }
            // 为空时服务端兜底「一般转账」，不阻塞提交
            const catId = parseInt(document.getElementById('quickCategory').value) || null;
            await api('/transfers', 'POST', { from_account_id: fromId, to_account_id: toId, amount, note, date: date || undefined, category_id: catId });
            showToast(tt('quick.toast.transferOk', '转账记录成功！'), 'success');
        } else {
            // ---- 收支模式 ----
            const body = {
                account_id: parseInt(document.getElementById('quickAccount').value),
                category_id: parseInt(document.getElementById('quickCategory').value),
                type, amount: parseFloat(document.getElementById('quickAmount').value),
                date: document.getElementById('quickDate').value,
                note: document.getElementById('quickNote').value,
                budget_id: document.getElementById('quickBudget').value ? parseInt(document.getElementById('quickBudget').value) : null,
            };
            if (!body.amount || body.amount <= 0) { showToast(tt('quick.toast.invalidAmount', '请输入有效金额'), 'error'); return; }
            await api('/transactions', 'POST', body);
            showToast(tt('quick.toast.saveOk', '记账成功！'), 'success');
        }

        this.close();
        await initCache();
        await DashboardManager.refresh();
        // 快捷记账会新增一笔交易/转账，账单页列表需同步，否则要切页才更新
        if (window.TransactionManager) await window.TransactionManager.refresh();
    }
};

export default QuickAdd;
