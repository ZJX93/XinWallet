/* ============================================
   Memory Retrieval（对话场景增强）
   ------------------------------------------------
   为对话场景提供记忆检索：检索与当前对话意图相关的记忆。
   在 transaction-parser 用的 retrieveMemory 基础上，
   新增 retrieveForChat：检索与当前对话意图相关的记忆。

   检索范围：
     - 历史对话偏好（interaction_style / language / currency）
     - 常用查询模式（用户常问的统计/债务/投资问题类型）
     - 商家/类目偏好（用于 Tool 结果解释时的个性化）
     - 近期重要洞察（最近的 importance >= 4 的洞察，供 AI 回复引用）

   注意：所有数据均来自已有数据库表（ai_rules / ai_user_profiles / ai_insights），
         不额外创建新表。
   ============================================ */

const db = require('../../../db');
const { NOISE_KEYS } = require('./memory-retrieval'); // 复用现有噪声词

/**
 * 对话场景的记忆检索结果结构
 */
const EMPTY_CHAT_MEMORY = {
    userPreferences: null,       // ai_user_profiles
    recentInsights: [],           // 最近 importance >= 4 的洞察
    relevantRules: [],            // 与当前对话相关的规则（按 type 归类）
    frequentQueries: [],         // 用户历史高频查询类型（从对话记录推断）
};

/**
 * retrieveForChat — 为 Chat 场景检索相关记忆
 *
 * @param {number} userId
 * @param {string} intent  当前意图（来自 intent-router）
 * @param {string} [message]  当前用户消息（用于关键词匹配规则）
 * @returns {Promise<object>} 对话场景记忆
 */
async function retrieveForChat(userId, intent, message = '') {
    try {
        const [profile, insights, rules] = await Promise.all([
            retrieveUserPreferences(userId),
            retrieveRecentInsights(userId),
            retrieveRelevantRules(userId, intent, message),
        ]);

        return {
            userPreferences: profile,
            recentInsights: insights,
            relevantRules: rules,
            frequentQueries: [],   // 后续配合对话记录完善
        };
    } catch (err) {
        console.warn('⚠️ retrieveForChat 失败，降级到空记忆:', err.message);
        return EMPTY_CHAT_MEMORY;
    }
}

/**
 * 获取用户 AI 偏好设置
 */
async function retrieveUserPreferences(userId) {
    try {
        const profile = await db.queryOne(
            `SELECT interaction_style, notification_enabled, insight_frequency,
                    insight_rank_threshold, preferences, stats_summary
               FROM ai_user_profiles WHERE user_id = ?`,
            [userId]
        );
        if (!profile) return null;
        return {
            interactionStyle: profile.interaction_style,
            notificationEnabled: profile.notification_enabled,
            insightFrequency: profile.insight_frequency,
            insightRankThreshold: profile.insight_rank_threshold,
            currency: profile.preferences?.currency || 'CNY',
            language: profile.preferences?.language || 'zh',
        };
    } catch (_) {
        return null;
    }
}

/**
 * 获取用户最近的重要洞察（importance >= 4，供 AI 回复时引用）
 * @param {number} userId
 * @param {number} [limit=5]
 */
async function retrieveRecentInsights(userId, { limit = 5 } = {}) {
    try {
        const rows = await db.query(
            `SELECT insight_type, importance, title, content, created_at
               FROM ai_insights
               WHERE user_id = ? AND status IN ('generated','read')
                 AND importance >= 4
               ORDER BY created_at DESC
               LIMIT ?`,
            [userId, limit]
        );
        return rows.map(r => ({
            type: r.insight_type,
            importance: r.importance,
            title: r.title,
            content: r.content.slice(0, 200),
            timeAgo: timeAgo(new Date(r.created_at)),
        }));
    } catch (_) {
        return [];
    }
}

/**
 * 根据意图和消息内容检索相关规则
 * @param {number} userId
 * @param {string} intent
 * @param {string} message
 */
async function retrieveRelevantRules(userId, intent, message = '') {
    try {
        // 按意图类型确定要检索的规则类型
        const ruleTypes = ruleTypesForIntent(intent);
        if (ruleTypes.length === 0) return [];

        const placeholders = ruleTypes.map(() => '?').join(',');
        const rows = await db.query(
            `SELECT type, match_key, category_id, confidence, status, updated_at
               FROM ai_rules
               WHERE user_id = ? AND type IN (${placeholders})
                 AND status IN ('candidate','verified','trusted')
               ORDER BY confidence DESC, updated_at DESC
               LIMIT 20`,
            [userId, ...ruleTypes]
        );

        // 额外：若消息中有商家名，优先返回该商家的规则
        if (message) {
            const merchantRules = await db.query(
                `SELECT type, match_key, category_id, confidence, status
                   FROM ai_rules
                   WHERE user_id = ? AND type = 'merchant_category'
                     AND match_key ILIKE ANY(?)  -- 包含商家名
                     AND status IN ('candidate','verified','trusted')
                   ORDER BY confidence DESC LIMIT 5`,
                [userId, message]
            );
            // 商家规则优先级更高，合并去重
            const seen = new Set();
            const merged = [];
            for (const r of [...merchantRules, ...rows]) {
                const key = `${r.type}:${r.match_key}`;
                if (!seen.has(key)) { seen.add(key); merged.push(r); }
            }
            return merged.slice(0, 15).map(r => ({
                type: r.type,
                matchKey: r.match_key,
                categoryId: r.category_id,
                confidence: r.confidence,
                status: r.status,
            }));
        }

        return rows.slice(0, 15).map(r => ({
            type: r.type,
            matchKey: r.match_key,
            categoryId: r.category_id,
            confidence: r.confidence,
            status: r.status,
        }));
    } catch (_) {
        return [];
    }
}

/**
 * 意图 → 相关规则类型映射
 */
function ruleTypesForIntent(intent) {
    const map = {
        transaction_parse: ['keyword_category', 'merchant_category'],
        budget: ['keyword_category'],
        statistics: ['keyword_category'],
        debt: ['merchant_category', 'keyword_category'],
        investment: ['keyword_category'],
        savings: ['keyword_category'],
    };
    return map[intent] || [];
}

/**
 * 相对时间格式化
 */
function timeAgo(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    const months = Math.floor(days / 30);
    return `${months}个月前`;
}

module.exports = {
    retrieveForChat,
    retrieveUserPreferences,
    retrieveRecentInsights,
    retrieveRelevantRules,
    EMPTY_CHAT_MEMORY,
};
