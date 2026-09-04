/* ============================================
   鑫钱包 · 金额精度工具（修复审核报告 M3）

   问题背景：
     数据库列是 numeric(15,2)（精确十进制），但 pg 驱动把 numeric 以字符串返回后，
     业务层统一 parseFloat 转成 IEEE-754 双精度浮点再做累加/乘除。
     浮点数无法精确表示 0.1、0.07 这类十进制小数，累加会产生分位漂移：
       0.1 + 0.2                → 0.30000000000000004
       0.07 累加 1000 次        → 69.99999999999966
       5 笔金额累加 2 万次      → 偏差 0.0000305176 元
     单次误差极小，但记账软件是长期累积场景，且误差会经由
     "余额重算 → 写回 DB → 再读出累加"形成放大链路。财务软件不可接受。

   本模块方案：
     以「整数分」为运算内核 —— 所有加减在 Number 安全整数域内完成，零误差；
     仅在最终输出时除以 100 还原为元。不引入 decimal.js 等外部依赖，
     零安装成本，且性能优于 BigInt/字符串十进制方案。

   适用范围与边界：
     Number.MAX_SAFE_INTEGER = 9007199254740991 分 ≈ 90 万亿元，
     远超个人记账量级，安全。超出时 toCents 会显式抛错而非静默失真。

   用法：
     const { sumAmounts, toCents, roundAmount } = require('../services/money');
     const total = sumAmounts(accounts, a => a.balance);   // 精确求和
     const t2    = sumAmounts([1.1, 2.2, 3.3]);            // 直接对数组求和
   ============================================ */

/**
 * 金额（元）→ 整数分
 * 用 Math.round 消除 parseFloat 本身引入的表示误差：
 *   19.99 * 100 = 1998.9999999999998 → round → 1999
 * @param {number|string|null|undefined} value
 * @returns {number} 整数分
 */
function toCents(value) {
    if (value === null || value === undefined || value === '') return 0;
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(num)) {
        // 显式失败优于静默归零——非法金额（NaN/Infinity/无法解析）必须让调用方感知，
        // 否则脏数据会被当作 0 静默写进账本，长期累积造成账目错乱
        throw new TypeError(`非法金额，无法转为整数分: ${JSON.stringify(value)}`);
    }

    const cents = Math.round(num * 100);
    if (!Number.isSafeInteger(cents)) {
        // 显式失败优于静默失真——金额溢出必须让调用方知道
        throw new RangeError(`金额超出安全计算范围: ${value}`);
    }
    return cents;
}

/**
 * 整数分 → 金额（元），保留 2 位小数
 * @param {number} cents
 * @returns {number}
 */
function fromCents(cents) {
    if (cents === null || cents === undefined) return 0;
    if (!Number.isFinite(cents)) {
        // 与 toCents 一致：非有限值视为调用方传入了脏数据，显式抛错而非静默归零
        throw new TypeError(`非法整数分: ${JSON.stringify(cents)}`);
    }
    return Math.round(cents) / 100;
}

/**
 * 精确求和：内部全程整数分累加，无浮点漂移
 * @param {Array} list 数组，元素可为数字、字符串，或对象（配合 selector）
 * @param {Function} [selector] 从元素中取出金额，默认取元素本身
 * @returns {number} 求和结果（元，2 位小数）
 */
function sumAmounts(list, selector) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    const pick = typeof selector === 'function' ? selector : (x => x);

    let cents = 0;
    for (const item of list) {
        cents += toCents(pick(item));
        if (!Number.isSafeInteger(cents)) {
            throw new RangeError('金额累加结果超出安全计算范围');
        }
    }
    return fromCents(cents);
}

/**
 * 精确加减：addAmounts(a, b, c...) 支持负数实现减法
 * @param  {...(number|string)} values
 * @returns {number}
 */
function addAmounts(...values) {
    let cents = 0;
    for (const v of values) cents += toCents(v);
    return fromCents(cents);
}

/**
 * 精确减法：a - b - c...
 */
function subtractAmounts(base, ...values) {
    let cents = toCents(base);
    for (const v of values) cents -= toCents(v);
    return fromCents(cents);
}

/**
 * 金额规范化：消除已有浮点误差，statement 到 2 位小数
 * 用于输出前的最后一道兜底
 */
function roundAmount(value) {
    return fromCents(toCents(value));
}

/**
 * 百分比计算（如收益率、占比），返回值保留指定小数位
 * 分子分母都在分域比较，避免 0 除与浮点误差
 * @param {number|string} part 分子（金额）
 * @param {number|string} whole 分母（金额）
 * @param {number} [digits=2] 保留小数位
 * @returns {number} 百分数值，如 12.34 表示 12.34%
 */
function percentOf(part, whole, digits = 2) {
    const w = toCents(whole);
    if (w === 0) return 0;
    const p = toCents(part);
    const factor = Math.pow(10, digits);
    return Math.round((p / w) * 100 * factor) / factor;
}

// toCents / fromCents 均被 portfolio.js 使用（前者用于分域比较，后者把分还原为元后接入 percentOf）。
module.exports = {
    toCents,
    fromCents,
    sumAmounts,
    addAmounts,
    subtractAmounts,
    roundAmount,
    percentOf,
};
