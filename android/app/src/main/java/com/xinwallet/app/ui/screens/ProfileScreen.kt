@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class
)

package com.xinwallet.app.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Wallet
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.viewmodel.ProfileViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * 「我的」页 — V2 精简版
 * 1) 头像 + 昵称 + 编辑 + 陪伴天数
 * 2) 宫格快捷入口（点击进入独立页面）— 含设置、应用锁
 * 3) 退出登录
 *
 * 外观主题 / 服务器地址 / 关于我们 + 应用内升级 已迁到独立页面 SettingsScreen。
 * 账本备份（xlsx 导出/导入）由「数据管理」宫格进入 DataManagementScreen，与鸿蒙端同一套服务端接口。
 */
@Composable
fun ProfileScreen(navController: NavHostController, onLogout: () -> Unit) {
    val vm: ProfileViewModel = viewModel(factory = viewModelFactory {
        ProfileViewModel(AppContainer.sessionManager, AppContainer.authRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val firstChar = state.username.firstOrNull()?.toString()?.uppercase() ?: "U"
    val memberDays = state.memberDays.coerceAtLeast(0)
    // 头像：优先服务端 avatar（emoji），否则 username 首字母
    val avatarText = state.avatar?.takeIf { it.isNotBlank() } ?: firstChar

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
        ) {
            Spacer(Modifier.height(8.dp))

            // 1) 头像 + 昵称 + 编辑
            var showEditProfile by remember { mutableStateOf(false) }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier.size(56.dp).clip(CircleShape).background(Brown100),
                    contentAlignment = Alignment.Center
                ) {
                    Text(avatarText, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Brown500)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            state.username.ifBlank { "未登录" },
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.width(6.dp))
                        Box(
                            Modifier
                                .size(28.dp)
                                .clip(CircleShape)
                                .clickable { showEditProfile = true },
                            contentAlignment = Alignment.Center
                        ) {
                            androidx.compose.material3.Icon(
                                Icons.Filled.Edit, contentDescription = "编辑个人信息",
                                tint = Brown500,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        if (memberDays > 0) "已经记账 $memberDays 天" else "今天开始记录吧",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 「修改个人信息」弹窗：头像 / 用户名 / 昵称 / 旧密码 / 新密码（修改密码为可选）
            if (showEditProfile) {
                EditProfileDialog(
                    currentAvatar = state.avatar,
                    currentUsername = state.username,
                    currentNickname = state.nickname,
                    submitting = state.editing,
                    onDismiss = {
                        showEditProfile = false
                        vm.clearMessage()
                    },
                    onSubmit = { avatar, username, nickname, oldPwd, newPwd ->
                        vm.submitProfile(avatar, username, nickname, oldPwd, newPwd)
                        // 成功提示后关闭弹窗（vm.state.message 非空 = 完成）
                        showEditProfile = false
                    }
                )
            }

            Spacer(Modifier.height(20.dp))

            // 2) 宫格快捷入口：每行 4 格，共 11 项（第 3 行 3 项左对齐 + 1 个占位）
            // 项目与顺序必须与鸿蒙 Profile.ets 的 GRID 数组逐项一致（见该文件注释）。
            // 注意「记一笔」不进宫格：底栏中间已有记账浮钮，重复入口是冗余。
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column(Modifier.padding(vertical = 12.dp)) {
                    val row1 = listOf(
                        QuickAction("截图记账", Icons.Filled.CameraAlt, QuickActionKind.Nav) { navController.navigate(Screen.AiScan.route) },
                        QuickAction("AI 洞察", Icons.Filled.Insights, QuickActionKind.Nav) { navController.navigate(Screen.AiInsight.route) },
                        QuickAction("AI 服务商", Icons.Filled.Cloud, QuickActionKind.Nav) { navController.navigate(Screen.ProviderList.route) },
                        QuickAction("AI 规则", Icons.Filled.AccountTree, QuickActionKind.Nav) { navController.navigate(Screen.RuleList.route) },
                        QuickAction("AI 建议", Icons.Filled.Lightbulb, QuickActionKind.Nav) { navController.navigate(Screen.AiAdvice.route) },
                        QuickAction("学习统计", Icons.Filled.School, QuickActionKind.Nav) { navController.navigate(Screen.LearningStats.route) },
                        QuickAction("模型评测", Icons.Filled.Assessment, QuickActionKind.Nav) { navController.navigate(Screen.Evaluation.route) },
                        QuickAction("分类管理", Icons.Filled.Sell, QuickActionKind.Nav) { navController.navigate(Screen.Categories.route) },
                        QuickAction("标签管理", Icons.Filled.LocalOffer, QuickActionKind.Nav) { navController.navigate(Screen.Tags.route) },
                        QuickAction("资产账户", Icons.Filled.Wallet, QuickActionKind.Nav) { navController.navigate(Screen.Accounts.route) }
                    )
                    val row2 = listOf(
                        QuickAction("理财管理", Icons.Filled.ShowChart, QuickActionKind.Nav) { navController.navigate(Screen.Investments.route) },
                        QuickAction("储蓄目标", Icons.Filled.Savings, QuickActionKind.Nav) { navController.navigate(Screen.SavingsGoals.route) },
                        QuickAction("预算管理", Icons.Filled.Receipt, QuickActionKind.Nav) { navController.navigate(Screen.Budgets.route) },
                        QuickAction("债务管理", Icons.Filled.SwapHoriz, QuickActionKind.Nav) { navController.navigate(Screen.Debts.route) }
                    )
                    val row3 = listOf(
                        QuickAction("数据管理", Icons.Filled.Storage, QuickActionKind.Nav) { navController.navigate(Screen.DataManagement.route) },
                        QuickAction("应用锁", Icons.Filled.Lock, QuickActionKind.Nav) { navController.navigate(Screen.AppLock.route) },
                        QuickAction("设置", Icons.Filled.Settings, QuickActionKind.Nav) { navController.navigate(Screen.Settings.route) }
                    )
                    @androidx.compose.runtime.Composable
                    fun renderRow(row: List<QuickAction>) {
                        // 每行固定 4 格；不足 4 项（如第三行 3 项）用等宽 Spacer 占位，
                        // 保证与上面满行对齐，后续新增功能从左往右依次填充。
                        Row(Modifier.fillMaxWidth()) {
                            row.forEach { item ->
                                QuickGridItem(item, modifier = Modifier.weight(1f))
                            }
                            repeat(4 - row.size) {
                                Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    renderRow(row1)
                    renderRow(row2)
                    renderRow(row3)
                }
            }

            Spacer(Modifier.height(32.dp))
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.Center) {
                OutlinedButton(onClick = { vm.logout(); onLogout() }) {
                    Text("退出登录")
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

/* ============================================================
 * 私有 Composable
 * ============================================================ */

/**
 * 「修改个人信息」弹窗
 * 字段：头像（emoji 快捷选择 + 手动输入）/ 用户名 / 昵称 / 旧密码 / 新密码（改密需同时填旧+新）
 * 提交后由 ProfileViewModel.submitProfile 调后端 PUT /api/auth/profile。
 */
@Composable
private fun EditProfileDialog(
    currentAvatar: String?,
    currentUsername: String,
    currentNickname: String,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (avatar: String?, username: String, nickname: String, oldPassword: String, newPassword: String) -> Unit
) {
    var avatar by remember { mutableStateOf(currentAvatar ?: "") }
    var username by remember { mutableStateOf(currentUsername) }
    var nickname by remember { mutableStateOf(currentNickname) }
    var oldPwd by remember { mutableStateOf("") }
    var newPwd by remember { mutableStateOf("") }

    val avatarPresets = listOf("💰", "🏠", "🍜", "✈️", "🎓", "🚗", "🎮", "🏥", "📚", "🐱", "🐶", "⭐")
    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text("修改个人信息") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                // 头像：预设 emoji 快捷选择 + 手动输入
                Text("头像", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    avatarPresets.forEach { emoji ->
                        val selected = avatar == emoji
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (selected) Brown100 else Color.Transparent)
                                .clickable(enabled = !submitting) { avatar = emoji },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(emoji, fontSize = 20.sp)
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = avatar,
                    onValueChange = { avatar = it.trim().take(10) },
                    label = { Text("自定义头像（emoji，最多 10 字符）") },
                    singleLine = true,
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it.trim() },
                    label = { Text("用户名") },
                    singleLine = true,
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = nickname,
                    onValueChange = { nickname = it },
                    label = { Text("昵称（可留空）") },
                    singleLine = true,
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                Text("修改密码（可留空）", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(
                    value = oldPwd,
                    onValueChange = { oldPwd = it },
                    label = { Text("旧密码") },
                    singleLine = true,
                    enabled = !submitting,
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = newPwd,
                    onValueChange = { newPwd = it },
                    label = { Text("新密码（≥8 位，含字母+数字）") },
                    singleLine = true,
                    enabled = !submitting,
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !submitting,
                onClick = { onSubmit(avatar.ifBlank { null }, username, nickname, oldPwd, newPwd) }
            ) { Text(if (submitting) "提交中…" else "保存") }
        },
        dismissButton = {
            TextButton(
                enabled = !submitting,
                onClick = onDismiss
            ) { Text("取消") }
        }
    )
}

private enum class QuickActionKind { Toast, Nav, Action }

private data class QuickAction(
    val label: String,
    val icon: ImageVector,
    val kind: QuickActionKind,
    val onDoubleClick: (() -> Unit)? = null,
    val onClick: () -> Unit
)

@Composable
private fun QuickGridItem(item: QuickAction, modifier: Modifier = Modifier) {
    val combined = if (item.onDoubleClick != null) {
        Modifier.combinedClickable(onClick = { item.onClick() }, onDoubleClick = { item.onDoubleClick!!() })
    } else {
        Modifier.clickable { item.onClick() }
    }
    Column(
        modifier = modifier.then(combined).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            Modifier.size(48.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            androidx.compose.material3.Icon(
                item.icon, contentDescription = item.label,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(22.dp)
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(item.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}
