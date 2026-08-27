const express = require('express');
const router = express.Router();

const db = require('../db');
const { success, fail, handleServerError } = require('./_helpers');

// 获取标签列表
router.get('/', async (req, res) => {
    try {
        const tags = await db.query('SELECT * FROM tags WHERE user_id = ? AND book_id = ? ORDER BY id', [req.userId, req.bookId]);
        res.json(success(tags));
    } catch (err) { handleServerError(res, err); }
});

// 新增标签
router.post('/', async (req, res) => {
    try {
        const { name, color, icon } = req.body;
        if (!name) return res.status(400).json(fail('标签名必填'));
        const result = await db.query(
            'INSERT INTO tags (user_id, book_id, name, color, icon) VALUES (?, ?, ?, ?, ?)',
            [req.userId, req.bookId, name, color || '#3b82f6', icon || '🏷️']
        );
        res.json(success({ id: result.insertId }, '标签已创建'));
    } catch (err) { handleServerError(res, err); }
});

// 更新标签
router.put('/:id', async (req, res) => {
    try {
        const { name, color, icon } = req.body;
        await db.query('UPDATE tags SET name = ?, color = ?, icon = ? WHERE id = ? AND user_id = ? AND book_id = ?',
            [name?.trim(), color, icon, req.params.id, req.userId, req.bookId]);
        res.json(success(null, '标签已更新'));
    } catch (err) { handleServerError(res, err); }
});

// 删除标签
router.delete('/:id', async (req, res) => {
    try {
        // transaction_tags 无 user_id 列，经 tags 表归属校验，仅删除当前用户本账本的标签关联
        await db.query(
            'DELETE FROM transaction_tags WHERE tag_id = ? AND tag_id IN (SELECT id FROM tags WHERE user_id = ? AND book_id = ?)',
            [req.params.id, req.userId, req.bookId]
        );
        await db.query('DELETE FROM tags WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
        res.json(success(null, '标签已删除'));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;
