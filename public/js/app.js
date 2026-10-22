/* ============================================
   鑫钱包 · 全栈 App (PostgreSQL API 版)
   ============================================ */

// 统一 API 调用、格式化函数：来自 utils.js（已挂载 window.api / window.fmt）
// 这样 app.js / auth.js 共用同一份 api() 实现，避免行为分裂。

// 全局状态中枢（API 基址 + 前端内存缓存 cache）已抽到 state.js（见 public/js/state.js）

// ==========================================
// api() / fmt() / escapeHtml() 已通过 utils.js 注入到 window，无需重复定义
// ==========================================

// ==========================================
// Toast
// ==========================================
// 轻量提示 toast 已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// 金额/日期格式化与转账配对已抽到 core.js（见 public/js/core.js），
// 该脚本在 index.html 中于 utils.js 之后、本文件之前加载，全局可直接复用。

// 合并转账配对已抽到 core.js（见 public/js/core.js），全局可直接复用。

// 骨架屏：数据加载中展示的微光占位
// 骨架屏/空态渲染已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// ==========================================
// 初始化缓存
// ==========================================
// 初始化缓存（initCache）已抽到 init.js（见 public/js/init.js）

// 缓存访问器已抽到 core.js（见 public/js/core.js），全局可直接复用。

// ==========================================
// 页面标题映射
// ==========================================
// 页面标题/副标题 —— i18n 第一阶段：键名直接当 i18n key 用，由 showPage() 经 I18N.t() 解析
// zh-CN 路径下展示中文需要 zh-CN 字典；当前 zh-CN 字典直接用页面中文作 fallback（key 即字符串），
// 这样不用维护 zh-CN.js 也保证中文正常。
// PAGE_META 已抽到 nav.js（见 public/js/nav.js）

// 导航状态/点击绑定已抽到 nav.js（见 public/js/nav.js）
document.querySelectorAll('.see-all').forEach(el => el.addEventListener('click', () => switchPage(el.dataset.page)));
// 移动端底部导航（initBottomNav 等）已抽到 init.js（见 public/js/init.js）

// 当前站点根路径（兼容反向代理子路径）：XIN_API_BASE 形如 /xin/api → 根为 /xin
// 路由 URL 助手已抽到 core.js（见 public/js/core.js），全局可直接复用。

// 拉取「上次更新结果」并渲染到关于页（对应服务端 /api/update/status，
// 2026-09-07 新增：暴露辅助容器重建的真实 exit code + 运行镜像是否真的切到 :latest）
// 关于页更新状态拉取（refreshUpdateLast）已抽到 init.js（见 public/js/init.js）

// 关于页「上次更新状态」渲染已抽到 ui.js（见 public/js/ui.js），全局可直接复用。

// 仅负责 DOM 渲染（不修改历史），供 switchPage 与 popstate 复用
// showPage 已抽到 nav.js（见 public/js/nav.js）

/* ── 原 syncStickyOffsets() 已删除 ────────────────────────────────────
   它的职责是实测 top-bar / filter-bar 高度并注入 --sticky-top-1 / --sticky-top-2，
   供三层 sticky 的 top 值消费。顶部固定取消后这两个变量无人消费，
   继续 rAF 双帧测量纯属浪费。
   ⛔ 如需恢复吸顶，连同 components.css / styles.css 里的注释一起恢复，
      并重新面对「玻璃态 blur 会抹平 body blob」这个矛盾。 */

// （原 resize 监听用于重算 sticky 偏移量，吸顶取消后已无必要，一并删除。）

// switchPage / popstate 已抽到 nav.js（见 public/js/nav.js）

// AI 配置标签页（initAIConfigTabs）已抽到 init.js（见 public/js/init.js）

// 页面数据刷新分派（refreshPage）已抽到 refresh.js（见 public/js/refresh.js）

// 导航访问器（getCurrentPage / refreshCurrentPage）已抽到 nav.js（见 public/js/nav.js）

// 多账本切换：重拉缓存（账户/分类等随账本隔离）+ 刷新当前页数据
window.addEventListener('book:changed', async () => {
    try { await initCache(); } catch (e) { console.warn('book:changed initCache 失败:', e.message); }
    if (typeof window.refreshCurrentPage === 'function') window.refreshCurrentPage();
});

// ==========================================
// 交易月份筛选选项（依赖 cache.currentMonth，由 boot() 中 initCache() 之后调用）
// 交易月份筛选（initTransMonthFilter）已抽到 init.js（见 public/js/init.js）

// ==========================================
// 标签管理（参考 Firefly III tags）
// ==========================================
// 标签颜色选择器（TAG_PALETTE + initColorSwatches）已抽到 init.js（见 public/js/init.js）

// ==========================================
// 应用启动
// ==========================================
// 语言切换（initLangSwitcher）已抽到 init.js（见 public/js/init.js）

// 预置分类本地化（initPresetCategoryLocalization）已抽到 init.js（见 public/js/init.js）

// 启动编排（boot）已抽到 boot.js（见 public/js/boot.js）；由 js/managers/index.js 在 DOMContentLoaded 后调用 window.boot()
