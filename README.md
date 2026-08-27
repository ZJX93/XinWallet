# 鑫钱包· 个人财务助手

<img src="public/images/logo.png" alt="鑫钱包" width="25%" />

> 本地私有部署的个人财务管理工具：记账、多账户、内部转账、预算、理财持仓追踪、统计分析、报表导出。
> 技术栈：Node.js + Express + PostgreSQL + 原生前端(毛玻璃 UI) + Chart.js。

## ✨ 功能特性

- 💰 **多账户管理**：现金 / 储蓄卡 / 微信 / 支付宝 / 信用卡，余额实时联动
- 🔄 **内部转账**：事务保证两端余额一致
- 📊 **交易记账**：收入 / 支出 / 转账，按月筛选与搜索
- 🗂️ **分类管理**：收支分类支持多级树结构，交易按类归集，可自定义图标与颜色
- 🏷️ **标签管理**：给交易打标签，支持按标签筛选与统计
- 🎯 **预算管理**：按类别设定月度预算，超支预警
- 🐷 **储蓄目标**：整合理财模块（参考 Firefly III piggy banks），可设定目标并向关联账户存入 / 取回
- 📈 **理财管理**：多品类理财产品（A 股 / 港股 / 美股 / 基金 / 黄金 / 加密 / 外汇 / 债券）、持仓追踪、收益分析、卖出 / 分红 / 加仓减仓记录；详情页可查看交易记录流水（Web / 安卓 / 鸿蒙三端一致）；清仓当天保留产品卡片、隔天自动归档
- 💳 **负债看板**：汇总未结清负债的剩余本金与月供，自动计算近期还款日与待还提醒（仪表盘展示）
- 📉 **统计分析**：收支趋势、类别占比、异常消费检测、AI 洞察
- 📟 **数据看板**：今日 / 本周 / 本月 / 本年收支与资产总览，一键查看近期交易
- 📋 **报表中心**：月 / 季 / 年报表，CSV 导出 / 导入
- 🧠 **AI 识别**：票据关键词解析、智能分类建议（纯前端关键词引擎，无需外部 API）
- 🔐 **账号鉴权**：注册 / 登录（JWT），数据按用户隔离
- 🌗 **主题切换**：亮色 / 暗色 / 跟随系统
- 🧾 **复式记账**：每笔流动记录来源/目标账户（参考 Firefly III），账本是余额唯一真相，支持一键对账修正漂移

## 🧱 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Node.js · Express 4 · PostgreSQL (pg 驱动) |
| 安全 | helmet(CSP) · cors · bcryptjs · jsonwebtoken · SSRF guard (url-guard) |
| 前端 | 原生 HTML/CSS/JS · Chart.js 4 · 前端文件统一在 `public/` |
| 文档 | Swagger UI 内嵌（同源，无 CDN 依赖） |
| 设计 | Premium 毛玻璃(glassmorphism) |

## 📁 目录结构

```
xin-wallet/
├── public/                 # 前端（由本服务同源托管）
│   ├── index.html          # SPA 入口（仪表盘 / 记账 / 报表 / 理财 等）
│   ├── login.html          # 登录 / 注册独立页面
│   ├── pages/              # 业务页（被 index.html 懒加载）
│   │   ├── dashboard.html
│   │   ├── reports.html
│   │   ├── investments.html
│   │   └── ai-recognition.html
│   ├── css/
│   │   ├── styles.css      # 主样式（毛玻璃主题 + 三态主题）
│   │   ├── auth.css        # 认证层样式
│   │   ├── login.css       # 登录页样式
│   │   ├── dashboard.css   # 仪表盘 / 业务页样式
│   │   ├── components.css  # 通用组件样式
│   │   ├── tokens.css      # 设计令牌（颜色 / 间距变量）
│   │   ├── fonts.css       # 字体引入
│   │   └── fonts/          # 本地字体（Geist 系列）
│   ├── images/
│   │   └── logo.png
│   └── js/
│       ├── app.js          # 前端主逻辑（各页面管理器 + 引导）
│       ├── auth.js         # 认证模块：token 拦截 / 登录注册 UI
│       ├── login.js        # 登录页逻辑
│       ├── config.js       # 前端配置
│       ├── bootstrap.js    # 前端引导
│       ├── page-loader.js  # 页面懒加载
│       ├── utils.js        # 通用工具（escapeHtml / fmt / csvCell）
│       ├── managers/       # 业务页管理器（account/transaction/report/dashboard/...）
│       └── vendor/         # 第三方前端库（Chart.js、xlsx 等）
├── server/
│   ├── index.js            # Express 入口 + 启动引导（建库建表 / 种子 / 演示数据）
│   ├── auth.js             # 密码哈希 + JWT 签发校验 + 鉴权中间件
│   ├── crypto.js           # AES-256-GCM 加解密
│   ├── db.js               # PostgreSQL 连接池 + ?→$N 占位符转换 + 事务封装
│   ├── validate.js         # 数值 / 类型校验（toNumber、toAmount、Express 验证中间件）
│   ├── rate-limit-user.js  # 用户级频率限制
│   ├── logger.js           # 结构化日志
│   ├── openapi.js          # OpenAPI 规范定义
│   ├── schema.sql          # 数据表 DDL + 预置种子数据
│   ├── seed-data.js        # 演示数据生成
│   ├── routes.js           # 路由注册入口
│   ├── routes/             # 按域拆分的路由模块
│   │   ├── auth.js         # 注册 / 登录 / 刷新 Token
│   │   ├── accounts.js     # 账户 CRUD + 一键对账
│   │   ├── transactions.js # 交易管理（查询构建器 + 复式记账）
│   │   ├── transfers.js    # 内部转账
│   │   ├── investments.js  # 理财类型 + 持仓管理 + 行情 API
│   │   ├── stats.js        # 仪表盘 + 综合统计
│   │   ├── reports.js      # 综合报表
│   │   ├── budgets.js      # 预算管理
│   │   ├── categories.js   # 分类管理
│   │   ├── tags.js         # 标签管理
│   │   ├── savings.js      # 储蓄目标
│   │   ├── debts.js        # 债务台账
│   │   ├── csv.js          # CSV 导入 / 导出
│   │   ├── ai.js           # AI 洞察与分析
│   │   ├── _helpers.js     # 公共响应 / 复式记账计算 / 错误码
│   │   └── utils.js        # 路由辅助（分类 / 信用卡同步）
│   ├── services/           # 可复用业务服务层
│   │   ├── market-data.js  # 行情数据（东方财富基金 / 腾讯证券 / 币安）
│   │   ├── portfolio.js    # 理财计算（年化 / 集中度 / 盈亏）
│   │   ├── quote-cache.js  # 行情 LRU 缓存
│   │   ├── debt-summary.js # 债务汇总纯逻辑
│   │   ├── money.js        # 整数分金额运算内核（toCents/fromCents/sumAmounts）
│   │   ├── url-guard.js    # SSRF 防护（外部 URL 校验）
│   │   └── ai.js           # AI 服务封装
│   ├── package.json        # server 依赖（Docker 构建用）
│   └── package-lock.json
├── scripts/                # 运维 / 排查脚本
│   ├── verify-routes.js    # 路由可达性自检
│   ├── smoke-test.js       # 冒烟测试
│   └── full-verify.js      # 全量校验脚本
├── test/                   # 单元测试（部分需数据库，见 CI）
│   ├── validate.test.js
│   ├── utils.test.js
│   ├── _helpers.test.js
│   ├── debt-summary.test.js
│   └── integration.test.js
├── .github/workflows/      # CI：pr-test.yml（测试门禁）/ auto-tag.yml（统一版本号 vX.Y.Z，X.Y 锁定为 0.0、仅递增 Z，即 v0.0.Z）/ release-image.yml（镜像构建）/ android-build.yml（APK 构建）
├── Dockerfile              # 多阶段构建（生产依赖 + 非 root 运行）
├── docker-compose.yml      # 应用 + PostgreSQL，数据卷持久化
├── docker-compose.external.yml  # 仅应用容器，复用已有 PostgreSQL
├── .dockerignore
├── .env.example            # 环境变量示例（复制为 .env 使用）
├── package.json            # 根依赖清单与启动脚本
├── package-lock.json
├── LICENSE                 # 开源许可证
└── RELEASE.md              # 版本发布与镜像构建说明
```
## 🚀 快速开始

