/* ============================================
   鑫钱包 · AI 服务商 & OCR 配置路由
   ============================================ */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { encrypt, decrypt } = require('../crypto');
const { success, fail, handleServerError, maskKey, extractJson, tryDecrypt, computeAccountBalance, enforceBalanceLimit, fmtDateTime, stripThinkingTokens, polishChatReply } = require('./_helpers');
const { resolveNote } = require('./utils');
const { getActiveProvider, getTranscriptionProvider, callProvider, chatWithTools, httpsPostRaw } = require('../services/ai');

// 统一校验 AI 服务商可用性：区分「未配置」与「配置存在但密钥解密失败（重部署导致）」，
// 让前端能给出明确引导（前往「AI 配置」页重新保存），避免用户误以为配置丢失。
function checkProvider(res, provider) {
    if (!provider) {
        res.status(400).json(fail('请先在 Web 端「AI 配置」页面配置 AI 服务商'));
        return false;
    }
    if (provider._decryptFailed) {
        res.status(400).json(fail('检测到 AI 服务商配置，但密钥解密失败（很可能是重部署后加密密钥 ENCRYPTION_KEY 变更）。请前往「AI 配置」页重新保存该服务商的 API Key。'));
        return false;
    }
    return true;
}
const { syncCreditCardDebt } = require('./utils');
const { toAmount, toNumber } = require('../validate');
const multer = require('multer');

/**
 * 腾讯云 OCR SDK 惰性加载：该 SDK 依赖 node-fetch（体积大、且仅在 /ocr 路由用到）。
 * 顶层 require 会在服务启动时即加载整条依赖链，容易导致 node-fetch 缺失/损坏时
 * 整个服务无法启动。改为首次调用 OCR 时才加载，避免拖垮其它完全无关的接口。
 */
let _OcrClient = null;
function getOcrClient() {
    if (!_OcrClient) {
        const { ocr: tencentOcr } = require('tencentcloud-sdk-nodejs-ocr');
        _OcrClient = tencentOcr.v20181119.Client;
    }
    return _OcrClient;
}

// 仅 OCR 路由需要图片上传：memoryStorage 不落盘、5MB 上限、仅接受图片类型。
// 在此局部定义并仅挂到 /ocr 路由（见下方 router.post('/ocr', ...)），不再于全局
// /api 上套用上传中间件，缩小「任意 /api 端点被 multipart 大 body 试探」的 DoS / 内存放大面。
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('仅支持图片格式'), false);
        cb(null, true);
    }
});

