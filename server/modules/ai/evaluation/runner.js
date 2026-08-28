/* ============================================
   Evaluation Runner
   ------------------------------------------------
   11 项核心指标：
     transaction_count_accuracy / amount_accuracy / type_accuracy
     category_accuracy / date_accuracy / confirmation_rate / correction_rate
     rule_hit_rate / llm_call_rate / fallback_rate / cost_per_prediction

   ⛔ 前 5 项由本 runner 离线跑批直接算出（不连库、不调模型 → CI 可跑）。
      后 6 项是【线上行为指标】，必须从 ai_feedback_events / ai_provider_usage
      聚合，离线数据集算不出来 —— 混在一起算会得到无意义的常数 0。
      故 runner 返回 offline_metrics + online_metrics 两组，语义严格分开。

   ⛔ 「任何版本发布前都必须比较基线」：runner 支持 baseline 对比，
      逐指标给出 delta 并标出 regression（下降即为回归）。
   ============================================ */

const { parseOffline } = require('../parser/transaction-parser');
const { decide } = require('../parser/decision-engine');
const { CASES, CATEGORIES, REF_DATE, DATASET_VERSION } = require('./dataset');

/**
 * 跑一遍离线评测。
 *
 * @param {object} [opts]
 * @param {Array}  [opts.cases]       自定义用例（默认全量）
 * @param {Array}  [opts.categories]  自定义类目表
 * @returns {{metrics:object, cases:Array, summary:object}}
 */
