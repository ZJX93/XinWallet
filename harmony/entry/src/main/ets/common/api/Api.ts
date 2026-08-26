/**
 * API 映射：对应安卓 ApiService.kt 的全部端点。
 * 命名与后端路径一致；复杂响应用 models 中的接口或宽松类型。
 */
import { get, post, put, del, ApiError } from '../http/Http';
import {
  ApiResponse, AuthConfig, LoginRequest, RefreshRequest, AuthResponse, UserWrapper, UpdateProfileRequest,
  Account, AccountsResponse, CreateAccountRequest, UpdateAccountRequest,
  AddAccountInterestRequest, AddAccountInterestResult,
  Category, TransactionItem, CreateTransactionRequest, UpdateTransactionRequest, TxSummary,
  Book, BooksResponse, BookIdResponse, CreateBookRequest, SwitchBookResponse,
  Dashboard, CalendarSummary, ChatRequest, ChatResponse, OcrResponse, OcrConfig,
  TranscribeRequest, TranscribeResponse, IdResponse,
  AiParseRequest, AiParseResponse, AiPredictionSnapshot,
  AiCommitRequest, AiCommitResponse, AiDiscardRequest, AiSimpleMessage
} from '../models';

/* 鉴权 */
export async function login(req: LoginRequest): Promise<ApiResponse<AuthResponse>> {
  return post<AuthResponse>('auth/login', req);
}
export async function refresh(req: RefreshRequest): Promise<ApiResponse<AuthResponse>> {
  return post<AuthResponse>('auth/refresh', req);
}
export async function demoLogin(): Promise<ApiResponse<AuthResponse>> {
  return post<AuthResponse>('auth/demo', { demo: true });
}
export async function authConfig(): Promise<ApiResponse<AuthConfig>> {
  return get<AuthConfig>('auth/config');
}
export async function profile(): Promise<ApiResponse<UserWrapper>> {
  return get<UserWrapper>('auth/profile');
}
export async function updateProfile(req: UpdateProfileRequest): Promise<ApiResponse<UserWrapper>> {
  return put<UserWrapper>('auth/profile', req);
}

/* 账户 */
export async function getAccounts(): Promise<ApiResponse<AccountsResponse>> {
  return get<AccountsResponse>('accounts');
}
export async function createAccount(req: CreateAccountRequest): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('accounts', req);
}
export async function updateAccount(id: number, req: UpdateAccountRequest): Promise<ApiResponse<object>> {
  return put<object>(`accounts/${id}`, req);
}
export async function closeAccount(id: number): Promise<ApiResponse<object>> {
  return post<object>(`accounts/${id}/close`);
}
export async function deleteAccount(id: number): Promise<ApiResponse<object>> {
  return del<object>(`accounts/${id}`);
}
export async function addAccountInterest(id: number, req: AddAccountInterestRequest): Promise<ApiResponse<AddAccountInterestResult>> {
  // 账户基础路径沿用既有账户接口写法：'accounts/{id}/interest'
  return post<AddAccountInterestResult>('accounts/' + id + '/interest', req);
}

/* 交易 */
export async function getTransactions(params: Record<string, Object>, extraHeaders?: Record<string, string>): Promise<ApiResponse<TransactionItem[]>> {
  return get<TransactionItem[]>('transactions', params, extraHeaders);
}
export async function createTransaction(req: CreateTransactionRequest): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('transactions', req);
}
export async function updateTransaction(id: number, req: UpdateTransactionRequest): Promise<ApiResponse<object>> {
  return put<object>(`transactions/${id}`, req);
}
export async function deleteTransaction(id: number): Promise<ApiResponse<object>> {
  return del<object>(`transactions/${id}`);
}
export async function getTransactionMonths(): Promise<ApiResponse<string[]>> {
  return get<string[]>('transactions/months');
}
export async function getTransactionSummary(month: string): Promise<ApiResponse<TxSummary>> {
  return get<TxSummary>('transactions/summary', { month });
}

