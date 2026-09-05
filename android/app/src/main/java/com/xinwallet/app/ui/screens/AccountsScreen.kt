package com.xinwallet.app.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateAccountRequest
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.BalanceCard
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.PullRefreshBox
import com.xinwallet.app.ui.components.SectionTitle
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.components.accountTypeLabel
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.AccountsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney

val ACCOUNT_TYPE_ORDER = listOf("cash", "bank_card", "credit_card", "electronic_payment", "financial_account", "digital", "other")

private val ACCOUNT_ICONS = listOf("💰", "💵", "🏦", "💳", "📱", "📈", "🪙", "🧧", "🏧", "💼")

/** 计息周期取值（与后端一致），与下拉显示文本一一对应 */
private val INTEREST_CYCLES = listOf("monthly", "yearly", "daily")
private val INTEREST_CYCLE_LABELS = listOf("按月", "按年", "按日")

private fun interestCycleLabel(cycle: String): String =
    INTEREST_CYCLE_LABELS[INTEREST_CYCLES.indexOf(cycle).takeIf { it >= 0 } ?: 0]

@Composable
fun AccountsScreen(navController: NavHostController) {
    val vm: AccountsViewModel = viewModel(factory = viewModelFactory { AccountsViewModel(AppContainer.accountRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    // 只保留「新增」表单所需状态。
    // editing / longPressed / confirmClose / confirmDelete 已随列表页管理入口一起移除
    // （编辑、销户、删除统一在 AccountDetailScreen）。
    var showForm by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load() }
    // 回到前台（从后台返回）：重新拉取账户数据
    LaunchedEffect(Unit) {
        AppContainer.onForeground.collect { vm.load() }
    }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.formDone) {
        if (state.formDone) { showForm = false; vm.consumeFormDone() }
    }

    if (showForm) {
        // account = null 固定为新增模式（编辑入口已移到详情页）
        AccountFormDialog(
            account = null,
            submitting = state.submitting,
            onDismiss = { showForm = false },
            onSubmit = { name, type, icon, opening, credit, annualRate, interestCycle ->
                vm.create(CreateAccountRequest(name, type, icon, opening, credit, annualRate, interestCycle))
            }
        )
    }

    /*
     * 已移除：longPressed 操作弹窗（编辑/销户/删除）及其 confirmClose / confirmDelete 二次确认。
     *
     * AccountDetailScreen 顶部已有等价的三个 ActionChip（编辑/销户/删除）和同样文案的
     * 二次确认，这里是同一功能的第二份实现。用户反馈「这个功能重复」，故收敛为：
     *   列表页 = 浏览 + 选择（点击进详情）
     *   详情页 = 管理
     * 新增仍留在列表页 FAB —— 新增时还没有账户可进详情。
     * AccountFormDialog 保留：新增用它，且 AccountDetailScreen 也复用同一个 Composable。
     */

    Scaffold(
        topBar = { TopBar("账户") },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            FloatingActionButton(onClick = { showForm = true }) {
                Icon(Icons.Filled.Add, "新增账户")
            }
        }
    ) { padding ->
        when {
            state.loading && state.accounts.isEmpty() -> LoadingBox()
            state.error != null && state.accounts.isEmpty() -> ErrorState(state.error!!) { vm.load() }
            else -> {
                val grouped = ACCOUNT_TYPE_ORDER.mapNotNull { t ->
                    val list = state.accounts.filter { it.type == t }
                    if (list.isEmpty()) null else t to list
                }
                PullRefreshBox(
                    refreshing = state.loading,
                    onRefresh = { vm.load() },
                    modifier = Modifier.fillMaxSize().padding(padding)
                ) {
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Spacer(Modifier.height(12.dp))
                        // 多币种 P2-2e：总资产按币种 breakdown 混显（state.totalAssets 是
                        // 后端 SUM(balance) 不分 currency 的单值，混币种账本下无意义）
                        BalanceCard(
                            title = "总资产",
                            amount = state.totalAssets,
                            subtitle = "所有活跃账户余额合计",
                            modifier = Modifier.padding(horizontal = 16.dp),
                            breakdown = state.totalAssetsBreakdown
                        )
                    }
                    if (grouped.isEmpty()) {
                        item {
                            com.xinwallet.app.ui.components.EmptyState("还没有账户，点右下角「+」添加第一个")
                        }
                    }
                    grouped.forEach { (type, list) ->
                        item { SectionTitle("${accountTypeLabel(type)}（${list.size}）") }
                        items(list, key = { it.id }) { acc ->
                            AccountRowWithActions(
                                account = acc,
                                onClick = { navController.navigate(Screen.AccountDetail.create(acc.id)) }
                            )
                        }
                    }
                    item { Spacer(Modifier.height(88.dp)) }
                    }
                }
            }
        }
    }
}

/**
 * 账户行：整行点击进详情，不再提供行内管理入口。
 *
 * 历史沿革（别再来回改）：
 *  1. 最初只有长按 + 「· 长按管理」灰字提示 → 用户反馈「没有编辑删除功能」（发现不了）
 *  2. 于是加了可见的「⋯」按钮呼出编辑/销户/删除 → 用户反馈「这个功能重复」
 *     （因为 AccountDetailScreen 顶部已有同样的三个 ActionChip）
 *  3. 现在：列表页只负责浏览与进入，管理动作唯一入口是详情页。
 *
 * 结论：功能不是「越多入口越好」，同一动作只该有一个归属明确的位置。
 */
