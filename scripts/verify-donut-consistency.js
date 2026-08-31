#!/usr/bin/env node
/**
 * 三端环图一致性校验。
 *
 * 环图在 web / 安卓 / 鸿蒙各有一份独立实现（Chart.js 配置 / Compose Canvas / ArkUI Canvas），
 * 没有共享代码 —— 唯一能保证「看起来是同一个图」的手段就是把关键参数抽出来逐项比对。
 * 手工核对靠不住：改了一端忘了另一端，表现是「安卓的环比鸿蒙粗一点」这种很难被报告的偏差。
 *
 * 校验两组东西：
 *   A. 莫兰迪调色板：三端 10 色必须完全相同（同一笔支出在三端应是同一个颜色）
 *   B. 环图几何参数：cutout / 圆角 / 间隙 / 选中外扩 / 动画时长 必须等价
 *
 * 用法：node scripts/verify-donut-consistency.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = {
  web: path.join(ROOT, 'public/js/managers/chart.js'),
  android: path.join(ROOT, 'android/app/src/main/java/com/xinwallet/app/ui/components/Charts.kt'),
  harmony: path.join(ROOT, 'harmony/entry/src/main/ets/common/components/Charts.ets')
};

const read = (k) => fs.readFileSync(F[k], 'utf8');
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; logger.info(`  ✓ ${name}`); }
  else { fail++; logger.info(`  ✗ ${name}${detail ? '  → ' + detail : ''}`); }
}

/* ─────────── A. 调色板一致性 ─────────── */
logger.info('\n[A] 莫兰迪调色板三端一致');

