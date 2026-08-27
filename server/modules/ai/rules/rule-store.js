/* ============================================
   规则存储（Rule Store）
   ------------------------------------------------
   经过验证、可执行的手工规则与学习规则。对应表 ai_rules。

   状态机（方案 §4）：candidate → verified → trusted → degraded → disabled
   ⛔ 状态由 evidence_score + accuracy_rate 共同决定，绝不由 sample_count 单独决定：
      「同一个错误重复 100 次」不该变成 trusted。

   ⛔ 时间衰减：读取时按 last_confirmed_at 距今天数做半衰期折算（HALF_LIFE_DAYS），
      避免旧习惯永久统治新行为（方案 §4 明确要求）。衰减只影响【读取权重】，
      不销毁原始 evidence_score —— 原始分是审计事实，衰减分是当下判断力。
   ============================================ */

// 证据权重（方案 §4 原文照搬，不得擅自调整）
const EVIDENCE_WEIGHTS = {
    manual_rule_creation: 10,
    explicit_correction: 6,
    consistent_reuse: 3,
    explicit_confirmation: 2,
    contradiction: -8,
    rule_disabled: -20,
    // discard 明确为 0：方案 §8「只记录 discard，不默认形成负向学习」
    discard: 0,
    negative_signal: -4,
};

// 状态升降阈值（衰减后分数 decay_score 参与判定）
const STATUS_THRESHOLDS = {
    trusted: { score: 20, accuracy: 0.85, minSample: 5 },
    verified: { score: 8, accuracy: 0.6, minSample: 2 },
    degraded: { score: -6 },   // 低于此分降级
    disabled: { score: -18 },  // 低于此分停用
};

// 半衰期：90 天前的证据权重减半
const HALF_LIFE_DAYS = 90;

// 规则参与决策的最低状态（candidate 不参与，避免一次偶然就改变判定）
const ACTIVE_STATUSES = ['verified', 'trusted'];

/**
 * 检索可用规则。
 * @param {object} db
 * @param {object} wm  Working Memory
 * @param {string[]} keys 候选匹配键（商家 / 关键词，已小写）
 * @returns {Promise<Array>} 规则数组，含 decay_score / effective_weight
 */
async function retrieveRules(db, wm, keys = []) {
    const cleanKeys = [...new Set(keys.filter(k => k && k.length >= 2).map(k => k.toLowerCase()))];
    if (cleanKeys.length === 0) return [];

    try {
        const placeholders = cleanKeys.map(() => '?').join(',');
        const rows = await db.query(
            `SELECT * FROM ai_rules
              WHERE user_id = ?
                AND (book_id = ? OR book_id IS NULL)
                AND status IN ('verified','trusted','candidate')
                AND LOWER(match_key) IN (${placeholders})
              ORDER BY evidence_score DESC
              LIMIT 40`,
            [wm.userId, wm.bookId, ...cleanKeys]
        );
        return rows.map(r => decorate(r, wm.refDate));
    } catch (_) {
        // 表不存在（老库未升级）或查询失败 → 无规则可用，退回纯确定性抽取
        return [];
    }
}

/**
 * 给规则附加衰减后权重与优先级序号，便于 Decision Engine 排序。
 * 优先级链（方案 §9）：手工规则 > trusted 学习规则 > verified 习惯证据
 */
function decorate(row, refDate = new Date()) {
    const score = Number(row.evidence_score) || 0;
    const decayed = applyDecay(score, row.last_confirmed_at || row.last_matched_at, refDate);

    // priority 越小越优先。手工规则永远压过学习规则（用户显式意图 > 系统归纳）
    let priority = 90;
    if (row.origin === 'manual') priority = 10;
    else if (row.status === 'trusted') priority = 20;
    else if (row.status === 'verified') priority = 30;
    else priority = 80; // candidate：仅作为弱证据参考，不足以裁决

    return {
        id: row.id,
        rule_type: row.rule_type,
        match_key: row.match_key,
        target_category_id: row.target_category_id,
        target_account_id: row.target_account_id,
        target_type: row.target_type,
        origin: row.origin,
        status: row.status,
        evidence_score: score,
        decay_score: Number(decayed.toFixed(4)),
        sample_count: Number(row.sample_count) || 0,
        accuracy_rate: Number(row.accuracy_rate) || 0,
        priority,
        active: ACTIVE_STATUSES.includes(row.status) || row.origin === 'manual',
    };
}

/**
 * 时间衰减：按半衰期指数折算。
 * @param {number} score 原始分
 * @param {Date|string|null} lastAt 最近一次被确认/命中的时间
 */
