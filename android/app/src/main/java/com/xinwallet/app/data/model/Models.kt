package com.xinwallet.app.data.model

import com.google.gson.annotations.SerializedName

/** 统一响应包装：{ success, data, message } */
data class ApiResponse<T>(
    val success: Boolean = false,
    val data: T? = null,
    val message: String? = null
)

/* ----------------------------- 鉴权 ----------------------------- */

data class User(
    val id: Int = 0,
    val username: String = "",
    val nickname: String? = null,
    val avatar: String? = null
)

data class AuthResponse(
    val token: String = "",
    @SerializedName("refreshToken") val refreshToken: String = "",
    val user: User? = null
)

data class UserWrapper(val user: User? = null)

data class IdResponse(val id: Int = 0)

data class LoginRequest(val username: String, val password: String)
data class RefreshRequest(@SerializedName("refreshToken") val refreshToken: String)
data class DemoRequest(val demo: Boolean = true)

/** 登录页配置：服务端是否开启演示账号（ALLOW_DEMO=true） */
data class AuthConfigResponse(val allowDemo: Boolean = false)

/** 修改个人资料（用户名 / 昵称 / 头像 / 改密）。所有字段均可选，服务端仅更新有变更的字段。 */
data class UpdateProfileRequest(
    val username: String? = null,
    val nickname: String? = null,
    val avatar: String? = null,
    val oldPassword: String? = null,
    val newPassword: String? = null
)

/* ----------------------------- 账户 ----------------------------- */

data class Account(
    val id: Int = 0,
    val code: String? = null,
    val name: String = "",
    val type: String = "cash",
    val icon: String? = "💰",
    val balance: Double = 0.0,
    @SerializedName("opening_balance") val openingBalance: Double = 0.0,
    @SerializedName("credit_limit") val creditLimit: Double = 0.0,
    @SerializedName("is_default") val isDefault: Boolean = false,
    val status: String = "active",
    @SerializedName("sort_order") val sortOrder: Int = 0,
    /** 多币种 P2-2a：ISO 4217 货币代码，账户默认币种 */
    val currency: String = "CNY",
    /** 年利率（%），如 3.5 表示 3.5% */
    @SerializedName("annual_rate") val annualRate: Double? = 0.0,
    /** 计息周期：monthly / yearly / daily */
    @SerializedName("interest_cycle") val interestCycle: String? = "monthly",
    /** 最近一次计息日期 YYYY-MM-DD */
    @SerializedName("last_interest_date") val lastInterestDate: String? = null
)

data class AccountsResponse(
    val accounts: List<Account> = emptyList(),
    @SerializedName("totalAssets") val totalAssets: Double = 0.0
)

data class CreateAccountRequest(
    val name: String,
    val type: String,
    val icon: String? = "💰",
    @SerializedName("opening_balance") val openingBalance: Double = 0.0,
    @SerializedName("credit_limit") val creditLimit: Double = 0.0,
    @SerializedName("annual_rate") val annualRate: Double = 0.0,
    @SerializedName("interest_cycle") val interestCycle: String = "monthly"
)

data class UpdateAccountRequest(
    val name: String,
    val type: String,
    val icon: String? = "💰",
    @SerializedName("opening_balance") val openingBalance: Double = 0.0,
    @SerializedName("credit_limit") val creditLimit: Double = 0.0,
    @SerializedName("annual_rate") val annualRate: Double = 0.0,
    @SerializedName("interest_cycle") val interestCycle: String = "monthly"
)

/** POST /accounts/accounts/{id}/interest 请求体：记一笔利息入账 */
data class AddAccountInterestRequest(
    val amount: Double,
    val date: String? = null,
    val note: String? = null
)

/** 记利息返回：最新余额 + 本次计息日期 */
data class AddAccountInterestResult(
    val balance: Double = 0.0,
    @SerializedName("last_interest_date") val lastInterestDate: String = ""
)

/* ----------------------------- 分类 ----------------------------- */

data class Category(
    val id: Int = 0,
    val code: String? = null,
    @SerializedName("parent_id") val parentId: Int? = null,
    @SerializedName("user_id") val userId: Int? = null,
    val name: String = "",
    val type: String = "expense",
    val icon: String? = "📌",
    val color: String? = "#6366f1",
    @SerializedName("is_system") val isSystem: Boolean = true,
    @SerializedName("sort_order") val sortOrder: Int = 0
)

/* ----------------------------- 交易（列表：嵌套格式） ----------------------------- */

data class TransactionItem(
    val id: Int = 0,
    val type: String = "expense",
    val amount: Double = 0.0,
    val note: String? = null,
    val date: String = "",
    val location: String? = null,
    @SerializedName("link_type") val linkType: String? = null,
    @SerializedName("link_id") val linkId: Int? = null,
    val category: TxRef? = null,
    val account: TxRef? = null,
    val source: TxRef? = null,
    val destination: TxRef? = null,
    val counterparty: TxCounterparty? = null,
    @SerializedName("transfer_id") val transferId: Int? = null,
    /**
     * 折叠后的转账双端信息。
     *
     * 一笔转账在库里是两条腿（transfer_out + transfer_in），列表已在服务端
     * SQL 层折叠成一条（见 server/routes/transactions.js）。这个字段让那一条
     * 记录能自己表达完整的「A → B」。
     *
     * **非 null 即代表这是折叠转账，编辑/删除必须走 /transfers/{id}** ——
     * 用 item.id 去调 transactions/{id} 只会动一条腿，转出账户扣了 200 而
     * 转入账户还是加 100，两个账户余额从此对不上。
     *
     * 服务端要求 transfer_id + 双端账户名三者齐全才构造它，账户被删导致
     * JOIN 不到名字时为 null —— 此时退回普通渲染，不显示「? → ?」。
     */
    val transfer: TxTransfer? = null,
    val tags: List<TxTag> = emptyList()
)

data class TxTransfer(
    val id: Int = 0,
    val from: TxRef? = null,
    val to: TxRef? = null
)

data class TxRef(val id: Int = 0, val name: String = "", val icon: String? = null)
data class TxCounterparty(val dir: String? = null, val name: String = "", val icon: String? = null)
data class TxTag(val id: Int = 0, val name: String = "", val color: String? = null, val icon: String? = null)

/* ----------------------------- 交易（扁平格式：仪表盘最近交易） ----------------------------- */

