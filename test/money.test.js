/* 金额精度内核（money.js）单元测试 —— 无数据库依赖 */
const test = require('node:test');
const assert = require('node:assert');
const {
    toCents, fromCents, sumAmounts, addAmounts, subtractAmounts, roundAmount, percentOf
} = require('../server/services/money');

test('toCents：元转整数分，消除浮点表示误差', () => {
    assert.strictEqual(toCents(19.99), 1999);
    assert.strictEqual(toCents(0.1), 10);
    assert.strictEqual(toCents('3.14'), 314);
    assert.strictEqual(toCents(0), 0);
});

test('toCents：空值归零、非法值抛错', () => {
    assert.strictEqual(toCents(null), 0);
    assert.strictEqual(toCents(undefined), 0);
    assert.strictEqual(toCents(''), 0);
    assert.throws(() => toCents('abc'), TypeError);
    assert.throws(() => toCents(NaN), TypeError);
});

test('toCents：超出安全范围显式抛错而非静默失真', () => {
    assert.throws(() => toCents(1e15), RangeError);
});

test('fromCents：分转元保留两位小数', () => {
    assert.strictEqual(fromCents(1999), 19.99);
    assert.strictEqual(fromCents(0), 0);
    assert.strictEqual(fromCents(null), 0);
});

test('sumAmounts：浮点列表精确求和（无 0.1+0.2 漂移）', () => {
    assert.strictEqual(sumAmounts([0.1, 0.2]), 0.3);
    assert.strictEqual(sumAmounts([1.1, 2.2, 3.3]), 6.6);
    assert.strictEqual(sumAmounts([]), 0);
});

test('sumAmounts：支持 selector 从对象取值', () => {
    const rows = [{ balance: '10.01' }, { balance: 20.02 }];
    assert.strictEqual(sumAmounts(rows, r => r.balance), 30.03);
});

test('addAmounts / subtractAmounts：精确加减', () => {
    assert.strictEqual(addAmounts(1.1, 2.2), 3.3);
    assert.strictEqual(addAmounts(0.1, 0.2, 0.3), 0.6);
    assert.strictEqual(subtractAmounts(10, 3.33), 6.67);
    assert.strictEqual(subtractAmounts(1, 0.1, 0.2), 0.7);
});

test('roundAmount：消除已有浮点误差并规范化两位小数', () => {
    assert.strictEqual(roundAmount(0.1 + 0.2), 0.3);
    assert.strictEqual(roundAmount('19.999'), 20);
});

test('percentOf：分域比值防除零与浮点误差', () => {
    assert.strictEqual(percentOf(2, 100), 2);
    assert.strictEqual(percentOf(1, 3, 2), 33.33);
    assert.strictEqual(percentOf(0, 0), 0);
    assert.strictEqual(percentOf(50, 0), 0);
});