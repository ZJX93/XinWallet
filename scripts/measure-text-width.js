#!/usr/bin/env node
/**
 * 文本宽度测算工具（vp / dp）
 *
 * 用途：在决定「金额要不要缩写」「一行能不能放两项」「Canvas 给多宽」之前，
 * 先把宽度算出来，而不是靠眼估。
 *
 * 起因（见 docs/harmony-style-guide.md §44）：
 * 曾凭手感估出「KPI 卡 -¥123,456.78 ≈ 132vp 越界」→ 给 6 个 KPI 值全上了缩写。
 * 实测只有 118vp，卡内可用 131vp，本来放得下。手估错了 14vp，
 * 而这 14vp 恰好就是「要不要缩写」的分界线，导致金额白丢了小数位。
 *
 * 用法：
 *   node scripts/measure-text-width.js
 *   node scripts/measure-text-width.js --fs 20 --avail 131 "¥123,456.78" "-¥1,234,567.89"
 *   node scripts/measure-text-width.js --kpi          # KPI 卡多屏宽全量核对
 *   node scripts/measure-text-width.js --fit 111 --fs 20 "-¥1,234,567.89"   # 倒推 minFontSize
 */

/* ── 字符 advance 近似表（HarmonyOS Sans SC / 思源黑体，单位 em）──
 * 数字用 tabular figures，宽度一致；标点和符号实测偏窄。
 * 汉字按全角 1.0em 计。误差约 ±3%，用于「够不够」判断足够。
 */
const ADV = {
  digit: 0.55,
  comma: 0.27,   // , 和 .
  yuan: 0.60,    // ¥
  minus: 0.36,   // -
  plus: 0.55,    // +
  space: 0.28,
  cjk: 1.00,
  latin: 0.52,   // 西文字母平均
};

function advance(ch) {
  if (ch >= '0' && ch <= '9') return ADV.digit;
  if (ch === ',' || ch === '.') return ADV.comma;
  if (ch === '¥' || ch === '$') return ADV.yuan;
  if (ch === '-' || ch === '‹' || ch === '›') return ADV.minus;
  if (ch === '+') return ADV.plus;
  if (ch === ' ') return ADV.space;
  if (/[a-zA-Z]/.test(ch)) return ADV.latin;
  return ADV.cjk;
}

/** 文本在指定字号下的宽度（vp） */
function width(str, fontSize) {
  let em = 0;
  for (const ch of str) em += advance(ch);
  return +(em * fontSize).toFixed(1);
}

/** 倒推：要塞进 avail 宽度，字号最大能给到多少 */
function fitFontSize(str, avail, maxFs = 20, minFs = 9) {
  for (let fs = maxFs; fs >= minFs; fs--) {
    if (width(str, fs) <= avail) return fs;
  }
  return minFs;
}

/* ── 本项目已知容器可用宽（vp）────────────────────────────── */
const CONTAINERS = {
  /** KPI 卡内可用：(屏宽 - 页面padding 16*2 - 卡间距 10) / 2 - 卡padding 14*2 */
  kpiCard: (screen) => (screen - 32 - 10) / 2 - 28,
  /** 普通卡片内可用：屏宽 - 页面padding 16*2 - 卡padding 16*2 */
  card: (screen) => screen - 32 - 32,
  /** 趋势图 Canvas：卡内可用再留 12 余量 */
  trendCanvas: (screen) => screen - 32 - 32 - 12,
  /** 环形图中心：内圆直径 DIAMETER(160) - STROKE(36)，留 8 余量 */
  donutCenter: () => 160 - 36 - 8,
};

const SCREENS = [320, 360, 392, 412];

/** 本项目会出现的金额档位，含极端值 */
const MONEY_CASES = [
  '¥674.32',
  '¥3,895.00',
  '¥9,999.99',
  '¥20,904.00',
  '¥123,456.78',
  '-¥123,456.78',
  '¥1,234,567.89',
  '-¥1,234,567.89',
  '¥12,345,678.90',
];

function reportKpi() {
  console.log('=== KPI 卡：各屏宽下卡内可用 ===');
  for (const s of SCREENS) {
    console.log(`  ${s}vp 屏 → ${CONTAINERS.kpiCard(s)}vp`);
  }
  console.log('');
  console.log('=== 20sp 下各金额能否放下 ===');
  console.log('  值'.padEnd(20) + '宽度' + SCREENS.map(s => String(s).padStart(6)).join(''));
  for (const v of MONEY_CASES) {
    const ww = width(v, 20);
    const cells = SCREENS.map(s => (ww <= CONTAINERS.kpiCard(s) ? '    ok' : '    XX')).join('');
    console.log('  ' + v.padEnd(18) + String(ww).padStart(6) + cells);
  }
  console.log('');
  console.log('=== minFontSize 倒推（最窄的 320vp 屏）===');
  const avail = CONTAINERS.kpiCard(320);
  for (const v of ['¥1,234,567.89', '-¥1,234,567.89', '¥12,345,678.90']) {
    const fs = fitFontSize(v, avail);
    console.log(`  ${v.padEnd(18)}→ ${fs}sp（可用 ${avail}，实宽 ${width(v, fs)}）`);
  }
  console.log('');
  console.log('  当前取 minFontSize(15)：留一档余量，不按亿级定');
  console.log('  （按理论最大值定会让常见值也被压小，为极端情况牺牲日常可读性）');
  console.log('');
  console.log('=== 环形图中心（可用 ' + CONTAINERS.donutCenter() + 'vp，与屏宽无关）===');
  for (const v of MONEY_CASES) {
    const ww = width(v, 20);
    console.log('  ' + String(ww).padStart(6) + '  ' + v.padEnd(18) +
      (ww <= CONTAINERS.donutCenter() ? 'ok' : 'XX 需缩到 ' + fitFontSize(v, CONTAINERS.donutCenter()) + 'sp'));
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--kpi')) {
    reportKpi();
    return;
  }

  let fs = 14;
  let avail = 0;
  let fit = 0;
  const texts = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fs') { fs = Number(argv[++i]); continue; }
    if (argv[i] === '--avail') { avail = Number(argv[++i]); continue; }
    if (argv[i] === '--fit') { fit = Number(argv[++i]); continue; }
    texts.push(argv[i]);
  }

  for (const t of texts) {
    const ww = width(t, fs);
    let line = `${String(ww).padStart(7)}vp  @${fs}sp  ${t}`;
    if (avail > 0) line += ww <= avail ? `  放得下（余 ${(avail - ww).toFixed(1)}）` : `  超出 ${(ww - avail).toFixed(1)}`;
    if (fit > 0) line += `  → 要塞进 ${fit}vp 需 ${fitFontSize(t, fit, fs)}sp`;
    console.log(line);
  }
}

main();

module.exports = { width, fitFontSize, CONTAINERS };