/* 转账 */
export async function getTransfers(month?: string): Promise<ApiResponse<object[]>> {
  return get<object[]>('transfers', month ? { month } : {});
}
export async function createTransfer(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('transfers', req);
}
/**
 * 修改转账。**折叠后的转账记录必须走这里，不能走 updateTransaction。**
 *
 * 一笔转账在库里是两条 transactions 腿（transfer_out + transfer_in），
 * 列表已折叠成一条展示。若拿那条腿的 id 去调 transactions/:id，
 * 只会改动单条腿 —— 比如金额从 100 改成 200，转出账户扣了 200 而
 * 转入账户还是加 100，两个账户余额从此永久对不上。
 *
 * 服务端 PUT /transfers/:id 是**全量替换**语义：内部先 DELETE 掉该
 * transfer_id 的所有腿再重建两条，并重算涉及的全部账户余额。
 * 所以 req 必须回填完整字段（from_account_id / to_account_id / amount /
 * note / date），漏传 note 会被清成空串。
 */
export async function updateTransfer(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`transfers/${id}`, req);
}
export async function deleteTransfer(id: number): Promise<ApiResponse<object>> {
  return del<object>(`transfers/${id}`);
}

/* 分类 */
export async function getCategories(): Promise<ApiResponse<Category[]>> {
  return get<Category[]>('categories?flat=1');
}
export async function createCategory(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('categories', req);
}
export async function updateCategory(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`categories/${id}`, req);
}
export async function deleteCategory(id: number): Promise<ApiResponse<object>> {
  return del<object>(`categories/${id}`);
}

/* 理财 */
export async function getInvestmentTypes(): Promise<ApiResponse<object[]>> {
  return get<object[]>('investment-types');
}
export async function getInvestments(includeSold: boolean = false): Promise<ApiResponse<object>> {
  return get<object>('investments/investments', includeSold ? { includeSold: true } : undefined);
}
export async function createInvestment(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('investments/investments', req);
}
export async function updateInvestment(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`investments/investments/${id}`, req);
}
export async function deleteInvestment(id: number): Promise<ApiResponse<object>> {
  return del<object>(`investments/investments/${id}`);
}
export async function getInvestmentTransactions(id: number): Promise<ApiResponse<object[]>> {
  return get<object[]>(`investments/investments/${id}/transactions`);
}

export async function deleteInvestmentTransaction(investmentId: number, txnId: number): Promise<ApiResponse<object>> {
  return del<object>(`investments/investments/${investmentId}/transactions/${txnId}`);
}

/* 仪表盘 / 日历 */
export async function getDashboard(): Promise<ApiResponse<Dashboard>> {
  return get<Dashboard>('stats/dashboard');
}
export async function getStatsCalendar(year: number, month: number): Promise<ApiResponse<CalendarSummary>> {
  return get<CalendarSummary>('stats/calendar', { year, month });
}

/* AI */
export async function ocr(imageBase64: string, accountId?: number): Promise<ApiResponse<OcrResponse>> {
  // 后端约定 multipart 字段名 image；这里用 JSON 包裹 base64（与安卓 base64 方案对齐）
  // account_id 必传（走 v0.2 闭环时）：抽取器不推断账户，快照缺它 commit 阶段 422
  return post<OcrResponse>('ai/ocr', {
    image: imageBase64,
    account_id: accountId,
    platform: 'harmony'
  });
}
export async function getOcrConfig(): Promise<ApiResponse<OcrConfig>> {
  return get<OcrConfig>('ai/ocr-config');
}
export async function chat(req: ChatRequest): Promise<ApiResponse<ChatResponse>> {
  return post<ChatResponse>('ai/chat', req);
}
export async function transcribe(req: TranscribeRequest): Promise<ApiResponse<TranscribeResponse>> {
  return post<TranscribeResponse>('ai/transcribe', req);
}

/* AI v0.2 预测闭环：parse → 用户确认 → commit（AI 输出永不直接写账本） */

