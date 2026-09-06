/**
 * 数据契约：镜像安卓端 ApiService.kt / Models.kt 的接口与数据结构。
 * 字段命名与后端 JSON 保持一致（后端用 snake_case，序列化后安卓用 @SerializedName 映射；
 * 鸿蒙端直接按后端原始字段名定义，便于 JSON.parse）。
 */

/** 统一响应包装：{ success, data, message } */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/* ----------------------------- 鉴权 ----------------------------- */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface DemoRequest {
  demo?: boolean;
}

export interface User {
  id?: number;
  username?: string;
  nickname?: string;
  email?: string;
  avatar?: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user?: User;
}

/** 登录页配置：服务端是否开启演示账号（ALLOW_DEMO=true） */
export interface AuthConfig {
  allowDemo: boolean;
}

export interface UserWrapper {
  user?: User;
}

export interface IdResponse {
  id: number;
}

export interface UpdateProfileRequest {
  username?: string;
  nickname?: string;
  avatar?: string;
  oldPassword?: string;
  newPassword?: string;
}

/* ----------------------------- 账户 ----------------------------- */

export interface Account {
  id: number;
  code?: string;
  name: string;
  type: string;
  icon?: string;
  balance: number;
  opening_balance?: number;
  credit_limit?: number;
  is_default?: boolean;
  status?: string;
  sort_order?: number;
  annual_rate?: number;
  interest_cycle?: string;
  last_interest_date?: string;
}

export interface AccountsResponse {
  accounts: Account[];
  totalAssets?: number;
}

export interface CreateAccountRequest {
  name: string;
  type: string;
  icon?: string;
  opening_balance?: number;
  credit_limit?: number;
  annual_rate?: number;
  interest_cycle?: string;
}

export interface UpdateAccountRequest {
  name: string;
  type: string;
  icon?: string;
  opening_balance?: number;
  credit_limit?: number;
  annual_rate?: number;
  interest_cycle?: string;
}

/** 账户计息请求体：{ amount 必填正数, date 可选 YYYY-MM-DD, note 可选 } */
export interface AddAccountInterestRequest {
  amount: number;
  date?: string;
  note?: string;
}

/** 账户计息返回数据：{ balance 新余额, last_interest_date 上次计息日期 } */
export interface AddAccountInterestResult {
  balance: number;
  last_interest_date?: string;
}

/* ----------------------------- 分类 ----------------------------- */

export interface Category {
  id: number;
  code?: string;
  parent_id?: number;
  user_id?: number;
  name: string;
  type: string;
  icon?: string;
  color?: string;
  is_system?: boolean;
  sort_order?: number;
}

/* ----------------------------- 交易 ----------------------------- */

export interface TxRef {
  id: number;
  name: string;
  icon?: string;
}

export interface TxCounterparty {
  dir?: string;
  name: string;
  icon?: string;
}

export interface TxTag {
  id: number;
  name: string;
  color?: string;
  icon?: string;
}

/**
 * 折叠后的转账双端信息（服务端 transactions.js 的 transfer 字段）。
 *
 * 一笔转账在库里是两条腿（transfer_out + transfer_in），列表已在 SQL 层折叠成
 * 一条。这个字段让那一条记录能自己表达完整的「A → B」，同时告诉客户端：
 * 编辑/删除要走 /transfers/:id —— 只改单条腿会让两个账户余额对不上。
 */
export interface TxTransfer {
  id: number;
  from: TxRef;
  to: TxRef;
}

export interface TransactionItem {
  id: number;
  type: string;
  amount: number;
  /** 多币种 P2-3c：每笔交易的币种（后端 transactions.js 列表/单条/ledger 已 LEFT JOIN accounts.currency 并兜底 'CNY'）。调用 TransactionRow 时不传 currency prop 即可让它自动取此字段。 */
  currency?: string;
  note?: string;
  date: string;
  location?: string;
  link_type?: string;
  link_id?: number;
  category?: TxRef;
  account?: TxRef;
  source?: TxRef;
  destination?: TxRef;
  counterparty?: TxCounterparty;
  transfer_id?: number;
  /** 非空即代表这是折叠后的转账记录，编辑/删除须走 /transfers/:id */
  transfer?: TxTransfer;
  tags?: TxTag[];
}

export interface Transaction {
  id: number;
  user_id?: number;
  account_id?: number;
  category_id?: number;
  type: string;
  amount: number;
  /** 多币种 P2-3c：扁平格式也带币种（dashboard 等接口 SELECT t.* 已带 currency） */
  currency?: string;
  note?: string;
  date: string;
  cat_name?: string;
  cat_icon?: string;
  acc_name?: string;
  acc_icon?: string;
}

export interface CreateTransactionRequest {
  account_id: number;
  category_id: number;
  type: string;
  amount: number;
  /**
   * 多币种 P2-3c：新建交易时显式带币种。后端优先级 body.currency > 关联账户 currency > 'CNY'；
   * 旧客户端不传时后端会按账户币种兜底，向后兼容。
   */
  currency?: string;
  note?: string;
  date: string;
  location?: string;
  link_type?: string;
  link_id?: number;
  /** AI/OCR 场景传入的商家或个人对象；服务端会自动按「类目名-merchant」格式拼接备注 */
  merchant?: string;
}

