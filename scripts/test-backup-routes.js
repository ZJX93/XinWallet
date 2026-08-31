/* ============================================
   鑫钱包 · 备份路由 端到端（无真实 DB）集成测试
   - 用内存 mock 的 db 替换 server/db（require.cache 注入）
   - 通过真实 Express + multer 跑 /backup/export 与 /backup/import
   - 校验每次 INSERT 的列名都在 schema.sql 中存在（捕获列名笔误）
   - 校验导出文件可识别、导入能恢复（含转账生成 1 transfer + 2 交易）
   ============================================ */
const path = require('path');
const express = require('express');

// ---------- 1) 解析 schema.sql，构建 表 -> 列集合 ----------
const fs = require('fs');
const schemaSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8');
const schemaMap = {};
{
    const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g;
    let m;
    while ((m = re.exec(schemaSrc))) {
        const tname = m[1];
        const body = m[2];
        const cols = new Set();
        for (const line of body.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            if (/^(PRIMARY KEY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|KEY|INDEX|\)|CREATE)/i.test(t)) continue;
            const cm = t.match(/^([a-zA-Z_][\w]*)\s+/);
            if (cm) cols.add(cm[1]);
        }
        schemaMap[tname] = cols;
    }
}
// 多账本迁移：book_id 通过 ALTER TABLE ADD COLUMN 追加（不在 CREATE TABLE 中），补齐到 schema 映射
{
    const re = /ALTER TABLE\s+(\w+)\s+ADD COLUMN[^;]*?\bbook_id\b/ig;
    let m;
    while ((m = re.exec(schemaSrc))) {
        const t = m[1];
        if (schemaMap[t]) schemaMap[t].add('book_id');
    }
}

// ---------- 2) 构造 mock db ----------
let insertLog = [];   // {table, columns, params}
let colErrors = [];
let nextId = 1000;

const EXPORT_ROWS = {
    books: [{ name: '默认账本', icon: '📒', color: '#6366f1', is_default: true }],
    categories: [
        { code: 'E0100', name: '餐饮', type: 'expense', icon: '🍜', color: '#22c55e', is_system: true, parent_name: '' },
        { code: '', name: '我的分类', type: 'expense', icon: '⭐', color: '#ff0000', is_system: false, parent_name: '' }
    ],
    tags: [{ name: '餐饮', color: '#f59e0b', icon: '🍜' }],
    budgets: [{ name: '月度预算', period_type: 'month', amount: 2000, start_date: '2024-01-01', end_date: '2024-01-31' }],
    debts: [{ name: '信用卡', type: 'credit_card', direction: 'payable', creditor: '银行', principal: 10000, remaining: 5000, interest_rate: 0.05, term_months: 12, method: 'equal_installment', monthly_payment: 900, start_date: '2024-01-01', due_date: '2024-12-31', billing_day: 5, payment_day: 15, min_payment: 500, status: 'active', note: '', account_name: '招商银行' }],
    savings_goals: [{ name: '买房', target_amount: 100000, current_amount: 20000, icon: '🎯', note: '', status: 'active', account_name: '储蓄账户' }],
    accounts: [
        { code: 'A0100', name: '现金', type: 'cash', icon: '💵', balance: 500, opening_balance: 500, credit_limit: null, is_default: true, status: 'active' },
        { code: 'A0201', name: '招商银行', type: 'bank_card', icon: '🏦', balance: 8000, opening_balance: 8000, credit_limit: null, is_default: false, status: 'active' }
    ],
    investments: [{ name: '基金A', code: 'V0203', buy_price: 1, current_price: 1.2, quantity: 100, total_cost: 100, current_value: 120, fee: 0, buy_date: '2024-01-01', expected_rate: 0.05, status: 'holding', note: '', account_name: '招商银行', type_name: '基金' }],
    transactions: [
        { date: '2024-01-15 10:00:00', type: 'expense', amount: 50, account: '现金', category: '餐饮', note: '午饭' },
        { date: '2024-01-16 12:00:00', type: 'income', amount: 8000, account: '招商银行', category: '工资薪水', note: '工资' }
    ],
    transfers: [{ date: '2024-01-17 09:00:00', amount: 1000, note: '挪钱', from_account: '现金', to_account: '招商银行' }]
};

function validateInsert(sql, params) {
    const mm = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)/);
    if (!mm) return;
    const table = mm[1];
    const columns = mm[2].split(',').map(s => s.trim()).filter(Boolean);
    const known = schemaMap[table];
    if (!known) { colErrors.push(`未知表: ${table}`); return; }
    for (const c of columns) {
        if (!known.has(c)) colErrors.push(`表 ${table} 含未知列: ${c}`);
    }
    insertLog.push({ table, columns, params });
}

