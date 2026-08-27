# Android 端深度走读（analysis_04_android.md）

> 范围：`android/app/src/main/java/com/xinwallet/app/`（90 个 Kotlin）。引用来自实际 `read_file`。
> 架构：**MVVM + 手动 DI**，Repository 与后端 26 路由严格一一对应。

---

## 1. 入口与依赖注入
- `XWalletApplication.kt`：Application，初始化 DI 容器。
- `di/AppContainer.kt`：手动组装 Retrofit/Repository/ViewModel。
- `MainActivity.kt`：单 Activity + Compose 宿主。
- `ui/AppRoot.kt`：根 Composable。
- `navigation/AppNav.kt`：导航图（全部页面路由）。

## 2. 数据层

### 2.1 `data/model/Models.kt`
全部数据实体：`User/Book/Account/Transaction/Category/Investment/Debt/SavingsGoal/Tag/Budget` 及 AI 系（`AiProvider/AiMessage/AiFeedbackEvent/AiRule/AiPrediction` 等），与后端 schema 一一对应。

### 2.2 `data/remote/ApiService.kt`（Retrofit 接口，对应后端路由）
定义全部端点。鉴权组（L13-30）：

```13:30:android/app/src/main/java/com/xinwallet/app/data/remote/ApiService.kt
@POST("auth/login")
suspend fun login(@Body req: LoginRequest): Response<ApiResponse<AuthResponse>>
@POST("auth/refresh")
suspend fun refresh(@Body req: RefreshRequest): Response<ApiResponse<AuthResponse>>
@POST("auth/demo")
suspend fun demoLogin(): Response<ApiResponse<AuthResponse>>
@GET("auth/config")
suspend fun authConfig(): Response<ApiResponse<AuthConfigResponse>>
@GET("auth/profile")
suspend fun profile(): Response<ApiResponse<UserWrapper>>
@PUT("auth/profile")
suspend fun updateProfile(@Body req: UpdateProfileRequest): Response<ApiResponse<UserWrapper>>
```

账户组（L32-50）、交易组（L52-68，`getTransactions` 含 `@Header("X-Book-Id") bookId: Int?` —— null 时 `AuthInterceptor` 自动注入当前账本，非 null 临时覆盖）：

```53:68:android/app/src/main/java/com/xinwallet/app/data/remote/ApiService.kt
@GET("transactions")
suspend fun getTransactions(
    @Query("month") month: String? = null,
    @Query("type") type: String? = null,
    @Query("account_id") accountId: Int? = null,
    @Query("search") search: String? = null,
    ...
    @Query("limit") limit: Int = 50,
    @Header("X-Book-Id") bookId: Int? = null  // null→注入当前账本；非null→搜索页临时覆盖
): Response<ApiResponse<List<TransactionItem>>>
```

- `AuthInterceptor.kt`：注入 JWT + `X-Book-Id`（读 `SessionManager`）。
- `ApiResult.kt`：统一 `ApiResponse<T>` 封套（code/message/data）。

### 2.3 `data/local/`
- `SessionManager.kt`：登录态/Token 持久化。
- `CredentialStore.kt`：加密凭据（对接后端 `crypto`）。

### 2.4 `data/repository/`（约 18 个，与后端路由对应）
`TransactionRepository` `AccountRepository` `CategoryRepository` `InvestmentRepository` `DebtRepository` `SavingsRepository` `BudgetRepository` `BookRepository` `AuthRepository` `UserRepository` `StatisticsRepository` `AiRepository` `ChatRepository` `ProviderRepository` `FeedbackRepository` `EvaluationRepository` `UpdateRepository`(自更新) `ApkVerifier`(签名校验) —— 每个封装对应 ApiService 方法，供 ViewModel 调用。

## 3. UI 层

### 3.1 `ui/screens/`（30+ Compose 页面，核心文件）
| 页面 | 行数 | 说明 |
|------|------|------|
| `AddTransactionScreen.kt` | 79KB | 交易录入（含 AI 智能填单） |
| `ReportsScreen.kt` | 62KB | 报表/图表 |
| `ChatScreen.kt` | — | AI 对话记账 |
| `HomeScreen.kt` `TransactionsScreen.kt` `AccountsScreen.kt` `InvestmentsScreen.kt` `DebtsScreen.kt` `SavingsScreen.kt` `BudgetsScreen.kt` | — | 各业务主页 |
| `AiConfirmCard.kt` `ProviderListScreen.kt` `RuleListScreen.kt` `EvaluationScreen.kt` `LearningStatsScreen.kt` | — | AI 子系统前端 |
| `LoginScreen.kt` `AppLockScreen.kt` `SettingsScreen.kt` `ProfileScreen.kt` `DataManagementScreen.kt` | — | 账户/锁/设置 |

### 3.2 `ui/viewmodel/`（约 22 个）
每个屏幕配 ViewModel，持有 Repository，暴露 `StateFlow`/`LiveData`（如 `ChatViewModel` 持有 `ChatRepository`，对接 AI 子系统）。

### 3.3 `ui/components/`
- `Charts.kt`：图表 Composable（饼/柱/趋势）。
- `Components.kt`：通用卡片/弹窗/表单。
- `CalendarCell.kt`：日历单元格。

### 3.4 `ui/theme/`
`Color.kt` `Glass.kt` `Theme.kt` `Type.kt`：玻璃拟态 + 莫兰迪主题（与 Web/CSS 视觉一致）。

### 3.5 `util/`
`HashUtil.kt`(签名校验) `ImageUtils.kt` `MoneyUtils.kt`(金额格式化)。

## 4. AI 对接链路
```
ChatScreen.kt (UI)
  → ChatViewModel (StateFlow)
  → ChatRepository / AiRepository
  → ApiService.POST("/api/ai/chat")
  → 后端 routes/ai.js → modules/ai（同 analysis_02_ai.md 链路）
  → AiConfirmCard 展示 prediction 草稿 → 用户确认 → commit
```
