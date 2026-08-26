package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiAdviceItem
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 财务建议页 ViewModel。
 * 服务端从本月 + 上月财务数据抽取 3-5 条可量化建议（priority 三态 high/medium/low）。
 * 入参为空 body；调用前需已激活一个对话服务商，未配置会 400。
 */
data class AiAdviceUiState(
    val loading: Boolean = false,
    val advice: List<AiAdviceItem> = emptyList(),
    val generatedAt: String? = null,
    val error: String? = null,
    /** 服务商未配置时给出引导文案 */
    val needsProvider: Boolean = false,
)

class AiAdviceViewModel(private val aiRepo: AiRepository) : ViewModel() {
    private val _state = MutableStateFlow(AiAdviceUiState())
    val state: StateFlow<AiAdviceUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val r = aiRepo.advice()) {
                is ApiResult.Success -> {
                    val resp = r.data
                    _state.value = _state.value.copy(
                        loading = false,
                        advice = resp.advice,
                        generatedAt = resp.generatedAt,
                        error = if (resp.advice.isEmpty()) "暂无建议，记几笔账后再来看看" else null
                    )
                }
                is ApiResult.Error -> {
                    val msg = r.message ?: "获取建议失败"
                    val needsProvider = msg.contains("服务商") || msg.contains("未配置") || msg.contains("未激活")
                    _state.value = _state.value.copy(loading = false, error = msg, needsProvider = needsProvider)
                }
            }
        }
    }
}
