/* ============================================
   AI 洞察：生成 / 列表 / 排序 / 统计 / 已读 / 删除
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
router.post('/insights/analyze', async (req, res) => {
    try {
        const userId = req.userId;
        const bookId = req.body.book_id || null;
        const generated = await aiModule.runFullAnalysis(userId, bookId);
        res.json({ ok: true, generated: generated.length, items: generated });
    } catch (err) {
        handleServerError(res, err, '洞察分析');
    }
});

// GET /ai/insights  获取洞察列表
router.get('/insights', async (req, res) => {
    try {
        const userId = req.userId;
        const { status, insight_type, importance_ge, limit = 20, offset = 0 } = req.query;
        const rows = await aiModule.getInsights(userId, {
            status,
            insightType: insight_type,
            importanceGE: importance_ge ? parseInt(importance_ge, 10) : null,
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10),
        });
        res.json({ ok: true, insights: rows });
    } catch (err) {
        handleServerError(res, err, '获取洞察列表');
    }
});

// GET /ai/insights/ranked  获取已排序去重的洞察列表（供前端 Radar 使用）
router.get('/insights/ranked', async (req, res) => {
    try {
        const userId = req.userId;
        const { min_importance = 3, limit = 20, offset = 0 } = req.query;
        const rows = await aiModule.getRankedInsights(userId, {
            minImportance: parseInt(min_importance, 10),
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10),
        });
        res.json({ ok: true, insights: rows });
    } catch (err) {
        handleServerError(res, err, '获取排序洞察');
    }
});

// GET /ai/insights/stats  获取洞察摘要统计
router.get('/insights/stats', async (req, res) => {
    try {
        const userId = req.userId;
        const stats = await aiModule.getInsightStats(userId);
        res.json({ ok: true, stats });
    } catch (err) {
        handleServerError(res, err, '获取洞察统计');
    }
});

// DELETE /ai/insights/type/:type  批量忽略某类型的所有洞察
router.delete('/insights/type/:type', async (req, res) => {
    try {
        const userId = req.userId;
        const { type } = req.params;
        await aiModule.dismissAllOfType(userId, type);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '批量忽略洞察');
    }
});

// PATCH /ai/insights/:id/read  标记已读
router.patch('/insights/:id/read', async (req, res) => {
    try {
        const userId = req.userId;
        const id = parseInt(req.params.id, 10);
        await aiModule.markRead(userId, id);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '标记已读');
    }
});

// DELETE /ai/insights/:id  忽略/驳回洞察
router.delete('/insights/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const id = parseInt(req.params.id, 10);
        await aiModule.dismissInsight(userId, id);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '忽略洞察');
    }
});

/* ---------- Conversation 端点 ---------- */

module.exports = router;
