/* ============================================
   图片记账通道：票据版式预处理 → 抽取 → 落预测快照；含 /ocr 与 /ocr/retranscribe
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, toNumber, getActiveProvider, aiModule, upload } = require('./_shared');
const logger = require('../../logger');
const { applyPreprocessDateOverride } = aiModule;
const router = express.Router();
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

    // 转录原文含用户账单隐私，默认不输出（需 LOG_LEVEL=debug 才记录）
    logger.debug('[OCR] transcribe', { source: tr.source, text: tr.text });
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
    let pre = null;   // 票据版式预处理结果（含精确时分秒），供下方时间兜底复用
    if (aiModule.looksLikeReceipt(tr.text)) {
        pre = aiModule.preprocessReceipt(tr.text, { defaultDate: new Date().toISOString().slice(0, 10) });
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
        } else {
            // 判定像票据但一条策略都没命中 → 退回原文，交给主链路尽力而为
        }
    }
    // 解析文本/商户线索含隐私，默认不输出
    logger.debug('[OCR] parse', { parseText, receiptDate, merchantHints });

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
        // 客户端透传的「上次使用账户」兜底名，OCR 文本无渠道关键词时
        // resolveAccount 走 fallback_default 路径会用到，让识别依据可显示「上次使用：XXX」。
        last_account_name: (req.body && req.body.account_name) ? String(req.body.account_name) : null,
        platform: (req.body && req.body.platform) || 'unknown',
        /*  ⚠️ 账户渠道词必须扫【原始 OCR 文本】，不能扫下面的 parseText：
            票据预处理器会把「支付方式 / 零钱 / 银行卡」这类标签行当噪声整行丢弃，
            parseText 里已无渠道词，只扫它会让账户永远回退到客户端默认账户
            （2026-08-29 实测：原文写着「支付方式　零钱」，仍落到默认账户）。 */
        account_scan_text: tr.text || null,
    };
    if (receiptDate) imageContext.date = receiptDate;

    const parsed = await aiModule.parseTransactions(db, {
        userId: req.userId,
        bookId: req.bookId,
        text: parseText,
        context: imageContext,
    });
    const { transactions, validation, decision_trace } = parsed;

    // 时间/日期兜底：票据预处理器已从「转账时间/支付时间」读到精确时分秒与日期，
    // 但模型复核可能仍填 00:00:00、甚至编造错误的日期 → 用预处理的硬证据覆盖
    // （详见 receipt-date-override.js，逻辑已抽出以便单元测试）。
    applyPreprocessDateOverride(pre, transactions);

    /*  备注兜底：票据上的「商品说明」是白纸黑字写了买了什么
        （如「蜜雪冰城(龙湖星悦广场店)外卖订单」），模型常自己编一个笼统备注
        （如「淘宝闪购外卖」）或干脆留空 → 模型没给备注时直接用票据原文。 */
    if (pre && pre.ok && pre.note) {
        transactions.forEach(t => {
            if (t && !t.note) {
                t.note = pre.note;
                if (t.evidence) t.evidence.note = 'receipt_preprocess_note';
            }
        });
    }

    /*  账户字段必须打出来：此前这行只打日期/金额/商户，账户匹配情况在日志里完全不可见，
        线上「账户没匹配上」只能靠查库快照反推（2026-08-29 排障代价）。 */
    // 交易详情含金额/账户等隐私，默认不输出（排障设 LOG_LEVEL=debug）
    logger.debug('[OCR] transactions', { transactions: transactions.map(t => ({
        date: t.date,
        amount: t.amount,
        merchant: t.merchant,
        account_id: t.account_id != null ? t.account_id : null,
        account_evidence: (t.evidence && t.evidence.account) || null,
        account_conf: (t.confidence && t.confidence.account) != null ? t.confidence.account : null,
        account_details: t.account_match_details || null,
        date_source: t.evidence && t.evidence.date,
    })) });
    logger.debug('[OCR] imageContext', { account_id: imageContext.account_id, last_account_name: imageContext.last_account_name });

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
        logger.error('[图片记账 ERROR]', err && err.stack ? err.stack : err);
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
        logger.error('[图片重转录 ERROR]', err && err.stack ? err.stack : err);
        handleServerError(res, err, '重新识别');
    }
});

function normalizeForce(v) {
    const s = String(v || '').trim();
    return (s === 'model' || s === 'tencent_ocr') ? s : null;
}

module.exports = router;
