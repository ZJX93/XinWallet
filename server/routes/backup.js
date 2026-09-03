/* ============================================
   鑫钱包 · 账本备份（xlsx 多工作表：配置页/账户页/预算表/理财表/债务表/储蓄表/账单流水页）
   导出：各模块独立成表，深色表头 + 斑马纹 + 全格边框的专业制表样式
   导入：解析上述工作表，事务内完整恢复（账户/分类/标签/预算/债务/储蓄目标/交易/转账）
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
const BACKUP_VERSION = 3;

// 工作表名称（导出/导入均依赖，改名需同步）
// v3 结构：账本配置页（账本/分类/标签/AI配置）｜账户页（账户）｜预算表（预算）
//         ｜理财表（理财持仓+理财流水）｜债务表（债务+债务还款）｜储蓄表（储蓄目标+储蓄流水）｜账单流水页（交易）
const SHEET_CONFIG = '账本配置页';
const SHEET_ACCOUNTS = '账户页';
const SHEET_BUDGET = '预算表';
const SHEET_INV = '理财表';
const SHEET_DEBT = '债务表';
const SHEET_SAVINGS = '储蓄表';
const SHEET_TX = '账单流水页';
const SHEET_INV_TX = '理财流水页'; // v2 遗留可选表：旧备份无「理财表」时据此解析理财流水

// v3 各工作表内的「区段标题」（解析时据此切换区块）
const CONFIG_SECTIONS = ['账本', '分类', '标签', 'AI配置'];
const ACCOUNT_SECTIONS = ['账户'];
const BUDGET_SECTIONS = ['预算'];
const INV_SECTIONS = ['理财持仓', '理财流水'];
const DEBT_SECTIONS = ['债务', '债务还款'];
const SAVINGS_SECTIONS = ['储蓄目标', '储蓄流水'];
const TX_SECTION = '交易';

// v2 兼容：旧备份区段布局（账本配置页含预算/债务/储蓄目标、账户页含理财持仓）
const CONFIG_SECTIONS_V2 = ['账本', '分类', '标签', '预算', '债务', '储蓄目标'];
const ACCOUNT_SECTIONS_V2 = ['账户', '理财持仓'];

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
// 表格样式常量（品牌靛蓝，专业制表：深色表头 + 斑马纹 + 全格边框）
const BRAND_ARGB = 'FF3742C6';
const SUBTITLE_ARGB = 'FF5B63E8';
const ZEBRA_ARGB = 'FFF2F4FB';
const THIN = { style: 'thin', color: { argb: 'FFD0D5E0' } };
const CELL_BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const TITLE_COLOR = { argb: BRAND_ARGB };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
const SUBTITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTITLE_ARGB } };
const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_ARGB } };

// 给表头行套样式（白字 + 深靛蓝底 + 边框 + 居中）
function styleHeaderRow(row) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.fill = HEADER_FILL;
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.eachCell(c => { c.border = CELL_BORDER; });
}

// 添加「区段」：空行 + 标题行（合并+浅靛蓝底白字） + 表头行（深底白字） + 数据行（斑马纹+全格边框）
function addSection(ws, title, headers, rows) {
    ws.addRow([]);
    const titleRow = ws.addRow([title]);
    titleRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    titleRow.fill = SUBTITLE_FILL;
    titleRow.alignment = { vertical: 'middle', indent: 1 };
    if (headers.length > 1) ws.mergeCells(titleRow.number, 1, titleRow.number, headers.length);
    const headerRow = ws.addRow(headers);
    styleHeaderRow(headerRow);
    (rows || []).forEach((r, idx) => {
        const dr = ws.addRow(r);
        dr.alignment = { vertical: 'middle', wrapText: false };
        const fill = (idx % 2 === 1) ? ZEBRA_FILL : null;
        // 按表头列数给每一列都加边框，确保空单元格也有「格子」，避免出现白表
        for (let c = 1; c <= headers.length; c++) {
            const cell = dr.getCell(c);
            cell.border = CELL_BORDER;
            if (fill) cell.fill = fill;
        }
    });
}

// 统一收尾：列宽自适应（限幅）、首行大标题（深底白字+合并）、冻结首行
function finalizeSheet(ws) {
    let maxCols = 0;
    ws.eachRow(row => { maxCols = Math.max(maxCols, row.cellCount); });
    for (let i = 1; i <= maxCols; i++) {
        const col = ws.getColumn(i);
        if (!col.width) col.width = 16;
    }
    const first = ws.getRow(1);
    first.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
    first.alignment = { vertical: 'middle', indent: 1 };
    if (maxCols > 1) ws.mergeCells(1, 1, 1, maxCols);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
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
        fmtDateTime(t.date) || fmtDate(t.date), t.type_label, t.amount, t.account, t.category || '', t.note || '', t.counterparty || '',
        t.link_type || '', t.link_obj || '', t.tags || ''
    ]);
    // 理财交易流水：原始买卖/红利记录，导入时据此复现（而非合成单笔建仓）。
    const invTxRows = (data.investmentTxns || []).map(t => [
        t.investment_name || '', t.account_name || '', t.type, fmtDate(t.date) || fmtDate(t.date),
        t.amount, t.price, t.quantity, t.fee, t.note || ''
    ]);
    // 债务还款流水（含跨账户还款）：导出原始还款记录，导入时重建 debt_repayments + 台账腿。
    const debtRepayRows = (data.debtRepayments || []).map(r => [
        r.debt_name || '', r.account_name || '', r.amount,
        r.principal_part || '', r.interest_part || '',
        fmtDateTime(r.paid_at) || fmtDate(r.paid_at), r.note || ''
    ]);
    // 储蓄流水（v3 新增独立表内容）：导出原始存取记录，导入时重建 savings_transactions。
    const savingsTxRows = (data.savingsTxns || []).map(t => [
        t.goal_name || '', t.account_name || '', t.type, t.amount,
        fmtDateTime(t.date) || fmtDate(t.date), t.note || ''
    ]);
    // AI 配置（v3 新增「账本配置页」区段）：仅导出非敏感字段，api_key / OCR 密钥不落盘。
    const ai = data.aiConfig || {};
    const aiProviders = ai.providers || [];
    const aiProviderRows = aiProviders.map(p => ['服务商', p.name || '', p.base_url || '', p.model || '', p.is_active ? '是' : '否', `type=${p.api_type || 'openai'}`]);
    const aiOcr = ai.ocr || {};
    const aiOcrRow = [['OCR', aiOcr.provider || 'tencent', aiOcr.region || 'ap-guangzhou', '', aiOcr.configured ? '已配置' : '未配置', '密钥需在原设备重新填写']];
    const aiSettings = ai.settings || {};
    const aiSettingRows = Object.keys(aiSettings).map(k => ['识别设置', k, '', '', '', aiSettings[k] === true ? '是' : (aiSettings[k] === false ? '否' : String(aiSettings[k] != null ? aiSettings[k] : ''))]);
    const aiConfigRows = [...aiProviderRows, ...aiOcrRow, ...aiSettingRows];

    // ---- Sheet 1: 账本配置页（账本/分类/标签/AI配置）----
    // 首行保留 BACKUP_MARK 作为文件识别标记（解析时校验），与 v2 兼容
    const cfg = wb.addWorksheet(SHEET_CONFIG);
    cfg.addRow([BACKUP_MARK]);
    cfg.addRow(['版本', BACKUP_VERSION]);
    cfg.addRow(['导出时间', new Date().toISOString()]);
    cfg.addRow(['账本', book.name || '默认账本']);
    addSection(cfg, '账本', ['名称', '图标', '颜色', '默认'],
        [[book.name || '默认账本', book.icon || '📒', book.color || '#6366f1', book.is_default ? '是' : '否']]);
    addSection(cfg, '分类', ['编码', '名称', '类型', '图标', '颜色', '系统预设', '父分类'], catRows);
    addSection(cfg, '标签', ['名称', '颜色', '图标'], tagRows);
    addSection(cfg, 'AI配置', ['类别', '名称', 'Base URL', '模型', '启用', '参数/值'], aiConfigRows);

    // ---- Sheet 2: 账户页（仅账户）----
    const acc = wb.addWorksheet(SHEET_ACCOUNTS);
    acc.addRow([SHEET_ACCOUNTS]);
    addSection(acc, '账户', ['编码', '名称', '类型', '图标', '余额', '期初余额', '信用额度', '默认', '状态'], accountRows);

    // ---- Sheet 3: 理财表（理财持仓 + 理财流水，合并）----
    const inv = wb.addWorksheet(SHEET_INV);
    inv.addRow([SHEET_INV]);
    addSection(inv, '理财持仓', ['名称', '代码', '类型', '关联账户', '买入价', '现价', '数量', '成本价', '现值', '手续费', '买入日期', '预期收益率', '状态', '备注'], investRows);
    addSection(inv, '理财流水', ['持仓名称', '关联账户', '类型', '日期', '金额', '价格', '数量', '手续费', '备注'], invTxRows);

    // ---- Sheet 4: 债务表（债务 + 债务还款，独立）----
    const debt = wb.addWorksheet(SHEET_DEBT);
    debt.addRow([SHEET_DEBT]);
    addSection(debt, '债务', ['名称', '类型', '方向', '债权人', '本金', '剩余', '利率', '期数', '还款方式', '月供', '开始日期', '到期日', '账单日', '还款日', '最低还款', '状态', '备注', '关联账户'], debtRows);
    addSection(debt, '债务还款', ['债务名称', '账户', '金额', '本金部分', '利息部分', '日期', '备注'], debtRepayRows);

    // ---- Sheet 5: 储蓄表（储蓄目标 + 储蓄流水，独立）----
    const sav = wb.addWorksheet(SHEET_SAVINGS);
    sav.addRow([SHEET_SAVINGS]);
    addSection(sav, '储蓄目标', ['名称', '目标金额', '当前金额', '关联账户', '图标', '备注', '状态'], goalRows);
    addSection(sav, '储蓄流水', ['储蓄目标名称', '关联账户', '类型', '金额', '日期', '备注'], savingsTxRows);

    // ---- Sheet 6: 账单流水页（交易 + 转账）----
    const tx = wb.addWorksheet(SHEET_TX);
    tx.addRow([SHEET_TX]);
    addSection(tx, TX_SECTION, ['时间', '类型', '金额', '账户', '分类', '备注', '对方账户', '关联类型', '关联对象', '标签'], txRows);

    // ---- Sheet 7: 预算表（预算，独立）----
    const budget = wb.addWorksheet(SHEET_BUDGET);
    budget.addRow([SHEET_BUDGET]);
    addSection(budget, '预算', ['名称', '周期', '金额', '开始日期', '结束日期'], budgetRows);

    // 统一套用表格样式（列宽/边框/斑马纹/冻结首行），确保每张表都是专业制表
    [cfg, acc, budget, inv, debt, sav, tx].forEach(finalizeSheet);
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
        const version = cellNum(cfgWs.getRow(2).getCell(2).value) || BACKUP_VERSION;
        // 探测是否为 v3 新结构：理财表/债务表/储蓄表 三者皆存在即视为 v3，否则回退 v2 兼容解析。
        const isV3 = !!(wb.getWorksheet(SHEET_INV) && wb.getWorksheet(SHEET_DEBT) && wb.getWorksheet(SHEET_SAVINGS));

        const config = parseSections(cfgWs, isV3 ? CONFIG_SECTIONS : CONFIG_SECTIONS_V2);
        const accounts = parseSections(accWs, isV3 ? ACCOUNT_SECTIONS : ACCOUNT_SECTIONS_V2);
        const tx = parseSections(txWs, [TX_SECTION, '债务还款']);

        // 归一化到 import 统一字段
        let investRows = [], invTxRows = [], debts = [], debtRepayments = [], savings = [], savingsTxns = [], budgets = [], aiConfig = null;

        if (isV3) {
            const invWs = wb.getWorksheet(SHEET_INV);
            const inv = parseSections(invWs, INV_SECTIONS);
            investRows = inv['理财持仓'] || [];
            invTxRows = inv['理财流水'] || [];

            const debtWs = wb.getWorksheet(SHEET_DEBT);
            const d = parseSections(debtWs, DEBT_SECTIONS);
            debts = d['债务'] || [];
            debtRepayments = d['债务还款'] || [];

            const savWs = wb.getWorksheet(SHEET_SAVINGS);
            const s = parseSections(savWs, SAVINGS_SECTIONS);
            savings = s['储蓄目标'] || [];
            savingsTxns = s['储蓄流水'] || [];

            // 预算优先从独立「预算表」解析；兼容旧 v3（预算仍在配置页）时回退读取配置页预算区段
            const bWs = wb.getWorksheet(SHEET_BUDGET);
            if (bWs) {
                const b = parseSections(bWs, BUDGET_SECTIONS);
                budgets = b['预算'] || [];
            } else {
                const bc = parseSections(cfgWs, ['预算']);
                budgets = bc['预算'] || [];
            }

            aiConfig = parseAiConfig(config['AI配置']);
        } else {
            // v2 兼容：理财持仓在账户页、理财流水在遗留「理财流水页」；债务/储蓄目标/预算在配置页；债务还款在账单流水页
            investRows = accounts['理财持仓'] || [];
            const invTxWs = wb.getWorksheet(SHEET_INV_TX);
            const invTx = invTxWs ? parseSections(invTxWs, ['理财流水']) : {};
            invTxRows = invTx['理财流水'] || [];
            debts = config['债务'] || [];
            debtRepayments = tx['债务还款'] || [];
            savings = config['储蓄目标'] || [];
            budgets = config['预算'] || [];
            savingsTxns = [];
        }

        // 归一到 import 现有消费路径：债务/储蓄目标/预算塞回 config，理财持仓塞回 accounts
        config['债务'] = debts;
        config['储蓄目标'] = savings;
        config['预算'] = budgets;
        accounts['理财持仓'] = investRows;

        return {
            version,
            bookName: (config['账本'] && config['账本'][0] && config['账本'][0]['名称']) || '',
            config,
            accounts,
            investmentTxns: invTxRows,
            debtRepayments,
            savingsTxns,
            aiConfig,
            transactions: (tx[TX_SECTION] || [])
        };
    });
}

// 从「账本配置页」的 AI配置 区段解析出结构化 AI 配置（仅非敏感字段；密钥不导出故不解析）
function parseAiConfig(rows) {
    if (!rows || !rows.length) return null;
    const providers = [];
    let ocr = { provider: 'tencent', region: 'ap-guangzhou', configured: false };
    const settings = {};
    for (const r of rows) {
        const cat = String(r['类别'] || '').trim();
        const name = String(r['名称'] || '').trim();
        const base = String(r['Base URL'] || '').trim();
        const en = String(r['启用'] || '').trim();
        const param = String(r['参数/值'] || '').trim();
        if (cat === '服务商') {
            if (name) providers.push({ name, api_type: param.replace(/^type=/, ''), base_url: base, model: r['模型'] != null ? String(r['模型']) : '', is_active: en === '是' });
        } else if (cat === 'OCR') {
            ocr = { provider: name || 'tencent', region: base || 'ap-guangzhou', configured: en === '已配置' };
        } else if (cat === '识别设置') {
            if (name) {
                if (param === '是') settings[name] = true;
                else if (param === '否') settings[name] = false;
                else if (param !== '') settings[name] = param;
            }
        }
    }
    return { providers, ocr, settings };
}

// ==========================================
// 导出接口：GET /backup/export  → 下载 xlsx
// ==========================================
router.get('/export', async (req, res) => {
    try {
        const userId = req.userId;
        const bookId = req.bookId;

        const [book, cats, tags, budgets, debts, goals, accounts, investments, investmentTxns, incExp, transfers, debtRepayments,
                aiProviders, aiSettingsRow, aiOcrRow, savingsTxns] = await Promise.all([
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
                `SELECT CAST(t.date AS CHAR(19)) AS date, t.type, t.amount, a.name AS account, c.name AS category, t.note,
                        t.id AS tid, t.link_type,
                        d.name AS debt_name
                   FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
                   LEFT JOIN categories c ON t.category_id = c.id
                   LEFT JOIN debts d ON t.link_id = d.id AND t.link_type = 'debt_repayment'
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
            ),
            // 债务还款流水（含跨账户还款）：导出原始还款记录，导入时重建 debt_repayments + 台账腿，
            // 否则跨账户还款的 transfer_out/in 腿不落盘，备份恢复后债务还款历史完全丢失。
            db.query(
                `SELECT d.name AS debt_name, a.name AS account_name, r.amount,
                        r.principal_part, r.interest_part,
                        CAST(r.paid_at AS CHAR(19)) AS paid_at, r.note
                   FROM debt_repayments r
                   LEFT JOIN debts d ON r.debt_id = d.id
                   LEFT JOIN accounts a ON r.account_id = a.id
                  WHERE r.user_id = ? AND r.book_id = ?
                  ORDER BY r.paid_at DESC, r.id DESC`,
                [userId, bookId]
            ),
            // AI 服务商配置（仅非密钥字段，api_key 加密存储不导出）
            db.query('SELECT name, api_type, base_url, model, is_active FROM ai_providers WHERE user_id = ? ORDER BY sort_order, id', [userId]),
            // AI 识别行为设置（JSON 列，无密钥，安全导出）
            db.queryOne('SELECT settings FROM ai_settings WHERE user_id = ?', [userId]),
            // OCR 配置（仅 provider/region，secret 加密不导出）
            db.queryOne('SELECT provider, region FROM ai_ocr_config WHERE user_id = ?', [userId]),
            // 储蓄流水（v3 独立表内容）：导出原始存取记录，导入时重建 savings_transactions
            db.query(
                `SELECT st.type, st.amount, CAST(st.date AS CHAR(19)) AS date, st.note,
                        g.name AS goal_name, a.name AS account_name
                   FROM savings_transactions st
                   LEFT JOIN savings_goals g ON st.goal_id = g.id
                   LEFT JOIN accounts a ON st.account_id = a.id
                  WHERE st.user_id = ? AND (g.id IS NULL OR g.book_id = ? OR g.book_id IS NULL)
                  ORDER BY st.date ASC, st.id ASC`,
                [userId, bookId]
            )
        ]);

        // 交易标签映射：一次查出本账本全部 income/expense 交易的标签，避免逐行查询。
        const tidList = incExp.map(r => r.tid).filter(Boolean);
        const tagMap = {};
        if (tidList.length) {
            const tagRows = await db.query(
                `SELECT tt.transaction_id AS tid, tg.name
                   FROM transaction_tags tt
                   JOIN tags tg ON tt.tag_id = tg.id
                   JOIN transactions t ON t.id = tt.transaction_id
                  WHERE t.user_id = ? AND t.book_id = ? AND t.type IN ('income','expense')`,
                [userId, bookId]
            );
            tagRows.forEach(r => { (tagMap[r.tid] = tagMap[r.tid] || []).push(r.name); });
        }

        const transactions = [
            ...incExp.map(r => ({
                date: r.date, type_label: r.type === 'income' ? '收入' : '支出',
                amount: Math.round(parseFloat(r.amount) * 100) / 100,
                account: r.account || '', category: r.category || '', note: r.note || '', counterparty: '',
                link_type: r.link_type || '', link_obj: r.debt_name || '',
                tags: (tagMap[r.tid] || []).join(',')
            })),
            ...transfers.map(r => ({
                date: r.date, type_label: '转账',
                amount: Math.round(parseFloat(r.amount) * 100) / 100,
                account: r.from_account || '', category: '', note: r.note || '', counterparty: r.to_account || '',
                tags: ''
            }))
        ];

        // AI 配置归一（仅非敏感字段；api_key / OCR 密钥加密存储，不导出）
        let aiSettingsObj = {};
        if (aiSettingsRow && aiSettingsRow.settings) {
            try { aiSettingsObj = typeof aiSettingsRow.settings === 'string' ? JSON.parse(aiSettingsRow.settings) : aiSettingsRow.settings; } catch (e) { aiSettingsObj = {}; }
        }
        const aiConfig = {
            providers: (aiProviders || []).map(p => ({ name: p.name, api_type: p.api_type, base_url: p.base_url, model: p.model, is_active: !!p.is_active })),
            settings: aiSettingsObj,
            ocr: aiOcrRow ? { provider: aiOcrRow.provider || 'tencent', region: aiOcrRow.region || 'ap-guangzhou', configured: true } : { provider: 'tencent', region: 'ap-guangzhou', configured: false }
        };

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
            debtRepayments: debtRepayments || [],
            savingsTxns: savingsTxns || [],
            aiConfig,
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
        // 导入模式：replace（默认，清空后恢复干净账本）/ merge（不清空，仅补入备份里缺失的主数据与流水）
        const mergeMode = String((req.body && req.body.mode) || 'replace').trim() === 'merge';
        let parsed;
        try {
            parsed = await parseWorkbook(req.file.buffer);
        } catch (e) {
            return res.status(400).json(fail(e.message || '备份文件解析失败'));
        }
        const { config, accounts, transactions, investmentTxns, debtRepayments, savingsTxns, aiConfig } = parsed;
        const userId = req.userId;
        const bookId = req.bookId;

        const imported = { tags: 0, accounts: 0, categories: 0, budgets: 0, debts: 0, savings_goals: 0, investments: 0, transactions: 0, transfers: 0 };

        const transferCat = await db.queryOne(
            "SELECT id FROM categories WHERE name='转账' AND type='transfer' AND (user_id IS NULL OR user_id=?) LIMIT 1",
            [userId]
        );
        const transferCatId = transferCat ? transferCat.id : 22;

        await db.transaction(async (conn) => {
            // 合并模式辅助：按唯一键查找已存在记录 id（表名/列名为硬编码常量，非用户输入，安全）。
            // ⚠️ 必须定义在事务回调内，才能捕获事务连接 conn；原先定义在外部，
            // 运行时 conn 未定义 → merge 导入直接崩溃（ReferenceError: conn is not defined）。
            const findExistingId = async (table, whereCols, whereVals) => {
                const where = whereCols.map(c => `${c} = ?`).join(' AND ');
                const rows = await conn.query(`SELECT id FROM ${table} WHERE ${where}`, whereVals);
                return rows.length ? rows[0].id : null;
            };
            // 0) 替换模式：先清空当前账本全部数据，保证导入后是「干净账本」。
            //    合并模式：不清空，仅把备份里缺失的主数据/流水补进来（按名/去重跳过已存在的）。
            //    这些表之间没有外键约束，按依赖逻辑先删子表再删父表；分类含自引用，逐级删叶子后清顶层。
            if (!mergeMode) {
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
            }

            // 1) 标签（同时建立 名称→id 映射，供后续交易标签关联）
            const tagNameToId = {};
            for (const t of (config['标签'] || [])) {
                if (!t || !String(t['名称'] || '').trim()) continue;
                const e = await conn.query('SELECT id FROM tags WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, t['名称']]);
                if (e && e.length) { tagNameToId[t['名称']] = e[0].id; continue; }
                const ins = await conn.query(
                    'INSERT INTO tags (user_id, book_id, name, color, icon) VALUES (?, ?, ?, ?, ?)',
                    [userId, bookId, t['名称'], typeof t['颜色'] === 'string' ? t['颜色'] : '#6366f1', typeof t['图标'] === 'string' ? t['图标'] : '🏷️']
                );
                const got = await conn.query('SELECT id FROM tags WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, t['名称']]);
                if (got.length) tagNameToId[t['名称']] = got[0].id;
                imported.tags++;
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
                if (mergeMode) {
                    const ex = await findExistingId('investments', ['user_id', 'book_id', 'name'], [userId, bookId, i['名称']]);
                    if (ex != null) continue; // 持仓已存在则整体跳过（含其原始流水），避免重复建仓
                }
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
                if (mergeMode) {
                    const ex = await findExistingId('budgets', ['user_id', 'book_id', 'name'], [userId, bookId, b['名称']]);
                    if (ex != null) continue;
                }
                await conn.query(
                    db.insertIgnoreSql('budgets', ['user_id', 'book_id', 'name', 'period_type', 'amount', 'start_date', 'end_date']),
                    [userId, bookId, b['名称'], ['month', 'quarter', 'half', 'year'].includes(b['周期']) ? b['周期'] : 'month', cellNum(b['金额']) || 0, fmtDate(b['开始日期']), fmtDate(b['结束日期']) || fmtDate(b['开始日期'])]
                );
                imported.budgets++;
            }

            // 5) 债务
            const debtNameToId = {};
            for (const d of (config['债务'] || [])) {
                if (!d || !String(d['名称'] || '').trim()) continue;
                if (mergeMode) {
                    const ex = await findExistingId('debts', ['user_id', 'book_id', 'name'], [userId, bookId, d['名称']]);
                    if (ex != null) { debtNameToId[d['名称']] = ex; continue; }
                }
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
                const drow = await conn.query('SELECT id FROM debts WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, d['名称']]);
                if (drow.length) debtNameToId[d['名称']] = drow[0].id;
                imported.debts++;
            }

            // 6) 储蓄目标
            for (const g of (config['储蓄目标'] || [])) {
                if (!g || !String(g['名称'] || '').trim()) continue;
                if (mergeMode) {
                    const ex = await findExistingId('savings_goals', ['user_id', 'book_id', 'name'], [userId, bookId, g['名称']]);
                    if (ex != null) continue;
                }
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

            // 6.5) 储蓄流水（v3 独立表）：重建 savings_transactions，使储蓄存取历史可恢复。
            //      储蓄目标的当前金额已在上面用快照覆盖，此处补入流水明细，不做重算（保持与线上快照一致）。
            for (const st of (savingsTxns || [])) {
                const goalName = String(st['储蓄目标名称'] || '').trim();
                const acctName = String(st['关联账户'] || '').trim();
                const type = st['类型'] === 'withdraw' ? 'withdraw' : 'deposit';
                const amt = toAmount(st['金额']);
                if (amt == null || amt <= 0) continue;
                let goalId = null;
                if (goalName) {
                    const gq = await conn.query('SELECT id FROM savings_goals WHERE user_id = ? AND book_id = ? AND name = ?', [userId, bookId, goalName]);
                    goalId = gq.length ? gq[0].id : null;
                }
                const aid = acctName ? acMap[acctName] : null;
                const date = fmtDateTime(st['日期']) || fmtDate(st['日期']) || new Date().toISOString().slice(0, 19);
                // 合并模式去重：按 目标+类型+金额+同日 判定（goal_id 为 NULL 时走 IS NULL 分支）
                if (mergeMode) {
                    const params = [userId, bookId, type, amt, date];
                    const sql = goalId == null
                        ? 'SELECT id FROM savings_transactions WHERE user_id=? AND book_id=? AND goal_id IS NULL AND type=? AND amount=? AND DATE(date)=DATE(?)'
                        : 'SELECT id FROM savings_transactions WHERE user_id=? AND book_id=? AND goal_id=? AND type=? AND amount=? AND DATE(date)=DATE(?)';
                    if (goalId != null) params.splice(2, 0, goalId);
                    const exRows = await conn.query(sql, params);
                    if (exRows.length) continue;
                }
                await conn.query(
                    'INSERT INTO savings_transactions (user_id, book_id, goal_id, account_id, type, amount, date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, bookId, goalId, aid, type, amt, date, String(st['备注'] || '')]
                );
                imported.savings_transactions = (imported.savings_transactions || 0) + 1;
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
                    // 合并模式：同付款/收款账户+金额+日期已存在则跳过
                    if (mergeMode) {
                        const dateT = fmtDateTime(t['时间']) || fmtDate(t['时间']) || new Date().toISOString().slice(0, 19);
                        const ex = await findExistingId('transfers', ['user_id', 'book_id', 'from_account_id', 'to_account_id', 'amount', 'date'], [userId, bookId, fa, ta, amount, dateT]);
                        if (ex != null) continue;
                    }
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
                    // 合并模式：同账户+日期+金额+备注+类型已存在则跳过，避免重复追加
                    if (mergeMode) {
                        const ex = await findExistingId('transactions', ['user_id', 'book_id', 'account_id', 'type', 'amount', 'date', 'note'], [userId, bookId, aid, typeLabel === '收入' ? 'income' : 'expense', amount, fmtDateTime(t['时间']) || fmtDate(t['时间']) || new Date().toISOString().slice(0, 19), String(t['备注'] || '')]);
                        if (ex != null) continue;
                    }
                    const catId = await resolveCategoryId(t['分类']);
                    const typeVal = typeLabel === '收入' ? 'income' : 'expense';
                    const date = fmtDateTime(t['时间']) || fmtDate(t['时间']) || new Date().toISOString().slice(0, 19);
                    // 关联流水保真：账户计息 / 债务还款的 link_type 与 link_id 一并恢复，
                    // 否则导入后退化成普通交易，破坏「利息/债务去各自页面」的约束一致性。
                    const linkType = String(t['关联类型'] || '').trim();
                    let linkId = null;
                    if (linkType === 'account_interest') {
                        linkId = aid; // 计息流水归属自身账户
                    } else if (linkType === 'debt_repayment') {
                        const dn = String(t['关联对象'] || '').trim();
                        linkId = debtNameToId[dn] != null ? debtNameToId[dn] : null;
                    }
                    const insTx = await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, link_type, link_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [userId, bookId, aid, catId, typeVal, amount, String(t['备注'] || ''), date, linkType || null, linkId]
                    );
                    const newTxId = insTx.insertId;
                    // 交易标签关联：按标签名解析 id 写入 transaction_tags
                    const tagStr = String(t['标签'] || '').trim();
                    if (newTxId && tagStr) {
                        for (const tn of tagStr.split(',').map(s => s.trim()).filter(Boolean)) {
                            const tgid = tagNameToId[tn];
                            if (tgid != null) {
                                await conn.query(db.insertIgnoreSql('transaction_tags', ['transaction_id', 'tag_id']), [newTxId, tgid]);
                            }
                        }
                    }
                    imported.transactions++;
                }
            }

            // 7.x) 债务还款流水恢复：重建 debt_repayments 记录 + 台账腿（含跨账户还款的两条腿），
            //      使导入后债务还款历史完整、约束可达（交易页按 debt_repayment 拦截去债务页）。
            for (const r of (debtRepayments || [])) {
                const dn = String(r['债务名称'] || '').trim();
                const an = String(r['账户'] || '').trim();
                const debtId = debtNameToId[dn] != null ? debtNameToId[dn] : null;
                const accId = acMap[an];
                const amt = toAmount(r['金额']);
                if (!debtId || !accId || amt == null || amt <= 0) continue;
                const paidAt = fmtDateTime(r['日期']) || fmtDate(r['日期']) || new Date().toISOString().slice(0, 19);
                // 合并模式：同债务+金额+还款日已存在则跳过
                if (mergeMode && debtId != null) {
                    const ex = await findExistingId('debt_repayments', ['user_id', 'book_id', 'debt_id', 'amount', 'paid_at'], [userId, bookId, debtId, amt, paidAt]);
                    if (ex != null) continue;
                }
                const pp = cellNum(r['本金部分']) || amt;
                const ip = cellNum(r['利息部分']) || 0;
                const repIns = await conn.query(
                    'INSERT INTO debt_repayments (user_id, book_id, debt_id, account_id, amount, principal_part, interest_part, paid_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, bookId, debtId, accId, amt, pp, ip, paidAt, String(r['备注'] || '')]
                );
                const repId = repIns.insertId;
                // 重建台账腿（复刻债务还款创建逻辑，简化版）
                const drow = await conn.query('SELECT account_id, direction FROM debts WHERE id = ? AND user_id = ? AND book_id = ?', [debtId, userId, bookId]);
                const debtAccId = drow.length ? drow[0].account_id : null;
                const isReceivable = drow.length && drow[0].direction === 'receivable';
                const crossAccount = debtAccId != null && debtAccId !== accId;
                const txNote = String(r['备注'] || '');
                if (crossAccount && debtAccId != null) {
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id, link_type, link_id)
                         VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, NULL, 'debt_repayment', ?)`,
                        [userId, bookId, accId, transferCatId, amt, txNote, paidAt, accId, repId]
                    );
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id, link_type, link_id)
                         VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, NULL, ?, 'debt_repayment', ?)`,
                        [userId, bookId, debtAccId, transferCatId, amt, txNote, paidAt, debtAccId, repId]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id, link_type, link_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'debt_repayment', ?)`,
                        [userId, bookId, accId, transferCatId, isReceivable ? 'income' : 'expense', amt, txNote, paidAt, accId, accId, repId]
                    );
                }
                imported.transactions++;
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

            // 7.8) AI 配置恢复（仅非敏感字段；api_key / OCR 密钥加密存储，不导出也不覆盖，需用户在原设备重填）
            if (aiConfig) {
                // 识别行为设置：直接覆盖（JSON 列，无密钥，安全）
                if (aiConfig.settings && Object.keys(aiConfig.settings).length) {
                    const sJson = typeof aiConfig.settings === 'string' ? aiConfig.settings : JSON.stringify(aiConfig.settings);
                    await conn.query(db.upsertSql('ai_settings', ['user_id'], ['settings']), [userId, sJson]);
                }
                // 服务商：目标无同名则插入（密钥留空，导入后需重填）
                for (const p of (aiConfig.providers || [])) {
                    if (!p || !String(p.name || '').trim()) continue;
                    const ex = await conn.query('SELECT id FROM ai_providers WHERE user_id = ? AND name = ?', [userId, p.name]);
                    if (ex.length) continue;
                    await conn.query(
                        'INSERT INTO ai_providers (user_id, name, api_type, base_url, api_key, model, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [userId, p.name, p.api_type || 'openai', p.base_url || '', null, p.model || '', p.is_active ? true : false, 0]
                    );
                    imported.ai_providers = (imported.ai_providers || 0) + 1;
                }
                // OCR：目标无配置则插入 provider/region（密钥留空）
                if (aiConfig.ocr) {
                    const ex = await conn.query('SELECT id FROM ai_ocr_config WHERE user_id = ?', [userId]);
                    if (!ex.length) {
                        await conn.query(db.insertIgnoreSql('ai_ocr_config', ['user_id', 'provider', 'secret_id', 'secret_key', 'region']), [userId, aiConfig.ocr.provider || 'tencent', '', '', aiConfig.ocr.region || 'ap-guangzhou']);
                        imported.ai_ocr = (imported.ai_ocr || 0) + 1;
                    }
                }
            }

            // 8) 以账本为准重算所有导入账户余额，避免直接写入导致漂移
            for (const name of Object.keys(acMap)) {
                const newBal = await computeAccountBalance(conn, userId, acMap[name], bookId);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ? AND book_id = ?', [newBal, acMap[name], userId, bookId]);
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
