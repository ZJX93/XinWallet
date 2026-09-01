package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateDebtRequest
import com.xinwallet.app.data.model.CreateRepaymentRequest
import com.xinwallet.app.data.model.Debt
import com.xinwallet.app.data.model.UpdateRepaymentRequest
import com.xinwallet.app.data.model.DebtDetailResponse
import com.xinwallet.app.data.model.DebtListSummary
import com.xinwallet.app.data.model.UpdateDebtRequest
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.DebtRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class DebtsUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val debts: List<Debt> = emptyList(),
    val summary: DebtListSummary? = null,
    val accounts: List<Account> = emptyList(),
    val submitting: Boolean = false,
    val toast: String? = null,
    val formDone: Boolean = false,
    val detail: DebtDetailResponse? = null,
    val detailLoading: Boolean = false
)

class DebtsViewModel(
    private val repo: DebtRepository,
    private val accountRepo: AccountRepository
) : ViewModel() {
    private val _state = MutableStateFlow(DebtsUiState(loading = true))
    val state: StateFlow<DebtsUiState> = _state

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val debts = repo.getDebts()
            val accs = accountRepo.getAccounts()
            val list = (debts as? ApiResult.Success)?.data
            val accList = (accs as? ApiResult.Success)?.data?.accounts ?: emptyList()
            val err = (debts as? ApiResult.Error)?.message ?: (accs as? ApiResult.Error)?.message
            _state.value = _state.value.copy(
                loading = false,
                debts = list?.debts ?: emptyList(),
                summary = list?.summary,
                accounts = accList,
                error = if (list == null && err != null) err else null
            )
        }
    }

    fun create(req: CreateDebtRequest) = submit("债务已记录") { repo.createDebt(req).toUnit() }
    fun update(id: Int, req: UpdateDebtRequest) = submit("债务已更新") { repo.updateDebt(id, req) }
    fun delete(id: Int) = submit("债务已删除") { repo.deleteDebt(id) }

    fun loadDetail(id: Int) {
        viewModelScope.launch {
            _state.value = _state.value.copy(detailLoading = true, detail = null)
            when (val r = repo.getDebt(id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(detailLoading = false, detail = r.data)
                is ApiResult.Error -> _state.value = _state.value.copy(detailLoading = false, error = r.message)
            }
        }
    }

    fun repay(id: Int, req: CreateRepaymentRequest) = submit("还款已记录") { repo.createRepayment(id, req) }

    fun deleteRepayment(id: Int, rid: Int) = submit("还款记录已删除") { repo.deleteRepayment(id, rid) }
    fun updateRepayment(id: Int, rid: Int, req: UpdateRepaymentRequest) = submit("还款已更新") { repo.updateRepayment(id, rid, req) }

    fun clearDetail() { _state.value = _state.value.copy(detail = null) }

    private fun submit(okMessage: String, call: suspend () -> ApiResult<Unit>) {
        viewModelScope.launch {
            _state.value = _state.value.copy(submitting = true, error = null)
            when (val r = call()) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(submitting = false, toast = okMessage, formDone = true)
                    load()
                }
                is ApiResult.Error -> _state.value = _state.value.copy(submitting = false, error = r.message)
            }
        }
    }

    fun consumeToast() { _state.value = _state.value.copy(toast = null) }
    fun consumeError() { _state.value = _state.value.copy(error = null) }
    fun consumeFormDone() { _state.value = _state.value.copy(formDone = false) }
}

private fun <T> ApiResult<T>.toUnit(): ApiResult<Unit> = when (this) {
    is ApiResult.Success -> ApiResult.Success(Unit)
    is ApiResult.Error -> this
}
