package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.NetworkCheck
import androidx.compose.material.icons.filled.Power
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiProvider
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.ProviderViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 服务商配置列表页。
 *
 * 关键设计：
 *   - 「激活」用 Switch + 「启用」按钮双表达：Switch 反映当前状态，启用是动作
 *   - 「测试连接」用每行独立的 NetworkCheck 按钮 + spinner，测试结果展开在行尾
 *   - 「删除」二次确认弹窗（防误触，服务商删了规则会回到 candidate 重攒证据）
 *   - 跳编辑页用 FAB 右下角浮钮（与项目其他配置页风格一致）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderListScreen(navController: NavHostController) {
    val vm: ProviderViewModel = viewModel(factory = viewModelFactory {
        ProviderViewModel(AppContainer.aiRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var pendingDelete by remember { mutableStateOf<AiProvider?>(null) }

    // Toast 一次性展示
    LaunchedEffect(state.toast) {
        state.toast?.let {
            snackbar.showSnackbar(it)
            vm.consumeToast()
        }
    }

    Scaffold(
        topBar = {
            TopBar(
                title = "AI 服务商",
                onBack = { navController.popBackStack() },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { navController.navigate("provider-edit/0") }) {
                Icon(Icons.Filled.Add, contentDescription = "新增服务商")
            }
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        when {
            state.loading && state.providers.isEmpty() -> LoadingBox(modifier = Modifier.padding(padding))
            state.providers.isEmpty() -> EmptyState(
                title = "还没有配置服务商",
                desc = "添加至少一个对话服务商才能使用 AI 记账、消费洞察、语音转写",
                modifier = Modifier.padding(padding)
            )
            else -> ProviderList(
                providers = state.providers,
                testingId = state.testingId,
                lastTestResult = state.lastTestResult,
                onEdit = { id -> navController.navigate("provider-edit/$id") },
                onActivate = { id -> vm.activate(id) },
                onDelete = { p -> pendingDelete = p },
                onTest = { id -> vm.testConnection(id) },
                modifier = Modifier.padding(padding),
            )
        }
    }

    // 删除二次确认
    pendingDelete?.let { p ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除服务商「${p.name}」？") },
            text = { Text("删除后关联的 AI 规则会回到 candidate 重新积累证据，至少要等下次再攒够 verified 才会影响预测。\n\n操作不可撤销。") },
            confirmButton = {
                TextButton(onClick = {
                    vm.delete(p.id); pendingDelete = null
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun ProviderList(
    providers: List<AiProvider>,
    testingId: Int?,
    lastTestResult: Pair<Int, String>?,
    onEdit: (Int) -> Unit,
    onActivate: (Int) -> Unit,
    onDelete: (AiProvider) -> Unit,
    onTest: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        items(providers, key = { it.id }) { p ->
            ProviderCard(
                p = p,
                testing = testingId == p.id,
                testResult = if (lastTestResult?.first == p.id) lastTestResult.second else null,
                onEdit = { onEdit(p.id) },
                onActivate = { onActivate(p.id) },
                onDelete = { onDelete(p) },
                onTest = { onTest(p.id) }
            )
        }
        item { Spacer(Modifier.height(72.dp)) }   // 给 FAB 留位
    }
}

@Composable
private fun ProviderCard(
    p: AiProvider,
    testing: Boolean,
    testResult: String?,
    onEdit: () -> Unit,
    onActivate: () -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(36.dp).clip(CircleShape)
                        .background((if (p.isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                            .copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = when (p.apiType) { "anthropic" -> "🅰"; else -> "🤖" },
                        fontSize = 18.sp
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.name, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                        if (p.isActive) {
                            Spacer(Modifier.width(6.dp))
                            Box(
                                Modifier.clip(RoundedCornerShape(4.dp))
                                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f))
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text("启用中", style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                    Text("${p.model} · ${p.apiType}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(p.baseUrl,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1)
                }
                IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = "编辑") }
            }

            // 测试结果展开行（如果有）
            testResult?.let { res ->
                Spacer(Modifier.height(6.dp))
                val (ok, msg) = if (res.startsWith("ok:")) true to res.removePrefix("ok:")
                else false to res.removePrefix("fail:")
                Text(
                    text = if (ok) "✅ 连接成功：${msg.take(60)}" else "❌ ${msg.take(80)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (ok) Color(0xFF2E7D32) else MaterialTheme.colorScheme.error,
                )
            }

            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                // 启用 Switch（仅当未启用时可点，启用中的点会触发切换）
                if (!p.isActive) {
                    OutlinedButton(onClick = onActivate) {
                        Icon(Icons.Filled.Power, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("启用")
                    }
                } else {
                    Text("当前激活", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary)
                }
                Spacer(modifier = Modifier.weight(1f))
                if (testing) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    TextButton(onClick = onTest) {
                        Icon(Icons.Filled.NetworkCheck, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("测试")
                    }
                }
                TextButton(onClick = onDelete) {
                    Icon(Icons.Filled.Delete, contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}
