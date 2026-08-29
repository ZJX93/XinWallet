/* ============================================
   账户解析器（Account Resolver）
   ------------------------------------------------
   场景：用户在 AI 记账里拍照上传小票/支付截图，OCR 文本里通常隐含
         「支付宝尾号1234」「微信支付」「现金」「中国银行(4567)」等
         支付方式，但纯规则抽取器识别不出来——只能拿到用户当前选中的
         默认账户（容易被前端粘住，俗称「固定账户」）。

   解决：从 OCR 文本里抽取「支付渠道关键词」，再和用户的账户列表做
         模糊匹配，命中即覆盖默认账户。未命中则回退默认账户。

   设计原则（v0.2）：
     1) 零网络 IO / 零模型调用（与确定性抽取器同质）
     2) 匹配必须有 confidence，告知调用方「这是猜的」还是「文本里写了」
     3) 不修改用户账户列表，只返回建议 id；落账由上层 commit 决定
     4) 银行渠道特殊：先尝试精确银行名（中行/招行/…）→ 兜底用「银行」通配

   关键词字典（CN/EN）：
     支付宝 / Alipay / 集分宝 → 匹配账户名含「支付宝」
     微信 / WeChat / 微信支付 → 匹配账户名含「微信」
     现金 / Cash / 现付         → 匹配账户名含「现金」/「现付」
     银行卡 / 储蓄卡 / 信用卡 / 招行 / 工行 / 建行 / 中行 / 农行 / 交通银行
                                    → 匹配账户名含「银行」「卡」
     云闪付 / UnionPay / 银联   → 匹配账户名含「云闪付」/「银联」
     花呗 / 借呗 / 信用购       → 匹配账户名含「花呗」/「借呗」
   ============================================ */

const KEYWORD_GROUPS = [
    {
        source: 'alipay',
        label: '支付宝',
        // 关键词列表 = 「用于在文本里识别这个渠道」+「用于匹配账户名的字典」
        // 任一关键词出现在文本即激活；激活后用全部 kws 在账户名里找匹配
        kws: ['支付宝', 'alipay', '集分宝', '花呗', '借呗', '信用购'],
    },
    {
        source: 'wechat',
        label: '微信',
        kws: ['微信', 'wechat', 'weixin'],
    },
    {
        source: 'union',
        label: '云闪付',
        kws: ['云闪付', 'unionpay', '银联'],
    },
    {
        source: 'cash',
        label: '现金',
        kws: ['现金', '现付', 'cash'],
    },
    {
        source: 'bank',
        label: '银行',
        // 银行的关键词特别多：精确行名（招行/中行/…）+ 通用（银行卡/尾号）
        // 扫描时取首个命中；匹配账户名时优先用「精确行名」以避免误命中
        kws: [
            // 精确行名（先放，优先匹配用户行名）
            '招商银行', '招行', '工商银行', '工行', '建设银行', '建行',
            '中国银行', '中行', '农业银行', '农行', '交通银行', '邮储银行', '邮政',
            '浦发银行', '民生银行', '兴业银行', '光大银行', '平安银行', '中信银行',
            // 通用兜底（放最后，避免误匹配其他账户）
            '银行卡', '储蓄卡', '信用卡', '尾号',
        ],
    },
];

/**
 * 规范化账户名用于匹配：去空白/标点，转小写。
 */
function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s·\.\-_/()（）\[\]【】,，]/g, '');
}

/**
 * 从文本中扫描各支付渠道关键词，返回所有命中（去重）。
 * @param {string} text
 * @returns {Array<{source:string, label:string, keyword:string, score:number}>}
 */
function scanPaymentChannels(text) {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase();
    const hits = [];
    for (const grp of KEYWORD_GROUPS) {
        let firstHit = null;
        for (const kw of grp.kws) {
            if (lower.includes(kw.toLowerCase())) {
                firstHit = kw;
                break;
            }
        }
        if (firstHit) {
            // 给不同类型的命中不同 score：精确行名 > 通用关键词
            const isGeneric = ['银行卡', '储蓄卡', '信用卡', '尾号'].includes(firstHit);
            hits.push({
                source: grp.source,
                label: grp.label,
                keyword: firstHit,
                score: isGeneric ? 0.7 : 0.9,
            });
        }
    }
    return hits;
}

/**
 * 在账户列表中找匹配某个支付渠道的第一个账户。
 * 策略：先用整个 kws 字典在账户名里找最具体的匹配（含「招行」账户名优先
 *      于「银行卡」），再回退到 label 兜底。
 * @param {Array<{id:number|string,name:string}>} accounts
 * @param {{source:string, label:string, keyword:string}} channel
 * @returns {object|null}
 */
function findAccountByChannel(accounts, channel) {
    if (!Array.isArray(accounts) || accounts.length === 0) return null;

    // 找到这个渠道对应的完整 kws 字典
    const grp = KEYWORD_GROUPS.find(g => g.source === channel.source);
    if (!grp) return null;

    // 优先级 1：精确关键词（如「招行」「中行」「招商银行」）出现在账户名里
    const genericSuffix = new Set(['银行卡', '储蓄卡', '信用卡', '尾号', '现金', '现付', 'cash']);
    const specificKws = grp.kws.filter(kw => !genericSuffix.has(kw));
    for (const kw of specificKws) {
        const nkw = norm(kw);
        for (const a of accounts) {
            if (norm(a.name).includes(nkw)) return a;
        }
    }

    // 优先级 2：通用关键词（含「银行」「卡」「现金」等）出现在账户名里
    for (const kw of grp.kws) {
        if (specificKws.includes(kw)) continue;
        const nkw = norm(kw);
        for (const a of accounts) {
            if (norm(a.name).includes(nkw)) return a;
        }
    }

    // 优先级 3：用渠道 label 兜底
    const n = norm(channel.label);
    for (const a of accounts) {
        if (norm(a.name).includes(n)) return a;
    }

    return null;
}

