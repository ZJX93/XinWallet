/* ============================================
   账户解析器单元测试
   覆盖 v0.2 新增的「OCR 关键词优先于请求体默认值」能力
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveAccount,
    scanPaymentChannels,
    findAccountByChannel,
    norm,
} = require('../server/modules/ai/extraction/account-resolver');

const ACCTS = [
    { id: 1, name: '支付宝 花呗', type: 'credit' },
    { id: 2, name: '支付宝 余额', type: 'cash' },
    { id: 3, name: '微信钱包', type: 'cash' },
    { id: 4, name: '现金', type: 'cash' },
    { id: 5, name: '招商银行(4567)', type: 'bank' },
    { id: 6, name: '中国建设银行', type: 'bank' },
];

test('scanPaymentChannels: 命中「支付宝」', () => {
    const ch = scanPaymentChannels('支付方式：支付宝 余额');
    assert.ok(ch.some(c => c.source === 'alipay'));
});

test('scanPaymentChannels: 命中「微信」', () => {
    const ch = scanPaymentChannels('微信支付收款方 商家A');
    assert.ok(ch.some(c => c.source === 'wechat'));
});

test('scanPaymentChannels: 命中「尾号」→ bank 组', () => {
    const ch = scanPaymentChannels('中国银行尾号1234 收款88元');
    assert.ok(ch.some(c => c.source === 'bank'));
});

test('scanPaymentChannels: 现金命中', () => {
    const ch = scanPaymentChannels('现金收款 88元');
    assert.ok(ch.some(c => c.source === 'cash'));
});

test('scanPaymentChannels: 无渠道 → 空', () => {
    assert.deepEqual(scanPaymentChannels('hello world'), []);
});

test('findAccountByChannel: 支付宝 → 匹配到「支付宝 余额」而非「支付宝 花呗」（按列表顺序）', () => {
    const ch = { source: 'alipay', label: '支付宝' };
    const acc = findAccountByChannel(ACCTS, ch);
    assert.equal(acc.id, 1); // ACCTS 里第一个含「支付宝」的
});

test('findAccountByChannel: 微信 → 「微信钱包」', () => {
    const acc = findAccountByChannel(ACCTS, { source: 'wechat', label: '微信' });
    assert.equal(acc.id, 3);
});

test('findAccountByChannel: 银行 → 「招商银行」', () => {
    const acc = findAccountByChannel(ACCTS, { source: 'bank', label: '银行卡' });
    assert.equal(acc.id, 5);
});

test('norm: 去空白/标点', () => {
    assert.equal(norm('支付宝·花呗'), '支付宝花呗');
    assert.equal(norm('招商银行(4567)'), '招商银行4567');
    assert.equal(norm('Cash'), 'cash');
});

/* ─────────── resolveAccount 行为 ─────────── */

test('resolveAccount: 文本含「支付宝」→ 覆盖默认花呗 ID=1', () => {
    const r = resolveAccount('永升物业 支付方式：支付宝 余额 638.4', {
        accounts: ACCTS,
        account_id: 1, // 默认是「支付宝 花呗」
    });
    // 文本里有「支付宝」关键词，且 ACCTS 里第一个含支付宝的是「支付宝 花呗」（id=1）
    // 与默认值相同 → 应仍选 1，但 source 标记为 channel:alipay
    assert.equal(r.account_id, 1);
    assert.match(r.source, /^channel:/);
});

test('resolveAccount: 文本含「微信」→ 不再被默认花呗锁定', () => {
    const r = resolveAccount('晚餐 38 微信支付', {
        accounts: ACCTS,
        account_id: 1, // 默认是花呗
    });
    assert.equal(r.account_id, 3); // 微信钱包
    assert.equal(r.source, 'channel:wechat');
    assert.equal(r.confidence, 0.9);
});

test('resolveAccount: 文本含「尾号」→ 命中银行账户（招商银行 5）', () => {
    const r = resolveAccount('中国银行尾号1234 收入 5000', {
        accounts: ACCTS,
        account_id: 1,
    });
    assert.equal(r.account_id, 5);
});

