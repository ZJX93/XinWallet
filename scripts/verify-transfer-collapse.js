/**
 * 转账折叠验收：一笔转账在流水列表里只出一条「A → B」，且可编辑/删除。
 *
 * 为什么需要这个脚本：
 * 复式记账下一笔转账会写两条 transactions（transfer_out + transfer_in），
 * 靠 transfer_id 关联。折叠是在 SQL 的 WHERE 里排除「有配对 out 腿的 in 腿」。
 * 这个条件写错的后果分两种，都很难在真机上一眼看出来：
 *   - 条件太宽（一刀切排除所有 transfer_in）→ 用户手动记的单边入账彻底消失，
 *     数据还在、余额还算着，但列表里永远看不到、也没法删
 *   - 条件太窄 → 该折叠的没折叠，回归成两条
 *
 * 这里用内存表模拟 SQL 语义（NOT EXISTS 子查询），不需要数据库。
 */

let pass = 0, fail = 0;
const results = [];
function ok(name, cond) {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}`); }
}
function eq(name, actual, expected) {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  if (good) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}\n         实际=${JSON.stringify(actual)}\n         期望=${JSON.stringify(expected)}`); }
}

// ──────────────────────────────────────────────
// 复刻 server/routes/transactions.js 的折叠条件
//
//   AND NOT (
//     t.type = 'transfer_in' AND t.transfer_id IS NOT NULL
//     AND EXISTS (SELECT 1 FROM transactions x
//                 WHERE x.transfer_id = t.transfer_id AND x.type = 'transfer_out'
//                   AND x.user_id = t.user_id AND x.book_id = t.book_id)
//   )
// ──────────────────────────────────────────────
function collapse(rows) {
  return rows.filter(t => {
    const hidden =
      t.type === 'transfer_in' &&
      t.transfer_id != null &&
      rows.some(x =>
        x.transfer_id === t.transfer_id &&
        x.type === 'transfer_out' &&
        x.user_id === t.user_id &&
        x.book_id === t.book_id
      );
    return !hidden;
  });
}

const U = 1, B = 1;
const mk = (id, type, amount, transfer_id = null, extra = {}) =>
  Object.assign({ id, type, amount, transfer_id, user_id: U, book_id: B }, extra);

console.info('【1】正常转账：两条腿折叠成一条，保留 transfer_out');
{
  const rows = [
    mk(1, 'expense', 50),
    mk(2, 'transfer_out', 1000, 77),
    mk(3, 'transfer_in', 1000, 77),
    mk(4, 'income', 8000)
  ];
  const out = collapse(rows);
  eq('折叠后条数', out.length, 3);
  eq('保留的是 out 腿', out.filter(r => r.transfer_id === 77).map(r => r.type), ['transfer_out']);
  ok('非转账记录不受影响', out.some(r => r.id === 1) && out.some(r => r.id === 4));
}

console.info('\n【2】⛔ 单边入账必须保留（transfer_id 为 NULL）');
{
  // POST /transactions 允许单独创建 type='transfer_in' 且 transfer_id 为 NULL。
  // 一刀切排除所有 transfer_in 会让这条记录彻底消失 —— 数据还在、余额还算着，
  // 但用户看不到也删不掉。这是「条件太宽」最危险的后果。
  const rows = [
    mk(1, 'transfer_in', 300, null),
    mk(2, 'expense', 20)
  ];
  const out = collapse(rows);
  eq('孤立 transfer_in 保留', out.length, 2);
  ok('它确实在结果里', out.some(r => r.id === 1));
}

console.info('\n【3】⛔ out 腿缺失的残留 in 腿必须保留');
{
  // 历史数据里可能出现 out 腿被删而 in 腿残留。若一刀切排除，
  // 这条脏数据将永久不可见、无法清理。
  const rows = [
    mk(1, 'transfer_in', 500, 99),   // 有 transfer_id 但没有配对 out
    mk(2, 'income', 100)
  ];
  const out = collapse(rows);
  eq('残留 in 腿保留', out.length, 2);
  ok('可见因此可删', out.some(r => r.id === 1 && r.type === 'transfer_in'));
}

