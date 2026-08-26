package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiProvider
import com.xinwallet.app.data.model.AiProviderPayload
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 服务商配置页 ViewModel。
 *
 * 5 个核心动作：list / create / update / delete / activate / test。
 * 状态设计要点：
 *   - loading 只在「列表初次加载」和「测试连接」时拉满；CRUD 后立即刷新列表而非切 loading
 *   - toast 与 error 解耦：error 用于 UI 顶部红条（阻塞），toast 用于一次性提示（瞬时）
 *   - testing 单独 state，UI 上把「测试连接」按钮 spinner 化（其他按钮仍可用）
 */
data class ProviderUiState(
    val loading: Boolean = false,
    val providers: List<AiProvider> = emptyList(),
    val error: String? = null,
    val toast: String? = null,
    /** 当前正在测试哪个 provider（id），UI 上对应行显示 spinner */
    val testingId: Int? = null,
    /** 最近一次测试结果（含 ok/reply/error），用于该行展开显示 */
    val lastTestResult: Pair<Int, String>? = null,    // (id, "ok:reply" | "fail:error")
)

class ProviderViewModel(
    private val aiRepo: AiRepository
) : ViewModel() {
    private val _state = MutableStateFlow(ProviderUiState())
    val state: StateFlow<ProviderUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val r = aiRepo.listProviders()) {
                is ApiResult.Success -> {
                    val list = r.data.providers ?: emptyList()
                    _state.value = _state.value.copy(loading = false, providers = list)
                }
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }

    fun create(payload: AiProviderPayload, onDone: () -> Unit) {
        viewModelScope.launch {
            when (val r = aiRepo.createProvider(payload)) {
                is ApiResult.Success -> { _state.value = _state.value.copy(toast = "已创建"); refresh(); onDone() }
                is ApiResult.Error -> _state.value = _state.value.copy(toast = r.message ?: "创建失败")
            }
        }
    }

    fun update(id: Int, payload: AiProviderPayload, onDone: () -> Unit) {
        viewModelScope.launch {
            when (val r = aiRepo.updateProvider(id, payload)) {
                is ApiResult.Success -> { _state.value = _state.value.copy(toast = "已更新"); refresh(); onDone() }
                is ApiResult.Error -> _state.value = _state.value.copy(toast = r.message ?: "更新失败")
            }
        }
    }

    fun delete(id: Int) {
        viewModelScope.launch {
            when (val r = aiRepo.deleteProvider(id)) {
                is ApiResult.Success -> { _state.value = _state.value.copy(toast = "已删除"); refresh() }
                is ApiResult.Error -> _state.value = _state.value.copy(toast = r.message ?: "删除失败")
            }
        }
    }

    fun activate(id: Int) {
        viewModelScope.launch {
            when (val r = aiRepo.activateProvider(id)) {
                is ApiResult.Success -> { _state.value = _state.value.copy(toast = "已启用"); refresh() }
                is ApiResult.Error -> _state.value = _state.value.copy(toast = r.message ?: "启用失败")
            }
        }
    }

    /**
     * 测试连接：服务端实际发一次「回复 OK」调用，结果回写到 lastTestResult 用于展开显示。
     * testingId 让 UI 给对应行 spinner；测试期间不阻塞其他操作（其他行仍可独立操作）。
     */
    fun testConnection(id: Int) {
        if (_state.value.testingId != null) return   // 已有测试在进行
        _state.value = _state.value.copy(testingId = id, lastTestResult = null)
        viewModelScope.launch {
            when (val r = aiRepo.testProvider(id)) {
                is ApiResult.Success -> {
                    val data = r.data
                    val msg = if (data?.ok == true) "ok:${data.reply ?: ""}" else "fail:${data?.error ?: "未知错误"}"
                    _state.value = _state.value.copy(testingId = null, lastTestResult = id to msg)
                }
                is ApiResult.Error -> {
                    _state.value = _state.value.copy(
                        testingId = null,
                        lastTestResult = id to "fail:${r.message ?: "未知错误"}",
                    )
                }
            }
        }
    }

    fun consumeToast() { _state.value = _state.value.copy(toast = null) }
}
