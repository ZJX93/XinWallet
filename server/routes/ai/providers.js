/* ============================================
   AI 服务商管理：列表 / 新增 / 修改 / 删除 / 启用 / 连通性测试
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, encrypt, decrypt, success, fail, handleServerError, maskKey, callProvider } = require('./_shared');
const router = express.Router();
function validateProvider(body) {
    const { name, api_type, base_url, model } = body || {};
    if (!name || !name.trim()) return '名称必填';
    if (!api_type || !['openai', 'anthropic'].includes(api_type)) return '接口类型必须是 openai 或 anthropic';
    if (!base_url || !base_url.trim()) return '接口地址必填';
    if (!model || !model.trim()) return '模型名必填';
    return null;
}

// 获取服务商列表
router.get('/providers', async (req, res) => {
    try {
        const rows = await db.query('SELECT id, user_id, name, api_type, base_url, api_key, model, is_active, sort_order, created_at FROM ai_providers WHERE user_id = ? ORDER BY sort_order, id', [req.userId]);
        res.json(success({
            providers: rows.map(r => ({
                id: r.id, name: r.name, api_type: r.api_type, base_url: r.base_url,
                model: r.model, is_active: !!r.is_active, sort_order: r.sort_order,
                api_key: maskKey(decrypt(r.api_key))
            }))
        }));
    } catch (err) { handleServerError(res, err); }
});

// 创建服务商
router.post('/providers', async (req, res) => {
    try {
        const err = validateProvider(req.body);
        if (err) return res.status(400).json(fail(err));
        const { name, api_type, base_url, api_key, model, is_active, sort_order } = req.body;
        const encryptedKey = api_key ? encrypt(api_key.trim()) : null;
        const result = await db.query(
            'INSERT INTO ai_providers (user_id, name, api_type, base_url, api_key, model, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.userId, name.trim(), api_type, base_url.trim(), encryptedKey, model.trim(), is_active ? true : false, sort_order || 0]
        );
        if (is_active) {
            await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = ? AND id != ?', [req.userId, result.insertId]);
        }
        res.json(success({ id: result.insertId }, '服务商已创建'));
    } catch (err) { handleServerError(res, err); }
});

// 更新服务商
router.put('/providers/:id', async (req, res) => {
    try {
        const err = validateProvider(req.body);
        if (err) return res.status(400).json(fail(err));
        const { name, api_type, base_url, api_key, model, is_active, sort_order } = req.body;
        const existing = await db.queryOne('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!existing) return res.status(404).json(fail('服务商不存在'));

        const updates = {
            name: name.trim(), api_type, base_url: base_url.trim(),
            model: model.trim(), is_active: is_active ? true : false, sort_order: sort_order || 0
        };
        if (typeof api_key === 'string' && api_key.trim()) {
            updates.api_key = encrypt(api_key.trim());
        }
        const keys = Object.keys(updates);
        const values = Object.values(updates);
        values.push(req.params.id, req.userId);
        await db.query(`UPDATE ai_providers SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, values);

        if (is_active) {
            await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = ? AND id != ?', [req.userId, req.params.id]);
        }
        res.json(success({ updated: true }, '服务商已更新'));
    } catch (err) { handleServerError(res, err); }
});

// 删除服务商
router.delete('/providers/:id', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!existing) return res.status(404).json(fail('服务商不存在'));
        await db.query('DELETE FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        res.json(success({ deleted: true }, '服务商已删除'));
    } catch (err) { handleServerError(res, err); }
});

// 激活服务商
router.post('/providers/:id/activate', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!existing) return res.status(404).json(fail('服务商不存在'));
        await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = ?', [req.userId]);
        await db.query('UPDATE ai_providers SET is_active = TRUE WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        res.json(success({ activated: true }, '已启用该服务商'));
    } catch (err) { handleServerError(res, err); }
});

// 测试连接
router.post('/providers/:id/test', async (req, res) => {
    try {
        const provider = await db.queryOne('SELECT * FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!provider) return res.status(404).json(fail('服务商不存在'));
        if (provider.api_key) {
            const decrypted = decrypt(provider.api_key);
            if (decrypted === null) {
                return res.status(400).json(fail('API Key 解密失败：服务端 ENCRYPTION_KEY 与历史凭证不匹配，请重新输入 Key 保存'));
            }
            provider.api_key = decrypted;
        }
        if (!provider.api_key) return res.status(400).json(fail('服务商未设置 API Key'));

        const result = await callProvider(provider, [{ role: 'user', content: '回复"OK"' }]);
        res.json(success({ ok: true, reply: (result || '').slice(0, 100) }, '连接测试成功'));
    } catch (err) {
        res.json(success({ ok: false, error: err.message }, '连接测试失败'));
    }
});

module.exports = router;
