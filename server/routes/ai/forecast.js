/* ============================================
   现金流预测 & 模拟（Forecast & Simulation）
   ------------------------------------------------
   由 server/routes/ai.js 机械拆分而来。
   历史背景：forecast-service.js 的 4 个函数（forecastCashflow /
   simulateBudget / simulateSavingsGoal / simulateDebtPayoff）此前
   没有挂接任何路由，前端 AIInsights._loadCashflow 调用 /ai/forecast/cashflow
   一律返回 404。本文件补齐这一空缺。

   ⛔ 本文件【只】通过 modules/ai 桶访问 forecastService，绝不直接 require
      services/forecast-service.js（与同目录其他模块的约束一致）。
   ============================================ */

const { express, handleServerError, aiModule } = require('./_shared');
const router = express.Router();

// ============================================
// 1) 现金流预测
//    GET /api/ai/forecast/cashflow?months=3
//    前端字段约定：data.predicted.{inflow, outflow, balance}
//    forecast-service 直接返回 { forecast:[{projected_income,...}], trend, confidence }
//    在此处汇总成前端期望的形状。
// ============================================
router.get('/forecast/cashflow', async (req, res) => {
    try {
        const months = Math.min(Math.max(parseInt(req.query.months, 10) || 3, 1), 24);
        const result = await aiModule.forecastService.forecastCashflow(req.userId, { months });

        // 汇总未来 N 个月的流入/流出/期末余额
        const list = Array.isArray(result.forecast) ? result.forecast : [];
        const inflow = list.reduce((s, x) => s + Number(x.projected_income || 0), 0);
        const outflow = list.reduce((s, x) => s + Number(x.projected_expense || 0), 0);
        const balance = list.length ? Number(list[list.length - 1].projected_balance || 0) : 0;

        res.json({
            success: true,
            data: {
                predicted: {
                    inflow: Math.round(inflow * 100) / 100,
                    outflow: Math.round(outflow * 100) / 100,
                    balance: Math.round(balance * 100) / 100,
                },
                trend: result.trend,
                confidence: result.confidence,
                forecast: list,
                message: result.message || null,
            },
        });
    } catch (err) {
        handleServerError(res, err, '现金流预测');
    }
});

module.exports = router;