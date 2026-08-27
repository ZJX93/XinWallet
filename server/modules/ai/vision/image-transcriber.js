/* ============================================
   AI v0.2 · 图片转录层（Image → Text）
   ------------------------------------------------
   方案 §1 的链路起点是 Input Preprocessor，它只接受【文本】。
   图片记账要接进 v0.2 主链路，唯一干净的做法就是先把图片变成文本，
   再把文本交给和「手打一句话」完全相同的下游。

   ⇒ 本层是【可替换的转录器】，两个实现：
        ① model  —— 大模型多模态直读（主路，质量最好，能读懂版式）
        ② tencent_ocr —— 腾讯云 OCR 纯文字转录（兜底）

   ⛔⛔ 关键设计约束（用户明确要求，勿改）：
        腾讯云 OCR【只提供识别能力，不参与任何学习】。
        它的产物就是一段纯文字，与用户手打的文字在下游【完全同权】：
        走同一个 Deterministic Extractor、同一个 Memory Retrieval、
        同一个 Decision Engine。因此：
          · 不给 OCR 单独建规则表、不写 OCR 专属证据、不做 OCR 特有学习
          · 学习只发生在【用户确认/修正 prediction】那一步（与文字通道共用）
          · 换掉腾讯 OCR（或将来接别家）不会动到学习逻辑一行代码

   ⛔ 为什么不是「OCR 出文字后自己拼 prompt 抽取」（老实现的做法）：
      老实现在 routes/ai.js 里另写了一套 prompt + 344 行正则，
      于是同一个「星巴克 35」经文字通道和图片通道会走出两套结果、
      两套置信度、两套类目匹配，规则学到的东西在图片通道完全不生效。
      本层把职责切到只剩「转录」，双通道从此共用一个大脑。

   兜底触发条件（三种，对应用户诉求）：
     A. provider 不具备图片理解能力（vision_support='no' 或模型名预判不支持）
     B. 大模型读图调用失败 / 超时 / 回复「我看不到图片」
     C. 用户主动说「识别有误」→ 调 transcribeImage({ force:'tencent_ocr' })
   ============================================ */

const { resolveVisionSupport, looksLikeVisionUnsupported } = require('./vision-capability');

/*  转录提示词：只要求「读出文字」，不要求「理解成交易」。
    ⛔ 别在这里让模型直接输出 JSON 交易 —— 那会把抽取逻辑分叉到两处
       （见文件头注释）。转录层的产物必须是纯文本。 */
const TRANSCRIBE_PROMPT = [
    '请把这张账单/收据/支付截图里的文字【原样】逐行读出来。',
    '要求：',
    '1. 只输出图片里的文字本身，不要任何解释、总结或分析。',
    '2. 保持原有的行顺序；同一行内的内容用空格分隔。',
    '3. 金额、日期、时间、商户名必须完整保留，不要改写或推测。',
    '4. 图片里没有的信息绝对不要补充。',
].join('\n');

/** 腾讯云 OCR 单次调用上限（腾讯侧限制约 7MB base64，留余量） */
const OCR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 图片转录为文字。
 *
 * 契约：
 *   - 永不抛异常（除非参数非法），失败以 { ok:false, ... } 返回
 *   - 成功 → { ok:true, text, source:'model'|'tencent_ocr', attempts:[...] }
 *   - source 会一路透传到前端与 prediction 快照，用户能看到「这次是谁读的图」
 *
 * @param {object}   p
 * @param {object}   p.db                    db 模块（查 ai_ocr_config / 写 vision_support）
 * @param {number}   p.userId
 * @param {string}   p.imageBase64
 * @param {string}   [p.mime='image/jpeg']
 * @param {object}   [p.provider]            已解密的 active provider，null 表示未配置
 * @param {'model'|'tencent_ocr'} [p.force]  强制指定转录器（用户说「识别有误」时传 tencent_ocr）
 */
