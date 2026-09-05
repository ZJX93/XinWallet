const express = require('express');
const router = express.Router();

const db = require('../db');
const { success, fail, handleServerError, computeAccountBalance, enforceBalanceLimit, normDate } = require('./_helpers');
const { toAmount } = require('../validate');
const { ensureCategory } = require('./utils');

// 获取储蓄目标列表
router.get('/', async (req, res) => {
    try {
        // 多币种 P2-2e：SELECT 显式读 a.currency / sa.currency——current_amount 镜像账户余额，单 currency
        const goals = await db.query(
            `SELECT g.*, a.name as acc_name, a.icon as acc_icon, a.balance as acc_balance, a.currency as acc_currency,
                    sa.name as source_acc_name, sa.currency as source_currency
             FROM savings_goals g
             LEFT JOIN accounts a ON g.account_id = a.id
             LEFT JOIN accounts sa ON g.source_account_id = sa.id
             WHERE g.user_id = ? AND g.book_id = ? ORDER BY g.status, g.id`,
            [req.userId, req.bookId]
        );
        res.json(success(goals.map(g => {
            // 多币种 P2-2e：currency 跟随关联储蓄账户；无关联账户时默认 CNY
            const cur = g.acc_currency || 'CNY';
            return {
                ...g,
                target_amount: parseFloat(g.target_amount),
                // 关联真实账户时，current_amount 直接镜像该账户余额（single source of truth）
                current_amount: g.account_id ? parseFloat(g.acc_balance || 0) : parseFloat(g.current_amount || 0),
                currency: cur,
                source_account_id: g.source_account_id || null,
                source_acc_name: g.source_acc_name || null
            };
        })));
    } catch (err) { handleServerError(res, err); }
});

