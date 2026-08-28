/* ============================================
   用户 AI 画像与偏好设置
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
router.get('/profile', async (req, res) => {
    try {
        const userId = req.userId;
        const profile = await aiModule.profileService.getOrCreateProfile(userId);
        res.json({ ok: true, profile });
    } catch (err) {
        handleServerError(res, err, '获取 Profile');
    }
});

// PATCH /ai/profile  更新用户 AI Profile
router.patch('/profile', async (req, res) => {
    try {
        const userId = req.userId;
        const { interaction_style, notification_enabled, insight_frequency,
                insight_rank_threshold, preferences } = req.body;
        const updates = {};
        if (interaction_style !== undefined) updates.interaction_style = interaction_style;
        if (notification_enabled !== undefined) updates.notification_enabled = notification_enabled;
        if (insight_frequency !== undefined) updates.insight_frequency = insight_frequency;
        if (insight_rank_threshold !== undefined) updates.insight_rank_threshold = insight_rank_threshold;
        if (preferences !== undefined) updates.preferences = preferences;

        await aiModule.profileService.updateProfile(userId, updates);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '更新 Profile');
    }
});

/* ---------- Event Bus 端点 ---------- */

module.exports = router;
