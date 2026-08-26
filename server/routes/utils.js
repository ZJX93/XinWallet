/* ============================================
   鑫钱包 · 路由辅助函数
   提取自 routes.js 的公共逻辑，供多模块复用
   ============================================ */

// ==========================================
// 辅助：确保分类存在（不存在则自动创建）
// 优先匹配「系统预设（user_id IS NULL）」或「当前用户私有（user_id = ?）」
// 统一唯一权威实现，categories.js / savings.js / utils.js 共用本函数
// ==========================================
async function ensureCategory(conn, userId, name, type, icon) {
    // 匹配：系统预设(user_id IS NULL) 或 用户级共享辅助分类(book_id IS NULL)。
    // 多账本下，用户自建的「本账本专属」分类不参与兜底，避免跨账本误复用。
    let cat = await conn.query(
        "SELECT id FROM categories WHERE name = ? AND type = ? AND (user_id IS NULL OR (user_id = ? AND book_id IS NULL)) LIMIT 1",
        [name, type, userId]
    );
    if (cat.length === 0) {
        // 自动创建的辅助分类归属「用户级共享」(book_id 默认 NULL)，对所有账本可见
        const result = await conn.query(
            "INSERT INTO categories (user_id, name, type, icon, color, is_system) VALUES (?, ?, ?, ?, '#6366f1', TRUE)",
            [userId, name, type, icon]
        );
        return result.insertId;
    }
    return cat[0].id;
}

// ==========================================
// 备注兜底：尊重调用方给定的 note，不做强制拼接。
// ⛔ 本函数【不做任何格式化】——「有 note 就用 note」而已。
//    2026-08-25 踩过的坑：deterministic-extractor 曾注释「commit 时经 resolveNote
//    规范化」，据此把原始片段直接当 note 传进来，结果备注落成
//    `2026年8月20日老乡鸡 18元`（日期金额全冗余），且完全不报错。
//    「场景-对象」格式由 `modules/ai/extraction/note-composer.js` 在【抽取阶段】生成，
//    不要指望这里补救。
// 业务规则：
//   1. 调用方给了 note 就用（AI 链路的 note 已由 note-composer 规范化为「场景-对象」）。
//   2. 没给 note 但给了 merchant（如只识别出商家名）：fallback 到 merchant（最简洁自然）。
//   3. 都没给：用类目名兜底（避免空备注）。常见于手动记账+用户忘填场景。
// 用于 /transactions 创建与更新、AI 预测 commit 等所有入口。
// ==========================================
async function resolveNote(conn, userId, categoryId, note, merchant) {
    if (note) return note;
    if (merchant) return merchant;
    const catRow = await conn.queryOne(
        'SELECT name FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
        [categoryId, userId]
    );
    return catRow ? catRow.name : '';
}

// ==========================================
// 信用卡债务自动同步（交易后自动更新 debts 表）
// ==========================================
async function syncCreditCardDebt(conn, userId, accountId) {
    const acctRows = await conn.query(
        'SELECT name, type, balance, credit_limit FROM accounts WHERE id = $1 AND user_id = $2',
        [accountId, userId]
    );
    const account = acctRows[0];
    if (!account || account.type !== 'credit_card') return;

    const balance = parseFloat(account.balance);
    const limit = parseFloat(account.credit_limit) || 0;
    // 欠款：余额为负时 = -balance（欠款额）；余额为正时 = limit - balance（可用额度）
    const owes = balance <= 0
        ? Math.max(0, -balance)
        : Math.max(0, limit - balance);

    // 查找已关联的债务（按名称匹配）
    const debtRows = await conn.query(
        "SELECT id FROM debts WHERE user_id = $1 AND type = 'credit_card' AND name = $2",
        [userId, account.name]
    );
    const debt = debtRows[0];

    if (owes <= 0) {
        if (debt) {
            await conn.query("UPDATE debts SET remaining = 0, monthly_payment = 0, min_payment = 0, status = 'paid_off' WHERE id = $1", [debt.id]);
        }
    } else {
        const minPmt = Math.max(Math.round(owes * 0.1), 500);
        if (debt) {
            await conn.query(
                'UPDATE debts SET remaining = $1, monthly_payment = 0, min_payment = $2, interest_rate = 18.25, method = \'minimum\', status = \'active\' WHERE id = $3',
                [owes, minPmt, debt.id]
            );
        } else {
            await conn.query(
                `INSERT INTO debts (user_id, name, type, creditor, principal, remaining, interest_rate, term_months, method, monthly_payment, billing_day, payment_day, min_payment, status, note)
                 VALUES (?, ?, 'credit_card', ?, 0, ?, 18.25, 0, 'minimum', 0, 15, 5, ?, 'active', '自动同步：信用卡账户')`,
                [userId, account.name, account.name, owes, minPmt]
            );
        }
    }
}

module.exports = {
    ensureCategory,
    syncCreditCardDebt,
    resolveNote
};
