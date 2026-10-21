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
async function initCache() {
    const now = new Date();
    cache.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const accData = await api('/accounts');
    cache.accounts = accData ? accData.accounts : [];

    // 多币种 P2-2c：缓存 debt 列表（含 currency 字段，供 dashboard totalDebt 前端折算）
    try {
        const debtsData = await api('/debts');
        cache.debts = (debtsData && debtsData.debts) || [];
    } catch (e) { console.warn('initCache 加载 debts 失败（dashboard totalDebt 将保留后端默认值）:', e.message); cache.debts = []; }

    const catData = await api('/categories?flat=1');
    cache.categories = catData || [];

    const invTypes = await api('/investment-types');
    cache.investmentTypes = invTypes || [];

    const tagsData = await api('/tags');
    cache.tags = tagsData || [];

    // 加载预算列表（用于交易表单关联下拉）— 加载当前日期范围内的所有预算
    const budgetsData = await api(`/budgets?period=${cache.currentMonth}-01`);
    cache.budgets = budgetsData || [];
}

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
// 移动端底部导航：点击分组标签展开子菜单
let _bottomNavInited = false;
const initBottomNav = () => {
    if (_bottomNavInited) return;
    _bottomNavInited = true;
    const menu = document.getElementById('sidebar').querySelector('.nav-menu');
    const labels = menu.querySelectorAll('.nav-group-label');
    const items = menu.querySelectorAll('.nav-item');

    // 按分组标签对导航项分组
    const groups = {};
    let currentGroup = null;
    menu.querySelectorAll('li').forEach(el => {
        if (el.classList.contains('nav-group-label')) {
            currentGroup = el.textContent.trim();
            groups[currentGroup] = [];
        } else if (currentGroup && el.classList.contains('nav-item')) {
            groups[currentGroup].push(el);
        }
    });

    // 更新分组标签显示为文字，保存原始名称到 data-group
    labels.forEach(label => {
        const name = label.textContent.trim();
        label.dataset.group = name;
        label.innerHTML = `<span style="display:block;font-size:11px;line-height:1;font-weight:var(--fw-medium)">${escapeHtml(name)}</span>`;
    });

    // 点击分组标签展开子菜单
    let openGroup = null;
    const popup = document.createElement('div');
    popup.className = 'mobile-submenu';
    popup.style.cssText = 'display:none;position:fixed;bottom:60px;left:0;right:0;background:var(--surface-card);border-top:1px solid var(--border-subtle);border-radius:12px 12px 0 0;padding:12px 8px;z-index:51;box-shadow:0 -4px 16px rgba(0,0,0,0.15);max-height:50vh;overflow-y:auto;';
    document.body.appendChild(popup);

    const closeSubmenu = () => { popup.style.display = 'none'; openGroup = null; labels.forEach(l => l.classList.remove('active')); };
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && !Array.from(labels).includes(e.target)) closeSubmenu();
    });

    labels.forEach(label => {
        label.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = label.dataset.group;
            // 总览（Overview）只有一个子项，直接跳转仪表盘
            if (name === tt('nav.group.overview', '总览')) { closeSubmenu(); switchPage('dashboard'); return; }
            if (openGroup === name) { closeSubmenu(); return; }
            labels.forEach(l => l.classList.remove('active'));
            label.classList.add('active');
            openGroup = name;

            const subItems = groups[name] || [];
            popup.innerHTML = subItems.map(it => {
                const text = it.querySelector('.nav-text')?.textContent || it.dataset.page;
                const page = it.dataset.page;
                return `<div class="mobile-subitem" data-page="${page}" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:8px;cursor:pointer;font-size:14px;color:var(--text-primary);">
                    <span>${escapeHtml(text)}</span>
                </div>`;
            }).join('');
            popup.style.display = 'block';

            // 子项点击
            popup.querySelectorAll('.mobile-subitem').forEach(sub => {
                sub.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const page = sub.dataset.page;
                    closeSubmenu();
                    if (page) switchPage(page);
                });
            });
        });
    });
};
if (window.innerWidth <= 720) initBottomNav();
window.addEventListener('resize', () => { if (window.innerWidth <= 720) initBottomNav(); });

// 当前站点根路径（兼容反向代理子路径）：XIN_API_BASE 形如 /xin/api → 根为 /xin
// 路由 URL 助手已抽到 core.js（见 public/js/core.js），全局可直接复用。

