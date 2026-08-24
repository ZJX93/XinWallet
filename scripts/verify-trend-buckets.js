#!/usr/bin/env node
/**
 * 趋势时间桶聚合验收。
 *
 * 背景：服务端 /reports 的 dailyTrend 恒按天补齐（reports.js:355 的 while 逐日 push），
 * 按年请求回来 365 条、自定义 3 个月回来约 90 条。两端原来都是 1:1 映射成折线点，
 * 结果按年时 365 个点挤在 234vp 绘图区里（相邻 0.64vp，而点直径 4vp）→ 糊成一团墨迹，
 * 「每日概况」表格同时变成 365 行。
 *
 * 修法是在客户端加一层桶聚合：跨度 > 62 天按月聚合，否则保持按天。
 * 本脚本验证这层聚合的正确性 —— 重点是**总额守恒**（聚合不能丢钱）。
 *
 * 用法：node scripts/verify-trend-buckets.js
 */

const THRESHOLD = 62;

/** 与 harmony/pages/Reports.ets 的 trendBuckets() / android ReportsScreen.kt 同逻辑 */
function trendBuckets(raw) {
    if (raw.length <= THRESHOLD) return raw;
    const keys = [], inc = [], exp = [];
    for (const x of raw) {
        const ym = (x.date || '').slice(0, 7);
        if (ym.length < 7) continue;
        let at = keys.indexOf(ym);
        if (at < 0) { keys.push(ym); inc.push(0); exp.push(0); at = keys.length - 1; }
        inc[at] += x.income || 0;
        exp[at] += x.expense || 0;
    }
    return keys.map((k, i) => ({ date: k, income: inc[i], expense: exp[i] }));
}

function isMonthBucket(b) {
    return b.length > 0 && (b[0].date || '').length === 7;
}

/** 桶标签：月桶跨年时带年份，否则只写月 */
function bucketLabel(buckets, i) {
    const d = (buckets[i] || {}).date || '';
    if (d.length !== 7) return d;
    const crossYear = buckets[0].date.slice(0, 4) !== buckets[buckets.length - 1].date.slice(0, 4);
    const m = Number(d.slice(5, 7));
    return crossYear ? `${d.slice(0, 4)}年${m}月` : `${m}月`;
}

/** X 轴刻度抽样（鸿蒙 Charts.ets 版：按实测标签宽倒推步长） */
function xTicks(labels, plotW, measure) {
    const n = labels.length;
    if (n === 0) return [];
    if (n === 1) return [0];
    let widest = 0;
    for (const s of labels) { const w = measure(s); if (w > widest) widest = w; }
    const slot = (widest > 0 ? widest : 18) + 2;
    const gapPx = plotW / (n - 1);
    const step = Math.max(1, Math.ceil(slot / gapPx));
    const marks = [];
    for (let i = 0; i < n; i += step) marks.push(i);
    const last = n - 1;
    if (marks[marks.length - 1] !== last) {
        if (last - marks[marks.length - 1] < step / 2) marks.pop();
        marks.push(last);
    }
    return marks;
}

/** 9sp 下的标签宽近似（数字 0.55em / '/' 0.30em / 汉字 1.0em） */
function measure9(s) {
    let u = 0;
    for (const c of s) {
        if (c >= '0' && c <= '9') u += 0.55;
        else if (c === '/') u += 0.30;
        else u += 1.0;
    }
    return u * 9;
}

/** 生成服务端风格的逐日数据 */
function genDays(startY, startM, months, dailyInc, dailyExp) {
    const out = [];
    for (let mi = 0; mi < months; mi++) {
        const t = startY * 12 + (startM - 1) + mi;
        const y = Math.floor(t / 12), m = (t % 12) + 1;
        const dim = new Date(y, m, 0).getDate();
        for (let d = 1; d <= dim; d++) {
            out.push({
                date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                income: dailyInc,
                expense: dailyExp
            });
        }
    }
    return out;
}