function applyDecay(score, lastAt, refDate = new Date()) {
    if (!lastAt) return score;
    const t = lastAt instanceof Date ? lastAt : new Date(lastAt);
    if (Number.isNaN(t.getTime())) return score;
    const days = Math.max(0, (refDate.getTime() - t.getTime()) / 86400000);
    // 负分不衰减：坏记录不该因为"久了"就自动洗白
    if (score < 0) return score;
    return score * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/**
 * 依据分数与准确率推导状态。
 * @returns {'candidate'|'verified'|'trusted'|'degraded'|'disabled'}
 */
function deriveStatus({ evidence_score, accuracy_rate, sample_count, origin, current }) {
    const score = Number(evidence_score) || 0;
    const acc = Number(accuracy_rate) || 0;
    const n = Number(sample_count) || 0;

    // 已被显式停用的规则不自动复活：必须由用户重新启用（避免"错误习惯自己爬回来"）
    if (current === 'disabled') return 'disabled';

    if (score <= STATUS_THRESHOLDS.disabled.score) return 'disabled';
    if (score <= STATUS_THRESHOLDS.degraded.score) return 'degraded';

    // 手工规则天生 trusted：用户显式意图不需要"攒证据"
    if (origin === 'manual') return 'trusted';

    const T = STATUS_THRESHOLDS.trusted;
    if (score >= T.score && acc >= T.accuracy && n >= T.minSample) return 'trusted';

    const V = STATUS_THRESHOLDS.verified;
    if (score >= V.score && acc >= V.accuracy && n >= V.minSample) return 'verified';

    return 'candidate';
}

/**
 * 创建 / 更新规则并累计证据（Evidence Engine 的落库入口）。
 *
 * @returns {Promise<{id:number, status:string, evidence_score:number, delta:number}|null>}
 */
async function applyEvidence(db, {
    userId, bookId, ruleType = 'merchant_category', matchKey,
    targetCategoryId = null, targetAccountId = null, targetType = null,
    eventType, origin = 'learned', predictionId = null, feedbackEventId = null,
    correct = null,   // true=本次命中且被确认；false=本次被纠正；null=不计入准确率
    payload = {},
}) {
    if (!matchKey) return null;
    const key = String(matchKey).slice(0, 120);
    const delta = EVIDENCE_WEIGHTS[eventType] !== undefined ? EVIDENCE_WEIGHTS[eventType] : 0;

    try {
        const existing = await db.queryOne(
            `SELECT * FROM ai_rules
              WHERE user_id = ? AND book_id = ? AND rule_type = ? AND match_key = ?
              LIMIT 1`,
            [userId, bookId, ruleType, key]
        );

        let ruleId; let newScore; let newStatus;

        if (existing) {
            newScore = (Number(existing.evidence_score) || 0) + delta;
            const sample = (Number(existing.sample_count) || 0) + 1;
            const correctN = (Number(existing.correct_count) || 0) + (correct === true ? 1 : 0);
            const wrongN = (Number(existing.incorrect_count) || 0) + (correct === false ? 1 : 0);
            const judged = correctN + wrongN;
            const acc = judged > 0 ? correctN / judged : 0;

            newStatus = deriveStatus({
                evidence_score: newScore, accuracy_rate: acc, sample_count: sample,
                origin: existing.origin, current: existing.status,
            });

            // 目标值变更：用户把「星巴克」从 早午晚餐 改到 零食饮料 时，
            // 规则目标必须跟着改，否则规则永远指向错的类目。
            const nextCategory = (eventType === 'explicit_correction' && targetCategoryId)
                ? targetCategoryId
                : (existing.target_category_id || targetCategoryId);

            await db.query(
                `UPDATE ai_rules
                    SET evidence_score = ?, sample_count = ?, correct_count = ?, incorrect_count = ?,
                        accuracy_rate = ?, status = ?, decay_score = ?,
                        target_category_id = ?, target_account_id = ?, target_type = ?,
                        last_matched_at = CURRENT_TIMESTAMP,
                        last_confirmed_at = ${correct === true ? 'CURRENT_TIMESTAMP' : 'last_confirmed_at'},
                        last_corrected_at = ${correct === false ? 'CURRENT_TIMESTAMP' : 'last_corrected_at'}
                  WHERE id = ?`,
                [newScore, sample, correctN, wrongN, Number(acc.toFixed(4)), newStatus,
                 Math.max(0, newScore), nextCategory,
                 targetAccountId || existing.target_account_id,
                 targetType || existing.target_type, existing.id]
            );
            ruleId = existing.id;
        } else {
            // 新规则：负分事件不建规则（没有规则可扣分，建一条负分空规则毫无意义）
            if (delta <= 0) return null;
            newScore = delta;
            const correctN = correct === true ? 1 : 0;
            const wrongN = correct === false ? 1 : 0;
            const judged = correctN + wrongN;
            const acc = judged > 0 ? correctN / judged : 0;
            newStatus = deriveStatus({
                evidence_score: newScore, accuracy_rate: acc, sample_count: 1, origin, current: null,
            });

            const ins = await db.query(
                `INSERT INTO ai_rules
                   (user_id, book_id, rule_type, match_key, target_category_id, target_account_id,
                    target_type, origin, status, evidence_score, sample_count, hit_count,
                    correct_count, incorrect_count, accuracy_rate, decay_score,
                    last_matched_at, last_confirmed_at, last_corrected_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?,
                         CURRENT_TIMESTAMP,
                         ${correct === true ? 'CURRENT_TIMESTAMP' : 'NULL'},
                         ${correct === false ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
                [userId, bookId, ruleType, key, targetCategoryId, targetAccountId, targetType,
                 origin, newStatus, newScore, correctN, wrongN, Number(acc.toFixed(4)),
                 Math.max(0, newScore)]
            );
            ruleId = ins.insertId;
        }

        // 证据流水：每一分都能溯源（方案 §4「累计可审计证据」）
        await db.query(
            `INSERT INTO ai_rule_evidence
               (rule_id, user_id, feedback_event_id, prediction_id, event_type, delta, score_after, status_after, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ruleId, userId, feedbackEventId, predictionId, eventType, delta, newScore, newStatus,
             JSON.stringify(payload || {})]
        );

        return { id: ruleId, status: newStatus, evidence_score: newScore, delta };
    } catch (_) {
        // 学习失败不得影响账本（方案 §11）
        return null;
    }
}

/** 记录规则被命中（不改变分数，只更新 hit_count 与时间，用于 rule_hit_rate 指标） */
async function markRuleHit(db, ruleIds = []) {
    const ids = ruleIds.filter(Boolean);
    if (ids.length === 0) return;
    try {
        const placeholders = ids.map(() => '?').join(',');
        await db.query(
            `UPDATE ai_rules SET hit_count = hit_count + 1, last_matched_at = CURRENT_TIMESTAMP
              WHERE id IN (${placeholders})`,
            ids
        );
    } catch (_) { /* 指标类写入，失败可忽略 */ }
}

/**
 * 管理视图：列出用户规则（供「我的记账习惯」页展示与人工干预）。
 *
 * ⚠️ 与 retrieveRules 的区别：
 *   retrieveRules 是【决策通道】—— 按 match_key 精确命中、只取活跃状态、限 40 条；
 *   listRules 是【管理通道】—— 全状态可见（含 disabled/degraded），因为用户要能看到
 *   「我停用过哪些」才能重新启用。两者混用会让停用的规则从管理页消失。
 *
 * @returns {Promise<{rules:Array, total:number}>}
 */
async function listRules(db, { userId, bookId = null, status = null, limit = 100, offset = 0 }) {
    const where = ['user_id = ?'];
    const args = [userId];
    if (bookId) { where.push('(book_id = ? OR book_id IS NULL)'); args.push(bookId); }
    if (status) { where.push('status = ?'); args.push(status); }
    const clause = where.join(' AND ');

    try {
        const rows = await db.query(
            `SELECT * FROM ai_rules WHERE ${clause}
              ORDER BY (origin = 'manual') DESC, evidence_score DESC, id DESC
              LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}
             OFFSET ${Math.max(0, Number(offset) || 0)}`,
            args
        );
        const cnt = await db.queryOne(
            `SELECT COUNT(*) AS total FROM ai_rules WHERE ${clause}`, args
        );
        return {
            rules: rows.map(r => ({
                ...decorate(r),
                hit_count: Number(r.hit_count) || 0,
                correct_count: Number(r.correct_count) || 0,
                incorrect_count: Number(r.incorrect_count) || 0,
                last_matched_at: r.last_matched_at,
                last_confirmed_at: r.last_confirmed_at,
                last_corrected_at: r.last_corrected_at,
                created_at: r.created_at,
            })),
            total: cnt ? Number(cnt.total) : rows.length,
        };
    } catch (_) {
        // 老库未升级（表不存在）→ 返回空列表而非 500，让页面显示「暂无习惯」
        return { rules: [], total: 0 };
    }
}

/** 读取单条规则的证据流水（每一分的来源，方案 §4「可审计」） */
async function ruleEvidenceTrail(db, { userId, ruleId, limit = 50 }) {
    try {
        return await db.query(
            `SELECT e.id, e.event_type, e.delta, e.score_after, e.status_after,
                    e.payload, e.created_at
               FROM ai_rule_evidence e
              WHERE e.rule_id = ? AND e.user_id = ?
              ORDER BY e.id DESC
              LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}`,
            [ruleId, userId]
        );
    } catch (_) {
        return [];
    }
}

module.exports = {
    retrieveRules, applyEvidence, markRuleHit, deriveStatus, applyDecay, decorate,
    listRules, ruleEvidenceTrail,
    EVIDENCE_WEIGHTS, STATUS_THRESHOLDS, HALF_LIFE_DAYS, ACTIVE_STATUSES,
};
