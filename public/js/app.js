/* ============================================
   鑫钱包 · 全栈 App (PostgreSQL API 版)
   ============================================ */

// 统一 API 调用、格式化函数：来自 utils.js（已挂载 window.api / window.fmt）
// 这样 app.js / auth.js 共用同一份 api() 实现，避免行为分裂。

// API 基址
const API = window.XIN_API_BASE || '/api';

// 全局缓存
let cache = { accounts: [], categories: [], investmentTypes: [], investments: [], tags: [], currentMonth: '' };
window.cache = cache; // ES Module 无法访问 let 声明的顶级变量，显式挂载到 window

// ==========================================
// api() / fmt() / escapeHtml() 已通过 utils.js 注入到 window，无需重复定义
// ==========================================

// ==========================================
// Toast
// ==========================================
// 轻量提示 toast 已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// 金额/日期格式化与转账配对已抽到 core.js（见 public/js/core.js），
// 该脚本在 index.html 中于 utils.js 之后、本文件之前加载，全局可直接复用。

// 合并转账配对已抽到 core.js（见 public/js/core.js），全局可直接复用。

// 骨架屏：数据加载中展示的微光占位
// 骨架屏/空态渲染已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// ==========================================
// 初始化缓存
// ==========================================
// 初始化缓存（initCache）已抽到 init.js（见 public/js/init.js）

// 缓存访问器已抽到 core.js（见 public/js/core.js），全局可直接复用。

// ==========================================
// 页面标题映射
// ==========================================
// 页面标题/副标题 —— i18n 第一阶段：键名直接当 i18n key 用，由 showPage() 经 I18N.t() 解析
// zh-CN 路径下展示中文需要 zh-CN 字典；当前 zh-CN 字典直接用页面中文作 fallback（key 即字符串），
// 这样不用维护 zh-CN.js 也保证中文正常。
// PAGE_META 已抽到 nav.js（见 public/js/nav.js）

// 导航状态/点击绑定已抽到 nav.js（见 public/js/nav.js）
document.querySelectorAll('.see-all').forEach(el => el.addEventListener('click', () => switchPage(el.dataset.page)));
// 移动端底部导航（initBottomNav 等）已抽到 init.js（见 public/js/init.js）

// 当前站点根路径（兼容反向代理子路径）：XIN_API_BASE 形如 /xin/api → 根为 /xin
// 路由 URL 助手已抽到 core.js（见 public/js/core.js），全局可直接复用。

// 拉取「上次更新结果」并渲染到关于页（对应服务端 /api/update/status，
// 2026-09-07 新增：暴露辅助容器重建的真实 exit code + 运行镜像是否真的切到 :latest）
// 关于页更新状态拉取（refreshUpdateLast）已抽到 init.js（见 public/js/init.js）

// 关于页「上次更新状态」渲染已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// 仅负责 DOM 渲染（不修改历史），供 switchPage 与 popstate 复用
// showPage 已抽到 nav.js（见 public/js/nav.js）

/* ── 原 syncStickyOffsets() 已删除 ────────────────────────────────────
   它的职责是实测 top-bar / filter-bar 高度并注入 --sticky-top-1 / --sticky-top-2，
   供三层 sticky 的 top 值消费。顶部固定取消后这两个变量无人消费，
   继续 rAF 双帧测量纯属浪费。
   ⛔ 如需恢复吸顶，连同 components.css / styles.css 里的注释一起恢复，
      并重新面对「玻璃态 blur 会抹平 body blob」这个矛盾。 */

// （原 resize 监听用于重算 sticky 偏移量，吸顶取消后已无必要，一并删除。）

// switchPage / popstate 已抽到 nav.js（见 public/js/nav.js）

// AI 配置标签页（initAIConfigTabs）已抽到 init.js（见 public/js/init.js）

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

// 导航访问器（getCurrentPage / refreshCurrentPage）已抽到 nav.js（见 public/js/nav.js）

// 多账本切换：重拉缓存（账户/分类等随账本隔离）+ 刷新当前页数据
window.addEventListener('book:changed', async () => {
    try { await initCache(); } catch (e) { console.warn('book:changed initCache 失败:', e.message); }
    if (typeof window.refreshCurrentPage === 'function') window.refreshCurrentPage();
});

// ==========================================
// 交易月份筛选选项（依赖 cache.currentMonth，由 boot() 中 initCache() 之后调用）
// 交易月份筛选（initTransMonthFilter）已抽到 init.js（见 public/js/init.js）

// ==========================================
// 标签管理（参考 Firefly III tags）
// ==========================================
// 标签颜色选择器（TAG_PALETTE + initColorSwatches）已抽到 init.js（见 public/js/init.js）

// ==========================================
// 应用启动
// ==========================================
// 语言切换（initLangSwitcher）已抽到 init.js（见 public/js/init.js）

// 预置分类本地化（initPresetCategoryLocalization）已抽到 init.js（见 public/js/init.js）

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

// boot() 由 js/managers/index.js 在 DOMContentLoaded 后直接调用；app.js 加载为普通 script，所有变量已在全局
