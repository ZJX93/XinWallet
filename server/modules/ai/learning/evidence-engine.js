/* ============================================
<<<<<<< HEAD
   Evidence Engine —— 证据消费与规则演化
   ------------------------------------------------
   这是「越用越聪明」的唯一开关。
=======
   AI v0.2 · §4 Evidence Engine —— 证据消费与规则演化
   ------------------------------------------------
   这是 v0.2「越用越聪明」的唯一开关。
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0

   ⛔ 修复的历史缺陷（2026-08-25 审计发现）：
      Phase 1 只把 ai_feedback_events 【写进去】，全仓没有一处 `FROM ai_feedback_events`
      —— 证据只进不出，用户每次修正都被完整记录但【不会改变下一次的识别结果】。
      本模块把这条链路接通：feedback event → 规则/记忆更新 → 下次 parse 命中。

   ⛔ 方案 §11 铁律：「Commit 成功后异步触发 Learning/Evidence。
      学习失败不得回滚已成功保存的账本。」
      ⇒ 本模块的所有入口都在【事务之外】调用，且全部 try/catch 吞异常。
        任何 throw 都是 bug。
   ============================================ */

const { applyEvidence, markRuleHit, EVIDENCE_WEIGHTS } = require('../rules/rule-store');
const { upsertMemoryItem } = require('../memory/semantic-memory');
const { normalizeKey, isUsefulKey, chunkKeys } = require('../memory/keys');

/**
 * 从一笔交易里提炼可学习的「主体键」。
 * 优先商家（最稳定），退回备注里的显著片段。
 *
 * ⛔ 必须与读侧 memory-retrieval.buildRetrievalKeys 用同一份 keys.js 归一：
 *    否则会出现「写进去的是『在星巴克』、查出来用的是『星巴克』」——
 *    规则永远命中不了自己，学习看着在攒分实际零效果，且完全不报错。
 *    （这正是 2026-08-25 端到端验证抓到的真实缺陷。）
 */
function learnableKey(txn) {
    const m = normalizeKey(txn.merchant);
    if (isUsefulKey(m)) return m;

    /*  ⛔ 必须 raw_segment 优先、note 兜底（2026-08-25 修正，顺序反了会静默失效）：
        note 现在由 note-composer 规范化成「场景-对象」，当交易【没有商家】
        且原文没有可用场景时，note 会退化成【纯类目名】（如「其他支出」）。
        此时若拿 note 当学习键，chunkKeys 取到的是「其他」——
        所有无商家交易共用同一个键，规则互相污染、学习完全无效，且不报任何错。
        raw_segment 保存的是用户原话（「随便花了18元」→ 键「随便」），才有区分度。 */
    const basis = String(txn.raw_segment || txn.note || '').trim();
    const chunks = chunkKeys(basis, 10);
    return chunks.length ? chunks[0] : null;
}

/**
 * commit 之后的学习入口（异步、幂等、绝不抛异常）。
 *
 * @param {object} db          db 模块（⚠️ 不要传事务连接：事务已提交）
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.bookId
 * @param {number} params.predictionId
 * @param {number} [params.feedbackEventId]
 * @param {'confirmed'|'corrected'} params.action
 * @param {Array}  params.candidateTxns  AI 原始预测
 * @param {Array}  params.finalTxns      用户最终确认的交易
 * @param {Array}  [params.matchedRuleIds] 本次 parse 命中的规则 id（用于 hit_count）
 * @returns {Promise<{learned:Array, errors:number}>}
 */
