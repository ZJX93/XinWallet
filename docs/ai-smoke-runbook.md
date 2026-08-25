# AI v0.2 冒烟套件跑法

> 首次编写：2026-08-25（三套合计 **166/166 全绿**，零代码改动）
> 套件位置：`server/modules/ai/__tests__/*.mjs`

## 一、套件清单

| 文件 | 断言数 | 覆盖 |
|---|---|---|
| `smoke-phase1.mjs` | 38 | parse/commit/幂等/409 冲突/discard/参数校验 |
| `smoke-web-contract.mjs` | 66 | 复现 `public/js/managers/ai-smart-entry.js` 真实调用序列 |
| `smoke-harmony-contract.mjs` | 62 | 复刻 `harmony/.../Http.ts` 的 `doRequest` 语义与 `Chat.ets` 前置自检 |

### ⛔ 这三套不在 `npm test` 门禁内

`package.json` 的 `"test": "node --test \"test/*.test.js\""`，而套件是 `.mjs` 且不在 `test/` 下
⇒ **`npm test` 全绿不代表 AI v0.2 已验证**，必须手工跑。

三套都是**端到端**（`BASE = http://127.0.0.1:18888`），需要真实 PG + 后端。

---

## 二、前置环境（四步）

### 1. Docker daemon

Docker Desktop 装在**用户目录**，不在 Program Files：

```
C:/Users/XIN/AppData/Local/Programs/DockerDesktop/Docker Desktop.exe
```

daemon 没起时需拉起该 GUI 进程，约 10s 就绪（`docker info` 轮询判断）。

### 2. PostgreSQL —— 别新建容器

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
```

会发现 `xinwallet-db` **已存在且已映射 `127.0.0.1:5432`**（`restart: unless-stopped`，
Docker Desktop 一起就自动恢复）。直接用它。

> ⚠️ 手工 `docker run -p 127.0.0.1:5432:5432` 会撞 `port is already allocated`。
> 注：`docker-compose.yml` 里 db 的 `ports` **默认是注释掉的**（安全加固：DB 仅内部网络可达），
> 当前这台开发机被手工放开过。

就绪检查：`docker exec xinwallet-db pg_isready -U postgres`

### 3. 后端 —— 必须放宽 AI 限流

```bash
cd <repo>
AI_RATE_LIMIT_MAX=100000 API_RATE_LIMIT_MAX=100000 \
WRITE_RATE_LIMIT_MAX=100000 AUTH_RATE_LIMIT_MAX=100000 \
env -u NODE_OPTIONS node server/index.js > /c/Users/XIN/AppData/Local/Temp/xw-server.log 2>&1 &
```

- `env -u NODE_OPTIONS`：剥掉 WorkBuddy 注入的 safe-delete shim（同 hvigor / gradlew）
- 限流变量见下面第三节，**不加会有 6 个假失败**

等 `INFO Server started` 出现即可（约 12s，含数据库自愈）。

### 4. 登录方式

三套都走 `POST /api/auth/demo` **免密**登录，依赖 `.env` 里的 `ALLOW_DEMO=true`（已开）。

> `smoke-harmony-contract.mjs:18` 读的 `DEMO_PASSWORD` 是**残留未用变量**，不必设置。

---

## 三、⛔ 头号坑：失败集中在后半段且实际码是 429 ⇒ 限流，不是契约问题

`server/rate-limit-user.js:50` —— **AI 接口默认每分钟仅 10 次**：

```js
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.AI_RATE_LIMIT_MAX || '10', 10),
    ...
```

一套冒烟一轮要打 15+ 次 AI 路由，于是后半段全被拦。**失败表征极具误导性**：

```
[9] discard：弃置预测
  FAIL HTTP 200 (实际 429)
  FAIL status=discarded (实际 undefined)     ← 看着像状态机 bug
[10] 参数校验
  FAIL 空文本 → 400 (实际 429)                ← 看着像校验没生效
  FAIL 无交易信息 → 422 (实际 429)  → {"message":"AI 接口调用过于频繁，请稍后再试"}
