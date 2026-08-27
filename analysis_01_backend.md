# 后端深度走读（analysis_01_backend.md）

> 范围：`server/` 根基础设施 + `server/routes/` 17 个路由。所有引用均来自实际 `read_file`，格式 `起始行:结束行:路径`。

---

## A. 基础设施

### A.1 `server/db.js`（PostgreSQL 核心）

连接池与 UTF-8 显式声明（L7-19）：

```7:19:server/db.js
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'xinwallet',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  options: '-c client_encoding=UTF8',   // Windows/Git Bash 中文 GBK 往返防护
});
```

占位符归一化 `toPgPlaceholders`（L64-97）：把业务 SQL 的 `?` 转成 PostgreSQL 的 `$N`，已存在的 `$N` 保留，序号从最大 `$N` 之后累加，兼容「静态 `$N` + 动态 `?` 混合」。仅处理引号外的 `?`/`$N`，避免误伤字符串。

自动补 RETURNING（L51-57）：`autoReturning` 对 INSERT 且未含 RETURNING 且非 `ON CONFLICT DO NOTHING` 的语句追加 `RETURNING id`，并在结果 rows 上挂 `insertId`（L104-109），兼容旧调用方读 `.insertId`。

事务封装 `transaction`（L126-152）：接管 `client.query` 应用占位符归一化，补齐 `queryOne`，BEGIN/COMMIT/ROLLBACK，finally 还原原生 query 避免污染连接池。

**启动自愈**（关键设计）：
- `healCategoryData`（L173-206）：修复旧版「投资分类抢占总系统分类 id 1/2/3」的种子缺陷——把投资分类改到 901/902/903，补回缺失的餐饮/交通/购物，重置自增序列。完全幂等，健康库为 no-op。
- `ensureDefaultBookId` / `healBooks`（L216-249）：为每位用户确保默认账本，把 `book_id IS NULL` 的遗留数据回填到默认账本（系统预设分类 `user_id IS NULL` 不回填，保持全局共享）。

### A.2 `server/routes/books.js`（多账本隔离）

`resolveBookContext` 中间件（L48-79）是**账本隔离的总开关**：解析优先级 ①`X-Book-Id` 头（须属于当前用户）②用户默认账本 ③自动创建默认账本。所有受保护路由经此写入 `req.bookId`。

```48:73:server/routes/books.js
async function resolveBookContext(req, res, next) {
    if (req.path && req.path.startsWith('/auth')) return next();
    try {
        const headerBookId = req.header('X-Book-Id');
        let bookId = null;
        if (headerBookId) {
            const b = await db.queryOne(
                'SELECT id FROM books WHERE id = ? AND user_id = ?',
                [parseInt(headerBookId, 10), req.userId]);
            if (b) bookId = b.id;
        }
        if (!bookId) {
            const def = await db.queryOne(
                'SELECT id FROM books WHERE user_id = ? AND is_default = TRUE', [req.userId]);
            if (def) bookId = def.id;
        }
        if (!bookId) bookId = await ensureDefaultBook(db, req.userId);
        req.bookId = bookId;
        next();
    } catch (err) { handleServerError(res, err, '解析当前账本'); }
}
```

`ensureDefaultBook`（L24-38）事务内安全版，供种子/自愈调用。列表端点（L82+）返回全部账本并标注 `is_current`。

> 其余路由（transactions/accounts/...）均依赖 `req.bookId` 做 WHERE 过滤，实现用户间 + 账本间双重隔离。

### A.3 `server/routes/ai.js`（95KB，AI 对话与预测闭环）

路由层只 `require('../modules/ai')` 桶文件，绝不直接碰子模块。关键端点：
- `POST /api/ai/chat`：自然语言记账对话，调用 `parseTransactions` 产出 prediction 草稿。
- `POST /api/ai/transactions/parse`：JSON 文本解析。
- `POST /api/ai/predictions/:id/commit`：落账，成功后异步触发 `learnFromCommit`（`evidence-engine`）。
- `POST /api/ai/predictions/:id/discard`：丢弃草稿。

### A.4 其他路由（清单 + 职责）
| 文件 | 职责 |
|------|------|
| `accounts.js` | 账户 CRUD、余额重算、利息入账 |
| `auth.js` | 登录/刷新/注册/演示登录 |
| `backup.js`(37KB) | 数据导出（xlsx，配 `test-backup-xlsx.js`） |
| `budgets.js` | 预算设定与执行率 |
| `categories.js` | 分类树（系统预设只读 + 用户自定义） |
| `debts.js`(24KB) | 债权债务与还款 |
| `investments.js`(44KB) | 理财产品/持仓/清仓/计费 |
| `reports.js`(36KB) | 报表与统计计算 |
| `savings.js` | 攒钱目标 |
| `stats.js`(27KB) | 统计聚合 |
| `tags.js` | 标签 |
| `transactions.js`(33KB) | 交易 CRUD + 筛选 |
| `transfers.js` | 转账（双账户对冲） |
| `utils.js` | 路由公共工具 |
| `_helpers.js`(16KB) | `success/fail*/ErrorCodes` 响应封装 |

### A.5 其他根文件
`auth.js`(JWT+锁定)、`crypto.js`(AES 敏感字段)、`rate-limit-user.js`(令牌桶)、`validate.js`(入参校验)、`logger.js`、`openapi.js`、`seed-data.js`、`routes.js`(注册)、`index.js`(HTTP 入口)、`schema.sql`(全量 DDL，表结构含 user_id+book_id 双隔离 + updated_at 触发器)。
