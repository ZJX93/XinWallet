package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.data.model.AiAdviceItem
import com.xinwallet.app.data.model.AiInsightItem
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * AI 智能分析页 ViewModel（v0.2.1：insight 合并到 advice）。
 *
 * 缓存策略（用户要求）：
 *   - 启动时先同步从 SessionManager DataStore 读 JSON 缓存填充 state（不发请求）
 *   - 只有【首次进入无缓存】时静默发一次 /ai/advice
 *   - 用户点右上角「刷新」才主动调接口，成功覆盖缓存
 *   - advice + insights 分两个 key 存（前者数组，后者数组），generatedAt 单独存
 *
 * 服务端契约（/ai/advice）：{ advice: AiAdviceItem[], insights: AiInsightItem[], generatedAt }
 */
data class AiAdviceUiState(
    val loading: Boolean = false,
    val advice: List<AiAdviceItem> = emptyList(),
    val insights: List<AiInsightItem> = emptyList(),
    val generatedAt: String? = null,
    val error: String? = null,
    /** 服务商未配置时给出引导文案 */
    val needsProvider: Boolean = false,
    /** 标记是否已从缓存恢复（用于 UI 显示「已加载缓存」/避免首次显示 loading） */
    val fromCache: Boolean = false,
)

class AiAdviceViewModel(
    private val aiRepo: AiRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {
    private val _state = MutableStateFlow(AiAdviceUiState())
    val state: StateFlow<AiAdviceUiState> = _state

    private val gson = Gson()
    private val adviceType = object : TypeToken<List<AiAdviceItem>>() {}.type
    private val insightType = object : TypeToken<List<AiInsightItem>>() {}.type

    init {
        loadFromCacheThenMaybeFetch()
    }

    /**
     * 启动顺序：先读缓存 → 有缓存渲染（不发请求）→ 无缓存则静默发一次请求。
     * 缓存损坏/格式变化时降级到静默发请求（避免卡在加载态）。
     */
    private fun loadFromCacheThenMaybeFetch() {
        viewModelScope.launch {
            val adviceJson = sessionManager.aiAdviceCacheJson()
            val insightJson = sessionManager.aiInsightCacheJson()
            val generatedAt = sessionManager.aiAdviceGeneratedAt().ifBlank { null }
            val cachedAdvice = parseList<AiAdviceItem>(adviceJson)
            val cachedInsights = parseList<AiInsightItem>(insightJson)
            val hasCache = cachedAdvice.isNotEmpty() || cachedInsights.isNotEmpty()
            if (hasCache) {
                _state.value = _state.value.copy(
                    advice = cachedAdvice,
                    insights = cachedInsights,
                    generatedAt = generatedAt,
                    fromCache = true,
                )
            } else {
                refresh()
            }
        }
    }

    private inline fun <reified T> parseList(json: String): List<T> {
        if (json.isBlank()) return emptyList()
        return try {
            gson.fromJson<List<T>>(json, object : TypeToken<List<T>>() {}.type)
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun refresh() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val r = aiRepo.advice()) {
                is ApiResult.Success -> {
                    val resp = r.data
                    // 双写 DataStore（advice/insights 各自一段 JSON），覆盖旧缓存
                    try {
                        sessionManager.saveAiAdviceCache(
                            adviceJson = gson.toJson(resp.advice),
                            insightJson = gson.toJson(resp.insights),
                            generatedAt = resp.generatedAt ?: ""
                        )
                    } catch (_: Exception) {
                        // 缓存写失败不影响本次显示——下次重启会重新拉
                    }
                    _state.value = _state.value.copy(
                        loading = false,
                        advice = resp.advice,
                        insights = resp.insights,
                        generatedAt = resp.generatedAt,
                        error = if (resp.advice.isEmpty() && resp.insights.isEmpty())
                            "本月无数据，试试记账后再来" else null,
                        fromCache = false,
                    )
                }
                is ApiResult.Error -> {
                    val msg = r.message ?: "获取建议失败"
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
}