package com.xinwallet.app.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.material3.Scaffold
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateSavingGoalRequest
import com.xinwallet.app.data.model.SavingGoal
import com.xinwallet.app.data.model.SavingsAllocateRequest
import com.xinwallet.app.data.model.SavingsWithdrawRequest
import com.xinwallet.app.data.model.UpdateSavingGoalRequest
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LinearProgress
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.viewmodel.SavingsGoalsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix

private val GOAL_ICONS = listOf("🎯", "💰", "🏠", "🚗", "✈️", "📈", "🎓", "💍")

@Composable
fun SavingsTab() {
    val vm: SavingsGoalsViewModel = viewModel(factory = viewModelFactory { SavingsGoalsViewModel(AppContainer.savingsGoalRepository, AppContainer.accountRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    var editing by remember { mutableStateOf<SavingGoal?>(null) }
    var showForm by remember { mutableStateOf(false) }
    var actionTarget by remember { mutableStateOf<SavingGoal?>(null) }
    var allocateTarget by remember { mutableStateOf<SavingGoal?>(null) }
    var withdrawTarget by remember { mutableStateOf<SavingGoal?>(null) }
    var confirmDelete by remember { mutableStateOf<SavingGoal?>(null) }
    var showTxns by remember { mutableStateOf<SavingGoal?>(null) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.formDone) {
        if (state.formDone) {
            showForm = false; editing = null; allocateTarget = null; withdrawTarget = null; confirmDelete = null
            showTxns = null; vm.consumeFormDone()
        }
    }
    LaunchedEffect(showTxns) { showTxns?.let { vm.loadTxns(it.id) } }

    if (showForm) {
        GoalFormDialog(
            goal = editing,
            accounts = state.accounts,
            submitting = state.submitting,
            onDismiss = { showForm = false; editing = null },
            onSubmit = { name, target, accId, srcId, icon, note ->
                val target2 = editing
                if (target2 == null) {
                    vm.create(CreateSavingGoalRequest(name, target, accId, srcId, icon, note))
                } else {
                    vm.update(target2.id, UpdateSavingGoalRequest(name, target, accId, srcId, icon, note))
                }
            }
        )
    }

    actionTarget?.let { g ->
        AlertDialog(
            onDismissRequest = { actionTarget = null },
            title = { Text(g.name) },
            text = {
                Column {
                    TextButton(onClick = { allocateTarget = g; actionTarget = null }) { Text("💸 存入目标") }
                    TextButton(onClick = { withdrawTarget = g; actionTarget = null }) { Text("🏧 取回目标") }
                    TextButton(onClick = { showTxns = g; actionTarget = null }) { Text("📜 查看流水") }
                    TextButton(onClick = { editing = g; showForm = true; actionTarget = null }) { Text("✏️ 编辑") }
                    TextButton(onClick = { confirmDelete = g; actionTarget = null }) { Text("🗑 删除", color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { actionTarget = null }) { Text("取消") } }
        )
    }

    allocateTarget?.let { g ->
        TransferDialog(
            title = "存入「${g.name}」",
            accounts = state.accounts.filter { it.id != g.accountId },
            label = "从账户",
            submitting = state.submitting,
            onDismiss = { allocateTarget = null },
            onSubmit = { amount, accId -> vm.allocate(g.id, SavingsAllocateRequest(amount, accId)) }
        )
    }

    withdrawTarget?.let { g ->
        TransferDialog(
            title = "取回「${g.name}」",
            accounts = state.accounts.filter { it.id != g.accountId },
            label = "到账户",
            submitting = state.submitting,
            onDismiss = { withdrawTarget = null },
            onSubmit = { amount, accId -> vm.withdraw(g.id, SavingsWithdrawRequest(amount, accId)) }
        )
    }

    confirmDelete?.let { g ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除目标「${g.name}」？") },
            text = { Text("删除后不可恢复。") },
            confirmButton = { TextButton(onClick = { vm.delete(g.id); confirmDelete = null }) { Text("删除", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消") } }
        )
    }

    showTxns?.let { g ->
        TxnsDialog(goal = g, txns = state.txns, loading = state.txnsLoading, onDismiss = { showTxns = null; vm.clearTxns() })
    }

    Box(Modifier.fillMaxSize()) {
        when {
            state.loading && state.goals.isEmpty() -> LoadingBox()
            state.error != null && state.goals.isEmpty() -> com.xinwallet.app.ui.components.ErrorState(state.error!!) { vm.load() }
            else -> {
                if (state.goals.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState("还没有储蓄目标，点右下角「+」新增")
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(state.goals, key = { it.id }) { g ->
                            GoalRow(goal = g, onClick = { editing = g; showForm = true }, onLongClick = { actionTarget = g })
                        }
                        item { Spacer(Modifier.height(88.dp)) }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { editing = null; showForm = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            text = { Text("新增目标") },
            icon = { Icon(Icons.Filled.Add, "新增目标") }
        )
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun GoalRow(goal: SavingGoal, onClick: () -> Unit, onLongClick: () -> Unit) {
    val dark = LocalIsDark.current
    val ratio = if (goal.targetAmount > 0) (goal.currentAmount / goal.targetAmount).toFloat() else 0f
    val done = goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount
    val color = if (done) MaterialTheme.colorScheme.primary else if (dark) ExpenseColorDark else ExpenseColor
    Column(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(goal.icon ?: "🎯", style = MaterialTheme.typography.titleMedium) }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(goal.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text("储蓄账户 ${goal.accName ?: "-"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                // 多币种 P2-2e：目标当前/目标金额按关联储蓄账户币种格式化
                Text(formatMoney(goal.currentAmount, goal.currency), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = color)
                Text("/ ${formatMoney(goal.targetAmount, goal.currency)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(8.dp))
        LinearProgress(ratio, color)
    }
}

@Composable
private fun GoalFormDialog(
    goal: SavingGoal?,
    accounts: List<Account>,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (name: String, target: Double, accId: Int, srcId: Int, icon: String, note: String) -> Unit
) {
    var name by remember { mutableStateOf(goal?.name.orEmpty()) }
    var target by remember { mutableStateOf(if (goal != null) trimAmount(goal.targetAmount) else "") }
    var accId by remember { mutableStateOf(goal?.accountId ?: accounts.firstOrNull()?.id ?: 0) }
    var srcId by remember { mutableStateOf(goal?.sourceAccountId ?: accounts.firstOrNull()?.id ?: 0) }
    var icon by remember { mutableStateOf(goal?.icon ?: "🎯") }
    var note by remember { mutableStateOf(goal?.note.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }

    val accOptions = accounts.map { "${it.name} ${it.icon ?: ""}" to it.id }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(if (goal == null) "新增储蓄目标" else "编辑储蓄目标") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 460.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("目标名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = target,
                    onValueChange = { target = it.filter { c -> c.isDigit() || c == '.' } },
                    label = { Text("目标金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                DropdownField(label = "储蓄账户（资金归集账户）", value = accOptions.firstOrNull { it.second == accId }?.first ?: "请选择", options = accOptions, onSelected = { accId = it })
                Spacer(Modifier.height(12.dp))
                DropdownField(label = "来源账户（存入时从此扣款）", value = accOptions.firstOrNull { it.second == srcId }?.first ?: "请选择", options = accOptions, onSelected = { srcId = it })
                Spacer(Modifier.height(12.dp))
                Text("图标", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    GOAL_ICONS.forEach { e -> IconChoice(e, icon == e) { icon = e } }
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("备注（可选）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
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
                    if (name.isBlank()) { localError = "请输入目标名称"; return@TextButton }
                    val t = target.toDoubleOrNull()
                    if (t == null || t <= 0) { localError = "请输入有效目标金额"; return@TextButton }
                    if (accId == 0 || srcId == 0) { localError = "请选择储蓄账户与来源账户"; return@TextButton }
                    if (accId == srcId) { localError = "储蓄账户不能与来源账户相同"; return@TextButton }
                    localError = null
                    onSubmit(name.trim(), t, accId, srcId, icon, note.trim())
                }
            ) { Text(if (submitting) "保存中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun TransferDialog(
    title: String,
    accounts: List<Account>,
    label: String,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (amount: Double, accountId: Int) -> Unit
) {
    var amount by remember { mutableStateOf("") }
    var accId by remember { mutableStateOf(accounts.firstOrNull()?.id ?: 0) }
    var localError by remember { mutableStateOf<String?>(null) }
    val accOptions = accounts.map { "${it.name} ${it.icon ?: ""}" to it.id }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 360.dp)) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } },
                    label = { Text("金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                if (accOptions.isEmpty()) {
                    Text("暂无可用账户", color = MaterialTheme.colorScheme.error)
                } else {
                    DropdownField(label = label, value = accOptions.firstOrNull { it.second == accId }?.first ?: "请选择", options = accOptions, onSelected = { accId = it })
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
                    val amt = amount.toDoubleOrNull()
                    if (amt == null || amt <= 0) { localError = "请输入有效金额"; return@TextButton }
                    if (accId == 0) { localError = "请选择账户"; return@TextButton }
                    localError = null
                    onSubmit(amt, accId)
                }
            ) { Text(if (submitting) "处理中…" else "确定") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun TxnsDialog(goal: SavingGoal, txns: com.xinwallet.app.data.model.SavingsTxnResponse?, loading: Boolean, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${goal.name} · 流水") },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                if (loading) {
                    com.xinwallet.app.ui.components.LoadingBox()
                } else {
                    txns?.summary?.let { s ->
                        // 多币种 P2-2e：累计存入/取回按 breakdown 混显（跨账户存入会跨币种）
                        Text("累计存入 ${formatMoneyMix(s.depositBreakdown)} · 取回 ${formatMoneyMix(s.withdrawBreakdown)}", style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.height(8.dp))
                    }
                    if (txns?.transactions.isNullOrEmpty()) {
                        EmptyState("暂无流水")
                    } else {
                        LazyColumn(Modifier.fillMaxWidth()) {
                            items(txns!!.transactions) { t ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (t.type == "deposit") "存入" else "取回", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(48.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(t.date.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        t.accountName?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                    }
                                    // 多币种 P2-2e：流水金额按储蓄账户币种格式化
                                    Text(formatMoney(t.amount, t.currency), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } }
    )
}

@Composable
private fun IconChoice(emoji: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(40.dp).clickable { onClick() }
    ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(emoji, style = MaterialTheme.typography.titleMedium) } }
}

@Composable
fun SavingsGoalsScreen(navController: NavHostController) {
    Scaffold(
        topBar = { TopBar("储蓄目标", onBack = { navController.popBackStack() }) }
    ) { innerPadding ->
        Box(Modifier.fillMaxSize().padding(innerPadding)) { SavingsTab() }
    }
}

