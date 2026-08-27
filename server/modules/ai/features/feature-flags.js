/* ============================================
   Feature Flags
   ------------------------------------------------
   通过环境变量控制各功能模块的开关，
   支持按用户 ID 段灰度（USER_ID % N 匹配）或全局开关。

   环境变量：
     AI_V2_ENABLED=1                    — 全局总开关
     AI_V2_CHAT=1                       — v2 Chat API
     AI_V2_INSIGHTS=1                   — 主动洞察
     AI_V2_FORECAST=1                   — Forecast & Simulation
     AI_V2_TOOL_CALL=1                  — Tool Call
     AI_V2_MODEL_ROUTE=1                — 模型路由（非简单查询走 LLM）
     AI_V2_GRAY_PERCENT=10              — 灰度百分比（默认 10%）
   ============================================ */

const FEATURE_DEFAULTS = {
    AI_V2_ENABLED: false,
    AI_V2_CHAT: false,
    AI_V2_INSIGHTS: false,
    AI_V2_FORECAST: false,
    AI_V2_TOOL_CALL: false,
    AI_V2_MODEL_ROUTE: false,
    AI_V2_GRAY_PERCENT: 10,
};

/**
 * 获取特性开关状态
 * @param {string} flag  特性名（如 'chat'）
 * @param {number} [userId]  用户 ID（用于灰度判断）
 */
function isEnabled(flag, userId = null) {
    const envKey = `AI_V2_${flag.toUpperCase()}`;
    const globalEnabled = process.env[envKey] === '1';
    if (!globalEnabled) return false;

    // 全局启用时，检查灰度百分比
    const grayPercent = parseInt(process.env.AI_V2_GRAY_PERCENT || '10', 10);
    if (userId && grayPercent < 100) {
        return (userId % 100) < grayPercent;
    }
    return true;
}

/**
 * 检查多个特性
 * @param {string[]} flags
 * @param {number} [userId]
 */
function areEnabled(flags, userId = null) {
    return flags.every(f => isEnabled(f, userId));
}

/**
 * 获取所有特性状态（用于调试页面）
 */
function getAllFlags() {
    const result = {};
    for (const [key, defaultVal] of Object.entries(FEATURE_DEFAULTS)) {
        const flag = key.replace('AI_V2_', '').toLowerCase();
        result[flag] = {
            env: process.env[key] === '1',
            default: defaultVal,
            effective: process.env[key] === '1',
        };
    }
    return {
        ...result,
        gray_percent: parseInt(process.env.AI_V2_GRAY_PERCENT || '10', 10),
    };
}

/**
 * 获取用户可用的 v2 功能列表
 */
function getUserFeatures(userId) {
    return {
        chat: isEnabled('chat', userId),
        insights: isEnabled('insights', userId),
        forecast: isEnabled('forecast', userId),
        toolCall: isEnabled('tool_call', userId),
        modelRoute: isEnabled('model_route', userId),
    };
}

module.exports = {
    isEnabled,
    areEnabled,
    getAllFlags,
    getUserFeatures,
};
