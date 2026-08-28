# AI 子系统深度走读（analysis_02_ai.md）

> 范围：`server/modules/ai/` 全部 46 个文件。引用来自实际 `read_file`。
> 主线：**自然语言/图片 → 结构化交易（prediction 草稿）→ 用户确认 → 落账 → 异步学习**。

---

## 0. 桶文件 `index.js`（分层防火墙）

L1-10 明确纪律：`routes/ai.js` 只依赖本文件，不得直接 require 子目录。L12-60 集中导出全链路入口：`parseTransactions/loadContext/parseOffline`、`createPrediction/commitPrediction`、`validateResult`、`composeNote`、`evidence-engine` 规则演化、`model-router`/`cost-tracker`/`complexity-analyzer`、`evaluation/runner`、`insight-engine`、`conversation/message/profile` 服务、`tool-registry`、图片通道 `transcribeImage/looksLikeReceipt/preprocessReceipt`。

```12:18:server/modules/ai/index.js
const { parseTransactions, loadContext, parseOffline, PREDICTION_VERSION } =
    require('./parser/transaction-parser');
const { createPrediction, getPrediction, commitPrediction, discardPrediction } =
    require('./prediction/prediction-store');
const { validateResult, FIELD_THRESHOLDS } = require('./validation/result-validator');
const { extractTransactions } = require('./extraction/deterministic-extractor');
```

## 1. Parser 编排层

### 1.1 `parser/transaction-parser.js`（心脏，L1-21 铁律）
- 不写库（写库是 `prediction-store` 职责）。
- 不直接 require `services/ai`（模型调用一律经 `provider-gateway`）。
- 任何增强层（记忆/模型）失败都**降级而非报错**：记账是刚需，退回纯确定性 + `needs_confirmation`。

`parseTransactions`（L65+）严格按序编排：
1. `buildContext`（L67）
2. 第一遍 `extractTransactions`（L76-82，商家名是记忆检索主键）
3. `retrieveMemory`（L87-93，失败→`emptyMemory()` 降级）
4. 第二遍带历史商家词典重跑（L95-110，`mergedMerchants` 合并票据 hints 与历史，**绝不二选一**）
5. `decide`（L113 决策引擎融合）
6. `analyzeComplexity` + `route`（L116-120 复杂度→模型路由）
7. 仅当 `cheap_model`/`strong_model` 路由时 `reviewWithModel` 复核（L143-166：模型只做修正，修正字段给 0.86，仍需确认）

`loadContext`（L38-46）兼容旧签名；`parseOffline`（L233+）不查库不调模型，供 CI 评测。

### 1.2 `parser/decision-engine.js`（统一决策/证据融合）
L8-16 优先级链：**手工规则 > trusted 学习规则 > verified 习惯证据 > 历史候选 > LLM**。三条铁律：经 Result Validator；冲突保留不确定性；类目 id 只能来自真实 categories 表（孤儿规则丢弃，否则 commit 422）。

`decide`（L37+）：类目融合（L58-80）要求记忆候选 `confidence > 当前 + OVERRIDE_MARGIN(0.001)` 或当前为 fallback(0.35) 才覆盖；账户融合（L82+）**绝不覆盖用户显式选择**。

### 1.3 `parser/decision-policy.js` / `parser/context-builder.js`
`decision-policy.js` 决定最终 `needs_confirmation` 阈值；`context-builder.js` 组装 categories/accounts/wm(working memory 锚点：accountId/bookId/refDate)。

## 2. Extraction（9 个确定性抽取器）
`deterministic-extractor.js`（L5.68KB）是**离线兜底核心**，`extractTransactions` 用正则从原文抽取 amount/type/merchant/date/category。各字段抽取器：`amount-extractor` `currency-extractor` `date-extractor` `merchant-extractor`（user_history 分支 0.96 置信，最强商家信号）`type-extractor` `category-matcher`(14.84KB 最大抽取器) `note-composer`(场景-对象备注，服务端唯一真相) `transaction-splitter`(多笔拆分)。

