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
function showToast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) { console.log(`[toast:${type}]`, msg); return; }
    // error 走 role=alert 让屏幕阅读器立刻播报；其他用 role=status 走 polite
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
}

// 带符号金额（收入 + / 支出 -），用于列表右侧。直接复用 utils.js 的 fmt（已按币种出符号）
function fmtSigned(n, type) {
    const v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    // 取出 fmt 拼出的金额数字部分（去前缀符号/币符），避免双重符号：
    // fmt(正数, CNY) → '¥100.00'，此处只取 '100.00'。
    // 转出腿与支出同为资金流出，统一带 '-'；转入腿与收入带 '+'。
    // （成对的转账行显式传 'transfer_in'，不受此规则影响）
    const sign = (type === 'expense' || type === 'transfer_out') ? '-' : '+';
    const full = fmt(Math.abs(v));
    const numPart = full.replace(/^[^\d.-]+/, '');
    return sign + '¥' + numPart;
}
// 无符号 ¥ 前缀的纯数字（用于已含 ¥ 的拼接场景，避免双重符号）
function fmtNum(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0.00';
    return fmt(v).replace(/^[^\d.-]+/, '');
}
function fmtDate(d) {
    /**
     * 返回 datetime-local 的 value：YYYY-MM-DDTHH:mm
     *
     * ⚠️ 这里**不能**补到秒。调用方里有三个 `type="date"` 的框
     * （investBuyDate / reduceDate / interestDate），它们只接受
     * YYYY-MM-DD，多给时间部分会被浏览器直接拒收、value 变空。
     *
     * 需要秒粒度的 datetime-local 框请用 fmtDateTimeLocal()。
     */
    if (d) {
        const s = String(d).replace(' ', 'T');
        return s.slice(0, 16); // YYYY-MM-DDTHH:mm
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
}

/**
 * 给 `<input type="datetime-local" step="1">` 用的 value，精确到秒。
 *
 * 为什么必须补秒：带 step 的控件会渲染秒位。只回填到分钟时秒位是**空的**，
 * 用户明明没碰过秒，光标扫过去滚一下就变成 00:02:00 之类的值 ——
 * 而且会当成用户输入提交上去（截图里日期显示 2026/08/23 00:02:00
 * 而库里存的是 00:00:00，就是这么来的）。
 *
 * 只用在确认是 datetime-local 的框上（transDate / quickDate），
 * 不要拿去喂 type="date"。
 */
function fmtDateTimeLocal(d) {
    if (d) {
        const s = String(d).replace(' ', 'T').replace('Z', '');
        const base = s.slice(0, 19);
        if (base.length === 10) return base + 'T00:00:00';  // 只有日期
        if (base.length === 16) return base + ':00';        // 只到分钟
        return base;
    }
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
        + `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
// 显示用：datetime → 短格式（精确到秒）
function fmtDateTime(s) {
    if (!s) return '';
    const str = String(s).replace('T', ' ').replace('Z', '').trim();
    // 如果有秒就显示到秒
    if (str.length >= 19) return str.slice(0, 19);
    if (str.length >= 16) return str.slice(0, 16);
    return str.slice(0, 10);
}
function parseDateParts(s) {
    const str = String(s).replace('T', ' ').replace('Z', '').trim();
    const [datePart, timePart = ''] = str.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    return { y, m, d, time: timePart.slice(0, 5) };
}
// 本地日期 → YYYY-MM-DD（避免 toISOString 的 UTC 偏移问题）
function fmtLocalDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fmtDateGroupHeader(s) {
    const { y, m, d } = parseDateParts(s);
    const weekdays = [
        tt('app.date.weekday.sun', '星期日'),
        tt('app.date.weekday.mon', '星期一'),
        tt('app.date.weekday.tue', '星期二'),
        tt('app.date.weekday.wed', '星期三'),
        tt('app.date.weekday.thu', '星期四'),
        tt('app.date.weekday.fri', '星期五'),
        tt('app.date.weekday.sat', '星期六')
    ];
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return tt('app.date.groupFormat', '{y}年{m}月{d}日 {weekday}')
        .replace('{y}', y).replace('{m}', m).replace('{d}', d).replace('{weekday}', weekdays[day]);
}
function fmtTransTime(s) {
    const { time } = parseDateParts(s);
    return time || '00:00';
}
// escapeHtml 已在 utils.js 中定义并挂载到 window，此处不再重复

/**
 * 合并转账配对：把 transfer_in / transfer_out 归并成一条转账记录。
 *
 * ⚠️ 现在服务端已在 SQL 层折叠（transactions.js：命中配对 out 腿的
 * transfer_in 不再返回），所以列表里通常只有 out 腿一条，
 * 下面的 `transactions.find(...)` 找不到配对 —— 若仍依赖客户端配对，
 * 渲染就会变成「工资卡 → ?」。
 *
 * 因此优先吃服务端给的 t.transfer（{ id, from, to } 双端齐全），
 * 直接合成 _transferOut / _transferIn 的等价结构，让下游 renderRow
 * 与编辑弹窗的取值方式完全不变。
 *
 * 客户端配对逻辑保留作兜底：
 *   1. 旧版服务端（未部署折叠）仍会返回两条腿，此时走原路径
 *   2. transfer 字段要求双端账户名齐全才由服务端构造，账户被删时为 null
 */
function mergeTransferPairs(transactions) {
    const result = [];
    const pairedIds = new Set();
    for (const t of transactions) {
        if (pairedIds.has(t.id)) continue;
        // 路径 1：服务端已折叠并给出完整双端信息 —— 不需要在列表里找配对
        if (t.transfer && t.transfer.from && t.transfer.to) {
            const outLeg = { ...t, account: t.transfer.from };
            // in 腿在折叠后不存在于列表里，这里合成一个等价对象供渲染取 account.name。
            // 注意 id 仍用 out 腿的 —— 编辑/删除都按 transfer_id 走 /transfers/:id，
            // 不会真的用到这个合成 id 去操作单条 transactions。
            const inLeg = { ...t, account: t.transfer.to };
            pairedIds.add(t.id);
            result.push({
                ...t,
                _pairOut: outLeg, _pairIn: inLeg,
                _transferOut: outLeg, _transferIn: inLeg,
                amount: Math.abs(t.amount), _merged: true
            });
            continue;
        }
        // 路径 3：跨账户还款折叠腿（link_type='debt_repayment'，服务端给了 counterparty
        // 但没走 transfers 表，故无 transfer / transfer_id）。直接复用转账的 A→B 渲染模式：
        // 以自身 account 为 from、counterparty 为 to 合成双端，下游 renderRow 套用转账分支。
        if (t.link_type === 'debt_repayment' && t.counterparty) {
            const outIsSelf = t.type === 'transfer_out';
            const selfAcc = t.account;
            const peerAcc = { id: null, name: t.counterparty.name, icon: t.counterparty.icon };
            const outLeg = { ...t, account: outIsSelf ? selfAcc : peerAcc };
            const inLeg = { ...t, account: outIsSelf ? peerAcc : selfAcc };
            pairedIds.add(t.id);
            result.push({
                ...t,
                _pairOut: outLeg, _pairIn: inLeg,
                _transferOut: outLeg, _transferIn: inLeg,
                amount: Math.abs(t.amount), _merged: true
            });
            continue;
        }
        // 路径 2：旧版服务端返回两条腿，按 transfer_id 在列表内配对
        if ((t.type === 'transfer_in' || t.type === 'transfer_out') && t.transfer_id) {
            const pair = transactions.find(
                x => x.transfer_id === t.transfer_id && x.id !== t.id && !pairedIds.has(x.id)
            );
            if (pair) {
                const out = t.type === 'transfer_out' ? t : pair;
                const inn = t.type === 'transfer_in' ? t : pair;
                pairedIds.add(out.id);
                pairedIds.add(inn.id);
                result.push({ ...out, _pairOut: out, _pairIn: inn, _transferOut: out, _transferIn: inn, amount: out.amount, _merged: true });
                continue;
            }
        }
        result.push(t);
    }
    return result;
}

// 骨架屏：数据加载中展示的微光占位
function showSkeleton(el, rows = 3, variant = 'list') {
    if (!el) return;
    let html = '';
    if (variant === 'list') {
        for (let i = 0; i < rows; i++) {
            html += `<div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:45%"></div><div class="skeleton-line shimmer" style="width:70%"></div></div><div class="skeleton-amt shimmer"></div></div>`;
        }
    } else if (variant === 'grid') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-card shimmer"></div>`;
    } else if (variant === 'text') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-line shimmer" style="width:${60 + (i % 3) * 12}%"></div>`;
    }
    el.innerHTML = `<div class="skeleton-wrap" data-skeleton="${variant}">${html}</div>`;
}

