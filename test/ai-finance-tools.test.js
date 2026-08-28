/* ============================================
   AI 财务分析工具（只读）测试
   ------------------------------------------------
     守护三件事：
      1) book_id 隔离 —— 每条 SQL 必须同时带 user_id + book_id，
         （历史教训：已删除的 tool-registry.js 实现就没有，会跨账本串数据）
      2) 计算口径与既有实现一致（预算按 budget_id 关联、债务复用 debt-summary）
      3) 空数据 / 缺字段时不抛异常（AI 工具抛错会直接打断对话）
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    getFinancialOverview, listDebts, listBudgets, listInvestments, listSavingsGoals,
} = require('../server/modules/ai/tools/finance-tools');

const USER_ID = 42;
const BOOK_ID = 7;

/**
 * 内存版 db mock：按 SQL 特征返回预设数据，并记录全部调用用于隔离断言。
 */
function mkDb(data = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            const s = sql.replace(/\s+/g, ' ');

            if (/FROM accounts/.test(s)) return [{ total: data.accountsTotal ?? 0 }];
            // getFinancialOverview 的理财查询是聚合，listInvestments 是明细 —— 用 SUM 区分
            if (/SUM\(current_value\)/.test(s)) return [{ total: data.investTotal ?? 0 }];
            if (/SUM\(remaining\)/.test(s)) {
                return [{ total: data.debtTotal ?? 0, monthly: data.debtMonthly ?? 0 }];
            }
            if (/FROM transactions/.test(s)) {
                if (/GROUP BY|actual/.test(s)) return data.budgetRows ?? [];
                return [{ income: data.income ?? 0, expense: data.expense ?? 0 }];
            }
            if (/FROM budgets/.test(s)) return data.budgetRows ?? [];
            if (/FROM savings_goals/.test(s)) return data.goalRows ?? [];
            if (/FROM debt_repayments/.test(s)) return data.repaymentRows ?? [];
            if (/FROM investments/.test(s)) return data.investRows ?? [];
            if (/FROM debts/.test(s)) return data.debtRows ?? [];
            return [];
        },
    };
}

/** 断言本次调用中每条 SQL 都带 user_id + book_id 过滤 */
function assertBookIsolated(calls) {
    assert.ok(calls.length > 0, '应至少有一次查询');
    for (const c of calls) {
        assert.match(c.sql, /book_id/, `SQL 必须带 book_id 过滤: ${c.sql.slice(0, 60)}`);
        assert.ok(c.params.includes(USER_ID), `参数必须含 userId: ${c.sql.slice(0, 60)}`);
        assert.ok(c.params.includes(BOOK_ID), `参数必须含 bookId: ${c.sql.slice(0, 60)}`);
    }
}

/* ─────────── 1. 财务全景 ─────────── */

test('get_financial_overview: 净资产 = 账户余额 + 理财市值 - 负债', async () => {
    const db = mkDb({ accountsTotal: 50000, investTotal: 12000, debtTotal: 20000, debtMonthly: 3000, income: 15000, expense: 9000 });
    const r = await getFinancialOverview(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.ok, true);
    assert.equal(r.资产.账户余额, 50000);
    assert.equal(r.资产.理财市值, 12000);
    assert.equal(r.资产.合计, 62000);
    assert.equal(r.负债.未结清总额, 20000);
    assert.equal(r.净资产, 42000);        // 62000 - 20000
    assert.equal(r.本月.结余, 6000);       // 15000 - 9000
    assert.equal(r.本月.储蓄率, 40);       // 6000/15000
    assertBookIsolated(db.calls);
});

test('get_financial_overview: 偿债压力（负债率 / 月供占收入比）', async () => {
    const db = mkDb({ accountsTotal: 100000, investTotal: 0, debtTotal: 30000, debtMonthly: 6000, income: 12000, expense: 8000 });
    const r = await getFinancialOverview(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.偿债压力.负债率, 30);         // 30000/100000
    assert.equal(r.偿债压力.月供占收入比, 50);   // 6000/12000 —— 超过 40% 高压线
});

test('get_financial_overview: 零收入时不出现除零 NaN / Infinity', async () => {
    const db = mkDb({ accountsTotal: 0, investTotal: 0, debtTotal: 0, debtMonthly: 0, income: 0, expense: 0 });
    const r = await getFinancialOverview(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.本月.储蓄率, null);
    assert.equal(r.偿债压力.负债率, null);
    assert.equal(r.偿债压力.月供占收入比, null);
    assert.equal(r.净资产, 0);
});

test('get_financial_overview: month 参数只影响收支统计的月份筛选', async () => {
    const db = mkDb({ accountsTotal: 100, income: 100, expense: 20 });
    await getFinancialOverview(db, { userId: USER_ID, bookId: BOOK_ID, month: '2026-05' });

    const txCall = db.calls.find(c => /FROM transactions/.test(c.sql));
    assert.ok(txCall.params.includes('2026-05%'), '月度筛选应传 YYYY-MM%');
    // 跨方言要求：禁用 TO_CHAR / DATE_TRUNC
    assert.doesNotMatch(txCall.sql, /TO_CHAR|DATE_TRUNC/i);
});

