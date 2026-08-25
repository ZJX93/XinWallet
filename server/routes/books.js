/* ============================================
   鑫钱包 · 多账本（账套）路由
   - 提供账本 CRUD / 切换默认账本 / 删除（数据迁移至默认账本）
   - 导出 resolveBookContext 中间件：为所有受保护路由解析「当前账本」req.bookId
   - 导出 ensureDefaultBook：为指定用户确保存在默认账本（供种子 / 自愈使用）
   ============================================ */

const express = require('express');
const db = require('../db');
const { success, handleServerError, ErrorCodes, failBadRequest, failNotFound, failValidation } = require('./_helpers');

const router = express.Router();

// 默认账本名称 / 图标 / 主题色
const DEFAULT_BOOK = { name: '默认账本', icon: '📒', color: '#6366f1' };

/**
 * 确保某用户存在「默认账本」。
 * - 已有默认账本 → 返回其 id
 * - 无任何账本 → 新建默认账本并返回其 id
 * - 有账本但无默认 → 将最早的一个标记为默认
 * 兼容事务内 conn（需支持 .query）与顶层 db。
 */
async function ensureDefaultBook(conn, userId) {
    const c = conn || db;
    const existing = await c.queryOne('SELECT id FROM books WHERE user_id = ? AND is_default = TRUE', [userId]);
    if (existing) return existing.id;
    const any = await c.queryOne('SELECT id FROM books WHERE user_id = ? ORDER BY id ASC LIMIT 1', [userId]);
    if (any) {
        await c.query('UPDATE books SET is_default = TRUE WHERE id = ?', [any.id]);
        return any.id;
    }
    const r = await c.query(
        'INSERT INTO books (user_id, name, icon, color, is_default) VALUES (?, ?, ?, ?, TRUE)',
        [userId, DEFAULT_BOOK.name, DEFAULT_BOOK.icon, DEFAULT_BOOK.color]
    );
    return r.insertId;
}

/**
 * 受保护路由通用中间件：解析「当前账本」并写入 req.bookId。
 * 解析优先级：
 *   1. 请求头 X-Book-Id（前端切换账本后携带），且必须属于当前用户
 *   2. 用户的默认账本（is_default = TRUE）
 *   3. 自动为该用户创建默认账本
 * 所有用户财务查询/写入都基于 req.bookId 实现账本隔离。
 */
async function resolveBookContext(req, res, next) {
    // 认证相关路由不经过账本解析
    if (req.path && req.path.startsWith('/auth')) return next();
    try {
        const headerBookId = req.header('X-Book-Id');
        let bookId = null;

        if (headerBookId) {
            const b = await db.queryOne(
                'SELECT id FROM books WHERE id = ? AND user_id = ?',
                [parseInt(headerBookId, 10), req.userId]
            );
            if (b) bookId = b.id;
        }
        if (!bookId) {
            const def = await db.queryOne(
                'SELECT id FROM books WHERE user_id = ? AND is_default = TRUE',
                [req.userId]
            );
            if (def) bookId = def.id;
        }
        if (!bookId) {
            bookId = await ensureDefaultBook(db, req.userId);
        }

        req.bookId = bookId;
        next();
    } catch (err) {
        // 账本解析失败不应阻断业务，退化为无账本过滤会影响隔离，故直接报错
        handleServerError(res, err, '解析当前账本');
    }
}

