/* ============================================
<<<<<<< HEAD
   交易解析器（Parser 层 · 全链路编排）
   ------------------------------------------------
   严格按架构图的顺序编排：
=======
   AI v0.2 · 交易解析器（Parser 层 · 全链路编排）
   ------------------------------------------------
   严格按方案 §1 架构图的顺序编排：
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0

     Input Preprocessor
       → Deterministic Extractor        (extraction/)
       → Context Builder                (parser/context-builder)
       → Memory Retrieval               (memory/memory-retrieval)
       → Decision Engine                (parser/decision-engine)
       → Complexity Analyzer → Router   (runtime/)
       → [可选] Provider 复核            (providers/provider-gateway)
       → Result Validator + Decision Policy
       → 产出 prediction 草稿

   ⛔ 本层【不写库】—— 写库是 prediction-store 的职责，保持纯粹便于单测。
   ⛔ 本层【不 require services/ai】—— 模型调用一律经 providers/provider-gateway
      （方案 §13：TransactionParser 不应直接依赖具体模型供应商）。
   ⛔ 任何增强层（记忆/模型）失败都必须降级而非报错：
      记账是刚需，宁可退回纯确定性结果 + needs_confirmation。
   ============================================ */

const { extractTransactions } = require('../extraction/deterministic-extractor');
const { validateResult } = require('../validation/result-validator');
const { buildContext, snapshotContext } = require('./context-builder');
const { decide } = require('./decision-engine');
const { retrieveMemory, snapshotMemory, emptyMemory } = require('../memory/memory-retrieval');
const { analyzeComplexity } = require('../runtime/complexity-analyzer');
const { route } = require('../runtime/model-router');
const { resolveProvider, reviewWithModel, isModelRouteAllowed } = require('../providers/provider-gateway');

const PREDICTION_VERSION = 2;   // Phase 3/4 接入后快照结构升级

/**
 * 兼容旧签名：仅加载类目 + 历史商家。
 * 保留是因为 routes/ai.js 的 OCR 链路与冒烟套件都直接用过它。
 */
async function loadContext(db, userId, bookId) {
    const ctx = await buildContext(db, { userId, bookId, context: {} });
    let userMerchants = [];
    try {
        const mem = await retrieveMemory(db, ctx.wm, { text: '', merchants: [] });
        userMerchants = mem.frequent_merchants;
    } catch (_) { userMerchants = []; }
    return { categories: ctx.categories, userMerchants };
}

/**
 * 解析文本为候选交易 + 校验裁决（不落库）。
 *
 * @param {object} db
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.bookId
 * @param {string} params.text
 * @param {object} [params.context] { account_id?, date?, timezone?, platform?, merchant_hints? }
 *        merchant_hints：调用方【已经确定】的商家名（目前来源是图片通道的票据版式
 *        预处理器 —— 它从「商户全称」标签行里读到的名字是结构性确定的，
 *        不该让下游再用词典去猜一遍）。会与记忆里的历史商家合并后喂给抽取器。
 * @param {boolean} [params.allowModel] 覆盖全局模型路由开关（评测时强制关闭）
 * @returns {Promise<{transactions:Array, validation:object, decision_trace:object,
 *                    memory_snapshot:object, model_request:object|null,
 *                    model_response:object|null, route:string, matched_rule_ids:number[]}>}
 */
