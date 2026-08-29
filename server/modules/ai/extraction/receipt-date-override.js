/* ============================================
   票据日期/时间硬覆盖：预处理器已从「支付时间」读到精确日期与时分秒，
   模型复核却可能填 00:00:00、填当前时间、甚至编造日期 → 以票据为准覆盖。
   独立成模块以便单元测试（2026-08-29 同一张票据两次识别 08-29/08-25 的根因）。

   ⛔ 2026-08-29 踩过的两个坑，都写在下面的逻辑里：
      ① 票据里的「立减金 -0.10」被预处理器误拆成第二笔，模型只回 1 笔
         → 旧逻辑因【笔数 1:1 不匹配】整段放弃 → 日期漏填被原样保留。
         ⇒ 现在笔数不匹配时，只要票据日期【唯一】仍整体兜底。
      ② 模型把时间填成【解析时的当前时间】（实测 14:29:18 冒充 20:19:15）。
         它不是 00:00:00，旧逻辑以为"模型给了有效时间"就放行了。
         ⇒ 单笔票据（票据日期与时间都唯一）时，时分秒强制覆盖。
   ============================================ */

/**
 * 用票据日期/时间覆盖单笔交易（原地修改）。
 * @param {{date:string, evidence?:Object}} t 模型输出的一笔交易
 * @param {string} srcDate 'YYYY-MM-DD'，票据硬证据日期
 * @param {string} [srcTime] 'HH:mm:ss'，票据硬证据时间
 * @param {boolean} [forceTime] 是否强制用票据时间覆盖模型时间
 * @returns {boolean} 是否发生覆盖
 */
function applyDateToTxn(t, srcDate, srcTime, forceTime = false) {
    if (!t || !t.date) return false;
    const dateOk = t.date.slice(0, 10) === srcDate;
    const m = / (\d{2}:\d{2}:\d{2})$/.exec(t.date);
    const modelTime = m ? m[1] : null;
    const hasRealTime = !!modelTime && modelTime !== '00:00:00';
    if (dateOk && hasRealTime && !forceTime) return false;

    /*  时间取谁：
        · 模型填了 00:00:00 → 票据时间补上
        · 模型填了「当前时间」→ 只有 forceTime（单笔票据）时才敢覆盖
        · 多笔账单不 forceTime：票据只给了一个支付时间，不能套到每一笔上 */
    const time = (hasRealTime && !forceTime) ? modelTime : (srcTime || '00:00:00');
    const next = `${srcDate} ${time}`;
    if (next === t.date) return false;          // 覆盖后与原来一样，不算覆盖
    t.date = next;
    if (t.evidence) {
        t.evidence.date = dateOk ? 'receipt_preprocess_time' : 'receipt_preprocess_date';
    }
    return true;
}

/**
 * 用票据预处理结果覆盖模型输出的日期/时间（原地修改 transactions）。
 * @param {{ok:boolean, items?:Array<{date?:string,time?:string}>}} pre 票据预处理结果
 * @param {Array<{date:string, evidence?:Object}>} transactions 模型输出
 * @returns {number} 实际覆盖的笔数
 */
function applyPreprocessDateOverride(pre, transactions) {
    if (!pre || !pre.ok || !Array.isArray(pre.items) || !pre.items.length ||
        !Array.isArray(transactions) || !transactions.length) {
        return 0;
    }

    /*  单笔票据判定：票据读到的【日期】与【时间】都唯一。
        单笔时票据的时分秒就是这一笔的硬证据，即使模型填了个"看起来有效"
        的时间也必须覆盖；多笔账单各笔时间不同，不能拿一个时间去套所有笔。 */
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    const dates = uniq(pre.items.map(i => i && i.date));
    const times = uniq(pre.items.map(i => i && i.time));
    const forceTime = dates.length === 1 && times.length === 1;

    // 笔数对齐：逐笔精细覆盖（多笔账单各笔有自己的日期）
    if (transactions.length === pre.items.length) {
        let overridden = 0;
        pre.items.forEach((src, idx) => {
            if (!src) return;
            if (applyDateToTxn(transactions[idx], src.date, src.time, forceTime)) overridden += 1;
        });
        return overridden;
    }

    // 笔数不匹配：票据各笔日期一致时（单笔票据被误拆多笔），仍整体兜底
    if (dates.length !== 1) return 0;
    let overridden = 0;
    for (const t of transactions) {
        if (applyDateToTxn(t, dates[0], pre.items[0].time, forceTime)) overridden += 1;
    }
    return overridden;
}

module.exports = { applyPreprocessDateOverride, applyDateToTxn };