```

**判据：失败全部集中在套件靠后段落、且 `实际` 码统一为 429 ⇒ 先查限流，别去读业务代码。**

放宽后 `38 通过 / 0 失败`。项目已有先例：`server/.env` 里的 `AUTH_RATE_LIMIT_MAX=1000`
就是为跑测试放宽的，所以走环境变量是既有约定，**不需要改代码**。

---

## 四、跑

```bash
cd <repo>
env -u NODE_OPTIONS node server/modules/ai/__tests__/smoke-phase1.mjs
env -u NODE_OPTIONS node server/modules/ai/__tests__/smoke-web-contract.mjs
env -u NODE_OPTIONS node server/modules/ai/__tests__/smoke-harmony-contract.mjs
```

结尾标志：`SMOKE_ALL_PASS` / `web 端接入契约全部验证通过` / `Harmony 契约全部通过 ✓`

### 幂等键坑（作者已在注释写明）

`RUN_ID = ${Date.now()}-${random}` 必须每轮唯一。硬编码常量第二次运行会命中上一轮幂等记录，
后端**正确**返回历史快照（无 id、余额不再变动），而断言按「首次落账」写 ⇒ **假失败**。

---

## 五、清理脏数据

一轮三套会往 demo 账本落 **22 条真实交易（含 2 组转账）+ 24 条预测**，账户余额被真实扣减。

### 5.1 先备份

```bash
docker exec xinwallet-db pg_dump -U postgres -d xinwallet \
  > /c/Users/XIN/AppData/Local/Temp/xw-backup/xinwallet-before-cleanup.sql
```

### 5.2 ⛔ `docker exec` 跑 heredoc SQL 必须加 `-i`

```bash
docker exec    xinwallet-db psql ... <<'SQL'   # ❌ stdin 没接上，静默什么都不执行、输出为空、exit 0
docker exec -i xinwallet-db psql ... <<'SQL'   # ✅
```

第一次清理就这么「成功」了，实际一行没删。
**铁律：删改类 SQL 跑完必须用独立 SELECT 复查计数，别信 exit code。**

### 5.3 定位靠关联表，不靠时间戳

`ai_prediction_transactions.transaction_id` 是唯一真相 —— 比
`created_at > NOW() - INTERVAL '30 minutes'` 精确，不会误伤 demo 原有数据。

```sql
BEGIN;
CREATE TEMP TABLE smoke_txn AS
  SELECT DISTINCT transaction_id AS id FROM ai_prediction_transactions;
-- 转账必须整组删，否则留下孤立的 transfer_in 半条腿
CREATE TEMP TABLE smoke_transfer AS
  SELECT DISTINCT transfer_id AS id FROM transactions
  WHERE id IN (SELECT id FROM smoke_txn) AND transfer_id IS NOT NULL;

DELETE FROM ai_prediction_transactions;
DELETE FROM ai_feedback_events;
DELETE FROM transactions
 WHERE id IN (SELECT id FROM smoke_txn)
    OR transfer_id IN (SELECT id FROM smoke_transfer);
DELETE FROM transfers WHERE id IN (SELECT id FROM smoke_transfer);
DELETE FROM ai_predictions;
COMMIT;
```

### 5.4 ⛔ 余额不会自动回滚 —— 但也别手写余额 SQL

`accounts.balance` 是**物化列**，由应用层维护（`transactions` 上的触发器只管 `updated_at`）。
删行后余额会偏。

✅ **调用应用自带的自愈接口**：

```bash
TK=$(curl -s -X POST http://127.0.0.1:18888/api/auth/demo -H 'Content-Type: application/json' \
     | python -c "import json,sys;print(json.load(sys.stdin)['data']['token'])")
curl -s -X POST http://127.0.0.1:18888/api/accounts/reconcile \
     -H "Authorization: Bearer $TK" -H 'X-Book-Id: 1' -H 'Content-Type: application/json'
# → {"success":true,"data":{"reconciled":2,"totalAdjusted":521.5},"message":"已对账，修正 2 个账户余额"}
```

实现在 `server/routes/accounts.js:209`，内部用 `computeAccountBalance` 与 `stored` 比对，
差值 >0.005 就修正。**比手写 UPDATE 更可靠，且走的是生产同一条路径。**

### 5.5 ⛔ 校验余额一致性的 SQL 必须带 `book_id` 过滤

漏掉会看到**假漂移**：id=1「现金」`stored 500` vs `computed 466.51`。
真因是该 `account_id` 在 **book 7 / book 12 下另有 5 条交易**被算了进来。

```sql
LEFT JOIN transactions t ON t.account_id = a.id AND t.book_id = a.book_id   -- 缺这半句就错
```

加上后 `500 = 500`。**多账本项目里，任何按 `account_id` 聚合的核对都要同时约束 `book_id`。**

---

## 六、收尾

```bash
# 停后端（Git Bash 的 taskkill //PID 语法在此环境不生效，用 PowerShell）
# PowerShell: Get-NetTCPConnection -LocalPort 18888 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
```

PG 容器是 `unless-stopped` 常驻，**不用停**。

---

## 七、附带发现（非套件问题）

后端启动日志会有 2 条告警：

```
[crypto] 解密失败（tag 校验未通过）
⚠️ [AI 凭证自检] ai_providers id=1/id=2 user=1 解密失败（密钥可能已变更）
```

`ENCRYPTION_KEY` 与写入时不一致的历史遗留，需去「AI 配置」页重存 API Key。

**不影响冒烟** —— 套件走 `decision_trace.engine = deterministic` 的内置确定性规则解析，不调外部 LLM。
