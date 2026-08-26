package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.TipsAndUpdates
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiAdviceItem
import com.xinwallet.app.data.model.AiInsightItem
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.AiAdviceViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 智能分析页（v0.2.1：insight 与 advice 合并展示）。
 *
 * 两段渲染：
 *   - 顶部：洞察区（observation：warning/info/tip），来自 AiAdviceResponse.insights
 *   - 底部：建议区（actionable：high/medium/low），来自 AiAdviceResponse.advice
 *
 * 缓存策略：首次从 SessionManager DataStore 读 JSON 渲染（不发请求）；用户点刷新才重发。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiAdviceScreen(navController: NavHostController) {
    val vm: AiAdviceViewModel = viewModel(factory = viewModelFactory {
        AiAdviceViewModel(AppContainer.aiRepository, AppContainer.sessionManager)
    })
    val state by vm.state.collectAsState()

    Scaffold(
        topBar = { TopBar(title = "💡 AI 智能分析", onBack = { navController.popBackStack() }) }
    ) { padding ->
        val hasContent = state.advice.isNotEmpty() || state.insights.isNotEmpty()
        when {
            state.loading && !hasContent -> LoadingBox(modifier = Modifier.padding(padding))
            state.needsProvider && !hasContent -> ProviderMissingView(modifier = Modifier.padding(padding), onOpenSettings = { navController.navigate(Screen.Settings.route) })
            state.error != null && !hasContent -> ErrorView(message = state.error!!, modifier = Modifier.padding(padding), onRetry = { vm.refresh() })
            !hasContent -> EmptyState(title = "暂无内容", desc = "记几笔账后，AI 会基于你的财务数据给出可量化的建议", modifier = Modifier.padding(padding))
            else -> CombinedList(
                advice = state.advice,
                insights = state.insights,
                generatedAt = state.generatedAt,
                modifier = Modifier.padding(padding),
                loading = state.loading,
                onRefresh = { vm.refresh() }
            )
        }
    }
}

@Composable
private fun CombinedList(
    advice: List<AiAdviceItem>,
    insights: List<AiInsightItem>,
    generatedAt: String?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    onRefresh: () -> Unit = {}
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 顶部操作条
        item {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "洞察 ${insights.size} 条 · 建议 ${advice.size} 条",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新", modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        // 洞察段
        if (insights.isNotEmpty()) {
            item {
                Text(
                    text = "🧠 消费洞察",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 4.dp, top = 4.dp)
                )
            }
            items(insights, key = { "ins_${it.title}_${it.level}_${insights.indexOf(it)}" }) { InsightCard(it) }
        }
        // 建议段
        if (advice.isNotEmpty()) {
            item {
                Text(
                    text = "💡 财务建议",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 4.dp, top = 8.dp)
                )
            }
            items(advice, key = { "adv_${it.title}_${it.priority}_${advice.indexOf(it)}" }) { AdviceCard(it) }
        }
        // 生成时间
        if (generatedAt != null) {
            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "生成于 $generatedAt",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun InsightCard(item: AiInsightItem) {
    val (color, icon) = when (item.level) {
        "warning" -> Color(0xFFE53935) to Icons.Outlined.Warning
        "tip" -> Color(0xFF43A047) to Icons.Outlined.TipsAndUpdates
        else -> Color(0xFF1E88E5) to Icons.Outlined.Info
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = item.level, tint = color, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(item.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.action.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(text = "▶ 行动：${item.action}", style = MaterialTheme.typography.bodySmall, color = color, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun AdviceCard(item: AiAdviceItem) {
    val (color, icon) = when (item.priority) {
        "high" -> Color(0xFFE53935) to Icons.Outlined.Warning
        "low" -> Color(0xFF43A047) to Icons.Outlined.TipsAndUpdates
        else -> Color(0xFFFF9800) to Icons.Outlined.Info
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = item.priority, tint = color, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(item.content, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.impact.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(text = "📈 预期影响：${item.impact}", style = MaterialTheme.typography.bodySmall, color = color, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
private fun ProviderMissingView(modifier: Modifier, onOpenSettings: () -> Unit) {
    Box(modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Lightbulb, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(16.dp))
            Text("还没配置 AI 服务商", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text("需要先在「服务商」中添加并激活一个对话模型（如 GPT-4o、Claude、国产大模型）才能生成建议", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Spacer(Modifier.height(20.dp))
            Button(onClick = onOpenSettings) { Text("去配置") }
        }
    }
}

@Composable
private fun ErrorView(message: String, modifier: Modifier, onRetry: () -> Unit) {
    Box(modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onRetry) { Text("重试") }
        }
    }
}