export interface UpdateTransactionRequest {
  account_id: number;
  category_id: number;
  type: string;
  amount: number;
  /**
   * 多币种 P2-3c：编辑交易时允许改币种。后端优先级 body.currency > 新账户 currency > 老 currency > 'CNY'。
   */
  currency?: string;
  note?: string;
  date: string;
  location?: string;
  link_type?: string;
  link_id?: number;
  /** 同 CreateTransactionRequest：可选，AI/OCR 编辑场景透传给服务端拼接 */
  merchant?: string;
}

/* ----------------------------- 债务明细 ----------------------------- */
export interface RepaymentItem {
  id?: number;
  debt_id?: number;
  amount?: number;
  paid_at?: string;
  /** 多币种 P2-3b：还款币种（debt_repayments 表 P2-2d 加的 currency 列） */
  currency?: string;
}
export interface DebtDetail {
  repayments?: RepaymentItem[];
}

/* ----------------------------- 汇总/报表 ----------------------------- */

export interface CategoryTotal {
  id: number;
  name: string;
  icon?: string;
  parent_id?: number;
  total: number;
}

export interface TxSummary {
  income: number;
  expense: number;
  balance: number;
  /**
   * 多币种 P2-3c：单值 income/expense/balance 在混币种账本下不再有意义（跨币种累加本就是错的）。
   * 后端按 currency GROUP BY 后回填这两个 breakdown，前端用 fmtMoneyMix 智能混显。
   * 老客户端只读 income/expense/balance 仍工作（fallback 单值，无数据则为零）；新客户端优先 breakdown。
   */
  currency?: string;
  incomeBreakdown?: Record<string, number>;
  expenseBreakdown?: Record<string, number>;
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
}

export interface Dashboard {
  monthIncome?: number;
  monthExpense?: number;
  balance?: number;
  recentTransactions?: Transaction[];
  budgetUsage?: object;
  [key: string]: Object;
}

export interface CalendarDay {
  date: string;
  income: number;
  expense: number;
  hasRecord: boolean;
}

export interface CalendarSummary {
  year: number;
  month: number;
  monthDays: CalendarDay[];
  monthSummary?: object;
}

/* ----------------------------- 多账本 ----------------------------- */

export interface Book {
  id: number;
  name: string;
  icon?: string;
  type?: string;
  currency?: string;
  is_default?: boolean;
  created_at?: string;
}

export interface BooksResponse {
  books: Book[];
  currentBookId: number;
}

export interface BookIdResponse {
  id: number;
}

export interface CreateBookRequest {
  name: string;
  icon?: string;
}

export interface SwitchBookResponse {
  bookId: number;
}

/* ----------------------------- AI ----------------------------- */

export interface ChatMessage {
  role: string;
  content: string;
  type?: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  imageBase64?: string;
}

export interface ChatResponse {
  reply: string;
  transactions?: TransactionItem[];
  [key: string]: Object;
}

export interface AiSettingsResponse {
  settings: {
    /** web 端给 AI 起的名字（后端字段名 ai_name，下划线）；空串表示未起名（客户端回退「小鑫」/「AI」） */
    ai_name: string;
    [key: string]: Object;
  };
}

export interface OcrResponse {
  /* v0.2 预测闭环字段（/ai/ocr 识别出交易时返回；识别不出时缺失 → undefined） */
  prediction_id?: number;
  /** 实际是 AiCandidateTxn 形状（与 /ai/transactions/parse 同构） */
  transactions?: AiCandidateTxn[];
  verdict?: string;
  overall_confidence?: number;
  reasons?: string[];
  needs_confirmation?: boolean;
  transcribe_source?: string;
  /* 通用字段 */
  text?: string;
  reason?: string;
  [key: string]: Object;
}

export interface OcrConfig {
  configured?: boolean;
  [key: string]: Object;
}

export interface TranscribeRequest {
  audio: string; // base64
  format?: string;
}

export interface TranscribeResponse {
  text: string;
}

/* ------------------- AI v0.2 预测闭环（parse → 确认 → commit） -------------------
 * 核心原则：AI 输出【永不直接写账本】。
 * parse 只产出不可变预测快照，用户确认/修正后 commit 才原子落账。
 * 与上方 legacy ChatRequest/ChatResponse（后端 function calling 直写）并存。
 */

/** source 是【输入通道】，必须是 parse/chat/ocr/voice（受服务端 CHECK 约束）；平台放 context.platform */
export interface AiParseRequest {
  text: string;
  context?: AiParseContext;
  source?: string;
}

export interface AiParseContext {
  account_id?: number;
  /** yyyy-MM-dd，让服务端以客户端本地「今天」为基准 */
  date?: string;
  platform?: string;
}

