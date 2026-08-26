/* ============================================
   AI v0.2 · §9 Decision Engine
   ------------------------------------------------
   方案原文的统一决策接口：
     decide({ extraction, memory, rules, context })
       → { transactions, field_confidence, evidence, route, decision }

   优先级链（方案 §9，不得擅自调整顺序）：
     手工规则 > trusted 学习规则 > verified 习惯证据 > 历史候选 > LLM

   ⛔ 三条铁律：
     1. 任何来源都必须经过 Result Validator（本模块只融合，不裁决合法性）。
     2. 证据冲突时优先保留不确定性 —— 交由 decision-policy 降级，本模块不"猜一个"。
     3. 类目 id 只能来自真实 categories 表；规则里的 target_category_id 也必须
        在 context.categories 里存在，否则视为失效规则直接丢弃
        （用户删过类目时规则会指向孤儿 id，落账会 422）。
   ============================================ */

const { decidePolicy } = require('./decision-policy');

// 记忆证据要覆盖确定性抽取结果，必须【严格更强】。
// 关键词命中给 0.90，因此 verified 规则（0.88）不足以覆盖 —— 这是刻意设计：
// 「文本里明写了『打车』」比「这个商家以前常记成餐饮」更可信。
const OVERRIDE_MARGIN = 0.001;

/**
 * 统一决策。
 *
 * @param {object} params
 * @param {object} params.extraction  { transactions, multi, split_source }
 * @param {object} params.memory      Memory Retrieval 结果
 * @param {object} params.context     Context Builder 结果 { wm, categories, accounts }
 * @param {object} [params.routing]   Complexity Router 结果
 * @returns {{transactions:Array, field_confidence:Array, evidence:object,
 *            route:string, decision:string, validation:object, policy:object}}
 */
function decide({ extraction, memory = {}, context, routing = null }) {
    const categories = (context && context.categories) || [];
    const catIds = new Set(categories.map(c => c.id));
    const candidates = (memory.candidates || []).filter(
        // 规则指向已删除的类目 → 失效，直接丢弃（否则 commit 会 422）
        c => c.field !== 'category' || !c.category_id || catIds.has(c.category_id)
    );

    const appliedEvidence = [];
    const matchedRuleIds = [];

    const transactions = (extraction.transactions || []).map((txn) => {
        const segment = String(txn.raw_segment || txn.note || '');
        const merged = { ...txn };

        // 找出适用于本笔的记忆候选（按 match_key 出现在片段中判定）
        const applicable = candidates
            .filter(c => segment.toLowerCase().includes(String(c.match_key).toLowerCase()))
            // 已按 priority 排过序，此处保持稳定
            .slice(0, 8);

        // ---- 类目融合 ----
        const catCandidate = applicable.find(c => c.field === 'category' && c.category_id);
        if (catCandidate) {
            const currentConf = (txn.confidence && txn.confidence.category) || 0;
            const isFallback = txn.evidence && txn.evidence.category === 'fallback_other';
            const stronger = catCandidate.confidence > currentConf + OVERRIDE_MARGIN;

            // 覆盖条件：记忆更强，或确定性抽取本就只是兜底（兜底 0.35 必被覆盖）
            if (stronger || isFallback) {
                const hit = categories.find(c => c.id === catCandidate.category_id);
                merged.category_id = catCandidate.category_id;
                merged.category_name = hit ? hit.name : merged.category_name;
                merged.confidence = { ...merged.confidence, category: catCandidate.confidence };
                merged.evidence = { ...merged.evidence, category: catCandidate.source };

                appliedEvidence.push({
                    seq: txn.seq, field: 'category', source: catCandidate.source,
                    layer: catCandidate.layer, from: txn.category_id, to: catCandidate.category_id,
                    confidence: catCandidate.confidence, rule_id: catCandidate.rule_id || null,
                });
                if (catCandidate.rule_id) matchedRuleIds.push(catCandidate.rule_id);
            }
        }

        // ---- 账户融合（仅在调用方未指定账户时补，绝不覆盖用户显式选择）----
        if (!merged.account_id) {
            const accCandidate = applicable.find(c => c.account_id);
            if (accCandidate) {
                const accounts = (context && context.accounts) || [];
                if (accounts.some(a => a.id === accCandidate.account_id)) {
                    merged.account_id = accCandidate.account_id;
                    merged.evidence = { ...merged.evidence, account: accCandidate.source };
                    appliedEvidence.push({
                        seq: txn.seq, field: 'account', source: accCandidate.source,
                        layer: accCandidate.layer, to: accCandidate.account_id,
                        rule_id: accCandidate.rule_id || null,
                    });
                    if (accCandidate.rule_id) matchedRuleIds.push(accCandidate.rule_id);
                }
            }
        }

        // ---- 类型融合：仅当确定性抽取毫无方向信号（default_expense, 0.50）时才采纳记忆 ----
        //      有明确方向词时绝不让历史覆盖（「收到工资」不能因为历史被改成支出）
        if (merged.evidence && merged.evidence.type === 'default_expense') {
            const typeCandidate = applicable.find(c => c.type === 'income' || c.type === 'expense');
            if (typeCandidate && typeCandidate.type !== merged.type) {
                merged.type = typeCandidate.type;
                // 记忆推断的方向置信度压在 type 阈值 0.8 以下 → 仍需用户确认。
                // 方向错会静默污染报表，这里刻意不给"自动通过"的分数。
                merged.confidence = { ...merged.confidence, type: 0.72 };
                merged.evidence = { ...merged.evidence, type: `memory_${typeCandidate.source}` };
                appliedEvidence.push({
                    seq: txn.seq, field: 'type', source: typeCandidate.source,
                    layer: typeCandidate.layer, from: txn.type, to: typeCandidate.type,
                });
            }
        }

        return merged;
    });

    // 裁决（含冲突/负面记忆/fallback 降级）
    const { verdict, validation, policy } = decidePolicy({ transactions, memory, routing });

    return {
        transactions,
        field_confidence: transactions.map(t => ({ seq: t.seq, ...t.confidence })),
        evidence: {
            applied: appliedEvidence,
            matched_rule_ids: [...new Set(matchedRuleIds)],
            memory_layers: memory.layers || {},
            negated: (memory.negated || []).map(n => ({
                layer: n.layer, match_key: n.match_key, category_id: n.category_id,
            })),
            dropped_stale_rules: (memory.candidates || []).length - candidates.length,
        },
        route: routing ? routing.route : 'local',
        decision: verdict,
        validation,
        policy,
    };
}

module.exports = { decide, OVERRIDE_MARGIN };
