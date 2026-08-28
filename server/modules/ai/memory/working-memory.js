/* ============================================
   Working Memory
   ------------------------------------------------
   当前请求的瞬时上下文：账户、时区、参考日期、平台、账本。
   ⛔ 铁律：Working Memory【不形成长期习惯】—— 本层任何内容都不得写入
   ai_rules / ai_memory_items。它只是"这一次请求的现场"，请求结束即丢弃。

   之所以单独成模块而不是散在 parser 里：方案 §6 要求 prediction 快照能
   完整重放当时的上下文（context_snapshot），集中构造才能保证不漏字段。
   ============================================ */

const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/**
 * 构造本次请求的工作记忆。
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.bookId
 * @param {object} [params.context]  客户端传入的 { account_id, date, timezone, platform }
 * @param {Date}   [params.now]      注入当前时间（测试用）
 * @returns {{userId:number, bookId:number, accountId:number|null, timezone:string,
 *            refDate:Date, refDateStr:string, platform:string, source:string}}
 */
function buildWorkingMemory({ userId, bookId, context = {}, now = new Date() }) {
    // 参考日期：调用方显式指定（如 OCR 票据日期）优先，否则用当前时间
    let refDate = now;
    if (context.date && /^\d{4}-\d{2}-\d{2}/.test(context.date)) {
        const [y, m, d] = context.date.slice(0, 10).split('-').map(Number);
        const cand = new Date(y, m - 1, d);
        if (!Number.isNaN(cand.getTime())) refDate = cand;
    }

    return {
        userId,
        bookId: bookId || null,
        accountId: context.account_id || null,
        // 客户端透传的「上次使用的账户」名：OCR 文本无渠道关键词时
        // resolveAccount 走 fallback_default 路径会用到，让识别依据可显示「上次使用：XXX」。
        lastAccountName: context.last_account_name || null,
        timezone: context.timezone || DEFAULT_TIMEZONE,
        refDate,
        refDateStr: toDateStr(refDate),
        // 平台是展示维度，不参与判定；放在此处便于 decision_trace 归档
        platform: context.platform || 'unknown',
        source: context.source || 'parse',
    };
}

/** 可序列化的上下文快照（写入 ai_predictions.request.context 与 decision_trace） */
function snapshotWorkingMemory(wm) {
    return {
        book_id: wm.bookId,
        account_id: wm.accountId,
        last_account_name: wm.lastAccountName || null,
        timezone: wm.timezone,
        ref_date: wm.refDateStr,
        platform: wm.platform,
        source: wm.source,
    };
}

function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

module.exports = { buildWorkingMemory, snapshotWorkingMemory, DEFAULT_TIMEZONE };
