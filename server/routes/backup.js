/* ============================================
   鑫钱包 · 账本备份（xlsx 3 工作表）
   导出：账本配置页 / 账户页 / 账单流水页（像微信账单，可识别、可恢复）
   导入：解析上述 3 工作表，事务内完整恢复（账户/分类/标签/预算/债务/储蓄目标/交易/转账）
   ============================================ */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');

const db = require('../db');
const { success, fail, handleServerError, computeAccountBalance } = require('./_helpers');
const { toAmount } = require('../validate');
const { recomputeInvestmentPosition } = require('./transactions');

// 备份文件识别标记：导入时校验，避免误读普通 xlsx
const BACKUP_MARK = '鑫钱包账本备份';
const BACKUP_VERSION = 1;

// 工作表名称（导出/导入均依赖，改名需同步）
const SHEET_CONFIG = '账本配置页';
const SHEET_ACCOUNTS = '账户页';
const SHEET_TX = '账单流水页';
const SHEET_INV_TX = '理财流水页'; // 可选工作表：原始理财交易流水（导入时据此复现，而非只写计算快照）

// 各工作表内的「区段标题」（解析时据此切换区块）
const CONFIG_SECTIONS = ['账本', '分类', '标签', '预算', '债务', '储蓄目标'];
const ACCOUNT_SECTIONS = ['账户', '理财持仓'];
const TX_SECTION = '交易';

// 仅接受 xlsx（基于内容类型或扩展名），5MB 上限，内存暂存不落盘
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || /\.xlsx$/i.test(file.originalname || '');
        if (!ok) return cb(new Error('仅支持 .xlsx 备份文件'));
        cb(null, true);
    }
});

// ==========================================
// 工具：单元格取值统一为字符串（日期保留日期部分）
// ==========================================
function cellStr(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object' && v.text != null) return String(v.text);
    if (typeof v === 'object' && v.result != null) return String(v.result);
    return String(v);
}
function cellNum(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function fmtDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).replace('T', ' ').replace('Z', '');
    return s.slice(0, 10);
}
function fmtDateTime(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
    const s = String(v).replace('T', ' ').replace('Z', '');
    return s.slice(0, 19);
}

// ==========================================
// 构建工作簿（纯函数，便于单测，不依赖 DB）
// ==========================================
function addSection(ws, title, headers, rows) {
    // 段间留一空行
    ws.addRow([]);
    ws.addRow([title]);
    ws.addRow(headers);
    for (const r of (rows || [])) ws.addRow(r);
}