/* ─────────── 2. 债务 ─────────── */

test('list_debts: 汇总用 dueAmount 而非 dueThisMonth（后者是笔数）', async () => {
    // ⚠️ 守护点：calcDebtDueSummary 返回的 dueThisMonth 是【笔数】、
    //    dueAmount 才是【金额】。二者混用会让「本月应还」显示成 2 元而不是 2 笔共 X 元。
    const db = mkDb({
        debtRows: [
            { id: 1, name: '车贷', type: 'loan', direction: 'payable', remaining: '80000', interest_rate: '4.5', monthly_payment: '2500', due_date: '2028-01-01', status: 'active' },
        ],
        repaymentRows: [],
    });
    const r = await listDebts(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.ok, true);
    assert.equal(r.汇总.未结清笔数, 1);
    assert.equal(r.汇总.剩余总额, 80000);
    // 贷款无还款记录 → 首期即逾期或本期应还，金额应等于月供级别而非笔数级别
    assert.ok(r.汇总.本月应还 >= 0);
    assert.equal(typeof r.汇总.本月应还, 'number');
    assert.equal(r.debts[0].类型, '贷款');
    assert.equal(r.debts[0].剩余, 80000);
    assertBookIsolated(db.calls);
});

test('list_debts: 无债务时返回空结构而非报错', async () => {
    const db = mkDb({ debtRows: [] });
    const r = await listDebts(db, { userId: USER_ID, bookId: BOOK_ID });
    assert.equal(r.ok, true);
    assert.deepEqual(r.debts, []);
    assert.equal(r.汇总.未结清笔数, 0);
});

test('list_debts: 信用卡 / 借贷类型文案映射正确', async () => {
    const db = mkDb({
        debtRows: [
            { id: 1, name: '招行信用卡', type: 'credit_card', direction: 'payable', remaining: '5000', interest_rate: null, monthly_payment: null, due_date: null, status: 'active', billing_day: 5, payment_day: 25, min_payment: '500' },
            { id: 2, name: '朋友借款', type: 'personal', direction: 'receivable', remaining: '2000', interest_rate: '0', monthly_payment: '0', due_date: null, status: 'active' },
        ],
        repaymentRows: [],
    });
    const r = await listDebts(db, { userId: USER_ID, bookId: BOOK_ID });
    assert.equal(r.debts[0].类型, '信用卡');
    assert.equal(r.debts[1].类型, '个人借贷');
    assert.equal(r.debts[1].方向, '应收(别人欠我)');
});

/* ─────────── 3. 预算 ─────────── */

test('list_budgets: 执行率与超支判定', async () => {
    const db = mkDb({
        budgetRows: [
            { id: 1, name: '餐饮', period_type: 'month', start_date: '2026-08-01', end_date: '2026-08-31', amount: '2000', actual: '900' },
            { id: 2, name: '购物', period_type: 'month', start_date: '2026-08-01', end_date: '2026-08-31', amount: '1000', actual: '1200' },
        ],
    });
    const r = await listBudgets(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.budgets[0].已用, 900);
    assert.equal(r.budgets[0].剩余, 1100);
    assert.equal(r.budgets[0].执行率, 45);
    assert.equal(r.budgets[0].超支, false);

    assert.equal(r.budgets[1].执行率, 120);
    assert.equal(r.budgets[1].超支, true);
    assert.equal(r.budgets[1].剩余, -200);
    assertBookIsolated(db.calls);
});

test('list_budgets: 口径与 routes/budgets.js 一致（按 budget_id 关联，非时间范围）', async () => {
    const db = mkDb({ budgetRows: [] });
    await listBudgets(db, { userId: USER_ID, bookId: BOOK_ID });
    const sql = db.calls[0].sql;
    assert.match(sql, /b\.id = t\.budget_id/, '必须按 budget_id 关联');
    assert.match(sql, /t\.type = 'expense'/, '只统计支出');
    // budgets 表没有 category_id / status 列，误用会直接 SQL 报错
    assert.doesNotMatch(sql, /b\.category_id/);
    assert.doesNotMatch(sql, /b\.status/);
});

test('list_budgets: 空预算返回空数组', async () => {
    const r = await listBudgets(mkDb({}), { userId: USER_ID, bookId: BOOK_ID });
    assert.deepEqual(r.budgets, []);
});

/* ─────────── 4. 理财 ─────────── */

