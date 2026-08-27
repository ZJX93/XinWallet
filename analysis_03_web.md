# Web 前端深度走读（analysis_03_web.md）

> 范围：`public/` 原生 HTML/CSS/JS（无框架，ES Module 拆分自单体 app.js）。引用来自实际 `read_file`。

---

## 1. 整体架构

原生 JS + 玻璃拟态 CSS + PWA。状态管理由 `js/managers/` 下 22 个 manager 对象承担（单例命名空间对象，挂在全局）。数据访问统一经 manager，manager 内部 `fetch` 后端 API（无独立 `api.js`，由 `DataManager`/`data.js` 等直接封装）。

## 2. 状态层 `js/managers/`

### 2.1 `index.js`（聚合入口）
导出 `App` 聚合对象，整合所有 manager 命名空间，供各页面按需引用。

### 2.2 `data.js`（基础数据维护，拆分自 app.js 第 4089-4326 行，2026-07-22）
头部注释（L1-19）记录了拆分来源、依赖（全局 `api`/`escapeHtml`/`showToast`/`TagManager`、DOM 元素）。`DataManager` 对象（L21 起）：

```21:43:public/js/managers/data.js
const DataManager = {
    _collapsedCats: new Set(),
    init() {
        document.querySelectorAll('.dc-tab').forEach(tab => {
            tab.addEventListener('click', () => { /* Tab 切换 */ });
        });
        document.getElementById('addCatBtn').addEventListener('click', () => this.openCatModal());
        document.getElementById('catFilterType').addEventListener('change', () => this.refreshCats());
        document.getElementById('dcEditForm').addEventListener('submit', e => { e.preventDefault(); this.saveEdit(); });
        initColorSwatches('dcColorSwatches', 'dcEditColor');
        // 分类表格操作委托（事件委托）
        document.getElementById('catTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'edit-cat') this.openCatModal(parseInt(btn.dataset.id));
            ...
        });
    },
```

含分类/理财类型 CRUD、编辑弹窗（颜色/图标/风险/排序）、表格操作事件委托。`_collapsedCats` 维护折叠态。

### 2.3 业务 manager（职责）
| Manager | 行数 | 职责 |
|---------|------|------|
| `report.js` | 55KB | 报表/统计/趋势/环形图数据计算（最大） |
| `transaction.js` | 40KB | 交易增删改查、筛选 |
| `ai-recognition.js` | 43KB | AI 识别对话框逻辑 |
| `investment.js` | 42KB | 投资理财前端逻辑 |
| `dashboard.js` | 31KB | 首页汇总编排 |
| `account.js` | 31KB | 账户管理 |
| `chart.js` | 29KB | 图表渲染封装（ECharts/Canvas） |
| `debt.js` | 28KB | 债务逻辑 |
| `ai-provider.js` / `ai-smart-entry.js` | 26KB | AI 供应商配置 / 智能入口 |
| `savings.js` `budget.js` `tag.js` `transfer.js` `quick-add.js` | — | 攒钱/预算/标签/转账/快记 |
| `ai-advice.js` `ai-evaluation.js` `ai-learning.js` `ai-rules.js` `theme.js` | — | AI 建议/评测/学习/规则/主题 |

各 manager 通过 `fetch('/api/...')` 调用后端，全程携带 `X-Book-Id`（账本隔离）与 JWT（认证）。

## 3. 入口与资源
- `index.html`：单页应用壳，按功能加载 manager 与页面片段。
- `css/`：玻璃拟态/莫兰迪调色板（由 `scripts/gen-morandi-palette.js` 生成）。
- `manifest.json` + Service Worker：PWA 可安装、离线缓存。
- `pages/`：各功能页面 HTML 片段。

## 4. 数据流
```
用户操作 → manager.init 绑定的 DOM 事件
   → manager 调 fetch('/api/...', {headers:{X-Book-Id, Authorization}})
   → 后端 routes/* (经 resolveBookContext 注入 bookId)
   → manager 更新内部状态 + 重渲染对应 DOM 区块
```
