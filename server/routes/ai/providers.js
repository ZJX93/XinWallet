/* ============================================
   AI 服务商管理：列表 / 新增 / 修改 / 删除 / 启用 / 连通性测试
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, encrypt, decrypt, success, fail, handleServerError, maskKey, callProvider } = require('./_shared');
const https = require('https');
const http = require('http');
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

// 拉取已保存服务商的可用模型（使用服务端已存的 Key，不外泄到前端）
router.get('/providers/:id/models', async (req, res) => {
    try {
        const provider = await db.queryOne('SELECT * FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!provider) return res.status(404).json(fail('服务商不存在'));
        let key = null;
        if (provider.api_key) {
            const decrypted = decrypt(provider.api_key);
            if (decrypted === null) {
                return res.status(400).json(fail('API Key 解密失败：服务端 ENCRYPTION_KEY 与历史凭证不匹配，请重新输入 Key 保存'));
            }
            key = decrypted;
        }
        if (!key) return res.status(400).json(fail('该服务商未设置 API Key，无法拉取模型'));
        const result = await listModels(provider.base_url, key, provider.api_type);
        res.json(success(result));
    } catch (err) { handleServerError(res, err); }
});

// 预览可用模型（新建未保存时，用临时地址 + Key 拉取，不落库；Key 不外泄到前端）
router.post('/providers/preview-models', async (req, res) => {
    try {
        const { base_url, api_key, api_type } = req.body || {};
        if (!base_url || !base_url.trim()) return res.status(400).json(fail('请先填写接口地址'));
        const key = (api_key || '').trim();
        if (!key) return res.status(400).json(fail('请先填写 API Key 后再拉取（新建时 Key 必填）'));
        const result = await listModels(base_url.trim(), key, api_type || 'openai');
        res.json(success(result));
    } catch (err) { handleServerError(res, err); }
});

module.exports = router;

// ============ 拉取上游可用模型（GET /v1/models 等） ============
// 通用 http/https GET JSON
function fetchJson(url, headers = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch (_) { return reject(new Error('接口地址格式无效')); }
        const lib = u.protocol === 'http:' ? http : https;
        const req = lib.request(u, {
            method: 'GET',
            headers: { 'User-Agent': 'xinwallet/1.0', 'Accept': 'application/json', ...headers },
            timeout: timeoutMs,
        }, (res) => {
            let buf = '';
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(buf); } catch { parsed = buf; }
                if (res.statusCode >= 200 && res.statusCode < 300) { resolve(parsed); return; }
                const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                reject(new Error(`上游返回 ${res.statusCode}：${detail.slice(0, 200)}`));
            });
        });
        req.on('error', (e) => reject(new Error(`无法连接到服务商：${e.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时（15s）')); });
        req.end();
    });
}

// 拉取上游可用模型：OpenAI 兼容走 /models；Ollama 走 /api/tags；Anthropic 不支持
// 返回 { supported, models?, message?, error? }
async function listModels(base_url, api_key, api_type) {
    const url = (base_url || '').replace(/\/+$/, '');
    if (!url) return { supported: true, models: [], message: '接口地址为空' };

    if (/(127\.0\.0\.1|localhost):11434/.test(url)) {
        try {
            const data = await fetchJson(`${url}/api/tags`);
            const models = (data.models || []).map((m) => m.name).filter(Boolean);
            return { supported: true, models };
        } catch (e) { return { supported: true, models: [], error: e.message }; }
    }

    if (api_type === 'anthropic') {
        return { supported: false, message: 'Anthropic / MiniMax(Anthropic) 接口不提供「列出模型」接口，请手动输入模型名' };
    }

    try {
        const headers = api_key ? { Authorization: `Bearer ${api_key}` } : {};
        const data = await fetchJson(`${url}/models`, headers);
        let models = [];
        if (Array.isArray(data)) models = data;
        else if (data && Array.isArray(data.data)) models = data.data;
        else if (data && Array.isArray(data.models)) models = data.models;
        models = models.map((m) => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
        models = [...new Set(models)];
        if (!models.length) return { supported: true, models: [], message: '上游未返回任何模型，请确认地址或 Key' };
        if (models.length > 200) models = models.slice(0, 200);
        return { supported: true, models };
    } catch (e) { return { supported: true, models: [], error: e.message }; }
}
module.exports.fetchModels = listModels; // 供测试脚本直接调用
