/* ============================================
   账户解析器：支付宝 / 微信【子渠道】优先级回归
   ------------------------------------------------
   2026-09-07 用户截图实测缺陷：花呗付款的账单被记到了「支付宝余额」，
   而不是「支付宝花呗」（账户错 → 余额静默错账，比留空难发现）。

   根因：scanPaymentChannels 取【第一个命中】的 kw 作为 keyword，
        而旧 alipay 组的 kws 把泛词「支付宝」排在最前：
            ['支付宝', 'alipay', '集分宝', '花呗', '借呗', '信用购', '余额宝']
        票据原文里「付款方式　花呗」旁边还有「商品说明　支付宝缴款」，
        ⇒ firstHit 拿到泛词「支付宝」→ findAccountByChannel 优先级 0 用
           「支付宝」去账户名里找 → 命中【第一个】含「支付宝」的账户
           = 「支付宝余额」❌（哪怕列表里也有「支付宝花呗」）。

   修复：子渠道排在总渠道之前 —— kws 改为
            ['花呗', '借呗', '信用购', '余额宝', '集分宝', '支付宝', 'alipay']
        微信组同理（零钱通 → 零钱 → 微信）。
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAccount, scanPaymentChannels } = require('../server/modules/ai/extraction/account-resolver');

/** 典型账户列表：同时存在「支付宝余额」与「支付宝花呗」（复现 bug 的关键） */
const ACCOUNTS = [
    { id: 1, name: '支付宝余额', type: 'alipay' },
    { id: 2, name: '支付宝花呗', type: 'alipay' },
    { id: 3, name: '微信零钱', type: 'wechat' },
    { id: 4, name: '现金', type: 'cash' },
];

/** 用户截图（支付宝账单详情页）的 OCR 原文本：花呗 + 商品说明里带「支付宝缴款」 */
const ALIPAY_HUABEI_OCR = [
    '百乐易购',
    '-12.90',
    '交易成功',
    '支付时间 2026-09-06 08:38:01',
    '付款方式　花呗',
    '商品说明　支付宝缴款',
    '收单机构　微商银行股份有限公司',
    '清算机构　中国银联股份有限公司',
    '收款方全称　合肥市新站区百乐易购生活超市',
].join('\n');

test('花呗付款：匹配「支付宝花呗」，不得被泛词「支付宝」抢到「支付宝余额」', () => {
    // 先确认扫描到的 keyword 是子渠道「花呗」而不是泛词「支付宝」
    const hits = scanPaymentChannels(ALIPAY_HUABEI_OCR);
    const alipayHit = hits.find(h => h.label === '支付宝');
    assert.ok(alipayHit, '应扫到支付宝渠道');
    assert.equal(alipayHit.keyword, '花呗');

    const r = resolveAccount(ALIPAY_HUABEI_OCR, { accounts: ACCOUNTS, account_id: 1 });
    assert.equal(r.account_id, 2);
    assert.equal(r.matched_account.name, '支付宝花呗');
    assert.equal(r.source, 'channel:alipay');
});

test('花呗付款：账户列表顺序颠倒（花呗在前）同样命中花呗', () => {
    const reversed = [
        { id: 2, name: '支付宝花呗', type: 'alipay' },
        { id: 1, name: '支付宝余额', type: 'alipay' },
    ];
    const r = resolveAccount(ALIPAY_HUABEI_OCR, { accounts: reversed, account_id: 1 });
    assert.equal(r.account_id, 2);
    assert.equal(r.matched_account.name, '支付宝花呗');
});

test('余额宝付款：匹配专门的「余额宝」账户', () => {
    const ocr = ['百乐易购', '-12.90', '付款方式　余额宝'].join('\n');
    const accs = [
        { id: 1, name: '支付宝余额', type: 'alipay' },
        { id: 2, name: '余额宝', type: 'alipay' },
    ];
    const r = resolveAccount(ocr, { accounts: accs, account_id: 1 });
    assert.equal(r.account_id, 2);
    assert.equal(r.matched_account.name, '余额宝');
});

test('花呗票据但没有花呗账户：回退到含「支付宝」的账户（不报错、不返回 null）', () => {
    const accs = [
        { id: 1, name: '支付宝余额', type: 'alipay' },
        { id: 3, name: '微信零钱', type: 'wechat' },
    ];
    const ocr = ['百乐易购', '-12.90', '付款方式　花呗'].join('\n');
    const r = resolveAccount(ocr, { accounts: accs, account_id: 1 });
    assert.equal(r.account_id, 1);
    assert.equal(r.matched_account.name, '支付宝余额');
    assert.equal(r.source, 'channel:alipay');
});

test('普通支付宝票据（无子渠道词）：仍匹配「支付宝余额」不回归', () => {
    const ocr = ['百乐易购', '-12.90', '支付宝', '交易成功'].join('\n');
    const r = resolveAccount(ocr, { accounts: ACCOUNTS, account_id: 1 });
    // keyword='支付宝' → 命中第一个含「支付宝」的账户
    assert.equal(r.matched_account.name, '支付宝余额');
    assert.equal(r.source, 'channel:alipay');
});

test('微信：票据写「零钱通」时命中「微信零钱通」而不是「微信零钱」', () => {
    const ocr = ['老乡鸡', '-18.00', '微信支付', '支付方式　零钱通'].join('\n');
    const accs = [
        { id: 3, name: '微信零钱', type: 'wechat' },
        { id: 5, name: '微信零钱通', type: 'wechat' },
    ];
    const hits = scanPaymentChannels(ocr);
    const wx = hits.find(h => h.label === '微信');
    assert.equal(wx.keyword, '零钱通');          // 子渠道优先于泛词「微信」

    const r = resolveAccount(ocr, { accounts: accs, account_id: 3 });
    assert.equal(r.matched_account.name, '微信零钱通');
});

test('微信：票据只写「零钱」时命中「微信零钱」', () => {
    const ocr = ['老乡鸡', '-18.00', '支付方式　零钱'].join('\n');
    const accs = [
        { id: 3, name: '微信零钱', type: 'wechat' },
        { id: 5, name: '微信零钱通', type: 'wechat' },
    ];
    const r = resolveAccount(ocr, { accounts: accs, account_id: 3 });
    assert.equal(r.matched_account.name, '微信零钱');
});

test('自定义账户名含花呗（「我的花呗」）：仍能按花呗命中', () => {
    const ocr = ['百乐易购', '-12.90', '付款方式　花呗'].join('\n');
    const accs = [
        { id: 1, name: '支付宝余额', type: 'alipay' },
        { id: 9, name: '我的花呗', type: 'alipay' },
    ];
    const r = resolveAccount(ocr, { accounts: accs, account_id: 1 });
    assert.equal(r.account_id, 9);
    assert.equal(r.matched_account.name, '我的花呗');
});
