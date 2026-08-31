// 一次性脚本：用最新成本口径（卖出按回款全额扣成本）对所有持仓重算。
// 仅修正因算法变更而过时的快照，不改变任何流水数据。幂等。
require('dotenv').config();
const path = require('path');
const db = require('../server/db');
const router = require('../server/routes/transactions');
const recompute = router.recomputeInvestmentPosition;

(async () => {
  const invs = await db.query('SELECT id, user_id, name FROM investments ORDER BY id');
  let changed = 0;
  for (const inv of invs) {
    const before = await db.queryOne('SELECT quantity, total_cost, buy_price, current_value, status FROM investments WHERE id=$1', [inv.id]);
    await recompute(db, inv.id, inv.user_id);
    const after = await db.queryOne('SELECT quantity, total_cost, buy_price, current_value, status FROM investments WHERE id=$1', [inv.id]);
    const cb = parseFloat(before.total_cost) || 0, ca = parseFloat(after.total_cost) || 0;
    if (Math.abs(cb - ca) > 1e-6) {
      changed++;
      logger.info(`[变更] id=${inv.id} ${inv.name}: cost ${before.total_cost} -> ${after.total_cost}, qty ${before.quantity} -> ${after.quantity}, status ${before.status} -> ${after.status}`);
    }
  }
  logger.info(`\n完成：共 ${invs.length} 只持仓，成本发生变动 ${changed} 只。`);
  await db.pool.end();
})().catch(e => { logger.error('ERR', e); process.exit(1); });
