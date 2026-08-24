# 本地后端启动说明

面向本机开发调试。生产部署走 `docker compose up -d`，与本文无关。

---

## 架构：Postgres 在容器，Node 在宿主机

```
宿主机 Node (node --watch server/index.js)  ← 改代码自动重载
      │  127.0.0.1:5432
      ▼
Docker 容器 xinwallet-db (postgres:16-alpine)
```

**为什么不全用 compose**：`docker-compose.yml` 里 app 是构建成镜像跑的，
每改一行服务端代码都要重建镜像。宿主机跑 Node 配 `--watch`，改完存盘即生效。

**为什么 db 不用 compose 起**：compose 里 db 的端口映射被**故意注释掉了**
（安全加固：数据库只在容器内网可达）。宿主机的 Node 连不上它。
本机这个 `xinwallet-db` 容器是单独起的，映射了 `127.0.0.1:5432`。

---

## 前置条件

| 项 | 状态 |
|---|---|
| 本机 PostgreSQL / MySQL | **未安装**，只有 Docker |
| Docker Desktop | 已装（server 29.7.2） |
| 容器 `xinwallet-db` | 已存在，映射 `127.0.0.1:5432` |
| `server/node_modules` | 已装齐 14 个依赖 |
| 根 `node_modules` | 已装（249 包）—— `npm test` 需要，见下文 |

---

## 启动

```bash
cd D:/ProgramData/WorkBuddy/XinWallet/XinWallet

# 1. 确认数据库容器在跑
docker ps --format "{{.Names}} {{.Ports}}" | grep xinwallet-db
# 没在跑：docker start xinwallet-db

# 2. 启动后端（watch 模式，改代码自动重载）
node --watch server/index.js
```

访问：

* 前端 <http://localhost:18888>
* API 文档 <http://localhost:18888/docs>
* 演示登录：`ALLOW_DEMO=true` 已开，登录页有快捷入口（账号 demo）

启动成功的标志是这两行：

```
✅ 数据库已就绪
INFO  Server started {"port":"18888","env":"development",...}
```

`initDatabase()` 幂等 —— 自动建库建表，已存在则跳过，不会清数据。

---

## 停止

Windows 上 `Ctrl+C` 有时留下孤儿进程占着 18888。确认并清理：

```powershell
# 查占用
Get-NetTCPConnection -LocalPort 18888 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess | Select-Object Id,ProcessName,StartTime }

# 停掉
Get-NetTCPConnection -LocalPort 18888 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## ⚠️ 最容易踩的坑：孤儿旧进程

Node **不热重载**（除非 `--watch`）。一个 8 月 22 日启动的进程会一直跑
22 日那份代码，哪怕磁盘上的文件已经改了三十次。

这次就是：18888 被一个**运行了 30 小时**的进程占着，
接口返回的全是旧逻辑 —— 服务端改动看起来"完全没生效"。

**判断方法**：比对进程启动时间和文件修改时间。

```powershell
# 进程启动时间
Get-NetTCPConnection -LocalPort 18888 -State Listen |
  ForEach-Object { (Get-Process -Id $_.OwningProcess).StartTime }
```

```bash
# 文件修改时间
stat -c "%y %n" server/routes/transfers.js
```

进程启动时间早于文件修改时间 → 它跑的是旧代码，必须重启。

**所以推荐始终用 `--watch` 启动。**

---

## `.env` 配置要点

`.env` 已被 `.gitignore` 忽略（第 2 行），不会入库。几个不能照抄 `.env.example` 的地方：

### 数据库密码取自容器实际值

```bash
docker inspect xinwallet-db --format '{{range .Config.Env}}{{println .}}{{end}}' | grep POSTGRES
```

填错会卡在「等待数据库就绪」重试 30 次（约 60s）后退出。

### `NODE_ENV` 必须是 development

`production` 下 `crypto.js` 找不到密钥文件会直接 `process.exit(1)`，
`auth.js` 对 JWT_SECRET 也是硬失败。

### `ENCRYPTION_KEY_FILE` 必须覆盖

默认值 `/app/data/.encryption-key` 是**容器内**路径，宿主机不存在。
不覆盖的话每次启动都写不进去 → 每次生成新 key → 本次存的 AI 凭证下次启动就解不开。

配置指向仓库**外**的目录（避免密钥被误提交）：

```
ENCRYPTION_KEY_FILE=D:/ProgramData/WorkBuddy/XinWallet/.local-secrets/.encryption-key
```

生效的标志是第二次启动打印「🔐 从数据卷读取 ENCRYPTION_KEY」而不是「首次启动自动生成」。

---

## 已知的无害告警

启动时这段是**预期的**，不是配置错误：

```
⚠️ [AI 凭证自检] ai_providers id=2 user=1 解密失败（密钥可能已变更）
⚠️ 共 2 条 AI/OCR 凭证因加密密钥变更无法解密
```

库里那 2 条 AI 凭证是**更早某次运行**写的，加密它们的 key 存在一个
已不存在的 app 容器卷里。key 丢了，密文永久解不开 —— 与当前配置无关。

想消掉这个告警：在「AI 配置」页重新保存一次 API Key 即可（会用当前 key 重新加密）。

---

## 跑测试

```bash
npm test              # 单元测试，129 项
npm run test:routes   # 路由清单校验
```

**根目录必须装依赖**：`test/` 下有 4 个文件从项目根 `require('express')`，
而依赖原先只装在 `server/node_modules`。缺根依赖时它们直接
`Cannot find module 'express'` 失败（表现为 4 个 fail，与代码无关）。
装好后测试总数从 114 涨到 129 —— 原先有 15 项根本没跑起来。

```bash
npm install           # 根目录
```

⚠️ **部分测试会连真库**（`accounts-detail.test.js` 等 `require('../server/db')`
并读 `.env`）。它们跑在同一个 `xinwallet` 库上，不要在有重要数据时随意跑。

---

## 转账相关的专项验证

```bash
node scripts/verify-transfer-collapse.js      # 36 项：SQL 层折叠
node scripts/verify-transfer-merge-client.js  # 24 项：web 端兼容两种返回形态
node scripts/verify-transfer-note.js          # 28 项：两条腿的备注方向与用户原文
```

三个都不连数据库、不起服务，可随时跑。

---

## 临时文件

* `.local-tmp/` —— 联调产物（token、接口快照），已加入 `.gitignore`，随时可删
* `D:/ProgramData/WorkBuddy/XinWallet/.local-secrets/` —— 加密密钥，**在仓库外**，删了会导致已存的 AI 凭证解不开
