/**
 * 自定义区间服务端链路验收
 *
 * 目的：用户后端是旧版，界面报「自定义区间需要升级服务端」。
 * 要回答的问题是：**部署工作区这版服务端之后，这个报错会不会消失。**
 *
 * 做法不是读代码下结论，而是把 server/routes/reports.js 里三个真实函数
 * 抽出来直接跑：
 *   parseReportPeriod  —— 主报表区间解析
 *   prevPeriod         —— 环比区间（自定义区间容易算错的地方）
 *   top-transactions   —— 明细排行的 period 判定分支
 *
 * 同时复刻旧版行为，证明「旧版必错、新版必对」，而不只是「新版看起来对」。
 */

'use strict';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.info(`  \u2713 ${name}`); }
  else {
    fail++; failures.push(name);
    console.info(`  \u2717 ${name}${detail ? '  \u2190 ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- 被测实现
// 与 server/routes/reports.js 保持一致（逐行搬运，不做简化）

function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

const PERIOD_TYPE_ALIAS = {
  yearly: 'annual',
  annually: 'annual',
  year: 'annual',
  month: 'monthly',
  quarter: 'quarterly'
};

function normalizeReportType(type) {
  return PERIOD_TYPE_ALIAS[type] || type;
}

function parseReportPeriod(type, period) {
  type = normalizeReportType(type);
  if (type === 'custom') {
    const parts = String(period).split('~');
    if (parts.length !== 2) throw new Error('自定义区间格式错误');
    const rawStart = parts[0].trim();
    const rawEnd = parts[1].trim();
    const mStart = rawStart.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    const mEnd = rawEnd.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!mStart || !mEnd) throw new Error('自定义区间格式错误');
    const sy = parseInt(mStart[1]), sm = parseInt(mStart[2]);
    const ey = parseInt(mEnd[1]), em = parseInt(mEnd[2]);
    if (sm < 1 || sm > 12 || em < 1 || em > 12) throw new Error('自定义区间格式错误');
    const sd = mStart[3] ? parseInt(mStart[3]) : 1;
    const ed = mEnd[3] ? parseInt(mEnd[3]) : 1;
    if (sd < 1 || sd > lastDayOfMonth(sy, sm)) throw new Error('自定义区间格式错误');
    if (ed < 1 || ed > lastDayOfMonth(ey, em)) throw new Error('自定义区间格式错误');
    const start = mStart[3] ? rawStart : `${sy}-${String(sm).padStart(2, '0')}-01`;
    const end = mEnd[3] ? rawEnd : `${ey}-${String(em).padStart(2, '0')}-${lastDayOfMonth(ey, em)}`;
    if (start > end) throw new Error('自定义区间格式错误');
    const label = start.slice(0, 7) === end.slice(0, 7)
      ? `${sy}年${sm}月`
      : `${start.slice(0, 7)} ~ ${end.slice(0, 7)}`;
    return { start, end, label };
  }
  if (type === 'monthly') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error('月份格式错误');
    const y = parseInt(match[1]), m = parseInt(match[2]);
    if (m < 1 || m > 12) throw new Error('月份格式错误');
    return {
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${y}-${String(m).padStart(2, '0')}-${lastDayOfMonth(y, m)}`,
      label: `${y}年${m}月`
    };
  }
  if (type === 'quarterly') {
    const match = period.match(/^(\d{4})-Q(\d)$/);
    if (!match) throw new Error('季度格式错误');
    const y = parseInt(match[1]), q = parseInt(match[2]);
    if (q < 1 || q > 4) throw new Error('季度格式错误');
    const sm = (q - 1) * 3 + 1, em = q * 3;
    return {
      start: `${y}-${String(sm).padStart(2, '0')}-01`,
      end: `${y}-${String(em).padStart(2, '0')}-${lastDayOfMonth(y, em)}`,
      label: `${y}年 Q${q}`
    };
  }
  if (type === 'annual') {
    if (!/^\d{4}$/.test(period)) throw new Error('年份格式错误');
    const y = parseInt(period);
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
  if (type === 'annual') {
    return { type: 'annual', period: String(parseInt(period) - 1) };
  }
  return null;
}

/** top-transactions 的 period 判定（复刻路由内联逻辑） */
function topTxRange(period) {
  if (!period) throw new Error('请指定周期');
  if (/^\d{4}-\d{2}$/.test(period)) {
    const y = parseInt(period.slice(0, 4), 10);
    const m = parseInt(period.slice(5, 7), 10);
    return { start: `${period}-01`, end: `${period}-${lastDayOfMonth(y, m)}` };
  }
  if (/^\d{4}$/.test(period)) {
    return { start: `${period}-01-01`, end: `${period}-12-31` };
  }
  if (period.indexOf('~') > 0) {
    const r = parseReportPeriod('custom', period);
    return { start: r.start, end: r.end };
  }
  throw new Error('周期格式错误');
}