// 校验服务商输入
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
        const rows = await db.query('SELECT id, user_id, name, api_type, base_url, api_key, model, is_active, sort_order, created_at FROM ai_providers WHERE user_id = $1 ORDER BY sort_order, id', [req.userId]);
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
            'INSERT INTO ai_providers (user_id, name, api_type, base_url, api_key, model, is_active, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [req.userId, name.trim(), api_type, base_url.trim(), encryptedKey, model.trim(), is_active ? 1 : 0, sort_order || 0]
        );
        if (is_active) {
            await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = $1 AND id != $2', [req.userId, result.insertId]);
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
            model: model.trim(), is_active: is_active ? 1 : 0, sort_order: sort_order || 0
        };
        if (typeof api_key === 'string' && api_key.trim()) {
            updates.api_key = encrypt(api_key.trim());
        }
        const keys = Object.keys(updates);
        const values = Object.values(updates);
        values.push(req.params.id, req.userId);
        await db.query(`UPDATE ai_providers SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, values);

        if (is_active) {
            await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = $1 AND id != $2', [req.userId, req.params.id]);
        }
        res.json(success({ updated: true }, '服务商已更新'));
    } catch (err) { handleServerError(res, err); }
});

// 删除服务商
router.delete('/providers/:id', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!existing) return res.status(404).json(fail('服务商不存在'));
        await db.query('DELETE FROM ai_providers WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
        res.json(success({ deleted: true }, '服务商已删除'));
    } catch (err) { handleServerError(res, err); }
});

// 激活服务商
router.post('/providers/:id/activate', async (req, res) => {
    try {
        const existing = await db.queryOne('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!existing) return res.status(404).json(fail('服务商不存在'));
        await db.query('UPDATE ai_providers SET is_active = FALSE WHERE user_id = $1', [req.userId]);
        await db.query('UPDATE ai_providers SET is_active = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
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

// AI 财务建议（基于用户完整财务数据生成多条建议）
router.post('/advice', async (req, res) => {
    try {
        const provider = await getActiveProvider(req.userId);
        if (!checkProvider(res, provider)) return;

        // 收集用户财务数据：本月交易汇总、预算、储蓄目标、账户、债务
        const currentMonth = new Date().toISOString().slice(0, 7);
        const [summary, budgets, goals, accounts, debts] = await Promise.all([
            db.query(
                `SELECT c.name AS category, t.type, SUM(t.amount) AS total, COUNT(*) AS cnt
                 FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
                 WHERE t.user_id = ? AND t.book_id = ? AND TO_CHAR(t.date, 'YYYY-MM') = ?
                 GROUP BY c.name, t.type ORDER BY total DESC`,
                [req.userId, req.bookId, currentMonth]
            ),
            db.query(
                'SELECT name, amount FROM budgets WHERE user_id = $1 AND book_id = $2 AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE',
                [req.userId, req.bookId]
            ),
            db.query(
                "SELECT name, target_amount, current_amount, icon FROM savings_goals WHERE user_id = $1 AND book_id = $2 AND status = 'active'",
                [req.userId, req.bookId]
            ),
            db.query(
                "SELECT name, balance, type FROM accounts WHERE user_id = $1 AND book_id = $2 AND status = 'active' ORDER BY balance DESC",
                [req.userId, req.bookId]
            ),
            db.query(
                `SELECT name, type, remaining, monthly_payment, interest_rate, method, due_date, status
                 FROM debts WHERE user_id = ? AND book_id = ? AND status != 'paid_off'`,
                [req.userId, req.bookId]
            )
        ]);

        // 也获取上月数据用于环比
        const prevMonth = (() => {
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            return d.toISOString().slice(0, 7);
        })();
        const prevSummary = await db.query(
            `SELECT c.name AS category, t.type, SUM(t.amount) AS total
             FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ? AND t.book_id = ? AND TO_CHAR(t.date, 'YYYY-MM') = ?
             GROUP BY c.name, t.type ORDER BY total DESC`,
            [req.userId, req.bookId, prevMonth]
        );

        const curExpense = summary.filter(r => r.type === 'expense').reduce((s, r) => s + parseFloat(r.total), 0);
        const curIncome = summary.filter(r => r.type === 'income').reduce((s, r) => s + parseFloat(r.total), 0);
        const prevExpense = prevSummary.filter(r => r.type === 'expense').reduce((s, r) => s + parseFloat(r.total), 0);
        const momRate = prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense * 100).toFixed(1) : null;

        // 计算总负债和月供
        const totalDebt = debts.reduce((s, d) => s + parseFloat(d.remaining || 0), 0);
        const totalMonthlyPayment = debts.reduce((s, d) => s + parseFloat(d.monthly_payment || 0), 0);
        const totalAssets = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets * 100).toFixed(1) : '0';

        const context = {
            本月: currentMonth,
            本月收入: Math.round(curIncome * 100) / 100,
            本月支出: Math.round(curExpense * 100) / 100,
            收支比: curIncome > 0 ? (curExpense / curIncome * 100).toFixed(0) + '%' : '无收入',
            支出环比: momRate !== null ? `${momRate > 0 ? '+' : ''}${momRate}%` : '无上月数据',
            分类收支: summary.map(r => ({ 类别: r.category, 类型: r.type, 金额: Math.round(parseFloat(r.total) * 100) / 100, 笔数: r.cnt })),
            预算: budgets.map(b => ({ 名称: b.name, 预算额: Math.round(parseFloat(b.amount) * 100) / 100 })),
            储蓄目标: goals.map(g => ({ 名称: g.name, 目标: Math.round(parseFloat(g.target_amount) * 100) / 100, 当前: Math.round(parseFloat(g.current_amount) * 100) / 100, 进度: Math.round(parseFloat(g.current_amount) / Math.max(1, parseFloat(g.target_amount)) * 100) + '%' })),
            账户: accounts.map(a => ({ 名称: a.name, 余额: Math.round(parseFloat(a.balance) * 100) / 100, 类型: a.type })),
            债务: {
                总负债: Math.round(totalDebt * 100) / 100,
                月供应付: Math.round(totalMonthlyPayment * 100) / 100,
                负债资产比: debtToAssetRatio + '%',
                明细: debts.map(d => ({
                    名称: d.name,
                    类型: d.type === 'credit_card' ? '信用卡' : d.type === 'loan' ? '贷款' : d.type === 'personal' ? '个人借贷' : '其他',
                    剩余: Math.round(parseFloat(d.remaining || 0) * 100) / 100,
                    月供: Math.round(parseFloat(d.monthly_payment || 0) * 100) / 100,
                    状态: d.status === 'overdue' ? '逾期' : '正常'
                }))
            },
            上月支出: Math.round(prevExpense * 100) / 100
        };

        const content = await callProvider(provider, [
            {
                role: 'system',
                content: `你是一位资深个人理财顾问。基于用户完整财务数据，给出 3-5 条切实可行的财务建议，按重要性排序。
要求：
1. 优先针对真实风险（超支、储蓄目标滞后、收支比失衡、闲置资金、负债过高、逾期风险）
2. 若用户有负债，必须分析负债资产比、月供占收入比，给出降债建议
3. 每条必须基于具体数据，给出可量化、可操作的方向
4. 区分优先级
返回纯 JSON，每条含：
- title：8字以内建议标题
- content：45字以内具体建议（含数据）
- impact：15字以内预期影响
- priority：优先级，"high"（重要）/ "medium"（中等）/ "low"（可选）三选一
{"advice":[{"title":"","content":"","impact":"","priority":""}]}
不要 markdown、不要解释、不要超出字段。`
            },
            { role: 'user', content: JSON.stringify(context, null, 0) }
        ]);
        const json = extractJson(content);
        const advice = (json && Array.isArray(json.advice)) ? json.advice : [];
        res.json(success({ advice, generatedAt: new Date().toISOString() }));
    } catch (err) { handleServerError(res, err); }
});

// AI 消费洞察
router.post('/insight', async (req, res) => {
    try {
        const provider = await getActiveProvider(req.userId);
        if (!checkProvider(res, provider)) return;

        const month = (req.body && req.body.month) || new Date().toISOString().slice(0, 7);
        const [summary, prevSummary, budgets, goals, accounts, debts] = await Promise.all([
            db.query(`SELECT c.name, SUM(t.amount) as total, COUNT(*) as cnt FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND t.book_id = ? AND t.type = 'expense' AND TO_CHAR(t.date, 'YYYY-MM') = ? GROUP BY c.name ORDER BY total DESC`, [req.userId, req.bookId, month]),
            db.query(`SELECT SUM(t.amount) as total FROM transactions t WHERE t.user_id = ? AND t.book_id = ? AND t.type = 'expense' AND TO_CHAR(t.date, 'YYYY-MM') = TO_CHAR(CAST(? AS DATE) - INTERVAL '1 month', 'YYYY-MM')`, [req.userId, req.bookId, month + '-01']),
            db.query('SELECT name, amount FROM budgets WHERE user_id = $1 AND book_id = $2 AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE', [req.userId, req.bookId]),
            db.query("SELECT name, target_amount, current_amount FROM savings_goals WHERE user_id = $1 AND book_id = $2 AND status = 'active'", [req.userId, req.bookId]),
            db.query("SELECT name, balance, type FROM accounts WHERE user_id = $1 AND book_id = $2 AND status = 'active' ORDER BY balance DESC", [req.userId, req.bookId]),
            db.query("SELECT name, type, remaining, monthly_payment, status FROM debts WHERE user_id = $1 AND book_id = $2 AND status != 'paid_off'", [req.userId, req.bookId])
        ]);

        const curTotal = summary.reduce((s, r) => s + parseFloat(r.total), 0);
        const prevTotal = prevSummary[0] ? parseFloat(prevSummary[0].total || 0) : 0;
        const momRate = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal * 100).toFixed(1) : null;

        // 计算总负债和月供
        const totalDebt = debts.reduce((s, d) => s + parseFloat(d.remaining || 0), 0);
        const totalMonthlyPayment = debts.reduce((s, d) => s + parseFloat(d.monthly_payment || 0), 0);
        const totalAssets = accounts.reduce((s, a) => s + parseFloat(a.balance || 0), 0);
        const debtToAssetRatio = totalAssets > 0 ? (totalDebt / totalAssets * 100).toFixed(1) : '0';

        const context = {
            本月: month,
            本月支出合计: Math.round(curTotal * 100) / 100,
            上月支出合计: Math.round(prevTotal * 100) / 100,
            支出环比: momRate !== null ? `${momRate > 0 ? '+' : ''}${momRate}%` : '无上月数据',
            分类支出: summary.map(r => ({ 类别: r.name, 金额: Math.round(parseFloat(r.total) * 100) / 100, 笔数: r.cnt })),
            预算执行: budgets.map(b => ({ 名称: b.name, 预算: Math.round(parseFloat(b.amount) * 100) / 100 })),
            储蓄目标: goals.map(g => ({ 名称: g.name, 目标: Math.round(parseFloat(g.target_amount) * 100) / 100, 当前: Math.round(parseFloat(g.current_amount) * 100) / 100 })),
            账户余额: accounts.map(a => ({ 名称: a.name, 余额: Math.round(parseFloat(a.balance) * 100) / 100, 类型: a.type })),
            债务: {
                总负债: Math.round(totalDebt * 100) / 100,
                月供应付: Math.round(totalMonthlyPayment * 100) / 100,
                负债资产比: debtToAssetRatio + '%',
                明细: debts.map(d => ({
                    名称: d.name,
                    类型: d.type === 'credit_card' ? '信用卡' : d.type === 'loan' ? '贷款' : d.type === 'personal' ? '个人借贷' : '其他',
                    剩余: Math.round(parseFloat(d.remaining || 0) * 100) / 100,
                    月供: Math.round(parseFloat(d.monthly_payment || 0) * 100) / 100,
                    状态: d.status === 'overdue' ? '逾期' : '正常'
                }))
            }
        };

        const content = await callProvider(provider, [
            { role: 'system', content: `你是一位资深个人理财分析师。基于用户多维度财务数据，给出 3-5 条有真正洞察价值的分析，避免泛泛而谈。
要求：
1. 精准识别异常（某类超支、环比激增、预算执行率异常）
2. 结合余额与储蓄目标判断资金健康度
3. 必须分析债务负担：负债资产比（>50%为警戒）、月供占收入比（>40%为高压）、逾期笔数
4. 给出储蓄率、还款计划、提前还贷等可执行动作
5. 每条给出可执行的改善动作
返回纯 JSON，每条含：
- title：8字以内标题
- description：45字以内具体分析（含数据）
- action：15字以内行动建议
- level：重要程度，"warning"（需重视）/ "info"（关注）/ "tip"（小建议）三选一
{"insights":[{"title":"","description":"","action":"","level":""}]}
不要 markdown、不要解释、不要超出字段。` },
            { role: 'user', content: JSON.stringify(context, null, 0) }
        ]);
        const json = extractJson(content);
        const insights = (json && Array.isArray(json.insights)) ? json.insights : [];
        res.json(success({ insights, generatedAt: new Date().toISOString() }));
    } catch (err) { handleServerError(res, err); }
});

// OCR 配置
router.get('/ocr-config', async (req, res) => {
    try {
        const cfg = await db.queryOne('SELECT provider, secret_id, secret_key, region FROM ai_ocr_config WHERE user_id = ?', [req.userId]);
        if (!cfg) {
            res.json(success({ provider: 'tencent', secret_id: '', region: 'ap-guangzhou' }));
            return;
        }
        // 诊断：是否成功解密
        const idResult = tryDecrypt(cfg.secret_id);
        const keyResult = tryDecrypt(cfg.secret_key);
        const decryptOk = idResult.ok && keyResult.ok;
        res.json(success({
            provider: cfg.provider,
            secret_id: maskKey(idResult.value),
            region: cfg.region,
            // 关键：告知前端"凭证是否可正常解密"
            credentialsValid: decryptOk,
            credentialsError: decryptOk ? null : (idResult.error || keyResult.error || '密钥不匹配，请重新添加凭证'),
        }));
    } catch (err) { handleServerError(res, err); }
});

router.post('/ocr-config', async (req, res) => {
    try {
        const { secret_id, secret_key, region } = req.body || {};
        // 如果 secret_id 是脱敏占位符（含 ...），说明前端未重新输入完整 Key，忽略该字段
        const idVal = secret_id && secret_id.trim();
        const keyVal = secret_key && secret_key.trim();
        const isMaskedId = idVal && idVal.includes('...');

        // 查询现有配置，用于字段未提供时保留原值
        const existing = await db.queryOne('SELECT * FROM ai_ocr_config WHERE user_id = ?', [req.userId]);

        if (!idVal && !existing) return res.status(400).json(fail('SecretId 必填'));
        if (!keyVal && !existing) return res.status(400).json(fail('SecretKey 必填'));

        const finalId = isMaskedId ? existing?.secret_id : (idVal ? encrypt(idVal) : existing?.secret_id);
        const finalKey = keyVal ? encrypt(keyVal) : existing?.secret_key;
        const finalRegion = (region || existing?.region || 'ap-guangzhou').trim();

        await db.query(
            `INSERT INTO ai_ocr_config (user_id, provider, secret_id, secret_key, region)
             VALUES (?, 'tencent', ?, ?, ?)
             ON CONFLICT (user_id) DO UPDATE SET
             secret_id = EXCLUDED.secret_id,
             secret_key = EXCLUDED.secret_key,
             region = EXCLUDED.region`,
            [req.userId, finalId, finalKey, finalRegion]
        );
        res.json(success({ saved: true }, 'OCR 配置已保存'));
    } catch (err) { handleServerError(res, err); }
});

// 兜底：从 OCR 文字中用正则提取交易项（当 AI 不返回 JSON 时使用）
function fallbackExtractItems(ocrText, defaultDate) {

    // === 智能分类引擎：结合商户名+时间推断二级分类 ===
    function inferCategory(name, note, timeStr) {
        const text = ((name || '') + ' ' + (note || '')).toLowerCase();

        // 从支付时间推断餐别（中餐类时按时间段修正）
        let mealBias = null;
        if (timeStr) {
            const hourMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
            if (hourMatch) {
                const h = parseInt(hourMatch[1]);
                if (h >= 5 && h < 10) mealBias = '早餐';
                else if (h >= 10 && h < 14) mealBias = '午餐';
                else if (h >= 14 && h < 21) mealBias = '晚餐';
                else mealBias = '晚餐'; // 深夜归晚餐
            }
        }

        // 一级分类（兜底）
        const level1 = [
            { kw: ['药','医','体检','医院','诊所','挂号','牙','眼','疫苗','保健','药房','药局','处方','感冒','咳嗽'], cat: '医疗' },
            { kw: ['车','油','打车','滴滴','地铁','公交','停车','高速','etc','加油站','充电','骑行','共享单车'], cat: '交通' },
            { kw: ['酒店','机票','火车票','民宿','旅行','行李','托运','景点','门票'], cat: '旅行' },
            { kw: ['房','租','水电','物业','燃气','暖气','网费'], cat: '住房' },
            { kw: ['电影','游戏','健身','运动','k歌','ktv','演出','展览','游泳'], cat: '娱乐' },
            { kw: ['课','书','学','培训','教育','考试','报名','文具'], cat: '教育' },
            { kw: ['话费','流量','宽带','手机','充值','通信','快递'], cat: '通讯' },
            { kw: ['购','买','京东','淘宝','天猫','拼多多','超市','便利店','商场','百货','日用品','家居','数码'], cat: '购物' },
            { kw: ['礼','红包','人情','结婚','生日','聚会','请客'], cat: '人情' },
            { kw: ['衣','鞋','包','化妆','美容','护肤','美发'], cat: '美容' },
            { kw: ['猫粮','狗粮','猫砂','宠物'], cat: '宠物' },
            { kw: ['保险','保费','理赔','社保'], cat: '保险' },
            { kw: ['加油','中石化','中石油'], cat: '爱车' },
        ];

        // 二级分类（精确匹配）
        const level2 = [
            // 餐饮二级
            { kw: ['早餐','早','包子','豆浆','油条','粥','肠粉','煎饼'], cat: '早餐' },
            { kw: ['盒饭','盖饭','便当','食堂','米线','麻辣烫','冒菜','披萨'], cat: '午餐' },
            { kw: ['饼','面','粉','饭','卷','汤','饺子','馄饨','炒饭','拌面','粥'], cat: '午餐' },
            { kw: ['晚餐','晚','夜宵','宵夜','烧烤','串','火锅','烤鱼','小龙虾','大排档','炸鸡','汉堡','炒菜','炒'], cat: '晚餐' },
            { kw: ['肯德基','麦当劳','汉堡王','必胜客','华莱士','德克士','星巴克','瑞幸','海底捞','呷哺','九田家','西贝','外婆家','绿茶餐厅','探鱼','蛙来哒','太二','喜茶','奈雪','一点点','coco','蜜雪冰城','古茗','霸王茶姬','乐乐茶'], cat: '外卖' },
            { kw: ['水果','糖','巧克力','冰淇淋','薯片','坚果','瓜子','饮料','矿泉水','咖啡','奶茶','茶','可乐','雪碧'], cat: '零食' },
            { kw: ['聚餐','聚会','请客','饭局','订餐','酒席'], cat: '聚餐' },
            { kw: ['外卖','美团','饿了么','配送'], cat: '外卖' },
            { kw: ['菜','肉','蛋','鱼','虾','鸡','鸭','牛','羊','小吃','馆','餐厅','饭店'], cat: '晚餐' },
            { kw: ['奶茶店','饮品','甜品','蛋糕','面包','烘焙'], cat: '零食' },
            // 交通二级
            { kw: ['地铁','公交','一卡通','交通卡'], cat: '公交地铁' },
            { kw: ['打车','滴滴','曹操','T3','首汽','花小猪','出租车','的士'], cat: '打车' },
            { kw: ['火车','高铁','机票','飞机','12306','携程','飞猪','航旅'], cat: '火车飞机' },
            { kw: ['共享单车','哈啰','美团单车','骑行','单车'], cat: '公交地铁' },
            { kw: ['加油站','中石化','中石油','汽油','柴油'], cat: '加油' },
            { kw: ['充电','充电桩','特来电','星星充电'], cat: '充电' },
            { kw: ['停车','停车场','泊车','车位'], cat: '停车费' },
            { kw: ['过路费','高速','ETC','通行费'], cat: '过路费' },
            // 购物二级
            { kw: ['超市','百货','日用品','纸巾','洗衣','垃圾袋','清洁'], cat: '日用百货' },
            { kw: ['服装','衣服','鞋','包','裤','衣','袜','帽','围巾'], cat: '服装鞋包' },
            { kw: ['数码','手机','电脑','耳机','平板','充电宝','鼠标','键盘'], cat: '数码产品' },
            { kw: ['家居','家具','床','桌','椅','柜','沙发','灯','窗帘'], cat: '家居家具' },
            // 住房二级
            { kw: ['房租','租金','房东','中介','租房'], cat: '房租' },
            { kw: ['电费','水费','燃气','煤气','天然气'], cat: '水电燃气' },
            { kw: ['物业','物管','管理费'], cat: '物业费' },
            { kw: ['维修','修理','疏通','漏水'], cat: '维修' },
            // 医疗二级
            { kw: ['门诊','挂号','诊所','医生','看病','检查','化验'], cat: '门诊' },
            { kw: ['药','药品','药房','药店','处方'], cat: '药品' },
            // 教育二级
            { kw: ['培训','课程','网课','补习','辅导班','学而思','新东方'], cat: '培训课程' },
            { kw: ['书','书籍','教材','书店','当当','kindle'], cat: '书籍' },
            { kw: ['考试','报名','雅思','托福','考研','考公'], cat: '考试报名' },
            // 通讯二级
            { kw: ['话费','手机费','sim卡','中国移动','中国联通','中国电信','移动','联通','电信'], cat: '话费' },
            { kw: ['宽带','网费','光纤','wifi'], cat: '宽带' },
            { kw: ['快递','顺丰','圆通','中通','申通','韵达','邮政','EMS'], cat: '快递' },
            // 娱乐二级
            { kw: ['电影','影院','猫眼','淘票票','imax'], cat: '电影演出' },
            { kw: ['游戏','steam','switch','ps','xbox','手游','充值','皮肤'], cat: '游戏' },
            { kw: ['健身','跑步','瑜伽','游泳','球','器械','私教','运动'], cat: '运动健身' },
            { kw: ['旅游','景点','门票','度假'], cat: '旅游度假' },
            { kw: ['ktv','唱歌','酒吧','蹦迪','livehouse'], cat: 'KTV酒吧' },
            // 人情二级
            { kw: ['父母','爸','妈','爹','娘','老人','长辈'], cat: '孝敬父母' },
            { kw: ['红包','送礼','礼物','份子钱','彩礼'], cat: '送礼红包' },
            // 宠物二级
            { kw: ['猫粮','狗粮','罐头','冻干','宠物食品'], cat: '主粮零食' },
            // 美容二级
            { kw: ['护肤','面膜','精华','乳液','防晒','洗面奶','水乳'], cat: '护肤' },
            { kw: ['美发','理发','烫发','染发','洗剪吹','造型'], cat: '美发' },
            // 收入二级
            { kw: ['基本工资','底薪','月薪','工资条'], cat: '基本工资' },
            { kw: ['奖金','年终奖','绩效','提成','分红'], cat: '奖金' },
            { kw: ['补贴','报销','差旅','餐饮补贴','交通补贴','房补'], cat: '补贴报销' },
            { kw: ['理财收益','利息','基金','股票','余额宝'], cat: '理财收益' },
            { kw: ['房租收入','收租'], cat: '房租收入' },
        ];

        // 先尝试匹配二级分类
        for (const rule of level2) {
            for (const kw of rule.kw) {
                if (text.includes(kw)) {
                    // 餐饮类（早/午/晚餐）用支付时间修正
                    if (mealBias && ['早餐','午餐','晚餐','外卖'].includes(rule.cat)) {
                        return mealBias;
                    }
                    return rule.cat;
                }
            }
        }
        // 再匹配一级
        for (const rule of level1) {
            for (const kw of rule.kw) {
                if (text.includes(kw)) return rule.cat;
            }
        }
        return '其他';
    }

    function inferNote(ocrText, name, amount) {
        // 从 OCR 文字提取有意义的交易描述，排除支付渠道/账户信息
        // 提取"商品"行的内容作为备注
        const productMatch = ocrText.match(/商品\s*(.+)/);
        if (productMatch) return productMatch[1].trim();
        // 否则用交易名本身
        return name || '消费';
    }

    // 从 OCR 提取完整支付时间（用于餐别推断和精确时间）
    const ocrDateTime = (() => {
        const m1 = ocrText.match(/支付时间\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2}):(\d{2}):(\d{2})/);
        if (m1) return `${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')} ${m1[4].padStart(2,'0')}:${m1[5].padStart(2,'0')}:${m1[6].padStart(2,'0')}`;
        const m2 = ocrText.match(/支付时间\s*(\d{4}-\d{2}-\d{2})\s*(\d{1,2}):(\d{2}):(\d{2})/);
        if (m2) return `${m2[1]} ${m2[2].padStart(2,'0')}:${m2[3].padStart(2,'0')}:${m2[4].padStart(2,'0')}`;
        return null;
    })();
    const ocrTime = (() => {
        const m = ocrText.match(/支付时间.*?(\d{1,2}):(\d{2})/)
               || ocrText.match(/(\d{1,2}):(\d{2}):\d{2}/);
        return m ? `${m[1]}:${m[2]}` : null;
    })();

    const items = [];
    const seen = new Set();
    const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
    const skipKeywords = /合计|总计|小计|总金额|优惠|退款|实付|找零|应付|应收|余额|折扣|满减|立减/i;
    const noiseKeywords = /支付金额|支付|消费|收款|订单|交易|当前状态|付款方式|账单详情/i;

    let contextDate = defaultDate;
    const globalDateMatch = ocrText.match(/(\d{4}[-\/]\d{2}[-\/]\d{2})|(\d{4}年\d{1,2}月\d{1,2}日)/);
    if (globalDateMatch) {
        contextDate = globalDateMatch[1]
            ? globalDateMatch[1].replace(/\//g, '-')
            : globalDateMatch[2].replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, (a, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    }
    if (ocrDateTime) contextDate = ocrDateTime;

    // 解析单行中的完整日期时间，保留时间部分
    function parseDateFromLine(line) {
        if (!line) return contextDate;
        // 优先匹配完整时间：2026年7月17日 17:23:49 或 2026-07-17 17:23:49
        const ftm1 = line.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s+(\d{1,2}):(\d{2}):(\d{2})/);
        if (ftm1) return `${ftm1[1]}-${ftm1[2].padStart(2,'0')}-${ftm1[3].padStart(2,'0')} ${ftm1[4].padStart(2,'0')}:${ftm1[5].padStart(2,'0')}:${ftm1[6].padStart(2,'0')}`;
        const ftm2 = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/);
        if (ftm2) return `${ftm2[1]} ${ftm2[2].padStart(2,'0')}:${ftm2[3].padStart(2,'0')}:${ftm2[4].padStart(2,'0')}`;
        // 只有日期时尝试从附近补充时间
        const m1 = line.match(/(\d{4}[-\/]\d{2}[-\/]\d{2})/);
        if (m1) return m1[1].replace(/\//g, '-');
        const m2 = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m2) {
            const date = `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
            // 尝试从同一行后面提取时间
            const tm = line.match(/(\d{1,2}):(\d{2}):(\d{2})/);
            if (tm) return `${date} ${tm[1].padStart(2,'0')}:${tm[2].padStart(2,'0')}:${tm[3].padStart(2,'0')}`;
            return date;
        }
        return contextDate;
    }

    function addItem(name, amount, date, note) {
        const key = `${name}|${amount.toFixed(2)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const category = inferCategory(name, note || '', ocrTime);
        items.push({
            name: name.slice(0, 50),
            amount,
            type: category === '收入' ? 'income' : 'expense',
            date,
            note: note || inferNote(ocrText, name),
            category
        });
    }

    function isNoiseLine(line) {
        return !line || line.length > 60 || skipKeywords.test(line) || noiseKeywords.test(line)
            || /^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(line) || /^\d{4}年\d{1,2}月/.test(line)
            || /^\d{2}:\d{2}/.test(line) || /^\d{10,}$/.test(line)
            || /^(?:交易单号|商户单号|收单机构|支付方式|商家小程序|账单服务)/.test(line);
    }

    function findMerchantName(startIdx, maxLookBack = 5) {
        for (let k = 1; k <= maxLookBack && startIdx - k >= 0; k++) {
            const candidate = lines[startIdx - k].trim();
            if (isNoiseLine(candidate)) continue;
            const productMatch = candidate.match(/^商品\s*(.+)/);
            if (productMatch) return productMatch[1].trim();
            return candidate;
        }
        return null;
    }

    // 策略1: 微信支付格式 — "商户名" 行后跟 "支付金额 ¥xx.xx"
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const payMatch = line.match(/支付金额\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/);
        if (!payMatch || i === 0) continue;
        const amount = parseFloat(payMatch[1]);
        if (!amount || amount <= 0 || amount > 999999) continue;

        let merchantName = lines[i - 1];
        // 如果前一行的上一行是日期，则商户名是更前一行
        if (i > 1 && /^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(merchantName)) {
            merchantName = lines[i - 2] || merchantName;
        }
        if (skipKeywords.test(merchantName) || noiseKeywords.test(merchantName)) continue;
        if (merchantName.length < 1 || merchantName.length > 60) continue;

        // 查找附近的日期（保留时间）
        let date = contextDate;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const dtm = lines[j].match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
            if (dtm) {
                date = `${dtm[1]}-${dtm[2].padStart(2,'0')}-${dtm[3].padStart(2,'0')}` +
                       (dtm[4] ? ` ${dtm[4].padStart(2,'0')}:${dtm[5].padStart(2,'0')}:${dtm[6].padStart(2,'0')}` : '');
                break;
            }
            const dm = lines[j].match(/(\d{4}[-\/]\d{2}[-\/]\d{2})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
            if (dm) {
                date = dm[1].replace(/\//g, '-') +
                       (dm[2] ? ` ${dm[2].padStart(2,'0')}:${dm[3].padStart(2,'0')}:${dm[4].padStart(2,'0')}` : '');
                break;
            }
        }
        addItem(merchantName, amount, date);
    }

    // 策略2: 支付宝格式 — 商户名在上一行，"消费 ¥xx.xx" 在当前行
    for (let i = 1; i < lines.length; i++) {
        const m = lines[i].match(/^(?:消费|收款|支出|收入)\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/);
        if (!m) continue;
        const amount = parseFloat(m[1]);
        if (!amount || amount <= 0 || amount > 999999) continue;

        let name = lines[i - 1];
        if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(name)) name = lines[i - 2] || name;
        if (skipKeywords.test(name) || noiseKeywords.test(name)) continue;
        if (name.length < 1 || name.length > 60) continue;

        let date = contextDate;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const dm = lines[j].match(/(\d{4}[-\/]\d{2}[-\/]\d{2})/);
            if (dm) { date = dm[1].replace(/\//g, '-'); break; }
        }
        addItem(name, amount, date);
    }

    // 策略3: 通用格式 — "商户名 ¥xx.xx"（排除含消费/支出/收入关键词的行，留给策略4）
    const genericRe = /^(.{1,50}?)\s+[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)\s*(?:元)?\s*$/;
    for (const line of lines) {
        if (skipKeywords.test(line) || noiseKeywords.test(line)) continue;
        if (line.length > 100) continue;
        if (/(?:消费|收款|支出|收入)/.test(line)) continue;
        const m = line.match(genericRe);
        if (!m) continue;
        let name = m[1].trim();
        const amount = parseFloat(m[2]);
        if (!amount || amount <= 0 || amount > 999999) continue;
        name = name.replace(/^\d{4}[-\/]\d{2}[-\/]\d{2}\s*/, '');
        if (name.length < 2 || name.length > 60) continue;
        if (/^\d{2}:\d{2}/.test(name)) continue;
        // 过滤状态栏噪声：纯数字、单字母、无明显语义的短串
        if (/^\d+$/.test(name)) continue;
        if (/^[a-zA-Z]$/.test(name)) continue;
        if (/^\d+[a-zA-Z]$/.test(name) || /^[a-zA-Z]\d+$/.test(name)) continue;
        addItem(name, amount, contextDate);
    }

    // 策略4: 同行格式 — "商户名 消费/支出 ¥xx.xx"
    const inlineTypeRe = /^(.{1,40}?)\s+(?:消费|收款|支出|收入)\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/;
    for (const line of lines) {
        if (skipKeywords.test(line) || noiseKeywords.test(line)) continue;
        if (line.length > 100) continue;
        const m = line.match(inlineTypeRe);
        if (!m) continue;
        let name = m[1].trim();
        const amount = parseFloat(m[2]);
        if (!amount || amount <= 0 || amount > 999999) continue;
        if (name.length < 2 || name.length > 60) continue;
        if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(name)) continue;
        // 过滤状态栏噪声
        if (/^\d+$/.test(name) || /^[a-zA-Z]$/.test(name) || /^\d+[a-zA-Z]$/.test(name) || /^[a-zA-Z]\d+$/.test(name)) continue;
        addItem(name, amount, contextDate);
    }

    // 策略5: 微信账单详情格式 — 金额是独立的负数行如 "-4.00"，向上找商户名/商品名
    const negativeAmountRe = /^-\s*(\d{1,10}(?:\.\d{1,2})?)\s*$/;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(negativeAmountRe);
        if (!m) continue;
        const amount = parseFloat(m[1]);
        if (!amount || amount <= 0 || amount > 999999) continue;

        // 优先使用 "商品" 行提取名称
        let name = null;
        for (let k = 1; k <= 8 && i - k >= 0; k++) {
            const prev = lines[i - k].trim();
            const productMatch = prev.match(/^商品\s*(.+)/);
            if (productMatch) { name = productMatch[1].trim(); break; }
        }
        if (!name) name = findMerchantName(i, 8);
        if (!name) continue;

        // 从附近提取日期
        let date = contextDate;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const d = parseDateFromLine(lines[j]);
            if (d !== contextDate) { date = d; break; }
        }
        if (date === contextDate) {
            for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
                const d = parseDateFromLine(lines[j]);
                if (d !== contextDate) { date = d; break; }
            }
        }
        addItem(name, amount, date);
    }

    return items;
}

