/*
 * boot.js —— 从 app.js 抽离的启动编排（审计 id 18：app.js god-file 分解第九刀，收口）。
 * boot() 是应用启动总装配：I18N.init → PreferencesManager.load → 语言同步 →
 * 各 init 助手（initLangSwitcher / initPresetCategoryLocalization / initCache /
 * initTransMonthFilter）→ 按序 safeInit 十几个 Manager（缺失由 safeInit 容错 warn，
 * 不中断）→ 从 URL path 恢复页面（currentRoute / showPage）。
 * 仅引用全局：I18N / PreferencesManager / 各 Manager / init.js 的 init* 助手 /
 * core.js 的 currentRoute/pageUrl / nav.js 的 showPage/PAGE_META，均为 window 全局。
 * 由 js/managers/index.js 在 DOMContentLoaded 后直接调用 window.boot()。
 */
async function boot() {
    const DEBUG = window.XIN_DEBUG === true || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const log = (...a) => { if (DEBUG) console.log(...a); };  // 启动横幅仅在本地/调试态打印
    log(tt('app.boot.start', '🚀 鑫钱包启动...'));
    try { await I18N.init(); log('  ✅ i18n'); } catch(e) { console.warn(tt('app.boot.warnI18n', '  ⚠️  i18n init 失败(跳过):'), e.message); }
    try { await PreferencesManager.load(); log('  ✅ preferences'); } catch(e) { console.warn(tt('app.boot.warnPref', '  ⚠️  preferences (跳过):'), e.message); }
    const prefLang = PreferencesManager.lang;
    if (prefLang && prefLang !== I18N.lang) { await I18N.setLang(prefLang); log(tt('app.boot.langSynced', '  ✅ 语言按偏好同步 -> ') + ' ' + prefLang); }
    initLangSwitcher();
    initPresetCategoryLocalization();
    // ⛔ safeInit 必须先定义再调用：const 不会 hoist，提前调用会 TDZ 抛 ReferenceError
    const safeInit = (name, fn) => { try { fn(); log('  ✅ '+name); } catch(e) { console.warn(tt('app.boot.warnSkip', '  ⚠️  {name} (跳过):').replace('{name}', name), e.message); } };
    safeInit('FxManager', () => FxManager.init());   // 多币种 P2-2b：拉取汇率（汇率查询页与金额折算依赖，原顶栏入口已移除）
    try { await initCache(); log('  ✅ initCache'); } catch(e) { console.error('  ❌ initCache:', e.message); throw e; }
    // 交易月份筛选：依赖 cache.currentMonth，必须在 initCache 之后
    safeInit('TransMonthFilter', () => initTransMonthFilter());
    safeInit('ThemeManager', () => ThemeManager.init());
    safeInit('AccountManager', () => AccountManager.init());
    safeInit('TransactionManager', () => TransactionManager.init());
    safeInit('BudgetManager', () => BudgetManager.init());
    safeInit('InvestmentManager', () => InvestmentManager.init());
    safeInit('DebtManager', () => DebtManager.init());
    safeInit('TagManager', () => TagManager.init());
    safeInit('DataManager', () => DataManager.init());
    safeInit('SavingsGoalManager', () => SavingsGoalManager.init());
    safeInit('AISmartEntry', () => AISmartEntry.init());
    safeInit('AIBillImport', () => AIBillImport.init());
    safeInit('AIAdvice', () => AIAdvice.init());
    safeInit('AIChat', () => AIChat.init());
    safeInit('AIRules', () => AIRules.init());
    safeInit('AILearning', () => AILearning.init());
    safeInit('AIInsights', () => AIInsights.init());
    safeInit('AIProviderManager', () => AIProviderManager.init());
    safeInit('AIChat', () => AIChat.init());
    safeInit('AISettings', () => AISettings.init());
    safeInit('ReportManager', () => ReportManager.init());
    safeInit('QuickAdd', () => QuickAdd.init());
    try { await DashboardManager.init(); console.log('  ✅ Dashboard'); } catch(e) { console.warn(tt('app.boot.warnDashboard', '  ⚠️  Dashboard (跳过):'), e.message); }

    // 从 URL path 恢复页面状态（干净路由：/transactions）
    const page = currentRoute();
    const validPages = Object.keys(window.PAGE_META);
    if (validPages.includes(page)) {
        history.replaceState({ page }, '', pageUrl(page));
        await showPage(page);
    } else {
        history.replaceState({ page: 'dashboard' }, '', pageUrl('dashboard'));
        await showPage('dashboard');
    }
    log(tt('app.boot.ready', '✅ 鑫钱包系统已就绪'));
}

window.boot = boot; // 显式暴露（与 init.js 的 init* 暴露风格一致），供 managers/index.js 调用