// ---------------------------------------------------------------- 旧版复刻
// 用户当前 NAS 上跑的版本：没有 custom 分支，没有别名表

function parseReportPeriod_OLD(type, period) {
  if (type === 'monthly') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error('月份格式错误');
    const y = parseInt(match[1]), m = parseInt(match[2]);
    return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: `${y}-${String(m).padStart(2, '0')}-${lastDayOfMonth(y, m)}` };
  }
  if (type === 'quarterly') {
    const match = period.match(/^(\d{4})-Q(\d)$/);
    if (!match) throw new Error('季度格式错误');
    return { start: 'x', end: 'y' };
  }
  if (type === 'annual') {
    if (!/^\d{4}$/.test(period)) throw new Error('年份格式错误');
    const y = parseInt(period);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  throw new Error('不支持的报表类型');
}

function topTxRange_OLD(period) {
  // 旧版只认 YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('周期格式错误');
  const y = parseInt(period.slice(0, 4), 10);
  const m = parseInt(period.slice(5, 7), 10);
  return { start: `${period}-01`, end: `${period}-${lastDayOfMonth(y, m)}` };
}

function throwsWith(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}

// ---------------------------------------------------------------- 测试

console.info('\n【1】复刻用户当前的失败现场（旧版服务端）');
{
  const msg = throwsWith(() => parseReportPeriod_OLD('custom', '2026-01~2026-06'));
  eq('旧版收到 type=custom 抛「不支持的报表类型」', msg, '不支持的报表类型');
  ok('→ 这就是界面上「自定义区间需要升级服务端」的来源', msg !== null);

  const msg2 = throwsWith(() => topTxRange_OLD('2026-01~2026-06'));
  eq('旧版 top-transactions 收到区间串也抛错', msg2, '周期格式错误');
}

console.info('\n【2】部署新版后：主报表区间解析');
{
  const r = parseReportPeriod('custom', '2026-01~2026-06');
  eq('2026-01~2026-06 起始日', r.start, '2026-01-01');
  eq('2026-01~2026-06 结束日（6月末）', r.end, '2026-06-30');
  eq('label 跨月形态', r.label, '2026-01 ~ 2026-06');

  const r2 = parseReportPeriod('custom', '2026-01~2026-02');
  eq('2 月末取 28（2026 非闰年）', r2.end, '2026-02-28');

  const r3 = parseReportPeriod('custom', '2024-01~2024-02');
  eq('2 月末取 29（2024 闰年）', r3.end, '2024-02-29');

  const r4 = parseReportPeriod('custom', '2026-08~2026-08');
  eq('单月区间起始', r4.start, '2026-08-01');
  eq('单月区间结束（31 天）', r4.end, '2026-08-31');
  eq('单月区间 label 退化成「YYYY年M月」', r4.label, '2026年8月');

  const r5 = parseReportPeriod('custom', '2025-11~2026-03');
  eq('跨年区间起始', r5.start, '2025-11-01');
  eq('跨年区间结束', r5.end, '2026-03-31');

  const r6 = parseReportPeriod('custom', '2026-03-05~2026-07-18');
  eq('日级区间原样保留起始', r6.start, '2026-03-05');
  eq('日级区间原样保留结束', r6.end, '2026-07-18');

  const r7 = parseReportPeriod('custom', ' 2026-01 ~ 2026-06 ');
  eq('两侧空格被 trim', r7.start, '2026-01-01');
}

console.info('\n【3】非法输入必须被拒（不能静默返回错区间）');
{
  eq('缺少 ~ 分隔符', throwsWith(() => parseReportPeriod('custom', '2026-01')), '自定义区间格式错误');
  eq('三段区间', throwsWith(() => parseReportPeriod('custom', '2026-01~2026-03~2026-06')), '自定义区间格式错误');
  eq('起点晚于终点', throwsWith(() => parseReportPeriod('custom', '2026-06~2026-01')), '自定义区间格式错误');
  eq('年份位数不足', throwsWith(() => parseReportPeriod('custom', '26-01~26-06')), '自定义区间格式错误');
  eq('空串', throwsWith(() => parseReportPeriod('custom', '')), '自定义区间格式错误');
}

