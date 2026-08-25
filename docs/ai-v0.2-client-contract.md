# AI v0.2 预测闭环 · 三端接入契约

> 适用范围：web（`public/`）、Android（`android/`）、HarmonyOS NEXT（`harmony/`）
> 后端实现：`server/routes/ai.js`（L1390-1553 新路由区）+ `server/modules/ai/`

---

## 1. 核心哲学（不可妥协）

**AI 输出永不直接写账本。**

```
POST /api/ai/transactions/parse   →  产出不可变预测快照（pending）
        ↓  用户在确认卡片里核对 / 修正 / 删行
POST /api/ai/predictions/:id/commit    →  事务内原子落账（committed）
POST /api/ai/predictions/:id/discard   →  弃置（discarded）
```

旧的「AI function calling 直写账本」通道（`POST /api/ai/chat`）**保留不删**，作为
非记账类咨询对话的回退路径。三端跑通、观察期结束后再评估移除。

---

## 2. 状态机（单向不可逆）

```
pending ──commit──▶ committed
   └────discard───▶ discarded
```

| 越界操作 | 后端返回 |
|---|---|
| 对已 committed 的预测 discard | `409` 已提交的预测不能弃置 |
| 对已 discarded 的预测 commit | `409` 该预测已被弃置，无法提交 |
| 对已 committed 的预测用**不同** idempotency_key commit | `409` 该预测已经被提交，且 idempotency_key 不匹配 |
| 对已 committed 的预测用**相同** idempotency_key commit | `200` 幂等返回历史快照，余额不再变动 |

### ⚠️ 客户端判定 stale 必须用 HTTP 状态码

后端有 **3 种不同的 409 文案**，任何字符串匹配都会漏。三端统一：

```js
// web —— utils.js 的 api() 已把 HTTP 码挂到 err.status
if (err.status === 409) { /* 本地状态过期，清空确认卡片 */ }
```
```kotlin
// Android —— ApiResult.Error.code 取自 response.code()
if (r.code == 409) { /* 清空 aiConfirm */ }
```
```typescript
// Harmony —— ApiError.code 取自 resp.responseCode
if (err.code === 409) { this.resetConfirm(); }
```

---

## 3. 字段级置信度裁决

决策字段与阈值（与 `server/modules/ai/validation/result-validator.js` 对齐）：

| 字段 | 阈值 | 参与裁决 |
|---|---|---|
| `amount` | ≥ 0.90 | ✅ |
| `type` | ≥ 0.80 | ✅ |
| `category` | ≥ 0.70 | ✅ |
| `date` | ≥ 0.80 | ✅ |
| `merchant` / `currency` | — | ❌ 仅记录 |

### ⚠️ 禁止前端自行比较阈值

**不要**拿 `overall_confidence` 和任何数字比大小自行判定。一律以后端返回的
`verdict` / `needs_confirmation` / `validation.per_txn[].per_field[field].ok` 为准。
阈值调整是后端行为，前端硬编码会导致三端裁决口径漂移。

`verdict` 三态：

- `invalid` —— 结构非法，禁止提交
- `needs_confirmation` —— 任一决策字段低于阈值
- `ready` —— 全部达标，**仍建议二次确认**（不做自动提交）

多笔场景取保守值：任一笔 needs_confirmation ⇒ 整体 needs_confirmation。

---

## 4. `source` 语义 = 输入通道，不是客户端平台

受数据库约束 `ai_predictions_source_check` 限制，只能取：

```
parse | chat | ocr | voice
```

平台信息放 `context.platform`：

```json
{
  "text": "午饭 28",
  "context": { "platform": "harmony", "account_id": 2, "date": "2026-08-25" },
  "source": "chat"
}
```

传非法值（如 `web_text`）**在入口就返回 400**，附带可读文案
`source 必须是 parse / chat / ocr / voice 之一`。
（此前会一路落到 INSERT 撞 CHECK 约束抛 500，本轮已修复。）

三端实际取值：web = `parse`，Android/Harmony 聊天页 = `chat`，OCR = `ocr`，语音 = `voice`。

---

## 5. 提交语义：confirmed vs corrected

| action | 是否回传 transactions | 后端行为 |
|---|---|---|
| `confirmed` | **不传** | 直接用服务端不可变快照落账 |
| `corrected` | **必须传完整数组** | 以客户端数组落账，并计算 `final_diff` |

客户端据 `isDirty()`（当前候选 vs 原始快照深拷贝）推导 action，不要让用户手选。

### 人工修正标记

