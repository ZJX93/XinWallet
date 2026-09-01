package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateTransactionRequest
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.data.model.TxSummary
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.TransactionRepository
import com.xinwallet.app.util.currentMonth
import com.xinwallet.app.util.todayDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class TxUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val items: List<TransactionItem> = emptyList(),
    /** 有交易的月份列表（倒序），为空时回退到当前月 */
    val months: List<String> = emptyList(),
    /** 当前选中周期：按月模式为 "YYYY-MM"，按年模式为 "YYYY" */
    val month: String = currentMonth(),
    /** 时间维度："month"（按月查看）或 "year"（按年查看） */
    val periodMode: String = "month",
    /** null = 全部；expense / income / transfer（transfer 由后端匹配两条腿） */
    val typeFilter: String? = null,
    /** 备注 / 分类名关键字搜索 */
    val search: String = "",
    /** 账户筛选：null = 全部账户 */
    val accountFilter: Int? = null,
    /** 账户筛选选项（来自账户列表） */
    val accounts: List<Account> = emptyList(),
    val summary: TxSummary? = null,
    /** 一次性提示（删除成功等） */
    val toast: String? = null,
    /** 视图模式：list（流水）默认；calendar（日历）需用户切换 */
    val viewMode: String = "list"
)

class TransactionsViewModel(
    private val repo: TransactionRepository,
    private val accountRepo: AccountRepository
) : ViewModel() {
    private val _state = MutableStateFlow(TxUiState(loading = true))
    val state: StateFlow<TxUiState> = _state

    /** 账户详情页复用：只按账户拉流水，不关心月份/类型/搜索筛选 */
    fun load(month: String? = null, accountId: Int? = null) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = repo.getTransactions(month = month, accountId = accountId, limit = 200)) {
                is ApiResult.Success -> _state.value = _state.value.copy(loading = false, items = r.data)
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }

    /** 账单页首次进入：拉账户列表 + 月份列表 + 当前月流水与汇总 */
    fun init() {
        viewModelScope.launch {
            val accounts = (accountRepo.getAccounts() as? ApiResult.Success)?.data?.accounts.orEmpty()
            val monthsResult = repo.getMonths()
            val months = (monthsResult as? ApiResult.Success)?.data.orEmpty()
            val target = months.firstOrNull() ?: currentMonth()
            _state.value = _state.value.copy(accounts = accounts, months = months, month = target)
            refresh()
        }
    }

    fun selectMonth(month: String) {
        if (month == _state.value.month) return
        _state.value = _state.value.copy(month = month)
        refresh()
    }

    /** 切换时间维度：按月 / 按年。切换后自动将 month 截取为对应精度并刷新 */
    fun setPeriodMode(mode: String) {
        if (mode == _state.value.periodMode) return
        val s = _state.value
        val newMonth = when (mode) {
            "year" -> s.month.take(4)  // "2026-08" → "2026"
            else -> {
                // 年→月：补当前月，如 "2026" → "2026-08"
                val m = s.month
                if (m.length == 4) "$m-${currentMonth().substring(5)}" else m
            }
        }
        _state.value = s.copy(periodMode = mode, month = newMonth)
        refresh()
    }

    /** 切换 流水/日历 视图模式（每次进入页面默认 list） */
    fun setViewMode(mode: String) {
        if (mode == _state.value.viewMode) return
        _state.value = _state.value.copy(viewMode = mode)
    }

    fun selectType(type: String?) {
        if (type == _state.value.typeFilter) return
        _state.value = _state.value.copy(typeFilter = type)
        refresh()
    }

    fun selectAccount(id: Int?) {
        if (id == _state.value.accountFilter) return
        _state.value = _state.value.copy(accountFilter = id)
        refresh()
    }

    /** 输入时只改状态不发请求，由 UI 在提交/防抖后调 refresh */
    fun setSearch(text: String) {
        _state.value = _state.value.copy(search = text)
    }

    /** 按当前 month + typeFilter + accountFilter + search 重新拉取流水与汇总 */
    fun refresh() {
        viewModelScope.launch {
            val s = _state.value
            _state.value = s.copy(loading = true, error = null)
            val listResult = repo.getTransactions(
                month = s.month,
                type = s.typeFilter,
                accountId = s.accountFilter,
                search = s.search,
                limit = 300
            )
            val sumResult = repo.getSummary(s.month)
            val cur = _state.value
            when (listResult) {
                is ApiResult.Success -> _state.value = cur.copy(
                    loading = false,
                    items = listResult.data,
                    summary = (sumResult as? ApiResult.Success)?.data ?: cur.summary
                )
                is ApiResult.Error -> _state.value = cur.copy(loading = false, error = listResult.message)
            }
        }
    }

    /**
     * 删除交易。转账产生的两条记录由后端按 transfer_id 联动删除，
     * 这里删完直接整页刷新，避免本地状态与账本余额不一致。
     */
    fun delete(item: TransactionItem) {
        viewModelScope.launch {
            // 折叠转账走 /transfers/{id}：语义直白（用户删的是「一笔转账」）。
            // 注：deleteTransaction 也安全 —— 服务端已按 transfer_id 级联删两条腿
            // 和 transfers 主记录（transactions.js:491-501）。区别只在语义。
            val tid = item.transfer?.id
            val r = if (tid != null) repo.deleteTransfer(tid) else repo.deleteTransaction(item.id)
            when (r) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(toast = "已删除")
                    refresh()
                }
                is ApiResult.Error -> _state.value = _state.value.copy(error = r.message)
            }
        }
    }


    fun consumeToast() {
        _state.value = _state.value.copy(toast = null)
    }

    /**
     * 复制一笔交易：以原交易同账户/分类/类型/金额/备注生成一条【新】记录，
     * 日期取今天，且去掉 link_type/link_id（避免把利息/关联交易再挂一次）。
     * 转账不支持复制（它的两条腿需走 /transfers，调用方已禁用）。
     */
    fun clone(item: TransactionItem) {
        viewModelScope.launch {
            val req = CreateTransactionRequest(
                accountId = item.account?.id ?: 0,
                categoryId = item.category?.id ?: 0,
                type = item.type,
                amount = item.amount,
                note = item.note,
                date = todayDate()
            )
            when (val r = repo.createTransaction(req)) {
                is ApiResult.Success -> _state.value = _state.value.copy(toast = "已复制为新交易")
                is ApiResult.Error -> _state.value = _state.value.copy(error = r.message)
            }
        }
    }

    fun consumeError() {
        _state.value = _state.value.copy(error = null)
    }
}
