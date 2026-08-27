/* ============================================
   AI v0.2 · 确定性抽取器 —— 金额
   ------------------------------------------------
   设计要点（对齐 v0.2 原则 #1「确定性优先」）：
   金额是记账里最不能出错的字段，因此【不交给模型】，用规则穷举中文口语写法。
   每个抽取结果都带 source（命中哪条规则）与 confidence，供字段级裁决使用。
   ============================================ */

// 中文数字 → 阿拉伯数字（仅覆盖口语常见范围，超出交给阿拉伯数字分支）
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/**
 * 解析纯中文数字串（如「三十五」「一百二」「两千五」）。
 * 注意「一百二」口语指 120 而非 102，故末尾裸数字按「降一级单位」补位。
 * @returns {number|null}
 */
function parseChineseNumber(str) {
    if (!str) return null;
    let total = 0;      // 已累计的值
    let section = 0;    // 当前节（万以下）的累计
    let digit = 0;      // 待结算的个位数字
    let lastUnit = 1;   // 上一个命中的单位，用于口语补位
    let matched = false;

    for (const ch of str) {
        if (CN_DIGIT[ch] !== undefined) {
            digit = CN_DIGIT[ch];
            matched = true;
        } else if (CN_UNIT[ch] !== undefined) {
            const unit = CN_UNIT[ch];
            matched = true;
            if (unit === 10000) {
                section = (section + digit) * unit;
                total += section;
                section = 0;
            } else {
                // 「十五」→ digit 缺省为 1
                section += (digit === 0 ? 1 : digit) * unit;
            }
            lastUnit = unit;
            digit = 0;
        } else {
            return null; // 含非数字字符，交给其它分支
        }
    }
    if (!matched) return null;

    if (digit !== 0) {
        // 口语补位：「一百二」→ 100 + 2*10 = 120；「三十五」→ 30 + 5 = 35
        total += section + (lastUnit >= 100 ? digit * (lastUnit / 10) : digit);
    } else {
        total += section;
    }
    return total > 0 ? total : null;
}

/**
 * 从文本中抽取金额候选。
 * 置信度分档依据「表达的明确程度」：
 *   0.98 带货币符号/单位（¥35.5、35.5元）—— 几乎不可能误判
 *   0.90 动词后紧跟裸数字（花了35.5）—— 语境明确
 *   0.85 中文数字带单位（三十五元）
 *   0.60 孤立裸数字（35.5）—— 可能是数量/编号，需用户确认
 * @param {string} text
 * @returns {{value:number, source:string, confidence:number, raw:string}|null}
 */
function extractAmount(text) {
    if (!text || typeof text !== 'string') return null;

    // 1) 货币符号 / 显式单位：¥35.5、35.5元、35.5块、35.5块钱、RMB 35.5
    //    单位置于数字后或符号置于数字前，两种语序都覆盖。
    const withUnit = text.match(
        /(?:[¥￥$]|RMB\s*|人民币\s*)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块|圆|RMB)/i
    );
    if (withUnit) {
        const raw = withUnit[1] || withUnit[2];
        const value = parseFloat(raw);
        if (Number.isFinite(value) && value > 0) {
            return { value, source: 'currency_unit', confidence: 0.98, raw: withUnit[0].trim() };
        }
    }

    // 2) 中文数字 + 单位：三十五元、两百块
    const cnWithUnit = text.match(/([零一二两三四五六七八九十百千万]+)\s*(?:元|块钱|块|圆)/);
    if (cnWithUnit) {
        const value = parseChineseNumber(cnWithUnit[1]);
        if (value !== null && value > 0) {
            return { value, source: 'chinese_number_unit', confidence: 0.85, raw: cnWithUnit[0] };
        }
    }

    // 3) 交易动词 + 裸数字：花了35.5、支出35、收入200、充值50
    const withVerb = text.match(
        /(?:花了|花掉|花費|花费|支出|付了|付款|支付|消费|消費|收入|收到|进账|入账|赚了|充值|转了|转账)\s*(\d+(?:\.\d{1,2})?)/
    );
    if (withVerb) {
        const value = parseFloat(withVerb[1]);
        if (Number.isFinite(value) && value > 0) {
            return { value, source: 'verb_context', confidence: 0.90, raw: withVerb[0] };
        }
    }

    // 4) 孤立裸数字 —— 最不可靠：可能是数量（3个）、日期（25号）、编号。
    //    过滤掉紧邻量词/日期单位的数字，剩余仍给低置信度，强制用户确认。
    const bare = text.match(/(?<![\d.])(\d+(?:\.\d{1,2})?)(?![\d.])(?!\s*(?:个|件|张|杯|份|号|日|月|年|点|%|折|人|次|台|斤|克|kg|g|ml|L))/i);
    if (bare) {
        const value = parseFloat(bare[1]);
        if (Number.isFinite(value) && value > 0) {
            return { value, source: 'bare_number', confidence: 0.60, raw: bare[1] };
        }
    }

    return null;
}

module.exports = { extractAmount, parseChineseNumber };
