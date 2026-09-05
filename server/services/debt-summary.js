/* ============================================
   鑫钱包 · 债务汇总纯逻辑（无副作用，可在 Node 直接 require 测试）
   ============================================ */

function fmtDateOnly(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) {
        return v.getFullYear() + '-' +
            String(v.getMonth() + 1).padStart(2, '0') + '-' +
            String(v.getDate()).padStart(2, '0');
    }
    return String(v).slice(0, 10);
}

/**
 * 计算「本月需还款」与「逾期」。按债务类型区分逻辑：
 *
 * 【贷款类 loan/personal/other + monthly_payment > 0】
 *   FIFO 先进先出：从首期逐月到当前月，还款优先冲抵最早未还期。
 *
 * 【信用卡 credit_card】
 *   基于账单日(billing_day) / 还款日(payment_day) 判断当前账单周期。
 *   - 当前账单周期 = 上月 billing_day ~ 本月 billing_day 前一日
 *   - 该周期还款截止 = 本月 payment_day
 *   - 若今天 >= 还款截止日 且该周期未还清 → 逾期
 *   - 若今天 < 还款截止日 → 本月需还（还没到期）
 *   - 逾期金额用 min_payment（最低还款额），本月需还用 min_payment
 *
 * - activeDebts: 进行中债务数组
 * - repaymentsByDebt: { [debtId]: [{ amount, paid_at }, ...] }
 * - todayStr: 'YYYY-MM-DD'
 */
function calcDebtDueSummary(activeDebts, repaymentsByDebt, todayStr) {
    const [ty, tm] = todayStr.slice(0, 7).split('-').map(Number);
    const curYm = `${ty}-${String(tm).padStart(2, '0')}`;
    let dueThisMonth = 0;
    let dueAmount = 0;
    let overdue = 0;
    let overdueAmount = 0;
    // 多币种 P2-2d：按债务 currency 分组累计 dueAmount / overdueAmount
    const dueAmountBreakdown = {};
    const overdueAmountBreakdown = {};
    const addBreakdown = (map, currency, amount) => {
        const cur = currency || 'CNY';
        map[cur] = (parseFloat(map[cur]) || 0) + amount;
    };

    activeDebts.forEach(d => {
        const remaining = parseFloat(d.remaining) || 0;
        if (remaining <= 0) return;

        const type = (d.type || '').toLowerCase();
        const cur = (d.currency || 'CNY').toUpperCase();  // 多币种 P2-2d：每笔债务的货币

        if (type === 'credit_card') {
            // ===== 信用卡：按账单周期判断 =====
            const billingDay = parseInt(d.billing_day) || null;
            const paymentDay = parseInt(d.payment_day) || null;
            if (!billingDay || !paymentDay) return;

            const minPmt = parseFloat(d.min_payment) || remaining;
            const reps = repaymentsByDebt[d.id] || [];

            // 当前账单周期：上月 billing_day 出账 → 本月 payment_day 还款
            // 还款截止日字符串
            const lastDayOfPayMonth = new Date(ty, tm, 0).getDate();
            const payDay = Math.min(paymentDay, lastDayOfPayMonth);
            const cutoff = `${curYm}-${String(payDay).padStart(2, '0')}`;

            // 检查本月是否有还款
            const curMonthReps = reps.filter(r => {
                const paidAt = fmtDateOnly(r.paid_at);
                return paidAt && paidAt.startsWith(curYm);
            });
            const paidInMonth = curMonthReps.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

            if (todayStr >= cutoff) {
                // 已过还款截止日但还在本月 → 本月需还（按剩余最低还款计）
                if (paidInMonth + 0.005 < minPmt) {
                    dueThisMonth++;
                    const r = Math.max(0, minPmt - paidInMonth);
                    dueAmount += r;
                    addBreakdown(dueAmountBreakdown, cur, r);
                }
                // 已还清则不计
            } else {
                // 未到还款截止日 → 若本月账单已提前还足则不计入，
                // 否则按「剩余最低还款」计入（修复：此前无条件计入全额 minPmt，
                // 导致已提前还足的账单仍被算作本月待还）
                const remaining = Math.max(0, minPmt - paidInMonth);
                if (remaining > 0.005) {
                    dueThisMonth++;
                    dueAmount += remaining;
                    addBreakdown(dueAmountBreakdown, cur, remaining);
                }
            }

        } else {
            // ===== 贷款类：FIFO =====
            const monthly = parseFloat(d.monthly_payment) || 0;
            if (monthly <= 0) return;

            const startStr = d.start_date ? fmtDateOnly(d.start_date) : null;
            let dueDay = d.payment_day ? parseInt(d.payment_day) : null;
            if (!dueDay && startStr) {
                const sd = parseInt(startStr.slice(8, 10));
                if (!isNaN(sd)) dueDay = sd;
            }
            if (!dueDay) return;

            let sy = null, sm = null;
            if (startStr) {
                sy = parseInt(startStr.slice(0, 4));
                sm = parseInt(startStr.slice(5, 7));
            }

            // 首期 = 起始月的次月
            let fy, fm;
            if (sy !== null && sm !== null) {
                fy = sm === 12 ? sy + 1 : sy;
                fm = sm === 12 ? 1 : sm + 1;
            } else {
                fy = ty; fm = tm;
            }

            const reps = repaymentsByDebt[d.id] || [];
            let credit = reps.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

            let y = fy, m = fm;
            while (y < ty || (y === ty && m <= tm)) {
                const ym = `${y}-${String(m).padStart(2, '0')}`;
                const lastDay = new Date(y, m, 0).getDate();
                const dd = Math.min(dueDay, lastDay);

                if (credit + 0.005 >= monthly) {
                    credit -= monthly;
                } else {
                    if (ym < curYm) {
                        overdue++;
                        overdueAmount += monthly;
                        addBreakdown(overdueAmountBreakdown, cur, monthly);
                    } else {
                        dueThisMonth++;
                        dueAmount += monthly;
                        addBreakdown(dueAmountBreakdown, cur, monthly);
                    }
                }
                m++;
                if (m > 12) { m = 1; y++; }
            }
        }
    });

    // 多币种 P2-2d：breakdown 数字保留两位小数
    Object.keys(dueAmountBreakdown).forEach(k => { dueAmountBreakdown[k] = Math.round(dueAmountBreakdown[k] * 100) / 100; });
    Object.keys(overdueAmountBreakdown).forEach(k => { overdueAmountBreakdown[k] = Math.round(overdueAmountBreakdown[k] * 100) / 100; });

    return {
        dueThisMonth,
        dueAmount: Math.round(dueAmount * 100) / 100,
        overdue,
        overdueAmount: Math.round(overdueAmount * 100) / 100,
        // 多币种 P2-2d：breakdown 按 currency 分组
        dueAmountBreakdown,
        overdueAmountBreakdown
    };
}

module.exports = { calcDebtDueSummary };
