#!/usr/bin/env node
/**
 * 校验：鸿蒙组件库里「在 ForEach 内被动态绑定」的属性必须带 @Prop。
 *
 * 背景（2026-08-23 真实 bug）：ArkTS 子组件的无装饰器成员变量只在首次构造时赋值，
 * 父 @State 变化后不同步。ForEach 的 key 是稳定 id 时 ArkUI 会复用实例，
 * 于是 Chip.active 永远停在初始值 —— 点击后状态变了但 UI 不刷新，表现为「选项点不动」。
 *
 * 判别铁证：同页面里不在 ForEach 内的 Chip 能选中、在 ForEach 内的点不动。
 *
 * 双向断言：
 *   1) 组件侧：Chip.active/useGradient、CategoryIcon.selected 必须有 @Prop
 *   2) 调用侧：ForEach 内对这些属性的动态绑定仍然存在（确认校验有实际保护对象）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'harmony', 'entry', 'src', 'main', 'ets');
const COMPONENTS = path.join(ROOT, 'common', 'components', 'Components.ets');
const PAGES_DIR = path.join(ROOT, 'pages');

let pass = 0;
let fail = 0;

function check(desc, ok, detail) {
  if (ok) {
    pass++;
    logger.info(`  ✓ ${desc}`);
  } else {
    fail++;
    logger.info(`  ✗ ${desc}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 取出 `@Component export struct <Name> { ... }` 到 build() 之前的成员声明区 */
function memberBlock(src, structName) {
  const i = src.indexOf(`export struct ${structName}`);
  if (i < 0) return null;
  const b = src.indexOf('build()', i);
  return b < 0 ? null : src.slice(i, b);
}

logger.info('== 1. 组件侧：动态属性必须带 @Prop ==');
const comp = fs.readFileSync(COMPONENTS, 'utf8');

// 每项：结构体名 / 属性名 / 该属性为什么必须同步
const REQUIRED = [
  ['Chip', 'active', 'ForEach 内选中态；缺 @Prop 会「点不动」'],
  ['Chip', 'useGradient', '激活态填充样式，随 active 一起变'],
  ['CategoryIcon', 'selected', 'ForEach(categories) 内选中描边'],
];

for (const [struct, prop, why] of REQUIRED) {
  const block = memberBlock(comp, struct);
  if (!block) {
    check(`${struct} 结构体存在`, false, '未找到 export struct');
    continue;
  }
  // 允许注释穿插：只要该属性声明行自身以 @Prop 开头
  const declared = new RegExp(`@Prop\\s+${prop}\\s*[?:]`).test(block);
  const bare = new RegExp(`^\\s*${prop}\\s*[?:]`, 'm').test(block);
  check(`${struct}.${prop} 带 @Prop（${why}）`, declared && !bare,
    declared ? '' : '缺 @Prop，ForEach 复用实例后不会同步父状态');
}

logger.info('\n== 2. 调用侧：ForEach 内的动态绑定仍存在 ==');
// 若这些调用点被移除，上面的校验就失去保护对象，需要同步更新本脚本
const CALLSITES = [
  ['Search.ets', /Chip\(\{[^}]*active:\s*this\.selBook === b\.id/, '账本单选（用户实测的 bug 现场）'],
  ['Search.ets', /Chip\(\{[^}]*active:\s*this\.types\.includes/, '类型多选'],
  ['Tags.ets', /Chip\(\{[^}]*active:\s*this\.fIcon === ic/, '标签图标选择'],
  ['Category.ets', /Chip\(\{[^}]*active:\s*this\.fType === t\.key/, '类目类型选择'],
  ['Budgets.ets', /Chip\(\{[^}]*active:\s*this\.fPeriod === p/, '预算周期选择'],
  ['Accounts.ets', /Chip\(\{[^}]*active:\s*this\.fType === t/, '账户类型选择'],
  ['AccountDetail.ets', /Chip\(\{[^}]*active:\s*this\.fType === t/, '账户详情类型选择'],
  ['AddTransaction.ets', /CategoryIcon\(\{[^}]*selected:\s*this\.catId === c\.id/, '记账类目选择'],
];

for (const [file, re, desc] of CALLSITES) {
  const p = path.join(PAGES_DIR, file);
  if (!fs.existsSync(p)) {
    check(`${file} 存在`, false, '文件缺失');
    continue;
  }
  check(`${file}: ${desc}`, re.test(fs.readFileSync(p, 'utf8')));
}

logger.info('\n== 3. 回归护栏：不得退回无装饰器写法 ==');
// 精确匹配「行首缩进 + 属性名 + : 类型」且前面没有装饰器
const REGRESSIONS = [
  [/^\s{2}active:\s*boolean/m, 'Chip.active 退回无装饰器'],
  [/^\s{2}selected:\s*boolean/m, 'CategoryIcon.selected 退回无装饰器'],
];
for (const [re, desc] of REGRESSIONS) {
  check(`未出现「${desc}」`, !re.test(comp));
}

logger.info(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