// OCR 识别
router.post('/ocr', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json(fail('请上传图片'));
        const imageBase64 = req.file.buffer.toString('base64');
        if (!imageBase64) return res.status(400).json(fail('图片内容为空'));

        const cfg = await db.queryOne('SELECT * FROM ai_ocr_config WHERE user_id = ?', [req.userId]);
        if (!cfg || !cfg.secret_id || !cfg.secret_key) {
            return res.status(400).json(fail('请先前往「AI配置」页面设置腾讯云 OCR 密钥'));
        }

        const secretId = decrypt(cfg.secret_id);
        const secretKey = decrypt(cfg.secret_key);
        // 任一解密失败 → 静默回退已被去除，须让用户重新保存凭证
        if (!secretId || !secretKey) {
            return res.status(400).json(fail('OCR 密钥解密失败，请前往「AI配置」页面重新保存腾讯云 OCR 密钥'));
        }

        const client = new (getOcrClient())({
            credential: { secretId, secretKey },
            region: cfg.region || 'ap-guangzhou'
        });
        const ocrResult = await client.GeneralAccurateOCR({ ImageBase64: imageBase64 });
        const textDetections = ocrResult.TextDetections || [];
        const ocrText = textDetections.map(d => d.DetectedText || '').filter(Boolean).join('\n');

        console.log(`[OCR] user=${req.userId} textLen=${ocrText.length} preview=${ocrText.slice(0, 200).replace(/\n/g, ' ')}`);

        if (!ocrText) {
            return res.json(success({ text: '', items: [], reason: 'OCR 未识别到文字，请尝试上传更清晰的账单截图' }));
        }

        const provider = await getActiveProvider(req.userId);
        if (provider && provider._decryptFailed) {
            return res.status(400).json(fail('检测到 AI 服务商配置，但密钥解密失败（很可能是重部署后加密密钥 ENCRYPTION_KEY 变更）。请前往「AI 配置」页重新保存该服务商的 API Key。'));
        }
        const today = new Date().toISOString().slice(0, 10);

        // 策略：若配置了 AI 服务商，优先用大模型分析 OCR 文字，识别质量更高；
        //       大模型无结果/失败，或未配置 AI 时，回退到本地正则兜底。
        if (provider) {
            try {
                const prompt = `你是一位账单识别助手。请根据以下 OCR 识别的账单文字，提取出交易记录。

要求：
1. 只返回纯 JSON，不要任何解释。
2. 格式：{"items":[{"name":"完整商户名或商品名","amount":100.00,"type":"expense","date":"2026-08-10 13:51:00","note":"补充描述（可选）","category":"分类名","merchant":"对象（商家或个人姓名，可选，如「大味王」「张三」）"}]}
3. name 字段：取最完整的商户/商品名称，不要截断；如果 OCR 中有“商品”行，优先用商品行内容，否则用商户名。
4. amount 必须为正数。
5. date 格式为 YYYY-MM-DD HH:mm:ss；如果账单中只有日期没有时间，时间填 00:00:00。
6. 跳过合计、优惠、退款、找零、应付、实付等汇总行；只保留实际消费/收入的条目。
7. category 必须从下面列表中选择最合适的，尽量细分；如果确实无法判断，返回“其他”。
8. 餐别按时间推断：05-10早餐，10-14午餐，14-21晚餐。
9. 每条的 note 由你**自己生成完整**「场景-对象」格式（用 `-` 连接）。场景 X 由你根据语境自由决定（可以是类目名/消费品/事件，如"早餐""买菜""雪糕"），对象 Y 是识别出的商家或个人（如"老乡鸡""张三""邻几"）。例：「早餐-老乡鸡」「买菜-张三」「雪糕-邻几」。无法确定对象时只写场景（如「晚餐」）。merchant 字段单独存原始对象名（不带场景前缀），与 note 各自独立。

可选分类：早餐|午餐|晚餐|零食|聚餐|外卖|饮料|生鲜|公交地铁|打车|火车飞机|加油|充电|停车费|过路费|日用百货|服装鞋包|数码产品|家居家具|房租|水电燃气|物业费|维修|电影演出|游戏|运动健身|旅游度假|KTV酒吧|门诊|药品|体检|培训课程|书籍|考试报名|话费|宽带|快递|孝敬父母|送礼红包|护肤|美发|主粮零食|社保|商业保险|维保费|车险|其他

OCR文字：
${ocrText}`;

                const content = await callProvider(provider, [
                    { role: 'user', content: prompt }
                ]);
                console.log(`[OCR AI] user=${req.userId} rawReply=${(content || '').slice(0, 500)}`);
                const json = extractJson(content);
                const items = (json && Array.isArray(json.items)) ? json.items : [];
                if (items.length > 0) {
                    return res.json(success({ text: ocrText, items, reason: '' }));
                }
                console.log(`[OCR AI] user=${req.userId} no items from LLM, falling back to regex`);
            } catch (err) {
                console.error(`[OCR AI ERROR] user=${req.userId}`, err && err.message ? err.message : err);
                // LLM 调用失败，继续走正则兜底
            }
        }

        const fallbackItems = fallbackExtractItems(ocrText, today);
        if (fallbackItems.length > 0) {
            console.log(`[OCR REGEX] user=${req.userId} extracted ${fallbackItems.length} items via regex fallback`);
            return res.json(success({ text: ocrText, items: fallbackItems, reason: '' }));
        }

        const reason = provider
            ? 'AI 未能从识别结果中解析出交易项，建议检查 AI 服务商是否可用，或手动输入'
            : '未配置 AI 服务商且未能从 OCR 文字中自动提取交易项，请先配置 AI 服务商或手动输入';
        res.json(success({ text: ocrText, items: [], reason }));
    } catch (err) {
        console.error('[OCR ERROR]', err && err.stack ? err.stack : err);
        handleServerError(res, err, 'OCR 识别');
    }
});

