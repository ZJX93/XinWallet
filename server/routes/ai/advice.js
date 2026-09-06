/* ============================================
   AI 财务建议（/advice）+ 已废弃的 /insight
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, extractJson, callProvider, getActiveProvider, checkProvider, aiModule } = require('./_shared');
const router = express.Router();
router.post('/advice', async (req, res) => {
    try {
        const provider = await getActiveProvider(req.userId);
        if (!checkProvider(res, provider)) return;

        // 收集用户财务数据：本月交易汇总、预算、储蓄目标、账户、债务
        const currentMonth = new Date().toISOString().slice(0, 7);
        const [summary, budgets, goals, accounts, debts] = await Promise.all([
            db.query(
                `SELECT c.name AS category, t.type, SUM(t.amount) AS total, COUNT(*) AS cnt
                 FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
                 WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ?
                 GROUP BY c.name, t.type ORDER BY total DESC`,
                [req.userId, req.bookId, currentMonth + '%']
            ),
            db.query(
                'SELECT name, amount FROM budgets WHERE user_id = ? AND book_id = ? AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE',
                [req.userId, req.bookId]
            ),
            db.query(
                "SELECT name, target_amount, current_amount, icon FROM savings_goals WHERE user_id = ? AND book_id = ? AND status = 'active'",
                [req.userId, req.bookId]
            ),
            db.query(
                "SELECT name, balance, type FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active' ORDER BY balance DESC",
                [req.userId, req.bookId]
            ),
            db.query(
                `SELECT name, type, remaining, monthly_payment, interest_rate, method, due_date, status
                 FROM debts WHERE user_id = ? AND book_id = ? AND status != 'paid_off'`,
                [req.userId, req.bookId]
            )
        ]);

        // 也获取上月数据用于环比
        const prevMonth = (() => {
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            return d.toISOString().slice(0, 7);
        })();
        const prevSummary = await db.query(
            `SELECT c.name AS category, t.type, SUM(t.amount) AS total
             FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ?
             GROUP BY c.name, t.type ORDER BY total DESC`,
            [req.userId, req.bookId, prevMonth + '%']
        );

        const curExpense = summary.filter(r => r.type === 'expense').reduce((s, r) => s + parseFloat(r.total), 0);
        const curIncome = summary.filter(r => r.type === 'income').reduce((s, r) => s + parseFloat(r.total), 0);
        const prevExpense = prevSummary.filter(r => r.type === 'expense').reduce((s, r) => s + parseFloat(r.total), 0);
        const momRate = prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense * 100).toFixed(1) : null;

        // 计算总负债和月供
        const totalDebt = debts.reduce((s, d) => s + parseFloat(d.remaining || 0), 0);
        const totalMonthlyPayment = debts.reduce((s, d) => s + parseFloat(d.monthly_payment || 0), 0);
        const totalAssets = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets * 100).toFixed(1) : '0';

        const context = {
            本月: currentMonth,
            本月收入: Math.round(curIncome * 100) / 100,
            本月支出: Math.round(curExpense * 100) / 100,
            收支比: curIncome > 0 ? (curExpense / curIncome * 100).toFixed(0) + '%' : '无收入',
            支出环比: momRate !== null ? `${momRate > 0 ? '+' : ''}${momRate}%` : '无上月数据',
            分类收支: summary.map(r => ({ 类别: r.category, 类型: r.type, 金额: Math.round(parseFloat(r.total) * 100) / 100, 笔数: r.cnt })),
            预算: budgets.map(b => ({ 名称: b.name, 预算额: Math.round(parseFloat(b.amount) * 100) / 100 })),
            储蓄目标: goals.map(g => ({ 名称: g.name, 目标: Math.round(parseFloat(g.target_amount) * 100) / 100, 当前: Math.round(parseFloat(g.current_amount) * 100) / 100, 进度: Math.round(parseFloat(g.current_amount) / Math.max(1, parseFloat(g.target_amount)) * 100) + '%' })),
            账户: accounts.map(a => ({ 名称: a.name, 余额: Math.round(parseFloat(a.balance) * 100) / 100, 类型: a.type })),
            债务: {
                总负债: Math.round(totalDebt * 100) / 100,
                月供应付: Math.round(totalMonthlyPayment * 100) / 100,
                负债资产比: debtToAssetRatio + '%',
                明细: debts.map(d => ({
                    名称: d.name,
                    类型: d.type === 'credit_card' ? '信用卡' : d.type === 'loan' ? '贷款' : d.type === 'personal' ? '个人借贷' : '其他',
                    剩余: Math.round(parseFloat(d.remaining || 0) * 100) / 100,
                    月供: Math.round(parseFloat(d.monthly_payment || 0) * 100) / 100,
                    状态: d.status === 'overdue' ? '逾期' : '正常'
                }))
            },
            上月支出: Math.round(prevExpense * 100) / 100
        };

        // 自动故障转移：服务商不可用时沿候选链自动切换，用户无需手动改配置
        const chain = await aiModule.resolveProviderChain(req.userId);
        const { result: content } = await aiModule.callWithFailover(
            chain.length ? chain : [provider],
            (p) => callProvider(p, [
                {
                    role: 'system',
                    content: `你是一位资深个人理财顾问。基于用户完整财务数据，一次性输出两段：
1) insights 观察型分析 3-5 条：本月发生了什么（异常、环比、债务负担、储蓄率、资金健康度）
2) advice 建议型条目 3-5 条：下月怎么做（可量化动作、含 impact 预期效果）

要求（两段均须遵守）：
1. insights 优先针对真实风险（某类超支、环比激增、预算执行率异常、储蓄目标滞后、负债过高、逾期风险）
2. 若用户有负债，必须分析负债资产比（>50%警戒）、月供占收入比（>40%高压）、逾期笔数；advice 给出对应降债/还款建议
3. 每条必须基于具体数据，给出可量化、可操作方向
4. advice 必须能在 insights 之外提供新信息（不可只是 insights 的同义改写）

返回纯 JSON，schema 如下：
{
  "insights":[{"title":"≤8字","description":"≤45字含数据","action":"≤15字","level":"warning|info|tip"}],
  "advice":[{"title":"≤8字","content":"≤45字含数据","impact":"≤15字","priority":"high|medium|low"}]
}

不要 markdown、不要解释、不要超出字段。`
                },
                { role: 'user', content: JSON.stringify(context, null, 0) }
            ])
        );
        const json = extractJson(content);
        const advice = (json && Array.isArray(json.advice)) ? json.advice : [];
        const insights = (json && Array.isArray(json.insights)) ? json.insights : [];
        res.json(success({ advice, insights, generatedAt: new Date().toISOString() }));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;