test('resolveAccount: 文本完全无关 → 走默认值', () => {
    const r = resolveAccount('买咖啡 28', {
        accounts: ACCTS,
        account_id: 4, // 现金
    });
    assert.equal(r.account_id, 4);
    assert.equal(r.source, 'fallback_default');
    assert.equal(r.confidence, 0.5);
});

test('resolveAccount: 文本无渠道且无默认 → null', () => {
    const r = resolveAccount('买咖啡 28', { accounts: ACCTS, account_id: null });
    assert.equal(r.account_id, null);
    assert.equal(r.source, 'fallback_default');
    assert.equal(r.confidence, 0.0);
});

test('resolveAccount: 文本有渠道但用户没对应账户 → 回退默认', () => {
    const noWechat = [{ id: 1, name: '支付宝' }, { id: 2, name: '现金' }];
    const r = resolveAccount('微信支付 20', { accounts: noWechat, account_id: 1 });
    assert.equal(r.account_id, 1); // 回退到默认
    assert.equal(r.source, 'channel_no_match_in_accounts');
    assert.equal(r.matched_account, null);
    assert.ok(r.matched_channel);
});

test('resolveAccount: 文本多渠道 → 优先级按 score（specific 优先于 generic）', () => {
    // 「微信支付 + 支付宝」同时出现 → 都是 specific → score 都是 0.9，
    // resolveAccount 按 channels 插入顺序遍历；alipay 字典先扫到「支付宝」→ 命中花呗
    const r = resolveAccount('微信支付 用了支付宝花呗 38', {
        accounts: ACCTS,
        account_id: 99,
    });
    assert.equal(r.account_id, 1); // 支付宝 花呗
    assert.equal(r.source, 'channel:alipay');
});

test('resolveAccount: 文本为 null → 默认', () => {
    const r = resolveAccount(null, { accounts: ACCTS, account_id: 2 });
    assert.equal(r.account_id, 2);
    assert.equal(r.source, 'fallback_default');
});

test('resolveAccount: 大小写不敏感（Alipay）', () => {
    const r = resolveAccount('Alipay 收款 100', {
        accounts: ACCTS,
        account_id: 4,
    });
    assert.equal(r.account_id, 1);
});

/* ─────────── v0.3 新增：上次使用账户兜底 ─────────── */

test('resolveAccount: 文本无渠道 + 上次使用「支付宝 花呗」→ 用 1，details 含「上次使用」', () => {
    // 模拟用户截图的「账单详情页」：OCR 文本里没有支付宝/微信等关键词，
    // 不应让 account 留空 —— 而应按客户端传的「上次使用账户名」兜底。
    const r = resolveAccount('永升物业樾溪臺 638.4元', {
        accounts: ACCTS,
        account_id: null,
        last_account_name: '支付宝 花呗',
    });
    assert.equal(r.account_id, 1);
    assert.equal(r.source, 'fallback_default');
    assert.match(r.details, /上次使用.*支付宝 花呗/);
});

test('resolveAccount: last_account_name 不在用户账户列表里 → 退到 account_id', () => {
    // 客户端传来一个已被删除的账户名（如多设备同步延迟），不应报错，应回退到默认账户。
    const r = resolveAccount('买咖啡 28', {
        accounts: ACCTS,
        account_id: 4, // 现金
        last_account_name: '已删除账户',
    });
    assert.equal(r.account_id, 4);
    assert.equal(r.source, 'fallback_default');
});

test('resolveAccount: 文本无渠道 + 无 last_account_name + 无默认 → null + details 提示', () => {
    const r = resolveAccount('买咖啡 28', {
        accounts: ACCTS,
        account_id: null,
        last_account_name: null,
    });
    assert.equal(r.account_id, null);
    assert.equal(r.source, 'fallback_default');
    assert.equal(r.confidence, 0.0);
    assert.match(r.details, /未匹配到任何账户/);
});
