/**
 * 鑫钱包 · 用户级速率限制
 * 按 userId 而非 IP 限流（同一个用户多设备共享配额）
 * 对未认证接口退化为按 IP
 */

const rateLimit = require('express-rate-limit');

function userKeyGenerator(req) {
    // 已登录用户用 userId，未登录用 IP
    if (req.userId) {
        return `u${req.userId}`;
    }
    return `ip${req.ip}`;
}

/**
 * 通用 API 限流：每分钟 200 次 / 每用户
 * 用于已认证接口
 */
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.API_RATE_LIMIT_MAX || '200', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { success: false, message: '操作过于频繁，请稍后再试' },
    skip: (req) => req.path === '/healthz' || req.path === '/readyz',
});

/**
 * 写操作限流：每分钟 60 次 / 每用户（防止刷接口）
 * 用于 POST/PUT/DELETE
 */
const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.WRITE_RATE_LIMIT_MAX || '60', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    method: ['POST', 'PUT', 'DELETE'],
    message: { success: false, message: '写操作频率过高，请稍后再试' },
});

/**
 * AI 接口限流：每分钟 10 次（成本高）
 *
 * ⚠️ 例外：v0.2 的规则治理 / 学习统计 / 评测接口【不调用模型】，成本为零。
 *    若一并按 10 次/分限流，用户打开一次「记账习惯」页（列表 + 证据 + 统计 ≥3 次请求）
 *    就会吃掉当天大半配额，反而记不了账 —— 限流应该约束成本，不是约束路径前缀。
 *    这些路径退回通用 apiLimiter（200 次/分）即可。
 */
const AI_FREE_PATHS = [
    /^\/rules(\/|$)/,          // 规则列表 / 创建 / 停用 / 启用 / 证据流水
    /^\/learning\//,           // 学习统计面板
    /^\/evaluation\//,         // 评测跑批（纯 CPU 离线，不调模型）
    /^\/predictions\/\d+$/,    // 读取预测快照（只读库）
];

/**
 * 图片重转录（POST /ai/ocr/retranscribe）单独配额。
 *
 * ⛔ 为什么不能沿用 aiLimiter 的 10 次/分：
 *    这个接口的语义是「刚才那张图认错了，换腾讯云 OCR 再认一次」——
 *    用户会在识别失败后【连续】重试，而每次重试都要先消耗一次主识别。
 *    共用配额的结果是：试两三次就 429，用户看到的是「AI 调用过于频繁」，
 *    但他其实一笔账都还没记成。
 *
 * ⛔ 为什么也不能像规则接口那样直接免限流：
 *    腾讯云 OCR 是【按次计费】的真实成本，不设限等于给刷接口留口子。
 *
 * ⇒ 独立且更宽松的配额（默认 30 次/分）：够连续重试，又挡得住滥刷。
 */
const ocrRetranscribeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.OCR_RETRANSCRIBE_RATE_LIMIT_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { success: false, message: '重新识别过于频繁，请稍后再试' },
});

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.AI_RATE_LIMIT_MAX || '10', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator,
    message: { success: false, message: 'AI 接口调用过于频繁，请稍后再试' },
    // req.path 在挂载于 /ai 之下时是去掉前缀的相对路径（如 /rules）
    skip: (req) => AI_FREE_PATHS.some(re => re.test(req.path))
        // 重转录走自己的配额（见 ocrRetranscribeLimiter），此处放行避免双重计数
        || req.path === '/ocr/retranscribe',
});

module.exports = { apiLimiter, writeLimiter, aiLimiter, ocrRetranscribeLimiter, userKeyGenerator };