package com.xinwallet.app.data.remote

import com.xinwallet.app.data.model.*
import com.xinwallet.app.data.model.Tag
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    /* 鉴权 */
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

    /* 账户 */
    @GET("accounts")
    suspend fun getAccounts(@Query("all") all: Boolean? = null): Response<ApiResponse<AccountsResponse>>

    @POST("accounts")
    suspend fun createAccount(@Body req: CreateAccountRequest): Response<ApiResponse<IdResponse>>

    @PUT("accounts/{id}")
    suspend fun updateAccount(@Path("id") id: Int, @Body req: UpdateAccountRequest): Response<ApiResponse<Unit>>

    @POST("accounts/{id}/close")
    suspend fun closeAccount(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @DELETE("accounts/{id}")
    suspend fun deleteAccount(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /** 记利息：入账一笔利息，返回最新余额与计息日期 */
    @POST("accounts/{id}/interest")
    suspend fun addAccountInterest(@Path("id") id: Int, @Body req: AddAccountInterestRequest): Response<ApiResponse<AddAccountInterestResult>>

    /* 交易 */
    @GET("transactions")
    suspend fun getTransactions(
        @Query("month") month: String? = null,
        @Query("type") type: String? = null,
        @Query("account_id") accountId: Int? = null,
        @Query("search") search: String? = null,
        @Query("start_date") startDate: String? = null,
        @Query("end_date") endDate: String? = null,
        @Query("min_amount") minAmount: Double? = null,
        @Query("max_amount") maxAmount: Double? = null,
        @Query("types") types: String? = null,
        @Query("limit") limit: Int = 50,
        // 账本筛选：传具体账本 id 时临时覆盖全局 X-Book-Id（搜索页选账本用）；
        // 传 null 时 Retrofit 不发送该 header，AuthInterceptor 自动注入当前账本。
        @Header("X-Book-Id") bookId: Int? = null
    ): Response<ApiResponse<List<TransactionItem>>>

    @POST("transactions")
    suspend fun createTransaction(@Body req: CreateTransactionRequest): Response<ApiResponse<IdResponse>>

    @PUT("transactions/{id}")
    suspend fun updateTransaction(@Path("id") id: Int, @Body req: UpdateTransactionRequest): Response<ApiResponse<Unit>>

    @DELETE("transactions/{id}")
    suspend fun deleteTransaction(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /** 有交易记录的月份列表（倒序 YYYY-MM） */
    @GET("transactions/months")
    suspend fun getTransactionMonths(): Response<ApiResponse<List<String>>>

    /** 指定月份的收支汇总与分类占比 */
    @GET("transactions/summary")
    suspend fun getTransactionSummary(@Query("month") month: String): Response<ApiResponse<TxSummary>>

    /* 转账 */
    @GET("transfers")
    suspend fun getTransfers(@Query("month") month: String? = null): Response<ApiResponse<List<Transfer>>>

    @POST("transfers")
    suspend fun createTransfer(@Body req: CreateTransferRequest): Response<ApiResponse<IdResponse>>

    /**
     * 修改转账。**折叠后的转账记录必须走这里，不能走 updateTransaction。**
     *
     * 列表里一笔转账只显示一条（服务端 SQL 折叠），但那条记录的 id 只是
     * 两条腿中的一条。拿它去 transactions/{id} 只会改单条腿 ——
     * 金额从 100 改成 200 时，转出账户扣了 200 而转入账户还是加 100。
     *
     * 服务端是**全量替换**语义：先删掉该 transfer_id 的所有腿再重建两条，
     * 并重算涉及账户余额。所以 req 必须回填完整字段，note 漏传会被清空。
     * 复用 CreateTransferRequest —— 服务端 PUT/POST 入参字段完全一致。
     */
    @PUT("transfers/{id}")
    suspend fun updateTransfer(@Path("id") id: Int, @Body req: CreateTransferRequest): Response<ApiResponse<Unit>>

    @DELETE("transfers/{id}")
    suspend fun deleteTransfer(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /* 分类 */
    @GET("categories?flat=1")
    suspend fun getCategories(): Response<ApiResponse<List<Category>>>

    @POST("categories")
    suspend fun createCategory(@Body req: CreateCategoryRequest): Response<ApiResponse<IdResponse>>

    @PUT("categories/{id}")
    suspend fun updateCategory(@Path("id") id: Int, @Body req: UpdateCategoryRequest): Response<ApiResponse<Unit>>

    @DELETE("categories/{id}")
    suspend fun deleteCategory(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /* 理财 */
    @GET("investment-types")
    suspend fun getInvestmentTypes(): Response<ApiResponse<List<InvestmentType>>>

    @GET("investments/investments")
    suspend fun getInvestments(@Query("includeSold") includeSold: Boolean = false): Response<ApiResponse<InvestmentsResponse>>

    @POST("investments/investments")
    suspend fun createInvestment(@Body req: CreateInvestmentRequest): Response<ApiResponse<IdResponse>>

    @PUT("investments/investments/{id}")
    suspend fun updateInvestment(@Path("id") id: Int, @Body req: UpdateInvestmentRequest): Response<ApiResponse<Unit>>

    @DELETE("investments/investments/{id}")
    suspend fun deleteInvestment(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @GET("investments/investments/{id}/transactions")
    suspend fun getInvestmentTransactions(@Path("id") id: Int): Response<ApiResponse<List<InvestmentTransaction>>>

    @DELETE("investments/investments/{investmentId}/transactions/{txnId}")
    suspend fun deleteInvestmentTransaction(
        @Path("investmentId") investmentId: Int,
        @Path("txnId") txnId: Int
    ): Response<ApiResponse<Unit>>

    /** 编辑理财流水（买入/卖出/分红/利息/红利再投）。服务端 PUT /investments/:id/transactions/:txnId */
    @PUT("investments/investments/{id}/transactions/{txnId}")
    suspend fun updateInvestmentTransaction(
        @Path("id") id: Int,
        @Path("txnId") txnId: Int,
        @Body req: com.xinwallet.app.data.model.UpdateInvestmentTxnRequest
    ): Response<ApiResponse<Unit>>

    /** 新增理财流水（买入/卖出/分红/利息/红利再投） */
    @POST("investments/investments/{id}/transactions")
    suspend fun addInvestmentTransaction(
        @Path("id") id: Int,
        @Body req: com.xinwallet.app.data.model.AddInvestmentTxnRequest
    ): Response<ApiResponse<Unit>>

    /** 加仓 / 减仓（自动更新持仓成本与数量） */
    @POST("investments/investments/{id}/reduce")
    suspend fun reduceInvestment(
        @Path("id") id: Int,
        @Body req: com.xinwallet.app.data.model.ReduceInvestmentRequest
    ): Response<ApiResponse<Unit>>

    /** 清仓（按清仓价回款、标记已清仓） */
    @PUT("investments/investments/{id}/sell")
    suspend fun sellInvestment(
        @Path("id") id: Int,
        @Body req: com.xinwallet.app.data.model.SellInvestmentRequest
    ): Response<ApiResponse<Unit>>

    /* 仪表盘 */
    @GET("stats/dashboard")
    suspend fun getDashboard(): Response<ApiResponse<Dashboard>>

    /** 首页日历视图：返回某月每日 {date, income, expense, hasRecord} + monthSummary */
    @GET("stats/calendar")
    suspend fun getStatsCalendar(
        @Query("year") year: Int,
        @Query("month") month: Int
    ): Response<ApiResponse<CalendarSummary>>

    /* AI 智能记账 */
    /**
     * 上传账单图片做 OCR + 交易项提取，multipart 字段名必须是 image（后端 multer 约定）。
     * account_id 必传（v0.2 抽取器不推断账户，快照缺它 commit 阶段 422）；
     * platform 是埋点字段（后端 context.platform，缺省 'unknown'）。
     */
    @Multipart
    @POST("ai/ocr")
    suspend fun ocr(
        @Part image: MultipartBody.Part,
        @Part("account_id") accountId: RequestBody? = null,
        @Part("platform") platform: RequestBody? = null
    ): Response<ApiResponse<OcrResponse>>

    /** AI 对话记账：文字 / 截图多模态，后端用 function calling 真正建账 */
    @POST("ai/chat")
    suspend fun chat(@Body req: ChatRequest): Response<ApiResponse<ChatResponse>>

    /** 语音转文字（云端回退）：audio 为 base64 */
    @POST("ai/transcribe")
    suspend fun transcribe(@Body req: TranscribeRequest): Response<ApiResponse<TranscribeResponse>>

    /* AI v0.2 预测闭环：parse → 用户确认 → commit（AI 输出永不直接写账本） */

    /** 自然语言 → 候选交易 + 字段级置信度裁决 + 不可变预测快照；不落账 */
    @POST("ai/transactions/parse")
    suspend fun parseTransactions(
        @Body req: AiParseRequest,
        /** dev-only mock 短路：传 "1" 让服务端返回固定样例（无需 AI provider），用于 UI 自测 chip 化卡片 */
        @Query("mock") mock: String? = null
    ): Response<ApiResponse<AiParseResponse>>

    /** 读取预测快照（含 validation 字段级裁决明细，用于确认界面高亮） */
    @GET("ai/predictions/{id}")
    suspend fun getPrediction(@Path("id") id: Int): Response<ApiResponse<AiPredictionSnapshot>>

    /** 原子提交：事务内落账 + 状态更新 + 反馈事件；支持幂等重放 */
    @POST("ai/predictions/{id}/commit")
    suspend fun commitPrediction(
        @Path("id") id: Int,
        @Body req: AiCommitRequest
    ): Response<ApiResponse<AiCommitResponse>>

    /** 弃置预测：仅记录事件，不形成负向学习 */
    @POST("ai/predictions/{id}/discard")
    suspend fun discardPrediction(
        @Path("id") id: Int,
        @Body req: AiDiscardRequest
    ): Response<ApiResponse<AiSimpleMessage>>

    /* 预算 */
    @GET("budgets")
    suspend fun getBudgets(): Response<ApiResponse<List<Budget>>>

    @POST("budgets")
    suspend fun createBudget(@Body req: CreateBudgetRequest): Response<ApiResponse<IdResponse>>

    @PUT("budgets/{id}")
    suspend fun updateBudget(@Path("id") id: Int, @Body req: UpdateBudgetRequest): Response<ApiResponse<Unit>>

    @DELETE("budgets/{id}")
    suspend fun deleteBudget(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /* 储蓄目标 */
    @GET("savings-goals")
    suspend fun getSavingsGoals(): Response<ApiResponse<List<SavingGoal>>>

    @POST("savings-goals")
    suspend fun createSavingsGoal(@Body req: CreateSavingGoalRequest): Response<ApiResponse<IdResponse>>

    @PUT("savings-goals/{id}")
    suspend fun updateSavingsGoal(@Path("id") id: Int, @Body req: UpdateSavingGoalRequest): Response<ApiResponse<Unit>>

    @DELETE("savings-goals/{id}")
    suspend fun deleteSavingsGoal(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /** 存入：从来源账户转账到目标关联的储蓄账户 */
    @POST("savings-goals/{id}/allocate")
    suspend fun allocateSavings(@Path("id") id: Int, @Body req: SavingsAllocateRequest): Response<ApiResponse<Unit>>

    /** 取回：从目标关联的储蓄账户转账到目标账户 */
    @POST("savings-goals/{id}/withdraw")
    suspend fun withdrawSavings(@Path("id") id: Int, @Body req: SavingsWithdrawRequest): Response<ApiResponse<Unit>>

    @GET("savings-goals/{id}/transactions")
    suspend fun getSavingsTxns(@Path("id") id: Int): Response<ApiResponse<SavingsTxnResponse>>

    /* 债务 */
    @GET("debts")
    suspend fun getDebts(): Response<ApiResponse<DebtListResponse>>

    @POST("debts")
    suspend fun createDebt(@Body req: CreateDebtRequest): Response<ApiResponse<IdResponse>>

    @PUT("debts/{id}")
    suspend fun updateDebt(@Path("id") id: Int, @Body req: UpdateDebtRequest): Response<ApiResponse<Unit>>

    @DELETE("debts/{id}")
    suspend fun deleteDebt(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @GET("debts/{id}")
    suspend fun getDebt(@Path("id") id: Int): Response<ApiResponse<DebtDetailResponse>>

    /** 添加还款/收款记录（按 direction 分叉） */
    @POST("debts/{id}/repayments")
    suspend fun createRepayment(@Path("id") id: Int, @Body req: CreateRepaymentRequest): Response<ApiResponse<Unit>>

    @DELETE("debts/{id}/repayments/{rid}")
    suspend fun deleteRepayment(@Path("id") id: Int, @Path("rid") rid: Int): Response<ApiResponse<Unit>>

    /** 编辑还款/收款记录。服务端 PUT /debts/:id/repayments/:rid（按 direction 分叉） */
    @PUT("debts/{id}/repayments/{rid}")
    suspend fun updateRepayment(
        @Path("id") id: Int,
        @Path("rid") rid: Int,
        @Body req: com.xinwallet.app.data.model.UpdateRepaymentRequest
    ): Response<ApiResponse<Unit>>

    /* 报表 */
    @GET("reports")
    suspend fun getReport(
        @Query("type") type: String,
        @Query("period") period: String
    ): Response<ApiResponse<FinanceReport>>

    @GET("reports/top-transactions")
    suspend fun getTopTransactions(
        @Query("type") type: String,
        @Query("period") period: String
    ): Response<ApiResponse<TopTransactionsResponse>>

    /* 标签 */
    @GET("tags")
    suspend fun getTags(): Response<ApiResponse<List<Tag>>>

    @POST("tags")
    suspend fun createTag(@Body req: CreateTagRequest): Response<ApiResponse<IdResponse>>

    @PUT("tags/{id}")
    suspend fun updateTag(@Path("id") id: Int, @Body req: UpdateTagRequest): Response<ApiResponse<Unit>>

    @DELETE("tags/{id}")
    suspend fun deleteTag(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /* 多账本（账套） */
    @GET("books")
    suspend fun getBooks(): Response<ApiResponse<BooksResponse>>

    @POST("books")
    suspend fun createBook(@Body req: CreateBookRequest): Response<ApiResponse<BookIdResponse>>

    @PUT("books/{id}")
    suspend fun updateBook(@Path("id") id: Int, @Body req: UpdateBookRequest): Response<ApiResponse<Unit>>

    @POST("books/{id}/switch")
    suspend fun switchBook(@Path("id") id: Int): Response<ApiResponse<SwitchBookResponse>>

    @DELETE("books/{id}")
    suspend fun deleteBook(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /* 账本备份（数据管理）—— 与鸿蒙 DataManagement.ets 共用同一套服务端能力 */

    /**
     * 导出账本备份为 xlsx（工作表：账本配置页 / 账户页 / 账单流水页 / 理财流水页）。
     * 返回的是**二进制流**而非 ApiResponse<T>，因此：
     *   - 返回类型用 ResponseBody（GsonConverterFactory 不介入，否则会尝试把 xlsx 当 JSON 解析而失败）
     *   - 必须加 @Streaming，否则 Retrofit 会把整个文件先读进内存
     * 也因此这条接口不能走 safeApiCall，需要在 Repository 里自行落盘。
     */
    @Streaming
    @GET("backup/export")
    suspend fun exportBackup(): Response<ResponseBody>

    /**
     * 导入账本备份：上传 xlsx，服务端清空当前账本后完整恢复。
     * multipart 字段名必须是 file（后端 `upload.single('file')` 约定；写错会返回「请上传 .xlsx 备份文件」）。
     * data.imported 为各类型恢复条数，用于成功后回显汇总。
     */
    @Multipart
    @POST("backup/import")
    suspend fun importBackup(@Part file: MultipartBody.Part): Response<ApiResponse<ImportBackupResult>>

    /* ---------- AI 消费洞察（v0.2.1 起合并进 /ai/advice，insights 字段随之返回）----------
     * ⚠️ 原 /ai/insight 端点已删除（v0.2.1，2026-08-27）。
     *   此处移除 aiInsight 端点声明；调用方改用 aiAdvice() 拿 AiAdviceResponse.insights。 */

    /** 读取 AI 设置（含 web 端给 AI 起的名字 ai_name，安卓端标题展示用） */
    @GET("ai/settings")
    suspend fun getAiSettings(): Response<ApiResponse<AiSettingsResponse>>

    /* ---------- AI 服务商配置（/ai/providers 系列）----------
     * 端点路径不带前导斜杠（Retrofit 规范，与项目其他端点保持一致）。
     * 入参 AiProviderPayload 在 PUT 时 apiKey 为空字符串表示「不修改原 key」；
     * 与服务端 `if (typeof api_key === 'string' && api_key.trim())` 分支对齐。 */
    @GET("ai/providers")
    suspend fun aiProviders(): Response<ApiResponse<AiProviderListResponse>>

    @POST("ai/providers")
    suspend fun aiProviderCreate(@Body req: AiProviderPayload): Response<ApiResponse<Unit>>

    @PUT("ai/providers/{id}")
    suspend fun aiProviderUpdate(@Path("id") id: Int, @Body req: AiProviderPayload): Response<ApiResponse<Unit>>

    @DELETE("ai/providers/{id}")
    suspend fun aiProviderDelete(@Path("id") id: Int): Response<ApiResponse<Unit>>

    /** 激活某个服务商（同时把其他都置为 inactive，单选语义） */
    @POST("ai/providers/{id}/activate")
    suspend fun aiProviderActivate(@Path("id") id: Int): Response<ApiResponse<AiProviderActivateResponse>>

    /** 测试连通性：服务端实际发起一次最小调用（"回复 OK"），返回 {ok, reply} 或 {ok:false, error} */
    @POST("ai/providers/{id}/test")
    suspend fun aiProviderTest(@Path("id") id: Int): Response<ApiResponse<AiProviderTestResponse>>

    /* ---------- AI 财务建议（POST /ai/advice）----------
     * 入参为空 body（服务端固定取本月 + 上月环比）。
     * 输出 priority 三态 high/medium/low，与 insight 配套但字段更量化。 */
    @POST("ai/advice")
    suspend fun aiAdvice(): Response<ApiResponse<AiAdviceResponse>>

    /* ---------- AI 规则（/ai/rules 系列）----------
     * ⚠️ listRules 返回 thresholds / weights / half_life_days 必须一并展示给用户，
     * 客户端硬编码阈值会与后端漂移（这是 v0.2 验收铁律之一，见 server/modules/ai/rules/rule-store.js）。 */
    @GET("ai/rules")
    suspend fun aiRules(
        @Query("status") status: String? = null,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0,
    ): Response<ApiResponse<AiRuleListResponse>>

    @POST("ai/rules")
    suspend fun aiRuleCreate(@Body req: AiRuleCreatePayload): Response<ApiResponse<AiRuleActionResponse>>

    /** 停用规则：reason 可空（200 字内）；不传 reason 服务端默认空串 */
    @POST("ai/rules/{id}/disable")
    suspend fun aiRuleDisable(@Path("id") id: Int, @Body req: AiRuleDisablePayload): Response<ApiResponse<AiRuleActionResponse>>

    /** 重新启用：回到 candidate 重新攒证据，不恢复历史分数 */
    @POST("ai/rules/{id}/enable")
    suspend fun aiRuleEnable(@Path("id") id: Int): Response<ApiResponse<AiRuleActionResponse>>

    @GET("ai/rules/{id}/evidence")
    suspend fun aiRuleEvidence(@Path("id") id: Int, @Query("limit") limit: Int = 50): Response<ApiResponse<AiRuleEvidenceResponse>>

    /* ---------- AI 学习统计 + 评测 ----------
     * 字段都用 Map<String, Any?> 兜底：服务端这一组查询结果结构嵌套深、版本演进快，
     * 客户端不强类型化，避免 v0.3+ 字段调整时反序列化失败。 */
    @GET("ai/learning/stats")
    suspend fun aiLearningStats(): Response<ApiResponse<AiLearningStatsResponse>>

    @POST("ai/evaluation/run")
    suspend fun aiEvaluationRun(@Body req: AiEvaluationRunPayload): Response<ApiResponse<AiEvaluationRunResponse>>

    @GET("ai/evaluation/runs")
    suspend fun aiEvaluationRuns(@Query("limit") limit: Int = 10): Response<ApiResponse<AiEvaluationRunsResponse>>

    /* OCR 重转录（POST /ai/ocr/retranscribe）已在 v0.2.2 删除：
     * 截图记账整页删除后无调用方（AiScanViewModel.kt 已删）；用户改走「AI 对话记账 → 发图」路径。
     * 与之配对的 GET /ai/ocr-config 也已删除（getOcrConfig 方法、OcrConfig 模型类一并清理）。 */
}
