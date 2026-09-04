/* 债务汇总回归测试：本月需还款 / 逾期 计算
 *
 * 历史 bug 演进：
 *  v1：旧逻辑把“进行中债务总数”当本月需还款笔数（恒不为 0），逾期用贷款最终到期日判断（恒为 0）。
 *  v2：改为按“当前自然月已还款 vs 月供”判断——但只看了当前月，未把历史漏还的期数累加进逾期。
 *      例：房贷起始 2026-01-20、每月 20 日还款，仅 7 月还了一期，则 2~6 月共 5 期早已逾期，
 *          但 v2 只检查 7 月是否已还 → 误显示 overdue=0。
 *  v3：从起贷次月起逐月核对，但还款按“真实所属月份”匹配（7 月还款只抵 7 月），
 *      导致“补还历史逾期”不会减少逾期期数（遗留项）。
 *  v4（当前）：还款分配采用 FIFO（先进先出）——一笔还款优先冲抵“最早未还的那一期”。
 *      故用户补还历史逾期时，逾期期数相应减少；无 start_date 时退化为仅看当前月。
 */
const test = require('node:test');
const assert = require('node:assert');
const { calcDebtDueSummary } = require('../server/services/debt-summary');

const EPS = 0.005;
function rep(amount, paid_at) { return { amount, paid_at }; }
function byDebt(id, list) { const m = {}; m[id] = list; return m; }
function round2(n) { return Math.round(n * 100) / 100; }

test('房贷场景：起始1月20日，仅7月还了一期 → FIFO冲抵最早未还(2月)，逾期=4(3~6月)，7月仍待还', () => {
    const debts = [{ id: 1, monthly_payment: 3459.73, remaining: 796540.27, start_date: '2026-01-20' }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(3459.73, '2026-07-20')]), '2026-07-20');
    assert.strictEqual(r.dueThisMonth, 1, '7月仍未还，计入本月需还款');
    assert.strictEqual(r.dueAmount, 3459.73);
    assert.strictEqual(r.overdue, 4, '3~6月共4期逾期（2月已被冲抵）');
    assert.strictEqual(r.overdueAmount, round2(3459.73 * 4), '逾期金额 4 × 月供');
});

test('FIFO 冲抵：7月15日还款冲抵最早未还期(2月) → 2月已清，3~6月共4期逾期，7月本月需还', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, start_date: '2026-01-15' }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(3000, '2026-07-15')]), '2026-07-20');
    assert.strictEqual(r.overdue, 4, '2月被冲抵，3~6月共4期逾期（跨月），7月属本月需还');
    assert.strictEqual(r.dueThisMonth, 1);
    assert.strictEqual(r.dueAmount, 3000);
});

test('补还即减少最早逾期：先7期未还(逾期5+本月1)，补一笔后逾期5→4', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, start_date: '2026-01-15' }];
    const before = calcDebtDueSummary(debts, byDebt(1, []), '2026-07-20');
    assert.strictEqual(before.overdue, 5, '无还款时 2~6月共5期跨月逾期');
    assert.strictEqual(before.dueThisMonth, 1, '7月本月需还');
    const after = calcDebtDueSummary(debts, byDebt(1, [rep(3000, '2026-06-10')]), '2026-07-20');
    assert.strictEqual(after.overdue, 4, '一笔还款冲抵最早未还期，逾期 5→4');
});

test('每期都已按时还 → 逾期0、本月0', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, start_date: '2026-01-15' }];
    const reps = byDebt(1, [
        rep(3000, '2026-02-15'), rep(3000, '2026-03-15'), rep(3000, '2026-04-15'),
        rep(3000, '2026-05-15'), rep(3000, '2026-06-15'), rep(3000, '2026-07-15')
    ]);
    const r = calcDebtDueSummary(debts, reps, '2026-07-20');
    assert.strictEqual(r.overdue, 0);
    assert.strictEqual(r.dueThisMonth, 0);
    assert.strictEqual(r.overdueAmount, 0);
});

test('从未还款，今天在当月还款日之前 → 逾期=5(2~6月)，本月需还款=1', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, start_date: '2026-01-15' }];
    // 起贷1月15日 → 首期2月15日；今天7月10日（7月15日尚未到）
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2026-07-10');
    assert.strictEqual(r.overdue, 5, '2~6月共5期已过期');
    assert.strictEqual(r.dueThisMonth, 1, '7月15日未到，计入本月需还款');
    assert.strictEqual(r.dueAmount, 3000);
});

