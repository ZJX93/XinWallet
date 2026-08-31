/**
 * 直接对真实文件 server/routes/reports.js 做行为验证
 *
 * verify-custom-range-server.js 里的实现是**搬运的副本**，副本通过不等于
 * 真实文件通过 —— 两者会漂移。这个脚本从真实文件里把函数抠出来执行，
 * 保证验的是即将部署的那份代码。
 *
 * 做法：reports.js 依赖 express / db 等模块，不能直接 require。
 * 用正则从源码里截出三个纯函数的文本，在隔离作用域里 eval。
 * 这样任何对实现的改动都会立刻反映到验收结果上。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'routes', 'reports.js');
const code = fs.readFileSync(SRC, 'utf8');

/** 从源码截取指定函数的完整文本（按大括号配平） */
function extractFn(src, name) {
  const sig = `function ${name}(`;
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(`源码里找不到 ${name}`);
  let depth = 0;
  let started = false;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`${name} 大括号不配平`);
}

const names = ['lastDayOfMonth', 'normalizeReportType', 'parseReportPeriod', 'prevPeriod'];
const parts = names.map((n) => extractFn(code, n));

// PERIOD_TYPE_ALIAS 是 const 对象，单独截
const aliasAt = code.indexOf('const PERIOD_TYPE_ALIAS');
if (aliasAt < 0) throw new Error('源码里找不到 PERIOD_TYPE_ALIAS');
const aliasEnd = code.indexOf('};', aliasAt) + 2;
const aliasSrc = code.slice(aliasAt, aliasEnd);

const sandbox = {};
const factory = new Function(
  `${aliasSrc}\n${parts.join('\n')}\nreturn { lastDayOfMonth, normalizeReportType, parseReportPeriod, prevPeriod, PERIOD_TYPE_ALIAS };`
);
const impl = factory.call(sandbox);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; logger.info(`  \u2713 ${name}`); }
  else {
    fail++; failures.push(name);
    logger.info(`  \u2717 ${name}${detail ? '  \u2190 ' + detail : ''}`);
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}
function throwsWith(fn) {
  try { fn(); return null; } catch (e) { return e.message; }
}

const P = impl.parseReportPeriod;
const V = impl.prevPeriod;

logger.info(`\n源文件：${SRC}`);
logger.info(`抠出函数：${names.join(', ')} + PERIOD_TYPE_ALIAS\n`);

logger.info('【A】自定义区间正常路径');
{
  const r = P('custom', '2026-01~2026-06');
  eq('半年区间 start', r.start, '2026-01-01');
  eq('半年区间 end', r.end, '2026-06-30');
  eq('半年区间 label', r.label, '2026-01 ~ 2026-06');

  eq('单月区间 end（8 月 31 天）', P('custom', '2026-08~2026-08').end, '2026-08-31');
  eq('单月区间 label 退化', P('custom', '2026-08~2026-08').label, '2026年8月');
  eq('2 月末平年 28', P('custom', '2026-01~2026-02').end, '2026-02-28');
  eq('2 月末闰年 29', P('custom', '2024-01~2024-02').end, '2024-02-29');
  eq('跨年区间 start', P('custom', '2025-11~2026-03').start, '2025-11-01');
  eq('跨年区间 end', P('custom', '2025-11~2026-03').end, '2026-03-31');
  eq('日级区间原样保留', P('custom', '2026-03-05~2026-07-18').start, '2026-03-05');
  eq('两侧空格 trim', P('custom', ' 2026-01 ~ 2026-06 ').start, '2026-01-01');
  eq('整年区间 end', P('custom', '2026-01~2026-12').end, '2026-12-31');
}

