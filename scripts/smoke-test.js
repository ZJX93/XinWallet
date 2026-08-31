#!/usr/bin/env node
const BASE = process.env.TEST_URL || 'http://localhost:18888';
const API = `${BASE}/api`;

async function call(path, method = 'GET', body = null, token = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API}${path}`, opts);
    const json = await res.json();
    return { ok: res.ok && json.success, data: json.data, msg: json.message };
}

let p = 0, f = 0;
function test(name, ok, detail) {
    if (ok) { p++; console.info(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
    else { f++; console.info(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
    console.info('🧪 XinWallet API 冒烟测试\n');

    // Auth
    console.info('📋 认证');
    const login = await call('/auth/demo', 'POST');
    test('演示登录', login.ok, login.msg);
    const token = login.data?.token;
    if (!token) { console.info('\n❌ 无 token'); process.exit(1); }

    // Accounts
    console.info('\n📋 账户');
    const acc = await call('/accounts', 'GET', null, token);
    test('账户列表', acc.ok, acc.data?.accounts?.length + ' 个');
    const recon = await call('/accounts/reconcile', 'POST', null, token);
    test('账户对账', recon.ok, recon.msg);

    // Transactions
    console.info('\n📋 交易');
    test('交易列表', (await call('/transactions?limit=5', 'GET', null, token)).ok);
    test('交易月份', (await call('/transactions/months', 'GET', null, token)).ok);
    test('交易汇总', (await call('/transactions/summary?month=2026-07', 'GET', null, token)).ok);

    // Categories
    console.info('\n📋 分类');
    test('分类列表', (await call('/categories?flat=1', 'GET', null, token)).ok);

    // Budgets
    console.info('\n📋 预算');
    test('预算列表', (await call('/budgets', 'GET', null, token)).ok);

    // Tags
    console.info('\n📋 标签');
    test('标签列表', (await call('/tags', 'GET', null, token)).ok);

    // Transfers
    console.info('\n📋 转账');
    test('转账列表', (await call('/transfers', 'GET', null, token)).ok);

    // Investments
    console.info('\n📋 理财');
    test('理财持仓', (await call('/investments', 'GET', null, token)).ok);
    test('理财类型', (await call('/investment-types', 'GET', null, token)).ok);
    test('理财趋势', (await call('/stats/investments', 'GET', null, token)).ok);

    // Stats
    console.info('\n📋 统计');
    const dash = await call('/stats/dashboard', 'GET', null, token);
    test('仪表盘', dash.ok, dash.data?.currentMonth);
    test('仪表盘明细', (await call('/stats/dashboard/detail?type=today', 'GET', null, token)).ok);

    // Ledger & Reports
    console.info('\n📋 账本报表');
    test('复式账本', (await call('/transactions/ledger', 'GET', null, token)).ok);
    test('月度报表', (await call('/reports?type=monthly&period=2026-07', 'GET', null, token)).ok);

    // Savings
    console.info('\n📋 储蓄');
    test('储蓄目标', (await call('/savings-goals', 'GET', null, token)).ok);

    // AI
    console.info('\n📋 AI');
    test('AI 服务商', (await call('/ai/providers', 'GET', null, token)).ok);
    test('OCR 配置', (await call('/ai/ocr-config', 'GET', null, token)).ok);

    // 备份
    console.info('\n📋 备份');
    const bakExp = await fetch(`${API}/backup/export`, { headers: { 'Authorization': `Bearer ${token}` } });
    test('备份导出', bakExp.ok, bakExp.headers.get('content-type'));

    console.info(`\n${'='.repeat(40)}`);
    console.info(`结果: ${p} 通过, ${f} 失败`);
    console.info(`${'='.repeat(40)}`);
    process.exit(f > 0 ? 1 : 0);
})();
