#!/usr/bin/env node
/* ============================================
   XinWallet 全功能端到端验证脚本
   覆盖：认证、账户、交易、分类、预算、标签、
   转账、理财、储蓄、统计、账本、报表、备份、AI
   ============================================ */

const BASE = process.env.TEST_URL || 'http://localhost:18888';
const API = `${BASE}/api`;
const ExcelJS = require('exceljs');
let TOKEN = '';
let p = 0, f = 0, errors = [];

async function call(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (TOKEN) opts.headers['Authorization'] = `Bearer ${TOKEN}`;
    if (body) opts.body = JSON.stringify(body);
    try {
        const res = await fetch(`${API}${path}`, opts);
        const json = await res.json();
        return { ok: res.ok, status: res.status, success: json.success, data: json.data, msg: json.message };
    } catch (e) {
        return { ok: false, status: 0, success: false, data: null, msg: e.message };
    }
}

function ok(name, result, expect = true) {
    // expect=true: 期望成功 (ok=true, success=true)
    // expect=false: 期望拒绝 (ok可以是false, 但success必须是false)
    const pass = expect
        ? (result.ok && result.success === true)
        : (result.success === false);
    if (pass) { p++; console.info(`  ✅ ${name}`); }
    else { f++; console.info(`  ❌ ${name} — status=${result.status} msg="${result.msg}"`); errors.push(name); }
    return pass;
}

function log(msg) { console.info(`\n${'='.repeat(50)}\n📋 ${msg}\n${'='.repeat(50)}`); }

