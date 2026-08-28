/* ============================================
   记账规则管理：列表 / 新增 / 启停 / 证据链
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
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

module.exports = router;
