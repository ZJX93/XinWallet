/* ============================================
   鑫钱包 · PostgreSQL 跨方言端到端回归测试
   真实 HTTP 调用各模块核心接口，验证 PG 下无 500 崩溃
   （核心诉求：PG 问题“用到才暴露”，必须真实跑接口才能发现）。
   依赖运行中的服务：docker compose up -d → http://127.0.0.1:18888
   服务不可用时本套件自动 skip（可用 node --test 在纯单元环境无副作用运行）。
   运行：node --test test/pg-cross-dialect.e2e.test.js
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../server/db');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:18888/api';
let serverUp = false;

// ==========================================
// HTTP 封装
// ==========================================
async function call(method, path, opt = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opt.token) headers['Authorization'] = 'Bearer ' + opt.token;
  if (opt.bookId) headers['X-Book-Id'] = String(opt.bookId);
  const body = opt.json !== undefined ? JSON.stringify(opt.json) : undefined;
  const res = await fetch(BASE + path, { method, headers, body });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, json, data: json && json.data !== undefined ? json.data : null };
}

// ==========================================
// 测试用户隔离 + 清理
// ==========================================
async function register() {
  const uname = 'e2e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const r = await call('POST', '/auth/register', { json: { username: uname, password: 'Test1234', nickname: 'e2e' } });
  if (!r.json || !r.json.success) throw new Error('注册失败 ' + JSON.stringify(r));
  return { token: r.json.data.token, username: uname };
}
async function setupBook(token) {
  const b = await call('POST', '/books', { token, json: { name: 'e2e账本' } });
  return b.data.id;
}
async function makeAccount(token, bookId, name, opening = 10000) {
  const a = await call('POST', '/accounts', { token, bookId, json: { name, type: 'bank_card', opening_balance: opening } });
  return a.data.id;
}
async function cleanupTestUser(username) {
  const u = await db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (!u) return;
  const id = u.id;
  const tables = [
    'transactions', 'transfers', 'debt_repayments', 'debts',
    'investment_transactions', 'investments', 'savings_goals',
    'budgets', 'tags', 'categories', 'accounts',
    'ai_settings', 'ai_ocr_config', 'ai_providers', 'books'
  ];
  for (const tbl of tables) {
    try { await db.query(`DELETE FROM ${tbl} WHERE user_id = ?`, [id]); } catch (_) { /* 列可能无 user_id，忽略 */ }
  }
  await db.query('DELETE FROM users WHERE id = ?', [id]);
}

// 跳过包装：服务不可用时 skip 而非失败
function e2e(name, fn) {
  return test(name, async (t) => {
    if (!serverUp) { t.skip('服务不可用，跳过（docker compose up -d 后重试）'); return; }
    const u = await register();
    try { await fn(u, t); }
    finally { await cleanupTestUser(u.username); }
  });
}

// PG 兼容断言：HTTP < 500（任何 500 都是方言不兼容导致的中断）
function ok500(t, label, r) {
  assert.ok(r.status < 500, `${label} 应不返回 500，实得 ${r.status} ${JSON.stringify(r.json || r.text)}`);
}

// ==========================================
// 套件前置：探测服务可达性
// ==========================================
test.before(async () => {
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 3000);
    const r = await fetch(BASE + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: c.signal
    });
    clearTimeout(timer);
    serverUp = r.status < 600; // 能连通（即使 400/422）即视为服务在跑
  } catch { serverUp = false; }
});
test.after(async () => { try { await db.pool.end(); } catch (_) {} });

// ==========================================
// 各模块用例
// ==========================================
e2e('储蓄全流程', async (u, t) => {
  const bookId = await setupBook(u.token);
  const A = await makeAccount(u.token, bookId, '储蓄账户');
  const B = await makeAccount(u.token, bookId, '来源账户');
  const c1 = await call('POST', '/savings-goals', { token: u.token, bookId, json: { name: '买房', target_amount: 1000, account_id: A, source_account_id: B } });
  ok500(t, '储蓄-创建', c1); assert.ok(c1.data && c1.data.id, '应返回 id');
  const sid = c1.data.id;
  ok500(t, '储蓄-列表', await call('GET', '/savings-goals', { token: u.token, bookId }));
  ok500(t, '储蓄-存入', await call('POST', `/savings-goals/${sid}/allocate`, { token: u.token, bookId, json: { amount: 100, account_id: B } }));
  ok500(t, '储蓄-取回', await call('POST', `/savings-goals/${sid}/withdraw`, { token: u.token, bookId, json: { amount: 50, account_id: A } }));
  ok500(t, '储蓄-流水', await call('GET', `/savings-goals/${sid}/transactions`, { token: u.token, bookId }));
});

e2e('转账', async (u, t) => {
  const bookId = await setupBook(u.token);
  const A = await makeAccount(u.token, bookId, 'A');
  const B = await makeAccount(u.token, bookId, 'B');
  ok500(t, '转账-创建', await call('POST', '/transfers', { token: u.token, bookId, json: { from_account_id: A, to_account_id: B, amount: 30 } }));
  ok500(t, '转账-列表', await call('GET', '/transfers', { token: u.token, bookId }));
});

