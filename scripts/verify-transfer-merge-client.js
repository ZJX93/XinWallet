/**
 * 验证 web 端 mergeTransferPairs 对「服务端已折叠」和「服务端未折叠」两种
 * 返回形态都能正确渲染成一条 A → B。
 *
 * 为什么需要这个脚本：
 * 服务端在 SQL 层折叠转账后（transactions.js：命中配对 out 腿的 transfer_in
 * 不再返回），web 端原有的 mergeTransferPairs 靠「列表里同时存在两条腿」
 * 来配对，配对失败会 fall through 到 result.push(t)，渲染时
 * t._transferIn 为 undefined → 界面显示「工资卡 → ?」。
 *
 * 这是一个**只在部署新服务端后才暴露**的回归，本地用旧服务端测不出来，
 * 所以必须用脚本钉住两种形态。
 *
 * 运行：node scripts/verify-transfer-merge-client.js
 */

const fs = require('fs');
const path = require('path');

// —— 从 public/js/app.js 里抽出 mergeTransferPairs 求值（该文件是浏览器脚本，
//    直接 require 会因为引用 window/document 而崩） ——
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const start = appSrc.indexOf('function mergeTransferPairs');
if (start < 0) {
    console.error('✗ 在 public/js/app.js 里找不到 mergeTransferPairs');
    process.exit(1);
}
// 从函数起点往后找到匹配的右花括号
let depth = 0, end = -1;
for (let i = appSrc.indexOf('{', start); i < appSrc.length; i++) {
    if (appSrc[i] === '{') depth++;
    else if (appSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const fnSrc = appSrc.slice(start, end);
// eslint-disable-next-line no-new-func
const mergeTransferPairs = new Function(`${fnSrc}; return mergeTransferPairs;`)();

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.info(`  ✓ ${name}`); }
    else { fail++; console.info(`  ✗ ${name}${extra ? '  → ' + JSON.stringify(extra) : ''}`); }
}

/* ============ 1. 新服务端：已折叠，只有 out 腿 + transfer 字段 ============ */
console.info('\n[1] 新服务端（SQL 已折叠，列表只有 out 腿）');
{
    const list = [
        {
            id: 101, type: 'transfer_out', amount: 1000, date: '2026-08-20 10:00:00',
            note: '转账至余额宝', transfer_id: 7,
            account: { id: 1, name: '工资卡' },
            transfer: { id: 7, from: { id: 1, name: '工资卡' }, to: { id: 2, name: '余额宝' } }
        },
        { id: 102, type: 'expense', amount: 30, date: '2026-08-20 09:00:00', account: { id: 1, name: '工资卡' } }
    ];
    const merged = mergeTransferPairs(list);
    check('折叠数据合并后仍是 2 条（转账 1 条 + 支出 1 条）', merged.length === 2, merged.length);
    const tr = merged.find(x => x.transfer_id === 7);
    check('转账记录带 _merged 标记', tr && tr._merged === true);
    check('_transferOut.account.name = 工资卡', tr && tr._transferOut?.account?.name === '工资卡', tr && tr._transferOut?.account);
    check('_transferIn.account.name = 余额宝（关键：折叠后仍能拿到对方）',
        tr && tr._transferIn?.account?.name === '余额宝', tr && tr._transferIn?.account);
    check('渲染出的 A → B 不含问号',
        tr && `${tr._transferOut?.account?.name} → ${tr._transferIn?.account?.name}` === '工资卡 → 余额宝');
    check('金额取正', tr && tr.amount === 1000, tr && tr.amount);
    check('编辑用的 id 是 out 腿 id', tr && (tr._transferOut?.id ?? tr.id) === 101);
}

/* ============ 2. 旧服务端：未折叠，两条腿都在（兜底路径） ============ */
console.info('\n[2] 旧服务端（未折叠，两条腿都返回）');
{
    const list = [
        {
            id: 101, type: 'transfer_out', amount: 1000, date: '2026-08-20 10:00:00',
            transfer_id: 7, account: { id: 1, name: '工资卡' }
        },
        {
            id: 102, type: 'transfer_in', amount: 1000, date: '2026-08-20 10:00:00',
            transfer_id: 7, account: { id: 2, name: '余额宝' }
        }
    ];
    const merged = mergeTransferPairs(list);
    check('两条腿合并成 1 条', merged.length === 1, merged.length);
    const tr = merged[0];
    check('from = 工资卡', tr._transferOut?.account?.name === '工资卡');
    check('to = 余额宝', tr._transferIn?.account?.name === '余额宝');
}

