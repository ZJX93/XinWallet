/*
 * ui.js —— 从 app.js 抽离的纯 DOM 占位 / 空态渲染（审计 id 18：app.js god-file 分解第二刀）。
 *
 * showSkeleton / showEmpty 只依赖 utils.js 已挂载到 window 的 escapeHtml，不依赖 app.js
 * 的任何局部变量，因此独立成经典脚本，在 index.html 里于 utils.js / core.js 之后、app.js
 * 之前加载。抽离后 app.js 直接复用全局定义，god-file 体积继续下降。
 *
 * ⚠️ 改动此文件后务必跑 `node --test test/app-dom.test.js`（jsdom 安全网已锁死
 *    showSkeleton / showEmpty 的行为）—— 任一回归此处必红。
 */
// 骨架屏：加载占位（list / grid / text 三种形态），只写 innerHTML，不碰业务状态
function showSkeleton(el, rows = 3, variant = 'list') {
    if (!el) return;
    let html = '';
    if (variant === 'list') {
        for (let i = 0; i < rows; i++) {
            html += `<div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:45%"></div><div class="skeleton-line shimmer" style="width:70%"></div></div><div class="skeleton-amt shimmer"></div></div>`;
        }
    } else if (variant === 'grid') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-card shimmer"></div>`;
    } else if (variant === 'text') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-line shimmer" style="width:${60 + (i % 3) * 12}%"></div>`;
    }
    el.innerHTML = `<div class="skeleton-wrap" data-skeleton="${variant}">${html}</div>`;
}

// 空状态：纯文字提示（图标已按 UI 规范移除，保留 icon 参数仅为兼容历史调用）。
// text 经 escapeHtml 转义，避免存储型 XSS（与 utils.escapeHtml 同源防护）。
function showEmpty(el, text, icon = '') {
    if (!el) return;
    el.innerHTML = `<div class="empty-state">${icon ? `<div class="empty-icon">${icon}</div>` : ''}<div class="empty-text">${escapeHtml(text)}</div></div>`;
}
