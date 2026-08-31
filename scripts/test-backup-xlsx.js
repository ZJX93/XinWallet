/* 账本 xlsx 备份 round-trip 测试：构造样例数据 → 生成工作簿 → 解析回来 → 校验结构/识别标记/数据 */
const assert = require('assert');
const path = require('path');

async function main() {
    const { buildWorkbook, parseWorkbook, BACKUP_MARK } = require('../server/routes/backup');

    const sample = {
        book: { name: '我的账本', icon: '📒', color: '#6366f1', is_default: true },
        categories: [
            { code: 'E0100', name: '餐饮', type: 'expense', icon: '🍜', color: '#22c55e', is_system: true, parent_name: '' },
            { code: 'E0200', name: '交通出行', type: 'expense', icon: '🚗', color: '#22c55e', is_system: false, parent_name: '餐饮' }
        ],
        tags: [{ name: '必需', color: '#22c55e', icon: '⭐' }],
        budgets: [{ name: '月度餐饮', period_type: 'month', amount: 2000, start_date: '2026-08-01', end_date: '2026-08-31' }],
        debts: [{
            name: '招行信用卡', type: 'credit_card', direction: 'payable', creditor: '招商银行',
            principal: 10000, remaining: 6000, interest_rate: 0.05, term_months: 12, method: 'equal_installment',
            monthly_payment: 880, start_date: '2026-01-01', due_date: '2026-12-31', billing_day: 5, payment_day: 15,
            min_payment: 500, status: 'active', note: '日常消费', account_name: '招商银行'
        }],
        savings_goals: [{ name: '旅游基金', target_amount: 20000, current_amount: 5000, account_name: '余额宝', icon: '🎯', note: '暑假', status: 'active' }],
        accounts: [
            { code: 'A0100', name: '现金', type: 'cash', icon: '💵', balance: 1000, opening_balance: 500, credit_limit: 0, is_default: false, status: 'active' },
            { code: 'A0201', name: '招商银行', type: 'bank_card', icon: '🏦', balance: 25000, opening_balance: 20000, credit_limit: 0, is_default: true, status: 'active' }
        ],
        investments: [{
            name: '沪深300ETF', code: '510300', type_name: '基金', account_name: '招商银行',
            buy_price: 3.5, current_price: 4.0, quantity: 1000, total_cost: 3500, current_value: 4000,
            fee: 0, buy_date: '2026-03-01', expected_rate: 0.08, status: 'holding', note: ''
        }],
        transactions: [
            { date: '2026-08-10 12:30:00', type_label: '支出', amount: 38.5, account: '招商银行', category: '餐饮', note: '午餐', counterparty: '' },
            { date: '2026-08-09 09:00:00', type_label: '收入', amount: 12000, account: '招商银行', category: '工资', note: '月薪', counterparty: '' },
            { date: '2026-08-08 18:00:00', type_label: '转账', amount: 500, account: '招商银行', category: '', note: '零钱', counterparty: '现金' }
        ]
    };

    // 1) 生成
    const wb = buildWorkbook(sample);
    const buf = await wb.xlsx.writeBuffer();
    console.info('✅ 生成工作簿成功，字节数:', buf.length);

    // 2) 解析回来
    const parsed = await parseWorkbook(Buffer.from(buf));
    console.info('✅ 解析工作簿成功');

    // 3) 识别标记
    assert.strictEqual(parsed.version, 1, '版本应为 1');
    console.info('✅ 识别标记/版本正确');

    // 4) 配置页各区段
    assert.ok(parsed.config['账本'] && parsed.config['账本'][0]['名称'] === '我的账本', '账本信息缺失/错');
    assert.strictEqual(parsed.config['分类'].length, 2, '分类数量错');
    assert.strictEqual(parsed.config['标签'][0]['名称'], '必需', '标签错');
    assert.strictEqual(parsed.config['预算'][0]['金额'], '2000' || 2000, '预算金额错');
    assert.strictEqual(parsed.config['债务'][0]['名称'], '招行信用卡', '债务错');
    assert.strictEqual(parsed.config['储蓄目标'][0]['名称'], '旅游基金', '储蓄目标错');
    console.info('✅ 配置页各区段解析正确');

    // 5) 账户页各区段
    assert.strictEqual(parsed.accounts['账户'].length, 2, '账户数量错');
    assert.strictEqual(parsed.accounts['账户'][0]['名称'], '现金', '账户顺序/名称错');
    assert.strictEqual(parsed.accounts['理财持仓'][0]['名称'], '沪深300ETF', '理财持仓错');
    console.info('✅ 账户页各区段解析正确');

    // 6) 交易页
    assert.strictEqual(parsed.transactions.length, 3, '交易数量错');
    const transfer = parsed.transactions.find(t => t['类型'] === '转账');
    assert.ok(transfer, '转账行缺失');
    assert.strictEqual(transfer['对方账户'], '现金', '转账对方账户错');
    const income = parsed.transactions.find(t => t['类型'] === '收入');
    assert.strictEqual(income['金额'], '12000' || 12000, '收入金额错');
    console.info('✅ 账单流水页解析正确（含转账行）');

    // 7) 非法文件应被拒绝
    const badWb = new (require('exceljs').Workbook)();
    badWb.addWorksheet('账本配置页').addRow(['乱七八糟']);
    badWb.addWorksheet('账户页'); badWb.addWorksheet('账单流水页');
    const badBuf = await badWb.xlsx.writeBuffer();
    let rejected = false;
    try { await parseWorkbook(Buffer.from(badBuf)); } catch (e) { rejected = /不是有效的/.test(e.message); }
    assert.ok(rejected, '非法文件未被拒绝');
    console.info('✅ 非法/非备份文件被正确拒绝');

    console.info('\n🎉 全部 round-trip 断言通过');
}
main().catch(e => { console.error('❌ 测试失败:', e); process.exit(1); });
