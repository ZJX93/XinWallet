/* ============================================
   AI 识别行为设置：GET / PUT
   ------------------------------------------------
     把 AI_* 环境变量开关暴露成 Web 设置页可读写的接口。
     DB 保存值优先，未保存项回退 env / 内置默认（见 ai-settings-service）。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();

// GET /api/ai/settings —— 读取当前生效设置（DB 优先，env 兜底）
router.get('/settings', async (req, res) => {
    try {
        const settings = await aiModule.getAiSettings(db, req.userId);
        res.json(success({ settings }));
    } catch (err) {
        handleServerError(res, err, '读取 AI 识别设置');
    }
});

// PUT /api/ai/settings —— 保存设置（部分更新，只写合法 key）
router.put('/settings', async (req, res) => {
    try {
        const patch = (req.body && (req.body.settings || req.body)) || {};
        const updated = await aiModule.updateAiSettings(db, req.userId, patch);
        res.json(success({ settings: updated }, 'AI 识别设置已保存'));
    } catch (err) {
        handleServerError(res, err, '保存 AI 识别设置');
    }
});

module.exports = router;
