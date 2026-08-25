/* ============================================
   AI v0.2 · 交易解析器（Parser 层）
   ------------------------------------------------
   编排「加载上下文 → 确定性抽取 → 校验」，产出 prediction 草稿。
   本层【不写库】（写库是 prediction-store 的职责），保持纯粹便于单测。

   Phase 1 为纯确定性；Phase 4 接入复杂度路由后，
   当确定性结果 invalid/低置信时才升级调用模型（此处已留 hook 注释）。
   ============================================ */

const { extractTransactions } = require('../extraction/deterministic-extractor');
const { validateResult } = require('../validation/result-validator');

/**
 * 加载解析所需上下文（类目 / 默认账户 / 历史商家）。
 * @param {object} db  db 模块或事务连接
 * @param {number} userId
 * @param {number} bookId
 */
async function loadContext(db, userId, bookId) {
    // 类目：系统预设（user_id IS NULL）+ 用户自建；账本维度不过滤类目（与现有 /chat 一致）
    const categories = await db.query(
        `SELECT id, name, type, parent_id, code
           FROM categories
          WHERE user_id IS NULL OR user_id = ?
          ORDER BY sort_order, id`,
        [userId]
    );

    // 历史商家：从近期交易备注里取高频值，作为 merchant 抽取的个人化词典（Phase 3 会换成 ai_rules）
    let userMerchants = [];
    try {
        const rows = await db.query(
            `SELECT note, COUNT(*) AS cnt
               FROM transactions
              WHERE user_id = ? AND book_id = ? AND note IS NOT NULL AND note <> ''
              GROUP BY note
              ORDER BY cnt DESC
              LIMIT 50`,
            [userId, bookId]
        );
        userMerchants = rows.map(r => r.note).filter(n => n && n.length >= 2 && n.length <= 12);
    } catch (_) {
        // 历史商家是增强项，取不到不影响解析
        userMerchants = [];
    }

    return { categories, userMerchants };
}

/**
 * 解析文本为候选交易 + 校验裁决（不落库）。
 *
 * @param {object} db
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.bookId
 * @param {string} params.text
 * @param {object} [params.context] { account_id?, date?, timezone? }
 * @returns {Promise<{transactions:Array, validation:object, decision_trace:object}>}
 */
async function parseTransactions(db, { userId, bookId, text, context = {} }) {
    const { categories, userMerchants } = await loadContext(db, userId, bookId);

    // 若调用方指定了基准日期（如 OCR 票据日期），以它为参考日
    let refDate = new Date();
    if (context.date && /^\d{4}-\d{2}-\d{2}/.test(context.date)) {
        const [y, m, d] = context.date.slice(0, 10).split('-').map(Number);
        const cand = new Date(y, m - 1, d);
        if (!Number.isNaN(cand.getTime())) refDate = cand;
    }

    const { transactions, multi, split_source } = extractTransactions(text, {
        categories,
        account_id: context.account_id || null,
        book_id: bookId,
        refDate,
        userMerchants,
    });

    const validation = validateResult(transactions);

    // 证据链：可解释性核心 —— 让用户/开发者看懂「为什么这么判」
    const decision_trace = {
        engine: 'deterministic',       // Phase 4 后可能是 'cheap_model' / 'strong_model'
        prediction_version: 1,
        split: { source: split_source, multi, count: transactions.length },
        per_txn_evidence: transactions.map(t => ({ seq: t.seq, evidence: t.evidence })),
        thresholds: validation.thresholds,
        context_used: {
            categories_count: categories.length,
            user_merchants_count: userMerchants.length,
            ref_date: refDate.toISOString().slice(0, 10),
            account_id: context.account_id || null,
            book_id: bookId,
        },
        // Phase 4 hook：模型升级路由的决策记录将写入此处
        model_escalation: null,
    };

    return { transactions, validation, decision_trace };
}

module.exports = { parseTransactions, loadContext };