/** 自然语言 → 候选交易 + 字段级裁决 + 不可变预测快照；【不落账】 */
export async function aiParseTransactions(req: AiParseRequest): Promise<ApiResponse<AiParseResponse>> {
  return post<AiParseResponse>('ai/transactions/parse', req);
}

/** 读取预测快照（含 validation 字段级裁决明细，用于确认界面高亮） */
export async function aiGetPrediction(id: number): Promise<ApiResponse<AiPredictionSnapshot>> {
  return get<AiPredictionSnapshot>(`ai/predictions/${id}`);
}

/** 原子提交：事务内落账 + 状态更新 + 反馈事件；支持幂等重放 */
export async function aiCommitPrediction(id: number, req: AiCommitRequest): Promise<ApiResponse<AiCommitResponse>> {
  return post<AiCommitResponse>(`ai/predictions/${id}/commit`, req);
}

/** 弃置预测：仅记录事件，不形成负向学习 */
export async function aiDiscardPrediction(id: number, req: AiDiscardRequest): Promise<ApiResponse<AiSimpleMessage>> {
  return post<AiSimpleMessage>(`ai/predictions/${id}/discard`, req);
}

/* AI 消费洞察（v0.2.1 起合并进 /ai/advice，insights 字段随之返回）
   ⚠️ 原 /ai/insight 端点已废弃（服务端返回 410 + replacement 提示）。
     aiInsight() 已移除；调用方改用 aiAdvice() 拿 AiAdviceResponse.insights。
     AiInsightItem interface 保留供 advice 响应解析。 */

/** 单条洞察条目（与安卓 AiInsightItem 对齐） */
export interface AiInsightItem {
  title: string;
  description: string;
  action: string;
  level: 'warning' | 'info' | 'tip';
}

/* 预算 */
export async function getBudgets(): Promise<ApiResponse<object[]>> {
  return get<object[]>('budgets');
}
export async function createBudget(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('budgets', req);
}
export async function updateBudget(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`budgets/${id}`, req);
}
export async function deleteBudget(id: number): Promise<ApiResponse<object>> {
  return del<object>(`budgets/${id}`);
}

/* 储蓄目标 */
export async function getSavingsGoals(): Promise<ApiResponse<object[]>> {
  return get<object[]>('savings-goals');
}
export async function createSavingsGoal(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('savings-goals', req);
}
export async function updateSavingsGoal(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`savings-goals/${id}`, req);
}
export async function deleteSavingsGoal(id: number): Promise<ApiResponse<object>> {
  return del<object>(`savings-goals/${id}`);
}
export async function allocateSavings(id: number, req: object): Promise<ApiResponse<object>> {
  return post<object>(`savings-goals/${id}/allocate`, req);
}
export async function withdrawSavings(id: number, req: object): Promise<ApiResponse<object>> {
  return post<object>(`savings-goals/${id}/withdraw`, req);
}
export async function getSavingsTxns(id: number): Promise<ApiResponse<object>> {
  return get<object>(`savings-goals/${id}/transactions`);
}

/* 债务 */
export async function getDebts(): Promise<ApiResponse<object>> {
  return get<object>('debts');
}
export async function createDebt(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('debts', req);
}
export async function updateDebt(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`debts/${id}`, req);
}
export async function deleteDebt(id: number): Promise<ApiResponse<object>> {
  return del<object>(`debts/${id}`);
}
export async function getDebt(id: number): Promise<ApiResponse<object>> {
  return get<object>(`debts/${id}`);
}
export async function createRepayment(id: number, req: object): Promise<ApiResponse<object>> {
  return post<object>(`debts/${id}/repayments`, req);
}
export async function deleteRepayment(id: number, rid: number): Promise<ApiResponse<object>> {
  return del<object>(`debts/${id}/repayments/${rid}`);
}

/* 报表 */
export async function getReport(type: string, period: string): Promise<ApiResponse<object>> {
  return get<object>('reports', { type, period });
}
export async function getTopTransactions(type: string, period: string): Promise<ApiResponse<object>> {
  return get<object>('reports/top-transactions', { type, period });
}

