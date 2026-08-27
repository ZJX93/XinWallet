const express = require('express');
const router = express.Router();
const db = require('../db');
const { toNumber } = require('../validate');
const {
    success, handleServerError, computeAccountBalance, enforceBalanceLimit,
    ErrorCodes, failValidation, failNotFound, failBadRequest, failConflict
} = require('./_helpers');
const { ensureCategory } = require('./utils');

// 业务错误 → HTTP code 智能映射（用于 catch 块）
// 仅白名单的已知业务错误使用 err.message；未识别错误统一返回通用提示，避免泄露数据库堆栈/内部细节
function classifyError(err) {
    const msg = err.message || '';
    if (msg.includes('余额不能低于') || msg.includes('余额不足')) return failConflict(msg); // 409（余额下限）
    if (msg.includes('账户不存在')) return failNotFound(msg);            // 404
    if (msg.includes('金额')) return failValidation(msg);                // 422
    // 未识别的错误：记录到控制台，但对外不暴露原始消息
    console.error('[transfer] 未分类错误:', err);
    return failBadRequest('操作失败，请稍后重试');
}

// ==========================================
// 转账路由（错误码语义化版本）
// ==========================================

// 获取转账记录
router.get('/', async (req, res) => {
    try {
        const { month } = req.query;
        let sql = `SELECT t.*,
      a1.name as from_name, a1.icon as from_icon, a1.type as from_type,
      a2.name as to_name, a2.icon as to_icon, a2.type as to_type
      FROM transfers t
      LEFT JOIN accounts a1 ON t.from_account_id = a1.id
      LEFT JOIN accounts a2 ON t.to_account_id = a2.id
      WHERE t.user_id = ? AND t.book_id = ?`;
        const params = [req.userId, req.bookId];

        if (month) {
            sql += ' AND CAST(t.date AS CHAR(10)) LIKE ?';
            params.push(month + '%');
        }

        sql += ' ORDER BY t.date DESC, t.id DESC';

        const transfers = await db.query(sql, params);
        res.json(success(transfers));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 执行转账
router.post('/', async (req, res) => {
    try {
        const { from_account_id, to_account_id, amount, note, date } = req.body;

        const amountNum = toNumber(amount);
        // 参数缺失 → 400（请求格式错误）
        if (!from_account_id || !to_account_id) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('请选择转出和转入账户'));
        // 账户相同 → 422（业务规则不允许）
        if (from_account_id === to_account_id) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('转出和转入账户不能相同'));
        // 金额非法 → 422（业务校验）
        if (amountNum === null || amountNum <= 0) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('请输入有效金额'));

        const transferDate = date || new Date().toISOString().replace('T', ' ').slice(0, 19);

        // 使用事务确保一致性
        const result = await db.transaction(async (conn) => {
            // 检查转出账户
            const fromAcc = await conn.query('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [from_account_id, req.userId, req.bookId]);
            if (!fromAcc[0]) throw new Error('转出账户不存在');

            // 转账分类兜底：优先复用种子「一般转账」(id=22, type=transfer)，缺失则自动创建，避免硬编码 category_id
            const transferCatId = await ensureCategory(conn, req.userId, '一般转账', 'transfer', '🏦');

            // 创建转账记录
            const insertResult = await conn.query(
                `INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
                [req.userId, req.bookId, from_account_id, to_account_id, amountNum, note || '', transferDate]
            );

            // 转入账户名必须在插 out 腿之前拿到 —— out 腿备注写的是「转账至<对方>」，
            // 需要的是转入账户名。原先这行在 out 腿之后，只能拿自己的名字凑。
            // 同时补上 user_id / book_id 过滤：原先只按 id 查，跨账本的账户 id 也能命中。
            const toAcc = await conn.query('SELECT name FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [to_account_id, req.userId, req.bookId]);
            if (!toAcc[0]) throw new Error('转入账户不存在');

            // 余额由账本推导（复式记账 single source of truth）
            //
            // 备注拼接规则（曾经写反过，不要再改回去）：
            //   out 腿挂在「转出账户」名下 → 描述钱去哪了 → 转账至 + toAcc（对方）
            //   in  腿挂在「转入账户」名下 → 描述钱从哪来 → 来自   + fromAcc（对方）
            // 原先两处填的都是账户自己的名字，于是「工资卡 → 余额宝」的转出腿
            // 显示成「转账至工资卡」，方向完全颠倒。
            //
            // 用户填了 note 就以用户的为准：主表 transfers.note 一直存的是用户原文，
            // 但两条腿原先无条件覆盖成系统文案，导致用户备注在流水列表里根本看不到。
            const userNote = (note || '').trim();
            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
         VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
                [req.userId, req.bookId, from_account_id, transferCatId, amountNum, userNote || `转账至${toAcc[0].name}`, transferDate, insertResult.insertId, from_account_id]
            );

            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
         VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
                [req.userId, req.bookId, to_account_id, transferCatId, amountNum, userNote || `来自${fromAcc[0].name}`, transferDate, insertResult.insertId, to_account_id]
            );

            const fromBal = await computeAccountBalance(conn, req.userId, from_account_id);
            const toBal = await computeAccountBalance(conn, req.userId, to_account_id);
            await enforceBalanceLimit(conn, req.userId, from_account_id, fromBal);
            await enforceBalanceLimit(conn, req.userId, to_account_id, toBal);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [fromBal, from_account_id]);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [toBal, to_account_id]);

            return insertResult.insertId;
        });

        res.json(success({ id: result }, '转账成功'));
    } catch (err) {
        // 智能分类：业务错误返回正确状态码
        const errRes = classifyError(err);
        res.status(errRes.code).json(errRes);
    }
});

// 修改转账
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { from_account_id, to_account_id, amount, note, date } = req.body;

        const amountNum = toNumber(amount);
        if (!from_account_id || !to_account_id) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('请选择转出和转入账户'));
        if (from_account_id === to_account_id) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('转出和转入账户不能相同'));
        if (amountNum === null || amountNum <= 0) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('请输入有效金额'));

        const old = await db.queryOne('SELECT * FROM transfers WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!old) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('转账记录不存在'));

        const transferDate = date || old.date;
        const affectedAccounts = new Set([old.from_account_id, old.to_account_id, from_account_id, to_account_id]);

        await db.transaction(async (conn) => {
            // 转账分类兜底（同 post 路由）
            const transferCatId = await ensureCategory(conn, req.userId, '一般转账', 'transfer', '🏦');
            await conn.query(
                `UPDATE transfers SET from_account_id=?, to_account_id=?, amount=?, note=?, date=? WHERE id=? AND user_id = ? AND book_id = ?`,
                [from_account_id, to_account_id, amountNum, note || '', transferDate, id, req.userId, req.bookId]
            );

            await conn.query('DELETE FROM transactions WHERE transfer_id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);

            // 两个账户名都要在插腿之前拿到，且必须带 user_id / book_id 过滤 ——
            // 原先只按 id 查，能读到别人账本的账户名。
            const fromAcc = await conn.query('SELECT name FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [from_account_id, req.userId, req.bookId]);
            if (!fromAcc[0]) throw new Error('转出账户不存在');
            const toAcc = await conn.query('SELECT name FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [to_account_id, req.userId, req.bookId]);
            if (!toAcc[0]) throw new Error('转入账户不存在');

            // 备注规则与 POST 完全一致（见该处注释）：
            //   out 腿 → 转账至 + toAcc（对方），in 腿 → 来自 + fromAcc（对方）
            //   用户填了 note 就用用户的，别拿系统文案盖掉
            // 原先两处都填账户自己的名字，方向是反的。
            const userNote = (note || '').trim();
            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
         VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
                [req.userId, req.bookId, from_account_id, transferCatId, amountNum, userNote || `转账至${toAcc[0].name}`, transferDate, id, from_account_id]
            );

            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
         VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
                [req.userId, req.bookId, to_account_id, transferCatId, amountNum, userNote || `来自${fromAcc[0].name}`, transferDate, id, to_account_id]
            );

            const newBalances = {};
            for (const aid of affectedAccounts) {
                newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
            }
            for (const aid of affectedAccounts) {
                await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
            }
            for (const aid of affectedAccounts) {
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalances[aid], aid]);
            }
        });

        res.json(success(null, '转账已更新'));
    } catch (err) {
        const errRes = classifyError(err);
        res.status(errRes.code).json(errRes);
    }
});

// 删除转账
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const transfer = await db.queryOne('SELECT * FROM transfers WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!transfer) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('转账记录不存在'));

        await db.transaction(async (conn) => {
            await conn.query('DELETE FROM transactions WHERE transfer_id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
            await conn.query('DELETE FROM transfers WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
            const fromBal = await computeAccountBalance(conn, req.userId, transfer.from_account_id);
            const toBal = await computeAccountBalance(conn, req.userId, transfer.to_account_id);
            await enforceBalanceLimit(conn, req.userId, transfer.from_account_id, fromBal);
            await enforceBalanceLimit(conn, req.userId, transfer.to_account_id, toBal);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [fromBal, transfer.from_account_id]);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [toBal, transfer.to_account_id]);
        });

        res.json(success(null, '转账已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

module.exports = router;
