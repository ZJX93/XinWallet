/*
 * refresh.js —— 从 app.js 抽离的页面数据刷新分派（审计 id 18：app.js god-file 分解第八刀）。
 * refreshPage(page) 按页面名分派到对应 Manager 的 refresh。各 Manager 经
 * managers/index.js 异步注入 window，统一走 window.xxx 避免裸标识符在模块加载前的
 * ReferenceError；某页面无对应 Manager 时该分支被 if 守卫跳过（不会抛错）。
 * 被 nav.js 的 showPage / refreshCurrentPage 调用（同名全局函数声明自动挂 window）。
 * ai-config 页末尾顺带刷新 AI 配置标签页（initAIConfigTabs，已抽到 init.js）。
 */
async function refreshPage(page) {
    // 各 Manager 通过 ES Module 异步注入到 window（见 managers/index.js），
    // 统一使用 window.xxx 避免裸标识符在模块加载前的 ReferenceError
    const M = window;
    if (page === 'dashboard' && M.DashboardManager) await M.DashboardManager.refresh();
    if (page === 'accounts' && M.AccountManager) await M.AccountManager.refresh();
    if (page === 'transactions' && M.TransactionManager) await M.TransactionManager.refresh();
    if (page === 'budget' && M.BudgetManager) await M.BudgetManager.refresh();
    if (page === 'investments') {
        if (M.InvestmentManager) { await M.InvestmentManager.refresh(); await M.InvestmentManager.autoRefreshQuotes(); }
        if (M.SavingsGoalManager) await M.SavingsGoalManager.refresh();
    }
    if (page === 'debts' && M.DebtManager) await M.DebtManager.refresh();
    if (page === 'data-center' && M.DataManager) await M.DataManager.refresh();
    if (page === 'tags' && M.TagManager) await M.TagManager.refresh();
    if (page === 'ai-recognition') {
        if (M.AISmartEntry) M.AISmartEntry.refresh();
        if (M.AIBillImport) await M.AIBillImport.refresh();
        if (M.AIChat) M.AIChat.refresh();
    }
    if (page === 'ai-insights' && M.AIInsights) await M.AIInsights.refresh();
    if (page === 'ai-rules' && M.AIRules) await M.AIRules.refresh();
    if (page === 'ai-config') { if (M.AIProviderManager) { await M.AIProviderManager.refresh(); await M.AIProviderManager.refreshOcrConfig(); } if (M.AISettings) await M.AISettings.refresh(); initAIConfigTabs(); }
    if (page === 'ai-status' && M.AITools) await M.AITools.refresh();
    if (page === 'reports' && M.ReportManager) await M.ReportManager.refresh();
}