### 前置要求

- Node.js **20+**（与 `.nvmrc`、Docker 基础镜像一致；推荐 22 LTS）
- PostgreSQL 10+ 正在运行（默认 `localhost:5432`，账号 `postgres`）

### 安装与启动

```bash
# 1. 切换到仓库推荐的 Node 版本
nvm use           # 读取 .nvmrc；若未装 nvm 可手动对齐到 20/22

# 2. 安装依赖（仓库根 / server/ 两份 manifest 现在版本一致，root 用于测试与脚本，server 用于 Docker 部署）
npm install       # 根目录
cd server && npm install && cd ..   # 服务端依赖（与 Docker 一致）

# 3. 配置环境变量
cp .env.example .env
#   按需修改 .env（数据库密码、JWT_SECRET、演示账号密码等）

# 4. 启动（会自动建库建表并插入演示数据）
npm start
#   开发模式（热重载）：npm run dev
```

启动后访问 <http://localhost:18888/index.html>

### 常用脚本

| 脚本 | 用途 |
|---|---|
| `npm start` | 生产模式启动后端 |
| `npm run dev` | 监听文件变更的本地开发模式（基于 `node --watch`） |
| `npm test` | 跑 `test/*.test.js` 单元测试（无 DB 依赖） |
| `npm run test:routes` | 校验前端 API 调用与后端路由一致（CI 可用） |
| `npm run test:integration` | 启动后端后跑 API 冒烟（需先 `npm start`） |
| `npm run test:full` | 完整接口验证（需可写数据库） |

### 默认演示账号

首次启动会自动创建演示账号（密码见 `.env` 的 `DEMO_PASSWORD`，默认 `demo123456`）：

```
用户名: demo
密码:   demo123456
```

> 也可在登录页直接「注册」新账号；新账号初始无数据，演示数据仅属于 demo 用户。

## 🔐 鉴权说明

- 注册 `POST /api/auth/register`、登录 `POST /api/auth/login` 为公开接口。
- 登录成功后返回 JWT（access token 有效期 **1 小时**，refresh token 7 天；可通过 `JWT_EXPIRES` 覆盖），前端自动存入 `localStorage` 并通过拦截 `fetch` 附加到 `Authorization` 头。
- 除 `/api/auth/*` 外，所有业务接口均需携带有效 JWT，否则返回 `401` 并触发前端登录层。
- 数据按 `user_id` 隔离，各用户仅可见自己的账户 / 交易 / 理财数据。
- 登录 / 注册接口启用频率限制（默认 15 分钟最多 5 次，可通过 `AUTH_RATE_LIMIT_MAX` 调整），防暴力破解。

## 🌐 环境变量

| 变量 | 必填 | 说明 | 默认 |
|---|---|---|---|
| `PORT` | 否 | 服务端口 | `18888` |
| `APP_PORT` | 否 | 宿主机映射端口（Docker 部署时使用） | `18888` |
| `DB_HOST` | 否 | PostgreSQL 地址 | `localhost` |
| `DB_PORT` | 否 | PostgreSQL 端口 | `5432` |
| `DB_USER` | 否 | 数据库账号 | `postgres` |
| `DB_PASSWORD` | **是**（生产） | 数据库密码 | 空 |
| `DB_NAME` | 否 | 数据库名 | `xinwallet` |
| `JWT_SECRET` | **是**（生产） | JWT 签名密钥，**生产务必改为 32+ 字节随机串** | 内置开发默认值 |
| `DEMO_PASSWORD` | 否 | 演示账号密码（首次启动创建） | `demo123456` |
| `ENCRYPTION_KEY` | 建议 | AES-256-GCM 加密密钥（用于 AI Provider Key 等），**32 字节持久化** | 启动时随机生成（重启后旧数据无法解密） |
| `CORS_ORIGIN` | 否 | 允许的前端跨域来源（逗号分隔，留空=仅同源） | 空 |
| `ALLOW_DEMO` | 否 | 是否允许 demo 一键登录 | `true` |

## 📡 API 完整文档

### 通用约定

- **基础路径**：所有接口以 `/api` 为前缀（下文省略该前缀）。例如「账户列表」完整路径为 `GET /api/accounts`。
- **鉴权**：除认证接口（`/auth/*`）外，**所有业务接口都需要在请求头携带** `Authorization: Bearer <token>`。未携带或过期令牌返回 `401`。
- **数据隔离**：所有写 / 读操作均按 `user_id`（由 JWT 解析注入 `req.userId`）隔离。
- **内容类型**：请求体为 `application/json`，请设置 `Content-Type: application/json`。

#### 统一响应结构

成功：

```json
{ "success": true, "data": { }, "message": "可选的成功提示" }
```

失败：

```json
{ "success": false, "message": "错误描述", "code": 400 }
```

> `code` 字段为业务错误码（多数校验错误为 `400`）；HTTP 状态码与语义一致（见下表）。

#### 错误码对照

| HTTP 状态 | `code` | 含义 / 触发场景 |
|---|---|---|
| 200 | — | 成功 |
| 400 | 400 | 参数缺失 / 非法（如金额非数字、交易类型不合法、必填项为空、CSV 格式错误） |
| 401 | — | 未携带令牌 / 令牌过期 / 登录失败 |
| 404 | 404 | 资源不存在（账户 / 转账 / 交易 / 持仓 / 目标等） |
| 429 | — | 认证接口频率超限（默认 15 分钟内超过 5 次） |
| 500 | 500 | 服务器内部错误（详细信息仅记录在服务端日志，对外统一返回「服务器内部错误，请稍后重试」） |
| 502 | 502 | 行情查询 / 刷新失败（外部数据源不可达或解析失败） |

#### 复式记账核心规则（影响账户余额与转账/交易语义）

账户当前余额由账本推导，是余额的**唯一真相（single source of truth）**：

> 当前余额 = 期初余额(`opening_balance`) + 账本流水净额 − 已分配储蓄目标

- **转账**：`POST /transfers` 会同时写入一条 `transfers` 记录，并生成两条配对交易（`transfer_out` / `transfer_in`，通过 `transfer_id` 关联），事务内重算两端账户余额。
- **单笔交易**：`expense`/`transfer_out` 的账户记为资金流出（扣减方），`income`/`transfer_in` 记为资金流入（入账方）。
- **编辑账户余额**：`PUT /accounts/:id` 的 `balance` 字段会被当作新的「当前余额」，系统据此反推并重置期初基线，使「当前余额 = 期初 + 账本净额」恒成立。
- **一键对账**：`POST /accounts/reconcile` 以账本重算所有账户余额，修正历史漂移（如储蓄目标存取造成的账本外调整）。

---

### 1. 认证（公开，无需令牌）

