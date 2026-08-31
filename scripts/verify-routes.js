#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function normalizePath(p) {
    return '/' + p.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function extractRoutes(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const routes = new Set();
    // 支持单/双/反引号字符串 + 模板字符串（${} 参数归一为 :param）
    const re = /router\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        routes.add(normalizePath(m[2].replace(/\$\{[^}]+\}/g, ':param')));
    }
    return routes;
}

function extractMountedRoutes(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const mounts = [];
    const vars = new Map();

    const requireRe = /const\s+(\w+)\s*=\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = requireRe.exec(code)) !== null) {
        vars.set(m[1], `server/routes/${m[2]}.js`);
    }

    // 解构赋值形式：const { ..., router: booksRouter, ... } = require('./routes/books')
    // （books.js 导出 { router, resolveBookContext, ensureDefaultBook }，router 经别名挂载）
    const destructureRe = /const\s*\{[^}]*\brouter\s*:\s*(\w+)[^}]*\}\s*=\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
    while ((m = destructureRe.exec(code)) !== null) {
        vars.set(m[1], `server/routes/${m[2]}.js`);
    }

    const inlineRe = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:[^,)]+,\s*)*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)\s*\)/g;
    while ((m = inlineRe.exec(code)) !== null) {
        mounts.push({ prefix: m[1], file: `server/routes/${m[2]}.js` });
    }

    const varRe = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:\w+\s*,\s*)*(\w+)\s*\)/g;
    while ((m = varRe.exec(code)) !== null) {
        const file = vars.get(m[2]);
        if (file) mounts.push({ prefix: m[1], file });
    }

    return mounts;
}

// 后端路由
const mainRouteFile = path.join(ROOT, 'server', 'routes.js');
const mainRoutes = extractRoutes(mainRouteFile);
const mountedRoutes = extractMountedRoutes(mainRouteFile);
const allBackend = new Set(mainRoutes);
for (const s of mountedRoutes) {
    const f = path.join(ROOT, s.file);
    if (!fs.existsSync(f)) continue;
    for (const r of extractRoutes(f)) {
        allBackend.add(normalizePath(s.prefix + '/' + r));
    }
}

// 前端调用：把模板字符串中的 ${...} 归一为 :param，避免误报
const jsFiles = ['public/js/app.js', 'public/js/auth.js', 'public/js/login.js'];
const frontendCalls = new Set();
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // 匹配 api('...') / api("...") / api(`...`)，里面允许 ${...} 模板插值
    const re = /api\s*\(\s*(['"`])([^'"`]+)\1/g;
    let m;
    while ((m = re.exec(code)) !== null) {
        let p = m[2];
        // 只取 path 部分（问号之前），模板插值归一为 :param
        p = p.split('?')[0].replace(/\$\{[^}]+\}/g, ':param');
        if (!p) continue;
        frontendCalls.add(normalizePath(p));
    }
}

console.info(`后端路由: ${allBackend.size} 个, 前端调用: ${frontendCalls.size} 个\n`);

// 检查缺失
const missing = [];
for (const call of frontendCalls) {
    if (allBackend.has(call)) continue;
    // 模糊匹配 :id
    let found = false;
    for (const route of allBackend) {
        const pattern = route.replace(/\/:id/g, '/:param').replace(/\/:providerId/g, '/:param');
        if (call === pattern) { found = true; break; }
    }
    if (!found) missing.push(call);
}

if (missing.length === 0) {
    console.info('✅ 所有前端 API 调用均有对应后端路由！');
} else {
    console.info(`❌ 缺失 ${missing.length} 个路由:`);
    missing.forEach(m => console.info(`   ${m}`));
    process.exit(1);
}
