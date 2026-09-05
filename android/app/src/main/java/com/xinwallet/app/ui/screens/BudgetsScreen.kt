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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.Scaffold
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.data.model.Budget
import com.xinwallet.app.data.model.CreateBudgetRequest
import com.xinwallet.app.data.model.UpdateBudgetRequest
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.DatePickerField
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LinearProgress
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.viewmodel.BudgetsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix
import com.xinwallet.app.util.todayDate

private val BUDGET_PERIODS = listOf(
    "月" to "month",
    "周" to "week",
    "季" to "quarter",
    "半年" to "half",
    "年" to "year"
)

private fun periodLabel(type: String): String =
    BUDGET_PERIODS.firstOrNull { it.second == type }?.first ?: "月"

@Composable
fun BudgetsTab() {
    val vm: BudgetsViewModel = viewModel(factory = viewModelFactory { BudgetsViewModel(AppContainer.budgetRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    var editing by remember { mutableStateOf<Budget?>(null) }
    var showForm by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Budget?>(null) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.formDone) {
        if (state.formDone) { showForm = false; editing = null; vm.consumeFormDone() }
    }

    if (showForm) {
        BudgetFormDialog(
            budget = editing,
            submitting = state.submitting,
            onDismiss = { showForm = false; editing = null },
            onSubmit = { name, amount, period, baseDate ->
                val target = editing
                if (target == null) {
                    vm.create(CreateBudgetRequest(name, amount, period, baseDate))
                } else {
                    vm.update(target.id, UpdateBudgetRequest(name, amount, period, baseDate))
                }
            }
        )
    }

    confirmDelete?.let { b ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除预算「${b.name}」？") },
            text = { Text("删除后不可恢复。") },
            confirmButton = {
                TextButton(onClick = { vm.delete(b.id); confirmDelete = null }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消") } }
        )
    }

    Box(Modifier.fillMaxSize()) {
        when {
            state.loading && state.budgets.isEmpty() -> LoadingBox()
            state.error != null && state.budgets.isEmpty() -> com.xinwallet.app.ui.components.ErrorState(state.error!!) { vm.load() }
            else -> {
                if (state.budgets.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState("还没有预算，点右下角「+」新增")
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(state.budgets, key = { it.id }) { b ->
                            BudgetRow(
                                budget = b,
                                onClick = { editing = b; showForm = true },
                                onLongClick = { confirmDelete = b }
                            )
                        }
                        item { Spacer(Modifier.height(88.dp)) }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { editing = null; showForm = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            text = { Text("新增预算") },
            icon = { Icon(Icons.Filled.Add, "新增预算") }
        )
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun BudgetRow(budget: Budget, onClick: () -> Unit, onLongClick: () -> Unit) {
    val dark = LocalIsDark.current
    val ratio = if (budget.amount > 0) (budget.actual / budget.amount).toFloat() else 0f
    val over = budget.actual > budget.amount && budget.amount > 0
    val color = if (over) MaterialTheme.colorScheme.error else if (dark) ExpenseColorDark else ExpenseColor
    Column(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(budget.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.padding(start = 8.dp)
            ) { Text(periodLabel(budget.periodType), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)) }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
            // 多币种 P2-2e：「已用」按 actualBreakdown 混显（预算卡的实际支出来自
            // 各账户交易，混币种账本下会跨币种）
            Text("已用 ${formatMoneyMix(budget.actualBreakdown)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(8.dp))
            // 预算金额本身是 CNY 单货币估算（budgets.js / reports.js 同口径），不参与混显
            Text("预算 ${formatMoney(budget.amount)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(6.dp))
        LinearProgress(ratio, color)
        if (over) {
            Spacer(Modifier.height(4.dp))
            // 超支额 = actual 主货币值 - amount（两者同为主货币口径，可用单值）
            Text("已超支 ${formatMoney(budget.actual - budget.amount, budget.currency)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun BudgetFormDialog(
    budget: Budget?,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (name: String, amount: Double, period: String, baseDate: String?) -> Unit
) {
    var name by remember { mutableStateOf(budget?.name.orEmpty()) }
    var amount by remember { mutableStateOf(if (budget != null) trimAmount(budget.amount) else "") }
    var period by remember { mutableStateOf(budget?.periodType ?: "month") }
    var baseDate by remember { mutableStateOf(budget?.startDate?.takeIf { it.isNotBlank() } ?: "") }
    var localError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(if (budget == null) "新增预算" else "编辑预算") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 440.dp)) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("预算名称") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } },
                    label = { Text("预算金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                DropdownField(
                    label = "周期",
                    value = periodLabel(period),
                    options = BUDGET_PERIODS.map { it.first to 0 }.mapIndexed { i, p -> p.first to i },
                    onSelected = { idx -> period = BUDGET_PERIODS[idx].second }
                )
                Spacer(Modifier.height(12.dp))
                DatePickerField(
                    label = "起始日期（留空=今天）",
                    date = baseDate,
                    onDateChange = { baseDate = it }
                )
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
                    if (name.isBlank()) { localError = "请输入预算名称"; return@TextButton }
                    val amt = amount.toDoubleOrNull()
                    if (amt == null || amt <= 0) { localError = "请输入有效金额"; return@TextButton }
                    localError = null
                    onSubmit(name.trim(), amt, period, baseDate.ifBlank { null })
                }
            ) { Text(if (submitting) "保存中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
fun BudgetScreen(navController: NavHostController) {
    Scaffold(
        topBar = { TopBar("预算管理", onBack = { navController.popBackStack() }) }
    ) { innerPadding ->
        Box(Modifier.fillMaxSize().padding(innerPadding)) { BudgetsTab() }
    }
}