// 新增储蓄目标（必须关联一个真实账户作为储蓄账户，并指定默认来源账户）
router.post('/', async (req, res) => {
    try {
        const { name, target_amount, account_id, source_account_id, icon, note } = req.body;
        if (!name) return res.status(400).json(fail('目标名称必填'));
        const accId = account_id ? parseInt(account_id) : null;
        if (!accId) return res.status(400).json(fail('请选择储蓄账户'));
        const srcId = source_account_id ? parseInt(source_account_id) : null;
        if (!srcId) return res.status(400).json(fail('请选择来源账户'));
        if (srcId === accId) return res.status(400).json(fail('来源账户不能与储蓄账户相同'));
        const acc = await db.queryOne('SELECT id, balance FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!acc) return res.status(400).json(fail('储蓄账户不存在'));
        const src = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [srcId, req.userId, req.bookId]);
        if (!src) return res.status(400).json(fail('来源账户不存在'));
        const result = await db.query(
            `INSERT INTO savings_goals (user_id, book_id, name, target_amount, current_amount, account_id, source_account_id, icon, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, req.bookId, name, parseFloat(target_amount) || 0, parseFloat(acc.balance || 0), accId, srcId, icon || '🎯', note || '']
        );
        res.json(success({ id: result.insertId }, '储蓄目标已创建'));
    } catch (err) { handleServerError(res, err); }
});

// 更新储蓄目标（储蓄账户、来源账户必选）
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, target_amount, account_id, source_account_id, icon, note } = req.body;
        if (!name) return res.status(400).json(fail('目标名称必填'));
        const accId = account_id ? parseInt(account_id) : null;
        if (!accId) return res.status(400).json(fail('请选择储蓄账户'));
        const srcId = source_account_id ? parseInt(source_account_id) : null;
        if (!srcId) return res.status(400).json(fail('请选择来源账户'));
        if (srcId === accId) return res.status(400).json(fail('来源账户不能与储蓄账户相同'));
        const goal = await db.queryOne('SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!goal) return res.status(404).json(fail('储蓄目标不存在'));
        const acc = await db.queryOne('SELECT id, balance FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accId, req.userId, req.bookId]);
        if (!acc) return res.status(400).json(fail('储蓄账户不存在'));
        const src = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [srcId, req.userId, req.bookId]);
        if (!src) return res.status(400).json(fail('来源账户不存在'));
        await db.query(
            `UPDATE savings_goals SET name = ?, target_amount = ?, account_id = ?, source_account_id = ?, current_amount = ?, icon = ?, note = ? WHERE id = ? AND user_id = ? AND book_id = ?`,
            [name, parseFloat(target_amount) || 0, accId, srcId, parseFloat(acc.balance || 0), icon || '🎯', note || '', id, req.userId, req.bookId]
        );
        res.json(success(null, '储蓄目标已更新'));
    } catch (err) { handleServerError(res, err); }
});

// 存入目标：从来源账户转账到目标关联的储蓄账户（真实账户间转账）
router.post('/:id/allocate', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const amount = toAmount(req.body.amount);
        const srcId = req.body.account_id ? parseInt(req.body.account_id) : null;
        if (amount === null || amount <= 0) return res.status(400).json(fail('请输入有效金额'));
        if (!srcId) return res.status(400).json(fail('请选择来源账户'));
        const goal = await db.queryOne('SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!goal) return res.status(404).json(fail('目标不存在'));
        if (!goal.account_id) return res.status(400).json(fail('该目标未关联储蓄账户，无法存入'));
        if (srcId === goal.account_id) return res.status(400).json(fail('来源账户不能与储蓄账户相同'));
        const src = await db.queryOne('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [srcId, req.userId, req.bookId]);
        if (!src) return res.status(400).json(fail('来源账户不存在'));
        // 多币种 P2-2e：储蓄流水 currency 跟随储蓄账户币种（P2-2d 已加 savings_transactions.currency 列）
        const savAcc = await db.queryOne('SELECT id, currency FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?',
            [goal.account_id, req.userId, req.bookId]);
        const savCurrency = (savAcc && savAcc.currency) || 'CNY';
        await db.transaction(async (conn) => {
            const opDate = normDate();
            const catId = await ensureCategory(conn, req.userId, '储蓄存入', 'expense', '🏦');
            // 转账记录（来源 -> 储蓄账户）
            const tr = await conn.query(
                'INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, \'completed\')',
                [req.userId, req.bookId, srcId, goal.account_id, amount, `存入「${goal.name}」`, opDate]
            );
            const tid = tr.insertId;
            await conn.query(
                "INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id) VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)",
                [req.userId, req.bookId, srcId, catId, amount, `存入「${goal.name}」`, opDate, tid, srcId]
            );
            await conn.query(
                "INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id) VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)",
                [req.userId, req.bookId, goal.account_id, catId, amount, `存入「${goal.name}」`, opDate, tid, goal.account_id]
            );
            const srcBal = await computeAccountBalance(conn, req.userId, srcId, req.bookId);
            const savBal = await computeAccountBalance(conn, req.userId, goal.account_id, req.bookId);
            await enforceBalanceLimit(conn, req.userId, srcId, srcBal, req.bookId);
            await enforceBalanceLimit(conn, req.userId, goal.account_id, savBal, req.bookId);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [srcBal, srcId, req.userId, req.bookId]);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [savBal, goal.account_id, req.userId, req.bookId]);
            await conn.query('UPDATE savings_goals SET current_amount = ? WHERE id = ?', [savBal, id]);
            await conn.query('INSERT INTO savings_transactions (user_id, book_id, goal_id, account_id, type, amount, date, note, currency) VALUES (?, ?, ?, ?, \'deposit\', ?, ?, ?, ?)',
                [req.userId, req.bookId, id, srcId, amount, opDate, `存入「${goal.name}」`, savCurrency]);
        });
        res.json(success(null, '已存入目标'));
    } catch (err) { handleServerError(res, err); }
});

// 取回目标：从目标关联的储蓄账户转账到目标账户（真实账户间转账）
router.post('/:id/withdraw', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const amount = toAmount(req.body.amount);
        const destId = req.body.account_id ? parseInt(req.body.account_id) : null;
        if (amount === null || amount <= 0) return res.status(400).json(fail('请输入有效金额'));
        if (!destId) return res.status(400).json(fail('请选择目标账户'));
        const goal = await db.queryOne('SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!goal) return res.status(404).json(fail('目标不存在'));
        if (!goal.account_id) return res.status(400).json(fail('该目标未关联储蓄账户，无法取回'));
        if (destId === goal.account_id) return res.status(400).json(fail('目标账户不能与储蓄账户相同'));
        const sav = await db.queryOne('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [goal.account_id, req.userId, req.bookId]);
        if (!sav) return res.status(400).json(fail('储蓄账户不存在'));
        // 多币种 P2-2e：储蓄流水 currency 跟随储蓄账户币种（P2-2d 已加 savings_transactions.currency 列）
        const savCurrency = (sav && sav.currency) || 'CNY';
        await db.transaction(async (conn) => {
            const opDate = normDate();
            const catId = await ensureCategory(conn, req.userId, '储蓄取出', 'income', '🏦');
            // 转账记录（储蓄账户 -> 目标账户）
            const tr = await conn.query(
                'INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, \'completed\')',
                [req.userId, req.bookId, goal.account_id, destId, amount, `取回「${goal.name}」`, opDate]
            );
            const tid = tr.insertId;
            await conn.query(
                "INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id) VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)",
                [req.userId, req.bookId, goal.account_id, catId, amount, `取回「${goal.name}」`, opDate, tid, goal.account_id]
            );
            await conn.query(
                "INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id) VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)",
                [req.userId, req.bookId, destId, catId, amount, `取回「${goal.name}」`, opDate, tid, destId]
            );
            const savBal = await computeAccountBalance(conn, req.userId, goal.account_id, req.bookId);
            const destBal = await computeAccountBalance(conn, req.userId, destId, req.bookId);
            await enforceBalanceLimit(conn, req.userId, goal.account_id, savBal, req.bookId);
            await enforceBalanceLimit(conn, req.userId, destId, destBal, req.bookId);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [savBal, goal.account_id, req.userId, req.bookId]);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [destBal, destId, req.userId, req.bookId]);
            await conn.query('UPDATE savings_goals SET current_amount = ? WHERE id = ?', [savBal, id]);
            await conn.query('INSERT INTO savings_transactions (user_id, book_id, goal_id, account_id, type, amount, date, note, currency) VALUES (?, ?, ?, ?, \'withdraw\', ?, ?, ?, ?)',
                [req.userId, req.bookId, id, destId, amount, opDate, `取出「${goal.name}」`, savCurrency]);
        });
        res.json(success(null, '已取回'));
    } catch (err) { handleServerError(res, err); }
});

// 删除储蓄目标
router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM savings_goals WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
        res.json(success(null, '目标已删除'));
    } catch (err) { handleServerError(res, err); }
});

// 获取储蓄目标交易记录
router.get('/:id/transactions', async (req, res) => {
    try {
        const goal = await db.queryOne('SELECT id, name FROM savings_goals WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
        if (!goal) return res.status(404).json(fail('目标不存在'));
        // 多币种 P2-2e：SELECT 显式读 st.currency（流水表 P2-2d 加列）
        const transactions = await db.query(
            `SELECT st.type, st.amount, st.date, st.note, st.account_id, st.currency, a.name AS account_name
             FROM savings_transactions st
             LEFT JOIN accounts a ON st.account_id = a.id
             WHERE st.goal_id = ? AND st.user_id = ? AND st.book_id = ?
             ORDER BY st.date DESC, st.id DESC`,
            [req.params.id, req.userId, req.bookId]
        );
        // 多币种 P2-2e：summary 按 currency 累加得 breakdown；主货币按 amount 绝对值最大选
        const depositBreakdown = {};
        const withdrawBreakdown = {};
        transactions.forEach(t => {
            const cur = t.currency || 'CNY';
            const amt = parseFloat(t.amount);
            if (t.type === 'deposit') depositBreakdown[cur] = (depositBreakdown[cur] || 0) + amt;
            if (t.type === 'withdraw') withdrawBreakdown[cur] = (withdrawBreakdown[cur] || 0) + amt;
        });
        const pick = (bd) => Object.entries(bd).reduce((a, x) => Math.abs(x[1]) > Math.abs(bd[a] || 0) ? x[0] : a, 'CNY');
        const depositCur = pick(depositBreakdown);
        const withdrawCur = pick(withdrawBreakdown);
        const deposit = depositBreakdown[depositCur] || 0;
        const withdraw = withdrawBreakdown[withdrawCur] || 0;
        res.json(success({
            goal: { id: goal.id, name: goal.name },
            transactions: transactions.map(t => ({ ...t, amount: parseFloat(t.amount), currency: t.currency || 'CNY' })),
            summary: {
                deposit, withdraw, net: deposit - withdraw,
                currency: depositCur,
                depositBreakdown, withdrawBreakdown
            }
        }));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;
