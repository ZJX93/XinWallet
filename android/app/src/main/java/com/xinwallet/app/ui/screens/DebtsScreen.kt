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
import com.xinwallet.app.data.model.CreateDebtRequest
import com.xinwallet.app.data.model.CreateRepaymentRequest
import com.xinwallet.app.data.model.Debt
import com.xinwallet.app.data.model.DebtRepayment
import com.xinwallet.app.data.model.UpdateDebtRequest
import com.xinwallet.app.data.model.UpdateRepaymentRequest
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.DatePickerField
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LinearProgress
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.SectionTitle
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.viewmodel.DebtsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.todayDate

private val DEBT_DIRECTIONS = listOf("我欠别人（应付）" to "payable", "别人欠我（应收）" to "receivable")
private val DEBT_METHODS = listOf("等额本息" to "equal_installment", "等额本金" to "equal_principal", "先息后本" to "interest_only")

private fun directionLabel(d: String) = DEBT_DIRECTIONS.firstOrNull { it.second == d }?.first ?: "应付"
private fun methodLabel(m: String) = DEBT_METHODS.firstOrNull { it.second == m }?.first ?: "等额本息"
private fun statusLabel(s: String) = when (s) {
    "paid_off" -> "已还清"
    "overdue" -> "逾期"
    else -> "进行中"
}