// 空状态：纯文字提示（图标已按 UI 规范移除，保留 icon 参数仅为兼容历史调用）
function showEmpty(el, text, icon = '') {
    if (!el) return;
    el.innerHTML = `<div class="empty-state">${icon ? `<div class="empty-icon">${icon}</div>` : ''}<div class="empty-text">${escapeHtml(text)}</div></div>`;
}

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

function getCat(id) { return cache.categories.find(c => c.id === id) || { id, name: tt('common.unknown', '未知'), icon: '📌' }; }
function getAcc(id) { return cache.accounts.find(a => a.id === id) || { id, name: tt('common.unknown', '未知'), icon: '💰' }; }
function getExpCats() { return cache.categories.filter(c => c.type === 'expense'); }
function getIncCats() { return cache.categories.filter(c => c.type === 'income'); }
function getTransferCats() { return cache.categories.filter(c => c.type === 'transfer'); }

// ==========================================
// 页面标题映射
// ==========================================
// 页面标题/副标题 —— i18n 第一阶段：键名直接当 i18n key 用，由 showPage() 经 I18N.t() 解析
// zh-CN 路径下展示中文需要 zh-CN 字典；当前 zh-CN 字典直接用页面中文作 fallback（key 即字符串），
// 这样不用维护 zh-CN.js 也保证中文正常。
const PAGE_META = {
    dashboard:                  { title: 'pageTitle.dashboard',           subtitle: 'pageSubtitle.dashboard' },
    accounts:                   { title: 'pageTitle.accounts',            subtitle: 'pageSubtitle.accounts' },
    transactions:               { title: 'pageTitle.transactions',        subtitle: 'pageSubtitle.transactions' },
    budget:                     { title: 'pageTitle.budget',              subtitle: 'pageSubtitle.budget' },
    investments:                { title: 'pageTitle.investments',         subtitle: 'pageSubtitle.investments' },
    debts:                      { title: 'pageTitle.debts',               subtitle: 'pageSubtitle.debts' },
    'ai-recognition':           { title: 'pageTitle.ai-recognition',      subtitle: 'pageSubtitle.ai-recognition' },
    'ai-insights':              { title: 'pageTitle.ai-insights',         subtitle: 'pageSubtitle.ai-insights' },
    'ai-rules':                 { title: 'pageTitle.ai-rules',            subtitle: 'pageSubtitle.ai-rules' },
    'ai-evaluation':            { title: 'pageTitle.ai-evaluation',       subtitle: 'pageSubtitle.ai-evaluation' },
    reports:                    { title: 'pageTitle.reports',             subtitle: 'pageSubtitle.reports' },
    tags:                       { title: 'pageTitle.tags',                subtitle: 'pageSubtitle.tags' },
    'data-center':              { title: 'pageTitle.data-center',         subtitle: 'pageSubtitle.data-center' },
    'ai-config':                { title: 'pageTitle.ai-config',           subtitle: 'pageSubtitle.ai-config' },
    'ai-status':                { title: 'pageTitle.ai-status',           subtitle: 'pageSubtitle.ai-status' },
    about:                      { title: 'pageTitle.about',               subtitle: 'pageSubtitle.about' }
};