#### `POST /auth/register` — 注册

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名，需唯一 |
| `password` | string | 是 | 密码（bcrypt 加盐哈希存储） |
| `nickname` | string | 否 | 昵称，缺省用 username |

**响应** `200`

```json
{
  "success": true,
  "data": {
    "token": "<JWT>",
    "user": { "id": 12, "username": "alice", "nickname": "alice" }
  },
  "message": "注册成功"
}
```

**错误**：`400` 用户名或密码缺失 / 用户名已存在。

#### `POST /auth/login` — 登录

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |

**响应** `200`

```json
{
  "success": true,
  "data": {
    "token": "<JWT>",
    "user": { "id": 1, "username": "demo", "nickname": "演示用户" }
  },
  "message": "登录成功"
}
```

**错误**：`400` 用户名或密码缺失；`401` 用户名或密码错误。

#### `POST /auth/demo` — 演示登录

**请求体**：无。需 `.env` 中 `ALLOW_DEMO=true`（默认开启）。

**响应** `200` — 同登录，返回 token + 用户信息（demo 用户）。
**错误**：`403` 演示登录已禁用。

#### `POST /auth/refresh` — 刷新 Token

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `refreshToken` | string | 是 | 登录时返回的 refreshToken（有效期 7 天） |

**响应** `200` — 返回新的 JWT（1h 有效期）。
**错误**：`401` refreshToken 无效或已过期。

#### `GET /auth/profile` — 获取当前用户资料

**响应** `200` — `data.user` 含 `id, username, nickname, avatar` 等当前用户信息（供头像 / 个人资料页使用）。

#### `PUT /auth/profile` — 更新资料 / 修改密码

**请求体**（字段均可选）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `nickname` | string | 否 | 新昵称 |
| `avatar` | string | 否 | 头像（emoji 或 URL） |
| `password` | string | 否 | 新密码（修改密码时填写） |
| `oldPassword` | string | 条件 | 修改密码时必填，用于校验原密码 |

**响应** `200` — `data.user` 返回更新后的用户信息；`400` 原密码错误（修改密码场景）。

---

### 2. 账户管理

#### `GET /accounts` — 账户列表与总资产

**鉴权**：Bearer Token
**查询参数**：无

**响应** `200` — `data` 含 `accounts` 数组与 `totalAssets`（所有 active 账户余额之和）。每条账户含 `id, user_id, name, type, icon, balance, opening_balance, credit_limit, sort_order, status`。

```json
{
  "success": true,
  "data": {
    "accounts": [
      { "id": 1, "name": "现金", "type": "cash", "icon": "💵", "balance": 3200, "credit_limit": 0, "status": "active" }
    ],
    "totalAssets": 3200
  }
}
```

#### `POST /accounts` — 新增账户

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 账户名 |
| `type` | string | 是 | 类型：cash / bank / wechat / alipay / credit 等 |
| `icon` | string | 否 | emoji 图标，默认 💰 |
| `balance` | number | 否 | 初始余额，默认 0（同时设为期初余额） |
| `credit_limit` | number | 否 | 信用卡额度，默认 0 |

**响应** `200` — `data: { id }`；`400` 名称或类型缺失。

#### `PUT /accounts/:id` — 编辑账户

**请求体**：同 `POST /accounts`（全部可选重传）。修改 `balance` 会重置期初基线（见复式记账规则）。

**响应** `200` — `message: "账户已更新"`。

#### `DELETE /accounts/:id` — 关闭账户

软删除：将 `status` 置为 `closed`（不物理删除数据）。**响应** `200` — `message: "账户已关闭"`。

#### `POST /accounts/reconcile` — 一键对账

**请求体**：无。**鉴权**：Bearer Token

以账本重算当前用户所有 active 账户余额，修正与账本不一致的记录。

**响应** `200`

```json
{
  "success": true,
  "data": { "reconciled": 2, "totalAdjusted": -150.5 },
  "message": "已对账，修正 2 个账户余额"
}
```

（无偏差时 `reconciled: 0`，`message: "账户余额与账本一致，无需修正"`）

#### `GET /accounts/:id/transactions` — 账户交易明细

**查询参数**：`month`（可选，形如 `2025-07`）；缺省返回该账户全部交易。
**响应** `200` — 该账户下的交易数组（结构同 `GET /transactions` 列表项，含分类 / 账户 / 标签关联）。

---

### 3. 内部转账

#### `GET /transfers` — 转账记录

**查询参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `month` | string | 形如 `2025-07`，按月份筛选（LIKE `2025-07%`）；缺省返回全部 |

**响应** `200` — 数组，每项为转账记录并附带双方账户信息：`id, user_id, from_account_id, to_account_id, amount, note, date, status, from_name, from_icon, to_name, to_icon`。

#### `POST /transfers` — 执行转账

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `from_account_id` | number | 是 | 转出账户 ID |
| `to_account_id` | number | 是 | 转入账户 ID（不可等于转出） |
| `amount` | number | 是 | 金额（>0） |
| `note` | string | 否 | 备注 |
| `date` | string | 否 | 日期，默认当前时间 |

在事务内：校验转出账户余额 → 写 `transfers` 记录 → 生成 `transfer_out` / `transfer_in` 配对交易 → 重算两端余额。

**响应** `200` — `data: { id }`，`message: "转账成功"`。
**错误**：`400` 账户缺失 / 账户相同 / 金额非法 / 余额不足 / 转出账户不存在。

#### `PUT /transfers/:id` — 修改转账

**请求体**：同 `POST /transfers`。会删除旧配对交易、按新参数重建并重新计算所有受影响账户余额。

**响应** `200` — `message: "转账已更新"`；`404` 记录不存在。

#### `DELETE /transfers/:id` — 删除转账

删除 `transfers` 记录及其两条配对交易，并重新计算两端账户余额。**响应** `200` — `message: "转账已删除"`；`404` 记录不存在。

---

### 4. 交易管理

#### `GET /transactions` — 交易列表（支持多维筛选）

**查询参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `month` | string | 月份 `2025-07`；`all` 或不传则不按月筛选 |
| `type` | string | `income` / `expense` / `transfer`（`transfer` 会同时匹配 `transfer_in` 与 `transfer_out`）/ `all` |
| `category_id` | number | 分类 ID |
| `search` | string | 模糊匹配备注 / 分类名 |
| `tag_id` | number | 按标签筛选（子查询 `transaction_tags`） |
| `amount_op` | string | 金额比较：`gt` / `lt` / `eq` / `ne` / `bt`(区间) / `nb`(非区间) |
| `amount_val` | number | 比较值 1（区间时与 `amount_val2` 自动取大小边界） |
| `amount_val2` | number | 比较值 2（仅 `bt` / `nb` 使用） |
| `limit` | number | 分页条数 |
| `offset` | number | 分页偏移（需配合 `limit`） |

**响应** `200` — 数组，每条交易已格式化并附带关联信息：

```json
{
  "success": true,
  "data": [
    {
      "id": 101, "type": "expense", "amount": 45, "date": "2025-07-01 12:30:00",
      "note": "午餐",
      "category": { "id": 1, "name": "餐饮", "icon": "🍜" },
      "account": { "id": 2, "name": "工商银行", "icon": "🏦" },
      "source": null, "destination": null,
      "counterparty": null,
      "transfer_id": null, "budget_id": null, "budget_name": null,
      "tags": [ { "id": 3, "name": "日常", "color": "#3b82f6", "icon": "🏷️" } ]
    }
  ]
}
```

