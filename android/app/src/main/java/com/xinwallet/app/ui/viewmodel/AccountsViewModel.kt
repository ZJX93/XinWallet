package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateAccountRequest
import com.xinwallet.app.data.model.UpdateAccountRequest
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.util.sumByCurrency
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AccountsUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val accounts: List<Account> = emptyList(),
    val totalAssets: Double = 0.0,
    /** 提交中（新增/编辑/销户/删除），用于禁用弹窗按钮 */
    val submitting: Boolean = false,
    val toast: String? = null,
    /** 表单提交成功一次性信号，UI 收到后关闭弹窗 */
    val formDone: Boolean = false,
    /**
     * 多币种 P2-2e：总资产按账户币种分布 { "CNY": 1000.0, "USD": 50.0 }。
     *
     * 后端 totalAssets 是 SQL SUM(balance) **不分 currency**，混币种账本下这个
     * 数字没有意义（USD 100 + CNY 1000 ≠ 1100）。这里由客户端按
     * accounts[].currency 重新分组累加，交给 formatMoneyMix 展示成
     * 「¥1,000.00 ($50.00)」。账户数据本身已经带 currency，不需要改后端。
     */
    val totalAssetsBreakdown: Map<String, Double>? = null
)

class AccountsViewModel(private val repo: AccountRepository) : ViewModel() {
    private val _state = MutableStateFlow(AccountsUiState(loading = true))
    val state: StateFlow<AccountsUiState> = _state

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = repo.getAllAccounts()) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    error = null,
                    accounts = r.data.accounts,
                    totalAssets = r.data.totalAssets,
                    // 多币种 P2-2e：按账户币种重新分组，混币种账本下 totalAssets 单值无意义
                    totalAssetsBreakdown = buildAssetsBreakdown(r.data.accounts)
                )
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }

    fun create(req: CreateAccountRequest) = submit("账户已创建") { repo.createAccount(req).toUnit() }

    fun update(id: Int, req: UpdateAccountRequest) = submit("账户已更新") { repo.updateAccount(id, req) }

    /** 销户：保留历史流水，账户置为 closed 不再参与总资产 */
    fun close(id: Int) = submit("账户已销户") { repo.closeAccount(id) }

    /** 彻底删除：后端会校验是否存在关联流水，有则报错 */
    fun delete(id: Int) = submit("账户已删除") { repo.deleteAccount(id) }

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

    /**
     * 多币种 P2-2e：按账户币种分组累加余额，得到总资产 breakdown。
     *
     * 只统计 status == "active" 的账户，与后端 totalAssets 口径一致
     * （后端 SQL 也是 WHERE status='active'）。
     *
     * ⚠️ account.currency 可能是 null：Gson 反序列化 Kotlin data class 走
     * Unsafe 分配对象（不调构造器），`val currency: String = "CNY"` 的默认值
     * 不生效 —— 服务端还没返回该字段的老部署数据里它是 null，这里统一兜底 CNY。
     *
     * 信用卡口径：balance 是已欠金额（负数或正数取决于后端约定），这里原样
     * 累加，与后端 SUM(balance) 保持一致，不改变现有语义。
     */
    private fun buildAssetsBreakdown(accounts: List<Account>): Map<String, Double> =
        sumByCurrency(accounts.filter { it.status == "active" }, { it.currency }, { it.balance })

    fun consumeError() { _state.value = _state.value.copy(error = null) }
    fun consumeFormDone() { _state.value = _state.value.copy(formDone = false) }
}

/** 忽略返回体只关心成败，便于把不同返回类型的调用塞进同一个 submit 流程 */
private fun <T> ApiResult<T>.toUnit(): ApiResult<Unit> = when (this) {
    is ApiResult.Success -> ApiResult.Success(Unit)
    is ApiResult.Error -> this
}
