/* ============================================
   鑫钱包 · 账户与对账路由
   ============================================ */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { success, fail, handleServerError, sumLedgerEffects, computeAccountBalance, fmtDateTime, sumAmounts, addAmounts, subtractAmounts, ErrorCodes, failValidation, failNotFound } = require('./_helpers');
const { syncCreditCardDebt } = require('./utils');

// 获取所有账户。默认只返回正常账户；?all=1 时连已销户账户一起返回（总资产仍只累计正常账户）
router.get('/', async (req, res) => {
    try {
        const all = req.query.all === '1' || req.query.all === 'true';
        const accounts = all
            ? await db.query('SELECT * FROM accounts WHERE user_id = ? AND book_id = ? ORDER BY sort_order', [req.userId, req.bookId])
            : await db.query('SELECT * FROM accounts WHERE user_id = ? AND book_id = ? AND status = \'active\' ORDER BY sort_order', [req.userId, req.bookId]);
        // 金额精度（M3）：整数分累加，避免多账户浮点求和产生分位漂移
        const total = sumAmounts(accounts.filter(a => a.status !== 'closed'), a => a.balance || 0);
        res.json(success({ accounts, totalAssets: total }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 解析并校验信用额度
function resolveCreditLimit(type, credit_limit, existingLimit = 0) {
    const raw = parseFloat(credit_limit);
    if (type === 'credit_card') {
        if (isNaN(raw) || raw <= 0) return { ok: false, msg: '信用卡必须设置大于 0 的信用额度' };
        return { ok: true, limit: raw };
    }
    if (type === 'electronic_payment') {
        return { ok: true, limit: isNaN(raw) ? Math.max(0, existingLimit) : Math.max(0, raw) };
    }
    return { ok: true, limit: 0 };
}

// 新增账户
router.post('/', async (req, res) => {
    try {
        const { name, type, icon, balance, opening_balance, credit_limit, annual_rate, interest_cycle } = req.body;
        if (!name || !type) return res.status(400).json(fail('名称和类型必填'));

        const limitRes = resolveCreditLimit(type, credit_limit);
        if (!limitRes.ok) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation(limitRes.msg));

        // 以 opening_balance 为基准；兼容旧客户端仍传 balance 的情况
        const initialOpening = parseFloat(opening_balance !== undefined ? opening_balance : balance) || 0;
        if (initialOpening < -limitRes.limit - 0.005) {
            return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation(`初始余额不能低于 -${limitRes.limit.toFixed(2)}`));
        }

        const result = await db.query(
            `INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, credit_limit, annual_rate, interest_cycle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, req.bookId, name, type, icon || '💰', initialOpening, initialOpening, limitRes.limit,
             parseFloat(annual_rate) || 0, interest_cycle || 'monthly']
        );
        res.json(success({ id: result.insertId, balance: initialOpening, opening_balance: initialOpening, credit_limit: limitRes.limit }, '账户已创建'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 更新账户
router.put('/:id', async (req, res) => {
    try {
        const { name, type, icon, balance, opening_balance, credit_limit, annual_rate, interest_cycle } = req.body;
        const id = parseInt(req.params.id);

        const existing = await db.queryOne('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!existing) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('账户不存在'));

        const limitRes = resolveCreditLimit(type, credit_limit, parseFloat(existing.credit_limit) || 0);
        if (!limitRes.ok) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation(limitRes.msg));

        // 用户编辑的是「初始余额」，实时余额由账本流水动态算出
        const newOpening = parseFloat(opening_balance !== undefined ? opening_balance : balance) || 0;
        const effects = await sumLedgerEffects(db, req.userId, id);
        // 金额精度（M3）：newBalance 是展示给用户的实时余额，用整数分精确加法
        const newBalance = addAmounts(newOpening, effects);
        if (newBalance < -limitRes.limit - 0.005) {
            return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation(`调整后期初余额与流水将导致余额低于 -${limitRes.limit.toFixed(2)}`));
        }

        await db.query(
            `UPDATE accounts SET name=?, type=?, icon=?, balance=?, opening_balance=?, credit_limit=?, annual_rate=?, interest_cycle=? WHERE id=? AND user_id=? AND book_id=?`,
            [name, type, icon, newBalance, newOpening, limitRes.limit,
             parseFloat(annual_rate) || 0, interest_cycle || 'monthly', id, req.userId, req.bookId]
        );
        // 改额度 / 改类型后，授信账户（信用卡 + 带额度的电子支付）的已用额度可能变化，
        // 同步一次债务，避免存量负余额一直进不了债务管理
        await syncCreditCardDebt(db, req.userId, id);
        res.json(success({ balance: newBalance, opening_balance: newOpening, credit_limit: limitRes.limit }, '账户已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 查询账户的关联数据量（用于「彻底删除」前的可行性判断）
router.get('/:id/usage', async (req, res) => {
    try {
        const accId = parseInt(req.params.id);
        if (!accId) return res.status(400).json(fail('账户ID无效'));
        const accExists = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!accExists) return res.status(404).json(fail('账户不存在'));
        const row = await db.queryOne(
            `SELECT
                (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND (account_id = ? OR source_account_id = ? OR destination_account_id = ?)) AS transactions,
                (SELECT COUNT(*) FROM transfers WHERE user_id = ? AND (from_account_id = ? OR to_account_id = ?)) AS transfers,
                (SELECT COUNT(*) FROM debt_repayments WHERE user_id = ? AND account_id = ?) AS repayments,
                (SELECT COUNT(*) FROM savings_goals WHERE user_id = ? AND (account_id = ? OR source_account_id = ?)) AS goals,
                (SELECT COUNT(*) FROM savings_transactions WHERE user_id = ? AND account_id = ?) AS savings_txns,
                (SELECT COUNT(*) FROM debts WHERE user_id = ? AND account_id = ?) AS debts,
                (SELECT COUNT(*) FROM investments WHERE user_id = ? AND account_id = ?) AS investments`,
            [req.userId, accId, accId, accId, req.userId, accId, accId, req.userId, accId, req.userId, accId, accId, req.userId, accId, req.userId, accId, req.userId, accId]
        );
        const total = Object.values(row || {}).reduce((s, v) => s + parseInt(v || 0), 0);
        res.json(success({ usage: row, total }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 关闭账户（软删除，保留历史，仅从列表隐藏）
router.post('/:id/close', async (req, res) => {
    try {
        await db.query(
            'UPDATE accounts SET status = \'closed\' WHERE id = ? AND user_id = ? AND book_id = ?',
            [req.params.id, req.userId, req.bookId]
        );
        res.json(success(null, '账户已关闭'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 记一笔账户利息（与理财产品计息同构：记一笔 income 交易 + 重算余额）
// 利息金额由用户手填（与理财产品一致）；账户年利率/周期字段仅作展示与「预计利息」估算。
router.post('/:id/interest', async (req, res) => {
    try {
        const accId = parseInt(req.params.id);
        if (!accId) return res.status(400).json(fail('账户ID无效'));
        const { amount, date, note } = req.body || {};
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) return res.status(400).json(fail('利息金额必须大于 0'));
        const acc = await db.queryOne('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!acc) return res.status(404).json(failNotFound('账户不存在'));
        // 计息日期精确到秒，与 transactions.date 同格式（YYYY-MM-DD HH:MM:SS）。
        // 早期实现用 slice(0,10) 截到天，导致 DB(DATE) 与回显都丢失时分秒。
        const interestDate = date
          ? String(date).replace('T', ' ').slice(0, 19)
          : new Date().toISOString().replace('T', ' ').slice(0, 19);
        let newBalance;
        await db.transaction(async (conn) => {
            const catId = await getInterestCategoryId(conn);
            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, link_type, link_id)
                 VALUES (?, ?, ?, ?, 'income', ?, ?, ?, 'account_interest', ?)`,
                [req.userId, req.bookId, accId, catId, amt,
                 note ? `利息-${acc.name}-${note}` : `利息-${acc.name}`, interestDate, accId]
            );
            newBalance = await computeAccountBalance(conn, req.userId, accId);
            await conn.query('UPDATE accounts SET balance = ?, last_interest_date = ? WHERE id = ? AND user_id = ? AND book_id = ?', [newBalance, interestDate, accId, req.userId, req.bookId]);
        });
        res.json(success({ balance: newBalance, last_interest_date: interestDate }, '利息已记录'));
    } catch (err) { handleServerError(res, err); }
});

// 利息入账分类：优先「分红利息」（被动收入下的银行/账户计息），缺失时回退第一个收入分类
async function getInterestCategoryId(conn) {
    const rows = await conn.query('SELECT id FROM categories WHERE name = ? AND type = ?', ['分红利息', 'income']);
    if (rows[0]) return rows[0].id;
    const any = await conn.query('SELECT id FROM categories WHERE type = ? ORDER BY id LIMIT 1', ['income']);
    return any[0] ? any[0].id : null;
}

// 彻底删除账户（仅在无关联数据时可执行）
router.delete('/:id', async (req, res) => {
    try {
        const accId = parseInt(req.params.id);
        if (!accId) return res.status(400).json(fail('账户ID无效'));
        const acc = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!acc) return res.status(404).json(fail('账户不存在'));

        // 关联检查：任一表有记录即拒绝彻底删除
        const row = await db.queryOne(
            `SELECT
                (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND (account_id = ? OR source_account_id = ? OR destination_account_id = ?)) AS transactions,
                (SELECT COUNT(*) FROM transfers WHERE user_id = ? AND (from_account_id = ? OR to_account_id = ?)) AS transfers,
                (SELECT COUNT(*) FROM debt_repayments WHERE user_id = ? AND account_id = ?) AS repayments,
                (SELECT COUNT(*) FROM savings_goals WHERE user_id = ? AND (account_id = ? OR source_account_id = ?)) AS goals,
                (SELECT COUNT(*) FROM savings_transactions WHERE user_id = ? AND account_id = ?) AS savings_txns,
                (SELECT COUNT(*) FROM debts WHERE user_id = ? AND account_id = ?) AS debts,
                (SELECT COUNT(*) FROM investments WHERE user_id = ? AND account_id = ?) AS investments`,
            [req.userId, accId, accId, accId, req.userId, accId, accId, req.userId, accId, req.userId, accId, accId, req.userId, accId, req.userId, accId, req.userId, accId]
        );
        const parts = [
            ['交易', row.transactions], ['转账', row.transfers], ['还款', row.repayments],
            ['储蓄目标', row.goals], ['储蓄流水', row.savings_txns], ['债务', row.debts], ['理财持仓', row.investments]
        ].filter(([, n]) => parseInt(n) > 0);
        const total = parts.reduce((s, [, n]) => s + parseInt(n), 0);

        if (total > 0) {
            const detail = parts.map(([label, n]) => `${label} ${n} 笔`).join('、');
            return res.status(409).json(fail(`该账户存在关联数据（${detail}），无法彻底删除。请先清理相关记录，或使用「关闭账户」保留历史。`));
        }

        await db.query('DELETE FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        res.json(success(null, '账户已彻底删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 复式记账对账
router.post('/reconcile', async (req, res) => {
    try {
        const accounts = await db.query(
            "SELECT id, name, balance FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active'",
            [req.userId, req.bookId]
        );
        let fixed = 0;
        const diffs = [];
        for (const acc of accounts) {
            const computed = await computeAccountBalance(db, req.userId, acc.id);
            const stored = parseFloat(acc.balance);
            if (Math.abs(computed - stored) > 0.005) {
                await db.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [computed, acc.id, req.userId, req.bookId]);
                fixed++;
                // 金额精度（M3）：差额先收集，最后整数分求和，避免逐次浮点累加
                diffs.push(subtractAmounts(computed, stored));
            }
        }
        res.json(success(
            { reconciled: fixed, totalAdjusted: sumAmounts(diffs) },
            fixed > 0 ? `已对账，修正 ${fixed} 个账户余额` : '账户余额与账本一致，无需修正'
        ));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 账户资金明细（全部资金变动流水：收入/支出/转账/还款）
router.get('/:id/transactions', async (req, res) => {
    try {
        const accId = parseInt(req.params.id);
        if (!accId) return res.status(400).json(fail('账户ID无效'));
        const acc = await db.queryOne('SELECT id, name, icon, type FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!acc) return res.status(404).json(fail('账户不存在'));
        const lim = Math.min(parseInt(req.query.limit) || 200, 1000);
        const off = parseInt(req.query.offset) || 0;

        // 1) 关联该账户的交易（收入/支出/转账，account_id 即展示账户）
        const txns = await db.query(
            `SELECT t.id, t.type, t.amount, t.note, t.date, t.link_type, t.link_id,
                    c.id as cat_id, c.name as cat_name, c.icon as cat_icon,
                    tr.from_account_id as tr_from, tr.to_account_id as tr_to,
                    fa.name as tr_from_name, fa.icon as tr_from_icon,
                    ta.name as tr_to_name, ta.icon as tr_to_icon
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN transfers tr ON t.transfer_id = tr.id
             LEFT JOIN accounts fa ON tr.from_account_id = fa.id
             LEFT JOIN accounts ta ON tr.to_account_id = ta.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.account_id = ?
             ORDER BY t.date DESC, t.id DESC
             LIMIT ? OFFSET ?`,
            [req.userId, req.bookId, accId, lim, off]
        );

        // 2) 该账户作为还款来源的还款流水
        // 去重：跨账户/单腿还款的「付款账户」侧，transactions 表已有一笔 transfer_out 或 expense
        // 作为资金变动条目（带 note=还款·XXX），若再把 debt_repayments 这条也并入显示，
        // 同一笔还款会被计为两笔变动。这里排除「对应 transaction 腿已落在本账户」的还款记录。
        // 收款账户（债务关联账户）的 debt_repayments.account_id 永远是付款账户，本来就不会
        // 出现在这里，所以这个去重只对付款账户生效。
        const reps = await db.query(
            `SELECT r.id, r.amount, r.principal_part, r.interest_part, r.note, r.paid_at,
                    d.name as debt_name, ('💳') as debt_icon
             FROM debt_repayments r
             LEFT JOIN debts d ON r.debt_id = d.id
             WHERE r.user_id = ? AND r.book_id = ? AND r.account_id = ?
               AND r.transaction_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM transactions t
                   WHERE t.id = r.transaction_id AND t.account_id = r.account_id
               )
             ORDER BY r.paid_at DESC, r.id DESC
             LIMIT ? OFFSET ?`,
            [req.userId, req.bookId, accId, lim, off]
        );

        const items = [
            ...txns.map(t => ({
                kind: 'transaction',
                id: t.id,
                type: t.type,
                amount: parseFloat(t.amount),
                date: fmtDateTime(t.date),
                note: t.note || '',
                category: (t.cat_name || t.cat_icon) ? { name: t.cat_name, icon: t.cat_icon } : null,
                category_id: t.cat_id || null,
                counterparty: t.type === 'transfer_out'
                    ? (t.tr_to_name ? { dir: '→', name: t.tr_to_name, icon: t.tr_to_icon } : null)
                    : t.type === 'transfer_in'
                    ? (t.tr_from_name ? { dir: '←', name: t.tr_from_name, icon: t.tr_from_icon } : null)
                    : null,
                link_type: t.link_type || null,
                debt: null
            })),
            ...reps.map(r => ({
                kind: 'repayment',
                id: r.id,
                type: 'repayment',
                amount: parseFloat(r.amount),
                date: fmtDateTime(r.paid_at),
                note: r.note || '',
                category: null,
                counterparty: null,
                debt: { name: r.debt_name, icon: r.debt_icon }
            }))
        ];
        // 合并后整体按时间倒序
        items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        res.json(success({
            account: { id: acc.id, name: acc.name, icon: acc.icon, type: acc.type },
            transactions: items,
            count: items.length
        }));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;
