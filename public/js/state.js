/*
 * state.js —— 从 app.js 抽离的全局状态中枢（审计 id 18：app.js god-file 分解第七刀）。
 * 承载两处纯粹的全局状态声明：
 *   - API：API 基址，由 config.js 注入的 window.XIN_API_BASE 推导（兼容反向代理/子路径部署）
 *   - cache：前端内存缓存（accounts/categories/investmentTypes/investments/tags/currentMonth 等）
 * 二者均显式挂 window：经典脚本（utils/core/ui/nav/app）的顶级 let/const 不挂 window，
 * 而 managers（ES Module）、init.js 的 initCache、core.js 的缓存访问器都经
 * window.cache / window.API 访问。
 * 本文件只声明状态与挂载，不做任何数据初始化/请求（initCache 在 init.js）。
 */

// API 基址
const API = window.XIN_API_BASE || '/api';
window.API = API;

// 全局缓存
let cache = { accounts: [], categories: [], investmentTypes: [], investments: [], tags: [], currentMonth: '' };
window.cache = cache; // ES Module 无法访问 let 声明的顶级变量，显式挂载到 window
