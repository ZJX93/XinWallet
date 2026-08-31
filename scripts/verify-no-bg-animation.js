#!/usr/bin/env node
/**
 * 校验：web 端背景不得存在"来回移动"的循环动画。
 *
 * 背景（避免以后被误加回来）：
 *   body 的 background-image 铺了 4 个 radial-gradient 光斑（静态，需保留）；
 *   body::before / body::after 是两层全屏 position:fixed 的叠加层。
 *   曾经在这两层上挂 blobDrift1 14s / blobDrift2 18s 的 infinite 动画，
 *   做 translate + scale，观感上就是"背景色一直来回移动"，已移除。
 *
 * 判据要点：
 *   1. 不能只搜 "infinite" —— 骨架屏 shimmer、加载 spin、空状态 blobFloat
 *      都是合理的 infinite，属白名单，不能误杀。
 *   2. 必须确认静态渐变仍在 —— 否则等于把背景整个删了，不是本次诉求。
 *
 * 用法：node scripts/verify-no-bg-animation.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'public', 'css');

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    logger.info(`  \u2713 ${name}`);
  } else {
    fail++;
    logger.info(`  \u2717 ${name}`);
    if (detail) logger.info(`      ${detail}`);
  }
}

function readCss(file) {
  const p = path.join(CSS_DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const styles = readCss('styles.css');

logger.info('\n[1] styles.css 存在且可读');
check('styles.css 可读', styles !== null && styles.length > 0);
if (styles === null) {
  logger.info('\n无法继续，styles.css 缺失');
  process.exit(1);
}

// ---- 2. 背景漂移动画必须彻底移除 ----
// 注意用「animation 属性引用」而非 @keyframes 定义来判定：
// 只要没有任何选择器引用它，残留定义也不会生效；但这里两者都不该有。
logger.info('\n[2] 背景漂移动画已移除');
const driftKeyframes = /@keyframes\s+blobDrift\d/g;
const driftUsage = /animation\s*:[^;}]*blobDrift\d/g;
check(
  '无 blobDrift @keyframes 定义',
  !driftKeyframes.test(styles),
  '发现残留的 blobDrift keyframes 定义'
);
check(
  '无任何选择器引用 blobDrift',
  !driftUsage.test(styles),
  '仍有 animation 引用 blobDrift，背景会继续漂移'
);

// glassShimmer 同属"背景位置循环移动"，语义上一致，也不应出现
const shimmerUsage = /animation\s*:[^;}]*glassShimmer/g;
check(
  '无任何选择器引用 glassShimmer',
  !shimmerUsage.test(styles),
  'glassShimmer 会让背景位置循环移动'
);

// ---- 3. body 伪元素上不得挂任何 animation ----
// 这两层是全屏 fixed 覆盖层，一旦有动画就是全屏背景在动。
logger.info('\n[3] body::before / body::after 无 animation');
function pseudoBlocks(css, selector) {
  // 抓取该选择器的所有规则块内容（非贪婪到最近的右花括号）
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
    'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(css)) !== null) out.push(m[1]);
  return out;
}
for (const sel of ['body::before', 'body::after']) {
  const blocks = pseudoBlocks(styles, sel);
  const withAnim = blocks.filter((b) => /(^|[\s;])animation\s*:/.test(b));
  check(
    `${sel} 的 ${blocks.length} 个规则块均无 animation`,
    withAnim.length === 0,
    withAnim.length ? `有 ${withAnim.length} 个块仍带 animation` : ''
  );
}

// ---- 4. 静态光斑背景必须保留 ----
// 本次只去动态，不是把背景删掉。
logger.info('\n[4] 静态渐变背景保留');
check('body 仍有 4 个 blob 变量引用', (styles.match(/var\(--blob-[1-4]\)/g) || []).length >= 4);
check('body 静态 radial-gradient 仍在', /radial-gradient\(56vw 56vw/.test(styles));
check('body::after 叠加层仍保留渐变', /radial-gradient\(40vw 40vw at calc\(100% \+ 4vw\)/.test(styles));
check('background-attachment: fixed 仍在', /background-attachment:\s*fixed/.test(styles));

const tokens = readCss('tokens.css');
check('tokens.css 中 --blob-* 变量仍定义', tokens !== null && /--blob-1\s*:/.test(tokens));

// ---- 5. 合理的 infinite 动画不应被误删 ----
// 这三个跟"背景色移动"无关，属白名单，必须还在。
logger.info('\n[5] 白名单 infinite 动画未被误删');
check('骨架屏 shimmer 保留', /animation\s*:\s*shimmer\s/.test(styles));
check('加载 spin 保留', /animation\s*:\s*spin\s/.test(styles));
check('空状态 blobFloat 保留', /animation\s*:\s*blobFloat\s/.test(styles));

// ---- 6. CSS 结构完整性 ----
logger.info('\n[6] CSS 结构完整');
const ob = (styles.match(/\{/g) || []).length;
const cb = (styles.match(/\}/g) || []).length;
check(`花括号配平 ({ ${ob} / } ${cb})`, ob === cb, '编辑过程可能破坏了规则块结构');

// ---- 7. reduced-motion 兜底仍在 ----
logger.info('\n[7] prefers-reduced-motion 兜底保留');
check(
  '存在 prefers-reduced-motion 降级块',
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(styles)
);

logger.info(`\n${'='.repeat(46)}`);
logger.info(`通过 ${pass} 项，失败 ${fail} 项`);
logger.info('='.repeat(46));
process.exit(fail === 0 ? 0 : 1);