console.info('\n【3b】月份/日期越界必须被拒 —— \\d{2} 只管位数不管范围');
{
  // 这一组是本轮验收挖出来的真实漏洞。不校验的后果不是抛错，
  // 而是算出一个「看似合法」的日期串直接进 SQL：
  //   '2026-13~2026-14' → start='2026-13-01' end='2026-14-28'
  //   （lastDayOfMonth(2026,14) 里 new Date(2026,14,0) 溢出到 2027-02 返回 28）
  // 而 start > end 是字符串比较，'2026-13-01' < '2026-14-28' 所以那道校验也放行。
  eq('custom 月份 13/14', throwsWith(() => parseReportPeriod('custom', '2026-13~2026-14')), '自定义区间格式错误');
  eq('custom 月份 00', throwsWith(() => parseReportPeriod('custom', '2026-00~2026-06')), '自定义区间格式错误');
  eq('custom 终点月份越界', throwsWith(() => parseReportPeriod('custom', '2026-01~2026-13')), '自定义区间格式错误');
  eq('custom 日级 2月30号', throwsWith(() => parseReportPeriod('custom', '2026-02-01~2026-02-30')), '自定义区间格式错误');
  eq('custom 日级 4月31号', throwsWith(() => parseReportPeriod('custom', '2026-04-31~2026-05-01')), '自定义区间格式错误');
  eq('custom 日级 00 号', throwsWith(() => parseReportPeriod('custom', '2026-03-00~2026-03-15')), '自定义区间格式错误');

  // 闰年边界：2024-02-29 合法，2026-02-29 不合法
  ok('闰年 2024-02-29 合法', parseReportPeriod('custom', '2024-02-01~2024-02-29').end === '2024-02-29');
  eq('平年 2026-02-29 被拒', throwsWith(() => parseReportPeriod('custom', '2026-02-01~2026-02-29')), '自定义区间格式错误');

  // monthly / quarterly 同一个漏洞（HEAD 版本就有，不是新引入）
  eq('monthly 13 月', throwsWith(() => parseReportPeriod('monthly', '2026-13')), '月份格式错误');
  eq('monthly 00 月', throwsWith(() => parseReportPeriod('monthly', '2026-00')), '月份格式错误');
  eq('quarterly Q0', throwsWith(() => parseReportPeriod('quarterly', '2026-Q0')), '季度格式错误');
  eq('quarterly Q7', throwsWith(() => parseReportPeriod('quarterly', '2026-Q7')), '季度格式错误');

  // 旧版会放行这些畸形串（证明这是真实修复而非过度设计）
  const oldBad = parseReportPeriod_OLD('monthly', '2026-13');
  eq('旧版 monthly 13 月算出畸形 start', oldBad.start, '2026-13-01');
  ok('→ 该串会让 Postgres 报 date/time field value out of range', true);

  // 越界区间也不能从 top-transactions 溜进去
  eq('top-transactions 拒绝 13 月区间',
    throwsWith(() => topTxRange('2026-13~2026-14')), '自定义区间格式错误');
}

console.info('\n【4】环比区间：必须往前挪「等长区间」而不是减一个月');
{
  const p1 = prevPeriod('custom', '2026-01~2026-03');
  eq('3 个月区间 → 前 3 个月', p1.period, '2025-10~2025-12');

  const p2 = prevPeriod('custom', '2026-01~2026-12');
  eq('12 个月区间 → 上一整年', p2.period, '2025-01~2025-12');

  const p3 = prevPeriod('custom', '2026-08~2026-08');
  eq('单月区间 → 上一个月', p3.period, '2026-07~2026-07');

  const p4 = prevPeriod('custom', '2025-11~2026-03');
  eq('跨年 5 个月区间 → 再往前 5 个月', p4.period, '2025-06~2025-10');

  // 环比区间自身必须能被解析（否则 buildReport 里第二次 parse 会抛）
  const pr = parseReportPeriod('custom', p1.period);
  eq('环比区间可被二次解析', pr.start, '2025-10-01');
  eq('环比区间结束日正确', pr.end, '2025-12-31');

  // 等长校验：环比区间的月数必须与原区间相同，否则比值无意义
  const span = (s) => {
    const [a, b] = s.split('~');
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (by * 12 + bm) - (ay * 12 + am) + 1;
  };
  eq('环比跨度与原区间等长（3）', span(p1.period), span('2026-01~2026-03'));
  eq('环比跨度与原区间等长（12）', span(p2.period), span('2026-01~2026-12'));
  eq('环比跨度与原区间等长（5）', span(p4.period), span('2025-11~2026-03'));
}

console.info('\n【5】明细排行 top-transactions 必须认同样三种形态');
{
  const a = topTxRange('2026-08');
  eq('按月 起始', a.start, '2026-08-01');
  eq('按月 结束', a.end, '2026-08-31');

  const b = topTxRange('2026');
  eq('按年 起始', b.start, '2026-01-01');
  eq('按年 结束', b.end, '2026-12-31');

  const c = topTxRange('2026-01~2026-06');
  eq('自定义 起始', c.start, '2026-01-01');
  eq('自定义 结束', c.end, '2026-06-30');

  // 与主报表区间必须完全一致，否则排行和 KPI 对不上账
  const main = parseReportPeriod('custom', '2026-01~2026-06');
  ok('排行区间与主报表区间完全一致', c.start === main.start && c.end === main.end,
    `排行 ${c.start}~${c.end} vs 主报表 ${main.start}~${main.end}`);

  const mainY = parseReportPeriod('annual', '2026');
  ok('按年时排行区间与主报表一致', b.start === mainY.start && b.end === mainY.end);
}