function buildWorkbook(data) {
    const wb = new ExcelJS.Workbook();
    wb.creator = '鑫钱包';
    wb.created = new Date();
    wb.modified = new Date();

    const book = data.book || {};

    const catRows = (data.categories || []).map(c => [
        c.code || '', c.name, c.type, c.icon || '', c.color || '', c.is_system ? '是' : '否', c.parent_name || ''
    ]);
    const tagRows = (data.tags || []).map(t => [t.name, t.color || '', t.icon || '']);
    const budgetRows = (data.budgets || []).map(b => [b.name, b.period_type, b.amount, fmtDate(b.start_date), fmtDate(b.end_date)]);
    const debtRows = (data.debts || []).map(d => [
        d.name, d.type, d.direction, d.creditor || '', d.principal, d.remaining, d.interest_rate, d.term_months,
        d.method, d.monthly_payment, fmtDate(d.start_date), fmtDate(d.due_date), d.billing_day, d.payment_day,
        d.min_payment, d.status, d.note || '', d.account_name || ''
    ]);
    const goalRows = (data.savings_goals || []).map(g => [g.name, g.target_amount, g.current_amount, g.account_name || '', g.icon || '', g.note || '', g.status]);
    const accountRows = (data.accounts || []).map(a => [
        a.code || '', a.name, a.type, a.icon || '', a.balance, a.opening_balance, a.credit_limit,
        a.is_default ? '是' : '否', a.status || 'active'
    ]);
    const investRows = (data.investments || []).map(i => [
        i.name, i.code || '', i.type_name || '', i.account_name || '', i.buy_price, i.current_price, i.quantity,
        i.total_cost, i.current_value, i.fee, fmtDateTime(i.buy_date), i.expected_rate, i.status, i.note || ''
    ]);
    const txRows = (data.transactions || []).map(t => [
        fmtDateTime(t.date) || fmtDate(t.date), t.type_label, t.amount, t.account, t.category || '', t.note || '', t.counterparty || ''
    ]);
    // 理财交易流水：原始买卖/红利记录，导入时据此复现（而非合成单笔建仓）。
    const invTxRows = (data.investmentTxns || []).map(t => [
        t.investment_name || '', t.account_name || '', t.type, fmtDate(t.date) || fmtDate(t.date),
        t.amount, t.price, t.quantity, t.fee, t.note || ''
    ]);

    // ---- Sheet 1: 账本配置页 ----
    const cfg = wb.addWorksheet(SHEET_CONFIG);
    cfg.addRow([BACKUP_MARK]);
    cfg.addRow(['版本', BACKUP_VERSION]);
    cfg.addRow(['导出时间', new Date().toISOString()]);
    cfg.addRow(['账本', book.name || '默认账本']);
    addSection(cfg, '账本', ['名称', '图标', '颜色', '默认'],
        [[book.name || '默认账本', book.icon || '📒', book.color || '#6366f1', book.is_default ? '是' : '否']]);
    addSection(cfg, '分类', ['编码', '名称', '类型', '图标', '颜色', '系统预设', '父分类'], catRows);
    addSection(cfg, '标签', ['名称', '颜色', '图标'], tagRows);
    addSection(cfg, '预算', ['名称', '周期', '金额', '开始日期', '结束日期'], budgetRows);
    addSection(cfg, '债务', ['名称', '类型', '方向', '债权人', '本金', '剩余', '利率', '期数', '还款方式', '月供', '开始日期', '到期日', '账单日', '还款日', '最低还款', '状态', '备注', '关联账户'], debtRows);
    addSection(cfg, '储蓄目标', ['名称', '目标金额', '当前金额', '关联账户', '图标', '备注', '状态'], goalRows);

    // ---- Sheet 2: 账户页 ----
    const acc = wb.addWorksheet(SHEET_ACCOUNTS);
    acc.addRow([SHEET_ACCOUNTS]);
    addSection(acc, '账户', ['编码', '名称', '类型', '图标', '余额', '期初余额', '信用额度', '默认', '状态'], accountRows);
    addSection(acc, '理财持仓', ['名称', '代码', '类型', '关联账户', '买入价', '现价', '数量', '成本价', '现值', '手续费', '买入日期', '预期收益率', '状态', '备注'], investRows);

    // ---- Sheet 3: 账单流水页 ----
    const tx = wb.addWorksheet(SHEET_TX);
    tx.addRow([SHEET_TX]);
    addSection(tx, TX_SECTION, ['时间', '类型', '金额', '账户', '分类', '备注', '对方账户'], txRows);

    // ---- Sheet 4: 理财流水页（可选，旧备份无此表则导入时回退到合成建仓）----
    const invTx = wb.addWorksheet(SHEET_INV_TX);
    invTx.addRow([SHEET_INV_TX]);
    addSection(invTx, '理财流水', ['持仓名称', '关联账户', '类型', '日期', '金额', '价格', '数量', '手续费', '备注'], invTxRows);

    return wb;
}

// ==========================================
// 解析工作簿（纯函数，便于单测，不依赖 DB）
// ==========================================
// 在单个工作表内解析各「区段」：区段标题行 → 表头行 → 数据行
function parseSections(ws, knownTitles) {
    const out = {};
    let current = null;
    let headers = null;
    ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 标题行跳过
        const title = cellStr(row.getCell(1).value).trim();
        if (knownTitles.includes(title)) {
            current = title;
            out[current] = [];
            headers = null;
            return;
        }
        if (!current) return;
        const vals = [];
        row.eachCell((cell, colNumber) => { vals[colNumber - 1] = cellStr(cell.value); });
        if (!headers) { headers = vals; return; }
        if (vals.every(v => v === '')) return; // 空行跳过
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] != null ? vals[i] : ''); });
        out[current].push(obj);
    });
    return out;
}

