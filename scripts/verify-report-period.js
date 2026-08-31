/**
 * 服务端报表周期解析验收脚本。
 *
 * 背景：客户端（安卓 ReportsViewModel:90-94、鸿蒙 Reports.ets:108）一直发
 * `yearly` / `custom`，而服务端 parseReportPeriod 原本只认
 * `monthly` / `quarterly` / `annual` → 「按年查看」「自定义区间」全部 HTTP 400。
 * 客户端对失败做了降级（显示空态），所以表现为「这一年没数据」而不是报错。
 *
 * 本脚本内联一份与 server/routes/reports.js 同步的实现做隔离验证，
 * 改动那边后跑一次这里即可确认三种周期形态全部可解析、非法输入仍被拒。
 *
 * 用法：node scripts/verify-report-period.js
 */
function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); }

const PERIOD_TYPE_ALIAS = {
  yearly: 'annual', annually: 'annual', year: 'annual',
  month: 'monthly', quarter: 'quarterly'
};
function normalizeReportType(type) { return PERIOD_TYPE_ALIAS[type] || type; }

function parseReportPeriod(type, period) {
  type = normalizeReportType(type);
  if (type === 'custom') {
    const parts = String(period).split('~');
    if (parts.length !== 2) throw new Error('自定义区间格式错误');
    const rawStart = parts[0].trim(), rawEnd = parts[1].trim();
    const mStart = rawStart.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    const mEnd = rawEnd.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!mStart || !mEnd) throw new Error('自定义区间格式错误');
    const sy = +mStart[1], sm = +mStart[2], ey = +mEnd[1], em = +mEnd[2];
    const start = mStart[3] ? rawStart : `${sy}-${String(sm).padStart(2, '0')}-01`;
    const end = mEnd[3] ? rawEnd : `${ey}-${String(em).padStart(2, '0')}-${lastDayOfMonth(ey, em)}`;
    if (start > end) throw new Error('自定义区间格式错误');
    const label = start.slice(0, 7) === end.slice(0, 7)
      ? `${sy}年${sm}月`
      : `${start.slice(0, 7)} ~ ${end.slice(0, 7)}`;
    return { start, end, label };
  }
  if (type === 'monthly') {
    const m = period.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error('月份格式错误');
    const y = +m[1], mm = +m[2];
    return {
      start: `${y}-${String(mm).padStart(2, '0')}-01`,
      end: `${y}-${String(mm).padStart(2, '0')}-${lastDayOfMonth(y, mm)}`,
      label: `${y}年${mm}月`
    };
  }
  if (type === 'quarterly') {
    const m = period.match(/^(\d{4})-Q(\d)$/);
    if (!m) throw new Error('季度格式错误');
    const y = +m[1], q = +m[2], sm = (q - 1) * 3 + 1, em = q * 3;
    return {
      start: `${y}-${String(sm).padStart(2, '0')}-01`,
      end: `${y}-${String(em).padStart(2, '0')}-${lastDayOfMonth(y, em)}`,
      label: `${y}年 Q${q}`
    };
  }
  if (type === 'annual') {
    if (!/^\d{4}$/.test(period)) throw new Error('年份格式错误');
    const y = +period;
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}年` };
  }
  throw new Error('不支持的报表类型');
}

function prevPeriod(type, period) {
  type = normalizeReportType(type);
  if (type === 'custom') {
    const parts = String(period).split('~');
    if (parts.length !== 2) return null;
    const s = parts[0].trim().slice(0, 7).split('-').map(Number);
    const e = parts[1].trim().slice(0, 7).split('-').map(Number);
    if (s.length < 2 || e.length < 2) return null;
    const span = (e[0] * 12 + e[1]) - (s[0] * 12 + s[1]) + 1;
    const shift = (y, m, by) => {
      const t = y * 12 + (m - 1) - by;
      return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
    };
    return { type: 'custom', period: `${shift(s[0], s[1], span)}~${shift(e[0], e[1], span)}` };
  }
  if (type === 'monthly') {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return { type: 'monthly', period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
  }
  if (type === 'annual') return { type: 'annual', period: String(+period - 1) };
  return null;
}

/** top-transactions 的周期解析（与路由内联逻辑同步） */
function parseTopTxPeriod(period) {
  if (!period) throw new Error('缺少周期');
  if (/^\d{4}-\d{2}$/.test(period)) {
    const y = +period.slice(0, 4), m = +period.slice(5, 7);
    return { start: `${period}-01`, end: `${period}-${lastDayOfMonth(y, m)}` };
  }
  if (/^\d{4}$/.test(period)) return { start: `${period}-01-01`, end: `${period}-12-31` };
  if (period.indexOf('~') > 0) {
    const r = parseReportPeriod('custom', period);
    return { start: r.start, end: r.end };
  }
  throw new Error('周期格式错误');
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.info('  ✅ ' + msg); } else { fail++; console.info('  ❌ ' + msg); } };

console.info('\n【1】/reports 三种周期形态（客户端实际传参）');
for (const [t, p, expStart, expEnd] of [
  ['monthly', '2026-08', '2026-08-01', '2026-08-31'],
  ['yearly', '2026', '2026-01-01', '2026-12-31'],
  ['custom', '2026-01~2026-03', '2026-01-01', '2026-03-31'],
  ['custom', '2026-08~2026-08', '2026-08-01', '2026-08-31'],
  ['custom', '2026-01-15~2026-03-20', '2026-01-15', '2026-03-20'],
  ['annual', '2026', '2026-01-01', '2026-12-31'],
  ['quarterly', '2026-Q2', '2026-04-01', '2026-06-30'],
]) {
  try {
    const r = parseReportPeriod(t, p);
    ok(r.start === expStart && r.end === expEnd,
      `${t}/${p} → ${r.start}~${r.end}「${r.label}」`);
  } catch (e) { ok(false, `${t}/${p} 抛错「${e.message}」`); }
}

console.info('\n【2】非法输入必须仍被拒绝');
for (const [t, p] of [
  ['custom', '2026-01'], ['custom', '2026-03~2026-01'],
  ['custom', 'abc~def'], ['weekly', '2026-08'],
  ['monthly', '2026'], ['annual', '2026-08'],
]) {
  let rejected = false;
  try { parseReportPeriod(t, p); } catch (e) { rejected = true; }
  ok(rejected, `拒绝 ${t}/${p}`);
}

console.info('\n【3】环比上期必须与本期等长（否则同比失真）');
const monthsBetween = (a, b) => {
  const x = a.slice(0, 7).split('-').map(Number), y = b.slice(0, 7).split('-').map(Number);
  return (y[0] * 12 + y[1]) - (x[0] * 12 + x[1]) + 1;
};
for (const p of ['2026-01~2026-03', '2026-01~2026-12', '2026-11~2027-02']) {
  const cur = parseReportPeriod('custom', p);
  const pv = prevPeriod('custom', p);
  const prv = parseReportPeriod('custom', pv.period);
  const a = monthsBetween(cur.start, cur.end), b = monthsBetween(prv.start, prv.end);
  ok(a === b, `${p}（${a}月）→ 上期 ${pv.period}（${b}月）`);
}

console.info('\n【4】跨年回绕（span > 12 时不能只回绕一次）');
{
  const pv = prevPeriod('custom', '2026-01~2027-06'); // 18 个月
  const r = parseReportPeriod('custom', pv.period);
  ok(pv.period === '2024-07~2025-12', `18 个月区间往前挪 18 月 → ${pv.period}`);
  ok(monthsBetween(r.start, r.end) === 18, `上期仍是 18 个月（实际 ${monthsBetween(r.start, r.end)}）`);
}

console.info('\n【5】top-transactions 三种周期形态');
for (const [p, expStart, expEnd] of [
  ['2026-08', '2026-08-01', '2026-08-31'],
  ['2026', '2026-01-01', '2026-12-31'],
  ['2026-01~2026-03', '2026-01-01', '2026-03-31'],
]) {
  try {
    const r = parseTopTxPeriod(p);
    ok(r.start === expStart && r.end === expEnd, `period=${p} → ${r.start}~${r.end}`);
  } catch (e) { ok(false, `period=${p} 抛错「${e.message}」`); }
}

console.info('\n【6】缓存 key 归一化（yearly 与 annual 必须命中同一条）');
const cacheKey = (t, p) => `1:1:${normalizeReportType(t)}:${p}`;
ok(cacheKey('yearly', '2026') === cacheKey('annual', '2026'),
  `yearly/annual → 同一 key ${cacheKey('yearly', '2026')}`);
ok(cacheKey('monthly', '2026-08') !== cacheKey('annual', '2026-08'),
  '不同粒度仍是不同 key');

console.info(`\n${'='.repeat(52)}`);
console.info(fail === 0 ? `✅ 全部通过（${pass} 项）` : `❌ ${fail} 项失败 / 共 ${pass + fail} 项`);
process.exit(fail === 0 ? 0 : 1);
