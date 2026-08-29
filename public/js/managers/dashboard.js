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
            console.warn('[Dashboard] dashKpiBar 元素未找到，KPI 卡片点击事件未绑定');
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
        const safe = (name, fn) => { try { fn(); } catch(e) { console.warn(`[Dashboard] ${name} 渲染失败:`, e); } };

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

            // 净资产变化
            const monthsArr = (data.months || []).slice(-2);
            const recentChange = monthsArr.length === 2
                ? (monthsArr[1].savings - monthsArr[0].savings)
                : 0;
            const dashNetChange = document.getElementById('dashNetChange');
            if (dashNetChange) {
                if (recentChange !== 0) {
                    const sign = recentChange >= 0 ? '↑' : '↓';
                    const cls = recentChange >= 0 ? 'income' : 'expense';
                    dashNetChange.textContent = `${sign}${fmt(Math.abs(recentChange))}`;
                    dashNetChange.className = `kpi-change ${cls}`;
                } else {
                    dashNetChange.textContent = '较上月持平';
                    dashNetChange.className = 'kpi-change';
                }
            }

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

        // === 风险预警条（已关闭）
        // safe('alertBar', () => this.renderAlertBar(data));

        // === 资产负债概览 ===
        safe('balanceOverview', () => this.renderBalanceOverview(data));

        await ChartManager.renderDash();
    },

    renderAlertBar(data) {
        const bar = document.getElementById('dashAlertBar');
        const content = document.getElementById('dashAlertContent');
        if (!bar || !content) return;
        const alerts = [];

        // 1. 债务逾期
        const debts = data.debts || {};
        if (debts.overdue > 0) {
            alerts.push(`<span class="alert-item bad">💳 ${debts.overdue} 笔债务已逾期（${fmt(debts.overdueAmount || 0)}）</span>`);
        }

        // 2. 预算超支
        const budgets = data.budgets || [];
        const overspent = budgets.filter(b => parseFloat(b.actual || 0) > parseFloat(b.amount || 0));
        if (overspent.length > 0) {
            const totalOver = overspent.reduce((s, b) => s + (parseFloat(b.actual) - parseFloat(b.amount)), 0);
            alerts.push(`<span class="alert-item bad">📊 ${overspent.length} 项预算超支（合计 ${fmt(totalOver)}）</span>`);
        }

        // 3. 储蓄率过低（使用真实储蓄率）
        const inc = data.month.income;
        const exp = data.month.expense;
        const realSavingsRate = data.month.savingsRate !== undefined ? data.month.savingsRate : (inc > 0 ? ((inc - exp) / inc * 100) : 0);
        if (inc > 0 && realSavingsRate < 0) {
            alerts.push(`<span class="alert-item bad">⚠️ 本月储蓄净流出（取款 > 存入）</span>`);
        } else if (inc > 0 && realSavingsRate >= 0 && realSavingsRate < 10 && data.month.savings !== 0) {
            alerts.push(`<span class="alert-item warn">💡 本月储蓄率仅 ${realSavingsRate.toFixed(1)}%，建议加重储蓄</span>`);
        }

        // 4. 低账户余额（账户余额 < ¥1000）
        const lowBalance = (data.accounts || []).filter(a => parseFloat(a.balance) > 0 && parseFloat(a.balance) < 100);
        if (lowBalance.length > 0) {
            alerts.push(`<span class="alert-item warn">🏦 ${lowBalance.length} 个账户余额不足 ¥100</span>`);
        }

        if (alerts.length === 0) {
            bar.style.display = 'none';
        } else {
            bar.style.display = 'flex';
            content.innerHTML = alerts.join('');
        }
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

    renderAssetsDist(accounts, total) {
        const el = document.getElementById('dashAssetsDist');
        if (!el) return;
        if (!accounts || accounts.length === 0) { showEmpty(el, '暂无账户', '🏦'); return; }
        el.innerHTML = accounts.map(a => {
            const bal = parseFloat(a.balance);
            const ratio = total > 0 ? Math.max(bal / total * 100, 2) : 0;
            return `<div class="asset-row">
                <span class="asset-icon">${escapeHtml(a.icon || '💰')}</span>
                <div class="asset-body">
                    <div class="asset-top"><span class="asset-name">${escapeHtml(a.name)}</span><span class="asset-bal">${fmt(bal)}</span></div>
                    <div class="mini-bar"><div class="mini-bar-fill" style="width:${ratio}%"></div></div>
                </div>
            </div>`;
        }).join('');
    },

    renderBudgets(budgets) {
        const el = document.getElementById('dashBudgets');
        if (!el) return;
        if (!budgets || budgets.length === 0) { showEmpty(el, '本月暂无预算', '🎯'); return; }
        const today = new Date();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
        const dayOfMonth = today.getDate();
        const daysLeft = daysInMonth - dayOfMonth + 1;
        el.innerHTML = budgets.map(b => {
            const actual = b.actual || 0, amount = b.amount || 0;
            const ratio = amount > 0 ? Math.min(Math.round(actual / amount * 100), 999) : 0;
            const over = actual > amount;
            const remain = Math.max(0, amount - actual);
            const dailyAvg = dayOfMonth > 0 ? Math.round(actual / dayOfMonth) : 0;
            const safeDaily = daysLeft > 0 ? Math.round(remain / daysLeft) : 0;
            const projected = dailyAvg * daysInMonth;
            const willOver = projected > amount && !over;
            const alertLevel = over ? 'danger' : (ratio >= 80 ? 'warning' : 'ok');
            const cls = alertLevel === 'danger' ? 'over' : (alertLevel === 'warning' ? 'warn' : 'ok');
            let foot = '', hint = '';
            if (over) {
                foot = `已超支 ${fmt(actual - amount)} · ${ratio}%`;
            } else if (willOver) {
                foot = `⚠ 预计月末超支 ${fmt(projected - amount)} · 日均 ${fmt(dailyAvg)}`;
                hint = `<div class="budget-hint" style="color:var(--accent-expense);margin-top:4px;font-size:12px;">按当前速度，剩余 ${daysLeft} 天将超支约 ${fmt(projected - amount)} 元</div>`;
            } else {
                foot = `剩 ${fmt(remain)} · 可日均 ${fmt(safeDaily)} · ${ratio}%`;
            }
            return `<div class="budget-row">
                <div class="budget-top"><span class="budget-name">${escapeHtml(b.name)}</span><span class="budget-val">${fmt(b.actual)} / ${fmt(b.amount)}</span></div>
                <div class="budget-bar"><div class="budget-bar-fill ${cls}" style="width:${ratio}%"></div></div>
                <div class="budget-foot ${cls}">${foot}</div>${hint}
            </div>`;
        }).join('');
    },

    renderGoals(goals) {
        const el = document.getElementById('dashGoals');
        if (!el) return;
        if (!goals || goals.length === 0) { showEmpty(el, '还没有储蓄目标', '🎯'); return; }
        el.innerHTML = goals.map(g => {
            const ratio = g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0;
            const pct = Math.min(ratio, 100);
            const cls = ratio >= 100 ? 'done' : 'ok';
            return `<div class="goal-row">
                <div class="goal-top"><span class="goal-icon">${escapeHtml(g.icon || '🎯')}</span><span class="goal-name">${escapeHtml(g.name)}</span><span class="goal-pct">${ratio}%</span></div>
                <div class="goal-bar"><div class="goal-bar-fill ${cls}" style="width:${pct}%"></div></div>
                <div class="goal-foot">${fmt(g.current_amount)} / ${fmt(g.target_amount)}</div>
            </div>`;
        }).join('');
    },

    renderInvestments(holdings, summary) {
        const el = document.getElementById('dashInvest');
        if (!el) return;
        if (!holdings || holdings.length === 0) { showEmpty(el, '暂无理财持仓', '📈'); return; }
        const head = `<div class="invest-summary">市值 ${fmt(summary.totalValue)} · 收益 ${fmtSigned(summary.totalProfit, summary.totalProfit >= 0 ? 'income' : 'expense')}</div>`;
        const rows = holdings.slice(0, 5).map(h => {
            const cls = h.profit >= 0 ? 'positive' : 'negative';
            const icon = h.type_icon || '📈';
            return `<div class="goal-row">
                <div class="goal-top"><span class="goal-icon">${escapeHtml(icon)}</span><span class="goal-name">${escapeHtml(h.name)}</span><span class="goal-pct ${cls}">${h.profit_rate >= 0 ? '+' + h.profit_rate : h.profit_rate}%</span></div>
                <div class="goal-foot">市值 ${fmt(h.current_value)} · 成本 ${fmt(h.total_cost)}</div>
            </div>`;
        }).join('');
        const more = holdings.length > 5 ? `<div class="invest-more">等 ${holdings.length} 项持仓</div>` : '';
        el.innerHTML = head + rows + more;
    },

    renderDebts(d) {
        const el = document.getElementById('dashDebts');
        if (!el) return;
        if (!d || !d.count) { showEmpty(el, '暂无债务记录', '🏷️'); return; }
        el.innerHTML = `<div class="debt-dash-summary">
            <div class="debt-dash-item"><span class="debt-dash-label">总负债</span><span class="debt-dash-value">${fmt(d.totalRemaining)}</span></div>
            <div class="debt-dash-item"><span class="debt-dash-label">月供压力</span><span class="debt-dash-value">${fmt(d.totalMonthly)}</span></div>
            <div class="debt-dash-item"><span class="debt-dash-label">本月需还款</span><span class="debt-dash-value">${d.dueThisMonth} 笔 · ${fmt(d.dueAmount !== undefined ? d.dueAmount : d.totalMonthly)}</span></div>
            <div class="debt-dash-item ${d.overdue ? 'debt-overdue-text' : ''}"><span class="debt-dash-label">逾期</span><span class="debt-dash-value">${d.overdue ? (d.overdue + ' 笔 · ' + fmt(d.overdueAmount || 0)) : '0'}</span></div>
        </div>
        <div class="debt-dash-sub">共 ${d.count} 笔 · ${d.activeCount} 笔进行中</div>`;
    },

    renderDashAI() {
        // ⚠️ 2026-08-27 合并：insight 跟 advice 合并到 /ai/advice，洞察/建议都从 AIAdvice 缓存读
        const insights = (typeof AIAdvice !== 'undefined' && AIAdvice._loadInsights)
            ? AIAdvice._loadInsights() : null;
        const advice = (typeof AIAdvice !== 'undefined' && AIAdvice._loadAdvice)
            ? AIAdvice._loadAdvice() : null;

        const ie = document.getElementById('dashInsights');
        if (ie) {
            if (insights && insights.length) {
                const first = insights[0];
                const lv = { warning: '⚠️', info: '📌', tip: '💡' };
                ie.innerHTML = `<div class="dash-ai-item">
                    <div class="dash-ai-head">${lv[first.level] || '🧠'} ${escapeHtml(first.title)}</div>
                    <div class="dash-ai-desc">${escapeHtml(first.description)}${insights.length > 1 ? `<br><span style="color:var(--text-tertiary);font-size:var(--text-xs)">等 ${insights.length} 条洞察</span>` : ''}</div>
                </div>`;
            } else {
                ie.innerHTML = `<div class="empty-hint"><div class="empty-icon">🧠</div><p>尚未生成 AI 洞察</p><button class="btn btn-sm btn-primary go-ai-advice-btn" style="margin-top:8px">前往 AI 洞察</button></div>`;
                ie.querySelector('.go-ai-advice-btn')?.addEventListener('click', () => window.switchPage && window.switchPage('ai-insights'));
            }
        }

        const ae = document.getElementById('dashAdvice');
        if (ae) {
            if (advice && advice.length) {
                const first = advice[0];
                const pr = { high: '🔴', medium: '🟡', low: '🟢' };
                ae.innerHTML = `<div class="dash-ai-item">
                    <div class="dash-ai-head">${pr[first.priority] || '💡'} ${escapeHtml(first.title)}</div>
                    <div class="dash-ai-desc">${escapeHtml(first.content)}${advice.length > 1 ? `<br><span style="color:var(--text-tertiary);font-size:var(--text-xs)">等 ${advice.length} 条建议</span>` : ''}</div>
                </div>`;
            } else {
                ae.innerHTML = `<div class="empty-hint"><div class="empty-icon">💡</div><p>尚未生成 AI 建议</p><button class="btn btn-sm btn-primary go-ai-advice-btn" style="margin-top:8px">前往 AI 洞察</button></div>`;
                ae.querySelector('.go-ai-advice-btn')?.addEventListener('click', () => window.switchPage && window.switchPage('ai-insights'));
            }
        }
    }
};

export default DashboardManager;