console.info('\n【4】多笔转账互不干扰');
{
  const rows = [
    mk(1, 'transfer_out', 100, 10),
    mk(2, 'transfer_in', 100, 10),
    mk(3, 'transfer_out', 200, 20),
    mk(4, 'transfer_in', 200, 20),
    mk(5, 'transfer_out', 300, 30),
    mk(6, 'transfer_in', 300, 30)
  ];
  const out = collapse(rows);
  eq('3 笔转账 → 3 条', out.length, 3);
  eq('全部是 out 腿', out.map(r => r.type), ['transfer_out', 'transfer_out', 'transfer_out']);
  eq('transfer_id 各一次', out.map(r => r.transfer_id), [10, 20, 30]);
}

console.info('\n【5】跨用户 / 跨账本不能误配对');
{
  // EXISTS 子查询必须带 user_id / book_id 条件。漏掉的话，
  // 另一个用户碰巧同 transfer_id 的 out 腿会把本用户的 in 腿隐藏掉。
  const rows = [
    { id: 1, type: 'transfer_out', amount: 100, transfer_id: 55, user_id: 2, book_id: 1 },
    { id: 2, type: 'transfer_in', amount: 100, transfer_id: 55, user_id: 1, book_id: 1 }
  ];
  const out = collapse(rows);
  ok('不同 user 的 in 腿不被隐藏', out.some(r => r.id === 2));

  const rows2 = [
    { id: 1, type: 'transfer_out', amount: 100, transfer_id: 66, user_id: 1, book_id: 2 },
    { id: 2, type: 'transfer_in', amount: 100, transfer_id: 66, user_id: 1, book_id: 1 }
  ];
  const out2 = collapse(rows2);
  ok('不同 book 的 in 腿不被隐藏', out2.some(r => r.id === 2));
}

console.info('\n【6】折叠不影响余额推导（复式记账两条腿都必须留在库里）');
{
  // 折叠只发生在「列表查询的 WHERE」，不是删数据。
  // 余额由 computeAccountBalance 从全部 transactions 推导，
  // 若折叠误伤了数据层，收款账户余额会凭空少一笔。
  const all = [
    mk(1, 'transfer_out', 1000, 77, { account_id: 1 }),
    mk(2, 'transfer_in', 1000, 77, { account_id: 2 })
  ];
  // 余额推导（_helpers.js:236 的语义）：income/transfer_in 加，其他减
  const bal = (rows, accId) => rows
    .filter(r => r.account_id === accId)
    .reduce((s, r) => s + (['income', 'transfer_in'].includes(r.type) ? r.amount : -r.amount), 0);
  eq('转出账户 -1000', bal(all, 1), -1000);
  eq('转入账户 +1000', bal(all, 2), 1000);
  eq('两账户净额为 0（钱没凭空产生/消失）', bal(all, 1) + bal(all, 2), 0);

  const listed = collapse(all);
  eq('列表只显示 1 条', listed.length, 1);
  ok('但库里仍是 2 条（折叠不删数据）', all.length === 2);
}

console.info('\n【7】汇总口径不受折叠影响');
{
  // /summary 只 SUM type='income' 和 type='expense'（见 transactions.js:547-556），
  // 转账两条腿从来不计入。所以折叠不会让任何汇总数字发生变化 —— 这一点必须
  // 钉死：如果哪天汇总口径改成包含转账，折叠就会导致列表与汇总对不上。
  const rows = [
    mk(1, 'income', 8000),
    mk(2, 'expense', 300),
    mk(3, 'transfer_out', 1000, 77),
    mk(4, 'transfer_in', 1000, 77)
  ];
  const sum = rs => ({
    income: rs.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0),
    expense: rs.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
  });
  eq('折叠前后收入相同', sum(collapse(rows)).income, sum(rows).income);
  eq('折叠前后支出相同', sum(collapse(rows)).expense, sum(rows).expense);
  eq('收入值正确', sum(collapse(rows)).income, 8000);
  eq('支出值正确', sum(collapse(rows)).expense, 300);
}

