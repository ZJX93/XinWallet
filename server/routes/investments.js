/* ============================================
   鑫钱包 · 理财管理路由模块
   包含：理财类型 CRUD、持仓管理、行情 API
   ============================================ */

const express = require('express');
const db = require('../db');
const { success, fail, handleServerError, fmtDateOnly, fmtDateTime, computeAccountBalance } = require('./_helpers');
const {
  getQuoteStrategy,
  fetchQuoteByCategory,
  fetchPriceForInvestment
} = require('../services/market-data');
const transactionsRouter = require('./transactions');
const recomputeInvestmentPosition = transactionsRouter.recomputeInvestmentPosition;

const router = express.Router();

/**
 * 理财交易/流水日期归一化为「YYYY-MM-DD HH:MM:SS」（精确到秒）。
 * 兼容三种前端输入：datetime-local（带 T）、ISO（带 Z/毫秒）、纯日期（YYYY-MM-DD）。
 * 必须去除 Z 与毫秒——否则直接写入 TIMESTAMP/DATETIME 在 PG/MySQL 下会报格式错误。
 * 早期实现用 slice(0,10)/split('T')[0] 截到天，导致计息等日期丢失时分秒。
 */
function normDate(d) {
  if (!d) return new Date().toISOString().replace('T', ' ').slice(0, 19);
  return String(d).replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').slice(0, 19);
}

// ==========================================
// 理财类型 CRUD
// ==========================================