function mockQuery(sql, params = []) {
    // INSERT：校验列名并记录（真实 db.query 会把 insertId 挂到 rows 数组上，这里模拟）
    if (/^\s*INSERT/i.test(sql)) {
        validateInsert(sql, params);
        const rows = [{ id: ++nextId }];
        rows.insertId = nextId;
        return Promise.resolve(rows);
    }
    // 余额重算依赖（computeAccountBalance 的专属查询：SELECT opening_balance FROM accounts ...）
    if (/SELECT\s+opening_balance\s+FROM\s+accounts/i.test(sql)) return Promise.resolve([{ opening_balance: 0 }]);
    if (/COALESCE\s*\(\s*SUM/.test(sql)) return Promise.resolve([{ bal: 0 }]);
    if (/FROM\s+investment_types/i.test(sql)) return Promise.resolve([{ id: 1 }]);
    if (/name\s*=\s*'转账'/.test(sql)) return Promise.resolve([{ id: 22 }]);
    // 全局系统分类父级查找（导入用户分类时）
    if (/user_id\s+IS\s+NULL\s+AND\s+name/i.test(sql)) return Promise.resolve([]);
    // 默认 SELECT：导出阶段返回样例数据；导入阶段（存在性校验）返回空以触发插入
    if (fakeDb.phase === 'export') {
        const tm = sql.match(/FROM\s+(\w+)/i);
        const table = tm ? tm[1] : null;
        return Promise.resolve(table && EXPORT_ROWS[table] ? EXPORT_ROWS[table] : []);
    }
    return Promise.resolve([]);
}

const fakeDb = {
    phase: 'export',
    pool: {},
    query: mockQuery,
    queryOne: (sql, params) => mockQuery(sql, params).then(r => (r && r.length ? r[0] : null)),
    transaction: (fn) => fn({ query: mockQuery, queryOne: (s, p) => mockQuery(s, p).then(r => (r && r.length ? r[0] : null)) })
};

// ---------- 3) 注入 mock db 并加载 backup 路由 ----------
const dbPath = require.resolve(path.join(__dirname, '..', 'server', 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
const backup = require(path.join(__dirname, '..', 'server', 'routes', 'backup'));

// ---------- 4) 起服务、跑导出/导入 ----------
function assert(cond, msg) { if (!cond) { logger.error('❌ ' + msg); process.exitCode = 1; } else { logger.info('✅ ' + msg); } }

(async () => {
    const app = express();
    app.use((req, res, next) => { req.userId = 1; req.bookId = 1; next(); }); // 绕过鉴权/账本上下文
    app.use('/backup', backup);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
        // --- 导出 ---
        fakeDb.phase = 'export';
        const r1 = await fetch(`${base}/backup/export`);
        assert(r1.status === 200, `导出接口返回 200（实际 ${r1.status}）`);
        const buf = Buffer.from(await r1.arrayBuffer());
        assert(buf.length > 0, '导出生成了非空 xlsx 缓冲');

        // 导出的文件可被本应用识别
        const parsed = await backup.parseWorkbook(buf);
        assert(parsed.version === backup.BACKUP_MARK ? true : parsed.version >= 1, '导出文件可被 parseWorkbook 解析');
        assert(parsed.config['分类'] && parsed.config['分类'].some(c => c['名称'] === '我的分类'), '导出配置页包含用户分类');
        assert(parsed.transactions.some(t => t['类型'] === '转账'), '导出账单流水页包含转账行');

        // --- 导入 ---
        insertLog = [];
        colErrors = [];
        fakeDb.phase = 'import';
        const form = new FormData();
        form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'xinwallet_backup_test.xlsx');
        const r2 = await fetch(`${base}/backup/import`, { method: 'POST', body: form });
        const body = await r2.json();
        assert(r2.status === 200, `导入接口返回 200（实际 ${r2.status}: ${JSON.stringify(body)}）`);
        assert(body && body.success, '导入返回 success=true');

        const imp = body.data && body.data.imported;
        logger.info('   导入统计:', JSON.stringify(imp));
        assert(imp && imp.tags > 0, '导入恢复了标签');
        assert(imp && imp.accounts > 0, '导入恢复了账户');
        assert(imp && imp.categories > 0, '导入恢复了（用户）分类');
        assert(imp && imp.investments > 0, '导入恢复了理财持仓');
        assert(imp && imp.budgets > 0, '导入恢复了预算');
        assert(imp && imp.debts > 0, '导入恢复了债务');
        assert(imp && imp.savings_goals > 0, '导入恢复了储蓄目标');
        assert(imp && imp.transactions > 0, '导入恢复了收支交易');
        assert(imp && imp.transfers > 0, '导入恢复了转账');

        // 转账应生成 1 条 transfers + 2 条 transfer_* 台账交易
        const transfersRows = insertLog.filter(x => x.table === 'transfers');
        const txRows = insertLog.filter(x => x.table === 'transactions');
        assert(transfersRows.length === 1, '转账生成恰好 1 条 transfers 记录');
        assert(txRows.filter(r => r.columns.includes('source_account_id')).length === 2, '转账生成 2 条 transfer_out/transfer_in 台账交易');

        // 所有 INSERT 列名均合法
        logger.info('   [debug] insertLog 表:', [...new Set(insertLog.map(x => x.table))].join(','));
        assert(colErrors.length === 0, '所有 INSERT 列名均存在于 schema（' + (colErrors.join('; ') || '无异常') + '）');

        if (process.exitCode) logger.info('\n❌ 路由集成测试存在失败项'); else logger.info('\n🎉 备份路由端到端（无 DB）测试全部通过');
    } catch (e) {
        logger.error('❌ 测试异常:', e && e.stack ? e.stack : e);
        process.exitCode = 1;
    } finally {
        server.close();
    }
})();