let pass = 0, fail = 0;
function ok(cond, desc) {
    if (cond) { pass++; console.log('  \u2705 ' + desc); }
    else { fail++; console.log('  \u274C ' + desc); }
}
function head(t) { console.log('\n' + t); }

head('【按年 2026 全年 → 应聚合为 12 个月桶】');
{
    const raw = genDays(2026, 1, 12, 3, 7);
    const b = trendBuckets(raw);
    ok(raw.length === 365, `原始 365 天（实际 ${raw.length}）`);
    ok(b.length === 12, `聚合为 12 桶（实际 ${b.length}）`);
    ok(b[0].date === '2026-01' && b[11].date === '2026-12', `首末桶 ${b[0].date} ~ ${b[11].date}`);
    ok(isMonthBucket(b), 'isMonthBucket = true');
    // 总额守恒是这层聚合最关键的性质
    const sumInc = b.reduce((a, x) => a + x.income, 0);
    const sumExp = b.reduce((a, x) => a + x.expense, 0);
    ok(sumInc === 365 * 3, `收入总额守恒 ${sumInc} = ${365 * 3}`);
    ok(sumExp === 365 * 7, `支出总额守恒 ${sumExp} = ${365 * 7}`);
    ok(b[0].expense === 31 * 7, `1月支出 = 31天×7 = ${b[0].expense}`);
    ok(b[1].expense === 28 * 7, `2月支出 = 28天×7 = ${b[1].expense}（2026 非闰年）`);
}

head('【闰年 2028：2 月应为 29 天】');
{
    const b = trendBuckets(genDays(2028, 1, 12, 1, 2));
    ok(b[1].expense === 29 * 2, `2月支出 = 29天×2 = ${b[1].expense}`);
    ok(b.reduce((a, x) => a + x.expense, 0) === 366 * 2, '闰年总额 366 天守恒');
}

head('【按月 2026-08（31 天）→ 不该聚合】');
{
    const b = trendBuckets(genDays(2026, 8, 1, 1, 2));
    ok(b.length === 31, `保持 31 个日桶（实际 ${b.length}）`);
    ok(!isMonthBucket(b), 'isMonthBucket = false');
    ok(b[0].date.length === 10, `日桶 date 保持 10 位：${b[0].date}`);
}

head('【聚合阈值边界（62）】');
{
    const d59 = genDays(2026, 1, 2, 1, 1);       // 31+28
    const d62 = genDays(2026, 7, 2, 1, 1);       // 31+31
    const d92 = genDays(2026, 7, 3, 1, 1);       // 31+31+30
    ok(d59.length === 59 && trendBuckets(d59).length === 59, '59 天 ≤62 → 不聚合');
    ok(d62.length === 62 && trendBuckets(d62).length === 62, '62 天 恰好不聚合（边界含）');
    ok(d92.length === 92 && trendBuckets(d92).length === 3, '92 天 >62 → 聚合为 3 桶');
}

head('【跨年自定义区间 2026-11 ~ 2027-02】');
{
    const b = trendBuckets(genDays(2026, 11, 4, 1, 1));
    ok(b.length === 4, `4 个桶（实际 ${b.length}）`);
    ok(b.map(x => x.date).join(',') === '2026-11,2026-12,2027-01,2027-02',
        `顺序正确：${b.map(x => x.date).join(',')}`);
    // 跨年必须带年份，否则「11月 12月 1月 2月」看不出哪年
    ok(bucketLabel(b, 0) === '2026年11月', `跨年标签带年份：${bucketLabel(b, 0)}`);
    ok(bucketLabel(b, 2) === '2027年1月', `跨年标签带年份：${bucketLabel(b, 2)}`);
}

head('【同年区间不带年份（避免重复顶部导航已有信息）】');
{
    const b = trendBuckets(genDays(2026, 1, 12, 1, 1));
    ok(bucketLabel(b, 7) === '8月', `同年标签不带年份：${bucketLabel(b, 7)}`);
}

