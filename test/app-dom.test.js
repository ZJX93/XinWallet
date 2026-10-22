/* ============================================
   鑫钱包 · 前端 DOM 层单测（审计 id 18：jsdom 测试网，解锁 app.js god-file 分解）
   覆盖 app.js 中可脱离真实后端 / Manager 单独验证的逻辑：
   - 加载安全网：utils.js + app.js 在 jsdom 中无异常加载，核心函数挂到 window
     （god-file 分解时一旦破坏入口/加载期逻辑，这里必红）；
   - mergeTransferPairs：转账配对 / 折叠（god-file 核心逻辑，分解时必保）；
   - fmtSigned：带符号金额格式化（复用 utils.fmt 的 ¥）；
   - showToast：DOM 注入节点 + role/type；
   - getCat：缓存取分类（god-file 缓存访问器）。
   运行：node --test test/app-dom.test.js（无需数据库；依赖 devDependency jsdom）。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./helpers/loadApp');

test('app.js 在 jsdom 中无异常加载且核心函数暴露到 window', () => {
    const { window, errors } = loadApp();
    assert.strictEqual(
        errors.length,
        0,
        '加载不应产生 jsdomError：' + errors.map((e) => e.message).join('; ')
    );
    for (const fn of [
        'mergeTransferPairs',
        'fmtSigned',
        'showToast',
        'showPage',
        'switchPage',
        'getCurrentPage',
        'getCat',
        'getAcc',
        'getExpCats',
        'getIncCats',
        'getTransferCats',
        'showSkeleton',
        'showEmpty',
        'siteBase',
        'currentRoute',
        'pageUrl',
        'renderUpdateLast',
        'initCache',
        'refreshUpdateLast',
        'initAIConfigTabs',
        'initTransMonthFilter',
        'initColorSwatches',
        'initLangSwitcher',
        'initPresetCategoryLocalization',
        'initBottomNav',
        'refreshPage',
        'boot',
    ]) {
        assert.strictEqual(typeof window[fn], 'function', `${fn} 应暴露为全局函数`);
    }
    assert.ok(
        window.cache && Array.isArray(window.cache.accounts),
        'window.cache 应存在且含 accounts 数组'
    );
});

test('mergeTransferPairs：已折叠转账（transfer.from/to）合并为单条', () => {
    const { window } = loadApp();
    const txns = [
        {
            id: 1,
            type: 'transfer',
            amount: 500,
            transfer: { from: { id: 2, name: 'A' }, to: { id: 3, name: 'B' } },
        },
    ];
    const r = window.mergeTransferPairs(txns);
    assert.strictEqual(r.length, 1, '应合并为 1 条');
    assert.strictEqual(r[0]._merged, true);
    assert.strictEqual(r[0].amount, 500);
    assert.ok(r[0]._transferOut && r[0]._transferIn, '应合成双端腿');
});

test('mergeTransferPairs：旧版两条腿按 transfer_id 配对', () => {
    const { window } = loadApp();
    const txns = [
        { id: 1, type: 'transfer_out', amount: 200, transfer_id: 9 },
        { id: 2, type: 'transfer_in', amount: 200, transfer_id: 9 },
        { id: 3, type: 'expense', amount: 50 },
    ];
    const r = window.mergeTransferPairs(txns);
    assert.strictEqual(r.length, 2, '两条腿合并 + 一条普通 = 2');
    const merged = r.find((x) => x._merged);
    assert.ok(merged, '应存在合并行');
    assert.strictEqual(merged.amount, 200);
    assert.strictEqual(r.find((x) => x.id === 3).amount, 50, '普通交易原样保留');
});

test('mergeTransferPairs：跨账户还款（debt_repayment + counterparty）折叠', () => {
    const { window } = loadApp();
    const txns = [
        {
            id: 5,
            type: 'transfer_out',
            amount: 80,
            link_type: 'debt_repayment',
            counterparty: { name: '债主', icon: '🏦' },
        },
    ];
    const r = window.mergeTransferPairs(txns);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0]._merged, true);
    assert.strictEqual(r[0].amount, 80);
});

test('fmtSigned：支出 / 转出带负号、收入带正号（复用 utils.fmt 的 ¥）', () => {
    const { window } = loadApp();
    assert.strictEqual(window.fmtSigned(100, 'expense'), '-¥100.00');
    assert.strictEqual(window.fmtSigned(100, 'income'), '+¥100.00');
    assert.strictEqual(window.fmtSigned(50, 'transfer_out'), '-¥50.00');
    assert.strictEqual(window.fmtSigned(NaN, 'expense'), '¥0.00');
});

test('showToast：#toastContainer 注入后追加 toast 节点并带 role/type', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><div id="toastContainer"></div></body></html>'
    );
    window.showToast('保存成功', 'success');
    const c = window.document.getElementById('toastContainer');
    assert.strictEqual(c.children.length, 1, '应追加 1 个 toast');
    assert.strictEqual(c.children[0].textContent, '保存成功');
    assert.strictEqual(c.children[0].className.includes('success'), true);
    assert.strictEqual(c.children[0].getAttribute('role'), 'status');
});

test('getCat：从 window.cache 取分类（god-file 缓存访问器）', () => {
    const { window } = loadApp();
    window.cache.categories = [{ id: 7, name: '餐饮', icon: '🍜' }];
    assert.strictEqual(window.getCat(7).name, '餐饮');
    assert.strictEqual(window.getCat(999).name, '未知', '缺失分类回退未知');
});

test('showSkeleton：写入骨架屏 DOM 且按 variant/rows 渲染', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><div id="box"></div></body></html>'
    );
    const box = window.document.getElementById('box');
    window.showSkeleton(box, 2, 'list');
    assert.strictEqual(box.querySelector('.skeleton-wrap').getAttribute('data-skeleton'), 'list');
    assert.strictEqual(box.querySelectorAll('.skeleton-row').length, 2, 'list 形态应生成 2 行');
    const grid = window.document.createElement('div');
    window.showSkeleton(grid, 3, 'grid');
    assert.strictEqual(grid.querySelectorAll('.skeleton-card').length, 3, 'grid 形态应生成 3 卡');
    // 空 el 不应抛错
    assert.doesNotThrow(() => window.showSkeleton(null, 2, 'list'));
});

test('showEmpty：写入空态 DOM 并转义文本（防 XSS）', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><div id="box"></div></body></html>'
    );
    const box = window.document.getElementById('box');
    window.showEmpty(box, '<b>暂无</b>', '📭');
    const html = box.innerHTML;
    assert.ok(html.includes('empty-state'), '应包含 empty-state');
    assert.ok(html.includes('empty-icon'), '提供 icon 时应渲染图标');
    assert.ok(html.includes('&lt;b&gt;'), '文本应被 escapeHtml 转义，避免 XSS');
    assert.ok(!html.includes('<b>暂无</b>'), '原始标签不应原样注入');
    // 空 el 不应抛错
    assert.doesNotThrow(() => window.showEmpty(null, 'x'));
});

test('缓存访问器：getAcc / getExpCats / getIncCats / getTransferCats 从 window.cache 取数', () => {
    const { window } = loadApp();
    window.cache.accounts = [{ id: 3, name: '现金', icon: '💵' }];
    window.cache.categories = [
        { id: 1, name: '餐饮', type: 'expense' },
        { id: 2, name: '工资', type: 'income' },
        { id: 4, name: '转账', type: 'transfer' },
    ];
    assert.strictEqual(window.getAcc(3).name, '现金');
    assert.strictEqual(window.getAcc(999).name, '未知', '缺失账户回退未知');
    assert.strictEqual(window.getExpCats().length, 1);
    assert.strictEqual(window.getIncCats().length, 1);
    assert.strictEqual(window.getTransferCats().length, 1);
});

test('路由 URL 助手：siteBase / pageUrl / currentRoute（默认根路径）', () => {
    const { window } = loadApp();
    assert.strictEqual(window.siteBase(), '', '无 XIN_API_BASE 时 siteBase 为 ""');
    assert.strictEqual(window.pageUrl('reports'), '/reports');
    assert.strictEqual(window.currentRoute(), 'dashboard', '根路径回退 dashboard');
});

test('renderUpdateLast：空数据隐藏、成功/告警/未挂载分支产出对应徽章', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><div id="aboutUpdateLast"></div></body></html>'
    );
    const el = window.document.getElementById('aboutUpdateLast');

    // 1) null → 隐藏且无列表
    window.renderUpdateLast(null);
    assert.strictEqual(el.hidden, true, 'null 应隐藏容器');
    assert.strictEqual(el.querySelector('ul'), null, 'null 不应渲染列表');

    // 2) 空对象（无记录/无镜像偏差/无 appData）→ 无项，隐藏
    window.renderUpdateLast({});
    assert.strictEqual(el.hidden, true, '空对象应隐藏容器');

    // 3) 命令成功且无镜像偏差 → 一条 ok 徽章
    window.renderUpdateLast({ last: { ok: true, ts: '2026-01-01T00:00:00Z' } });
    assert.strictEqual(el.hidden, false);
    assert.strictEqual(el.querySelectorAll('li').length, 1, '成功分支渲染 1 条');
    assert.ok(el.querySelector('.ul-badge.ok'), 'ok 徽章应存在');

    // 4) 镜像偏差但命令成功 → warn 徽章
    window.renderUpdateLast({
        current: { containerImage: 'x:1', latestImage: 'x:latest', latestId: 'id', isLatest: false },
        last: { ok: true },
    });
    assert.ok(el.querySelector('.ul-badge.warn'), '镜像偏差应渲染 warn 徽章');

    // 5) /app/data 未挂载(type=none) → fix 徽章 + 折叠修复指引
    window.renderUpdateLast({ appData: { type: 'none' } });
    assert.ok(el.querySelector('.ul-badge.fix'), '未挂载应渲染 fix 徽章');
    assert.ok(el.querySelector('details'), 'fix 分支应带折叠修复指引');
});

test('TAG_PALETTE 已挂 window（供 managers/tag.js 这个 ES Module 访问）', () => {
    const { window } = loadApp();
    assert.ok(Array.isArray(window.TAG_PALETTE) && window.TAG_PALETTE.length === 10, 'window.TAG_PALETTE 应有 10 色');
});

test('initColorSwatches：按 TAG_PALETTE 渲染色块、高亮 input 当前值、点击切换', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body>' +
        '<div id="sw" class="color-swatches"></div>' +
        '<input id="tagColor" value="#10b981">' +
        '</body></html>'
    );
    window.initColorSwatches('sw', 'tagColor');
    const sw = window.document.querySelectorAll('#sw .color-swatch');
    assert.strictEqual(sw.length, window.TAG_PALETTE.length, '色块数应等于调色板长度');
    assert.strictEqual(window.document.querySelector('#sw .color-swatch.selected').dataset.color, '#10b981', '应高亮 input 当前值对应色块');
    sw[0].click(); // 事件冒泡到 container 的监听
    assert.strictEqual(window.document.getElementById('tagColor').value, window.TAG_PALETTE[0], '点击应写入 input.value');
    assert.ok(sw[0].classList.contains('selected'), '被点击的色块应 selected');
    assert.strictEqual(window.document.querySelectorAll('#sw .color-swatch.selected').length, 1, '同时仅一个 selected');
});

test('initAIConfigTabs：点击标签切换 active 与对应面板显隐', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body>' +
        '<div id="aiConfigTabs"><button class="ai-config-tab" data-panel="providers">P</button><button class="ai-config-tab" data-panel="ocr">O</button></div>' +
        '<div id="aiConfigPanel-providers"></div>' +
        '<div id="aiConfigPanel-ocr" style="display:none"></div>' +
        '</body></html>'
    );
    window.initAIConfigTabs();
    const tabs = window.document.querySelectorAll('#aiConfigTabs .ai-config-tab');
    tabs[1].click();
    assert.ok(tabs[1].classList.contains('active'), '被点击标签应 active');
    assert.ok(!tabs[0].classList.contains('active'));
    assert.strictEqual(window.document.getElementById('aiConfigPanel-ocr').style.display, '', 'ocr 面板应显示');
    assert.strictEqual(window.document.getElementById('aiConfigPanel-providers').style.display, 'none', 'providers 面板应隐藏');
});

test('initTransMonthFilter：生成「所有月份 + 近 12 月」共 13 项并默认选中 all', () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><select id="transMonthFilter"></select></body></html>'
    );
    window.initTransMonthFilter();
    const opts = window.document.querySelectorAll('#transMonthFilter option');
    assert.strictEqual(opts.length, 13, '选项应为 13（all + 12 月）');
    assert.strictEqual(window.document.getElementById('transMonthFilter').value, 'all', '默认选中所有月份');
});

test('refreshUpdateLast：fetch 成功渲染 ok 徽章；非 200 隐藏容器', async () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body><div id="aboutUpdateLast"></div></body></html>'
    );
    const el = window.document.getElementById('aboutUpdateLast');
    // 成功分支
    window.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: { last: { ok: true, ts: '2026-01-01T00:00:00Z' } } }) });
    await window.refreshUpdateLast();
    assert.strictEqual(el.hidden, false, '成功应显示容器');
    assert.ok(el.querySelector('.ul-badge.ok'), '成功应渲染 ok 徽章');
    // 非 200（旧镜像无该路由）→ 静默隐藏
    el.hidden = false;
    window.fetch = async () => ({ ok: false, status: 404 });
    await window.refreshUpdateLast();
    assert.strictEqual(el.hidden, true, '非 200 应隐藏容器');
});

test('导航：showPage 设置标题 / 高亮当前导航 / 显示当前页 / 更新 currentPage', async () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body>' +
        '<h1 id="pageTitle"></h1><p id="pageSubtitle"></p>' +
        '<a class="nav-item" data-page="transactions">T</a>' +
        '<a class="nav-item" data-page="budget">B</a>' +
        '<section class="page" id="page-transactions"></section>' +
        '<section class="page" id="page-budget"></section>' +
        '<button id="quickAddBtn"></button>' +
        '</body></html>'
    );
    // 桩：I18N（t 回退 key，确定可断言）/ PageLoader（避免真实懒加载请求）
    window.I18N = { t: (k, fb) => (fb == null ? k : fb), lang: 'zh' };
    window.PageLoader = { ensureLoaded: async () => {} };
    await window.showPage('transactions');
    assert.strictEqual(window.document.getElementById('pageTitle').textContent, 'pageTitle.transactions');
    const t = window.document.querySelector('.nav-item[data-page="transactions"]');
    const b = window.document.querySelector('.nav-item[data-page="budget"]');
    assert.ok(t.classList.contains('active'), 'transactions 导航应高亮');
    assert.ok(!b.classList.contains('active'), 'budget 导航不应高亮');
    assert.strictEqual(window.getCurrentPage(), 'transactions');
    assert.ok(window.document.getElementById('page-transactions').classList.contains('active'), '当前页 section 应加 active');
});

test('导航：switchPage 写入 history 并切换 currentPage', async () => {
    const { window } = loadApp(
        '<!doctype html><html><head></head><body>' +
        '<h1 id="pageTitle"></h1><p id="pageSubtitle"></p>' +
        '<a class="nav-item" data-page="dashboard">D</a>' +
        '<a class="nav-item" data-page="budget">B</a>' +
        '<section class="page" id="page-dashboard"></section>' +
        '<section class="page" id="page-budget"></section>' +
        '<button id="quickAddBtn"></button>' +
        '</body></html>'
    );
    window.I18N = { t: (k, fb) => (fb == null ? k : fb), lang: 'zh' };
    window.PageLoader = { ensureLoaded: async () => {} };
    window.switchPage('budget');
    assert.strictEqual(window.history.state && window.history.state.page, 'budget', 'history 应记录当前页');
    // showPage 为 async fire-and-forget，等一拍让 currentPage / 标题更新
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(window.getCurrentPage(), 'budget');
    assert.strictEqual(window.document.getElementById('pageTitle').textContent, 'pageTitle.budget');
});

test('导航元数据：window.PAGE_META 已暴露且含核心页', () => {
    const { window } = loadApp();
    assert.ok(window.PAGE_META && typeof window.PAGE_META === 'object', 'window.PAGE_META 应存在');
    assert.ok('transactions' in window.PAGE_META && 'budget' in window.PAGE_META && 'dashboard' in window.PAGE_META);
});

test('状态中枢（state.js）：window.API 由 XIN_API_BASE 推导、window.cache 含核心字段', () => {
    const { window } = loadApp();
    assert.strictEqual(typeof window.API, 'string', 'window.API 应为字符串');
    assert.ok(window.API.startsWith('/'), '默认根路径下 API 应以 / 开头');
    assert.ok(window.cache && typeof window.cache === 'object', 'window.cache 应存在');
    for (const k of ['accounts', 'categories', 'investmentTypes', 'investments', 'tags', 'currentMonth']) {
        assert.ok(k in window.cache, `window.cache 应含字段 ${k}`);
    }
    // cache 与初始数组引用一致（init.js 的 initCache 会就地填充这些数组）
    // 注意：jsdom 内创建的数组是「jsdom 域 Array」，与 Node 域 [] 跨域，
    // deepStrictEqual 会因原型身份不同失败，故改用 Array.isArray + length 断言。
    assert.ok(Array.isArray(window.cache.accounts) && window.cache.accounts.length === 0, 'accounts 初始应为空数组');
});

test('refreshPage：按页面分派到对应 Manager.refresh；无 Manager / ai-config 守卫不抛错', async () => {
    const { window } = loadApp();
    let called = null;
    window.DashboardManager = { refresh: async () => { called = 'dashboard'; } };
    window.ReportManager = { refresh: async () => { called = 'reports'; } };
    await window.refreshPage('dashboard');
    assert.strictEqual(called, 'dashboard', 'dashboard 应分派到 DashboardManager.refresh');
    await window.refreshPage('reports');
    assert.strictEqual(called, 'reports', 'reports 应分派到 ReportManager.refresh');
    // 无对应 Manager 的页面被 if 守卫跳过，不应抛错
    await assert.doesNotReject(() => window.refreshPage('tags'));
    // ai-config 分支还会调用 initAIConfigTabs（无 #aiConfigTabs 时应早返回，不抛错）
    await assert.doesNotReject(() => window.refreshPage('ai-config'));
});

test('boot：启动编排在无后端/Manager 时也能跑完（I18N/PreferencesManager/initCache/showPage 以桩替换，Manager 缺失被 safeInit 容错）', async () => {
    const { window } = loadApp();
    let showPageCalled = false;
    // 生产环境由 managers/index.js / i18n.js 在 boot 前注入；harness 未加载，以桩替代。
    // 注意 boot 在 try/catch 之外会读 PreferencesManager.lang / I18N.lang，故需真实桩对象。
    window.I18N = { init: async () => {}, setLang: async () => {}, lang: 'zh' };
    window.PreferencesManager = { load: async () => {}, lang: null };
    window.initCache = async () => {};           // 否则会真实请求 /api 并抛错中断 boot
    window.showPage = async () => { showPageCalled = true; };
    // 各业务 Manager 缺失时 safeInit 仅 warn，不中断 boot
    await window.boot();
    assert.strictEqual(showPageCalled, true, 'boot 应到达 showPage 恢复页面');
});
