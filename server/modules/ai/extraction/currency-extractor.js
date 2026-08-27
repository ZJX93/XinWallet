/* ============================================
   确定性抽取器 —— 币种
   ------------------------------------------------
   方案 §2 明确要求 currency-extractor 独立成模块（原先寄生在 merchant-extractor 里）。

   ⛔ 顺序即优先级的一个真实坑：
      「¥」既是人民币符号也是日元符号（Unicode 上 ¥ U+00A5 常用于 JPY，￥ U+FFE5 用于 CNY）。
      本项目主币是 CNY，故 CNY 规则必须排在 JPY 之前，否则「¥50」会被判成日元。
      JPY 只在出现「日元/日圆/JPY」字样时才命中。
   ============================================ */

const CURRENCY_RULES = [
    // CNY 放最前：¥/￥/元/块 在中文记账里几乎恒为人民币
    { re: /(?:￥|¥|RMB|人民币|元|块钱|块)/i, code: 'CNY', conf: 0.95, source: 'symbol_cny' },
    { re: /(?:\$|USD|美元|美金)/i, code: 'USD', conf: 0.95, source: 'symbol_usd' },
    { re: /(?:€|EUR|欧元)/i, code: 'EUR', conf: 0.95, source: 'symbol_eur' },
    { re: /(?:£|GBP|英镑)/i, code: 'GBP', conf: 0.95, source: 'symbol_gbp' },
    // 日元必须靠文字线索，不能靠 ¥（见上方注释）
    { re: /(?:JPY|日元|日圆)/i, code: 'JPY', conf: 0.92, source: 'text_jpy' },
    { re: /(?:HKD|港币|港元)/i, code: 'HKD', conf: 0.95, source: 'symbol_hkd' },
    { re: /(?:KRW|韩元)/i, code: 'KRW', conf: 0.92, source: 'text_krw' },
];

/**
 * 抽取币种。默认 CNY（本项目主币）。
 * @param {string} text
 * @returns {{value:string, source:string, confidence:number}}
 */
function extractCurrency(text) {
    if (text && typeof text === 'string') {
        for (const { re, code, conf, source } of CURRENCY_RULES) {
            if (re.test(text)) return { value: code, source, confidence: conf };
        }
    }
    // 无任何符号：中文记账默认人民币，0.85 是「合理默认」而非「确知」。
    // currency 不在 DECISIVE_FIELDS 里，故不会因此触发 needs_confirmation。
    return { value: 'CNY', source: 'default_cny', confidence: 0.85 };
}

module.exports = { extractCurrency, CURRENCY_RULES };
