/* ============================================
   结果校验器单元测试（v0.2 — 日期允许 YYYY-MM-DD HH:mm:ss）
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateResult } = require('../server/modules/ai/validation/result-validator');

// 每个候选交易需要附带 confidence（字段级阈值需要它）。
// 这里把 confidence 都设为 1.0，让校验聚焦在「结构性」分支：
// 仅日期格式 / 缺失检查。
const baseTxn = (over = {}) => ({
    seq: 1,
    type: 'expense',
    amount: 100,
    currency: 'CNY',
    merchant: '星巴克',
    category_id: 1,
    category_name: '餐饮',
    account_id: 1,
    note: '餐饮-星巴克',
    date: '2026-08-25',
    confidence: {
        amount: 1.0,
        type: 1.0,
        category: 1.0,
        date: 1.0,
        merchant: 1.0,
    },
    ...over,
});

test('validateResult: 标准 YYYY-MM-DD 日期通过', () => {
    const r = validateResult([baseTxn()]);
    assert.notEqual(r.verdict, 'invalid');
    assert.equal(r.verdict, 'ready');
});

test('validateResult: YYYY-MM-DD HH:mm:ss 通过（v0.2 精确到秒）', () => {
    const r = validateResult([baseTxn({ date: '2026-08-25 08:12:33' })]);
    assert.notEqual(r.verdict, 'invalid');
    assert.equal(r.verdict, 'ready');
});

test('validateResult: YYYY-MM-DD HH:mm 缺秒数 → 非法（强制 24h 秒级精度）', () => {
    // 设计选择：v0.2 既然承诺「精确到秒」，缺秒的格式直接拒，避免数据库悄悄截断
    const r = validateResult([baseTxn({ date: '2026-08-25 08:12' })]);
    assert.equal(r.verdict, 'invalid');
    assert.ok(r.reasons.some(x => x.includes('日期格式非法')));
});

test('validateResult: 非 ISO 格式（如 2026/08/25）非法', () => {
    const r = validateResult([baseTxn({ date: '2026/08/25' })]);
    assert.equal(r.verdict, 'invalid');
    assert.ok(r.reasons.some(x => x.includes('日期格式非法')));
});

test('validateResult: 缺日期非法', () => {
    const r = validateResult([baseTxn({ date: null })]);
    assert.equal(r.verdict, 'invalid');
    assert.ok(r.reasons.some(x => x.includes('日期格式非法')));
});

test('validateResult: HH:mm:ss 但日期非法 → 整体非法', () => {
    const r = validateResult([baseTxn({ date: 'foo 08:12:33' })]);
    assert.equal(r.verdict, 'invalid');
});

test('validateResult: 候选集任一笔 invalid → 整体 invalid', () => {
    const r = validateResult([
        baseTxn(),
        baseTxn({ seq: 2, date: 'foo' }),
    ]);
    assert.equal(r.verdict, 'invalid');
    assert.ok(r.reasons.some(x => x.includes('第2笔')));
});
