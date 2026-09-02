// ============================================================
// ReportManager —— 财务报表模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 3016 行 ~ 第 3719 行（共 704 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、fmtDateTime、showToast、
//                    showEmpty、showSkeleton、ChartManager、API、
//                    initCache、DashboardManager、DOM 元素
//                    （reportType、reportPeriod、reportContent、importFullInput 等）

// 全局数字滚动函数（报表中心用）
window.countUpReport = function(el, target, duration, formatter) {
    if (!el) return;
    const startTime = performance.now();
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    function tick(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const v = target * easeOut(t);
        el.textContent = formatter ? formatter(v) : Math.round(v).toLocaleString('zh-CN');
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = formatter ? formatter(target) : Math.round(target).toLocaleString('zh-CN');
    }
    requestAnimationFrame(tick);
};

const ReportManager = {
    charts: {},
    currentData: null,
    init() {
        const el = document.getElementById('reportType');
        if (!el) return;  // 报表页面通过 PageLoader 惰加载
        document.getElementById('generateReportBtn').addEventListener('click', () => this.generate());
        document.getElementById('printReportBtn').addEventListener('click', () => this.print());
        document.getElementById('reportType').addEventListener('change', () => this.populatePeriods());
        document.getElementById('exportFullBtn').addEventListener('click', () => this.exportFull());
        document.getElementById('importFullBtn').addEventListener('click', () => document.getElementById('importFullInput').click());
        document.getElementById('importFullInput').addEventListener('change', (e) => this.importFull(e.target.files[0]));

        // 事件委托：.bs-detail-card 内部的「关闭」按钮（替代原内联 onclick）
        const reportContent = document.getElementById('reportContent');
        if (reportContent && !reportContent._bsCloseDelegated) {
            reportContent.addEventListener('click', (e) => {
                const btn = e.target.closest('.js-bs-close');
                if (btn) {
                    const card = btn.closest('.bs-detail-card');
                    if (card) card.remove();
                }
            });
            reportContent._bsCloseDelegated = true;
        }

        // 默认填充周期并立即生成当前月报表，让用户进入页面就能看到内容
        this.populatePeriods();
        // 延迟生成避免在 init 流程中重复渲染
        setTimeout(() => this.generate(), 100);
    },
    refresh() {
        // 懒加载时 init 可能错过，先尝试绑定事件再生成
        this.tryBindEvents();
        return this.generate();
    },
    tryBindEvents() {
        const btn = document.getElementById('generateReportBtn');
        if (!btn || btn._reportBound) return;
        btn._reportBound = true;
        this.populatePeriods();
        btn.addEventListener('click', () => this.generate());
        const printBtn = document.getElementById('printReportBtn');
        if (printBtn) printBtn.addEventListener('click', () => this.print());
        const typeSel = document.getElementById('reportType');
        if (typeSel) typeSel.addEventListener('change', () => this.populatePeriods());
        const exportFullBtn = document.getElementById('exportFullBtn');
        if (exportFullBtn) exportFullBtn.addEventListener('click', () => this.exportFull());
        const importFullBtn = document.getElementById('importFullBtn');
        if (importFullBtn) importFullBtn.addEventListener('click', () => document.getElementById('importFullInput').click());
        const importInput = document.getElementById('importFullInput');
        if (importInput) importInput.addEventListener('change', (e) => this.importFull(e.target.files[0]));
        const reportContent = document.getElementById('reportContent');
        if (reportContent && !reportContent._bsCloseDelegated) {
            reportContent.addEventListener('click', (e) => {
                const b = e.target.closest('.js-bs-close');
                if (b) {
                    const card = b.closest('.bs-detail-card');
                    if (card) card.remove();
                }
            });
            reportContent._bsCloseDelegated = true;
        }
    },
    populatePeriods() {
        const type = document.getElementById('reportType').value;
        const sel = document.getElementById('reportPeriod');
        sel.innerHTML = '';
        const now = new Date();
        if (type === 'monthly') {
            for (let m = 0; m < 12; m++) {
                const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
                const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                sel.innerHTML += `<option value="${val}">${val}</option>`;
            }
        } else if (type === 'quarterly') {
            const y = now.getFullYear();
            for (let q = 1; q <= 4; q++) sel.innerHTML += `<option value="${y}-Q${q}">${y}年 Q${q}</option>`;
            // 上一年季度
            const py = y - 1;
            for (let q = 1; q <= 4; q++) sel.innerHTML += `<option value="${py}-Q${q}">${py}年 Q${q}</option>`;
        } else {
            for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) sel.innerHTML += `<option value="${y}">${y}年</option>`;
        }
    },
    async generate() {
        const type = document.getElementById('reportType').value;
        const period = document.getElementById('reportPeriod').value;
        const container = document.getElementById('reportContent');
        showSkeleton(container, 6, 'grid');
        const data = await api(`/reports?type=${type}&period=${period}`);
        if (!data) { showEmpty(container, '暂无数据', '📊'); return; }
        this.currentData = data;
        this.render(data);
    },
    destroyCharts() {
        Object.keys(this.charts).forEach(id => { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } });
    },
    // 数字滚动动画：所有 .report-kpi-value / .report-assets-value / .report-compare-value 从 0 滚动到当前显示值
    animateNumbers(container) {
        if (!container || !window.countUpReport) return;
        const parseNum = str => {
            const s = String(str).replace(/[¥,，%+\s]/g, '');
            return parseFloat(s) || 0;
        };
        container.querySelectorAll('.report-kpi-value, .report-assets-value, .report-compare-value').forEach(el => {
            const target = parseNum(el.textContent);
            const isPct = el.textContent.includes('%');
            const isSigned = /^[+\-]/.test(el.textContent.trim());
            const sign = isSigned ? el.textContent.trim()[0] : '';
            window.countUpReport(el, target, 900, v => {
                let n = Math.round(v);
                if (isPct) return sign + n.toFixed(1) + '%';
                return sign + '¥' + n.toLocaleString('zh-CN');
            });
        });
    },
    render(data) {
        const container = document.getElementById('reportContent');
        this.destroyCharts();
        const bsTitle = data.balanceSheet ? `🏛️ 资产负债表（${data.balanceSheet.period.end} 快照）` : '🏛️ 资产负债表';

        // 渲染完成后触发数字滚动动画（延迟 100ms 让 CSS stagger 先执行）
        requestAnimationFrame(() => {
            setTimeout(() => this.animateNumbers(container), 100);
        });
        container.innerHTML = `
            <div class="report-header">
                <h2 class="report-title">📊 ${data.label} 财务报告</h2>
                <span class="report-date">${data.start} ~ ${data.end}</span>
            </div>
            <div class="report-grid report-grid--overview">
                ${this.renderKPIs(data)}
                ${this.renderCompare(data)}
                ${this.renderAssets(data)}
            </div>
            ${this.renderCharts(data)}
            ${this.renderRatios(data)}
            <div class="report-tables-row">
                ${this.renderBalanceSheet(data)}
                ${this.renderCashFlow(data)}
            </div>
            <div class="report-grid report-grid--detail">
                ${this.renderTopExpenses(data)}
                ${this.renderDebtSection(data)}
            </div>
        `;
        this.initCharts(data);
        this.initInteractions();
    },
    renderKPIs(data) {
        const s = data.summary;
        return `
            <div class="report-kpi-card income">
                <div class="report-kpi-label">总收入</div>
                <div class="report-kpi-value">${fmt(s.income)}</div>
                <div class="report-kpi-sub">${s.transactionCount} 笔交易</div>
            </div>
            <div class="report-kpi-card expense">
                <div class="report-kpi-label">总支出</div>
                <div class="report-kpi-value">${fmt(s.expense)}</div>
                <div class="report-kpi-sub">日均 ${fmt(s.avgDailyExpense)}</div>
            </div>
            <div class="report-kpi-card balance">
                <div class="report-kpi-label">净结余</div>
                <div class="report-kpi-value">${fmt(s.balance)}</div>
                <div class="report-kpi-sub">储蓄率 ${s.savingsRate.toFixed(1)}%</div>
            </div>
            <div class="report-kpi-card rate">
                <div class="report-kpi-label">储蓄率</div>
                <div class="report-kpi-value">${s.savingsRate.toFixed(1)}%</div>
                <div class="report-kpi-sub">${s.balance >= 0 ? '收支健康' : '支出超收入'}</div>
            </div>
        `;
    },
    renderCompare(data) {
        if (!data.compare) return '';
        const c = data.compare, s = data.summary;
        const incDiff = s.income - c.income;
        const expDiff = s.expense - c.expense;
        const balDiff = s.balance - c.balance;
        return `
            <div class="report-compare-card">
                <div class="report-section-title">📈 环比上期（${c.label}）</div>
                <div class="report-compare-grid">
                    <div class="report-compare-row">
                        <span class="report-compare-label">收入</span>
                        <span class="report-compare-value">${fmt(c.income)}</span>
                        <span class="report-compare-diff ${incDiff >= 0 ? 'up' : 'down'}">${incDiff >= 0 ? '↑' : '↓'} ${fmt(Math.abs(incDiff))}</span>
                    </div>
                    <div class="report-compare-row">
                        <span class="report-compare-label">支出</span>
                        <span class="report-compare-value">${fmt(c.expense)}</span>
                        <span class="report-compare-diff ${expDiff <= 0 ? 'up' : 'down'}">${expDiff <= 0 ? '↓' : '↑'} ${fmt(Math.abs(expDiff))}</span>
                    </div>
                    <div class="report-compare-row">
                        <span class="report-compare-label">结余</span>
                        <span class="report-compare-value">${fmt(c.balance)}</span>
                        <span class="report-compare-diff ${balDiff >= 0 ? 'up' : 'down'}">${balDiff >= 0 ? '↑' : '↓'} ${fmt(Math.abs(balDiff))}</span>
                    </div>
                </div>
            </div>
        `;
    },
    renderAssets(data) {
        const a = data.assets;
        return `
            <div class="report-assets-card">
                <div class="report-section-title">💰 资产快照</div>
                <div class="report-assets-value">${fmt(a.totalAssets)}</div>
                <div class="report-assets-sub">账户 ${fmt(a.accounts)} · 理财 ${fmt(a.investments)}</div>
            </div>
        `;
    },
    renderCharts(data) {
        return `
            <div class="report-charts-row">
                <div class="glass-card report-chart-card">
                    <h3 class="card-title">收支趋势</h3>
                    <canvas id="reportTrendChart"></canvas>
                </div>
                <div class="glass-card report-chart-card">
                    <h3 class="card-title"><span id="reportExpPieTitle">支出类别占比</span> <span id="reportExpPieBack" class="see-all" style="display:none;cursor:pointer">← 返回</span></h3>
                    <canvas id="reportExpPieChart"></canvas>
                    <div id="reportExpPieHint" class="pie-hint">👆 单击看金额 · 双击进二级</div>
                </div>
            </div>
            <div class="report-charts-row">
                <div class="glass-card report-chart-card">
                    <h3 class="card-title"><span id="reportIncPieTitle">收入来源占比</span> <span id="reportIncPieBack" class="see-all" style="display:none;cursor:pointer">← 返回</span></h3>
                    <canvas id="reportIncPieChart"></canvas>
                    <div id="reportIncPieHint" class="pie-hint">👆 单击看金额 · 双击进二级</div>
                </div>
                <div class="glass-card report-chart-card">
                    <h3 class="card-title">账户资金流向</h3>
                    <canvas id="reportAccountChart"></canvas>
                </div>
            </div>
        `;
    },
    rollupCategories(list) {
        // 后端已按「子级向父级汇总」（递归 CTE）给出每个分类的 rolled total（=自身+全部子孙），
        // 这里只做「树结构重组 + 排序」用于渲染与点击展开，不再前端重算金额，避免与后端口径不一致。
        const byId = new Map();
        (list || []).forEach(c => byId.set(String(c.id), { ...c, children: [], rolledTotal: parseFloat(c.total || 0) }));
        const roots = [];
        byId.forEach(c => {
            const pid = c.parent_id != null ? String(c.parent_id) : null;
            if (pid && byId.has(pid)) byId.get(pid).children.push(c);
            else roots.push(c);
        });
        roots.sort((a, b) => b.rolledTotal - a.rolledTotal);
        roots.forEach(r => r.children.sort((a, b) => b.rolledTotal - a.rolledTotal));
        return roots;
    },
    renderTopExpenses(data) {
        if (!data.topExpenses || data.topExpenses.length === 0) return '';
        const max = parseFloat(data.topExpenses[0].amount || 0);
        const total = data.summary.expense || 0;
        const items = data.topExpenses.map((t, i) => {
            const pctOfMax = max > 0 ? (parseFloat(t.amount || 0) / max * 100) : 0;
            const pctOfTotal = total > 0 ? (parseFloat(t.amount || 0) / total * 100) : 0;
            return `
                <div class="report-top-item">
                    <div class="report-top-rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
                    <div class="report-top-info">
                        <div class="report-top-name">${escapeHtml(t.category_icon || '📌')} ${escapeHtml(t.category_name || '未分类')} · ${escapeHtml(t.note || '无备注')}</div>
                        <div class="report-top-bar-wrap">
                            <div class="report-top-bar"><div class="report-top-bar-fill" style="width:${Math.min(100, pctOfMax).toFixed(1)}%"></div></div>
                            <span class="report-top-pct">占总额 ${pctOfTotal.toFixed(1)}%</span>
                        </div>
                        <div class="report-top-meta">${String(t.date).slice(0, 10)}</div>
                    </div>
                    <div class="report-top-amount">${fmt(t.amount)}</div>
                </div>
            `;
        }).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">🔥 支出 TOP 5</h3>
                <div class="glass-card report-top-list">${items}</div>
            </div>
        `;
    },
    renderBudgetExecution(data) {
        if (!data.budgetExecution || data.budgetExecution.length === 0) return '';
        const items = data.budgetExecution.map(b => {
            const actual = parseFloat(b.actual || 0);
            const budget = parseFloat(b.budget || 0);
            const over = actual > budget;
            const remaining = budget - actual;
            let statusCls = 'safe';
            if (budget <= 0) statusCls = 'na';
            else if (actual > budget) statusCls = 'over';
            else if (b.usage >= 80) statusCls = 'warn';
            const statusText = budget <= 0 ? '未设预算'
                : actual === 0 ? '未开始'
                : over ? `超支 ${fmt(Math.abs(remaining))}`
                : remaining === 0 ? '刚好用完'
                : `剩余 ${fmt(remaining)}`;
            return `
                <div class="report-budget-item ${statusCls}">
                    <div class="report-budget-header">
                        <span class="report-budget-name">${escapeHtml(b.icon || "📊")} ${escapeHtml(b.name)}</span>
                        <span class="report-budget-status ${statusCls}">${statusText}</span>
                    </div>
                    <div class="report-budget-amount-line">已用 ${fmt(actual)} / 预算 ${fmt(budget)}</div>
                    <div class="report-progress-wrap">
                        <div class="report-progress"><div class="report-progress-bar ${statusCls}" style="width:${budget > 0 ? Math.min(100, (actual / budget * 100)) : 0}%"></div></div>
                        <span class="report-progress-text ${statusCls}">${b.usage.toFixed(1)}%</span>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">🎯 预算执行情况</h3>
                <div class="glass-card report-budget-list">${items}</div>
            </div>
        `;
    },
    renderDebtSection(data) {
        const d = data.debts;
        if (!d) return '';
        if (d.count === 0) {
            return `
                <div class="report-section">
                    <h3 class="report-section-title">💳 债务情况</h3>
                    <div class="glass-card report-budget-list"><div class="empty-hint"><div class="empty-icon">💳</div><p>本周期无活跃债务</p></div></div>
                </div>
            `;
        }
        const overdueTag = d.overdue > 0 ? `<span style="color:#ef4444;font-weight:bold;">⚠️ 逾期 ${d.overdue} 笔</span>` : '';
        const headerKpi = `
            <div class="report-compare-grid debt-kpi-grid">
                <div class="report-compare-row">
                    <span class="report-compare-label">总负债</span>
                    <span class="report-compare-value">${fmt(d.totalRemaining)}</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">本期已还款</span>
                    <span class="report-compare-value">${fmt(d.paidInPeriod || 0)}</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">本期还款笔数</span>
                    <span class="report-compare-value">${d.repaymentCount || 0} 笔</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">总债务笔数</span>
                    <span class="report-compare-value">${d.count} 笔 · ${overdueTag}</span>
                </div>
            </div>
        `;
        const debtItems = (d.list || []).map(item => `
            <div class="report-budget-item">
                <div class="report-budget-header">
                    <span class="report-budget-name">${item.type === 'credit_card' ? '💳' : item.type === 'loan' ? '🏦' : '📝'} ${escapeHtml(item.name)} <span style="font-size:11px;color:var(--text-tertiary);margin-left:6px">${item.type === 'credit_card' ? '信用卡' : item.type === 'loan' ? '贷款' : item.type === 'personal' ? '个人借款' : '其他'}</span></span>
                    <span class="report-budget-amount">${fmt(item.remaining)} / ${fmt(item.principal)}</span>
                </div>
                <div class="report-progress-wrap">
                    <div class="report-progress"><div class="report-progress-bar" style="width:${item.principal > 0 ? Math.min(100, (item.principal - item.remaining) / item.principal * 100) : 0}%"></div></div>
                    <span class="report-progress-text">${item.principal > 0 ? ((item.principal - item.remaining) / item.principal * 100).toFixed(1) : 0}% 已还</span>
                </div>
                <div class="report-budget-header" style="margin-top:4px;">
                    <span style="font-size:11px;color:var(--text-tertiary);">本期还款 ${item.periodRepayments} 笔 · ${fmt(item.periodPaid)}</span>
                    <span style="font-size:11px;color:var(--text-tertiary);">月供 ${fmt(item.monthly_payment)}</span>
                </div>
            </div>
        `).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">💳 债务情况${overdueTag}</h3>
                <div class="glass-card" style="margin-bottom:12px;">${headerKpi}</div>
                ${debtItems ? `<div class="glass-card report-budget-list">${debtItems}</div>` : ''}
                ${(d.repayments || []).length > 0 ? `
                    <div class="glass-card" style="margin-top:12px;">
                        <h4 class="report-table-title">本期还款流水</h4>
                        <table class="report-table">
                            <thead><tr><th>日期</th><th>债务</th><th>金额</th><th>本金</th><th>利息</th><th>备注</th></tr></thead>
                            <tbody>
                                ${d.repayments.map(r => `<tr>
                                    <td>${r.paid_at}</td>
                                    <td>${escapeHtml(r.debt_name || '')}</td>
                                    <td class="report-amount">${fmt(r.amount)}</td>
                                    <td>${fmt(r.principal_part || 0)}</td>
                                    <td>${fmt(r.interest_part || 0)}</td>
                                    <td>${escapeHtml(r.note || '')}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}
            </div>
        `;
    },
    renderRatios(data) {
        const r = data.ratios;
        if (!r) return '';
        const flag = (val, threshold, warn, ok, lowerIsBetter = true) => {
            const bad = lowerIsBetter ? val > threshold : val < threshold;
            return `<span class="ratio-flag ${bad ? 'bad' : 'good'}">${bad ? warn : ok}</span>`;
        };
        return `
            <div class="report-section">
                <h3 class="report-section-title">📊 关键财务比率</h3>
                <div class="glass-card ratio-grid">
                    <div class="ratio-item">
                        <div class="ratio-label">储蓄率 ${flag(r.savingsRate, 30, '偏低', '健康')}</div>
                        <div class="ratio-value">${r.savingsRate.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill" style="width:${Math.min(100, r.savingsRate)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">负债率 ${flag(r.debtRatio, 50, '警戒', '健康')}</div>
                        <div class="ratio-value">${r.debtRatio.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill warn" style="width:${Math.min(100, r.debtRatio)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">还款收入比 ${flag(r.debtPaymentRatio, 40, '过高', '可控')}</div>
                        <div class="ratio-value">${r.debtPaymentRatio.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill warn" style="width:${Math.min(100, r.debtPaymentRatio)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">资产负债率 ${flag(r.assetLiabilityRatio, 50, '警戒', '健康')}</div>
                        <div class="ratio-value">${r.assetLiabilityRatio.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill warn" style="width:${Math.min(100, r.assetLiabilityRatio)}%"></div></div>
                    </div>
                </div>
            </div>
        `;
    },
    renderBalanceSheet(data) {
        const bs = data.balanceSheet;
        if (!bs) return '';
        const changeColor = bs.change >= 0 ? 'income' : 'expense';
        const changeArrow = bs.change >= 0 ? '↑' : '↓';
        return `
            <div class="report-section">
                <h3 class="report-section-title">🏛️ 资产负债表（${bs.period.end} 快照）</h3>
                <div class="balance-sheet">
                    <!-- 资产 -->
                    <div class="bs-side">
                        <div class="bs-side-header bs-asset-header">资产</div>
                        <div class="bs-section">
                            <div class="bs-section-title">流动资产 <span class="bs-total">${fmt(bs.assets.current.total)}</span></div>
                            ${bs.assets.current.items.length === 0 ? '<div class="bs-empty">无账户</div>' :
                              bs.assets.current.items.map(a => `
                                <div class="bs-row">
                                    <span>${escapeHtml(a.name)}</span>
                                    <span>${fmt(a.total)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">投资资产 <span class="bs-total">${fmt(bs.assets.investment.total)}</span></div>
                            ${bs.assets.investment.items.length === 0 ? '<div class="bs-empty">无投资</div>' :
                              bs.assets.investment.items.map(i => `
                                <div class="bs-row">
                                    <span>${escapeHtml(i.name)}</span>
                                    <span>${fmt(i.total)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-row bs-total-row">
                            <span><strong>资产合计</strong></span>
                            <span><strong>${fmt(bs.assets.total)}</strong></span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>期初</span>
                            <span>${fmt(bs.assets.opening)}</span>
                        </div>
                    </div>
                    <!-- 负债+净资产 -->
                    <div class="bs-side">
                        <div class="bs-side-header bs-liab-header">负债 + 净资产</div>
                        <div class="bs-section">
                            <div class="bs-section-title">短期负债 <span class="bs-total">${fmt(bs.liabilities.shortTerm.total)}</span></div>
                            ${bs.liabilities.shortTerm.items.length === 0 ? '<div class="bs-empty">无短期负债</div>' :
                              bs.liabilities.shortTerm.items.map(d => `
                                <div class="bs-row clickable" data-debt-id="${d.id}">
                                    <span>${escapeHtml(d.name)}</span>
                                    <span>${fmt(d.remaining)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">信用卡 <span class="bs-total">${fmt(bs.liabilities.creditCard.total)}</span></div>
                            <div class="bs-meta-line">${escapeHtml(bs.liabilities.creditCard.note || '')}</div>
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">长期负债 <span class="bs-total">${fmt(bs.liabilities.longTerm.total)}</span></div>
                            ${bs.liabilities.longTerm.items.length === 0 ? '<div class="bs-empty">无长期负债</div>' :
                              bs.liabilities.longTerm.items.map(d => `
                                <div class="bs-row clickable" data-debt-id="${d.id}">
                                    <span>${escapeHtml(d.name)} <span class="bs-meta-inline">${d.term_months || 0}月</span></span>
                                    <span>${fmt(d.remaining)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-row bs-total-row">
                            <span><strong>负债合计</strong></span>
                            <span><strong>${fmt(bs.liabilities.total)}</strong></span>
                        </div>
                        <div class="bs-row bs-net-worth-row">
                            <span><strong>净资产 = 资产 - 负债</strong></span>
                            <span><strong>${fmt(bs.netWorth)}</strong></span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>期初净资产</span>
                            <span>${fmt(bs.openingNetWorth)}</span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>本期变化</span>
                            <span class="${changeColor}">${changeArrow} ${fmt(Math.abs(bs.change))}</span>
                        </div>
                    </div>
                </div>
                <div id="bsDetailContainer"></div>
            </div>
        `;
    },
    renderCashFlow(data) {
        const cf = data.cashFlow;
        if (!cf) return '';
        const flowRow = (label, inflow, outflow, net, color) => `
            <div class="cf-row">
                <div class="cf-label">${label}</div>
                <div class="cf-flows">
                    <span class="cf-inflow">+${fmt(inflow)}</span>
                    <span class="cf-outflow">-${fmt(outflow)}</span>
                </div>
                <div class="cf-net ${color}">${net >= 0 ? '+' : ''}${fmt(net)}</div>
            </div>
        `;
        const totalColor = cf.netChange >= 0 ? 'income' : 'expense';
        return `
            <div class="report-section">
                <h3 class="report-section-title">💧 现金流量表</h3>
                <div class="glass-card">
                    <div class="cf-header">
                        <span></span>
                        <span class="cf-header-inflow">流入</span>
                        <span class="cf-header-outflow">流出</span>
                        <span class="cf-header-net">净额</span>
                    </div>
                    ${flowRow('🏢 经营活动（日常收支）', cf.operating.inflow, cf.operating.outflow, cf.operating.net, cf.operating.net >= 0 ? 'income' : 'expense')}
                    ${flowRow('📈 投资活动', cf.investing.inflow, cf.investing.outflow, cf.investing.net, cf.investing.net >= 0 ? 'income' : 'expense')}
                    ${flowRow('🏦 筹资活动（借还款）', cf.financing.inflow, cf.financing.outflow, cf.financing.net, cf.financing.net >= 0 ? 'income' : 'expense')}
                    <div class="cf-row cf-total">
                        <div class="cf-label"><strong>本期现金净变化</strong></div>
                        <div class="cf-flows"></div>
                        <div class="cf-net ${totalColor}"><strong>${cf.netChange >= 0 ? '+' : ''}${fmt(cf.netChange)}</strong></div>
                    </div>
                    <div class="cf-note">${escapeHtml(cf.note || '')}</div>
                </div>
            </div>
        `;
    },
    initInteractions() {
        // 债务行点击：展开还款明细
        const container = document.getElementById('reportContent');
        if (!container) return;
        container.addEventListener('click', async (e) => {
            const debtRow = e.target.closest('.bs-row.clickable[data-debt-id]');
            const accountRow = e.target.closest('.bs-row.clickable[data-account-id]');
            if (debtRow) {
                await this.toggleDebtDetail(debtRow.dataset.debtId);
            } else if (accountRow && accountRow.dataset.accountId) {
                await this.toggleAccountDetail(accountRow.dataset.accountId);
            }
        });
    },
    async toggleDebtDetail(debtId) {
        const target = document.getElementById('bsDetailContainer');
        const existing = target.querySelector(`[data-detail-debt="${debtId}"]`);
        if (existing) { existing.remove(); return; }
        // 收起其他展开项
        target.innerHTML = '';
        const data = await api(`/debts/${debtId}`);
        if (!data || !data.debt) return;
        const d = data.debt;
        const reps = data.repayments || [];
        const totalPaid = reps.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
        const rows = reps.slice(0, 20).map(r => `
            <tr>
                <td>${r.paid_at}</td>
                <td class="report-amount">${fmt(r.amount)}</td>
                <td>${fmt(r.principal_part || 0)}</td>
                <td>${fmt(r.interest_part || 0)}</td>
                <td>${escapeHtml(r.note || '')}</td>
            </tr>
        `).join('');
        target.innerHTML = `
            <div class="bs-detail-card" data-detail-debt="${debtId}">
                <div class="bs-detail-header">
                    <h4>📋 ${escapeHtml(d.name)} 还款明细 <span class="bs-meta-inline">${reps.length} 笔记录</span></h4>
                    <button class="btn-close js-bs-close" aria-label="关闭">✕</button>
                </div>
                <div class="bs-detail-stats">
                    <div><span class="stat-label">本金</span><span>${fmt(d.principal)}</span></div>
                    <div><span class="stat-label">剩余</span><span>${fmt(d.remaining)}</span></div>
                    <div><span class="stat-label">月供</span><span>${fmt(d.monthly_payment)}</span></div>
                    <div><span class="stat-label">已还总额</span><span>${fmt(totalPaid)}</span></div>
                </div>
                ${rows ? `<table class="report-table"><thead><tr><th>日期</th><th>金额</th><th>本金</th><th>利息</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="bs-empty">暂无还款记录</div>'}
            </div>
        `;
    },
    async toggleAccountDetail(accountId) {
        const target = document.getElementById('bsDetailContainer');
        const existing = target.querySelector(`[data-detail-account="${accountId}"]`);
        if (existing) { existing.remove(); return; }
        target.innerHTML = '';
        const data = await api(`/accounts/${accountId}/transactions?limit=10`);
        if (!data) return;
        const acc = data.account;
        const rows = (data.transactions || []).map(t => `
            <tr>
                <td>${t.date}</td>
                <td>${escapeHtml(t.category_name || '')}</td>
                <td class="report-amount ${t.type === 'expense' ? 'expense' : 'income'}">${t.type === 'expense' ? '-' : '+'}${fmt(t.amount)}</td>
                <td>${escapeHtml(t.note || '')}</td>
            </tr>
        `).join('');
        target.innerHTML = `
            <div class="bs-detail-card" data-detail-account="${accountId}">
                <div class="bs-detail-header">
                    <h4>🏦 ${escapeHtml(acc.name)} 最近流水</h4>
                    <button class="btn-close js-bs-close" aria-label="关闭">✕</button>
                </div>
                ${rows ? `<table class="report-table"><thead><tr><th>日期</th><th>类别</th><th>金额</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="bs-empty">暂无流水</div>'}
            </div>
        `;
    },
    initCharts(data) {
        ChartManager.applyDefaults();
        const c = ChartManager.colors();
        // 收支趋势
        const trendCtx = document.getElementById('reportTrendChart');
        if (trendCtx && data.dailyTrend.length > 0) {
            const labels = data.dailyTrend.map(d => d.date.slice(5));
            const ctx = trendCtx.getContext('2d');
            // 渐变填充
            const incGrad = ctx.createLinearGradient(0, 0, 0, 220);
            incGrad.addColorStop(0, c.inc + '30');
            incGrad.addColorStop(1, c.inc + '04');
            const expGrad = ctx.createLinearGradient(0, 0, 0, 220);
            expGrad.addColorStop(0, c.exp + '30');
            expGrad.addColorStop(1, c.exp + '04');
            this.charts.trend = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: '收入', data: data.dailyTrend.map(d => d.income), borderColor: c.inc, backgroundColor: incGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.inc, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 },
                        { label: '支出', data: data.dailyTrend.map(d => d.expense), borderColor: c.exp, backgroundColor: expGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.exp, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: ChartManager.reduceMotion() ? false : { duration: 1200, easing: 'easeOutQuart' },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: c.bg, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, cornerRadius: 10, padding: 12 }
                    },
                    scales: {
                        x: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } },
                        y: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } }
                    }
                }
            });
        }
        // 支出饼图（仅显示一级 parent_id=null；单击看金额、双击下钻子级，数据库已做子级向父级汇总）
        const expPieCtx = document.getElementById('reportExpPieChart');
        if (expPieCtx && data.expenseByCategory && data.expenseByCategory.length > 0) {
            this._reportPieState = this._reportPieState || {};
            this._reportPieState.exp = { full: data.expenseByCategory, stack: [], selIdx: -1, selStackLen: 0 };
            this._drawReportPie('reportExpPieChart', 'exp');
        }
        // 收入饼图（同上：单击看金额、双击下钻）
        const incPieCtx = document.getElementById('reportIncPieChart');
        if (incPieCtx && data.incomeByCategory && data.incomeByCategory.length > 0) {
            this._reportPieState = this._reportPieState || {};
            this._reportPieState.inc = { full: data.incomeByCategory, stack: [], selIdx: -1, selStackLen: 0 };
            this._drawReportPie('reportIncPieChart', 'inc');
        }
        // 饼图下钻「返回」按钮（每次 render 后 DOM 重建，需重新绑定 onclick）
        ['exp', 'inc'].forEach(key => {
            const canvasId = key === 'exp' ? 'reportExpPieChart' : 'reportIncPieChart';
            const backId = key === 'exp' ? 'reportExpPieBack' : 'reportIncPieBack';
            const backEl = document.getElementById(backId);
            if (backEl) {
                backEl.onclick = () => {
                    const st = this._reportPieState && this._reportPieState[key];
                    if (st && st.stack.length) {
                        ChartManager._cancelPieClick(canvasId);
                        st.selIdx = -1;
                        st.stack.pop();
                        this._drawReportPie(canvasId, key);
                    }
                };
            }
        });
        // 账户资金流向（柱状图卡片版）
        const accCtx = document.getElementById('reportAccountChart');
        if (accCtx && data.accountFlows && data.accountFlows.length > 0) {
            const aCtx = accCtx.getContext('2d');
            // 净流入/净流出条形渐变
            const posGrad = aCtx.createLinearGradient(0, 0, 0, 220);
            posGrad.addColorStop(0, c.inc + 'cc');
            posGrad.addColorStop(1, c.inc + '66');
            const negGrad = aCtx.createLinearGradient(0, 0, 0, 220);
            negGrad.addColorStop(0, c.exp + 'cc');
            negGrad.addColorStop(1, c.exp + '66');
            this.charts.accFlow = new Chart(accCtx, {
                type: 'bar',
                data: {
                    labels: data.accountFlows.map(a => a.name),
                    datasets: [{
                        label: '净流入',
                        data: data.accountFlows.map(a => a.net),
                        backgroundColor: data.accountFlows.map(a => a.net >= 0 ? posGrad : negGrad),
                        borderColor: data.accountFlows.map(a => a.net >= 0 ? c.inc : c.exp),
                        borderWidth: 1, borderRadius: 8, borderSkipped: false,
                        hoverBackgroundColor: data.accountFlows.map(a => a.net >= 0 ? c.inc : c.exp)
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: ChartManager.reduceMotion() ? false : { duration: 1000, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: c.bg, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, cornerRadius: 10, padding: 12 }
                    },
                    scales: {
                        x: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } },
                        y: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } }
                    }
                }
            });
        }
    },
    // 报表饼图绘制（支持按一级 + 点击扇区下钻子级，与仪表盘支出饼图同模式）
    _drawReportPie(canvasId, key) {
        const c = ChartManager.colors();
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const state = this._reportPieState && this._reportPieState[key];
        if (!state) return;
        const full = state.full;
        const stack = state.stack;
        // 当前层级：栈空=一级（parent_id 为 null）；否则取栈顶父级的直接子级
        const slices = stack.length === 0
            ? full.filter(e => e.parent_id == null)
            : full.filter(e => e.parent_id === stack[stack.length - 1]);
        state.slices = slices;

        const baseTitle = key === 'exp' ? '支出类别占比' : '收入来源占比';
        const isExp = canvasId === 'reportExpPieChart';
        const titleEl = document.getElementById(isExp ? 'reportExpPieTitle' : 'reportIncPieTitle');
        const backEl = document.getElementById(isExp ? 'reportExpPieBack' : 'reportIncPieBack');
        const hintEl = document.getElementById(isExp ? 'reportExpPieHint' : 'reportIncPieHint');
        if (titleEl) {
            if (stack.length === 0) titleEl.textContent = baseTitle;
            else {
                const names = stack.map(id => (full.find(x => x.id === id) || {}).name || '');
                titleEl.textContent = baseTitle + ' › ' + names.join(' › ');
            }
        }
        if (backEl) backEl.style.display = stack.length ? '' : 'none';
        if (hintEl) hintEl.style.display = stack.length ? 'none' : '';

        const total = slices.reduce((s, e) => s + parseFloat(e.total || 0), 0);
        if (this.charts[canvasId]) this.charts[canvasId].destroy();
        // 重绘前清掉待决的单击，避免定时器回调打到已 destroy 的 chart 上
        ChartManager._cancelPieClick(canvasId);
        // 层级变了，旧的选中下标指向的已是另一个分类
        if (state.selIdx == null || state.selStackLen !== stack.length) {
            state.selIdx = -1;
            state.selStackLen = stack.length;
        }
        // 中心读数：未选中显示合计，单击某块后显示「分类名 · 占比」+ 该块金额。
        // 原实现没有中心读数（只靠 hover tooltip），单击看金额就没有落点了。
        const centerLabel = key === 'exp' ? '总支出' : '总收入';
        const centerTextPlugin = ChartManager._pieCenterPlugin(canvasId + 'Center', c, () => {
            const i = state.selIdx;
            if (i != null && i >= 0 && i < slices.length) {
                const e = slices[i];
                const v = parseFloat(e.total || 0);
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return {
                    title: `${e.name} · ${pct}%`,
                    amount: '¥' + Math.round(v).toLocaleString('zh-CN')
                };
            }
            return { title: centerLabel, amount: '¥' + Math.round(total).toLocaleString('zh-CN') };
        });
        this.charts[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: slices.map(e => (e.icon || '📌') + ' ' + e.name),
                datasets: [{
                    data: slices.map(e => parseFloat(e.total || 0)),
                    backgroundColor: slices.map((_, i) => c.cats[i % c.cats.length]),
                    borderColor: 'rgba(255, 252, 245, 0.95)',
                    borderWidth: 3,
                    borderRadius: 6,
                    spacing: 2,
                    hoverOffset: 8,
                    // 选中块外扩，让单击有明确的视觉落点（触屏没有 hover）
                    offset: slices.map((_, i) => (i === state.selIdx ? 8 : 0))
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '72%',
                animation: ChartManager.reduceMotion() ? false : { duration: 800, easing: 'easeOutQuart' },
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const idx = els[0].index;
                    const cat = slices[idx];
                    if (!cat) return;
                    const hasChildren = full.some(x => x.parent_id === cat.id);
                    ChartManager._dispatchPieClick(
                        canvasId,
                        idx,
                        // 单击：选中该块 → 环心显示它的金额与占比
                        () => { state.selIdx = idx; this._drawReportPie(canvasId, key); },
                        // 双击：下钻到二级（无子类则退化为单击）
                        hasChildren
                            ? () => { state.selIdx = -1; state.stack.push(cat.id); this._drawReportPie(canvasId, key); }
                            : null
                    );
                },
                plugins: {
                    legend: { display: false },
                    // 报表收支环同样禁用 tooltip：中心读数已展示「分类名 · 占比 + 金额」，
                    // 悬浮框重复且会挡住下半环（与 chart.js 两个环图保持一致）。
                    tooltip: { enabled: false }
                }
            },
            plugins: [centerTextPlugin]
        });
    },

    async exportCSV() {
        if (!this.currentData) { showToast('请先生成报表', 'warning'); return; }
        const d = this.currentData;
        const period = d.period;
        const s = d.summary;
        let csv = '\uFEFF鑫钱包财务报告,\n';
        csv += `报表周期,${d.label},\n`;
        csv += `总收入,${s.income.toFixed(2)},\n`;
        csv += `总支出,${s.expense.toFixed(2)},\n`;
        csv += `净结余,${s.balance.toFixed(2)},\n`;
        csv += `储蓄率,${s.savingsRate.toFixed(2)}%,\n\n`;
        csv += '支出类别,金额,占比\n';
        this.rollupCategories(d.expenseByCategory).forEach(e => { csv += `${e.name},${e.rolledTotal.toFixed(2)},${d.summary.expense > 0 ? (e.rolledTotal / d.summary.expense * 100).toFixed(2) : 0}%\n`; });
        csv += '\n收入类别,金额,占比\n';
        this.rollupCategories(d.incomeByCategory).forEach(e => { csv += `${e.name},${e.rolledTotal.toFixed(2)},${d.summary.income > 0 ? (e.rolledTotal / d.summary.income * 100).toFixed(2) : 0}%\n`; });
        csv += '\n日期,收入,支出\n';
        d.dailyTrend.forEach(t => { csv += `${fmtDateTime(t.date)},${t.income.toFixed(2)},${t.expense.toFixed(2)}\n`; });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `鑫钱包_财务报告_${period}.csv`; a.click();
        URL.revokeObjectURL(url);
        showToast('CSV 已导出', 'success');
    },
    async exportFull() {
        showToast('正在导出完整账本备份...', 'info');
        try {
            const res = await fetch(`${API}/backup/export`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('xin_token') }
            });
            if (!res.ok) throw new Error('导出失败');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `xinwallet_backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('完整账本已导出（xlsx 备份，含账户/交易/预算/理财/储蓄目标/债务）', 'success');
        } catch (err) {
            showToast('导出失败: ' + err.message, 'error');
        }
    },

    async importFull(file) {
        if (!file) return;
        // 导入会先清空当前账本全部数据再恢复（干净账本），属破坏性操作，
        // 用自定义模态框确认（不使用原生 confirm()，其在「先选文件再确认」流程里易被
        // 浏览器弹窗拦截策略/广告拦截扩展拦截，拦截后静默返回 false 导致导入无声失败）。
        const mergeChk = document.getElementById('mergeImportChk');
        const merge = !!(mergeChk && mergeChk.checked);
        const ok = await confirmClearImport(merge ? 'merge' : 'replace');
        if (!ok) { document.getElementById('importFullInput').value = ''; return; }
        showToast('正在' + (merge ? '合并' : '清空并') + '导入账本，请稍候...', 'info');
        try {
            const fd = new FormData();
            fd.append('file', file, file.name);
            fd.append('mode', merge ? 'merge' : 'replace');
            const token = localStorage.getItem('xin_token');
            const res = await fetch(`${API}/backup/import`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: fd
            });
            const result = await res.json();
            if (!result.success) throw new Error(result.message || '导入失败');
            const imp = result.data.imported;
            const parts = [];
            if (imp.accounts) parts.push(`账户${imp.accounts}`);
            if (imp.categories) parts.push(`分类${imp.categories}`);
            if (imp.transactions) parts.push(`交易${imp.transactions}`);
            if (imp.transfers) parts.push(`转账${imp.transfers}`);
            if (imp.budgets) parts.push(`预算${imp.budgets}`);
            if (imp.savings_goals) parts.push(`储蓄${imp.savings_goals}`);
            if (imp.investments) parts.push(`理财${imp.investments}`);
            if (imp.debts) parts.push(`债务${imp.debts}`);
            if (imp.tags) parts.push(`标签${imp.tags}`);
            showToast(`导入完成：${parts.join(' ')}`, 'success');
            await initCache();
            await DashboardManager.refresh();
        } catch (err) {
            showToast('导入失败: ' + err.message, 'error');
        }
        document.getElementById('importFullInput').value = '';
    },

    // 导入前破坏性确认：返回 Promise<boolean>。自建 DOM 模态框，不被浏览器弹窗拦截。
    confirmClearImport(mode) { return confirmClearImport(mode); },

    print() {
        // 打印前：强制重绘所有 Chart.js 图表以适应新的容器尺寸
        Object.values(this.charts).forEach(c => { if (c && c.resize) c.resize(); });
        // 短暂延迟后打印（让浏览器布局完成）
        setTimeout(() => window.print(), 200);
    }
};

// 导入前确认：自建 DOM 模态框（不用原生 confirm，避免被浏览器弹窗拦截）。
// 返回 Promise<boolean>：用户点确认按钮为 true，取消/关闭为 false。
// mode：'replace'（默认，清空当前账本后恢复）；'merge'（不清空，仅补入缺失数据）。
function confirmClearImport(mode) {
    const merge = mode === 'merge';
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        overlay.style.zIndex = '2000';
        overlay.innerHTML = merge ? `
            <div class="modal glass-card" style="max-width:440px">
                <div class="modal-header">
                    <h3>🔀 合并导入</h3>
                    <button class="modal-close" aria-label="关闭">✕</button>
                </div>
                <div class="modal-body" style="padding:12px 16px 4px;line-height:1.6">
                    <p>合并导入会<strong>保留当前账本现有数据</strong>，仅把备份中缺失的账户 / 分类 / 交易等补进来（按名称或去重跳过已存在的）。</p>
                    <p style="color:var(--text-secondary);font-size:var(--text-caption)">不会删除或覆盖现有数据，适合在多处导出的备份间累加。同名已存在的主数据、相同交易/转账将被跳过。</p>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
                    <button class="btn btn-ghost" data-act="cancel">取消</button>
                    <button class="btn btn-primary" data-act="ok">合并导入</button>
                </div>
            </div>` : `
            <div class="modal glass-card" style="max-width:440px">
                <div class="modal-header">
                    <h3>⚠️ 导入将清空当前账本</h3>
                    <button class="modal-close" aria-label="关闭">✕</button>
                </div>
                <div class="modal-body" style="padding:12px 16px 4px;line-height:1.6">
                    <p>导入新账单前，会<strong>先清空当前账本的全部数据</strong>，再恢复备份内容，确保得到干净账本。</p>
                    <p style="color:var(--text-secondary);font-size:var(--text-caption)">
                        将清空：账户 / 分类 / 标签 / 预算 / 交易 / 转账 / 理财 / 储蓄目标 / 债务（系统预设分类保留）。此操作不可撤销。
                    </p>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
                    <button class="btn btn-ghost" data-act="cancel">取消</button>
                    <button class="btn btn-danger" data-act="ok">清空并导入</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const done = (val) => { overlay.remove(); resolve(val); };
        overlay.querySelector('.modal-close').addEventListener('click', () => done(false));
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
        overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') { overlay.remove(); resolve(false); document.removeEventListener('keydown', onEsc); }
        });
    });
}

export default ReportManager;