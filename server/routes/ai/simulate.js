/* ============================================
   财务模拟：现金流预测 / 预算模拟 / 储蓄目标 / 债务还清
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
router.get('/forecast/cashflow', async (req, res) => {
    try {
        const userId = req.userId;
        const { months = 6 } = req.query;
        const result = await aiModule.forecastService.forecastCashflow(userId, {
            months: parseInt(months, 10),
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        handleServerError(res, err, '现金流预测');
    }
});

// POST /ai/simulate/budget  预算调整模拟
router.post('/simulate/budget', async (req, res) => {
    try {
        const userId = req.userId;
        const { category_id, new_budget, months = 3 } = req.body;
        if (!category_id || new_budget == null) {
            return res.status(400).json({ ok: false, error: 'category_id 和 new_budget 必填' });
        }
        const result = await aiModule.forecastService.simulateBudget(userId, category_id, new_budget, {
            months: parseInt(months, 10),
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        handleServerError(res, err, '预算模拟');
    }
});

// POST /ai/simulate/savings-goal  储蓄目标模拟
router.post('/simulate/savings-goal', async (req, res) => {
    try {
        const userId = req.userId;
        const { target_amount, months = 12, monthly_save } = req.body;
        if (!target_amount || target_amount <= 0) {
            return res.status(400).json({ ok: false, error: 'target_amount 必填且 > 0' });
        }
        const result = await aiModule.forecastService.simulateSavingsGoal(userId, target_amount, {
            months: parseInt(months, 10),
            monthlySave: monthly_save ? parseFloat(monthly_save) : null,
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        handleServerError(res, err, '储蓄目标模拟');
    }
});

// POST /ai/simulate/debt-payoff  债务还款模拟
router.post('/simulate/debt-payoff', async (req, res) => {
    try {
        const userId = req.userId;
        const { debt_id, extra_monthly_payment = 0 } = req.body;
        const result = await aiModule.forecastService.simulateDebtPayoff(userId, {
            debtId: debt_id ? parseInt(debt_id, 10) : null,
            extraMonthlyPayment: parseFloat(extra_monthly_payment) || 0,
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        handleServerError(res, err, '债务还款模拟');
    }
});

module.exports = router;
