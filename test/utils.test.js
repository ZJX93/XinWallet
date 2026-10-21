/* 前端纯函数单元测试：HTML 转义与货币格式化（防存储型 XSS 的关键保障） */
const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml, fmt, csvCell } = require('../public/js/utils');

test('escapeHtml 转义特殊字符', () => {
    assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(escapeHtml('a & b "c" \'d\''), 'a &amp; b &quot;c&quot; &#39;d&#39;');
});

test('escapeHtml 处理 null / undefined', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
});

test('escapeHtml 阻止常见 XSS payload', () => {
    const payload = '<img src=x onerror=alert(1)>';
    assert.strictEqual(escapeHtml(payload).includes('<img'), false);
});

test('fmt 货币格式（带千分位）', () => {
    // 新版使用 Intl.NumberFormat('zh-CN') 自动加千分位分隔符
    assert.strictEqual(fmt(1234.5), '¥1,234.50');
    assert.strictEqual(fmt(1234567.89), '¥1,234,567.89');
    assert.strictEqual(fmt(0), '¥0.00');
    assert.strictEqual(fmt('abc'), '¥0.00'); // 非法值兜底
});

/* CSV 单元格转义：财务报表 CSV 导出经此函数处理，防止公式注入与字段错位 */
test('csvCell 普通值原样返回', () => {
    assert.strictEqual(csvCell('餐饮'), '餐饮');
    assert.strictEqual(csvCell('1234.50'), '1234.50');
});

test('csvCell 含逗号/引号/换行被包裹转义', () => {
    assert.strictEqual(csvCell('a,b'), '"a,b"');
    assert.strictEqual(csvCell('he said "hi"'), '"he said ""hi"""');
    assert.strictEqual(csvCell('line1\nline2'), '"line1\nline2"');
});

test('csvCell 防 CSV 公式注入（= + - @ 开头前缀单引号）', () => {
    assert.strictEqual(csvCell('=cmd'), "'=cmd");
    assert.strictEqual(csvCell('+1'), "'+1");
    assert.strictEqual(csvCell('-1'), "'-1");
    assert.strictEqual(csvCell('@x'), "'@x");
});

test('csvCell 处理 null / undefined', () => {
    assert.strictEqual(csvCell(null), '');
    assert.strictEqual(csvCell(undefined), '');
});
