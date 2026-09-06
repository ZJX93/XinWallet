/* i18n 键完整性测试
 *
 * 守两件事：
 *  1. zh-CN 与 en-US 的键集必须一致 —— 缺键会让对应语言回落到 key 字符串裸露在界面上。
 *  2. HTML 里 data-i18n / data-i18n-title 引用的键必须在词典里存在。
 *     重构删除 legacy UI 时最容易漏改这一侧（如 aiRec.results.title → billTitle）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALE_DIR = path.join(ROOT, 'public', 'locales');
const PAGES_DIR = path.join(ROOT, 'public', 'pages');

/** locales/*.js 是 `export default { ... }` 的 ESM，用正则抽取顶层键 */
function loadKeys(file) {
    const src = fs.readFileSync(path.join(LOCALE_DIR, file), 'utf8');
    const keys = new Set();
    // 匹配 'a.b.c': 形式的键（值可能是字符串或嵌套，这里只要键）
    for (const m of src.matchAll(/^\s{4}'([^']+)'\s*:/gm)) keys.add(m[1]);
    return keys;
}

const zh = loadKeys('zh-CN.js');
const en = loadKeys('en-US.js');

test('词典本身非空（正则没失效）', () => {
    assert.ok(zh.size > 500, `zh 键数异常: ${zh.size}`);
    assert.ok(en.size > 500, `en 键数异常: ${en.size}`);
});

test('⛔ zh-CN 与 en-US 键集必须完全一致', () => {
    const missingInEn = [...zh].filter(k => !en.has(k));
    const missingInZh = [...en].filter(k => !zh.has(k));
    assert.deepStrictEqual(missingInEn, [], `en-US 缺少: ${missingInEn.join(', ')}`);
    assert.deepStrictEqual(missingInZh, [], `zh-CN 缺少: ${missingInZh.join(', ')}`);
});

test('⛔ 页面 data-i18n 引用的键必须存在于词典', () => {
    const missing = [];
    for (const f of fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(PAGES_DIR, f), 'utf8');
        for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) {
            const key = m[1];
            if (!zh.has(key)) missing.push(`${f}: ${key}`);
        }
    }
    assert.deepStrictEqual(missing, [], `页面引用了不存在的 i18n 键:\n${missing.join('\n')}`);
});
