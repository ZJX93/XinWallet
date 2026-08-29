/* ============================================
   Model Router + 熔断
   ------------------------------------------------
   路由表：
     simple  → local 或 cheap model
     medium  → cheap model
     complex → strong model
     provider failure → fallback 或 needs_confirmation

   ⛔ 本项目的现实约束（必须尊重，不要"按方案理想化"）：
     纯确定性抽取在真实类目表上已达 100% 识别率。因此：
     - simple 恒走 local（省钱省延迟，方案明确允许「simple → local」）
     - medium / complex 才考虑模型，且【必须有可用 provider】
     - 无 provider 时不报错、不空转，直接 route='local' 并让
       decision-policy 保持 needs_confirmation —— 宁可让用户点一下确认。

   ⛔ 熔断器是进程内内存态：多实例部署时各自独立。这是刻意的简化 ——
      跨实例熔断需要 Redis，而本项目是单实例 Node，引入外部依赖不划算。
   ============================================ */

// 熔断参数：连续失败 3 次后打开，30 秒后半开试探
const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 30_000;

// providerId → { failures, openedAt }
const breakers = new Map();

/**
 * 决定路由。
 *
 * @param {object} params
 * @param {object} params.complexity  analyzeComplexity 结果
 * @param {object} [params.provider]  可用的 provider { id, model, cheap_model, strong_model }
 * @param {boolean} [params.allowModel] 全局开关（环境变量 AI_ALLOW_MODEL_ROUTE）
 * @returns {{route:string, level:string, provider_id:number|null, model:string|null, reason:string}}
 */
function route({ complexity, provider = null, allowModel = false, allowSimpleModel = null }) {
    const level = complexity.level;

    // simple 默认走 local：省钱省延迟，且本地正则对"金额+明确类目词"已足够准。
    // ⚠️ 但本地正则【不懂语义】——口语化类目、隐含备注、商户别名它都拿不准。
    //    部署方若更看重准确率（例如本地没有可用算力、或用户表述普遍口语化），
    //    可用 AI_MODEL_ROUTE_SIMPLE=true 让简单场景也过一遍模型。
    const simpleToModel = allowSimpleModel === null
        ? isSimpleModelRouteAllowed()
        : allowSimpleModel;

    if (level === 'simple' && !simpleToModel) {
        return { route: 'local', level, provider_id: null, model: null, reason: 'simple_local_sufficient' };
    }

    // 显式关闭模型路由（AI_ALLOW_MODEL_ROUTE=false/0）→ 保持本地，由 policy 维持 needs_confirmation。
    // 注意：未设置该变量时 isModelRouteAllowed() 已乐观返回 true，故默认会启用模型。
    if (!allowModel) {
        return { route: 'local', level, provider_id: null, model: null, reason: 'model_route_disabled' };
    }

    if (!provider) {
        return { route: 'local', level, provider_id: null, model: null, reason: 'no_provider_configured' };
    }

    // 熔断打开 → fallback（policy 会因此降级为 needs_confirmation）
    if (isOpen(provider.id)) {
        return {
            route: 'fallback', level, provider_id: provider.id, model: null,
            reason: 'circuit_open',
        };
    }

    if (level === 'complex') {
        return {
            route: 'strong_model', level, provider_id: provider.id,
            model: provider.strong_model || provider.model || null,
            reason: 'complex_requires_strong',
        };
    }

    return {
        route: 'cheap_model', level, provider_id: provider.id,
        model: provider.cheap_model || provider.model || null,
        reason: 'medium_uses_cheap',
    };
}

/**
 * simple 场景是否也允许走模型。
 *
 * 默认 false —— 保持"simple → local"的省钱策略不变。
 * 置为 true 后，简单输入也会过一遍 cheap model，用 token 成本换语义准确率。
 * 适用于：本地正则效果不佳、或用户输入普遍口语化的部署。
 *
 * @param {object} [settings]  用户级 AI 设置（DB 优先）；缺省时回退环境变量
 */
function isSimpleModelRouteAllowed(settings) {
    if (settings && typeof settings.model_route_simple === 'boolean') {
        return settings.model_route_simple;
    }
    const raw = String(process.env.AI_MODEL_ROUTE_SIMPLE || '').toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * 是否启用 LLM-first（模型主抽取）。
 *
 * 默认 false —— 保持「本地主抽取 + 模型复核」的既有架构。
 * 置为 true 后，不再把本地候选喂给模型，让它独立从原文抽取；
 * 模型结果作为主结果，本地结果仅作回退。
 *
 * ⚠️ 默认关闭不只是保守，而是它【会让账户匹配变差】：
 *    开启后 transaction-parser 跳过整个「复核合并」，也就跳过了其中
 *    account_id 的【保守合并】保护 —— 那条规则要求模型置信度必须
 *    高于本地才覆盖，从而保住本地渠道关键词命中的硬证据
 *    （原文出现「支付宝」「花呗」→ confidence 0.9）。
 *    mergeLlmFirst 里没有这层保护，模型给什么用什么，
 *    本地硬证据会被模型的软推测无条件覆盖。
 *    另：笔数完全由模型决定，模型漏认就会少记。
 *
 * ⛔ 这不是「推翻重来」：安全铁律完全不变（类目/账户白名单、金额校验、
 *    Result Validator 阈值、Decision Policy 降级），且模型失败或返回空时
 *    自动回落到传统链路。仅在本地正则明显不够用、且能接受
 *    上述账户/笔数权衡时才开启（口语化输入多、版式杂）。
 */
function isLlmFirstEnabled(settings) {
    if (settings && typeof settings.llm_first === 'boolean') {
        return settings.llm_first;
    }
    const raw = String(process.env.AI_LLM_FIRST || '').toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
}

/** 熔断器是否打开 */
function isOpen(providerId) {
    const b = breakers.get(providerId);
    if (!b || !b.openedAt) return false;
    if (Date.now() - b.openedAt >= OPEN_DURATION_MS) {
        // 半开：清空计数放一个请求过去试探
        breakers.set(providerId, { failures: 0, openedAt: null });
        return false;
    }
    return true;
}

/** 记录一次失败 */
function recordFailure(providerId) {
    const b = breakers.get(providerId) || { failures: 0, openedAt: null };
    b.failures += 1;
    if (b.failures >= FAILURE_THRESHOLD) b.openedAt = Date.now();
    breakers.set(providerId, b);
    return b;
}

/** 记录一次成功（清零） */
function recordSuccess(providerId) {
    breakers.set(providerId, { failures: 0, openedAt: null });
}

/** 熔断状态快照（供监控 API） */
function breakerStates() {
    const out = {};
    for (const [id, b] of breakers.entries()) {
        out[id] = { failures: b.failures, open: isOpen(id), opened_at: b.openedAt };
    }
    return out;
}

/** 测试用：重置全部熔断器 */
function resetBreakers() { breakers.clear(); }

module.exports = {
    route, isOpen, isSimpleModelRouteAllowed, isLlmFirstEnabled,
    recordFailure, recordSuccess, breakerStates, resetBreakers,
    FAILURE_THRESHOLD, OPEN_DURATION_MS,
};
