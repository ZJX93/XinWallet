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

// 债务类型标签兜底（走字典 report.debt.type.*，不能用模块级常量直接展示：语言切换后需实时取值）
const DEBT_TYPE_FALLBACK = { credit_card: '信用卡', loan: '贷款', personal: '个人借款', other: '其他' };

const ReportManager = {
    charts: {},
    currentData: null,
    /**
     * 周期标签本地化。
     * 后端 label 固定为中文（「2026年9月」「2026年 Q3」「2026年」），英文界面直接显示会中英混排。
     * 中文界面沿用后端 label（含自定义区间等特殊格式）；英文界面按 period 串重新格式化，
     * 解析不出来（如自定义区间 '2026-01 ~ 2026-03'）时回退后端 label。
     */
    periodLabel(period, fallbackLabel) {
        const isZh = !(window.I18N && window.I18N.isZh && !window.I18N.isZh());
        if (isZh) return fallbackLabel || period || '';
        const p = String(period || '');
        let m = p.match(/^(\d{4})-(\d{2})$/);
        if (m) {
            const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        }
        m = p.match(/^(\d{4})-Q(\d)$/);
        if (m) return tt('report.periodOpt.quarter', '{y}年 Q{q}').replace('{y}', m[1]).replace('{q}', m[2]);
        if (/^\d{4}$/.test(p)) return tt('report.periodOpt.year', '{y}年').replace('{y}', p);
        return fallbackLabel || p;
    },
    /**
     * 后端返回的中文说明文案本地化。
     * 中文界面直接用后端值（保持与服务端口径一致）；英文界面改用字典键，避免中英混排。
     */
    serverNote(key, serverText) {
        const isZh = !(window.I18N && window.I18N.isZh && !window.I18N.isZh());
        if (isZh) return serverText || tt(key, '');
        return tt(key, serverText || '');
    },
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
            const qLabel = (yy, q) => escapeHtml(tt('report.periodOpt.quarter', '{y}年 Q{q}').replace('{y}', yy).replace('{q}', q));
            for (let q = 1; q <= 4; q++) sel.innerHTML += `<option value="${y}-Q${q}">${qLabel(y, q)}</option>`;
            // 上一年季度
            const py = y - 1;
            for (let q = 1; q <= 4; q++) sel.innerHTML += `<option value="${py}-Q${q}">${qLabel(py, q)}</option>`;
        } else {
            for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
                sel.innerHTML += `<option value="${y}">${escapeHtml(tt('report.periodOpt.year', '{y}年').replace('{y}', y))}</option>`;
            }
        }
    },
    async generate() {
        const type = document.getElementById('reportType').value;
        const period = document.getElementById('reportPeriod').value;
        const container = document.getElementById('reportContent');
        showSkeleton(container, 6, 'grid');
        const data = await api(`/reports?type=${type}&period=${period}`);
        if (!data) { showEmpty(container, tt('report.noData', '暂无数据')); return; }
        this.currentData = data;
        this.render(data);
    },
    destroyCharts() {
        Object.keys(this.charts).forEach(id => { if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; } });
    },
    // 数字滚动动画：所有 .report-kpi-value / .report-assets-value / .report-compare-value 从 0 滚动到当前显示值
    animateNumbers(container) {
        if (!container || !window.countUpReport) return;
        // 反解已渲染文本里的数字：货币符号随语言/币种变化（¥ / $ / € …），
        // 故按「只保留数字、正负号、小数点」清洗，而不是枚举符号。
        const parseNum = str => {
            const s = String(str).replace(/[^\d.\-]/g, '');
            return parseFloat(s) || 0;
        };
        container.querySelectorAll('.report-kpi-value, .report-assets-value, .report-compare-value').forEach(el => {
            const target = parseNum(el.textContent);
            const isPct = el.textContent.includes('%');
            const isSigned = /^[+\-]/.test(el.textContent.trim());
            const sign = isSigned ? el.textContent.trim()[0] : '';
            window.countUpReport(el, target, 900, v => {
                if (isPct) return sign + Math.round(v).toFixed(1) + '%';
                // 走 fmt() 复用多币种格式化，避免动画结束后与静态渲染的符号不一致
                return sign + fmt(Math.round(v));
            });
        });
    },
    render(data) {
        const container = document.getElementById('reportContent');
        this.destroyCharts();

        // 渲染完成后触发数字滚动动画（延迟 100ms 让 CSS stagger 先执行）
        requestAnimationFrame(() => {
            setTimeout(() => this.animateNumbers(container), 100);
        });
        container.innerHTML = `
            <div class="report-header">
                <h2 class="report-title">${escapeHtml(tt('report.title', '{label} 财务报告').replace('{label}', this.periodLabel(data.period, data.label)))}</h2>
                <span class="report-date">${data.start} ~ ${data.end}</span>
            </div>
            <div class="report-grid report-grid--overview">
                ${this.renderKPIs(data)}
                ${this.renderCompare(data)}
                ${this.renderAssets(data)}
            </div>
            ${this.renderCharts(data)}
            <!-- 三卡循环轮换：债务情况 → 右上，现金流量表 → 左下，支出 TOP 5 → 右下 -->
            <div class="report-tables-row">
                ${this.renderBalanceSheet(data)}
                ${this.renderDebtSection(data)}
            </div>
            <div class="report-grid report-grid--detail">
                ${this.renderCashFlow(data)}
                ${this.renderTopExpenses(data)}
            </div>
        `;
        this.initCharts(data);
        this.initInteractions();
    },
    renderKPIs(data) {
        const s = data.summary;
        return `
            <div class="report-kpi-card income">
                <div class="report-kpi-label">${escapeHtml(tt('report.kpi.income', '总收入'))}</div>
                <div class="report-kpi-value">${fmt(s.income)}</div>
                <div class="report-kpi-sub">${escapeHtml(tt('report.kpi.txnCount', '{n} 笔交易').replace('{n}', s.transactionCount))}</div>
            </div>
            <div class="report-kpi-card expense">
                <div class="report-kpi-label">${escapeHtml(tt('report.kpi.expense', '总支出'))}</div>
                <div class="report-kpi-value">${fmt(s.expense)}</div>
                <div class="report-kpi-sub">${escapeHtml(tt('report.kpi.avgDaily', '日均 {amt}').replace('{amt}', fmt(s.avgDailyExpense)))}</div>
            </div>
            <div class="report-kpi-card balance">
                <div class="report-kpi-label">${escapeHtml(tt('report.kpi.balance', '净结余'))}</div>
                <div class="report-kpi-value">${fmt(s.balance)}</div>
                <div class="report-kpi-sub">${escapeHtml(tt('report.kpi.savingsRateSub', '储蓄率 {pct}%').replace('{pct}', s.savingsRate.toFixed(1)))}</div>
            </div>
            <div class="report-kpi-card rate">
                <div class="report-kpi-label">${escapeHtml(tt('report.kpi.savingsRate', '储蓄率'))}</div>
                <div class="report-kpi-value">${s.savingsRate.toFixed(1)}%</div>
                <div class="report-kpi-sub">${escapeHtml(s.balance >= 0 ? tt('report.kpi.healthy', '收支健康') : tt('report.kpi.overspend', '支出超收入'))}</div>
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
                <div class="report-section-title">${escapeHtml(tt('report.compare.title', '环比上期（{label}）').replace('{label}', this.periodLabel(c.period, c.label)))}</div>
                <div class="report-compare-grid">
                    <div class="report-compare-row">
                        <span class="report-compare-label">${escapeHtml(tt('report.compare.income', '收入'))}</span>
                        <span class="report-compare-value">${fmt(c.income)}</span>
                        <span class="report-compare-diff ${incDiff >= 0 ? 'up' : 'down'}">${incDiff >= 0 ? '↑' : '↓'} ${fmt(Math.abs(incDiff))}</span>
                    </div>
                    <div class="report-compare-row">
                        <span class="report-compare-label">${escapeHtml(tt('report.compare.expense', '支出'))}</span>
                        <span class="report-compare-value">${fmt(c.expense)}</span>
                        <span class="report-compare-diff ${expDiff <= 0 ? 'up' : 'down'}">${expDiff <= 0 ? '↓' : '↑'} ${fmt(Math.abs(expDiff))}</span>
                    </div>
                    <div class="report-compare-row">
                        <span class="report-compare-label">${escapeHtml(tt('report.compare.balance', '结余'))}</span>
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
                <div class="report-section-title">${escapeHtml(tt('report.assets.title', '资产快照'))}</div>
                <div class="report-assets-value">${fmt(a.totalAssets)}</div>
                <div class="report-assets-sub">${escapeHtml(tt('report.assets.sub', '账户 {acc} · 理财 {inv}').replace('{acc}', fmt(a.accounts)).replace('{inv}', fmt(a.investments)))}</div>
            </div>
        `;
    },
    renderCharts(data) {
        // 右列互换：上方「账户资金流向」/ 下方「支出类别占比」
        // 调整原因：账户流向（柱状图）右侧放置更符合视觉重心；与左列收入/支出形成「收-流」对比
        return `
            <div class="report-charts-row">
                <div class="glass-card report-chart-card">
                    <h3 class="card-title">${escapeHtml(tt('report.chart.trend', '收支趋势'))}</h3>
                    <canvas id="reportTrendChart"></canvas>
                </div>
                <div class="glass-card report-chart-card">
                    <h3 class="card-title">${escapeHtml(tt('report.chart.accountFlow', '账户资金流向'))}</h3>
                    <canvas id="reportAccountChart"></canvas>
                </div>
            </div>
            <!-- 第二行：3 列布局 —— 收入饼 / 支出饼 / 关键财务比率（4 项竖向） -->
            <div class="report-charts-row report-charts-row--3col">
                <div class="glass-card report-chart-card">
                    <h3 class="card-title"><span id="reportIncPieTitle">${escapeHtml(tt('report.chart.incomePie', '收入来源占比'))}</span> <span id="reportIncPieBack" class="see-all" style="display:none;cursor:pointer">${escapeHtml(tt('report.chart.back', '← 返回'))}</span></h3>
                    <canvas id="reportIncPieChart"></canvas>
                    <div id="reportIncPieHint" class="pie-hint">${escapeHtml(tt('report.chart.pieHint', '👆 单击看金额 · 双击进二级'))}</div>
                </div>
                <div class="glass-card report-chart-card">
                    <h3 class="card-title"><span id="reportExpPieTitle">${escapeHtml(tt('report.chart.expensePie', '支出类别占比'))}</span> <span id="reportExpPieBack" class="see-all" style="display:none;cursor:pointer">${escapeHtml(tt('report.chart.back', '← 返回'))}</span></h3>
                    <canvas id="reportExpPieChart"></canvas>
                    <div id="reportExpPieHint" class="pie-hint">${escapeHtml(tt('report.chart.pieHint', '👆 单击看金额 · 双击进二级'))}</div>
                </div>
                ${this.renderRatios(data)}
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
                        <div class="report-top-name">${escapeHtml(t.category_icon || '📌')} ${escapeHtml(t.category_name || tt('report.top.uncategorized', '未分类'))} · ${escapeHtml(t.note || tt('report.top.noNote', '无备注'))}</div>
                        <div class="report-top-bar-wrap">
                            <div class="report-top-bar"><div class="report-top-bar-fill" style="width:${Math.min(100, pctOfMax).toFixed(1)}%"></div></div>
                            <span class="report-top-pct">${escapeHtml(tt('report.top.pctOfTotal', '占总额 {pct}%').replace('{pct}', pctOfTotal.toFixed(1)))}</span>
                        </div>
                        <div class="report-top-meta">${String(t.date).slice(0, 10)}</div>
                    </div>
                    <div class="report-top-amount">${fmt(t.amount)}</div>
                </div>
            `;
        }).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">${escapeHtml(tt('report.top.title', '支出 TOP 5'))}</h3>
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
            const statusText = budget <= 0 ? tt('report.budget.noBudget', '未设预算')
                : actual === 0 ? tt('report.budget.notStarted', '未开始')
                : over ? tt('report.budget.over', '超支 {amt}').replace('{amt}', fmt(Math.abs(remaining)))
                : remaining === 0 ? tt('report.budget.exact', '刚好用完')
                : tt('report.budget.remaining', '剩余 {amt}').replace('{amt}', fmt(remaining));
            return `
                <div class="report-budget-item ${statusCls}">
                    <div class="report-budget-header">
                        <span class="report-budget-name">${escapeHtml(b.icon || "📊")} ${escapeHtml(b.name)}</span>
                        <span class="report-budget-status ${statusCls}">${escapeHtml(statusText)}</span>
                    </div>
                    <div class="report-budget-amount-line">${escapeHtml(tt('report.budget.usedOf', '已用 {actual} / 预算 {budget}').replace('{actual}', fmt(actual)).replace('{budget}', fmt(budget)))}</div>
                    <div class="report-progress-wrap">
                        <div class="report-progress"><div class="report-progress-bar ${statusCls}" style="width:${budget > 0 ? Math.min(100, (actual / budget * 100)) : 0}%"></div></div>
                        <span class="report-progress-text ${statusCls}">${b.usage.toFixed(1)}%</span>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">${escapeHtml(tt('report.budget.title', '预算执行情况'))}</h3>
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
                    <h3 class="report-section-title">${escapeHtml(tt('report.debt.title', '债务情况'))}</h3>
                    <div class="glass-card report-budget-list"><div class="empty-hint"><p>${escapeHtml(tt('report.debt.none', '本周期无活跃债务'))}</p></div></div>
                </div>
            `;
        }
        const overdueTag = d.overdue > 0 ? `<span style="color:#ef4444;font-weight:bold;">${escapeHtml(tt('report.debt.overdueN', '⚠️ 逾期 {n} 笔').replace('{n}', d.overdue))}</span>` : '';
        const headerKpi = `
            <div class="report-compare-grid debt-kpi-grid">
                <div class="report-compare-row">
                    <span class="report-compare-label">${escapeHtml(tt('report.debt.totalRemaining', '总负债'))}</span>
                    <span class="report-compare-value">${fmt(d.totalRemaining)}</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">${escapeHtml(tt('report.debt.paidInPeriod', '本期已还款'))}</span>
                    <span class="report-compare-value">${fmt(d.paidInPeriod || 0)}</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">${escapeHtml(tt('report.debt.repaymentCount', '本期还款笔数'))}</span>
                    <span class="report-compare-value">${escapeHtml(tt('report.debt.countN', '{n} 笔').replace('{n}', d.repaymentCount || 0))}</span>
                </div>
                <div class="report-compare-row">
                    <span class="report-compare-label">${escapeHtml(tt('report.debt.totalCount', '总债务笔数'))}</span>
                    <span class="report-compare-value">${escapeHtml(tt('report.debt.countN', '{n} 笔').replace('{n}', d.count))} · ${overdueTag}</span>
                </div>
            </div>
        `;
        const debtTypeLabel = (type) => tt('debt.type.' + type, DEBT_TYPE_FALLBACK[type] || DEBT_TYPE_FALLBACK.other);
        const debtItems = (d.list || []).map(item => `
            <div class="report-budget-item">
                <div class="report-budget-header">
                    <span class="report-budget-name">${item.type === 'credit_card' ? '💳' : item.type === 'loan' ? '🏦' : '📝'} ${escapeHtml(item.name)} <span style="font-size:11px;color:var(--text-tertiary);margin-left:6px">${escapeHtml(debtTypeLabel(item.type))}</span></span>
                    <span class="report-budget-amount">${fmt(item.remaining)} / ${fmt(item.principal)}</span>
                </div>
                <div class="report-progress-wrap">
                    <div class="report-progress"><div class="report-progress-bar" style="width:${item.principal > 0 ? Math.min(100, (item.principal - item.remaining) / item.principal * 100) : 0}%"></div></div>
                    <span class="report-progress-text">${escapeHtml(tt('report.debt.repaidPct', '{pct}% 已还').replace('{pct}', item.principal > 0 ? ((item.principal - item.remaining) / item.principal * 100).toFixed(1) : 0))}</span>
                </div>
                <div class="report-budget-header" style="margin-top:4px;">
                    <span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(tt('report.debt.periodRepay', '本期还款 {n} 笔 · {amt}').replace('{n}', item.periodRepayments).replace('{amt}', fmt(item.periodPaid)))}</span>
                    <span style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(tt('report.debt.monthly', '月供 {amt}').replace('{amt}', fmt(item.monthly_payment)))}</span>
                </div>
            </div>
        `).join('');
        return `
            <div class="report-section">
                <h3 class="report-section-title">${escapeHtml(tt('report.debt.title', '债务情况'))}${overdueTag}</h3>
                <div class="glass-card" style="margin-bottom:12px;">${headerKpi}</div>
                ${debtItems ? `<div class="glass-card report-budget-list">${debtItems}</div>` : ''}
                ${(d.repayments || []).length > 0 ? `
                    <div class="glass-card" style="margin-top:12px;">
                        <h4 class="report-table-title">${escapeHtml(tt('report.debt.repayFlowTitle', '本期还款流水'))}</h4>
                        <table class="report-table">
                            <thead><tr>
                                <th>${escapeHtml(tt('report.col.date', '日期'))}</th>
                                <th>${escapeHtml(tt('report.col.debt', '债务'))}</th>
                                <th>${escapeHtml(tt('report.col.amount', '金额'))}</th>
                                <th>${escapeHtml(tt('report.col.principal', '本金'))}</th>
                                <th>${escapeHtml(tt('report.col.interest', '利息'))}</th>
                                <th>${escapeHtml(tt('report.col.note', '备注'))}</th>
                            </tr></thead>
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
            return `<span class="ratio-flag ${bad ? 'bad' : 'good'}">${escapeHtml(bad ? warn : ok)}</span>`;
        };
        const fLow = tt('report.ratio.flag.low', '偏低');
        const fHealthy = tt('report.ratio.flag.healthy', '健康');
        const fAlert = tt('report.ratio.flag.alert', '警戒');
        const fTooHigh = tt('report.ratio.flag.tooHigh', '过高');
        const fCtrl = tt('report.ratio.flag.underControl', '可控');
        return `
            <div class="report-section">
                <h3 class="report-section-title">${escapeHtml(tt('report.ratio.title', '关键财务比率'))}</h3>
                <div class="glass-card ratio-grid ratio-grid--stack">
                    <div class="ratio-item">
                        <div class="ratio-label">${escapeHtml(tt('report.ratio.savingsRate', '储蓄率'))} ${flag(r.savingsRate, 30, fLow, fHealthy)}</div>
                        <div class="ratio-value">${r.savingsRate.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill" style="width:${Math.min(100, r.savingsRate)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">${escapeHtml(tt('report.ratio.debtRatio', '负债率'))} ${flag(r.debtRatio, 50, fAlert, fHealthy)}</div>
                        <div class="ratio-value">${r.debtRatio.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill warn" style="width:${Math.min(100, r.debtRatio)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">${escapeHtml(tt('report.ratio.debtPaymentRatio', '还款收入比'))} ${flag(r.debtPaymentRatio, 40, fTooHigh, fCtrl)}</div>
                        <div class="ratio-value">${r.debtPaymentRatio.toFixed(1)}%</div>
                        <div class="ratio-bar"><div class="ratio-bar-fill warn" style="width:${Math.min(100, r.debtPaymentRatio)}%"></div></div>
                    </div>
                    <div class="ratio-item">
                        <div class="ratio-label">${escapeHtml(tt('report.ratio.assetLiabilityRatio', '资产负债率'))} ${flag(r.assetLiabilityRatio, 50, fAlert, fHealthy)}</div>
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
                <h3 class="report-section-title">${escapeHtml(tt('report.bs.title', '资产负债表（{date} 快照）').replace('{date}', bs.period.end))}</h3>
                <div class="balance-sheet">
                    <!-- 资产 -->
                    <div class="bs-side">
                        <div class="bs-side-header bs-asset-header">${escapeHtml(tt('report.bs.assets', '资产'))}</div>
                        <div class="bs-section">
                            <div class="bs-section-title">${escapeHtml(tt('report.bs.currentAssets', '流动资产'))} <span class="bs-total">${fmt(bs.assets.current.total)}</span></div>
                            ${bs.assets.current.items.length === 0 ? `<div class="bs-empty">${escapeHtml(tt('report.bs.noAccount', '无账户'))}</div>` :
                              bs.assets.current.items.map(a => `
                                <div class="bs-row">
                                    <span>${escapeHtml(a.name)}</span>
                                    <span>${fmt(a.total)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">${escapeHtml(tt('report.bs.investAssets', '投资资产'))} <span class="bs-total">${fmt(bs.assets.investment.total)}</span></div>
                            ${bs.assets.investment.items.length === 0 ? `<div class="bs-empty">${escapeHtml(tt('report.bs.noInvest', '无投资'))}</div>` :
                              bs.assets.investment.items.map(i => `
                                <div class="bs-row">
                                    <span>${escapeHtml(i.name)}</span>
                                    <span>${fmt(i.total)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-row bs-total-row">
                            <span><strong>${escapeHtml(tt('report.bs.assetTotal', '资产合计'))}</strong></span>
                            <span><strong>${fmt(bs.assets.total)}</strong></span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>${escapeHtml(tt('report.bs.opening', '期初'))}</span>
                            <span>${fmt(bs.assets.opening)}</span>
                        </div>
                    </div>
                    <!-- 负债+净资产 -->
                    <div class="bs-side">
                        <div class="bs-side-header bs-liab-header">${escapeHtml(tt('report.bs.liabPlusNet', '负债 + 净资产'))}</div>
                        <div class="bs-section">
                            <div class="bs-section-title">${escapeHtml(tt('report.bs.shortTermLiab', '短期负债'))} <span class="bs-total">${fmt(bs.liabilities.shortTerm.total)}</span></div>
                            ${bs.liabilities.shortTerm.items.length === 0 ? `<div class="bs-empty">${escapeHtml(tt('report.bs.noShortTerm', '无短期负债'))}</div>` :
                              bs.liabilities.shortTerm.items.map(d => `
                                <div class="bs-row clickable" data-debt-id="${d.id}">
                                    <span>${escapeHtml(d.name)}</span>
                                    <span>${fmt(d.remaining)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">${escapeHtml(tt('report.bs.creditCard', '信用卡'))} <span class="bs-total">${fmt(bs.liabilities.creditCard.total)}</span></div>
                            <div class="bs-meta-line">${escapeHtml(this.serverNote('report.bs.creditCardNote', bs.liabilities.creditCard.note))}</div>
                        </div>
                        <div class="bs-section">
                            <div class="bs-section-title">${escapeHtml(tt('report.bs.longTermLiab', '长期负债'))} <span class="bs-total">${fmt(bs.liabilities.longTerm.total)}</span></div>
                            ${bs.liabilities.longTerm.items.length === 0 ? `<div class="bs-empty">${escapeHtml(tt('report.bs.noLongTerm', '无长期负债'))}</div>` :
                              bs.liabilities.longTerm.items.map(d => `
                                <div class="bs-row clickable" data-debt-id="${d.id}">
                                    <span>${escapeHtml(d.name)} <span class="bs-meta-inline">${escapeHtml(tt('report.bs.termMonths', '{n}月').replace('{n}', d.term_months || 0))}</span></span>
                                    <span>${fmt(d.remaining)}</span>
                                </div>
                              `).join('')}
                        </div>
                        <div class="bs-row bs-total-row">
                            <span><strong>${escapeHtml(tt('report.bs.liabTotal', '负债合计'))}</strong></span>
                            <span><strong>${fmt(bs.liabilities.total)}</strong></span>
                        </div>
                        <div class="bs-row bs-net-worth-row">
                            <span><strong>${escapeHtml(tt('report.bs.netWorthFormula', '净资产 = 资产 - 负债'))}</strong></span>
                            <span><strong>${fmt(bs.netWorth)}</strong></span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>${escapeHtml(tt('report.bs.openingNetWorth', '期初净资产'))}</span>
                            <span>${fmt(bs.openingNetWorth)}</span>
                        </div>
                        <div class="bs-row bs-meta">
                            <span>${escapeHtml(tt('report.bs.change', '本期变化'))}</span>
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
                <div class="cf-label">${escapeHtml(label)}</div>
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
                <h3 class="report-section-title">${escapeHtml(tt('report.cf.title', '现金流量表'))}</h3>
                <div class="glass-card">
                    <div class="cf-header">
                        <span></span>
                        <span class="cf-header-inflow">${escapeHtml(tt('report.cf.inflow', '流入'))}</span>
                        <span class="cf-header-outflow">${escapeHtml(tt('report.cf.outflow', '流出'))}</span>
                        <span class="cf-header-net">${escapeHtml(tt('report.cf.net', '净额'))}</span>
                    </div>
                    ${flowRow(tt('report.cf.operating', '经营活动（日常收支）'), cf.operating.inflow, cf.operating.outflow, cf.operating.net, cf.operating.net >= 0 ? 'income' : 'expense')}
                    ${flowRow(tt('report.cf.investing', '投资活动'), cf.investing.inflow, cf.investing.outflow, cf.investing.net, cf.investing.net >= 0 ? 'income' : 'expense')}
                    ${flowRow(tt('report.cf.financing', '筹资活动（借还款）'), cf.financing.inflow, cf.financing.outflow, cf.financing.net, cf.financing.net >= 0 ? 'income' : 'expense')}
                    <div class="cf-row cf-total">
                        <div class="cf-label"><strong>${escapeHtml(tt('report.cf.netChange', '本期现金净变化'))}</strong></div>
                        <div class="cf-flows"></div>
                        <div class="cf-net ${totalColor}"><strong>${cf.netChange >= 0 ? '+' : ''}${fmt(cf.netChange)}</strong></div>
                    </div>
                    <div class="cf-note">${escapeHtml(this.serverNote('report.cf.note', cf.note))}</div>
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
                    <h4>${escapeHtml(tt('report.bs.repayDetailTitle', '{name} 还款明细').replace('{name}', d.name))} <span class="bs-meta-inline">${escapeHtml(tt('report.bs.repayCountN', '{n} 笔记录').replace('{n}', reps.length))}</span></h4>
                    <button class="btn-close js-bs-close" aria-label="${escapeHtml(tt('common.close', '关闭'))}">✕</button>
                </div>
                <div class="bs-detail-stats">
                    <div><span class="stat-label">${escapeHtml(tt('report.bs.stat.principal', '本金'))}</span><span>${fmt(d.principal)}</span></div>
                    <div><span class="stat-label">${escapeHtml(tt('report.bs.stat.remaining', '剩余'))}</span><span>${fmt(d.remaining)}</span></div>
                    <div><span class="stat-label">${escapeHtml(tt('report.bs.stat.monthly', '月供'))}</span><span>${fmt(d.monthly_payment)}</span></div>
                    <div><span class="stat-label">${escapeHtml(tt('report.bs.stat.totalPaid', '已还总额'))}</span><span>${fmt(totalPaid)}</span></div>
                </div>
                ${rows ? `<table class="report-table"><thead><tr>
                    <th>${escapeHtml(tt('report.col.date', '日期'))}</th>
                    <th>${escapeHtml(tt('report.col.amount', '金额'))}</th>
                    <th>${escapeHtml(tt('report.col.principal', '本金'))}</th>
                    <th>${escapeHtml(tt('report.col.interest', '利息'))}</th>
                    <th>${escapeHtml(tt('report.col.note', '备注'))}</th>
                  </tr></thead><tbody>${rows}</tbody></table>` : `<div class="bs-empty">${escapeHtml(tt('report.bs.noRepayment', '暂无还款记录'))}</div>`}
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
                    <h4>${escapeHtml(tt('report.bs.recentTxnTitle', '{name} 最近流水').replace('{name}', acc.name))}</h4>
                    <button class="btn-close js-bs-close" aria-label="${escapeHtml(tt('common.close', '关闭'))}">✕</button>
                </div>
                ${rows ? `<table class="report-table"><thead><tr>
                    <th>${escapeHtml(tt('report.col.date', '日期'))}</th>
                    <th>${escapeHtml(tt('report.col.category', '类别'))}</th>
                    <th>${escapeHtml(tt('report.col.amount', '金额'))}</th>
                    <th>${escapeHtml(tt('report.col.note', '备注'))}</th>
                  </tr></thead><tbody>${rows}</tbody></table>` : `<div class="bs-empty">${escapeHtml(tt('report.bs.noTxn', '暂无流水'))}</div>`}
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
                        { label: tt('chart.income', '收入'), data: data.dailyTrend.map(d => d.income), borderColor: c.inc, backgroundColor: incGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.inc, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 },
                        { label: tt('chart.expense', '支出'), data: data.dailyTrend.map(d => d.expense), borderColor: c.exp, backgroundColor: expGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.exp, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 }
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
                        label: tt('report.chart.netInflow', '净流入'),
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

        const baseTitle = key === 'exp'
            ? tt('report.chart.expensePie', '支出类别占比')
            : tt('report.chart.incomePie', '收入来源占比');
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
        const centerLabel = key === 'exp'
            ? tt('report.pie.totalExpense', '总支出')
            : tt('report.pie.totalIncome', '总收入');
        const centerTextPlugin = ChartManager._pieCenterPlugin(canvasId + 'Center', c, () => {
            const i = state.selIdx;
            if (i != null && i >= 0 && i < slices.length) {
                const e = slices[i];
                const v = parseFloat(e.total || 0);
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return {
                    title: `${e.name} · ${pct}%`,
                    amount: fmt(Math.round(v))
                };
            }
            return { title: centerLabel, amount: fmt(Math.round(total)) };
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
        if (!this.currentData) { showToast(tt('report.toast.generateFirst', '请先生成报表'), 'warning'); return; }
        const d = this.currentData;
        const period = d.period;
        const s = d.summary;
        let csv = '\uFEFF' + tt('report.csv.title', '鑫钱包财务报告') + ',\n';
        csv += `${tt('report.csv.period', '报表周期')},${this.periodLabel(d.period, d.label)},\n`;
        csv += `${tt('report.csv.income', '总收入')},${s.income.toFixed(2)},\n`;
        csv += `${tt('report.csv.expense', '总支出')},${s.expense.toFixed(2)},\n`;
        csv += `${tt('report.csv.balance', '净结余')},${s.balance.toFixed(2)},\n`;
        csv += `${tt('report.csv.savingsRate', '储蓄率')},${s.savingsRate.toFixed(2)}%,\n\n`;
        const amountCol = tt('report.csv.amount', '金额');
        const shareCol = tt('report.csv.share', '占比');
        csv += `${tt('report.csv.expenseCategory', '支出类别')},${amountCol},${shareCol}\n`;
        this.rollupCategories(d.expenseByCategory).forEach(e => { csv += `${e.name},${e.rolledTotal.toFixed(2)},${d.summary.expense > 0 ? (e.rolledTotal / d.summary.expense * 100).toFixed(2) : 0}%\n`; });
        csv += `\n${tt('report.csv.incomeCategory', '收入类别')},${amountCol},${shareCol}\n`;
        this.rollupCategories(d.incomeByCategory).forEach(e => { csv += `${e.name},${e.rolledTotal.toFixed(2)},${d.summary.income > 0 ? (e.rolledTotal / d.summary.income * 100).toFixed(2) : 0}%\n`; });
        csv += `\n${tt('report.csv.date', '日期')},${tt('report.csv.colIncome', '收入')},${tt('report.csv.colExpense', '支出')}\n`;
        d.dailyTrend.forEach(t => { csv += `${fmtDateTime(t.date)},${t.income.toFixed(2)},${t.expense.toFixed(2)}\n`; });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = tt('report.csv.filename', '鑫钱包_财务报告_{period}.csv').replace('{period}', period);
        a.click();
        URL.revokeObjectURL(url);
        showToast(tt('report.toast.csvExported', 'CSV 已导出'), 'success');
    },
    async exportFull() {
        showToast(tt('report.toast.exporting', '正在导出完整账本备份...'), 'info');
        try {
            const res = await fetch(`${API}/backup/export`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('xin_token') }
            });
            if (!res.ok) throw new Error(tt('report.toast.exportFailed', '导出失败'));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `xinwallet_backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(tt('report.toast.exportDone', '完整账本已导出（xlsx 备份，含账户/交易/预算/理财/储蓄目标/债务）'), 'success');
        } catch (err) {
            showToast(tt('report.toast.exportFailed', '导出失败') + ': ' + err.message, 'error');
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
        showToast(merge
            ? tt('report.toast.importingMerge', '正在合并导入账本，请稍候...')
            : tt('report.toast.importingReplace', '正在清空并导入账本，请稍候...'), 'info');
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
            if (!result.success) throw new Error(result.message || tt('report.toast.importFailed', '导入失败'));
            const imp = result.data.imported;
            // 导入统计项：中英「账户5」/「5 accounts」语序不同，逐项走整句插值键
            const IMPORT_PARTS = [
                ['accounts', 'report.import.accounts', '账户{n}'],
                ['categories', 'report.import.categories', '分类{n}'],
                ['transactions', 'report.import.transactions', '交易{n}'],
                ['transfers', 'report.import.transfers', '转账{n}'],
                ['budgets', 'report.import.budgets', '预算{n}'],
                ['savings_goals', 'report.import.savingsGoals', '储蓄{n}'],
                ['investments', 'report.import.investments', '理财{n}'],
                ['debts', 'report.import.debts', '债务{n}'],
                ['tags', 'report.import.tags', '标签{n}']
            ];
            const parts = IMPORT_PARTS
                .filter(([field]) => imp[field])
                .map(([field, key, fallback]) => tt(key, fallback).replace('{n}', imp[field]));
            showToast(tt('report.toast.importDone', '导入完成：{parts}').replace('{parts}', parts.join(' ')), 'success');
            await initCache();
            await DashboardManager.refresh();
        } catch (err) {
            showToast(tt('report.toast.importFailed', '导入失败') + ': ' + err.message, 'error');
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
        const closeAria = escapeHtml(tt('common.close', '关闭'));
        const cancelText = escapeHtml(tt('common.cancel', '取消'));
        // 正文含 <strong>，字典值即为可信 HTML 片段，故不做转义
        overlay.innerHTML = merge ? `
            <div class="modal glass-card" style="max-width:440px">
                <div class="modal-header">
                    <h3>${escapeHtml(tt('report.confirmImport.mergeTitle', '合并导入'))}</h3>
                    <button class="modal-close" aria-label="${closeAria}">✕</button>
                </div>
                <div class="modal-body" style="padding:12px 16px 4px;line-height:1.6">
                    <p>${tt('report.confirmImport.mergeBody', '合并导入会<strong>保留当前账本现有数据</strong>，仅把备份中缺失的账户 / 分类 / 交易等补进来（按名称或去重跳过已存在的）。')}</p>
                    <p style="color:var(--text-secondary);font-size:var(--text-caption)">${escapeHtml(tt('report.confirmImport.mergeHint', '不会删除或覆盖现有数据，适合在多处导出的备份间累加。同名已存在的主数据、相同交易/转账将被跳过。'))}</p>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
                    <button class="btn btn-ghost" data-act="cancel">${cancelText}</button>
                    <button class="btn btn-primary" data-act="ok">${escapeHtml(tt('report.confirmImport.mergeOk', '合并导入'))}</button>
                </div>
            </div>` : `
            <div class="modal glass-card" style="max-width:440px">
                <div class="modal-header">
                    <h3>${escapeHtml(tt('report.confirmImport.replaceTitle', '⚠️ 导入将清空当前账本'))}</h3>
                    <button class="modal-close" aria-label="${closeAria}">✕</button>
                </div>
                <div class="modal-body" style="padding:12px 16px 4px;line-height:1.6">
                    <p>${tt('report.confirmImport.replaceBody', '导入新账单前，会<strong>先清空当前账本的全部数据</strong>，再恢复备份内容，确保得到干净账本。')}</p>
                    <p style="color:var(--text-secondary);font-size:var(--text-caption)">
                        ${escapeHtml(tt('report.confirmImport.replaceHint', '将清空：账户 / 分类 / 标签 / 预算 / 交易 / 转账 / 理财 / 储蓄目标 / 债务（系统预设分类保留）。此操作不可撤销。'))}
                    </p>
                </div>
                <div style="display:flex;gap:12px;justify-content:flex-end;padding:16px">
                    <button class="btn btn-ghost" data-act="cancel">${cancelText}</button>
                    <button class="btn btn-danger" data-act="ok">${escapeHtml(tt('report.confirmImport.replaceOk', '清空并导入'))}</button>
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