/* 标签 */
export async function getTags(): Promise<ApiResponse<object[]>> {
  return get<object[]>('tags');
}
export async function createTag(req: object): Promise<ApiResponse<IdResponse>> {
  return post<IdResponse>('tags', req);
}
export async function updateTag(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`tags/${id}`, req);
}
export async function deleteTag(id: number): Promise<ApiResponse<object>> {
  return del<object>(`tags/${id}`);
}

/* 多账本 */
export async function getBooks(): Promise<ApiResponse<BooksResponse>> {
  return get<BooksResponse>('books');
}
export async function createBook(req: CreateBookRequest): Promise<ApiResponse<BookIdResponse>> {
  return post<BookIdResponse>('books', req);
}
export async function updateBook(id: number, req: object): Promise<ApiResponse<object>> {
  return put<object>(`books/${id}`, req);
}
export async function switchBook(id: number): Promise<ApiResponse<SwitchBookResponse>> {
  return post<SwitchBookResponse>(`books/${id}/switch`);
}
export async function deleteBook(id: number): Promise<ApiResponse<object>> {
  return del<object>(`books/${id}`);
}

/* 账本备份（xlsx 3 工作表，服务端生成/解析） */
import { Session } from '../store/Session';
import { downloadFileTo, uploadFileFrom } from '../http/Http';

/** 导出账本备份为 xlsx，返回本地保存路径 */
export async function exportBackup(): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const cacheDir = Session.getCacheDir();
  const savePath = `${cacheDir}/xinwallet_backup_${date}.xlsx`;
  await downloadFileTo('backup/export', savePath);
  return savePath;
}

/** 导入账本备份（xlsx 文件路径，服务端解析恢复） */
export async function importBackup(filePath: string): Promise<ApiResponse<object>> {
  return uploadFileFrom('backup/import', filePath);
}

/* AI 服务商配置：与安卓 AiProvider / AiProviderPayload / AiProviderTestResponse 对齐。
 * 契约（server/routes/ai.js validateProvider）：
 *   - name / base_url / model 必填；api_type ∈ {openai, anthropic}
 *   - GET 列表返回的 apiKey 是服务端 maskKey 掩码（如 sk-****abcd），不可回传
 *   - PUT 时 apiKey 留空字符串 = 不修改原 key（服务端按 trim 判定）
 *   - 测试连接返回 {ok, reply} 或 {ok:false, error} —— 调用方按 ok 判定结果 */

export interface AiProvider {
  id: number;
  name: string;
  api_type: 'openai' | 'anthropic';
  base_url: string;
  /** 服务端返回的是掩码值；新建/修改时若传原值则会被加密入库 */
  api_key: string;
  model: string;
  is_active: boolean;
  sort_order: number;
}

export interface AiProviderListResponse {
  providers: AiProvider[];
}