@Composable
private fun AccountRowWithActions(
    account: Account,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) { Text(account.icon ?: "💰", style = MaterialTheme.typography.titleMedium) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(account.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                if (account.status != "active") {
                    Spacer(Modifier.width(6.dp))
                    Text("已销户", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                }
            }
            Text(accountTypeLabel(account.type), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            // 多币种 P2-2e：账户余额/额度按账户自身币种格式化（accounts.currency，P2-2a 加列）
            Text(formatMoney(account.balance, account.currency), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            if (account.type == "credit_card" && account.creditLimit > 0) {
                Text("额度 ${formatMoney(account.creditLimit, account.currency)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * 账户新增 / 编辑表单。
 * 注意：编辑时改的是「期初余额」而不是实时余额 —— 实时余额由账本流水推导，
 * 这与 Web 端 v0.3.0 之后的账户模型保持一致。
 *
 * 可见性为 internal 而非 private：AccountDetailScreen 也要复用这个表单
 * （详情页的「编辑」入口）。Kotlin 的 private 是**文件级**作用域，同包不同文件
 * 也访问不到，所以必须放宽到 internal（模块内可见）。
 * 不要为了图省事在详情页复制一份 —— 字段校验规则（信用卡额度、利率、计息周期）
 * 只应有一处实现。
 */
@Composable
internal fun AccountFormDialog(
    account: Account?,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (name: String, type: String, icon: String, opening: Double, credit: Double, annualRate: Double, interestCycle: String) -> Unit
) {
    var name by remember { mutableStateOf(account?.name.orEmpty()) }
    var type by remember { mutableStateOf(account?.type ?: "cash") }
    var icon by remember { mutableStateOf(account?.icon ?: "💰") }
    var opening by remember { mutableStateOf(if (account != null) trimAmount(account.openingBalance) else "") }
    var credit by remember { mutableStateOf(if (account != null && account.creditLimit > 0) trimAmount(account.creditLimit) else "") }
    var annualRate by remember { mutableStateOf(if ((account?.annualRate ?: 0.0) > 0.0) trimAmount(account?.annualRate ?: 0.0) else "") }
    var interestCycle by remember { mutableStateOf(account?.interestCycle?.takeIf { INTEREST_CYCLES.contains(it) } ?: "monthly") }
    var localError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(if (account == null) "新增账户" else "编辑账户") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 420.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("账户名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                DropdownField(
                    label = "账户类型",
                    value = accountTypeLabel(type),
                    options = ACCOUNT_TYPE_ORDER.mapIndexed { idx, t -> accountTypeLabel(t) to idx },
                    onSelected = { idx -> type = ACCOUNT_TYPE_ORDER[idx] }
                )
                Spacer(Modifier.height(12.dp))
                Text("图标", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    ACCOUNT_ICONS.take(5).forEach { emoji -> IconChoice(emoji, icon == emoji) { icon = emoji } }
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    ACCOUNT_ICONS.drop(5).forEach { emoji -> IconChoice(emoji, icon == emoji) { icon = emoji } }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = opening,
                    onValueChange = { opening = it.filter { c -> c.isDigit() || c == '.' || c == '-' } },
                    label = { Text("期初余额") },
                    supportingText = { Text("当前余额由流水自动推导，这里填开户时的初始金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (type == "credit_card") {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = credit,
                        onValueChange = { credit = it.filter { c -> c.isDigit() || c == '.' } },
                        label = { Text("信用额度") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (type != "credit_card") {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = annualRate,
                        onValueChange = { annualRate = it.filter { c -> c.isDigit() || c == '.' } },
                        label = { Text("年利率（%）") },
                        supportingText = { Text("如 3.5 表示年利率 3.5%，用于计息参考，可不填") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(12.dp))
                    DropdownField(
                        label = "计息周期",
                        value = interestCycleLabel(interestCycle),
                        options = INTEREST_CYCLE_LABELS.mapIndexed { idx, label -> label to idx },
                        onSelected = { idx -> interestCycle = INTEREST_CYCLES[idx] }
                    )
                }
                localError?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !submitting,
                onClick = {
                    if (name.isBlank()) { localError = "请输入账户名称"; return@TextButton }
                    localError = null
                    onSubmit(
                        name.trim(),
                        type,
                        icon,
                        opening.toDoubleOrNull() ?: 0.0,
                        if (type == "credit_card") credit.toDoubleOrNull() ?: 0.0 else 0.0,
                        if (type != "credit_card") annualRate.toDoubleOrNull() ?: 0.0 else 0.0,
                        if (type != "credit_card") interestCycle else "monthly"
                    )
                }
            ) { Text(if (submitting) "保存中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun IconChoice(emoji: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(40.dp).clickable { onClick() }
    ) {
        Box(contentAlignment = Alignment.Center) { Text(emoji, style = MaterialTheme.typography.titleMedium) }
    }
}