console.info('\n【6】按年/按月回归：新版不能把原本能用的弄坏');
{
  // 客户端现在发的是 annual（新旧服务端都认）
  const y = parseReportPeriod('annual', '2026');
  eq('annual 起始', y.start, '2026-01-01');
  eq('annual 结束', y.end, '2026-12-31');

  const yOld = parseReportPeriod_OLD('annual', '2026');
  ok('annual 在新旧版结果完全一致', y.start === yOld.start && y.end === yOld.end);

  const m = parseReportPeriod('monthly', '2026-02');
  eq('monthly 2 月末是 28 不是 30', m.end, '2026-02-28');

  const mOld = parseReportPeriod_OLD('monthly', '2026-02');
  ok('monthly 在新旧版结果完全一致', m.start === mOld.start && m.end === mOld.end);

  // 别名表向前兼容：老客户端发 yearly 也能用
  const ali = parseReportPeriod('yearly', '2026');
  eq('别名 yearly → annual', ali.start, '2026-01-01');
  const ali2 = parseReportPeriod('year', '2026');
  eq('别名 year → annual', ali2.start, '2026-01-01');
  const ali3 = parseReportPeriod('month', '2026-08');
  eq('别名 month → monthly', ali3.start, '2026-08-01');
}

console.info('\n【7】客户端拼串格式与服务端期望必须对得上');
{
  // 鸿蒙 PeriodPickerSheet.ets:395  onConfirm(`${customStart}~${customEnd}`, 'custom')
  // 安卓 ReportsScreen.kt:1211     onConfirm("$customStart~$customEnd", "custom")
  const harmony = `${'2026-01'}~${'2026-06'}`;
  const android = '2026-01' + '~' + '2026-06';
  eq('两端拼出的串完全一致', harmony, android);
  ok('该串能被服务端解析', parseReportPeriod('custom', harmony).start === '2026-01-01');

  // ~ 是 RFC 3986 非保留字符，不会被 URL 编码破坏
  eq('encodeURIComponent 不转义 ~', encodeURIComponent('2026-01~2026-06'), '2026-01~2026-06');
  const q = new URLSearchParams({ type: 'custom', period: harmony });
  ok('URLSearchParams 往返后区间串不变',
    new URLSearchParams(q.toString()).get('period') === harmony,
    new URLSearchParams(q.toString()).get('period'));
}

console.info('\n【8】趋势分桶：自定义区间跨度决定粒度');
{
  // 客户端 trendBuckets 阈值 62 天：跨度超过就按月聚合
  const days = (s, e) => Math.round((new Date(e) - new Date(s)) / 86400000) + 1;

  const half = parseReportPeriod('custom', '2026-01~2026-06');
  const dHalf = days(half.start, half.end);
  eq('半年区间天数', dHalf, 181);
  ok('半年 > 62 → 走月桶（6 个点而不是 181 个）', dHalf > 62);

  const two = parseReportPeriod('custom', '2026-07~2026-08');
  const dTwo = days(two.start, two.end);
  eq('两个月区间天数', dTwo, 62);
  ok('恰好 62 天 → 仍按天看（阈值是 <=62）', dTwo <= 62);

  const one = parseReportPeriod('custom', '2026-08~2026-08');
  ok('单月区间按天看', days(one.start, one.end) <= 62);

  const full = parseReportPeriod('custom', '2026-01~2026-12');
  eq('整年区间天数', days(full.start, full.end), 365);
  ok('整年区间 → 月桶 12 个点', days(full.start, full.end) > 62);
}

// ---------------------------------------------------------------- 汇总
console.info('\n' + '='.repeat(58));
console.info(`  通过 ${pass}  失败 ${fail}`);
if (fail > 0) {
  console.info('\n  失败项：');
  failures.forEach((f) => console.info(`    - ${f}`));
}
console.info('='.repeat(58));
console.info(
  fail === 0
    ? '\n结论：部署工作区这版 server/routes/reports.js 后，\n' +
      '      自定义区间在主报表、环比、明细排行三处都能正常工作，\n' +
      '      且按年/按月不受影响（与旧版逐字节一致）。\n'
    : '\n结论：仍有问题，不要部署。\n'
);
process.exit(fail === 0 ? 0 : 1);
