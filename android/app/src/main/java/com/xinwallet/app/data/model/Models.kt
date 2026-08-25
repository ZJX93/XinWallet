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
    val reason: String? = null
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

/** GET /ai/ocr-config：判断是否已配置腾讯云 OCR 密钥 */
data class OcrConfig(
    val provider: String? = null,
    @SerializedName("secret_id") val secretId: String? = null,
    val region: String? = null,
    val credentialsValid: Boolean? = null,
    val credentialsError: String? = null
) {
    /** secret_id 为空表示尚未配置 */
    val configured: Boolean get() = !secretId.isNullOrBlank()
}

/* ----------------------------- AI 对话记账 ----------------------------- */

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
    @SerializedName("savingsRate") val savingsRate: Double = 0.0
)

data class AmountOnly(val expense: Double = 0.0)
data class IncomeExpense(val income: Double = 0.0, val expense: Double = 0.0)
data class MonthTrend(val month: String = "", val income: Double = 0.0, val expense: Double = 0.0)
data class InvData(
    @SerializedName("totalCost") val totalCost: Double = 0.0,
    @SerializedName("totalValue") val totalValue: Double = 0.0,
    @SerializedName("totalProfit") val totalProfit: Double = 0.0,
    val holdings: List<HoldingRow> = emptyList()
)
data class BudgetRow(
    val id: Int = 0,
    val name: String = "",
    @SerializedName("start_date") val startDate: String = "",
    @SerializedName("end_date") val endDate: String = "",
    val amount: Double = 0.0,
    val actual: Double = 0.0
)
data class SavingGoal(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = "🎯",
    @SerializedName("target_amount") val targetAmount: Double = 0.0,
    @SerializedName("current_amount") val currentAmount: Double = 0.0,
    val status: String = "active",
    @SerializedName("account_id") val accountId: Int? = null,
    @SerializedName("acc_name") val accName: String? = null,
    @SerializedName("source_account_id") val sourceAccountId: Int? = null,
    @SerializedName("source_acc_name") val sourceAccName: String? = null,
    val note: String? = null
)
data class HoldingRow(
    val name: String = "",
    val code: String? = null,
    @SerializedName("total_cost") val totalCost: Double = 0.0,
    @SerializedName("current_value") val currentValue: Double = 0.0,
    val profit: Double = 0.0,
    @SerializedName("profit_rate") val profitRate: Double = 0.0,
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
    val activeCount: Int = 0
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

/** 月度预算执行（结余 tab 展示） */
data class ReportBudgetExec(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = "💰",
    val budget: Double = 0.0,
    val actual: Double = 0.0,
    val usage: Double = 0.0
)

data class ReportSummary(
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val balance: Double = 0.0,
    @SerializedName("savingsRate") val savingsRate: Double = 0.0,
    @SerializedName("transactionCount") val transactionCount: Int = 0,
    @SerializedName("avgDailyExpense") val avgDailyExpense: Double = 0.0
)

/** 分类占比切片（支出/收入共用）。total 即该分类在周期内的发生额。 */
data class ReportCategorySlice(
    val id: Int = 0,
    val name: String = "",
    val icon: String? = null,
    @SerializedName("parent_id") val parentId: Int? = null,
    val total: Double = 0.0
)

data class DailyTrendPoint(
    val date: String = "",
    val income: Double = 0.0,
    val expense: Double = 0.0
)

data class TopExpense(
    val id: Int = 0,
    val date: String = "",
    val amount: Double = 0.0,
    val note: String? = null,
    @SerializedName("category_name") val categoryName: String? = null,
    @SerializedName("category_icon") val categoryIcon: String? = null
)

/** 环比：与上个周期对比 */
data class ReportCompare(
    val period: String = "",
    val label: String = "",
    val income: Double = 0.0,
    val expense: Double = 0.0,
    val balance: Double = 0.0
)

/** GET /reports/top-transactions 返回：按 type 取 Top5 交易 */
data class TopTransactionsResponse(
    val items: List<TopTransaction> = emptyList()
)

data class TopTransaction(
    val id: Int = 0,
    val date: String = "",
    val amount: Double = 0.0,
    val note: String? = null,
    @SerializedName("category_name") val categoryName: String? = null,
    @SerializedName("category_icon") val categoryIcon: String? = null
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
