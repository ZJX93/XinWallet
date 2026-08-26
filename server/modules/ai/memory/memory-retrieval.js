/* ============================================
   AI v0.2 · Memory Retrieval —— 五层记忆汇总
   ------------------------------------------------
   方案 §3 结尾原文：
     「Memory Retrieval 不直接替代业务判断，而是输出 evidence candidates，
       由 Decision Engine 统一裁决。」

   ⛔ 因此本模块【绝不返回结论】。返回的是一组带 source/weight/confidence 的
      候选证据，Decision Engine 按优先级链裁决。本模块也不写库。

   汇总顺序（仅决定 candidates 数组的排列，不代表最终采纳）：
     Procedural（手工/学习规则） → Semantic（习惯假设）
     → Episodic（历史分布） → Negative（否证，作为扣分项）
   ============================================ */

const { retrieveEpisodic, retrieveFrequentMerchants, dominantAccount } = require('./episodic-memory');
const { retrieveMemoryItems, induceSemantic, isNegated } = require('./semantic-memory');
const { retrieveRules } = require('../rules/rule-store');
const { normalizeKey, isUsefulKey, chunkKeys, NOISE_KEYS } = require('./keys');

/**
 * 从文本与抽取结果中提取候选检索键。
 * 键的质量直接决定记忆命中率：商家名最准，其次是文本里的长词片段。
 *
 * ⛔ 归一化必须与写侧（evidence-engine.learnableKey）走同一份 keys.js：
 *    读侧查「星巴克」而写侧存「在星巴克」时，规则永远命中不了自己且不报错。
 *
 * @param {string} text
 * @param {Array} [merchants] 已抽取的商家名
 * @returns {string[]}
 */
function buildRetrievalKeys(text, merchants = []) {
    const keys = new Set();
    for (const m of merchants) {
        const k = normalizeKey(m);
        if (isUsefulKey(k)) keys.add(k);
    }
    // 文本中的连续中文/字母片段（2-8 字），作为兜底检索键
    for (const c of chunkKeys(text, 8)) keys.add(c);
    // 限制检索键数量：每个键一次 SQL，无上限会让长文本拖垮 parse
    return [...keys].slice(0, 8);
}

// 高频噪声词已统一到 ./keys.js（读写两侧共用同一份，避免键归一漂移）。

/**
 * 检索全部记忆层，产出 evidence candidates。
 *
 * @param {object} db
 * @param {object} wm      Working Memory
 * @param {object} params
 * @param {string} params.text
 * @param {Array}  params.merchants 已抽取的商家名数组
 * @returns {Promise<{candidates:Array, layers:object, keys:string[], frequent_merchants:string[]}>}
 */
