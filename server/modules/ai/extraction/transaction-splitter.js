/* ============================================
   AI v0.2 · 确定性抽取器 —— 多笔拆分
   ------------------------------------------------
   「早饭12，打车30，午饭25」应拆成 3 笔，而不是把 12/30/25 混成一笔。
   拆分策略：先按显式分隔符切；若切完只有一段但含多个金额，再按「金额锚点」二次切。
   宁可少拆（合成一笔让用户改）也不要错拆——错拆会凭空造出不存在的交易。
   ============================================ */

// 显式分隔符：中英文逗号/分号/顿号/换行
const HARD_SEP = /[\n；;，,、]+/;

/**
 * 判断片段是否「像一笔交易」：至少含一个数字（金额线索）。
 * 纯描述性片段（如「今天有点累」）不应成为一笔。
 */
function looksLikeTxn(seg) {
    return /\d/.test(seg) || /[零一二两三四五六七八九十百千万]+\s*(?:元|块)/.test(seg);
}

/**
 * 拆分多笔交易。
 * @param {string} text
 * @returns {{segments:string[], source:string, multi:boolean}}
 */
function splitTransactions(text) {
    if (!text || typeof text !== 'string') {
        return { segments: [], source: 'empty', multi: false };
    }
    const trimmed = text.trim();

    // 1) 显式分隔符切分
    const hard = trimmed.split(HARD_SEP).map(s => s.trim()).filter(Boolean);
    const hardTxns = hard.filter(looksLikeTxn);
    if (hardTxns.length > 1) {
        return { segments: hardTxns, source: 'hard_separator', multi: true };
    }

    // 2) 「和 / 以及 / 还有 / 另外」连接的并列消费
    //    要求两侧都含数字，否则「我和朋友吃饭30」会被错拆。
    const conj = trimmed.split(/\s*(?:以及|还有|另外|外加|加上)\s*/).map(s => s.trim()).filter(Boolean);
    const conjTxns = conj.filter(looksLikeTxn);
    if (conjTxns.length > 1) {
        return { segments: conjTxns, source: 'conjunction', multi: true };
    }

    // 3) 金额锚点二次切分：单段内出现多个「带单位金额」→ 按金额位置切。
    //    只认带单位的金额（元/块/¥），裸数字不参与，避免「买3个15元」被切成两笔。
    const anchors = [...trimmed.matchAll(/(?:[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:元|块钱|块))/g)];
    if (anchors.length > 1) {
        const segs = [];
        for (let i = 0; i < anchors.length; i++) {
            const start = i === 0 ? 0 : anchors[i - 1].index + anchors[i - 1][0].length;
            const end = anchors[i].index + anchors[i][0].length;
            const seg = trimmed.slice(start, end).trim();
            if (seg && looksLikeTxn(seg)) segs.push(seg);
        }
        // 尾部残留描述（如「…共花了」）忽略；仅当确实切出 >1 段才认为是多笔
        if (segs.length > 1) {
            return { segments: segs, source: 'amount_anchor', multi: true };
        }
    }

    // 4) 单笔
    return { segments: [trimmed], source: 'single', multi: false };
}

module.exports = { splitTransactions, looksLikeTxn };