logger.info('\n【B】越界输入必须抛错（本轮修复点）');
{
  eq('月份 13/14', throwsWith(() => P('custom', '2026-13~2026-14')), '自定义区间格式错误');
  eq('月份 00', throwsWith(() => P('custom', '2026-00~2026-06')), '自定义区间格式错误');
  eq('终点月份 13', throwsWith(() => P('custom', '2026-01~2026-13')), '自定义区间格式错误');
  eq('日级 2月30号', throwsWith(() => P('custom', '2026-02-01~2026-02-30')), '自定义区间格式错误');
  eq('日级 4月31号', throwsWith(() => P('custom', '2026-04-31~2026-05-01')), '自定义区间格式错误');
  eq('日级 00 号', throwsWith(() => P('custom', '2026-03-00~2026-03-15')), '自定义区间格式错误');
  eq('平年 2-29 被拒', throwsWith(() => P('custom', '2026-02-01~2026-02-29')), '自定义区间格式错误');
  ok('闰年 2-29 放行', P('custom', '2024-02-01~2024-02-29').end === '2024-02-29');
  eq('monthly 13 月', throwsWith(() => P('monthly', '2026-13')), '月份格式错误');
  eq('monthly 00 月', throwsWith(() => P('monthly', '2026-00')), '月份格式错误');
  eq('quarterly Q0', throwsWith(() => P('quarterly', '2026-Q0')), '季度格式错误');
  eq('quarterly Q7', throwsWith(() => P('quarterly', '2026-Q7')), '季度格式错误');
  eq('缺分隔符', throwsWith(() => P('custom', '2026-01')), '自定义区间格式错误');
  eq('起点晚于终点', throwsWith(() => P('custom', '2026-06~2026-01')), '自定义区间格式错误');
}

logger.info('\n【C】合法边界不能被新校验误伤');
{
  ok('Q1 正常', P('quarterly', '2026-Q1').start === '2026-01-01');
  ok('Q4 正常', P('quarterly', '2026-Q4').end === '2026-12-31');
  ok('1 月正常', P('monthly', '2026-01').start === '2026-01-01');
  ok('12 月正常', P('monthly', '2026-12').end === '2026-12-31');
  ok('每月末日都合法', [1,2,3,4,5,6,7,8,9,10,11,12].every((m) => {
    const mm = String(m).padStart(2, '0');
    const last = impl.lastDayOfMonth(2026, m);
    try { P('custom', `2026-${mm}-01~2026-${mm}-${last}`); return true; }
    catch { return false; }
  }));
}

logger.info('\n【D】环比区间等长');
{
  eq('3 个月 → 前 3 个月', V('custom', '2026-01~2026-03').period, '2025-10~2025-12');
  eq('12 个月 → 上一整年', V('custom', '2026-01~2026-12').period, '2025-01~2025-12');
  eq('单月 → 上个月', V('custom', '2026-08~2026-08').period, '2026-07~2026-07');
  eq('跨年 5 个月', V('custom', '2025-11~2026-03').period, '2025-06~2025-10');
  ok('环比区间可被二次解析', P('custom', V('custom', '2026-01~2026-03').period).start === '2025-10-01');
}

logger.info('\n【E】按年/按月与旧版逐字节一致（不能弄坏已有功能）');
{
  eq('annual start', P('annual', '2026').start, '2026-01-01');
  eq('annual end', P('annual', '2026').end, '2026-12-31');
  eq('monthly 2 月 end', P('monthly', '2026-02').end, '2026-02-28');
  eq('别名 yearly', P('yearly', '2026').start, '2026-01-01');
  eq('别名 year', P('year', '2026').start, '2026-01-01');
  eq('别名 month', P('month', '2026-08').start, '2026-08-01');
  eq('别名 quarter', P('quarter', '2026-Q2').start, '2026-04-01');
}

logger.info('\n' + '='.repeat(58));
logger.info(`  通过 ${pass}  失败 ${fail}`);
if (fail > 0) {
  logger.info('\n  失败项：');
  failures.forEach((f) => logger.info(`    - ${f}`));
}
logger.info('='.repeat(58));
logger.info(
  fail === 0
    ? '\n验的是真实文件（非副本）。可以部署。\n'
    : '\n真实文件有问题，不要部署。\n'
);
process.exit(fail === 0 ? 0 : 1);
