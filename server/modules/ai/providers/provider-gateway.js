/* ============================================
<<<<<<< HEAD
   Provider 抽象层
   ------------------------------------------------
=======
   AI v0.2 · §13 Provider 抽象层
   ------------------------------------------------
   方案 §13 结尾原文：
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
     「保持 Provider、业务决策、学习、存储彼此解耦。
       TransactionParser 不应直接依赖具体模型供应商。」

   ⛔ 本模块是【唯一】允许 modules/ai 触碰 services/ai.js 的地方。
      parser / decision-engine / memory 一律不得 require('../../services/ai')。
      这样将来换供应商（或加本地模型）只改这一个文件。

   ⛔ 同时承担「provider 故障不影响 Rule/History 命中」（验收标准 #7）：
      resolveProvider 取不到 provider 时返回 null 而不抛异常，
      调用方据此走 route='local'，规则与历史照常生效。
   ============================================ */

const { recordFailure, recordSuccess } = require('../runtime/model-router');

// 全局开关：默认关闭模型路由（本地准确率已足够，避免无谓开销与延迟）
function isModelRouteAllowed() {
    return String(process.env.AI_ALLOW_MODEL_ROUTE || '').toLowerCase() === 'true'
        || process.env.AI_ALLOW_MODEL_ROUTE === '1';
}

/**
 * 解析可用 provider（含 cheap/strong 模型名）。
 * ⚠️ 永不抛异常：取不到就返回 null。
 *
 * @param {number} userId
 * @returns {Promise<{id:number, api_type:string, base_url:string, api_key:string,
 *                    model:string, cheap_model:string, strong_model:string}|null>}
 */
async function resolveProvider(userId) {
    try {
        // 懒加载：避免 modules/ai 被离线单测 require 时连带拉起 services/ai 的网络依赖
        const { getActiveProvider } = require('../../../services/ai');
        const p = await getActiveProvider(userId);
        if (!p || !p.api_key) return null;
        return {
            id: p.id,
            api_type: p.api_type,
            base_url: p.base_url,
            api_key: p.api_key,
            model: p.model,
            // 项目的 ai_providers 表只有单个 model 列 —— 两档共用同一模型。
            // 环境变量可覆盖，便于「便宜模型跑 medium、强模型跑 complex」。
            cheap_model: process.env.AI_CHEAP_MODEL || p.model,
            strong_model: process.env.AI_STRONG_MODEL || p.model,
        };
    } catch (_) {
        return null;
    }
}

/**
 * 通过 provider 复核候选交易（Phase 4 的模型升级通道）。
 *
 * 契约：
 *   - 成功 → { ok:true, transactions, request, response, usage }
 *   - 失败 → { ok:false, error, request } 且已记录熔断失败计数
 *   - ⛔ 无论如何都不抛异常，也不写库（写库由调用方决定）
 *
 * @param {object} params
 * @param {object} params.provider
 * @param {string} params.model
 * @param {string} params.text          用户原文
 * @param {Array}  params.candidates    本地抽取的候选（作为提示，让模型只做修正）
 * @param {Array}  params.categories    真实类目表（模型只能从中选，不得臆造）
 */
async function reviewWithModel({ provider, model, text, candidates, categories, timeoutMs = 12000 }) {
    const catList = categories
        .filter(c => c.type === 'income' || c.type === 'expense')
        .map(c => `${c.id}:${c.name}(${c.type})`)
        .join(', ');

    const messages = [
        {
            role: 'system',
            content: [
                '你是记账助手的复核器。任务：检查本地规则引擎抽出的候选交易是否正确，只修正明显错误。',
                '严格约束：',
                '1. category_id 必须从下面给出的类目清单里选，不得臆造 id。',
                '2. 不确定就保持原值，不要猜。',
                '3. 只输出 JSON，格式：{"transactions":[{"seq":1,"type":"expense","amount":12.5,"category_id":33,"date":"2026-08-25","merchant":"星巴克"}]}',
                `可用类目：${catList}`,
            ].join('\n'),
        },
        {
            role: 'user',
            content: `原文：${text}\n本地候选：${JSON.stringify(candidates.map(c => ({
                seq: c.seq, type: c.type, amount: c.amount, category_id: c.category_id,
                category_name: c.category_name, date: c.date, merchant: c.merchant,
            })))}`,
        },
    ];

    const request = { model, messages_count: messages.length, text_length: text.length };
    const started = Date.now();

    try {
        const { callProvider } = require('../../../services/ai');
        const raw = await withTimeout(
            callProvider({ ...provider, model }, messages),
            timeoutMs
        );
        const parsed = safeParseJson(stripFence(raw));
        if (!parsed || !Array.isArray(parsed.transactions)) {
            recordFailure(provider.id);
            return { ok: false, error: '模型返回格式不合法', request, latency_ms: Date.now() - started };
        }

        // 只接受合法类目 id：模型臆造 id 一律丢弃该字段（保留本地值）
        const validIds = new Set(categories.map(c => c.id));
        const cleaned = parsed.transactions.map(t => ({
            seq: t.seq,
            type: ['income', 'expense', 'transfer'].includes(t.type) ? t.type : undefined,
            amount: typeof t.amount === 'number' && t.amount > 0 ? t.amount : undefined,
            category_id: validIds.has(t.category_id) ? t.category_id : undefined,
            date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : undefined,
            merchant: typeof t.merchant === 'string' ? t.merchant : undefined,
        }));

        recordSuccess(provider.id);
        return {
            ok: true,
            transactions: cleaned,
            request,
            response: { raw_length: String(raw || '').length, transactions: cleaned },
            latency_ms: Date.now() - started,
            // 项目现有 callProvider 不回传 token 用量 → 按字符数粗估（4 字符 ≈ 1 token）
            usage: {
                prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
                completion_tokens: Math.ceil(String(raw || '').length / 4),
            },
        };
    } catch (err) {
        recordFailure(provider.id);
        return {
            ok: false,
            error: err && err.message ? err.message : String(err),
            request,
            latency_ms: Date.now() - started,
            timeout: /timeout/i.test(String(err && err.message)),
        };
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`model timeout after ${ms}ms`)), ms)),
    ]);
}

/** 模型常把 JSON 包在 ```json 围栏里 */
function stripFence(s) {
    const str = String(s || '').trim();
    const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    return m ? m[1].trim() : str;
}

function safeParseJson(s) {
    try { return JSON.parse(s); } catch { return null; }
}

module.exports = { resolveProvider, reviewWithModel, isModelRouteAllowed };