// web: const lightCats = [ '#B89881','#84B3AC', ... ]
const webBlock = read('web').match(/const lightCats\s*=\s*\[([\s\S]*?)\]/);
const webCats = webBlock ? (webBlock[1].match(/#[0-9A-Fa-f]{6}/g) || []).map((s) => s.toUpperCase()) : [];

// android: private val SLICE_PALETTE = listOf( Color(0xFFB89881), ... )
const andBlock = read('android').match(/private val SLICE_PALETTE = listOf\(([\s\S]*?)\n\)/);
const andCats = andBlock
  ? (andBlock[1].match(/0xFF([0-9A-Fa-f]{6})/g) || []).map((s) => '#' + s.slice(4).toUpperCase())
  : [];

// harmony: export const SLICE_PALETTE: string[] = [ '#B89881', ... ]
const harBlock = read('harmony').match(/export const SLICE_PALETTE:\s*string\[\]\s*=\s*\[([\s\S]*?)\]/);
const harCats = harBlock ? (harBlock[1].match(/#[0-9A-Fa-f]{6}/g) || []).map((s) => s.toUpperCase()) : [];

check('web 调色板已解析（10 色）', webCats.length === 10, `实际 ${webCats.length}`);
check('android 调色板已解析（10 色）', andCats.length === 10, `实际 ${andCats.length}`);
check('harmony 调色板已解析（10 色）', harCats.length === 10, `实际 ${harCats.length}`);
check('android ↔ harmony 完全一致', andCats.join() === harCats.join(),
  andCats.join() === harCats.join() ? '' : `\n      android: ${andCats.join(' ')}\n      harmony: ${harCats.join(' ')}`);
check('web ↔ android 完全一致', webCats.join() === andCats.join(),
  webCats.join() === andCats.join() ? '' : `\n      web:     ${webCats.join(' ')}\n      android: ${andCats.join(' ')}`);

// 莫兰迪特征：全部低饱和。高饱和色混进来会立刻在暖棕卡片上抢戏。
function hsv(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.substr(0, 2), 16) / 255;
  const g = parseInt(n.substr(2, 2), 16) / 255;
  const b = parseInt(n.substr(4, 2), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return { s: mx === 0 ? 0 : ((mx - mn) / mx) * 100, v: mx * 100 };
}
const overSat = andCats.filter((c) => hsv(c).s > 34);
check('全部为低饱和莫兰迪（S ≤ 34%）', overSat.length === 0,
  overSat.map((c) => `${c}(S=${hsv(c).s.toFixed(0)}%)`).join(' '));

/* ─────────── B. 几何参数等价 ─────────── */
logger.info('\n[B] 环图几何参数三端等价');

const web = read('web');
const and = read('android');
const har = read('harmony');

/**
 * 只截取环图相关代码段再匹配 —— 三个文件里都还有别的图表，
 * 全文匹配会误伤：web 的柱状图也有 borderRadius(=8)、安卓的 DonutProgress
 * 本来就该有灰轨道、鸿蒙 TrendChart 的网格线也用 COLORS.divider。
 */
function section(src, startRe, endRe) {
  const s = src.search(startRe);
  if (s < 0) return '';
  const rest = src.slice(s);
  const e = endRe ? rest.search(endRe) : -1;
  return e > 0 ? rest.slice(0, e) : rest;
}
// web：从 type:'doughnut' 到该 Chart 构造结束（plugins: [centerTextPlugin]）。
// 不能只截到 options: —— cutout 写在 options 里面，截早了就匹配不到。
const webDonuts = [...web.matchAll(/type:\s*'doughnut'[\s\S]*?plugins:\s*\[centerTextPlugin\]/g)].map((m) => m[0]);
// 安卓：fun DonutChart 到 ringSegmentPath 定义结束前
const andDonut = section(and, /fun DonutChart\(/, /^\/\/ ──── 环图几何参数/m);
// 鸿蒙：export struct DonutChart 到 TrendChart 之前
const harDonut = section(har, /export struct DonutChart \{/, /export struct TrendChart/);

// web 的 doughnut 配置项（仪表盘 dashPie + 理财 invAllocation，取值应一致）
const pickNums = (arr, re) => arr.map((blk) => {
  const m = blk.match(re);
  return m ? Number(m[1]) : null;
});
const webCutout = pickNums(webDonuts, /cutout:\s*'(\d+)%'/);
const webRadius = pickNums(webDonuts, /borderRadius:\s*(\d+)/);
const webHover = pickNums(webDonuts, /hoverOffset:\s*(\d+)/);

const uniq = (a) => [...new Set(a)];
check(`web 识别到 2 处环图`, webDonuts.length === 2, `实际 ${webDonuts.length}`);
check('web 两处环图 cutout 一致', uniq(webCutout).length === 1, webCutout.join('/'));
check('web 两处环图 borderRadius 一致', uniq(webRadius).length === 1, webRadius.join('/'));
check('web 两处环图 hoverOffset 一致', uniq(webHover).length === 1, webHover.join('/'));

const num = (src, re) => {
  const m = src.match(re);
  return m ? Number(m[1]) : null;
};

const andCutout = num(and, /private const val CUTOUT = ([\d.]+)f/);
const harCutout = num(har, /readonly CUTOUT:\s*number\s*=\s*([\d.]+)/);
const wc = uniq(webCutout)[0] / 100;
check(`cutout 等价（web ${wc} / android ${andCutout} / harmony ${harCutout}）`,
  andCutout === wc && harCutout === wc);

const andCorner = num(and, /private const val CORNER_DP = ([\d.]+)f/);
const harCorner = num(har, /readonly CORNER:\s*number\s*=\s*([\d.]+)/);
const wr = uniq(webRadius)[0];
check(`圆角等价（web ${wr} / android ${andCorner} / harmony ${harCorner}）`,
  andCorner === wr && harCorner === wr);

const andHover = num(and, /private const val HOVER_OFFSET = ([\d.]+)f/);
const harHover = num(har, /readonly HOVER:\s*number\s*=\s*([\d.]+)/);
const wh = uniq(webHover)[0];
check(`选中外扩等价（web ${wh} / android ${andHover} / harmony ${harHover}）`,
  andHover === wh && harHover === wh);

const andGap = num(and, /private const val GAP_DP = ([\d.]+)f/);
const harGap = num(har, /readonly GAP:\s*number\s*=\s*([\d.]+)/);
check(`扇区间隙等价（android ${andGap} / harmony ${harGap}）`, andGap !== null && andGap === harGap);

// 入场动画 800ms + easeOutQuart（web 的 animation 配置）
check('web 环图入场 800ms', /animateScale:\s*true[\s\S]{0,80}duration:\s*800/.test(web));
check('android 入场 800ms', /durationMillis = 800, easing = EaseOutQuart/.test(and));
check('harmony 入场 800ms', /const DUR = 800/.test(har));
check('android 选中过渡 260ms', /durationMillis = 260/.test(and));
check('harmony 选中过渡 260ms', /const DUR = 260/.test(har));

/* ─────────── C. web 式样特征：不该再有的东西 ─────────── */
logger.info('\n[C] 已移除非 web 式样的元素');

// 只在环图代码段内检查 —— 安卓 DonutProgress（预算进度）本来就该有灰轨道，
// 鸿蒙 TrendChart 的网格线也用 COLORS.divider，全文匹配会误报。
check('android 环图无灰色轨道整圆', !/drawCircle\(track/.test(andDonut));
check('harmony 环图无灰色轨道整圆', !/COLORS\.divider/.test(harDonut));
check('android 无四角引线标注', !/nearestCorner|CornerLabel/.test(and));
check('harmony 无四角引线标注', !/cornerAlign|SelInfo/.test(har));
check('android 扇区为 Path 自绘（非 Stroke 近似圆角）', /ringSegmentPath/.test(andDonut));
check('harmony 扇区为 Path 自绘（非 lineCap 近似圆角）', /ringSegment\(/.test(harDonut));
// 中心读数是 web「无图例」式样的必要配套：去掉引线后，占比只能落在环心
const andReports = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/xinwallet/app/ui/screens/ReportsScreen.kt'), 'utf8');
const harReports = fs.readFileSync(path.join(ROOT, 'harmony/entry/src/main/ets/pages/Reports.ets'), 'utf8');
check('android 环心第一行带占比', /centerTitle[\s\S]{0,200}totalAmount \* 100/.test(andReports));
check('harmony 环心第一行带占比', /donutCenterTitle[\s\S]{0,400}pct\.toFixed\(1\)/.test(harReports));

/* ─────────── D. 层级式样：一级环图 + 二级列表 ─────────── */
// 2026-08-23 改动：移除「小类/大类」全局切换，改为「环图只画一级、列表随选中项展开二级」。
// 这是两端各自独立实现的行为契约，很容易在后续重构中被单端改回去 —— 一旦一端恢复
// granularity 切换、另一端没有，两端统计页的信息层级就不一样了，而且不会有任何报错。
logger.info('\n[D] 层级式样：一级环图 + 选中项二级列表');

check('android 已移除小类/大类切换', !/GRAN_OPTIONS|granularity/.test(andReports));
check('harmony 已移除小类/大类切换', !/GranChip|granularity/.test(harReports));
check('android 环图仅取一级分类', /parentId == null && it\.total > 0/.test(andReports));
check('harmony 环图仅取一级分类', /cats\(\)[\s\S]{0,300}parent_id === null \|\| c\.parent_id === undefined/.test(harReports));
check('android 有二级子类索引', /childrenByParent/.test(andReports));
check('harmony 有二级子类索引', /childPieces\(\)/.test(harReports));
// 占比分母必须是父类总额而非子类之和，否则子类占比会虚高到 100%
check('android 列表占比用父类总额', /baseTotal = selected\?\.total/.test(andReports));
check('harmony 列表占比用父类总额', /baseTotal:\s*this\.effIdx\(\)/.test(harReports));
// CategoryBars 现在要随选中项换数据，ArkUI 里必须 @Prop（否则实例复用后列表永不更新）
const harComponents = fs.readFileSync(path.join(ROOT, 'harmony/entry/src/main/ets/common/components/Components.ets'), 'utf8');
check('harmony CategoryBars.items 有 @Prop', /@Prop items: DonutPiece\[\]/.test(harComponents));

logger.info(`\n${fail === 0 ? '✓' : '✗'} ${pass}/${pass + fail} 项通过`);
process.exit(fail === 0 ? 0 : 1);