async function parseTransactions(db, { userId, bookId, text, context = {}, allowModel = null }) {
    // ---- 1) Context Builder ----
    const ctx = await buildContext(db, { userId, bookId, context });

    // 调用方给的确定商家名（图片通道的票据预处理器会传）
    const merchantHints = Array.isArray(context.merchant_hints)
        ? context.merchant_hints.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim())
        : [];

    // ---- 2) Deterministic Extractor（先跑一遍，商家名是记忆检索的主键）----
    //      此处还没有历史商家词典，但 merchant_hints 是确定值，第一遍就该用上。
    const firstPass = extractTransactions(text, {
        categories: ctx.categories,
        account_id: ctx.wm.accountId,
        book_id: ctx.wm.bookId,
        refDate: ctx.wm.refDate,
        userMerchants: merchantHints,
    });

    // ---- 3) Memory Retrieval ----
    let memory;
    try {
        memory = await retrieveMemory(db, ctx.wm, {
            text,
            merchants: firstPass.transactions.map(t => t.merchant).filter(Boolean),
        });
    } catch (_) {
        memory = emptyMemory();   // 记忆层故障 → 退回纯确定性
    }

    // ---- 4) 带个人化商家词典重跑抽取 ----
    //      为什么要跑两遍：merchant-extractor 的 user_history 分支给 0.96 置信度，
    //      是最强的商家信号；而历史词典本身要靠第一遍的商家名去检索。
    //      两遍的成本是纯 CPU 正则，远低于一次 SQL。
    //      ⚠️ merchant_hints 必须与历史商家【合并】而非二选一：票据上的商家名
    //         可能是首次出现（历史里没有），漏掉就白抽了。
    const mergedMerchants = Array.from(new Set([...merchantHints, ...memory.frequent_merchants]));
    const extraction = mergedMerchants.length
        ? extractTransactions(text, {
            categories: ctx.categories,
            account_id: ctx.wm.accountId,
            book_id: ctx.wm.bookId,
            refDate: ctx.wm.refDate,
            userMerchants: mergedMerchants,
        })
        : firstPass;

    // ---- 5) Decision Engine（融合记忆证据 + 裁决）----
    let decision = decide({ extraction, memory, context: ctx, routing: null });

    // ---- 6) Complexity Analyzer + Router ----
    const complexity = analyzeComplexity({
        text, extraction, memory, validation: decision.validation,
    });

    const modelAllowed = allowModel === null ? isModelRouteAllowed() : allowModel;
    let provider = null;
    if (modelAllowed && complexity.level !== 'simple') {
        provider = await resolveProvider(userId);
    }
    const routing = route({ complexity, provider, allowModel: modelAllowed });

    // ---- 7) 可选：Provider 复核（仅在真正路由到模型时）----
    let modelRequest = null;
    let modelResponse = null;
    let modelUsage = null;

    if ((routing.route === 'cheap_model' || routing.route === 'strong_model') && provider) {
        const review = await reviewWithModel({
            provider, model: routing.model, text,
            candidates: decision.transactions, categories: ctx.categories,
        });
        modelRequest = review.request || null;

        if (review.ok) {
            modelResponse = review.response;
            modelUsage = review.usage;
            // 合并模型修正：只接受它明确给出的字段，其余保留本地结果
            const merged = decision.transactions.map((t) => {
                const fix = review.transactions.find(r => r.seq === t.seq);
                if (!fix) return t;
                const out = { ...t };
                const applied = [];
                for (const f of ['type', 'amount', 'category_id', 'date', 'merchant']) {
                    if (fix[f] !== undefined && fix[f] !== t[f]) {
                        out[f] = fix[f];
                        applied.push(f);
                    }
                }
                if (applied.length) {
                    // 模型修正的字段给 0.86：高于兜底但低于确定性关键词（0.90）。
                    // 模型是「理解器不是账本」—— 它的修正仍需用户确认。
                    out.confidence = { ...out.confidence };
                    out.evidence = { ...out.evidence };
                    for (const f of applied) {
                        const key = f === 'category_id' ? 'category' : f;
                        if (out.confidence[key] !== undefined) out.confidence[key] = 0.86;
                        out.evidence[key] = `model_${routing.route}`;
                    }
                }
                return out;
            });
            decision = decide({
                extraction: { ...extraction, transactions: merged }, memory, context: ctx, routing,
            });
        } else {
            // 模型失败 → 降级为 fallback，让 policy 强制 needs_confirmation
            modelResponse = { error: review.error, timeout: !!review.timeout };
            decision = decide({
                extraction, memory, context: ctx,
                routing: { ...routing, route: 'fallback', reason: 'provider_error' },
            });
            routing.route = 'fallback';
            routing.reason = 'provider_error';
        }
    } else if (routing.route === 'fallback') {
        // 熔断打开：不调模型，直接以 fallback 裁决（policy 会降级）
        decision = decide({ extraction, memory, context: ctx, routing });
    }

    // ---- 8) 证据链（可解释性核心）----
    const decision_trace = {
        engine: routing.route === 'local' ? 'deterministic' : routing.route,
        prediction_version: PREDICTION_VERSION,
        split: {
            source: extraction.split_source,
            multi: extraction.multi,
            count: decision.transactions.length,
        },
        per_txn_evidence: decision.transactions.map(t => ({ seq: t.seq, evidence: t.evidence })),
        thresholds: decision.validation.thresholds,
        context_used: snapshotContext(ctx),
        memory: {
            layers: memory.layers,
            keys: memory.keys,
            applied: decision.evidence.applied,
            matched_rule_ids: decision.evidence.matched_rule_ids,
            negated: decision.evidence.negated,
            dropped_stale_rules: decision.evidence.dropped_stale_rules,
        },
        complexity,
        routing,
        policy: decision.policy,
        model_escalation: modelRequest
            ? { route: routing.route, model: routing.model, ok: !!modelResponse && !modelResponse.error,
                usage: modelUsage }
            : null,
    };

    return {
        transactions: decision.transactions,
        validation: decision.validation,
        decision_trace,
        memory_snapshot: snapshotMemory(memory),
        model_request: modelRequest,
        model_response: modelResponse,
        route: routing.route,
        matched_rule_ids: decision.evidence.matched_rule_ids,
        // 供 cost-tracker 记账
        model_usage: modelUsage,
        provider_id: provider ? provider.id : null,
    };
}

/**
 * 纯离线解析（评测系统用）：不查库、不调模型，只跑确定性抽取 + 校验。
 * 传入 categories 即可，无需数据库连接 —— 保证评测可在 CI 里无 PG 运行。
 */
function parseOffline({ text, categories = [], refDate = new Date(), accountId = null, userMerchants = [] }) {
    const extraction = extractTransactions(text, {
        categories, account_id: accountId, refDate, userMerchants,
    });
    const validation = validateResult(extraction.transactions);
    return { transactions: extraction.transactions, validation, extraction };
}

module.exports = { parseTransactions, loadContext, parseOffline, PREDICTION_VERSION };