## 3. Intent / Providers / Runtime
- `intent/intent-router.js`：意图路由（记账/查询/分析/闲聊）。
- `providers/provider-gateway.js`（L1-52）：**唯一**允许触碰 `services/ai` 之处。`resolveProvider` 永不抛异常（取不到→null→route='local'，规则与历史照常生效）；`reviewWithModel`（L69+）契约：成功/失败都不抛、不写库。`isModelRouteAllowed`（L19-22）默认关闭模型路由（本地准确率足够）。
- `runtime/model-router.js`：复杂度→模型档位 + 熔断 `breakerStates/resetBreakers`。
- `runtime/cost-tracker.js`：`usageMetrics` 计量。
- `runtime/complexity-analyzer.js`：`analyzeComplexity`。

## 4. Memory（三层记忆）
`working-memory.js`(锚点) `episodic-memory.js`(单次交互) `semantic-memory.js`(长期偏好，`upsertMemoryItem`) `memory-retrieval.js`(检索) `memory-retrieval-chat.js` `keys.js`(归一化键，`normalizeKey/isUsefulKey/chunkKeys` —— 读写侧必须用同一份，否则学习命中失效)。

## 5. Learning（越用越聪明）
`learning/evidence-engine.js`（L1-43 修复 2026-08-25 历史缺陷：feedback event 之前只进不出）：
- `learnableKey`（L30-43）：优先商家，退回 raw_segment（**非 note**，否则无商家交易共用同一键污染规则）。
- `learnFromCommit`（L60+）：commit 后异步、幂等、try/catch 吞异常；调用 `markRuleHit` + `applyEvidence` + `upsertMemoryItem`。

`learning/evidence-scheduler.js`：异步调度规则更新。

## 6. Rules / Prediction / Validation
- `rules/rule-store.js`(14.34KB)：`applyEvidence/markRuleHit/EVIDENCE_WEIGHTS/STATUS_THRESHOLDS/HALF_LIFE_DAYS/listRules/ruleEvidenceTrail`（半衰期衰减置信）。
- `prediction/prediction-store.js`(22.44KB 最大)：`createPrediction/getPrediction/commitPrediction/discardPrediction` 快照落库。
- `validation/result-validator.js`：`validateResult` + `FIELD_THRESHOLDS`（字段必填/置信阈值）。

## 7. Services / Tools / Vision / Evaluation / Events / Features / Context
- `services/`：`insight-engine.js`(18KB 洞察) `forecast-service.js`(14.57KB 预测) `conversation/message/profile-service`。
- `tools/finance-tools.js`：AI 对话只读分析工具（债务/预算/理财/储蓄/财务全景，带 user_id+book_id 隔离，经桶文件导出供 chat.js 调用）。
  （2026-08-29 已删除零消费的 `tool-registry.js` / `intent-router.js` / `context-planner.js` / `memory-retrieval-chat.js` —— 它们与 schema 不符、require 路径错误、从未被任何路由调用。）
- `vision/`：`receipt-preprocessor.js`(17.33KB 票据版式预处理，产出 `merchant_hints` 喂给 parser) `image-transcriber.js`(12.38KB 图像转写) `vision-capability.js`(能力探测降级)。
- `evaluation/`：`dataset.js`(16.56KB) `runner.js`(12.83KB，`runOfflineEvaluation/compareWithBaseline`)。
- `events/`：`event-bus.js` `event-handlers.js`（内部事件解耦）。
- `features/`：`feature-flags.js` `metrics-cleanup.js`。

## 8. 完整调用链
```
用户输入(文本/图片)
  ├─ 图片 → vision/receipt-preprocessor → merchant_hints
  └─ 文本 ┐
          └→ parser/transaction-parser.parseTransactions
               ├→ context-builder（categories/accounts/wm）
               ├→ extraction/deterministic-extractor ×2（两遍，商家词典）
               ├→ memory/memory-retrieval（personalized merchants/candidates）
               ├→ parser/decision-engine.decide（规则>证据>历史>LLM 融合）
               ├→ runtime/complexity-analyzer + model-router
               ├→ providers/provider-gateway.reviewWithModel（可选复核）
               ├→ validation/result-validator
               └→ prediction/prediction-store.createPrediction（草稿）
           ↓ 用户确认
       commitPrediction（落账 transactions）
           ↓ 异步
       learning/evidence-engine.learnFromCommit
           ├→ rules/rule-store.applyEvidence（规则演化）
           └→ memory/semantic-memory.upsertMemoryItem（长期偏好）
```