data class Transaction(
    val id: Int = 0,
    @SerializedName("user_id") val userId: Int = 0,
    @SerializedName("account_id") val accountId: Int = 0,
    @SerializedName("category_id") val categoryId: Int = 0,
    val type: String = "expense",
    val amount: Double = 0.0,
    val note: String? = null,
    val date: String = "",
    @SerializedName("cat_name") val catName: String? = null,
    @SerializedName("cat_icon") val catIcon: String? = null,
    @SerializedName("acc_name") val accName: String? = null,
    @SerializedName("acc_icon") val accIcon: String? = null
)

data class CreateTransactionRequest(
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("category_id") val categoryId: Int,
    val type: String,
    val amount: Double,
    val note: String? = null,
    val date: String,
    val location: String? = null,
    @SerializedName("link_type") val linkType: String? = null,
    @SerializedName("link_id") val linkId: Int? = null,
    /** 关联预算（可选）：传入后端会写 transactions.budget_id，参与预算统计 */
    @SerializedName("budget_id") val budgetId: Int? = null,
    /** AI/OCR 场景传入的商家或个人对象；服务端会自动按「类目名-merchant」格式拼接备注 */
    val merchant: String? = null,
    /** 关联标签 id 列表（可选）：后端写入 transaction_tags；null/空数组 = 不关联 */
    val tags: List<Int>? = null
)

/** 编辑交易：字段与新增一致，后端会按账本重算受影响账户余额 */
data class UpdateTransactionRequest(
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("category_id") val categoryId: Int,
    val type: String,
    val amount: Double,
    val note: String? = null,
    val date: String,
    val location: String? = null,
    @SerializedName("link_type") val linkType: String? = null,
    @SerializedName("link_id") val linkId: Int? = null,
    @SerializedName("budget_id") val budgetId: Int? = null,
    /** 关联标签 id 列表（可选）：后端会在事务内先清空再写入 transaction_tags */
    val tags: List<Int>? = null
)

/** GET /transactions/summary?month=YYYY-MM */
data class TxSummary(
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val balance: Double = 0.0,
    val expenseByCategory: List<CategoryTotal> = emptyList(),
    val incomeByCategory: List<CategoryTotal> = emptyList()
)

data class CategoryTotal(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = null,
    @SerializedName("parent_id") val parentId: Int? = null,
    val total: Double = 0.0
)

/* ----------------------------- 转账 ----------------------------- */

data class Transfer(
    val id: Int = 0,
    @SerializedName("from_account_id") val fromAccountId: Int = 0,
    @SerializedName("to_account_id") val toAccountId: Int = 0,
    val amount: Double = 0.0,
    val note: String? = null,
    val date: String = "",
    val status: String = "completed",
    @SerializedName("from_name") val fromName: String? = null,
    @SerializedName("from_icon") val fromIcon: String? = null,
    @SerializedName("to_name") val toName: String? = null,
    @SerializedName("to_icon") val toIcon: String? = null
)

data class CreateTransferRequest(
    @SerializedName("from_account_id") val fromAccountId: Int,
    @SerializedName("to_account_id") val toAccountId: Int,
    val amount: Double,
    val note: String? = null,
    val date: String
)

/* ----------------------------- 理财 ----------------------------- */

data class InvestmentType(
    val id: Int = 0,
    val code: String? = null,
    val name: String = "",
    val icon: String? = "📈",
    @SerializedName("risk_level") val riskLevel: String = "medium",
    val category: String = "fund",
    val description: String? = null,
    @SerializedName("sort_order") val sortOrder: Int = 0,
    @SerializedName("is_system") val isSystem: Boolean = false
)

data class Investment(
    val id: Int = 0,
    @SerializedName("user_id") val userId: Int = 0,
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("investment_type_id") val investmentTypeId: Int = 0,
    val name: String = "",
    val code: String = "",
    @SerializedName("buy_price") val buyPrice: Double = 0.0,
    @SerializedName("current_price") val currentPrice: Double = 0.0,
    val quantity: Double = 0.0,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("current_value") val currentValue: Double = 0.0,
    val fee: Double = 0.0,
    @SerializedName("buy_date") val buyDate: String = "",
    @SerializedName("expected_rate") val expectedRate: Double = 0.0,
    @SerializedName("actual_rate") val actualRate: Double = 0.0,
    @SerializedName("nav_date") val navDate: String? = null,
    val status: String = "holding",
    val note: String? = null,
    @SerializedName("risk_level") val riskLevel: String? = null,
    @SerializedName("type_name") val typeName: String? = null,
    @SerializedName("type_icon") val typeIcon: String? = null,
    @SerializedName("acc_name") val accName: String? = null,
    val profit: Double = 0.0,
    @SerializedName("profit_rate") val profitRate: Double = 0.0,
    val annualizedRate: Double = 0.0
)

data class InvestmentsResponse(
    val investments: List<Investment> = emptyList(),
    val summary: PortfolioSummary? = null,
    val byType: Map<String, TypeGroup>? = null
)

data class InvestmentTransaction(
    val id: Int = 0,
    val type: String = "buy",
    @SerializedName("type_label") val typeLabel: String = "买入",
    val amount: Double = 0.0,
    val price: Double = 0.0,
    val quantity: Double = 0.0,
    @SerializedName("fee") val fee: Double = 0.0,
    val date: String = "",
    val note: String? = null
)

/** 新增理财流水（买入/卖出/分红/利息/红利再投）。后端 POST /investments/:id/transactions */
data class AddInvestmentTxnRequest(
    val type: String,
    val amount: Double,
    val price: Double = 0.0,
    val quantity: Double = 0.0,
    val date: String,
    val note: String? = null,
    val fee: Double = 0.0
)

/** 加仓/减仓。后端 POST /investments/:id/reduce（action=buy/sell，自动更新持仓成本与数量） */
data class ReduceInvestmentRequest(
    val action: String,
    val price: Double,
    val quantity: Double,
    val fee: Double = 0.0,
    val date: String? = null,
    val note: String? = null
)

/** 清仓。后端 PUT /investments/:id/sell（按清仓价回款、标记已清仓、资金入账关联账户） */
data class SellInvestmentRequest(
    @SerializedName("sell_price") val sellPrice: Double,
    val date: String? = null,
    val note: String? = null,
    val fee: Double = 0.0
)

data class InvestmentTransactionsResponse(
    val transactions: List<InvestmentTransaction> = emptyList()
)

data class PortfolioSummary(
    val totalCost: Double = 0.0,
    val totalValue: Double = 0.0,
    val totalProfit: Double = 0.0,
    val totalProfitRate: Double = 0.0
)

data class TypeGroup(
    val type_name: String = "",
    val icon: String? = null,
    val risk_level: String? = null,
    val total_cost: Double = 0.0,
    val total_value: Double = 0.0,
    val items: List<Investment> = emptyList()
)

