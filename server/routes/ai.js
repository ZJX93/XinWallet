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
// AI v0.2 模块桶：图片通道（/ocr）与预测闭环（/transactions/parse）都要用。
// ⚠️ 必须在顶部 require —— 图片通道位于文件中段，const 的 TDZ 会让「写在下面」直接 ReferenceError。
// ⛔ 路由层【只能】依赖这个桶文件。原先直接 require 的 extraction/category-matcher
//    已随 legacy 解析器一并移除（它是那 253 行的唯一使用者）。
const aiModule = require('../modules/ai');

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

/*  ⛔ 原腾讯云 OCR SDK 惰性加载器已迁到 `modules/ai/vision/image-transcriber.js`。
    路由层不再直接碰 SDK —— 转录（图片→文字）整体属于 vision 层的职责。   */

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
                content: `你是一位资深个人理财顾问。基于用户完整财务数据，一次性输出两段：
1) insights 观察型分析 3-5 条：本月发生了什么（异常、环比、债务负担、储蓄率、资金健康度）
2) advice 建议型条目 3-5 条：下月怎么做（可量化动作、含 impact 预期效果）

要求（两段均须遵守）：
1. insights 优先针对真实风险（某类超支、环比激增、预算执行率异常、储蓄目标滞后、负债过高、逾期风险）
2. 若用户有负债，必须分析负债资产比（>50%警戒）、月供占收入比（>40%高压）、逾期笔数；advice 给出对应降债/还款建议
3. 每条必须基于具体数据，给出可量化、可操作方向
4. advice 必须能在 insights 之外提供新信息（不可只是 insights 的同义改写）

返回纯 JSON，schema 如下：
{
  "insights":[{"title":"≤8字","description":"≤45字含数据","action":"≤15字","level":"warning|info|tip"}],
  "advice":[{"title":"≤8字","content":"≤45字含数据","impact":"≤15字","priority":"high|medium|low"}]
}

不要 markdown、不要解释、不要超出字段。`
            },
            { role: 'user', content: JSON.stringify(context, null, 0) }
        ]);
        const json = extractJson(content);
        const advice = (json && Array.isArray(json.advice)) ? json.advice : [];
        const insights = (json && Array.isArray(json.insights)) ? json.insights : [];
        res.json(success({ advice, insights, generatedAt: new Date().toISOString() }));
    } catch (err) { handleServerError(res, err); }
});

