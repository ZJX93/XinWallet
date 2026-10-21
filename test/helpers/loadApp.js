'use strict';
/*
 * 前端 DOM 测试脚手架（审计 id 18：解锁 app.js god-file 分解）。
 *
 * 按 index.html 的脚本顺序在 jsdom 中加载 utils.js + app.js（经典脚本语义），
 * 返回 { window, errors }。app.js 顶层 function 声明会挂到 window，供测试调用。
 *
 * 为什么用「注入 <script> 元素」而不是 window.eval：
 * 经典脚本的顶层 function 声明只有在 <script> 元素的全局作用域里才会变成 window 属性，
 * 而 eval 的作用域不会把声明提升为全局，window.mergeTransferPairs 会是 undefined。
 *
 * 用 VirtualConsole 捕获 jsdomError：脚本在加载期抛错不会让 appendChild 抛异常，
 * 而是报到虚拟控制台；不捕获就无法发现「加载即崩」这种 god-file 分解最该防的回归。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UTILS_PATH = path.join(REPO_ROOT, 'public', 'js', 'utils.js');
const CORE_PATH = path.join(REPO_ROOT, 'public', 'js', 'core.js');
const APP_PATH = path.join(REPO_ROOT, 'public', 'js', 'app.js');

function loadApp(html) {
    const doc =
        html ||
        '<!doctype html><html><head></head><body><div id="toastContainer"></div></body></html>';
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(e));

    const dom = new JSDOM(doc, {
        runScripts: 'dangerously',
        url: 'http://localhost/',
        virtualConsole,
        pretendToBeVisual: true,
    });
    const { window } = dom;

    // 顺序与 index.html 一致：utils.js → core.js → app.js
    for (const file of [UTILS_PATH, CORE_PATH, APP_PATH]) {
        const code = fs.readFileSync(file, 'utf8');
        const script = window.document.createElement('script');
        script.textContent = code;
        window.document.body.appendChild(script);
    }

    return { window, errors };
}

module.exports = { loadApp };
