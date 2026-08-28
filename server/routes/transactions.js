/* ============================================
   鑫钱包 · 交易管理路由
   ============================================ */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { toAmount, TRANSACTION_TYPES } = require('../validate');
const {
    success, handleServerError, fmtDateTime, computeAccountBalance, enforceBalanceLimit,
    ErrorCodes, failBadRequest, failValidation, failNotFound
} = require('./_helpers');
const { syncCreditCardDebt, resolveNote } = require('./utils');

// ==========================================
// 理财交易回滚：删除台账交易时，若其由理财操作(建仓/加减仓/清仓/分红/利息)生成，
// 需同步删除对应的理财交易记录并按剩余流水重算持仓，避免「余额恢复、持仓不恢复」。
// ==========================================

// 用剩余理财交易流水重算持仓（数量/成本/市值/状态），作为单一真相。
// 与「加减仓/清仓」增量更新完全等价，但天然支持删除任意一笔后重算，
// 含清仓的反向还原（不依赖已丢失的历史持仓快照）。
async function recomputeInvestmentPosition(conn, investmentId, userId) {
    const inv = await conn.query('SELECT * FROM investments WHERE id = ? AND user_id = ?', [investmentId, userId]);
    const row = inv[0];
    if (!row) return;
    const txns = await conn.query(
        `SELECT * FROM investment_transactions WHERE investment_id = ? AND user_id = ? ORDER BY date ASC, id ASC`,
        [investmentId, userId]
    );
    let qty = 0, cost = 0;
    for (const t of txns) {
        const q = parseFloat(t.quantity) || 0;
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'buy' || t.type === 'reinvest') {
            qty += q;
            cost += amt; // 买入金额(含费)/红利再投金额计入成本基数
        } else if (t.type === 'sell') {
            // 券商净投入本金口径：卖出按实际回款(amount)全额从成本基数扣减，
            // 而非按当时均价比例扣减。这样持仓盈亏与同花顺/东方财富等券商一致。
            cost -= amt;
            qty -= q;
        }
        // dividend / interest 仅产生现金入账，不影响持仓数量与成本
    }
    if (qty < 0) qty = 0; // 异常保护：持仓数量不得为负
    // 注意：cost 可为负。净投入本金口径下，减仓把本金拿回后剩余持仓成本变负，
    // 即"零成本持股、利润已锁定在成本里"，属正确结果，不做归零（与同花顺/东方财富一致）。
    const currentPrice = parseFloat(row.current_price) || 0;
    const currentValue = qty * currentPrice;
    const buyPrice = qty > 0 ? cost / qty : 0;
    // 做T：数量归 0 也不立即标记 sold，保持 holding；隔夜由列表查询自动归档。
    // 手动清仓（sell 路由）会单独写 status='sold' + sold_date=today。
    await conn.query(
        `UPDATE investments SET quantity=?, total_cost=?, current_value=?, buy_price=?, status='holding', sold_date=NULL
         WHERE id=? AND user_id=?`,
        [qty, cost, currentValue, buyPrice, investmentId, userId]
    );
}

// 删除与台账交易关联的理财交易记录，并重算持仓
async function reverseLinkedInvestmentTxn(conn, userId, investmentTxnId) {
    if (!investmentTxnId) return;
    const invTxn = await conn.query('SELECT * FROM investment_transactions WHERE id = ? AND user_id = ?', [investmentTxnId, userId]);
    const t = invTxn[0];
    if (!t) return;
    const investmentId = t.investment_id;
    await conn.query('DELETE FROM investment_transactions WHERE id = ? AND user_id = ?', [investmentTxnId, userId]);
    await recomputeInvestmentPosition(conn, investmentId, userId);
}

// ==========================================
// 交易管理 API
// ==========================================

