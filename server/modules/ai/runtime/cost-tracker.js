/* ============================================
   Cost Tracker
   ------------------------------------------------
   落库 ai_provider_usage，为 cost_per_prediction 与 llm_call_rate 供数。

   ⛔ 金额一律用【微分（0.000001 元）整数】存储，不用浮点：
      单次调用成本常在 0.0001 元量级，float 累加上万次会漂移。
   ⛔ 本模块所有写入都吞异常：成本记账失败绝不能影响用户记账。
   ============================================ */

// 参考价（人民币 / 千 token）。仅用于估算，真实账单以供应商为准。
// 未知模型按 cheap 档估，避免成本被低估成 0 而失去监控意义。
const PRICE_PER_1K = {
    cheap: { prompt: 0.001, completion: 0.002 },
    strong: { prompt: 0.015, completion: 0.06 },
};

/**
 * 估算成本（返回微分整数）。
 */
function estimateCostMicro({ route, promptTokens = 0, completionTokens = 0 }) {
    if (route === 'local') return 0;
    const tier = route === 'strong_model' ? 'strong' : 'cheap';
    const p = PRICE_PER_1K[tier];
    const cny = (promptTokens / 1000) * p.prompt + (completionTokens / 1000) * p.completion;
    return Math.round(cny * 1_000_000);
}

/**
 * 记录一次用量。
 *
 * @param {object} db
 * @param {object} params
 * @returns {Promise<number|null>} usage id
 */
async function recordUsage(db, {
    userId, providerId = null, predictionId = null, route = 'local', model = '',
    promptTokens = 0, completionTokens = 0, latencyMs = 0, outcome = 'success',
}) {
    try {
        const cost = estimateCostMicro({ route, promptTokens, completionTokens });
        const ins = await db.query(
            `INSERT INTO ai_provider_usage
               (user_id, provider_id, prediction_id, route, model,
                prompt_tokens, completion_tokens, latency_ms, cost_micro_cny, outcome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, providerId, predictionId, route, String(model || '').slice(0, 80),
             promptTokens, completionTokens, latencyMs, cost, outcome]
        );
        return ins.insertId;
    } catch (_) {
        return null;   // 成本记账失败不影响主流程
    }
}

/**
 * 汇总指标（供 §12 的 llm_call_rate / fallback_rate / cost_per_prediction）。
 *
 * @returns {Promise<object>}
 */
async function usageMetrics(db, userId, days = 30) {
    const out = {
        total_predictions: 0, local_count: 0, llm_count: 0, fallback_count: 0,
        llm_call_rate: 0, fallback_rate: 0,
        total_cost_micro_cny: 0, cost_per_prediction_micro: 0,
        avg_latency_ms: 0,
    };
    try {
        const rows = await db.query(
            `SELECT route, COUNT(*) AS cnt, SUM(cost_micro_cny) AS cost, AVG(latency_ms) AS lat
               FROM ai_provider_usage
              WHERE user_id = ? AND created_at >= CURRENT_TIMESTAMP - INTERVAL '${Number(days)} days'
              GROUP BY route`,
            [userId]
        );
        let latSum = 0; let latN = 0;
        for (const r of rows) {
            const n = Number(r.cnt);
            out.total_predictions += n;
            out.total_cost_micro_cny += Number(r.cost) || 0;
            if (r.route === 'local') out.local_count += n;
            else if (r.route === 'fallback') out.fallback_count += n;
            else out.llm_count += n;
            latSum += (Number(r.lat) || 0) * n; latN += n;
        }
        if (out.total_predictions > 0) {
            out.llm_call_rate = Number((out.llm_count / out.total_predictions).toFixed(4));
            out.fallback_rate = Number((out.fallback_count / out.total_predictions).toFixed(4));
            out.cost_per_prediction_micro = Math.round(out.total_cost_micro_cny / out.total_predictions);
        }
        if (latN > 0) out.avg_latency_ms = Math.round(latSum / latN);
    } catch (_) {
        // MySQL 不支持 INTERVAL 'N days' 语法 → 退回不带时间窗的全量统计
        try {
            const rows = await db.query(
                `SELECT route, COUNT(*) AS cnt, SUM(cost_micro_cny) AS cost
                   FROM ai_provider_usage WHERE user_id = ? GROUP BY route`,
                [userId]
            );
            for (const r of rows) {
                const n = Number(r.cnt);
                out.total_predictions += n;
                out.total_cost_micro_cny += Number(r.cost) || 0;
                if (r.route === 'local') out.local_count += n;
                else if (r.route === 'fallback') out.fallback_count += n;
                else out.llm_count += n;
            }
            if (out.total_predictions > 0) {
                out.llm_call_rate = Number((out.llm_count / out.total_predictions).toFixed(4));
                out.fallback_rate = Number((out.fallback_count / out.total_predictions).toFixed(4));
                out.cost_per_prediction_micro = Math.round(out.total_cost_micro_cny / out.total_predictions);
            }
        } catch (__) { /* 表不存在，返回全零 */ }
    }
    return out;
}

module.exports = { recordUsage, usageMetrics, estimateCostMicro, PRICE_PER_1K };
