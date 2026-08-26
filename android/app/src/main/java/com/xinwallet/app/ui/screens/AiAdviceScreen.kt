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
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.AiAdviceViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 财务建议页：服务端用大模型从财务数据抽取可量化建议。
 * priority 三态渲染：high（红）→ medium（橙）→ low（绿）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiAdviceScreen(navController: NavHostController) {
    val vm: AiAdviceViewModel = viewModel(factory = viewModelFactory { AiAdviceViewModel(AppContainer.aiRepository) })
    val state by vm.state.collectAsState()

    Scaffold(
        topBar = { TopBar(title = "💡 财务建议", onBack = { navController.popBackStack() }) }
    ) { padding ->
        when {
            state.loading && state.advice.isEmpty() -> LoadingBox(modifier = Modifier.padding(padding))
            state.needsProvider -> ProviderMissingView(modifier = Modifier.padding(padding), onOpenSettings = { navController.navigate(Screen.Settings.route) })
            state.error != null && state.advice.isEmpty() -> ErrorView(message = state.error!!, modifier = Modifier.padding(padding), onRetry = { vm.refresh() })
            state.advice.isEmpty() -> EmptyState(title = "暂无建议", desc = "记几笔账后，AI 会基于你的财务数据给出可量化的建议", modifier = Modifier.padding(padding))
            else -> AdviceList(items = state.advice, generatedAt = state.generatedAt, modifier = Modifier.padding(padding), loading = state.loading, onRefresh = { vm.refresh() })
        }
    }
}

@Composable
private fun AdviceList(
    items: List<AiAdviceItem>,
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
        item {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(text = "本月 ${items.size} 条建议", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新", modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        items(items, key = { "${it.title}_${it.priority}_${items.indexOf(it)}" }) { AdviceCard(it) }
        if (generatedAt != null) {
            item {
                Spacer(Modifier.height(8.dp))
                Text(text = "生成于 $generatedAt", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(8.dp), textAlign = TextAlign.Center)
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
