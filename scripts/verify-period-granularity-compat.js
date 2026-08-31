#!/usr/bin/env node
/**
 * 验收：客户端粒度参数在「新旧服务端」上都必须可用。
 *
 * 背景（本轮现场）：
 *   客户端按年发 'yearly'，而线上服务端是旧版 —— parseReportPeriod 只有
 *   monthly / quarterly / annual 三个分支，收到 'yearly' 直接 throw → HTTP 400。
 *   客户端 catch 只打日志、保留旧 data，于是界面顶部是「2026年」、
 *   KPI 按年算月均，趋势图却还是上个月的 31 天 —— 看着像分桶没生效，
 *   实际是请求失败了。
 *
 * 结论：客户端必须发「新旧都认」的值 = 'annual'。
 * 这样功能不依赖服务端部署顺序。
 *
 * 本脚本复刻两个版本的 parseReportPeriod，逐一验证。
 */

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; logger.info(`  ✅ ${name}`); }
    else { fail++; logger.info(`  ❌ ${name}${extra ? '（' + extra + '）' : ''}`); }
}

function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); }

/* ───────── 旧服务端（= 当前 git HEAD，用户线上跑的版本） ───────── */
function parseOld(type, period) {
    if (type === 'monthly') {
        const m = period.match(/^(\d{4})-(\d{2})$/);
        if (!m) throw new Error('月份格式错误');
        const y = +m[1], mo = +m[2];
        return { start: `${y}-${String(mo).padStart(2, '0')}-01`, end: `${y}-${String(mo).padStart(2, '0')}-${lastDayOfMonth(y, mo)}` };
    }
    if (type === 'quarterly') {
        const m = period.match(/^(\d{4})-Q(\d)$/);
        if (!m) throw new Error('季度格式错误');
        const y = +m[1], q = +m[2];
        return { start: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, end: `${y}-${String(q * 3).padStart(2, '0')}-${lastDayOfMonth(y, q * 3)}` };
    }
    if (type === 'annual') {
        if (!/^\d{4}$/.test(period)) throw new Error('年份格式错误');
        return { start: `${period}-01-01`, end: `${period}-12-31` };
    }
    throw new Error('不支持的报表类型');
}

/* ───────── 新服务端（工作区版本，含 PERIOD_TYPE_ALIAS + custom 分支） ───────── */
const ALIAS = { yearly: 'annual', annually: 'annual', year: 'annual', month: 'monthly', quarter: 'quarterly' };
function parseNew(type, period) {
    type = ALIAS[type] || type;
    if (type === 'custom') {
        const parts = String(period).split('~');
        if (parts.length !== 2) throw new Error('自定义区间格式错误');
        const ms = parts[0].trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
        const me = parts[1].trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
        if (!ms || !me) throw new Error('自定义区间格式错误');
        const start = ms[3] ? parts[0].trim() : `${+ms[1]}-${ms[2]}-01`;
        const end = me[3] ? parts[1].trim() : `${+me[1]}-${me[2]}-${lastDayOfMonth(+me[1], +me[2])}`;
        if (start > end) throw new Error('自定义区间格式错误');
        return { start, end };
    }
    return parseOld(type, period);
}

function tryParse(fn, type, period) {
    try { return { ok: true, r: fn(type, period) }; }
    catch (e) { return { ok: false, msg: e.message }; }
}

/* ───────── 客户端当前发送的粒度（两端已统一） ───────── */
function clientGranularity(periodMode) {
    if (periodMode === 'year') return 'annual';
    if (periodMode === 'custom') return 'custom';
    return 'monthly';
}

logger.info('\n【修复前：客户端发 yearly，旧服务端拒绝】');
{
    const r = tryParse(parseOld, 'yearly', '2026');
    ok('旧服务端收到 yearly 会抛错（这就是线上现场）', !r.ok && r.msg === '不支持的报表类型', r.ok ? '竟然通过了' : r.msg);
}

logger.info('\n【修复后：客户端按年发 annual】');
{
    ok("periodMode='year' → 'annual'", clientGranularity('year') === 'annual', clientGranularity('year'));

    const oldR = tryParse(parseOld, clientGranularity('year'), '2026');
    ok('旧服务端接受', oldR.ok, oldR.msg);
    ok('旧服务端区间 = 2026-01-01 ~ 2026-12-31',
        oldR.ok && oldR.r.start === '2026-01-01' && oldR.r.end === '2026-12-31',
        oldR.ok ? `${oldR.r.start}~${oldR.r.end}` : oldR.msg);

    const newR = tryParse(parseNew, clientGranularity('year'), '2026');
    ok('新服务端接受', newR.ok, newR.msg);
    ok('新旧服务端区间完全一致',
        oldR.ok && newR.ok && oldR.r.start === newR.r.start && oldR.r.end === newR.r.end);
}

