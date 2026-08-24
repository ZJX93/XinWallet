package com.xinwallet.app.ui.screens

import java.util.Calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.PullRefreshBox
import com.xinwallet.app.ui.components.BookHeader
import com.xinwallet.app.ui.components.BookSwitcherSheet
import com.xinwallet.app.ui.components.CalendarCellData
import com.xinwallet.app.ui.components.CellKind
import com.xinwallet.app.ui.components.SharedCalendarCell
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import androidx.compose.foundation.isSystemInDarkTheme
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.viewmodel.shiftMonth
import com.xinwallet.app.ui.viewmodel.TransactionsViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyShort
import com.xinwallet.app.util.formatDayLabel
import com.xinwallet.app.util.todayDate
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce

/**
 * 账单流水页：月份切换 + 类型筛选 + 当月收支汇总 + 按日分组的流水，
 * 点击任意一条可编辑或删除（转账记录只允许删除，由后端联动删掉配对的另一条腿）。
 */
@Composable
fun TransactionsScreen(navController: NavHostController, initialMonth: String? = null, initialViewMode: String? = null) {
    val vm: TransactionsViewModel = viewModel(factory = viewModelFactory {
        TransactionsViewModel(AppContainer.transactionRepository, AppContainer.accountRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var acting by remember { mutableStateOf<TransactionItem?>(null) }
    var confirmDelete by remember { mutableStateOf<TransactionItem?>(null) }
    var showBookSheet by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // 外部传入的初始月份（如从首页"8月1日-8月31日"跳转而来）
    var appliedInitialMonth by remember { mutableStateOf(false) }
    if (initialMonth != null && !appliedInitialMonth) {
        vm.selectMonth(initialMonth)
        appliedInitialMonth = true
    }
    // 路由里传 view=calendar 时才显式进入日历视图；其他情况一律默认 list
    var appliedInitialView by remember { mutableStateOf(false) }
    if (initialViewMode != null && !appliedInitialView) {
        vm.setViewMode(initialViewMode)
        appliedInitialView = true
    }

    // 当前账本切换后重新初始化（X-Book-Id 已由 AuthInterceptor 注入，vm.init 拉取对应账本数据）
    val curBookId = AppContainer.currentBookId.collectAsState().value
    LaunchedEffect(curBookId) { vm.init() }
    // 从「记一笔 / 编辑 / AI 记账」返回本页时（NavBackStackEntry 重新 RESUME）自动刷新，
    // 保证列表与账户余额同步，不用用户手动下拉。
    var firstResume by remember { mutableStateOf(true) }
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                if (firstResume) firstResume = false else vm.refresh()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }

    // 月份选择器弹窗状态
    var showMonthPicker by remember { mutableStateOf(false) }
    // 视图模式：流水（list）/ 日历（calendar），由 ViewModel 持有，每次进入页面默认为 list
    val viewMode = state.viewMode
    // 日历模式下选中的日期（默认选中今日，显示今日详情）
    var calendarSelectedDay by remember { mutableStateOf(todayDate()) }

    acting?.let { item ->
        AlertDialog(
            onDismissRequest = { acting = null },
            title = {
                Text(
                    // 折叠转账的标题直接给「A → B」，比分类名「一般转账」有信息量
                    item.transfer?.let { "${it.from?.name ?: "?"} → ${it.to?.name ?: "?"}" }
                        ?: (item.category?.name ?: "交易")
                )
            },
            text = {
                Column {
                    Text(
                        formatMoney(if (item.transfer != null) kotlin.math.abs(item.amount) else item.amount),
                        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(item.date.take(19), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (!item.note.isNullOrBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(item.note, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (item.transfer != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "编辑会同时更新转出、转入两条记录并重算双方余额。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else if (item.transferId != null) {
                        // transferId 有但 transfer 为 null：双端账户名缺失（账户被删）
                        // 或 out 腿已被删的残留 in 腿。这类记录不能走转账表单
                        // （拿不到 from/to 无法回填），只保留删除。
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "这笔转账的账户信息不完整（可能账户已被删除），只能删除。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            },
            confirmButton = {
                // 编辑分三种情况：
                //   普通交易 → 记账页（EditTransaction）
                //   折叠转账 → 记账页的转账 tab（EditTransfer，内部走 PUT /transfers/{id}）
                //   信息不完整的转账残留 → 不给编辑（见上方说明）
                // 转账原先是在列表里弹表单改的，与「改支出/改收入」体验不一致，已统一为跳记账页。
                if (item.transfer != null) {
                    TextButton(onClick = {
                        acting = null
                        navController.navigate(Screen.EditTransfer.create(item.transfer.id, state.month))
                    }) {
                        Icon(Icons.Filled.Edit, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("编辑")
                    }
                } else if (item.transferId == null) {
                    TextButton(onClick = {
                        acting = null
                        navController.navigate(Screen.EditTransaction.create(item.id, state.month))
                    }) {
                        Icon(Icons.Filled.Edit, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("编辑")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = item; acting = null }) {
                    Icon(Icons.Filled.Delete, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(4.dp))
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            }
        )
    }

    // 转账编辑已改为跳记账页（Screen.EditTransfer），不再在列表内弹表单，
    // 原 TransferEditDialog 与 vm.saveTransfer 随之移除。

    confirmDelete?.let { item ->
        val tf = item.transfer
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text(if (item.transferId != null) "删除这笔转账？" else "删除这笔交易？") },
            text = {
                Text(
                    when {
                        // 有完整双端信息：把两个账户名写出来，用户才知道哪两笔余额会变
                        tf != null -> "转账在账本里是一进一出两条记录，删除会同时移除双方，" +
                                "并重算 ${tf.from?.name ?: "转出账户"} 和 ${tf.to?.name ?: "转入账户"} 的余额。此操作不可恢复。"
                        item.transferId != null -> "转账的转出、转入两条记录会一并删除，账户余额将重新计算。"
                        else -> "删除后账户余额会按账本重新计算，该操作不可撤销。"
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = { vm.delete(item); confirmDelete = null }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消") } }
        )
    }

    if (showMonthPicker) {
        // 日历视图强制按月模式（月历网格无按年语义），且不显示「按年查看」tab
        val forceMonthMode = viewMode == "calendar"
        // 最早一笔交易年份（state.months 倒序，末位即最早），用于按年视图首页起点
        val minYear = state.months.lastOrNull()?.take(4)?.toIntOrNull()
            ?: Calendar.getInstance().get(Calendar.YEAR)
        PeriodPickerDialog(
            initialMonth = state.month,
            initialMode = if (forceMonthMode) "month" else state.periodMode,
            allowYear = !forceMonthMode,
            minYear = minYear,
            onDismiss = { showMonthPicker = false },
            onConfirm = { period, mode ->
                showMonthPicker = false
                if (!forceMonthMode) vm.setPeriodMode(mode)
                vm.selectMonth(period)
            }
        )
    }

    BookSwitcherSheet(
        show = showBookSheet,
        onDismiss = { showBookSheet = false },
        onSelect = { id ->
            scope.launch { AppContainer.switchBook(id) }
            showBookSheet = false
        },
        onCreate = { name ->
            scope.launch { AppContainer.createBook(name) }
            showBookSheet = false
        }
    )

    Scaffold(topBar = { BookHeader(onSwapBook = { showBookSheet = true }, onSearch = { navController.navigate(Screen.Search.route) }) }, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // 顶部：流水/日历 切换 + 月份左右切换
            TxTypeMonthBar(
                viewMode = viewMode,
                onViewChange = { vm.setViewMode(it); if (it == "calendar") calendarSelectedDay = todayDate() },
                month = state.month,
                periodMode = state.periodMode,
                onPrevMonth = {
                    if (state.periodMode == "year") {
                        val y = state.month.take(4).toIntOrNull() ?: return@TxTypeMonthBar
                        vm.selectMonth("${y - 1}")
                    } else {
                        vm.selectMonth(shiftMonth(state.month, -1))
                    }
                },
                onNextMonth = {
                    if (state.periodMode == "year") {
                        val y = state.month.take(4).toIntOrNull() ?: return@TxTypeMonthBar
                        vm.selectMonth("${y + 1}")
                    } else {
                        vm.selectMonth(shiftMonth(state.month, 1))
                    }
                },
                onOpenPicker = { showMonthPicker = true }
            )

            when {
                state.loading && state.items.isEmpty() -> LoadingBox()
                state.error != null && state.items.isEmpty() -> ErrorState(state.error!!) { vm.refresh() }
                else -> {
                    val grouped = state.items.groupBy { it.date.take(10) }.toList().sortedByDescending { it.first }
                    PullRefreshBox(
                        refreshing = state.loading,
                        onRefresh = { vm.refresh() },
                        modifier = Modifier.fillMaxSize()
                    ) {
                        if (viewMode == "calendar") {
                            CalendarView(
                                month = state.month,
                                items = state.items,
                                selectedDay = calendarSelectedDay,
                                onSelectDay = { calendarSelectedDay = it }
                            )
                        } else {
                            LazyColumn(Modifier.fillMaxSize()) {
                                item {
                                    Spacer(Modifier.height(8.dp))
                                    SummaryCard(
                                        income = state.summary?.income ?: 0.0,
                                        expense = state.summary?.expense ?: 0.0,
                                        balance = state.summary?.balance ?: 0.0,
                                        txCount = state.items.size,
                                        periodMode = state.periodMode
                                    )
                                    Spacer(Modifier.height(8.dp))
                                }
                                if (grouped.isEmpty()) {
                                    val emptyMsg = if (state.accountFilter != null || state.typeFilter != null)
                                        "未找到匹配的交易" else "${state.month} 暂无流水记录"
                                    item { EmptyState(emptyMsg) }
                                } else {
                                    // 整月流水合并为一张卡：日期头 + 当天交易 + 分隔线
                                    item(key = "transactions-card") {
                                        TransactionsCard(grouped) { item -> acting = item }
                                    }
                                }
                                item { Spacer(Modifier.height(80.dp)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TxTypeMonthBar(
    viewMode: String,
    onViewChange: (String) -> Unit,
    month: String,
    periodMode: String = "month",
    onPrevMonth: () -> Unit,
    onNextMonth: () -> Unit,
    onOpenPicker: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // 左：流水 / 日历 切换（与统计页支出/收入/结余完全一致：外圆角10dp/内9dp/padding3dp/激活padding3dp）
        Row(
            Modifier
                .weight(1f)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFFF0EDEE))
                .padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            listOf("list" to "流水", "calendar" to "日历").forEach { (key, label) ->
                val on = viewMode == key
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(9.dp))
                        .background(if (on) Brown500 else Color.Transparent)
                        .clickable { onViewChange(key) }
                        .padding(vertical = 3.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        label,
                        color = if (on) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        softWrap = false
                    )
                }
            }
        }
        // 右：月份选择器（‹ 月份 ›），点击月份打开选择弹窗
        Box(
            Modifier.size(32.dp).clickable { onPrevMonth() },
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Filled.ChevronLeft, "上个月", modifier = Modifier.size(20.dp), tint = Brown500)
        }
        Text(
            prettyMonth(month, periodMode),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            modifier = Modifier.clickable { onOpenPicker() }
        )
        Box(
            Modifier.size(32.dp).clickable { onNextMonth() },
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Filled.ChevronRight, "下个月", modifier = Modifier.size(20.dp), tint = Brown500)
        }
    }
}

@Composable
private fun SummaryCard(income: Double, expense: Double, balance: Double, txCount: Int, periodMode: String = "month") {
    val prefix = if (periodMode == "year") "本年" else "本月"
    val gradient = androidx.compose.ui.graphics.Brush.horizontalGradient(
        colors = listOf(Brown500, Brown300)
    )
    androidx.compose.material3.Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(20.dp),
        color = Color.Transparent
    ) {
        Box(Modifier.fillMaxWidth().background(gradient).padding(horizontal = 18.dp, vertical = 18.dp)) {
            Column {
                Text("结余", style = MaterialTheme.typography.titleMedium, color = Color.White)
                Spacer(Modifier.height(4.dp))
                Text(
                    // formatMoney 自带 ¥ 前缀，原先又拼了一个，真机上显示成「¥ ¥21,201.34」
                    formatMoney(balance),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    KpiCell("${prefix}支出", expense)
                    KpiCell("${prefix}收入", income)
                    KpiCell("${prefix}预算", 0.0)
                    KpiCell("${prefix}剩余", 0.0)
                }
            }
        }
    }
}

@Composable
private fun KpiCell(label: String, value: Double) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.85f),
            softWrap = false
        )
        Spacer(Modifier.height(2.dp))
        Text(
            formatMoney(value),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = Color.White,
            softWrap = false,
            maxLines = 1
        )
    }
}

@Composable
private fun DayHeader(day: String, list: List<TransactionItem>) {
    val income = list.filter { it.type == "income" }.sumOf { it.amount }
    val expense = list.filter { it.type == "expense" }.sumOf { it.amount }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 日期与汇总行共用 formatDayLabel/formatMoneyShort：
        // 同一页出现 '2026-08-28' 和 '8月28日' 两种写法，用户会以为是两种东西
        Text(formatDayLabel(day), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false)
        Spacer(Modifier.weight(1f))
        val parts = buildList {
            if (income > 0) add("收 ${formatMoneyShort(income)}")
            if (expense > 0) add("支 ${formatMoneyShort(expense)}")
        }
        if (parts.isNotEmpty()) {
            Text(parts.joinToString("  "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

/** 整月流水一张大卡：日期头 + 当天交易（行间细分隔线），日期分组之间粗分隔线 */
@Composable
private fun TransactionsCard(
    grouped: List<Pair<String, List<TransactionItem>>>,
    onItemClick: (TransactionItem) -> Unit
) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(vertical = 2.dp)) {
            grouped.forEachIndexed { gi, (day, list) ->
                DayHeader(day, list)
                list.forEachIndexed { idx, item ->
                    TransactionRowClickable(item) { onItemClick(item) }
                    if (idx != list.lastIndex) {
                        HorizontalDivider(color = Color(0xFFF0EDEE), modifier = Modifier.padding(horizontal = 14.dp))
                    }
                }
                if (gi != grouped.lastIndex) {
                    HorizontalDivider(color = Color(0xFFF0EDEE), modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
        }
    }
}

/**
 * 流水列表 / 日历日详情共用的单行。两处调用（本文件 540、849 行），改这里两处同步生效。
 *
 * 转账渲染必须与首页 `HomeScreen.TodayBillRow` 完全一致，三条规则：
 *   ① 图标固定 🔄 —— 不用 category.icon（转账分类图标是 🏦，跟储蓄卡支出撞脸）
 *   ② 副标题「A → B · 备注」 —— 旧代码只拼 account.name，显示成「工资卡 · 房租押金」，
 *      看不出这是笔转账、更看不出钱去了哪（用户截图问题）
 *   ③ 金额**不带正负号、用中性色** —— 转账是内部搬钱，既不是收入也不是支出。
 *      旧代码把 transfer_out 当支出加了「-」和绿色，与支出混在一起无法区分。
 *
 * ⚠️ 主标题仍取 `category.name`（转账在库里有真实分类如「一般转账」），
 *    **不要写死「转账」** —— 首页与鸿蒙 `TransactionRow` 都是这么做的，
 *    写死会把分类信息挤掉，且与左侧 🔄 图标重复表意。
 */
@Composable
private fun TransactionRowClickable(item: TransactionItem, onClick: () -> Unit) {
    val dark = LocalIsDark.current
    // transfer 非 null 是折叠转账；type 前缀兜底老后端不返回 transfer 的情况
    val isTransfer = item.transfer != null || item.type.startsWith("transfer")
    val isIncome = !isTransfer && item.type == "income"
    val isExpense = !isTransfer && item.type == "expense"
    val color = when {
        isTransfer -> MaterialTheme.colorScheme.onSurface
        isIncome -> if (dark) IncomeColorDark else IncomeColor
        isExpense -> if (dark) ExpenseColorDark else ExpenseColor
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    if (isTransfer) "🔄" else (item.category?.icon ?: "📌"),
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.category?.name ?: "交易", style = MaterialTheme.typography.bodyLarge)
            val sub = if (isTransfer) {
                // 流向放前面、备注放后面：备注长度不可控，保证「A → B」始终完整可见
                val flow = if (item.transfer != null) {
                    "${item.transfer.from?.name ?: "?"} → ${item.transfer.to?.name ?: "?"}"
                } else {
                    // 兜底：type 是 transfer_* 但服务端没折叠出 transfer，按方向拼
                    val out = item.type != "transfer_in"
                    val from = if (out) (item.source?.name ?: item.account?.name)
                               else (item.counterparty?.name ?: item.source?.name)
                    val to = if (out) (item.counterparty?.name ?: item.destination?.name)
                             else (item.destination?.name ?: item.account?.name)
                    "${from ?: "?"} → ${to ?: "?"}"
                }
                if (item.note.isNullOrBlank()) flow else "$flow · ${item.note}"
            } else {
                listOfNotNull(
                    item.account?.name,
                    item.note?.takeIf { it.isNotBlank() }
                ).joinToString(" · ").ifBlank { item.date.take(10) }
            }
            Text(sub, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        Text(
            // 转账取绝对值：折叠后的那条腿可能是 transfer_out 的负数金额
            if (isTransfer) formatMoney(kotlin.math.abs(item.amount))
            else (if (isIncome) "+" else if (isExpense) "-" else "") + formatMoney(item.amount),
            style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = color
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PeriodPickerDialog(
    initialMonth: String,       // "YYYY-MM" 或 "YYYY"
    initialMode: String,        // "month" 或 "year"
    allowYear: Boolean = true,  // 日历视图强制为 false（只有月份选择）
    minYear: Int = Calendar.getInstance().get(Calendar.YEAR), // 最早一笔交易的年份（按年视图首页起点）
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit   // (period, mode) → period="YYYY-MM"或"YYYY", mode="month"/"year"
) {
    val currentYear = Calendar.getInstance().get(Calendar.YEAR)
    val currentMonthInt = Calendar.getInstance().get(Calendar.MONTH) + 1 // 1-based

    val initYear = initialMonth.take(4).toIntOrNull() ?: currentYear
    val initMonth = if (initialMonth.length >= 7) initialMonth.substring(5, 7).trimStart('0').toIntOrNull() ?: currentMonthInt else currentMonthInt

    var mode by remember { mutableStateOf(if (allowYear) initialMode else "month") }
    var selYear by remember { mutableStateOf(initYear) }
    var selMonth by remember { mutableStateOf(initMonth) }
    // 按年视图：12 年一页，首页起点从最早交易年份开始
    var selYearBase by remember {
        mutableStateOf(((initYear - minYear).coerceAtLeast(0) / 12) * 12 + minYear)
    }

    val months = remember { (1..12).toList() }
    val monthYears = remember { (currentYear - 8)..(currentYear + 3) }
    val pageYears = remember(selYearBase) { (selYearBase..selYearBase + 11).toList() }

    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null
    ) {
        Column(Modifier.padding(horizontal = 24.dp)) {
            // 顶部 tab：按月查看 / 按年查看（无背景，选中显示暖棕下划线）
            if (allowYear) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    listOf("month" to "按月查看", "year" to "按年查看").forEach { (key, label) ->
                        val on = mode == key
                        Column(
                            Modifier.clickable { mode = key }.padding(horizontal = 18.dp, vertical = 12.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                label,
                                color = if (on) Brown500 else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp
                            )
                            if (on) {
                                Spacer(Modifier.height(6.dp))
                                Box(Modifier.width(28.dp).height(2.dp).background(Brown500))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            if (mode == "month") {
                // 第二行：年份选择（沿用现状样式）
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = { selYear -= 1 }, enabled = selYear > monthYears.first()) {
                        Icon(Icons.Filled.ChevronLeft, "上一年", tint = Brown500)
                        Spacer(Modifier.width(4.dp))
                        Text("${selYear - 1}", color = Brown500, fontSize = 13.sp)
                    }
                    Text("$selYear", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    TextButton(onClick = { selYear += 1 }, enabled = selYear < monthYears.last()) {
                        Text("${selYear + 1}", color = Brown500, fontSize = 13.sp)
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Filled.ChevronRight, "下一年", tint = Brown500)
                    }
                }
                Spacer(Modifier.height(16.dp))
                // 12 个月份网格：点击月份即确认
                val cols = 4
                months.chunked(cols).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { m ->
                            val isSelected = m == selMonth && selYear == initYear
                            val isCurrent = m == currentMonthInt && currentYear == selYear
                            Box(
                                Modifier
                                    .weight(1f)
                                    .aspectRatio(2.2f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        when {
                                            isSelected -> Brown500
                                            isCurrent -> Color(0xFFE8F5E9)
                                            else -> Color(0xFFF5F5F5)
                                        }
                                    )
                                    .clickable { onConfirm(String.format("%04d-%02d", selYear, m), "month") },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    "${m}月",
                                    color = when {
                                        isSelected -> Color.White
                                        isCurrent -> Brown500
                                        else -> MaterialTheme.colorScheme.onSurface
                                    },
                                    fontWeight = if (isSelected || isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                    fontSize = 14.sp
                                )
                            }
                        }
                        // 补齐空位（不足4个时）
                        repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(10.dp))
                }
            } else {
                // 第二行：年份翻页（12 年一页）
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = { selYearBase = (selYearBase - 12).coerceAtLeast(minYear) }, enabled = selYearBase > minYear) {
                        Icon(Icons.Filled.ChevronLeft, "上一页", tint = Brown500)
                        Spacer(Modifier.width(4.dp))
                        Text("${selYearBase - 1}", color = Brown500, fontSize = 13.sp)
                    }
                    Text("${selYearBase}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    TextButton(onClick = { selYearBase += 12 }) {
                        Text("${selYearBase + 12}", color = Brown500, fontSize = 13.sp)
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Filled.ChevronRight, "下一页", tint = Brown500)
                    }
                }
                Spacer(Modifier.height(16.dp))
                // 年份网格：12 个年份，点击即确认
                val yCols = 4
                pageYears.chunked(yCols).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { y ->
                            val isSelected = y == selYear
                            val isCurrent = y == currentYear
                            Box(
                                Modifier
                                    .weight(1f)
                                    .aspectRatio(2.0f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        when {
                                            isSelected -> Brown500
                                            isCurrent -> Color(0xFFE8F5E9)
                                            else -> Color(0xFFF5F5F5)
                                        }
                                    )
                                    .clickable { onConfirm("$y", "year") },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    "$y",
                                    color = when {
                                        isSelected -> Color.White
                                        isCurrent -> Brown500
                                        else -> MaterialTheme.colorScheme.onSurface
                                    },
                                    fontWeight = if (isSelected || isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                    fontSize = 15.sp
                                )
                            }
                        }
                        repeat(yCols - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

private fun prettyMonth(m: String, mode: String = "month"): String {
    return if (mode == "year") "${m.take(4)}年" else {
        val parts = m.split("-")
        if (parts.size == 2) "${parts[0]}年${parts[1].trimStart('0')}月" else m
    }
}

/* ============================================================
 * 视图模式切换 + 日历视图（参考暖棕记账 app 改版）
 * ============================================================ */

@Composable
private fun CalendarView(
    month: String,
    items: List<com.xinwallet.app.data.model.TransactionItem>,
    selectedDay: String?,
    onSelectDay: (String) -> Unit
) {
    val byDate = remember(items) {
        items.groupBy { it.date.take(10) }.mapValues { (_, list) ->
            val income = list.filter { it.type == "income" }.sumOf { it.amount }
            val expense = list.filter { it.type == "expense" }.sumOf { it.amount }
            income to expense
        }
    }
    val monthYm = remember(month) { parseMonth(month) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        item {
            Spacer(Modifier.height(8.dp))
            MonthCalendarGrid(
                year = monthYm.first,
                month = monthYm.second,
                totalsByDate = byDate,
                selectedDay = selectedDay,
                onSelectDay = onSelectDay
            )
            Spacer(Modifier.height(12.dp))
        }
        if (selectedDay != null) {
            val dayItems = items.filter { it.date.take(10) == selectedDay }.sortedByDescending { it.date }
            if (dayItems.isEmpty()) {
                item { Text("${selectedDay} 暂无记录", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
            } else {
                val income = dayItems.filter { it.type == "income" }.sumOf { it.amount }
                val expense = dayItems.filter { it.type == "expense" }.sumOf { it.amount }
                val balance = income - expense
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // ⚠️ 日期不能挂 weight(1f)：weight 的语义是「你吃剩余空间」，
                        // 剩余为负时就变成「你被压到装不下也得认」。右侧三项按内容取宽一个都不让，
                        // 于是这行里唯一被牺牲的就是日期 —— 而日期恰恰一个字符都不能少
                        // （'2026-08-28' 断成 '2026-08-2 / 8'）。改用 Spacer 顶开，
                        // 空间由中间空白吸收，没有元素被迫压缩。
                        Text(
                            formatDayLabel(selectedDay),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            softWrap = false
                        )
                        Spacer(Modifier.weight(1f))
                        // 三项金额统一 formatMoneyShort：混用会让 '收 ¥1.90万' 和
                        // '结余 +¥17,226.00' 看起来像两类不同数据
                        Text("收 ${formatMoneyShort(income)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, maxLines = 1)
                        Spacer(Modifier.width(10.dp))
                        Text("支 ${formatMoneyShort(expense)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 1)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "结余 ${if (balance >= 0) "+" else ""}${formatMoneyShort(balance)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (balance >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                            maxLines = 1
                        )
                    }
                }
                items(dayItems, key = { "cal-${it.id}" }) { tx ->
                    TransactionRowClickable(tx) { /* 由父级 acting 状态处理（这里只展示） */ }
                }
            }
        }
        item { Spacer(Modifier.height(120.dp)) }
    }
}

/** 6×7 月历格子：含上下月残日（淡化）、当日高亮、当日金额提示（与首页日历完全一致） */
@Composable
private fun MonthCalendarGrid(
    year: Int,
    month: Int,
    totalsByDate: Map<String, Pair<Double, Double>>,
    selectedDay: String?,
    onSelectDay: (String) -> Unit
) {
    // 周一开始（与首页日历一致）
    val cal = java.util.Calendar.getInstance().apply {
        clear(); set(year, month - 1, 1); setFirstDayOfWeek(java.util.Calendar.MONDAY); firstDayOfWeek = java.util.Calendar.MONDAY
    }
    val firstWeekday = cal.get(java.util.Calendar.DAY_OF_WEEK)
    val colOffset = ((firstWeekday - java.util.Calendar.MONDAY) + 7) % 7
    val daysInMonth = cal.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)

    // 上下月信息
    val prevCal = (cal.clone() as java.util.Calendar).apply { add(java.util.Calendar.MONTH, -1) }
    val prevDaysInMonth = prevCal.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)
    val nextCal = (cal.clone() as java.util.Calendar).apply { add(java.util.Calendar.MONTH, 1) }

    val totalCells = 42
    val cells = (0 until totalCells).map { idx -> idx - colOffset + 1 }.map { dayNum ->
        when {
            dayNum < 1 -> {
                CellInfo(day = prevDaysInMonth + dayNum, inMonth = false, date = "", month = -1)
            }
            dayNum > daysInMonth -> {
                CellInfo(day = dayNum - daysInMonth, inMonth = false, date = "", month = 1)
            }
            else -> {
                val date = String.format(java.util.Locale.CHINA, "%04d-%02d-%02d", year, month, dayNum)
                CellInfo(day = dayNum, inMonth = true, date = date, month = 0)
            }
        }
    }
    val weeks = cells.chunked(7)
    val today = remember {
        val t = java.util.Calendar.getInstance()
        String.format(java.util.Locale.CHINA, "%04d-%02d-%02d", t.get(java.util.Calendar.YEAR), t.get(java.util.Calendar.MONTH) + 1, t.get(java.util.Calendar.DAY_OF_MONTH))
    }
    // 月份名（用于上下月残日显示）
    val monthNames = arrayOf("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二")
    val prevMonthLabel = "${monthNames[prevCal.get(java.util.Calendar.MONTH)]}月"
    val nextMonthLabel = "${monthNames[nextCal.get(java.util.Calendar.MONTH)]}月"

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            // 星期表头（周一开始，与首页一致）
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                listOf("一", "二", "三", "四", "五", "六", "日").forEach { w ->
                    Text(
                        w,
                        modifier = Modifier.weight(1f),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            weeks.forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    row.forEachIndexed { idx, cell ->
                        val totals = if (cell.date.isNotEmpty()) totalsByDate[cell.date] else null
                        val isSelected = cell.inMonth && cell.date == selectedDay
                        val isToday = cell.inMonth && cell.date == today
                        val dayData = if (cell.inMonth && totals != null) {
                            com.xinwallet.app.data.model.CalendarDay(
                                date = cell.date,
                                income = totals.first,
                                expense = totals.second,
                                hasRecord = true
                            )
                        } else null
                        val kind = when (cell.month) {
                            -1 -> CellKind.PREV
                            1 -> CellKind.NEXT
                            else -> CellKind.CURRENT
                        }
                        val cellData = CalendarCellData(
                            kind = kind,
                            date = cell.date.ifEmpty { null },
                            day = if (cell.inMonth) cell.day else null,
                            // 与首页一致：仅每个残月区域的第一格显示月名，其余留空
                            dayLabel = when {
                                cell.month == -1 && cell.day == prevDaysInMonth - colOffset + 1 -> prevMonthLabel
                                cell.month == 1 && cell.day == 1 -> nextMonthLabel
                                else -> null
                            }
                        )
                        Box(modifier = Modifier.weight(1f)) {
                            SharedCalendarCell(
                                cell = cellData,
                                isSelected = isSelected,
                                isToday = isToday,
                                dayData = dayData,
                                onClick = { if (cell.inMonth) onSelectDay(cell.date) }
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun cellMoney(v: Double): String {
    // 两位小数、无千分符、无前导 0（如 100 → 100.00，1 → 1.00，10000 → 10000.00）
    return String.format(Locale.US, "%.2f", v)
}

private fun cellFontSize(s: String): androidx.compose.ui.unit.TextUnit {
    // 长度自适应：越长字号越小，避免超出日期格
    return when (s.length) {
        in 0..6 -> 9.sp
        in 7..8 -> 8.sp
        else -> 7.sp
    }
}

private data class CellInfo(val day: Int, val inMonth: Boolean, val date: String, val month: Int)

// 本地 CalendarCell 已删除——账单页日历改为使用 SharedCalendarCell（components/CalendarCell.kt）

private fun parseMonth(m: String): Pair<Int, Int> {
    val parts = m.split("-")
    return if (parts.size == 2) parts[0].toInt() to parts[1].toInt() else 2026 to 1
}

