/* ============================================
   V2 运维端点：特性开关 / 指标 / 成本 / 清理 / 状态
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule, getEventBusStats } = require('./_shared');
const router = express.Router();

/**
 * GET /ai/v2/features
 *   返回当前用户视角的完整功能开关信息（含覆写）：
 *     - features   : { chat, insights, ... } 用户命中后的有效值（DB > ENV > 默认 + 灰度）
 *     - overrides  : { chat: true, ... }       当前用户的显式覆写（无覆写的 key 缺省）
 *     - env        : { chat: '0', ... }         ENV 视角（参考）
 *     - flags      : [{ key }, ...]             flag 元信息，供前端按 key 渲染 toggle
 *     - gray_percent                              当前 ENV 灰度百分比（参考）
 *   ?debug=1 时返回额外的 all_flags（无用户上下文的环境总览）
 */
router.get('/v2/features', async (req, res) => {
    try {
        const userId = req.userId;
        const features = await aiModule.getUserFeatures(userId);
        const overrides = await aiModule.listOverrides(userId);
        const env = {
            chat: process.env.AI_V2_CHAT === '1',
            insights: process.env.AI_V2_INSIGHTS === '1',
            forecast: process.env.AI_V2_FORECAST === '1',
            tool_call: process.env.AI_V2_TOOL_CALL === '1',
            model_route: process.env.AI_V2_MODEL_ROUTE === '1',
        };
        const flags = aiModule.getFlagMeta();
        const gray_percent = parseInt(process.env.AI_V2_GRAY_PERCENT || '10', 10);
        const payload = { features, overrides, env, flags, gray_percent };
        if (req.query.debug === '1') payload.all_flags = aiModule.getAllFlags();
        res.json(success(payload));
    } catch (err) {
        handleServerError(res, err, '获取功能开关');
    }
});

/**
 * PUT /ai/v2/features
 *   body: { key: 'chat', value: true | false }
 *   持久化到 ai_runtime_settings（按 user_id 隔离），立即生效。
 *   鉴权：复用现有 auth（任意登录用户）；按 user_id 隔离确保用户只改自己的。
 */
router.put('/v2/features', express.json(), async (req, res) => {
    try {
        const userId = req.userId;
        const { key, value, clear } = req.body || {};
        if (!key) {
            return res.status(400).json(fail('缺少参数 key'));
        }
        // 白名单校验：未知 flag 直接 400，避免 throw 引发 500 兜底（运维页 P0-降级点）
        const FLAG_KEYS = aiModule.FLAG_KEYS || [];
        if (!FLAG_KEYS.includes(key)) {
            return res.status(400).json(fail(`未知功能开关: ${key}（仅支持 ${FLAG_KEYS.join('/')}）`));
        }
        if (clear === true) {
            await aiModule.clearOverride(userId, key);
        } else if (typeof value === 'boolean') {
            await aiModule.setOverride(userId, key, value);
        } else {
            return res.status(400).json(fail('value 必须为布尔，或设置 clear:true'));
        }
        // 返回最新状态，方便前端无额外请求直接刷新
        const features = await aiModule.getUserFeatures(userId);
        const overrides = await aiModule.listOverrides(userId);
        res.json(success({ key, value: value, cleared: clear === true, features, overrides }));
    } catch (err) {
        handleServerError(res, err, '更新功能开关');
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
            // Dockerfile line 60-61: `ENV APP_VERSION=$VERSION` 已注入镜像；
            // compose / release-image.yml 传 `--build-arg VERSION=<tag>`，dev fallback 'dev'。
            // 历史代码硬编码 'current' 导致运维页永远显示 current，现读环境变量。
            version: process.env.APP_VERSION || 'dev',
            timestamp: new Date().toISOString(),
        }));
    } catch (err) {
        handleServerError(res, err, 'v2 状态');
    }
});

module.exports = router;
