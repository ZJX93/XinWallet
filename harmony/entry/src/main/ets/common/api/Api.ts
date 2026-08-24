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
  TranscribeRequest, TranscribeResponse, IdResponse
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
export async function ocr(imageBase64: string): Promise<ApiResponse<OcrResponse>> {
  // 后端约定 multipart 字段名 image；这里用 JSON 包裹 base64（与安卓 base64 方案对齐）
  return post<OcrResponse>('ai/ocr', { image: imageBase64 });
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

export { ApiError };
