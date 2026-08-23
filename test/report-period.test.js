/**
 * 报表周期解析 —— 正式测试（进 npm test / CI 门禁）
 *
 * 为什么单独建这个文件：
 * `test/` 下原本**没有任何**覆盖 parseReportPeriod 的用例，所以
 * 「客户端发 yearly / custom → 服务端 throw('不支持的报表类型') → 400」
 * 这个 bug 在 CI 全绿的情况下活了很久。scripts/verify-*.js 是排查期
 * 写的隔离脚本，不进 npm test，拦不住回归。
 *
 * 实现取自真实文件 server/routes/reports.js（按大括号配平抠函数），
 * 不是搬运副本 —— 副本会和实现漂移，那样测试通过也没有意义。
 * reports.js 依赖 express / db 无法直接 require，故用这个办法。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'server', 'routes', 'reports.js');
const code = fs.readFileSync(SRC, 'utf8');

/** 按大括号配平从源码截出函数全文 */
function extractFn(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `源码里找不到 ${name}`);
  let depth = 0;
  let started = false;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    else if (src[i] === '}') {
      depth--;
      if (started && depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`${name} 大括号不配平`);
}

const aliasAt = code.indexOf('const PERIOD_TYPE_ALIAS');
assert.ok(aliasAt >= 0, '源码里找不到 PERIOD_TYPE_ALIAS');
const aliasSrc = code.slice(aliasAt, code.indexOf('};', aliasAt) + 2);

const fnNames = ['lastDayOfMonth', 'normalizeReportType', 'parseReportPeriod', 'prevPeriod'];
const impl = new Function(
  `${aliasSrc}\n${fnNames.map((n) => extractFn(code, n)).join('\n')}\n` +
  `return { ${fnNames.join(', ')} };`
)();

const P = impl.parseReportPeriod;
const V = impl.prevPeriod;

// ---------------------------------------------------------------- 粒度别名

test('客户端发的 yearly 必须被识别（此前 400 的直接原因）', () => {
  const r = P('yearly', '2026');
  assert.strictEqual(r.start, '2026-01-01');
  assert.strictEqual(r.end, '2026-12-31');
});

test('其余粒度别名', () => {
  assert.strictEqual(P('year', '2026').start, '2026-01-01');
  assert.strictEqual(P('annually', '2026').start, '2026-01-01');
  assert.strictEqual(P('month', '2026-08').start, '2026-08-01');
  assert.strictEqual(P('quarter', '2026-Q2').start, '2026-04-01');
});

test('未知粒度仍要抛错（别名表不能变成放行一切）', () => {
  assert.throws(() => P('weekly', '2026-W01'), /不支持的报表类型/);
  assert.throws(() => P('', '2026'), /不支持的报表类型/);
});

// ---------------------------------------------------------------- 自定义区间

test('自定义区间：月级', () => {
  const r = P('custom', '2026-01~2026-06');
  assert.strictEqual(r.start, '2026-01-01');
  assert.strictEqual(r.end, '2026-06-30');
  assert.strictEqual(r.label, '2026-01 ~ 2026-06');
});

test('自定义区间：单月时 label 退化成「YYYY年M月」', () => {
  const r = P('custom', '2026-08~2026-08');
  assert.strictEqual(r.start, '2026-08-01');
  assert.strictEqual(r.end, '2026-08-31');
  assert.strictEqual(r.label, '2026年8月');
});

test('自定义区间：日级原样保留', () => {
  const r = P('custom', '2026-03-05~2026-07-18');
  assert.strictEqual(r.start, '2026-03-05');
  assert.strictEqual(r.end, '2026-07-18');
});

test('自定义区间：跨年', () => {
  const r = P('custom', '2025-11~2026-03');
  assert.strictEqual(r.start, '2025-11-01');
  assert.strictEqual(r.end, '2026-03-31');
});

test('自定义区间：两侧空格被 trim', () => {
  assert.strictEqual(P('custom', ' 2026-01 ~ 2026-06 ').start, '2026-01-01');
});

test('自定义区间：月末日按真实天数（含闰年）', () => {
  assert.strictEqual(P('custom', '2026-01~2026-02').end, '2026-02-28');
  assert.strictEqual(P('custom', '2024-01~2024-02').end, '2024-02-29');
  assert.strictEqual(P('custom', '2026-03~2026-04').end, '2026-04-30');
});

test('自定义区间：格式非法必须抛', () => {
  assert.throws(() => P('custom', '2026-01'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-01~2026-03~2026-06'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-06~2026-01'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '26-01~26-06'), /自定义区间格式错误/);
  assert.throws(() => P('custom', ''), /自定义区间格式错误/);
});