// ⚠️ /ai/insight 已合并进 /ai/advice（v0.2.1，2026-08-27）：insights 改为随 advice 一起返回。
// 路由保留仅作软弃过渡，前端切完可整体删除。任何调用都返回 410 + 引导文案，避免静默拿空数据。
router.post('/insight', async (req, res) => {
    return res.status(410).json(fail(
        '/ai/insight 已废弃，请改用 POST /ai/advice（同时返回 insights + advice）。',
        { deprecated: true, replacement: '/ai/advice' }
    ));
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

/*  ⛔ 原 `fallbackExtractItems`（253 行 legacy OCR 正则解析器）已于 2026-08-25 删除。
    能力去处：`modules/ai/vision/receipt-preprocessor.js`
      · 5 套版式策略全部迁走，并【新补】策略 1b（竖排标签版式，legacy 全漏）
      · 类目词表此前已并入 `extraction/category-matcher.js`
    ⛔ 别在这里重新写第二套抽取逻辑 —— legacy 之所以要删，就是因为它让
       图片通道和文字通道各有一个大脑，规则学到的习惯在图片上完全不生效。   */

// ==========================================
// 图片记账（v0.2 图片通道）
// ------------------------------------------------
// 链路：图片 → 【转录层】→ 文字 → v0.2 主链路 → 不可变预测 → 用户确认 → 原子落账
//
// 转录层两条通道（modules/ai/vision/image-transcriber.js）：
//   ① 大模型多模态直读（主路）
//   ② 腾讯云 OCR 纯文字转录（兜底）
//
// ⛔⛔ 腾讯云 OCR 在本方案里【只提供识别能力，不参与任何学习】。
//     它的产物就是一段纯文字，与用户手打的文字在下游完全同权 ——
//     同一个抽取器、同一套记忆检索、同一个决策引擎、同一套规则。
//     兜底触发条件三种：
//       A. 当前模型不具备图片理解能力（vision_support='no' 或模型名预判不支持）
//       B. 大模型读图失败/超时/回复「我看不到图片」
//       C. 用户主动说「识别有误」→ POST /ocr/retranscribe（force=tencent_ocr）
//
// ⛔ 为什么废掉原来那套「OCR 文字 → 自己拼 prompt → 344 行正则兜底」：
//    它让图片通道和文字通道各有一套抽取逻辑与置信度，
//    结果规则学到的习惯在图片通道完全不生效（「越用越聪明」在图片上失效）。
//    现在两条通道共用一个大脑，学习成果自动对图片生效。
// ==========================================

/** 把 v0.2 候选交易映射回老客户端的 items 形状（安卓 OcrItem / 鸿蒙 OcrResponse.items） */
function toLegacyOcrItems(transactions) {
    return (transactions || []).map(t => ({
        name: t.merchant || t.category_name || t.raw_segment || '未命名',
        amount: t.amount,
        type: t.type,
        // 老客户端期望 'YYYY-MM-DD HH:mm:ss'，v0.2 只给日期 → 补 00:00:00
        date: t.date ? `${t.date} 00:00:00` : null,
        note: t.note || '',
        // 老客户端按【类目名】匹配本地 id，不是 id
        category: t.category_name || '其他',
        merchant: t.merchant || null,
    }));
}

/**
 * 图片记账的共用实现：转录 → 解析 → 落预测快照。
 * @param {'model'|'tencent_ocr'} [force] 强制指定转录器
 */
async function handleImageAccounting(req, res, imageBase64, mime, force) {
    if (!imageBase64) return res.status(400).json(fail('图片内容为空'));

    // provider 取不到不算错：转录层会直接走腾讯 OCR 兜底
    const provider = await getActiveProvider(req.userId);
    if (provider && provider._decryptFailed) {
        return res.status(400).json(fail('检测到 AI 服务商配置，但密钥解密失败（很可能是重部署后加密密钥 ENCRYPTION_KEY 变更）。请前往「AI 配置」页重新保存该服务商的 API Key。'));
    }

    // ── 第一步：转录（图片 → 文字）────────────────────────────────
    const tr = await aiModule.transcribeImage({
        db, userId: req.userId, imageBase64, mime,
        provider: provider && !provider._decryptFailed ? provider : null,
        force,
    });
    console.log(`[图片记账] user=${req.userId} force=${force || '-'} ok=${tr.ok} source=${tr.source || '-'} textLen=${(tr.text || '').length} attempts=${JSON.stringify(tr.attempts)}`);

    if (!tr.ok) {
        // ⚠️ fail(msg, code) 的第二参数是【错误码】不是附加数据（_helpers.js:16）。
        //    附加信息只能挂在返回对象上，不能塞进 fail()。
        return res.status(400).json({
            ...fail(tr.error),
            needs_ocr_config: !!tr.needs_ocr_config,
            transcribe_attempts: tr.attempts,
        });
    }

    // ── 第二步：票据版式预处理（仅当文本确实是账单版式）──────────
    /*  ⛔⛔ 这一步不能省。实测（2026-08-25）把账单 OCR 原文直接喂给 v0.2 抽取器：
          · 交易单号 4200002891202608201234567890 → 抽出一笔 4.2e27 元
          · 支付时间 08:12:33 的「08」→ 抽出一笔 8 元
          · 商户名一个都抽不到，全落「其他支出」
        根因是抽取器为【自然语言】设计（假设文中数字就是金额），
        而账单版式满是单号/时间戳，且商户名与金额分处不同行。
        ⇒ 先把版式整理成「老乡鸡 18元」这类干净语句，抽取器的输入假设才成立。
        ⚠️ looksLikeReceipt 判定为 false（用户手打的文字）时【原样放行】，
           绝不能让预处理误伤文字通道。 */
    let parseText = tr.text;
    let receiptInfo = null;
    let merchantHints = [];
    let receiptDate = null;
    if (aiModule.looksLikeReceipt(tr.text)) {
        const pre = aiModule.preprocessReceipt(tr.text, { defaultDate: new Date().toISOString().slice(0, 10) });
        if (pre.ok) {
            parseText = pre.text;
            receiptInfo = { strategy: pre.strategy, item_count: pre.items.length };
            // 预处理已从「商户全称」标签行确定了商家名 → 直接给抽取器，别让它再猜
            // ⚠️ 复用同一次预处理结果，绝不重复调用（两次结果漂移就查不清了）
            merchantHints = pre.items.map(i => i.name);
            /*  票据日期要当作参考日传下去。
                ⛔ 否则记的是【上传当天】而不是【消费当天】：用户周一补记上周五的
                   小票，日期会全部错成周一，而且完全不报错 —— 只能靠人肉核对发现。 */
            receiptDate = pre.items.map(i => i.date).filter(Boolean).sort()[0] || null;
            console.log(`[图片记账] user=${req.userId} 票据预处理命中 strategy=${pre.strategy} → ${pre.items.length} 行 日期=${receiptDate || '-'}`);
        } else {
            // 判定像票据但一条策略都没命中 → 退回原文，交给主链路尽力而为
            console.log(`[图片记账] user=${req.userId} 判定为票据但无策略命中，退回原文解析`);
        }
    }

    // ── 第三步：文字 → v0.2 主链路（与手打文字完全同路）──────────
    /*  ⚠️ account_id 必须由客户端在上传时一并给出。
        v0.2 的抽取器【不推断账户】（票据上通常也没有「我的哪张卡」这种信息），
        而 commit 阶段缺 account_id 会直接 422「第N笔未指定账户」。
        ⇒ 前端的图片上传界面必须带账户选择器，默认取上次使用的账户。 */
    const imageContext = {
        channel: 'image',
        transcribe_source: tr.source,
        receipt: receiptInfo,
        merchant_hints: merchantHints,
        account_id: toNumber(req.body && req.body.account_id) || null,
        platform: (req.body && req.body.platform) || 'unknown',
    };
    if (receiptDate) imageContext.date = receiptDate;

    const parsed = await aiModule.parseTransactions(db, {
        userId: req.userId,
        bookId: req.bookId,
        text: parseText,
        context: imageContext,
    });
    const { transactions, validation, decision_trace } = parsed;

    // 转录成功但抽不出交易：把转录文字回给前端，用户可以手工改文字再解析
    if (!transactions.length) {
        return res.json(success({
            text: tr.text,
            items: [],
            transcribe_source: tr.source,
            transcribe_attempts: tr.attempts,
            reason: tr.source === 'tencent_ocr'
                ? '腾讯云 OCR 已读出文字，但未能从中识别出交易项。可直接编辑下方文字后重新解析。'
                : 'AI 已读出文字，但未能识别出交易项。可点「换腾讯云 OCR 重试」，或编辑下方文字后重新解析。',
        }));
    }

    // ── 第四步：落不可变预测快照（source='ocr'，与文字通道共用同一张表）──
    const predictionId = await aiModule.createPrediction({
        userId: req.userId,
        bookId: req.bookId,
        source: 'ocr',
        text: tr.text,
        // ⚠️ 快照存【完整】context（含 receipt / merchant_hints / account_id），
        //    否则事后复盘时看不出「当时是按哪套版式策略解的」。
        context: imageContext,
        transactions,
        validation,
        decisionTrace: decision_trace,
        memorySnapshot: parsed.memory_snapshot,
        modelRequest: parsed.model_request,
        modelResponse: parsed.model_response,
        route: parsed.route,
    });

    res.json(success({
        // ---- v0.2 新字段 ----
        prediction_id: predictionId,
        transactions,
        verdict: validation.verdict,
        overall_confidence: validation.overall,
        reasons: validation.reasons,
        needs_confirmation: validation.verdict !== 'ready',
        route: parsed.route,
        complexity: decision_trace.complexity ? decision_trace.complexity.level : 'simple',
        memory_applied: decision_trace.memory ? decision_trace.memory.applied : [],
        // 谁读的图：前端据此显示来源标签，并决定是否给出「换腾讯 OCR 重试」入口
        transcribe_source: tr.source,
        transcribe_attempts: tr.attempts,

        // ---- 老字段（三端现有客户端仍在读，务必保留）----
        text: tr.text,
        items: toLegacyOcrItems(transactions),
        reason: '',
    }));
}

// OCR / 图片识别（multipart 上传，安卓在用）
router.post('/ocr', upload.single('image'), async (req, res) => {
    try {
        // 兼容鸿蒙：它走 JSON body 传 base64（Api.ts: post('ai/ocr', { image })）
        const imageBase64 = req.file
            ? req.file.buffer.toString('base64')
            : (req.body && req.body.image ? String(req.body.image).replace(/^data:[^,]+,/, '') : '');
        if (!imageBase64) return res.status(400).json(fail('请上传图片'));

        const mime = req.file ? req.file.mimetype : (req.body && req.body.mime) || 'image/jpeg';
        // force 允许直接指定（便于前端一次到位地选转录器）
        const force = normalizeForce(req.body && req.body.force);
        await handleImageAccounting(req, res, imageBase64, mime, force);
    } catch (err) {
        console.error('[图片记账 ERROR]', err && err.stack ? err.stack : err);
        handleServerError(res, err, '图片识别');
    }
});

// ---- POST /api/ai/ocr/retranscribe ----
// 用户说「识别有误」时调用：强制用腾讯云 OCR 重新转录同一张图。
// ⛔ 为什么是独立接口而不是给 /ocr 加参数就完事：
//    语义不同。/ocr 是「帮我认这张图」，本接口是「上一次认错了，换个引擎再认」——
//    独立出来前端才能给出明确的按钮文案，日志也能分开统计两者的成功率
//    （§12 要求可比较，混在一个端点里就永远算不出「兜底救回率」）。
router.post('/ocr/retranscribe', upload.single('image'), async (req, res) => {
    try {
        const imageBase64 = req.file
            ? req.file.buffer.toString('base64')
            : (req.body && req.body.image ? String(req.body.image).replace(/^data:[^,]+,/, '') : '');
        if (!imageBase64) return res.status(400).json(fail('请重新上传图片'));

        const mime = req.file ? req.file.mimetype : (req.body && req.body.mime) || 'image/jpeg';
        // 默认强制腾讯 OCR：这个接口存在的意义就是换引擎
        const force = normalizeForce(req.body && req.body.force) || 'tencent_ocr';
        await handleImageAccounting(req, res, imageBase64, mime, force);
    } catch (err) {
        console.error('[图片重转录 ERROR]', err && err.stack ? err.stack : err);
        handleServerError(res, err, '重新识别');
    }
});

function normalizeForce(v) {
    const s = String(v || '').trim();
    return (s === 'model' || s === 'tencent_ocr') ? s : null;
}

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

        const system = `你是「小鑫」，「鑫钱包」App 的 AI 记账助手，帮助用户查账、改账、答疑。
规则：
1. 只处理与记账/查账相关的请求；无关的礼貌拒绝。
2. 信息不全（金额或收支方向）时用一句中文追问，不要臆造。
3. ⛔ **你没有「新建交易」的能力**。本对话里不存在 create_transaction / create_transfer 工具。
   用户说「记一笔 / 帮我记账 / 花了多少」这类**新建**需求时，回复引导他用「智能记账」入口
   （输入框旁的记账按钮），那里会先展示识别结果、由用户确认后才落账。
   **绝不可**说「已记一笔 / 已入账 / 记好了」——你根本写不进账本，那是欺骗用户。
   （产品原则：AI 识别结果必须经用户确认才写账本，杜绝静默记错。）
4. 可用工具（共 6 个，均不新建交易）：
   - list_accounts（查账户）、list_categories（查类目）：**实时从数据库拿**，永远是最新的；遇到「用户说的账户/类目名我不确定」「以前看到的列表可能过期」「预投喂为空」时，第一选择是先调它们查到再决策
   - list_transactions（查交易，用于定位修改/删除目标）
   - update_transaction / delete_transaction（修改/删除**已存在**的交易）
   - query_stats（查账问答：余额、月度、排行等）
5. 用户说"把 XX 改成 YY""这笔记错了""删了这笔"时，先调 list_transactions 拿到 transaction_id，再调 update / delete。
6. **不知道账户/类目 id 时不要瞎猜、不要做软匹配**，先调 list_accounts / list_categories 拿到全量再选。
   - 若工具返回的列表里没有用户提到的名字，**立刻在回复里如实告诉用户**「没找到账户『XX』，现有账户：…；要用 YY 吗？」并请用户确认——不要自作主张用名字相近的项顶替。
7. list_accounts / list_categories 的 query 参数是**模糊匹配**（任意子串），可以用「微信」「零钱通」「早餐」等做关键词。
8. 金额用正数；时间默认当前时间；日期格式 YYYY-MM-DD HH:mm:ss。
9. update_transaction 只能修改普通收入/支出（type=income/expense），不能修改转账；删除无此限制。
10. 操作成功后用一句话向用户确认（如"已更新：午餐 13.9 → 外卖 15.0""已删除该笔支出"）。
11. 工具调用返回 {"ok": false, ...} 时表示修改/删除失败，**必须**如实告诉用户失败原因并请其补充或更正，**不得**说"已保存/已完成/已删除"。
    **只有** update_transaction / delete_transaction 真实返回了 {"ok": true, ...}，你才可以说"已更新/已删除"。
    若你只调了 list_* / query_stats 等**只读**工具、或根本没调任何写工具，就**绝不可**声称账本已变更。
12. 对话风格：像真人在微信/小爱里陪用户记账一样自然。**禁止**在回复中暴露后端工具名（list_accounts / query_stats 等）、函数调用 JSON 块、调试占位符、思考过程。回复尽量 1-2 句、简洁有温度；如有多个工具并行执行**只总结结果**，不写"我已经为您调用了 xxx 工具"之类机械化开场白。
补充：
- 下方「可用类目」「可用账户」两节是**预投喂**的快速参考（凭 system prompt 即可见），足以应对多数简单场景。但当用户提的账户名与预投喂列表不完全一致、或预投喂为空、或你对此前的列表没把握时，**必须**调 list_accounts / list_categories 实时确认——凭印象编一个 id 会导致记账失败。
- 用户那张截图中「我的工具集里没有列出账户和分类的接口」这句话是**错的**，从 v0.0.44 起本系统确实提供了 list_accounts / list_categories 工具，AI 可以调用它们直接拿到 id。
- 这两节若显式标注「空 — 当前账本没有...」，说明用户该账本下确实没建账户/类目，请建议他去 App「账户管理 / 分类管理」建好后重试。

可用类目：
${catRef}

可用账户：
${accRef}`;

        /**
         * ⛔ create_transaction / create_transfer 两个【直写账本】工具已于 2026-08-25 移除。
         * ------------------------------------------------
         * 移除原因：它们让模型输出绕过用户确认直接 INSERT INTO transactions，
         * 违反 v0.2 核心原则「AI 输出永不直接写账本」。三端已全部切换到新链路
         * （web 完全不用 /chat 记账，android/harmony 仅在 422 时回退到 /chat），
         * 原注释里写的移除条件「三端均切换后再删」已满足。
         *
         * ⚠️ 曾造成真实 bug：转出腿备注写成 `转账至${fromAcc.name}`（转出账户自己），
         *    而 transfers.js 早已把同样的错修成 toAcc.name —— 重复实现导致修复没同步。
         *
         * 记账链路（唯一）：
         *   POST /api/ai/transactions/parse     → 确定性抽取，产出不可变预测快照（不写账本）
         *   POST /api/ai/predictions/:id/commit → 用户确认后事务内原子落账（FOR UPDATE + 幂等键）
         *
         * /chat 现在只保留【只读咨询】+ update/delete（改删须用户给出明确交易 id，非凭空创建）。
         */
        const tools = [
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
         * 工具执行器。
         * ⛔ 已移除 create_transaction / create_transfer（见上方 tools 定义处的说明）：
         *    新建交易一律走 /ai/transactions/parse → /ai/predictions/:id/commit。
         *    模型若仍尝试调用这两个名字，会落到末尾的 unknown_tool 分支返回错误，
         *    这是【期望行为】—— 宁可让模型报错，也不能绕过用户确认写账本。
         */
        async function executeTool(name, args) {
            if (name === 'create_transaction' || name === 'create_transfer') {
                return {
                    ok: false,
                    error: '新建交易请走「智能记账」确认流程，对话中不支持直接记账。',
                    hint: 'use_parse_commit_flow',
                };
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

// ⚠️ aiModule 的 require 已提到文件顶部（图片通道 /ocr 在本行之前就要用它，
//    const 有 TDZ，留在这里会让 /ocr 直接 ReferenceError）。

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
        const parsed = await aiModule.parseTransactions(db, {
            userId: req.userId,
            bookId: req.bookId,
            text,
            context,
        });
        const { transactions, validation, decision_trace } = parsed;

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
            // Phase 3/4 新增快照：记忆证据 / 模型原始请求响应 / 实际路由
            // 落库是「事后可复盘」的前提：没有它，线上一条错判永远查不出是记忆错还是模型错。
            memorySnapshot: parsed.memory_snapshot,
            modelRequest: parsed.model_request,
            modelResponse: parsed.model_response,
            route: parsed.route,
        });

        res.json(success({
            prediction_id: predictionId,
            transactions,
            verdict: validation.verdict,
            overall_confidence: validation.overall,
            reasons: validation.reasons,
            // 前端据此决定是否弹确认框
            needs_confirmation: validation.verdict !== 'ready',
            // 可解释性：让用户看到「为什么这么判」，也便于三端展示证据来源标签
            route: parsed.route,
            complexity: decision_trace.complexity ? decision_trace.complexity.level : 'simple',
            memory_applied: decision_trace.memory ? decision_trace.memory.applied : [],
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
            memory_snapshot: pred.memory_snapshot, // 记忆证据快照（可解释性）
            model_request: pred.model_request,
            model_response: pred.model_response,
            route: pred.route,
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

/* ============================================
   AI v0.2 · 规则演化与记忆治理（Phase 3 · 方案 §4）
   ------------------------------------------------
   为什么必须暴露这组接口：
     方案 §4 的验收标准要求「错误习惯可 disabled」「证据可审计」。
     若规则只在后台默默演化而用户无法查看/干预，一条学错的规则会
     永久污染后续识别 —— 学习系统必须自带刹车。

   命名统一 /ai/rules/*：与 /ai/predictions/* 平级，同属 v0.2 闭环。
   ============================================ */

const AI_RULE_TYPES = ['merchant_category', 'merchant_account', 'keyword_category', 'keyword_type'];

// ---- GET /api/ai/rules ----
// 列出「我的记账习惯」。管理通道：全状态可见（含 disabled），否则用户无法重新启用
router.get('/rules', async (req, res) => {
    try {
        const status = req.query.status || null;
        if (status && !['candidate', 'verified', 'trusted', 'degraded', 'disabled'].includes(status)) {
            return res.status(400).json(fail('status 取值非法'));
        }
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

        const { rules, total } = await aiModule.listRules(db, {
            userId: req.userId, bookId: req.bookId, status, limit, offset,
        });

        res.json(success({
            rules, total, limit, offset,
            // 前端展示「多少分能升级」需要阈值，硬编码在客户端会与后端漂移
            thresholds: aiModule.STATUS_THRESHOLDS,
            weights: aiModule.EVIDENCE_WEIGHTS,
            half_life_days: aiModule.HALF_LIFE_DAYS,
        }));
    } catch (err) {
        handleServerError(res, err, '查询 AI 规则');
    }
});

// ---- POST /api/ai/rules ----
// 用户显式创建规则（manual_rule_creation +10，直接 trusted）
router.post('/rules', async (req, res) => {
    try {
        const body = req.body || {};
        const matchKey = String(body.match_key || '').trim();
        if (!matchKey) return res.status(400).json(fail('请提供 match_key（商家名或关键词）'));
        if (matchKey.length > 120) return res.status(400).json(fail('match_key 最长 120 字'));

        const ruleType = body.rule_type || 'merchant_category';
        if (!AI_RULE_TYPES.includes(ruleType)) {
            return res.status(400).json(fail(`rule_type 必须是 ${AI_RULE_TYPES.join(' / ')} 之一`));
        }

        const targetCategoryId = body.target_category_id ? parseInt(body.target_category_id, 10) : null;
        const targetAccountId = body.target_account_id ? parseInt(body.target_account_id, 10) : null;
        const targetType = body.target_type || null;
        if (targetType && !['expense', 'income', 'transfer'].includes(targetType)) {
            return res.status(400).json(fail("target_type 必须是 'expense' / 'income' / 'transfer'"));
        }
        if (!targetCategoryId && !targetAccountId && !targetType) {
            return res.status(400).json(fail('至少要指定一个目标（类目 / 账户 / 收支方向）'));
        }

        // 归属校验必须在入口做：规则指向别人的类目会让后续 parse 产出无法落账的预测，
        // 而那时报错已经离用户操作太远、无从诊断。
        // ⚠️ 归属条件严格照搬 routes/categories.js:13 的既有范式：
        //    系统预设(user_id IS NULL) + 用户级共享(book_id IS NULL) + 当前账本专属。
        //    漏掉 user_id IS NULL 会让「早午晚餐」这类系统类目全部建不了规则。
        if (targetCategoryId) {
            const cat = await db.queryOne(
                `SELECT id FROM categories
                  WHERE id = ?
                    AND (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))`,
                [targetCategoryId, req.userId, req.bookId]
            );
            if (!cat) return res.status(400).json(fail('目标类目不存在或不属于当前账本'));
        }
        if (targetAccountId) {
            // 账户没有系统预设，条件与 accounts 路由一致
            const acc = await db.queryOne(
                `SELECT id FROM accounts
                  WHERE id = ? AND user_id = ? AND (book_id = ? OR book_id IS NULL)`,
                [targetAccountId, req.userId, req.bookId]
            );
            if (!acc) return res.status(400).json(fail('目标账户不存在或不属于当前账本'));
        }

        const rule = await aiModule.createManualRule(db, {
            userId: req.userId, bookId: req.bookId, matchKey, ruleType,
            targetCategoryId, targetAccountId, targetType,
        });
        if (!rule) return res.status(500).json(fail('规则创建失败，请稍后重试'));

        res.json(success({ message: '规则已创建', rule }));
    } catch (err) {
        handleServerError(res, err, '创建 AI 规则');
    }
});

// ---- POST /api/ai/rules/:id/disable ----
// 停用规则（rule_disabled −20，且不自动复活）
router.post('/rules/:id/disable', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的规则 ID'));
        const reason = String((req.body && req.body.reason) || '').slice(0, 200);

        const r = await aiModule.disableRule(db, { userId: req.userId, ruleId: id, reason });
        if (!r.ok) return res.status(404).json(fail(r.error || '规则不存在'));
        res.json(success({ message: '规则已停用', rule: r }));
    } catch (err) {
        handleServerError(res, err, '停用 AI 规则');
    }
});

// ---- POST /api/ai/rules/:id/enable ----
// 重新启用（回到 candidate 重新攒证据，不恢复历史分数）
router.post('/rules/:id/enable', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的规则 ID'));

        const r = await aiModule.enableRule(db, { userId: req.userId, ruleId: id });
        if (!r.ok) return res.status(404).json(fail(r.error || '规则不存在'));
        res.json(success({ message: '规则已重新启用（重新积累证据）', rule: r }));
    } catch (err) {
        handleServerError(res, err, '启用 AI 规则');
    }
});

// ---- GET /api/ai/rules/:id/evidence ----
// 证据流水：这条规则的每一分从哪来
router.get('/rules/:id/evidence', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的规则 ID'));

        const trail = await aiModule.ruleEvidenceTrail(db, {
            userId: req.userId, ruleId: id,
            limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50)),
        });
        res.json(success({ rule_id: id, evidence: trail }));
    } catch (err) {
        handleServerError(res, err, '查询规则证据');
    }
});