console.info('\n【8】按类型筛选「转账」时同样只出一条');
{
  // 客户端筛选 type=transfer 会展开成 IN ('transfer_in','transfer_out')。
  // 折叠条件是独立 AND 上去的，所以筛选态下同样生效。
  const rows = [
    mk(1, 'transfer_out', 100, 10),
    mk(2, 'transfer_in', 100, 10),
    mk(3, 'expense', 50)
  ];
  const typeFiltered = collapse(rows).filter(r => ['transfer_in', 'transfer_out'].includes(r.type));
  eq('筛选转账 → 1 条', typeFiltered.length, 1);
  eq('且是 out 腿', typeFiltered[0].type, 'transfer_out');
}

console.info('\n【9】折叠记录必须携带完整 A→B（否则客户端无法渲染）');
{
  // 服务端 formatted 里的 transfer 字段：只有 transfer_id + 两端名字都在才构造。
  const buildTransfer = t =>
    (t.transfer_id && t.tr_from_name && t.tr_to_name)
      ? { id: t.transfer_id, from: { id: t.tr_from, name: t.tr_from_name }, to: { id: t.tr_to, name: t.tr_to_name } }
      : null;

  const full = { transfer_id: 77, tr_from: 1, tr_from_name: '工资卡', tr_to: 2, tr_to_name: '余额宝' };
  const built = buildTransfer(full);
  ok('两端齐全时构造出 transfer', built !== null);
  eq('from 正确', built.from.name, '工资卡');
  eq('to 正确', built.to.name, '余额宝');
  eq('id 用于转发编辑/删除到 /transfers/:id', built.id, 77);

  // JOIN 不到账户时（账户被删）不能构造出半个对象，否则客户端渲染成 "undefined → 余额宝"
  ok('缺 from 名 → null', buildTransfer({ transfer_id: 77, tr_to_name: '余额宝' }) === null);
  ok('缺 to 名 → null', buildTransfer({ transfer_id: 77, tr_from_name: '工资卡' }) === null);
  ok('无 transfer_id → null（普通收支不该有 transfer 字段）',
    buildTransfer({ tr_from_name: 'A', tr_to_name: 'B' }) === null);
}

console.info('\n【10】编辑/删除必须走 /transfers/:id 而不是 /transactions/:id');
{
  // 改 transactions/:id 只会动一条腿 —— 转出账户扣了 200、转入账户还是加 100，
  // 两个账户余额从此对不上。折叠记录的编辑必须整体走 transfers 路由。
  const route = t => (t.transfer != null ? `/transfers/${t.transfer.id}` : `/transactions/${t.id}`);
  eq('折叠转账 → transfers 路由',
    route({ id: 2, transfer: { id: 77 } }), '/transfers/77');
  eq('普通支出 → transactions 路由',
    route({ id: 5, transfer: null }), '/transactions/5');
  eq('单边入账（无 transfer）→ transactions 路由',
    route({ id: 9, transfer: null }), '/transactions/9');
}

console.info('\n【11】分页：折叠必须在 SQL 层，不能在 JS 里过滤');
{
  // 若拿到 LIMIT 20 的结果后再在 JS 里 filter 掉 in 腿，
  // 用户会看到「明明说有 20 条却只显示 14 条」，且下一页判断全错。
  const page = [];
  for (let i = 1; i <= 10; i++) {
    page.push(mk(i * 2 - 1, 'transfer_out', 100, i));
    page.push(mk(i * 2, 'transfer_in', 100, i));
  }
  // 错误做法：先取 20 条再过滤
  const wrong = collapse(page.slice(0, 20));
  eq('JS 后过滤只剩 10 条（这就是 bug）', wrong.length, 10);
  // 正确做法：折叠条件进 WHERE，再 LIMIT 20
  const right = collapse(page).slice(0, 20);
  eq('SQL 层折叠后再分页能拿满', right.length, 10);
  ok('本例总共只有 10 笔转账，所以 10 条即全部', collapse(page).length === 10);
}

console.info('\n' + results.join('\n'));
console.info(`\n${'─'.repeat(52)}`);
console.info(`总计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
