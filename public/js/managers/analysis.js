// ==========================================
// AnalysisManager — 消费分析
// 拆分自 public/js/app.js
// 原始位置: 第 3724 行 — 第 3915 行 (const AnalysisManager = { ... };)
// 注：AI 洞察 / AI 建议卡片已从本页面移除（功能与独立的 ai-insight / ai-advice 页重复）
// ==========================================

const AnalysisManager = {
    async refresh() {
        // 顶部月度概览
        await this.renderOverview();
        // 消费结构 + 异常检测
        const container = document.getElementById('analysisStructure');
        const anomalyList = document.getElementById('anomalyList');
        showSkeleton(container, 5, 'text');
        showSkeleton(anomalyList, 2, 'text');

        const summary = await api(`/transactions/summary?month=${cache.currentMonth}`);
        if (!summary) return;

        // 消费结构：只取一级分类（后端已做子级向父级汇总，parent_id 为 null 即一级）
        const topCats = (summary.expenseByCategory || []).filter(e => e.parent_id == null);
        container.className = '';
        // 莫兰迪色系（低饱和柔和灰调），与饼图配色风格统一
        const colors = ['#B98E8E','#8FA9C4','#9CB39A','#A99BC4','#C9B79C','#C09A86','#8FB5B0','#C7A0AE','#A38FA6','#AEB39A','#8FA6C0','#B7AEC9'];
        container.innerHTML = topCats.map((e, i) => `
            <div class="analysis-structure-item">
                <div class="analysis-structure-cat">${escapeHtml(e.icon || "📌")} ${escapeHtml(e.name)}</div>
                <div class="analysis-structure-bar"><div class="analysis-structure-fill" style="width:${summary.expense > 0 ? (e.total / summary.expense * 100).toFixed(1) : 0}%;background:${colors[i % colors.length]}"></div></div>
                <div class="analysis-structure-percent" style="color:${colors[i % colors.length]}">${summary.expense > 0 ? (e.total / summary.expense * 100).toFixed(1) : 0}%</div>
            </div>
        `).join('');

        // 异常检测（基于一级分类）
        const bigItems = topCats.filter(e => e.total > summary.expense * 0.3);
        anomalyList.innerHTML = bigItems.length > 0 ?
            bigItems.map(e => `<div class="anomaly-item"><div class="anomaly-icon">⚠️</div><div class="anomaly-info"><div class="anomaly-title">${escapeHtml(e.icon || "📌")} ${escapeHtml(e.name)} 占比过高</div><div class="anomaly-desc">占比 ${(e.total / summary.expense * 100).toFixed(0)}%，金额 ${fmt(e.total)}</div></div></div>`).join('') :
            '<div class="empty-state ok"><div class="empty-icon">✅</div><div class="empty-text">消费分布较为均衡</div></div>';

        // 趋势图
        this.renderTrend();
    },

    async renderOverview() {
        const overview = document.getElementById('analysisOverview');
        showSkeleton(overview, 3, 'text');
        const dash = await api('/stats/dashboard');
        if (!dash) return;

        const income = dash.month?.income || 0;
        const expense = dash.month?.expense || 0;
        const balance = income - expense;

        // 预算总使用率
        const budgets = dash.budgets || [];
        const totalBudget = budgets.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
        const totalActual = budgets.reduce((s, b) => s + (parseFloat(b.actual) || 0), 0);
        const budgetPct = totalBudget > 0 ? Math.min(100, Math.round(totalActual / totalBudget * 100)) : 0;
        const budgetOver = totalActual > totalBudget;

        overview.innerHTML = `
            <div class="analysis-overview-card income">
                <div class="overview-icon">💰</div>
                <div class="overview-value">${fmt(income)}</div>
                <div class="overview-label">本月收入</div>
            </div>
            <div class="analysis-overview-card expense">
                <div class="overview-icon">💳</div>
                <div class="overview-value">${fmt(expense)}</div>
                <div class="overview-label">本月支出</div>
            </div>
            <div class="analysis-overview-card balance">
                <div class="overview-icon">📊</div>
                <div class="overview-value">${fmt(balance)}</div>
                <div class="overview-label">本月结余</div>
            </div>
            ${totalBudget > 0 ? `
            <div class="analysis-budget-bar">
                <span class="budget-label">📋 预算使用</span>
                <div class="budget-progress-wrap">
                    <div class="budget-progress-fill" style="width:${budgetPct}%;background:${budgetOver ? 'var(--expense)' : 'var(--accent-500)'}"></div>
                </div>
                <span class="budget-text" style="color:${budgetOver ? 'var(--expense)' : 'var(--accent-500)'}">${fmt(totalActual)} / ${fmt(totalBudget)} (${budgetPct}%)</span>
            </div>` : ''}
        `;
    },

    async renderTrend() {
        ChartManager.applyDefaults();
        const dash = await api('/stats/dashboard');
        if (!dash || !dash.months) return;
        const c = ChartManager.colors();
        ChartManager.destroy('analysisTrend');
        const ctx = document.getElementById('analysisTrendChart').getContext('2d');
        const ms = [...dash.months].reverse();
        const avg = ms.length > 0 ? ms.reduce((s, m) => s + m.expense, 0) / ms.length : 0;

        // 渐变填充
        const expGrad = ctx.createLinearGradient(0, 0, 0, 220);
        expGrad.addColorStop(0, c.exp + '30');
        expGrad.addColorStop(1, c.exp + '04');

        ChartManager.charts['analysisTrend'] = new Chart(ctx, {
            type: 'line', data: {
                labels: ms.map(m => m.month.substring(5) + '月'),
                datasets: [
                    { label: '月支出', data: ms.map(m => m.expense), borderColor: c.exp, backgroundColor: expGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.exp, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 },
                    { label: '平均线', data: Array(ms.length).fill(avg), borderColor: c.war + '80', borderDash: [8, 4], pointRadius: 0, borderWidth: 2, fill: false }
                ]
            }, options: {
                responsive: true, maintainAspectRatio: true,
                animation: ChartManager.reduceMotion() ? false : { duration: 1200, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: c.bg, titleColor: c.text, bodyColor: c.text,
                        borderColor: c.grid, borderWidth: 1, cornerRadius: 10, padding: 12
                    }
                },
                scales: {
                    x: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } },
                    y: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } }
                }
            }
        });
    }
};

export default AnalysisManager;