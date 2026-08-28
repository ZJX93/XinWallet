/* ============================================
   预测快照：查询 / 提交落账 / 丢弃
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
router.get('/predictions/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const pred = await aiModule.getPrediction(id, req.userId);
        if (!pred) return res.status(404).json(fail('预测不存在'));

        res.json(success({
            prediction_id: pred.id,
            status: pred.status,
            verdict: pred.verdict,
            source: pred.source,
            prediction_version: pred.prediction_version,
            request: pred.request,
            transactions: pred.candidate_txns,
            validation: pred.validation,
            decision_trace: pred.decision_trace,   // 已通过 user_id 过滤，属主可见
            memory_snapshot: pred.memory_snapshot, // 记忆证据快照（可解释性）
            model_request: pred.model_request,
            model_response: pred.model_response,
            route: pred.route,
            final_txns: pred.final_txns,
            final_diff: pred.final_diff,
            committed_at: pred.committed_at,
            created_at: pred.created_at,
        }));
    } catch (err) {
        handleServerError(res, err, '查询 AI 预测');
    }
});

// ---- POST /api/ai/predictions/:id/commit ----
// 原子提交：事务内落账 + 关联 + 状态更新 + 反馈事件；支持幂等重放
router.post('/predictions/:id/commit', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const action = (req.body && req.body.action) || 'confirmed';
        if (action !== 'confirmed' && action !== 'corrected') {
            return res.status(400).json(fail("action 必须是 'confirmed' 或 'corrected'"));
        }
        const correctedTxns = req.body && req.body.transactions;
        if (action === 'corrected' && !Array.isArray(correctedTxns)) {
            return res.status(400).json(fail("action='corrected' 时必须提供 transactions 数组"));
        }

        const idempotencyKey = (req.body && req.body.idempotency_key) || null;
        if (idempotencyKey && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 64)) {
            return res.status(400).json(fail('idempotency_key 必须是 64 字符以内的字符串'));
        }

        const result = await aiModule.commitPrediction(
            id, req.userId, req.bookId, action, correctedTxns, idempotencyKey
        );

        // prediction-store 返回 { status, body }，统一包装成项目响应格式
        if (result.status === 200) {
            return res.json(success(result.body));
        }
        return res.status(result.status).json(fail(result.body.error, result.body.details));
    } catch (err) {
        handleServerError(res, err, '提交 AI 预测');
    }
});

// ---- POST /api/ai/predictions/:id/discard ----
// 弃置预测：仅记录事件，不默认形成负向学习
router.post('/predictions/:id/discard', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const reason = (req.body && req.body.reason) || '';
        const result = await aiModule.discardPrediction(id, req.userId, req.bookId, reason);

        if (result.status === 200) return res.json(success(result.body));
        return res.status(result.status).json(fail(result.body.error));
    } catch (err) {
        handleServerError(res, err, '弃置 AI 预测');
    }
});

/* ============================================
   规则演化与记忆治理
   ------------------------------------------------
   为什么必须暴露这组接口：
     方案 §4 的验收标准要求「错误习惯可 disabled」「证据可审计」。
     若规则只在后台默默演化而用户无法查看/干预，一条学错的规则会
     永久污染后续识别 —— 学习系统必须自带刹车。

   命名统一 /ai/rules/*：与 /ai/predictions/* 平级，同属 v0.2 闭环。
   ============================================ */

module.exports = router;
