/* ============================================
   交易解析器（Parser 层 · 全链路编排）
   ------------------------------------------------
   严格按架构图的顺序编排：

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
const { selectFewShotExamples, isFewShotEnabled } = require('../memory/few-shot-selector');
const { analyzeComplexity } = require('../runtime/complexity-analyzer');
const { route, isSimpleModelRouteAllowed, isLlmFirstEnabled } = require('../runtime/model-router');
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
        accounts: ctx.accounts,
        account_id: ctx.wm.accountId,
        book_id: ctx.wm.bookId,
        refDate: ctx.wm.refDate,
        userMerchants: merchantHints,
        last_account_name: ctx.wm.lastAccountName || null,
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
            accounts: ctx.accounts,
            account_id: ctx.wm.accountId,
            book_id: ctx.wm.bookId,
            refDate: ctx.wm.refDate,
            userMerchants: mergedMerchants,
            last_account_name: ctx.wm.lastAccountName || null,
        })
        : firstPass;

    // ---- 5) Decision Engine（融合记忆证据 + 裁决）----
    let decision = decide({ extraction, memory, context: ctx, routing: null });

    // ---- 6) Complexity Analyzer + Router ----
    const complexity = analyzeComplexity({
        text, extraction, memory, validation: decision.validation,
    });

    const modelAllowed = allowModel === null ? isModelRouteAllowed() : allowModel;
    // simple 默认不去查 provider（省一次 SQL + 省一次模型调用）；
    // 只有当部署方开启 AI_MODEL_ROUTE_SIMPLE 时才为 simple 也解析 provider。
    const simpleToModel = isSimpleModelRouteAllowed();
    let provider = null;
    if (modelAllowed && (complexity.level !== 'simple' || simpleToModel)) {
        provider = await resolveProvider(userId);
    }
    const routing = route({
        complexity, provider, allowModel: modelAllowed, allowSimpleModel: simpleToModel,
    });

    // ---- 7) 可选：Provider 复核（仅在真正路由到模型时）----
    let modelRequest = null;
    let modelResponse = null;
    let modelUsage = null;

    if ((routing.route === 'cheap_model' || routing.route === 'strong_model') && provider) {
        // Few-shot 先例：从历史交易里挑出与本次输入最相似的几条真实归类。
        // ⛔ 仅在开关打开时才检索（它会把历史消费明细发给第三方模型）。
        //    检索失败一律降级为「无先例」，绝不让记账链路挂掉。
        let fewShot = null;
        if (isFewShotEnabled()) {
            try {
                fewShot = await selectFewShotExamples(db, ctx.wm, {
                    text,
                    merchants: extraction.transactions.map(t => t.merchant).filter(Boolean),
                });
            } catch (_) {
                fewShot = null;
            }
        }

        // LLM-first：不把本地候选喂给模型，让它独立从原文抽取。
        //   理由：本地正则一旦漏拆或错拆，候选就成了错误锚点，会带偏模型。
        //   独立抽取后模型能给出本地压根没识别出的笔数与语义。
        const llmFirst = isLlmFirstEnabled();

        const review = await reviewWithModel({
            provider, model: routing.model, text,
            candidates: llmFirst ? [] : decision.transactions,
            categories: ctx.categories,
            // 把第 3 步已检索好的记忆（规则/习惯/历史分布/否证）交给模型，
            // 让它的"修正与补全"有据可依，而不是凭常识盲猜用户习惯。
            accounts: ctx.accounts,
            memory,
            fewShot,
        });
        modelRequest = review.request || null;

        if (review.ok) {
            modelResponse = review.response;
            modelUsage = review.usage;

            // LLM-first：以模型结果为主，本地仅作兜底。
            //   模型一条都没给出时不置位，让下面走传统「复核合并」——
            //   绝不因为开了开关就丢掉可记账的结果。
            let llmFirstApplied = false;
            if (llmFirst) {
                const firstPass = mergeLlmFirst(review.transactions, decision.transactions, text, routing);
                if (firstPass && firstPass.length) {
                    decision = decide({
                        extraction: { ...extraction, transactions: firstPass }, memory, context: ctx, routing,
                    });
                    llmFirstApplied = true;
                }
            }

            // 合并模型结果：模型既可能【修正】本地抽错字段，也可能【补全】本地空字段。
            // 授信模型：它给的 conf 原样写入 confidence（不再一律压到 0.86），
            // 但仍要过 Result Validator 字段阈值 + Decision Policy 冲突/负面记忆降级，
            // 安全铁律（金额最严、类目 id 合法、方向不静默污染）不受影响。
            // LLM-first 已产出结果时跳过：此时本地结果只是回退，不参与修补。
            const merged = llmFirstApplied ? decision.transactions : decision.transactions.map((t) => {
                const fix = review.transactions.find(r => r.seq === t.seq);
                if (!fix) return t;
                const out = { ...t };
                const applied = [];
                const conf = fix.conf || {};
                // account_id 也在合并范围内：v2 prompt 起模型可建议账户
                // （此前模型即便想给，清洗层也会直接丢弃 —— 账户永远只能本地猜）。
                for (const f of ['type', 'amount', 'category_id', 'account_id', 'date', 'merchant', 'note']) {
                    if (fix[f] === undefined || fix[f] === t[f]) continue;

                    // 账户保守合并：只在模型【比本地更有把握】时才覆盖。
                    // 理由：账户判错会污染余额；而本地一旦经渠道关键词命中
                    // （原文出现"支付宝""花呗"）就是硬证据，不该被模型的软推测推翻。
                    if (f === 'account_id') {
                        const localScore = Number(out.confidence.account) || 0;
                        const modelScore = Number(conf.account_id) || 0;
                        if (modelScore <= localScore) continue;
                    }

                    out[f] = fix[f];
                    applied.push(f);
                }
                if (applied.length) {
                    out.confidence = { ...out.confidence };
                    out.evidence = { ...out.evidence };
                    for (const f of applied) {
                        // confidence / evidence 用的归一化 key
                        const key = f === 'category_id' ? 'category'
                            : f === 'account_id' ? 'account'
                                : f;
                        // ⚠️ 模型自报 conf 用的是 prompt 里的【原始字段名】
                        //    （category_id / account_id），必须按 f 取，不能按 key 取 ——
                        //    此前用 conf[key] 恒为 undefined，导致模型的类目
                        //    置信度被静默丢弃，永远落不到 confidence 上。
                        const modelScore = conf[f];
                        // 金额/类型属于"错了污染账本"的字段：模型给的 conf 低于本地时保留本地分数，
                        // 其余字段用模型自报 conf（拿不准模型会自报低分 → 自然落到 needs_confirmation）。
                        if (typeof modelScore === 'number') {
                            const localScore = out.confidence[key];
                            if ((f === 'amount' || f === 'type') && typeof localScore === 'number') {
                                out.confidence[key] = Math.max(localScore, modelScore);
                            } else {
                                out.confidence[key] = modelScore;
                            }
                        }
                        out.evidence[key] = `model_${routing.route}`;
                    }
                }
                return out;
            });
            // LLM-first 已在上方 decide 过，此处无需重复融合
            if (!llmFirstApplied) {
                decision = decide({
                    extraction: { ...extraction, transactions: merged }, memory, context: ctx, routing,
                });
            }
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

/* ════════════════════════════════════════════════════════════
   LLM-first 合并
   ════════════════════════════════════════════════════════════ */

