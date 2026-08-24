#!/usr/bin/env node
/**
 * 校验本轮两项改动（安卓 + 鸿蒙）：
 *
 *   A. 账户详情页必须有 编辑 / 销户 / 删除 入口
 *      —— 用户反馈「资产账户只有计息功能，修改删除功能没有」。
 *         注意：功能在账户**列表页**早就有（长按/⋯），但用户是从**详情页**进去的，
 *         入口必须出现在他正在看的那一页。这条断言防止以后又退回「只有记利息」。
 *
 *   B. 转账行第二行显示「A → B」
 *      —— 对齐 web 端表格列语义：第一行=分类列，第二行=账户列。
 *         转账时账户列正是 "A → B"（见 public/js/managers/transaction.js 的 .trans-account）。
 *
 * 用法：node scripts/verify-account-detail-actions.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AND = path.join(ROOT, 'android/app/src/main/java/com/xinwallet/app');
const HAR = path.join(ROOT, 'harmony/entry/src/main/ets');
const WEB = path.join(ROOT, 'public/js');

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name}`);
    if (detail) console.log(`      ${detail}`);
  }
}

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const andDetail = read(path.join(AND, 'ui/screens/AccountDetailScreen.kt'));
const andComp = read(path.join(AND, 'ui/components/Components.kt'));
const andAccounts = read(path.join(AND, 'ui/screens/AccountsScreen.kt'));
const andInvDetail = read(path.join(AND, 'ui/screens/InvestmentDetailScreen.kt'));
const harDetail = read(path.join(HAR, 'pages/AccountDetail.ets'));
const harComp = read(path.join(HAR, 'common/components/Components.ets'));
const webTx = read(path.join(WEB, 'managers/transaction.js'));

console.log('\n[1] 源文件均可读');
const files = {
  'AccountDetailScreen.kt': andDetail,
  'Components.kt': andComp,
  'AccountsScreen.kt': andAccounts,
  'InvestmentDetailScreen.kt': andInvDetail,
  'AccountDetail.ets': harDetail,
  'Components.ets': harComp,
  'transaction.js': webTx
};
let missing = false;
for (const [n, c] of Object.entries(files)) {
  if (c === null) { missing = true; }
  check(n, c !== null);
}
if (missing) { console.log('\n有文件缺失，终止'); process.exit(1); }

// ============ A. 账户详情页操作入口 ============

console.log('\n[2] 安卓账户详情页：编辑 / 销户 / 删除 入口');
check('有「编辑」ActionChip', /ActionChip\([^\n]*"编辑"/.test(andDetail));
check('有「销户」ActionChip', /ActionChip\([^\n]*"销户"/.test(andDetail));
check('有「删除」ActionChip', /ActionChip\([^\n]*"删除"/.test(andDetail));
check('保留「记利息」入口', /ActionChip\([^\n]*"记利息"/.test(andDetail));
// 注意：这里不能用 [^)]* —— Modifier.weight(1f) 自带右括号会提前截断匹配。
// 用 [^\n]* 限定在同一行内即可（ActionChip 调用都是单行写法）。
check('删除 chip 用 danger 色标记', /ActionChip\([^\n]*"删除"[^\n]*danger\s*=\s*true/.test(andDetail));
// 复用列表页表单而非另写一套：字段校验规则只应有一处
check('复用 AccountFormDialog（不另写表单）', /AccountFormDialog\(/.test(andDetail));
check('调用 UpdateAccountRequest 提交编辑', /UpdateAccountRequest\(/.test(andDetail));
check('销户走 accountsVm.close', /accountsVm\.close\(/.test(andDetail));
check('删除走 accountsVm.delete', /accountsVm\.delete\(/.test(andDetail));

console.log('\n[3] 安卓：AccountFormDialog 跨文件可见');
// Kotlin 的 private 是**文件级**作用域，同包不同文件也访问不到。
// 这条断言防止以后有人「顺手」把它改回 private 而导致详情页编译失败。
check(
  'AccountFormDialog 声明为 internal（非 private）',
  /internal fun AccountFormDialog\(/.test(andAccounts),
  'private 是文件级作用域，详情页会 Cannot access'
);

console.log('\n[4] 安卓：删除后必须退出详情页');
// 账户已不存在，留在详情页会展示陈旧数据且下次刷新拉空
check('存在 pendingDeleted 标记', /pendingDeleted/.test(andDetail));
check('删除成功后 popBackStack', /pendingDeleted\s*\)\s*\{[\s\S]{0,120}popBackStack\(\)/.test(andDetail));

console.log('\n[5] 鸿蒙账户详情页：编辑 / 销户 / 删除 入口');
check('有「编辑」ActionChip', /ActionChip\(\{[^}]*label:\s*'编辑'/.test(harDetail));
check('有「销户」ActionChip', /ActionChip\(\{[^}]*label:\s*'销户'/.test(harDetail));
check('有「删除」ActionChip', /ActionChip\(\{[^}]*label:\s*'删除'/.test(harDetail));
check('保留「记利息」入口', /ActionChip\(\{[^}]*label:\s*'记利息'/.test(harDetail));
check('删除 chip 标记 danger', /ActionChip\(\{[^}]*label:\s*'删除'[^}]*danger:\s*true/.test(harDetail));
check('调用 Api.updateAccount', /Api\.updateAccount\(/.test(harDetail));
check('调用 Api.closeAccount', /Api\.closeAccount\(/.test(harDetail));
check('调用 Api.deleteAccount', /Api\.deleteAccount\(/.test(harDetail));
check('删除成功后 router.back()', /doDelete[\s\S]{0,600}router\.back\(\)/.test(harDetail));
check('二次确认弹层存在（ConfirmSheet）', /ConfirmSheet\(\)/.test(harDetail));

console.log('\n[6] 鸿蒙：编辑不得提交 opening_balance');
// 余额由复式记账推导（server 的 computeAccountBalance），直接改会与流水对不上
const updBlock = (harDetail.match(/Api\.updateAccount\([\s\S]{0,420}?\}\);/) || [''])[0];
check(
  'updateAccount 调用未含 opening_balance',
  updBlock.length > 0 && !/opening_balance/.test(updBlock),
  '余额由流水推导，传 opening_balance 会与账本对不上'
);
check('当前余额输入框置灰（enabled(false)）', /enabled\(false\)/.test(harDetail));

console.log('\n[7] 两端 ActionChip 为公共组件（不各自复制）');
check('安卓 Components.kt 导出 ActionChip', /^fun ActionChip\(/m.test(andComp));
check('鸿蒙 Components.ets 导出 ActionChip', /export struct ActionChip/.test(harComp));
check(
  '投资详情页已改用公共 ActionChip',
  /ActionChip\(/.test(andInvDetail) && !/private fun TxnActionChip/.test(andInvDetail),
  '仍存在私有 TxnActionChip，两份实现会漂移'
);
check('安卓 ActionChip 支持 danger 参数', /fun ActionChip\([\s\S]{0,300}danger:\s*Boolean/.test(andComp));
check('鸿蒙 ActionChip 支持 danger 参数', /struct ActionChip\s*\{[\s\S]{0,300}danger:\s*boolean/.test(harComp));

// ============ B. 转账行第二行 A → B ============

console.log('\n[8] 安卓转账行：第一行分类、第二行 A → B');
const andRow = (andComp.match(/fun TransactionRow\(item: TransactionItem\)[\s\S]*?\n\}/) || [''])[0];
check('TransactionRow 已定位', andRow.length > 0);
// 第一行必须先出现 category，且不能再是 "A → B"
check(
  '第一行用 item.category?.name',
  /Text\(\s*\n?\s*item\.category\?\.name/.test(andRow),
  '第一行应让位给分类名'
);
check(
  '第二行含 from → to 拼接（主路径 transfer 字段）',
  /val flow = if \(tf != null\)[\s\S]{0,200}tf\.from\?\.name[\s\S]{0,60}→[\s\S]{0,60}tf\.to\?\.name/.test(andRow),
  '第二行应显示 A → B'
);
check(
  '老后端不返回 transfer 时仍有兜底拼接',
  /item\.type != "transfer_in"[\s\S]{0,260}item\.source\?\.name/.test(andRow),
  '兜底按 type 方向用 source/counterparty/destination 拼 A → B'
);
check(
  '流向在备注之前（截断只吃备注）',
  /if \(item\.note\.isNullOrBlank\(\)\) flow else "\$flow · \$\{item\.note\}"/.test(andRow),
  '顺序反了会让长备注把 A → B 挤进省略号'
);
check(
  '第二行不再写死「转账」常量',
  !/isTransfer -> if \(item\.note\.isNullOrBlank\(\)\) "转账"/.test(andRow),
  '写死常量与左侧 🔄 重复表意，白占一行'
);

console.log('\n[9] 鸿蒙转账行：第一行分类、第二行 A → B');
check('存在 subText() 方法', /private subText\(\)/.test(harComp));
const harSub = (harComp.match(/private subText\(\)[\s\S]*?\n  \}/) || [''])[0];
check('subText 拼接 from → to', /transfer\?\.from\?\.name[\s\S]{0,60}→[\s\S]{0,60}transfer\?\.to\?\.name/.test(harSub));
check('流向在备注之前', /flow \+ ' · ' \+ note/.test(harSub));
const harRow = (harComp.match(/export struct TransactionRow[\s\S]*?\n\}/) || [''])[0];
check(
  '第一行用 category?.name',
  /Text\(this\.item\?\.category\?\.name/.test(harRow),
  '第一行应让位给分类名'
);
check(
  '右下角不再重复写「转账」',
  !/Text\('转账'\)\.fontSize\(11\)/.test(harRow),
  '左侧 🔄 + 第二行 A → B 已表达清楚，第三处重复是噪声'
);
check('普通记录右下角仍显示账户名', /!this\.isTransfer\(\) && this\.item\?\.account\?\.name/.test(harRow));

console.log('\n[10] 与 web 端列语义一致（参照基准）');
// web 是表格：.trans-category 是分类列，.trans-account 是账户列，
// 转账时账户列渲染 "A → B"。两端两行分别对应这两列。
check(
  'web 转账行的 trans-account 列渲染 A → B',
  /trans-td trans-account">\$\{fromName\} → \$\{toName\}/.test(webTx),
  'web 端基准变了，两端断言需同步复核'
);

console.log('\n[11] 转账仍保持中性色 / 无正负号');
check('安卓转账用 onSurface 中性色', /isTransfer -> MaterialTheme\.colorScheme\.onSurface/.test(andComp));
check('鸿蒙转账金额无正负号', /if \(this\.isTransfer\(\)\) return raw;/.test(harComp));

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(50));
process.exit(fail === 0 ? 0 : 1);
