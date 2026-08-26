package com.xinwallet.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiLearningStatsResponse
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.LearningStatsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 学习统计页：把 /ai/learning/stats 的 5 个区块渲染成键值卡片。
 * 嵌套 Map 用 flatten() 安全展平（Gson 反序列化为 LinkedTreeMap，值类型多为 Number/String/Map/List）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LearningStatsScreen(navController: NavHostController) {
    val vm: LearningStatsViewModel = viewModel(factory = viewModelFactory { LearningStatsViewModel(AppContainer.aiRepository) })
    val state by vm.state.collectAsState()
    val stats = state.stats

    Scaffold(
        topBar = { TopBar(title = "🧠 学习统计", onBack = { navController.popBackStack() }) }
    ) { padding ->
        when {
            state.loading && stats == null -> LoadingBox(modifier = Modifier.padding(padding))
            state.error != null && stats == null -> ErrorView(message = state.error!!, modifier = Modifier.padding(padding), onRetry = { vm.refresh() })
            stats == null -> EmptyState(title = "暂无学习数据", desc = "记几笔账后 AI 会开始积累记忆与规则", modifier = Modifier.padding(padding))
            else -> StatsBody(stats = stats, modifier = Modifier.padding(padding), loading = state.loading, onRefresh = { vm.refresh() })
        }
    }
}

@Composable
private fun StatsBody(
    stats: AiLearningStatsResponse,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    onRefresh: () -> Unit = {}
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("AI 自我学习情况", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (loading) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                else IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Refresh, contentDescription = "刷新", modifier = Modifier.size(20.dp)) }
            }
        }
        item { KVSection("反馈与记忆", flatten("", stats.evidence)) }
        item { ContradictionSection(stats.contradictions) }
        item { KVSection("在线指标", flatten("", stats.metrics)) }
        item { KVSection("调用用量", flatten("", stats.usage)) }
        item { KVSection("模型熔断器", flatten("", stats.breakers)) }
    }
}

@Composable
private fun ContradictionSection(contradictions: List<Map<String, Any?>>) {
    SectionCard(title = "规则冲突") {
        if (contradictions.isEmpty()) {
            Text("无冲突规则 ✓", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                contradictions.forEach { c ->
                    val matchKey = c["match_key"]?.toString() ?: "?"
                    val variants = (c["variants"] as? List<*>)?.joinToString(" / ") { it.toString() } ?: ""
                    val samples = (c["samples"] as? List<*>)?.size ?: 0
                    Column(Modifier.fillMaxWidth().padding(8.dp)) {
                        Text(matchKey, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(2.dp))
                        Text("变体：$variants", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("样本数：$samples", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun KVSection(title: String, rows: List<Pair<String, String>>) {
    SectionCard(title = title) {
        if (rows.isEmpty()) {
            Text("—", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                rows.forEach { (k, v) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(k, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(v, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorView(message: String, modifier: Modifier, onRetry: () -> Unit) {
    Box(modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            androidx.compose.material3.OutlinedButton(onClick = onRetry) { Text("重试") }
        }
    }
}

/** 递归展平嵌套 Map 为「标签 → 值」行；嵌套键用「 · 」连接。List 值显示为「N 项」。 */
private fun flatten(prefix: String, v: Any?): List<Pair<String, String>> {
    val out = mutableListOf<Pair<String, String>>()
    when (v) {
        is Map<*, *> -> {
            for ((k, vv) in v) {
                val label = if (prefix.isBlank()) "$k" else "$prefix · $k"
                when (vv) {
                    is Map<*, *> -> out += flatten(label, vv)
                    is List<*> -> out += label to "${vv.size} 项"
                    else -> out += label to fmt("$k", vv)
                }
            }
        }
        else -> if (prefix.isNotBlank()) out += prefix to fmt(prefix, v)
    }
    return out
}

/** 按字段名智能格式化：rate → 百分比；cost/micro → 人民币（÷1e6）；其余 Number → 原值。 */
private fun fmt(key: String, value: Any?): String {
    return when {
        value == null -> "—"
        key.contains("rate") && value is Number -> "%.1f%%".format(value.toDouble() * 100)
        (key.contains("cost") || key.contains("micro")) && value is Number -> "¥%.4f".format(value.toDouble() / 1_000_000.0)
        value is Number -> {
            val d = value.toDouble()
            if (d % 1.0 == 0.0) value.toLong().toString() else "%.4f".format(d)
        }
        else -> value.toString()
    }
}