// 获取当前用户用过的全部地点（去重，按最近使用排序），便于记账 chip 自动提示
router.get('/locations', async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT location, MAX(date) as last_used, COUNT(*) as cnt
             FROM transactions
             WHERE user_id = ? AND book_id = ? AND location IS NOT NULL AND location <> ''
             GROUP BY location
             ORDER BY last_used DESC
             LIMIT 50`,
            [req.userId, req.bookId]
        );
        const locations = rows.map(r => ({
            name: r.location,
            last_used: r.last_used,
            count: r.cnt
        }));
        res.json(success(locations));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 获取交易列表
router.get('/', async (req, res) => {
    try {
        const { month, type, types, search, location, limit, offset, tag_id, amount_op, amount_val, amount_val2,
                start_date, end_date, min_amount, max_amount,
                category_id, account_id } = req.query;
        let sql = `SELECT t.*, c.name as cat_name, c.icon as cat_icon, c.type as cat_type,
      a.name as acc_name, a.icon as acc_icon,
      sa.name as src_name, sa.icon as src_icon,
      da.name as dst_name, da.icon as dst_icon,
      tr.from_account_id as tr_from, tr.to_account_id as tr_to,
      fa.name as tr_from_name, fa.icon as tr_from_icon,
      ta.name as tr_to_name, ta.icon as tr_to_icon,
      b.name as budget_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      LEFT JOIN accounts sa ON t.source_account_id = sa.id
      LEFT JOIN accounts da ON t.destination_account_id = da.id
      LEFT JOIN transfers tr ON t.transfer_id = tr.id
      LEFT JOIN accounts fa ON tr.from_account_id = fa.id
      LEFT JOIN accounts ta ON tr.to_account_id = ta.id
      LEFT JOIN budgets b ON t.budget_id = b.id
      WHERE t.user_id = ? AND t.book_id = ?`;
        const params = [req.userId, req.bookId];

        // ──── 转账折叠：一笔转账只出一条「A → B」，不要转出/转入各一条 ────
        //
        // 数据模型是复式记账：transfers 表存主体（from/to/amount），transactions 表
        // 存两条腿（transfer_out + transfer_in）靠 transfer_id 关联。这个设计是对的
        // —— 每个账户的余额都要能独立从自己的流水推导出来（computeAccountBalance）。
        // 问题只在展示层：列表把两条腿都渲染出来，用户看到同一笔转账重复两次。
        //
        // 折叠保留 transfer_out 腿，因为它自己就带着完整信息：
        // 上面 LEFT JOIN transfers 已经取到 tr_from_name / tr_to_name，
        // 下方 counterparty 字段直接能拼出「A → B」，不需要额外查询。
        //
        // ⚠️ 判据必须是「有 transfer_id 且存在配对的 out 腿」，不能按 type 一刀切
        // 排除所有 transfer_in：
        //   1. POST /transactions 允许单独创建 type='transfer_in' 而 transfer_id 为 NULL
        //      （见本文件 create 分支），那是用户手动记的单边入账，必须照常显示
        //   2. 历史数据里可能存在 out 腿已被删而 in 腿残留的情况，一刀切会让它彻底
        //      从列表消失 —— 数据还在、余额还算着，但用户永远看不到、也无法删除
        //
        // ⚠️ 必须在 SQL 层折叠，不能拿到结果后在 JS 里 filter：
        // 下方分页用的是 SQL 的 LIMIT/OFFSET，JS 过滤会让 limit=20 实际只显示 14 条，
        // 且「还有没有下一页」的判断全错。
        sql += ` AND NOT (
        t.type = 'transfer_in' AND t.transfer_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM transactions x
          WHERE x.transfer_id = t.transfer_id
            AND x.type = 'transfer_out'
            AND x.user_id = t.user_id AND x.book_id = t.book_id
        )
      )`;

        if (month && month !== 'all') {
            sql += ' AND CAST(t.date AS CHAR(10)) LIKE ?';
            params.push(month + '%');
        }

        // 类型筛选：types（多选，逗号分隔）优先；缺省回退单值 type。
        // 'transfer' 展开为 transfer_in/transfer_out；其他值需在 TRANSACTION_TYPES 白名单内。
        let typeSet = [];
        if (types && types !== 'all') {
            typeSet = String(types).split(',').map(s => s.trim()).filter(Boolean);
        } else if (type && type !== 'all') {
            typeSet = [type];
        }
        if (typeSet.length) {
            const conds = [];
            for (const t of typeSet) {
                if (t === 'transfer') {
                    conds.push("t.type IN ('transfer_in', 'transfer_out')");
                } else if (TRANSACTION_TYPES.includes(t)) {
                    conds.push('t.type = ?');
                    params.push(t);
                }
                // 未识别的 token (例如 'debt' 预留) 直接忽略，避免单选时误返回空
            }
            if (conds.length) sql += ' AND (' + conds.join(' OR ') + ')';
        }

        if (category_id && category_id !== 'all') {
            sql += ' AND t.category_id = ?';
            params.push(parseInt(category_id));
        }
        if (account_id && account_id !== 'all') {
            sql += ' AND t.account_id = ?';
            params.push(parseInt(account_id));
        }
        if (search) {
            sql += ' AND (t.note LIKE ? OR c.name LIKE ? OR t.location LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
        }
        // 地点精确筛选
        if (location && location !== 'all') {
            sql += ' AND t.location = ?';
            params.push(location);
        }
        if (tag_id && tag_id !== 'all') {
            sql += ' AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)';
            params.push(parseInt(tag_id));
        }
        // 日期范围：与 CAST(t.date AS CHAR(10)) 比较，按 YYYY-MM-DD 字符串序即可
        if (start_date) {
            sql += ' AND CAST(t.date AS CHAR(10)) >= ?';
            params.push(start_date);
        }
        if (end_date) {
            sql += ' AND CAST(t.date AS CHAR(10)) <= ?';
            params.push(end_date);
        }
        // 金额范围（独立于旧的 amount_op/amount_val/amount_val2，UI 用 amount range 时走这里）
        if (min_amount !== undefined && min_amount !== '' && !isNaN(parseFloat(min_amount))) {
            sql += ' AND t.amount >= ?';
            params.push(parseFloat(min_amount));
        }
        if (max_amount !== undefined && max_amount !== '' && !isNaN(parseFloat(max_amount))) {
            sql += ' AND t.amount <= ?';
            params.push(parseFloat(max_amount));
        }
        if (amount_op && amount_op !== 'all') {
            const v1 = parseFloat(amount_val);
            if (!isNaN(v1)) {
                if (amount_op === 'gt') {
                    sql += ' AND t.amount > ?';
                    params.push(v1);
                } else if (amount_op === 'lt') {
                    sql += ' AND t.amount < ?';
                    params.push(v1);
                } else if (amount_op === 'eq') {
                    sql += ' AND t.amount = ?';
                    params.push(v1);
                } else if (amount_op === 'ne') {
                    sql += ' AND t.amount != ?';
                    params.push(v1);
                } else if (amount_op === 'bt' || amount_op === 'nb') {
                    const v2 = parseFloat(amount_val2);
                    if (!isNaN(v2)) {
                        const lo = Math.min(v1, v2);
                        const hi = Math.max(v1, v2);
                        if (amount_op === 'bt') {
                            sql += ' AND t.amount BETWEEN ? AND ?';
                        } else {
                            sql += ' AND t.amount NOT BETWEEN ? AND ?';
                        }
                        params.push(lo, hi);
                    }
                }
            }
        }

        sql += ' ORDER BY t.date DESC, t.id DESC';

        if (limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(limit));
            if (offset) {
                sql += ' OFFSET ?';
                params.push(parseInt(offset));
            }
        }

        const transactions = await db.query(sql, params);

        // 加载交易标签
        let tagMap = {};
        if (transactions.length) {
            const ids = transactions.map(t => t.id);
            const placeholders = ids.map(() => '?').join(',');
            const tagRows = await db.query(
                `SELECT tt.transaction_id, tg.id as tag_id, tg.name as tag_name, tg.color, tg.icon
                 FROM transaction_tags tt JOIN tags tg ON tt.tag_id = tg.id
                 WHERE tt.transaction_id IN (${placeholders})`,
                ids
            );
            tagRows.forEach(r => {
                if (!tagMap[r.transaction_id]) tagMap[r.transaction_id] = [];
                tagMap[r.transaction_id].push({ id: r.tag_id, name: r.tag_name, color: r.color, icon: r.icon });
            });
        }

        // 格式化
        const formatted = transactions.map(t => ({
            id: t.id,
            type: t.type,
            amount: parseFloat(t.amount),
            date: fmtDateTime(t.date),
            note: t.note || '',
            location: t.location || null,
            link_type: t.link_type || null,
            link_id: t.link_id || null,
            category: { id: t.category_id, name: t.cat_name, icon: t.cat_icon },
            account: { id: t.account_id, name: t.acc_name, icon: t.acc_icon },
            source: t.source_account_id ? { id: t.source_account_id, name: t.src_name, icon: t.src_icon } : null,
            destination: t.destination_account_id ? { id: t.destination_account_id, name: t.dst_name, icon: t.dst_icon } : null,
            // 转账对方账户（复式记账：每笔转账展示借贷对方）
            counterparty: t.type === 'transfer_out'
                ? (t.tr_to_name ? { dir: '→', name: t.tr_to_name, icon: t.tr_to_icon } : null)
                : t.type === 'transfer_in'
                ? (t.tr_from_name ? { dir: '←', name: t.tr_from_name, icon: t.tr_from_icon } : null)
                : null,
            transfer_id: t.transfer_id,
            /**
             * 折叠后的转账双端信息。列表里一笔转账只出一条记录（见上方 SQL 的
             * 转账折叠条件），这条记录必须能自己表达完整的「A → B」，
             * 否则客户端只能拿 counterparty 猜另一端是谁。
             *
             * 客户端据此渲染「工资卡 → 余额宝」，并且知道要把编辑/删除
             * 转发到 /transfers/:id（transfer 字段非空即代表这是折叠记录，
             * 改 transactions/:id 只会动一条腿，两个账户余额就对不上了）。
             */
            transfer: t.transfer_id && t.tr_from_name && t.tr_to_name
                ? {
                    id: t.transfer_id,
                    from: { id: t.tr_from, name: t.tr_from_name, icon: t.tr_from_icon },
                    to: { id: t.tr_to, name: t.tr_to_name, icon: t.tr_to_icon }
                }
                : null,
            budget_id: t.budget_id,
            budget_name: t.budget_name,
            tags: tagMap[t.id] || []
        }));

        res.json(success(formatted));
    } catch (err) {
        handleServerError(res, err);
    }
});

// ==========================================
// 复式记账流水（Firefly III 式：每笔流动展示 来源 → 目标）
// ==========================================
router.get('/ledger', async (req, res) => {
    try {
        const { month } = req.query;
        let sql = `SELECT t.id, t.type, t.amount, t.date, t.note, t.transfer_id,
            sa.name as src_name, sa.icon as src_icon,
            da.name as dst_name, da.icon as dst_icon,
            c.name as cat_name, c.icon as cat_icon
            FROM transactions t
            LEFT JOIN accounts sa ON t.source_account_id = sa.id
            LEFT JOIN accounts da ON t.destination_account_id = da.id
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.user_id = ? AND t.book_id = ?`;
        const params = [req.userId, req.bookId];
        if (month && month !== 'all') {
            sql += ' AND CAST(t.date AS CHAR(10)) LIKE ?';
            params.push(month + '%');
        }
        sql += ' ORDER BY t.date DESC, t.id DESC';
        const rows = await db.query(sql, params);
        const formatted = rows.map(t => ({
            id: t.id,
            type: t.type,
            amount: parseFloat(t.amount),
            date: t.date,
            note: t.note || '',
            transfer_id: t.transfer_id,
            category: { name: t.cat_name, icon: t.cat_icon },
            source: t.source_account_id ? { name: t.src_name, icon: t.src_icon } : null,
            destination: t.destination_account_id ? { name: t.dst_name, icon: t.dst_icon } : null
        }));
        res.json(success(formatted));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 新增交易
router.post('/', async (req, res) => {
    try {
        const { account_id, category_id, budget_id, type, amount, date, note, location, link_type, link_id, merchant } = req.body;

        const amountNum = toAmount(amount);
        if (amountNum === null || amountNum <= 0) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('请输入有效金额'));
        if (!account_id) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('请选择账户'));
        if (!TRANSACTION_TYPES.includes(type)) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('交易类型不合法'));

        const transDate = date || new Date().toISOString().replace('T', ' ').slice(0, 19);
        // 复式记账：支出/转出(source=扣款账户)，收入/转入(dest=入账账户)
        const src = (type === 'expense' || type === 'transfer_out') ? parseInt(account_id) : null;
        const dst = (type === 'income' || type === 'transfer_in') ? parseInt(account_id) : null;
        const bId = budget_id ? parseInt(budget_id) : null;
        const loc = location || null;
        const lt = link_type || null;
        const li = link_id ? parseInt(link_id) : null;

        // 使用事务确保余额一致
        const result = await db.transaction(async (conn) => {
            // 备注：尊重调用方给定的 note（AI 流程由 AI 自填；手动记账由用户填），无则 fallback 到 merchant，再无则用类目名
            const finalNote = await resolveNote(conn, req.userId, parseInt(category_id), note, merchant);
            const insertResult = await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, budget_id, type, amount, note, date, source_account_id, destination_account_id, location, link_type, link_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, req.bookId, parseInt(account_id), parseInt(category_id), bId, type, amountNum, finalNote, transDate, src, dst, loc, lt, li]
            );

            // 余额由账本推导（复式记账 single source of truth），取代易漂移的增量更新
            const newBalance = await computeAccountBalance(conn, req.userId, parseInt(account_id));
            await enforceBalanceLimit(conn, req.userId, parseInt(account_id), newBalance);
            await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, parseInt(account_id)]);

            // 自动同步信用卡债务
            await syncCreditCardDebt(conn, req.userId, parseInt(account_id));

            // 写入交易标签
            const tags = Array.isArray(req.body.tags) ? req.body.tags.map(t => parseInt(t)).filter(Boolean) : [];
            for (const tid of tags) {
                await conn.query(
                    db.insertIgnoreSql('transaction_tags', ['transaction_id', 'tag_id']),
                    [insertResult.insertId, tid]
                );
            }

            return insertResult.insertId;
        });

        res.json(success({ id: result }, '交易已添加'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 更新交易
router.put('/:id', async (req, res) => {
    try {
        const { account_id, category_id, budget_id, type, amount, date, note, location, link_type, link_id, merchant } = req.body;
        const id = parseInt(req.params.id);

        const amountNum = toAmount(amount);
        if (amountNum === null || amountNum <= 0) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('请输入有效金额'));
        if (!TRANSACTION_TYPES.includes(type)) return res.status(ErrorCodes.VALIDATION_FAILED).json(failValidation('交易类型不合法'));

        // 先获取原交易信息用于回滚余额
        const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!old) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('交易不存在'));

        const src = (type === 'expense' || type === 'transfer_out') ? parseInt(account_id) : null;
        const dst = (type === 'income' || type === 'transfer_in') ? parseInt(account_id) : null;
        const bId = budget_id ? parseInt(budget_id) : null;
        const loc = location || null;
        const lt = link_type || null;
        const li = link_id ? parseInt(link_id) : null;

        await db.transaction(async (conn) => {
            // 备注：尊重调用方给定的 note，无则 fallback 到 merchant，再无则用类目名
            const finalNote = await resolveNote(conn, req.userId, parseInt(category_id), note, merchant);
            // 更新交易记录（含复式记账借贷双方字段 + location/link）
            await conn.query(
                `UPDATE transactions SET account_id=?, category_id=?, budget_id=?, type=?, amount=?, note=?, date=?, source_account_id=?, destination_account_id=?, location=?, link_type=?, link_id=? WHERE id=? AND user_id=? AND book_id=?`,
                [parseInt(account_id), parseInt(category_id), bId, type, amountNum, finalNote, date, src, dst, loc, lt, li, id, req.userId, req.bookId]
            );

            // 重置交易标签
            await conn.query('DELETE FROM transaction_tags WHERE transaction_id = ?', [id]);
            const tags = Array.isArray(req.body.tags) ? req.body.tags.map(t => parseInt(t)).filter(Boolean) : [];
            for (const tid of tags) {
                await conn.query(
                    db.insertIgnoreSql('transaction_tags', ['transaction_id', 'tag_id']),
                    [id, tid]
                );
            }

            // 余额由账本重算（旧账户 + 新账户，账户变更时两者都修正），彻底杜绝漂移
            const affected = new Set([parseInt(old.account_id), parseInt(account_id)]);
            const newBalances = {};
            for (const aid of affected) {
                newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
            }
            for (const aid of affected) {
                await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
            }
            for (const aid of affected) {
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalances[aid], aid]);
                // 自动同步信用卡债务
                await syncCreditCardDebt(conn, req.userId, aid);
            }
        });

        res.json(success(null, '交易已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 删除交易
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!old) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('交易不存在'));

        await db.transaction(async (conn) => {
            // 如果是转账记录，同时删除配对的另一条
            const affectedAccounts = new Set([parseInt(old.account_id)]);
            if (old.transfer_id) {
                // 删除同一 transfer_id 的所有关联交易
                const paired = await conn.query(
                    'SELECT id, account_id FROM transactions WHERE transfer_id = ? AND id != ? AND user_id = ? AND book_id = ?',
                    [old.transfer_id, id, req.userId, req.bookId]
                );
                paired.forEach(p => affectedAccounts.add(parseInt(p.account_id)));
                await conn.query('DELETE FROM transactions WHERE transfer_id = ? AND user_id = ? AND book_id = ?', [old.transfer_id, req.userId, req.bookId]);
                // 同时删除 transfers 表记录
                await conn.query('DELETE FROM transfers WHERE id = ? AND user_id = ? AND book_id = ?', [old.transfer_id, req.userId, req.bookId]);
            } else {
                await conn.query('DELETE FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
            }
            // 若该台账交易由理财操作生成，回滚对应持仓（删除理财流水 + 按剩余流水重算）
            await reverseLinkedInvestmentTxn(conn, req.userId, old.investment_txn_id);
            // 余额由账本重算，避免增量回滚的漂移
            const newBalances = {};
            for (const aid of affectedAccounts) {
                newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
            }
            for (const aid of affectedAccounts) {
                await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
            }
            for (const aid of affectedAccounts) {
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalances[aid], aid]);
                // 自动同步信用卡债务（删除交易后余额变化）
                await syncCreditCardDebt(conn, req.userId, aid);
            }
        });

        res.json(success(null, '交易已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 交易月份列表
router.get('/months', async (req, res) => {
    try {
        const months = await db.query(
            `SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') as month
       FROM transactions WHERE user_id = ? AND book_id = ? ORDER BY month DESC`,
            [req.userId, req.bookId]
        );
        res.json(success(months.map(m => m.month)));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 月度汇总
router.get('/summary', async (req, res) => {
    try {
        const { month } = req.query;
        if (!month) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('请指定月份'));

        const incomeRow = await db.queryOne(
            `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE user_id = ? AND book_id = ? AND type = 'income' AND CAST(date AS CHAR(10)) LIKE ?`,
            [req.userId, req.bookId, month + '%']
        );
        const expenseRow = await db.queryOne(
            `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE user_id = ? AND book_id = ? AND type = 'expense' AND CAST(date AS CHAR(10)) LIKE ?`,
            [req.userId, req.bookId, month + '%']
        );

        // 类别汇总（子级向父级汇总，数据库层递归 CTE，语义同报表 /reports）：
        // 每个分类的 total = 自身发生额 + 其全部子孙（任意层级）发生额之和，并回传 parent_id 供前端分层展示。
        const expByCat = await db.query(
            `WITH RECURSIVE anc AS (
               SELECT c.id AS node, c.id AS ancestor_id, c.parent_id AS parent_id
               FROM categories c
               UNION ALL
               SELECT a.node, p.id AS ancestor_id, p.parent_id AS parent_id
               FROM anc a JOIN categories p ON p.id = a.parent_id
             ),
             agg AS (
               SELECT a.ancestor_id AS cat_id, COALESCE(SUM(t.amount), 0) AS total
               FROM anc a
               JOIN transactions t ON t.category_id = a.node
                AND t.user_id = ? AND t.book_id = ? AND t.type = 'expense' AND CAST(t.date AS CHAR(10)) LIKE ?
               GROUP BY a.ancestor_id
             )
             SELECT c.id, c.name, c.icon, c.parent_id, agg.total
             FROM agg JOIN categories c ON c.id = agg.cat_id
             ORDER BY agg.total DESC`,
            [req.userId, req.bookId, month + '%']
        );

        const incByCat = await db.query(
            `WITH RECURSIVE anc AS (
               SELECT c.id AS node, c.id AS ancestor_id, c.parent_id AS parent_id
               FROM categories c
               UNION ALL
               SELECT a.node, p.id AS ancestor_id, p.parent_id AS parent_id
               FROM anc a JOIN categories p ON p.id = a.parent_id
             ),
             agg AS (
               SELECT a.ancestor_id AS cat_id, COALESCE(SUM(t.amount), 0) AS total
               FROM anc a
               JOIN transactions t ON t.category_id = a.node
                AND t.user_id = ? AND t.book_id = ? AND t.type = 'income' AND CAST(t.date AS CHAR(10)) LIKE ?
               GROUP BY a.ancestor_id
             )
             SELECT c.id, c.name, c.icon, c.parent_id, agg.total
             FROM agg JOIN categories c ON c.id = agg.cat_id
             ORDER BY agg.total DESC`,
            [req.userId, req.bookId, month + '%']
        );

        const income = parseFloat(incomeRow.total);
        const expense = parseFloat(expenseRow.total);

        res.json(success({
            income, expense, balance: income - expense,
            expenseByCategory: expByCat.map(r => ({ ...r, total: parseFloat(r.total) })),
            incomeByCategory: incByCat.map(r => ({ ...r, total: parseFloat(r.total) }))
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 获取单条交易（按 id 精确获取，供编辑态使用，避免前端拉取全量列表）
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!Number.isInteger(id)) return res.status(ErrorCodes.BAD_REQUEST).json(failBadRequest('无效的交易 ID'));
        /**
         * JOIN transfers 与列表接口保持一致。
         *
         * 原先这里只 JOIN categories/accounts/budgets，返回体里既没有
         * transfer_id 也没有 transfer 字段 —— 于是 web 端编辑转账时
         * `if (!old.transfer_id) return showToast('无法定位转账记录')`
         * 必然命中，转账永远保存不了（截图里连弹三次就是这个）。
         *
         * 单条接口必须自洽：不能要求调用方先拉一次列表、再从缓存里
         * 反查对方账户。列表缓存可能是上个月的、可能被筛选条件过滤掉。
         */
        const rows = await db.query(
            `SELECT t.*, c.name as cat_name, c.icon as cat_icon, c.type as cat_type,
                a.name as acc_name, a.icon as acc_icon, b.name as budget_name,
                tr.from_account_id as tr_from, tr.to_account_id as tr_to,
                fa.name as tr_from_name, fa.icon as tr_from_icon,
                ta.name as tr_to_name, ta.icon as tr_to_icon
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts a ON t.account_id = a.id
             LEFT JOIN budgets b ON t.budget_id = b.id
             LEFT JOIN transfers tr ON t.transfer_id = tr.id
             LEFT JOIN accounts fa ON tr.from_account_id = fa.id
             LEFT JOIN accounts ta ON tr.to_account_id = ta.id
             WHERE t.id = ? AND t.user_id = ? AND t.book_id = ?`,
            [id, req.userId, req.bookId]
        );
        if (!rows[0]) return res.status(ErrorCodes.NOT_FOUND).json(failNotFound('交易不存在'));
        const t = rows[0];
        const tagRows = await db.query(
            `SELECT tg.id, tg.name, tg.color, tg.icon
             FROM transaction_tags tt JOIN tags tg ON tt.tag_id = tg.id
             WHERE tt.transaction_id = ?`,
            [id]
        );
        const formatted = {
            id: t.id,
            type: t.type,
            amount: parseFloat(t.amount),
            date: fmtDateTime(t.date),
            note: t.note || '',
            category: { id: t.category_id, name: t.cat_name, icon: t.cat_icon },
            account: { id: t.account_id, name: t.acc_name, icon: t.acc_icon },
            // 与列表接口同名同形，客户端一套解析逻辑通吃两个接口
            transfer_id: t.transfer_id ?? null,
            transfer: t.transfer_id && t.tr_from_name && t.tr_to_name
                ? {
                    id: t.transfer_id,
                    from: { id: t.tr_from, name: t.tr_from_name, icon: t.tr_from_icon },
                    to: { id: t.tr_to, name: t.tr_to_name, icon: t.tr_to_icon }
                }
                : null,
            budget_id: t.budget_id,
            budget_name: t.budget_name,
            tags: tagRows.map(r => ({ id: r.id, name: r.name, color: r.color, icon: r.icon }))
        };
        res.json(success(formatted));
    } catch (err) {
        handleServerError(res, err);
    }
});

router.recomputeInvestmentPosition = recomputeInvestmentPosition;
module.exports = router;