async function transcribeImage({ db, userId, imageBase64, mime = 'image/jpeg', provider, force }) {
    if (!imageBase64) return { ok: false, error: '图片内容为空', attempts: [] };

    const attempts = [];

    // ── 通道 A：大模型多模态直读（主路）────────────────────────────
    // force='tencent_ocr' 时直接跳过：用户已经说了模型读得不对，再读一遍没意义
    const skipModel = force === 'tencent_ocr';
    if (!skipModel && provider && provider.api_key) {
        const support = resolveVisionSupport(provider);
        if (support === 'no') {
            attempts.push({ source: 'model', ok: false, skipped: true, reason: 'vision_unsupported' });
        } else {
            const r = await transcribeByModel({ provider, imageBase64, mime });
            attempts.push({
                source: 'model', ok: r.ok, reason: r.ok ? undefined : r.error,
                vision_unsupported: r.visionUnsupported || undefined,
            });

            // 把「到底支不支持读图」的真实结论记回 DB，下次不用再试错
            if (support === 'unknown' || r.visionUnsupported) {
                await rememberVisionSupport(db, provider.id, r.visionUnsupported ? 'no' : (r.ok ? 'yes' : null));
            }

            if (r.ok) {
                return { ok: true, text: r.text, source: 'model', attempts };
            }
        }
    } else if (!skipModel) {
        attempts.push({ source: 'model', ok: false, skipped: true, reason: 'no_provider' });
    }

    // ── 通道 B：腾讯云 OCR 兜底（只转录，不学习）──────────────────
    const ocr = await transcribeByTencentOcr({ db, userId, imageBase64 });
    attempts.push({ source: 'tencent_ocr', ok: ocr.ok, reason: ocr.ok ? undefined : ocr.error });
    if (ocr.ok) {
        return { ok: true, text: ocr.text, source: 'tencent_ocr', attempts };
    }

    // 两条通道都不通：把两边的原因都带出去，否则用户只看到「识别失败」无从下手
    return {
        ok: false,
        error: buildBothFailedMessage(attempts),
        attempts,
        // 供前端决定引导去哪个配置页
        needs_ocr_config: ocr.needsConfig || false,
    };
}

/** 通道 A 实现：大模型读图 */
async function transcribeByModel({ provider, imageBase64, mime, timeoutMs = 30000 }) {
    try {
        // 懒加载：与 provider-gateway 同一纪律，避免离线单测拉起网络依赖
        const { callProvider } = require('../../../services/ai');
        const messages = [{
            role: 'user',
            content: [
                { type: 'text', text: TRANSCRIBE_PROMPT },
                { type: 'image', mime: mime || 'image/jpeg', data: imageBase64 },
            ],
        }];

        // ⚠️ callProvider 走的是 callOpenAICompatible / callAnthropic，
        //    它们只吃 content 原样；多模态归一化在 services/ai.js 的
        //    toOpenAIContent / toAnthropicContent 里 —— 那两个函数只被
        //    chatWithTools 用到。所以这里必须显式转一次，否则数组会被原样发出去。
        const normalized = normalizeForProvider(provider, messages);
        const raw = await withTimeout(callProvider(provider, normalized), timeoutMs);
        const text = String(raw || '').trim();

        // HTTP 200 但内容是「我看不到图」→ 判定为不支持，交给兜底
        if (looksLikeVisionUnsupported({ replyText: text })) {
            return { ok: false, error: '模型不具备图片理解能力', visionUnsupported: true };
        }
        if (!text) return { ok: false, error: '模型未返回任何文字' };
        // 太短基本等于没读出来（一张账单截图不可能只有几个字）
        if (text.length < 4) return { ok: false, error: `模型仅返回 ${text.length} 个字符，视为识别失败` };

        return { ok: true, text };
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        return {
            ok: false,
            error: msg,
            visionUnsupported: looksLikeVisionUnsupported({ errorMessage: msg }),
        };
    }
}

