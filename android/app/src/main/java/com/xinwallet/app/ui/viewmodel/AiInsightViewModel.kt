package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiInsightItem
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 消费洞察页 ViewModel。
 * 一次性拉取当月（或指定月）消费洞察；用户可点「换月」切换；服务端 400（未配置服务商）显示引导。
 *
 * 注意：服务端 insight 输出完全由大模型从财务数据抽取（不只是统计），可能耗时数秒；
 * 不要给每次切换月份加 debounce —— 月份跨度大、来回点概率不高，避免过度设计。
 */
data class AiInsightUiState(
    val loading: Boolean = false,
    val month: String? = null,           // null = 当月（服务端兜底）
    val items: List<AiInsightItem> = emptyList(),
    val generatedAt: String? = null,
    val error: String? = null,
    /** 服务商未配置时给出引导文案（普通 error 弹 toast 即可） */
    val needsProvider: Boolean = false,
)

class AiInsightViewModel(
    private val aiRepo: AiRepository
) : ViewModel() {
    private val _state = MutableStateFlow(AiInsightUiState())
    val state: StateFlow<AiInsightUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val r = aiRepo.insight(_state.value.month)) {
                is ApiResult.Success -> {
                    val data = r.data
                    _state.value = _state.value.copy(
                        loading = false,
                        items = data?.insights ?: emptyList(),
                        generatedAt = data?.generatedAt,
                        error = if ((data?.insights ?: emptyList()).isEmpty()) "本月无数据，试试记账后再来" else null,
                    )
                }
                is ApiResult.Error -> {
                    val msg = r.message ?: "获取洞察失败"
                    // 400 + 文案含「服务商」/「未配置」⇒ 引导用户去配置
                    val needsProvider = msg.contains("服务商") || msg.contains("未配置") || msg.contains("未激活")
                    _state.value = _state.value.copy(
                        loading = false,
                        error = msg,
                        needsProvider = needsProvider,
                    )
                }
            }
        }
    }

    fun setMonth(month: String?) {
        if (_state.value.month == month) return
        _state.value = _state.value.copy(month = month)
        refresh()
    }
}