// 拉取「上次更新结果」并渲染到关于页（对应服务端 /api/update/status，
// 2026-09-07 新增：暴露辅助容器重建的真实 exit code + 运行镜像是否真的切到 :latest）
async function refreshUpdateLast() {
    const el = document.getElementById('aboutUpdateLast');
    if (!el) return;
    try {
        const res = await fetch(`${API}/update/status`, { credentials: 'same-origin' });
        // 旧镜像无该路由(404) / 限流(429) / 未登录(401)：静默隐藏，不打扰用户
        if (!res.ok) { el.hidden = true; return; }
        const j = await res.json().catch(() => null);
        renderUpdateLast(j && j.success ? j.data : null);
    } catch (e) {
        el.hidden = true;
    }
}

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

function initAIConfigTabs() {
    const tabs = document.getElementById('aiConfigTabs');
    if (!tabs || tabs.dataset.bound) return;
    tabs.dataset.bound = '1';
    tabs.querySelectorAll('.ai-config-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;
            tabs.querySelectorAll('.ai-config-tab').forEach(b => b.classList.toggle('active', b === btn));
            ['providers', 'ocr', 'behavior'].forEach(p => {
                const el = document.getElementById('aiConfigPanel-' + p);
                if (el) el.style.display = p === panel ? '' : 'none';
            });
        });
    });
}

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
function initTransMonthFilter() {
    const sel = document.getElementById('transMonthFilter');
    if (!sel) return;
    const now = new Date();
    const opts = [`<option value="all">${escapeHtml(tt('app.month.allMonths', '所有月份'))}</option>`];
    for (let m = 0; m < 12; m++) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        opts.push(`<option value="${val}">${val}</option>`);
    }
    sel.innerHTML = opts.join('');
    // 默认选中"所有月份"（与其他筛选框一致），保持 UI 行为统一
    sel.value = 'all';
}

// ==========================================
// 标签管理（参考 Firefly III tags）
// ==========================================
const TAG_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#22c55e'];

// 颜色选择器渲染（TagManager 和 DataManager 共用）
function initColorSwatches(containerId, inputId) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if (!container || !input) return;
    container.innerHTML = TAG_PALETTE.map(c =>
        `<span class="color-swatch ${input.value === c ? 'selected' : ''}" style="background:${c}" data-color="${c}"></span>`
    ).join('');
    container.addEventListener('click', (e) => {
        const sw = e.target.closest('.color-swatch');
        if (!sw) return;
        container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        input.value = sw.dataset.color;
    });
}

// ==========================================
// 应用启动
// ==========================================
function initLangSwitcher() {
    const btn = document.getElementById('langBtn');
    const menu = document.getElementById('langMenu');
    if (!btn || !menu) return;
    const syncActive = () => menu.querySelectorAll('.lang-opt').forEach(o =>
        o.style.background = (o.dataset.lang === I18N.lang) ? 'var(--surface-hover)' : 'none');
    syncActive();
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = (menu.style.display === 'none' || menu.style.display === '') ? 'block' : 'none';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });
    menu.querySelectorAll('.lang-opt').forEach(opt => {
        opt.addEventListener('click', async (e) => {
            e.stopPropagation();
            const lang = opt.dataset.lang;
            await I18N.setLang(lang); // 本地字典切换 + applyDOM + dispatch
            try { await PreferencesManager.setLanguage(lang); } catch (_) {} // 持久化到后端 preferences（best-effort）
            menu.style.display = 'none';
            location.reload(); // I3 起改为无刷新重渲染当前页
        });
    });
    window.addEventListener('i18n:changed', syncActive);
}

/**
 * 预置分类多语言：cache.categories / investmentTypes 是最早加载且被各页复用的数据，
 * 语言切换时它们的名字还停留在旧语言，这里原地重跑一次本地化，
 * 使下拉框、交易列表等无需重新请求接口即可跟随切换。
 */
function initPresetCategoryLocalization() {
    window.addEventListener('i18n:changed', () => {
        try {
            if (typeof localizeSystemNames === 'function' && window.cache) {
                localizeSystemNames(window.cache, 0);
            }
        } catch (e) { /* 本地化失败不该影响语言切换 */ }
    });
}

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