/**
 * LLM-first 合并：以【模型抽取结果】为主，本地结果仅用于补齐模型没给的字段。
 *
 * 与传统「复核合并」的区别：
 *   - 传统：以本地结果为基准逐条打补丁，笔数由本地决定（本地漏拆就永远漏了）
 *   - LLM-first：笔数与语义都由模型决定，本地只兜底缺失字段
 *
 * ⛔ 安全铁律不受本函数影响：
 *    类目/账户 id 的白名单校验、金额 > 0、日期格式校验，
 *    都已在 provider-gateway 的清洗层完成；此处只做结构转换。
 *    模型返回空 → 调用方回退传统链路。
 *
 * @param {Array} modelTxns  模型抽取结果（已清洗）
 * @param {Array} localTxns  本地抽取结果（兜底用）
 * @param {string} text      用户原文
 * @param {object} routing   路由结果（用于标记 evidence 来源）
 * @returns {Array} 标准 candidate 结构
 */
function mergeLlmFirst(modelTxns, localTxns, text, routing) {
    if (!Array.isArray(modelTxns) || modelTxns.length === 0) return [];

    const localBySeq = new Map((localTxns || []).map(t => [t.seq, t]));

    return modelTxns.map((m, idx) => {
        const seq = Number.isInteger(m.seq) ? m.seq : idx + 1;
        const local = localBySeq.get(seq);
        const conf = m.conf || {};
        const baseConf = (local && local.confidence) || {};

        const out = {
            ...(local || {}),
            seq,
            // 模型给什么用什么；模型没给的才回退本地值
            type: m.type || (local && local.type) || 'expense',
            amount: m.amount != null ? m.amount : (local ? local.amount : null),
            currency: (local && local.currency) || 'CNY',
            merchant: m.merchant != null ? m.merchant : (local ? local.merchant : null),
            category_id: m.category_id !== undefined ? m.category_id : (local ? local.category_id : null),
            account_id: m.account_id !== undefined ? m.account_id : (local ? local.account_id : null),
            date: m.date || (local ? local.date : null),
            note: m.note != null ? m.note : (local ? local.note : ''),
            raw_segment: (local && local.raw_segment) || text,
        };

        // 置信度：模型自报为准，缺失时沿用本地（本地也没有则 0，让 validator 判 invalid）
        out.confidence = {
            ...baseConf,
            amount: numOr(conf.amount, baseConf.amount),
            type: numOr(conf.type, baseConf.type),
            category: numOr(conf.category_id, baseConf.category),
            account: numOr(conf.account_id, baseConf.account),
            date: numOr(conf.date, baseConf.date),
            merchant: numOr(conf.merchant, baseConf.merchant),
        };

        // 整笔来源标记为模型主抽取（供「识别依据」展示与事后审计）
        out.evidence = {};
        for (const k of ['amount', 'type', 'category', 'account', 'date', 'merchant']) {
            out.evidence[k] = `model_first_${routing.route}`;
        }
        return out;
    });
}

/** 取第一个数字，都没有则 0 */
function numOr(...vals) {
    for (const v of vals) {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
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

module.exports = {
    parseTransactions, loadContext, parseOffline, mergeLlmFirst, PREDICTION_VERSION,
};