function runOfflineEvaluation(opts = {}) {
    const cases = opts.cases || CASES;
    const categories = opts.categories || CATEGORIES;

    const results = [];
    const counters = {
        count_total: 0, count_hit: 0,
        amount_total: 0, amount_hit: 0,
        type_total: 0, type_hit: 0,
        category_total: 0, category_hit: 0,
        date_total: 0, date_hit: 0,
        // 秒级完备性：分母=所有声明了日期期望的交易
        date_precision_total: 0, date_precision_hit: 0,
        verdict_total: 0, verdict_hit: 0,
    };

    for (const c of cases) {
        const parsed = parseOffline({
            text: c.text, categories, refDate: REF_DATE,
        });

        // 用例可注入 memory 候选来验证记忆融合逻辑（矛盾历史 / 习惯变化场景）
        let transactions = parsed.transactions;
        let validation = parsed.validation;
        if (c.memory) {
            const d = decide({
                extraction: parsed.extraction,
                memory: { candidates: c.memory.candidates || [], negated: c.memory.negated || [], layers: {} },
                context: { categories, accounts: [], wm: {} },
            });
            transactions = d.transactions;
            validation = d.validation;
        }

        const fieldResults = {};
        let passed = true;

        // ---- 笔数 ----
        counters.count_total += 1;
        const countOk = transactions.length === c.expect.count;
        fieldResults.count = { expected: c.expect.count, actual: transactions.length, ok: countOk };
        if (countOk) counters.count_hit += 1; else passed = false;

        // ---- 逐笔字段 ----
        const expectTxns = c.expect.txns || [];
        fieldResults.txns = [];
        for (let i = 0; i < expectTxns.length; i += 1) {
            const exp = expectTxns[i];
            const act = transactions[i];
            const row = { seq: i + 1 };

            if (!act) {
                row.missing = true;
                passed = false;
                fieldResults.txns.push(row);
                // 缺失时也要把该笔期望的字段计入分母，否则准确率会被虚高
                if (exp.amount !== undefined) counters.amount_total += 1;
                if (exp.type !== undefined) counters.type_total += 1;
                if (exp.category_id !== undefined) counters.category_total += 1;
                if (exp.date !== undefined) counters.date_total += 1;
                continue;
            }

            if (exp.amount !== undefined) {
                counters.amount_total += 1;
                const ok = Math.abs(Number(act.amount) - Number(exp.amount)) < 0.005;
                row.amount = { expected: exp.amount, actual: act.amount, ok };
                if (ok) counters.amount_hit += 1; else passed = false;
            }
            if (exp.type !== undefined) {
                counters.type_total += 1;
                const ok = act.type === exp.type;
                row.type = { expected: exp.type, actual: act.type, ok };
                if (ok) counters.type_hit += 1; else passed = false;
            }
            if (exp.category_id !== undefined) {
                counters.category_total += 1;
                const ok = act.category_id === exp.category_id;
                row.category = { expected: exp.category_id, actual: act.category_id, ok };
                if (ok) counters.category_hit += 1; else passed = false;
            }
            if (exp.date !== undefined) {
                counters.date_total += 1;
                // 日期按「期望值声明的精度」比较：
                // 期望写到日（'2026-08-25'）→ 只校验到日。这样「没有具体时刻时补
                // 12:00:00 还是当前时刻」这类实现细节不会被固化进黄金标准 ——
                // 以后调整补齐策略不会把评测打红。
                // 若某个用例就是要卡秒级精度，把期望写全（19 字符）即可自动升级为全等比较。
                const ok = String(act.date ?? '').slice(0, String(exp.date).length) === exp.date;
                row.date = { expected: exp.date, actual: act.date, ok };
                if (ok) counters.date_hit += 1; else passed = false;

                // 秒级完备性：项目记账规则要求交易时间精确到秒，
                // 缺时分秒会导致同日多笔排序不稳、幂等键冲突。
                counters.date_precision_total += 1;
                if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(act.date ?? ''))) {
                    counters.date_precision_hit += 1;
                }
            }
            if (exp.merchant !== undefined) {
                const ok = act.merchant === exp.merchant;
                row.merchant = { expected: exp.merchant, actual: act.merchant, ok };
                if (!ok) passed = false;
            }
            fieldResults.txns.push(row);
        }

        // ---- 裁决（仅在用例显式声明期望时才断言）----
        if (c.expect.verdict !== undefined) {
            counters.verdict_total += 1;
            const ok = validation.verdict === c.expect.verdict;
            fieldResults.verdict = { expected: c.expect.verdict, actual: validation.verdict, ok };
            if (ok) counters.verdict_hit += 1; else passed = false;
        }

        results.push({
            case_id: c.id, scenario: c.scenario, input_text: c.text,
            expected: c.expect,
            actual: {
                count: transactions.length,
                verdict: validation.verdict,
                txns: transactions.map(t => ({
                    seq: t.seq, type: t.type, amount: t.amount,
                    category_id: t.category_id, category_name: t.category_name,
                    date: t.date, merchant: t.merchant,
                })),
            },
            field_results: fieldResults,
            passed,
        });
    }

    const metrics = {
        transaction_count_accuracy: rate(counters.count_hit, counters.count_total),
        amount_accuracy: rate(counters.amount_hit, counters.amount_total),
        type_accuracy: rate(counters.type_hit, counters.type_total),
        category_accuracy: rate(counters.category_hit, counters.category_total),
        date_accuracy: rate(counters.date_hit, counters.date_total),
        date_precision_rate: rate(counters.date_precision_hit, counters.date_precision_total),
        verdict_accuracy: rate(counters.verdict_hit, counters.verdict_total),
        case_pass_rate: rate(results.filter(r => r.passed).length, results.length),
    };

    // 分场景准确率：定位"改了一个词表，坏了哪一类"
    const byScenario = {};
    for (const r of results) {
        byScenario[r.scenario] = byScenario[r.scenario] || { total: 0, passed: 0 };
        byScenario[r.scenario].total += 1;
        if (r.passed) byScenario[r.scenario].passed += 1;
    }
    for (const k of Object.keys(byScenario)) {
        byScenario[k].pass_rate = rate(byScenario[k].passed, byScenario[k].total);
    }

    return {
        metrics,
        cases: results,
        summary: {
            dataset_version: DATASET_VERSION,
            total_cases: results.length,
            passed_cases: results.filter(r => r.passed).length,
            failed_cases: results.filter(r => !r.passed).map(r => r.case_id),
            by_scenario: byScenario,
            counters,
        },
    };
}

/**
 * 采集线上行为指标（需要数据库）。
 * confirmation_rate / correction_rate / rule_hit_rate 来自 ai_feedback_events + ai_rules，
 * llm_call_rate / fallback_rate / cost_per_prediction 来自 ai_provider_usage。
 */
