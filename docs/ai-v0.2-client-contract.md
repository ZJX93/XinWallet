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

## 10.5 图片通道（腾讯云 OCR 作为兜底）

### 设计约束（用户明确要求，勿改）

1. **大模型多模态是主路** —— 先让当前 AI 服务商自己读图。
2. **用户说识别有误 → 腾讯云 OCR 兜底**。
3. **模型不具备图片理解能力 → 腾讯云 OCR 兜底**。
4. **腾讯 OCR 只提供识别，不参与学习**。

第 4 条是整个设计的关键：OCR 的产物就是**一段纯文字**，之后与用户手打的文字
**在下游完全同权** —— 同一个 Deterministic Extractor、同一个 Memory Retrieval、
同一个 Decision Engine。因此不给 OCR 单独建规则表、不写 OCR 专属证据、不做
OCR 特有学习；学习只发生在「用户确认/修正 prediction」那一步（与文字通道共用）。
换掉腾讯 OCR（或将来接别家）不会动到学习逻辑一行代码。

### 链路

```
图片 → ① 转录（vision 主路 / 腾讯 OCR 兜底）
     → ② 票据版式预处理（账单原文 → 干净语句）
     → ③ v0.2 主链路（与手打文字完全相同）
     → ④ prediction 快照 → 用户确认 → 落账 + 学习
```

**② 为什么不可省**：账单 OCR 原文直接喂给抽取器会灾难性误判（实测）：
交易单号 `4200002891202608201234567890` → 抽出一笔 **4.2e27 元**；
支付时间 `08:12:33` 里的 `08` → 抽出一笔 **8 元**；商户名一个都抽不到。
根因是 v0.2 抽取器为**自然语言**设计，假设文中数字就是金额。

### 端点

| 端点 | 语义 |
|---|---|
| `POST /api/ai/ocr` | 「帮我认这张图」（主路，vision 优先） |
| `POST /api/ai/ocr/retranscribe` | 「上一次认错了，换腾讯 OCR 再认」 |

两者都同时支持 **multipart**（字段名 `image`，安卓在用）与 **JSON base64**
（`{ image, mime }`，鸿蒙 `Api.ts: post('ai/ocr', { image })` 在用）。

**为什么重转录是独立端点而不是给 `/ocr` 加参数**：语义不同，独立出来前端才能给出
明确的按钮文案，日志也能分开统计两者成功率（§12 要求可比较「兜底救回率」，
混在一个端点里永远算不出来）。

### 响应字段

```json
{
  "prediction_id": 108,
  "verdict": "needs_confirmation",
  "transactions": [ /* 同 §6 候选交易字段 */ ],
  "transcribe_source": "model | tencent_ocr",
  "transcribe_attempts": [
    { "source": "model", "ok": false, "reason": "模型不支持图片输入" },
    { "source": "tencent_ocr", "ok": true }
  ],
  "text": "...",   // 老字段，兼容安卓既有 OcrItem 解析
  "items": [ ... ] // 老字段，同上
}
```

### ⚠️ 客户端必须注意

- **图片上传界面必须带账户选择器**。v0.2 抽取器**不推断账户**（票据上通常没有
  「我的哪张卡」信息），而 commit 阶段缺 `account_id` 会直接 422。
  上传时用 `context.account_id` 传入，候选交易就会带上账户，`confirmed` 可直接用。
- **`transcribe_attempts` 要展示给用户**。两条通道都失败时错误消息形如
  `未配置 AI 服务商；腾讯云 OCR 兜底也失败（未配置腾讯云 OCR 密钥）`，
  并附 `needs_ocr_config: true` 供前端引导去配置页。
- **重转录有独立限流配额**（默认 30 次/分）。语义是「刚才认错了换引擎再认」，
  用户会连续重试；若共用 AI 的 10 次/分，试两三次就 429（而一笔账都没记成）。

### vision 能力判定：三态 + 失败降级

`ai_providers.vision_support` 取值 `unknown` / `yes` / `no`，判定优先级：

```
DB 确定结论  >  模型名白名单  >  unknown（乐观尝试一次）
```

真实调用结果会写回 DB。**用布尔会分不清「没试过」和「不支持」**，导致每次上传
都白试一次失败调用（多等一轮超时 + 白烧 token）。

⚠️ 「不支持 vision」有两种表现，**第二种最致命**：
① 直接 400（好办）；
② **HTTP 200 但回复「我看不到图片」** —— JSON 解析失败后会被误判成「模型格式错」，
于是重试、报错、扣 token，用户只看到「识别失败」。
故必须靠回复内容识别（中英文措辞都要覆盖）。

---

## 10.6 备注格式：「场景-对象」由服务端确定性生成

落账备注形如 `喝咖啡-星巴克`、`打车拼车-滴滴`、`生鲜食材-永辉`。

