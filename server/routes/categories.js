const express = require('express');
const router = express.Router();

const db = require('../db');
const { success, fail, handleServerError } = require('./_helpers');

// 获取分类列表
router.get('/', async (req, res) => {
    try {
        const { type, flat } = req.query;
        // 多账本隔离：返回「系统预设(全局) + 用户级共享(book_id IS NULL) + 当前账本专属」分类
        const params = [req.userId, req.bookId];
        let where = 'WHERE (c.user_id IS NULL OR (c.user_id = ? AND (c.book_id IS NULL OR c.book_id = ?)))';
        if (type) { where += ' AND c.type = ?'; params.push(type); }

        // 排序规则（顶级位置必须由 sort_order 决定，而非自增 id）：
        //   1. type            —— expense / income / transfer 分组，保持既有展示顺序
        //   2. 父级 sort_order  —— 顶级分类自身，或子分类所属父级的 sort_order
        //   3. 父级 id          —— sort_order 相同时的稳定兜底，保证父子不被拆散
        //   4. 是否子分类       —— FALSE(父) 排在 TRUE(子) 之前
        //   5. 自身 sort_order / id —— 同一父级下的子分类顺序
        const rows = await db.query(
            `SELECT c.*
               FROM categories c
               LEFT JOIN categories p ON p.id = c.parent_id
             ${where}
              ORDER BY c.type,
                       COALESCE(p.sort_order, c.sort_order),
                       COALESCE(c.parent_id, c.id),
                       (c.parent_id IS NOT NULL),
                       c.sort_order,
                       c.id`,
            params
        );

        // flat 参数：返回扁平列表（交易表单等场景）
        if (flat === '1') return res.json(success(rows));

        // 树形结构
        const map = {};
        const tree = [];
        rows.forEach(c => { c.children = []; map[c.id] = c; });
        rows.forEach(c => {
            if (c.parent_id && map[c.parent_id]) {
                map[c.parent_id].children.push(c);
            } else {
                tree.push(c);
            }
        });
        res.json(success({ tree, flat: rows }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 新增分类（归属当前用户）
router.post('/', async (req, res) => {
    try {
        const { parent_id, name, icon, type, color } = req.body;
        if (!name || !type) return res.status(400).json(fail('名称和类型必填'));
        // 预检查：schema 有 UNIQUE(parent_id, name)，同父下重名直接返 400 友好提示，避免 500
        const dup = parent_id == null
            ? await db.queryOne('SELECT id FROM categories WHERE parent_id IS NULL AND name = ?', [name])
            : await db.queryOne('SELECT id FROM categories WHERE parent_id = ? AND name = ?', [parent_id, name]);
        if (dup) return res.status(400).json(fail(`该分类下已存在同名分类「${name}」`));
        const TYPE_COLOR = { expense: '#22c55e', income: '#ef4444', transfer: '#3b82f6' };
        const defaultColor = TYPE_COLOR[type] || '#6366f1';
        // PG prepared statement 无法对参数做 IS NULL 类型推断，按 parent_id 是否 null 在 JS 分支拆 SQL
        const maxSort = parent_id == null
            ? await db.queryOne(
                'SELECT COALESCE(MAX(sort_order),0)+1 as n FROM categories WHERE type = ? AND parent_id IS NULL AND (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))',
                [type, req.userId, req.bookId]
              )
            : await db.queryOne(
                'SELECT COALESCE(MAX(sort_order),0)+1 as n FROM categories WHERE type = ? AND parent_id = ? AND (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))',
                [type, parent_id, req.userId, req.bookId]
              );
        const result = await db.query(
            'INSERT INTO categories (parent_id, user_id, book_id, name, icon, type, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)',
            [parent_id || null, req.userId, req.bookId, name, icon || '📌', type, color || defaultColor, maxSort.n]
        );
        res.json(success({ id: result.insertId }, '分类已创建'));
    } catch (err) { handleServerError(res, err); }
});

// 更新分类（仅允许编辑当前用户的私有分类）
router.put('/:id', async (req, res) => {
    try {
        const { parent_id, name, icon, type, color, sort_order } = req.body;
        // 检查权限：必须是当前用户的私有分类（系统预设不允许修改）
        const owner = await db.queryOne('SELECT user_id FROM categories WHERE id = ?', [req.params.id]);
        if (!owner) return res.status(404).json(fail('分类不存在'));
        // 允许登录用户改预置全局分类（user_id IS NULL）；仅阻止改他人私有分类
        if (owner.user_id !== null && owner.user_id !== req.userId) {
            return res.status(403).json(fail('无权修改该分类'));
        }
        await db.query(
            'UPDATE categories SET parent_id = ?, name = ?, icon = ?, type = ?, color = ?, sort_order = ? WHERE id = ?',
            [parent_id || null, name, icon, type, color, sort_order, req.params.id]
        );
        res.json(success(null, '分类已更新'));
    } catch (err) { handleServerError(res, err); }
});

// 删除分类（仅当前用户的私有分类可删）
router.delete('/:id', async (req, res) => {
    try {
        const owner = await db.queryOne('SELECT user_id FROM categories WHERE id = ?', [req.params.id]);
        if (!owner) return res.status(404).json(fail('分类不存在'));
        // 允许登录用户删预置全局分类（user_id IS NULL）；仅阻止删他人私有分类
        if (owner.user_id !== null && owner.user_id !== req.userId) {
            return res.status(403).json(fail('无权删除该分类'));
        }
        const used = await db.queryOne('SELECT COUNT(*) as cnt FROM transactions WHERE category_id = ?', [req.params.id]);
        if (used && used.cnt > 0) return res.status(400).json(fail('该分类下有交易记录，无法删除'));
        const hasChildren = await db.queryOne('SELECT COUNT(*) as cnt FROM categories WHERE parent_id = ?', [req.params.id]);
        if (hasChildren && hasChildren.cnt > 0) return res.status(400).json(fail('该分类下有子分类，请先删除子分类'));
        await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json(success(null, '分类已删除'));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;