async function collectOnlineMetrics(db, userId) {
    const out = {
        confirmation_rate: 0, correction_rate: 0, discard_rate: 0,
        rule_hit_rate: 0, llm_call_rate: 0, fallback_rate: 0,
        cost_per_prediction_micro: 0, total_predictions: 0,
    };

    try {
        const rows = await db.query(
            `SELECT event_type, COUNT(*) AS cnt FROM ai_feedback_events
              WHERE user_id = ? AND event_type IN ('explicit_confirmation','explicit_correction','discard')
              GROUP BY event_type`,
            [userId]
        );
        let total = 0;
        const byType = {};
        for (const r of rows) { byType[r.event_type] = Number(r.cnt); total += Number(r.cnt); }
        if (total > 0) {
            out.confirmation_rate = rate(byType.explicit_confirmation || 0, total);
            out.correction_rate = rate(byType.explicit_correction || 0, total);
            out.discard_rate = rate(byType.discard || 0, total);
        }
    } catch (_) { /* 表不存在 */ }

    // rule_hit_rate：命中过的规则 / 全部活跃规则
    try {
        const r = await db.queryOne(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN hit_count > 0 THEN 1 ELSE 0 END) AS hit
               FROM ai_rules WHERE user_id = ? AND status IN ('verified','trusted')`,
            [userId]
        );
        if (r && Number(r.total) > 0) out.rule_hit_rate = rate(Number(r.hit) || 0, Number(r.total));
    } catch (_) { /* 表不存在 */ }

    try {
        const { usageMetrics } = require('../runtime/cost-tracker');
        const u = await usageMetrics(db, userId);
        out.llm_call_rate = u.llm_call_rate;
        out.fallback_rate = u.fallback_rate;
        out.cost_per_prediction_micro = u.cost_per_prediction_micro;
        out.total_predictions = u.total_predictions;
    } catch (_) { /* 表不存在 */ }

    return out;
}

/**
 * 与基线比较（回归检测）。
 * @returns {{deltas:object, regressions:Array, improvements:Array}}
 */
function compareWithBaseline(current, baseline) {
    const deltas = {};
    const regressions = [];
    const improvements = [];
    if (!baseline) return { deltas, regressions, improvements, has_baseline: false };

    for (const [k, v] of Object.entries(current)) {
        if (typeof v !== 'number') continue;
        const b = baseline[k];
        if (typeof b !== 'number') continue;
        const d = Number((v - b).toFixed(4));
        deltas[k] = d;
        // 容差 0.0001 避免浮点噪声被当成回归
        if (d < -0.0001) regressions.push({ metric: k, from: b, to: v, delta: d });
        else if (d > 0.0001) improvements.push({ metric: k, from: b, to: v, delta: d });
    }
    return { deltas, regressions, improvements, has_baseline: true };
}

/**
 * 落库一次评测跑批（含逐条明细）。
 * @returns {Promise<number|null>} run_id
 */
async function persistRun(db, { userId = null, label = '', engineVersion = '', result, baselineRunId = null }) {
    try {
        let baseline = null;
        if (baselineRunId) {
            const row = await db.queryOne(
                `SELECT metrics FROM ai_evaluation_runs WHERE id = ?`, [baselineRunId]
            );
            if (row) baseline = typeof row.metrics === 'object' ? row.metrics : JSON.parse(row.metrics || '{}');
        }
        const regression = compareWithBaseline(result.metrics, baseline);

        const ins = await db.query(
            `INSERT INTO ai_evaluation_runs
               (user_id, label, dataset_version, engine_version, total_cases, passed_cases,
                metrics, baseline_run_id, regression)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, String(label).slice(0, 80), result.summary.dataset_version, String(engineVersion).slice(0, 32),
             result.summary.total_cases, result.summary.passed_cases,
             JSON.stringify(result.metrics), baselineRunId, JSON.stringify(regression)]
        );
        const runId = ins.insertId;

        for (const c of result.cases) {
            await db.query(
                `INSERT INTO ai_evaluation_cases
                   (run_id, case_id, scenario, input_text, expected, actual, field_results, passed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [runId, c.case_id, c.scenario, c.input_text,
                 JSON.stringify(c.expected), JSON.stringify(c.actual),
                 JSON.stringify(c.field_results), c.passed]
            );
        }
        return runId;
    } catch (_) {
        return null;   // 评测落库失败不影响评测结果本身
    }
}

/** 取最近一次跑批作为基线 */
async function latestRun(db) {
    try {
        return await db.queryOne(
            `SELECT id, label, metrics, total_cases, passed_cases, created_at
               FROM ai_evaluation_runs ORDER BY created_at DESC, id DESC LIMIT 1`
        );
    } catch (_) {
        return null;
    }
}

function rate(hit, total) {
    if (!total) return 0;
    return Number((hit / total).toFixed(4));
}

module.exports = {
    runOfflineEvaluation, collectOnlineMetrics, compareWithBaseline,
    persistRun, latestRun,
};
