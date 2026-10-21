/* ============================================
   鑫钱包 · 前端通用工具单测（审计 id 18：建前端测试网，锁死纯函数行为）
   目标：utils.js 是前端唯一可在 Node 中单测的纯函数模块（文件头部即声明），
   先把它钉死，后续对 app.js 等 god file 的收敛才有安全网。
   覆盖：escapeHtml（防存储型 XSS）、csvCell（CSV 公式注入防护）、
        tt（无 I18N 回退兜底）、debounce（搜索防抖：连续调用只触发最后一次）。
   运行：node --test test/frontend-utils.test.js（无需数据库）。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const utils = require('../public/js/utils.js');

test('escapeHtml：转义 XSS 危险字符', () => {
    assert.strictEqual(utils.escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
    assert.strictEqual(utils.escapeHtml(null), '');
    assert.strictEqual(utils.escapeHtml('safe文本'), 'safe文本');
});

test('csvCell：CSV 公式注入防护（= + - @ 开头前缀单引号）', () => {
    assert.strictEqual(utils.csvCell('=cmd'), "'=cmd");
    assert.strictEqual(utils.csvCell('+1'), "'+1");
    assert.strictEqual(utils.csvCell('-1'), "'-1");
    assert.strictEqual(utils.csvCell('@x'), "'@x");
    assert.strictEqual(utils.csvCell('normal'), 'normal');
    assert.strictEqual(utils.csvCell('a,b'), '"a,b"');
    assert.strictEqual(utils.csvCell('he"llo'), '"he""llo"');
});

test('tt：Node 无 I18N 时回退 fallback', () => {
    assert.strictEqual(utils.tt('some.unknown.key', '兜底文案'), '兜底文案');
    assert.strictEqual(utils.tt('key'), 'key');
});

test('debounce：连续调用只触发最后一次', async () => {
    let calls = 0;
    let last = null;
    const fn = utils.debounce((x) => { calls++; last = x; }, 20);
    fn(1); fn(2); fn(3);
    assert.strictEqual(calls, 0, '延迟前不应执行');
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(calls, 1, '只应执行一次');
    assert.strictEqual(last, 3, '应取最后一次参数');
});
