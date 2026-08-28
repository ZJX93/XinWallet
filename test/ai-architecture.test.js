/* ============================================
   鑫钱包 · AI 分层架构守卫
   ------------------------------------------------
   守护两条被写在注释里、却长期没有自动化校验的约束：

   1) routes/ 层只能通过桶文件 server/modules/ai 访问 AI 能力，
      不得直接 require modules/ai 的子目录。
      理由：AI 内部（extraction/parser/memory/rules/...）要能自由重构，
      一旦路由直连子目录，重构就会波及路由层，分层即失效。

   2) 桶必须导出路由层实际需要的符号（当前为 getEventBusStats）。
      理由：这正是历史上约束被破坏的根因 —— 桶没导出 getStats，
      routes/ai/_shared.js 只好直连 events/event-bus，
      而注释却写着"有测试守着"。补上导出 + 本测试，约束才能真正闭环。

   纯静态扫描，不启动服务器、不连数据库，可直接并入 npm test。
   ============================================ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'server', 'routes');
const BARREL_PATH = path.join(ROOT, 'server', 'modules', 'ai', 'index.js');

/** 递归收集目录下所有 .js 文件 */
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

/**
 * 剥离注释但保留行数与列偏移（用空格替换注释字符），
 * 这样既不会把注释里"举例用的路径"误判为真实依赖，行号也不会错位。
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/^[^\S\n]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

// 匹配 require('.../modules/ai/<子路径>')：桶之后必须还有内容才算"子目录"
const DIRECT_SUBMODULE = /require\(\s*['"`]([^'"`]*modules[/\\]ai[/\\][^'"`]+)['"`]\s*\)/g;
// 桶自身的等价写法：modules/ai、modules/ai/、modules/ai/index.js
const BARREL_EQUIVALENT = /(?:^|[/\\])modules[/\\]ai[/\\]?(?:index(?:\.js)?)?$/;

test('routes 层不得直接 require modules/ai 的子目录', () => {
    const violations = [];

    for (const file of walk(ROUTES_DIR)) {
        const code = stripComments(fs.readFileSync(file, 'utf8'));
        for (const m of code.matchAll(DIRECT_SUBMODULE)) {
            const spec = m[1];
            if (BARREL_EQUIVALENT.test(spec)) continue; // 走桶，合规
            const line = code.slice(0, m.index).split('\n').length;
            violations.push(`${path.relative(ROOT, file)}:${line}  require('${spec}')`);
        }
    }

    assert.deepStrictEqual(
        violations,
        [],
        '以下路由文件绕过了 AI 桶文件。请改为从桶 (server/modules/ai) 取用，\n' +
        '若桶缺少该符号就补到桶的导出里，不要在路由层直连子目录：\n  ' + violations.join('\n  ')
    );
});

test('AI 桶文件导出路由层依赖的 getEventBusStats', () => {
    const src = stripComments(fs.readFileSync(BARREL_PATH, 'utf8'));

    assert.ok(
        /require\(\s*['"`]\.\/events\/event-bus['"`]\s*\)/.test(src),
        'modules/ai/index.js 应从 ./events/event-bus 引入 getStats'
    );

    // 只认 module.exports 块内的导出，避免把 require 解构处的同名变量误判为导出
    const exportBlock = src.slice(src.lastIndexOf('module.exports'));
    assert.ok(
        /\bgetEventBusStats\b/.test(exportBlock),
        'modules/ai/index.js 的 module.exports 必须包含 getEventBusStats，' +
        '否则 routes/ai/_shared.js 会被迫退回直连 events/event-bus'
    );
});