logger.info('\n【按年区间必须覆盖整 12 个月（趋势图分桶的前提）】');
{
    const r = parseOld('annual', '2026');
    const days = Math.round((new Date(r.end) - new Date(r.start)) / 86400000) + 1;
    ok('2026（平年）= 365 天', days === 365, String(days));

    const months = new Set();
    const cur = new Date(r.start), last = new Date(r.end);
    while (cur <= last) { months.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`); cur.setDate(cur.getDate() + 1); }
    ok('逐日补齐后恰好落在 12 个月桶里', months.size === 12, String(months.size));
    ok('首桶 2026-01 末桶 2026-12',
        [...months][0] === '2026-01' && [...months][11] === '2026-12',
        `${[...months][0]}..${[...months][11]}`);

    const leap = parseOld('annual', '2024');
    const leapDays = Math.round((new Date(leap.end) - new Date(leap.start)) / 86400000) + 1;
    ok('2024（闰年）= 366 天', leapDays === 366, String(leapDays));
}

logger.info('\n【按月不受影响（回归）】');
{
    ok("periodMode='month' → 'monthly'", clientGranularity('month') === 'monthly');
    const r = tryParse(parseOld, 'monthly', '2026-08');
    ok('旧服务端接受 monthly', r.ok, r.msg);
    ok('2026-08 = 31 天',
        r.ok && r.r.end === '2026-08-31',
        r.ok ? r.r.end : r.msg);
    const feb = parseOld('monthly', '2026-02');
    ok('2026-02 = 28 天（不是 30）', feb.end === '2026-02-28', feb.end);
}

logger.info('\n【自定义区间：旧服务端确实不支持 → 必须给出明确文案】');
{
    ok("periodMode='custom' → 'custom'", clientGranularity('custom') === 'custom');
    const oldR = tryParse(parseOld, 'custom', '2026-01~2026-06');
    ok('旧服务端拒绝 custom（所以要提示升级服务端而不是「暂无数据」）',
        !oldR.ok, oldR.ok ? '意外通过' : oldR.msg);
    const newR = tryParse(parseNew, 'custom', '2026-01~2026-06');
    ok('新服务端接受 custom', newR.ok, newR.msg);
    ok('半年区间 = 2026-01-01 ~ 2026-06-30',
        newR.ok && newR.r.start === '2026-01-01' && newR.r.end === '2026-06-30',
        newR.ok ? `${newR.r.start}~${newR.r.end}` : newR.msg);

    // 半年 = 181 天 > 62，所以同样会走月桶（6 个）
    if (newR.ok) {
        const days = Math.round((new Date(newR.r.end) - new Date(newR.r.start)) / 86400000) + 1;
        ok('半年 181 天 > 62 → 触发月桶聚合', days === 181 && days > 62, String(days));
    }
}

logger.info('\n【新服务端仍兼容 yearly（向前兼容，老客户端不被打断）】');
{
    const r = tryParse(parseNew, 'yearly', '2026');
    ok('新服务端接受 yearly', r.ok, r.msg);
    const a = tryParse(parseNew, 'annual', '2026');
    ok('yearly 与 annual 等价',
        r.ok && a.ok && r.r.start === a.r.start && r.r.end === a.r.end);
}

logger.info('\n【失败时不得保留旧数据（状态机语义）】');
{
    // 复刻修复后的 load()：失败 → data = null + error 非空
    function load(prevData, requestOk) {
        if (requestOk) return { data: { tag: 'new' }, error: '' };
        return { data: null, error: '数据加载失败' };
    }
    const after = load({ tag: 'august-31-days' }, false);
    ok('请求失败后 data 被清空（不会出现「年壳子 + 月数据」）', after.data === null);
    ok('请求失败后 error 非空（能渲染错误态而不是空态）', after.error.length > 0);
    const okCase = load({ tag: 'august' }, true);
    ok('请求成功后 error 复位', okCase.error === '' && okCase.data !== null);
}

logger.info(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败项'}（${pass} 项通过，${fail} 项失败）\n`);
process.exit(fail === 0 ? 0 : 1);
