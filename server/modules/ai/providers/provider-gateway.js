/* ============================================
   Provider 抽象层
   ------------------------------------------------
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
const { buildMemoryHints } = require('./prompt-builder');
const { buildParserMessages } = require('../prompts/parser-prompt');

// 全局开关：
//   - 显式设为 false / 0 → 强制关闭（保留给想省成本的部署）。
//   - 显式设为 true / 1 → 强制打开。
//   - 未设置 → 自动判断：只要存在可用 provider（api_key 非空）就允许模型路由，
//     让"配了模型就用模型"成为默认行为；没配 provider 时退回纯本地，不报错。
//   （旧默认是 false，导致整套模型链路形同虚设，体验不如直接用第三方模型。）
let _providerProbe = null;
function isModelRouteAllowed() {
    const raw = process.env.AI_ALLOW_MODEL_ROUTE;
    const explicit = String(raw || '').toLowerCase();
    if (explicit === 'false' || raw === '0') return false;
    if (explicit === 'true' || raw === '1') return true;
    // 未显式设置：依赖调用方在路由前用 resolveProvider 探测；此处乐观返回 true，
    // 真正无 provider 时 route() 会落到 local/fallback，不影响兜底。
    return true;
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
 * @param {Array}  [params.accounts]    真实账户表（供习惯提示引用账户名称）
 * @param {object} [params.memory]      Memory Retrieval 结果 —— 用户记账习惯的数据来源
 * @param {number} [params.timeoutMs]   超时毫秒
 */
async function reviewWithModel({
    provider, model, text, candidates, categories,
    accounts = [], memory = null, timeoutMs = 12000,
}) {
    // 用户记账习惯：把本地已检索到的规则 / 习惯假设 / 历史分布 / 否证
    // 翻译成自然语言喂给模型。此前模型只拿到「原文 + 本地候选 + 类目表」，
    // 等于让它凭常识盲猜 —— 这是"AI 识别差强人意"的根因之一。
    // ⛔ 无历史的新用户 / 记忆层故障时返回空串，不注入任何内容。
    const memoryHints = buildMemoryHints({ memory, categories, accounts });

    // prompt 已外置到 ../prompts/parser-prompt.js 并版本化。
    // 默认 v1（字节级冻结的基线），环境变量 AI_PARSER_PROMPT_VERSION=v2 切到增强版。
    const { messages, version: promptVersion } = buildParserMessages({
        text, candidates, categories, accounts, memoryHints,
    });

    const request = {
        model,
        messages_count: messages.length,
        text_length: text.length,
        // 审计用：本条 prompt 是否注入了用户习惯、注入了多长。
        // 便于事后判断"模型猜错"到底是没喂到习惯，还是喂了也没听。
        memory_hints_injected: Boolean(memoryHints),
        memory_hints_length: memoryHints ? memoryHints.length : 0,
        // prompt 版本落库：事后可回溯"哪次错判用的是哪一版 prompt"，
        // 也是 A/B 对比与一键回退的依据。
        prompt_version: promptVersion,
    };
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

        // 只接受合法 id 与合法字段；模型臆造 id / 非法值一律丢弃该字段（保留本地值）
        const validIds = new Set(categories.map(c => c.id));
        const validAccountIds = new Set(accounts.map(a => a.id));
        const cleaned = parsed.transactions.map(t => {
            const conf = (t.conf && typeof t.conf === 'object') ? t.conf : {};
            return {
                seq: t.seq,
                type: ['income', 'expense', 'transfer'].includes(t.type) ? t.type : undefined,
                amount: typeof t.amount === 'number' && t.amount > 0 ? t.amount : undefined,
                category_id: validIds.has(t.category_id) ? t.category_id : undefined,
                // v2 起模型可建议账户：同样只认白名单里的 id，臆造一律丢弃。
                // 账户错了不会污染金额，但会污染余额，所以校验与类目同等严格。
                account_id: validAccountIds.has(t.account_id) ? t.account_id : undefined,
                // 日期允许到秒：v2 要求模型尽量补出 HH:MM:SS。
                // 同时兼容纯日期（旧模型/保守输出），不做强制升级。
                date: isValidModelDate(t.date) ? t.date : undefined,
                merchant: typeof t.merchant === 'string' && t.merchant.trim() ? t.merchant.trim() : undefined,
                note: typeof t.note === 'string' && t.note.trim() ? t.note.trim() : undefined,
                // 模型自报置信度，原样带回（授信模型）。调用方仍过 Result Validator 阈值 + 冲突降级。
                conf: {
                    type: typeof conf.type === 'number' ? conf.type : undefined,
                    amount: typeof conf.amount === 'number' ? conf.amount : undefined,
                    category_id: typeof conf.category_id === 'number' ? conf.category_id : undefined,
                    account_id: typeof conf.account_id === 'number' ? conf.account_id : undefined,
                    date: typeof conf.date === 'number' ? conf.date : undefined,
                    merchant: typeof conf.merchant === 'number' ? conf.merchant : undefined,
                },
            };
        });

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

/**
 * 校验模型给出的日期字符串。
 *
 * ⚠️ 光靠正则只校验【格式】：「1002-81-93」完全符合 \d{4}-\d{2}-\d{2}，
 *    却是 OCR 把订单号/单号误认成日期的产物 —— 直接落库会写出脏数据。
 *    故必须再做一层【语义】校验：月份 1~12、日 1~31、时分秒在合理区间。
 *
 * @param {string} s
 * @returns {boolean}
 */
function isValidModelDate(s) {
    const str = String(s || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(str)) return false;

    const [y, m, d] = str.slice(0, 10).split('-').map(Number);
    if (y < 1970 || y > 2200) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;

    const time = str.slice(11);
    if (time) {
        const parts = time.split(':').map(Number);
        if (parts[0] > 23) return false;
        if (parts[1] > 59) return false;
        if (parts[2] !== undefined && parts[2] > 59) return false;
    }
    return true;
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