// ==========================================
// 导航（History API 干净路由：/transactions 而非 #transactions）
// ==========================================
let currentPage = 'dashboard';
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => item.addEventListener('click', () => switchPage(item.dataset.page)));
document.querySelectorAll('.see-all').forEach(el => el.addEventListener('click', () => switchPage(el.dataset.page)));
document.getElementById('aiStatusBtn')?.addEventListener('click', () => switchPage('ai-status'));
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
        label.innerHTML = `<span style="display:block;font-size:11px;line-height:1;font-weight:var(--fw-medium)">${name}</span>`;
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
                    <span>${text}</span>
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
function siteBase() {
    return (window.XIN_API_BASE || '/api').replace(/\/api$/, '');
}
// 从 pathname 解析当前路由页（去掉站点根前缀与首尾斜杠）
function currentRoute() {
    let p = window.location.pathname;
    const base = siteBase();
    if (base && p.startsWith(base)) p = p.slice(base.length);
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p || 'dashboard';
}
// 路由页对应的 URL（所有页面统一为 /<page>，dashboard 也是 /dashboard）
function pageUrl(page) {
    const base = siteBase();
    return base + '/' + page;
}

// 仅负责 DOM 渲染（不修改历史），供 switchPage 与 popstate 复用
async function showPage(page) {
    // 懒加载：若该 page 为占位 section（data-lazy），先 fetch 进来
    await PageLoader.ensureLoaded(`page-${page}`);

    currentPage = page;
    navItems.forEach(i => i.classList.toggle('active', i.dataset.page === page));
    const meta = PAGE_META[page] || {};
    document.getElementById('pageTitle').textContent = I18N.t(meta.title);
    document.getElementById('pageSubtitle').textContent = I18N.t(meta.subtitle);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pg = document.getElementById(`page-${page}`);
    if (pg) pg.classList.add('active');
    // 快速记账按钮仅在仪表盘页面显示
    const quickBtn = document.getElementById('quickAddBtn');
    if (quickBtn) quickBtn.style.display = page === 'dashboard' ? '' : 'none';
    // 交易管理页的 class 钩子（保留：CSS 里 .top-bar-sticky 仍承载该页专属的
    // padding 与分隔线）。⛔ 顶部三层 sticky 吸顶已于 2026-08-24 按用户要求取消，
    // 该 class 不再改变定位行为，--sticky-top-1/2 也不再需要注入。
    const topBar = document.querySelector('header.top-bar');
    if (topBar) topBar.classList.toggle('top-bar-sticky', page === 'transactions');
    // 关于页：动态填充真实版本号（懒加载 HTML 经 innerHTML 注入，内联脚本不会执行）
    if (page === 'about') {
        fetch('/api/version').then(r => r.json()).then(j => {
            const v = j?.data?.version;
            const el = document.getElementById('aboutVersion');
            if (v && el) el.textContent = v;
        }).catch(() => {});

        // 应用一键更新：检测最新镜像 / 应用更新
        const checkBtn = document.getElementById('aboutCheckUpdateBtn');
        const applyBtn = document.getElementById('aboutApplyUpdateBtn');
        const statusEl = document.getElementById('aboutUpdateStatus');
        if (checkBtn && statusEl && !checkBtn.dataset.bound) {
            checkBtn.dataset.bound = '1';
            checkBtn.addEventListener('click', async () => {
                checkBtn.disabled = true;
                statusEl.textContent = tt('app.update.checking', '检测中…');
                try {
                    const res = await fetch(`${API}/update/check`, { credentials: 'same-origin' });
                    // 旧版本镜像不含该路由 → 404；限流 → 429。必须区分，否则一律「检测失败」无从排查。
                    if (res.status === 404) {
                        statusEl.textContent = tt('app.update.unsupported', '当前版本不支持在线更新，请手动拉取最新镜像');
                        return;
                    }
                    if (res.status === 429) {
                        statusEl.textContent = tt('app.update.tooFrequent', '检测过于频繁，请 10 分钟后再试');
                        return;
                    }
                    const r = await res.json().catch(() => null);
                    if (r && r.success && r.data) {
                        const d = r.data;
                        let msg = tt('app.update.current', '当前 {version}').replace('{version}', d.currentVersion || '');
                        if (d.error) {
                            // 取不到最新版本时如实提示，绝不显示「已是最新」
                            msg += tt('app.update.noLatest', ' · 无法获取最新版本（{err}）').replace('{err}', d.error);
                            // dev 构建用户不受 GitHub API 限流/超时影响，
                            // 仍可强制更新到 ghcr.io 最新镜像（不需要版本号比对）
                            if (applyBtn && !d.isDevBuild) applyBtn.style.display = 'none';
                            else if (applyBtn) msg += tt('app.update.forceHint', '；可强制更新到最新镜像');
                        } else {
                            if (d.latestVersion) msg += tt('app.update.latest', ' / 最新 {version}').replace('{version}', d.latestVersion);
                            if (d.hasUpdate) {
                                if (applyBtn) applyBtn.style.display = '';
                                msg += tt('app.update.found', ' · 发现新版本');
                            } else if (d.isDevBuild) {
                                if (applyBtn) applyBtn.style.display = '';
                                msg += tt('app.update.devSwitch', ' · 本地自建版本，可切换到官方镜像');
                            } else {
                                if (applyBtn) applyBtn.style.display = 'none';
                                msg += tt('app.update.upToDate', ' · 已是最新');
                            }
                        }
                        if (d.dockerAvailable === false) msg += tt('app.update.noDocker', '（容器内 docker 不可用，无法自动更新）');
                        statusEl.textContent = msg;
                    } else {
                        statusEl.textContent = tt('app.update.failedHttp', '检测失败（HTTP {status}）').replace('{status}', res.status);
                    }
                } catch (e) {
                    statusEl.textContent = tt('app.update.failed', '检测失败：{msg}').replace('{msg}', e.message || '网络错误');
                } finally {
                    checkBtn.disabled = false;
                }
            });
            if (applyBtn) applyBtn.addEventListener('click', async () => {
                applyBtn.disabled = true;
                statusEl.textContent = tt('app.update.applying', '正在更新，服务即将重启…');
                try {
                    const ap = await fetch(`${API}/update/apply`, { method: 'POST', credentials: 'same-origin' });
                    if (!ap.ok) {
                        statusEl.textContent = tt('app.update.requestFailed', '更新请求失败（HTTP {status}）').replace('{status}', ap.status);
                        applyBtn.disabled = false;
                        return;
                    }
                    // 轮询 /healthz 等待容器重启完成（最多约 2 分钟）
                    let restored = false;
                    for (let i = 0; i < 40; i++) {
                        await new Promise(r => setTimeout(r, 3000));
                        try {
                            const h = await fetch('/healthz', { cache: 'no-store' });
                            if (h.ok) { restored = true; break; }
                        } catch (e) { /* 重启中，连接暂不可达 */ }
                    }
                    if (restored) location.reload();
                    else statusEl.textContent = tt('app.update.maybeDone', '更新可能已完成，请手动刷新页面');
                } catch (e) {
                    statusEl.textContent = tt('app.update.applyFailed', '更新失败：{msg}').replace('{msg}', e.message || '');
                    applyBtn.disabled = false;
                }
            });
        }
    }
    // 刷新当前页数据
    refreshPage(page);
}

