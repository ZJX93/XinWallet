/* ============================================
   鑫钱包 · 路由辅助函数
   提取自 routes.js 的公共逻辑，供多模块复用
   ============================================ */

// ==========================================
// 辅助：确保分类存在（不存在则自动创建）
// 优先匹配「系统预设（user_id IS NULL）」或「当前用户私有（user_id = ?）」
// 统一唯一权威实现，categories.js / savings.js / utils.js 共用本函数
// ==========================================
// 部分分类自动创建时需挂到指定父类下（例如「借出」→ 其他支出，「借入」→ 其他收入），
// 避免它们散落成「一级叶子」，后续账本/筛选体验与系统预设不一致。
// key 格式：`<name>|<type>`，value 为父类 id（必须是已存在的系统一级分类）。
const DEFAULT_PARENT_BY_CAT = {
    '借出|expense': 14,   // 其他支出
    '借入|income': 21,    // 其他收入
};

async function ensureCategory(conn, userId, name, type, icon) {
    // 匹配：系统预设(user_id IS NULL) 或 用户级共享辅助分类(book_id IS NULL)。
    // 多账本下，用户自建的「本账本专属」分类不参与兜底，避免跨账本误复用。
    let cat = await conn.query(
        "SELECT id FROM categories WHERE name = ? AND type = ? AND (user_id IS NULL OR (user_id = ? AND book_id IS NULL)) LIMIT 1",
        [name, type, userId]
    );
    if (cat.length === 0) {
        // 自动创建的辅助分类归属「用户级共享」(book_id 默认 NULL)，对所有账本可见
        const parentId = DEFAULT_PARENT_BY_CAT[`${name}|${type}`] || null;
        const result = await conn.query(
            "INSERT INTO categories (user_id, name, type, icon, color, parent_id, is_system) VALUES (?, ?, ?, ?, '#6366f1', ?, TRUE)",
            [userId, name, type, icon, parentId]
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
// 授信账户债务自动同步（交易后自动更新 debts 表）
//
// 适用范围：信用卡 + 带信用额度的电子支付账户（花呗 / 微粒贷 / 月付等）。
// 这两类账户的共同点是「余额可以为负，负值即占用授信」，占用就必须体现为债务，
// 否则用户看到的负债会凭空少一块。原先只认 credit_card，电子支付账户设了额度
// 却刷成负数时债务列表里什么都没有。
// ==========================================

// 判断账户是否属于「占用授信」类：信用卡，或带信用额度的电子支付账户
function isCreditAccount(account) {
    if (!account) return false;
    if (account.type === 'credit_card') return true;
    return account.type === 'electronic_payment' && (parseFloat(account.credit_limit) || 0) > 0;
}

async function syncCreditCardDebt(conn, userId, accountId) {
    const acctRows = await conn.query(
        'SELECT name, type, balance, credit_limit, book_id FROM accounts WHERE id = ? AND user_id = ?',
        [accountId, userId]
    );
    const account = acctRows[0];
    if (!isCreditAccount(account)) return;

    const balance = parseFloat(account.balance);
    // 欠款只发生在余额为负（已占用授信）时；余额 >= 0（含溢缴款 / 充值余额）不属于欠款
    const owes = balance < 0 ? Math.max(0, -balance) : 0;

    const isCard = account.type === 'credit_card';
    // debts.type 受 CHECK 约束（credit_card/loan/personal/other），
    // 电子支付类授信账户落在 'other' 上
    const debtType = isCard ? 'credit_card' : 'other';
    // 归属账本取自账户自身：债务列表按 book_id 过滤，写 NULL 会让同步出来的债务不显示
    const bookId = (account.book_id === undefined || account.book_id === null) ? null : account.book_id;
    const syncNote = isCard ? '自动同步：信用卡账户' : '自动同步：信用支付账户';

    // 查找已关联的债务：优先按关联账户定位；回退到同名匹配（历史同步记录没写 account_id）
    let debtRows = await conn.query(
        'SELECT id FROM debts WHERE user_id = ? AND account_id = ? AND type = ? LIMIT 1',
        [userId, accountId, debtType]
    );
    if (debtRows.length === 0) {
        debtRows = await conn.query(
            'SELECT id FROM debts WHERE user_id = ? AND type = ? AND name = ? AND account_id IS NULL LIMIT 1',
            [userId, debtType, account.name]
        );
    }
    const debt = debtRows[0];

    if (owes <= 0) {
        if (debt) {
            // 已结清时一并把可能残留的旧硬编码利率清零，避免编辑时回填 18.25
            await conn.query("UPDATE debts SET remaining = 0, monthly_payment = 0, min_payment = 0, interest_rate = 0, status = 'paid_off' WHERE id = ?", [debt.id]);
        }
    } else {
        const minPmt = Math.max(Math.round(owes * 0.1), 500);
        if (debt) {
            // ⚠️ 不再硬编码 18.25：信用卡/花呗消费账单在免息期内还清本就不产生利息，
            // 挂载行业利率上限会误导用户以为「账单在计息」。利息字段改由「还款时如实
            // 填写利息」驱动，详情接口再反推真实年化（见 debts.js GET /:id）。
            await conn.query(
                'UPDATE debts SET remaining = ?, monthly_payment = 0, min_payment = ?, interest_rate = 0, method = \'minimum\', status = \'active\' WHERE id = ?',
                [owes, minPmt, debt.id]
            );
        } else {
            await conn.query(
                `INSERT INTO debts (user_id, book_id, account_id, name, type, direction, creditor, principal, remaining, interest_rate, term_months, method, monthly_payment, billing_day, payment_day, min_payment, status, note)
                 VALUES (?, ?, ?, ?, ?, 'payable', ?, 0, ?, 0, 0, 'minimum', 0, 15, 5, ?, 'active', ?)`,
                [userId, bookId, accountId, account.name, debtType, account.name, owes, minPmt, syncNote]
            );
        }
    }
}

module.exports = {
    ensureCategory,
    syncCreditCardDebt,
    isCreditAccount,
    resolveNote
};