// ==========================================
// AI 对话记账（文字 / 语音转写文本 / 截图多模态）
// 客户端维护对话历史，每次把完整 messages 发上来；截图以 imageBase64 附着在 user 消息或顶层 image 字段。
// 后端用 function calling 真正建账 / 查账，返回 { reply, transactions }。
// ==========================================
router.post('/chat', async (req, res) => {
    try {
        const { messages, image, mime } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json(fail('消息不能为空'));
        const provider = await getActiveProvider(req.userId);
        if (!checkProvider(res, provider)) return;

        // 取用户类目与账户作为工具参考
        const cats = await db.query(
            `SELECT c.id, c.name, c.type, c.icon FROM categories c WHERE (c.user_id IS NULL OR (c.user_id = ? AND (c.book_id IS NULL OR c.book_id = ?))) ORDER BY c.type, c.sort_order`,
            [req.userId, req.bookId]
        );
        const accounts = await db.query(
            `SELECT id, name, icon, type FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active' ORDER BY sort_order`,
            [req.userId, req.bookId]
        );
        const transferCat = await db.queryOne("SELECT id FROM categories WHERE name='转账' AND type='transfer' AND (user_id IS NULL OR user_id=?) LIMIT 1", [req.userId]) || { id: 22 };

        const catRef = cats.length === 0
            ? '（空 — 当前账本没有可用类目，请提示用户去 App「分类管理」检查）'
            : cats.map(c => `- [${c.id}] ${c.name}（${c.type}${c.icon ? ' ' + c.icon : ''}）`).join('\n');
        const accRef = accounts.length === 0
            ? '（空 — 当前账本没有可用账户，请提示用户去 App「账户管理」检查）'
            : accounts.map(a => `- [${a.id}] ${a.name}（${a.type}${a.icon ? ' ' + a.icon : ''}）`).join('\n');

        // 归一化客户端消息：user 消息可携带 imageBase64
        const norm = messages.map(m => {
            if (m.role === 'user' && m.imageBase64) {
                return { role: 'user', content: [{ type: 'text', text: m.content || '' }, { type: 'image', mime: m.mime || 'image/jpeg', data: m.imageBase64 }] };
            }
            return { role: m.role, content: m.content };
        });
        // 顶层 image（可选）附加到最后一条 user 消息
        if (image) {
            const lastUser = [...norm].reverse().find(m => m.role === 'user');
            if (lastUser) {
                lastUser.content = Array.isArray(lastUser.content) ? lastUser.content : [{ type: 'text', text: lastUser.content || '' }];
                lastUser.content.push({ type: 'image', mime: mime || 'image/jpeg', data: image });
            }
        }

        const system = `你是「小鑫」，「鑫钱包」App 的 AI 记账助手，帮助用户通过自然语言完成记账、查账、改账。
规则：
1. 只处理与记账/查账相关的请求；无关的礼貌拒绝。
2. 信息不全（金额或收支方向）时用一句中文追问，不要臆造。
3. 可用工具（共 8 个）：
   - create_transaction（收入/支出）、create_transfer（账户间转账）
   - list_accounts（查账户）、list_categories（查类目）：**实时从数据库拿**，永远是最新的；遇到「用户说的账户/类目名我不确定」「以前看到的列表可能过期」「预投喂为空」时，第一选择是先调它们查到再决策
   - list_transactions（查交易，用于定位修改/删除目标；或建账时按商家名复用历史同类交易的 id）
   - update_transaction / delete_transaction（修改/删除）
   - query_stats（查账问答：余额、月度、排行等）
4. 用户说"把 XX 改成 YY""这笔记错了""删了这笔"时，先调 list_transactions 拿到 transaction_id，再调 update / delete。
5. **不知道账户/类目 id 时不要瞎猜、不要做软匹配**，先调 list_accounts / list_categories 拿到全量再选。
   - 若工具返回的列表里没有用户提到的名字，**立刻在回复里如实告诉用户**「没找到账户『XX』，现有账户：…；要用 YY 吗？」并请用户确认——不要自作主张用名字相近的项顶替。
6. list_accounts / list_categories 的 query 参数是**模糊匹配**（任意子串），可以用「微信」「零钱通」「早餐」等做关键词。
7. 金额用正数；时间默认当前时间；日期格式 YYYY-MM-DD HH:mm:ss。
8. update_transaction 只能修改普通收入/支出（type=income/expense），不能修改转账；删除无此限制。
9. 操作成功后用一句话向用户确认（如"已记一笔：午餐 -38.5（招商银行）""已更新：午餐 13.9 → 外卖 15.0""已删除该笔支出"）。
10. 工具调用返回 {"ok": false, ...} 时表示记账/修改/删除失败，**必须**如实告诉用户失败原因并请其补充或更正，**不得**说"已记/已保存/已完成/已删除"。
    **只有**某个写工具（create_transaction / create_transfer / update_transaction / delete_transaction）真实返回了 {"ok": true, "transaction_id": <数字>}，你才可以在回复里说"已记/已更新/已删除/已完成"。若你只调了 list_accounts / list_categories / list_transactions / query_stats 等**只读**工具、或根本没调任何写工具，就**绝不可**在回复里声称"已记一笔 / 已创建交易 / 记好了 / 已入账 / 已记账成功"——那会误导用户以为已经落账，而账本上其实什么都没有。拿不准是否真的写成功时，宁可说"请到「添加」确认是否记成功"也别说"已记"。
11. 记账时，**你自己**在 note 字段写入完整「场景-对象」格式（用 `-` 连接）。场景 X 由你根据语境自由决定（类目名/消费品/事件，如「早餐」「买菜」「雪糕」），对象 Y 是商家或个人姓名（如「老乡鸡」「张三」「邻几」）。merchant 字段单独存原始对象（纯对象名，不带场景前缀）。无法确定对象时只写场景（如「晚餐」），merchant 留空。
12. 对话风格：像真人在微信/小爱里陪用户记账一样自然。**禁止**在回复中暴露后端工具名（create_transaction / list_accounts 等）、函数调用 JSON 块、调试占位符、思考过程。回复尽量 1-2 句、简洁有温度；如有多个工具并行执行**只总结结果**，不写"我已经为您调用了 xxx 工具"之类机械化开场白。
补充：
- 下方「可用类目」「可用账户」两节是**预投喂**的快速参考（凭 system prompt 即可见），足以应对多数简单场景。但当用户提的账户名与预投喂列表不完全一致、或预投喂为空、或你对此前的列表没把握时，**必须**调 list_accounts / list_categories 实时确认——凭印象编一个 id 会导致记账失败。
- 用户那张截图中「我的工具集里没有列出账户和分类的接口」这句话是**错的**，从 v0.0.44 起本系统确实提供了 list_accounts / list_categories 工具，AI 可以调用它们直接拿到 id。
- 这两节若显式标注「空 — 当前账本没有...」，说明用户该账本下确实没建账户/类目，请建议他去 App「账户管理 / 分类管理」建好后重试。

可用类目：
${catRef}

可用账户：
${accRef}`;

        const tools = [
            {
                name: 'create_transaction',
                description: '创建一笔收入或支出交易。category_id 与 account_id 必须从上面账户/类目列表中选取。',
                parameters: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['income', 'expense'] },
                        amount: { type: 'number', description: '正数金额' },
                        category_id: { type: 'integer' },
                        account_id: { type: 'integer' },
                        date: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss，可省略' },
                        note: { type: 'string', description: '备注/商户名' },
                        merchant: { type: 'string', description: '对象：商家名称或个人姓名（如「大味王」「张三」），留空表示无明确对象' }
                    },
                    required: ['type', 'amount', 'category_id', 'account_id']
                }
            },
            {
                name: 'create_transfer',
                description: '在两个账户间转账（如储蓄卡转余额宝）。from_account_id/to_account_id 从账户列表选取。',
                parameters: {
                    type: 'object',
                    properties: {
                        from_account_id: { type: 'integer' },
                        to_account_id: { type: 'integer' },
                        amount: { type: 'number' },
                        date: { type: 'string' },
                        note: { type: 'string' }
                    },
                    required: ['from_account_id', 'to_account_id', 'amount']
                }
            },
            {
                name: 'list_accounts',
                description: '查当前账本下所有可用账户（可按名称模糊过滤）。返回 [{id, name, type, balance, icon}, ...]。**当你无法确定 account_id 或 from_account_id/to_account_id 时必须先调本工具**——绝不要凭「预投喂列表」硬猜，也不要做软匹配；调本工具后若仍找不到完全匹配的名字，**立刻在回复里告诉用户并请其确认**。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '名称模糊关键词（任意子串，如「微信」「零钱通」「招行」），可省略表示查全部' },
                        limit: { type: 'integer', description: '默认 50，最大 100' }
                    }
                }
            },
            {
                name: 'list_categories',
                description: '查当前账本下所有可用分类（可按名称/类型过滤）。返回 [{id, name, type, icon}, ...]。**当你无法确定 category_id 时必须先调本工具**。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '名称模糊关键词（任意子串，如「早餐」「交通」「外卖」），可省略' },
                        type_filter: { type: 'string', enum: ['income', 'expense'], description: '按收支类型过滤，可省略' },
                        limit: { type: 'integer', description: '默认 50，最大 100' }
                    }
                }
            },
            {
                name: 'list_transactions',
                description: '按关键词、金额、日期范围列出最近交易。两种用途：(a) 定位用户想修改或删除的目标交易（须返回的 transaction_id 喂给 update/delete）；(b) 创建交易时若账户/类目不能确定，可用商家名/场景名（如「大味王」「晚餐」「加油」）做 keyword，查最近 1–3 条同场景的过往交易，复用其 account_id/category_id。返回交易 id、时间、金额、类型、备注、分类、账户。',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: '备注/分类/账户/商家关键词，可省略' },
                        amount: { type: 'number', description: '精确金额，可省略' },
                        date_from: { type: 'string', description: 'YYYY-MM-DD，可省略' },
                        date_to: { type: 'string', description: 'YYYY-MM-DD，可省略' },
                        limit: { type: 'integer', description: '默认 10，最大 20；查历史同类时建议给 3' }
                    }
                }
            },
            {
                name: 'update_transaction',
                description: '修改一笔已存在的普通收入/支出交易（不能修改转账）。transaction_id 必须先从 list_transactions 获取。',
                parameters: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'integer', description: '交易 id' },
                        type: { type: 'string', enum: ['income', 'expense'], description: '新的收支方向' },
                        amount: { type: 'number', description: '新金额（正数）' },
                        category_id: { type: 'integer', description: '新分类 id' },
                        account_id: { type: 'integer', description: '新账户 id' },
                        date: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss，可省略表示不变' },
                        note: { type: 'string', description: '新备注，可省略表示不变' }
                    },
                    required: ['transaction_id', 'type', 'amount', 'category_id', 'account_id']
                }
            },
            {
                name: 'delete_transaction',
                description: '删除一笔已存在的交易（包括转账，会级联删除配对记录）。transaction_id 必须先从 list_transactions 获取。',
                parameters: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'integer', description: '交易 id' }
                    },
                    required: ['transaction_id']
                }
            },
            {
                name: 'query_stats',
                description: '回答查账类问题（本月收入/支出/结余、当前总余额、本月各类目花费、最近交易）。',
                parameters: {
                    type: 'object',
                    properties: {
                        metric: { type: 'string', enum: ['month_income', 'month_expense', 'month_balance', 'total_balance', 'category_this_month', 'recent'] },
                        month: { type: 'string', description: 'YYYY-MM，可省略表示当前月' }
                    },
                    required: ['metric']
                }
            }
        ];

        /**
         * ⚠️ LEGACY（AI v0.2 起标记弃用，本次不改动行为）
         * ------------------------------------------------
         * 下面的 create_transaction / create_transfer 工具会让模型输出【直接写入账本】，
         * 这违反 v0.2 核心原则「AI 输出永不直接写账本，必经 prediction 快照 + 用户确认」。
         *
         * 替代链路（已上线，见本文件末尾）：
         *   POST /api/ai/transactions/parse        → 产出不可变预测快照（不写账本）
         *   POST /api/ai/predictions/:id/commit    → 用户确认后事务内原子落账（幂等）
         *
         * 移除条件：web / android / harmony 三端均切换到新链路后，再删除这两个工具
         *          及其 executeTool 分支。在此之前保留，避免破坏现有客户端。
         */
        async function executeTool(name, args) {
            if (name === 'create_transaction') {
                const type = args.type;
                if (type !== 'income' && type !== 'expense') return { ok: false, error: '收支类型不合法' };
                const amount = toAmount(args.amount);
                if (amount === null || amount <= 0) return { ok: false, error: '金额无效' };
                const accountId = parseInt(args.account_id), categoryId = parseInt(args.category_id);
                const acc = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accountId, req.userId, req.bookId]);
                if (!acc) return { ok: false, error: '账户不存在' };
                const cat = await db.queryOne('SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)', [categoryId, req.userId]);
                if (!cat) return { ok: false, error: '分类不存在' };
                const date = args.date || new Date().toISOString().replace('T', ' ').slice(0, 19);
                const txId = await db.transaction(async (conn) => {
                    // 备注：尊重 AI 给的 note（AI 在 prompt 中被要求按「场景-对象」格式生成）
                    const note = await resolveNote(conn, req.userId, categoryId, args.note, args.merchant);
                    const ins = await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [req.userId, req.bookId, accountId, categoryId, type, amount, note, date,
                        (type === 'expense' ? accountId : null), (type === 'income' ? accountId : null)]
                    );
                    const newBal = await computeAccountBalance(conn, req.userId, accountId);
                    await enforceBalanceLimit(conn, req.userId, accountId, newBal);
                    await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newBal, accountId]);
                    await syncCreditCardDebt(conn, req.userId, accountId);
                    return ins.insertId;
                });
                return { ok: true, transaction_id: txId, type, amount, category_id: categoryId, account_id: accountId };
            }
            if (name === 'create_transfer') {
                const fromId = parseInt(args.from_account_id), toId = parseInt(args.to_account_id);
                const amount = toNumber(args.amount);
                if (!fromId || !toId) return { ok: false, error: '请选择转出和转入账户' };
                if (fromId === toId) return { ok: false, error: '转出和转入账户不能相同' };
                if (amount === null || amount <= 0) return { ok: false, error: '金额无效' };
                const fromAcc = await db.queryOne('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [fromId, req.userId, req.bookId]);
                if (!fromAcc) return { ok: false, error: '转出账户不存在' };
                const date = args.date || new Date().toISOString().replace('T', ' ').slice(0, 19);
                const txId = await db.transaction(async (conn) => {
                    const ins = await conn.query(
                        `INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
                        [req.userId, req.bookId, fromId, toId, amount, args.note || '', date]
                    );
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                         VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
                        [req.userId, req.bookId, fromId, transferCat.id, amount, `转账至${fromAcc.name}`, date, ins.insertId, fromId]
                    );
                    const toAcc = await db.queryOne('SELECT name FROM accounts WHERE id = ?', [toId]);
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                         VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
                        [req.userId, req.bookId, toId, transferCat.id, amount, `来自${toAcc ? toAcc.name : '转账'}`, date, ins.insertId, toId]
                    );
                    const fromBal = await computeAccountBalance(conn, req.userId, fromId);
                    const toBal = await computeAccountBalance(conn, req.userId, toId);
                    await enforceBalanceLimit(conn, req.userId, fromId, fromBal);
                    await enforceBalanceLimit(conn, req.userId, toId, toBal);
                    await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2', [fromBal, fromId]);
                    await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2', [toBal, toId]);
                    return ins.insertId;
                });
                return { ok: true, transaction_id: txId, type: 'transfer', amount, from_account_id: fromId, to_account_id: toId };
            }
            if (name === 'query_stats') {
                const metric = args.metric;
                const month = args.month || new Date().toISOString().slice(0, 7);
                if (metric === 'total_balance') {
                    const rows = await db.query("SELECT COALESCE(SUM(balance),0) as b FROM accounts WHERE user_id = $1 AND book_id = $2 AND status='active'", [req.userId, req.bookId]);
                    return { ok: true, metric, value: parseFloat(rows[0].b) };
                }
                if (metric === 'month_income' || metric === 'month_expense' || metric === 'month_balance') {
                    const rows = await db.query(
                        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) as inc,
                                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) as exp
                         FROM transactions WHERE user_id = ? AND book_id = ? AND CAST(date AS CHAR(10)) LIKE ? AND type IN ('income','expense')`,
                        [req.userId, req.bookId, month + '%']
                    );
                    const inc = parseFloat(rows[0].inc), exp = parseFloat(rows[0].exp);
                    const value = metric === 'month_income' ? inc : metric === 'month_expense' ? exp : (inc - exp);
                    return { ok: true, metric, month, value };
                }
                if (metric === 'category_this_month') {
                    const rows = await db.query(
                        `SELECT c.name, COALESCE(SUM(t.amount),0) as amt FROM transactions t
                         LEFT JOIN categories c ON t.category_id = c.id
                         WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ? AND t.type='expense'
                         GROUP BY c.name ORDER BY amt DESC LIMIT 8`,
                        [req.userId, req.bookId, month + '%']
                    );
                    return { ok: true, metric, month, rows: rows.map(r => ({ name: r.name, amount: parseFloat(r.amt) })) };
                }
                if (metric === 'recent') {
                    const rows = await db.query(
                        `SELECT t.amount, t.type, t.note, t.date, c.name as cat FROM transactions t
                         LEFT JOIN categories c ON t.category_id=c.id WHERE t.user_id=? AND t.book_id=? ORDER BY t.date DESC, t.id DESC LIMIT 5`,
                        [req.userId, req.bookId]
                    );
                    return { ok: true, metric, rows: rows.map(r => ({ amount: parseFloat(r.amount), type: r.type, note: r.note, date: r.date, category: r.cat })) };
                }
                return { ok: false, error: '不支持的查询类型' };
            }
            if (name === 'list_accounts') {
                const query = args.query ? `%${args.query}%` : null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 50, 1), 100);
                const rows = await db.query(
                    `SELECT id, name, type, balance, icon FROM accounts
                     WHERE user_id = $1 AND book_id = $2 AND status = 'active'
                       ${query ? 'AND name LIKE $3' : ''}
                     ORDER BY sort_order, id LIMIT ${limit}`,
                    query ? [req.userId, req.bookId, query] : [req.userId, req.bookId]
                );
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        account_id: r.id, name: r.name, type: r.type,
                        balance: parseFloat(r.balance), icon: r.icon
                    }))
                };
            }
            if (name === 'list_categories') {
                const query = args.query ? `%${args.query}%` : null;
                const typeFilter = args.type_filter || null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 50, 1), 100);
                const params = [req.userId, req.bookId];
                let sql = `SELECT id, name, type, icon FROM categories
                           WHERE (user_id IS NULL OR (user_id = $1 AND (book_id IS NULL OR book_id = $2)))`;
                if (query) { sql += ' AND name LIKE $3'; params.push(query); }
                if (typeFilter) { params.push(typeFilter); sql += ` AND type = $${params.length}`; }
                sql += ' ORDER BY type, sort_order LIMIT ' + limit;
                const rows = await db.query(sql, params);
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        category_id: r.id, name: r.name, type: r.type, icon: r.icon
                    }))
                };
            }
            if (name === 'list_transactions') {
                const keyword = args.keyword ? `%${args.keyword}%` : null;
                const amount = toAmount(args.amount);
                const dateFrom = args.date_from || null;
                const dateTo = args.date_to || null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 10, 1), 20);
                let sql = `SELECT t.id, t.amount, t.type, t.note, t.date, c.name as cat, a.name as acc
                           FROM transactions t
                           LEFT JOIN categories c ON t.category_id=c.id
                           LEFT JOIN accounts a ON t.account_id=a.id
                           WHERE t.user_id=? AND t.book_id = ?`;
                const params = [req.userId, req.bookId];
                if (keyword) { sql += ' AND (t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)'; params.push(keyword, keyword, keyword); }
                if (amount !== null && amount > 0) { sql += ' AND t.amount = ?'; params.push(amount); }
                if (dateFrom) { sql += ' AND t.date >= ?'; params.push(dateFrom); }
                if (dateTo) { sql += ' AND t.date <= ?'; params.push(dateTo); }
                sql += ' ORDER BY t.date DESC, t.id DESC LIMIT ?';
                params.push(limit);
                const rows = await db.query(sql, params);
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        transaction_id: r.id, amount: parseFloat(r.amount), type: r.type,
                        note: r.note, date: fmtDateTime(r.date), category: r.cat, account: r.acc
                    }))
                };
            }
            if (name === 'update_transaction') {
                const txId = parseInt(args.transaction_id);
                const type = args.type;
                if (!txId) return { ok: false, error: '缺少交易 id' };
                if (type !== 'income' && type !== 'expense') return { ok: false, error: '只能修改普通收入/支出' };
                const amount = toAmount(args.amount);
                if (amount === null || amount <= 0) return { ok: false, error: '金额无效' };
                const accountId = parseInt(args.account_id), categoryId = parseInt(args.category_id);
                const acc = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accountId, req.userId, req.bookId]);
                if (!acc) return { ok: false, error: '账户不存在' };
                const cat = await db.queryOne('SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)', [categoryId, req.userId]);
                if (!cat) return { ok: false, error: '分类不存在' };
                const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [txId, req.userId, req.bookId]);
                if (!old) return { ok: false, error: '交易不存在' };
                if (old.type === 'transfer_in' || old.type === 'transfer_out') return { ok: false, error: '转账请删除后重新记账' };
                const date = args.date || fmtDateTime(old.date);
                const note = args.note !== undefined ? args.note : old.note;
                const src = type === 'expense' ? accountId : null;
                const dst = type === 'income' ? accountId : null;
                await db.transaction(async (conn) => {
                    await conn.query(
                        `UPDATE transactions SET account_id=?, category_id=?, type=?, amount=?, note=?, date=?, source_account_id=?, destination_account_id=? WHERE id=? AND user_id=? AND book_id=?`,
                        [accountId, categoryId, type, amount, note || '', date, src, dst, txId, req.userId, req.bookId]
                    );
                    const affected = new Set([parseInt(old.account_id), accountId]);
                    const newBalances = {};
                    for (const aid of affected) newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
                    for (const aid of affected) await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
                    for (const aid of affected) {
                        await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newBalances[aid], aid]);
                        await syncCreditCardDebt(conn, req.userId, aid);
                    }
                });
                return { ok: true, transaction_id: txId, action: 'updated', type, amount };
            }
            if (name === 'delete_transaction') {
                const txId = parseInt(args.transaction_id);
                if (!txId) return { ok: false, error: '缺少交易 id' };
                const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [txId, req.userId, req.bookId]);
                if (!old) return { ok: false, error: '交易不存在' };
                let deletedType = old.type;
                await db.transaction(async (conn) => {
                    const affectedAccounts = new Set([parseInt(old.account_id)]);
                    if (old.transfer_id) {
                        const paired = await conn.query(
                            'SELECT id, account_id FROM transactions WHERE transfer_id = $1 AND id != $2 AND user_id = $3 AND book_id = $4',
                            [old.transfer_id, txId, req.userId, req.bookId]
                        );
                        paired.forEach(p => { affectedAccounts.add(parseInt(p.account_id)); });
                        await conn.query('DELETE FROM transactions WHERE transfer_id = $1 AND user_id = $2 AND book_id = $3', [old.transfer_id, req.userId, req.bookId]);
                        await conn.query('DELETE FROM transfers WHERE id = $1 AND user_id = $2 AND book_id = $3', [old.transfer_id, req.userId, req.bookId]);
                    } else {
                        await conn.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2 AND book_id = $3', [txId, req.userId, req.bookId]);
                    }
                    const newBalances = {};
                    for (const aid of affectedAccounts) newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
                    for (const aid of affectedAccounts) await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
                    for (const aid of affectedAccounts) {
                        await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newBalances[aid], aid]);
                        await syncCreditCardDebt(conn, req.userId, aid);
                    }
                });
                return { ok: true, transaction_id: txId, action: 'deleted', type: deletedType, amount: parseFloat(old.amount) };
            }
            return { ok: false, error: '未知工具 ' + name };
        }

        const conv = [{ role: 'system', content: system }, ...norm];
        let reply = '';
        const mutations = [];
        const toolErrors = [];
        let unfinished = false;
        let writeSucceeded = false;
        const MAX_LOOPS = 5;
        for (let i = 0; i < MAX_LOOPS; i++) {
            const msg = await chatWithTools(provider, conv, tools);
            conv.push(msg);
            if (!msg.toolCalls || msg.toolCalls.length === 0) { reply = stripThinkingTokens(msg.content || ''); break; }
            for (const tc of msg.toolCalls) {
                const result = await executeTool(tc.name, tc.arguments || {});
                conv.push({ role: 'tool', toolCallId: tc.id, content: JSON.stringify(result) });
                if (!result.ok) toolErrors.push(result.error || '操作失败');
                if (result.ok && result.transaction_id) {
                    writeSucceeded = true;
                    const action = result.action || 'created';
                    if (action === 'deleted') {
                        mutations.push({
                            id: result.transaction_id, action,
                            type: result.type || 'expense',
                            amount: parseFloat(result.amount || 0),
                            categoryName: '', accountName: '', date: ''
                        });
                    } else {
                        const t = await db.queryOne(
                            `SELECT t.amount, t.type, t.note, t.date, c.name as cat, a.name as acc
                             FROM transactions t LEFT JOIN categories c ON t.category_id=c.id LEFT JOIN accounts a ON t.account_id=a.id
                             WHERE t.id=? AND t.user_id=? AND t.book_id = ?`,
                            [result.transaction_id, req.userId, req.bookId]
                        );
                        if (t) mutations.push({ id: result.transaction_id, action, type: t.type, amount: parseFloat(t.amount), categoryName: t.cat, accountName: t.acc, date: fmtDateTime(t.date) });
                    }
                }
            }
            // 最后一轮仍要求调工具：说明步骤太多/循环用尽，本次未完整执行
            if (i === MAX_LOOPS - 1) unfinished = true;
        }
        // reply 兜底前先按真实执行状态修正，避免"没记却回复已记"
        if (!reply || reply === '已完成处理。') {
            if (unfinished) reply = '本次处理步骤较多未能全部完成，请再说一次或补充信息后重试。';
            else if (toolErrors.length > 0) reply = '记录失败：' + toolErrors[0] + '，请补充或更正后重试。';
            else reply = '已完成处理。';
        } else {
            // 关键安全网：AI 文案声称"已记/已创建交易/记好了/已入账"等成功口吻，
            // 但本次没有任何写工具真正返回 {"ok": true, "transaction_id"}（writeSucceeded=false）。
            // 典型场景：思考模型只调了 list_* 只读工具就"脑补"已记账，或写工具报错失败。
            // 此时账本上其实什么都没有，必须如实纠正，杜绝"假成功"误导用户。
            const claimsRecorded = /已记(一笔|账|好|录)?|已创建(了)?交易|记好了|已保存(到账本)?|已入账|已成功记账|已为您记[账录]|记录成功|记账成功|成功记[账入]/.test(reply);
            if (claimsRecorded && !writeSucceeded) {
                const reason = toolErrors.length > 0
                    ? ('：' + toolErrors[0])
                    : '：系统检测到本次并未真正调用记账工具写入账本';
                reply = '很抱歉，这笔其实没有记录成功' + reason + '。请确认金额与收支方向，或到「添加」手动记一笔。';
            } else if (toolErrors.length > 0 && mutations.length === 0) {
                // 兜底：文案未明确声称成功但确有工具报错且无落库
                reply = '很抱歉，这笔没有记录成功：' + toolErrors[0] + '。' + reply;
            }
        }
        // 最终再剥离一次思考标记（覆盖任何遗漏路径），并兜底空回复
        reply = stripThinkingTokens(reply || '');
        if (!reply) reply = '已完成处理。';
        // AI 记账回复修饰：去除「机械化前缀」、隐藏工具名/调试字样，并按真实落账结果追加自然口语。
        // 注意：此处**不会**修改 mutations（transactions 卡片）——前端 ChatBubble 渲染完全不变。
        reply = polishChatReply(reply, writeSucceeded);
        res.json(success({ reply, transactions: mutations }));
    } catch (err) {
        if (err && err.isAiProviderError) return res.status(err.statusCode || 502).json(fail(err.message));
        handleServerError(res, err, 'AI 对话');
    }
});