/* ── 原 syncStickyOffsets() 已删除 ────────────────────────────────────
   它的职责是实测 top-bar / filter-bar 高度并注入 --sticky-top-1 / --sticky-top-2，
   供三层 sticky 的 top 值消费。顶部固定取消后这两个变量无人消费，
   继续 rAF 双帧测量纯属浪费。
   ⛔ 如需恢复吸顶，连同 components.css / styles.css 里的注释一起恢复，
      并重新面对「玻璃态 blur 会抹平 body blob」这个矛盾。 */

// （原 resize 监听用于重算 sticky 偏移量，吸顶取消后已无必要，一并删除。）

// 导航：写入历史记录 + 渲染
function switchPage(page) {
    history.pushState({ page }, '', pageUrl(page));
    showPage(page);  // async: fire-and-forget，避免阻塞 click handler
}

// 浏览器前进/后退：仅渲染，不新增历史
window.addEventListener('popstate', () => {
    const page = currentRoute();
    const valid = Object.keys(PAGE_META);
    showPage(valid.includes(page) ? page : 'dashboard');
});

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
        if (M.AIRecognition) await M.AIRecognition.refresh();
        if (M.AISmartEntry) M.AISmartEntry.refresh();
        if (M.AIChat) M.AIChat.refresh();
    }
    if (page === 'ai-insights' && M.AIInsights) await M.AIInsights.refresh();
    if (page === 'ai-rules' && M.AIRules) await M.AIRules.refresh();
    if (page === 'ai-evaluation' && M.AIEvaluation) await M.AIEvaluation.refresh();
    if (page === 'ai-config') { if (M.AIProviderManager) { await M.AIProviderManager.refresh(); await M.AIProviderManager.refreshOcrConfig(); } if (M.AISettings) await M.AISettings.refresh(); initAIConfigTabs(); }
    if (page === 'ai-status' && M.AITools) await M.AITools.refresh();
    if (page === 'reports' && M.ReportManager) await M.ReportManager.refresh();
}

