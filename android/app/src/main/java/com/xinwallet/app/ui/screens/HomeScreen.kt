package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.BookHeader
import com.xinwallet.app.ui.components.BookSwitcherSheet
import com.xinwallet.app.ui.components.CalendarCellData
import com.xinwallet.app.ui.components.CellKind
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.SharedCalendarCell
import com.xinwallet.app.ui.components.formatCompact
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown200
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.viewmodel.HomeViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix
import com.xinwallet.app.util.formatMoneyShort
import com.xinwallet.app.util.todayDate
import androidx.compose.ui.text.style.TextAlign
import java.util.Calendar

/** 首页可勾选的卡片定义（顺序即展示顺序） */
private data class HomeCard(val id: String, val title: String, val desc: String)
private val ALL_HOME_CARDS = listOf(
    HomeCard("month_summary", "本月支出", "当月收入 / 支出 / 日均支出概览"),
    HomeCard("today_bills", "今日账单", "今天发生的收支明细"),
    HomeCard("calendar", "账单日历", "按日查看收支配比")
)

/** 把持久化的逗号分隔串解析为启用的卡片 id 集合；空串表示全部启用 */
private fun parseEnabled(csv: String): Set<String> {
    if (csv.isBlank()) return ALL_HOME_CARDS.map { it.id }.toSet()
    return csv.split(",").map { it.trim() }.filter { it.isNotBlank() }.toSet()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(navController: NavHostController) {
    val vm: HomeViewModel = viewModel(factory = viewModelFactory {
        HomeViewModel(AppContainer.api, AppContainer.transactionRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showBookSheet by remember { mutableStateOf(false) }
    var showManage by remember { mutableStateOf(false) }

    val now = remember { Calendar.getInstance() }
    var calYear by remember { mutableStateOf(now.get(Calendar.YEAR)) }
    var calMonth by remember { mutableStateOf(now.get(Calendar.MONTH) + 1) }
    val curBookId = AppContainer.currentBookId.collectAsState().value

    // 用户勾选的卡片可见性（持久化）
    val cardsCsv by AppContainer.sessionManager.homeCardsFlow().collectAsState(initial = "")
    val enabled = remember(cardsCsv) { parseEnabled(cardsCsv) }

    // 切账本时按需加载（日历不再收起，始终预载）
    LaunchedEffect(curBookId) {
        vm.loadDashboard()
        vm.loadTodayBills()
        vm.loadCalendar(calYear, calMonth)
    }
    LaunchedEffect(calYear, calMonth) {
        vm.loadCalendar(calYear, calMonth)
    }
    // 回到前台（从后台返回）：重新拉取首页数据，避免停留在过期数据 / 因 token 过期无法刷新
    LaunchedEffect(Unit) {
        AppContainer.onForeground.collect {
            vm.loadDashboard()
            vm.loadTodayBills()
            vm.loadCalendar(calYear, calMonth)
        }
    }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it) } }

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

    // 「编辑首页卡片」底部弹窗
    if (showManage) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        var selection by remember { mutableStateOf(enabled) }
        ModalBottomSheet(
            onDismissRequest = {
                showManage = false
                scope.launch { AppContainer.sessionManager.saveHomeCards(selection.joinToString(",")) }
            },
            sheetState = sheetState
        ) {
            Text(
                "编辑首页卡片",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
            )
            Text(
                "勾选希望在首页展示的卡片",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp)
            )
            Spacer(Modifier.height(8.dp))
            Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
                ALL_HOME_CARDS.forEach { card ->
                    val on = selection.contains(card.id)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { selection = if (on) selection - card.id else selection + card.id }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(card.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Text(card.desc, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(checked = on, onCheckedChange = {
                            selection = if (it) selection + card.id else selection - card.id
                        })
                    }
                    HorizontalDivider(color = Color(0xFFF0EDEE))
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }

    Scaffold(
        topBar = { BookHeader(onSwapBook = { showBookSheet = true }, onSearch = { navController.navigate(Screen.Search.route) }) },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        when {
            state.loading && state.dashboard == null -> LoadingBox()
            state.error != null && state.dashboard == null ->
                ErrorBlock(state.error!!, onRetry = { vm.loadDashboard(); vm.loadTodayBills(); vm.loadCalendar(calYear, calMonth) })
            else -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
            ) {
                Spacer(Modifier.height(8.dp))
                if (enabled.contains("month_summary")) {
                    MonthSummaryCard(
                        monthIncome = state.dashboard?.month?.income ?: 0.0,
                        monthExpense = state.dashboard?.month?.expense ?: 0.0,
                        // 多币种 P2-2e：本月收/支按 breakdown 智能格式化
                        monthExpenseBreakdown = state.dashboard?.month?.expenseBreakdown,
                        monthIncomeBreakdown = state.dashboard?.month?.incomeBreakdown,
                        monthCurrency = state.dashboard?.month?.currency ?: "CNY",
                        monthYear = calYear,
                        monthNumber = calMonth,
                        onOpenMonthDetail = {
                            // 跳转到账单页（流水视图，指定当前月）。
                            // 关键：popUpTo(home) 把 home 保留为栈底而非被覆盖，
                            // 这样点底部「首页」tab 时 navigateRoot 才能回到 home 栈项。
                            val monthStr = "%04d-%02d".format(calYear, calMonth)
                            val target = Screen.Transactions.create(month = monthStr, view = "list")
                            val homeId = navController.graph.findStartDestination().id
                            navController.navigate(target) {
                                popUpTo(homeId) { inclusive = false; saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        }
                    )
                }
                if (enabled.contains("today_bills")) {
                    TodayBillsCard(
                        bills = state.todayBills,
                        // 多币种 P2-2e：今日收/支沿用 dashboard.month.currency 作 display 货币
                        // （多币种账本下 HomeViewModel 的 sumOf{it.amount} 仍是单值近似，
                        //  严格多币种拆分待 list SQL 加 account currency 后再实现）
                        todayIncome = state.todayIncome,
                        todayExpense = state.todayExpense,
                        todayCurrency = state.dashboard?.month?.currency ?: "CNY"
                    )
                }
                if (enabled.contains("calendar") && state.calendar != null) {
                    CalendarCard(
                        year = calYear,
                        month = calMonth,
                        days = state.calendar?.monthDays.orEmpty(),
                        monthIncome = state.calendar?.monthSummary?.income ?: 0.0,
                        monthExpense = state.calendar?.monthSummary?.expense ?: 0.0,
                        // 多币种 P2-2e：本月汇总沿用 dashboard.month.currency；breakdown 后续 CalendarSummary 扩字段再加
                        monthCurrency = state.dashboard?.month?.currency ?: "CNY",
                        onPrev = { shiftMonth(calYear, calMonth, -1) { y, m -> calYear = y; calMonth = m } },
                        onNext = { shiftMonth(calYear, calMonth, 1) { y, m -> calYear = y; calMonth = m } }
                    )
                }

                // 编辑首页卡片入口
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.Center
                ) {
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(20.dp))
                            .background(Brown100)
                            .clickable { showManage = true }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Filled.Tune, contentDescription = null, tint = Brown500, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("编辑首页卡片", color = Brown500, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
                    }
                }
                Spacer(Modifier.height(72.dp)) // 底部导航留白
            }
        }
    }
}

/**
 * 本月支出大卡（暖棕渐变 + 半透明白圆装饰），与全局暖棕主题统一。
 *  金额根据长度自适应字号（4位以下 displaySmall，5-6位 headlineLarge，7位及以上 titleLarge），
 *  保证单行显示不溢出。日期范围按钮可点击跳转到账单页流水的当月明细。
 */
@Composable
private fun MonthSummaryCard(
    monthIncome: Double,
    /** 多币种 P2-2e：本月支出主货币值（dailyAvg 计算用，展示走 breakdown） */
    monthExpense: Double,
    /** 多币种 P2-2e：本月收入按账户币种分布（monthIncome 是主货币值） */
    monthIncomeBreakdown: Map<String, Double>?,
    /** 多币种 P2-2e：本月支出按账户币种分布（monthExpense 是主货币值） */
    monthExpenseBreakdown: Map<String, Double>?,
    /** 多币种 P2-2e：本月主货币（来自 dashboard.month.currency） */
    monthCurrency: String,
    monthYear: Int,
    monthNumber: Int,
    onOpenMonthDetail: () -> Unit
) {
    val cal = remember(monthYear, monthNumber) { Calendar.getInstance().apply { set(monthYear, monthNumber - 1, 1) } }
    val daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
    // 计算本月已过天数（仅当前月）/ 否则取整月天数
    val today = Calendar.getInstance()
    val dayOfMonth = if (today.get(Calendar.YEAR) == monthYear && today.get(Calendar.MONTH) + 1 == monthNumber) {
        today.get(Calendar.DAY_OF_MONTH).coerceAtLeast(1)
    } else {
        daysInMonth
    }
    val dailyAvg = if (dayOfMonth > 0) monthExpense / dayOfMonth else 0.0
    val range = remember(monthYear, monthNumber, daysInMonth) {
        "${monthNumber}月1日-${monthNumber}月${daysInMonth}日"
    }

    // 金额自适应字号：字符串越长字号越小，保证单行不溢出
    // 多币种 P2-2e：本月支出按 breakdown 智能格式化（多币种账本自动附注其他货币）
    val amountStr = formatMoneyMix(monthExpenseBreakdown)
    val amountStyle = when {
        amountStr.length <= 7 -> MaterialTheme.typography.displaySmall     // < 1万
        amountStr.length <= 9 -> MaterialTheme.typography.headlineLarge     // 1-99万
        else -> MaterialTheme.typography.titleLarge                          // ≥100万
    }

    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .shadow(elevation = 2.dp, shape = RoundedCornerShape(20.dp), clip = false)
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.linearGradient(
                    colors = listOf(Brown500, Brown300.copy(alpha = 0.95f), Brown200.copy(alpha = 0.9f))
                )
            )
            .height(132.dp)
    ) {
        // 右上 + 右中 两个半透明白圆装饰（缩小并加大偏移，避免遮挡右侧文字）
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 80.dp, y = (-30).dp)
                .size(80.dp)
                .background(Color.White.copy(alpha = 0.12f), CircleShape)
        )
        Box(
            Modifier
                .align(Alignment.CenterEnd)
                .offset(x = 90.dp, y = 30.dp)
                .size(110.dp)
                .background(Color.White.copy(alpha = 0.08f), CircleShape)
        )

        // 文字区域：占满宽，左侧对齐
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 14.dp)
                .align(Alignment.TopStart)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "本月支出",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.9f),
                    maxLines = 1
                )
                // 日期范围右上靠右（白色胶囊）
                Box(
                    Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.9f))
                        .clickable { onOpenMonthDetail() }
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    Text(
                        range,
                        style = MaterialTheme.typography.labelMedium,
                        color = Brown500,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            // 大金额：自适应字号 + 单行 + Ellipsis
            Text(
                amountStr,
                style = amountStyle,
                color = Color.White,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            // 本月收入 + 日均支出 合并一行，小字体自适应
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(
                    "本月收入 ",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp),
                    color = Color.White.copy(alpha = 0.78f),
                    maxLines = 1
                )
                Text(
                    // 多币种 P2-2e：本月收入按 breakdown 智能格式化
                    formatMoneyMix(monthIncomeBreakdown),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "日均支出 ",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp),
                    color = Color.White.copy(alpha = 0.78f),
                    maxLines = 1
                )
                Text(
                    // 多币种 P2-2e：日均支出 = 主货币值 / dayOfMonth，按月主货币格式化
                    formatMoney(dailyAvg, monthCurrency),
                    style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

/** 今日账单卡片：标题 + 收入/支出汇总 + 明细列表 */
@Composable
private fun TodayBillsCard(
    bills: List<TransactionItem>,
    todayIncome: Double,
    todayExpense: Double,
    /** 多币种 P2-2e：今日收/支 display 货币（来自 dashboard.month.currency） */
    todayCurrency: String
) {
    Card(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("今日账单", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
                Spacer(Modifier.weight(1f))
                // 与账单页同源：一行并排多项金额时用 formatMoneyShort。
                // 这行现状不溢出，但余量很小 —— 一个 ¥123,456.00 就会挤，提前换掉成本为零
                Text("收入 ", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                // 多币种 P2-2e：今日按 display 货币格式化（多币种账本下是单值近似，严格拆分待 list SQL 加 currency 后再做）
                Text(formatMoneyShort(todayIncome, todayCurrency), style = MaterialTheme.typography.labelMedium, color = Brown500, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Spacer(Modifier.width(10.dp))
                Text("支出 ", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                Text(formatMoneyShort(todayExpense, todayCurrency), style = MaterialTheme.typography.labelMedium, color = ExpenseColor, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            HorizontalDivider(color = Color(0xFFF0EDEE))
            if (bills.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "今日还没有记账，点点底部 + 记一笔吧～",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                bills.forEach { t ->
                    TodayBillRow(t)
                    HorizontalDivider(color = Color(0xFFF0EDEE), modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
        }
    }
}

/** 单条今日账单：圆形 icon + 分类/备注 + 右侧金额（支出绿/收入棕） */
@Composable
private fun TodayBillRow(t: TransactionItem) {
    /**
     * 与账户详情页的 TransactionRow 保持同一套转账语义：折叠转账在列表里只出
     * 一条，要能自己表达完整的「A → B」。之前这条主页组件没做 transfer 识别，
     * 导致转账在主页显示为「一般转账 🏦 + 备注 + 红色负号」，与鸿蒙端不一致。
     */
    val isTransfer = t.transfer != null || t.type.startsWith("transfer")
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Brown100),
            contentAlignment = Alignment.Center
        ) {
            Text(
                if (isTransfer) "🔄" else (t.category?.icon?.takeIf { it.isNotBlank() } ?: "💰"),
                fontSize = 18.sp
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                t.category?.name?.takeIf { it.isNotBlank() } ?: "未分类",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )
            val sub = if (isTransfer) {
                // 第二行承载「A → B · 备注」，备注长度不可控，放后面保证流向始终完整可见。
                val flow = if (t.transfer != null) {
                    "${t.transfer.from?.name ?: "?"} → ${t.transfer.to?.name ?: "?"}"
                } else {
                    // 兜底：老后端不返回 transfer，但 type 仍是 transfer_*，按方向拼 A → B。
                    val out = t.type != "transfer_in"
                    val from = if (out) (t.source?.name ?: t.account?.name)
                               else (t.counterparty?.name ?: t.source?.name)
                    val to = if (out) (t.counterparty?.name ?: t.destination?.name)
                             else (t.destination?.name ?: t.account?.name)
                    "${from ?: "?"} → ${to ?: "?"}"
                }
                if (t.note.isNullOrBlank()) flow else "$flow · ${t.note}"
            } else {
                t.note.takeIf { !it.isNullOrBlank() } ?: t.account?.name
            }
            if (!sub.isNullOrBlank()) {
                Text(
                    sub,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }
        }
        val signed = when {
            isTransfer -> formatMoney(t.amount)
            t.type == "income" || t.type == "transfer_in" -> formatMoney(t.amount)
            t.type == "expense" || t.type == "transfer_out" -> "-" + formatMoney(t.amount)
            else -> formatMoney(t.amount)
        }
        val color = when {
            isTransfer -> MaterialTheme.colorScheme.onSurface
            t.type == "income" || t.type == "transfer_in" -> Brown500
            t.type == "expense" || t.type == "transfer_out" -> ExpenseColor
            else -> MaterialTheme.colorScheme.onSurface
        }
        Text(signed, style = MaterialTheme.typography.titleMedium, color = color, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * 账单日历卡片：周一起头，6 行 × 7 列；有记录=暖棕淡底；选中=暖棕深底白字；上下月淡灰+月名。
 */
@Composable
private fun CalendarCard(
    year: Int,
    month: Int,
    days: List<com.xinwallet.app.data.model.CalendarDay>,
    monthIncome: Double,
    monthExpense: Double,
    /** 多币种 P2-2e：本月主货币（来自 dashboard.month.currency） */
    monthCurrency: String,
    onPrev: () -> Unit,
    onNext: () -> Unit
) {
    var selectedDate by remember { mutableStateOf(todayDate()) }
    val todayStr = remember { todayDate() }
    val calMap = remember(days) { days.associateBy { it.date } }
    val grid = remember(year, month) { buildCalendarGrid(year, month) }

    Card(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            // 月份导航
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                MonthArrowBtn(icon = Icons.Filled.ChevronLeft, onClick = onPrev)
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Brown100)
                        .padding(horizontal = 18.dp, vertical = 6.dp)
                ) {
                    Text("${year}年${month}月", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Brown500)
                }
                Spacer(Modifier.weight(1f))
                MonthArrowBtn(icon = Icons.Filled.ChevronRight, onClick = onNext)
            }
            // 周次标题
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                listOf("一", "二", "三", "四", "五", "六", "日").forEach { w ->
                    Text(
                        w,
                        modifier = Modifier.weight(1f),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            // 6 行 × 7 列日期格子：纯 Column + Row 排版，
// 避开 LazyVerticalGrid 与外层 verticalScroll 的嵌套冲突 + 让 cell 自适应撑高
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                grid.chunked(7).forEach { week ->
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        week.forEach { cell ->
                            Box(modifier = Modifier.weight(1f)) {
                                SharedCalendarCell(
                                    cell = cell,
                                    isSelected = cell.date == selectedDate,
                                    isToday = cell.date == todayStr,
                                    dayData = calMap[cell.date],
                                    onClick = { if (cell.date != null) selectedDate = cell.date }
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = Color(0xFFF0EDEE))
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("本月收入 ", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                // 多币种 P2-2e：CalendarSummary 目前无 breakdown，按本月主货币格式化（后续扩字段再切 breakdown）
                Text(formatMoney(monthIncome, monthCurrency), style = MaterialTheme.typography.titleMedium, color = Brown500, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(24.dp))
                Text("本月支出 ", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(formatMoney(monthExpense, monthCurrency), style = MaterialTheme.typography.titleMedium, color = ExpenseColor, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

/** 月份导航箭头按钮：暖棕浅底圆形 36dp */
@Composable
private fun MonthArrowBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(Brown100)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = Brown500, modifier = Modifier.size(20.dp))
    }
}

/** 6 行 × 7 列日历数据：填满当月，前后补充上下月日期。 */
private fun buildCalendarGrid(year: Int, month: Int): List<CalendarCellData> {
    val cal = Calendar.getInstance().apply {
        clear(); set(year, month - 1, 1); setFirstDayOfWeek(Calendar.MONDAY); firstDayOfWeek = Calendar.MONDAY
    }
    val firstWeekday = cal.get(Calendar.DAY_OF_WEEK)
    val colOffset = ((firstWeekday - Calendar.MONDAY) + 7) % 7
    val daysInMonth = cal.getActualMaximum(Calendar.DAY_OF_MONTH)

    val prevCal = (cal.clone() as Calendar).apply { add(Calendar.MONTH, -1) }
    val prevYear = prevCal.get(Calendar.YEAR)
    val prevMonthNum = prevCal.get(Calendar.MONTH) + 1
    val prevMonthName = monthChineseShort(prevMonthNum)
    val prevDaysInMonth = prevCal.getActualMaximum(Calendar.DAY_OF_MONTH)

    val nextCal = (cal.clone() as Calendar).apply { add(Calendar.MONTH, 1) }
    val nextYear = nextCal.get(Calendar.YEAR)
    val nextMonthNum = nextCal.get(Calendar.MONTH) + 1
    val nextMonthName = monthChineseShort(nextMonthNum)

    val total = 42
    val cells = ArrayList<CalendarCellData>(total)

    for (i in 0 until colOffset) {
        val dayNum = prevDaysInMonth - colOffset + 1 + i
        cells.add(
            CalendarCellData(
                kind = CellKind.PREV,
                date = "%04d-%02d-%02d".format(prevYear, prevMonthNum, dayNum),
                day = null,
                dayLabel = if (i == 0 && colOffset > 0) prevMonthName else null
            )
        )
    }
    for (d in 1..daysInMonth) {
        cells.add(
            CalendarCellData(
                kind = CellKind.CURRENT,
                date = "%04d-%02d-%02d".format(year, month, d),
                day = d,
                dayLabel = null
            )
        )
    }
    var nextDay = 1
    while (cells.size < total) {
        cells.add(
            CalendarCellData(
                kind = CellKind.NEXT,
                date = "%04d-%02d-%02d".format(nextYear, nextMonthNum, nextDay),
                day = null,
                dayLabel = if (nextDay == 1) nextMonthName else null
            )
        )
        nextDay++
    }
    return cells
}

/** 8→八 / 11→十一 等中文月名短名 */
private fun monthChineseShort(m: Int): String {
    val names = arrayOf("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二")
    return names.getOrNull(m - 1)?.let { "${it}月" } ?: ""
}

/** 月份加减，溢出自动进位 */
private fun shiftMonth(y: Int, m: Int, delta: Int, set: (Int, Int) -> Unit) {
    var ny = y; var nm = m + delta
    if (nm < 1) { nm += 12; ny -= 1 }
    if (nm > 12) { nm -= 12; ny += 1 }
    set(ny, nm)
}

@Composable
private fun ErrorBlock(message: String, onRetry: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(8.dp))
        androidx.compose.material3.OutlinedButton(onClick = onRetry) { Text("重试") }
    }
}
