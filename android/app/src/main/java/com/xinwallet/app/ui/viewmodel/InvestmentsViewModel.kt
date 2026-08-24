package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateInvestmentRequest
import com.xinwallet.app.data.model.Investment
import com.xinwallet.app.data.model.InvestmentType
import com.xinwallet.app.data.model.PortfolioSummary
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.InvestmentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class InvUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val investments: List<Investment> = emptyList(),
    val summary: PortfolioSummary? = null,
    val types: List<InvestmentType> = emptyList(),
    /** 新增表单的「扣款账户」下拉数据源 */
    val accounts: List<Account> = emptyList(),
    val submitting: Boolean = false,
    /** 提交成功信号：界面收到后关闭表单并清空，由 consumeFormDone 复位 */
    val formDone: Boolean = false,
    val toast: String? = null
)

class InvestmentsViewModel(
    private val invRepo: InvestmentRepository,
    /**
     * 账户仓库可空：InvestmentsContent 在首页 tab 里也会被复用，
     * 那里不需要新增表单。可空使调用方能只传理财仓库。
     */
    private val accountRepo: AccountRepository? = null
) : ViewModel() {
    private val _state = MutableStateFlow(InvUiState(loading = true))
    val state: StateFlow<InvUiState> = _state

    fun load(includeSold: Boolean = false) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val inv = invRepo.getInvestments(includeSold)
            val types = invRepo.getTypes()
            val invList = (inv as? ApiResult.Success)?.data?.investments ?: emptyList()
            val sum = (inv as? ApiResult.Success)?.data?.summary
            val typeList = (types as? ApiResult.Success)?.data ?: emptyList()
            _state.value = _state.value.copy(loading = false, investments = invList, summary = sum, types = typeList)
        }
    }

    /**
     * 拉取活跃账户，供新增表单的扣款账户下拉使用。
     * 只在真的打开表单时调用 —— 浏览持仓不需要账户数据。
     */
    fun loadAccountsIfNeeded() {
        if (_state.value.accounts.isNotEmpty() || accountRepo == null) return
        viewModelScope.launch {
            val r = accountRepo.getAccounts()
            val list = (r as? ApiResult.Success)?.data?.accounts?.filter { it.status == "active" } ?: emptyList()
            _state.value = _state.value.copy(accounts = list)
        }
    }

    fun create(req: CreateInvestmentRequest, includeSold: Boolean) {
        viewModelScope.launch {
            _state.value = _state.value.copy(submitting = true)
            when (val r = invRepo.createInvestment(req)) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(submitting = false, formDone = true, toast = "持仓已添加")
                    load(includeSold)
                }
                is ApiResult.Error -> {
                    // 失败必须回显后端原文：参数不完整/类型不存在等原因用户才知道怎么改
                    _state.value = _state.value.copy(submitting = false, error = r.message)
                }
            }
        }
    }

    fun consumeFormDone() { _state.value = _state.value.copy(formDone = false) }
    fun consumeToast() { _state.value = _state.value.copy(toast = null) }
    fun consumeError() { _state.value = _state.value.copy(error = null) }
}
