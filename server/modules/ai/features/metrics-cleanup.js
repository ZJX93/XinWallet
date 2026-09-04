/* ============================================
   Metrics & Cleanup
   ------------------------------------------------
   1. Metrics：各功能使用统计（覆盖度/成本/质量）
   2. Cleanup：资源清理（孤立数据/过期洞察）
   ============================================ */

const db = require('../../../db');

/**
 * N 天前的日期（YYYY-MM-DD）。
 * ⛔ 用于替代 MySQL 专属的 `NOW() - INTERVAL n DAY` / `CURDATE() - INTERVAL n DAY`：
 *    PostgreSQL 的 INTERVAL 字面量语法不同（要求 `INTERVAL '30 days'`），
 *    原生写法在 PG 下直接语法错误。统一在 JS 侧算好日期再参数绑定，双方言都可执行。
 */
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - Number(n));
    return d.toISOString().slice(0, 10);
}

// ============================================
// 1. Metrics（使用统计）
// ============================================

/**
 * 获取整体健康指标（供运维/调试页面）
 */
async function getHealthMetrics() {
    try {
        const [
            predictionCount, conversationCount, messageCount,
            insightCount, ruleCount, providerUsage,
            pendingFeedback, recentErrors,
        ] = await Promise.all([
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_predictions WHERE created_at >= ?`, [daysAgo(30)]),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_conversations WHERE created_at >= ?`, [daysAgo(30)]),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_messages WHERE created_at >= ?`, [daysAgo(30)]),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_insights WHERE created_at >= ?`, [daysAgo(30)]),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_rules WHERE status != 'disabled'`),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_provider_usage WHERE created_at >= ?`, [daysAgo(7)]),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_feedback_events WHERE processed = FALSE`),
            db.queryOne(`SELECT COUNT(*) AS cnt FROM ai_messages WHERE error IS NOT NULL AND created_at >= ?`, [daysAgo(7)]),
        ]);

        return {
            last_30_days: {
                predictions: parseInt(predictionCount?.cnt, 10) || 0,
                conversations: parseInt(conversationCount?.cnt, 10) || 0,
                messages: parseInt(messageCount?.cnt, 10) || 0,
                insights_generated: parseInt(insightCount?.cnt, 10) || 0,
            },
            current_state: {
                active_rules: parseInt(ruleCount?.cnt, 10) || 0,
                provider_api_calls_7d: parseInt(providerUsage?.cnt, 10) || 0,
                pending_feedback: parseInt(pendingFeedback?.cnt, 10) || 0,
                recent_errors_7d: parseInt(recentErrors?.cnt, 10) || 0,
            },
            timestamp: new Date().toISOString(),
        };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * 获取成本追踪（近 7 天按 Provider 分组）
 */
async function getCostBreakdown({ days = 7 } = {}) {
    try {
        const rows = await db.query(`
            SELECT
                route,
                SUM(prompt_tokens) AS total_prompt,
                SUM(completion_tokens) AS total_completion,
                SUM(latency_ms) AS total_latency_ms,
                SUM(cost_micro_cny) AS total_cost_micro_cny,
                COUNT(*) AS call_count
            FROM ai_provider_usage
            WHERE created_at >= ?
            GROUP BY route
            ORDER BY total_cost_micro_cny DESC
        `, [daysAgo(days)]);

        return {
            period_days: days,
            by_route: rows.map(r => ({
                route: r.route,
                calls: parseInt(r.call_count, 10),
                prompt_tokens: parseInt(r.total_prompt, 10),
                completion_tokens: parseInt(r.total_completion, 10),
                total_tokens: parseInt(r.total_prompt, 10) + parseInt(r.total_completion, 10),
                latency_ms_avg: r.call_count > 0 ? Math.round(parseInt(r.total_latency_ms, 10) / parseInt(r.call_count, 10)) : 0,
                cost_micro_cny: parseInt(r.total_cost_micro_cny, 10),
                cost_cny: (parseInt(r.total_cost_micro_cny, 10) / 1e6).toFixed(6),
            })),
            total_cost_cny: rows.reduce((s, r) => s + parseInt(r.total_cost_micro_cny || 0, 10), 0) / 1e6,
        };
    } catch (err) {
        return { error: err.message };
    }
}

// ============================================
// 2. Cleanup（旧 AI 清理）
// ============================================

/**
 * 清理孤立预测（prediction 已废弃但 transactions 未落账，且创建 > 7 天前）
 */
async function cleanupOrphanedPredictions(userId) {
    try {
        const result = await db.query(
            `DELETE FROM ai_predictions
               WHERE user_id = ?
                 AND status = 'pending'
                 AND created_at < ?`,
            [userId, daysAgo(7)]
        );
        return { deleted: result.rowCount || 0 };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * 归档旧对话（> 90 天无新消息的 active 对话 → archived）
 */
async function archiveOldConversations(userId) {
    try {
        const result = await db.query(
            `UPDATE ai_conversations
               SET status = 'archived', updated_at = NOW()
               WHERE user_id = ?
                 AND status = 'active'
                 AND last_message_at < ?`,
            [userId, daysAgo(90)]
        );
        return { archived: result.rowCount || 0 };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * 全量清理（运行所有清理任务）
 */
async function runFullCleanup(userId) {
    const results = {};

    try {
        results.insights_cleanup = await db.query(
            `DELETE FROM ai_insights
               WHERE user_id = ? AND created_at < ?
                 AND status IN ('read','dismissed','archived')`,
            [userId, daysAgo(90)]
        );
    } catch (_) { /* 表可能不存在 */ }

    try {
        results.orphaned_predictions = await cleanupOrphanedPredictions(userId);
    } catch (_) { /* 表可能不存在 */ }

    try {
        results.old_conversations = await archiveOldConversations(userId);
    } catch (_) { /* 表可能不存在 */ }

    return results;
}

module.exports = {
    getHealthMetrics,
    getCostBreakdown,
    cleanupOrphanedPredictions,
    archiveOldConversations,
    runFullCleanup,
};
