/* ============================================
   记账规则管理：列表 / 新增 / 启停 / 证据链
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule } = require('./_shared');
const router = express.Router();
// ⛔ merchant_account 已移除：商户≠固定支付方式（淘宝闪购可用信用卡/花呗/零钱…），
//    商户→账户的固定规则会越学越错（2026-08-29）。账户只由票据付款方式/尾号决定。
const AI_RULE_TYPES = ['merchant_category', 'keyword_category', 'keyword_type'];

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
        if (body.target_account_id != null) {
            return res.status(400).json(fail('商户→账户规则已移除：商户不固定支付方式，账户由票据付款方式/卡号尾号决定'));
        }
        const targetType = body.target_type || null;
        if (targetType && !['expense', 'income', 'transfer'].includes(targetType)) {
            return res.status(400).json(fail("target_type 必须是 'expense' / 'income' / 'transfer'"));
        }
        if (!targetCategoryId && !targetType) {
            return res.status(400).json(fail('至少要指定一个目标（类目 / 收支方向）'));
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
        const rule = await aiModule.createManualRule(db, {
            userId: req.userId, bookId: req.bookId, matchKey, ruleType,
            targetCategoryId, targetType,
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

// ---- DELETE /api/ai/rules/:id ----
// 删除规则（仅允许删除已禁用规则，防止误删活跃规则导致不可逆损失）
router.delete('/rules/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json(fail('无效的规则 ID'));

        // 安全约束：只允许删除已禁用的规则
        const rule = await db.queryOne(
            'SELECT id, status FROM ai_rules WHERE id = ? AND user_id = ?',
            [id, req.userId]
        );
        if (!rule) return res.status(404).json(fail('规则不存在'));
        if (String(rule.status || '').toLowerCase() !== 'disabled') {
            return res.status(400).json(fail('只能删除已禁用的规则，请先禁用再删除'));
        }

        // 级联删除关联证据
        await db.query('DELETE FROM ai_rule_evidence WHERE rule_id = ? AND user_id = ?', [id, req.userId]);
        await db.query('DELETE FROM ai_rules WHERE id = ? AND user_id = ?', [id, req.userId]);

        res.json(success({ message: '规则已删除' }));
    } catch (err) {
        handleServerError(res, err, '删除 AI 规则');
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
