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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.CreateInvestmentRequest
import com.xinwallet.app.data.model.Investment
import com.xinwallet.app.data.model.InvestmentType
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.BalanceCard
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.SectionTitle
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.components.DateTimePickerField
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.viewmodel.InvestmentsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix
import com.xinwallet.app.util.formatMoneySigned
import com.xinwallet.app.util.sumByCurrency
import com.xinwallet.app.util.todayDateTime

/**
 * 理财持仓列表主体。
 *
 * vm / includeSold / onIncludeSoldChange 都可选：
 *  - InvestmentsScreen（独立页）传入自己的 vm，以便和 FAB 新增表单共享同一份状态
 *    （新增成功后要刷新这个列表）
 *  - PlanningScreen 的 tab 里无参调用，此时自建 vm、自持 includeSold
 */
@Composable
fun InvestmentsContent(
    navController: NavHostController,
    contentPadding: PaddingValues = PaddingValues(),
    externalVm: InvestmentsViewModel? = null,
    externalIncludeSold: Boolean? = null,
    onIncludeSoldChange: ((Boolean) -> Unit)? = null
) {
    val vm: InvestmentsViewModel = externalVm
        ?: viewModel(factory = viewModelFactory { InvestmentsViewModel(AppContainer.investmentRepository) })
    val state by vm.state.collectAsState()
    // 受控/非受控两种模式：外部传了就用外部的，否则本地自持
    var localIncludeSold by remember { mutableStateOf(false) }
    val includeSold = externalIncludeSold ?: localIncludeSold

    // 已有外部 vm 时不重复触发首次加载 —— InvestmentsScreen 已经 load 过，
    // 这里再来一次会打出两次相同请求。
    LaunchedEffect(externalVm) { if (externalVm == null) vm.load(includeSold) }
    // 回到前台（从后台返回）：重新拉取理财数据
    LaunchedEffect(Unit) {
        AppContainer.onForeground.collect { vm.load(includeSold) }
    }

    when {
        state.loading -> LoadingBox()
        state.error != null && state.investments.isEmpty() -> ErrorState(state.error!!) { vm.load() }
        state.investments.isEmpty() -> EmptyState("暂无理财持仓，点右下角「+」添加")
        else -> {
            val sum = state.summary
            val grouped = state.investments.groupBy { it.typeName ?: "其他" }
            LazyColumn(Modifier.fillMaxSize().padding(contentPadding)) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("显示已清仓", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Switch(
                            checked = includeSold,
                            onCheckedChange = { v ->
                                if (onIncludeSoldChange != null) onIncludeSoldChange(v) else localIncludeSold = v
                                vm.load(v)
                            }
                        )
                    }
                }
                item {
                    Spacer(Modifier.height(12.dp))
                    // 多币种 P2-2e：后端 summary（calcPortfolioMetrics）是纯金额累加
                    // **不分 currency**，混币种账本下无意义 —— 客户端按
                    // investments[].currency 重新分组，交给 formatMoneyMix 混显。
                    val valueBd = sumByCurrency(state.investments, { it.currency }, { it.currentValue })
                    if (sum != null) {
                        val costBd = sumByCurrency(state.investments, { it.currency }, { it.totalCost })
                        // 总收益用单值 + 主货币（成本/市值混显已足够表达币种构成）
                        val cur = valueBd.entries.maxByOrNull { kotlin.math.abs(it.value) }?.key ?: "CNY"
                        val sub = "总成本 ${formatMoneyMix(costBd)} · 总收益 ${formatMoneySigned(sum.totalProfit, cur)}"
                        BalanceCard("理财总市值", sum.totalValue, sub, Modifier.padding(horizontal = 16.dp), breakdown = valueBd)
                    } else {
                        BalanceCard("理财总市值", state.investments.sumOf { it.currentValue }, null, Modifier.padding(horizontal = 16.dp), breakdown = valueBd)
                    }
                }
                grouped.forEach { (typeName, list) ->
                    item { SectionTitle("$typeName（${list.size}）") }
                    items(list) { inv ->
                        InvestmentRow(inv) { navController.navigate(Screen.InvestmentDetail.create(inv.id)) }
                    }
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
fun InvestmentsScreen(navController: NavHostController) {
    val vm: InvestmentsViewModel = viewModel(
        factory = viewModelFactory {
            InvestmentsViewModel(AppContainer.investmentRepository, AppContainer.accountRepository)
        }
    )
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var showForm by remember { mutableStateOf(false) }
    var includeSold by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load(includeSold) }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.formDone) {
        if (state.formDone) { showForm = false; vm.consumeFormDone() }
    }

    if (showForm) {
        InvestmentFormDialog(
            types = state.types,
            accounts = state.accounts,
            submitting = state.submitting,
            onDismiss = { showForm = false },
            onSubmit = { req -> vm.create(req, includeSold) }
        )
    }

    Scaffold(
        topBar = { TopBar("理财管理", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            // 新增持仓入口。此前本页只能看不能加 —— 持仓只能从 web 端建，
            // 「理财管理」页反而没有创建能力。
            FloatingActionButton(onClick = {
                vm.loadAccountsIfNeeded()
                showForm = true
            }) {
                Icon(Icons.Filled.Add, "新增持仓")
            }
        }
    ) { padding ->
        InvestmentsContent(navController, padding, vm, includeSold) { includeSold = it }
    }
}

@Composable
private fun InvestmentRow(inv: Investment, onClick: () -> Unit) {
    val dark = LocalIsDark.current
    val gain = inv.profit >= 0
    val profitColor = if (gain) (if (dark) IncomeColorDark else IncomeColor) else (if (dark) ExpenseColorDark else ExpenseColor)
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) { Text(inv.typeIcon ?: "📈", style = MaterialTheme.typography.titleMedium) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(inv.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(inv.typeName ?: "理财", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (inv.status == "sold") {
                    Spacer(Modifier.width(6.dp))
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
                        modifier = Modifier.padding(0.dp)
                    ) {
                        Text(
                            "已清仓",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                        )
                    }
                }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            // 多币种 P2-2e：单条理财的市值/收益按该理财自身币种格式化
            Text(formatMoney(inv.currentValue, inv.currency), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            Text(
                "${formatMoneySigned(inv.profit, inv.currency)}  (${String.format("%.2f", inv.profitRate)}%)",
                style = MaterialTheme.typography.labelSmall, color = profitColor
            )
        }
    }
}

/** 风险等级：值对齐服务端白名单（low/medium/high/very_high），标签用中文 */
private val RISK_OPTIONS = listOf(
    "低风险" to "low",
    "中风险" to "medium",
    "高风险" to "high",
    "极高风险" to "very_high"
)

/**
 * 新增理财持仓表单。
 *
 * 字段与 web 端 investment.js 的 save() 一致，只保留建仓必需项：
 * 类型（必填）、名称（必填）、代码、扣款账户、买入价、数量、手续费、买入日期、风险、备注。
 * 预期收益率等编辑期才有意义的字段不在建仓表单里出现。
 */
@Composable
private fun InvestmentFormDialog(
    types: List<InvestmentType>,
    accounts: List<Account>,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (CreateInvestmentRequest) -> Unit
) {
    // 预选第一个类型：investment_type_id 是服务端必填，
    // 留空会让用户填完全部字段才在提交时被拒。
    var typeId by remember(types) { mutableStateOf(types.firstOrNull()?.id ?: 0) }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var accountId by remember { mutableStateOf(0) }
    var buyPrice by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("") }
    var fee by remember { mutableStateOf("") }
    var buyDate by remember { mutableStateOf(todayDateTime()) }
    var risk by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }

    // 总成本 = 买入价 × 数量 + 手续费。服务端 total_cost 不传会落 0，
    // 导致成本为 0、收益率算成无穷大，所以本地算好再提交，并实时回显给用户。
    val totalCost = (buyPrice.toDoubleOrNull() ?: 0.0) * (quantity.toDoubleOrNull() ?: 0.0) +
            (fee.toDoubleOrNull() ?: 0.0)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新增持仓") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DropdownField(
                    label = "理财类型 *",
                    value = types.firstOrNull { it.id == typeId }?.name ?: "",
                    options = types.map { it.name to it.id },
                    emptyHint = "暂无类型"
                ) { typeId = it }
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("产品名称 *") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = code, onValueChange = { code = it },
                    label = { Text("代码（选填，如 000001）") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                DropdownField(
                    label = "扣款账户",
                    value = if (accountId == 0) "不关联账户" else accounts.firstOrNull { it.id == accountId }?.name ?: "",
                    // 0 = 不关联：服务端 parseInt(0)||null → null，不生成扣款流水
                    options = listOf("不关联账户" to 0) + accounts.map { it.name to it.id },
                    emptyHint = "暂无账户"
                ) { accountId = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = buyPrice, onValueChange = { buyPrice = it },
                        label = { Text("买入价") }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                    )
                    OutlinedTextField(
                        value = quantity, onValueChange = { quantity = it },
                        label = { Text("数量/份额") }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                    )
                }
                OutlinedTextField(
                    value = fee, onValueChange = { fee = it },
                    label = { Text("手续费（选填）") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
                )
                // 实时回显推导值：提交后才看到就晚了（改一次得删了重建）
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("总成本", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    // 多币种 P2-2e：按所选扣款账户币种回显（未关联账户时默认 CNY）。
                    // 提交时 currency 留空，由后端按同一规则推断（investments.js：
                    // currency || 账户 currency || 'CNY'），两端口径一致。
                    val formCurrency = if (accountId == 0) "CNY"
                    else accounts.firstOrNull { it.id == accountId }?.currency ?: "CNY"
                    Text(formatMoney(totalCost, formCurrency), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                }
                DateTimePickerField(
                    label = "买入日期",
                    value = buyDate,
                    modifier = Modifier.fillMaxWidth(),
                    onValueChange = { buyDate = it }
                )
                DropdownField(
                    label = "风险等级（选填）",
                    value = RISK_OPTIONS.firstOrNull { it.second == risk }?.first ?: "",
                    // 「不设置」允许撤销误选 —— risk_level 可空
                    options = listOf("不设置" to -1) + RISK_OPTIONS.mapIndexed { i, p -> p.first to i },
                    emptyHint = "不设置"
                ) { idx -> risk = if (idx < 0) "" else RISK_OPTIONS[idx].second }
                OutlinedTextField(
                    value = note, onValueChange = { note = it },
                    label = { Text("备注（选填）") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                localError?.let {
                    Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !submitting,
                onClick = {
                    if (name.isBlank()) { localError = "请输入产品名称"; return@TextButton }
                    if (typeId == 0) { localError = "请选择理财类型"; return@TextButton }
                    localError = null
                    val price = buyPrice.toDoubleOrNull() ?: 0.0
                    onSubmit(
                        CreateInvestmentRequest(
                            accountId = accountId.takeIf { it != 0 },
                            investmentTypeId = typeId,
                            name = name.trim(),
                            code = code.trim(),
                            buyPrice = price,
                            // 建仓时现价即买入价：此刻还没有行情变动，收益应为 0 而不是 -100%
                            currentPrice = price,
                            quantity = quantity.toDoubleOrNull() ?: 0.0,
                            totalCost = totalCost,
                            currentValue = totalCost,
                            fee = fee.toDoubleOrNull() ?: 0.0,
                            buyDate = buyDate,
                            riskLevel = risk.ifBlank { null },
                            note = note.trim()
                        )
                    )
                }
            ) { Text(if (submitting) "提交中…" else "保存") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}

/** 今天的 yyyy-MM-dd：买入日期默认值（多数记录当天录入，省一次选择） */
private fun todayIso(): String {
    val c = java.util.Calendar.getInstance()
    return String.format(
        "%04d-%02d-%02d",
        c.get(java.util.Calendar.YEAR),
        c.get(java.util.Calendar.MONTH) + 1,
        c.get(java.util.Calendar.DAY_OF_MONTH)
    )
}