test('当月还款日已过且未还 → 本月需还1笔（非逾期，跨月才算逾期）', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, start_date: '2026-01-15' }];
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2026-07-20');
    assert.strictEqual(r.overdue, 5, '2~6月共5期跨月逾期');
    assert.strictEqual(r.dueThisMonth, 1, '7月属本月需还');
    assert.strictEqual(r.dueAmount, 3000);
});

test('无 start_date → 退化为仅看当前月（付款日未到不逾期）', () => {
    const debts = [{ id: 1, monthly_payment: 3000, remaining: 100000, payment_day: 25 }];
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2025-07-20');
    assert.strictEqual(r.dueThisMonth, 1);
    assert.strictEqual(r.overdue, 0);
});

test('无月供或已结清剩余 → 跳过', () => {
    const debts = [
        { id: 1, monthly_payment: 0, remaining: 100000, start_date: '2026-01-15' },
        { id: 2, monthly_payment: 1500, remaining: 0, start_date: '2026-01-15' }
    ];
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2026-07-20');
    assert.strictEqual(r.dueThisMonth, 0);
    assert.strictEqual(r.overdue, 0);
    assert.strictEqual(r.overdueAmount, 0);
});

test('短月边界：2月29日闰年正常判定，不报错', () => {
    // dueDay=31 在2月会被裁剪到28/29，2月应还日已过应计逾期
    const debts = [{ id: 1, monthly_payment: 1000, remaining: 5000, start_date: '2025-01-31', payment_day: 31 }];
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2025-03-15');
    assert.ok(r.overdue >= 1, '2月(裁剪到28日)已过应计逾期');
});

test('start_date 为 Date 对象（仪表盘路由原始入参）也能正确解析', () => {
    // 回归：仪表盘路由直接 SELECT start_date 得到 Date 对象，
    // 若用 String(date).slice(0,10) 会得到 "Wed Jan 2..." 乱码导致退化为仅看当前月。
    const debts = [{ id: 1, monthly_payment: 3459.73, remaining: 796540.27, start_date: new Date('2026-01-20T00:00:00Z') }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(3459.73, '2026-07-20')]), '2026-07-20');
    assert.strictEqual(r.overdue, 4, 'Date 入参应同样得到 FIFO 结果 4 期逾期');
    assert.strictEqual(r.dueThisMonth, 1);
});

test('信用卡：还款日前未还 → 本月需还 1 笔（全额 min_pmt）', () => {
    const debts = [{ id: 1, type: 'credit_card', billing_day: 5, payment_day: 25, min_payment: 500, remaining: 2000 }];
    const r = calcDebtDueSummary(debts, byDebt(1, []), '2026-07-20'); // 20 < 25 未到还款日
    assert.strictEqual(r.dueThisMonth, 1);
    assert.strictEqual(r.dueAmount, 500);
});

test('信用卡：还款日前已提前还足 → 本月不再计入待还（修复点）', () => {
    const debts = [{ id: 1, type: 'credit_card', billing_day: 5, payment_day: 25, min_payment: 500, remaining: 2000 }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(500, '2026-07-10')]), '2026-07-20');
    assert.strictEqual(r.dueThisMonth, 0, '已还足则不计');
    assert.strictEqual(r.dueAmount, 0);
});

test('信用卡：还款日后已还足 → 本月不计', () => {
    const debts = [{ id: 1, type: 'credit_card', billing_day: 5, payment_day: 25, min_payment: 500, remaining: 2000 }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(500, '2026-07-26')]), '2026-07-30'); // 30 >= 25 已过截止
    assert.strictEqual(r.dueThisMonth, 0);
    assert.strictEqual(r.dueAmount, 0);
});

test('信用卡：还款日后部分还 → 按剩余最低还款计入', () => {
    const debts = [{ id: 1, type: 'credit_card', billing_day: 5, payment_day: 25, min_payment: 500, remaining: 2000 }];
    const r = calcDebtDueSummary(debts, byDebt(1, [rep(200, '2026-07-26')]), '2026-07-30');
    assert.strictEqual(r.dueThisMonth, 1);
    assert.strictEqual(r.dueAmount, 300);
});