async function learnFromCommit(db, {
    userId, bookId, predictionId, feedbackEventId = null,
    action, candidateTxns = [], finalTxns = [], matchedRuleIds = [],
}) {
    const learned = [];
    let errors = 0;

    try {
        await markRuleHit(db, matchedRuleIds);
    } catch (_) { errors += 1; }

    for (const final of finalTxns) {
        try {
            const orig = candidateTxns.find(c => c.seq === final.seq) || {};
            const key = learnableKey(final) || learnableKey(orig);
            if (!key) continue;

            // 转账没有类目学习价值（类目固定为「转账」）
            if (final.type === 'transfer') continue;

            const finalCat = final.category_id || null;
            const origCat = orig.category_id || null;
            if (!finalCat) continue;

            const corrected = action === 'corrected' && origCat && origCat !== finalCat;

            if (corrected) {
                // ---- 用户改了类目：这是最强监督信号（+6）----
                // 1) 正向：为「新类目」累积证据，并把规则目标改到新类目
                const res = await applyEvidence(db, {
                    userId, bookId, ruleType: 'merchant_category', matchKey: key,
                    targetCategoryId: finalCat, eventType: 'explicit_correction',
                    predictionId, feedbackEventId, correct: false,
                    payload: { from_category_id: origCat, to_category_id: finalCat, seq: final.seq },
                });
                if (res) learned.push({ key, event: 'explicit_correction', ...res });

                // 2) 负向：把「旧类目」这条假设记为被证伪（Negative Memory）
                await upsertMemoryItem(db, {
                    userId, bookId, subject: key, predicate: 'category',
                    objectValue: String(origCat), categoryId: origCat, signal: 'refute',
                });
                // 3) 正向记忆：新类目 +1 支持
                await upsertMemoryItem(db, {
                    userId, bookId, subject: key, predicate: 'category',
                    objectValue: String(finalCat), categoryId: finalCat, signal: 'support',
                });
            } else {
                // ---- 用户直接确认：弱监督信号（+2）----
                const res = await applyEvidence(db, {
                    userId, bookId, ruleType: 'merchant_category', matchKey: key,
                    targetCategoryId: finalCat, eventType: 'explicit_confirmation',
                    predictionId, feedbackEventId, correct: true,
                    payload: { category_id: finalCat, seq: final.seq },
                });
                if (res) learned.push({ key, event: 'explicit_confirmation', ...res });

                await upsertMemoryItem(db, {
                    userId, bookId, subject: key, predicate: 'category',
                    objectValue: String(finalCat), categoryId: finalCat, signal: 'support',
                });
            }

            // 账户习惯：同一商家总用同一账户，也值得学（弱信号，不改类目规则）
            const acc = final.account_id || final.from_account_id;
            if (acc) {
                await applyEvidence(db, {
                    userId, bookId, ruleType: 'merchant_account', matchKey: key,
                    targetAccountId: acc, eventType: 'consistent_reuse',
                    predictionId, feedbackEventId, correct: true,
                    payload: { account_id: acc },
                });
            }
        } catch (_) {
            errors += 1;   // 单笔学习失败不影响其余笔
        }
    }

    return { learned, errors };
}

/**
 * 用户显式创建规则（+10，最高权重，直接 trusted）。
 * 对应方案 §4 的 manual_rule_creation 事件。
 */
async function createManualRule(db, {
    userId, bookId, matchKey, ruleType = 'merchant_category',
    targetCategoryId = null, targetAccountId = null, targetType = null,
}) {
    // 先写 feedback event，再让 rule-store 累积证据 —— 保持「事件 → 证据」单向链路
    let feedbackEventId = null;
    try {
        const ins = await db.query(
            `INSERT INTO ai_feedback_events (user_id, book_id, event_type, evidence_score, payload)
             VALUES (?, ?, 'manual_rule_creation', ?, ?)`,
            [userId, bookId, EVIDENCE_WEIGHTS.manual_rule_creation,
             JSON.stringify({ match_key: matchKey, rule_type: ruleType, target_category_id: targetCategoryId })]
        );
        feedbackEventId = ins.insertId;
    } catch (_) { /* 事件写入失败不阻断规则创建 */ }

    return applyEvidence(db, {
        userId, bookId, ruleType, matchKey,
        targetCategoryId, targetAccountId, targetType,
        eventType: 'manual_rule_creation', origin: 'manual',
        feedbackEventId, correct: true,
        payload: { created_by: 'user' },
    });
}

/**
 * 停用规则（-20，直接 disabled 且不自动复活）。
 * 对应方案 §4 的 rule_disabled 事件与「错误习惯可 disabled」验收标准。
 */
