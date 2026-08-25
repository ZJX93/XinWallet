/* ============================================
   鑫钱包 · 种子数据模块 v2
   基于新分类体系（15一级 + 54二级），覆盖全部功能模块
   ============================================ */

const db = require('./db');
const { ensureDefaultBook } = require('./routes/books');

// 复式记账账户余额计算
async function sumLedgerEffects(conn, userId, accountId) {
    const rows = await conn.query(
        `SELECT COALESCE(SUM(
            CASE
                WHEN source_account_id = ? THEN -amount
                WHEN destination_account_id = ? THEN amount
                WHEN account_id = ? AND type IN ('income','transfer_in') THEN amount
                WHEN account_id = ? AND type IN ('expense','transfer_out') THEN -amount
                ELSE 0
            END), 0) AS bal
        FROM transactions
        WHERE user_id = ? AND (source_account_id = ? OR destination_account_id = ? OR account_id = ?)`,
        [accountId, accountId, accountId, accountId, userId, accountId, accountId, accountId]
    );
    return parseFloat(rows[0] && rows[0].bal != null ? rows[0].bal : 0);
}

async function computeAccountBalance(conn, userId, accountId) {
    const acc = await conn.query('SELECT opening_balance FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId]);
    const opening = acc[0] ? parseFloat(acc[0].opening_balance || 0) : 0;
    const effects = await sumLedgerEffects(conn, userId, accountId);
    return opening + effects;
}

/**
 * 为指定用户注入完整种子数据
 */
async function seedUserData(userId, conn) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-based
    const currentMonth = `${y}-${String(m + 1).padStart(2, '0')}`;
    const lastMonth = m === 0 ? 11 : m - 1;
    const lmY = m === 0 ? y - 1 : y;
    const twoMonthsAgo = (() => {
        let mm = m - 2, yy = y;
        if (mm < 0) { mm += 12; yy -= 1; }
        return `${yy}-${String(mm + 1).padStart(2, '0')}`;
    })();

    // 多账本：先为当前用户建立默认账本，所有演示数据归属该账本
    const bookId = await ensureDefaultBook(conn, userId);

    // ===========================================
    // 1. 账户（6个，覆盖各种类型）
    // ===========================================
    const existingAccounts = await conn.query(
        'SELECT id, name FROM accounts WHERE user_id = $1 ORDER BY id', [userId]
    );

    const accountData = [
        { name: '现金',       type: 'cash',                 icon: '💵',  balance: 1200.00,  credit_limit: 0 },
        { name: '工商银行',   type: 'bank_card',            icon: '🏦',  balance: 42000.00, credit_limit: 0 },
        { name: '招商银行',   type: 'bank_card',            icon: '🏦',  balance: 28000.00, credit_limit: 0 },
        { name: '微信支付',   type: 'electronic_payment',   icon: '💚',  balance: 3200.00,  credit_limit: 0 },
        { name: '支付宝',     type: 'electronic_payment',   icon: '🔵',  balance: 5600.00,  credit_limit: 0 },
        { name: '信用卡',     type: 'credit_card',           icon: '💳',  balance: -2800.00, credit_limit: 50000 },
    ];

    const accountIds = {};
    if (existingAccounts.length >= 6) {
        for (let i = 0; i < accountData.length; i++) {
            accountIds[accountData[i].name] = existingAccounts[i].id;
        }
        for (const a of accountData) {
            const acc = await conn.query('SELECT opening_balance FROM accounts WHERE id = $1', [accountIds[a.name]]);
            if (acc[0] && parseFloat(acc[0].opening_balance || 0) === 0) {
                await conn.query(
                    'UPDATE accounts SET balance = $1, opening_balance = $2, credit_limit = $3, type = $4, icon = $5 WHERE id = $6',
                    [a.balance, a.balance, a.credit_limit, a.type, a.icon, accountIds[a.name]]
                );
            }
        }
    } else {
        for (const a of accountData) {
            const r = await conn.query(
                `INSERT INTO accounts (user_id, book_id, name, type, icon, balance, opening_balance, credit_limit, is_default, sort_order, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                [userId, bookId, a.name, a.type, a.icon, a.balance, a.balance, a.credit_limit,
                 a.name === '工商银行' ? 1 : 0, Object.keys(accountIds).length + 1]
            );
            accountIds[a.name] = Number(r.insertId);
        }
    }

    // ===========================================
    // 2. 交易记录（基于新分类体系，真实中国消费场景）
    // ===========================================
    // 收入模板：使用分类 code（E=支出 I=收入 T=转账）
    const incomeTemplates = [
        { cat: 'I0101', name: '月工资',         amount: 18000, account: '工商银行' },
        { cat: 'I0102', name: '季度奖金',       amount: 8000,  account: '工商银行' },
        { cat: 'I0103', name: '加班补贴',       amount: 1200,  account: '工商银行' },
        { cat: 'I0201', name: '基金分红',       amount: 650,   account: '招商银行' },
        { cat: 'I0202', name: '房租收入',       amount: 3500,  account: '招商银行' },
        { cat: 'I0203', name: '理财到期赎回',   amount: 20000, account: '工商银行' },
        { cat: 'I0301', name: '周末兼职',       amount: 2000,  account: '微信支付' },
        { cat: 'I0302', name: '接外包项目',     amount: 5000,  account: '工商银行' },
        { cat: 'I0400', name: '拼多多退款',     amount: 35,    account: '微信支付' },
    ];

    // 支出模板：使用分类 code（E=支出）
    const expenseTemplates = [
        // 餐饮 E01
        { cat: 'E0101', name: '午餐-黄焖鸡',       amount: 28,   account: '微信支付' },
        { cat: 'E0101', name: '早餐-包子豆浆',     amount: 12,   account: '微信支付' },
        { cat: 'E0102', name: '晚餐外卖',           amount: 42,   account: '支付宝' },
        { cat: 'E0105', name: '周末聚餐-海底捞',   amount: 320,  account: '支付宝' },
        { cat: 'E0103', name: '瑞幸咖啡',           amount: 18,   account: '微信支付' },
        { cat: 'E0106', name: '超市买菜',           amount: 156,  account: '微信支付' },
        { cat: 'E0106', name: '水果店',             amount: 45,   account: '微信支付' },
        { cat: 'E0104', name: '烟酒',               amount: 85,   account: '微信支付' },
        // 交通出行 E02
        { cat: 'E0202', name: '滴滴打车-上班',     amount: 32,   account: '支付宝' },
        { cat: 'E0201', name: '地铁月卡',           amount: 200,  account: '支付宝' },
        { cat: 'E0203', name: '加油',               amount: 380,  account: '信用卡' },
        { cat: 'E0204', name: '商场停车费',         amount: 25,   account: '微信支付' },
        { cat: 'E0205', name: '北京→上海高铁',     amount: 553,  account: '支付宝' },
        { cat: 'E0206', name: '车辆保养',           amount: 680,  account: '信用卡' },
        // 购物消费 E03
        { cat: 'E0301', name: '京东-纸巾洗衣液',   amount: 89,   account: '微信支付' },
        { cat: 'E0302', name: '淘宝-夏季T恤',      amount: 168,  account: '支付宝' },
        { cat: 'E0302', name: '优衣库-衬衫',       amount: 299,  account: '信用卡' },
        { cat: 'E0303', name: 'Apple Watch表带',   amount: 149,  account: '支付宝' },
        { cat: 'E0304', name: '宜家-台灯',         amount: 79,   account: '信用卡' },
        // 居家生活 E04
        { cat: 'E0401', name: '房租',               amount: 4500, account: '招商银行' },
        { cat: 'E0402', name: '电费',               amount: 185,  account: '支付宝' },
        { cat: 'E0402', name: '水费+燃气',          amount: 92,   account: '支付宝' },
        { cat: 'E0403', name: '水管维修',           amount: 150,  account: '微信支付' },
        { cat: 'E0404', name: '话费充值',           amount: 99,   account: '微信支付' },
        { cat: 'E0404', name: '宽带月费',           amount: 79,   account: '支付宝' },
        { cat: 'E0405', name: '社保代缴',           amount: 1480, account: '工商银行' },
        { cat: 'E0406', name: '洗洁精垃圾袋',       amount: 35,   account: '微信支付' },
        { cat: 'E0407', name: '顺丰寄文件',         amount: 23,   account: '微信支付' },
        // 休闲娱乐 E05
        { cat: 'E0501', name: '流浪地球3 电影',    amount: 80,   account: '支付宝' },
        { cat: 'E0502', name: 'Steam-黑神话DLC',   amount: 128,  account: '微信支付' },
        { cat: 'E0503', name: '乐刻健身房月卡',     amount: 199,  account: '支付宝' },
        { cat: 'E0504', name: '三亚机票+酒店',      amount: 2800, account: '信用卡' },
        { cat: 'E0505', name: '猫粮+猫砂',           amount: 220,  account: '支付宝' },
        { cat: 'E0506', name: 'B站大会员年费',       amount: 148,  account: '支付宝' },
        { cat: 'E0506', name: 'iCloud月费',          amount: 21,   account: '支付宝' },
        // 医疗健康 E06
        { cat: 'E0601', name: '感冒药',             amount: 45,   account: '微信支付' },
        { cat: 'E0602', name: '年度体检',           amount: 680,  account: '信用卡' },
        { cat: 'E0603', name: '洗牙',               amount: 298,  account: '支付宝' },
        { cat: 'E0604', name: '蛋白粉',             amount: 189,  account: '支付宝' },
        // 学习进修 E07
        { cat: 'E0701', name: '软考报名费',         amount: 180,  account: '支付宝' },
        { cat: 'E0702', name: '技术书籍3本',       amount: 156,  account: '支付宝' },
        { cat: 'E0703', name: '极客时间年会员',     amount: 365,  account: '微信支付' },
        // 人情往来 E08
        { cat: 'E0801', name: '给爸妈转生活费',     amount: 2000, account: '工商银行' },
        { cat: 'E0802', name: '同事结婚红包',       amount: 500,  account: '微信支付' },
        { cat: 'E0803', name: '水滴筹捐款',         amount: 50,   account: '微信支付' },
        { cat: 'E0804', name: '请朋友吃饭',         amount: 286,  account: '支付宝' },
        // 育儿亲子 E09
        { cat: 'E0901', name: '奶粉3罐',           amount: 450,  account: '支付宝' },
        { cat: 'E0902', name: '乐高积木',           amount: 199,  account: '信用卡' },
        { cat: 'E0903', name: '英语培训班',         amount: 2800, account: '招商银行' },
        { cat: 'E0904', name: '小儿退烧药',         amount: 68,   account: '微信支付' },
    ];

    // 生成 3 个月数据（当月 + 上月 + 上上月）
    const months = [
        { year: y, month: m },
        { year: lmY, month: lastMonth },
        { year: parseInt(twoMonthsAgo.split('-')[0]), month: parseInt(twoMonthsAgo.split('-')[1]) - 1 },
    ];

    // 构建 code → category_id 映射（种子数据用 code 引用，这里转为数据库 id）
    const codeToId = {};
    const catRows = await conn.query('SELECT id, code FROM categories WHERE code IS NOT NULL');
    for (const row of catRows) {
        codeToId[row.code] = row.id;
    }

    for (const mi of months) {
        const py = mi.year, pm = mi.month;
        const lastDay = new Date(py, pm + 1, 0).getDate();

        // 收入：分散在月初/月中/月末
        let dayCounter = 5;
        for (const tx of incomeTemplates) {
            const day = Math.min(dayCounter, lastDay);
            const dateStr = `${py}-${String(pm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const variance = 0.9 + Math.random() * 0.2;
            const acctId = accountIds[tx.account] || accountIds['工商银行'];
            const catId = codeToId[tx.cat];
            if (!catId) { console.warn(`⚠️ 未知分类 code: ${tx.cat}`); continue; }
            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
                [userId, bookId, acctId, catId, 'income', Math.round(tx.amount * variance), tx.name, dateStr, acctId]
            );
            dayCounter += 3 + Math.floor(Math.random() * 4);
            if (dayCounter > lastDay) dayCounter = dayCounter % lastDay + 1;
        }

        // 支出：覆盖整月
        dayCounter = 1;
        for (const tx of expenseTemplates) {
            const day = Math.min(dayCounter, lastDay);
            const dateStr = `${py}-${String(pm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const variance = 0.8 + Math.random() * 0.4;
            const acctId = accountIds[tx.account] || accountIds['微信支付'];
            const catId = codeToId[tx.cat];
            if (!catId) { console.warn(`⚠️ 未知分类 code: ${tx.cat}`); continue; }
            await conn.query(
                `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                [userId, bookId, acctId, catId, 'expense', Math.round(tx.amount * variance), tx.name, dateStr, acctId]
            );
            dayCounter += 1 + Math.floor(Math.random() * 3);
            if (dayCounter > lastDay) dayCounter = dayCounter % lastDay + 1;
        }
    }

    // ===========================================
    // 3. 转账（跨账户资金转移）
    // ===========================================
    const transfers = [
        { from: '工商银行', to: '微信支付', amount: 2000, note: '日常零花', daysAgo: 2, cat: 93 },
        { from: '工商银行', to: '支付宝',   amount: 1500, note: '淘宝购物备用', daysAgo: 5, cat: 93 },
        { from: '工商银行', to: '现金',     amount: 1000, note: '取现备用', daysAgo: 8, cat: 95 },
        { from: '招商银行', to: '工商银行', amount: 5000, note: '资金归集', daysAgo: 12, cat: 93 },
        { from: '工商银行', to: '信用卡',   amount: 2800, note: '还信用卡', daysAgo: 15, cat: 94 },
        { from: '支付宝',   to: '微信支付', amount: 500,  note: 'AA收款转出', daysAgo: 18, cat: 93 },
    ];
    for (const t of transfers) {
        const d = new Date(y, m, Math.max(1, now.getDate() - t.daysAgo));
        const dateStr = d.toISOString().split('T')[0];
        const tr = await conn.query(
            `INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
            [userId, bookId, accountIds[t.from], accountIds[t.to], t.amount, t.note, dateStr]
        );
        const tid = Number(tr.insertId);
        await conn.query(
            `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
             VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
            [userId, bookId, accountIds[t.from], t.cat, t.amount, `转账至${t.to}`, dateStr, tid, accountIds[t.from]]
        );
        await conn.query(
            `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
             VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
            [userId, bookId, accountIds[t.to], t.cat, t.amount, `来自${t.from}`, dateStr, tid, accountIds[t.to]]
        );
    }

    // ===========================================
    // 4. 预算（基于新分类体系的月度预算）
    // ===========================================
    const budgetData = [
        { name: '餐饮',      amount: 3000 },
        { name: '交通出行',  amount: 1200 },
        { name: '购物消费',  amount: 1500 },
        { name: '居家生活',  amount: 6500 },
        { name: '休闲娱乐',  amount: 1000 },
        { name: '医疗健康',  amount: 800 },
        { name: '学习进修',  amount: 600 },
        { name: '人情往来',  amount: 1500 },
        { name: '育儿亲子',  amount: 3000 },
    ];
    for (const b of budgetData) {
        const startDate = `${currentMonth}-01`;
        const lastDay = new Date(y, m + 1, 0).getDate();
        const endDate = `${currentMonth}-${String(lastDay).padStart(2, '0')}`;
        await conn.query(
            `INSERT INTO budgets (user_id, book_id, name, period_type, start_date, end_date, amount)
             VALUES (?, ?, ?, 'month', ?, ?, ?)`,
            [userId, bookId, b.name, startDate, endDate, b.amount]
        );
    }

    // ===========================================
    // 5. 理财持仓（覆盖各种投资品类）
    // ===========================================
    // 构建 code → investment_type_id 映射
    const investTypeCodeToId = {};
    const itRows = await conn.query('SELECT id, code FROM investment_types WHERE code IS NOT NULL');
    for (const row of itRows) {
        investTypeCodeToId[row.code] = row.id;
    }

    const investmentData = [
        { typeCode: 'V0101', name: '定期存款-1年期',   code: '',           buy_price: 1,       current_price: 1.015,   quantity: 50000,  buy_date: `${y}-01-15`, expected_rate: 1.5 },
        { typeCode: 'V0201', name: '余额宝',            code: '000198',     buy_price: 1.0,     current_price: 1.0018,  quantity: 30000,  buy_date: `${y}-02-01`, expected_rate: 1.8 },
        { typeCode: 'V0202', name: '招商产业债C',       code: '001868',     buy_price: 1.12,    current_price: 1.156,   quantity: 20000,  buy_date: `${y}-03-10`, expected_rate: 3.2 },
        { typeCode: 'V0203', name: '沪深300ETF',        code: '510300',     buy_price: 3.85,    current_price: 4.12,    quantity: 8000,   buy_date: `${y}-04-15`, expected_rate: 8 },
        { typeCode: 'V0204', name: '易方达蓝筹精选',    code: '005827',     buy_price: 2.35,    current_price: 2.58,    quantity: 10000,  buy_date: `${y}-05-20`, expected_rate: 10 },
        { typeCode: 'V0301', name: '贵州茅台',           code: 'sh600519',   buy_price: 1650,    current_price: 1780,    quantity: 10,     buy_date: `${y}-06-10`, expected_rate: 8 },
        { typeCode: 'V9901', name: '招行季季宝',        code: '',           buy_price: 1,       current_price: 1.012,   quantity: 80000,  buy_date: `${y}-07-01`, expected_rate: 3.0 },
        { typeCode: 'V0601', name: '黄金ETF',           code: '518880',     buy_price: 5.15,    current_price: 5.62,    quantity: 3000,   buy_date: `${y}-08-10`, expected_rate: 6 },
        { typeCode: 'V0401', name: '腾讯控股',           code: '00700',      buy_price: 380,     current_price: 452,     quantity: 100,    buy_date: `${y}-09-05`, expected_rate: 12 },
        { typeCode: 'V0501', name: 'Apple Inc.',         code: 'AAPL',       buy_price: 195,     current_price: 218,     quantity: 30,     buy_date: `${y}-10-15`, expected_rate: 10 },
        { typeCode: 'V0701', name: '比特币',             code: 'BTCUSDT',    buy_price: 42000,   current_price: 68000,   quantity: 0.05,   buy_date: `${y}-11-01`, expected_rate: 20 },
        { typeCode: 'V0103', name: '国债逆回购',         code: '',           buy_price: 100,     current_price: 100.8,   quantity: 500,    buy_date: `${y}-12-01`, expected_rate: 2.0 },
    ];
    for (const inv of investmentData) {
        const totalCost = inv.buy_price * inv.quantity;
        const currentValue = inv.current_price * inv.quantity;
        const typeId = investTypeCodeToId[inv.typeCode];
        if (!typeId) { console.warn(`⚠️ 未知投资类型 code: ${inv.typeCode}`); continue; }
        await conn.query(
            `INSERT INTO investments (user_id, book_id, account_id, investment_type_id, name, code, buy_price, current_price, quantity,
             total_cost, current_value, buy_date, expected_rate, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'holding')`,
            [userId, bookId, accountIds['工商银行'], typeId, inv.name, inv.code || '',
             inv.buy_price, inv.current_price, inv.quantity,
             totalCost, currentValue, inv.buy_date, inv.expected_rate]
        );
    }

    // ===========================================
    // 6. 储蓄目标
    // ===========================================
    const savingsGoals = [
        { name: '买车基金',   target: 200000, current: 95000,  icon: '🚗', status: 'active' },
        { name: '旅行基金',   target: 50000,  current: 28000,  icon: '✈️', status: 'active' },
        { name: '应急储备',   target: 100000, current: 100000, icon: '🛡️', status: 'completed' },
        { name: '装修基金',   target: 150000, current: 45000,  icon: '🏠', status: 'active' },
        { name: '教育基金',   target: 80000,  current: 22000,  icon: '🎓', status: 'active' },
    ];
    for (const g of savingsGoals) {
        await conn.query(
            `INSERT INTO savings_goals (user_id, book_id, name, target_amount, current_amount, icon, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, bookId, g.name, g.target, g.current, g.icon, g.status]
        );
    }

    // ===========================================
    // 7. 债务（信用卡 + 房贷 + 车贷 + 个人借贷）
    // ===========================================
    const debts = [
        { name: '招商银行信用卡', type: 'credit_card', creditor: '招商银行', principal: 50000, remaining: 2800, interest_rate: 18.25, term_months: 0, method: 'minimum', monthly_payment: 280, billing_day: 10, payment_day: 28, min_payment: 280, status: 'active', start_date: `${y}-01-01` },
        { name: '住房按揭贷款',   type: 'loan',        creditor: '建设银行', principal: 1200000, remaining: 1050000, interest_rate: 3.95, term_months: 360, method: 'equal_installment', monthly_payment: 5692.8, status: 'active', start_date: '2021-03-01', due_date: '2051-03-01' },
        { name: '汽车分期贷款',   type: 'loan',        creditor: '工商银行', principal: 80000, remaining: 48000, interest_rate: 4.5, term_months: 36, method: 'equal_installment', monthly_payment: 2380.5, status: 'active', start_date: '2024-06-01' },
        { name: '借朋友周转',     type: 'personal',    creditor: '老张',     principal: 10000, remaining: 10000, interest_rate: 0, term_months: 3, method: 'lump_sum', monthly_payment: 0, status: 'active', start_date: `${y}-${String(m + 1).padStart(2, '0')}-01` },
    ];
    for (const d of debts) {
        await conn.query(
            `INSERT INTO debts (user_id, book_id, name, type, creditor, principal, remaining, interest_rate, term_months, method,
             monthly_payment, start_date, due_date, billing_day, payment_day, min_payment, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, bookId, d.name, d.type, d.creditor, d.principal, d.remaining, d.interest_rate,
             d.term_months || 0, d.method, d.monthly_payment || 0,
             d.start_date || null, d.due_date || null, d.billing_day || null,
             d.payment_day || null, d.min_payment || 0, d.status]
        );
    }

    // ===========================================
    // 8. 标签
    // ===========================================
    const tags = [
        { name: '必需',      color: '#ef4444', icon: '⭐' },
        { name: '可省',      color: '#10b981', icon: '💡' },
        { name: '大额',      color: '#8b5cf6', icon: '💎' },
        { name: '订阅',      color: '#3b82f6', icon: '🔁' },
        { name: '冲动消费',  color: '#f59e0b', icon: '⚡' },
        { name: '投资相关',  color: '#22c55e', icon: '📈' },
        { name: '家庭支出',  color: '#ec4899', icon: '👨‍👩‍👧' },
        { name: '可报销',    color: '#06b6d4', icon: '🧾' },
    ];
    const existingTags = await conn.query('SELECT COUNT(*) AS cnt FROM tags WHERE user_id = $1', [userId]);
    if (parseInt(existingTags[0].cnt) === 0) {
        for (const t of tags) {
            await conn.query(
                `INSERT INTO tags (user_id, book_id, name, color, icon) VALUES (?, ?, ?, ?, ?)`,
                [userId, bookId, t.name, t.color, t.icon]
            );
        }
    }

    // ===========================================
    // 9. 投资净值快照（8周历史，用于趋势图）
    // ===========================================
    const invList = await conn.query('SELECT id, total_cost, current_value FROM investments WHERE user_id = $1', [userId]);
    const today = new Date();
    for (let w = 8; w >= 0; w--) {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay() - w * 7);
        const snapDate = d.toISOString().slice(0, 10);
        for (const inv of invList) {
            const cost = parseFloat(inv.total_cost);
            const baseValue = parseFloat(inv.current_value);
            const weekProgress = w / 8;
            const randomFactor = 0.92 + weekProgress * 0.16 + (Math.random() * 0.04 - 0.02);
            const snapValue = Math.round(baseValue * randomFactor * 100) / 100;
            const snapCost = Math.round(cost * (0.95 + Math.random() * 0.1) * 100) / 100;
            await conn.query(
                `INSERT INTO investment_snapshots (user_id, book_id, investment_id, total_value, total_cost, nav_date)
                 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (investment_id, nav_date) DO NOTHING`,
                [userId, bookId, inv.id, snapValue, snapCost, snapDate]
            );
        }
    }

    // ===========================================
    // 10. 重新计算所有账户余额
    // ===========================================
    for (const aid of Object.values(accountIds)) {
        const bal = await computeAccountBalance(conn, userId, aid);
        await conn.query('UPDATE accounts SET balance = $1 WHERE id = $2 AND user_id = $3', [bal, aid, userId]);
    }
}

async function userHasData(userId) {
    const r = await db.queryOne('SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ?', [userId]);
    return parseInt(r.cnt) > 0;
}

async function ensureUserSeed(userId) {
    if (await userHasData(userId)) return false;
    await db.transaction(async (conn) => {
        await seedUserData(userId, conn);
    });
    return true;
}

module.exports = { seedUserData, ensureUserSeed, userHasData };