> 转账类交易会填充 `source` / `destination` / `counterparty`（含方向 `→` / `←` 与对方账户名）。

#### `GET /ledger` — 复式记账流水

**查询参数**：`month`（同交易列表）。**响应** `200` — 数组，每条含 `source` / `destination` 账户（展现「来源 → 目标」）。

#### `POST /transactions` — 新增交易

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `account_id` | number | 是 | 关联账户 ID |
| `category_id` | number | 是 | 分类 ID |
| `budget_id` | number | 否 | 关联预算 ID |
| `type` | string | 是 | `income` / `expense` / `transfer_in` / `transfer_out` |
| `amount` | number | 是 | 金额（>0） |
| `date` | string | 否 | 日期，默认当前时间 |
| `note` | string | 否 | 备注 |
| `tags` | number[] | 否 | 标签 ID 数组 |

写入后按复式记账重算账户余额，并写入交易标签关联。**响应** `200` — `data: { id }`；`400` 金额非法 / 缺账户 / 类型不合法。

#### `PUT /transactions/:id` — 更新交易

**请求体**：同 `POST /transactions`。会重置交易标签，并按「旧账户 + 新账户」重算余额（账户变更时两者都修正）。**响应** `200` — `message: "交易已更新"`；`404` 交易不存在。

#### `DELETE /transactions/:id` — 删除交易

若删除的是转账配对交易，会级联删除同一 `transfer_id` 的另一条及 `transfers` 主记录，并重算所有受影响账户余额。**响应** `200` — `message: "交易已删除"`；`404` 交易不存在。

#### `GET /transactions/months` — 交易月份列表

**响应** `200` — `data` 为去重月份的字符串数组（倒序），如 `["2025-07","2025-06"]`。

#### `GET /transactions/summary` — 月度汇总

**查询参数**：`month`（必填，形如 `2025-07`）。

**响应** `200`

```json
{
  "success": true,
  "data": {
    "income": 18800, "expense": 7320, "balance": 11480,
    "expenseByCategory": [ { "id": 4, "name": "住房", "icon": "🏠", "parent_id": null, "total": 3500 } ],
    "incomeByCategory": [ { "id": 15, "name": "工资", "icon": "💼", "parent_id": null, "total": 15000 } ]
  }
}
```

> 类别汇总在数据库层用递归 CTE 完成「子级向父级汇总」：`total` 为该分类自身 + 全部子孙（任意层级）发生额之和；`parent_id` 为 `null` 表示一级分类。前端据此只展示一级，点击可下钻二级（与 `/reports` 语义一致）。

**错误**：`400` 未指定月份。

---

### 5. 综合报表

#### `GET /reports` — 生成报表

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 否 | `monthly`（默认）/ `quarterly` / `annual` |
| `period` | string | 是 | 周期：`monthly`→`2025-07`；`quarterly`→`2025-Q3`；`annual`→`2025` |

**响应** `200` — 结构如下：

```json
{
  "success": true,
  "data": {
    "type": "monthly", "period": "2025-07", "label": "2025年7月",
    "start": "2025-07-01", "end": "2025-07-31", "days": 31,
    "summary": {
      "income": 18800, "expense": 7320, "balance": 11480,
      "savingsRate": 61.06, "transactionCount": 42, "avgDailyExpense": 236.13
    },
    "dailyTrend": [ { "date": "2025-07-01", "income": 0, "expense": 3545 } ],
    "expenseByCategory": [ { "id": 4, "name": "住房", "icon": "🏠", "total": 3500 } ],
    "incomeByCategory": [ { "id": 15, "name": "工资", "icon": "💼", "total": 15000 } ],
    "accountFlows": [ { "id": 2, "name": "工商银行", "icon": "🏦", "type": "bank", "net": -5000 } ],
    "topExpenses": [ { "id": 90, "date": "2025-07-01", "amount": 3500, "note": "房租", "category_name": "住房", "category_icon": "🏠" } ],
    "budgetExecution": [ { "id": 4, "name": "住房", "icon": "🏠", "budget": 4000, "actual": 3500, "usage": 87.5 } ],
    "assets": { "totalAssets": 125000, "accounts": 80000, "investments": 45000 },
    "compare": { "period": "2025-06", "label": "2025年6月", "income": 17000, "expense": 8000, "balance": 9000 }
  }
}
```

> `dailyTrend` 会补齐无交易日期；`compare` 为上一周期环比（同类型上一周期）；`budgetExecution` 按预算名称与类别匹配实际支出。
> **错误**：`400` 未指定周期 / 周期格式错误 / 不支持的报表类型。

---

### 6. 预算管理

#### `GET /budgets` — 预算列表

**查询参数**：`period`（可选，形如 `2025-07` 或 `2025-07-01`，筛选时间范围重叠的预算）。

**响应** `200` — 数组，每项含 `actual`（已关联支出汇总）及格式化后的 `start_date` / `end_date` / `amount`(number)。

#### `POST /budgets` — 新增 / 更新预算

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 预算名称 |
| `amount` | number | 是 | 预算金额（>0） |
| `period_type` | string | 否 | `month`(默认) / `quarter` / `half` / `year` |
| `base_date` | string | 否 | 周期基准日，默认今天；据此计算 `start_date` / `end_date` |

**响应** `200` — `message: "预算已设置"`；使用 `ON DUPLICATE KEY` 同名预算会更新金额。
**错误**：`400` 名称或金额缺失 / 非法。

#### `PUT /budgets/:id` — 更新预算

**请求体**：同 `POST /budgets`。**响应** `200` — `message: "预算已更新"`。

#### `DELETE /budgets/:id` — 删除预算

**响应** `200` — `message: "预算已删除"`。

---

### 7. 分类管理

#### `GET /categories` — 分类列表

**查询参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `type` | string | 按类型筛选（如 `income` / `expense`） |
| `flat` | string | `1` 时直接返回扁平列表（交易表单场景） |

**响应** `200`
- `flat=1`：`data` 为扁平的分类数组。
- 默认：`data` 为 `{ tree, flat }` —— `tree` 为树形结构（按 `parent_id` 嵌套 `children`），`flat` 为完整扁平列表。

#### `POST /categories` — 新增分类

