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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiRule
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.RuleListViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 规则管理（服务端 ai_rules 表）。
 *
 * 列表 + 状态过滤（全部 / verified / trusted / candidate / disabled）+ 启用/禁用 + 查看证据。
 *
 * 设计要点：
 *   - 状态过滤用 Chip 横排，state.statusFilter=null 表示全部
 *   - 单条 rule 卡：match_key + rule_type + status + score + sample_count + 操作区
 *   - 「禁用」二次确认（破坏性，不可逆 —— discard 不可复活样本）
 *   - 「查看证据」跳 RuleEvidence 页
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuleListScreen(navController: NavHostController) {
    val vm: RuleListViewModel = viewModel(factory = viewModelFactory {
        RuleListViewModel(AppContainer.aiRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    // toast/error 自动消化
    LaunchedEffect(state.toast) {
        state.toast?.let {
            snackbar.showSnackbar(it)
            vm.clearToast()
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar("⚠️ $it")
            vm.clearError()
        }
    }

    Scaffold(
        topBar = {
            TopBar(
                title = "🧠 AI 规则管理",
                onBack = { navController.popBackStack() }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) { data -> Snackbar(data) } }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {

            // 阈值说明（顶部 footer）
            if (state.thresholds.isNotEmpty()) {
                ThresholdFooter(state.thresholds, state.total)
            }

            // 状态过滤 chip
            FilterRow(current = state.statusFilter, onChange = { vm.setFilter(it) })

            // 列表
            when {
                state.loading && state.rules.isEmpty() -> LoadingBox()
                state.rules.isEmpty() -> EmptyState(
                    title = "还没有 AI 规则",
                    desc = "记账几次后 AI 会自动学习，或手动新增规则"
                )
                else -> {
                    // 应用过滤
                    val filtered = if (state.statusFilter == null) state.rules
                    else state.rules.filter { it.status == state.statusFilter }

                    if (filtered.isEmpty()) {
                        EmptyState(
                            title = "「${state.statusFilter ?: ""}」状态下没有规则",
                            desc = "切换其他过滤查看"
                        )
                    } else {
                        LazyColumn(
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            items(filtered, key = { "rule_${it.id}_${it.status}" }) { rule ->
                                RuleRow(
                                    rule = rule,
                                    pending = state.pendingId == rule.id,
                                    onDisable = { vm.disable(rule.id, reason = "user_disabled") },
                                    onEnable = { vm.enable(rule.id) },
                                    onShowEvidence = {
                                        navController.navigate(
                                            Screen.RuleEvidence.create(rule.id, rule.matchKey)
                                        )
                                    }
                                )
                            }
                            item { Spacer(Modifier.height(24.dp)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ThresholdFooter(thresholds: Map<String, Any?>, total: Int) {
    val verified = thresholds["verified"] as? Map<*, *> ?: emptyMap<Any, Any>()
    val vScore = (verified["score"] as? Number)?.toDouble() ?: 8.0
    val vAcc = (verified["accuracy"] as? Number)?.toDouble() ?: 0.6
    val vSample = (verified["min_sample"] as? Number)?.toInt() ?: 2

    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                "共 $total 条规则 · verified 阈值: score≥${vScore.toInt()} · accuracy≥${(vAcc * 100).toInt()}% · sample≥${vSample}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "规则晋升：candidate → verified（达阈值）→ trusted · 禁用不可逆且不复活样本",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp
            )
        }
    }
}

@Composable
private fun FilterRow(current: String?, onChange: (String?) -> Unit) {
    val filters = listOf(
        null to "全部",
        "verified" to "已生效",
        "trusted" to "高可信",
        "candidate" to "候选",
        "disabled" to "已禁用"
    )
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        filters.forEach { (status, label) ->
            FilterChip(
                selected = current == status,
                onClick = { onChange(status) },
                label = { Text(label, fontSize = 12.sp) }
            )
        }
    }
}

@Composable
private fun RuleRow(
    rule: AiRule,
    pending: Boolean,
    onDisable: () -> Unit,
    onEnable: () -> Unit,
    onShowEvidence: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    rule.matchKey,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                StatusBadge(rule.status)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "类型：${rule.ruleType}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Score ${rule.score}",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Text("Accuracy ${(rule.accuracy * 100).toInt()}%",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Text("样本 ${rule.sampleCount}",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            rule.targetCategoryId?.let { cat ->
                Spacer(Modifier.height(4.dp))
                Text("目标类目 ID: $cat",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            rule.targetAccountId?.let { acc ->
                Text("目标账户 ID: $acc",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = onShowEvidence,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("查看证据", fontSize = 12.sp)
                }

                Spacer(Modifier.width(8.dp))

                when (rule.status) {
                    "disabled" -> Button(
                        onClick = onEnable,
                        enabled = !pending,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (pending) CircularProgressIndicator(
                            Modifier.size(14.dp), strokeWidth = 2.dp
                        ) else Text("启用", fontSize = 12.sp)
                    }
                    else -> OutlinedButton(
                        onClick = onDisable,
                        enabled = !pending,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (pending) CircularProgressIndicator(
                            Modifier.size(14.dp), strokeWidth = 2.dp
                        ) else Text("禁用", fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (color, icon, label) = when (status) {
        "trusted" -> Triple(Color(0xFF1E88E5), Icons.Outlined.CheckCircle, "高可信")
        "verified" -> Triple(Color(0xFF43A047), Icons.Outlined.CheckCircle, "已生效")
        "candidate" -> Triple(Color(0xFFFFA726), Icons.Outlined.HourglassEmpty, "候选")
        "disabled" -> Triple(Color(0xFFE53935), Icons.Outlined.Block, "已禁用")
        else -> Triple(Color.Gray, Icons.Outlined.Science, status)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = label, tint = color, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.Medium
        )
    }
}