e2e('投资全流程', async (u, t) => {
  const bookId = await setupBook(u.token);
  const A = await makeAccount(u.token, bookId, '证券');
  const types = (await call('GET', '/investments', { token: u.token, bookId })).data || [];
  let tid = types[0] && types[0].id;
  if (!tid) { const ct = await call('POST', '/investments', { token: u.token, json: { name: '自定义', risk_level: 'medium', category: 'fund' } }); tid = ct.data && ct.data.id; }
  const inv = await call('POST', '/investments/investments', { token: u.token, bookId, json: { account_id: A, investment_type_id: tid, name: '基金', buy_price: 1, current_price: 1, quantity: 10, total_cost: 10, current_value: 10, buy_date: '2026-09-01' } });
  ok500(t, '投资-建仓', inv); assert.ok(inv.data && inv.data.id);
  const iid = inv.data.id;
  ok500(t, '投资-持仓列表', await call('GET', '/investments/investments', { token: u.token, bookId }));
  ok500(t, '投资-记流水', await call('POST', `/investments/${iid}/transactions`, { token: u.token, bookId, json: { type: 'dividend', amount: 1, price: 0.1, quantity: 1, date: '2026-09-02', fee: 0 } }));
  ok500(t, '投资-卖出', await call('PUT', `/investments/${iid}/sell`, { token: u.token, bookId, json: { sell_price: 2, date: '2026-09-03' } }));
});

e2e('报表', async (u, t) => {
  const bookId = await setupBook(u.token);
  ok500(t, '报表-monthly', await call('GET', '/reports?type=monthly&period=2026-09', { token: u.token, bookId }));
  ok500(t, '报表-top', await call('GET', '/reports/top-transactions?period=2026-09', { token: u.token, bookId }));
});

e2e('统计', async (u, t) => {
  const bookId = await setupBook(u.token);
  ok500(t, '统计-dashboard', await call('GET', '/stats/dashboard', { token: u.token, bookId }));
  ok500(t, '统计-dashboard/detail', await call('GET', '/stats/dashboard/detail', { token: u.token, bookId }));
  ok500(t, '统计-investments', await call('GET', '/stats/investments', { token: u.token, bookId }));
  ok500(t, '统计-calendar', await call('GET', '/stats/calendar?month=2026-09', { token: u.token, bookId }));
});

e2e('交易辅助', async (u, t) => {
  const bookId = await setupBook(u.token);
  ok500(t, '交易-months', await call('GET', '/transactions/months', { token: u.token, bookId }));
  ok500(t, '交易-summary', await call('GET', '/transactions/summary?month=2026-09', { token: u.token, bookId }));
  ok500(t, '交易-ledger', await call('GET', '/transactions/ledger?month=2026-09', { token: u.token, bookId }));
  ok500(t, '交易-列表', await call('GET', '/transactions', { token: u.token, bookId }));
});

e2e('债务(贷款)全流程', async (u, t) => {
  const bookId = await setupBook(u.token);
  const A = await makeAccount(u.token, bookId, '贷款账户');
  const d = await call('POST', '/debts', { token: u.token, bookId, json: { name: '房贷', principal: 100000, direction: 'payable', account_id: A, interest_rate: 4.9, term_months: 360 } });
  ok500(t, '债务-创建', d); assert.ok(d.data && d.data.id, '应返回 id');
  const did = d.data.id;
  ok500(t, '债务-列表', await call('GET', '/debts', { token: u.token, bookId }));
  ok500(t, '债务-还款', await call('POST', `/debts/${did}/repayments`, { token: u.token, bookId, json: { amount: 1000, paid_at: '2026-09-01', account_id: A } }));
  ok500(t, '债务-详情', await call('GET', `/debts/${did}`, { token: u.token, bookId }));
  ok500(t, '债务-删除', await call('DELETE', `/debts/${did}`, { token: u.token, bookId }));
});

e2e('AI 配置 (PG 兼容关键路径)', async (u, t) => {
  const bookId = await setupBook(u.token);
  // ai_providers.is_active 为 boolean 列，代码写 is_active?1:0（整数），验证 PG 下不崩
  const p = await call('POST', '/ai/providers', { token: u.token, bookId, json: { name: 'test', api_type: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'sk-x', model: 'gpt-4o', is_active: true, sort_order: 0 } });
  ok500(t, 'AI-provider-创建', p); assert.ok(p.data && p.data.id);
  if (p.data && p.data.id) ok500(t, 'AI-provider-删除', await call('DELETE', `/ai/providers/${p.data.id}`, { token: u.token, bookId }));
  // ai_ocr_config（backup 导入崩溃修复点：secret_id NOT NULL）
  const o = await call('POST', '/ai/ocr-config', { token: u.token, bookId, json: { secret_id: 'AKIDx', secret_key: 'secret', region: 'ap-guangzhou' } });
  ok500(t, 'AI-ocr-config', o);
  // ai_settings（jsonb 列）
  const s = await call('PUT', '/ai/settings', { token: u.token, bookId, json: { autoCategorize: true } });
  ok500(t, 'AI-settings', s);
});