data class CreateInvestmentRequest(
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("investment_type_id") val investmentTypeId: Int,
    val name: String,
    val code: String = "",
    @SerializedName("buy_price") val buyPrice: Double = 0.0,
    @SerializedName("current_price") val currentPrice: Double = 0.0,
    val quantity: Double = 0.0,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("current_value") val currentValue: Double = 0.0,
    val fee: Double = 0.0,
    @SerializedName("buy_date") val buyDate: String = "",
    @SerializedName("expected_rate") val expectedRate: Double = 0.0,
    @SerializedName("risk_level") val riskLevel: String? = null,
    val note: String? = null
)

/** 编辑理财持仓 */
data class UpdateInvestmentRequest(
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("investment_type_id") val investmentTypeId: Int,
    val name: String,
    val code: String = "",
    @SerializedName("buy_price") val buyPrice: Double = 0.0,
    @SerializedName("current_price") val currentPrice: Double = 0.0,
    val quantity: Double = 0.0,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("current_value") val currentValue: Double = 0.0,
    val fee: Double = 0.0,
    @SerializedName("buy_date") val buyDate: String = "",
    @SerializedName("expected_rate") val expectedRate: Double = 0.0,
    @SerializedName("risk_level") val riskLevel: String? = null,
    val note: String? = null
)

/* ----------------------------- AI 智能记账 ----------------------------- */

/** POST /ai/ocr 返回体 */
data class OcrResponse(
    val text: String = "",
    val items: List<OcrItem> = emptyList(),
    val reason: String? = null,
    /* ---- v0.2 预测闭环字段（/ai/ocr 识别出交易时返回）----
     * ⚠️ 「识别不出交易」分支只返回 text/items/reason，不含下列字段。
     *   Gson 反序列化绕过构造器（不走 Kotlin 默认值），缺失的引用类型字段
     *   实际为 null —— 调用方必须 orEmpty()/判空，不能信这里的默认值。
     *   predictionId 用 primitive Int：缺失时为 0，可作为「无预测」判据。 */
    @SerializedName("prediction_id") val predictionId: Int = 0,
    val transactions: List<AiCandidateTxn>? = null,
    val verdict: String? = null,
    @SerializedName("overall_confidence") val overallConfidence: Double? = null,
    val reasons: List<String>? = null,
    @SerializedName("needs_confirmation") val needsConfirmation: Boolean = true,
    @SerializedName("transcribe_source") val transcribeSource: String? = null
)

/**
 * OCR 识别出的单条交易候选。
 * `category` 是后端给出的分类「名称」（如「午餐」），客户端需按名称匹配到本地分类 id。
 * `date` 形如 `2026-07-17 17:23:49`，也可能只有日期。
 */
data class OcrItem(
    val name: String = "",
    val amount: Double = 0.0,
    val type: String = "expense",
    val date: String? = null,
    val note: String? = null,
    val category: String? = null,
    /** 服务端 LLM 识别出的对象（商家/个人姓名），用于服务端拼接「类目名-merchant」备注 */
    val merchant: String? = null
)

/** 对话中的一条消息；user 消息可附带截图（多模态），assistant 消息可携带已建交易 */
data class ChatMessage(
    val role: String,
    val content: String = "",
    val imageBase64: String? = null,
    val mime: String? = null,
    val transactions: List<ChatTxn> = emptyList()
)

data class ChatRequest(
    val messages: List<ChatMessage>,
    val image: String? = null,
    val mime: String? = null
)

data class ChatTxn(
    val id: Int = 0,
    val action: String = "created", // created | updated | deleted
    val type: String = "",
    val amount: Double = 0.0,
    val categoryName: String? = null,
    val accountName: String? = null,
    val date: String? = null
)

data class ChatResponse(
    val reply: String = "",
    val transactions: List<ChatTxn> = emptyList()
)

/** AI 设置（GET /ai/settings 返回 settings 对象，ai_name 即 web 端给 AI 起的名字） */
data class AiSettingsResponse(
    val settings: AiSettingsDto = AiSettingsDto()
)

data class AiSettingsDto(
    @SerializedName("ai_name") val aiName: String = ""
)

data class TranscribeRequest(
    val audio: String,
    val mime: String? = null
)

data class TranscribeResponse(val text: String = "")

/* ------------------- AI v0.2 预测闭环（parse → 确认 → commit） -------------------
 * 核心原则：AI 输出【永不直接写账本】。
 * parse 产出不可变预测快照，用户确认/修正后 commit 才原子落账。
 *
 * 与上方 legacy ChatRequest/ChatResponse 的关系：
 *   legacy /ai/chat 由后端 function calling 直接建账；本组模型走确认闭环，二者并存。
 */

/**
 * POST /ai/transactions/parse 请求体。
 * source 表示【输入通道】，必须是 parse / chat / ocr / voice 之一（受服务端 CHECK 约束）；
 * 客户端平台放 context.platform，不要塞进 source。
 */
data class AiParseRequest(
    val text: String,
    val context: AiParseContext? = null,
    val source: String = "parse"
)

data class AiParseContext(
    @SerializedName("account_id") val accountId: Int? = null,
    /** yyyy-MM-dd，让服务端以客户端本地「今天」为基准而非服务器时区 */
    val date: String? = null,
    val platform: String = "android"
)

/** POST /ai/transactions/parse 响应体 */
data class AiParseResponse(
    @SerializedName("prediction_id") val predictionId: Int = 0,
    val transactions: List<AiCandidateTxn> = emptyList(),
    /** ready | needs_confirmation */
    val verdict: String = "needs_confirmation",
    @SerializedName("overall_confidence") val overallConfidence: Double? = null,
    val reasons: List<String> = emptyList(),
    /** 前端据此决定是否必须弹确认框；禁止拿 overallConfidence 自行比阈值 */
    @SerializedName("needs_confirmation") val needsConfirmation: Boolean = true
)

/**
 * 候选交易。amount 保证 > 0；categoryId / accountId / merchant 可能为 null。
 * date 是 10 字符纯日期（yyyy-MM-dd），不带时间部分。
 */
