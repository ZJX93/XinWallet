/*
 * nav.js —— 从 app.js 抽离的导航核心（审计 id 18：app.js god-file 分解第五刀）。
 * 页面标题/副标题映射、当前页状态、导航高亮与 History API 干净路由。
 * 依赖：utils（api/fmt/escapeHtml 已挂 window）、core.js（pageUrl / currentRoute）、
 * i18n.js（I18N）、page-loader.js（PageLoader）、ui.js（showToast 等）。
 * currentPage / navItems / PAGE_META 为模块内 lexical；navItems / PAGE_META 同时挂 window
 * 供 boot() 等跨脚本（app.js）访问。showPage / switchPage 为函数声明，自动挂 window。
 */
// 导航（History API 干净路由：/transactions 而非 #transactions）
let currentPage = 'dashboard';
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => item.addEventListener('click', () => switchPage(item.dataset.page)));
window.navItems = navItems; // 供 app.js 顶部 .see-all 之外的导航点击绑定等跨脚本访问

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
    reports:                    { title: 'pageTitle.reports',             subtitle: 'pageSubtitle.reports' },
    tags:                       { title: 'pageTitle.tags',                subtitle: 'pageSubtitle.tags' },
    'data-center':              { title: 'pageTitle.data-center',         subtitle: 'pageSubtitle.data-center' },
    'ai-config':                { title: 'pageTitle.ai-config',           subtitle: 'pageSubtitle.ai-config' },
    'ai-status':                { title: 'pageTitle.ai-status',           subtitle: 'pageSubtitle.ai-status' },
    about:                      { title: 'pageTitle.about',               subtitle: 'pageSubtitle.about' },
    'fx-rates':                 { title: 'pageTitle.fx-rates',            subtitle: 'pageSubtitle.fx-rates' }
};
window.PAGE_META = PAGE_META; // 供 boot() 等跨脚本访问（Object.keys）

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
    // 汇率查询页（懒加载片段）：每次进入重新渲染，汇率可能已在别处刷新
    if (page === 'fx-rates' && window.FxRates) {
        try { FxRates.render(); } catch (e) { console.warn('[fx-rates] render 失败:', e.message); }
    }

    // 关于页：动态填充真实版本号（懒加载 HTML 经 innerHTML 注入，内联脚本不会执行）
    if (page === 'about') {
        fetch('/api/version').then(r => r.json()).then(j => {
            const v = j?.data?.version;
            const el = document.getElementById('aboutVersion');
            if (v && el) el.textContent = v;
        }).catch(() => {});

        // 展示上次更新结果（成功/失败/镜像未真正切换告警）；页面刷新后自动重新拉取
        refreshUpdateLast();

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
                    const res = await fetch(`${(window.XIN_API_BASE || '/api')}/update/check`, { credentials: 'same-origin' });
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
                    const ap = await fetch(`${(window.XIN_API_BASE || '/api')}/update/apply`, { method: 'POST', credentials: 'same-origin' });
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

window.refreshCurrentPage = () => refreshPage(currentPage);
window.getCurrentPage = () => currentPage;
