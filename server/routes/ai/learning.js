/* ============================================
   学习统计（/learning/stats）与离线评测（/evaluation/*）
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule, safeJson } = require('./_shared');
const router = express.Router();
router.get('/learning/stats', async (req, res) => {
    try {
        const [stats, contradictions, online, usage] = await Promise.all([
            aiModule.evidenceStats(db, req.userId),
            aiModule.detectContradictions(db, req.userId),
            aiModule.collectOnlineMetrics(db, req.userId),
            aiModule.usageMetrics(db, req.userId),
        ]);

        res.json(success({
            evidence: stats,
            // 同一商家出现两个高分类目 = 需要用户裁定，不该由系统猜
            contradictions,
            metrics: online,
            usage,
            breakers: aiModule.breakerStates(),
        }));
    } catch (err) {
        handleServerError(res, err, '查询 AI 学习统计');
    }
});

/* ============================================
   评测系统
   ------------------------------------------------
   方案原文：「任何版本发布前都必须比较基线」。
   ⇒ 跑批接口默认自动取最近一次跑批作基线，并在响应里直出 regressions。
      不做「先查基线再手工传 id」，否则最容易被跳过的就是这一步。
   ============================================ */

// ---- POST /api/ai/evaluation/run ----
router.post('/evaluation/run', async (req, res) => {
    try {
        const label = String((req.body && req.body.label) || '').slice(0, 80);
        const persist = (req.body && req.body.persist) !== false;   // 默认落库

        // 离线跑批：不连库、不调模型，纯 CPU
        const result = aiModule.runOfflineEvaluation();

        const baselineRow = await aiModule.latestRun(db);
        const baseline = baselineRow
            ? (typeof baselineRow.metrics === 'object' ? baselineRow.metrics : JSON.parse(baselineRow.metrics || '{}'))
            : null;
        const regression = aiModule.compareWithBaseline(result.metrics, baseline);

        let runId = null;
        if (persist) {
            runId = await aiModule.persistRun(db, {
                userId: req.userId, label, engineVersion: String(aiModule.PREDICTION_VERSION),
                result, baselineRunId: baselineRow ? baselineRow.id : null,
            });
        }

        res.json(success({
            run_id: runId,
            metrics: result.metrics,
            summary: result.summary,
            baseline_run_id: baselineRow ? baselineRow.id : null,
            regression,
            // 只回失败用例的明细：全量 36 条 actual 会让响应膨胀到没人读
            failed_cases: result.cases.filter(c => !c.passed),
        }));
    } catch (err) {
        handleServerError(res, err, '运行 AI 评测');
    }
});

// ---- GET /api/ai/evaluation/runs ----
router.get('/evaluation/runs', async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        let runs = [];
        try {
            runs = await db.query(
                `SELECT id, label, dataset_version, engine_version, total_cases, passed_cases,
                        metrics, baseline_run_id, regression, created_at
                   FROM ai_evaluation_runs
                  ORDER BY created_at DESC, id DESC
                  LIMIT ${limit}`
            );
        } catch (_) { runs = []; }   // 老库未升级 → 空列表，不给 500

        res.json(success({
            runs: runs.map(r => ({
                ...r,
                metrics: typeof r.metrics === 'object' ? r.metrics : safeJson(r.metrics, {}),
                regression: typeof r.regression === 'object' ? r.regression : safeJson(r.regression, null),
            })),
            dataset_version: aiModule.DATASET_VERSION,
        }));
    } catch (err) {
        handleServerError(res, err, '查询评测历史');
    }
});

// ============================================
// AI 模块扩展端点
// ============================================

/* ---------- Insight 端点 ---------- */

module.exports = router;
