/* ============================================
   对话会话管理：列表 / 新建 / 详情 / 改名 / 删除 / 消息分页
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
router.get('/conversations', async (req, res) => {
    try {
        const userId = req.userId;
        const { status = 'active', limit = 20, offset = 0 } = req.query;
        const rows = await aiModule.conversationService.getConversations(userId, {
            status,
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10),
        });
        res.json({ ok: true, conversations: rows });
    } catch (err) {
        handleServerError(res, err, '获取对话列表');
    }
});

// POST /ai/conversations  创建新对话
router.post('/conversations', async (req, res) => {
    try {
        const userId = req.userId;
        const { book_id, title, model_used } = req.body;
        const conv = await aiModule.conversationService.createConversation(userId, {
            bookId: book_id,
            title: title || '新对话',
            modelUsed: model_used || null,
        });
        res.status(201).json({ ok: true, conversation: conv });
    } catch (err) {
        handleServerError(res, err, '创建对话');
    }
});

// GET /ai/conversations/:id  获取单个对话
router.get('/conversations/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const id = parseInt(req.params.id, 10);
        const conv = await aiModule.conversationService.getConversation(userId, id);
        if (!conv) return res.status(404).json({ ok: false, error: '对话不存在' });
        res.json({ ok: true, conversation: conv });
    } catch (err) {
        handleServerError(res, err, '获取对话');
    }
});

// PATCH /ai/conversations/:id  更新对话标题
router.patch('/conversations/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const id = parseInt(req.params.id, 10);
        const { title } = req.body;
        if (!title) return res.status(400).json({ ok: false, error: 'title 必填' });
        await aiModule.conversationService.updateTitle(userId, id, title);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '更新对话标题');
    }
});

// DELETE /ai/conversations/:id  删除对话（级联删除消息）
router.delete('/conversations/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const id = parseInt(req.params.id, 10);
        await aiModule.conversationService.deleteConversation(userId, id);
        res.json({ ok: true });
    } catch (err) {
        handleServerError(res, err, '删除对话');
    }
});

/* ---------- Message 端点 ---------- */

// GET /ai/conversations/:id/messages  获取对话消息历史
router.get('/conversations/:id/messages', async (req, res) => {
    try {
        const userId = req.userId;
        const conversationId = parseInt(req.params.id, 10);
        const { limit = 50, before_id } = req.query;
        const rows = await aiModule.messageService.getMessages(userId, conversationId, {
            limit: parseInt(limit, 10),
            beforeId: before_id ? parseInt(before_id, 10) : null,
        });
        res.json({ ok: true, messages: rows });
    } catch (err) {
        handleServerError(res, err, '获取消息历史');
    }
});

/* ---------- Profile 端点 ---------- */

module.exports = router;
