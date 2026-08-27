/* ============================================
<<<<<<< HEAD
   Model Router + 熔断
   ------------------------------------------------
   路由表：
=======
   AI v0.2 · §10 Model Router + 熔断
   ------------------------------------------------
   路由表（方案 §10 原文）：
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
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
function route({ complexity, provider = null, allowModel = false }) {
    const level = complexity.level;

    // simple 一律本地：方案允许，且本地准确率已足够
    if (level === 'simple') {
        return { route: 'local', level, provider_id: null, model: null, reason: 'simple_local_sufficient' };
    }

    // 未开启模型路由（默认关闭）→ 保持本地，由 policy 维持 needs_confirmation
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
    route, isOpen, recordFailure, recordSuccess, breakerStates, resetBreakers,
    FAILURE_THRESHOLD, OPEN_DURATION_MS,
};