function parseWorkbook(buf) {
    const wb = new ExcelJS.Workbook();
    return wb.xlsx.load(buf).then(() => {
        const cfgWs = wb.getWorksheet(SHEET_CONFIG);
        const accWs = wb.getWorksheet(SHEET_ACCOUNTS);
        const txWs = wb.getWorksheet(SHEET_TX);
        if (!cfgWs || !accWs || !txWs) {
            throw new Error('备份文件缺少必需的工作表（账本配置页/账户页/账单流水页）');
        }
        const mark = cellStr(cfgWs.getRow(1).getCell(1).value);
        if (mark !== BACKUP_MARK) {
            throw new Error('不是有效的鑫钱包账本备份文件');
        }
        const config = parseSections(cfgWs, CONFIG_SECTIONS);
        const accounts = parseSections(accWs, ACCOUNT_SECTIONS);
        const tx = parseSections(txWs, [TX_SECTION]);
        // 理财流水页为可选工作表：旧备份（无此表）导入时回退到合成建仓。
        const invTxWs = wb.getWorksheet(SHEET_INV_TX);
        const invTx = invTxWs ? parseSections(invTxWs, ['理财流水']) : {};
        return {
            version: cellNum(cfgWs.getRow(2).getCell(2).value) || BACKUP_VERSION,
            bookName: (config['账本'] && config['账本'][0] && config['账本'][0]['名称']) || '',
            config,
            accounts,
            investmentTxns: (invTx['理财流水'] || []),
            transactions: (tx[TX_SECTION] || [])
        };
    });
}

