#!/usr/bin/env node
/**
 * 转账编辑「定位 transfer 主记录」的回归钉子。
 *
 * 起因：web 端点保存弹「无法定位转账记录」，一次都存不进去。
 * 根因是 GET /transactions/:id **不 JOIN transfers**，返回体里没有
 * transfer_id，而 web 端 save() 里写着
 *   `if (!old.transfer_id) { showToast('无法定位转账记录'); return; }`
 * —— 判据依赖的字段服务端从来没给过，于是必然命中。
 *
 * 这类 bug 的特征：**回填是对的、保存是死的**。因为回填走的是列表缓存
 * （能拿到 transfer.to），保存走的是单条接口（拿不到 transfer_id）。
 * 只测「打开弹窗数据对不对」永远发现不了。
 *
 * 本脚本做两件事：
 *   A. 源码级断言 —— 单条接口必须 JOIN transfers 且输出 transfer_id/transfer
 *   B. 行为级断言 —— resolveTransferId 的三级回退在各种服务端形态下都能定位
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
    if (cond) { pass++; console.log('  ok   ' + msg); }
    else { fail++; failures.push(msg); console.log('  FAIL ' + msg); }
}
function section(t) { console.log('\n' + t); }

// ─────────────────────────────────────────────────────────────
section('A. 服务端：GET /transactions/:id 必须自带转账信息');

const txSrc = fs.readFileSync(path.join(ROOT, 'server/routes/transactions.js'), 'utf8');

// 切出单条接口那一段（从 router.get('/:id' 到下一个 router. 或文件尾）
const singleStart = txSrc.indexOf("router.get('/:id'");
ok(singleStart > 0, "能定位 router.get('/:id') 单条接口");
const afterSingle = txSrc.slice(singleStart);
const singleEnd = afterSingle.indexOf('\nrouter.', 1);
const singleBlock = singleEnd > 0 ? afterSingle.slice(0, singleEnd) : afterSingle;

ok(/LEFT JOIN transfers\s+tr\s+ON\s+t\.transfer_id\s*=\s*tr\.id/.test(singleBlock),
    '单条接口 JOIN 了 transfers 主表');
ok(/LEFT JOIN accounts\s+fa\s+ON\s+tr\.from_account_id/.test(singleBlock),
    '单条接口 JOIN 了转出账户（fa）');
ok(/LEFT JOIN accounts\s+ta\s+ON\s+tr\.to_account_id/.test(singleBlock),
    '单条接口 JOIN 了转入账户（ta）');
ok(/tr_from_name/.test(singleBlock) && /tr_to_name/.test(singleBlock),
    '单条接口 SELECT 了双端账户名别名');

// 这是最关键的一条：字段真的输出到响应体
ok(/transfer_id:\s*t\.transfer_id/.test(singleBlock),
    '响应体输出 transfer_id（web 端 save() 的判据字段）');
ok(/transfer:\s*t\.transfer_id\s*&&\s*t\.tr_from_name\s*&&\s*t\.tr_to_name/.test(singleBlock),
    'transfer 字段构造判据与列表接口一致（三者齐全才给）');
ok(/from:\s*\{\s*id:\s*t\.tr_from/.test(singleBlock) && /to:\s*\{\s*id:\s*t\.tr_to/.test(singleBlock),
    'transfer.from.id / transfer.to.id 取的是 transfers 主表的双端 id');

// 单条接口的 WHERE 必须仍带 user_id / book_id（加 JOIN 时最容易顺手丢掉）
ok(/WHERE\s+t\.id\s*=\s*\?\s*AND\s+t\.user_id\s*=\s*\?\s*AND\s+t\.book_id\s*=\s*\?/.test(singleBlock),
    '加 JOIN 后 WHERE 仍带 user_id / book_id（不能越权读别人的交易）');

// ─────────────────────────────────────────────────────────────
section('B. web 端：不得再出现「拿不到字段就报死」的单一判据');

const webSrc = fs.readFileSync(path.join(ROOT, 'public/js/managers/transaction.js'), 'utf8');

ok(/async\s+resolveTransferId\s*\(/.test(webSrc),
    '存在 resolveTransferId 统一定位函数');
ok(!/if\s*\(\s*!old\s*\|\|\s*!old\.transfer_id\s*\)\s*\{\s*showToast\('无法定位转账记录'/.test(webSrc),
    '旧的单一判据（!old.transfer_id 直接报错）已移除');
ok(/无法定位转账记录，请刷新页面后重试/.test(webSrc),
    '提示文案给出了下一步动作，不是死路式的「无法定位」');
ok(/this\.resolveTransferId\(editId\)/.test(webSrc),
    'save() 通过 resolveTransferId 取 id');

// 三级回退都在
const resolveStart = webSrc.indexOf('async resolveTransferId');
const resolveBlock = webSrc.slice(resolveStart, resolveStart + 2000);
ok(/_editingTransferId/.test(resolveBlock), '回退①：使用打开弹窗时缓存的 _editingTransferId');
ok(/old\?\.transfer_id\s*\|\|\s*old\?\.transfer\?\.id/.test(resolveBlock),
    '回退②：单条接口的 transfer_id 或 transfer.id 都认');
ok(/_lastMergedTransfers/.test(resolveBlock), '回退③：列表缓存配对结果');

ok(/this\._editingTxId\s*===\s*idNum/.test(resolveBlock),
    '缓存命中要校验 txId 匹配（否则会用上一笔的 transfer_id）');

// 缓存清理：编辑普通交易 / 新增时必须清掉，否则串号
const clearCount = (webSrc.match(/this\._editingTransferId\s*=\s*null/g) || []).length;
ok(clearCount >= 2, `_editingTransferId 至少在 2 处被清空（实际 ${clearCount}）—— 普通交易分支 + 新增分支`);

// 回填方向：转出账户不能直接用 t.account.id
ok(/t\.transfer\?\.from\?\.id/.test(webSrc),
    '转出账户优先取 transfer.from.id（不能直接用 t.account.id，点到 in 腿会填反）');

// ─────────────────────────────────────────────────────────────
section('C. 行为：三级回退在各种服务端形态下都能定位');

// 复刻 resolveTransferId 的逻辑（纯函数版，便于断言）
function resolveTransferId({ editId, cache, single, list }) {
    const idNum = parseInt(editId);
    if (cache && cache.transferId && cache.txId === idNum) return cache.transferId;
    if (single) {
        const tid = single.transfer_id || (single.transfer && single.transfer.id);
        if (tid) return tid;
    }
    const arr = list || [];
    const hit = arr.find(x => x.id === idNum
        || (x._transferOut && x._transferOut.id === idNum)
        || (x._transferIn && x._transferIn.id === idNum));
    if (!hit) return null;
    return (hit.transfer && hit.transfer.id) || hit.transfer_id
        || (hit._transferOut && hit._transferOut.transfer_id) || null;
}

// 1) 新服务端：单条接口带 transfer_id
ok(resolveTransferId({
    editId: 1696,
    single: { id: 1696, transfer_id: 41, transfer: { id: 41 } }
}) === 41, '新服务端：单条接口的 transfer_id 直接命中');

// 2) 新服务端但只给了 transfer 对象（没给顶层 transfer_id）
ok(resolveTransferId({
    editId: 1696,
    single: { id: 1696, transfer: { id: 41 } }
}) === 41, '只给 transfer 对象时从 transfer.id 取');

// 3) 旧服务端：单条接口啥都没有，但弹窗缓存了（这是本 bug 的核心兜底）
ok(resolveTransferId({
    editId: 1696,
    cache: { txId: 1696, transferId: 41 },
    single: { id: 1696, type: 'transfer_out' }
}) === 41, '旧服务端：单条接口无字段，靠弹窗缓存定位');

// 4) 旧服务端 + 无缓存：靠列表配对结果
ok(resolveTransferId({
    editId: 1696,
    single: { id: 1696, type: 'transfer_out' },
    list: [{ id: 1696, _transferOut: { id: 1696, transfer_id: 41 }, _transferIn: { id: 1697, transfer_id: 41 } }]
}) === 41, '旧服务端无缓存：从列表配对结果定位');

// 5) 点到 in 腿也要能定位（残留脏数据场景）
ok(resolveTransferId({
    editId: 1697,
    single: null,
    list: [{ id: 1696, _transferOut: { id: 1696, transfer_id: 41 }, _transferIn: { id: 1697, transfer_id: 41 } }]
}) === 41, '点到 in 腿（id=1697）也能定位到同一笔 transfer');

// 6) 缓存是上一笔的 —— 必须不命中，避免改错记录
ok(resolveTransferId({
    editId: 1700,
    cache: { txId: 1696, transferId: 41 },
    single: { id: 1700, transfer_id: 45 }
}) === 45, '缓存 txId 不匹配时跳过，用单条接口的正确值（不会误改 41）');

// 7) 三条路全断 —— 返回 null 而不是抛异常或返回 undefined
ok(resolveTransferId({
    editId: 9999, single: { id: 9999, type: 'expense' }, list: []
}) === null, '三级全断时返回 null（交由调用方提示刷新重试）');

// 8) 普通交易不该被误判成转账
ok(resolveTransferId({
    editId: 500, single: { id: 500, type: 'expense', transfer_id: null }, list: []
}) === null, '普通交易返回 null（transfer_id 为 null 不算命中）');

// ─────────────────────────────────────────────────────────────
section('D. datetime-local 的秒位（截图里 00:02:00 的来源）');

const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');

ok(/function fmtDateTimeLocal\s*\(/.test(appSrc),
    '存在 fmtDateTimeLocal()（给 step="1" 的 datetime-local 用）');

// fmtDate 必须保持分钟粒度：有三个 type="date" 的框在用它
const fmtDateBlock = appSrc.slice(appSrc.indexOf('function fmtDate('), appSrc.indexOf('function fmtDateTimeLocal('));
ok(/slice\(0,\s*16\)/.test(fmtDateBlock),
    'fmtDate 仍切到 16 位（investBuyDate / reduceDate / interestDate 是 type="date"，多给时间会被拒收）');
ok(!/slice\(0,\s*19\)/.test(fmtDateBlock),
    'fmtDate 没有被改成 19 位');

// 复刻 fmtDateTimeLocal 做行为断言
function fmtDateTimeLocal(d) {
    if (d) {
        const s = String(d).replace(' ', 'T').replace('Z', '');
        const base = s.slice(0, 19);
        if (base.length === 10) return base + 'T00:00:00';
        if (base.length === 16) return base + ':00';
        return base;
    }
    return null;
}
ok(fmtDateTimeLocal('2026-08-23 00:00:00') === '2026-08-23T00:00:00',
    '后端 datetime 原样带秒');
ok(fmtDateTimeLocal('2026-08-23') === '2026-08-23T00:00:00',
    '只有日期时补 T00:00:00（datetime-local 会拒收纯日期）');
ok(fmtDateTimeLocal('2026-08-23T09:30') === '2026-08-23T09:30:00',
    '只到分钟时补 :00 —— 这是 00:02:00 问题的修复点');
ok(fmtDateTimeLocal('2026-08-23T09:30:45.123Z') === '2026-08-23T09:30:45',
    'ISO 带毫秒和 Z 时截到秒');

const txMgr = fs.readFileSync(path.join(ROOT, 'public/js/managers/transaction.js'), 'utf8');
ok(/transDate'\)\.value = fmtDateTimeLocal\(t\.date\)/.test(txMgr),
    '编辑回填 transDate 用 fmtDateTimeLocal');
ok(!/transDate'\)\.value = fmtDate\(/.test(txMgr),
    'transDate 不再用分钟粒度的 fmtDate');

const quickSrc = fs.readFileSync(path.join(ROOT, 'public/js/managers/quick-add.js'), 'utf8');
ok(/fmtDateTimeLocal\(\)/.test(quickSrc),
    'quickDate 改用统一函数（原先是手写拼接，逻辑重复）');

// 预算筛选的日期比较
ok(/String\(raw\)\.slice\(0,\s*10\)/.test(txMgr),
    '预算筛选先截出日期部分再比（否则区间最后一天选不到预算）');
ok(/String\(b\.end_date\)\.slice\(0,\s*10\)/.test(txMgr),
    'end_date 也统一截到 10 位');

// 行为验证：修复前后对比
const d10 = (s) => String(s).slice(0, 10);
const inRangeOld = (t, s, e) => t >= s && t <= e;
const inRangeNew = (t, s, e) => d10(t) >= d10(s) && d10(t) <= d10(e);
ok(inRangeOld('2026-08-31T10:00:00', '2026-08-01', '2026-08-31') === false,
    '（复现旧 bug）带时间直接比较时，区间最后一天为 false');
ok(inRangeNew('2026-08-31T10:00:00', '2026-08-01', '2026-08-31') === true,
    '截到日期后，区间最后一天正确命中');
ok(inRangeNew('2026-09-01T00:00:00', '2026-08-01', '2026-08-31') === false,
    '区间外仍然不命中（没有放宽边界）');

// ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(52));
console.log(`总计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
if (fail) {
    console.log('\n失败项：');
    failures.forEach(f => console.log('  • ' + f));
    process.exit(1);
}