// 语音转文字：自动查找用户配置的 OpenAI 兼容服务商（支持 /audio/transcriptions）
// MiniMax 不提供公开的独立语音转写 API，需另配 OpenAI 兼容服务商（如 Groq 免费 Whisper）
router.post('/transcribe', async (req, res) => {
    try {
        const { audio, mime } = req.body;
        if (!audio) return res.status(400).json(fail('缺少音频'));
        const provider = await getTranscriptionProvider(req.userId);
        if (!provider) return res.status(400).json(fail('语音转写需要一个支持 /audio/transcriptions 的 OpenAI 兼容服务商。请在设置中额外配置一个（如 Groq 免费 Whisper、OpenAI 等），语音转写将自动使用该服务商'));

        // 确定转写模型：Groq 用 whisper-large-v3，OpenAI 用 whisper-1，服务商 model 含 whisper 则直接用
        let whisperModel = 'whisper-1';
        const baseUrl = (provider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
        if (baseUrl.includes('groq.com')) whisperModel = 'whisper-large-v3';
        if (provider.model && provider.model.toLowerCase().includes('whisper')) whisperModel = provider.model;

        const url = baseUrl + '/audio/transcriptions';
        const boundary = '----xinwallet' + Date.now();
        const fileData = Buffer.from(audio, 'base64');
        const extMap = {
            'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
            'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
            'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/oga': 'ogg'
        };
        const ext = extMap[mime] || 'bin';
        const ctype = mime || 'application/octet-stream';
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${ctype}\r\n\r\n`),
            fileData,
            Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n--${boundary}--\r\n`)
        ]);
        const data = await httpsPostRaw(url, { 'Authorization': `Bearer ${provider.api_key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body);
        const text = (typeof data === 'string') ? data : (data && data.text);
        if (!text) return res.status(502).json(fail('语音转写失败：服务商未返回文字'));
        res.json(success({ text }));
    } catch (err) {
        if (err && err.isAiProviderError) return res.status(err.statusCode || 502).json(fail(err.message));
        handleServerError(res, err, '语音转写');
    }
});

/* ============================================
   AI v0.2 · 预测闭环（Phase 1）
   ------------------------------------------------
   核心原则：AI 输出【永不直接写账本】。
   链路：parse（产出不可变预测快照）→ 用户确认/修正 → commit（事务内原子落账）
        或 discard（弃置，不形成负面学习）。

   与上方 legacy 直写路径（/chat 的 create_transaction 工具调用，约 L1044）的关系：
   本次【不改动】legacy 行为，二者并存；待 web/android/harmony 三端切到本链路后再移除 legacy。
   ============================================ */

const aiModule = require('../modules/ai');

// source 表示【输入通道】而非客户端平台，取值必须与 schema 的 ai_predictions_source_check 一致。
// 客户端平台（web/android/harmony）请放在 context.platform，避免通道枚举被平台维度污染。
const AI_PREDICTION_SOURCES = ['parse', 'chat', 'ocr', 'voice'];

// ---- POST /api/ai/transactions/parse ----
// 自然语言 → 候选交易 + 字段级置信度裁决 + 不可变预测快照
router.post('/transactions/parse', async (req, res) => {
    try {
        const text = (req.body && req.body.text) || '';
        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json(fail('请提供要解析的文本'));
        }
        if (text.length > 2000) {
            return res.status(400).json(fail('文本过长（最多 2000 字）'));
        }

        // 在入口拦下非法 source：否则会在 INSERT 时撞 CHECK 约束，用户只能看到 500
        const source = (req.body && req.body.source) || 'parse';
        if (!AI_PREDICTION_SOURCES.includes(source)) {
            return res.status(400).json(fail(`source 必须是 ${AI_PREDICTION_SOURCES.join(' / ')} 之一`));
        }

        const context = (req.body && req.body.context) || {};
        const { transactions, validation, decision_trace } = await aiModule.parseTransactions(db, {
            userId: req.userId,
            bookId: req.bookId,
            text,
            context,
        });

        if (!transactions.length) {
            return res.status(422).json(fail('未能从文本中识别出交易信息'));
        }

        const predictionId = await aiModule.createPrediction({
            userId: req.userId,
            bookId: req.bookId,
            source,
            text,
            context,
            transactions,
            validation,
            decisionTrace: decision_trace,
        });

        res.json(success({
            prediction_id: predictionId,
            transactions,
            verdict: validation.verdict,
            overall_confidence: validation.overall,
            reasons: validation.reasons,
            // 前端据此决定是否弹确认框
            needs_confirmation: validation.verdict !== 'ready',
        }));
    } catch (err) {
        handleServerError(res, err, 'AI 解析交易');
    }
});

// ---- GET /api/ai/predictions/:id ----
// 读取预测快照；decision_trace（证据链）仅属主可见
router.get('/predictions/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const pred = await aiModule.getPrediction(id, req.userId);
        if (!pred) return res.status(404).json(fail('预测不存在'));

        res.json(success({
            prediction_id: pred.id,
            status: pred.status,
            verdict: pred.verdict,
            source: pred.source,
            prediction_version: pred.prediction_version,
            request: pred.request,
            transactions: pred.candidate_txns,
            validation: pred.validation,
            decision_trace: pred.decision_trace,   // 已通过 user_id 过滤，属主可见
            final_txns: pred.final_txns,
            final_diff: pred.final_diff,
            committed_at: pred.committed_at,
            created_at: pred.created_at,
        }));
    } catch (err) {
        handleServerError(res, err, '查询 AI 预测');
    }
});

// ---- POST /api/ai/predictions/:id/commit ----
// 原子提交：事务内落账 + 关联 + 状态更新 + 反馈事件；支持幂等重放
router.post('/predictions/:id/commit', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const action = (req.body && req.body.action) || 'confirmed';
        if (action !== 'confirmed' && action !== 'corrected') {
            return res.status(400).json(fail("action 必须是 'confirmed' 或 'corrected'"));
        }
        const correctedTxns = req.body && req.body.transactions;
        if (action === 'corrected' && !Array.isArray(correctedTxns)) {
            return res.status(400).json(fail("action='corrected' 时必须提供 transactions 数组"));
        }

        const idempotencyKey = (req.body && req.body.idempotency_key) || null;
        if (idempotencyKey && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 64)) {
            return res.status(400).json(fail('idempotency_key 必须是 64 字符以内的字符串'));
        }

        const result = await aiModule.commitPrediction(
            id, req.userId, req.bookId, action, correctedTxns, idempotencyKey
        );

        // prediction-store 返回 { status, body }，统一包装成项目响应格式
        if (result.status === 200) {
            return res.json(success(result.body));
        }
        return res.status(result.status).json(fail(result.body.error, result.body.details));
    } catch (err) {
        handleServerError(res, err, '提交 AI 预测');
    }
});

// ---- POST /api/ai/predictions/:id/discard ----
// 弃置预测：仅记录事件，不默认形成负向学习
router.post('/predictions/:id/discard', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的预测 ID'));

        const reason = (req.body && req.body.reason) || '';
        const result = await aiModule.discardPrediction(id, req.userId, req.bookId, reason);

        if (result.status === 200) return res.json(success(result.body));
        return res.status(result.status).json(fail(result.body.error));
    } catch (err) {
        handleServerError(res, err, '弃置 AI 预测');
    }
});

module.exports = router;
