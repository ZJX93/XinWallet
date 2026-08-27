/* ============================================
<<<<<<< HEAD
   确定性抽取器 —— 交易类型（收入/支出/转账）
=======
   AI v0.2 · 确定性抽取器 —— 交易类型（收入/支出/转账）
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
   ------------------------------------------------
   类型判错的后果比金额判错更隐蔽（金额错用户一眼看出，收支方向错会静默污染报表），
   因此采用「强信号词 → 高置信；无信号 → 默认支出但压低置信度强制确认」的策略。
   ============================================ */

// 转账信号最强，须先判：否则「转账给妈妈2000」会被「给」类词误判为支出。
const TRANSFER_WORDS = ['转账', '转给', '转到', '划转', '互转', '还信用卡', '还款到'];

// 「转…到」分离句式：连写关键词覆盖不到「从工商银行转 50 到微信支付」这类自然表达。
// 必须在关键词匹配之前判定，否则会被账户名里的「支付」（微信支付/支付宝）误判成 expense。
const TRANSFER_PATTERNS = [
    // 从 A 转/划 [金额] 到/去/进 B —— 最典型的双账户句式
    /从.{1,16}?[转划挪][^。；;]{0,12}?[到去进入]/,
    // 转/划[出|入] 金额 到/去 B —— 省略转出账户（用户后续在确认卡片里补）
    /[转划挪](?:出|入)?\s*\d[\d,.]*\s*(?:元|块|块钱|rmb|人民币)?\s*[到去进入]/i,
    // A 转出/转入 到 B —— 金额缺失的纯方向表达
    /[转划](?:入|出)\s*[到去进]/,
];
/* ⛔ 收支方向词表【从 category-matcher.js 的 KEYWORD_TO_CATEGORY 派生】。
   历史事故：这里曾手写一份独立词表，与类目词表不同步，导致
   「基金收益1200元」被判 expense、类目还连锁退化成「其他支出」
   （matchCategory 第一层 `if (entry.type !== type) continue` 会整段跳过该方向的类目）。
   ⇒ 一个词漏了同时打坏 type 和 category 两个字段。
   现在只需维护 KEYWORD_TO_CATEGORY 一处，本文件自动跟随。
   下面两个 EXTRA 数组只放【纯方向动词】——它们不指向任何具体类目，故类目词表里没有。 */
const { keywordsOfType } = require('./category-matcher');

// 纯方向动词/名词：只表达收支方向，不携带类目语义
const INCOME_EXTRA = ['收入', '收到', '进账', '入账', '到账', '赚了', '挣了', '营收'];
const EXPENSE_EXTRA = [
    '花了', '花掉', '花费', '支出', '付了', '付款', '支付', '消费', '买了', '购买',
    '充值', '缴费', '交了', '打赏', '开销', '破费',
];

// 派生词按长度降序：优先命中更具体的长词（「理财收益」先于「收益」），
// 避免短词抢先命中导致 raw 证据过泛，影响可解释性。
const byLenDesc = (a, b) => b.length - a.length;
const INCOME_WORDS = [...new Set([...INCOME_EXTRA, ...keywordsOfType('income')])].sort(byLenDesc);
const EXPENSE_WORDS = [...new Set([...EXPENSE_EXTRA, ...keywordsOfType('expense')])].sort(byLenDesc);

/**
 * 抽取交易类型。
 * @param {string} text
 * @returns {{value:'income'|'expense'|'transfer', source:string, confidence:number, raw:string}}
 */
function extractType(text) {
    if (!text || typeof text !== 'string') {
        return { value: 'expense', source: 'default_fallback', confidence: 0.50, raw: '' };
    }

    for (const w of TRANSFER_WORDS) {
        if (text.includes(w)) {
            return { value: 'transfer', source: 'transfer_keyword', confidence: 0.95, raw: w };
        }
    }
    // 分离句式的置信度略低于显式关键词：句式匹配比词表匹配更容易误伤
    for (const re of TRANSFER_PATTERNS) {
        const m = text.match(re);
        if (m) {
            return { value: 'transfer', source: 'transfer_pattern', confidence: 0.88, raw: m[0] };
        }
    }
    for (const w of INCOME_WORDS) {
        if (text.includes(w)) {
            return { value: 'income', source: 'income_keyword', confidence: 0.93, raw: w };
        }
    }
    for (const w of EXPENSE_WORDS) {
        if (text.includes(w)) {
            return { value: 'expense', source: 'expense_keyword', confidence: 0.93, raw: w };
        }
    }

    // 无任何方向信号：绝大多数记账是支出，故默认 expense；
    // 但 confidence 压到 0.50（< §6 的 type 阈值 0.8）→ 必然触发 needs_confirmation。
    // 这是刻意设计：宁可让用户点一下确认，也不静默写错方向。
    return { value: 'expense', source: 'default_expense', confidence: 0.50, raw: '' };
}

module.exports = { extractType, TRANSFER_WORDS, TRANSFER_PATTERNS, INCOME_WORDS, EXPENSE_WORDS };
