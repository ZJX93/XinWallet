#!/usr/bin/env node
/**
 * 环图莫兰迪配色生成 + 校验（一次性设计工具，结果固化进三端代码）。
 *
 * 为什么要脚本而不是手挑颜色：
 * 环图相邻扇区必须一眼可辨，而莫兰迪本身是「低饱和」体系 —— 手挑很容易挑出
 * 两个只差 5° 色相的灰调，铺在环上就糊成一段。这里用 HSV 定义、机器换算 hex，
 * 并强制校验三件事：
 *   1) 饱和度全部落在莫兰迪区间（S 16~32%），不许混进高饱和色
 *   2) 相邻扇区色相距离 ≥ 90°（环图按值降序上色，相邻是必然并排的）
 *   3) 在亮色卡片(#FFFFFF)与暗色卡片(#29231D)上都要「看得见」——
 *      色块不需要达文字的 AA 4.5:1，但对比度低于 1.6:1 就会和底色融掉
 */

function hsvToHex(h, s, v) {
  const S = s / 100, V = v / 100;
  const c = V * S;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = V - c;
  const to = (n) => Math.round((n + m) * 255).toString(16).toUpperCase().padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

function relLum(hex) {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(n.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  return ((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05));
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 排序即设计：环图按金额降序上色，所以数组相邻项一定在环上并排。
 * 这里刻意把色相打散（不按色环顺序排），让 1↔2、2↔3 永远隔着一个大跨度。
 * 首色贴品牌棕（26°，品牌色 #995F2C 是 27°）—— 占比最大的分类用品牌调，
 * 与截图里那块大面积暖陶土一致。
 */
const SPEC = [
  { name: '暖陶棕', h: 26,  s: 30, v: 72 },
  { name: '青瓷绿', h: 172, s: 26, v: 70 },
  { name: '赭石红', h: 5,   s: 28, v: 70 },
  { name: '雾霾蓝', h: 205, s: 26, v: 72 },
  { name: '芥末黄', h: 45,  s: 30, v: 74 },
  { name: '藕荷紫', h: 280, s: 22, v: 72 },
  { name: '橄榄绿', h: 95,  s: 24, v: 70 },
  { name: '干玫瑰', h: 340, s: 24, v: 72 },
  { name: '灰蓝紫', h: 240, s: 18, v: 72 },
  // 末色要同时远离前一色(240°)和首色(26°) —— 因为恰好 10 个分类时它与首色在环上并排。
  // 合法区间 116~150°，取 130° 浅灰绿；原先取 32°（石灰米）与首色只差 6°，会糊成一段。
  { name: '浅灰绿', h: 130, s: 16, v: 78 }
];

const LIGHT_CARD = '#FFFFFF';
const DARK_CARD = '#29231D';

const out = SPEC.map((c) => {
  const hex = hsvToHex(c.h, c.s, c.v);
  return {
    ...c,
    hex,
    onLight: contrast(hex, LIGHT_CARD),
    onDark: contrast(hex, DARK_CARD)
  };
});

// 暗色卡片上整体压暗一档更稳（V 提 6 点，S 降 2 点：暗底上要提亮而非加饱和）
const dark = SPEC.map((c) => ({ name: c.name, hex: hsvToHex(c.h, Math.max(0, c.s - 2), Math.min(100, c.v + 8)) }));

let fail = 0;
console.info('idx  名称      HSV            hex       白底对比  暗底对比');
out.forEach((c, i) => {
  const okS = c.s >= 16 && c.s <= 32;
  const okL = c.onLight >= 1.6;
  const okD = c.onDark >= 1.6;
  if (!okS || !okL || !okD) fail++;
  console.info(
    String(i).padEnd(4),
    c.name.padEnd(8),
    `${c.h}/${c.s}/${c.v}`.padEnd(14),
    c.hex.padEnd(9),
    c.onLight.toFixed(2).padEnd(9),
    c.onDark.toFixed(2),
    okS && okL && okD ? '' : '  ✗'
  );
});

console.info('\n相邻色相距离（环上必然并排，要求 ≥90°）:');
for (let i = 0; i < SPEC.length; i++) {
  const j = (i + 1) % SPEC.length;
  const d = hueDist(SPEC[i].h, SPEC[j].h);
  if (d < 90) fail++;
  console.info(`  ${SPEC[i].name} ↔ ${SPEC[j].name}: ${d}°${d < 90 ? '  ✗' : ''}`);
}

console.info('\n— 亮色（安卓/鸿蒙/web 亮色共用）—');
console.info(out.map((c) => `'${c.hex}', // ${c.name}`).join('\n'));
console.info('\n— 暗色（web 暗色主题用）—');
console.info(dark.map((c) => `'${c.hex}', // ${c.name}`).join('\n'));

console.info(fail === 0 ? '\n✓ 全部校验通过' : `\n✗ ${fail} 项未通过`);
process.exit(fail === 0 ? 0 : 1);
