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
        'getCat',
        'getAcc',
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
