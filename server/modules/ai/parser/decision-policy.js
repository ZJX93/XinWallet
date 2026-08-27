/* ============================================
   AI v0.2 · §9 Decision Policy
   ------------------------------------------------
   把「字段级置信度」翻译成三态裁决 ready / needs_confirmation / invalid。

   ⛔ 本模块与 result-validator 的分界（很容易混）：
      result-validator  = 【结构与阈值】的机械校验（数据本身合法吗？分数够吗？）
      decision-policy   = 【策略层】：在校验结果之上叠加证据冲突、负面记忆、
                          路由降级等「要不要信」的判断，并可主动降级裁决。

      为什么不合并：方案 §9 明确「当证据冲突时，优先保留不确定性，不强行猜一个」。
      这是策略而非校验 —— 数据完全合法、分数全部达标，但两条 trusted 规则互相矛盾时，
      仍必须降级为 needs_confirmation。校验器无从表达这一点。
   ============================================ */

const { validateResult } = require('../validation/result-validator');

/**
 * 综合裁决。
 *
 * @param {object} params
 * @param {Array}  params.transactions  已由 Decision Engine 融合后的交易
 * @param {object} params.memory        Memory Retrieval 结果
 * @param {object} [params.routing]     Complexity Router 结果
 * @param {object} [params.thresholds]
 * @returns {{verdict:string, validation:object, policy:object}}
 */
function decidePolicy({ transactions, memory = {}, routing = null, thresholds }) {
    const validation = validateResult(transactions, thresholds);

    const policy = {
        base_verdict: validation.verdict,
        downgrades: [],
        conflicts: [],
        negated_count: (memory.negated || []).length,
        route: routing ? routing.route : 'local',
    };

    let verdict = validation.verdict;

    // ---- 降级规则 1：证据冲突 → 保留不确定性 ----
    const conflicts = detectConflicts(transactions, memory);
    if (conflicts.length > 0) {
        policy.conflicts = conflicts;
        if (verdict === 'ready') {
            verdict = 'needs_confirmation';
            policy.downgrades.push({
                rule: 'evidence_conflict',
                detail: `${conflicts.length} 处证据冲突，保留不确定性`,
            });
        }
    }

    // ---- 降级规则 2：负面记忆命中过 → 说明该主体历史上不稳定 ----
    if (policy.negated_count > 0 && verdict === 'ready') {
        verdict = 'needs_confirmation';
        policy.downgrades.push({
            rule: 'negative_memory',
            detail: `${policy.negated_count} 条候选被负面记忆否证，该商家历史归类不稳定`,
        });
    }

    // ---- 降级规则 3：Provider 故障走 fallback → 宁可让用户确认 ----
    //      方案 §10：「provider failure → fallback 或 needs_confirmation」
    if (routing && routing.route === 'fallback' && verdict === 'ready') {
        verdict = 'needs_confirmation';
        policy.downgrades.push({
            rule: 'provider_fallback',
            detail: '模型链路降级，结果未经模型复核',
        });
    }

    policy.final_verdict = verdict;
    return { verdict, validation: { ...validation, verdict }, policy };
}

/**
 * 检测证据冲突：同一笔交易上，两个【同等或更高优先级】的来源给出不同类目。
 *
 * ⚠️ 只有"势均力敌"才算冲突。手工规则 vs 历史分布不是冲突——
 *    优先级链已经明确前者胜出，那是正常裁决而非不确定。
 */
function detectConflicts(transactions, memory) {
    const conflicts = [];
    const candidates = memory.candidates || [];
    if (candidates.length === 0) return conflicts;

    for (const txn of transactions) {
        const applicable = candidates.filter(
            c => c.field === 'category' && c.category_id
                 && String(txn.raw_segment || txn.note || '').toLowerCase().includes(String(c.match_key).toLowerCase())
        );
        if (applicable.length < 2) continue;

        // 取最高优先级档位内的所有候选
        const bestPriority = Math.min(...applicable.map(c => c.priority));
        const topTier = applicable.filter(c => c.priority === bestPriority);
        const distinctCats = [...new Set(topTier.map(c => c.category_id))];

        if (distinctCats.length > 1) {
            conflicts.push({
                seq: txn.seq,
                field: 'category',
                priority_tier: bestPriority,
                candidates: topTier.map(c => ({
                    source: c.source, category_id: c.category_id, confidence: c.confidence,
                })),
            });
        }
    }
    return conflicts;
}

module.exports = { decidePolicy, detectConflicts };
