/**
 * 一次性数据修复脚本：把 total_cost 里被「红利再投」错误累加的金额扣掉。
 *
 * 背景（2026-09-07）：
 *   旧版 server/routes/transactions.js 的 recomputeInvestmentPosition 把 'reinvest'
 *   与 'buy' 合并到同一个分支，既累加份额 (qty) 又累加成本基数 (cost += amount)，
 *   导致「投入本金」被人为放大，「浮动盈亏 / 收益率 / 年化」全部被抵消为 0%。
 *
 *   正确的语义应是：reinvest 只是持仓内部转换（利息立即再投，不进现金也不扣现金），
 *   只应增 qty、不应动 cost。本次修复后端逻辑后，旧数据里被污染的 total_cost
 *   也要一次性纠正。
 *
 * 工作机制：
 *   - 不依赖后端路由，直接按 investment_transactions 全量流水重算 qty + cost
 *     （逻辑与修复后的 recomputeInvestmentPosition 保持一致：buy → 累加、sell → 扣减、
 *      reinvest → 仅 +qty、interest/dividend → 不影响）。
 *   - 默认 dry-run：只 print 差异，不写库，确认无误后加 --apply 才 UPDATE。
 *   - 幂等：修正后再次执行应「全部持仓无需修复」。
 *
 * 用法：
 *   node scripts/fix-reinvest-cost-contamination.js              # 预演
 *   node scripts/fix-reinvest-cost-contamination.js --apply      # 真正写库
 */
require('dotenv').config();
const db = require('../server/db');

const APPLY = process.argv.includes('--apply');

// 与 server/routes/transactions.js#recomputeInvestmentPosition（修复后）保持完全一致的口径
function computeExpected(txns, currentPrice) {
    let qty = 0, cost = 0;
    for (const t of txns) {
        const q = parseFloat(t.quantity) || 0;
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'buy') {
            qty += q;
            cost += amt;
        } else if (t.type === 'reinvest') {
            // 红利再投：只 +qty，不动 cost
            qty += q;
        } else if (t.type === 'sell') {
            cost -= amt;
            qty -= q;
        }
        // interest / dividend 不影响持仓
    }
    if (qty < 0) qty = 0;
    // 注意：cost 可为负（减仓把本金拿回后剩余持仓成本变负），不做归零
    const cp = parseFloat(currentPrice) || 0;
    return {
        qty,
        cost,
        currentValue: qty * cp,
        buyPrice: qty > 0 ? cost / qty : 0,
    };
}

(async () => {
    const invs = await db.query(
        `SELECT id, user_id, book_id, name, quantity, total_cost, current_price, current_value, buy_price
           FROM investments
          ORDER BY user_id, book_id, id`
    );

    let scanned = 0;
    let fixed = 0;
    let totalCostDelta = 0;
    let totalQtyDelta = 0;
    const dirty = [];

    for (const inv of invs) {
        scanned++;
        const txns = await db.query(
            `SELECT type, amount, quantity
               FROM investment_transactions
              WHERE investment_id = ? AND user_id = ?
              ORDER BY date ASC, id ASC`,
            [inv.id, inv.user_id]
        );
        const expected = computeExpected(txns, inv.current_price);

        const oldQty = parseFloat(inv.quantity) || 0;
        const oldCost = parseFloat(inv.total_cost) || 0;
        const qtyDelta = Math.abs(expected.qty - oldQty);
        const costDelta = Math.abs(expected.cost - oldCost);

        if (qtyDelta < 0.0001 && costDelta < 0.01) continue; // 无差异，跳过

        // 量化"旧版 bug 贡献了多少"：本次修复要纠正的金额 = oldCost - expected.cost
        const costShift = oldCost - expected.cost;
        const qtyShift = expected.qty - oldQty;
        fixed++;
        totalCostDelta += costShift;
        totalQtyDelta += qtyShift;
        dirty.push({ inv, oldQty, oldCost, expected, costShift, qtyShift });

        const tag = APPLY ? '[FIX ]' : '[DRY ]';
        console.log(
            `${tag} #${inv.id} user=${inv.user_id} book=${inv.book_id} ${inv.name || ''}: ` +
            `cost ${oldCost.toFixed(2)} → ${expected.cost.toFixed(2)} (Δ ${costShift >= 0 ? '+' : ''}${costShift.toFixed(2)}), ` +
            `qty ${oldQty} → ${expected.qty}`
        );

        if (APPLY) {
            await db.query(
                `UPDATE investments
                    SET quantity = ?, total_cost = ?, current_value = ?, buy_price = ?
                  WHERE id = ? AND user_id = ? AND book_id = ?`,
                [
                    expected.qty,
                    expected.cost,
                    expected.currentValue,
                    expected.buyPrice,
                    inv.id,
                    inv.user_id,
                    inv.book_id,
                ]
            );
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`扫描持仓 ${scanned} 个，${APPLY ? '已修复' : '需要修复'} ${fixed} 个`);
    if (fixed > 0) {
        console.log(`累计 total_cost 减除 ¥${totalCostDelta.toFixed(2)}（被旧版错误计入的 reinvest 金额）`);
        console.log(`累计 quantity 净变化 ${totalQtyDelta >= 0 ? '+' : ''}${totalQtyDelta.toFixed(4)} 份`);
    }
    if (!APPLY) {
        if (fixed > 0) {
            console.log('');
            console.log('以上为 dry-run 预演，尚未写库。确认无误后加 --apply 真正 UPDATE：');
            console.log('  node scripts/fix-reinvest-cost-contamination.js --apply');
        } else {
            console.log('所有持仓成本基数已经正确，无需修复。');
        }
    } else {
        console.log('');
        console.log('已写入数据库。投资详情页的「投入本金 / 浮动盈亏 / 收益率 / 年化」会自动反映正确数值。');
    }
    process.exit(0);
})().catch((e) => {
    console.error('脚本异常:', e);
    process.exit(1);
});