async function disableRule(db, { userId, ruleId, reason = '' }) {
    try {
        const rule = await db.queryOne(
            `SELECT * FROM ai_rules WHERE id = ? AND user_id = ?`, [ruleId, userId]
        );
        if (!rule) return { ok: false, error: '规则不存在' };

        const newScore = (Number(rule.evidence_score) || 0) + EVIDENCE_WEIGHTS.rule_disabled;
        await db.query(
            `UPDATE ai_rules SET status = 'disabled', evidence_score = ?, decay_score = 0 WHERE id = ?`,
            [newScore, ruleId]
        );

        let feedbackEventId = null;
        try {
            const ins = await db.query(
                `INSERT INTO ai_feedback_events (user_id, book_id, rule_id, event_type, evidence_score, payload)
                 VALUES (?, ?, ?, 'rule_disabled', ?, ?)`,
                [userId, rule.book_id, ruleId, EVIDENCE_WEIGHTS.rule_disabled,
                 JSON.stringify({ reason })]
            );
            feedbackEventId = ins.insertId;
        } catch (_) { /* 同上 */ }

        await db.query(
            `INSERT INTO ai_rule_evidence
               (rule_id, user_id, feedback_event_id, event_type, delta, score_after, status_after, payload)
             VALUES (?, ?, ?, 'rule_disabled', ?, ?, 'disabled', ?)`,
            [ruleId, userId, feedbackEventId, EVIDENCE_WEIGHTS.rule_disabled, newScore,
             JSON.stringify({ reason })]
        );

        return { ok: true, id: ruleId, status: 'disabled', evidence_score: newScore };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/** 重新启用被停用的规则（回到 candidate，重新攒证据） */
async function enableRule(db, { userId, ruleId }) {
    try {
        const rule = await db.queryOne(
            `SELECT * FROM ai_rules WHERE id = ? AND user_id = ?`, [ruleId, userId]
        );
        if (!rule) return { ok: false, error: '规则不存在' };
        await db.query(
            `UPDATE ai_rules SET status = 'candidate', evidence_score = 0, decay_score = 0 WHERE id = ?`,
            [ruleId]
        );
        return { ok: true, id: ruleId, status: 'candidate' };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * 检测矛盾（contradiction，-8）：同一 match_key 出现两个不同高分类目。
 * 由定期任务或规则读取时调用；此处提供纯查询版本供 API 展示。
 */
async function detectContradictions(db, userId) {
    try {
        return await db.query(
            `SELECT match_key, COUNT(DISTINCT target_category_id) AS variants,
                    SUM(sample_count) AS samples
               FROM ai_rules
              WHERE user_id = ? AND rule_type = 'merchant_category'
                AND status IN ('verified','trusted')
              GROUP BY match_key
             HAVING COUNT(DISTINCT target_category_id) > 1
              ORDER BY samples DESC
              LIMIT 20`,
            [userId]
        );
    } catch (_) {
        return [];
    }
}

/**
 * 读取证据统计（供「越用越聪明」的可视化与验收标准 #5 举证）。
 */
async function evidenceStats(db, userId) {
    const out = {
        feedback_events: {}, rules: {}, memory: {},
    };
    try {
        const ev = await db.query(
            `SELECT event_type, COUNT(*) AS cnt, SUM(evidence_score) AS score
               FROM ai_feedback_events WHERE user_id = ? GROUP BY event_type`,
            [userId]
        );
        for (const r of ev) {
            out.feedback_events[r.event_type] = { count: Number(r.cnt), score: Number(r.score) };
        }
    } catch (_) { /* 表不存在 */ }

    try {
        const rs = await db.query(
            `SELECT status, COUNT(*) AS cnt FROM ai_rules WHERE user_id = ? GROUP BY status`,
            [userId]
        );
        for (const r of rs) out.rules[r.status] = Number(r.cnt);
    } catch (_) { /* 表不存在 */ }

    try {
        const ms = await db.query(
            `SELECT kind, COUNT(*) AS cnt FROM ai_memory_items WHERE user_id = ? GROUP BY kind`,
            [userId]
        );
        for (const r of ms) out.memory[r.kind] = Number(r.cnt);
    } catch (_) { /* 表不存在 */ }

    return out;
}

module.exports = {
    learnFromCommit, createManualRule, disableRule, enableRule,
    detectContradictions, evidenceStats, learnableKey,
};
