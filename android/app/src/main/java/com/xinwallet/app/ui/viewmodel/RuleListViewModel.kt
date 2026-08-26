package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiRule
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 规则管理页 ViewModel（与安卓 AiInsightViewModel 风格对齐）。
 *
 * 服务端 ai_rules 表字段较多，但客户端用 Models.kt 的 AiRule 强类型（match_key / rule_type /
 * status / score / accuracy / sample_count / target_category_id / target_account_id / target_type）。
 * thresholds 通过强类型 Map<String, Any?> 兜底（Schema 演进中）。
 */
data class RuleListUiState(
    val loading: Boolean = false,
    val rules: List<AiRule> = emptyList(),
    val total: Int = 0,
    /** 服务端阈值（verified/threshold/min_sample 等，Schema 演进期不强类型化） */
    val thresholds: Map<String, Any?> = emptyMap(),
    val error: String? = null,
    val toast: String? = null,
    /** 正在处理的 rule id（disable/enable） */
    val pendingId: Int? = null,
    /** 显示过滤器：null = 全部；其他 = 按 status 过滤 */
    val statusFilter: String? = null
)

class RuleListViewModel(private val aiRepo: AiRepository) : ViewModel() {

    private val _state = MutableStateFlow(RuleListUiState())
    val state: StateFlow<RuleListUiState> = _state

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = aiRepo.listRules(limit = 100)) {
                is ApiResult.Success -> {
                    val data = r.data
                    _state.value = _state.value.copy(
                        loading = false,
                        rules = data?.rules ?: emptyList(),
                        total = data?.total ?: (data?.rules?.size ?: 0),
                        thresholds = data?.thresholds ?: emptyMap()
                    )
                }
                is ApiResult.Error -> _state.value =
                    _state.value.copy(loading = false, error = r.message)
            }
        }
    }

    /**
     * 禁用：POST /ai/rules/:id/disable body {reason}。
     * discard 后服务端会让关联规则回到 candidate 重攒证据（v0.2 行为：discard 不可逆、不复活样本）。
     */
    fun disable(ruleId: Int, reason: String = "user_disabled") {
        viewModelScope.launch {
            _state.value = _state.value.copy(pendingId = ruleId)
            when (val r = aiRepo.disableRule(ruleId, reason)) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(pendingId = null, toast = "已禁用，关联样本不会复活")
                    refresh()
                }
                is ApiResult.Error ->
                    _state.value = _state.value.copy(pendingId = null, error = r.message)
            }
        }
    }

    fun enable(ruleId: Int) {
        viewModelScope.launch {
            _state.value = _state.value.copy(pendingId = ruleId)
            when (val r = aiRepo.enableRule(ruleId)) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(pendingId = null, toast = "已启用，从候选重新攒证据")
                    refresh()
                }
                is ApiResult.Error ->
                    _state.value = _state.value.copy(pendingId = null, error = r.message)
            }
        }
    }

    fun setFilter(status: String?) {
        _state.value = _state.value.copy(statusFilter = status)
    }

    fun clearToast() { _state.value = _state.value.copy(toast = null) }
    fun clearError() { _state.value = _state.value.copy(error = null) }
}
