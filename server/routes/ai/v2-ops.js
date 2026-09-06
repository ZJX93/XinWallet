/* ============================================
   V2 运维端点：特性开关 / 指标 / 成本 / 清理 / 状态
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule, getEventBusStats } = require('./_shared');
const router = express.Router();
router.get('/v2/features', async (req, res) => {
    try {
        const userId = req.userId;
        const { debug } = req.query;
        if (debug === '1') {
            return res.json(success({ all_flags: aiModule.getAllFlags() }));
        }
        res.json(success({ features: aiModule.getUserFeatures(userId) }));
    } catch (err) {
        handleServerError(res, err, '获取功能开关');
    }
});

// GET /ai/v2/metrics  健康指标
router.get('/v2/metrics', async (req, res) => {
    try {
        const userId = req.userId;
        const [health, cost] = await Promise.all([
            aiModule.metricsCleanup.getHealthMetrics(),
            aiModule.metricsCleanup.getCostBreakdown({ days: 7 }),
        ]);
        res.json(success({ health, cost }));
    } catch (err) {
        handleServerError(res, err, '获取指标');
    }
});

// GET /ai/v2/metrics/cost  成本追踪
router.get('/v2/metrics/cost', async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const result = await aiModule.metricsCleanup.getCostBreakdown({ days: parseInt(days, 10) });
        res.json(success(result));
    } catch (err) {
        handleServerError(res, err, '获取成本');
    }
});

// POST /ai/v2/cleanup  运行清理任务
router.post('/v2/cleanup', async (req, res) => {
    try {
        const userId = req.userId;
        const result = await aiModule.metricsCleanup.runFullCleanup(userId);
        res.json(success(result));
    } catch (err) {
        handleServerError(res, err, '运行清理');
    }
});

// GET /ai/v2/status  整体状态（健康检查）
router.get('/v2/status', async (req, res) => {
    try {
        // 走 _shared 而非就地 require：子路由不直接碰 modules/ai 子目录，
        // 由 aiModule（桶文件）与 getEventBusStats 统一供给。
        const pending = await aiModule.pendingFeedbackCount().catch(() => 0);
        res.json(success({
            event_bus: getEventBusStats(),
            pending_feedback: pending,
            version: 'current',
            timestamp: new Date().toISOString(),
        }));
    } catch (err) {
        handleServerError(res, err, 'v2 状态');
    }
});

module.exports = router;
