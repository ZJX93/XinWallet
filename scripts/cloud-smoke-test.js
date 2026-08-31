/* 云端冒烟测试：demo 登录 + 核心 API 调用 */
const BASE = process.env.BASE_URL || 'http://localhost:18888';

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, raw: text };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  logger.info(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
}

async function main() {
  // 1. 健康检查
  const hz = await call('GET', '/healthz');
  record('healthz', hz.status === 200, `HTTP ${hz.status}`);

  // 2. demo 登录
  const demo = await call('POST', '/api/auth/demo');
  const token = demo.json?.data?.token;
  record('demo 登录', demo.status === 200 && !!token,
    demo.status === 200 ? `拿到 token（${token?.slice(0, 12)}…）` : `HTTP ${demo.status} ${demo.raw.slice(0, 120)}`);
  if (!token) {
    logger.info('\n无法获取 token，终止后续测试');
    process.exit(1);
  }

  // 3. 核心受保护 API
  const endpoints = [
    ['GET', '/api/accounts', '账户列表'],
    ['GET', '/api/transactions', '交易列表'],
    ['GET', '/api/categories', '分类列表'],
    ['GET', '/api/budgets', '预算列表'],
    ['GET', '/api/stats/dashboard', '仪表盘统计'],
    ['GET', '/api/savings-goals', '储蓄目标'],
    ['GET', '/api/debts', '债务列表'],
    ['GET', '/api/investments', '投资持仓'],
    ['GET', '/api/investment-types', '投资类型'],
    ['GET', '/api/tags', '标签列表'],
    ['GET', '/api/reports?type=monthly&period=2026-07', '报表汇总'],
  ];
  for (const [m, p, label] of endpoints) {
    const r = await call(m, p, { token });
    const ok = r.status === 200 && r.json?.success === true;
    const cnt = Array.isArray(r.json?.data) ? `(${r.json.data.length} 条)` : '';
    record(label, ok, ok ? `HTTP 200 ${cnt}` : `HTTP ${r.status} ${r.raw.slice(0, 100)}`);
  }

  // 4. 无 token 访问受保护接口应被拒绝
  const noAuth = await call('GET', '/api/accounts');
  record('未鉴权拦截', noAuth.status === 401, `HTTP ${noAuth.status}`);

  const passed = results.filter(r => r.ok).length;
  logger.info(`\n=== 冒烟测试结果：${passed}/${results.length} 通过 ===`);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch(e => { logger.error('测试脚本异常:', e); process.exit(3); });
