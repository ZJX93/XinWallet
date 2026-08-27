/* ============================================
   AI v0.2 · Context Builder
   ------------------------------------------------
   方案 §1 架构图里 Deterministic Extractor 之后紧跟 Context Builder，
   职责是把「解析所需的一切外部事实」组装成一个不可变对象：
     - 类目表（唯一真相，类目 id 绝不能臆造）
     - Working Memory（本次请求现场）
     - 默认账户

   ⛔ 与 Memory Retrieval 的分界：
      Context Builder 拿【确定事实】（类目表、账户），
      Memory Retrieval 拿【历史推断】（规则、习惯、历史分布）。
      前者错了是 bug，后者错了只是证据弱 —— 混在一起会分不清该不该信。
   ============================================ */

const { buildWorkingMemory, snapshotWorkingMemory } = require('../memory/working-memory');

/**
 * 组装解析上下文。
 * @param {object} db
 * @param {object} params { userId, bookId, context, now }
 * @returns {Promise<{wm:object, categories:Array, accounts:Array}>}
 */
async function buildContext(db, { userId, bookId, context = {}, now = new Date() }) {
    const wm = buildWorkingMemory({ userId, bookId, context, now });

    // 类目：系统预设（user_id IS NULL）+ 用户自建。账本维度不过滤（与既有 /chat 一致）
    let categories = [];
    try {
        categories = await db.query(
            `SELECT id, name, type, parent_id, code
               FROM categories
              WHERE user_id IS NULL OR user_id = ?
              ORDER BY sort_order, id`,
            [userId]
        );
    } catch (_) {
        // 类目取不到是硬故障：后续 category_id 必然为空 → validator 会判 invalid，
        // 这正是我们想要的（宁可报错也不臆造 id）
        categories = [];
    }

    // 账户：供规则 target_account_id 校验与账户名解析（不做默认账户猜测）
    let accounts = [];
    try {
        accounts = await db.query(
            `SELECT id, name, type FROM accounts
              WHERE user_id = ? AND (book_id = ? OR book_id IS NULL)
              ORDER BY id`,
            [userId, bookId]
        );
    } catch (_) {
        accounts = [];
    }

    return { wm, categories, accounts };
}

/** 可序列化的上下文快照 */
function snapshotContext(ctx) {
    return {
        ...snapshotWorkingMemory(ctx.wm),
        categories_count: ctx.categories.length,
        accounts_count: ctx.accounts.length,
    };
}

module.exports = { buildContext, snapshotContext };