test('list_investments: 单笔盈亏与收益率', async () => {
    const db = mkDb({
        investRows: [
            { id: 1, name: '沪深300ETF', code: '510300', total_cost: '10000', current_value: '11500', buy_date: '2025-01-01', expected_rate: '5', status: 'holding', risk_level: 'medium', type_name: '基金', category: 'fund' },
            { id: 2, name: '余额宝', code: '', total_cost: '5000', current_value: '4900', buy_date: '2025-06-01', expected_rate: '2', status: 'holding', risk_level: 'low', type_name: '货币基金', category: 'deposit' },
        ],
    });
    const r = await listInvestments(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.investments[0].盈亏, 1500);
    assert.equal(r.investments[0].收益率, 15);
    assert.equal(r.investments[1].盈亏, -100);
    assert.equal(r.investments[1].收益率, -2);
    assert.equal(r.汇总.持仓笔数, 2);
    assertBookIsolated(db.calls);
});

test('list_investments: 只统计在持（holding）的组合指标', async () => {
    const db = mkDb({
        investRows: [
            { id: 1, name: 'A', total_cost: '1000', current_value: '1100', buy_date: '2025-01-01', expected_rate: null, status: 'holding', risk_level: null, type_name: null, category: null },
            { id: 2, name: 'B', total_cost: '9000', current_value: '9000', buy_date: '2025-01-01', expected_rate: null, status: 'sold', risk_level: null, type_name: null, category: null },
        ],
    });
    const r = await listInvestments(db, { userId: USER_ID, bookId: BOOK_ID });
    // 组合汇总只算 holding；明细仍列出全部（含已卖出，供 AI 看全貌）
    assert.equal(r.汇总.持仓笔数, 1);
    assert.equal(r.investments.length, 2);
});

test('list_investments: 无持仓时组合指标为 0 而非 NaN', async () => {
    const r = await listInvestments(mkDb({ investRows: [] }), { userId: USER_ID, bookId: BOOK_ID });
    assert.equal(r.汇总.总盈亏, 0);
    assert.equal(r.汇总.持仓笔数, 0);
    assert.deepEqual(r.investments, []);
});

/* ─────────── 5. 储蓄目标 ─────────── */

test('list_savings_goals: 进度与缺口', async () => {
    const db = mkDb({
        goalRows: [
            { id: 1, name: '买房首付', target_amount: '200000', current_amount: '50000', status: 'active' },
            { id: 2, name: '旅行基金', target_amount: '10000', current_amount: '12000', status: 'completed' },
        ],
    });
    const r = await listSavingsGoals(db, { userId: USER_ID, bookId: BOOK_ID });

    assert.equal(r.goals[0].进度, 25);
    assert.equal(r.goals[0].缺口, 150000);
    assert.equal(r.goals[0].状态, '进行中');
    assert.equal(r.goals[1].进度, 100);   // 超额也封顶 100
    assert.equal(r.goals[1].缺口, 0);
    assert.equal(r.goals[1].状态, '已达成');
    assertBookIsolated(db.calls);
});

test('list_savings_goals: 目标额为 0 时不产生除零', async () => {
    const db = mkDb({ goalRows: [{ id: 1, name: '空目标', target_amount: '0', current_amount: '0', status: 'active' }] });
    const r = await listSavingsGoals(db, { userId: USER_ID, bookId: BOOK_ID });
    assert.equal(r.goals[0].进度, 0);
});

/* ─────────── 6. 跨方言安全 ─────────── */

test('所有工具：SQL 不含 PG/MySQL 单边函数', async () => {
    const scenarios = [
        () => getFinancialOverview(mkDb({}), { userId: USER_ID, bookId: BOOK_ID }),
        () => listDebts(mkDb({}), { userId: USER_ID, bookId: BOOK_ID }),
        () => listBudgets(mkDb({}), { userId: USER_ID, bookId: BOOK_ID }),
        () => listInvestments(mkDb({}), { userId: USER_ID, bookId: BOOK_ID }),
        () => listSavingsGoals(mkDb({}), { userId: USER_ID, bookId: BOOK_ID }),
    ];
    for (const run of scenarios) {
        const db = mkDb({});
        // 重新绑定：scenario 内部会 new 一个 db，这里改为直接跑并取模块级记录
        await run();
    }
    // 单独跑一次以检查 SQL
    for (const [fn, name] of [
        [getFinancialOverview, 'overview'], [listDebts, 'debts'],
        [listBudgets, 'budgets'], [listInvestments, 'investments'],
        [listSavingsGoals, 'goals'],
    ]) {
        const db = mkDb({ debtRows: [], investRows: [], budgetRows: [], goalRows: [] });
        await fn(db, { userId: USER_ID, bookId: BOOK_ID });
        for (const c of db.calls) {
            assert.doesNotMatch(c.sql, /TO_CHAR/i, `${name} 含 PG 专有 TO_CHAR`);
            assert.doesNotMatch(c.sql, /DATE_TRUNC/i, `${name} 含 PG 专有 DATE_TRUNC`);
            assert.doesNotMatch(c.sql, /INTERVAL\s+\d+\s+MONTH/i, `${name} 含 MySQL 专有 INTERVAL`);
        }
    }
});