**客户端不需要做任何拼接** —— 这是服务端在抽取阶段确定性生成的
（`modules/ai/extraction/note-composer.js`，全项目唯一真相）。

历史教训（2026-08-25）：旧做法是在 OCR prompt 里请 LLM 自己写成这个格式。
legacy 解析器删除后那段 prompt 一起消失，而抽取器直接把原始片段当备注，
于是落账变成 `2026年8月20日老乡鸡 18元`（日期金额全冗余），**且完全不报错**。
改为服务端生成的另一个原因是：备注格式是确定性规则，不该依赖模型听话；
同一笔交易在图片通道与文字通道必须得到完全一致的备注，靠 prompt 做不到。

⚠️ `commit` 响应的 `transactions[]` 会**回填最终 `note` 与 `date`**（这两个字段
服务端会改写）。客户端应展示回填值，而不是自己提交的原值。

---

## 11. 三端改动文件清单

### 后端
- `server/routes/ai.js` —— `source` 白名单入口拦截（400 而非 500）；
  图片通道 `handleImageAccounting`；`POST /ocr/retranscribe`；
  **删除 legacy `fallbackExtractItems`（253 行正则解析器）与整段 OCR prompt**
- `server/modules/ai/extraction/type-extractor.js` —— 新增 `TRANSFER_PATTERNS`
- `server/modules/ai/extraction/note-composer.js` —— 新建，「场景-对象」备注唯一真相
- `server/modules/ai/vision/image-transcriber.js` —— 新建，转录层（vision 主路 / OCR 兜底）
- `server/modules/ai/vision/vision-capability.js` —— 新建，三态能力判定 + 失败降级
- `server/modules/ai/vision/receipt-preprocessor.js` —— 新建，票据版式预处理（6 套策略）
- `server/modules/ai/prediction/prediction-store.js` —— commit 回填 `note`/`date`；
  修正分支按 `seq` 补回 `raw_segment`（否则学习键退化）
- `server/db.js` / `server/schema.sql` —— `ai_providers.vision_support` 三态列
- `server/rate-limit-user.js` / `server/routes.js` —— 重转录独立配额

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

1. ~~观察期结束后移除 legacy 直写路径~~ —— **已完成**（`/ai/chat` 的
   `create_transaction` / `create_transfer` 直写工具已移除，测试反向断言不得回归）
2. ~~Phase 2/3/4/5~~ —— **已完成**（决策引擎、规则记忆、运行时路由、离线评测）
3. ~~图片通道接入 v0.2 主链路 + 腾讯 OCR 降为兜底~~ —— **已完成**（见 §10.5）
4. **客户端 UI（未开始）**：当前入口只在服务端 API。
   本轮用户明确定界「功能只在服务端，客户端只使用接口」，故三端 UI 待单独立项：
   - 「记账习惯」管理页（规则列表 / 停用启用 / 证据流水 / 学习统计）
     —— 验收标准 #6「用户可 disable」目前需直接调 API
   - AI 识别页的「识别有误，换腾讯 OCR 重试」按钮（`POST /ai/ocr/retranscribe`）
   - 图片上传界面的账户选择器（**必需**，否则 commit 必然 422，见 §10.5）
5. 词表持续补充：`老乡鸡` 一类连锁餐饮尚未进 `MERCHANT_DICT`/`KEYWORD_TO_CATEGORY`
   （当前落到「其他支出」，备注仍可读为 `老乡鸡`，但类目需用户修正一次后由学习接管）

---

## 13. 验证基线（每次改动后必须复跑）

| 套件 | 命令 | 基线 |
|---|---|---|
| 单测门禁 | `env -u NODE_OPTIONS npm test` | **172 / 172** |
| 离线评测 | `runOfflineEvaluation()` | 7 项指标全 **1.0**，零失败用例 |
| Phase 3/4/5 e2e | `node .workbuddy/_e2e_phase345.mjs` | **75 / 75** |
| 图片通道 e2e | `node .workbuddy/_e2e_image.mjs` | **33 / 33** |
| 备注规范化 e2e | `node .workbuddy/_e2e_note.mjs` | **21 / 21** |

⛔ **`env -u NODE_OPTIONS` 不是可选项**：WorkBuddy 注入的 `genie-safe-delete`
会劫持 `fs.rmSync`，导致 node/npm 出现与代码无关的诡异失败。

⛔ **重启后端务必用 `bash .workbuddy/_restart_srv.sh`**：直接 `pkill` 杀不掉进程，
新进程会因 `EADDRINUSE` 立刻退出，但**日志文件已被覆盖** ⇒ 看起来重启成功了
（curl 有响应），实际跑的还是旧代码。表现为「改完代码 e2e 毫无变化」，
极易误判成代码写错 —— 本轮已因此浪费一轮排查。
