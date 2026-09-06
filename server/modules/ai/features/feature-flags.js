/* ============================================
   Feature Flags
   ------------------------------------------------
   三层优先级（运维页「功能开关」toggle 后立即生效）：
     1) ai_runtime_settings (DB 持久化覆写，按 user_id 隔离)
     2) process.env.AI_V2_* (容器启动时固化)
     3) FEATURE_DEFAULTS 默认值

   灰度策略：DB 覆写优先 → 不命中再走 ENV；ENV 未启用直接 false；
   ENV 启用时按 AI_V2_GRAY_PERCENT 灰度 (userId % 100 < percent)。

   性能：overrideCache 按 userId 懒加载 + PUT 时增量更新；
   读路径 isEnabled 保持 O(1)（除首次加载）。
   ============================================ */

const { DB_DIALECT } = require('../../../db'); // server/db.js
const db = require('../../../db');

// 默认值表
const FEATURE_DEFAULTS = {
    AI_V2_ENABLED: false,
    AI_V2_CHAT: false,
    AI_V2_INSIGHTS: false,
    AI_V2_FORECAST: false,
    AI_V2_TOOL_CALL: false,
    AI_V2_MODEL_ROUTE: false,
    AI_V2_GRAY_PERCENT: 10,
};

// 全部用户级功能开关；前端按 key 渲染 toggle 列表，label 由前端 i18n (aiStatus.feature.*) 提供
const FLAG_KEYS = ['chat', 'insights', 'forecast', 'tool_call', 'model_route'];

/**
 * 运行时覆写缓存：userId → Map<flag, boolean>
 *   - 首次访问某 userId 时查 DB 一次性加载
 *   - PUT 时单点更新缓存
 *   - 进程内命中即可；重启后从 DB 重新加载（持久化保证）
 */
const overrideCache = new Map();

/** 强制从 DB 重载某用户的所有覆写（运维排查用，目前未挂接口） */
function invalidateOverrideCache(userId) {
    overrideCache.delete(userId);
}

async function loadOverrides(userId) {
    if (userId == null) return new Map();
    if (overrideCache.has(userId)) return overrideCache.get(userId);
    const rows = await db.query(
        'SELECT key, value FROM ai_runtime_settings WHERE user_id = ?',
        [userId]
    );
    const m = new Map();
    for (const r of rows) {
        const v = r.value;
        if (v === true || v === false) m.set(r.key, v);
        else if (v === 1 || v === 0) m.set(r.key, !!v);
        else if (typeof v === 'string') m.set(r.key, v === 'true' || v === '1');
    }
    overrideCache.set(userId, m);
    return m;
}

/**
 * 获取特性开关状态（DB 覆写 > ENV > 默认值；ENV 启用时按灰度判断）
 *
 * @param {string} flag   特性名（chat / insights / forecast / tool_call / model_route）
 * @param {number} [userId]  用户 ID（用于灰度判断和 DB 覆写）
 * @returns {Promise<boolean>}
 */
async function isEnabled(flag, userId = null) {
    // 1) DB 覆写优先
    if (userId != null) {
        const m = await loadOverrides(userId);
        if (m.has(flag)) return m.get(flag);
    }

    // 2) ENV
    const envKey = `AI_V2_${flag.toUpperCase()}`;
    const envEnabled = process.env[envKey] === '1';
    if (!envEnabled) return false;

    // 3) 灰度（仅在 ENV 启用时判断）
    const grayPercent = parseInt(process.env.AI_V2_GRAY_PERCENT || '10', 10);
    if (userId != null && grayPercent < 100) {
        return (userId % 100) < grayPercent;
    }
    return true;
}

/**
 * 检查多个特性
 */
async function areEnabled(flags, userId = null) {
    for (const f of flags) {
        if (!(await isEnabled(f, userId))) return false;
    }
    return true;
}

/**
 * 获取所有特性状态（用于调试页面，ENV 视角）
 * 用户级有效状态用 getUserFeatures(userId)。
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
 * 获取用户可用的 v2 功能列表（已叠加 DB 覆写 + 灰度）
 */
async function getUserFeatures(userId) {
    // key 统一用 snake_case（与 FLAG_KEYS / DB / ENV / 前端 locale 一致）
    const out = {};
    for (const flag of FLAG_KEYS) out[flag] = await isEnabled(flag, userId);
    return out;
}

/** 获取 flag 元信息（key + i18n key）；前端按此渲染 toggle 列表 */
function getFlagMeta() {
    return FLAG_KEYS.map(k => ({ key: k }));
}

/**
 * 写入覆写（UPSERT）：运维页 toggle 后调用，立刻生效并持久化
 */
async function setOverride(userId, flag, value) {
    if (!FLAG_KEYS.includes(flag)) {
        throw new Error(`未知功能开关: ${flag}`);
    }
    const boolVal = !!value;
    const json = JSON.stringify(boolVal);
    if (DB_DIALECT === 'mysql') {
        await db.query(
            `INSERT INTO ai_runtime_settings (user_id, key, value, updated_at)
             VALUES (?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE value = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP`,
            [userId, flag, json, json]
        );
    } else {
        await db.query(
            `INSERT INTO ai_runtime_settings (user_id, key, value, updated_at)
             VALUES (?, ?, ?::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [userId, flag, json]
        );
    }
    // 同步更新缓存：先确保已从 DB 完整加载（避免缓存为空 Map 覆盖已有覆写）
    await loadOverrides(userId);
    const m = overrideCache.get(userId);
    if (!m) { const nm = new Map(); nm.set(flag, boolVal); overrideCache.set(userId, nm); }
    else { m.set(flag, boolVal); }
    return { flag, value: boolVal };
}

/** 清除覆写（回到 ENV 决定的默认值） */
async function clearOverride(userId, flag) {
    if (!FLAG_KEYS.includes(flag)) {
        throw new Error(`未知功能开关: ${flag}`);
    }
    await db.query('DELETE FROM ai_runtime_settings WHERE user_id = ? AND key = ?', [userId, flag]);
    // 同步缓存：先确保已加载，再删除该 key
    await loadOverrides(userId);
    const m = overrideCache.get(userId);
    if (m) m.delete(flag);
}

/** 列出某用户当前所有覆写（{flag: boolean}） */
async function listOverrides(userId) {
    const m = await loadOverrides(userId);
    return Object.fromEntries(m);
}

module.exports = {
    isEnabled,
    areEnabled,
    getAllFlags,
    getUserFeatures,
    getFlagMeta,
    setOverride,
    clearOverride,
    listOverrides,
    invalidateOverrideCache,
    FLAG_KEYS,
    FEATURE_DEFAULTS,
};