head('【结余累计曲线在月桶下仍逐桶累加】');
{
    const b = trendBuckets(genDays(2026, 1, 12, 10, 4));
    const accs = [];
    let acc = 0;
    b.forEach(x => { acc += x.income - x.expense; accs.push(acc); });
    ok(accs.length === 12, `12 个累计点（实际 ${accs.length}）`);
    let mono = true;
    for (let i = 1; i < accs.length; i++) if (accs[i] <= accs[i - 1]) mono = false;
    ok(mono, '收入>支出时累计单调递增');
    ok(Math.abs(accs[11] - (365 * 10 - 365 * 4)) < 1e-9,
        `末值 = 全年收入 − 全年支出 = ${accs[11]}`);
}

head('【稀疏数据：只有零星几天有交易】');
{
    // 服务端已补齐零值，但这里额外验证「大量 0 桶」不会算错
    const raw = genDays(2026, 1, 12, 0, 0);
    raw[10].expense = 500;   // 1月11日
    raw[200].expense = 300;  // 年中某天
    const b = trendBuckets(raw);
    ok(b.length === 12, '仍是 12 桶（零值月不该被丢掉）');
    ok(b.reduce((a, x) => a + x.expense, 0) === 800, `总额 800（实际 ${b.reduce((a, x) => a + x.expense, 0)}）`);
    const nonZero = b.filter(x => x.expense > 0).length;
    ok(nonZero === 2, `只有 2 个月非零（实际 ${nonZero}）`);
}

head('【脏数据容错】');
{
    const raw = genDays(2026, 1, 12, 1, 1);
    raw.push({ date: '', income: 99, expense: 99 });          // 空日期
    raw.push({ date: '2026', income: 88, expense: 88 });      // 只有年
    const b = trendBuckets(raw);
    ok(b.length === 12, `脏行被跳过，仍 12 桶（实际 ${b.length}）`);
    ok(b.reduce((a, x) => a + x.expense, 0) === 365, '脏行金额未混入（365）');
}

head('【X 轴刻度：12 个月桶应全标】');
{
    const b = trendBuckets(genDays(2026, 1, 12, 1, 1));
    const labels = b.map(x => `${Number(x.date.slice(5, 7))}月`);
    const marks = xTicks(labels, 234, measure9);
    ok(marks.length === 12, `12 个月全标（实际 ${marks.length}：${marks.map(i => labels[i]).join(' ')}）`);
    ok(marks[marks.length - 1] === 11, '末尾必标 12月');
}

head('【X 轴刻度：31 个日桶应等距抽样且末尾必标】');
{
    const labels = [];
    for (let d = 1; d <= 31; d++) labels.push(`8/${d}`);
    const marks = xTicks(labels, 234, measure9);
    ok(marks[marks.length - 1] === 30, `末尾必标 8/31（实际 ${labels[marks[marks.length - 1]]}）`);
    // 主体间隔应恒定（末段允许因「必标末尾」而变短）
    const gaps = [];
    for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1]);
    const body = gaps.slice(0, -1);
    ok(new Set(body).size === 1, `主体间隔恒定 = ${body[0]}（${labels.filter((_, i) => marks.includes(i)).join(' ')}）`);
    // 不重叠：相邻标记的像素距离必须 ≥ 标签宽
    const n = labels.length;
    const xAt = i => 44 + (i / (n - 1)) * 234;
    let minGap = Infinity;
    for (let k = 1; k < marks.length; k++) minGap = Math.min(minGap, xAt(marks[k]) - xAt(marks[k - 1]));
    ok(minGap >= measure9('8/15'), `最小间距 ${minGap.toFixed(1)}vp ≥ 标签宽 ${measure9('8/15').toFixed(1)}vp`);
}

head('【X 轴刻度：极端输入】');
{
    ok(xTicks([], 234, measure9).length === 0, '空标签不崩');
    ok(xTicks(['8月'], 234, measure9).join(',') === '0', '单标签只标 1 个');
}

console.log('\n' + (fail === 0
    ? `\u2705 全部通过（${pass} 项）`
    : `\u274C ${fail} 项失败，${pass} 项通过`));
process.exit(fail === 0 ? 0 : 1);