window.refreshCurrentPage = () => refreshPage(currentPage);
window.getCurrentPage = () => currentPage;

// 多账本切换：重拉缓存（账户/分类等随账本隔离）+ 刷新当前页数据
window.addEventListener('book:changed', async () => {
    try { await initCache(); } catch (e) { console.warn('book:changed initCache 失败:', e.message); }
    if (typeof window.refreshCurrentPage === 'function') window.refreshCurrentPage();
});

function quickAddFromAI(catId, note) {
    document.getElementById('quickAddModal').classList.add('show');
    document.querySelectorAll('#quickAddForm .type-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); if (b.dataset.type === 'expense') { b.classList.add('active'); b.setAttribute('aria-pressed','true'); } });
    QuickAdd.updateCatSelect('expense');
    document.getElementById('quickCategory').value = catId;
    document.getElementById('quickNote').value = note;
}

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

function initCurrencySwitcher() {
    const btn = document.getElementById('currencyBtn');
    const menu = document.getElementById('currencyMenu');
    if (!btn || !menu) return;
    const supported = (window.supportedCurrencies || ['CNY','USD','EUR','HKD','JPY','GBP','AUD','CAD']);
    const symbolMap = { CNY:'¥', USD:'$', EUR:'€', HKD:'HK$', JPY:'¥', GBP:'£', AUD:'A$', CAD:'C$' };

    // 多币种 P2-2b：汇率元信息行（订阅 FxManager，refresh 后自动刷新）
    const metaEl = document.createElement('div');
    metaEl.style.cssText = 'padding:6px 12px;font-size:11px;color:var(--text-tertiary);border-bottom:1px solid var(--border-subtle);margin-bottom:4px';
    menu.appendChild(metaEl);

    // 货币选项（点击切换 baseCurrency + 整页 reload）
    menu.insertAdjacentHTML('beforeend', supported.map(function (c) {
        return '<button class="lang-opt" data-cur="' + c + '" style="display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:var(--text-primary);cursor:pointer;border-radius:6px;font-size:14px">' + c + ' ' + (symbolMap[c] || '') + '</button>';
    }).join(''));

    // 分隔线 + 刷新按钮
    menu.insertAdjacentHTML('beforeend', '<div style="border-top:1px solid var(--border-subtle);margin:4px 0"></div>');
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'lang-opt';
    refreshBtn.dataset.act = 'refresh';
    refreshBtn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:var(--text-primary);cursor:pointer;border-radius:6px;font-size:14px';
    refreshBtn.textContent = '🔄 ' + I18N.t('currency.refresh');
    menu.appendChild(refreshBtn);

    // i18n 切换时同步刷新按钮文案（汇率元信息 / 按钮文案）
    const onI18nChanged = () => {
        if (!refreshBtn.disabled) {
            refreshBtn.textContent = '🔄 ' + I18N.t('currency.refresh');
        }
        if (metaEl && metaEl.dataset.fxText === 'ready') {
            metaEl.textContent = I18N.t('currency.lastUpdated') + ': ' + (window.FxManager && FxManager.rates ? window.FxManager.rates.date : '');
        }
    };
    window.addEventListener('i18n:changed', onI18nChanged);

    const updateFxMeta = function () {
        const r = window.FxManager && FxManager.rates;
        if (r) {
            metaEl.textContent = I18N.t('currency.lastUpdated') + ': ' + r.date + (r.stale ? ' (' + I18N.t('currency.stale') + ')' : '');
            metaEl.dataset.fxText = 'ready';
        } else {
            metaEl.textContent = I18N.t('currency.loading');
        }
    };
    updateFxMeta();
    if (window.FxManager && FxManager.subscribe) FxManager.subscribe(updateFxMeta);

    const syncActive = function () {
        const cur = (window.PreferencesManager && PreferencesManager.baseCurrency) || 'CNY';
        btn.textContent = symbolMap[cur] || cur;
        const opts = menu.querySelectorAll('.lang-opt');
        for (let i = 0; i < opts.length; i++) {
            if (opts[i].dataset.cur) {
                opts[i].style.background = (opts[i].dataset.cur === cur) ? 'var(--surface-hover)' : 'none';
            }
        }
    };
    syncActive();
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        menu.style.display = (menu.style.display === 'none' || menu.style.display === '') ? 'block' : 'none';
    });
    document.addEventListener('click', function () { menu.style.display = 'none'; });
    // 货币点击：保持原有行为（切 baseCurrency + reload）
    const opts = menu.querySelectorAll('.lang-opt[data-cur]');
    for (let i = 0; i < opts.length; i++) {
        opts[i].addEventListener('click', async function (e) {
            e.stopPropagation();
            await PreferencesManager.setBaseCurrency(opts[i].dataset.cur);
            menu.style.display = 'none';
            window.dispatchEvent(new CustomEvent('currency:changed', { detail: { baseCurrency: opts[i].dataset.cur } }));
            location.reload();
        });
    }
    // 刷新按钮：手动拉远端汇率
    refreshBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!window.FxManager) return;
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ ' + I18N.t('common.loading');
        try {
            await FxManager.refresh();
            if (typeof showToast === 'function') showToast(I18N.t('currency.toast.updated'), 'success');
        } catch (err) {
            if (typeof showToast === 'function') showToast(I18N.t('currency.toast.failed', { msg: err.message || 'Unknown error' }), 'error');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 ' + I18N.t('currency.refresh');
            menu.style.display = 'none';
        }
    });
    window.addEventListener('preferences:changed', syncActive);
    window.addEventListener('currency:changed', syncActive);
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
    initCurrencySwitcher();
    // ⛔ safeInit 必须先定义再调用：const 不会 hoist，提前调用会 TDZ 抛 ReferenceError
    const safeInit = (name, fn) => { try { fn(); log('  ✅ '+name); } catch(e) { console.warn(tt('app.boot.warnSkip', '  ⚠️  {name} (跳过):').replace('{name}', name), e.message); } };
    safeInit('FxManager', () => FxManager.init());   // 多币种 P2-2b：拉取汇率（顶栏刷新按钮依赖）
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
    safeInit('AIRecognition', () => AIRecognition.init());
    safeInit('AISmartEntry', () => AISmartEntry.init());
    safeInit('AIAdvice', () => AIAdvice.init());
    safeInit('AIChat', () => AIChat.init());
    safeInit('AIRules', () => AIRules.init());
    safeInit('AILearning', () => AILearning.init());
    safeInit('AIInsights', () => AIInsights.init());
    safeInit('AIEvaluation', () => AIEvaluation.init());
    safeInit('AIProviderManager', () => AIProviderManager.init());
    safeInit('AISettings', () => AISettings.init());
    safeInit('ReportManager', () => ReportManager.init());
    safeInit('QuickAdd', () => QuickAdd.init());
    try { await DashboardManager.init(); console.log('  ✅ Dashboard'); } catch(e) { console.warn(tt('app.boot.warnDashboard', '  ⚠️  Dashboard (跳过):'), e.message); }

    // 从 URL path 恢复页面状态（干净路由：/transactions）
    const page = currentRoute();
    const validPages = Object.keys(PAGE_META);
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
