/* ============================================
   票据日期/时间硬覆盖：预处理器已从「支付时间」读到精确日期与时分秒，
   模型复核却可能填 00:00:00、甚至编造日期 → 以票据为准覆盖。
   独立成模块以便单元测试（2026-08-29 同一张票据两次识别 08-29/08-25 的根因）。
   ============================================ */

/**
 * 用票据预处理结果覆盖模型输出的日期/时间（原地修改 transactions）。
 * 仅在预处理成功、且笔数 1:1 能对上时启用，避免错配污染多笔账单。
 * @param {{ok:boolean, items?:Array<{date?:string,time?:string}>}} pre 票据预处理结果
 * @param {Array<{date:string, evidence?:Object}>} transactions 模型输出
 * @returns {number} 实际覆盖的笔数
 */
function applyPreprocessDateOverride(pre, transactions) {
    if (!pre || !pre.ok || !Array.isArray(pre.items) || !pre.items.length ||
        !Array.isArray(transactions) || transactions.length !== pre.items.length) {
        return 0;
    }
    let overridden = 0;
    pre.items.forEach((src, idx) => {
        const t = transactions[idx];
        if (!src || !t || !t.date) return;

        // ① 时间兜底：模型常把时间填成 00:00:00，用票据读到的精确时分秒覆盖
        if (src.time && / 00:00:00$/.test(t.date)) {
            t.date = `${t.date.slice(0, 10)} ${src.time}`;
            if (t.evidence) t.evidence.date = 'receipt_preprocess_time';
            overridden += 1;
        }

        // ② 日期硬覆盖：票据上的日期是白纸黑字的硬证据，模型复核却会「编造」日期
        //    （实测同一张淘宝账单两次识别：一次 2026-08-29、一次 2026-08-25，时间都对）。
        //    只要本地从票据读到了日期，就以票据为准，模型无权改写。
        if (src.date && t.date.slice(0, 10) !== src.date) {
            const m = / (\d{2}:\d{2}:\d{2})$/.exec(t.date);
            const time = m ? m[1] : (src.time || '00:00:00');
            t.date = `${src.date} ${time}`;
            if (t.evidence) t.evidence.date = 'receipt_preprocess_date';
            overridden += 1;
        }
    });
    return overridden;
}

module.exports = { applyPreprocessDateOverride };
