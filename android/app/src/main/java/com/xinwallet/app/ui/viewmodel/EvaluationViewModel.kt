package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiEvaluationRunResponse
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 模型评测页 ViewModel。
 * - listEvaluationRuns：拉历史跑批（启动时加载）
 * - runEvaluation：发起一次离线跑批（不依赖对话服务商，纯本地 CPU，可能耗时数秒）
 * metrics/regression 字段用 Map 兜底。
 */
data class EvaluationUiState(
    val loading: Boolean = false,
    val running: Boolean = false,
    val result: AiEvaluationRunResponse? = null,
    val history: List<Map<String, Any?>> = emptyList(),
    val error: String? = null,
    val toast: String? = null,
)

class EvaluationViewModel(private val aiRepo: AiRepository) : ViewModel() {
    private val _state = MutableStateFlow(EvaluationUiState())
    val state: StateFlow<EvaluationUiState> = _state

    init { loadHistory() }

    fun loadHistory() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = aiRepo.listEvaluationRuns(limit = 10)) {
                is ApiResult.Success -> _state.value = _state.value.copy(loading = false, history = r.data.runs)
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }

    fun run() {
        viewModelScope.launch {
            _state.value = _state.value.copy(running = true, error = null)
            when (val r = aiRepo.runEvaluation(label = "android-manual", persist = true)) {
                is ApiResult.Success -> _state.value = _state.value.copy(running = false, result = r.data, toast = "评测完成")
                is ApiResult.Error -> _state.value = _state.value.copy(running = false, error = r.message)
            }
        }
    }

    fun clearToast() { _state.value = _state.value.copy(toast = null) }
    fun clearError() { _state.value = _state.value.copy(error = null) }
}