/**
 * 用【真实账户名】在原文里直接匹配。
 *
 * 为什么需要它：渠道字典（支付宝/微信/招行/…）覆盖不到用户的自定义账户名
 *   （工资卡、零钱通、小金库…）。只要账户名不含字典里的渠道词，
 *   scanPaymentChannels 就扫不到 → 只能 fallback，表现为「账户识别不出来」。
 *
 * 为什么安全：这属于「账单原文写明的账户证据」（照抄），而不是 prompt 里被明令
 *   禁止的「商家 → 账户」习惯猜测 —— 原文确实写了这个账户名。
 *
 * 冲突处理：多个账户名同时命中时取【最长】的那个，避免「信用卡」压过
 *   更具体的「招行信用卡」。
 *
 * ⛔ 规范化后长度 < 2 的名称（如「卡」「钱」）不参与，避免泛词误命中。
 *
 * @param {Array<{id:number|string,name:string}>} accounts
 * @param {string} text
 * @returns {object|null}
 */
function findAccountByNameInText(accounts, text) {
    if (!Array.isArray(accounts) || accounts.length === 0 || !text) return null;
    const normText = norm(text);
    let best = null;
    let bestLen = 0;
    for (const a of accounts) {
        const n = norm(a.name);
        if (!n || n.length < 2) continue;
        if (normText.includes(n) && n.length > bestLen) {
            best = a;
            bestLen = n.length;
        }
    }
    return best;
}

/**
 * 主入口：基于 OCR/原始文本解析出最合适的账户。
 *
 * @param {string} text            OCR 文本或用户输入
 * @param {object} ctx
 * @param {Array}  ctx.accounts           用户账户列表 [{id, name, type, ...}]
 * @param {number} [ctx.account_id]       客户端默认账户（无文本命中时回退到此）
 * @param {string} [ctx.last_account_name] 客户端透传的「上次使用」账户名（兜底显示用）
 * @returns {{
 *   account_id: number|null,
 *   confidence: number,
 *   source: string,
 *   matched_channel: object|null,
 *   matched_account: object|null,
 *   channels: Array,
 *   details: string
 * }}
 */
function resolveAccount(text, ctx = {}) {
    const {
        accounts = [],
        account_id: defaultAccountId = null,
        last_account_name: lastAccountName = null,
    } = ctx;

    const channels = scanPaymentChannels(text);

    // 文本中没扫到任何支付渠道 → 直接返回默认
    if (channels.length === 0) {
        // 【账户名直配】渠道词典覆盖不到自定义账户名（工资卡/零钱通/小金库…），
        // 但原文若直接写出了某个真实账户的名称，那就是「账单写明的账户」——强证据，
        // 属于照抄而非猜测，优先级高于「上次使用」和默认账户。
        const direct = findAccountByNameInText(accounts, text);
        if (direct) {
            return {
                account_id: direct.id,
                confidence: 0.9,
                source: 'name_in_text',
                matched_channel: null,
                matched_account: direct,
                channels: [],
                details: `原文写明账户「${direct.name}」，按账户名直接匹配`,
            };
        }
        // 优先用「上次使用账户名」找对应的账户 id，让结果真正落在用户已有的账上；
        // 找不到才退回到 defaultAccountId（OCR 上传时客户端传入）。
        let fallbackId = defaultAccountId;
        let fallbackName = lastAccountName || null;
        if (lastAccountName) {
            const hit = (accounts || []).find(a => norm(a.name) === norm(lastAccountName));
            if (hit) {
                fallbackId = hit.id;
                fallbackName = hit.name;
            }
        }
        return {
            account_id: fallbackId,
            confidence: fallbackId != null ? 0.5 : 0.0,
            source: 'fallback_default',
            matched_channel: null,
            matched_account: null,
            channels: [],
            details: fallbackName ? `未在文本中找到支付渠道，已按上次使用「${fallbackName}」兜底` : '未匹配到任何账户',
        };
    }

    // 按 score 降序，逐个渠道找账户
    channels.sort((a, b) => b.score - a.score);
    for (const ch of channels) {
        const acc = findAccountByChannel(accounts, ch);
        if (acc) {
            return {
                account_id: acc.id,
                confidence: ch.score,
                source: `channel:${ch.source}`,
                matched_channel: ch,
                matched_account: acc,
                channels,
            };
        }
    }

    // 文本里有渠道关键词但用户没有对应账户（罕见）→ 先看能否按账户名直配
    const direct = findAccountByNameInText(accounts, text);
    if (direct) {
        return {
            account_id: direct.id,
            confidence: 0.85,
            source: 'name_in_text',
            matched_channel: channels[0],
            matched_account: direct,
            channels,
            details: `渠道词未匹配到账户，但原文写明账户「${direct.name}」`,
        };
    }

    // 文本里有渠道关键词但用户没有对应账户（罕见）→ 用默认
    return {
        account_id: defaultAccountId,
        confidence: defaultAccountId != null ? 0.4 : 0.2,
        source: 'channel_no_match_in_accounts',
        matched_channel: channels[0],
        matched_account: null,
        channels,
    };
}

module.exports = { resolveAccount, scanPaymentChannels, findAccountByChannel, findAccountByNameInText, norm };
