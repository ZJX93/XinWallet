/* ============================================
   鑫钱包 · 真实数据导出→导入→全功能验证
   - 用真实账号（默认 123456）导出当前账本快照（真实数据）
   - 注册隔离测试用户，把快照导入到该用户（不污染真实账号）
   - 解析导出的 xlsx 得到「导出侧」真实计数，与「导入响应」计数逐一比对（往返保真度）
   - 逐项验证导入后：账户/分类/标签/预算/债务/储蓄/理财(含加仓减仓 recompute)/交易/转账
     的列表读取、关键写操作、以及二次往返的幂等性与「建仓流水修复」持续生效
   运行：REAL_PWD=<真实账号密码> node scripts/verify-export-import.js  （需本地 18888 服务已起）
   ============================================ */
'use strict';

const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:18888';
const REAL_USER = process.env.REAL_USER || '123456';
// 真实账号密码通过环境变量传入，避免把真实凭据写进仓库/提交历史
const REAL_PWD = process.env.REAL_PWD;
if (!REAL_PWD) {
    logger.error('✗ 缺少 REAL_PWD 环境变量（真实账号密码，用于导出快照）。\n  用法: REAL_PWD=xxxx node scripts/verify-export-import.js');
    process.exit(2);
}

const { parseWorkbook } = require(path.join(__dirname, '..', 'server', 'routes', 'backup'));

let pass = 0, failN = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; logger.info('  ✅ ' + name + (extra ? '  ' + extra : '')); }
    else { failN++; fails.push(name); logger.info('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}
const near = (a, b, eps = 0.05) => Math.abs((a || 0) - (b || 0)) < eps;

// 从列表接口响应中提取数组（兼容各接口不同返回结构）
function listOf(resp, name) {
    const d = resp.data;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.data)) return d.data;
    if (Array.isArray(d.list)) return d.list;
    if (Array.isArray(d.investments)) return d.investments;
    if (Array.isArray(d.flat)) return d.flat;      // 分类接口 {tree, flat}
    if (Array.isArray(d.tree)) return d.tree;
    if (Array.isArray(d[name])) return d[name];
    if (Array.isArray(d.accounts)) return d.accounts;
    if (Array.isArray(d.categories)) return d.categories;
    if (Array.isArray(d.debts)) return d.debts;
    if (Array.isArray(d.tags)) return d.tags;
    if (Array.isArray(d.budgets)) return d.budgets;
    if (Array.isArray(d.savings_goals)) return d.savings_goals;
    return [];
}

async function api(p, token, method = 'GET', body) {
    const headers = { Authorization: 'Bearer ' + token };
    const opt = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(BASE + p, opt);
    const txt = await r.text();
    let respJson = null;
    try { respJson = JSON.parse(txt); } catch (e) { respJson = { _text: txt }; }
    // 统一把响应内层 data 透出（接口返回 {success, data, message}）
    return { status: r.status, data: (respJson && respJson.data !== undefined ? respJson.data : respJson) || {} };
}

