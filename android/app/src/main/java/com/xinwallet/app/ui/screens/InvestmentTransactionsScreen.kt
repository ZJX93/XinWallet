package com.xinwallet.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.InvestmentTransaction
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.viewmodel.InvestmentsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneySigned
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

@Composable
fun InvestmentTransactionsScreen(navController: NavHostController, id: Int) {
    val scope = rememberCoroutineScope()
    val vm: InvestmentsViewModel = viewModel(factory = viewModelFactory { InvestmentsViewModel(AppContainer.investmentRepository) })
    val state by vm.state.collectAsState()
    val inv = state.investments.find { it.id == id }

    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var list by remember { mutableStateOf<List<InvestmentTransaction>>(emptyList()) }
    var showDeleteFor by remember { mutableStateOf<InvestmentTransaction?>(null) }
    var showEditFor by remember { mutableStateOf<InvestmentTransaction?>(null) }
    var showSheet by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }

    fun loadList() {
        scope.launch {
            loading = true
            error = null
            when (val res = AppContainer.investmentRepository.getTransactions(id)) {
                is com.xinwallet.app.data.remote.ApiResult.Success -> {
                    list = res.data ?: emptyList()
                    loading = false
                }
                is com.xinwallet.app.data.remote.ApiResult.Error -> {
                    error = res.message
                    loading = false
                }
            }
        }
    }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(Unit) { loadList() }

    Scaffold(
        topBar = { TopBar("${inv?.name ?: "理财"} · 交易记录", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            FloatingActionButton(onClick = { showSheet = true }) {
                Icon(Icons.Filled.Add, contentDescription = "记一笔")
            }
        }
    ) { padding ->
        when {
            loading -> LoadingBox()
            error != null -> ErrorState(error!!) { loadList() }
            list.isEmpty() -> EmptyState("暂无交易记录")
            else -> {
                LazyColumn(
                    Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)
                ) {
                    item { Spacer(Modifier.height(12.dp)) }
                    items(list) { tx -> TxRow(tx, onDelete = { showDeleteFor = tx }, onEdit = { showEditFor = tx }) }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }

        showDeleteFor?.let { tx ->
            AlertDialog(
                onDismissRequest = { showDeleteFor = null },
                title = { Text("确认删除") },
                text = { Text("确定删除该笔交易记录？") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDeleteFor = null
                            scope.launch {
                                when (val res = AppContainer.investmentRepository.deleteTransaction(id, tx.id)) {
                                    is com.xinwallet.app.data.remote.ApiResult.Success -> loadList()
                                    is com.xinwallet.app.data.remote.ApiResult.Error -> error = res.message
                                }
                            }
                        }
                    ) { Text("删除", color = MaterialTheme.colorScheme.error) }
                },
                dismissButton = { TextButton(onClick = { showDeleteFor = null }) { Text("取消") } }
            )
        }
    }

    if (showSheet) {
        InvestmentTxnSheet(
            invId = id,
            op = null,
            onDismiss = { showSheet = false },
            onDone = { loadList(); vm.load() },
            snackbar = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
        )
    }

    if (showEditFor != null) {
        InvestmentTxnSheet(
            invId = id,
            op = null,
            editing = showEditFor,
            onDismiss = { showEditFor = null },
            onDone = { loadList(); vm.load() },
            snackbar = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
        )
    }
}

@Composable
private fun TxRow(tx: InvestmentTransaction, onDelete: () -> Unit = {}, onEdit: () -> Unit = {}) {
    val dark = LocalIsDark.current
    val isBuy = tx.type == "buy" || tx.type == "reinvest"
    val isSell = tx.type == "sell"
    val gainColor = if (dark) IncomeColorDark else IncomeColor
    val lossColor = if (dark) ExpenseColorDark else ExpenseColor

    val amountColor = when {
        isBuy -> lossColor          // 买入/红利再投：资金流出
        isSell -> gainColor         // 卖出：资金流入
        else -> MaterialTheme.colorScheme.onSurface  // 分红/利息：收入
    }

    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                // 类型标签
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = amountColor.copy(alpha = 0.14f),
                    modifier = Modifier.padding(bottom = 6.dp)
                ) {
                    Text(
                        tx.typeLabel,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Medium,
                        color = amountColor,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
                Text(
                    tx.date.take(10).ifBlank { tx.date },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                // 系统自动备注文案不再展示，改为展示用户 note
                val sysNotes = setOf("初始买入", "加仓", "部分卖出", "清仓卖出", "建仓")
                val noteText = if (!tx.note.isNullOrBlank() && tx.note !in sysNotes) tx.note else null
                if (!noteText.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "📝 $noteText",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    // 多币种 P2-2e：单价 / 手续费跟随理财流水币种
                    "单价 ${formatMoney(tx.price, tx.currency)} · 数量 ${tx.quantity} · 手续费 ${formatMoney(tx.fee, tx.currency)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    // 多币种 P2-2e：流水金额按 tx.currency 格式化
                    formatMoneySigned(tx.amount, tx.currency),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = amountColor
                )
                IconButton(onClick = onEdit) {
                    Icon(Icons.Filled.Edit, contentDescription = "编辑", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
