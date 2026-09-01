package com.xinwallet.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.model.Investment
import com.xinwallet.app.data.model.UpdateInvestmentRequest
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.ActionChip
import com.xinwallet.app.ui.components.BalanceCard
import com.xinwallet.app.ui.components.DatePickerField
import com.xinwallet.app.ui.components.DateTimePickerField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.SectionTitle
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.viewmodel.InvestmentsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneySigned
import com.xinwallet.app.util.todayDateTime
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvestmentDetailScreen(navController: NavHostController, id: Int) {
    val vm: InvestmentsViewModel = viewModel(factory = viewModelFactory { InvestmentsViewModel(AppContainer.investmentRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val inv = state.investments.find { it.id == id }
    var showAddSubMenu by remember { mutableStateOf(false) }
    var showAddSheet by remember { mutableStateOf(false) }
    var addSheetOp by remember { mutableStateOf<String?>(null) }
    var showInterestSheet by remember { mutableStateOf(false) }
    var showEditSheet by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it) } }

    Scaffold(
        topBar = { TopBar(inv?.name ?: "理财详情", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        when {
            state.loading -> LoadingBox()
            state.error != null -> ErrorState(state.error!!) { vm.load() }
            inv == null -> EmptyState("未找到该理财记录")
            else -> InvestmentDetailContent(
                inv = inv,
                navController = navController,
                onAddReduce = { showAddSubMenu = true },
                onInterest = { showInterestSheet = true },
                onEdit = { showEditSheet = true },
                onDelete = { showDeleteDialog = true },
                modifier = Modifier.fillMaxSize().padding(padding)
            )
        }
    }

    // 加/减仓子菜单
    if (showAddSubMenu) {
        AddReduceSubMenu(
            onDismiss = { showAddSubMenu = false },
            onAdd = { addSheetOp = "buy"; showAddSheet = true; showAddSubMenu = false },
            onReduce = { addSheetOp = "sell"; showAddSheet = true; showAddSubMenu = false },
            onClear = { addSheetOp = "sell_all"; showAddSheet = true; showAddSubMenu = false }
        )
    }

    // 加仓/减仓/清仓弹层（复用现有 InvestmentTxnSheet）
    if (showAddSheet) {
        InvestmentTxnSheet(
            invId = id,
            op = addSheetOp,
            onDismiss = { showAddSheet = false },
            onDone = { vm.load() },
            snackbar = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
        )
    }

    // 计息弹层
    if (showInterestSheet) {
        InterestSheet(
            invId = id,
            onDismiss = { showInterestSheet = false },
            onDone = { vm.load() },
            snackbar = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
        )
    }

    // 编辑弹层
    if (showEditSheet && inv != null) {
        EditInvestmentSheet(
            inv = inv,
            onDismiss = { showEditSheet = false },
            onDone = { vm.load() },
            snackbar = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
        )
    }

    // 删除确认
    if (showDeleteDialog) {
        DeleteConfirmationDialog(
            invName = inv?.name ?: "该理财",
            onConfirm = {
                showDeleteDialog = false
                scope.launch {
                    when (val res = AppContainer.investmentRepository.deleteInvestment(id)) {
                        is ApiResult.Success -> { navController.popBackStack() }
                        is ApiResult.Error -> snackbar.showSnackbar(res.message)
                    }
                }
            },
            onDismiss = { showDeleteDialog = false }
        )
    }
}

@Composable
private fun InvestmentDetailContent(
    inv: Investment,
    navController: NavHostController,
    onAddReduce: () -> Unit,
    onInterest: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    val dark = LocalIsDark.current
    val gain = inv.profit >= 0
    val profitColor = if (gain) (if (dark) IncomeColorDark else IncomeColor) else (if (dark) ExpenseColorDark else ExpenseColor)
    LazyColumn(modifier.padding(horizontal = 16.dp)) {
        item {
            Spacer(Modifier.height(12.dp))
            BalanceCard(
                "当前市值", inv.currentValue,
                "总成本 ${formatMoney(inv.totalCost)}",
                Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ProfitStatCard("收益", formatMoneySigned(inv.profit), profitColor, Modifier.weight(1f))
                ProfitStatCard("收益率", "${String.format("%.2f", inv.profitRate)}%", profitColor, Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
        }
        item { SectionTitle("持仓信息") }
        item {
            InfoRow("名称", inv.name)
            InfoRow("代码", if (inv.code.isBlank()) "—" else inv.code)
            InfoRow("类型", "${inv.typeIcon ?: "📈"} ${inv.typeName ?: "理财"}")
            InfoRow("关联账户", inv.accName ?: "—")
            InfoRow("买入价", formatMoney(inv.buyPrice))
            InfoRow("现价", formatMoney(inv.currentPrice))
            InfoRow("持有数量", if (inv.quantity > 0) inv.quantity.toString() else "—")
            InfoRow("买入日期", if (inv.buyDate.isBlank()) "—" else inv.buyDate.take(10))
            if (!inv.note.isNullOrBlank()) InfoRow("备注", inv.note!!)
            Spacer(Modifier.height(16.dp))
        }
        // —— 4 个操作 chip：加/减仓 / 计息 / 编辑 / 删除 ——
        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ActionChip("📊", "加/减仓", Modifier.weight(1f)) { onAddReduce() }
                ActionChip("💰", "计息", Modifier.weight(1f)) { onInterest() }
                ActionChip("✏️", "编辑", Modifier.weight(1f)) { onEdit() }
                ActionChip("🗑️", "删除", Modifier.weight(1f), danger = true) { onDelete() }
            }
            Spacer(Modifier.height(12.dp))
        }
        item {
            // 交易记录入口：与上方操作 chip 同款样式，跳转独立页展示买入/卖出/分红等流水
            ActionChip("📋", "交易记录", Modifier.fillMaxWidth()) {
                navController.navigate(Screen.InvestmentTransactions.create(inv.id))
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun ProfitStatCard(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = modifier
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(88.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
}

/**
 * 加仓/减仓子菜单：点开「加/减仓」chip 后弹出的 3 选项 sheet。
 * 选定后关闭本菜单，打开对应的 InvestmentTxnSheet 表单。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddReduceSubMenu(
    onDismiss: () -> Unit,
    onAdd: () -> Unit,
    onReduce: () -> Unit,
    onClear: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text("📊 加仓 / 减仓", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            listOf(
                Triple("🟢", "加仓（买入更多）", onAdd),
                Triple("🔴", "减仓（卖出部分）", onReduce),
                Triple("🏁", "清仓（全部卖出）", onClear)
            ).forEach { (icon, label, action) ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                        .clickable { action() }
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(icon, fontSize = 20.sp)
                        Spacer(Modifier.width(12.dp))
                        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onDismiss, Modifier.fillMaxWidth()) { Text("取消") }
        }
    }
}

/**
 * 记录利息（type=interest）：后端会把这笔利息入账到关联账户的「理财收益」分类。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InterestSheet(
    invId: Int,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
    snackbar: (String) -> Unit
) {
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayDateTime().take(10)) }
    var note by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text("💰 记录利息", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text("利息将入账到关联账户的「理财收益」", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = amount, onValueChange = { amount = it },
                label = { Text("利息金额") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            DatePickerField(label = "日期", date = date, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onDateChange = { date = it })
            OutlinedTextField(
                value = note, onValueChange = { note = it },
                label = { Text("备注（可选）") },
                singleLine = true, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
            )
            Button(
                onClick = {
                    val a = amount.toDoubleOrNull() ?: 0.0
                    if (a <= 0) { snackbar("请填写有效的利息金额"); return@Button }
                    scope.launch {
                        submitting = true
                        val res = AppContainer.investmentRepository.addTransaction(
                            invId, com.xinwallet.app.data.model.AddInvestmentTxnRequest("interest", a, 0.0, 0.0, date, note.ifBlank { null }, 0.0)
                        )
                        submitting = false
                        when (res) {
                            is ApiResult.Success -> { onDone(); onDismiss() }
                            is ApiResult.Error -> snackbar(res.message)
                        }
                    }
                },
                enabled = !submitting,
                modifier = Modifier.fillMaxWidth()
            ) { Text("保存") }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onDismiss, Modifier.fillMaxWidth()) { Text("取消") }
        }
    }
}

/**
 * 编辑持仓：发送全字段 UpdateInvestmentRequest 调 PUT /investments/:id。
 * 关联账户/类型/费率等不在表单中暴露，沿用原值；后端会回滚并重建台账。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditInvestmentSheet(
    inv: Investment,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
    snackbar: (String) -> Unit
) {
    var name by remember { mutableStateOf(inv.name) }
    var code by remember { mutableStateOf(inv.code) }
    var buyPrice by remember { mutableStateOf(if (inv.buyPrice > 0) inv.buyPrice.toString() else "") }
    var currentPrice by remember { mutableStateOf(if (inv.currentPrice > 0) inv.currentPrice.toString() else "") }
    var quantity by remember { mutableStateOf(if (inv.quantity > 0) inv.quantity.toString() else "") }
    var buyDate by remember { mutableStateOf(if (inv.buyDate.isNotBlank()) inv.buyDate else todayDateTime()) }
    var note by remember { mutableStateOf(inv.note ?: "") }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text("✏️ 编辑持仓", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text("类型与关联账户如需调整，请删除后重新添加", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = name, onValueChange = { name = it },
                label = { Text("名称 *") },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = code, onValueChange = { code = it },
                label = { Text("代码") },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = buyPrice, onValueChange = { buyPrice = it },
                label = { Text("买入价") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = currentPrice, onValueChange = { currentPrice = it },
                label = { Text("现价") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = quantity, onValueChange = { quantity = it },
                label = { Text("持有数量") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            DateTimePickerField(label = "买入日期", value = buyDate, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onValueChange = { buyDate = it })
            OutlinedTextField(
                value = note, onValueChange = { note = it },
                label = { Text("备注（可选）") },
                singleLine = true, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
            )
            Button(
                onClick = {
                    if (name.isBlank()) { snackbar("请填写名称"); return@Button }
                    val bp = buyPrice.toDoubleOrNull() ?: 0.0
                    val cp = currentPrice.toDoubleOrNull() ?: 0.0
                    val q = quantity.toDoubleOrNull() ?: 0.0
                    scope.launch {
                        submitting = true
                        val req = UpdateInvestmentRequest(
                            accountId = inv.accountId,
                            investmentTypeId = inv.investmentTypeId,
                            name = name,
                            code = code,
                            buyPrice = bp,
                            currentPrice = cp,
                            quantity = q,
                            totalCost = inv.totalCost,
                            currentValue = cp * q,
                            fee = inv.fee,
                            buyDate = buyDate,
                            expectedRate = inv.expectedRate,
                            riskLevel = inv.riskLevel,
                            note = note.ifBlank { null }
                        )
                        val res = AppContainer.investmentRepository.updateInvestment(inv.id, req)
                        submitting = false
                        when (res) {
                            is ApiResult.Success -> { onDone(); onDismiss() }
                            is ApiResult.Error -> snackbar(res.message)
                        }
                    }
                },
                enabled = !submitting,
                modifier = Modifier.fillMaxWidth()
            ) { Text("保存") }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onDismiss, Modifier.fillMaxWidth()) { Text("取消") }
        }
    }
}

/**
 * 删除持仓二次确认：后端会清理该持仓的全部交易流水和关联台账。
 */
@Composable
private fun DeleteConfirmationDialog(
    invName: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("删除持仓") },
        text = {
            Text("确定要删除「$invName」吗？\n\n该持仓的全部交易记录、关联账户流水将一并清理，且不可恢复。")
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("删除", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

/**
 * 理财「记一笔」底部弹层（安卓端此前整段缺失，仅有查询/删除）。
 * 投资交易记录页（InvestmentTransactionsScreen）FAB 调用此 sheet，op=null 时先展示
 * 操作选择（买入/卖出/分红/清仓），选定后展示对应表单；
 * 买入/卖出走 /reduce（自动更新持仓成本与数量），分红/计息走 /transactions，
 * 清仓走 /sell。保存成功后 onDone 刷新持仓、onDismiss 关闭。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvestmentTxnSheet(
    invId: Int,
    op: String?,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
    snackbar: (String) -> Unit,
    editing: com.xinwallet.app.data.model.InvestmentTransaction? = null
) {
    val opLabels = mapOf(
        "buy" to "买入 / 加仓",
        "sell" to "卖出 / 减仓",
        "dividend" to "分红",
        "sell_all" to "清仓"
    )
    var localOp by remember { mutableStateOf(op ?: editing?.let {
        when (it.type) {
            "reinvest" -> "buy"
            "interest" -> "dividend"
            else -> it.type
        }
    }) }
    val scope = rememberCoroutineScope()

    var price by remember { mutableStateOf(editing?.price?.toString() ?: "") }
    var quantity by remember { mutableStateOf(editing?.quantity?.toString() ?: "") }
    var amount by remember { mutableStateOf(editing?.amount?.toString() ?: "") }
    var sellPrice by remember { mutableStateOf("") }
    var fee by remember { mutableStateOf(editing?.fee?.toString() ?: "") }
    var date by remember { mutableStateOf(editing?.date?.take(10) ?: todayDateTime().take(10)) }
    var note by remember { mutableStateOf(editing?.note ?: "") }
    var submitting by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            if (localOp == null) {
                Text("记一笔", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                listOf(
                    "buy" to "🟢 买入 / 加仓",
                    "sell" to "🔴 卖出 / 减仓",
                    "dividend" to "💰 分红到账",
                    "sell_all" to "🏁 清仓（全部卖出）"
                ).forEach { (k, label) ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                            .clickable { localOp = k }
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(label, style = MaterialTheme.typography.bodyLarge)
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onDismiss, Modifier.fillMaxWidth()) { Text("取消") }
            } else {
                val title = opLabels[localOp] ?: "记一笔"
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))

                if (localOp == "dividend") {
                    OutlinedTextField(
                        value = amount, onValueChange = { amount = it },
                        label = { Text("分红金额") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (localOp == "buy" || localOp == "sell") {
                    OutlinedTextField(
                        value = price, onValueChange = { price = it },
                        label = { Text("单价") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = quantity, onValueChange = { quantity = it },
                        label = { Text("数量") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = fee, onValueChange = { fee = it },
                        label = { Text("手续费（可选）") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                }
                if (localOp == "sell_all") {
                    OutlinedTextField(
                        value = sellPrice, onValueChange = { sellPrice = it },
                        label = { Text("清仓价（单价）") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = fee, onValueChange = { fee = it },
                        label = { Text("手续费（可选）") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true, modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                }

                DatePickerField(label = "日期", date = date, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), onDateChange = { date = it })
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("备注（可选）") },
                    singleLine = true, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
                )

                Button(
                    onClick = {
                        val p = price.toDoubleOrNull() ?: 0.0
                        val q = quantity.toDoubleOrNull() ?: 0.0
                        val a = amount.toDoubleOrNull() ?: 0.0
                        val sp = sellPrice.toDoubleOrNull() ?: 0.0
                        val f = fee.toDoubleOrNull() ?: 0.0
                        val valid = when (localOp) {
                            "buy", "sell" -> p > 0 && q > 0
                            "dividend" -> a > 0
                            "sell_all" -> sp > 0
                            else -> false
                        }
                        if (!valid) { snackbar("请填写有效的金额 / 价格与数量"); return@Button }
                        scope.launch {
                            submitting = true
                            val res = if (editing != null) {
                                // 编辑已有流水：金额按类型推导（分红/利息用 amount，买卖用 单价×数量）
                                val amt = if (localOp == "dividend" || localOp == "interest") a else (p * q)
                                AppContainer.investmentRepository.editTransaction(
                                    invId, editing.id,
                                    com.xinwallet.app.data.model.UpdateInvestmentTxnRequest(
                                        type = localOp ?: "buy",
                                        amount = amt,
                                        price = p,
                                        quantity = q,
                                        date = date,
                                        note = note.ifBlank { null },
                                        fee = f
                                    )
                                )
                            } else when (localOp) {
                                "buy" -> AppContainer.investmentRepository.reduce(
                                    invId, com.xinwallet.app.data.model.ReduceInvestmentRequest("buy", p, q, f, date, note.ifBlank { null })
                                )
                                "sell" -> AppContainer.investmentRepository.reduce(
                                    invId, com.xinwallet.app.data.model.ReduceInvestmentRequest("sell", p, q, f, date, note.ifBlank { null })
                                )
                                "dividend" -> AppContainer.investmentRepository.addTransaction(
                                    invId, com.xinwallet.app.data.model.AddInvestmentTxnRequest("dividend", a, 0.0, 0.0, date, note.ifBlank { null }, 0.0)
                                )
                                "sell_all" -> AppContainer.investmentRepository.sell(
                                    invId, com.xinwallet.app.data.model.SellInvestmentRequest(sp, date, note.ifBlank { null }, f)
                                )
                                else -> null
                            }
                            submitting = false
                            when (res) {
                                is ApiResult.Success -> { onDone(); onDismiss() }
                                is ApiResult.Error -> snackbar(res.message)
                                null -> snackbar("操作类型无效")
                            }
                        }
                    },
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("保存") }
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onDismiss, Modifier.fillMaxWidth()) { Text("取消") }
            }
        }
    }
}
