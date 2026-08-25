/* ============================================
   AI v0.2 · 确定性抽取器 —— 商家 / 币种
   ------------------------------------------------
   商家用「本地词典 + 结构线索」两级：命中词典最可靠；
   否则从「在X」「去X」这类介词结构里截取候选，置信度压低。
   Phase 3 会用 ai_rules 的用户历史商家来增强本模块（此处留好接口）。
   ============================================ */

// 常见商家/平台词典（覆盖高频记账场景，命中即高置信）
const MERCHANT_DICT = [
    '星巴克', '瑞幸', '麦当劳', '肯德基', '必胜客', '海底捞', '西贝', '真功夫',
    '美团', '饿了么', '滴滴', '高德', '曹操出行', '哈啰', '青桔',
    '淘宝', '天猫', '京东', '拼多多', '唯品会', '闲鱼', '抖音', '小红书',
    '盒马', '永辉', '沃尔玛', '家乐福', '山姆', '大润发', '华润万家', '物美',
    '中石化', '中石油', '国家电网', '中国移动', '中国联通', '中国电信',
    '苹果', 'App Store', 'Apple', '腾讯视频', '爱奇艺', '优酷', 'B站', '哔哩哔哩',
    'Netflix', 'Spotify', 'GitHub', 'OpenAI', '网易云', 'QQ音乐',
    '支付宝', '微信', '云闪付',
];

const CURRENCY_MAP = [
    { re: /(?:¥|￥|RMB|人民币|元|块)/i, code: 'CNY', conf: 0.95 },
    { re: /(?:\$|USD|美元|美金)/i, code: 'USD', conf: 0.95 },
    { re: /(?:€|EUR|欧元)/i, code: 'EUR', conf: 0.95 },
    { re: /(?:£|GBP|英镑)/i, code: 'GBP', conf: 0.95 },
    { re: /(?:¥|JPY|日元|日圆)/i, code: 'JPY', conf: 0.80 },
    { re: /(?:HKD|港币|港元)/i, code: 'HKD', conf: 0.95 },
];

/**
 * 抽取商家。
 * @param {string} text
 * @param {string[]} userMerchants 用户历史商家（Phase 3 传入，可为空）
 * @returns {{value:string, source:string, confidence:number}|null}
 */
function extractMerchant(text, userMerchants = []) {
    if (!text || typeof text !== 'string') return null;

    // 1) 用户历史商家优先（最贴合个人习惯）——长词优先避免子串误命中
    const hist = [...userMerchants].filter(Boolean).sort((a, b) => b.length - a.length);
    for (const m of hist) {
        if (text.includes(m)) {
            return { value: m, source: 'user_history', confidence: 0.96 };
        }
    }

    // 2) 内置词典
    const dict = [...MERCHANT_DICT].sort((a, b) => b.length - a.length);
    for (const m of dict) {
        if (text.toLowerCase().includes(m.toLowerCase())) {
            return { value: m, source: 'builtin_dict', confidence: 0.92 };
        }
    }

    // 3) 结构线索：「在XX」「去XX」「XX买/吃」——截 2~8 字非数字片段
    const struct = text.match(/(?:在|去|到)\s*([^\d\s，,。;；元块¥￥]{2,8}?)(?:买|吃|喝|花|消费|付|充|加油|办)/);
    if (struct) {
        return { value: struct[1], source: 'structural_hint', confidence: 0.55 };
    }

    return null;
}

/**
 * 抽取币种。默认 CNY（本项目主币），置信度 0.85（无显式符号时的合理默认）。
 * @param {string} text
 * @returns {{value:string, source:string, confidence:number}}
 */
function extractCurrency(text) {
    if (text && typeof text === 'string') {
        for (const { re, code, conf } of CURRENCY_MAP) {
            if (re.test(text)) return { value: code, source: 'symbol_match', confidence: conf };
        }
    }
    return { value: 'CNY', source: 'default_cny', confidence: 0.85 };
}

module.exports = { extractMerchant, extractCurrency, MERCHANT_DICT };