// ---- GET /api/ai/learning/stats ----
// 「越用越聪明」的举证面板：证据分布 + 矛盾检测 + 线上指标 + 熔断状态
router.get('/learning/stats', async (req, res) => {
    try {
        const [stats, contradictions, online, usage] = await Promise.all([
            aiModule.evidenceStats(db, req.userId),
            aiModule.detectContradictions(db, req.userId),
            aiModule.collectOnlineMetrics(db, req.userId),
            aiModule.usageMetrics(db, req.userId),
        ]);

        res.json(success({
            evidence: stats,
            // 同一商家出现两个高分类目 = 需要用户裁定，不该由系统猜
            contradictions,
            metrics: online,
            usage,
            breakers: aiModule.breakerStates(),
        }));
    } catch (err) {
        handleServerError(res, err, '查询 AI 学习统计');
    }
});

/* ============================================
   AI v0.2 · 评测系统（Phase 5 · 方案 §12）
   ------------------------------------------------
   方案原文：「任何版本发布前都必须比较基线」。
   ⇒ 跑批接口默认自动取最近一次跑批作基线，并在响应里直出 regressions。
      不做「先查基线再手工传 id」，否则最容易被跳过的就是这一步。
   ============================================ */

// ---- POST /api/ai/evaluation/run ----
router.post('/evaluation/run', async (req, res) => {
    try {
        const label = String((req.body && req.body.label) || '').slice(0, 80);
        const persist = (req.body && req.body.persist) !== false;   // 默认落库

        // 离线跑批：不连库、不调模型，纯 CPU
        const result = aiModule.runOfflineEvaluation();

        const baselineRow = await aiModule.latestRun(db);
        const baseline = baselineRow
            ? (typeof baselineRow.metrics === 'object' ? baselineRow.metrics : JSON.parse(baselineRow.metrics || '{}'))
            : null;
        const regression = aiModule.compareWithBaseline(result.metrics, baseline);

        let runId = null;
        if (persist) {
            runId = await aiModule.persistRun(db, {
                userId: req.userId, label, engineVersion: String(aiModule.PREDICTION_VERSION),
                result, baselineRunId: baselineRow ? baselineRow.id : null,
            });
        }

        res.json(success({
            run_id: runId,
            metrics: result.metrics,
            summary: result.summary,
            baseline_run_id: baselineRow ? baselineRow.id : null,
            regression,
            // 只回失败用例的明细：全量 36 条 actual 会让响应膨胀到没人读
            failed_cases: result.cases.filter(c => !c.passed),
        }));
    } catch (err) {
        handleServerError(res, err, '运行 AI 评测');
    }
});

// ---- GET /api/ai/evaluation/runs ----
router.get('/evaluation/runs', async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        let runs = [];
        try {
            runs = await db.query(
                `SELECT id, label, dataset_version, engine_version, total_cases, passed_cases,
                        metrics, baseline_run_id, regression, created_at
                   FROM ai_evaluation_runs
                  ORDER BY created_at DESC, id DESC
                  LIMIT ${limit}`
            );
        } catch (_) { runs = []; }   // 老库未升级 → 空列表，不给 500

        res.json(success({
            runs: runs.map(r => ({
                ...r,
                metrics: typeof r.metrics === 'object' ? r.metrics : safeJson(r.metrics, {}),
                regression: typeof r.regression === 'object' ? r.regression : safeJson(r.regression, null),
            })),
            dataset_version: aiModule.DATASET_VERSION,
        }));
    } catch (err) {
        handleServerError(res, err, '查询评测历史');
    }
});

// PG 的 JSONB 列驱动已自动反序列化，MySQL 的 JSON 列回来是字符串 —— 这里统一兜底。
function safeJson(v, dflt) {
    if (v === null || v === undefined) return dflt;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (_) { return dflt; }
}

module.exports = router;
