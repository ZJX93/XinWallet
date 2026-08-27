# HarmonyOS 端深度走读（analysis_05_harmony.md）

> 范围：`harmony/entry/src/main/`（33 ets + 若干 ts）。引用来自子代理实际读取。

---

## 1. 整体架构
ArkUI 声明式 + 类 MVVM 分层。页面（pages/）经 `service/` 层调后端 API，与 Android 端功能完全对齐（29 页 ↔ Android 30+ 屏）。

## 2. 页面 `pages/`（29 个 .ets）
| 页面 | 说明 |
|------|------|
| `Home.ets` | 首页汇总 |
| `AddTransaction.ets` | 交易录入（含 AI） |
| `Transactions.ets` `Accounts.ets` `Category.ets` `Tags.ets` | 交易/账户/分类/标签 |
| `Reports.ets`(50KB) | 报表图表（最大） |
| `Investments.ets` `InvestmentDetail.ets` `InvestmentTransactions.ets` | 投资理财 |
| `Debts.ets` `SavingsGoals.ets` `Budgets.ets` `Planning.ets` | 债务/攒钱/预算/规划 |
| `Chat.ets` | AI 对话记账 |
| `Advice.ets` | AI 建议 |
| `ProviderList.ets` `ProviderEdit.ets` `RuleList.ets` | AI 供应商/规则 |
| `Evaluation.ets` `LearningStats.ets` | AI 评测/学习统计 |
| `Login.ets` `AppLock.ets` `Profile.ets` `Settings.ets` `DataManagement.ets` `Search.ets` `AccountDetail.ets` `Main.ets` | 账户/锁/设置/搜索/根 |

每个 `@Entry` struct 含 `build()`，声明式 UI；状态用 `@State`/`@Link`/`@Prop`；网络请求经 `service/` 封装 `http` 模块，携带 `X-Book-Id` + JWT。

## 3. 通用组件 `common/components/`
- `Charts.ets`：图表封装。
- `CalendarCell.ets`：日历单元格。
- `Components.ets`(58KB)：通用卡片/表单/弹窗。
- `PeriodPickerSheet.ets`：周期选择器（对接报表周期，对应 Web `report.js` 周期逻辑）。

## 4. 其他目录
- `model/`：数据实体（与后端 schema 对应）。
- `service/`：网络层（API 端点封装，对应后端 26 路由）。
- `utils/`：金额格式化、日期、存储。
- `theme/`：玻璃拟态 + 莫兰迪主题常量（与 Web/Android 视觉一致）。
- `viewmodel/`（如有）：状态管理。
- `resources/`：中英双语字符串/布局/图片。

## 5. 与 Android 端对应关系
| 功能 | Android (kt) | Harmony (ets) |
|------|--------------|---------------|
| 首页 | HomeScreen | Home |
| 记账 | AddTransactionScreen | AddTransaction |
| 报表 | ReportsScreen | Reports |
| AI对话 | ChatScreen | Chat |
| 投资 | InvestmentsScreen | Investments |
| 供应商 | ProviderListScreen | ProviderList |
| 规则 | RuleListScreen | RuleList |
| 评测 | EvaluationScreen | Evaluation |

三端共享同一后端 API 契约（`X-Book-Id` 账本隔离 + JWT）。
