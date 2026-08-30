/* ============================================
   AI 识别行为设置（每用户，Web 设置页可改）
   ------------------------------------------------
   把原先只能靠环境变量控制的 AI_* 开关变成可运行时调整的
   用户级设置：DB 保存值优先，未保存的项回退到 env / 内置默认。
   这样部署者不用重启服务、不用改 env，就能在 Web 端
   「AI 配置」页直接调识别策略。

   覆盖的环境变量：
     model_route        ← AI_ALLOW_MODEL_ROUTE        （模型复核总开关，默认 true）
     model_route_simple ← AI_MODEL_ROUTE_SIMPLE       （简单输入也过模型，默认 false）
     llm_first          ← AI_LLM_FIRST                （模型主抽取，默认 false）
     few_shot           ← AI_FEWSHOT_ENABLED          （历史先例注入，默认 true）
     prompt_version     ← AI_PARSER_PROMPT_VERSION    （v3/v2/v1，默认 v3）

   幂等：表不存在 / 解析失败一律回退默认，绝不阻塞记账链路。
   ============================================ */

const SETTING_KEYS = ['model_route', 'model_route_simple', 'llm_first', 'few_shot', 'prompt_version', 'ai_name'];
const PROMPT_VERSIONS = ['v3'];

/** env 布尔读取：仅识别 false/0/no 为关；否则返回 fallback */
function envBool(key, fallback) {
    const raw = String(process.env[key] || '').trim().toLowerCase();
    if (raw === 'false' || raw === '0' || raw === 'no') return false;
    if (raw === 'true' || raw === '1' || raw === 'yes') return true;
    return fallback;
}

/** 从环境变量推导当前生效默认值（与各模块原读取逻辑保持一致） */
function envDefaults() {
    return {
        model_route: envBool('AI_ALLOW_MODEL_ROUTE', true),
        model_route_simple: envBool('AI_MODEL_ROUTE_SIMPLE', false),
        llm_first: envBool('AI_LLM_FIRST', false),
        few_shot: envBool('AI_FEWSHOT_ENABLED', true),
        prompt_version: (() => {
            const raw = String(process.env.AI_PARSER_PROMPT_VERSION || '').trim().toLowerCase();
            return PROMPT_VERSIONS.includes(raw) ? raw : 'v3';
        })(),
        // AI 助手自定义名称（Web 设置页可改）；空字符串表示使用默认「小鑫」
        ai_name: '',
    };
}

/** PG 的 JSONB 已自动反序列化，MySQL 的 JSON 列回来是字符串 —— 统一兜底 */
function safeJson(v, dflt) {
    if (v === null || v === undefined) return dflt;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (_) { return dflt; }
}

/**
 * 读取某用户当前的 AI 识别设置（DB 优先，env / 内置默认兜底）。
 * @param {object} db
 * @param {number} userId
 * @returns {Promise<{model_route:boolean, model_route_simple:boolean,
 *                    llm_first:boolean, few_shot:boolean, prompt_version:string}>}
 */
async function getAiSettings(db, userId) {
    const defaults = envDefaults();
    let stored = {};
    try {
        const row = await db.queryOne('SELECT settings FROM ai_settings WHERE user_id = ?', [userId]);
        if (row) stored = safeJson(row.settings, {});
    } catch (_) {
        // 表尚未建立（老库未执行新 schema）→ 回退 env 默认
    }
    const out = { ...defaults };
    for (const k of SETTING_KEYS) {
        if (stored[k] === undefined || stored[k] === null) continue;
        out[k] = stored[k];
    }
    return sanitize(out);
}

/** 校验并规整设置对象，只保留合法 key/取值 */
function sanitize(settings) {
    const out = envDefaults();
    const src = settings || {};
    for (const k of ['model_route', 'model_route_simple', 'llm_first', 'few_shot']) {
        if (typeof src[k] === 'boolean') out[k] = src[k];
        else if (src[k] === 1 || src[k] === 0) out[k] = !!src[k];
    }
    if (PROMPT_VERSIONS.includes(String(src.prompt_version || '').toLowerCase())) {
        out.prompt_version = String(src.prompt_version).toLowerCase();
    }
    // ai_name：用户自定义的 AI 助手名称（纯展示，前端/对话自称使用）。
    // 限制长度与空白，避免超长或控制字符污染 prompt / UI。
    if (typeof src.ai_name === 'string') {
        out.ai_name = src.ai_name.trim().replace(/\s+/g, ' ').slice(0, 20);
    }
    return out;
}

/**
 * 保存设置（部分更新：只写 patch 里出现的合法 key）。
 * 返回保存后完整的生效设置。
 *
 * ⛔ upsert 必须走 db.upsertSql 双方言构造器：
 *    PG → ON CONFLICT (user_id) DO UPDATE ...
 *    MySQL → ON DUPLICATE KEY UPDATE ...
 *    裸写 ON CONFLICT 会在 MySQL 下 syntax error（本项目默认方言是 PG）。
 *
 * ⛔ PG 的 db.prepare() 会对无 RETURNING 的 INSERT 自动追加 `RETURNING id`，
 *    而 ai_settings 只有 user_id 主键、没有 id 列 → 会报 column "id" does not exist。
 *    因此 PG 分支必须显式追加 `RETURNING user_id` 抢占该逻辑（autoReturning
 *    检测到 RETURNING 即跳过）；MySQL 不支持 RETURNING，走原样分支。
 */
async function updateAiSettings(db, userId, patch) {
    const current = await getAiSettings(db, userId);
    const next = sanitize({ ...current, ...(patch || {}) });
    const json = JSON.stringify(next);
    const sql = db.upsertSql('ai_settings', ['user_id'], ['settings', 'updated_at'])
        + (db.DB_DIALECT === 'mysql' ? '' : ' RETURNING user_id');
    try {
        await db.query(sql, [userId, json, new Date()]);
    } catch (_) {
        // 老库无表时尝试建表后重试一次，避免「升级后未跑 schema」导致设置页直接 500
        await db.query(
            'CREATE TABLE IF NOT EXISTS ai_settings (user_id INT PRIMARY KEY, settings JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
        );
        await db.query(sql, [userId, json, new Date()]);
    }
    return next;
}

module.exports = {
    SETTING_KEYS,
    PROMPT_VERSIONS,
    envDefaults,
    getAiSettings,
    updateAiSettings,
    sanitize,
};
