package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiLearningStatsResponse
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 学习统计页 ViewModel。GET /ai/learning/stats 返回嵌套结构（evidence/contradictions/
 * metrics/usage/breakers），字段多用 Map 兜底（schema 演进期不强类型化），UI 端按需挑用。
 */
data class LearningStatsUiState(
    val loading: Boolean = false,
    val stats: AiLearningStatsResponse? = null,
    val error: String? = null,
)

class LearningStatsViewModel(private val aiRepo: AiRepository) : ViewModel() {
    private val _state = MutableStateFlow(LearningStatsUiState())
    val state: StateFlow<LearningStatsUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val r = aiRepo.learningStats()) {
                is ApiResult.Success -> _state.value = _state.value.copy(loading = false, stats = r.data)
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = r.message)
            }
        }
    }
}