data class AiCandidateTxn(
    val seq: Int = 0,
    /** income | expense | transfer */
    val type: String = "expense",
    val amount: Double = 0.0,
    val currency: String = "CNY",
    val merchant: String? = null,
    @SerializedName("category_id") val categoryId: Int? = null,
    @SerializedName("category_name") val categoryName: String? = null,
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("from_account_id") val fromAccountId: Int? = null,
    @SerializedName("to_account_id") val toAccountId: Int? = null,
    val date: String? = null,
    val note: String? = null,
    /** 地点：用户可在 AI 卡片内编辑，落账时写入 transactions.location（对齐手动记账） */
    val location: String? = null,
    @SerializedName("raw_segment") val rawSegment: String? = null,
    /** 字段级置信度：amount/type/category/date/currency/merchant */
    val confidence: Map<String, Double> = emptyMap(),
    /** 抽取来源，用于向用户解释「为什么这么判」；缺失时值为 "missing" */
    val evidence: Map<String, String> = emptyMap()
)

/** GET /ai/predictions/{id} 响应体 */
data class AiPredictionSnapshot(
    @SerializedName("prediction_id") val predictionId: Int = 0,
    /** pending | committed | discarded */
    val status: String = "pending",
    val verdict: String = "needs_confirmation",
    val source: String = "parse",
    val transactions: List<AiCandidateTxn> = emptyList(),
    val validation: AiValidation? = null,
    @SerializedName("committed_at") val committedAt: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

/** 字段级裁决结果。前端只做展示，判定权在服务端。 */
data class AiValidation(
    val verdict: String = "needs_confirmation",
    val overall: Double? = null,
    val reasons: List<String> = emptyList(),
    @SerializedName("per_txn") val perTxn: List<AiTxnValidation> = emptyList(),
    val thresholds: Map<String, Double> = emptyMap()
)

data class AiTxnValidation(
    val seq: Int = 0,
    val verdict: String = "needs_confirmation",
    val overall: Double? = null,
    val reasons: List<String> = emptyList(),
    @SerializedName("per_field") val perField: Map<String, AiFieldVerdict> = emptyMap()
)

data class AiFieldVerdict(
    val score: Double = 0.0,
    val threshold: Double = 0.0,
    val ok: Boolean = false
)

/**
 * POST /ai/predictions/{id}/commit 请求体。
 * action=confirmed 时不传 transactions，服务端直接采用不可变快照；
 * action=corrected 时必须传修正后的完整数组。
 * idempotencyKey 固定后重试不会重复落账。
 */
data class AiCommitRequest(
    val action: String = "confirmed",
    val transactions: List<AiCandidateTxn>? = null,
    @SerializedName("idempotency_key") val idempotencyKey: String? = null
)

data class AiCommitResponse(
    val message: String = "",
    @SerializedName("prediction_id") val predictionId: Int = 0,
    val transactions: List<AiCommittedTxn> = emptyList()
)

/** 落账结果。transfer 的 id 是 transfer_id，不是 transaction_id。 */
data class AiCommittedTxn(
    val id: Int = 0,
    val seq: Int = 0,
    val type: String = "",
    val amount: Double = 0.0,
    @SerializedName("category_id") val categoryId: Int? = null,
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("from_account_id") val fromAccountId: Int? = null,
    @SerializedName("to_account_id") val toAccountId: Int? = null
)

data class AiDiscardRequest(val reason: String = "")

data class AiSimpleMessage(val message: String = "")

/* ----------------------------- 预算 ----------------------------- */

data class Budget(
    val id: Int = 0,
    val name: String = "",
    @SerializedName("period_type") val periodType: String = "month",
    @SerializedName("start_date") val startDate: String = "",
    @SerializedName("end_date") val endDate: String = "",
    val amount: Double = 0.0,
    val actual: Double = 0.0
)

data class CreateBudgetRequest(
    val name: String,
    val amount: Double,
    @SerializedName("period_type") val periodType: String = "month",
    @SerializedName("base_date") val baseDate: String? = null
)

data class UpdateBudgetRequest(
    val name: String,
    val amount: Double,
    @SerializedName("period_type") val periodType: String = "month",
    @SerializedName("base_date") val baseDate: String? = null
)

/* ----------------------------- 储蓄目标（存入/取回） ----------------------------- */

data class CreateSavingGoalRequest(
    val name: String,
    @SerializedName("target_amount") val targetAmount: Double,
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("source_account_id") val sourceAccountId: Int,
    val icon: String? = "🎯",
    val note: String? = null
)

data class UpdateSavingGoalRequest(
    val name: String,
    @SerializedName("target_amount") val targetAmount: Double,
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("source_account_id") val sourceAccountId: Int,
    val icon: String? = "🎯",
    val note: String? = null
)

data class SavingsAllocateRequest(
    val amount: Double,
    @SerializedName("account_id") val accountId: Int
)

data class SavingsWithdrawRequest(
    val amount: Double,
    @SerializedName("account_id") val accountId: Int
)

data class SavingsTxn(
    val type: String = "",
    val amount: Double = 0.0,
    val date: String = "",
    val note: String? = null,
    @SerializedName("account_name") val accountName: String? = null
)

data class SavingsTxnSummary(
    val deposit: Double = 0.0,
    val withdraw: Double = 0.0,
    val net: Double = 0.0
)

data class SavingsTxnResponse(
    val transactions: List<SavingsTxn> = emptyList(),
    val summary: SavingsTxnSummary? = null
)

/* ----------------------------- 债务（含还款） ----------------------------- */

data class DebtSubSummary(
    val remaining: Double = 0.0,
    val monthly: Double = 0.0,
    val count: Int = 0,
    val activeCount: Int = 0,
    val dueThisMonth: Double = 0.0,
    val dueAmount: Double = 0.0,
    val overdue: Int = 0,
    val overdueAmount: Double = 0.0
)

data class DebtListSummary(
    val totalRemaining: Double = 0.0,
    val totalMonthly: Double = 0.0,
    val dueThisMonth: Double = 0.0,
    val dueAmount: Double = 0.0,
    val overdue: Int = 0,
    val overdueAmount: Double = 0.0,
    val count: Int = 0,
    val activeCount: Int = 0,
    val netDebt: Double = 0.0,
    val payable: DebtSubSummary? = null,
    val receivable: DebtSubSummary? = null
)

data class DebtListResponse(
    val debts: List<Debt> = emptyList(),
    val summary: DebtListSummary? = null
)

data class Debt(
    val id: Int = 0,
    val name: String = "",
    val type: String = "loan",
    val direction: String = "payable",
    val creditor: String? = null,
    val principal: Double = 0.0,
    val remaining: Double = 0.0,
    @SerializedName("interest_rate") val interestRate: Double = 0.0,
    @SerializedName("term_months") val termMonths: Int = 0,
    val method: String = "equal_installment",
    @SerializedName("monthly_payment") val monthlyPayment: Double = 0.0,
    @SerializedName("min_payment") val minPayment: Double = 0.0,
    @SerializedName("start_date") val startDate: String? = null,
    @SerializedName("due_date") val dueDate: String? = null,
    @SerializedName("billing_day") val billingDay: Int? = null,
    @SerializedName("payment_day") val paymentDay: Int? = null,
    val note: String? = null,
    val status: String = "active",
    @SerializedName("paid_total") val paidTotal: Double = 0.0,
    @SerializedName("account_id") val accountId: Int? = null
)

data class DebtRepayment(
    val id: Int = 0,
    val amount: Double = 0.0,
    @SerializedName("principal_part") val principalPart: Double = 0.0,
    @SerializedName("interest_part") val interestPart: Double = 0.0,
    @SerializedName("paid_at") val paidAt: String = "",
    val note: String? = null,
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("account_name") val accountName: String? = null
)

data class DebtScheduleItem(
    val period: Int = 0,
    val payment: Double = 0.0,
    val principal: Double = 0.0,
    val interest: Double = 0.0,
    val remainAfter: Double = 0.0
)

data class DebtDetailResponse(
    val debt: Debt = Debt(),
    val repayments: List<DebtRepayment> = emptyList(),
    val schedule: List<DebtScheduleItem> = emptyList()
)

data class CreateDebtRequest(
    val name: String,
    val principal: Double,
    val direction: String = "payable",
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("interest_rate") val interestRate: Double = 0.0,
    @SerializedName("term_months") val termMonths: Int = 0,
    val method: String = "equal_installment",
    @SerializedName("monthly_payment") val monthlyPayment: Double = 0.0,
    @SerializedName("due_date") val dueDate: String? = null,
    val note: String? = null,
    val type: String = "loan",
    val creditor: String? = null
)

data class UpdateDebtRequest(
    val name: String,
    val principal: Double,
    val direction: String = "payable",
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("interest_rate") val interestRate: Double = 0.0,
    @SerializedName("term_months") val termMonths: Int = 0,
    val method: String = "equal_installment",
    @SerializedName("monthly_payment") val monthlyPayment: Double = 0.0,
    @SerializedName("due_date") val dueDate: String? = null,
    val note: String? = null,
    val type: String = "loan",
    val creditor: String? = null
)

data class CreateRepaymentRequest(
    val amount: Double,
    @SerializedName("paid_at") val paidAt: String? = null,
    val note: String? = null,
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("principal_part") val principalPart: Double? = null,
    @SerializedName("interest_part") val interestPart: Double? = null
)

/** 编辑还款/收款记录：字段与新增一致（金额/账户/日期/备注必填，本金与利息拆分可选） */
data class UpdateRepaymentRequest(
    val amount: Double,
    @SerializedName("paid_at") val paidAt: String? = null,
    val note: String? = null,
    @SerializedName("account_id") val accountId: Int,
    @SerializedName("principal_part") val principalPart: Double? = null,
    @SerializedName("interest_part") val interestPart: Double? = null
)

/** 编辑理财流水（买入/卖出/分红/利息/红利再投）。服务端 PUT /investments/:id/transactions/:txnId */
data class UpdateInvestmentTxnRequest(
    val type: String,
    val amount: Double,
    val price: Double = 0.0,
    val quantity: Double = 0.0,
    val date: String,
    val note: String? = null,
    val fee: Double = 0.0
)

/* ----------------------------- 仪表盘 ----------------------------- */

data class Dashboard(
    val today: AmountOnly? = null,
    val week: IncomeExpense? = null,
    val month: IncomeExpense? = null,
    val year: IncomeExpense? = null,
    val months: List<MonthTrend> = emptyList(),
    val accounts: List<Account> = emptyList(),
    @SerializedName("investments") val inv: InvData? = null,
    @SerializedName("budgets") val budgetRows: List<BudgetRow> = emptyList(),
    @SerializedName("savingsGoals") val goalRows: List<SavingGoal> = emptyList(),
    @SerializedName("recentTransactions") val recentTrans: List<TransactionItem> = emptyList(),
    @SerializedName("debts") val debt: DebtSummary? = null,
    @SerializedName("netWorth") val netWorth: Double = 0.0,
    @SerializedName("totalAssets") val totalAssets: Double = 0.0,
    @SerializedName("totalSavings") val totalSavings: Double = 0.0,
    @SerializedName("savingsRate") val savingsRate: Double = 0.0,
    // 多币种 P2-2e：顶层字段（累计）
    @SerializedName("totalIncome") val totalIncome: Double = 0.0,
    @SerializedName("totalExpense") val totalExpense: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("totalIncomeBreakdown") val totalIncomeBreakdown: Map<String, Double>? = null,
    @SerializedName("totalExpenseBreakdown") val totalExpenseBreakdown: Map<String, Double>? = null
)

/** today 今日支出。多币种 P2-2e：currency 主货币，expenseBreakdown 按账户币种分布 */
data class AmountOnly(
    val expense: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null
)

/** week/month/year 收支。多币种 P2-2e：breakdown 按账户币种分布 */
data class IncomeExpense(
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("incomeBreakdown") val incomeBreakdown: Map<String, Double>? = null,
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null
)

/** months 趋势项。多币种 P2-2e：savings/savingsRate；breakdown 按账户币种分布 */
data class MonthTrend(
    val month: String = "",
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val savings: Double = 0.0,
    @SerializedName("savingsRate") val savingsRate: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("incomeBreakdown") val incomeBreakdown: Map<String, Double>? = null,
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null
)

/** 投资汇总。多币种 P2-2e：breakdown 按投资 currency 分布 */
data class InvData(
    @SerializedName("totalCost") val totalCost: Double = 0.0,
    @SerializedName("totalValue") val totalValue: Double = 0.0,
    @SerializedName("totalProfit") val totalProfit: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("totalCostBreakdown") val totalCostBreakdown: Map<String, Double>? = null,
    @SerializedName("totalValueBreakdown") val totalValueBreakdown: Map<String, Double>? = null,
    val holdings: List<HoldingRow> = emptyList()
)

/** 预算执行。多币种 P2-2e：actualBreakdown 按交易账户币种分布（amount 是 CNY 单货币估算） */
data class BudgetRow(
    val id: Int = 0,
    val name: String = "",
    @SerializedName("start_date") val startDate: String = "",
    @SerializedName("end_date") val endDate: String = "",
    val amount: Double = 0.0,
    val actual: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("actualBreakdown") val actualBreakdown: Map<String, Double>? = null
)

/** 储蓄目标。多币种 P2-2e：currency 跟随关联储蓄账户 currency */
data class SavingGoal(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = "🎯",
    @SerializedName("target_amount") val targetAmount: Double = 0.0,
    @SerializedName("current_amount") val currentAmount: Double = 0.0,
    val status: String = "active",
    val currency: String = "CNY",
    val ratio: Double = 0.0,
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("acc_name") val accName: String? = null,
    @SerializedName("source_account_id") val sourceAccountId: Int? = null,
    @SerializedName("source_acc_name") val sourceAccName: String? = null,
    val note: String? = null
)

/** 持仓行。多币种 P2-2e：currency 跟随投资 currency（P2-2d 加列） */
data class HoldingRow(
    val name: String = "",
    val code: String? = null,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("current_value") val currentValue: Double = 0.0,
    val profit: Double = 0.0,
    @SerializedName("profit_rate") val profitRate: Double = 0.0,
    val currency: String = "CNY",
    @SerializedName("type_icon") val typeIcon: String? = null,
    @SerializedName("type_name") val typeName: String? = null
)
data class DebtSummary(
    @SerializedName("totalRemaining") val totalRemaining: Double = 0.0,
    @SerializedName("totalMonthly") val totalMonthly: Double = 0.0,
    @SerializedName("dueThisMonth") val dueThisMonth: Int = 0,
    @SerializedName("dueAmount") val dueAmount: Double = 0.0,
    val overdue: Int = 0,
    @SerializedName("overdueAmount") val overdueAmount: Double = 0.0,
    val count: Int = 0,
    val activeCount: Int = 0,
    // 多币种 P2-2e：主货币 + breakdown（与 web dashboard.js / debt.js 对齐）
    val currency: String = "CNY",
    @SerializedName("totalMonthlyBreakdown") val totalMonthlyBreakdown: Map<String, Double>? = null,
    @SerializedName("dueAmountBreakdown") val dueAmountBreakdown: Map<String, Double>? = null
)

/* ----------------------------- 报表 ----------------------------- */

/** GET /reports?type=&period= 的完整返回（仅声明用到字段，Gson 忽略其余） */
data class FinanceReport(
    val type: String = "",
    val period: String = "",
    val label: String = "",
    val summary: ReportSummary = ReportSummary(),
    @SerializedName("dailyTrend") val dailyTrend: List<DailyTrendPoint> = emptyList(),
    @SerializedName("expenseByCategory") val expenseByCategory: List<ReportCategorySlice> = emptyList(),
    @SerializedName("incomeByCategory") val incomeByCategory: List<ReportCategorySlice> = emptyList(),
    @SerializedName("topExpenses") val topExpenses: List<TopExpense> = emptyList(),
    @SerializedName("budgetExecution") val budgetExecution: List<ReportBudgetExec> = emptyList(),
    val compare: ReportCompare? = null
)

/** 月度预算执行（结余 tab 展示）。多币种 P2-2e：actualBreakdown 按账户币种给出 */
data class ReportBudgetExec(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = "💰",
    val budget: Double = 0.0,
    val actual: Double = 0.0,
    val usage: Double = 0.0,
    /** 多币种 P2-2e：actual 主货币（按 amount 绝对值最大选） */
    val currency: String = "CNY",
    /** 多币种 P2-2e：actual 按账户币种分布；缺省回退到 {currency: actual} */
    @SerializedName("actualBreakdown") val actualBreakdown: Map<String, Double>? = null
)

/** 报表汇总。多币种 P2-2e：breakdown 按交易账户币种分布，income/expense 为主货币值 */
data class ReportSummary(
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val balance: Double = 0.0,
    /** 多币种 P2-2e：本期收入/支出主货币 */
    val currency: String = "CNY",
    /** 多币种 P2-2e：income 按账户币种分布 */
    @SerializedName("incomeBreakdown") val incomeBreakdown: Map<String, Double>? = null,
    /** 多币种 P2-2e：expense 按账户币种分布 */
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null,
    @SerializedName("savingsRate") val savingsRate: Double = 0.0,
    @SerializedName("transactionCount") val transactionCount: Int = 0,
    @SerializedName("avgDailyExpense") val avgDailyExpense: Double = 0.0
)

/** 分类占比切片（支出/收入共用）。total 即该分类在周期内的发生额。多币种 P2-2e：totalBreakdown 按交易账户币种分布 */
data class ReportCategorySlice(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = null,
    @SerializedName("parent_id") val parentId: Int? = null,
    val total: Double = 0.0,
    /** 多币种 P2-2e：total 主货币 */
    val currency: String = "CNY",
    /** 多币种 P2-2e：total 按账户币种分布 */
    @SerializedName("totalBreakdown") val totalBreakdown: Map<String, Double>? = null
)

/** 日趋势点。多币种 P2-2e：breakdown 按交易账户币种分布（income/expense 为主货币值） */
data class DailyTrendPoint(
    val date: String = "",
    val income: Double = 0.0,
    val expense: Double = 0.0,
    /** 多币种 P2-2e：该日主货币 */
    val currency: String = "CNY",
    /** 多币种 P2-2e：income 按账户币种分布 */
    @SerializedName("incomeBreakdown") val incomeBreakdown: Map<String, Double>? = null,
    /** 多币种 P2-2e：expense 按账户币种分布 */
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null
)

/** Top5 支出。多币种 P2-2e：currency 跟随交易账户币种 */
data class TopExpense(
    val id: Int = 0,
    val date: String = "",
    val amount: Double = 0.0,
    val note: String? = null,
    @SerializedName("category_name") val categoryName: String? = null,
    @SerializedName("category_icon") val categoryIcon: String? = null,
    /** 多币种 P2-2e：交易账户币种 */
    val currency: String = "CNY"
)

/** 环比：与上个周期对比。多币种 P2-2e：breakdown 按账户币种分布 */
data class ReportCompare(
    val period: String = "",
    val label: String = "",
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val balance: Double = 0.0,
    /** 多币种 P2-2e：上期主货币 */
    val currency: String = "CNY",
    /** 多币种 P2-2e：income 按账户币种分布 */
    @SerializedName("incomeBreakdown") val incomeBreakdown: Map<String, Double>? = null,
    /** 多币种 P2-2e：expense 按账户币种分布 */
    @SerializedName("expenseBreakdown") val expenseBreakdown: Map<String, Double>? = null
)

/** GET /reports/top-transactions 返回：按 type 取 Top5 交易 */
data class TopTransactionsResponse(
    val items: List<TopTransaction> = emptyList()
)

/** Top5 交易（按类型区分支出/收入）。多币种 P2-2e：currency 跟随交易账户币种 */
data class TopTransaction(
    val id: Int = 0,
    val date: String = "",
    val amount: Double = 0.0,
    val note: String? = null,
    @SerializedName("category_name") val categoryName: String? = null,
    @SerializedName("category_icon") val categoryIcon: String? = null,
    /** 多币种 P2-2e：交易账户币种 */
    val currency: String = "CNY"
)

/* ----------------------------- 标签 ----------------------------- */

data class Tag(
    val id: Int = 0,
    val name: String = "",
    val color: String = "#3b82f6",
    val icon: String = "🏷️"
)

data class CreateTagRequest(val name: String, val color: String, val icon: String)
data class UpdateTagRequest(val name: String, val color: String, val icon: String)

/* 分类增删改请求体（后端 categories 要求 name + type 必填） */
data class CreateCategoryRequest(
    val name: String,
    val type: String,
    val icon: String? = null,
    val color: String? = null
)
data class UpdateCategoryRequest(
    val name: String,
    val type: String,
    val icon: String? = null,
    val color: String? = null
)

/* ----------------------------- 多账本（账套） ----------------------------- */

data class Book(
    val id: Int = 0,
    val name: String = "",
    val icon: String = "📒",
    val color: String = "#6366f1",
    @SerializedName("is_default") val isDefault: Boolean = false,
    @SerializedName("is_current") val isCurrent: Boolean = false,
    @SerializedName("sort_order") val sortOrder: Int = 0,
    @SerializedName("created_at") val createdAt: String? = null
)

/** GET /books 响应：账本列表 + 当前账本 id */
data class BooksResponse(
    val books: List<Book> = emptyList(),
    @SerializedName("current_book_id") val currentBookId: Int = 0
)

/** POST /books 响应 */
data class BookIdResponse(
    val id: Int = 0,
    @SerializedName("is_default") val isDefault: Boolean = false
)

/** POST /books/{id}/switch 响应 */
data class SwitchBookResponse(
    @SerializedName("current_book_id") val currentBookId: Int = 0
)

data class CreateBookRequest(
    val name: String,
    val icon: String? = null,
    val color: String? = null,
    @SerializedName("set_default") val setDefault: Boolean = false
)

data class UpdateBookRequest(
    val name: String? = null,
    val icon: String? = null,
    val color: String? = null
)

/* ----------------------------- 首页日历 ----------------------------- */

data class CalendarDay(
    val date: String = "",         // YYYY-MM-DD
    val income: Double = 0.0,
    val expense: Double = 0.0,
    @SerializedName("hasRecord") val hasRecord: Boolean = false
)

data class CalendarSummary(
    val year: Int = 0,
    val month: Int = 0,
    @SerializedName("monthStart") val monthStart: String = "",
    @SerializedName("monthEnd") val monthEnd: String = "",
    @SerializedName("monthSummary") val monthSummary: IncomeExpense = IncomeExpense(),
    @SerializedName("monthDays") val monthDays: List<CalendarDay> = emptyList()
)

/* ----------------------------- 账本备份（数据管理） ----------------------------- */

/**
 * 导入备份后各类型的恢复条数。
 * 字段与 server/routes/backup.js 里的 `imported` 对象一一对应，
 * 后端新增类型时这里补字段即可（缺字段只会显示不全，不会解析失败）。
 */
data class ImportedCounts(
    val tags: Int = 0,
    val accounts: Int = 0,
    val categories: Int = 0,
    val budgets: Int = 0,
    val debts: Int = 0,
    @SerializedName("savings_goals") val savingsGoals: Int = 0,
    val investments: Int = 0,
    val transactions: Int = 0,
    val transfers: Int = 0
) {
    /** 「账户:12  交易:340」这样的人类可读摘要，0 项不显示 */
    fun summary(): String = listOf(
        "账户" to accounts,
        "分类" to categories,
        "标签" to tags,
        "预算" to budgets,
        "债务" to debts,
        "储蓄目标" to savingsGoals,
        "理财" to investments,
        "交易" to transactions,
        "转账" to transfers
    ).filter { it.second > 0 }.joinToString("  ") { "${it.first}:${it.second}" }
}

data class ImportBackupResult(
    val imported: ImportedCounts = ImportedCounts()
)

/* ================= AI 消费洞察（POST /ai/insight） ================= */

/** POST /ai/insight 请求体。month 为 "YYYY-MM"，null 时服务端取本月。 */
data class AiInsightRequest(
    val month: String? = null
)

/**
 * 单条洞察。level 三态：warning（需重视）/ info（关注）/ tip（小建议）。
 * 服务端返回的是大模型从财务数据抽取的 3-5 条结构化洞察；客户端只渲染，不擅自改写文案。
 */
data class AiInsightItem(
    val title: String = "",
    val description: String = "",
    val action: String = "",
    val level: String = "info"
)

/** POST /ai/insight 响应体。generatedAt 是服务端生成时间，ISO8601 字符串。 */
data class AiInsightResponse(
    val insights: List<AiInsightItem> = emptyList(),
    @SerializedName("generated_at") val generatedAt: String? = null
)

/* ================= AI 服务商配置（/ai/providers 系列） =================
 * 契约（与 server/routes/ai.js validateProvider 对齐）：
 *   - name / base_url / model 必填；api_type 必须是 openai | anthropic
 *   - api_key 在 GET 列表时返回掩码版本（maskKey），POST/PUT 时原样发往后端入库加密
 *   - is_active 触发「单选激活」语义：激活 A 会把其他都置为 false
 *   - 测试连接返回 {ok, reply} 或 {ok:false, error}
 */

data class AiProvider(
    val id: Int = 0,
    val name: String = "",
    @SerializedName("api_type") val apiType: String = "openai",
    @SerializedName("base_url") val baseUrl: String = "",
    /** 服务端返回的是 maskKey 掩码（如 sk-****abcd），UI 上要明确提示用户这是脱敏值 */
    @SerializedName("api_key") val apiKey: String = "",
    val model: String = "",
    @SerializedName("is_active") val isActive: Boolean = false,
    @SerializedName("sort_order") val sortOrder: Int = 0,
)

/** GET /ai/providers 响应体 */
data class AiProviderListResponse(
    val providers: List<AiProvider> = emptyList()
)

/**
 * POST /ai/providers 与 PUT /ai/providers/:id 共用同一份入参。
 * apiKey 为空字符串时：创建必传、修改不动原值（语义见 validateProvider + PUT 分支的
 * `if (typeof api_key === 'string' && api_key.trim())` 判定）。
 */
data class AiProviderPayload(
    val name: String,
    @SerializedName("api_type") val apiType: String,
    @SerializedName("base_url") val baseUrl: String,
    @SerializedName("api_key") val apiKey: String,
    val model: String,
    @SerializedName("is_active") val isActive: Boolean = false,
    @SerializedName("sort_order") val sortOrder: Int = 0,
)

/** POST /providers/:id/test 响应体 —— 成功/失败都走 success 包装（见服务端） */
data class AiProviderTestResponse(
    val ok: Boolean = false,
    val reply: String? = null,
    val error: String? = null
)

/** POST /providers/:id/activate 响应体 */
data class AiProviderActivateResponse(
    val activated: Boolean = false
)

/* ================= AI 财务建议（POST /ai/advice） =================
 * 与 insight 的差别：advice 覆盖范围更广（收支/预算/储蓄目标/账户/债务），
 * 输出字段多了「impact 预期影响」和 priority 三态（high/medium/low）。
 * 入参为空 body，服务端固定取「本月」与「上月」做环比。 */

/**
 * 单条财务建议。priority 三态：high（重要）/ medium（中等）/ low（可选）。
 * 与 insight 同源（同样由大模型从财务数据抽取），但 prompt 要求更可量化、更排序化。
 */
data class AiAdviceItem(
    val title: String = "",
    val content: String = "",
    val impact: String = "",
    val priority: String = "medium"
)

/** POST /ai/advice 响应体（v0.2.1 起同时返回 insights 观察型） */
data class AiAdviceResponse(
    val advice: List<AiAdviceItem> = emptyList(),
    val insights: List<AiInsightItem> = emptyList(),
    @SerializedName("generated_at") val generatedAt: String? = null
)

/* ================= AI 规则（/ai/rules 系列） =================
 * 契约（server/routes/ai.js）：
 *   - GET 列表支持 status 过滤（candidate/verified/trusted/degraded/disabled）+ limit + offset
 *   - 同时返回 thresholds/weights/half_life_days（前端展示「多少分升级」用，严禁客户端硬编码）
 *   - POST 创建 body 至少要 target 三选一（category_id / account_id / type）
 *   - disable / enable 不可逆：disable 不自动复活，enable 回到 candidate 重攒证据
 *
 * rule 字段较多（match_key/rule_type/score/accuracy/sample_count/status/target_* 等）
 * 且状态枚举可能在 v0.3+ 调整，用 Map<String, Any?> 兜底以避免反序列化脆弱。 */

data class AiRule(
    val id: Int = 0,
    @SerializedName("match_key") val matchKey: String = "",
    @SerializedName("rule_type") val ruleType: String = "merchant_category",
    val score: Double = 0.0,
    val accuracy: Double = 0.0,
    @SerializedName("sample_count") val sampleCount: Int = 0,
    val status: String = "candidate",
    @SerializedName("target_category_id") val targetCategoryId: Int? = null,
    @SerializedName("target_account_id") val targetAccountId: Int? = null,
    @SerializedName("target_type") val targetType: String? = null,
    /** 其他未列字段（如 disabled_at/disabled_reason/last_hit_at 等）走这个兜底 */
    val extras: Map<String, Any?> = emptyMap(),
)

/** GET /ai/rules 响应体：列表 + 元数据 */
data class AiRuleListResponse(
    val rules: List<AiRule> = emptyList(),
    val total: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
    val thresholds: Map<String, Any?> = emptyMap(),
    val weights: Map<String, Any?> = emptyMap(),
    @SerializedName("half_life_days") val halfLifeDays: Int? = null,
)

/** POST /ai/rules body。三个 target 至少要传一个，否则服务端 400。 */
data class AiRuleCreatePayload(
    @SerializedName("match_key") val matchKey: String,
    @SerializedName("rule_type") val ruleType: String = "merchant_category",
    @SerializedName("target_category_id") val targetCategoryId: Int? = null,
    @SerializedName("target_account_id") val targetAccountId: Int? = null,
    @SerializedName("target_type") val targetType: String? = null,
)

/** GET /ai/rules/:id/evidence 响应体 */
data class AiRuleEvidenceResponse(
    @SerializedName("rule_id") val ruleId: Int = 0,
    val evidence: List<Map<String, Any?>> = emptyList(),
)

/** POST /ai/rules/:id/disable body（reason 可选） */
data class AiRuleDisablePayload(
    val reason: String? = null,
)

/** POST /ai/rules / disable / enable 通用响应：rule 字段较多，走 Map 兜底 */
data class AiRuleActionResponse(
    val message: String = "",
    val rule: Map<String, Any?> = emptyMap(),
)

/* ================= AI 学习统计 + 评测（/learning/stats, /evaluation/） =================
 * 契约（server/routes/ai.js）：
 *   - learning/stats: 4 个 Promise.all 查询 → {evidence, contradictions, metrics, usage, breakers}
 *     字段大多是嵌套结构 + 数字，UI 端按需挑用即可，客户端不强类型化（避免漂移）
 *   - evaluation/run: 入参 {label, persist}（persist 默认 true），响应含 metrics + regression
 *     「服务端自动取最近一次跑批作基线」—— 任何版本发布前必跑，UI 上要明显标 regressions
 *   - evaluation/runs: 历史跑批列表（最多 50 条），metrics/regression 字段是 JSON 字符串
 *
 * 全部用 Map<String, Any?> 兜底，避免 v0.3+ 字段调整导致反序列化失败。 */

data class AiLearningStatsResponse(
    val evidence: Map<String, Any?> = emptyMap(),
    val contradictions: List<Map<String, Any?>> = emptyList(),
    val metrics: Map<String, Any?> = emptyMap(),
    val usage: Map<String, Any?> = emptyMap(),
    val breakers: Map<String, Any?> = emptyMap(),
)

/** POST /ai/evaluation/run body。label 给跑批加注释，persist=false 表示不落库（CI 临时验证用） */
data class AiEvaluationRunPayload(
    val label: String? = null,
    val persist: Boolean = true,
)

/** POST /ai/evaluation/run 响应：单次跑批结果 + 与基线对比 */
data class AiEvaluationRunResponse(
    @SerializedName("run_id") val runId: Long? = null,
    val metrics: Map<String, Any?> = emptyMap(),
    val summary: Map<String, Any?> = emptyMap(),
    @SerializedName("baseline_run_id") val baselineRunId: Long? = null,
    val regression: Map<String, Any?> = emptyMap(),
    @SerializedName("failed_cases") val failedCases: List<Map<String, Any?>> = emptyList(),
)

/** GET /ai/evaluation/runs 响应：历史列表（每条 metrics/regression 都是字符串化的 JSON） */
data class AiEvaluationRunsResponse(
    val runs: List<Map<String, Any?>> = emptyList(),
)
