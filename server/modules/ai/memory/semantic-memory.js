/* ============================================
<<<<<<< HEAD
   Semantic Memory + Negative Memory
=======
   AI v0.2 · §3.3 Semantic Memory + §3.5 Negative Memory
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
   ------------------------------------------------
   Semantic：从历史归纳的【习惯假设】，例如「京东 + 耳机 通常属于 数码电器」。
   Negative：被反复证伪的错误假设，例如「京东并不总是 数码电器」。

   ⛔ 两层共用一张表 ai_memory_items，靠 kind 区分。这不是偷懒：
      同一个 subject 的正反证据必须放在一起才能相互否证
      （support_count 涨得慢而 refute_count 涨得快 → 自动翻转成 negative）。

   ⛔ 铁律（方案 §3 结尾）：本层输出【evidence candidates】，不是结论。
      Decision Engine 才有裁决权。所以所有函数返回的都是带 confidence 的候选，
      从不返回"就是这个类目"。
   ============================================ */

// 归纳阈值：至少 3 次一致才敢形成习惯假设（2 次可能是巧合）
const MIN_SUPPORT = 3;
// 证伪阈值：反驳占比超过 40% 即认为该假设不可靠，翻转为 negative
const REFUTE_RATIO = 0.4;

/**
 * 从 Episodic 分布归纳 Semantic 候选（在线归纳，不落库）。
 * 落库版本由 evidence-engine 在 commit 后异步写入（见 upsertMemoryItem）。
 *
 * @param {object} episodic  retrieveEpisodic 的结果
 * @returns {Array<{subject:string, category_id:number, category_name:string,
 *                  support:number, total:number, ratio:number, confidence:number, kind:string}>}
 */
function induceSemantic(episodic) {
    const out = [];
    for (const [subject, rows] of Object.entries(episodic.by_key || {})) {
        const total = rows.reduce((a, r) => a + r.count, 0);
        if (total < MIN_SUPPORT) continue;

        // 取占比最高的类目作为假设
        const top = rows.filter(r => r.category_id).sort((a, b) => b.count - a.count)[0];
        if (!top) continue;

        const ratio = top.count / total;
        // 一致性不足 → 这是「反面知识」：知道它不稳定，本身就有价值
        const kind = ratio >= (1 - REFUTE_RATIO) ? 'semantic' : 'negative';

        out.push({
            subject,
            category_id: top.category_id,
            category_name: top.category_name,
            type: top.type,
            support: top.count,
            total,
            ratio: Number(ratio.toFixed(4)),
            // 置信度 = 一致性比例 × 样本充分度（样本越多越可信，10 次封顶）
            confidence: kind === 'semantic'
                ? Number((ratio * Math.min(1, total / 10) * 0.95).toFixed(4))
                : 0,
            kind,
        });
    }
    return out;
}

/**
 * 读取已持久化的记忆条目（Semantic 与 Negative 一起取，便于相互否证）。
 * @returns {Promise<{semantic:Array, negative:Array}>}
 */
async function retrieveMemoryItems(db, wm, subjects = []) {
    const keys = [...new Set(subjects.filter(s => s && s.length >= 2))];
    const result = { semantic: [], negative: [] };
    if (keys.length === 0) return result;

    try {
        const placeholders = keys.map(() => '?').join(',');
        const rows = await db.query(
            `SELECT id, kind, subject, predicate, object_value, object_category_id,
                    support_count, refute_count, confidence, last_seen_at
               FROM ai_memory_items
              WHERE user_id = ?
                AND (book_id = ? OR book_id IS NULL)
                AND LOWER(subject) IN (${placeholders})
              ORDER BY confidence DESC
              LIMIT 40`,
            [wm.userId, wm.bookId, ...keys.map(k => k.toLowerCase())]
        );
        for (const r of rows) {
            const item = {
                id: r.id,
                subject: r.subject,
                predicate: r.predicate,
                object_value: r.object_value,
                category_id: r.object_category_id,
                support: Number(r.support_count),
                refute: Number(r.refute_count),
                confidence: Number(r.confidence),
            };
            if (r.kind === 'negative') result.negative.push(item);
            else result.semantic.push(item);
        }
    } catch (_) {
        // 表不存在（老库尚未升级）或查询失败：记忆是增强项，静默降级
    }
    return result;
}

/**
 * 写入 / 更新一条记忆条目（commit 后由 evidence-engine 调用）。
 *
 * @param {object} db
 * @param {object} params
 * @param {'support'|'refute'} params.signal  本次是支持还是反驳
 */
async function upsertMemoryItem(db, {
    userId, bookId, subject, predicate = 'category',
    objectValue, categoryId, signal,
}) {
    if (!subject || !objectValue) return null;
    const subj = String(subject).slice(0, 120);
    const obj = String(objectValue).slice(0, 120);

    try {
        const existing = await db.queryOne(
            `SELECT id, support_count, refute_count FROM ai_memory_items
              WHERE user_id = ? AND book_id = ? AND kind IN ('semantic','negative')
                AND subject = ? AND predicate = ? AND object_value = ?
              LIMIT 1`,
            [userId, bookId, subj, predicate, obj]
        );

        const supportInc = signal === 'support' ? 1 : 0;
        const refuteInc = signal === 'refute' ? 1 : 0;

        if (existing) {
            const support = Number(existing.support_count) + supportInc;
            const refute = Number(existing.refute_count) + refuteInc;
            const { kind, confidence } = classify(support, refute);
            await db.query(
                `UPDATE ai_memory_items
                    SET support_count = ?, refute_count = ?, kind = ?, confidence = ?,
                        last_seen_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [support, refute, kind, confidence, existing.id]
            );
            return existing.id;
        }

        const { kind, confidence } = classify(supportInc, refuteInc);
        const ins = await db.query(
            `INSERT INTO ai_memory_items
               (user_id, book_id, kind, subject, predicate, object_value, object_category_id,
                support_count, refute_count, confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, bookId, kind, subj, predicate, obj, categoryId || null,
             supportInc, refuteInc, confidence]
        );
        return ins.insertId;
    } catch (_) {
        // 学习类写入失败绝不影响已落账数据（方案 §11：学习失败不得回滚账本）
        return null;
    }
}

/** 依据支持/反驳次数判定 kind 与置信度 */
function classify(support, refute) {
    const total = support + refute;
    if (total === 0) return { kind: 'semantic', confidence: 0 };
    const ratio = support / total;
    if (ratio < 1 - REFUTE_RATIO) {
        // 反驳占比过高 → 这条假设本身成为「负面记忆」，置信度归零
        return { kind: 'negative', confidence: 0 };
    }
    return {
        kind: 'semantic',
        confidence: Number((ratio * Math.min(1, total / 10) * 0.95).toFixed(4)),
    };
}

/**
 * 判断某个 (subject, category) 组合是否被负面记忆否决。
 * Decision Engine 用它来「扣掉」不该信的候选。
 */
function isNegated(memoryItems, subject, categoryId) {
    if (!memoryItems || !Array.isArray(memoryItems.negative)) return false;
    const s = String(subject || '').toLowerCase();
    return memoryItems.negative.some(
        n => String(n.subject).toLowerCase() === s && n.category_id === categoryId
    );
}

module.exports = {
    induceSemantic, retrieveMemoryItems, upsertMemoryItem, isNegated,
    MIN_SUPPORT, REFUTE_RATIO,
};
