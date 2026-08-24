package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.Budget
import com.xinwallet.app.data.model.Category
import com.xinwallet.app.data.model.CreateTransactionRequest
import com.xinwallet.app.data.model.CreateTransferRequest
import com.xinwallet.app.data.model.Tag
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.data.model.Transfer
import com.xinwallet.app.data.model.UpdateTransactionRequest
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.BudgetRepository
import com.xinwallet.app.data.repository.CategoryRepository
import com.xinwallet.app.data.repository.TagRepository
import com.xinwallet.app.data.repository.TransactionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AddTxUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    val accounts: List<Account> = emptyList(),
    val categories: List<Category> = emptyList(),
    /** 已加载预算列表（用于「关联预算」chip 与 transactions.budget_id 持久化） */
    val budgets: List<Budget> = emptyList(),
    /** 已加载标签列表（用于「关联标签」chip 与 transaction_tags 持久化） */
    val tags: List<Tag> = emptyList(),
    /** 编辑模式下加载到的原始交易，UI 用它做表单预填 */
    val editing: TransactionItem? = null,
    /**
     * 转账编辑模式下加载到的原始转账记录（来自 GET /transfers），UI 据此预填转出/转入/金额/备注/日期。
     * 与 [editing] 互斥：普通交易走 editing，折叠转账走这里。
     */
    val editingTransfer: Transfer? = null
)

class AddTransactionViewModel(
    private val txRepo: TransactionRepository,
    private val accRepo: AccountRepository,
    private val catRepo: CategoryRepository,
    private val budgetRepo: BudgetRepository,
    private val tagRepo: TagRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AddTxUiState(loading = true))
    val state: StateFlow<AddTxUiState> = _state

    /**
     * 加载账户、分类、预算、标签选项。
     * 编辑模式下额外按 month 拉一次流水，从中定位到 editId 对应的交易做预填
     * （后端没有 GET /transactions/:id，用月份过滤的列表定位是最省事且确定的做法）。
     *
     * [transferId] 非空时进入**转账编辑模式**：改从 GET /transfers 定位记录。
     * 不能复用交易列表 —— 列表里那条折叠转账的 id 只是 transfer_out 那条腿的 id，
     * 拿它去 PUT /transactions/:id 只会改一条腿，两个账户余额会永久对不上。
     */
    fun loadOptions(editId: Int? = null, month: String? = null, transferId: Int? = null) {
        viewModelScope.launch {
            val acc = accRepo.getAccounts()
            val cat = catRepo.getCategories()
            val bud = budgetRepo.getBudgets()
            val tag = tagRepo.getTags()
            val accList = (acc as? ApiResult.Success)?.data?.accounts ?: emptyList()
            val catList = (cat as? ApiResult.Success)?.data ?: emptyList()
            val budList = (bud as? ApiResult.Success)?.data ?: emptyList()
            val tagList = (tag as? ApiResult.Success)?.data ?: emptyList()

            var editing: TransactionItem? = null
            var editingTransfer: Transfer? = null
            var loadError: String? = null
            if (transferId != null && transferId > 0) {
                // 先按月份缩小范围；月份不匹配（跨月改过日期、或调用方没带 month）时再全量兜底找一次
                val byMonth = (txRepo.getTransfers(month) as? ApiResult.Success)?.data
                editingTransfer = byMonth?.find { it.id == transferId }
                    ?: (txRepo.getTransfers(null) as? ApiResult.Success)?.data?.find { it.id == transferId }
                if (editingTransfer == null) loadError = "未找到该转账，可能已被删除"
            } else if (editId != null && editId > 0) {
                val list = txRepo.getTransactions(month = month, limit = 300)
                editing = (list as? ApiResult.Success)?.data?.find { it.id == editId }
                if (editing == null) loadError = "未找到该交易，可能已被删除"
            }
            _state.value = _state.value.copy(
                loading = false,
                accounts = accList,
                categories = catList,
                budgets = budList,
                tags = tagList,
                editing = editing,
                editingTransfer = editingTransfer,
                error = loadError
            )
        }
    }

    fun submitExpense(accountId: Int, categoryId: Int, amount: Double, note: String, type: String, date: String,
                      location: String? = null, linkType: String? = null, linkId: Int? = null,
                      budgetId: Int? = null, tagIds: List<Int>? = null) {
        val dt = normalizeDateTime(date)
        submit { txRepo.createTransaction(
            CreateTransactionRequest(accountId, categoryId, type, amount, note, dt, location, linkType, linkId, budgetId, tags = tagIds)
        ).toUnit() }
    }

    fun submitTransfer(fromId: Int, toId: Int, amount: Double, note: String, date: String) {
        val dt = normalizeDateTime(date)
        submit { txRepo.createTransfer(CreateTransferRequest(fromId, toId, amount, note, dt)).toUnit() }
    }

    /**
     * 转账编辑保存：必须走 PUT /transfers/{id}（全量替换语义，服务端会先删掉该
     * transfer_id 的所有腿再重建两条并重算双方余额）。
     * 绝不能用 submitEdit —— 那走 PUT /transactions/{id}，只动一条腿。
     */
    fun submitTransferEdit(transferId: Int, fromId: Int, toId: Int, amount: Double, note: String, date: String) {
        val dt = normalizeDateTime(date)
        submit { txRepo.updateTransfer(transferId, CreateTransferRequest(fromId, toId, amount, note, dt)) }
    }

    /** 编辑保存：date 已带时间（到秒），直接透传，不再回填原始时间 */
    fun submitEdit(id: Int, accountId: Int, categoryId: Int, amount: Double, note: String, type: String, date: String,
                   location: String? = null, linkType: String? = null, linkId: Int? = null,
                   budgetId: Int? = null, tagIds: List<Int>? = null) {
        val dt = normalizeDateTime(date)
        submit { txRepo.updateTransaction(
            id,
            UpdateTransactionRequest(accountId, categoryId, type, amount, note, dt, location, linkType, linkId, budgetId, tags = tagIds)
        ) }
    }

    /**
     * UI 传来的时间统一整理成 yyyy-MM-dd HH:mm:ss。
     * 兼容历史只传日期的调用方（补 00:00:00），也兼容多余的毫秒/时区后缀（截断到秒）。
     */
    private fun normalizeDateTime(raw: String): String {
        val s = raw.trim().replace('T', ' ')
        return when {
            s.length >= 19 -> s.substring(0, 19)
            s.length >= 16 -> s.substring(0, 16) + ":00"
            else -> s.take(10) + " 00:00:00"
        }
    }

    private fun submit(call: suspend () -> ApiResult<Unit>) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = call()) {
                is ApiResult.Success -> _state.value = _state.value.copy(loading = false, success = true)
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }
}

private fun <T> ApiResult<T>.toUnit(): ApiResult<Unit> = when (this) {
    is ApiResult.Success -> ApiResult.Success(Unit)
    is ApiResult.Error -> this
}