用户改过的字段必须：

- `confidence[field] = 1.0`
- `evidence[field] = 'user_corrected'`

这让 `final_diff` 与后续学习信号能区分「模型识别」与「人工已确认」。

### `final_diff` 真实结构（非扁平）

```json
{
  "action": "corrected",
  "corrected_count": 1,
  "diff_items": [
    { "seq": 1, "diff": { "amount": { "from": 28, "to": 33.5 } } }
  ]
}
```

### 幂等键

进入确认态时生成并**固定**（不要每次点提交都重新生成），网络重试不会重复落账。
不传时后端兜底 `pred-${id}`。三端格式：`<platform>-<predictionId>-<timestamp>`。

---

## 6. 候选交易字段约定

```typescript
{
  seq: number;              // 1 起，多笔唯一 —— ForEach/LazyColumn 的 key
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  category_id: number | null;
  category_name: string;    // 已带名字，前端无需按名猜 ID
  account_id: number | null;      // income/expense 用
  from_account_id?: number;       // transfer 用
  to_account_id?: number;         // transfer 用
  date: string;             // 10 字符纯日期 yyyy-MM-dd（不带时间！）
  note: string;
  merchant: string;
  raw_segment: string;      // 原文片段，溯源用
  confidence: { [field]: number };
  evidence: { [field]: string };
}
```

**服务端兜底**：`category_id` / `date` / `note`
**服务端不兜底（客户端必须补全）**：`income`/`expense` 的 `account_id`，
`transfer` 的 `from_account_id` + `to_account_id`

### 三端统一的前置自检（提交前，文案完全一致）

```
第 N 笔金额无效
第 N 笔请选择转出与转入账户
第 N 笔转出与转入账户不能相同
第 N 笔请选择账户
```

在客户端先拦，比让服务端返回 422 更快也更具体。

---

## 7. 三端 HTTP 封装差异（易踩）

| | 返回值 | 错误 | 状态码来源 |
|---|---|---|---|
| web `api()` | `data.data`（已解包） | `throw Error`，带 `.payload` / `.status` | `res.status` |
| Android `safeApiCall` | `ApiResult.Success/Error` | `Error(message, code)` | `response.code()` |
| Harmony `post<T>()` | 完整 `ApiResponse<T>`，需判 `success` | `throw ApiError(message, code)` | `resp.responseCode` |

其他平台差异：

- **Android 端点路径不带前导斜杠**：`@POST("ai/transactions/parse")`，不是 `"/ai/..."`
- **Harmony 用 snake_case 直传**，无序列化注解；ArkTS 严格模式下：
  - 禁止对 interface 做字符串索引访问（`pf[field]`）→ 必须写显式分支
  - `JSON.parse(JSON.stringify(x)) as T[]` 不稳 → 用显式 `cloneTxn/cloneTxns`
  - 账户/分类选择用项目既有的 `DropdownField` 组件，不要自造 `bindMenu`
- **web CSS 语义色**：收入=红、支出=绿（中国习惯）。
  用 `--success-500` / `--warning-500` / `--error-500`，
  且项目用 `color-mix(in srgb, ...)` 而非不存在的 `-soft` 后缀 token

---

## 8. 回退策略（Android / Harmony 聊天页）

聊天页同时承载「记账」与「咨询」两种意图，采用融合策略：

```
纯文本输入 → 先试 POST /ai/transactions/parse
              ├─ 200 → 渲染确认卡片（v0.2 确定性通道）
              └─ 422 → 回退 POST /ai/chat（保留咨询能力）
带图片输入 → 直接走 legacy 多模态 /ai/chat
```

422 判定：`err.code === 422`（Harmony）/ `err.code == 422 || message.contains("未能从文本中识别")`（Android）。

**清空对话时必须同步 discard 未确认预测**，否则快照永久挂在 pending 态。

---

## 9. 交易类型识别（本轮修复）

`server/modules/ai/extraction/type-extractor.js`

原先只有连写关键词（`转账`/`转给`/`转到`/`划转`…），
**「从工商银行转 50 到微信支付」这类分离句式识别不到**，
且会被账户名「微信**支付**」里的「支付」误判成 `expense`。

新增 `TRANSFER_PATTERNS` 分离句式匹配（置信度 0.88，略低于显式关键词 0.95），
在关键词表之前判定：

