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
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.TipsAndUpdates
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiInsightItem
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.AiInsightViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney

/**
 * AI 消费洞察页：服务端用大模型从本月收支/预算/储蓄目标/债务等多维度数据抽取 3-5 条结构化建议。
 *
 * 三级 level 渲染：
 *   warning（需重视）→ 红橙色
 *   info（关注）    → 蓝色
 *   tip（小建议）   → 灰绿
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiInsightScreen(navController: NavHostController) {
    val vm: AiInsightViewModel = viewModel(factory = viewModelFactory {
        AiInsightViewModel(AppContainer.aiRepository)
    })
    val state by vm.state.collectAsState()

    Scaffold(
        topBar = {
            TopBar(
                title = "💡 消费洞察",
                onBack = { navController.popBackStack() }
            )
        }
    ) { padding ->
        when {
            state.loading && state.items.isEmpty() -> LoadingBox(modifier = Modifier.padding(padding))
            state.needsProvider -> ProviderMissingView(
                modifier = Modifier.padding(padding),
                onOpenSettings = { navController.navigate(Screen.Settings.route) }
            )
            state.error != null && state.items.isEmpty() -> ErrorView(
                message = state.error!!,
                modifier = Modifier.padding(padding),
                onRetry = { vm.refresh() }
            )
            state.items.isEmpty() -> EmptyState(
                title = "本月还没有洞察",
                desc = "记几笔账后，AI 会基于你的财务数据给出建议",
                modifier = Modifier.padding(padding)
            )
            else -> InsightList(
                items = state.items,
                generatedAt = state.generatedAt,
                modifier = Modifier.padding(padding),
                loading = state.loading,
                onRefresh = { vm.refresh() }
            )
        }
    }
}

@Composable
private fun InsightList(
    items: List<AiInsightItem>,
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
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "本月 ${items.size} 条洞察",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    androidx.compose.material3.IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新", modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        items(items, key = { "${it.title}_${it.level}_${items.indexOf(it)}" }) { item ->
            InsightCard(item)
        }
        if (generatedAt != null) {
            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "生成于 $generatedAt",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun InsightCard(item: AiInsightItem) {
    val (color, icon) = when (item.level) {
        "warning" -> Color(0xFFE53935) to Icons.Outlined.Warning   // 红
        "tip"     -> Color(0xFF43A047) to Icons.Outlined.TipsAndUpdates  // 绿
        else      -> Color(0xFF1E88E5) to Icons.Outlined.Info      // 蓝
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = item.level, tint = color, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(item.description, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.action.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "👉 ${item.action}",
                        style = MaterialTheme.typography.bodySmall,
                        color = color,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

@Composable
private fun ProviderMissingView(modifier: Modifier, onOpenSettings: () -> Unit) {
    Box(modifier = modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Lightbulb, contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(16.dp))
            Text("还没配置 AI 服务商", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(
                "需要先在「服务商」中添加并激活一个对话模型（如 GPT-4o、Claude、国产大模型）才能生成洞察",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(20.dp))
            Button(onClick = onOpenSettings) { Text("去配置") }
        }
    }
}

@Composable
private fun ErrorView(message: String, modifier: Modifier, onRetry: () -> Unit) {
    Box(modifier = modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onRetry) { Text("重试") }
        }
    }
}