**请求体**：`parent_id`(number, 可选) · `name`*(string) · `icon`(string, 默认 📌) · `type`*(string: income/expense/transfer) · `color`(string, 默认 #6366f1)。
**响应** `200` — `data: { id }`；`400` 名称或类型缺失。

#### `PUT /categories/:id` — 更新分类

**请求体**：同 `POST`（全部可选重传）。**响应** `200` — `message: "分类已更新"`。

#### `DELETE /categories/:id` — 删除分类

**响应** `200` — `message: "分类已删除"`。
**错误**：`400` 该分类下仍有交易记录 / 仍有子分类。

---

### 8. 理财类型

#### `GET /investment-types` — 类型列表

**响应** `200` — 按 `sort_order` 排序的类型数组，含 `id, name, icon, risk_level, description, category`。

#### `POST /investment-types` — 新增类型

**请求体**：`name`*(string) · `icon`(string, 默认 💰) · `risk_level`(默认 medium) · `description`(string) · `category`(string: fund/stock/deposit/other, 默认 fund)。
**响应** `200` — `data: { id }`；`400` 名称缺失。

#### `PUT /investment-types/:id` — 更新类型

**请求体**：同 `POST`（全部可选重传）。**响应** `200` — `message: "理财类型已更新"`。

#### `DELETE /investment-types/:id` — 删除类型

**响应** `200` — `message: "理财类型已删除"`；`400` 该类型下仍有持仓。

---

### 9. 理财持仓

#### `GET /investments` — 持仓列表与汇总

**响应** `200` — `data` 含三部分：

```json
{
  "success": true,
  "data": {
    "investments": [
      {
        "id": 5, "name": "沪深300ETF", "code": "510300", "type_name": "指数基金",
        "buy_price": 4.12, "current_price": 4.56, "quantity": 5000,
        "total_cost": 20600, "current_value": 22800, "fee": 0,
        "profit": 2200, "profit_rate": 10.68,
        "expected_rate": 8, "actual_rate": 10.68
      }
    ],
    "summary": { "totalCost": 20600, "totalValue": 22800, "totalProfit": 2200, "totalProfitRate": 10.68 },
    "byType": { "指数基金": { "type_name": "指数基金", "icon": "📊", "risk_level": "medium", "total_cost": 20600, "total_value": 22800, "items": [ ... ] } }
  }
}
```

> 仅返回 `status = 'holding'` 的持仓；金额字段均为 number。

#### `GET /stats/investments` — 理财净值趋势

确保本周（周日）快照存在、并回溯补全历史每周快照后，返回趋势数据。

**响应** `200`

```json
{
  "success": true,
  "data": {
    "trendSeries": [
      { "id": 5, "name": "沪深300ETF", "type_name": "指数基金", "type_icon": "📊",
        "total_cost": 20600, "current_value": 22800, "profit_rate": 10.68,
        "points": [ { "date": "2025-07-06", "value": 21000 } ] }
    ],
    "byType": [ { "type_name": "指数基金", "icon": "📊", "total_cost": 20600, "total_value": 22800, "count": 1 } ]
  }
}
```

#### `POST /investments` — 新增持仓

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 持仓名称 |
| `investment_type_id` | number | 是 | 理财类型 ID |
| `account_id` | number | 否 | 关联资金账户 |
| `code` | string | 否 | 产品代码（基金 6 位数字 / 股票 sh/sz 前缀） |
| `buy_price` | number | 否 | 买入价 |
| `current_price` | number | 否 | 当前价（缺省用买入价） |
| `quantity` | number | 否 | 持有数量 |
| `total_cost` | number | 否 | 总成本（缺省 0） |
| `current_value` | number | 否 | 当前市值（缺省同总成本） |
| `fee` | number | 否 | 手续费 |
| `buy_date` | string | 否 | 买入日期，默认今天 |
| `expected_rate` | number | 否 | 预期收益率(%) |
| `note` | string | 否 | 备注 |

写入时会自动生成一条 `investment_transactions` 的「初始买入」记录。**响应** `200` — `data: { id }`；`400` 参数不完整。

#### `PUT /investments/:id` — 更新持仓（编辑 / 刷新行情二选一）

- **完整编辑**：`name` 字段存在时，按完整字段更新（含 `status`、`note` 等）。
- **仅刷新行情**：`name === undefined` 时，只更新 `current_price` / `current_value` / `actual_rate`（前端行情刷新场景）。

**响应** `200` — `message: "持仓已更新"`。

#### `POST /investments/:id/transactions` — 记录理财交易（卖出 / 分红 / 利息）

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | `buy` / `sell` / `dividend` / `interest` |
| `amount` | number | 否 | 金额 |
| `price` | number | 否 | 成交价 |
| `quantity` | number | 否 | 数量 |
| `date` | string | 否 | 日期 |
| `note` | string | 否 | 备注 |

行为：
- `sell`：减少持仓 `quantity` 与 `current_value`。
- `dividend` / `interest`：写入主交易（分类 17，`income` 类型）并增加关联账户余额。

**响应** `200` — `message: "操作已记录"`。

#### `GET /investments/:id/transactions` — 查看交易记录流水

按时间倒序返回该理财产品的全部流水（`investment_transactions`），包含初始买入、加仓、减仓、清仓、分红、利息等。**响应** `200` — `data: InvestmentTransaction[]`（`type` / `amount` / `price` / `quantity` / `date` / `note`）。

> Web / 安卓 / 鸿蒙三端理财详情页均提供「📋 交易记录」入口调用本接口。

#### `PUT /investments/:id/sell` — 清仓卖出

**请求体**：`sell_price`(number) · `date`(string) · `note`(string)。按 `sell_price × quantity` 计算卖出总额，记录卖出交易、置 `status='sold'`、`quantity=0`、写入 `sold_date`（清仓当天日期），并写入主交易（盈亏记入备注、增加账户余额）。**响应** `200` — `message: "已卖出"`；`404` 持仓不存在。

> **清仓当天保留**：持仓列表返回条件为 `status='holding' OR (status='sold' AND sold_date = 今天)`，即清仓当天卡片仍可见，隔天起自动归档隐藏（不影响历史统计）。

#### `POST /investments/:id/reduce` — 加仓 / 减仓

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | 是 | `buy`(加仓) / `sell`(减仓/部分卖出) |
| `price` | number | 是 | 成交价 |
| `quantity` | number | 是 | 成交数量（>0） |
| `fee` | number | 否 | 手续费 |
| `date` | string | 否 | 日期 |
| `note` | string | 否 | 备注 |

加仓：更新数量、加权成本（移动加权平均）、市值，写入主交易（支出）；减仓：按回款全额从成本基数中扣减（`cost -= amount`，净本金口径，与券商对账单一致），剩余为 0 时置 `sold` 并写入 `sold_date`（清仓当天），写入主交易（收入，含盈亏）。
**响应** `200` — `message: "已加仓"` / `"已减仓"` / `"已清仓"`；`400` 价格数量非法 / 卖出超量；`404` 持仓不存在。

#### `DELETE /investments/:id` — 删除持仓

级联删除该持仓的 `investment_transactions` 与主记录。**响应** `200` — `message: "持仓已删除"`。

---

### 10. 行情 API（代理外部数据源）

行情由服务端代理外部数据源：**基金**走东方财富（`api.fund.eastmoney.com`），**股票**走腾讯证券（`qt.gtimg.cn`，GBK 解码）。存款 / 其他类型不支持行情查询。

#### `GET /investments/quote` — 查询单只产品行情

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是 | 产品代码（基金 6 位数字 / 股票 sh/sz 前缀） |
| `category` | string | 否 | `fund` / `stock` / `deposit` / `other`，默认 `fund`（决定查询策略） |

**响应** `200`

- 基金：

```json
{ "success": true, "data": { "type": "fund", "code": "000198", "name": "天弘余额宝", "nav": 1.0003, "navDate": "2025-07-16", "estimatedNav": 1.0004, "estimatedChange": 0.01, "lastNav": 1.0003 } }
```

- 股票：

```json
{ "success": true, "data": { "type": "stock", "code": "sh600519", "name": "贵州茅台", "price": 1480.5, "change": 12.3, "changePercent": 0.84, "high": 1495, "low": 1465, "open": 1470 } }
```

**错误**：`400` 未提供代码 / 无法识别 / 该品类不支持；`502` 行情查询失败（外部源不可达或解析失败）。

#### `POST /investments/:id/refresh` — 刷新单个持仓行情

按持仓的 `code` 与类型品类拉取最新价，重算 `current_price` / `current_value` / `actual_rate`。
**响应** `200` — `data: { id, name, current_price, current_value, actual_rate, nav_date }`；`400` 无产品代码 / 品类不支持；`404` 持仓不存在；`502` 刷新失败。

#### `POST /investments/refresh-all` — 一键刷新全部持仓

遍历当前用户 `status='holding'` 且含 `code` 的持仓批量刷新。
**响应** `200`

```json
{ "success": true, "data": { "updated": 4, "results": [ { "id": 5, "code": "510300", "status": "ok", "price": 4.56, "currentValue": 22800, "actualRate": 10.68, "navDate": "2025-07-17" } ] }, "message": "已更新 4/5 个持仓" }
```

（无持仓时 `updated: 0`，`message: "无需要刷新的持仓"`）

---

### 11. 综合统计

#### `GET /stats/calendar` — 日历收支汇总

按**天**聚合指定月份的收支（`GROUP BY CAST(date AS CHAR(10))`），同日多笔合并为一行，避免时间戳不同导致分裂。`book_id` / `year` / `month` 为查询参数。

**响应** `200` — `data: { year, month, days: [ { date: "2025-07-16", income, expense, count, net } ] }`（前端首页 / 账单页日历共用，显示当日汇总金额）。

#### `GET /stats/dashboard` — 仪表盘数据

**响应** `200` — 一次性返回多周期数据：

```json
{
  "success": true,
  "data": {
    "currentMonth": "2025-07",
    "today": { "expense": 0 },
    "week": { "expense": 1250, "start": "2025-07-14", "end": "2025-07-17" },
    "month": { "income": 18800, "expense": 7320, "balance": 11480 },
    "year":  { "income": 112000, "expense": 56000, "balance": 56000 },
    "months": [ { "month": "2025-07", "income": 18800, "expense": 7320 } ],
    "accounts": [ { "id": 1, "name": "现金", "balance": 3200, "type": "cash" } ],
    "totalAssets": 125000,
    "investments": { "totalCost": 20600, "totalValue": 22800, "totalProfit": 2200 },
    "recentTransactions": [ { "id": 101, "type": "expense", "amount": 45, "date": "2025-07-17", "category": { "id": 1, "name": "餐饮", "icon": "🍜" }, "account": { "id": 2, "name": "工商银行", "icon": "🏦" } } ]
  }
}
```

#### `GET /stats/dashboard/detail` — 仪表盘卡片明细

**查询参数**：`type`（必填）—— `today` / `week` / `month` / `year` / `assets`。

- `today/week/month/year`：返回该周期内的交易明细与收支合计（`totalExpense` / `totalIncome` / `balance` / `transactions[]`）。
- `assets`：返回各 active 账户余额、理财市值(`inv_value`)与占比(`ratio`)，以及 `total`。

**响应** `200`

```json
{ "success": true, "data": { "type": "month", "title": "本月交易明细", "totalExpense": 7320, "totalIncome": 18800, "balance": 11480, "transactions": [ ... ] } }
```

**错误**：`400` 无效明细类型。

---

### 12. 标签管理

#### `GET /tags` — 标签列表

**响应** `200` — 当前用户标签数组（含 `id, user_id, name, color, icon`）。

#### `POST /tags` — 新增标签

**请求体**：`name`*(string) · `color`(string, 默认 #3b82f6) · `icon`(string, 默认 🏷️)。
**响应** `200` — `data: { id }`；`400` 标签名缺失。

#### `PUT /tags/:id` — 更新标签

**请求体**：同 `POST`（全部可选重传，名称必填）。**响应** `200` — `message: "标签已更新"`；`404` 标签不存在。

#### `DELETE /tags/:id` — 删除标签

级联删除 `transaction_tags` 关联。**响应** `200` — `message: "标签已删除"`。

---

### 13. 储蓄目标

#### `GET /savings-goals` — 目标列表

**响应** `200` — 数组，每项含关联账户信息，`target_amount` / `current_amount` 均为 number。

#### `GET /savings-goals/:id/transactions` — 目标存取流水

**响应** `200` — 该储蓄目标相关的账户余额变动流水（存入/取回记录）。

#### `POST /savings-goals` — 新增目标

**请求体**：`name`*(string) · `target_amount`(number) · `account_id`(number, 可选) · `icon`(string, 默认 🎯) · `note`(string)。
**响应** `200` — `data: { id }`；`400` 名称缺失。

#### `PUT /savings-goals/:id` — 更新目标

**请求体**：同 `POST`（全部可选重传，名称必填）。**响应** `200` — `message: "储蓄目标已更新"`；`404` 目标不存在。

#### `POST /savings-goals/:id/allocate` — 存入目标

**请求体**：`amount`*(number, >0)。若关联账户余额不足则报错；否则在事务内扣减账户余额并增加目标 `current_amount`（账本外调整，对账时通过已分配额抵扣）。
**响应** `200` — `message: "已存入目标"`；`400` 金额非法 / 关联账户余额不足；`404` 目标不存在。

#### `POST /savings-goals/:id/withdraw` — 取回目标

**请求体**：`amount`*(number, >0)。在事务内减少目标 `current_amount` 并（若关联账户）增加账户余额。
**响应** `200` — `message: "已取回"`；`400` 金额非法 / 目标余额不足；`404` 目标不存在。

#### `DELETE /savings-goals/:id` — 删除目标

**响应** `200` — `message: "目标已删除"`。

---

### 14. 债务管理

#### `GET /debts` — 债务列表

**响应** `200` — 数组，每项含 `id, name, type, creditor, principal, remaining, interest_rate, monthly_payment, start_date, due_date, billing_day, payment_day, status` 及 `repayments[]`（还款流水）。

已还清超过 7 天的债务会自动清理（仅删债务记录，保留还款流水）。

#### `POST /debts` — 新增债务

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 债务名称 |
| `type` | string | 是 | `credit_card` / `loan` / `personal` / `other` |
| `principal` | number | 是 | 本金/初始总额 |
| `creditor` | string | 否 | 债权人/机构/个人 |
| `remaining` | number | 否 | 剩余本金（默认等于 principal） |
| `interest_rate` | number | 否 | 年利率(%) |
| `term_months` | number | 否 | 期限月数 |
| `method` | string | 否 | 还款方式：`equal_installment` / `equal_principal` / `interest_only` / `minimum` / `lump_sum` / `manual` |
| `monthly_payment` | number | 否 | 月供 |
| `start_date` | string | 否 | 起始日期 |
| `due_date` | string | 否 | 到期/下次还款日 |
| `billing_day` | number | 否 | 信用卡账单日(1-28) |
| `payment_day` | number | 否 | 信用卡还款日(1-28) |
| `min_payment` | number | 否 | 最低还款额 |
| `note` | string | 否 | 备注 |

**响应** `200` — `data: { id }`。

#### `PUT /debts/:id` — 更新债务

**请求体**：同 `POST`（全部可选）。**响应** `200` — `message: "债务已更新"`。

#### `DELETE /debts/:id` — 删除债务

**响应** `200` — `message: "债务已删除"`。

#### `POST /debts/:id/repayments` — 记录还款

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `amount` | number | 是 | 还款金额 |
| `paid_at` | string | 是 | 还款日期 |
| `account_id` | number | 否 | 还款账户（自动扣减余额 + 写入交易记录） |
| `principal_part` | number | 否 | 本金部分 |
| `interest_part` | number | 否 | 利息部分 |
| `note` | string | 否 | 备注 |

事务内：写入 `debt_repayments` → 更新 `debts.remaining` → 若关联账户则写入交易（`expense`）并扣减余额。**响应** `200` — `message: "还款已记录"`。

#### `GET /debts/:id` — 债务详情

**响应** `200` — 同列表项结构（含 `id, name, type, ...` 及 `repayments[]` 还款流水）。

#### `DELETE /debts/:id/repayments/:rid` — 删除单笔还款

删除指定还款流水，回滚对 `debts.remaining` 的影响并撤销其写入的关联交易/余额变动。**响应** `200` — `message: "还款已删除"`；`404` 还款不存在。

---

### 15. 账本备份（xlsx 3 工作表）

备份为单个 `.xlsx` 文件，内含三个工作表，首行带固定识别标记 `鑫钱包账本备份` 与版本号，可用于数据损坏后的完整恢复。

- **账本配置页**：账本信息 + 分类 + 标签 + 预算 + 债务 + 储蓄目标
- **账户页**：账户 + 理财持仓
- **账单流水页**：全部交易（含转账）

#### `GET /backup/export` — 导出备份

**响应** `200` — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` 文件下载（`Content-Disposition: attachment; filename="xinwallet_backup_YYYY-MM-DD.xlsx"`）。

#### `POST /backup/import` — 导入备份

**请求体**：`file`(multipart/form-data，仅接受 `.xlsx`，≤5MB)。

导入时校验识别标记与三个工作表，事务内恢复标签、账户、分类（仅用户自建，系统预设跳过）、理财持仓、预算、债务、储蓄目标、交易与转账（生成 1 条转账主记录 + 2 条 `transfer_out`/`transfer_in` 台账），末尾按账本重算所有账户余额。

**响应** `200` — `data: { imported: { tags, accounts, categories, budgets, debts, savings_goals, investments, transactions, transfers } }`；`400` 缺少文件 / 非备份文件 / 格式错误。

---

### 16. AI 模块（服务商 / 洞察 / OCR）

AI 能力由用户自配置的「大模型服务商」驱动（API Key 经 AES-256-GCM 加密存储，列表 / 配置接口返回时自动掩码）；OCR 基于腾讯云（凭证同样加密）。所有接口需 Bearer 令牌。`/ai/*` 另受 AI 专用速率限制（`aiLimiter`）保护，防止成本失控。

#### `GET /ai/providers` — 服务商列表

**响应** `200` — `data.providers` 数组，每项含 `id, name, api_type, base_url, model, is_active, sort_order`，`api_key` 已掩码（如 `sk-****1234`）。

#### `POST /ai/providers` — 新增服务商

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 服务商名称 |
| `api_type` | string | 是 | `openai` / `anthropic` |
| `base_url` | string | 是 | 接口地址 |
| `api_key` | string | 否 | API Key（加密存储） |
| `model` | string | 是 | 模型名 |
| `is_active` | bool | 否 | 是否设为当前启用（启用会取消其他） |
| `sort_order` | number | 否 | 排序 |

**响应** `200` — `data: { id }`；`400` 校验失败（名称 / 类型 / 地址 / 模型必填）。

#### `PUT /ai/providers/:id` — 更新服务商

**请求体**：同 `POST`（全部可选重传；`api_key` 留空则不覆盖原值）。**响应** `200` — `message: "服务商已更新"`；`404` 不存在。

#### `DELETE /ai/providers/:id` — 删除服务商

**响应** `200` — `message: "服务商已删除"`；`404` 不存在。

#### `POST /ai/providers/:id/activate` — 启用服务商

将该服务商设为 `is_active = TRUE`，并取消其他服务商的启用状态。**响应** `200` — `message: "已启用该服务商"`；`404` 不存在。

#### `POST /ai/providers/:id/test` — 测试连接

使用存储的 API Key 向服务商发一条探针请求。**响应** `200` — `data: { ok, reply }`；`400` 未配置 Key / 解密失败 / 连接失败（`data.ok = false` 时返回错误原因）。

#### `POST /ai/advice` — AI 财务建议 + 消费洞察

汇总本月 / 上月收支、预算、储蓄目标、账户、债务，调用模型一次性生成建议与洞察。**响应** `200` — `data: { advice: [{ title, content, impact, priority }], insights: [{ title, description, action, level }], generatedAt }`；`400` 未配置服务商。

#### `POST /ai/insight` — AI 消费洞察（已废弃）

已合并进 `POST /ai/advice`，该端点返回 `410 Gone` 并提示改用 `/ai/advice`。

#### `GET /ai/ocr-config` — 获取 OCR 配置

**响应** `200` — `data: { provider, secret_id(掩码), region, credentialsValid, credentialsError }`；未配置时返回默认 `tencent / ap-guangzhou`。`credentialsValid` 用于提示前端密钥是否仍可正常解密。

#### `POST /ai/ocr-config` — 保存 OCR 配置

**请求体**：`secret_id`(string) · `secret_key`(string) · `region`(string, 默认 `ap-guangzhou`)。`secret_id` 若传入脱敏占位符（含 `...`）则保留原值不覆盖。**响应** `200` — `message: "OCR 配置已保存"`；`400` 首次保存时 SecretId / SecretKey 必填。

#### `POST /ai/ocr` — 账单 OCR 识别

`multipart/form-data` 上传账单图片（`file` 字段）。服务端先用正则快速提取交易项，失败再调模型；返回识别文字与结构化交易项。**响应** `200` — `data: { text, items: [{ name, amount, type, date, note, category }], reason }`；`400` 未上传图片 / 未配置 OCR 密钥 / 密钥解密失败。

---

## 🛡️ 安全

- 密码使用 `bcryptjs` 加盐哈希存储，无明文。
- 业务接口受 JWT 鉴权中间件保护，按用户隔离数据。
- `helmet` 开启 CSP（放行字体 / 本地资源），`cors` 严格白名单：前端由本服务同源托管时默认**不开放跨域**；仅在 `.env` 配置 `CORS_ORIGIN` 时才放行对应来源，且禁止任意站点携带凭据请求。
- `/api/auth/*` 登录注册接口启用频率限制（默认 15 分钟最多 5 次），防暴力破解。
- 所有 SQL 均为参数化查询，无注入风险。
- 前端所有用户可控字段（账户名、交易备注、标签名、理财名称等）在 `innerHTML` 渲染前均经 `escapeHtml` 转义，避免存储型 XSS。
- 服务端错误统一返回通用提示，完整堆栈仅记录在服务端日志，不向客户端泄露 SQL / 内部细节。
- 写入接口对金额 / 类型做校验（`toNumber` 拒绝 NaN、交易类型枚举校验），防止非法数据写入导致账目错乱。

## 🐳 Docker / NAS 部署

应用镜像已发布到 GitHub Container Registry（GHCR）：**`ghcr.io/zjx93/xin-wallet/xinwallet:latest`**（含 `linux/amd64` 与 `linux/arm64`，适配 x86 与 ARM 架构的 NAS）。镜像版本号与安卓客户端**完全统一**（同为 `vX.Y.Z`，X.Y 锁定为 0.0、即 v0.0.Z）——仓库只有一套版本线，由 `auto-tag.yml` 在每次发布时派发 `release-image.yml`（构建镜像）与 `android-build.yml`（构建 APK），因此你拉到的镜像版本永远等于安卓 App 里显示的版本。关联仓库为 public，**任何人无需登录即可匿名 `docker pull`**。也可固定到具体版本：`ghcr.io/zjx93/xin-wallet/xinwallet:v0.0.1`。

提供两种部署模式，按需选择：

- **模式 A · 一体部署（默认）**：用 `docker-compose.yml`，一条命令跑起「应用 + 内置 PostgreSQL」，数据存命名卷，最省心。适合 NAS 上还没有 PostgreSQL、或想独立隔离的场景。
- **模式 B · 复用已有 PostgreSQL**：用 `docker-compose.external.yml`，只启动应用容器，连接你 NAS / 服务器上**已经存在的 PostgreSQL**（复用既有数据，不另起库实例）。适合已经在跑 PostgreSQL 的用户。

两种模式均通过 `.env` 配置数据库连接；`initDatabase()` 会幂等建库建表（已存在则跳过），因此外部模式接入后**自动复用你已有的 xinwallet 数据**。

### 0. 准备环境变量（两模式通用）

```bash
cp .env.example .env
# 务必修改以下两项（不要使用示例值）：
#   DB_PASSWORD   —— 一体模式同时作为 PostgreSQL postgres 密码；外部模式填你已有库的密码
#   JWT_SECRET    —— 用 `openssl rand -hex 32` 生成一个长随机串
```

> 💡 **一键试用**：即使不创建 `.env`，直接 `docker compose up -d`（或模式 B 加 `-f docker-compose.external.yml`）也能拉起——compose 会自动从 GHCR 拉取**公开**预构建镜像，内置了默认密码/密钥。默认凭据**仅用于本地试用**，生产环境务必 `cp .env.example .env` 并改为强密码，否则数据库与 JWT 有泄露风险。
>
> 想从源码本地构建（而非拉取镜像），加 `--build` 即可：`docker compose up -d --build`（或模式 B 加 `-f docker-compose.external.yml`）。`app` 服务已同时声明 `image:` 与 `build:`，默认拉取 GHCR 镜像，`--build` 时才走本地源码构建。

### 1. 模式 A · 一体部署（自带 PostgreSQL）

```bash
docker compose up -d
```

- `DB_HOST` 会被 compose 固定为 `db`，无需手动改 `.env`
- 应用对外暴露端口：`${APP_PORT:-18888}`（默认 `18888`），浏览器访问 `http://<NAS_IP>:18888/index.html`
- PostgreSQL 仅在内部网络（`db:5432`）可达，不对外暴露，更安全
- 应用容器通过启动前的数据库就绪探测（最多重试 30 次 / 约 60s），避免 PostgreSQL 尚未就绪就连接导致启动失败

### 2. 模式 B · 复用已有 PostgreSQL

编辑 `.env`，把 `DB_HOST` 改成你现有库的主机/IP：

- 同一台 Docker 主机上的其他 PostgreSQL 容器 → 填该容器名（需与它在同一网络）
- NAS 原生安装的 PostgreSQL → 填宿主机局域网 IP，或 `host.docker.internal`（本 compose 已通过 `extra_hosts` 映射）
- `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` 填你既有库的对应值

```bash
# 使用外部 PostgreSQL 的 compose 文件启动（仅应用容器）
docker compose -f docker-compose.external.yml up -d --build
```

> ⚠️ 权限要求：应用所用的 `DB_USER` 需具备在目标库上「建表与改表」的权限，即 `CREATE DATABASE`（若库尚未创建）、`CREATE TABLE`、`ALTER`、`INDEX`；`initDatabase` 会自动建库建表，并在每次启动时执行幂等迁移。若账号无建库权限，请先手动执行 `CREATE DATABASE "xinwallet" ENCODING 'UTF8';`。

### 3. 各 NAS 平台要点

- **群晖 Synology**：Container Manager → 项目 → 新增 → 来源选 compose 文件所在文件夹 → 勾选「启用自动重启」→ 创建；或在 NAS ssh 终端直接 `docker compose up -d`。模式 B 请改用 `docker-compose.external.yml` 作为来源文件。
- **Unraid**：推荐安装 **Compose Manager** 插件后直接加载 compose 文件（比逐个 Add Container 更稳）。
- **TrueNAS SCALE**：Apps → 自定义 App 上传 compose，或 ssh 进 Apps 池执行 `docker compose up -d`。
- **QNAP**：Container Station → 应用程序 → 创建 → 粘贴 compose 内容。

### 4. 数据备份与升级

- **模式 A** 数据库存储在 Docker 命名卷 `xinwallet-db-data`；要固定到 NAS 共享文件夹，可把 `docker-compose.yml` 中 `xinwallet-db-data:/var/lib/postgresql/data` 改为绑定挂载，例如 `/volume1/docker/xinwallet/db:/var/lib/postgresql/data`（群晖路径示例）。
- **模式 B** 数据就在你已有的 PostgreSQL 中，按你原有的备份策略管理即可（如 `pg_dump`）。
- 升级：拉取最新代码后重新 `docker compose up -d`（模式 B 加 `-f docker-compose.external.yml`）；schema 幂等（`IF NOT EXISTS`），不会破坏现有数据。
- 备份（模式 A 示例）：`docker exec xinwallet-db pg_dump -U postgres xinwallet > xinwallet_$(date +%F).sql`。

> 若 NAS 处于无外网环境，前端所用的 Chart.js（jsdelivr CDN）与 Google Fonts 将无法加载，图表与字体回退为默认。如需完全离线，可将这两类资源改为本地引入（列入后续增强）。

## 🧪 测试

项目包含纯函数单元测试（无需数据库即可运行）：

```bash
npm install
npm test
```

- `test/validate.test.js`：后端数值校验 `toNumber`、交易类型枚举、CSV 行解析 `parseCsvLine`。
- `test/utils.test.js`：前端 `escapeHtml`（XSS 防护）、`csvCell`、货币格式化 `fmt`。
- `test/debt-summary.test.js`：负债汇总逻辑单元测试。

> 另见 `scripts/`：`verify-routes.js`（路由自检）、`smoke-test.js`（冒烟）、`full-verify.js`（全量校验）等排查脚本。

## 🛠️ 开发脚本与排障

`scripts/` 下提供可在终端直接运行的运维 / 排查脚本（均从仓库根目录以 `node` 执行）：

- `node scripts/verify-routes.js` —— 路由可达性自检，确认各 REST 接口已正确注册。
- `node scripts/smoke-test.js` —— 冒烟测试，对核心接口做连通性验证。
- `node scripts/full-verify.js` —— 全量校验，覆盖更多业务路径。

> 仓库含两份 `package.json`：`根 package.json` 承载启动脚本（`npm start` → `node server/index.js`）、测试（`npm test`）与依赖；`server/package.json` 是后端 API 的独立依赖清单（版本可能与根略有差异，以 `server/` 目录安装为准）。本地从源码启动请在 `server/` 目录执行 `npm install && npm start`。

## 📝 架构说明

- **数据库**：采用 PostgreSQL（支持递归 CTE / 窗口函数 / generate_series），为分类汇总、投资回报分析等场景提供支撑。
- **启动引导**：`server/index.js` 在启动时幂等执行 `server/schema.sql` 建库建表（已存在则跳过），并注入种子分类与演示数据。
- **服务分层**：行情数据（`services/market-data.js`）、理财计算（`services/portfolio.js`）、金额运算（`services/money.js`）、SSRF 防护（`services/url-guard.js`）从路由中独立为可复用服务层。
- **整数分金额内核**：`services/money.js` 统一以「整数分」做金额运算，根除浮点精度误差（`toCents`/`fromCents`/`sumAmounts` 等）。
- **兼容层**：`db.js` 内置 `?→$N` 占位符自动转换 + `INSERT RETURNING id` + SQL 双引号→单引号转换。

## 📝 后续可增强

- 多币种支持与汇率换算
- 投资回报率分析（XIRR/夏普比率，基于 PostgreSQL 窗口函数）
- AI 识别后端服务化（票据 OCR / LLM 分类）
- 接口 / 集成测试（基于测试数据库）
- 数据导入导出（JSON 备份）
