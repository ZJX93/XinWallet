/* ============================================
   文本记账解析（/transactions/parse）：抽取 → 校验 → 落预测快照
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
const AI_PREDICTION_SOURCES = ['parse', 'chat', 'ocr', 'voice'];

// ---- POST /api/ai/transactions/parse ----
// 自然语言 → 候选交易 + 字段级置信度裁决 + 不可变预测快照
router.post('/transactions/parse', async (req, res) => {
    try {
        const text = (req.body && req.body.text) || '';
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json(fail('请提供要解析的文本'));
        }
        if (text.length > 2000) {
            return res.status(400).json(fail('文本过长（最多 2000 字）'));
        }

        // 在入口拦下非法 source：否则会在 INSERT 时撞 CHECK 约束，用户只能看到 500
        const source = (req.body && req.body.source) || 'parse';
        if (!AI_PREDICTION_SOURCES.includes(source)) {
            return res.status(400).json(fail(`source 必须是 ${AI_PREDICTION_SOURCES.join(' / ')} 之一`));
        }

        const context = (req.body && req.body.context) || {};
        const parsed = await aiModule.parseTransactions(db, {
            userId: req.userId,
            bookId: req.bookId,
            text,
            context,
        });
        const { transactions, validation, decision_trace } = parsed;

        if (!transactions.length) {
            return res.status(422).json(fail('未能从文本中识别出交易信息'));
        }

        const predictionId = await aiModule.createPrediction({
            userId: req.userId,
            bookId: req.bookId,
            source,
            text,
            context,
            transactions,
            validation,
            decisionTrace: decision_trace,
            // 记忆证据 / 模型原始请求响应 / 实际路由快照
            // 落库是「事后可复盘」的前提：没有它，线上一条错判永远查不出是记忆错还是模型错。
            memorySnapshot: parsed.memory_snapshot,
            modelRequest: parsed.model_request,
            modelResponse: parsed.model_response,
            route: parsed.route,
        });

        res.json(success({
            prediction_id: predictionId,
            transactions,
            verdict: validation.verdict,
            overall_confidence: validation.overall,
            reasons: validation.reasons,
            // 前端据此决定是否弹确认框
            needs_confirmation: validation.verdict !== 'ready',
            // 可解释性：让用户看到「为什么这么判」，也便于三端展示证据来源标签
            route: parsed.route,
            complexity: decision_trace.complexity ? decision_trace.complexity.level : 'simple',
            memory_applied: decision_trace.memory ? decision_trace.memory.applied : [],
        }));
    } catch (err) {
        handleServerError(res, err, 'AI 解析交易');
    }
});

module.exports = router;