export interface AiProviderPayload {
  name: string;
  api_type: 'openai' | 'anthropic';
  base_url: string;
  api_key: string;
  model: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface AiProviderTestResponse {
  ok: boolean;
  reply?: string;
  error?: string;
}

export interface AiProviderActivateResponse {
  activated: boolean;
}

/** GET /ai/providers —— 列表；apiKey 是掩码 */
export async function aiProviders(): Promise<ApiResponse<AiProviderListResponse>> {
  return get<AiProviderListResponse>('ai/providers');
}

/** POST /ai/providers —— 创建（name/apiType/baseUrl/model/apiKey 必填） */
export async function aiProviderCreate(req: AiProviderPayload): Promise<ApiResponse<null>> {
  return post<null>('ai/providers', req);
}

/** PUT /ai/providers/:id —— 更新；apiKey 为空字符串则保留原值 */
export async function aiProviderUpdate(id: number, req: AiProviderPayload): Promise<ApiResponse<null>> {
  return put<null>(`ai/providers/${id}`, req);
}

/** DELETE /ai/providers/:id —— 删除 */
export async function aiProviderDelete(id: number): Promise<ApiResponse<null>> {
  return del<null>(`ai/providers/${id}`);
}

/** POST /ai/providers/:id/activate —— 激活（单选语义：会先把其他置为 inactive） */
export async function aiProviderActivate(id: number): Promise<ApiResponse<AiProviderActivateResponse>> {
  return post<AiProviderActivateResponse>(`ai/providers/${id}/activate`, {});
}

/** POST /ai/providers/:id/test —— 测试连通性（服务端实际发一次"回复 OK"调用） */
export async function aiProviderTest(id: number): Promise<ApiResponse<AiProviderTestResponse>> {
  return post<AiProviderTestResponse>(`ai/providers/${id}/test`, {});
}

/* AI 财务建议：与 insight 同源，输出多 impact + priority 三态（high/medium/low） */

export interface AiAdviceItem {
  title: string;
  content: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AiAdviceResponse {
  advice: AiAdviceItem[];
  generated_at?: string;
}

/** POST /ai/advice —— 入参为空，服务端固定取本月+上月环比；需已激活服务商 */
export async function aiAdvice(): Promise<ApiResponse<AiAdviceResponse>> {
  return post<AiAdviceResponse>('ai/advice', {});
}

/* AI 规则（/ai/rules 系列）：用户可手动管理（验收 #6「用户可 disable」客户端路径）。
 * 契约（server/routes/ai.js）：
 *   - GET 列表支持 status 过滤 + limit/offset；同时返回 thresholds/weights/half_life_days
 *   - POST 创建 body 至少要 target 三选一（category_id / account_id / type）
 *   - disable / enable 不可逆：disable 不自动复活，enable 回到 candidate 重攒证据
 *
 * ⚠️ listRules 返回 thresholds / weights / half_life_days 必须一并展示给用户，
 * 客户端硬编码阈值会与后端漂移（v0.2 验收铁律）。 */

export interface AiRule {
  id: number;
  match_key: string;
  rule_type: string;
  score: number;
  accuracy: number;
  sample_count: number;
  status: 'candidate' | 'verified' | 'trusted' | 'degraded' | 'disabled';
  target_category_id?: number | null;
  target_account_id?: number | null;
  target_type?: 'expense' | 'income' | 'transfer' | null;
  /** 状态枚举字段较多且可能在 v0.3+ 调整，用 ESObject 兜底接住所有未列字段 */
  extras?: ESObject;
}

export interface AiRuleListResponse {
  rules: AiRule[];
  total: number;
  limit: number;
  offset: number;
  /** 「多少分能升级」阈值，前端必须用这个展示，禁止硬编码 */
  thresholds: ESObject;
  weights: ESObject;
  half_life_days?: number;
}

export interface AiRuleCreatePayload {
  match_key: string;
  rule_type?: string;
  target_category_id?: number | null;
  target_account_id?: number | null;
  target_type?: 'expense' | 'income' | 'transfer' | null;
}

export interface AiRuleActionResponse {
  message: string;
  rule: ESObject;
}

export interface AiRuleEvidenceItem {
  id?: number;
  rule_id?: number;
  evidence_type?: string;
  score_delta?: number;
  source?: string;
  transaction_id?: number | null;
  raw_segment?: string;
  note?: string;
  occurred_at?: string;
}

export interface AiRuleEvidenceResponse {
  rule_id: number;
  evidence: AiRuleEvidenceItem[];
}

/** GET /ai/rules —— 列表 + 元数据；status 可空（返回所有） */
export async function aiRules(status?: string, limit: number = 100, offset: number = 0): Promise<ApiResponse<AiRuleListResponse>> {
  return get<AiRuleListResponse>('ai/rules', { status: status || '', limit, offset });
}

/** POST /ai/rules —— 创建规则。三个 target 至少要传一个 */
export async function aiRuleCreate(req: AiRuleCreatePayload): Promise<ApiResponse<AiRuleActionResponse>> {
  return post<AiRuleActionResponse>('ai/rules', req);
}

/** POST /ai/rules/:id/disable —— 停用；reason 可选（200 字内） */
export async function aiRuleDisable(id: number, reason?: string): Promise<ApiResponse<AiRuleActionResponse>> {
  return post<AiRuleActionResponse>(`ai/rules/${id}/disable`, { reason: reason || '' });
}

/** POST /ai/rules/:id/enable —— 重新启用（回到 candidate 重攒证据） */
export async function aiRuleEnable(id: number): Promise<ApiResponse<AiRuleActionResponse>> {
  return post<AiRuleActionResponse>(`ai/rules/${id}/enable`, {});
}

/** GET /ai/rules/:id/evidence —— 证据流水 */
export async function aiRuleEvidence(id: number, limit: number = 50): Promise<ApiResponse<AiRuleEvidenceResponse>> {
  return get<AiRuleEvidenceResponse>(`ai/rules/${id}/evidence`, { limit });
}

/* AI 学习统计 + 评测（/learning/stats, /evaluation/*）：
 * 字段都用 ESObject 兜底 —— 这一组查询结果结构嵌套深、版本演进快，
 * 客户端不强类型化，避免 v0.3+ 字段调整时反序列化失败。
 *
 * ⚠️ evaluation/run 是「离线跑批」：纯本地 CPU，不依赖对话服务商，但可能耗时数秒，
 * UI 上要明确告知用户「正在跑评测」并禁用按钮。 */

export interface AiLearningStatsResponse {
  evidence: ESObject;
  contradictions: ESObject[];
  metrics: ESObject;
  usage: ESObject;
  breakers: ESObject;
}

export interface AiEvaluationRunPayload {
  label?: string;
  /** 默认 true 落库；CI 临时验证可传 false 不留痕 */
  persist?: boolean;
}

export interface AiEvaluationRunResponse {
  run_id?: number;
  metrics: ESObject;
  summary: ESObject;
  baseline_run_id?: number;
  regression: ESObject;
  failed_cases: ESObject[];
}

export interface AiEvaluationRunsResponse {
  runs: ESObject[];
}

/** GET /ai/learning/stats —— 4 个 Promise.all 查询合一 */
export async function aiLearningStats(): Promise<ApiResponse<AiLearningStatsResponse>> {
  return get<AiLearningStatsResponse>('ai/learning/stats');
}

/** POST /ai/evaluation/run —— 跑一次离线评测 */
export async function aiEvaluationRun(req: AiEvaluationRunPayload = {}): Promise<ApiResponse<AiEvaluationRunResponse>> {
  return post<AiEvaluationRunResponse>('ai/evaluation/run', req);
}

/** GET /ai/evaluation/runs —— 历史跑批列表 */
export async function aiEvaluationRuns(limit: number = 10): Promise<ApiResponse<AiEvaluationRunsResponse>> {
  return get<AiEvaluationRunsResponse>('ai/evaluation/runs', { limit });
}

/* OCR 重转录（POST /ai/ocr/retranscribe）：
 * 与 /ai/ocr 字段一致，但服务端强制走 tencent_ocr 引擎。
 * ⚠️ 服务端同时接受 JSON body（req.body.image）+ multipart，本模块与 ocr() 保持一致走 JSON 路径，
 * 避免引入新 multipart 上传通道（鸿蒙 uploadFileFrom 不支持 form 字段拼接）。
 *
 * force 可空（默认 tencent_ocr）；传 "model" 可强制大模型多模态（CI 调试用）。
 * 用户在识别结果页看到「识别有误」时点「重识别」按钮触发。 */

export async function aiOcrRetranscribe(imageBase64: string, force?: string): Promise<ApiResponse<OcrResponse>> {
  return post<OcrResponse>('ai/ocr/retranscribe', {
    image: imageBase64,
    force: force || 'tencent_ocr',
  });
}

export { ApiError };