// 列表：返回当前用户全部账本，并标注 current
router.get('/', async (req, res) => {
    try {
        const books = await db.query(
            'SELECT id, name, icon, color, is_default, sort_order, created_at FROM books WHERE user_id = ? ORDER BY sort_order ASC, id ASC',
            [req.userId]
        );
        const list = books.map(b => ({
            ...b,
            is_current: b.id === req.bookId,
            created_at: b.created_at
        }));
        res.json(success({ books: list, current_book_id: req.bookId }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 新建账本
router.post('/', async (req, res) => {
    try {
        const { name, icon, color, set_default } = req.body;
        if (!name || !String(name).trim()) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('账本名称必填'));

        // 设定为默认时，需先清除其他默认
        if (set_default) {
            await db.query('UPDATE books SET is_default = FALSE WHERE user_id = ?', [req.userId]);
        }
        const r = await db.query(
            `INSERT INTO books (user_id, name, icon, color, is_default, sort_order)
             VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM books b WHERE user_id = ?))`,
            [req.userId, name.trim(), icon || DEFAULT_BOOK.icon, color || DEFAULT_BOOK.color, set_default ? true : false, req.userId]
        );
        // 若该用户此前没有任何账本，强制本账本为默认
        const cnt = await db.queryOne('SELECT COUNT(*) AS c FROM books WHERE user_id = ?', [req.userId]);
        if (parseInt(cnt.c) === 1) {
            await db.query('UPDATE books SET is_default = TRUE WHERE id = ?', [r.insertId]);
        }
        res.json(success({ id: r.insertId, is_default: set_default || parseInt(cnt.c) === 1 }, '账本已创建'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 更新账本（重命名 / 改图标颜色）
router.put('/:id', async (req, res) => {
    try {
        const { name, icon, color } = req.body;
        const id = parseInt(req.params.id, 10);
        const owner = await db.queryOne('SELECT id FROM books WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!owner) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('账本不存在'));

        const sets = [];
        const params = [];
        if (name !== undefined) { sets.push('name = ?'); params.push(String(name).trim()); }
        if (icon !== undefined) { sets.push('icon = ?'); params.push(icon); }
        if (color !== undefined) { sets.push('color = ?'); params.push(color); }
        if (sets.length === 0) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('没有要更新的字段'));
        params.push(id, req.userId);
        await db.query(`UPDATE books SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
        res.json(success(null, '账本已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 切换默认账本（置为 current）
router.post('/:id/switch', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const owner = await db.queryOne('SELECT id FROM books WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!owner) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('账本不存在'));
        await db.query('UPDATE books SET is_default = FALSE WHERE user_id = ?', [req.userId]);
        await db.query('UPDATE books SET is_default = TRUE WHERE id = ? AND user_id = ?', [id, req.userId]);
        res.json(success({ current_book_id: id }, '已切换到该账本'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 删除账本：将其全部数据迁移到「默认账本」后删除（禁止删除用户的最后一个账本）
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const owner = await db.queryOne('SELECT id FROM books WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!owner) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('账本不存在'));

        const count = await db.queryOne('SELECT COUNT(*) AS c FROM books WHERE user_id = ?', [req.userId]);
        if (parseInt(count.c) <= 1) {
            return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('至少保留一个账本，无法删除'));
        }

        // 目标账本 = 默认账本（优先）或任意其它账本
        let target = await db.queryOne('SELECT id FROM books WHERE user_id = ? AND is_default = TRUE AND id <> ?', [req.userId, id]);
        if (!target) target = await db.queryOne('SELECT id FROM books WHERE user_id = ? AND id <> ? ORDER BY id ASC LIMIT 1', [req.userId, id]);
        const targetId = target.id;

        await db.transaction(async (conn) => {
            // 被删账本相关的用户私有分类（user_id 非空）迁移到目标账本；系统分类(user_id IS NULL)不动
            await conn.query('UPDATE categories SET book_id = ? WHERE user_id = ? AND book_id = ?', [targetId, req.userId, id]);
            // 其余用户级数据按 user_id + book_id 整体迁移
            for (const t of ['accounts', 'transactions', 'transfers', 'budgets', 'tags', 'savings_goals', 'debts', 'debt_repayments', 'investments', 'investment_transactions', 'savings_transactions', 'investment_snapshots']) {
                await conn.query(`UPDATE ${t} SET book_id = ? WHERE user_id = ? AND book_id = ?`, [targetId, req.userId, id]);
            }
            // 若被删账本是默认，将目标账本设为默认
            await conn.query('UPDATE books SET is_default = TRUE WHERE id = ?', [targetId]);
            await conn.query('DELETE FROM books WHERE id = ? AND user_id = ?', [id, req.userId]);
        });

        res.json(success({ current_book_id: targetId }, '账本已删除，数据已并入默认账本'));
    } catch (err) {
        handleServerError(res, err);
    }
});

module.exports = {
    router,
    resolveBookContext,
    ensureDefaultBook
};