```js
/从.{1,16}?[转划挪][^。；;]{0,12}?[到去进入]/      // 从 A 转 N 到 B
/[转划挪](?:出|入)?\s*\d[\d,.]*\s*(?:元|块|…)?\s*[到去进入]/i  // 转出 N 到 B
/[转划](?:入|出)\s*[到去进]/                       // A 转出到 B
```

17 条用例回归 16 通过（唯一未过的是「给同事转的饭钱他还我了50」这种混合语义句，
判 expense 也合理，交由用户在确认卡片修正，不做过拟合）。

---

## 10. 验证套件

| 脚本 | 断言数 | 覆盖 |
|---|---|---|
| `server/modules/ai/__tests__/smoke-phase1.mjs` | 38 | 后端闭环：parse/commit/discard/幂等/冲突/参数校验 |
| `server/modules/ai/__tests__/smoke-web-contract.mjs` | 66 | 复刻 web `api()` 语义，8 场景 A~H |
| `server/modules/ai/__tests__/smoke-harmony-contract.mjs` | 62 | 复刻 Harmony `post<T>()` + `ApiError` 语义，9 场景 A~I |

**合计 166 断言，连跑两轮全绿（可重复）。**

运行方式（需先起本地服务）：

```bash
AI_RATE_LIMIT_MAX=500 WRITE_RATE_LIMIT_MAX=2000 node server/index.js &
node server/modules/ai/__tests__/smoke-phase1.mjs
node server/modules/ai/__tests__/smoke-web-contract.mjs
node server/modules/ai/__tests__/smoke-harmony-contract.mjs
```

### 测试脚本的两个坑（已修）

1. **幂等键必须每轮唯一**。硬编码 `smoke-key-001` 会让第二次运行命中上一轮记录，
   后端正确返回历史快照（无 `id`、余额不变），而断言按「首次落账」写 → 假失败。
   改为 `smoke-${RUN_ID}-A`，`RUN_ID = Date.now()-random`。
2. **必须挑余额最充足的账户**。账户余额保护（不得低于 0）是正确的业务行为，
   反复跑测试会耗尽小额账户（如「现金」197.5 → 0），
   取 `accounts[0]` 会撞出与被测逻辑无关的 409。
3. 默认写限流是每分钟 60 次，连跑三套会撞 429。
   本地测试用 `WRITE_RATE_LIMIT_MAX=2000` 放宽（**仅测试环境**）。

Android 端因本机无 JDK / Android SDK 未做编译验证，改为静态符号一致性校验：
13 个 `Ai*` data class 全部被引用、`AiRepository` 方法与 `ChatViewModel` 调用一一对应、
Retrofit 端点无前导斜杠、所用 Compose API 均已在项目其他文件出现（BOM 2024.10.01 兼容）。

---

## 11. 三端改动文件清单

### 后端
- `server/routes/ai.js` —— `source` 白名单入口拦截（400 而非 500）
- `server/modules/ai/extraction/type-extractor.js` —— 新增 `TRANSFER_PATTERNS`

### web
- `public/js/managers/ai-smart-entry.js` —— 新建，v0.2 主模块（~450 行）
- `public/pages/ai-recognition.html` —— 新增「✨ 一句话记账」卡片
- `public/css/components.css` —— `.ai-smart-*` 样式（~160 行）
- `public/js/managers/index.js`、`public/js/app.js` —— 注册与初始化
- `public/js/utils.js` —— `api()` 抛错时挂 `err.status`
- `public/index.html` —— 资源版本号 bump

### Android
- `data/model/Models.kt` —— 13 个 `Ai*` data class
- `data/remote/ApiService.kt` —— 4 个 v0.2 端点
- `data/repository/AiRepository.kt` —— parse/get/commit/discard + 幂等键
- `ui/viewmodel/ChatViewModel.kt` —— `AiConfirmState` + 编辑/提交/弃置 + 422 回退
- `ui/screens/AiConfirmCard.kt` —— 新建，确认卡片（~390 行）
- `ui/screens/ChatScreen.kt` —— 加载分类、注入默认账户、渲染卡片

### Harmony
- `common/models.ts` —— 16 个 `Ai*` interface
- `common/api/Api.ts` —— 4 个 v0.2 函数
- `pages/Chat.ets` —— 263 → 854 行，确认卡片 + 编辑 + 提交/弃置 + 清空时同步弃置

---

## 12. 后续路线

1. 观察期结束后移除 legacy 直写路径（`/ai/chat` 的 function calling 落账分支）
2. Phase 2：Decision Engine + `POST /ai/decide` 接口
3. Phase 3：规则与记忆系统（复用 `user_corrected` 信号做个性化）