async function retrieveMemory(db, wm, { text, merchants = [] }) {
    const keys = buildRetrievalKeys(text, merchants);

    // 四层并行检索：彼此独立，串行只会白等
    const [rules, episodic, memItems, frequentMerchants] = await Promise.all([
        retrieveRules(db, wm, keys),
        retrieveEpisodic(db, wm, keys),
        retrieveMemoryItems(db, wm, keys),
        retrieveFrequentMerchants(db, wm, 50),
    ]);

    const inducedSemantic = induceSemantic(episodic);
    const candidates = [];

    // ---- 层 1：Procedural Memory（规则）----
    for (const r of rules) {
        if (!r.active) continue;                 // candidate 状态不参与裁决
        if (!r.target_category_id) continue;
        candidates.push({
            layer: 'procedural',
            source: r.origin === 'manual' ? 'manual_rule' : `learned_rule_${r.status}`,
            priority: r.priority,
            match_key: r.match_key,
            field: fieldOfRuleType(r.rule_type),
            category_id: r.target_category_id,
            account_id: r.target_account_id || null,
            type: r.target_type || null,
            rule_id: r.id,
            // 手工规则给 0.97，trusted 0.94，verified 0.88 —— 均高于类目关键词的 0.90？
            // 不：verified 刻意压到 0.88 < 0.90，让「关键词明确」的场景仍以关键词为准，
            // 只有 trusted 及以上才允许覆盖关键词判定。
            confidence: r.origin === 'manual' ? 0.97 : (r.status === 'trusted' ? 0.94 : 0.88),
            evidence_score: r.evidence_score,
            decay_score: r.decay_score,
            accuracy_rate: r.accuracy_rate,
        });
    }

    // ---- 层 2：Semantic Memory（持久化习惯假设）----
    for (const s of memItems.semantic) {
        if (!s.category_id || s.confidence <= 0) continue;
        candidates.push({
            layer: 'semantic',
            source: 'semantic_memory',
            priority: 40,
            match_key: s.subject,
            field: 'category',
            category_id: s.category_id,
            confidence: Math.min(0.86, s.confidence),  // 归纳结论上限低于规则
            support: s.support,
            refute: s.refute,
            memory_id: s.id,
        });
    }

    // ---- 层 3：在线归纳的 Semantic 候选（本次从 Episodic 直接归纳）----
    for (const s of inducedSemantic) {
        if (s.kind !== 'semantic' || !s.category_id) continue;
        candidates.push({
            layer: 'semantic_induced',
            source: 'induced_habit',
            priority: 50,
            match_key: s.subject,
            field: 'category',
            category_id: s.category_id,
            type: s.type,
            confidence: Math.min(0.84, s.confidence),
            support: s.support,
            total: s.total,
            ratio: s.ratio,
        });
    }

    // ---- 层 4：Episodic Memory（历史分布，最弱证据）----
    for (const [subject, rows] of Object.entries(episodic.by_key || {})) {
        const top = rows.filter(r => r.category_id).sort((a, b) => b.count - a.count)[0];
        if (!top) continue;
        const total = rows.reduce((a, r) => a + r.count, 0);
        candidates.push({
            layer: 'episodic',
            source: 'history_top',
            priority: 60,
            match_key: subject,
            field: 'category',
            category_id: top.category_id,
            type: top.type,
            account_id: dominantAccount(episodic, subject),
            // 历史分布只作参考：置信度上限 0.78，低于 category 阈值 0.7 之上一点，
            // 单靠历史不足以让 verdict 变 ready（仍会因其它字段被卡）。
            confidence: Number(Math.min(0.78, (top.count / total) * 0.8).toFixed(4)),
            support: top.count,
            total,
        });
    }

    // 按优先级排序（priority 小的在前；同级按置信度降序）
    candidates.sort((a, b) => (a.priority - b.priority) || (b.confidence - a.confidence));

    // ---- 层 5：Negative Memory —— 作为过滤器而非候选 ----
    const negated = candidates.filter(c => isNegated(memItems, c.match_key, c.category_id));
    const accepted = candidates.filter(c => !negated.includes(c));

    return {
        candidates: accepted,
        negated,                              // 被否证的候选，写入 decision_trace 供审计
        keys,
        frequent_merchants: frequentMerchants,
        layers: {
            procedural: rules.length,
            semantic: memItems.semantic.length,
            semantic_induced: inducedSemantic.filter(s => s.kind === 'semantic').length,
            episodic: Object.keys(episodic.by_key || {}).length,
            negative: memItems.negative.length,
        },
        raw: { rules, episodic, memory_items: memItems, induced: inducedSemantic },
    };
}

/** 规则类型 → 它影响的字段 */
function fieldOfRuleType(t) {
    if (t === 'merchant_account') return 'account';
    if (t === 'merchant_type') return 'type';
    return 'category';
}

/**
 * 可序列化的记忆快照（写入 ai_predictions.memory_snapshot）。
 * ⛔ 只存摘要不存全量：raw 里含大量历史行，全量入库会让快照膨胀到几百 KB。
 */
function snapshotMemory(mem) {
    return {
        keys: mem.keys,
        layers: mem.layers,
        candidates: mem.candidates.slice(0, 12).map(c => ({
            layer: c.layer, source: c.source, field: c.field, match_key: c.match_key,
            category_id: c.category_id, confidence: c.confidence,
            rule_id: c.rule_id || null, priority: c.priority,
        })),
        negated: mem.negated.slice(0, 6).map(c => ({
            layer: c.layer, match_key: c.match_key, category_id: c.category_id,
        })),
        frequent_merchants_count: mem.frequent_merchants.length,
    };
}

/** 空记忆（数据库不可用时的安全降级：退回纯确定性抽取） */
function emptyMemory() {
    return {
        candidates: [], negated: [], keys: [], frequent_merchants: [],
        layers: { procedural: 0, semantic: 0, semantic_induced: 0, episodic: 0, negative: 0 },
        raw: { rules: [], episodic: { by_key: {} }, memory_items: { semantic: [], negative: [] }, induced: [] },
    };
}

module.exports = {
    retrieveMemory, buildRetrievalKeys, snapshotMemory, emptyMemory, NOISE_KEYS,
};
