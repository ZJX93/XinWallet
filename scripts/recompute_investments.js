// 一次性脚本：用最新成本口径（卖出按回款全额扣成本）对所有持仓重算。
// 仅修正因算法变更而过时的快照，不改变任何流水数据。幂等。
// 审计 H3 修复：占位符原用 PG 专有 $1，DB_DIALECT=mysql 下必错；统一为 ?
// 审计 L4 修复：dotenv 显式指向仓库根 .env，避免从其他目录运行时静默读错配置。
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../server/db');
const router = require('../server/routes/transactions');
const recompute = router.recomputeInvestmentPosition;

(async () => {
  const invs = await db.query('SELECT id, user_id, name FROM investments ORDER BY id');
  let changed = 0;
  for (const inv of invs) {
    const before = await db.queryOne('SELECT quantity, total_cost, buy_price, current_value, status FROM investments WHERE id=?', [inv.id]);
    await recompute(db, inv.id, inv.user_id);
    const after = await db.queryOne('SELECT quantity, total_cost, buy_price, current_value, status FROM investments WHERE id=?', [inv.id]);
    const cb = parseFloat(before.total_cost) || 0, ca = parseFloat(after.total_cost) || 0;
    if (Math.abs(cb - ca) > 1e-6) {
      changed++;
      console.info(`[变更] id=${inv.id} ${inv.name}: cost ${before.total_cost} -> ${after.total_cost}, qty ${before.quantity} -> ${after.quantity}, status ${before.status} -> ${after.status}`);
    }
  }
  console.info(`\n完成：共 ${invs.length} 只持仓，成本发生变动 ${changed} 只。`);
  await db.pool.end();
})().catch(e => { console.error('ERR', e); process.exit(1); });
