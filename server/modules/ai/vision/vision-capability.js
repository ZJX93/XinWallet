/* ============================================
   图片理解能力判定
   ------------------------------------------------
   职责单一：回答「这个 provider 能不能直接读图」。

   ⛔ 为什么不能只靠「试一次失败再降级」：
      不支持 vision 的模型收到图片消息时，行为极其不统一 ——
        · 一部分直接 400（能识别，好办）
        · 一部分 200 但回复「我看不到图片」（❗这才是麻烦的：HTTP 成功、
          内容是自然语言道歉，JSON 解析失败后会被误判成「模型格式错」，
          于是重试、报错、扣 token，用户只看到「识别失败」）
      所以必须先用模型名做预判，把绝大多数情况在发请求之前就分流掉。

   ⛔ 为什么不能只靠模型名白名单：
      用户可以填任意第三方中转的模型名（本项目就在用 a6api），
      名字千奇百怪。白名单只做「加速」，真实结论以调用结果为准，
      并把结论写回 ai_providers.vision_support 供下次直接用。

   ⇒ 三态设计：unknown（没试过，先试）/ yes（试成功过）/ no（试失败过）
      判定顺序：DB 里的确定结论 > 模型名白名单 > unknown（乐观尝试）
   ============================================ */

/*  已知具备图片理解能力的模型名片段（小写匹配）。
    只放「确定支持」的，宁缺勿滥 —— 漏判的代价是白试一次（可接受），
    误判为支持的代价是用户等一次超时（体验差得多）。 */
const VISION_MODEL_HINTS = [
    // OpenAI
    'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-5', 'o3', 'o4-mini', 'chatgpt-4o',
    // Anthropic（claude-3 起全系支持图片）
    'claude-3', 'claude-4', 'claude-sonnet', 'claude-opus', 'claude-haiku',
    // Google
    'gemini',
    // 国内
    'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qvq',
    'glm-4v', 'glm-4.1v', 'glm-4.5v',
    'step-1v', 'step-1o',
    'internvl', 'minicpm-v', 'yi-vision', 'ernie-4.0-turbo-vl', 'doubao-vision',
    'moonshot-v1-vision', 'kimi-latest', 'kimi-thinking',
    'grok-2-vision', 'grok-4', 'llama-3.2-vision', 'pixtral', 'mistral-small-3',
];

/*  明确【不】具备图片理解能力、但名字容易被上面的片段误伤的模型。
    ⛔ 这张表必须先于白名单判断 ——
       例如 'gpt-4o-mini-tts'（语音合成）会被 'gpt-4o' 命中。 */
const VISION_MODEL_DENY = [
    'tts', 'whisper', 'embedding', 'moderation', 'rerank', 'audio-preview',
    'realtime', 'transcribe', 'dall-e', 'image-gen',
];

/**
 * 按模型名预判是否支持图片。
 * @returns {boolean|null} true=很可能支持 / false=很可能不支持 / null=无法判断
 */
function guessVisionByModel(model) {
    const m = String(model || '').toLowerCase().trim();
    if (!m) return null;
    // 先查排除表：'gpt-4o-mini-tts' 不能被 'gpt-4o' 命中
    if (VISION_MODEL_DENY.some(d => m.includes(d))) return false;
    if (VISION_MODEL_HINTS.some(h => m.includes(h))) return true;
    return null;
}

/**
 * 综合判定：DB 已有结论优先，其次模型名，最后乐观尝试。
 *
 * @param {object} provider  含 model / vision_support
 * @returns {'yes'|'no'|'unknown'}
 */
function resolveVisionSupport(provider) {
    if (!provider) return 'no';

    // ① DB 里的确定结论最可信：它来自真实调用结果
    const stored = String(provider.vision_support || '').toLowerCase();
    if (stored === 'yes' || stored === 'no') return stored;

    // ② 模型名预判
    const guessed = guessVisionByModel(provider.model);
    if (guessed === true) return 'yes';
    if (guessed === false) return 'no';

    // ③ 都判不出来 → 乐观尝试一次，结果会被记回 DB
    return 'unknown';
}

/**
 * 判断一次模型调用的失败/回复，是否属于「不具备图片理解能力」。
 *
 * ⛔ 这是本模块最容易写错的地方：不支持 vision 的模型有两种表现，
 *    第二种（HTTP 200 + 自然语言道歉）必须靠回复内容识别，
 *    否则会被当成「模型返回格式不合法」而一直重试。
 *
 * @param {object} p
 * @param {string} p.errorMessage  调用抛出的错误消息（可空）
 * @param {string} p.replyText     模型返回的文本（可空）
 * @returns {boolean}
 */
function looksLikeVisionUnsupported({ errorMessage, replyText } = {}) {
    const err = String(errorMessage || '').toLowerCase();
    if (err) {
        // 各家报错措辞不同，取交集关键词
        const errHints = [
            'image', 'vision', 'multimodal', 'multi-modal', 'image_url',
            'invalid content type', 'unsupported content', 'does not support',
            'not support image', 'content type', 'invalid_image',
        ];
        if (errHints.some(h => err.includes(h))) return true;
    }

    const reply = String(replyText || '').toLowerCase();
    if (reply) {
        // HTTP 200 但内容是「我看不到图」—— 中英文都要覆盖
        const replyHints = [
            'cannot see', "can't see", 'cannot view', 'unable to see', 'unable to view',
            'no image', "don't have the ability to see", 'not able to see',
            'i cannot process image', 'as a text-based',
        ];
        if (replyHints.some(h => reply.includes(h))) return true;
        const zhHints = [
            '无法查看图片', '无法看到图片', '看不到图片', '无法识别图片', '不能查看图片',
            '无法处理图片', '不支持图片', '没有图片', '未收到图片', '无法解析图片',
            '我是一个文本', '纯文本模型',
        ];
        if (zhHints.some(h => reply.includes(h))) return true;
    }

    return false;
}

module.exports = {
    VISION_MODEL_HINTS,
    VISION_MODEL_DENY,
    guessVisionByModel,
    resolveVisionSupport,
    looksLikeVisionUnsupported,
};
