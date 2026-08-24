package com.xinwallet.app.ui.screens

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.UpdateAccountRequest
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.ActionChip
import com.xinwallet.app.ui.components.BalanceCard
import com.xinwallet.app.ui.components.DatePickerField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.SectionTitle
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.components.TransactionRow
import com.xinwallet.app.ui.components.accountTypeLabel
import com.xinwallet.app.ui.viewmodel.AccountsViewModel
import com.xinwallet.app.ui.viewmodel.TransactionsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.todayDate
import kotlinx.coroutines.launch

@Composable
fun AccountDetailScreen(navController: NavHostController, accountId: Int) {
    val vm: TransactionsViewModel = viewModel(factory = viewModelFactory { TransactionsViewModel(AppContainer.transactionRepository, AppContainer.accountRepository) })
    val state by vm.state.collectAsState()
    var account by remember { mutableStateOf<Account?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var showInterestDialog by remember { mutableStateOf(false) }
    var interestSubmitting by remember { mutableStateOf(false) }

    // 编辑 / 销户 / 删除：复用账户列表页的 AccountFormDialog 与 AccountsViewModel，
    // 不另写一套表单 —— 字段校验（信用卡必填额度、利率格式、计息周期取值）都在那边，
    // 复制一份必然漏掉某条规则。
    val accountsVm: AccountsViewModel = viewModel(factory = viewModelFactory { AccountsViewModel(AppContainer.accountRepository) })
    val accountsState by accountsVm.state.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var confirmClose by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    /**
     * 标记「本次 formDone 是删除触发的」。
     *
     * AccountsViewModel 把新增/编辑/销户/删除都汇流到同一个 submit()，成功后统一置
     * formDone=true，回调里分辨不出刚才干的是哪件事。删除后必须 popBackStack（账户已不存在，
     * 留在详情页只会展示陈旧数据并在下次刷新时报错），销户/编辑则应留在原页刷新。
     * 所以用一个显式标记来区分，不能只看 formDone。
     */
    var pendingDeleted by remember { mutableStateOf(false) }

    /** 拉取账户自身信息；编辑/销户成功后复用它刷新头部卡片 */
    suspend fun reloadAccount() {
        val r = AppContainer.accountRepository.getAllAccounts()
        if (r is ApiResult.Success) account = r.data?.accounts?.find { it.id == accountId }
    }

    LaunchedEffect(Unit) {
        vm.load(accountId = accountId)
        reloadAccount()
    }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it) } }
    LaunchedEffect(accountsState.error) { accountsState.error?.let { snackbar.showSnackbar(it); accountsVm.consumeError() } }
    LaunchedEffect(accountsState.toast) { accountsState.toast?.let { snackbar.showSnackbar(it); accountsVm.consumeToast() } }
    // 表单提交成功：关弹窗 + 刷新本页头部。
    // 删除成功要退回上一页 —— 账户已经没了，留在详情页会一直显示陈旧数据。
    LaunchedEffect(accountsState.formDone) {
        if (accountsState.formDone) {
            accountsVm.consumeFormDone()
            showForm = false
            if (pendingDeleted) {
                navController.popBackStack()
            } else {
                reloadAccount()
                vm.load(accountId = accountId)
            }
        }
    }

    if (showForm) {
        AccountFormDialog(
            account = account,
            submitting = accountsState.submitting,
            onDismiss = { showForm = false },
            onSubmit = { name, type, icon, opening, credit, annualRate, interestCycle ->
                accountsVm.update(accountId, UpdateAccountRequest(name, type, icon, opening, credit, annualRate, interestCycle))
            }
        )
    }

    if (confirmClose) {
        val acc = account
        AlertDialog(
            onDismissRequest = { confirmClose = false },
            title = { Text("销户「${acc?.name ?: ""}」？") },
            text = { Text("销户后该账户不再计入总资产，历史流水会完整保留。") },
            confirmButton = {
                TextButton(onClick = { accountsVm.close(accountId); confirmClose = false }) { Text("确认销户") }
            },
            dismissButton = { TextButton(onClick = { confirmClose = false }) { Text("取消") } }
        )
    }

    if (confirmDelete) {
        val acc = account
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("彻底删除「${acc?.name ?: ""}」？") },
            text = { Text("删除后不可恢复。若账户下已有流水或理财持仓，后端会拒绝删除，此时请改用「销户」。") },
            confirmButton = {
                TextButton(onClick = {
                    pendingDeleted = true
                    accountsVm.delete(accountId)
                    confirmDelete = false
                }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } }
        )
    }

    if (showInterestDialog) {
        AddInterestDialog(
            submitting = interestSubmitting,
            onDismiss = { if (!interestSubmitting) showInterestDialog = false },
            onSubmit = { amount, date, note ->
                interestSubmitting = true
                scope.launch {
                    when (val r = AppContainer.accountRepository.addInterest(accountId, amount, date, note)) {
                        is ApiResult.Success -> {
                            interestSubmitting = false
                            showInterestDialog = false
                            account = account?.copy(balance = r.data.balance, lastInterestDate = r.data.lastInterestDate)
                            snackbar.showSnackbar("利息已入账，最新余额 ${formatMoney(r.data.balance)}")
                            vm.load(accountId = accountId)
                        }
                        is ApiResult.Error -> {
                            interestSubmitting = false
                            snackbar.showSnackbar(r.message)
                        }
                    }
                }
            }
        )
    }

    Scaffold(
        topBar = { TopBar(account?.name ?: "账户", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        when {
            state.loading -> LoadingBox()
            state.error != null -> ErrorState(state.error!!) { vm.load(accountId = accountId) }
            else -> {
                LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
                    item {
                        Spacer(Modifier.height(12.dp))
                        account?.let { acc ->
                            val sub = buildString {
                                append(accountTypeLabel(acc.type))
                                if (acc.creditLimit > 0) append(" · 额度 ${formatMoney(acc.creditLimit)}")
                                acc.lastInterestDate?.takeIf { it.isNotBlank() }?.let { append(" · 上次计息 ${it.take(10)}") }
                                if (acc.status != "active") append(" · 已销户")
                            }
                            BalanceCard("当前余额", acc.balance, sub)
                            Spacer(Modifier.height(12.dp))
                            /*
                             * 操作区：与投资详情页同款 chip 排布（见 InvestmentDetailScreen）。
                             *
                             * 必须是可见 chip 而非藏进「⋯」或长按：账户列表页正是因为
                             * 「功能全有但只有长按能呼出」，被反馈成「没有编辑删除功能」。
                             *
                             * 销户仅对 active 账户有意义，已销户的账户该位置留空，
                             * chip 数量随之从 4 变 3（weight 自适应，不会留空洞）。
                             */
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (acc.status == "active") {
                                    ActionChip("💰", "记利息", Modifier.weight(1f)) { showInterestDialog = true }
                                }
                                ActionChip("✏️", "编辑", Modifier.weight(1f)) { showForm = true }
                                if (acc.status == "active") {
                                    ActionChip("📥", "销户", Modifier.weight(1f)) { confirmClose = true }
                                }
                                ActionChip("🗑️", "删除", Modifier.weight(1f), danger = true) { confirmDelete = true }
                            }
                            Spacer(Modifier.height(16.dp))
                        }
                        SectionTitle("交易记录")
                    }
                    if (state.items.isEmpty()) item { EmptyState("该账户暂无交易") }
                    else items(state.items) { TransactionRow(it) }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }
}

/**
 * 记利息弹窗：金额必填、日期默认今天、备注可选。
 * 确认后调 POST /accounts/accounts/{id}/interest，成功后由调用方刷新余额。
 */
@Composable
private fun AddInterestDialog(
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (amount: Double, date: String, note: String?) -> Unit
) {
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayDate()) }
    var note by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!submitting) onDismiss() },
        title = { Text("记利息") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 360.dp)) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } },
                    label = { Text("利息金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                DatePickerField(label = "计息日期", date = date, onDateChange = { date = it })
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("备注（可选）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
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
                    val v = amount.toDoubleOrNull()
                    if (v == null || v <= 0.0) { localError = "请输入正确的利息金额"; return@TextButton }
                    localError = null
                    onSubmit(v, date, note.trim().ifBlank { null })
                }
            ) { Text(if (submitting) "提交中…" else "确认") }
        },
        dismissButton = { TextButton(enabled = !submitting, onClick = onDismiss) { Text("取消") } }
    )
}
