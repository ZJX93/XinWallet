// ============================================================
// DashboardManager —— 仪表盘模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 652 行 ~ 第 1114 行（共 463 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、fmtSigned、switchPage、
//                    ChartManager.renderDash、AIAdvice 缓存读写、
//                    showEmpty、DOM 元素（dashKpiBar、dashDetailModal 等）
// ============================================================

// 数字滚动动画：从 0 滚动到目标值（KPI 灵动入场）
// 传入 el 元素、目标数值、duration(ms)、格式化函数
function countUp(el, target, duration = 800, formatter) {
    if (!el) return;
    const startVal = 0;
    const startTime = performance.now();
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    function tick(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const v = startVal + (target - startVal) * easeOut(t);
        el.textContent = formatter ? formatter(v) : Math.round(v).toLocaleString('zh-CN');
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = formatter ? formatter(target) : Math.round(target).toLocaleString('zh-CN');
    }
    requestAnimationFrame(tick);
}

const DashboardManager = {
    async init() {
        await PageLoader.ensureLoaded('page-dashboard');

        const bar = document.getElementById('dashKpiBar');
        if (!bar) {
            logger.warn('[Dashboard] dashKpiBar 元素未找到，KPI 卡片点击事件未绑定');
            return;
        }
        // 仪表盘页面是懒加载片段，其中的 .see-all（如「资产负债概览 › 报表 →」）
        // 在 app.js 启动时尚未进入 DOM，无法被全局选择器绑定，这里补绑一次。
        document.querySelectorAll('#page-dashboard .see-all').forEach(el => {
            el.addEventListener('click', () => {
                const page = el.dataset.page;
                if (page) { window.switchPage && window.switchPage(page); }
            });
        });
        bar.addEventListener('click', (e) => {
            const card = e.target.closest('.kpi-card');
            if (!card) return;
            // 优先看 data-action，避免与 data-detail 冲突
            const action = card.dataset.action;
            if (action === 'navigate') {
                const page = card.dataset.page;
                if (page) { window.switchPage && window.switchPage(page); return; }
            }
            // 详情弹窗（除非明确标记为 none）
            const type = card.dataset.detail;
            if (!type || type === 'none') return;
            // 兼容旧 data-detail 标记的 navigate 情况（无 data-action）
            if (type === 'investments') { window.switchPage && window.switchPage('investments'); return; }
            if (type === 'debts') { window.switchPage && window.switchPage('debts'); return; }
            // 否则打开弹窗（week/month/year/assets 等）
            this.showDetail(type);
        });
        // 安全绑定：元素可能因时序问题尚未加载（防御性检查）
        const dashClose = document.getElementById('dashDetailClose');
        if (dashClose) dashClose.addEventListener('click', () => this.closeDetail());
        const dashModal = document.getElementById('dashDetailModal');
        if (dashModal) dashModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeDetail();
        });
    },

    async showDetail(type) {
        const modal = document.getElementById('dashDetailModal');
        const titleEl = document.getElementById('dashDetailTitle');
        const summaryEl = document.getElementById('dashDetailSummary');
        const listEl = document.getElementById('dashDetailList');

        titleEl.textContent = '加载中...';
        summaryEl.innerHTML = '';
        listEl.innerHTML = '<div class="skeleton-wrap" data-skeleton="list"><div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:40%"></div><div class="skeleton-line shimmer" style="width:65%"></div></div><div class="skeleton-amt shimmer"></div></div><div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:45%"></div><div class="skeleton-line shimmer" style="width:60%"></div></div><div class="skeleton-amt shimmer"></div></div><div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:50%"></div><div class="skeleton-line shimmer" style="width:55%"></div></div><div class="skeleton-amt shimmer"></div></div></div>';
        modal.classList.add('show');

        const data = await api(`/stats/dashboard/detail?type=${type}`);
        if (!data) { this.closeDetail(); return; }

        titleEl.textContent = data.title;

        if (type === 'assets') {
            summaryEl.innerHTML = `<div class="detail-total"><span class="detail-total-label">总资产</span><span class="detail-total-value">${fmt(data.total)}</span></div>`;
            listEl.innerHTML = data.accounts.map(a => `
                <div class="detail-row">
                    <div class="detail-row-icon">${escapeHtml(a.icon || "💰")}</div>
                    <div class="detail-row-info"><span class="detail-row-name">${escapeHtml(a.name)}</span><span class="detail-row-sub">${a.type === 'credit_card' ? '信用卡' : a.type === 'cash' ? '现金' : a.type === 'electronic_payment' ? '电子支付' : a.type === 'financial_account' ? '金融账户' : a.type === 'digital' ? '数字货币' : '银行账户'}${a.inv_value > 0 ? ' · 含理财' + fmt(a.inv_value) : ''}</span></div>
                    <div class="detail-row-right"><span class="detail-row-value">${fmt(a.balance)}</span><div class="detail-bar-wrap"><div class="detail-bar" style="width:${Math.max(a.ratio, 2)}%"></div></div></div>
                </div>
            `).join('');
        } else {
            const isDual = ['month', 'year'].includes(type);
            summaryEl.innerHTML = isDual
                ? `<div class="detail-total"><span class="detail-total-label">汇总</span><span class="detail-total-value income">收 ${fmt(data.totalIncome)}</span><span class="detail-total-value expense">支 ${fmt(data.totalExpense)}</span><span class="detail-total-value">结余 ${fmt(data.balance)}</span></div>`
                : `<div class="detail-total"><span class="detail-total-label">总支出</span><span class="detail-total-value expense">${fmt(data.totalExpense)}</span></div>`;

            if (!data.transactions || data.transactions.length === 0) {
                listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无交易记录</div></div>';
            } else {
                // 合并配对的转账记录
                const transferMap = {};
                const rows = [];
                data.transactions.forEach(t => {
                    if (t.transfer_id) {
                        if (!transferMap[t.transfer_id]) transferMap[t.transfer_id] = {};
                        transferMap[t.transfer_id][t.type === 'transfer_out' ? 'out' : 'in'] = t;
                    } else {
                        rows.push(t);
                    }
                });
                Object.values(transferMap).forEach(pair => {
                    const t = pair.out || pair.in;
                    if (t) rows.push({ ...t, _merged: true, _pairOut: pair.out, _pairIn: pair.in });
                });
                rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

                // 按日期分组
                let lastDate = '';
                listEl.innerHTML = rows.map(t => {
                    const dateLabel = t.date.slice(5);
                    const showDate = dateLabel !== lastDate;
                    lastDate = dateLabel;
                    const isTransfer = t._merged;
                    if (isTransfer) {
                        const outAcc = t._pairOut ? t._pairOut.account : null;
                        const inAcc = t._pairIn ? t._pairIn.account : null;
                        const fromName = outAcc ? `${escapeHtml(outAcc.icon || '')} ${escapeHtml(outAcc.name || '')}` : '?';
                        const toName = inAcc ? `${escapeHtml(inAcc.icon || '')} ${escapeHtml(inAcc.name || '')}` : '?';
                        return (showDate ? `<div class="detail-date-sep"><span>${dateLabel}</span></div>` : '') + `
                    <div class="detail-row">
                        <div class="detail-row-icon">${escapeHtml(t.category.icon || "📌")}</div>
                        <div class="detail-row-info">
                            <span class="detail-row-name">${escapeHtml(t.category.name)}</span>
                            <span class="detail-row-sub">${fromName} → ${toName} · ${escapeHtml(t.note || '无备注')}</span>
                        </div>
                        <div class="detail-row-right">
                            <span class="detail-row-value transfer">${fmtSigned(t.amount, 'transfer_in')}</span>
                        </div>
                    </div>`;
                    }
                    return (showDate ? `<div class="detail-date-sep"><span>${dateLabel}</span></div>` : '') + `
                    <div class="detail-row">
                        <div class="detail-row-icon">${escapeHtml(t.category.icon || "📌")}</div>
                        <div class="detail-row-info">
                            <span class="detail-row-name">${escapeHtml(t.category.name)}</span>
                            <span class="detail-row-sub">${escapeHtml(t.note || '无备注')} · ${t.account ? escapeHtml(t.account.icon || "") + " " + escapeHtml(t.account.name || "") : ""}</span>
                        </div>
                        <div class="detail-row-right">
                            <span class="detail-row-value ${t.type === 'income' ? 'positive' : t.type === 'expense' ? 'negative' : 'transfer'}">${fmtSigned(t.amount, t.type)}</span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
    },

    closeDetail() {
        document.getElementById('dashDetailModal').classList.remove('show');
    },

    async refresh() {
        const data = await api('/stats/dashboard');
        if (!data) return;

        // 各 render 单独 try-catch，失败不影响其他
        const safe = (name, fn) => { try { fn(); } catch(e) { logger.warn(`[Dashboard] ${name} 渲染失败:`, e); } };

        // === KPI 核心卡 ===
        safe('kpiHero', () => {
            const totalAssets = data.totalAssets;
            const totalDebt = data.debts?.totalRemaining || 0;
            const netWorth = data.netWorth || (totalAssets - totalDebt);

            // 净资产（最核心指标）
            const dashNetWorth = document.getElementById('dashNetWorth');
            if (dashNetWorth) {
                countUp(dashNetWorth, netWorth, 900, fmt);
                dashNetWorth.className = 'kpi-value ' + (netWorth >= 0 ? 'positive' : 'negative');
            }
            const assetDebtEl = document.getElementById('dashAssetDebt');
            if (assetDebtEl) assetDebtEl.textContent = `资产 ${fmt(totalAssets)} / 负债 ${fmt(totalDebt)}`;

            // 储蓄率 = 累计净储蓄 / 总资产（反映资产中有多大比例是存下来的）
            const totalIncome = data.totalIncome || 0;
            const totalExpense = data.totalExpense || 0;
            const netSavings = totalIncome - totalExpense;
            const savingsRate = data.totalAssets > 0 ? (netSavings / data.totalAssets * 100) : 0;

            // 同时保留短期（本月）的辅助信息
            const monthIncome = data.month.income;
            const monthExpense = data.month.expense;
            const monthBalance = data.month.balance;

            const srEl = document.getElementById('dashSavingsRate');
            if (srEl) {
                countUp(srEl, savingsRate, 900, v => `${v.toFixed(1)}%`);
            }
            const summaryEl = document.getElementById('dashSavingsSummary');
            if (summaryEl) {
                if (netSavings === 0 && totalIncome === 0) {
                    summaryEl.textContent = '暂无储蓄数据';
                } else {
                    summaryEl.textContent = `累计净储蓄 ${fmt(netSavings)}`;
                }
            }
            const srBadge = document.getElementById('dashSavingsRateBadge');
            if (srBadge) {
                if (netSavings === 0) { srBadge.textContent = '无储蓄'; srBadge.className = 'kpi-badge neutral'; }
                else if (savingsRate >= 30) { srBadge.textContent = '健康'; srBadge.className = 'kpi-badge good'; }
                else if (savingsRate >= 15) { srBadge.textContent = '一般'; srBadge.className = 'kpi-badge warn'; }
                else if (savingsRate > 0) { srBadge.textContent = '偏低'; srBadge.className = 'kpi-badge bad'; }
                else { srBadge.textContent = '需关注'; srBadge.className = 'kpi-badge bad'; }
            }

            // 本月结余
            const monthBalEl = document.getElementById('dashMonthBalance');
            if (monthBalEl) {
                countUp(monthBalEl, monthBalance, 800, fmt);
                monthBalEl.className = 'kpi-value ' + (monthBalance >= 0 ? 'positive' : 'negative');
            }
            const monthChangeEl = document.getElementById('dashMonthChange');
            if (monthChangeEl) {
                monthChangeEl.textContent = `收 ${fmt(monthIncome)} 支 ${fmt(monthExpense)}`;
            }

            // 本周结余
            const weekIncome = data.week?.income || 0;
            const weekExpense = data.week?.expense || 0;
            const weekBalance = weekIncome - weekExpense;
            const weekBalEl = document.getElementById('dashWeekBalance');
            if (weekBalEl) {
                countUp(weekBalEl, weekBalance, 700, fmt);
                weekBalEl.className = 'kpi-value ' + (weekBalance >= 0 ? 'positive' : 'negative');
            }
            const weekDet = document.getElementById('dashWeekDetail');
            if (weekDet) weekDet.textContent = `收 ${fmt(weekIncome)} 支 ${fmt(weekExpense)}`;

            // 理财盈亏（与储蓄率卡片风格一致：label 带 badge，sub 显示总投入 + 收益率）
            const invProfit = data.investments.totalProfit;
            const invCost = data.investments.totalCost;
            const invRate = invCost > 0 ? (invProfit / invCost * 100) : 0;

            const invProfitEl = document.getElementById('dashInvProfit');
            if (invProfitEl) {
                countUp(invProfitEl, invProfit, 900, fmt);
                invProfitEl.className = 'kpi-value ' + (invProfit >= 0 ? 'positive' : 'negative');
            }
            const invBadge = document.getElementById('dashInvBadge');
            if (invBadge) {
                if (invProfit > 0) { invBadge.textContent = '盈利'; invBadge.className = 'kpi-badge good'; }
                else if (invProfit < 0) { invBadge.textContent = '亏损'; invBadge.className = 'kpi-badge bad'; }
                else { invBadge.textContent = '持平'; invBadge.className = 'kpi-badge neutral'; }
            }
            const invRateEl = document.getElementById('dashInvRate');
            if (invRateEl) {
                invRateEl.textContent = invCost > 0
                    ? `总投入 ${fmt(invCost)} · 收益率 ${invRate >= 0 ? '+' : ''}${invRate.toFixed(1)}%`
                    : '暂无持仓';
            }

            // 本年结余
            const yearBalEl = document.getElementById('dashYearBalance');
            if (yearBalEl) {
                countUp(yearBalEl, data.year.balance, 850, fmt);
                yearBalEl.className = 'kpi-value ' + (data.year.balance >= 0 ? 'positive' : 'negative');
            }
            const yearDetailEl = document.getElementById('dashYearDetail');
            if (yearDetailEl) yearDetailEl.textContent = `收 ${fmt(data.year.income)} 支 ${fmt(data.year.expense)}`;

            // 总资产
            const totalAssetsCard = document.getElementById('dashTotalAssets');
            if (totalAssetsCard) countUp(totalAssetsCard, totalAssets, 900, fmt);
            // 总负债
            const totalDebtCard = document.getElementById('dashTotalDebt');
            if (totalDebtCard) countUp(totalDebtCard, totalDebt, 850, fmt);
            const debtSub = document.getElementById('dashDebtSub');
            if (debtSub) debtSub.textContent = `月供 ${fmt(data.debts?.totalMonthly || 0)}`;
        });

        // === 资产负债概览 ===
        safe('balanceOverview', () => this.renderBalanceOverview(data));

        await ChartManager.renderDash();
    },

    renderBalanceOverview(data) {
        const el = document.getElementById('dashBalanceOverview');
        if (!el) return;
        // 总资产（后端已合并账户余额 + 投资市值）
        const totalAssets = data.totalAssets;
        const totalDebt = data.debts?.totalRemaining || 0;
        const netWorth = totalAssets - totalDebt;
        const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets * 100) : 0;

        // 资产分类
        const liquidTotal = (data.accounts || []).filter(a => parseFloat(a.balance) > 0)
            .reduce((s, a) => s + parseFloat(a.balance), 0);
        const investTotal = data.investments?.totalValue || 0;

        // 负债分类
        const debts = data.debts || {};
        const overdue = debts.overdue > 0;
        const dueAmount = debts.dueAmount || 0;
        const monthlyPayment = debts.totalMonthly || 0;

        el.innerHTML = `
            <div class="bo-row">
                <div class="bo-asset-side">
                    <div class="bo-bar-track">
                        <div class="bo-bar-liquid" style="width:${totalAssets > 0 ? (liquidTotal / totalAssets * 100) : 0}%"></div>
                        <div class="bo-bar-invest" style="width:${totalAssets > 0 ? (investTotal / totalAssets * 100) : 0}%"></div>
                    </div>
                    <div class="bo-bar-legend">
                        <span title="${fmt(liquidTotal)}"><i class="dot dot-liquid"></i>流动资产 ${fmtCompact(liquidTotal)}</span>
                        <span title="${fmt(investTotal)}"><i class="dot dot-invest"></i>投资资产 ${fmtCompact(investTotal)}</span>
                    </div>
                </div>
            </div>
            <div class="bo-stats">
                <div class="bo-stat bo-stat-asset">
                    <div class="bo-stat-label">总资产</div>
                    <div class="bo-stat-value" title="${fmt(totalAssets)}">${fmtCompact(totalAssets)}</div>
                </div>
                <div class="bo-stat bo-stat-liab">
                    <div class="bo-stat-label">总负债</div>
                    <div class="bo-stat-value" title="${fmt(totalDebt)}">${fmtCompact(totalDebt)}</div>
                    <div class="bo-stat-sub">负债率 ${debtRatio.toFixed(1)}%</div>
                </div>
                <div class="bo-stat bo-stat-net">
                    <div class="bo-stat-label">净资产</div>
                    <div class="bo-stat-value ${netWorth >= 0 ? 'positive' : 'negative'}" title="${fmt(netWorth)}">${fmtCompact(netWorth)}</div>
                </div>
            </div>
            <div class="bo-debt-info">
                <span>活跃债务 <strong>${debts.activeCount || 0}</strong> 笔</span>
                <span>月供 <strong>${fmt(monthlyPayment)}</strong></span>
                <span class="${overdue ? 'bad' : ''}">本月需还 <strong>${fmt(dueAmount)}</strong>${overdue ? ` <span class="bad">⚠️ 逾期 ${debts.overdue} 笔</span>` : ''}</span>
            </div>
        `;
    },

};

export default DashboardManager;