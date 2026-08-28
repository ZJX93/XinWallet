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
 */
async function reviewWithModel({ provider, model, text, candidates, categories, timeoutMs = 12000 }) {
    const catList = categories
        .filter(c => c.type === 'income' || c.type === 'expense')
        .map(c => `${c.id}:${c.name}(${c.type})`)
        .join(', ');

    // 系统提示升级：从"只修明显错误的复核器"升级为"理解+补全的解析器"。
    // 本地规则引擎擅长精确数字，但拿不准口语化类目、语义商家、隐含备注——
    // 把这些交给模型，而不是让模型只当打补丁的。
    const messages = [
        {
            role: 'system',
            content: [
                '你是记账助手的 AI 解析器。任务：基于用户原文，对本地规则引擎给出的候选交易做【语义理解与补全】。',
                '你可以且应当：',
                '1. 修正本地抽错的类型/金额/类目/日期/商家；',
                '2. 补全本地没抽出来的字段（例如把"中午吃了碗面"归到餐饮类目、给出商家名、写入语义备注 note）；',
                '3. 对口语化、模糊表述做合理推断（如"发了工资"→income、"还了信用卡"→transfer/expense）。',
                '严格约束：',
                '1. category_id 必须从下面给出的类目清单里选，不得臆造 id；拿不准时填 null。',
                '2. 每个字段都要给 conf（0~1 置信度）：有把握≥0.9，推测 0.7~0.89，不确定填 0 或省略。',
                '3. 金额/类型这种错了会污染账本的字段，没把握就保留本地值（不要乱改）。',
                '4. 只输出 JSON，禁止额外文本。格式：',
                '{"transactions":[{"seq":1,"type":"expense","amount":12.5,"category_id":33,',
                '"date":"2026-08-25","merchant":"星巴克","note":"午餐","conf":{"type":0.95,"amount":0.98,"category_id":0.9,"date":0.95,"merchant":0.7}}]}',
                '备注 note 用于记录消费目的/场景，便于后续洞察。',
                `可用类目：${catList}`,
            ].join('\n'),
        },
        {
            role: 'user',
            content: `原文：${text}\n本地候选：${JSON.stringify(candidates.map(c => ({
                seq: c.seq, type: c.type, amount: c.amount, category_id: c.category_id,
                category_name: c.category_name, date: c.date, merchant: c.merchant,
                note: c.note || '',
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

        // 只接受合法类目 id 与合法字段；模型臆造 id / 非法值一律丢弃该字段（保留本地值）
        const validIds = new Set(categories.map(c => c.id));
        const cleaned = parsed.transactions.map(t => {
            const conf = (t.conf && typeof t.conf === 'object') ? t.conf : {};
            return {
                seq: t.seq,
                type: ['income', 'expense', 'transfer'].includes(t.type) ? t.type : undefined,
                amount: typeof t.amount === 'number' && t.amount > 0 ? t.amount : undefined,
                category_id: validIds.has(t.category_id) ? t.category_id : undefined,
                date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : undefined,
                merchant: typeof t.merchant === 'string' && t.merchant.trim() ? t.merchant.trim() : undefined,
                note: typeof t.note === 'string' && t.note.trim() ? t.note.trim() : undefined,
                // 模型自报置信度，原样带回（授信模型）。调用方仍过 Result Validator 阈值 + 冲突降级。
                conf: {
                    type: typeof conf.type === 'number' ? conf.type : undefined,
                    amount: typeof conf.amount === 'number' ? conf.amount : undefined,
                    category_id: typeof conf.category_id === 'number' ? conf.category_id : undefined,
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
