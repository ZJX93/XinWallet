// ==========================================
// BudgetManager — 预算管理
// 拆分自 public/js/app.js
// 原始位置: 第 1745 行 — 第 1905 行 (const BudgetManager = { ... };)
// ==========================================

const BudgetManager = {
    init() {
        document.getElementById('addBudgetBtn').addEventListener('click', () => this.openModal());
        document.getElementById('budgetModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('budgetCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('budgetForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        // 周期筛选
        const periodSel = document.getElementById('budgetPeriodType');
        const baseMonth = document.getElementById('budgetBaseMonth');
        baseMonth.value = cache.currentMonth;
        periodSel.addEventListener('change', () => this.refresh());
        baseMonth.addEventListener('change', () => this.refresh());
    },
    openModal() {
        document.getElementById('budgetModal').classList.add('show');
        document.getElementById('budgetModalTitle').textContent = '添加预算';
        document.getElementById('budgetEditId').value = '';
        document.getElementById('budgetName').value = '';
        document.getElementById('budgetAmount').value = '';
        document.getElementById('budgetPeriodTypeSelect').value = 'month';
        document.getElementById('budgetBaseMonthSelect').value = cache.currentMonth;
    },
    openEditModal(b) {
        document.getElementById('budgetModal').classList.add('show');
        document.getElementById('budgetModalTitle').textContent = '编辑预算';
        document.getElementById('budgetEditId').value = b.id;
        document.getElementById('budgetName').value = b.name;
        document.getElementById('budgetAmount').value = b.amount;
        document.getElementById('budgetPeriodTypeSelect').value = b.period_type || 'month';
        document.getElementById('budgetBaseMonthSelect').value = b.start_date?.slice(0, 7) || cache.currentMonth;
    },
    closeModal() { document.getElementById('budgetModal').classList.remove('show'); },
    async save() {
        const editId = document.getElementById('budgetEditId').value;
        const name = document.getElementById('budgetName').value.trim();
        const amount = parseFloat(document.getElementById('budgetAmount').value);
        const periodType = document.getElementById('budgetPeriodTypeSelect').value;
        const baseDate = document.getElementById('budgetBaseMonthSelect').value + '-01';
        if (!name) { showToast('请输入预算名称', 'error'); return; }
        if (!amount || amount <= 0) { showToast('请输入有效金额', 'error'); return; }
        if (editId) {
            await api(`/budgets/${editId}`, 'PUT', { name, amount, period_type: periodType, base_date: baseDate });
            showToast('预算已更新', 'success');
        } else {
            await api('/budgets', 'POST', { name, amount, period_type: periodType, base_date: baseDate });
            showToast('预算已设置', 'success');
        }
        this.closeModal();
        await this.refresh();
    },
    async delete(id) {
        try {
            await api(`/budgets/${id}`, 'DELETE');
            showToast('预算已删除', 'warning');
            await this.refresh();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    // 计算周期时间范围（与后端对齐）
    calcPeriodRange(type, baseDate) {
        const d = new Date(baseDate + 'T00:00:00');
        const y = d.getFullYear();
        const m = d.getMonth();
        let start, end;
        switch (type) {
            case 'month':
                start = fmtLocalDate(y, m + 1, 1);
                end = fmtLocalDate(y, m + 1, new Date(y, m + 1, 0).getDate());
                break;
            case 'quarter': {
                const q = Math.floor(m / 3);
                start = fmtLocalDate(y, q * 3 + 1, 1);
                end = fmtLocalDate(y, (q + 1) * 3, new Date(y, (q + 1) * 3, 0).getDate());
                break;
            }
            case 'half': {
                const half = m < 6 ? 0 : 1;
                start = fmtLocalDate(y, half === 0 ? 1 : 7, 1);
                end = fmtLocalDate(y, half === 0 ? 6 : 12, new Date(y, half === 0 ? 6 : 12, 0).getDate());
                break;
            }
            case 'year':
                start = fmtLocalDate(y, 1, 1);
                end = fmtLocalDate(y, 12, 31);
                break;
            default:
                start = fmtLocalDate(y, m + 1, 1);
                end = fmtLocalDate(y, m + 1, new Date(y, m + 1, 0).getDate());
        }
        return { start, end };
    },
    periodLabel(type) {
        const map = { month: '月度', quarter: '季度', half: '半年', year: '年度' };
        return map[type] || type;
    },
    async refresh() {
        const periodType = document.getElementById('budgetPeriodType').value;
        const baseMonth = document.getElementById('budgetBaseMonth').value;
        const container = document.getElementById('budgetList');
        showSkeleton(container, 3, 'grid');
        const queryDate = baseMonth + '-01';
        const typeParam = periodType ? `&period_type=${periodType}` : '';
        const budgets = await api(`/budgets?period=${queryDate}${typeParam}`);
        if (!budgets) return;

        const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
        const totalUsed = budgets.reduce((s, b) => s + b.actual, 0);
        const remain = totalBudget - totalUsed;
        const rate = totalBudget > 0 ? Math.round(totalUsed / totalBudget * 100) : 0;

        document.getElementById('budgetTotal').textContent = fmt(totalBudget);
        document.getElementById('budgetUsed').textContent = fmt(totalUsed);
        document.getElementById('budgetRemain').textContent = fmt(remain);
        document.getElementById('budgetRate').textContent = rate + '%';

        const bar = document.getElementById('budgetTotalBar');
        bar.style.width = Math.min(rate, 100) + '%';
        bar.style.background = rate > 100 ? 'var(--accent-expense)' : rate > 80 ? 'var(--accent-warning)' : 'var(--accent-primary)';

        if (!budgets.length) { showEmpty(container, '该周期还没有设置预算，点击「添加预算」开始规划'); return; }
        container.innerHTML = budgets.map(b => {
            const r = Math.round(b.actual / b.amount * 100);
            const cls = r > 100 ? 'over' : r > 80 ? 'warning' : 'safe';
            const statusTag = r > 100
                ? '<span class="goal-status overdue">已超支</span>'
                : r > 80
                  ? '<span class="goal-status warn">即将超支</span>'
                  : '<span class="goal-status type">正常</span>';
            const periodLabel = this.periodLabel(b.period_type);
            const icon = { month: '📅', quarter: '📆', half: '🗓️', year: '📊' }[b.period_type] || '📋';
            return `
            <div class="goal-card ${cls === 'over' ? 'overdue' : ''}">
                <div class="goal-head">
                    <div class="goal-icon">${icon}</div>
                    <div class="goal-title">${escapeHtml(b.name)} <span class="goal-sub">· ${periodLabel} · ${b.start_date} ~ ${b.end_date}</span></div>
                    ${statusTag}
                </div>
                <div class="goal-amounts"><span class="goal-pct">已使用 ${fmt(b.actual)}</span><span>预算 ${fmt(b.amount)}</span></div>
                <div class="goal-progress"><div class="goal-progress-fill ${cls === 'over' ? 'danger' : ''}" style="width:${Math.min(r, 100)}%"></div></div>
                <div class="goal-amounts"><span class="goal-pct">${r}% 使用率</span><span>${r > 100 ? '超支 ' + fmt(b.actual - b.amount) : '剩余 ' + fmt(b.amount - b.actual)}</span></div>
                <div class="goal-actions">
                    <button class="btn btn-ghost" data-action="edit-budget" data-id="${b.id}">编辑</button>
                    <button class="btn btn-ghost" data-action="delete-budget" data-id="${b.id}">删除</button>
                </div>
            </div>
            `;
        }).join('');

        // 事件委托：编辑/删除按钮
        container.querySelectorAll('[data-action="edit-budget"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const b = budgets.find(x => x.id === parseInt(btn.dataset.id));
                if (b) this.openEditModal(b);
            });
        });
        container.querySelectorAll('[data-action="delete-budget"]').forEach(btn => {
            btn.addEventListener('click', () => this.delete(parseInt(btn.dataset.id)));
        });
    }
};

export default BudgetManager;