/** 通道 B 实现：腾讯云 OCR（纯转录） */
async function transcribeByTencentOcr({ db, userId, imageBase64 }) {
    try {
        const bytes = Buffer.byteLength(imageBase64, 'base64');
        if (bytes > OCR_MAX_BYTES) {
            return { ok: false, error: `图片过大（${(bytes / 1024 / 1024).toFixed(1)}MB），请压缩到 5MB 以内` };
        }

        const cfg = await db.queryOne('SELECT * FROM ai_ocr_config WHERE user_id = ?', [userId]);
        if (!cfg || !cfg.secret_id || !cfg.secret_key) {
            return { ok: false, error: '未配置腾讯云 OCR 密钥', needsConfig: true };
        }

        const { decrypt } = require('../../../crypto');
        const secretId = decrypt(cfg.secret_id);
        const secretKey = decrypt(cfg.secret_key);
        // ⛔ 解密失败绝不静默回退成明文（历史上踩过）：让用户去重存
        if (!secretId || !secretKey) {
            return {
                ok: false,
                error: 'OCR 密钥解密失败，请前往「AI配置」页重新保存腾讯云 OCR 密钥',
                needsConfig: true,
            };
        }

        const OcrClient = getOcrClient();
        const client = new OcrClient({
            credential: { secretId, secretKey },
            region: cfg.region || 'ap-guangzhou',
        });
        const result = await client.GeneralAccurateOCR({ ImageBase64: imageBase64 });
        const text = (result.TextDetections || [])
            .map(d => d.DetectedText || '')
            .filter(Boolean)
            .join('\n');

        if (!text) return { ok: false, error: 'OCR 未识别到文字，请上传更清晰的截图' };
        return { ok: true, text };
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
    }
}

/*  懒加载腾讯云 SDK：它是可选依赖，未装时不应拖垮整个 ai 模块的 require。
    与 routes/ai.js 里既有的 getOcrClient 同一范式。 */
let _ocrClient = null;
function getOcrClient() {
    if (!_ocrClient) {
        _ocrClient = require('tencentcloud-sdk-nodejs-ocr').ocr.v20181119.Client;
    }
    return _ocrClient;
}

/**
 * 把归一化的多模态 content 转成目标 provider 的原生格式。
 *
 * ⛔ 刻意 require services/ai.js 的 toOpenAIContent / toAnthropicContent 而不是抄一份：
 *    本项目已经因为「读写两侧各写一套归一逻辑」吃过一次静默失败的亏
 *    （见 memory/keys.js 文件头）。同一张图在「AI 对话通道」和「图片记账通道」
 *    必须发出格式完全一致的请求，否则只会在其中一端报错、极难定位。
 *    ⇒ 为此在 services/ai.js 的 module.exports 里补出了这两个函数。
 */
function normalizeForProvider(provider, messages) {
    const { toOpenAIContent, toAnthropicContent } = require('../../../services/ai');
    const conv = provider.api_type === 'anthropic' ? toAnthropicContent : toOpenAIContent;
    return messages.map(m => ({ role: m.role, content: conv(m.content) }));
}

/** 把判定结论写回 ai_providers，下次省一次试错 */
async function rememberVisionSupport(db, providerId, verdict) {
    if (!verdict || !providerId) return;
    try {
        await db.query('UPDATE ai_providers SET vision_support = ? WHERE id = ?', [verdict, providerId]);
    } catch (_) {
        // ⛔ 记不住就算了，绝不能因为这个可选优化把整条转录链路搞失败
    }
}

function buildBothFailedMessage(attempts) {
    const model = attempts.find(a => a.source === 'model');
    const ocr = attempts.find(a => a.source === 'tencent_ocr');
    const parts = [];
    if (model) {
        if (model.reason === 'no_provider') parts.push('未配置 AI 服务商');
        else if (model.reason === 'vision_unsupported') parts.push('当前 AI 模型不支持读图');
        else parts.push(`AI 读图失败（${model.reason || '未知原因'}）`);
    }
    if (ocr) parts.push(`腾讯云 OCR 兜底也失败（${ocr.reason || '未知原因'}）`);
    return parts.join('；') || '图片识别失败';
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`vision timeout after ${ms}ms`)), ms)),
    ]);
}

module.exports = {
    transcribeImage,
    TRANSCRIBE_PROMPT,
    OCR_MAX_BYTES,
    // 导出内部实现供单测直接打桩，避免为了测降级逻辑而真的发网络请求
    _internals: { transcribeByModel, transcribeByTencentOcr, normalizeForProvider },
};