// ---------------------------------------------------------------- 范围校验
// 正则 \d{2} 只管位数不管范围。不校验的后果不是抛错，而是算出一个
// 「看似合法」的日期串直接进 SQL：
//   '2026-13~2026-14' → start='2026-13-01' end='2026-14-28'
//   （lastDayOfMonth(2026,14) 里 new Date(2026,14,0) 溢出到 2027-02 返回 28）
// 而 start > end 是字符串比较，'2026-13-01' < '2026-14-28' 所以也放行。

test('越界月份必须抛：custom', () => {
  assert.throws(() => P('custom', '2026-13~2026-14'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-00~2026-06'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-01~2026-13'), /自定义区间格式错误/);
});

test('越界日期必须抛：custom 日级', () => {
  assert.throws(() => P('custom', '2026-02-01~2026-02-30'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-04-31~2026-05-01'), /自定义区间格式错误/);
  assert.throws(() => P('custom', '2026-03-00~2026-03-15'), /自定义区间格式错误/);
});

test('闰年边界：2-29 平年拒、闰年放', () => {
  assert.throws(() => P('custom', '2026-02-01~2026-02-29'), /自定义区间格式错误/);
  assert.strictEqual(P('custom', '2024-02-01~2024-02-29').end, '2024-02-29');
});

test('越界月份必须抛：monthly', () => {
  assert.throws(() => P('monthly', '2026-13'), /月份格式错误/);
  assert.throws(() => P('monthly', '2026-00'), /月份格式错误/);
});

test('越界季度必须抛：quarterly（Q0 会拼出 2026--2-01 畸形串）', () => {
  assert.throws(() => P('quarterly', '2026-Q0'), /季度格式错误/);
  assert.throws(() => P('quarterly', '2026-Q7'), /季度格式错误/);
});

test('合法边界不被新校验误伤', () => {
  assert.strictEqual(P('monthly', '2026-01').start, '2026-01-01');
  assert.strictEqual(P('monthly', '2026-12').end, '2026-12-31');
  assert.strictEqual(P('quarterly', '2026-Q1').start, '2026-01-01');
  assert.strictEqual(P('quarterly', '2026-Q4').end, '2026-12-31');
  // 12 个月的月末日全部合法
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const last = impl.lastDayOfMonth(2026, m);
    assert.doesNotThrow(() => P('custom', `2026-${mm}-01~2026-${mm}-${last}`), `${mm} 月末日被误拒`);
  }
});

// ---------------------------------------------------------------- 环比区间

test('自定义区间的环比往前挪「等长区间」而非减一个月', () => {
  assert.strictEqual(V('custom', '2026-01~2026-03').period, '2025-10~2025-12');
  assert.strictEqual(V('custom', '2026-01~2026-12').period, '2025-01~2025-12');
  assert.strictEqual(V('custom', '2026-08~2026-08').period, '2026-07~2026-07');
  assert.strictEqual(V('custom', '2025-11~2026-03').period, '2025-06~2025-10');
});

test('环比区间必须能被二次解析（buildReport 会再 parse 一次）', () => {
  const prev = V('custom', '2026-01~2026-03');
  const r = P('custom', prev.period);
  assert.strictEqual(r.start, '2025-10-01');
  assert.strictEqual(r.end, '2025-12-31');
});

test('环比跨度与原区间等长（否则比值无意义）', () => {
  const span = (s) => {
    const [a, b] = s.split('~');
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (by * 12 + bm) - (ay * 12 + am) + 1;
  };
  for (const p of ['2026-01~2026-03', '2026-01~2026-12', '2025-11~2026-03', '2026-08~2026-08']) {
    assert.strictEqual(span(V('custom', p).period), span(p), `${p} 环比跨度不等长`);
  }
});

// ---------------------------------------------------------------- 回归

test('按月/按年结果与历史行为一致', () => {
  assert.strictEqual(P('monthly', '2026-02').start, '2026-02-01');
  assert.strictEqual(P('monthly', '2026-02').end, '2026-02-28');
  assert.strictEqual(P('monthly', '2024-02').end, '2024-02-29');
  assert.strictEqual(P('annual', '2026').start, '2026-01-01');
  assert.strictEqual(P('annual', '2026').end, '2026-12-31');
  assert.throws(() => P('annual', '26'), /年份格式错误/);
});

test('客户端两端拼出的自定义区间串能被服务端解析', () => {
  // 鸿蒙 PeriodPickerSheet.ets:395  `${customStart}~${customEnd}`
  // 安卓 ReportsScreen.kt:1211     "$customStart~$customEnd"
  const s = '2026-01' + '~' + '2026-06';
  assert.doesNotThrow(() => P('custom', s));
  // ~ 是 RFC 3986 非保留字符，不会被 URL 编码破坏
  assert.strictEqual(encodeURIComponent(s), s);
});
