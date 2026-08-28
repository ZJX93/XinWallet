/* ============================================
   腾讯云 OCR 配置读写（密钥以掩码回显，避免明文下行）
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, encrypt, decrypt, success, fail, handleServerError, maskKey, tryDecrypt } = require('./_shared');
const router = express.Router();
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

        const upsertSql = db.upsertSql('ai_ocr_config', ['user_id'], ['provider', 'secret_id', 'secret_key', 'region']);
        await db.query(upsertSql, [req.userId, 'tencent', finalId, finalKey, finalRegion]);
        res.json(success({ saved: true }, 'OCR 配置已保存'));
    } catch (err) { handleServerError(res, err); }
});

/*  ⛔ 原 `fallbackExtractItems`（253 行 legacy OCR 正则解析器）已于 2026-08-25 删除。
    能力去处：`modules/ai/vision/receipt-preprocessor.js`
      · 5 套版式策略全部迁走，并【新补】策略 1b（竖排标签版式，legacy 全漏）
      · 类目词表此前已并入 `extraction/category-matcher.js`
    ⛔ 别在这里重新写第二套抽取逻辑 —— legacy 之所以要删，就是因为它让
       图片通道和文字通道各有一个大脑，规则学到的习惯在图片上完全不生效。   */

module.exports = router;
