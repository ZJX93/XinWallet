/* ============================================
<<<<<<< HEAD
   Episodic Memory
=======
   AI v0.2 · §3.2 Episodic Memory
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
   ------------------------------------------------
   回答「以前发生过什么」——真实历史交易与反馈事件，不做任何归纳。
   本层是【事实层】：只报告观察到的分布，不给结论。
   归纳成"习惯假设"是 Semantic Memory 的事，裁决是 Decision Engine 的事。

   ⛔ 性能铁律：本层每次 parse 都会跑，必须走索引且 LIMIT 有界。
      transactions 上已有 (user_id, book_id) 复合索引（schema.sql:idx_*_user_book）。
   ============================================ */

// 单次检索的历史窗口：更久远的历史交给 Semantic Memory 的归纳结论，
// 避免每次 parse 都扫全表（老用户可能有数万条交易）。
const LOOKBACK_DAYS = 180;
const MAX_ROWS = 200;

/**
 * 按商家 / 关键词检索历史交易分布。
 *
 * @param {object} db     db 模块或事务连接
 * @param {object} wm     Working Memory
 * @param {string[]} keys 候选检索键（商家名 + 文本关键片段）
 * @returns {Promise<{by_key:object, recent_notes:string[], total_scanned:number}>}
 *   by_key[key] = [{ category_id, category_name, type, account_id, count, last_date }]
 */
async function retrieveEpisodic(db, wm, keys = []) {
    const cleanKeys = [...new Set(keys.filter(k => k && k.length >= 2 && k.length <= 40))];
    const result = { by_key: {}, recent_notes: [], total_scanned: 0 };
    if (cleanKeys.length === 0) return result;

    for (const key of cleanKeys) {
        try {
            // 按备注模糊匹配同一商家的历史归类分布。
            // 只取 income/expense：转账的类目固定，没有归类学习价值。
            const rows = await db.query(
                `SELECT t.category_id,
                        c.name  AS category_name,
                        t.type,
                        t.account_id,
                        COUNT(*) AS cnt,
                        MAX(t.date) AS last_date
                   FROM transactions t
                   LEFT JOIN categories c ON c.id = t.category_id
                  WHERE t.user_id = ?
                    AND t.book_id = ?
                    AND t.type IN ('income','expense')
                    AND t.note LIKE ?
                    AND t.date >= ?
                  GROUP BY t.category_id, c.name, t.type, t.account_id
                  ORDER BY cnt DESC
                  LIMIT 10`,
                [wm.userId, wm.bookId, `%${key}%`, cutoffDate(wm.refDate)]
            );
            if (rows.length) {
                result.by_key[key] = rows.map(r => ({
                    category_id: r.category_id,
                    category_name: r.category_name || null,
                    type: r.type,
                    account_id: r.account_id,
                    count: Number(r.cnt),
                    last_date: normalizeDate(r.last_date),
                }));
                result.total_scanned += rows.reduce((a, r) => a + Number(r.cnt), 0);
            }
        } catch (_) {
            // 历史检索是增强项：数据库异常不能让记账链路失败
        }
    }

    return result;
}

/**
 * 高频备注 → 个人化商家词典（供 merchant-extractor 增强）。
 * 这是 Phase 1 就有的能力，此处收拢到 Episodic 层统一管理。
 */
async function retrieveFrequentMerchants(db, wm, limit = 50) {
    try {
        const rows = await db.query(
            `SELECT note, COUNT(*) AS cnt
               FROM transactions
              WHERE user_id = ? AND book_id = ? AND note IS NOT NULL AND note <> ''
              GROUP BY note
              ORDER BY cnt DESC
              LIMIT ?`,
            [wm.userId, wm.bookId, limit]
        );
        return rows.map(r => r.note).filter(n => n && n.length >= 2 && n.length <= 12);
    } catch (_) {
        return [];
    }
}

/**
 * 该商家在历史里最常用的账户（用于 account 建议，低权重）。
 * @returns {number|null}
 */
function dominantAccount(episodic, key) {
    const rows = episodic.by_key[key];
    if (!rows || !rows.length) return null;
    const byAcc = new Map();
    for (const r of rows) {
        if (!r.account_id) continue;
        byAcc.set(r.account_id, (byAcc.get(r.account_id) || 0) + r.count);
    }
    if (byAcc.size === 0) return null;
    return [...byAcc.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function cutoffDate(refDate) {
    const d = new Date(refDate.getTime() - LOOKBACK_DAYS * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** PG 返回 Date 对象、MySQL 返回字符串 —— 统一成 YYYY-MM-DD */
function normalizeDate(v) {
    if (!v) return null;
    if (typeof v === 'string') return v.slice(0, 10);
    if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    return String(v).slice(0, 10);
}

module.exports = {
    retrieveEpisodic, retrieveFrequentMerchants, dominantAccount,
    LOOKBACK_DAYS, MAX_ROWS,
};
