/* ============================================
   AI 事件总线：手动触发事件 / 查看事件统计
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule } = require('./_shared');
// 事件总线能力统一由桶导出：路由层不得直连 modules/ai 子目录，
// 该约束由 test/ai-architecture.test.js 静态守护。
const { emitEvent, getEventBusStats, getEventBusHistory } = aiModule;
const router = express.Router();
router.post('/events/emit', async (req, res) => {
    try {
        const userId = req.userId;
        const { event_type, payload } = req.body;
        const allowedEvents = ['transaction.created', 'transaction.updated', 'transaction.deleted',
                               'budget.exceeded', 'balance.anomaly'];
        if (!event_type || !allowedEvents.includes(event_type)) {
            return res.status(400).json({ ok: false, error: `event_type 必填且可为：${allowedEvents.join(', ')}` });
        }

        const eventPayload = { userId, ...(payload || {}) };
        // emit 为 async（内部逐个 await 订阅者），不 await 会把 Promise 序列化成 {} 返回
        const event = await emitEvent(event_type, eventPayload);
        res.json({ ok: true, event });
    } catch (err) {
        handleServerError(res, err, '事件触发');
    }
});

// GET /ai/events/stats  查看 Event Bus 状态（调试用）
router.get('/events/stats', async (req, res) => {
    try {
        res.json({ ok: true, stats: getEventBusStats(), history: getEventBusHistory({ limit: 20 }) });
    } catch (err) {
        handleServerError(res, err, 'Event Bus 状态');
    }
});

module.exports = router;
