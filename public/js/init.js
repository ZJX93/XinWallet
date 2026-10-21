/*
 * init.js —— 从 app.js 抽离的初始化助手（审计 id 18：app.js god-file 分解第六刀）。
 * 页面启动前的局部初始化：缓存装载、移动端底部导航、关于页更新状态拉取、
 * AI 配置标签页、交易月份筛选、标签颜色选择器、语言切换、预置分类本地化。
 * 仅依赖全局：utils 的 api/fmt/escapeHtml/tt/localizeSystemNames（已挂 window）、
 * i18n.js 的 I18N、nav.js 的 switchPage、以及 boot 运行时已就绪的 managers
 * （PreferencesManager / FxManager / ThemeManager 等）。
 * 注意：cache / API 基址 / TAG_PALETTE 均显式走 window，避免在多脚本共享的全局
 * 词法环境下与 app.js 重复声明同名 let/const（会触发 "already been declared"）。
 */

// ---------- 缓存装载（app.js 中 let cache 已执行 window.cache = cache，二者同引用）----------
async function initCache() {
    const now = new Date();
    window.cache.currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const accData = await api('/accounts');
    window.cache.accounts = accData ? accData.accounts : [];

    // 多币种 P2-2c：缓存 debt 列表（含 currency 字段，供 dashboard totalDebt 前端折算）
    try {
        const debtsData = await api('/debts');
        window.cache.debts = (debtsData && debtsData.debts) || [];
    } catch (e) { console.warn('initCache 加载 debts 失败（dashboard totalDebt 将保留后端默认值）:', e.message); window.cache.debts = []; }

    const catData = await api('/categories?flat=1');
    window.cache.categories = catData || [];

    const invTypes = await api('/investment-types');
    window.cache.investmentTypes = invTypes || [];

    const tagsData = await api('/tags');
    window.cache.tags = tagsData || [];

    // 加载预算列表（用于交易表单关联下拉）— 加载当前日期范围内的所有预算
    const budgetsData = await api(`/budgets?period=${window.cache.currentMonth}-01`);
    window.cache.budgets = budgetsData || [];
}

// ---------- 关于页「上次更新状态」拉取（API 基址走 window.XIN_API_BASE）----------
async function refreshUpdateLast() {
    const el = document.getElementById('aboutUpdateLast');
    if (!el) return;
    try {
        const res = await fetch(`${(window.XIN_API_BASE || '/api')}/update/status`, { credentials: 'same-origin' });
        // 旧镜像无该路由(404) / 限流(429) / 未登录(401)：静默隐藏，不打扰用户
        if (!res.ok) { el.hidden = true; return; }
        const j = await res.json().catch(() => null);
        renderUpdateLast(j && j.success ? j.data : null);
    } catch (e) {
        el.hidden = true;
    }
}

// ---------- 移动端底部导航 ----------
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

// ---------- AI 配置标签页 ----------
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

// ---------- 交易月份筛选 ----------
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

// ---------- 标签颜色选择器 ----------
const TAG_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#22c55e'];
window.TAG_PALETTE = TAG_PALETTE; // 供 managers/tag.js（ES Module）访问，经典脚本 const 不挂 window

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

// ---------- 语言切换 ----------
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

// ---------- 预置分类本地化（i18n:changed 时原地重跑系统名本地化）----------
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