/* ============ 3. 手动单边入账：transfer_id 为 NULL，必须原样保留 ============ */
console.info('\n[3] 手动单边入账（transfer_id 为 NULL）');
{
    const list = [
        { id: 201, type: 'transfer_in', amount: 500, date: '2026-08-19 12:00:00', transfer_id: null, account: { id: 2, name: '余额宝' } }
    ];
    const merged = mergeTransferPairs(list);
    check('原样保留 1 条', merged.length === 1);
    check('不带 _merged（没有配对可合）', !merged[0]._merged);
    check('不会凭空造出 _transferIn', merged[0]._transferIn === undefined);
}

/* ============ 4. 残留 in 腿（out 已被删）：必须仍可见 ============ */
console.info('\n[4] 残留 in 腿（out 腿已被删除的历史脏数据）');
{
    const list = [
        { id: 301, type: 'transfer_in', amount: 800, date: '2026-08-18 08:00:00', transfer_id: 9, account: { id: 2, name: '余额宝' } }
    ];
    const merged = mergeTransferPairs(list);
    check('仍然保留（不能人间蒸发，否则用户无法删除它）', merged.length === 1);
    check('id 保持原样，可用于删除', merged[0].id === 301);
}

/* ============ 5. transfer 字段不完整（账户被删）：走兜底不崩 ============ */
console.info('\n[5] transfer 字段缺 to（账户被删，服务端给 null）');
{
    const list = [
        {
            id: 401, type: 'transfer_out', amount: 200, date: '2026-08-17 08:00:00',
            transfer_id: 11, account: { id: 1, name: '工资卡' },
            transfer: { id: 11, from: { id: 1, name: '工资卡' }, to: null }
        }
    ];
    const merged = mergeTransferPairs(list);
    check('不进入折叠路径（to 缺失）', !merged[0]._merged || merged[0]._transferIn?.account == null);
    check('不抛异常且保留记录', merged.length === 1);
}

/* ============ 6. 多笔转账互不串台 ============ */
console.info('\n[6] 同一天多笔折叠转账');
{
    const list = [
        {
            id: 501, type: 'transfer_out', amount: 100, date: '2026-08-16 10:00:00', transfer_id: 21,
            account: { id: 1, name: 'A' }, transfer: { id: 21, from: { id: 1, name: 'A' }, to: { id: 2, name: 'B' } }
        },
        {
            id: 502, type: 'transfer_out', amount: 300, date: '2026-08-16 11:00:00', transfer_id: 22,
            account: { id: 2, name: 'B' }, transfer: { id: 22, from: { id: 2, name: 'B' }, to: { id: 3, name: 'C' } }
        }
    ];
    const merged = mergeTransferPairs(list);
    check('保留 2 条', merged.length === 2, merged.length);
    const m1 = merged.find(x => x.transfer_id === 21);
    const m2 = merged.find(x => x.transfer_id === 22);
    check('第 1 笔 A → B', m1._transferOut.account.name === 'A' && m1._transferIn.account.name === 'B');
    check('第 2 笔 B → C', m2._transferOut.account.name === 'B' && m2._transferIn.account.name === 'C');
    check('金额不串台', m1.amount === 100 && m2.amount === 300);
}

/* ============ 7. 混合形态（折叠 + 未折叠同时出现） ============ */
console.info('\n[7] 混合：一笔已折叠 + 一笔仍是两条腿');
{
    const list = [
        {
            id: 601, type: 'transfer_out', amount: 100, date: '2026-08-15 10:00:00', transfer_id: 31,
            account: { id: 1, name: 'A' }, transfer: { id: 31, from: { id: 1, name: 'A' }, to: { id: 2, name: 'B' } }
        },
        { id: 602, type: 'transfer_out', amount: 200, date: '2026-08-15 11:00:00', transfer_id: 32, account: { id: 2, name: 'B' } },
        { id: 603, type: 'transfer_in', amount: 200, date: '2026-08-15 11:00:00', transfer_id: 32, account: { id: 3, name: 'C' } }
    ];
    const merged = mergeTransferPairs(list);
    check('3 条输入合并成 2 条', merged.length === 2, merged.length);
    check('两条都是 _merged', merged.every(x => x._merged === true));
    check('没有任何一端是 undefined',
        merged.every(x => x._transferOut?.account?.name && x._transferIn?.account?.name));
}

console.info(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