// ==========================================
// 导出接口：GET /backup/export  → 下载 xlsx
// ==========================================
router.get('/export', async (req, res) => {
    try {
        const userId = req.userId;
        const bookId = req.bookId;

        const [book, cats, tags, budgets, debts, goals, accounts, investments, investmentTxns, incExp, transfers] = await Promise.all([
            db.queryOne('SELECT name, icon, color, is_default FROM books WHERE id = ? AND user_id = ?', [bookId, userId]),
            db.query(
                `SELECT c.code, c.name, c.type, c.icon, c.color, c.is_system,
                        p.name AS parent_name
                   FROM categories c LEFT JOIN categories p ON c.parent_id = p.id
                  WHERE c.user_id IS NULL OR (c.user_id = ? AND (c.book_id IS NULL OR c.book_id = ?))
                  ORDER BY c.type, c.sort_order, c.id`,
                [userId, bookId]
            ),
            db.query('SELECT name, color, icon FROM tags WHERE user_id = ? AND book_id = ?', [userId, bookId]),
            db.query('SELECT name, period_type, amount, start_date, end_date FROM budgets WHERE user_id = ? AND book_id = ?', [userId, bookId]),
            db.query(
                `SELECT d.name, d.type, direction, creditor, principal, remaining, interest_rate, term_months,
                        method, monthly_payment, start_date, due_date, billing_day, payment_day, min_payment,
                        d.status, note, a.name AS account_name
                   FROM debts d LEFT JOIN accounts a ON d.account_id = a.id
                  WHERE d.user_id = ? AND d.book_id = ?`,
                [userId, bookId]
            ),
            db.query(
                `SELECT g.name, target_amount, current_amount, g.icon, note, g.status, a.name AS account_name
                   FROM savings_goals g LEFT JOIN accounts a ON g.account_id = a.id
                  WHERE g.user_id = ? AND g.book_id = ?`,
                [userId, bookId]
            ),
            db.query(
                `SELECT code, name, type, icon, balance, opening_balance, credit_limit, is_default, status
                   FROM accounts WHERE user_id = ? AND book_id = ? ORDER BY sort_order, id`,
                [userId, bookId]
            ),
            db.query(
                `SELECT i.name, i.code, i.buy_price, i.current_price, i.quantity, i.total_cost, i.current_value,
                       i.fee, i.buy_date, i.expected_rate, i.status, i.note, a.name AS account_name, it.name AS type_name
                   FROM investments i LEFT JOIN accounts a ON i.account_id = a.id
                   LEFT JOIN investment_types it ON i.investment_type_id = it.id
                  WHERE i.user_id = ? AND i.book_id = ?`,
                [userId, bookId]
            ),
            db.query(
                `SELECT it.type, CAST(it.date AS CHAR(10)) AS date, it.amount, it.price, it.quantity, it.fee, it.note,
                       i.name AS investment_name, a.name AS account_name
                   FROM investment_transactions it
                   LEFT JOIN investments i ON it.investment_id = i.id
                   LEFT JOIN accounts a ON i.account_id = a.id
                  WHERE it.user_id = ? AND it.book_id = ?
                  ORDER BY i.name, it.date ASC, it.id ASC`,
                [userId, bookId]
            ),
            db.query(
                `SELECT CAST(t.date AS CHAR(19)) AS date, t.type, t.amount, a.name AS account, c.name AS category, t.note
                   FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
                   LEFT JOIN categories c ON t.category_id = c.id
                  WHERE t.user_id = ? AND t.book_id = ? AND t.type IN ('income','expense')
                  ORDER BY t.date DESC, t.id DESC`,
                [userId, bookId]
            ),
            db.query(
                `SELECT CAST(t.date AS CHAR(19)) AS date, t.amount, t.note,
                        a1.name AS from_account, a2.name AS to_account
                   FROM transfers t LEFT JOIN accounts a1 ON t.from_account_id = a1.id
                   LEFT JOIN accounts a2 ON t.to_account_id = a2.id
                  WHERE t.user_id = ? AND t.book_id = ?
                  ORDER BY t.date DESC, t.id DESC`,
                [userId, bookId]
            )
        ]);

        const transactions = [
            ...incExp.map(r => ({
                date: r.date, type_label: r.type === 'income' ? '收入' : '支出',
                amount: Math.round(parseFloat(r.amount) * 100) / 100,
                account: r.account || '', category: r.category || '', note: r.note || '', counterparty: ''
            })),
            ...transfers.map(r => ({
                date: r.date, type_label: '转账',
                amount: Math.round(parseFloat(r.amount) * 100) / 100,
                account: r.from_account || '', category: '', note: r.note || '', counterparty: r.to_account || ''
            }))
        ];

        const wb = buildWorkbook({
            book: book || { name: '默认账本', icon: '📒', color: '#6366f1', is_default: true },
            categories: cats,
            tags: tags,
            budgets: budgets,
            debts: debts,
            savings_goals: goals,
            accounts: accounts,
            investments: investments,
            investmentTxns: investmentTxns,
            transactions
        });

        const buf = await wb.xlsx.writeBuffer();
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="xinwallet_backup_${date}.xlsx"`);
        res.status(200).send(Buffer.from(buf));
    } catch (err) { handleServerError(res, err, '账本导出'); }
});

// ==========================================
// 导入接口：POST /backup/import  → 上传 xlsx 并恢复
// ==========================================
router.post('/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json(fail('请上传 .xlsx 备份文件'));
        let parsed;
        try {
            parsed = await parseWorkbook(req.file.buffer);
        } catch (e) {
            return res.status(400).json(fail(e.message || '备份文件解析失败'));
        }
        const { config, accounts, transactions, investmentTxns } = parsed;
        const userId = req.userId;
        const bookId = req.bookId;

        const imported = { tags: 0, accounts: 0, categories: 0, budgets: 0, debts: 0, savings_goals: 0, investments: 0, transactions: 0, transfers: 0 };

        const transferCat = await db.queryOne(
            "SELECT id FROM categories WHERE name='转账' AND type='transfer' AND (user_id IS NULL OR user_id=?) LIMIT 1",
            [userId]
        );
        const transferCatId = transferCat ? transferCat.id : 22;

        await db.transaction(async (conn) => {
            // 0) 先清空当前账本全部数据，保证导入后是「干净账本」（替换而非合并）。
            //    仅删除本用户本账本的数据；系统预设分类(user_id IS NULL)全局共享，保留不删。
            //    这些表之间没有外键约束，按依赖逻辑先删子表再删父表；分类含自引用，逐级删叶子后清顶层。
            await conn.query('DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ? AND book_id = ?)', [userId, bookId]);
            await conn.query('DELETE FROM transactions WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM transfers WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM investments WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM investment_transactions WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM debts WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM debt_repayments WHERE user_id = ?', [userId]);
            await conn.query('DELETE FROM savings_goals WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM savings_transactions WHERE user_id = ?', [userId]);
            await conn.query('DELETE FROM budgets WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM tags WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            await conn.query('DELETE FROM accounts WHERE user_id = ? AND book_id = ?', [userId, bookId]);
            // 分类：清空本账本用户自建分类（系统预设保留）。
            // 用派生表包一层子查询，规避 MySQL「不能在 DELETE 子查询中引用同表」的限制，跨方言兼容。
            await conn.query(
                `DELETE FROM categories
                  WHERE user_id = ? AND book_id = ?
                    AND parent_id IS NOT NULL
                    AND parent_id IN (
                        SELECT id FROM (
                            SELECT id FROM categories WHERE user_id = ? AND book_id = ?
                        ) AS _t
                    )`,
                [userId, bookId, userId, bookId]
            );
            await conn.query('DELETE FROM categories WHERE user_id = ? AND book_id = ?', [userId, bookId]);

            // 1) 标签
            for (const t of (config['标签'] || [])) {
                if (!t || !String(t['名称'] || '').trim()) continue;
                const e = await conn.query('SELECT id FROM tags WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, t['名称']]);
                if (!e || !e.length) {
                    await conn.query(
                        'INSERT INTO tags (user_id, book_id, name, color, icon) VALUES (?, ?, ?, ?, ?)',
                        [userId, bookId, t['名称'], typeof t['颜色'] === 'string' ? t['颜色'] : '#6366f1', typeof t['图标'] === 'string' ? t['图标'] : '🏷️']
                    );
                    imported.tags++;
                }
            }

            // 1.5) 分类：仅导入「用户自建」分类（系统预设全局共享，跳过），并建立 名称→id 映射，
            //      供交易/转账按分类名解析；父分类按名称解析（先查本轮已建，再查全局系统分类）。
            const catNameToId = {};
            {
                const pendingCats = (config['分类'] || []).filter(c => c && String(c['名称'] || '').trim() && c['系统预设'] !== '是');
                let progressed = true;
                while (pendingCats.length && progressed) {
                    progressed = false;
                    for (let i = pendingCats.length - 1; i >= 0; i--) {
                        const c = pendingCats[i];
                        const name = String(c['名称']).trim();
                        const pname = c['父分类'] ? String(c['父分类']).trim() : '';
                        let parentId = null;
                        if (pname) {
                            if (catNameToId[pname] != null) parentId = catNameToId[pname];
                            else {
                                const pr = await conn.query('SELECT id FROM categories WHERE user_id IS NULL AND name = ? LIMIT 1', [pname]);
                                if (pr.length) parentId = pr[0].id;
                                else continue; // 父分类尚未就绪，下一轮再试
                            }
                        }
                        const existSql = 'SELECT id FROM categories WHERE user_id = ? AND book_id = ? AND name = ? AND '
                            + (parentId == null ? 'parent_id IS NULL' : 'parent_id = ?');
                        const existParams = parentId == null ? [userId, bookId, name] : [userId, bookId, name, parentId];
                        const ex = await conn.query(existSql, existParams);
                        let newId;
                        if (ex.length) {
                            newId = ex[0].id;
                        } else {
                            // code/is_system 原为 SQL 字面量，改走绑定参数以保持全参数化
                            const ins = await conn.query(
                                db.insertIgnoreSql('categories', ['user_id', 'book_id', 'code', 'name', 'type', 'icon', 'color', 'is_system', 'parent_id', 'sort_order']),
                                [
                                    userId, bookId, null, name,
                                    ['expense', 'income', 'transfer'].includes(c['类型']) ? c['类型'] : 'expense',
                                    typeof c['图标'] === 'string' && c['图标'] ? c['图标'] : '📌',
                                    typeof c['颜色'] === 'string' && c['颜色'] ? c['颜色'] : '#6366f1',
                                    false, parentId, 0
                                ]
                            );
                            const got = await conn.query(existSql, existParams);
                            newId = got.length ? got[0].id : (ins.insertId != null ? ins.insertId : null);
                        }
                        if (newId != null) {
                            catNameToId[name] = newId;
                            imported.categories++;
                            pendingCats.splice(i, 1);
                            progressed = true;
                        }
                    }
                }
            }

            // 2) 账户（建立 名称→id 映射，供后续引用）
            const acMap = {};
            for (const a of (accounts['账户'] || [])) {
                if (!a || !String(a['名称'] || '').trim()) continue;
                const e = await conn.query('SELECT id FROM accounts WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, a['名称']]);
                if (e && e.length) { acMap[a['名称']] = e[0].id; continue; }
                const balance = cellNum(a['余额']);
                const opening = cellNum(a['期初余额']);
                const limit = cellNum(a['信用额度']);
                const r = await conn.query(
                    `INSERT INTO accounts (user_id, book_id, code, name, type, icon, balance, opening_balance, credit_limit, is_default, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId, bookId,
                        typeof a['编码'] === 'string' && a['编码'] ? a['编码'] : null,
                        a['名称'],
                        typeof a['类型'] === 'string' && a['类型'] ? a['类型'] : 'bank_card',
                        typeof a['图标'] === 'string' ? a['图标'] : '💰',
                        Number.isFinite(balance) ? balance : 0,
                        Number.isFinite(opening) ? opening : 0,
                        Number.isFinite(limit) ? limit : 0,
                        a['默认'] === '是' ? true : false,
                        a['状态'] === 'closed' ? 'closed' : 'active'
                    ]
                );
                acMap[a['名称']] = r.insertId;
                imported.accounts++;
            }
            // 账户 id → 名称 反向映射（转账备注展示用）
            const idToName = {};
            for (const [n, id] of Object.entries(acMap)) idToName[id] = n;

            async function resolveCategoryId(name) {
                if (!name) return 14;
                const c = await conn.query(
                    'SELECT id FROM categories WHERE name = ? AND (user_id IS NULL OR user_id = ?) LIMIT 1',
                    [name, userId]
                );
                return c && c.length ? c[0].id : 14;
            }

            // 3) 理财持仓
            // 按 (持仓名称|关联账户) 归集原始理财流水：导入时若有真实流水则据此复现，
            // 否则回退到合成单笔「导入建仓」使快照闭合（兼容旧备份/手动持仓）。
            const invTxKey = (name, acct) => `${String(name || '').trim()}|${acct || ''}`;
            const invTxByKey = {};
            for (const f of (investmentTxns || [])) {
                const key = invTxKey(f['持仓名称'], f['关联账户']);
                if (!f || !String(f['持仓名称'] || '').trim()) continue;
                (invTxByKey[key] = invTxByKey[key] || []).push(f);
            }
            for (const i of (accounts['理财持仓'] || [])) {
                if (!i || !String(i['名称'] || '').trim()) continue;
                const aid = i['关联账户'] ? acMap[i['关联账户']] : null;
                const it = await conn.query('SELECT id FROM investment_types WHERE name = ?', [String(i['类型'] || '其他')]);
                const ins = await conn.query(
                    `INSERT INTO investments (user_id, book_id, account_id, investment_type_id, name, code, buy_price, current_price, quantity, total_cost, current_value, fee, buy_date, expected_rate, status, note)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId, bookId, aid, it && it.length ? it[0].id : 1,
                        i['名称'], String(i['代码'] || ''),
                        cellNum(i['买入价']) || 0, cellNum(i['现价']) || 0, cellNum(i['数量']) || 0,
                        cellNum(i['成本价']) || 0, cellNum(i['现值']) || 0, cellNum(i['手续费']) || 0,
                        fmtDate(i['买入日期']) || new Date().toISOString().slice(0, 10),
                        cellNum(i['预期收益率']) || 0,
                        i['状态'] === 'sold' || i['状态'] === 'expired' ? i['状态'] : 'holding',
                        String(i['备注'] || '')
                    ]
                );
                const newInvId = ins ? (ins.insertId != null ? ins.insertId : (ins[0] && ins[0].id)) : null;
                imported.investments++;
                // 系统持仓的唯一真相来自 investment_transactions（recomputeInvestmentPosition 仅按流水重算）。
                // 优先复现原始流水：逐笔写入后按净本金口径重算，得到与线上一致的持仓（含做T/负成本）；
                // 无原始流水则合成单笔「导入建仓」使快照闭合，删除某笔交易触发重算时也不会清零。
                const q0 = cellNum(i['数量']) || 0;
                const flows = invTxByKey[invTxKey(i['名称'], i['关联账户'])];
                if (newInvId && flows && flows.length) {
                    for (const f of flows) {
                        const ftype = String(f['类型'] || '').trim();
                        const allowed = ['buy', 'sell', 'reinvest', 'dividend', 'interest'];
                        const type = allowed.includes(ftype) ? ftype : 'buy';
                        const fdate = fmtDate(f['日期']) || fmtDate(i['买入日期']) || new Date().toISOString().slice(0, 10);
                        await conn.query(
                            `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, fee, note)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                userId, bookId, newInvId, type,
                                cellNum(f['金额']) || 0, cellNum(f['价格']) || 0, cellNum(f['数量']) || 0,
                                fdate, cellNum(f['手续费']) || 0, String(f['备注'] || '')
                            ]
                        );
                    }
                    await recomputeInvestmentPosition(conn, newInvId, userId);
                } else if (newInvId && q0 > 0) {
                    await conn.query(
                        `INSERT INTO investment_transactions (user_id, book_id, investment_id, type, amount, price, quantity, date, note)
                         VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, '导入建仓')`,
                        [
                            userId, bookId, newInvId,
                            cellNum(i['成本价']) || 0, cellNum(i['买入价']) || 0, q0,
                            fmtDate(i['买入日期']) || new Date().toISOString().slice(0, 10)
                        ]
                    );
                }
            }

            // 4) 预算
            for (const b of (config['预算'] || [])) {
                if (!b || !String(b['名称'] || '').trim()) continue;
                await conn.query(
                    db.insertIgnoreSql('budgets', ['user_id', 'book_id', 'name', 'period_type', 'amount', 'start_date', 'end_date']),
                    [userId, bookId, b['名称'], ['month', 'quarter', 'half', 'year'].includes(b['周期']) ? b['周期'] : 'month', cellNum(b['金额']) || 0, fmtDate(b['开始日期']), fmtDate(b['结束日期']) || fmtDate(b['开始日期'])]
                );
                imported.budgets++;
            }

            // 5) 债务
            for (const d of (config['债务'] || [])) {
                if (!d || !String(d['名称'] || '').trim()) continue;
                const aid = d['关联账户'] ? acMap[d['关联账户']] : null;
                await conn.query(
                    db.insertIgnoreSql('debts', ['user_id', 'book_id', 'account_id', 'name', 'type', 'direction', 'creditor', 'principal', 'remaining', 'interest_rate', 'term_months', 'method', 'monthly_payment', 'start_date', 'due_date', 'billing_day', 'payment_day', 'min_payment', 'status', 'note']),
                    [
                        userId, bookId, aid, d['名称'],
                        ['credit_card', 'loan', 'personal', 'other'].includes(d['类型']) ? d['类型'] : 'loan',
                        d['方向'] === 'receivable' ? 'receivable' : 'payable',
                        String(d['债权人'] || ''),
                        cellNum(d['本金']) || 0, cellNum(d['剩余']) || 0,
                        cellNum(d['利率']) || 0, cellNum(d['期数']) || 0,
                        ['equal_installment', 'equal_principal', 'interest_only', 'minimum', 'lump_sum', 'manual'].includes(d['还款方式']) ? d['还款方式'] : 'equal_installment',
                        cellNum(d['月供']) || 0,
                        fmtDate(d['开始日期']), fmtDate(d['到期日']),
                        cellNum(d['账单日']), cellNum(d['还款日']),
                        cellNum(d['最低还款']) || 0,
                        ['active', 'paid_off', 'overdue'].includes(d['状态']) ? d['状态'] : 'active',
                        String(d['备注'] || '')
                    ]
                );
                imported.debts++;
            }

            // 6) 储蓄目标
            for (const g of (config['储蓄目标'] || [])) {
                if (!g || !String(g['名称'] || '').trim()) continue;
                const aid = g['关联账户'] ? acMap[g['关联账户']] : null;
                await conn.query(
                    db.insertIgnoreSql('savings_goals', ['user_id', 'book_id', 'name', 'target_amount', 'current_amount', 'account_id', 'icon', 'note', 'status']),
                    [
                        userId, bookId, g['名称'],
                        cellNum(g['目标金额']) || 0, cellNum(g['当前金额']) || 0, aid,
                        typeof g['图标'] === 'string' ? g['图标'] : '🎯',
                        String(g['备注'] || ''),
                        ['active', 'completed', 'archived'].includes(g['状态']) ? g['状态'] : 'active'
                    ]
                );
                imported.savings_goals++;
            }

            // 7) 交易 + 转账
            for (const t of (transactions || [])) {
                const typeLabel = String(t['类型'] || '').trim();
                const amount = toAmount(t['金额']);
                if (amount === null || amount <= 0) continue;

                if (typeLabel === '转账') {
                    const fa = acMap[t['账户']];
                    const ta = acMap[t['对方账户']];
                    if (!fa || !ta) continue;
                    const date = fmtDateTime(t['时间']) || fmtDate(t['时间']) || new Date().toISOString().slice(0, 19);
                    const note = String(t['备注'] || '');
                    const ins = await conn.query(
                        `INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
                        [userId, bookId, fa, ta, amount, note, date]
                    );
                    const tid = ins.insertId;
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                         VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
                        [userId, bookId, fa, transferCatId, amount, `转账至${idToName[ta] || '对方'}`, date, tid, fa]
                    );
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                         VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
                        [userId, bookId, ta, transferCatId, amount, `来自${idToName[fa] || '对方'}`, date, tid, ta]
                    );
                    imported.transfers++;
                } else {
                    const aid = acMap[t['账户']];
                    if (!aid) continue;
                    const catId = await resolveCategoryId(t['分类']);
                    const typeVal = typeLabel === '收入' ? 'income' : 'expense';
                    const date = fmtDateTime(t['时间']) || fmtDate(t['时间']) || new Date().toISOString().slice(0, 19);
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [userId, bookId, aid, catId, typeVal, amount, String(t['备注'] || ''), date]
                    );
                    imported.transactions++;
                }
            }

            // 7.5) 导入后回填投资台账的 investment_txn_id 指针。
            // 账单流水页把投资台账当作普通 income/expense 恢复（无指针），理财流水页又重建了
            // investment_transactions（新 id）。若不重建关联，删除投资流水时后台账会再次残留、
            // 余额不回退——正是本次修复的问题场景。按「账户 + 收支方向 + 金额 + 同日」唯一命中才回填，
            // 歧义或金额差 1 分等无法唯一命中的跳过，绝不猜测。
            // try/catch 包裹：回填失败只影响"删除时能否精确清理后台账"，绝不阻断已恢复的账本。
            try {
              await backfillInvestmentLinks(conn, userId, bookId);
            } catch (e) {
              console.error('[导入] 回填投资台账指针异常（不影响已恢复账本）:', e && e.message);
            }

            // 8) 以账本为准重算所有导入账户余额，避免直接写入导致漂移
            for (const name of Object.keys(acMap)) {
                const newBal = await computeAccountBalance(conn, userId, acMap[name]);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBal, acMap[name]]);
            }
        });

        res.json(success({ imported }, '已在清空当前账本后恢复备份（干净账本）'));
    } catch (err) { handleServerError(res, err, '账本导入'); }
});

// 导入后重建投资台账与理财流水的关联指针（防删除后孤儿残留）。
// 仅按「账户 + 收支方向 + 金额 + 同日」唯一命中时才回填；多条歧义一律跳过，绝不猜测。
// DATE(date)=DATE(?) 跨 PG/MySQL 兼容，容忍台账与流水之间的时分秒差异。
async function backfillInvestmentLinks(conn, userId, bookId) {
  const invTxns = await conn.query(
    `SELECT it.id, it.type, it.amount, CAST(it.date AS CHAR(10)) AS date, inv.account_id
       FROM investment_transactions it
       JOIN investments inv ON inv.id = it.investment_id
      WHERE it.user_id = ? AND it.book_id = ?`,
    [userId, bookId]
  );
  for (const it of invTxns) {
    if (!it.account_id) continue; // 持仓未绑定账户时不会生成台账，跳过
    const dir = (it.type === 'sell' || it.type === 'dividend' || it.type === 'interest') ? 'income' : 'expense';
    const cands = await conn.query(
      `SELECT id FROM transactions
        WHERE user_id = ? AND book_id = ? AND account_id = ?
          AND type = ? AND amount = ? AND DATE(date) = DATE(?) AND investment_txn_id IS NULL
          AND (note LIKE '买入·%' OR note LIKE '加仓%' OR note LIKE '卖出%'
               OR note LIKE '分红-%' OR note LIKE '利息-%' OR note LIKE '建仓%')
        ORDER BY id`,
      [userId, bookId, it.account_id, dir, it.amount, it.date]
    );
    // 仅唯一命中时回填；多条歧义不猜（避免误关联），后续仍可手动或 heal 脚本处理
    if (cands.length === 1) {
      await conn.query(
        'UPDATE transactions SET investment_txn_id = ? WHERE id = ? AND investment_txn_id IS NULL',
        [it.id, cands[0].id]
      );
    }
  }
}

module.exports = router;
// 附加纯函数，便于单测（不影响 router.use 挂载）
module.exports.buildWorkbook = buildWorkbook;
module.exports.parseWorkbook = parseWorkbook;
module.exports.BACKUP_MARK = BACKUP_MARK;