async function main() {
    logger.info(`\n=== 鑫钱包 真实数据 导出→导入→全功能验证 (BASE=${BASE}) ===\n`);

    // ---------- 1) 真实账号登录 + 导出快照 + 解析导出侧计数 ----------
    logger.info('【1】真实账号登录并导出账本快照');
    const login = await api('/api/auth/login', null, 'POST', { username: REAL_USER, password: REAL_PWD });
    ok('真实账号登录 200', login.status === 200, 'status=' + login.status);
    const tokenA = login.data && login.data.token;
    ok('拿到真实账号 token', !!tokenA);
    if (!tokenA) { finish(); return; }

    const exp = await fetch(BASE + '/api/backup/export', { headers: { Authorization: 'Bearer ' + tokenA } });
    ok('导出接口 200', exp.status === 200, 'status=' + exp.status);
    const buf = Buffer.from(await exp.arrayBuffer());
    ok('导出生成非空 xlsx', buf.length > 0, 'bytes=' + buf.length);
    const ct = exp.headers.get('content-type') || '';
    ok('导出 content-type 为 xlsx', /spreadsheetml|excel|octet/.test(ct), ct);

    const parsed = await parseWorkbook(buf);
    const expC = {
        accounts: (parsed.accounts && parsed.accounts['账户'] || []).length,
        investments: (parsed.accounts && parsed.accounts['理财持仓'] || []).length,
        categories: (parsed.config && parsed.config['分类'] || []).filter(c => c && c['系统预设'] !== '是').length,
        tags: (parsed.config && parsed.config['标签'] || []).length,
        budgets: (parsed.config && parsed.config['预算'] || []).length,
        debts: (parsed.config && parsed.config['债务'] || []).length,
        savings_goals: (parsed.config && parsed.config['储蓄目标'] || []).length,
        transactions: (parsed.transactions || []).filter(t => t['类型'] !== '转账').length,
        transfers: (parsed.transactions || []).filter(t => t['类型'] === '转账').length
    };
    logger.info('  导出侧真实计数:', JSON.stringify(expC));

    // ---------- 2) 注册隔离测试用户 ----------
    logger.info('\n【2】注册隔离测试用户');
    const uname = 'verify_' + Date.now().toString().slice(-8);
    const upwd = 'Test1234';
    const reg = await api('/api/auth/register', null, 'POST', { username: uname, password: upwd });
    ok('测试用户注册 200', reg.status === 200, 'status=' + reg.status + (reg.data && reg.data.message ? ' ' + reg.data.message : ''));
    const tokenB = reg.data && reg.data.token;
    ok('拿到测试用户 token', !!tokenB);
    if (!tokenB) { finish(); return; }

    // ---------- 3) 把真实快照导入隔离用户（清空+导入） ----------
    logger.info('\n【3】导入真实快照到隔离用户（清空+导入）');
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'real_backup.xlsx');
    const impR = await fetch(BASE + '/api/backup/import', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenB }, body: form });
    const imp = await impR.json();
    ok('导入接口 200', impR.status === 200, 'status=' + impR.status);
    ok('导入 success=true', imp.success === true, imp.message || '');
    const im = imp.data && imp.data.imported;
    logger.info('  导入统计:', JSON.stringify(im));

    // ---------- 4) 往返保真度：导入计数 == 导出侧计数 ----------
    logger.info('\n【4】导出导入往返保真度（计数一致）');
    const pairs = [
        ['账户', 'accounts'], ['理财持仓', 'investments'], ['分类', 'categories'],
        ['标签', 'tags'], ['预算', 'budgets'], ['债务', 'debts'],
        ['储蓄目标', 'savings_goals'], ['交易', 'transactions'], ['转账', 'transfers']
    ];
    for (const [label, key] of pairs) {
        const expV = expC[key], impV = im ? im[key] : undefined;
        ok(`导入${label}数==导出${label}数 (${expV}==${impV})`, expV === impV, `${expV} vs ${impV}`);
    }

    // ---------- 5) 各实体列表读取正常 ----------
    logger.info('\n【5】导入后各实体列表读取正常');
    const accB = await api('/api/accounts', tokenB);
    const accList = listOf(accB, 'accounts');
    ok('账户列表 200 且含数据', accB.status === 200 && accList.length > 0, 'n=' + accList.length);
    const catB = await api('/api/categories', tokenB);
    const catList = listOf(catB, 'categories');
    ok('分类列表 200 且含数据', catB.status === 200 && catList.length > 0, 'n=' + catList.length);
    const tagB = await api('/api/tags', tokenB);
    const tagList = listOf(tagB, 'tags');
    ok('标签列表 200', tagB.status === 200, 'n=' + tagList.length);
    const budB = await api('/api/budgets', tokenB);
    const budList = listOf(budB, 'budgets');
    ok('预算列表 200', budB.status === 200, 'n=' + budList.length);
    const debtB = await api('/api/debts', tokenB);
    const debtList = listOf(debtB, 'debts');
    ok('债务列表 200 且含数据', debtB.status === 200 && debtList.length > 0, 'n=' + debtList.length);
    const sgB = await api('/api/savings-goals', tokenB);
    const sgList = listOf(sgB, 'savings_goals');
    ok('储蓄目标列表 200', sgB.status === 200, 'n=' + sgList.length);
    const invB = await api('/api/investments/investments', tokenB);
    const invList = listOf(invB, 'investments');
    ok('理财列表 200 且含数据', invB.status === 200 && invList.length > 0, 'n=' + invList.length);
    const txnB = await api('/api/transactions?page=1&page_size=1', tokenB);
    ok('交易列表 200', txnB.status === 200, 'status=' + txnB.status);
    const trfB = await api('/api/transfers?page=1&page_size=1', tokenB);
    ok('转账列表 200', trfB.status === 200, 'status=' + trfB.status);
    const dash = await api('/api/stats/dashboard', tokenB);
    ok('仪表盘 200', dash.status === 200, 'status=' + dash.status);

    // ---------- 6) 理财加仓/减仓 recompute 一致性 ----------
    logger.info('\n【6】导入后理财加仓/减仓（recompute 一致性）');
    const H = invList.find(x => parseFloat(x.quantity) > 0) || invList[0];
    ok('选中持仓用于加减仓', !!H, H ? ('#' + H.id + ' ' + H.name) : '');
    if (H) {
        const txns = await api('/api/investments/investments/' + H.id + '/transactions', tokenB);
        const rows = listOf(txns, 'transactions');
        ok('导入后持仓含建仓流水(≥1)', rows.length >= 1, 'txns=' + rows.length);

        const p = parseFloat(H.current_price) || 1;
        const qBuy = 10;
        const buyR = await api('/api/investments/investments/' + H.id + '/reduce', tokenB, 'POST',
            { action: 'buy', price: p, quantity: qBuy, fee: 0, date: '2026-08-18', note: '验证加仓' });
        ok('加仓 200', buyR.status === 200, 'status=' + buyR.status + (buyR.data && buyR.data.message ? ' ' + buyR.data.message : ''));
        const Hb = listOf(await api('/api/investments/investments', tokenB), 'investments').find(x => x.id === H.id);
        const expQty = parseFloat(H.quantity) + qBuy;
        const expCost = parseFloat(H.total_cost) + (p * qBuy);
        ok('加仓后数量正确', near(Hb.quantity, expQty), `${Hb.quantity} vs ${expQty}`);
        ok('加仓后成本正确', near(Hb.total_cost, expCost), `${Hb.total_cost} vs ${expCost}`);

        const qSell = 5;
        const sellR = await api('/api/investments/investments/' + H.id + '/reduce', tokenB, 'POST',
            { action: 'sell', price: p, quantity: qSell, fee: 0, date: '2026-08-18', note: '验证减仓' });
        ok('减仓 200', sellR.status === 200, 'status=' + sellR.status + (sellR.data && sellR.data.message ? ' ' + sellR.data.message : ''));
        const Hs = listOf(await api('/api/investments/investments', tokenB), 'investments').find(x => x.id === H.id);
        const expQty2 = expQty - qSell;
        const costRatio = qSell / expQty;
        const expCost2 = expCost - expCost * costRatio;
        ok('减仓后数量正确', near(Hs.quantity, expQty2), `${Hs.quantity} vs ${expQty2}`);
        ok('减仓后成本正确', near(Hs.total_cost, expCost2), `${Hs.total_cost} vs ${expCost2}`);
    }

    // ---------- 7) 交易/转账 写入验证 ----------
    logger.info('\n【7】导入后新建交易/转账');
    // 选余额最高的账户做写入验证，避免恰好选中低余额账户触发"余额不足"被误判为功能异常
    const sortedAcc = [...accList].sort((a, b) => parseFloat(b.balance || 0) - parseFloat(a.balance || 0));
    const hiAcc = sortedAcc[0];
    const hiBal = parseFloat(hiAcc.balance || 0);
    if (hiAcc && catList.length) {
        const txnAmt = Math.min(1.23, Math.max(0.01, Math.floor((hiBal - 0.01) * 100) / 100));
        const newTxn = await api('/api/transactions', tokenB, 'POST', {
            account_id: hiAcc.id, category_id: catList[0].id, type: 'expense', amount: txnAmt, note: '验证交易'
        });
        ok('新建交易 200', newTxn.status === 200, 'status=' + newTxn.status + (newTxn.data && newTxn.data.message ? ' ' + newTxn.data.message : ''));
        const other = sortedAcc.find(a => a.id !== hiAcc.id);
        if (other) {
            const trfAmt = Math.min(5, Math.max(0.01, Math.floor((hiBal - 0.01) * 100) / 100));
            const newTrf = await api('/api/transfers', tokenB, 'POST', {
                from_account_id: hiAcc.id, to_account_id: other.id, amount: trfAmt, note: '验证转账'
            });
            ok('新建转账 200', newTrf.status === 200, 'status=' + newTrf.status + (newTrf.data && newTrf.data.message ? ' ' + newTrf.data.message : ''));
        } else {
            logger.info('  ⚠️ 账户不足 2 个，跳过转账写入验证');
        }
    } else {
        logger.info('  ⚠️ 无账户/分类，跳过交易写入验证');
    }

    // ---------- 8) 二次往返（再导出→再导入）幂等性 ----------
    logger.info('\n【8】二次往返：再导出→再导入（幂等/不丢数据/建仓修复仍生效）');
    const before_acc = (listOf(await api('/api/accounts', tokenB), 'accounts')).length;
    const before_cat = (listOf(await api('/api/categories', tokenB), 'categories')).length;
    const before_inv = (listOf(await api('/api/investments/investments', tokenB), 'investments')).length;
    const exp2 = await fetch(BASE + '/api/backup/export', { headers: { Authorization: 'Bearer ' + tokenB } });
    const buf2 = Buffer.from(await exp2.arrayBuffer());
    ok('二次导出 200 非空', exp2.status === 200 && buf2.length > 0, 'bytes=' + buf2.length);
    const form2 = new FormData();
    form2.append('file', new Blob([buf2], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'real_backup2.xlsx');
    const imp2R = await fetch(BASE + '/api/backup/import', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenB }, body: form2 });
    const imp2 = await imp2R.json();
    ok('二次导入 200 success', imp2R.status === 200 && imp2.success === true, 'status=' + imp2R.status);
    const after_acc = (listOf(await api('/api/accounts', tokenB), 'accounts')).length;
    const after_cat = (listOf(await api('/api/categories', tokenB), 'categories')).length;
    const afterInv = listOf(await api('/api/investments/investments', tokenB), 'investments');
    const after_inv = afterInv.length;
    ok('二次导入后 账户数不变', after_acc === before_acc, `${after_acc} vs ${before_acc}`);
    ok('二次导入后 分类数不变', after_cat === before_cat, `${after_cat} vs ${before_cat}`);
    ok('二次导入后 理财数不变', after_inv === before_inv, `${after_inv} vs ${before_inv}`);
    // 建仓修复在重导后仍生效：每个「持有中」持仓恰好 1 条建仓流水
    let allOne = true, totalTxn = 0, holdingCount = 0;
    for (const h of afterInv) {
        if (parseFloat(h.quantity) <= 0) continue;
        holdingCount++;
        const t = await api('/api/investments/investments/' + h.id + '/transactions', tokenB);
        const rr = listOf(t, 'transactions');
        totalTxn += rr.length;
        if (rr.length !== 1) allOne = false;
    }
    ok('二次导入后每持有持仓恰 1 条建仓流水', allOne, 'totalInvTxn=' + totalTxn + ' holdings=' + holdingCount);
    // 加仓在二次导入后仍可用
    const H2 = afterInv.find(x => parseFloat(x.quantity) > 0) || afterInv[0];
    if (H2) {
        const r2 = await api('/api/investments/investments/' + H2.id + '/reduce', tokenB, 'POST',
            { action: 'buy', price: parseFloat(H2.current_price) || 1, quantity: 3, fee: 0, date: '2026-08-18', note: '二次导入后加仓' });
        ok('二次导入后加仓仍可用 200', r2.status === 200, 'status=' + r2.status + (r2.data && r2.data.message ? ' ' + r2.data.message : ''));
    }

    finish();
}

function finish() {
    logger.info(`\n=== 结果：通过 ${pass} / 失败 ${failN} ===`);
    if (failN) { logger.info('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
    else logger.info('🎉 全部通过');
}
main().catch(e => { logger.error('💥 脚本异常:', e && e.stack ? e.stack : e); process.exitCode = 1; });
