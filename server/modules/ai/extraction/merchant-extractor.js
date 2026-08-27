/* ============================================
<<<<<<< HEAD
   确定性抽取器 —— 商家
=======
   AI v0.2 · 确定性抽取器 —— 商家
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
   ------------------------------------------------
   商家用「用户历史 → 内置词典 → 结构线索」三级：历史最贴合个人习惯，
   词典次之；否则从「在X」「去X」这类介词结构里截取候选，置信度压低。

   📌 币种抽取已按方案 §2 拆分到独立模块 currency-extractor.js。
      此处保留 extractCurrency 的再导出，避免既有 require 断裂
      （deterministic-extractor / 冒烟套件都从本文件取过它）。
   ============================================ */

const { extractCurrency } = require('./currency-extractor');
// 键归一与记忆层共用同一份实现（写侧存脏键 = 规则永远命中不了自己，见 memory/keys.js 注释）
const { normalizeKey, isUsefulKey } = require('../memory/keys');

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

const CURRENCY_MAP_MOVED = 'currency-extractor.js';

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
        // ⚠️ 必须过 normalizeKey：正则的非贪婪可能连带首尾虚词（如「在到星巴克花」），
        //    而这个值会成为 evidence-engine 的学习键 —— 存脏了规则就永远命中不了自己。
        const v = normalizeKey(struct[1]);
        if (isUsefulKey(v)) return { value: v, source: 'structural_hint', confidence: 0.55 };
    }

    // 4) 兜底结构：「在XX 38元」——商家后面直接跟金额，没有动词
    //    这是最自然的输入之一（「在星巴克 38」），原先完全抽不到商家 ⇒ 学不到任何习惯。
    const bare = text.match(/(?:在|去|到)\s*([^\d\s，,。;；元块¥￥]{2,10})(?=\s*[\d¥￥]|$)/);
    if (bare) {
        const v = normalizeKey(bare[1]);
        // 置信度压到 0.5：比带动词的结构更弱，仅够作为记忆检索键，不足以自行裁决
        if (isUsefulKey(v)) return { value: v, source: 'structural_bare', confidence: 0.5 };
    }

    return null;
}

// extractCurrency 已迁至 currency-extractor.js（方案 §2 要求独立模块）。
// 这里原样再导出，保证既有调用点（deterministic-extractor、冒烟套件）零改动。
module.exports = { extractMerchant, extractCurrency, MERCHANT_DICT };