/** 字段级置信度 / 证据链：键为 amount/type/category/date/currency/merchant */
export interface AiConfidenceMap {
  amount?: number;
  type?: number;
  category?: number;
  date?: number;
  currency?: number;
  merchant?: number;
}

export interface AiEvidenceMap {
  amount?: string;
  type?: string;
  category?: string;
  date?: string;
  currency?: string;
  merchant?: string;
}

/**
 * 候选交易。amount 保证 > 0；category_id / account_id / merchant 可能为空。
 * date 是 10 字符纯日期（yyyy-MM-dd），不带时间部分。
 */
export interface AiCandidateTxn {
  seq: number;
  /** income | expense | transfer */
  type: string;
  amount: number;
  currency?: string;
  merchant?: string;
  category_id?: number;
  category_name?: string;
  account_id?: number;
  from_account_id?: number;
  to_account_id?: number;
  date?: string;
  note?: string;
  raw_segment?: string;
  confidence?: AiConfidenceMap;
  evidence?: AiEvidenceMap;
}

export interface AiParseResponse {
  prediction_id: number;
  transactions: AiCandidateTxn[];
  /** ready | needs_confirmation */
  verdict: string;
  overall_confidence?: number;
  reasons?: string[];
  /** 据此决定是否必须弹确认；禁止拿 overall_confidence 自行比阈值 */
  needs_confirmation: boolean;
}

export interface AiFieldVerdict {
  score: number;
  threshold: number;
  ok: boolean;
}

export interface AiPerFieldMap {
  amount?: AiFieldVerdict;
  type?: AiFieldVerdict;
  category?: AiFieldVerdict;
  date?: AiFieldVerdict;
  merchant?: AiFieldVerdict;
}

export interface AiTxnValidation {
  seq: number;
  verdict: string;
  overall?: number;
  reasons?: string[];
  per_field?: AiPerFieldMap;
}

/** 字段级裁决结果；判定权在服务端，客户端只做展示 */
export interface AiValidation {
  verdict: string;
  overall?: number;
  reasons?: string[];
  per_txn?: AiTxnValidation[];
}

export interface AiPredictionSnapshot {
  prediction_id: number;
  /** pending | committed | discarded */
  status: string;
  verdict: string;
  source?: string;
  transactions?: AiCandidateTxn[];
  validation?: AiValidation;
  committed_at?: string;
  created_at?: string;
}

/**
 * action=confirmed 时不传 transactions，服务端直接采用不可变快照；
 * action=corrected 时必须传修正后的完整数组。
 */
export interface AiCommitRequest {
  action: string;
  transactions?: AiCandidateTxn[];
  idempotency_key?: string;
}

/** 落账结果。transfer 的 id 是 transfer_id，不是 transaction_id。 */
export interface AiCommittedTxn {
  id: number;
  seq: number;
  type: string;
  amount: number;
  category_id?: number;
  account_id?: number;
  from_account_id?: number;
  to_account_id?: number;
}

export interface AiCommitResponse {
  message: string;
  prediction_id: number;
  transactions: AiCommittedTxn[];
}

export interface AiDiscardRequest {
  reason?: string;
}

export interface AiSimpleMessage {
  message: string;
}

/* ----------------------------- 通用列表包装 ----------------------------- */

export interface ListResponse<T> {
  list?: T[];
  items?: T[];
  [key: string]: Object;
}

/* ----------------------------- 写入请求（页面本地构造） ----------------------------- */

export interface TagRequest {
  name: string;
  icon?: string;
  color?: string;
}

export interface BudgetRequest {
  name: string;
  amount: number;
  period: string;
}

export interface DebtRequest {
  name: string;
  type: string;
  principal: number;
  monthlyPayment: number;
}

export interface SavingsGoalRequest {
  name: string;
  icon?: string;
  target: number;
  accountId?: number;
}

/* ----------------------------- 首页卡片复用实体 ----------------------------- */

/** 预算实体（首页预算卡与预算管理页共用） */
/** 预算。多币种 P2-3b：amount 是 CNY 单货币（budgets.js / reports.js 一致），actual 按交易账户币种分布 */
export interface Budget {
  id: number;
  name: string;
  amount: number;
  period?: string;
  startDate?: string;
  spent?: number;
  used?: number;
  /** 多币种 P2-3b：actual 主货币 */
  currency?: string;
  /** 多币种 P2-3b：actual 按交易账户币种分布 */
  actualBreakdown?: Record<string, number>;
}

/** 储蓄目标实体（首页目标卡与储蓄目标页共用）。多币种 P2-3b：跟随关联储蓄账户 currency */
export interface Goal {
  id: number;
  name: string;
  icon?: string;
  accountId?: number;
  current?: number;
  target?: number;
  /** 多币种 P2-3b：储蓄目标币种（跟随关联账户） */
  currency?: string;
}

/** 分类支出聚合项（首页分类榜卡本地聚合产物） */
export interface CategoryStat {
  name: string;
  icon: string;
  amount: number;
  ratio: number;
}