(async () => {
console.info('🔬 XinWallet 全功能端到端验证\n');

// ================================================================
log('模块一：认证 (Auth)');

// 1.1 演示登录
const login = await call('/auth/demo', 'POST');
ok('1.1 演示登录', login);
TOKEN = login.data?.token;
if (!TOKEN) { console.info('❌ 无法获取 token，终止'); process.exit(1); }

// 1.2 正常登录
const login2 = await call('/auth/login', 'POST', { username: 'demo', password: 'demo123456' });
ok('1.2 正常登录', login2);

// 1.3 错误密码
const login3 = await call('/auth/login', 'POST', { username: 'demo', password: 'wrong' });
ok('1.3 错误密码拒绝', login3, false);

// 1.4 注册新用户
const uname = 'test_' + Date.now();
const reg = await call('/auth/register', 'POST', { username: uname, password: 'Test123456', nickname: '测试' });
ok('1.4 注册新用户', reg);

// 1.5 重复注册
const reg2 = await call('/auth/register', 'POST', { username: uname, password: 'Test123456', nickname: '测试2' });
ok('1.5 重复注册拒绝', reg2, false);

// ================================================================
log('模块二：账户 (Accounts)');

// 2.1 获取账户列表
const accList = await call('/accounts');
const accCount = accList.data?.accounts?.length || 0;
ok('2.1 账户列表', accList);

// 2.2 创建账户
const accCreate = await call('/accounts', 'POST', { name: '测试账户_' + Date.now(), type: 'cash', icon: '💵', balance: 1000 });
const accId = accCreate.data?.id;
ok('2.2 创建账户', accCreate);

// 2.3 更新账户
if (accId) {
    const accUpdate = await call('/accounts/' + accId, 'PUT', { name: '测试账户_已更新', type: 'cash', icon: '💵', balance: 2000 });
    ok('2.3 更新账户', accUpdate);
}

// 2.4 对账
const recon = await call('/accounts/reconcile', 'POST');
ok('2.4 账户对账', recon);

// 2.5 关闭账户
if (accId) {
    const accDelete = await call('/accounts/' + accId, 'DELETE');
    ok('2.5 关闭账户', accDelete);
}

// ================================================================
log('模块三：交易 (Transactions)');

// 获取参考数据
const cats = (await call('/categories?flat=1')).data || [];
const accs = (await call('/accounts')).data?.accounts || [];
const refAcc = accs[0]?.id;
const refCat = cats[0]?.id;

// 3.1 创建支出
const txCreate = await call('/transactions', 'POST', {
    account_id: refAcc, category_id: refCat, type: 'expense',
    amount: 88.88, note: '端到端测试支出', date: '2026-07-18'
});
const txId = txCreate.data?.id;
ok('3.1 创建支出', txCreate);

// 3.2 创建收入
const txIncome = await call('/transactions', 'POST', {
    account_id: refAcc, category_id: 21, type: 'income',
    amount: 999, note: '端到端测试收入', date: '2026-07-18'
});
ok('3.2 创建收入', txIncome);

// 3.3 获取交易列表
const txList = await call('/transactions?limit=10');
ok('3.3 交易列表', txList);

// 3.4 更新交易
if (txId) {
    const txUpdate = await call('/transactions/' + txId, 'PUT', {
        account_id: refAcc, category_id: refCat, type: 'expense',
        amount: 99.99, note: '端到端测试支出_已更新', date: '2026-07-18'
    });
    ok('3.4 更新交易', txUpdate);
}

// 3.5 交易汇总
const summary = await call('/transactions/summary?month=2026-07');
ok('3.5 交易汇总', summary);

// 3.6 交易月份
const months = await call('/transactions/months');
ok('3.6 交易月份', months);

// 3.7 删除交易
if (txId) {
    const txDelete = await call('/transactions/' + txId, 'DELETE');
    ok('3.7 删除交易', txDelete);
}
// 也删除测试收入
if (txIncome.data?.id) {
    await call('/transactions/' + txIncome.data.id, 'DELETE');
}

// ================================================================
log('模块四：分类 (Categories)');

// 4.1 获取分类
const catList = await call('/categories?flat=1');
ok('4.1 分类列表', catList);

// 4.2 创建分类
const catCreate = await call('/categories', 'POST', { name: '测试分类_' + Date.now(), type: 'expense', icon: '🧪', color: '#ff6600' });
const catId = catCreate.data?.id;
ok('4.2 创建分类', catCreate);

// 4.3 更新分类
if (catId) {
    const catUpdate = await call('/categories/' + catId, 'PUT', { name: '测试分类_已更新', type: 'expense', icon: '✅', color: '#00ff00' });
    ok('4.3 更新分类', catUpdate);
}

// 4.4 删除分类
if (catId) {
    const catDelete = await call('/categories/' + catId, 'DELETE');
    ok('4.4 删除分类', catDelete);
}

// ================================================================
log('模块五：预算 (Budgets)');

// 5.1 获取预算
const budList = await call('/budgets');
ok('5.1 预算列表', budList);

// 5.2 创建预算
const budCreate = await call('/budgets', 'POST', {
    name: '测试预算_' + Date.now(), period_type: 'month',
    base_date: '2026-07-01', amount: 5000
});
const budId = budCreate.data?.id;
ok('5.2 创建预算', budCreate);

// 5.3 更新预算
if (budId) {
    const budUpdate = await call('/budgets/' + budId, 'PUT', {
        name: '测试预算_已更新', period_type: 'month',
        base_date: '2026-07-01', amount: 6000
    });
    ok('5.3 更新预算', budUpdate);
}

// 5.4 删除预算
if (budId) {
    const budDelete = await call('/budgets/' + budId, 'DELETE');
    ok('5.4 删除预算', budDelete);
}

// ================================================================
log('模块六：标签 (Tags)');

// 6.1 获取标签
const tagList = await call('/tags');
ok('6.1 标签列表', tagList);

// 6.2 创建标签
const tagCreate = await call('/tags', 'POST', { name: '测试标签_' + Date.now(), color: '#ff0000', icon: '🏷️' });
const tagId = tagCreate.data?.id;
ok('6.2 创建标签', tagCreate);

// 6.3 更新标签
if (tagId) {
    const tagUpdate = await call('/tags/' + tagId, 'PUT', { name: '测试标签_已更新', color: '#0000ff', icon: '📌' });
    ok('6.3 更新标签', tagUpdate);
}

// 6.4 删除标签
if (tagId) {
    const tagDelete = await call('/tags/' + tagId, 'DELETE');
    ok('6.4 删除标签', tagDelete);
}

// ================================================================
log('模块七：转账 (Transfers)');

// 7.1 获取转账
const trList = await call('/transfers');
ok('7.1 转账列表', trList);

// 7.2 创建转账
if (accs.length >= 2) {
    const trCreate = await call('/transfers', 'POST', {
        from_account_id: accs[0].id, to_account_id: accs[1].id,
        amount: 100, note: '测试转账', date: '2026-07-18'
    });
    const trId = trCreate.data?.id;
    ok('7.2 创建转账', trCreate);

    // 7.3 更新转账
    if (trId) {
        const trUpdate = await call('/transfers/' + trId, 'PUT', {
            from_account_id: accs[0].id, to_account_id: accs[1].id,
            amount: 200, note: '测试转账_已更新', date: '2026-07-18'
        });
        ok('7.3 更新转账', trUpdate);
    }

    // 7.4 删除转账
    if (trId) {
        const trDelete = await call('/transfers/' + trId, 'DELETE');
        ok('7.4 删除转账', trDelete);
    }
} else {
    console.info('  ⚠️  跳过转账测试（需要至少2个账户）');
}

// ================================================================
log('模块八：理财 (Investments)');

// 8.1 获取持仓
const invList = await call('/investments');
ok('8.1 理财持仓', invList);

// 8.2 获取类型
const invTypes = await call('/investment-types');
ok('8.2 理财类型', invTypes);

// 8.3 创建类型
const invTypeCreate = await call('/investment-types', 'POST', {
    name: '测试类型_' + Date.now(), icon: '📊', risk_level: 'medium', category: 'fund'
});
const invTypeId = invTypeCreate.data?.id;
ok('8.3 创建理财类型', invTypeCreate);

// 8.4 创建持仓
if (invTypeId && refAcc) {
    const invCreate = await call('/investments', 'POST', {
        account_id: refAcc, investment_type_id: invTypeId, name: '测试基金_' + Date.now(),
        code: '000001', buy_price: 1.5, current_price: 1.6, quantity: 1000,
        total_cost: 1500, current_value: 1600, buy_date: '2026-07-01'
    });
    const invId = invCreate.data?.id;
    ok('8.4 创建持仓', invCreate);

    // 8.5 更新持仓（完整编辑需要所有字段）
    if (invId) {
        const invUpdate = await call('/investments/' + invId, 'PUT', {
            name: '测试基金_已更新', investment_type_id: invTypeId,
            buy_price: 1.5, current_price: 1.8, quantity: 1000,
            total_cost: 1500, current_value: 1800, buy_date: '2026-07-01'
        });
        ok('8.5 更新持仓', invUpdate);
    }

    // 8.6 加仓
    if (invId) {
        const invReduce = await call('/investments/' + invId + '/reduce', 'POST', {
            action: 'buy', price: 1.7, quantity: 500, fee: 5, date: '2026-07-18'
        });
        ok('8.6 加仓', invReduce);
    }

    // 8.7 理财趋势
    const invTrend = await call('/stats/investments');
    ok('8.7 理财趋势', invTrend);

    // 8.8 删除持仓
    if (invId) {
        const invDelete = await call('/investments/' + invId, 'DELETE');
        ok('8.8 删除持仓', invDelete);
    }
}

// 8.9 删除类型
if (invTypeId) {
    const invTypeDelete = await call('/investment-types/' + invTypeId, 'DELETE');
    ok('8.9 删除理财类型', invTypeDelete);
}

// ================================================================
log('模块九：储蓄目标 (Savings)');

// 9.1 获取目标
const goalList = await call('/savings-goals');
ok('9.1 储蓄目标列表', goalList);

// 9.2 创建目标
const goalCreate = await call('/savings-goals', 'POST', {
    name: '测试目标_' + Date.now(), target_amount: 10000, account_id: refAcc, icon: '🎯'
});
const goalId = goalCreate.data?.id;
ok('9.2 创建目标', goalCreate);

// 9.3 更新目标
if (goalId) {
    const goalUpdate = await call('/savings-goals/' + goalId, 'PUT', {
        name: '测试目标_已更新', target_amount: 20000
    });
    ok('9.3 更新目标', goalUpdate);
}

// 9.4 存入
if (goalId) {
    const goalAlloc = await call('/savings-goals/' + goalId + '/allocate', 'POST', { amount: 1000 });
    ok('9.4 存入目标', goalAlloc);
}

// 9.5 取出
if (goalId) {
    const goalWithdraw = await call('/savings-goals/' + goalId + '/withdraw', 'POST', { amount: 500 });
    ok('9.5 取出目标', goalWithdraw);
}

// 9.6 删除目标
if (goalId) {
    const goalDelete = await call('/savings-goals/' + goalId, 'DELETE');
    ok('9.6 删除目标', goalDelete);
}

// ================================================================
log('模块十：统计与仪表盘 (Stats & Dashboard)');

// 10.1 仪表盘
const dash = await call('/stats/dashboard');
ok('10.1 仪表盘', dash);

// 10.2 仪表盘明细
const dashDetail = await call('/stats/dashboard/detail?type=month');
ok('10.2 仪表盘明细(月)', dashDetail);

// 10.3 今日明细
const dashToday = await call('/stats/dashboard/detail?type=today');
ok('10.3 仪表盘明细(日)', dashToday);

// 10.4 资产明细
const dashAssets = await call('/stats/dashboard/detail?type=assets');
ok('10.4 仪表盘明细(资产)', dashAssets);

// ================================================================
log('模块十一：账本与报表 (Ledger & Reports)');

// 11.1 复式账本
const ledger = await call('/ledger');
ok('11.1 复式账本', ledger);

// 11.2 月度报表
const reportM = await call('/reports?type=monthly&period=2026-07');
ok('11.2 月度报表', reportM);

// 11.3 季度报表
const reportQ = await call('/reports?type=quarterly&period=2026-Q3');
ok('11.3 季度报表', reportQ);

// 11.4 年度报表
const reportY = await call('/reports?type=annual&period=2026');
ok('11.4 年度报表', reportY);

// ================================================================
log('模块十二：账本 xlsx 备份 (Backup)');

// 12.1 备份导出（返回 xlsx 二进制）
const bakRes = await fetch(`${API}/backup/export`, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
ok('12.1 备份导出', { ok: bakRes.ok, success: bakRes.ok, msg: '' });

// 12.2 备份为 xlsx 文件（spreadsheetml 内容类型）
const bakCt = bakRes.headers.get('content-type') || '';
ok('12.2 备份为 xlsx 文件', { ok: bakCt.includes('spreadsheetml'), success: bakCt.includes('spreadsheetml'), msg: bakCt });

// 12.3 导出文件可解析为 3 工作表（账本配置页 / 账户页 / 账单流水页）
let bakParsed = false, bakMsg = '';
try {
    const bakBuf = Buffer.from(await bakRes.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bakBuf);
    const sheets = wb.worksheets.map(w => w.name);
    bakParsed = sheets.includes('账本配置页') && sheets.includes('账户页') && sheets.includes('账单流水页');
    bakMsg = sheets.join(',');
} catch (e) { bakMsg = e.message; }
ok('12.3 备份含 3 工作表', { ok: bakParsed, success: bakParsed, msg: bakMsg });

// 12.4 备份导入（无文件）拒绝
const bakNoFile = await call('/backup/import', 'POST', {});
ok('12.4 备份导入无文件拒绝', bakNoFile, false);

// ================================================================
log('模块十三：AI 服务商 (AI Providers)');

// 13.1 获取服务商
const aiList = await call('/ai/providers');
ok('13.1 AI 服务商列表', aiList);

// 13.2 创建服务商
const aiCreate = await call('/ai/providers', 'POST', {
    name: '测试AI_' + Date.now(), api_type: 'openai',
    base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    api_key: 'sk-test-key-12345', is_active: false
});
const aiId = aiCreate.data?.id;
ok('13.2 创建服务商', aiCreate);

// 13.3 更新服务商
if (aiId) {
    const aiUpdate = await call('/ai/providers/' + aiId, 'PUT', {
        name: '测试AI_已更新', api_type: 'openai',
        base_url: 'https://api.openai.com/v1', model: 'gpt-4o',
        is_active: false
    });
    ok('13.3 更新服务商', aiUpdate);
}

// 13.4 激活服务商
if (aiId) {
    const aiActivate = await call('/ai/providers/' + aiId + '/activate', 'POST');
    ok('13.4 激活服务商', aiActivate);
}

// 13.5 测试连接（预期失败，因为是假 key）
if (aiId) {
    const aiTest = await call('/ai/providers/' + aiId + '/test', 'POST');
    // 测试连接可能成功也可能失败，只要不 500 就行
    console.info('  ℹ️  13.5 测试连接 — status=' + aiTest.status + ' msg=' + (aiTest.msg || '').slice(0, 50));
}

// 13.6 删除服务商
if (aiId) {
    const aiDelete = await call('/ai/providers/' + aiId, 'DELETE');
    ok('13.6 删除服务商', aiDelete);
}

// ================================================================
log('模块十四：OCR 配置 (OCR Config)');

// 14.1 获取配置
const ocrGet = await call('/ai/ocr-config');
ok('14.1 OCR 配置查询', ocrGet);

// 14.2 保存配置（脱敏值不更新 secret）
const ocrSave = await call('/ai/ocr-config', 'POST', {
    secret_id: 'AKIDWI...I2Z0',  // 脱敏值，应被忽略
    region: 'ap-shanghai'
});
ok('14.2 OCR 配置保存(脱敏)', ocrSave);

// ================================================================
// 结果汇总
console.info(`\n${'='.repeat(50)}`);
console.info(`🔬 全功能验证结果: ${p} 通过, ${f} 失败`);
if (errors.length > 0) {
    console.info(`\n失败项:`);
    errors.forEach(e => console.info(`  ❌ ${e}`));
}
console.info(`${'='.repeat(50)}`);
process.exit(f > 0 ? 1 : 0);

})().catch(e => { console.error('验证异常:', e.message); process.exit(1); });