@Composable
fun DebtsTab() {
    val vm: DebtsViewModel = viewModel(factory = viewModelFactory { DebtsViewModel(AppContainer.debtRepository, AppContainer.accountRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    var editing by remember { mutableStateOf<Debt?>(null) }
    var showForm by remember { mutableStateOf(false) }
    var detailId by remember { mutableStateOf<Int?>(null) }
    var repayId by remember { mutableStateOf<Int?>(null) }
    var confirmDeleteDebt by remember { mutableStateOf<Debt?>(null) }
    var confirmDeleteRepay by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var actionDebt by remember { mutableStateOf<Debt?>(null) }
    // 编辑还款：长按还款记录进入，回填金额/账户/日期/备注
    var editRepay by remember { mutableStateOf<DebtRepayment?>(null) }
    var editRepayDebtId by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.formDone) {
        if (state.formDone) {
            showForm = false; editing = null; repayId = null; confirmDeleteDebt = null; actionDebt = null
            vm.consumeFormDone()
        }
    }
    LaunchedEffect(detailId) { detailId?.let { vm.loadDetail(it) } }

    if (showForm) {
        DebtFormDialog(
            debt = editing,
            accounts = state.accounts,
            submitting = state.submitting,
            onDismiss = { showForm = false; editing = null },
            onSubmit = { name, principal, direction, accId, rate, term, method, due, note ->
                val target = editing
                val req = if (direction == "receivable") {
                    CreateDebtRequest(name, principal, "receivable", if (accId == 0) null else accId, rate, term, method, 0.0, due.ifBlank { null }, note)
                } else {
                    CreateDebtRequest(name, principal, "payable", if (accId == 0) null else accId, rate, term, method, 0.0, due.ifBlank { null }, note)
                }
                if (target == null) vm.create(req)
                else vm.update(target.id, UpdateDebtRequest(name, principal, direction, if (accId == 0) null else accId, rate, term, method, 0.0, due.ifBlank { null }, note))
            }
        )
    }

    actionDebt?.let { d ->
        AlertDialog(
            onDismissRequest = { actionDebt = null },
            title = { Text(d.name) },
            text = {
                Column {
                    TextButton(onClick = { editing = d; showForm = true; actionDebt = null }) { Text("✏️ 编辑") }
                    TextButton(onClick = { repayId = d.id; actionDebt = null }) { Text(if (d.direction == "receivable") "💰 记一笔收款" else "💸 记一笔还款") }
                    TextButton(onClick = { confirmDeleteDebt = d; actionDebt = null }) { Text("🗑 删除", color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { actionDebt = null }) { Text("取消") } }
        )
    }

    repayId?.let { id ->
        val debt = state.detail?.debt ?: state.debts.firstOrNull { it.id == id }
        debt?.let {
            RepaymentDialog(
                debt = it,
                accounts = state.accounts,
                submitting = state.submitting,
                onDismiss = { repayId = null },
                onSubmit = { amount, accId, date, note -> vm.repay(id, CreateRepaymentRequest(amount, date, note, accId)) }
            )
        }
    }

    // 编辑还款：长按还款记录进入，回填原值，保存走 updateRepayment
    editRepay?.let { r ->
        val debtId = editRepayDebtId
        val debt = state.detail?.debt ?: state.debts.firstOrNull { it.id == debtId }
        debt?.let {
            RepaymentDialog(
                debt = it,
                accounts = state.accounts,
                submitting = state.submitting,
                editing = r,
                onDismiss = { editRepay = null },
                onSubmit = { amount, accId, date, note ->
                    vm.updateRepayment(debtId ?: it.id, r.id, UpdateRepaymentRequest(amount, date, note, accId))
                },
                onDelete = { confirmDeleteRepay = (debtId ?: it.id) to r.id; editRepay = null }
            )
        }
    }

    confirmDeleteDebt?.let { d ->
        AlertDialog(
            onDismissRequest = { confirmDeleteDebt = null },
            title = { Text("删除债务「${d.name}」？") },
            text = { Text("将连带删除其还款流水，已产生的账户余额变动无法自动回滚，请确认。") },
            confirmButton = { TextButton(onClick = { vm.delete(d.id); confirmDeleteDebt = null }) { Text("删除", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDeleteDebt = null }) { Text("取消") } }
        )
    }

    confirmDeleteRepay?.let { (did, rid) ->
        AlertDialog(
            onDismissRequest = { confirmDeleteRepay = null },
            title = { Text("删除这条还款记录？") },
            text = { Text("删除后该笔还款对应的账户余额也会回滚。") },
            confirmButton = { TextButton(onClick = { vm.deleteRepayment(did, rid); confirmDeleteRepay = null }) { Text("删除", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDeleteRepay = null }) { Text("取消") } }
        )
    }

    detailId?.let { id ->
        val detail = state.detail
        DebtDetailDialog(
            loading = state.detailLoading,
            detail = detail,
            onDismiss = { detailId = null; vm.clearDetail() },
            onRepay = { repayId = id },
            onLongRepay = { rid ->
                val r = state.detail?.repayments?.firstOrNull { it.id == rid }
                if (r != null) { editRepay = r; editRepayDebtId = id }
            }
        )
    }

    Box(Modifier.fillMaxSize()) {
        when {
            state.loading && state.debts.isEmpty() -> LoadingBox()
            state.error != null && state.debts.isEmpty() -> com.xinwallet.app.ui.components.ErrorState(state.error!!) { vm.load() }
            else -> {
                val payable = state.debts.filter { it.direction == "payable" }
                val receivable = state.debts.filter { it.direction == "receivable" }
                if (state.debts.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { EmptyState("还没有债务记录，点右下角「+」新增") }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        item {
                            Spacer(Modifier.height(12.dp))
                            DebtSummaryCard(
                                payableRemaining = state.summary?.payable?.remaining ?: 0.0,
                                receivableRemaining = state.summary?.receivable?.remaining ?: 0.0,
                                dueThisMonth = state.summary?.payable?.dueThisMonth ?: 0.0,
                                overdue = state.summary?.payable?.overdueAmount ?: 0.0
                            )
                        }
                        if (payable.isNotEmpty()) item { SectionTitle("我欠别人（应付）") }
                        items(payable, key = { it.id }) { d ->
                            DebtRow(debt = d, onClick = { detailId = d.id }, onLongClick = { actionDebt = d })
                        }
                        if (receivable.isNotEmpty()) item { SectionTitle("别人欠我（应收）") }
                        items(receivable, key = { it.id }) { d ->
                            DebtRow(debt = d, onClick = { detailId = d.id }, onLongClick = { actionDebt = d })
                        }
                        item { Spacer(Modifier.height(88.dp)) }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { editing = null; showForm = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            text = { Text("新增债务") },
            icon = { Icon(Icons.Filled.Add, "新增债务") }
        )
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun DebtSummaryCard(payableRemaining: Double, receivableRemaining: Double, dueThisMonth: Double, overdue: Double) {
    val dark = LocalIsDark.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatCard("我欠别人", formatMoney(payableRemaining), if (dark) ExpenseColorDark else ExpenseColor, Modifier.weight(1f))
        StatCard("别人欠我", formatMoney(receivableRemaining), if (dark) IncomeColorDark else IncomeColor, Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatCard("本月待还", formatMoney(dueThisMonth), MaterialTheme.colorScheme.onSurfaceVariant, Modifier.weight(1f))
        StatCard("逾期未还", formatMoney(overdue), MaterialTheme.colorScheme.error, Modifier.weight(1f))
    }
}

@Composable
private fun StatCard(title: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    Card(modifier = modifier, shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = color)
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DebtRow(debt: Debt, onClick: () -> Unit, onLongClick: () -> Unit) {
    val dark = LocalIsDark.current
    val isRecv = debt.direction == "receivable"
    val paid = debt.principal - debt.remaining
    val ratio = if (debt.principal > 0) (paid / debt.principal).toFloat() else 0f
    val color = if (isRecv) (if (dark) IncomeColorDark else IncomeColor) else (if (dark) ExpenseColorDark else ExpenseColor)
    val statusColor = when (debt.status) {
        "paid_off" -> MaterialTheme.colorScheme.primary
        "overdue" -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(debt.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.padding(start = 8.dp)) {
                Text(statusLabel(debt.status), style = MaterialTheme.typography.labelSmall, color = statusColor, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
            Text("${directionLabel(debt.direction)} · 剩余 ${formatMoney(debt.remaining)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            if (!debt.dueDate.isNullOrBlank()) Text("到期 ${debt.dueDate}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(6.dp))
        LinearProgress(ratio, color)
        Spacer(Modifier.height(4.dp))
        Text("本金 ${formatMoney(debt.principal)} · 月供 ${formatMoney(debt.monthlyPayment)} · 已还 ${formatMoney(debt.paidTotal)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun DebtFormDialog(
    debt: Debt?,
    accounts: List<Account>,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (name: String, principal: Double, direction: String, accId: Int, rate: Double, term: Int, method: String, due: String, note: String) -> Unit
) {
    var name by remember { mutableStateOf(debt?.name.orEmpty()) }
    var direction by remember { mutableStateOf(debt?.direction ?: "payable") }
    var principal by remember { mutableStateOf(if (debt != null) trimAmount(debt.principal) else "") }
    var accId by remember { mutableStateOf(debt?.accountId ?: 0) }
    var rate by remember { mutableStateOf(if (debt != null) trimAmount(debt.interestRate) else "") }
    var term by remember { mutableStateOf(if (debt != null && debt.termMonths > 0) debt.termMonths.toString() else "") }
    var method by remember { mutableStateOf(debt?.method ?: "equal_installment") }
    var due by remember { mutableStateOf(debt?.dueDate?.takeIf { it.isNotBlank() } ?: "") }
    var note by remember { mutableStateOf(debt?.note.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }

    val accOptions = listOf("不关联账户" to 0) + accounts.map { "${it.name} ${it.icon ?: ""}" to it.id }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(if (debt == null) "新增债务" else "编辑债务") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 480.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("债务名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                DropdownField(label = "类型", value = directionLabel(direction), options = DEBT_DIRECTIONS.map { it.first to 0 }.mapIndexed { i, p -> p.first to i }, onSelected = { idx -> direction = DEBT_DIRECTIONS[idx].second })
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = principal, onValueChange = { principal = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("本金") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                DropdownField(label = "关联账户（可选）", value = accOptions.firstOrNull { it.second == accId }?.first ?: "请选择", options = accOptions, onSelected = { accId = it })
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(value = rate, onValueChange = { rate = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("年利率%") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(value = term, onValueChange = { term = it.filter { c -> c.isDigit() } }, label = { Text("期数(月)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(12.dp))
                DropdownField(label = "还款方式", value = methodLabel(method), options = DEBT_METHODS.map { it.first to 0 }.mapIndexed { i, p -> p.first to i }, onSelected = { idx -> method = DEBT_METHODS[idx].second })
                Spacer(Modifier.height(12.dp))
                DatePickerField(label = "到期日（可选）", date = due, onDateChange = { due = it })
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
                    if (name.isBlank()) { localError = "请输入债务名称"; return@TextButton }
                    val p = principal.toDoubleOrNull()
                    if (p == null || p <= 0) { localError = "请输入有效本金"; return@TextButton }
                    localError = null
                    onSubmit(name.trim(), p, direction, accId, rate.toDoubleOrNull() ?: 0.0, term.toIntOrNull() ?: 0, method, due, note.trim())
                }
            ) { Text(if (submitting) "保存中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@Composable
private fun RepaymentDialog(
    debt: Debt,
    accounts: List<Account>,
    submitting: Boolean,
    editing: DebtRepayment? = null,
    onDismiss: () -> Unit,
    onSubmit: (amount: Double, accountId: Int, date: String, note: String) -> Unit,
    onDelete: (() -> Unit)? = null
) {
    var amount by remember { mutableStateOf(if (editing != null) trimAmount(editing.amount) else "") }
    var accId by remember { mutableStateOf(editing?.accountId ?: accounts.firstOrNull()?.id ?: 0) }
    var date by remember { mutableStateOf(editing?.paidAt?.take(10) ?: todayDate()) }
    var note by remember { mutableStateOf(editing?.note.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }
    val accOptions = accounts.map { "${it.name} ${it.icon ?: ""}" to it.id }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text(if (editing != null) "编辑还款" else (if (debt.direction == "receivable") "记一笔收款" else "记一笔还款")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 360.dp)) {
                OutlinedTextField(value = amount, onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("金额") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                if (accOptions.isEmpty()) {
                    Text("暂无可用账户", color = MaterialTheme.colorScheme.error)
                } else {
                    DropdownField(label = "账户", value = accOptions.firstOrNull { it.second == accId }?.first ?: "请选择", options = accOptions, onSelected = { accId = it })
                }
                Spacer(Modifier.height(12.dp))
                DatePickerField(label = "日期", date = date, onDateChange = { date = it })
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("备注（可选）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (editing != null && onDelete != null) {
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = onDelete) { Text("🗑 删除这条记录", color = MaterialTheme.colorScheme.error) }
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
                    onSubmit(amt, accId, date, note.trim())
                }
            ) { Text(if (submitting) "处理中…" else "确定") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DebtDetailDialog(
    loading: Boolean,
    detail: com.xinwallet.app.data.model.DebtDetailResponse?,
    onDismiss: () -> Unit,
    onRepay: () -> Unit,
    onLongRepay: (rid: Int) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(detail?.debt?.name ?: "债务详情") },
        text = {
            if (loading || detail == null) {
                LoadingBox()
            } else {
                val d = detail.debt
                Column(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column { Text("剩余", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(formatMoney(d.remaining), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                        Column { Text("本金", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(formatMoney(d.principal), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                        Column { Text("月供", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(formatMoney(d.monthlyPayment), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                    }
                    if (d.note.isNullOrBlank().not()) {
                        Spacer(Modifier.height(6.dp))
                        Text("备注：${d.note}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("还款记录（${detail.repayments.size}）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(4.dp))
                    if (detail.repayments.isEmpty()) {
                        EmptyState("暂无还款记录")
                    } else {
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 240.dp)) {
                            items(detail.repayments) { r ->
                                Row(
                                    Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { onLongRepay(r.id) }).padding(vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(r.paidAt.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        r.accountName?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                    }
                                    Text(formatMoney(r.amount), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onRepay) { Text(if (detail?.debt?.direction == "receivable") "记收款" else "记还款") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("关闭") } }
    )
}

@Composable
fun LoanScreen(navController: NavHostController) {
    Scaffold(
        topBar = { TopBar("债务管理", onBack = { navController.popBackStack() }) }
    ) { innerPadding ->
        Box(Modifier.fillMaxSize().padding(innerPadding)) { DebtsTab() }
    }
}

