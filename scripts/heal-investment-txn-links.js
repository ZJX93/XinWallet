/**
 * 一次性脚本：回填理财台账交易缺失的 investment_txn_id 指针，并列出孤儿台账。
 *
 * 背景：transactions.investment_txn_id 是后来 ALTER 补上的列（见 schema.sql 的兼容补列段），
 * 补列之前由理财操作（建仓/加仓/减仓/分红/利息）生成的台账交易没有这个指针。
 * 而删除理财流水时后端按该指针清理台账，指针缺失会导致：
 *     理财流水删掉了，账户明细里那条台账还在，账户余额也不回退。
 *
 * 本脚本做两件事：
 *   1) 回填：对现存理财流水，按「账户 + 金额 + 日期 + 收支方向」去匹配无指针的台账，
 *      唯一命中才回填；命中多条（歧义）一律跳过并报告，绝不猜测。
 *   2) 报告：悬空指针（指向已被删除的流水）与疑似孤儿台账，供人工确认后处理。
 *
 * 安全：默认 dry-run，只报告不写库；确认无误后加 --apply 才真正 UPDATE。
 * 幂等：已有指针的台账会被 WHERE investment_txn_id IS NULL 排除，重复执行无副作用。
 *
 * 用法：
 *   node scripts/heal-investment-txn-links.js          # 预演
 *   node scripts/heal-investment-txn-links.js --apply  # 执行
 */
require('dotenv').config();
const db = require('../server/db');

const APPLY = process.argv.includes('--apply');

/** 理财操作生成台账的备注特征，用于识别疑似孤儿（仅报告，不自动处理） */
const NOTE_PATTERNS = ['加仓', '卖出', '分红-', '利息-', '买入·', '建仓'];

(async () => {
  // ---------- 1) 回填缺失的指针 ----------
  const invTxns = await db.query(
    `SELECT it.id, it.investment_id, it.user_id, it.book_id, it.type, it.amount, it.date,
            inv.account_id, inv.name AS inv_name
       FROM investment_transactions it
       JOIN investments inv ON inv.id = it.investment_id
      ORDER BY it.id`
  );

  let filled = 0;
  let ambiguous = 0;
  let noMatch = 0;

  for (const it of invTxns) {
    if (!it.account_id) continue; // 持仓未绑定账户时不会生成台账，跳过
    const dir = (it.type === 'sell' || it.type === 'dividend' || it.type === 'interest') ? 'income' : 'expense';
    const cands = await db.query(
      `SELECT id, note FROM transactions
        WHERE user_id = ? AND book_id = ? AND account_id = ?
          AND type = ? AND amount = ? AND DATE(date) = DATE(?) AND investment_txn_id IS NULL
        ORDER BY id`,
      [it.user_id, it.book_id, it.account_id, dir, it.amount, it.date]
    );

    if (!cands.length) { noMatch++; continue; }
    if (cands.length > 1) {
      ambiguous++;
      console.warn(`[歧义跳过] 流水#${it.id}(${it.inv_name} ${it.type} ${it.amount}) 匹配到 ${cands.length} 条台账: ${cands.map((c) => c.id).join(',')}`);
      continue;
    }

    const tid = cands[0].id;
    console.info(`[${APPLY ? '回填' : '待回填'}] 台账#${tid} -> 理财流水#${it.id} (${it.inv_name} ${it.type} ${it.amount} ${it.date})`);
    if (APPLY) {
      await db.query(
        'UPDATE transactions SET investment_txn_id = ? WHERE id = ? AND investment_txn_id IS NULL',
        [it.id, tid]
      );
    }
    filled++;
  }

  // ---------- 2) 报告需要人工处理的部分 ----------
  // 悬空指针：指向一条已经不存在的理财流水（流水被删但台账没清理）
  const dangling = await db.query(
    `SELECT t.id, t.user_id, t.account_id, t.amount, t.date, t.note, t.investment_txn_id
       FROM transactions t
      WHERE t.investment_txn_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM investment_transactions it WHERE it.id = t.investment_txn_id)
      ORDER BY t.id`
  );

  // 疑似孤儿：备注像理财操作、但没有指针，且匹配不到任何现存流水
  const likeCls = NOTE_PATTERNS.map(() => 'note LIKE ?').join(' OR ');
  const likeParams = NOTE_PATTERNS.map((p) => `${p}%`);
  const suspects = await db.query(
    `SELECT id, user_id, account_id, amount, date, note
       FROM transactions
      WHERE investment_txn_id IS NULL AND (${likeCls})
      ORDER BY id`,
    likeParams
  );

  console.info('\n=== 汇总 ===');
  console.info(`理财流水总数 ${invTxns.length}`);
  console.info(`回填/待回填 ${filled}；歧义跳过 ${ambiguous}；无匹配 ${noMatch}（台账已删或已回填，属正常）`);
  console.info(`悬空指针台账（指向已删流水，需清理）: ${dangling.length}`);
  dangling.forEach((d) => console.info(`  [悬空] 台账#${d.id} 账户#${d.account_id} ${d.amount} ${d.date} note=${d.note || ''}`));
  console.info(`疑似孤儿台账（备注像理财操作但无指针，需人工核对）: ${suspects.length}`);
  suspects.forEach((s) => console.info(`  [疑似] 台账#${s.id} 账户#${s.account_id} ${s.amount} ${s.date} note=${s.note || ''}`));

  if (!APPLY) {
    console.info('\n当前为 dry-run，未写库。确认上面的回填清单无误后，加 --apply 执行。');
  } else {
    console.info('\n已执行回填。若上面列出了悬空/疑似孤儿台账，请在账户明细中核对后手动删除（删除后后端会按账本重算余额）。');
  }

  await db.pool.end();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