// 获取理财类型列表
router.get('/', async (req, res) => {
    try {
        const types = await db.query('SELECT * FROM investment_types ORDER BY sort_order, id');
        res.json(success(types));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 新增理财类型
router.post('/', async (req, res) => {
    try {
        const { name, icon, risk_level, description, category } = req.body;
        if (!name) return res.status(400).json(fail('请输入类型名称'));
        
        const result = await db.query(
            `INSERT INTO investment_types (name, icon, risk_level, description, category) VALUES (?, ?, ?, ?, ?)`,
            [name, icon || '📈', risk_level || 'medium', description || '', category || 'fund']
        );
        res.json(success({ id: result.insertId }));
    } catch (err) {
        handleServerError(res, err);
    }
});

/**
 * 安全修复：investment_types 是全局共享表（无 user_id 列），schema 预置 11 条基础类型。
 * 此前 PUT/DELETE 无任何保护 → 任意登录用户可改删全局类型，影响所有用户
 * （与审核报告 C4「系统分类可被任意用户篡改」同构，报告未覆盖此表）。
 * 系统预置类型一律拒绝普通用户改删。
 */
async function assertTypeEditable(id) {
    const t = await db.queryOne('SELECT id, is_system FROM investment_types WHERE id = ?', [id]);
    if (!t) return { ok: false, code: 404, msg: '理财类型不存在' };
    if (t.is_system) return { ok: false, code: 403, msg: '系统预置类型不可修改或删除' };
    return { ok: true };
}

// ==========================================
// 持仓创建时同步生成台账交易，保持账本一致
// ==========================================

// 投资理财一级（支出）：名下挂「投资买入」「理财保险」二级
async function getInvestmentTopCategoryId(conn) {
    const rows = await conn.query('SELECT id FROM categories WHERE code = ? AND type = ?', ['E1100', 'expense']);
    if (rows[0]) return rows[0].id;
    const r = await conn.query(
        'INSERT INTO categories (code, name, type, icon, color, is_system) VALUES (?, ?, ?, ?, ?, TRUE)',
        ['E1100', '投资理财', 'expense', '💹', '#22c55e']
    );
    return r.insertId;
}

// 判断是否保险类理财产品（买入应归入「理财保险」而非「投资买入」）
async function isInsuranceType(conn, typeId) {
    if (!typeId) return false;
    const t = await conn.query('SELECT category, name FROM investment_types WHERE id = ?', [typeId]);
    if (!t[0]) return false;
    return t[0].category === 'insurance' || (t[0].name && t[0].name.indexOf('保险') !== -1);
}

// 买入分类（支出）：保险类→理财保险，其余→投资买入；均为「投资理财」二级
async function getOrCreateInvestmentBuyCategory(conn, isInsurance) {
    const name = isInsurance ? '理财保险' : '投资买入';
    const rows = await conn.query('SELECT id, parent_id FROM categories WHERE name = ? AND type = ?', [name, 'expense']);
    if (rows[0]) {
        // 历史动态创建的「投资买入」可能无 parent，挂回投资理财下
        if (rows[0].parent_id == null) {
            const topId = await getInvestmentTopCategoryId(conn);
            await conn.query('UPDATE categories SET parent_id = ? WHERE id = ?', [topId, rows[0].id]);
        }
        return rows[0].id;
    }
    const topId = await getInvestmentTopCategoryId(conn);
    const icon = isInsurance ? '🛡️' : '📈';
    const r = await conn.query(
        'INSERT INTO categories (name, type, icon, color, parent_id, is_system) VALUES (?, ?, ?, ?, ?, TRUE)',
        [name, 'expense', icon, '#22c55e', topId]
    );
    return r.insertId;
}

// 理财收益分类（收入，隶属于被动收入）：卖出/减仓/清仓共用
async function getInvestmentSellCategoryId(conn) {
    const rows = await conn.query('SELECT id FROM categories WHERE name = ? AND type = ?', ['理财收益', 'income']);
    if (rows[0]) return rows[0].id;
    // 理财收益缺失时自动补建到「被动收入」下，保证卖出分类口径正确
    const parent = await conn.query('SELECT id FROM categories WHERE name = ? AND type = ?', ['被动收入', 'income']);
    const parentId = parent[0] ? parent[0].id : null;
    const result = await conn.query(
        // 列 6 个 → 占位符 5 个 + is_system 的 TRUE 字面量。
        // 早期这里多写了一个 `?`（6 个占位符 + TRUE = 7 个值对 6 列），
        // 一旦「理财收益」种子缺失、走到这条兜底补建路径就会直接 SQL 报错、拖垮卖出/减仓。
        'INSERT INTO categories (name, type, icon, color, parent_id, is_system) VALUES (?, ?, ?, ?, ?, TRUE)',
        ['理财收益', 'income', '📊', '#22c55e', parentId]
    );
    return result.insertId;
}

// 创建持仓时：资金从关联账户流出（支出），扣减余额
async function createInvestmentCreateTxn(conn, userId, bookId, accId, cost, name, dateStr, investmentTypeId, investmentTxnId = null) {
    if (!accId || !(cost > 0)) return null;
    const isIns = await isInsuranceType(conn, investmentTypeId);
    const catId = await getOrCreateInvestmentBuyCategory(conn, isIns);
    const txDate = normDate(dateStr);
    const txResult = await conn.query(
        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id, investment_txn_id)
         VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, NULL, ?)`,
        [userId, bookId, accId, catId, cost, `买入·${name}`, txDate, accId, investmentTxnId]
    );
    // 以账本为准重算关联账户余额
    const newBalance = await computeAccountBalance(conn, userId, accId);
    await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, accId]);
    return txResult.insertId;
}

// 回滚创建持仓时生成的台账交易（删除交易并按账本重算账户余额）
async function rollbackInvestmentCreateTxn(conn, userId, txId, accId) {
    if (!txId) return;
    await conn.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [txId, userId]);
    if (accId) {
        const newBalance = await computeAccountBalance(conn, userId, accId);
        await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, accId]);
    }
}

// 定位某笔理财流水对应的主账本台账交易（账户明细里那条）。
// 老数据可能没回填 investment_txn_id 指针（该列是 schema.sql 后补的兼容列），
// 只按指针删会漏掉台账——表现即「理财流水删了，账户明细那条还在、余额不回退」。
// 因此指针查不到时，用「账户 + 金额 + 日期 + 收支方向」兜底反查孤儿台账，
// 并限定 investment_txn_id IS NULL，避免误伤已关联的台账。
async function findInvestmentLedgerTxns(conn, { userId, bookId, txnId, accountId, type, amount, date }) {
    const linked = await conn.query(
        'SELECT id, account_id FROM transactions WHERE investment_txn_id = ? AND user_id = ? AND book_id = ?',
        [txnId, userId, bookId]
    );
    if (linked && linked.length) return linked;
    if (!accountId) return [];
    // 由流水类型推导台账是 income 还是 expense
    const dir = (type === 'sell' || type === 'dividend' || type === 'interest') ? 'income' : 'expense';
    const orphan = await conn.query(
        `SELECT id, account_id FROM transactions
         WHERE user_id = ? AND book_id = ? AND account_id = ?
           AND type = ? AND amount = ? AND date = ? AND investment_txn_id IS NULL
         ORDER BY id DESC LIMIT 1`,
        [userId, bookId, accountId, dir, amount, date]
    );
    return orphan || [];
}

// 删除某笔理财流水对应的台账交易：能定位到就按 id 精确删除；
// 指针缺失、兜底也没命中（如跨账本等边界）时仍按指针删一次，保持原有行为。
// 返回被删除台账行的 { id, account_id }，供调用方按「台账实际所属账户」重算余额。
async function deleteInvestmentLedgerTxns(conn, ctx) {
    const linked = await findInvestmentLedgerTxns(conn, ctx);
    const ids = (linked || []).map((t) => t.id);
    if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        await conn.query(
            `DELETE FROM transactions WHERE id IN (${ph}) AND user_id = ? AND book_id = ?`,
            [...ids, ctx.userId, ctx.bookId]
        );
    } else {
        await conn.query(
            'DELETE FROM transactions WHERE investment_txn_id = ? AND user_id = ? AND book_id = ?',
            [ctx.txnId, ctx.userId, ctx.bookId]
        );
    }
    return linked || [];
}

// 更新理财类型
router.put('/:id', async (req, res) => {
    try {
        const typeId = parseInt(req.params.id);
        if (!Number.isInteger(typeId)) return res.status(400).json(fail('无效的类型 ID'));
        const guard = await assertTypeEditable(typeId);
        if (!guard.ok) return res.status(guard.code).json(fail(guard.msg));

        const { name, icon, risk_level, description, category } = req.body;
        await db.query(
            `UPDATE investment_types SET name=?, icon=?, risk_level=?, description=?, category=? WHERE id=? AND is_system = FALSE`,
            [name, icon, risk_level, description, category, typeId]
        );
        res.json(success(null, '类型已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 删除理财类型
router.delete('/:id', async (req, res) => {
    try {
        const typeId = parseInt(req.params.id);
        if (!Number.isInteger(typeId)) return res.status(400).json(fail('无效的类型 ID'));
        const guard = await assertTypeEditable(typeId);
        if (!guard.ok) return res.status(guard.code).json(fail(guard.msg));

        const count = await db.queryOne(
            'SELECT COUNT(*) as cnt FROM investments WHERE investment_type_id = ?',
            [typeId]
        );
        if (count.cnt > 0) return res.status(400).json(fail('该类型下仍有持仓，无法删除'));

        await db.query('DELETE FROM investment_types WHERE id = ? AND is_system = FALSE', [typeId]);
        res.json(success(null, '类型已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 获取所有持仓
//
// 修复 m2（重复实现）：calcAnnualizedRate / calcPortfolioMetrics 原先在本文件与
// stats.js 中各存一份逐字节相同的副本，而 services/portfolio.js 早已提供同名实现
// 却无人引用 —— 三份代码各自漂移的隐患。现统一复用共享服务。
const { annualizedRate: calcAnnualizedRate, calcPortfolioMetrics } = require('../services/portfolio');

router.get('/investments', async (req, res) => {
    try {
        const todayStr = fmtDateOnly(new Date());
        // 默认只显示「持有中 + 清仓当天」；includeSold=true 时额外展示历史已清仓记录
        const includeSold = req.query.includeSold === 'true' || req.query.includeSold === '1';
        const whereSold = includeSold
            ? `(i.status = 'holding' OR i.status = 'sold')`
            : `(i.status = 'holding' OR (i.status = 'sold' AND i.sold_date = ?))`;
        const whereParams = includeSold ? [req.userId, req.bookId] : [req.userId, req.bookId, todayStr];

        // 做T隔夜归档：holding 且数量已为 0、最后交易日期 < 今天的持仓，自动标记为 sold + sold_date=最后交易日期。
        // 当天做T卖到 0 时仍保持 holding，列表继续显示；隔夜才归档，支持连贯计算。
        await db.query(
            `UPDATE investments i
             SET status='sold',
                 sold_date = (SELECT MAX(CAST(date AS DATE)) FROM investment_transactions WHERE investment_id = i.id)
             WHERE i.user_id = ? AND i.book_id = ?
               AND i.status = 'holding'
               AND i.quantity = 0
               AND (SELECT MAX(CAST(date AS DATE)) FROM investment_transactions WHERE investment_id = i.id) < ?`,
            [req.userId, req.bookId, todayStr]
        );

        const investments = await db.query(
            `SELECT i.*, it.name as type_name, it.icon as type_icon, it.risk_level as type_risk_level,
       COALESCE(i.risk_level, it.risk_level) as risk_level,
       a.name as acc_name
       FROM investments i
       JOIN investment_types it ON i.investment_type_id = it.id
       LEFT JOIN accounts a ON i.account_id = a.id
       WHERE i.user_id = ? AND i.book_id = ?
         AND ${whereSold}
       ORDER BY CASE WHEN i.status = 'holding' THEN 0 ELSE 1 END, i.current_value DESC`,
            whereParams
        );

        // 计算汇总：仅统计当前持有中的持仓，已清仓的不计入总市值
        const holding = investments.filter(i => i.status === 'holding');
        const totalCost = holding.reduce((s, i) => s + parseFloat(i.total_cost), 0);
        const totalValue = holding.reduce((s, i) => s + parseFloat(i.current_value), 0);
        const totalProfit = totalValue - totalCost;
        const totalProfitRate = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;

        // 按类型分组
        const byType = {};
        investments.forEach(i => {
            if (i.status === 'sold') return; // 已清仓（仅清仓当天显示卡片）不计入类型汇总
            const key = i.type_name;
            if (!byType[key]) byType[key] = { type_name: key, icon: i.type_icon, risk_level: i.risk_level, total_cost: 0, total_value: 0, items: [] };
            byType[key].total_cost += parseFloat(i.total_cost);
            byType[key].total_value += parseFloat(i.current_value);
            byType[key].items.push({
                ...i,
                buy_price: parseFloat(i.buy_price),
                current_price: parseFloat(i.current_price),
                quantity: parseFloat(i.quantity),
                total_cost: parseFloat(i.total_cost),
                current_value: parseFloat(i.current_value),
                fee: parseFloat(i.fee || 0),
                profit: parseFloat(i.current_value) - parseFloat(i.total_cost),
                profit_rate: parseFloat(i.total_cost) > 0 ? ((parseFloat(i.current_value) - parseFloat(i.total_cost)) / parseFloat(i.total_cost) * 100) : 0,
                expected_rate: parseFloat(i.expected_rate),
                actual_rate: parseFloat(i.actual_rate)
            });
        });

        res.json(success({
            investments: investments.map(i => ({
                ...i,
                buy_price: parseFloat(i.buy_price),
                current_price: parseFloat(i.current_price),
                quantity: parseFloat(i.quantity),
                total_cost: parseFloat(i.total_cost),
                current_value: parseFloat(i.current_value),
                fee: parseFloat(i.fee || 0),
                profit: parseFloat(i.current_value) - parseFloat(i.total_cost),
                profit_rate: parseFloat(i.total_cost) > 0 ? ((parseFloat(i.current_value) - parseFloat(i.total_cost)) / parseFloat(i.total_cost) * 100) : 0,
                expected_rate: parseFloat(i.expected_rate),
                actual_rate: parseFloat(i.actual_rate),
                annualizedRate: (() => { const ar = calcAnnualizedRate(i.total_cost, i.current_value, i.buy_date); return ar == null ? null : Math.round(ar * 100) / 100; })()
            })),
            summary: { ...calcPortfolioMetrics(investments), totalProfitRate: Math.round(totalProfitRate * 100) / 100 },
            byType
        }));
    } catch (err) {
        handleServerError(res, err);
    }
});

router.post('/investments', async (req, res) => {
    try {
        const { account_id, investment_type_id, name, code, buy_price, current_price, quantity, total_cost, current_value, fee, buy_date, expected_rate, risk_level, note } = req.body;

        if (!name || !investment_type_id) return res.status(400).json(fail('参数不完整'));

        const feeVal = parseFloat(fee) || 0;
        const costVal = parseFloat(total_cost) || 0;
        const valueVal = parseFloat(current_value) || costVal || 0;
        const accId = parseInt(account_id) || null;
        const buyDate = normDate(buy_date);
        const riskVal = ['low', 'medium', 'high', 'very_high'].includes(risk_level) ? risk_level : null;

        const result = await db.transaction(async (conn) => {
            const invResult = await conn.query(
                `INSERT INTO investments (user_id, book_id, account_id, investment_type_id, name, code, buy_price, current_price, quantity, total_cost, current_value, fee, buy_date, expected_rate, risk_level, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, req.bookId, accId, parseInt(investment_type_id), name, code || '',
                    parseFloat(buy_price) || 0, parseFloat(current_price) || parseFloat(buy_price) || 0,
                    parseFloat(quantity) || 0, costVal,
                    valueVal,
                    feeVal,
                    buyDate, parseFloat(expected_rate) || 0, riskVal,
                    note || '']
            );
            const invId = invResult.insertId;

            // 记录买入操作
            const initBuyTxn = await conn.query(
                `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
                 VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, '初始买入')`,
                [req.userId, req.bookId, invId, costVal, parseFloat(buy_price) || 0, parseFloat(quantity) || 0, buyDate, feeVal]
            );

            // 关联账户：买入扣款，保持账本一致；并把台账交易关联回理财买入流水(investment_txn_id)
            const createTxnId = await createInvestmentCreateTxn(conn, req.userId, req.bookId, accId, costVal, name, buyDate, parseInt(investment_type_id), initBuyTxn.insertId);
            if (createTxnId) {
                await conn.query('UPDATE investments SET create_transaction_id = ? WHERE id = ?', [createTxnId, invId]);
            }

            return invResult;
        });

        res.json(success({ id: result.insertId }, '理财持仓已添加'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 更新理财持仓（编辑/刷新行情）
router.put('/investments/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { account_id, investment_type_id, name, code, buy_price, current_price, quantity, total_cost, current_value, fee, buy_date, expected_rate, actual_rate, risk_level, note, status } = req.body;

        // 区分行情刷新（仅 current_price/current_value/actual_rate）和完整编辑
        const isQuoteRefresh = name === undefined;

        if (isQuoteRefresh) {
            await db.query(
                'UPDATE investments SET current_price=?, current_value=?, actual_rate=? WHERE id=? AND user_id=?',
                [parseFloat(current_price) || 0, parseFloat(current_value) || 0, parseFloat(actual_rate) || 0, id, req.userId]
            );
            res.json(success(null, '持仓已更新'));
            return;
        }

        const newAccId = parseInt(account_id) || null;
        const newCost = parseFloat(total_cost) || 0;
        const newName = name || '';
        const newBuyDate = normDate(buy_date);

        await db.transaction(async (conn) => {
            // 取出旧持仓，用于回滚旧台账交易
            const oldRows = await conn.query('SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
            const old = oldRows[0] || null;

            // 回滚旧的创建交易（避免账本残留）
            if (old && old.create_transaction_id) {
                await rollbackInvestmentCreateTxn(conn, req.userId, old.create_transaction_id, old.account_id);
            }

            await conn.query(
                `UPDATE investments SET
                    account_id=?, investment_type_id=?, name=?, code=?,
                    buy_price=?, current_price=?, quantity=?, total_cost=?, current_value=?, fee=?,
                    buy_date=?, expected_rate=?, actual_rate=?, risk_level=?, note=?, status=?
                 WHERE id=? AND user_id=? AND book_id=?`,
                [
                    newAccId, parseInt(investment_type_id), newName, code || '',
                    parseFloat(buy_price) || 0, parseFloat(current_price) || 0,
                    parseFloat(quantity) || 0, newCost, parseFloat(current_value) || 0, parseFloat(fee) || 0,
                    newBuyDate,
                    parseFloat(expected_rate) || 0, parseFloat(actual_rate) || 0,
                    ['low', 'medium', 'high', 'very_high'].includes(risk_level) ? risk_level : null,
                    note || '', status || 'holding', id, req.userId, req.bookId
                ]
            );

            // 按新参数重建创建交易（账户/成本/名称/日期变化时），沿用原持仓所属账本
            const newTxnId = await createInvestmentCreateTxn(conn, req.userId, old ? old.book_id : req.bookId, newAccId, newCost, newName, newBuyDate, parseInt(investment_type_id));
            await conn.query('UPDATE investments SET create_transaction_id = ? WHERE id = ?', [newTxnId, id]);
        });

        res.json(success(null, '持仓已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 理财交易记录（卖出/分红/红利再投等）
router.post('/investments/:id/transactions', async (req, res) => {
    try {
        const { type, amount, price, quantity, date, note, fee } = req.body;
        const investmentId = parseInt(req.params.id);
        if (!Number.isInteger(investmentId)) return res.status(400).json(fail('无效的持仓 ID'));

        // 安全修复（审核报告 C3）：本接口原先完全没有归属校验，
        // 登录用户枚举 id 即可向他人持仓插入流水并篡改其数量/市值。
        // 此处强制先校验持仓归属，后续所有写操作一律带 user_id 条件。
        const ownedInv = await db.queryOne(
            'SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?',
            [investmentId, req.userId, req.bookId]
        );
        if (!ownedInv) return res.status(404).json(fail('持仓不存在'));
        if (!['buy', 'sell', 'dividend', 'interest', 'reinvest'].includes(type)) {
            return res.status(400).json(fail('不支持的交易类型'));
        }

        // 红利再投：先算新增份额（金额 / 单位净值），用于流水与持仓更新
        let addedQty = parseFloat(quantity) || 0;
        if (type === 'reinvest') {
            const nav = parseFloat(price) || parseFloat(ownedInv.current_price) || 0;
            const amt = parseFloat(amount) || 0;
            if (!(nav > 0)) return res.status(400).json(fail('红利再投需要有效的单位净值，请在「当前净值」填写'));
            if (!(amt > 0)) return res.status(400).json(fail('红利再投金额需大于 0'));
            addedQty = amt / nav;
        }

        const dateNorm = normDate(date);
        let msg = '操作已记录';
        const invTxn = await db.query(
            `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, req.bookId, investmentId, type, parseFloat(amount), parseFloat(price) || 0, addedQty, dateNorm, parseFloat(fee) || 0, note || '']
        );

        // 如果是卖出，更新持仓（净投入本金口径：成本按回款全额扣减，与 recompute 一致）
        if (type === 'sell') {
            await db.query(
                'UPDATE investments SET quantity = quantity - ?, total_cost = total_cost - ?, current_value = current_value - ? WHERE id = ? AND user_id = ?',
                [parseFloat(quantity), parseFloat(amount), parseFloat(amount), investmentId, req.userId]
            );
        }

        // 如果是分红/利息，记录到主交易（现金入账）
        if (type === 'dividend' || type === 'interest') {
            const investment = ownedInv;
            if (investment && investment.account_id) {
                await db.transaction(async (conn) => {
                    const sellCatId = await getInvestmentSellCategoryId(conn);
                    await conn.query(
                            `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
             VALUES (?, ?, ?, ?, 'income', ?, ?, ?, ?)`,
                            [req.userId, req.bookId, investment.account_id, sellCatId, parseFloat(amount), `${type === 'dividend' ? '分红' : '利息'}-${investment.name}`, dateNorm, invTxn.insertId]
                        );
                        // 以账本为准重算账户余额（单一真相，避免直接加减导致漂移）
                        const newBalance = await computeAccountBalance(conn, req.userId, investment.account_id);
                        await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, investment.account_id]);
                });
            }
            msg = type === 'dividend' ? '分红已记录' : '利息已记录';
        }

        // 如果是红利再投，增加持有份额（不进现金、不动账户余额）
        if (type === 'reinvest') {
            const nav = parseFloat(price) || parseFloat(ownedInv.current_price) || 0;
            const newQty = parseFloat(ownedInv.quantity) + addedQty;
            const newCurrentValue = newQty * nav;
            await db.query(
                'UPDATE investments SET quantity = ?, current_value = ? WHERE id = ? AND user_id = ?',
                [newQty, newCurrentValue, investmentId, req.userId]
            );
            msg = '红利再投已记录，持有份额已增加';
        }

        res.json(success(null, msg));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 查看某理财持仓的全部交易记录（买入/卖出/分红/利息/红利再投）
const INV_TXN_TYPE_LABEL = {
  buy: '买入', sell: '卖出', dividend: '分红', interest: '利息', reinvest: '红利再投'
};
router.get('/investments/:id/transactions', async (req, res) => {
    try {
        const investmentId = parseInt(req.params.id);
        if (!Number.isInteger(investmentId)) return res.status(400).json(fail('无效的持仓 ID'));

        // 归属校验：禁止跨用户查看他人持仓流水
        const owned = await db.queryOne('SELECT id FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [investmentId, req.userId, req.bookId]);
        if (!owned) return res.status(404).json(fail('持仓不存在'));

        const rows = await db.query(
            `SELECT * FROM investment_transactions
             WHERE investment_id = ? AND user_id = ? AND book_id = ?
             ORDER BY date ASC, id ASC`,
            [investmentId, req.userId, req.bookId]
        );
        // 标记该持仓的第一笔买入为「建仓」，其余买入为「买入」
        let firstBuyId = null;
        for (const r of rows) {
            if (r.type === 'buy') { firstBuyId = r.id; break; }
        }
        const list = rows.reverse().map(t => {
            let label = INV_TXN_TYPE_LABEL[t.type] || t.type;
            if (t.type === 'buy' && t.id === firstBuyId) label = '建仓';
            return {
                id: t.id,
                type: t.type,
                type_label: label,
                amount: parseFloat(t.amount),
                price: parseFloat(t.price),
                quantity: parseFloat(t.quantity),
                fee: parseFloat(t.fee) || 0,
                date: fmtDateTime(t.date),
                note: t.note || ''
            };
        });
        res.json(success(list));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 删除理财交易记录（加减仓流水），并同步删除关联台账交易、重算持仓与账户余额
router.delete('/investments/:id/transactions/:txnId', async (req, res) => {
    try {
        const investmentId = parseInt(req.params.id);
        const txnId = parseInt(req.params.txnId);
        if (!investmentId || !txnId) return res.status(400).json(fail('参数错误'));

        const investment = await db.queryOne(
            'SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?',
            [investmentId, req.userId, req.bookId]
        );
        if (!investment) return res.status(404).json(fail('持仓不存在'));

        const txn = await db.queryOne(
            'SELECT * FROM investment_transactions WHERE id = ? AND investment_id = ? AND user_id = ?',
            [txnId, investmentId, req.userId]
        );
        if (!txn) return res.status(404).json(fail('交易记录不存在'));

        await db.transaction(async (conn) => {
            // 先定位该流水对应的台账交易再精确删除；指针缺失的老数据走
            // 「账户 + 金额 + 日期」兜底（findInvestmentLedgerTxns），
            // 避免出现「理财流水删掉了、账户明细那条还在、余额不回退」。
            const affected = new Set();
            if (investment.account_id) affected.add(parseInt(investment.account_id));

            const ledgerRows = await deleteInvestmentLedgerTxns(conn, {
                userId: req.userId,
                bookId: req.bookId,
                txnId,
                accountId: investment.account_id,
                type: txn.type,
                amount: txn.amount,
                date: txn.date,
            });
            // 余额要按「台账实际所属账户」重算，而不只是持仓当前绑定的账户
            (ledgerRows || []).forEach((t) => { if (t.account_id) affected.add(parseInt(t.account_id)); });

            // 删除理财流水
            await conn.query(
                'DELETE FROM investment_transactions WHERE id = ? AND user_id = ?',
                [txnId, req.userId]
            );
            // 用剩余流水重算持仓（做T：数量归0也保持holding，隔夜自动归档）
            await recomputeInvestmentPosition(conn, investmentId, req.userId);
            // 关联账户余额重算（单一真相）
            for (const aid of affected) {
                const newBalance = await computeAccountBalance(conn, req.userId, aid);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, aid]);
            }
        });

        res.json(success(null, '已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 修改理财交易记录（reverse 旧笔 + 按新值插入 + 重算持仓与账户余额）
// 采用「删旧 + 插新 + recompute 兜底」的事务策略，持仓始终由全部流水推导，避免口径漂移。
// 旧台账清理与删除接口同口径（指针缺失的老数据走「账户+金额+日期」兜底）；
// buy/sell 修改后按新值重建台账，否则只删不重建会令「改了加仓/卖出，账户明细与余额没跟上」。
router.put('/investments/:id/transactions/:txnId', async (req, res) => {
    try {
        const { type, amount, price, quantity, date, note, fee } = req.body;
        const investmentId = parseInt(req.params.id);
        const txnId = parseInt(req.params.txnId);
        if (!Number.isInteger(investmentId) || !Number.isInteger(txnId)) return res.status(400).json(fail('参数错误'));
        if (!['buy', 'sell', 'dividend', 'interest', 'reinvest'].includes(type)) return res.status(400).json(fail('不支持的交易类型'));

        const investment = await db.queryOne('SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [investmentId, req.userId, req.bookId]);
        if (!investment) return res.status(404).json(fail('持仓不存在'));

        const old = await db.queryOne('SELECT * FROM investment_transactions WHERE id = ? AND investment_id = ? AND user_id = ?', [txnId, investmentId, req.userId]);
        if (!old) return res.status(404).json(fail('交易记录不存在'));

        let addedQty = parseFloat(quantity) || 0;
        if (type === 'reinvest') {
            const nav = parseFloat(price) || parseFloat(investment.current_price) || 0;
            const amt = parseFloat(amount) || 0;
            if (!(nav > 0)) return res.status(400).json(fail('红利再投需要有效的单位净值，请在「当前净值」填写'));
            if (!(amt > 0)) return res.status(400).json(fail('红利再投金额需大于 0'));
            addedQty = amt / nav;
        }

        const dateNorm = normDate(date);
        let msg = '已更新';
        await db.transaction(async (conn) => {
            // 1) reverse 旧笔：先清旧台账（含指针缺失老数据的兜底），再删旧流水重算持仓
            const affected = new Set();
            if (investment.account_id) affected.add(parseInt(investment.account_id));

            const oldLedger = await deleteInvestmentLedgerTxns(conn, {
                userId: req.userId,
                bookId: req.bookId,
                txnId,
                accountId: investment.account_id,
                type: old.type,
                amount: old.amount,
                date: old.date,
            });
            // 旧台账可能挂在其它账户（持仓换绑过账户），余额重算要覆盖它
            (oldLedger || []).forEach((t) => { if (t.account_id) affected.add(parseInt(t.account_id)); });
            await conn.query('DELETE FROM investment_transactions WHERE id = ? AND user_id = ?', [txnId, req.userId]);
            await recomputeInvestmentPosition(conn, investmentId, req.userId);

            // 2) 插入新值
            const inv = await conn.query(
                `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, req.bookId, investmentId, type, parseFloat(amount), parseFloat(price) || 0, addedQty, dateNorm, parseFloat(fee) || 0, note || '']
            );
            const newInvTxnId = inv.insertId;

            // 3) 按新值重建主账本（recompute 不处理主账本）：
            //    买入 → 现金流出(expense)；卖出/分红/利息 → 现金入账(income)；红利再投不进现金、无台账。
            if (type === 'buy' || type === 'sell' || type === 'dividend' || type === 'interest') {
                if (investment.account_id) {
                    if (type === 'buy') {
                        const isIns = await isInsuranceType(conn, investment.investment_type_id);
                        const buyCatId = await getOrCreateInvestmentBuyCategory(conn, isIns);
                        await conn.query(
                            `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
                             VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?)`,
                            [req.userId, req.bookId, investment.account_id, buyCatId, parseFloat(amount), `买入·${investment.name}`, dateNorm, newInvTxnId]
                        );
                    } else {
                        const sellCatId = await getInvestmentSellCategoryId(conn);
                        // 卖出被改后本笔盈亏上下文已失效，备注不再输出「盈亏±x」，只保留流水事实
                        const txnNote = type === 'sell'
                            ? `卖出·${investment.name}`
                            : `${type === 'dividend' ? '分红' : '利息'}-${investment.name}`;
                        await conn.query(
                            `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
                             VALUES (?, ?, ?, ?, 'income', ?, ?, ?, ?)`,
                            [req.userId, req.bookId, investment.account_id, sellCatId, parseFloat(amount), txnNote, dateNorm, newInvTxnId]
                        );
                    }
                }
                msg = type === 'buy' ? '买入记录已更新' : type === 'sell' ? '卖出记录已更新' : type === 'dividend' ? '分红已更新' : '利息已更新';
            } else if (type === 'reinvest') {
                msg = '红利再投已更新，持有份额已增加';
            }

            // 4) 统一重算持仓（含新流水）+ 同步受影响账户余额（单一真相）
            await recomputeInvestmentPosition(conn, investmentId, req.userId);
            for (const aid of affected) {
                const newBalance = await computeAccountBalance(conn, req.userId, aid);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, aid]);
            }
        });

        res.json(success(null, msg));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 卖出/清仓
router.put('/investments/:id/sell', async (req, res) => {
    try {
        const { sell_price, date, note, fee } = req.body;
        const id = parseInt(req.params.id);
        const investment = await db.queryOne('SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!investment) return res.status(404).json(fail('持仓不存在'));

        const sellAmount = parseFloat(sell_price) * parseFloat(investment.quantity);

        await db.transaction(async (conn) => {
            // 记录卖出
            const sellTxn = await conn.query(
                `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
         VALUES (?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?)`,
                [req.userId, req.bookId, id, sellAmount, parseFloat(sell_price), parseFloat(investment.quantity), normDate(date), parseFloat(fee) || 0, note || '清仓卖出']
            );

            // 更新持仓状态（写入 sold_date = 清仓当天，供列表「清仓当天保留、隔天归档」）
            await conn.query(
                `UPDATE investments SET current_price=?, current_value=?, quantity=0, status='sold', sold_date=? WHERE id=? AND user_id=? AND book_id=?`,
                [parseFloat(sell_price), sellAmount, fmtDateOnly(new Date()), id, req.userId, req.bookId]
            );

            // 记录到主交易（如果关联了账户）
            if (investment.account_id) {
                const profit = sellAmount - parseFloat(investment.total_cost);
                const sellCatId = await getInvestmentSellCategoryId(conn);
                await conn.query(
                    `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
           VALUES (?, ?, ?, ?, 'income', ?, ?, ?, ?)`,
                    [req.userId, req.bookId, investment.account_id, sellCatId, sellAmount, `卖出${investment.name}，盈亏${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`, normDate(date), sellTxn.insertId]
                );
                // 以账本为准重算账户余额
                const newBalance = await computeAccountBalance(conn, req.userId, investment.account_id);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, investment.account_id]);
            }
        });

        res.json(success(null, '已卖出'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 加仓/减仓（买入/卖出）
router.post('/investments/:id/reduce', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { action, price, quantity: qty, fee: txnFee, date, note } = req.body;
        const isBuy = action === 'buy';
        const q = parseFloat(qty) || 0;
        const p = parseFloat(price) || 0;
        const fee = parseFloat(txnFee) || 0;
        if (q <= 0 || p <= 0) return res.status(400).json(fail('成交价格和数量必须大于0'));

        const investment = await db.queryOne('SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [id, req.userId, req.bookId]);
        if (!investment) return res.status(404).json(fail('持仓不存在'));

        if (!isBuy && q > parseFloat(investment.quantity)) {
            return res.status(400).json(fail('卖出数量不能超过持仓数量'));
        }

        await db.transaction(async (conn) => {
            if (isBuy) {
                // ===== 加仓 =====
                const buyAmount = p * q + fee;
                const newQty = parseFloat(investment.quantity) + q;
                const newTotalCost = parseFloat(investment.total_cost) + buyAmount;
                const avgCost = newQty > 0 ? newTotalCost / newQty : 0;
                const newCurrentValue = newQty * parseFloat(investment.current_price || p);

                const buyInvTxn = await conn.query(
                    `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
                     VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?)`,
                    [req.userId, req.bookId, id, buyAmount, p, q, normDate(date), fee, note || '加仓']
                );
                await conn.query(
                    `UPDATE investments SET quantity=?, total_cost=?, current_value=?, buy_price=?, status='holding', sold_date=NULL WHERE id=? AND user_id=? AND book_id=?`,
                    [newQty, newTotalCost, newCurrentValue, avgCost, id, req.userId, req.bookId]
                );
                if (investment.account_id) {
                    const isIns = await isInsuranceType(conn, investment.investment_type_id);
                    const buyCatId = await getOrCreateInvestmentBuyCategory(conn, isIns);
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
                         VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?)`,
                        [req.userId, req.bookId, investment.account_id, buyCatId, buyAmount, `加仓${investment.name} ${q}份 @ ${p}`, normDate(date), buyInvTxn.insertId]
                    );
                    // 以账本为准重算账户余额
                    const newBalance = await computeAccountBalance(conn, req.userId, investment.account_id);
                    await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, investment.account_id]);
                }
                res.json(success(null, '已加仓'));
            } else {
                // ===== 减仓/卖出 =====
                const sellAmount = p * q - fee;
                const remainingQty = parseFloat(investment.quantity) - q;
                // 券商净投入本金口径：卖出按实际回款(sellAmount)全额从成本基数扣减，
                // 与 recomputeInvestmentPosition 的 sell 分支保持一致（不再按当时均价比例扣减）。
                const newTotalCost = parseFloat(investment.total_cost) - sellAmount;
                const newCurrentValue = remainingQty * parseFloat(investment.current_price || p);
                // 台账备注用的"本笔盈亏"：按卖出前均价估算该笔卖出对应的成本（仅展示，不影响持仓成本口径）。
                const beforeQty = parseFloat(investment.quantity);
                const avgUnitCost = beforeQty > 0 ? parseFloat(investment.total_cost) / beforeQty : 0;
                const reducedCost = avgUnitCost * q;

                const sellInvTxn = await conn.query(
                    `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
                     VALUES (?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?)`,
                    [req.userId, req.bookId, id, sellAmount, p, q, normDate(date), fee, note || '卖出']
                );
                // 做T：卖到 0 也不立即清仓，保持 holding，隔夜由列表查询自动归档。
                // 这样当天先卖后买可连贯计算，不会出现"已清仓"假象。
                await conn.query(
                    `UPDATE investments SET quantity=?, total_cost=?, current_value=?, status='holding', sold_date=NULL WHERE id=? AND user_id=? AND book_id=?`,
                    [remainingQty, newTotalCost, newCurrentValue, id, req.userId, req.bookId]
                );
                if (investment.account_id) {
                    const profit = sellAmount - reducedCost;
                    const sellCatId = await getInvestmentSellCategoryId(conn);
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, investment_txn_id)
           VALUES (?, ?, ?, ?, 'income', ?, ?, ?, ?)`,
                        [req.userId, req.bookId, investment.account_id, sellCatId, sellAmount, `卖出${investment.name}，盈亏${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`, normDate(date), sellInvTxn.insertId]
                    );
                    // 以账本为准重算账户余额
                    const newBalance = await computeAccountBalance(conn, req.userId, investment.account_id);
                    await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, investment.account_id]);
                }
                res.json(success(null, remainingQty > 0 ? '已减仓' : '已清仓'));
            }
        });
    } catch (err) {
        handleServerError(res, err);
    }
});

// 删除理财持仓
router.delete('/investments/:id', async (req, res) => {
    try {
        await db.transaction(async (conn) => {
            const invRows = await conn.query('SELECT * FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
            const inv = invRows[0] || null;

            // 收集需要按账本重算余额的账户（单一真相，避免增量回滚漂移）
            const affectedAccounts = new Set();
            if (inv && inv.account_id) affectedAccounts.add(parseInt(inv.account_id));

            // 该持仓的全部理财流水（建仓/加仓/减仓/清仓/分红/利息）
            const invTxns = await conn.query(
                'SELECT id FROM investment_transactions WHERE investment_id = ? AND user_id = ? AND book_id = ?',
                [req.params.id, req.userId, req.bookId]
            );

            // BUG-1 修复：删除由这些理财流水生成的主交易台账。
            // 建仓/加仓/减仓/清仓/分红/利息每笔都回填了 investment_txn_id 反向指针，
            // 仅回滚 create_transaction_id 会遗漏其余台账，导致孤儿交易 + 账户余额不回滚。
            // 建仓那笔台账的 investment_txn_id 即初始买入流水 id，已包含在下述 IN 子句中，一并清理。
            if (invTxns.length) {
                const ids = invTxns.map(t => t.id);
                const placeholders = ids.map(() => '?').join(',');
                const linked = await conn.query(
                    `SELECT id, account_id FROM transactions WHERE investment_txn_id IN (${placeholders}) AND user_id = ? AND book_id = ?`,
                    [...ids, req.userId, req.bookId]
                );
                linked.forEach(t => { if (t.account_id) affectedAccounts.add(parseInt(t.account_id)); });
                await conn.query(
                    `DELETE FROM transactions WHERE investment_txn_id IN (${placeholders}) AND user_id = ? AND book_id = ?`,
                    [...ids, req.userId, req.bookId]
                );
            }

            // 删除理财流水与持仓本身
            await conn.query('DELETE FROM investment_transactions WHERE investment_id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
            await conn.query('DELETE FROM investments WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);

            // 以账本为准统一重算受影响账户余额
            for (const aid of affectedAccounts) {
                if (!aid) continue;
                const newBalance = await computeAccountBalance(conn, req.userId, aid);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalance, aid]);
            }
        });
        res.json(success(null, '持仓已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});
// 查询单个代码行情（自动识别类型）
router.get('/quote', async (req, res) => {
    try {
        const { code, category } = req.query;
        if (!code) return res.status(400).json(fail('请提供产品代码'));
        const c = String(code).trim();
        // category 可以是 fund/stock/deposit/other，默认 fund
        const invCategory = category || 'fund';
        const data = await fetchQuoteByCategory(invCategory, c, { withName: true });
        return res.json(success({ type: data.source, ...data }));
    } catch (err) {
        console.error('[行情查询]', err.message);
        res.status(502).json(fail('行情查询失败：' + err.message));
    }
});

// 刷新单个持仓行情
router.post('/:id/refresh', async (req, res) => {
    try {
        const inv = await db.queryOne(
            `SELECT i.*, it.category as type_category
             FROM investments i JOIN investment_types it ON i.investment_type_id = it.id
             WHERE i.id = ? AND i.user_id = ? AND i.book_id = ?`,
            [req.params.id, req.userId, req.bookId]
        );
        if (!inv) return res.status(404).json(fail('持仓不存在'));
        if (!inv.code || !String(inv.code).trim()) return res.status(400).json(fail('该持仓无产品代码'));

        const strategy = getQuoteStrategy(inv.type_category, inv.code);
        if (!strategy) return res.status(400).json(fail('该品类不支持行情查询'));
        // 统一使用 market-data.js 的 fetchPriceForInvestment
        const { price, navDate, name } = await fetchPriceForInvestment(inv);

        const qty = parseFloat(inv.quantity);
        const currentValue = price * qty;
        const totalCost = parseFloat(inv.total_cost);
        const actualRate = totalCost > 0 ? ((currentValue - totalCost) / totalCost * 100) : 0;

        await db.query(
            'UPDATE investments SET current_price=?, current_value=?, actual_rate=?, nav_date=? WHERE id=? AND user_id=? AND book_id=?',
            [price, currentValue, actualRate, navDate || null, inv.id, req.userId, req.bookId]
        );

        res.json(success({
            id: inv.id, name: name || inv.name,
            current_price: price, current_value: currentValue,
            actual_rate: actualRate, nav_date: navDate
        }, '行情已更新'));
    } catch (err) {
        console.error('[刷新持仓]', err.message);
        res.status(502).json(fail('行情刷新失败：' + err.message));
    }
});

// 一键刷新全部持仓行情
router.post('/refresh-all', async (req, res) => {
    try {
        const investments = await db.query(
            `SELECT i.*, it.category as type_category
             FROM investments i JOIN investment_types it ON i.investment_type_id = it.id
             WHERE i.user_id = ? AND i.book_id = ? AND i.status = 'holding' AND i.code IS NOT NULL AND i.code != ''`,
            [req.userId, req.bookId]
        );
        if (investments.length === 0) return res.json(success({ updated: 0, results: [] }, '无需要刷新的持仓'));

        const results = [];
        for (const inv of investments) {
            try {
                const strategy = getQuoteStrategy(inv.type_category, inv.code);
                if (!strategy) {
                    results.push({ id: inv.id, code: inv.code, status: 'skipped', reason: '该品类不支持行情查询' });
                    continue;
                }
                const { price, navDate, name } = await fetchPriceForInvestment(inv);

                const qty = parseFloat(inv.quantity);
                const currentValue = price * qty;
                const totalCost = parseFloat(inv.total_cost);
                const actualRate = totalCost > 0 ? ((currentValue - totalCost) / totalCost * 100) : 0;

                await db.query(
                    'UPDATE investments SET current_price=?, current_value=?, actual_rate=?, nav_date=? WHERE id=? AND user_id=? AND book_id=?',
                    [price, currentValue, actualRate, navDate || null, inv.id, req.userId, req.bookId]
                );
                results.push({ id: inv.id, code: inv.code, name: name || inv.name, price, currentValue, actualRate, navDate, status: 'ok' });
            } catch (e) {
                results.push({ id: inv.id, code: inv.code, status: 'error', reason: e.message });
            }
        }
        const updated = results.filter(r => r.status === 'ok').length;
        res.json(success({ updated, results }, `已更新 ${updated}/${investments.length} 个持仓`));
    } catch (err) {
        handleServerError(res, err, '批量刷新行情');
    }
});

module.exports = router;
// 导出内部 helper 供集成测试验证台账一致性
module.exports.createInvestmentCreateTxn = createInvestmentCreateTxn;
module.exports.rollbackInvestmentCreateTxn = rollbackInvestmentCreateTxn;
