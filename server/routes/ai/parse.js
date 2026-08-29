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

        /* ---- dev-only mock 短路 ----
         * 用途：本地/UI 自测 —— 没配 AI provider 时，让 chip 化卡片/确认链路跑通。
         *   启用：?mock=1 query 或 body.mock === true
         *   ⚠️ 当前不加 NODE_ENV 门禁（docker-compose 默认 production，但本地测试时不一定能改）。
         *      线上误带 query 几乎不可能（普通用户不会写 ?mock=1），保留简短判定。
         *   ⚠️ mock 数据含低置信字段以触发 needs_confirmation，UI 才能展示「高亮低置信」横幅。
         */
        if (req.query.mock === '1' || (req.body && req.body.mock === true)) {
            const now = new Date();
            const ymd = now.toISOString().slice(0, 10);
            const transactions = [
                {
                    seq: 1, type: 'expense', amount: 28.0, currency: 'CNY',
                    merchant: '老王牛肉面',
                    category_id: null, category_name: '餐饮',
                    account_id: null,
                    date: `${ymd} 12:15:00`, note: '中午吃牛肉面',
                    raw_segment: text,
                    confidence: { amount: 0.92, type: 0.88, category: 0.55, date: 0.95, merchant: 0.7 },
                    evidence: { amount: 'regex:28', type: 'regex:吃', category: 'fallback_default', date: 'now', account: 'fallback_default' },
                },
                {
                    seq: 2, type: 'expense', amount: 6.5, currency: 'CNY',
                    merchant: '瑞幸咖啡',
                    category_id: null, category_name: '餐饮',
                    account_id: null,
                    date: `${ymd} 09:30:00`, note: '早上咖啡',
                    raw_segment: text,
                    confidence: { amount: 0.96, type: 0.9, category: 0.85, date: 0.93 },
                    evidence: { amount: 'regex:6.5', type: 'regex:咖啡', category: 'keyword:咖啡', date: 'now' },
                },
            ];
            const validation = {
                verdict: 'needs_confirmation',
                overall: 0.72,
                reasons: ['category 字段置信度偏低（0.55）', 'account 字段未识别'],
                per_txn: [
                    { seq: 1, verdict: 'needs_confirmation', per_field: {
                        amount: { score: 0.92, threshold: 0.85, ok: true },
                        type: { score: 0.88, threshold: 0.8, ok: true },
                        category: { score: 0.55, threshold: 0.75, ok: false },
                        date: { score: 0.95, threshold: 0.8, ok: true },
                    }},
                    { seq: 2, verdict: 'ready', per_field: {
                        amount: { score: 0.96, threshold: 0.85, ok: true },
                        type: { score: 0.9, threshold: 0.8, ok: true },
                        category: { score: 0.85, threshold: 0.75, ok: true },
                        date: { score: 0.93, threshold: 0.8, ok: true },
                    }},
                ],
                thresholds: { amount: 0.85, type: 0.8, category: 0.75, date: 0.8 },
            };
            const decision_trace = { prediction_version: 2, complexity: { level: 'simple' }, memory: { matched_rule_ids: [] } };
            const predictionId = await aiModule.createPrediction({
                userId: req.userId, bookId: req.bookId, source, text,
                context: (req.body && req.body.context) || {},
                transactions, validation, decisionTrace: decision_trace,
                route: 'local',
            });
            return res.json(success({
                prediction_id: predictionId,
                transactions,
                verdict: validation.verdict,
                overall_confidence: validation.overall,
                reasons: validation.reasons,
                needs_confirmation: validation.verdict !== 'ready',
                route: 'local',
                complexity: 'simple',
                memory_applied: [],
            }));
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
