package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar
import java.util.Locale
import androidx.lifecycle.viewmodel.compose.viewModel
import com.xinwallet.app.data.model.DailyTrendPoint
import com.xinwallet.app.data.model.ReportCategorySlice
import com.xinwallet.app.data.model.TopTransaction
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.BookHeader
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.components.BookSwitcherSheet
import com.xinwallet.app.ui.components.CategoryBars
import com.xinwallet.app.ui.components.DonutChart
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.ErrorState
import com.xinwallet.app.ui.components.LinearProgress
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.viewmodel.ReportsViewModel
import com.xinwallet.app.ui.viewmodel.shiftMonth
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix
import com.xinwallet.app.util.formatMoneyShort
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import java.util.regex.Pattern

private val DATA_TYPE_OPTIONS = listOf("expense" to "支出", "income" to "收入", "balance" to "结余")
// 「小类/大类」切换已移除：环图固定只画一级分类，二级明细由下方列表随选中项联动展示。
// 原本两个 chip 表达的是「整张图换一套数据」，用户要在两种视图间来回切才能看全；
// 现在是「上面选大类、下面看它的小类」，一屏就能读完层级关系。

/** "2026-08" → "2026年8月" */
private fun monthLabel(period: String): String {
    val m = Pattern.compile("(\\d{4})-(\\d{2})").matcher(period)
    if (!m.find()) return period
    return "${m.group(1)}年${m.group(2)?.toIntOrNull() ?: 0}月"
}

/** 顶部时间选择器显示文案：月=年月，年=年份，自定义=年月-年月 */
private fun periodDisplay(period: String, periodMode: String): String {
    return when (periodMode) {
        "year" -> "${period.take(4)}年"
        "custom" -> {
            val p = period.split("~")
            val s = p.getOrNull(0)?.take(7) ?: period
            val e = p.getOrNull(1)?.take(7) ?: period
            "$s - $e"
        }
        else -> monthLabel(period)
    }
}

/** "2026-08-12" → "2026-08-12"（趋势头部用 ISO 日期，跟截图一致） */
private fun isoDay(iso: String): String = iso.take(10)

/**
 * 趋势/表格的时间桶。**这是按年视图能看的关键。**
 *
 * 服务端 dailyTrend 恒按天补齐（reports.js:355 那个 while 循环逐日 push），
 * 所以按年请求回来的是 365 条、自定义 3 个月回来的是 ~90 条。
 * 原代码直接 1:1 映射成折线点，后果是：
 *
 *   绘图区宽约 234dp ÷ 364 段 = 相邻点间距 0.64dp
 *   而数据点直径约 4dp → 每个点盖住前后各 3 个邻居
 *   → 整条折线糊成一团墨迹，X 轴的月份被抽样成不规则日期序列
 *   → 「每日概况」表格同时变成 365 行
 *
 * 「按年」的语义单位本来就是月，不是日。所以按桶聚合：
 *   跨度 > 62 天 → 月桶（按年固定 12 个，自定义 3 个月得 3 个）
 *   否则         → 日桶（按月 28~31 个，与原行为一致）
 *
 * 阈值取 62 而不是判断 periodMode：自定义区间选了半年同样需要按月聚合，
 * 用 periodMode 判断会漏掉它。62 = 两个月上限（31×2），
 * 即「最多两个月仍按天看」，再长就超出人对逐日曲线的分辨能力了。
 *
 * 聚合后 date 只留 "YYYY-MM"（7 位）—— 下游靠字符串长度判断粒度。
 */
/**
 * 错误态副文案：告诉用户「接下来能做什么」。
 *
 * 必须按真实原因分叉。原来无条件写「检查网络连接，或确认服务端已更新」，
 * 服务端升级完之后遇到网络问题还是这句 —— 用户会一直去查服务端版本。
 */
private fun reportErrorHint(error: String): String = when {
    error.contains("升级服务端") -> "当前服务端版本不支持自定义区间，请更新后端后重试"
    error.contains("登录") || error.contains("401") -> "登录状态可能已过期，请重新登录"
    error.contains("格式错误") -> "所选区间不合法，请重新选择起止月份"
    else -> "检查网络连接后重试；持续失败请确认服务端是否可访问"
}

private fun trendBuckets(raw: List<DailyTrendPoint>): List<DailyTrendPoint> {
    if (raw.size <= 62) return raw
    val order = LinkedHashMap<String, DoubleArray>()
    raw.forEach { p ->
        val ym = p.date.take(7)
        if (ym.length < 7) return@forEach
        val acc = order.getOrPut(ym) { doubleArrayOf(0.0, 0.0) }
        acc[0] += p.income
        acc[1] += p.expense
    }
    return order.map { (ym, acc) -> DailyTrendPoint(date = ym, income = acc[0], expense = acc[1]) }
}

/** 桶是否按月聚合（影响副标题措辞与表格首列表头） */
private fun isMonthBucket(buckets: List<DailyTrendPoint>): Boolean =
    buckets.isNotEmpty() && buckets[0].date.length == 7

/**
 * 桶标签。
 * 日桶 "2026-08-12" → "2026-08-12"（保持原样，与截图一致）
 * 月桶 "2026-08"    → "8月"；仅当这批桶跨年时才带年份
 *   （按年查看时 12 个桶同属一年，顶部导航已写「2026年」，重复是 0 比特信息；
 *     自定义跨年区间 2026-11~2027-02 会出现两个「1月」，年份是必要的）
 */
private fun bucketLabel(buckets: List<DailyTrendPoint>, index: Int): String {
    val d = buckets.getOrNull(index)?.date ?: return ""
    if (d.length != 7) return isoDay(d)
    val crossYear = buckets.first().date.take(4) != buckets.last().date.take(4)
    val m = d.substring(5, 7).trimStart('0')
    return if (crossYear) "${d.take(4)}年${m}月" else "${m}月"
}

/**
 * 统计页（截图版布局）：
 * 顶部：[支出/收入/结余 tab]               [‹ 2026年08月 ›]
 *   ─ 支出: 4KPI(2x2) → 支出趋势 → 分类排行 → 明细排行
 *   ─ 收入: 2KPI → 收入趋势 → 分类排行 → 明细排行
 *   ─ 结余: 2KPI → 结余趋势 → 每日概况（绿色表头大表格）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(navController: NavHostController) {
    val vm: ReportsViewModel = viewModel(factory = viewModelFactory { ReportsViewModel(AppContainer.reportRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    // 当前账本切换后重新拉取报表
    val curBookId = AppContainer.currentBookId.collectAsState().value
    LaunchedEffect(curBookId) { vm.reload() }
    // 回到前台（从后台返回）：重新拉取报表数据
    LaunchedEffect(Unit) {
        AppContainer.onForeground.collect { vm.reload() }
    }

    // 错误提示只在「已有报表可看」时用 snackbar 一闪而过（刷新失败不该赶走已有内容）。
    //
    // ⚠️ 不能无条件 consumeError()：那样会把 error 立刻清成 null，
    // 下面 when 里的 ErrorState 分支永远走不到，最终落到
    // EmptyState("暂无报表数据") —— 请求失败被伪装成「这个周期没记账」。
    // report == null 时把 error 留着，交给 ErrorState 显性呈现 + 提供重试。
    LaunchedEffect(state.error) {
        val e = state.error
        if (e != null && state.report != null) {
            snackbar.showSnackbar(e)
            vm.consumeError()
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0), // 与首页/账单一致：让 BookHeader.statusBarsPadding 单独负责状态栏 inset，避免双层留白
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        when {
            state.loading && state.report == null -> LoadingBox()
            // ⚠️ 重试必须用 reload() 不能用 setPeriod(state.period)：
            // setPeriod 开头有 `if (period == _state.value.period) return`，
            // 传当前值直接 return —— 按钮点了毫无反应，像是坏的。
            //
            // hint 与鸿蒙 ErrorBlock 的副文案保持一致：按年/自定义失败的真实
            // 原因通常是服务端版本旧，只说"数据加载失败"用户只会反复切周期。
            state.error != null && state.report == null -> ErrorState(
                state.error!!,
                onRetry = { vm.reload() },
                hint = reportErrorHint(state.error!!)
            )
            state.report != null -> ReportContent(
                report = state.report!!,
                dataType = state.dataType,
                period = state.period,
                periodMode = state.periodMode,
                months = emptyList(), // TODO: 从后端获取有交易的月份列表
                minYear = Calendar.getInstance().get(Calendar.YEAR) - 5, // 默认近 5 年，可从数据推算
                topTransactions = state.topTransactions,
                onDataTypeChange = vm::setDataType,
                // ⚠️ 必须走 applyPeriod 原子入口，不能拆成
                //    vm.setPeriodMode(mode); vm.setPeriod(period)
                // 两个 setter 各带去重 guard 且各自发请求，串起来会打出中间态请求
                // （年→月先请求当前月、月→自定义先拿 custom 配月份串）。
                // 详见 ReportsViewModel.applyPeriod 注释与 verify-period-atomic-apply.js。
                onPeriodChange = { period, mode -> vm.applyPeriod(period, mode) },
                onSearch = { navController.navigate(Screen.Search.route) },
                modifier = Modifier.fillMaxSize().padding(padding)
            )
            else -> EmptyState("暂无报表数据")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportContent(
    report: com.xinwallet.app.data.model.FinanceReport,
    dataType: String,
    period: String,
    periodMode: String = "month",
    months: List<String> = emptyList(),
    minYear: Int,
    topTransactions: List<TopTransaction>,
    onDataTypeChange: (String) -> Unit,
    onPeriodChange: (String, String) -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showBookSheet by remember { mutableStateOf(false) }
    var showPeriodPicker by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // KPI 计算
    val kpis = remember(report, dataType, periodMode, period) { buildKpis(dataType, report, periodMode, period) }

    // 时间桶：按年/长区间自动聚合为月桶，否则保持日桶。
    // 趋势图与「每日概况」表格共用同一份，保证两处粒度一致 ——
    // 曲线按月而表格按日会让用户对不上号。
    val buckets = remember(report) { trendBuckets(report.dailyTrend) }

    // 趋势序列 + 峰值
    val series = remember(buckets, dataType) {
        when (dataType) {
            "income" -> buckets.map { it.income }
            "balance" -> {
                val out = mutableListOf<Double>()
                var acc = 0.0
                buckets.forEach { p -> acc += (p.income - p.expense); out.add(acc) }
                out
            }
            else -> buckets.map { it.expense }
        }
    }
    val peakIndex = remember(series) {
        if (series.isEmpty()) null else run {
            var idx = 0
            for (i in series.indices) if (series[i] > series[idx]) idx = i
            idx
        }
    }

    // 分类排行数据（仅 支出/收入 维度）
    val rawCats = remember(report, dataType) {
        if (dataType == "income") report.incomeByCategory else report.expenseByCategory
    }
    // 环图数据：固定只取一级分类（parentId 为空，后端已把子类金额上卷到此处）。
    // ⚠️ 必须在这里过滤零金额并按金额降序，与鸿蒙 Reports.ets:pieces() 保持同一套顺序。
    // DonutChart 内部会 filter(>0)+降序重排，它按 name 回调选中；两边顺序不一致时，
    // 环图的第 N 块和列表的第 N 行不是同一个分类 —— 不报错、不崩，只是「点了 A 高亮 B」。
    val cats = remember(rawCats) {
        rawCats.filter { it.parentId == null && it.total > 0 }.sortedByDescending { it.total }
    }
    // 二级子类索引：parentId → 该父类下的子类（已过滤零金额并降序）。
    // 列表区不再跟着环图换数据源，而是「选中哪个大类就展开它的小类」。
    val childrenByParent = remember(rawCats) {
        rawCats.filter { it.parentId != null && it.total > 0 }
            .groupBy { it.parentId!! }
            .mapValues { (_, list) -> list.sortedByDescending { it.total } }
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

    // 时间选择器弹窗
    if (showPeriodPicker) {
        ReportPeriodPickerDialog(
            initialPeriod = period,
            initialMode = periodMode,
            minYear = minYear,
            onDismiss = { showPeriodPicker = false },
            onConfirm = { newPeriod, newMode ->
                showPeriodPicker = false
                onPeriodChange(newPeriod, newMode)
            }
        )
    }

    Column(modifier) {
        // —— 顶部固定区（账本头） ——
        BookHeader(onSwapBook = { showBookSheet = true }, onSearch = onSearch)

        // —— 类型 tab + 月份选择器（同一行；不随下方报表滚动） ——
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // 左列：类型 tab（填充整列，宽度对齐"支出金额"卡；3 段均分列宽）
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0xFFF0EDEE))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                DATA_TYPE_OPTIONS.forEach { (value, label) ->
                    val on = dataType == value
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(9.dp))
                            .background(if (on) Brown500 else Color.Transparent)
                            .clickable { onDataTypeChange(value) }
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
            // 右列：周期选择器（点击打开选择弹窗）
            Row(
                Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.End
            ) {
                Box(
                    Modifier.size(32.dp).clickable(enabled = periodMode != "custom") {
                        // 左箭头：按月 shiftMonth，按年 ±1 年（自定义模式无相邻周期概念）
                        if (periodMode == "year") {
                            val y = period.take(4).toIntOrNull() ?: return@clickable
                            onPeriodChange("${y - 1}", "year")
                        } else {
                            onPeriodChange(shiftMonth(period, -1), periodMode)
                        }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Filled.ChevronLeft, "上一个周期",
                        modifier = Modifier.size(20.dp),
                        tint = Brown500
                    )
                }
                Text(
                    periodDisplay(period, periodMode),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    modifier = Modifier.clickable { showPeriodPicker = true }
                )
                Box(
                    Modifier.size(32.dp).clickable(enabled = periodMode != "custom") {
                        // 右箭头：按月 shiftMonth，按年 +1 年（自定义模式无相邻周期概念）
                        if (periodMode == "year") {
                            val y = period.take(4).toIntOrNull() ?: return@clickable
                            onPeriodChange("${y + 1}", "year")
                        } else {
                            onPeriodChange(shiftMonth(period, 1), periodMode)
                        }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Filled.ChevronRight, "下一个周期",
                        modifier = Modifier.size(20.dp),
                        tint = Brown500
                    )
                }
            }
        }

        // —— 仅下方报表内容滚动 ——
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            // KPI 卡片（按维度不同）
            item { KpiGrid(kpis) }
            item { Spacer(Modifier.height(12.dp)) }

            // 趋势
            item { TrendCard(dataType, buckets, series, peakIndex) }
            item { Spacer(Modifier.height(12.dp)) }

            // 支出 / 收入：分类排行 + 明细排行
            if (dataType != "balance") {
                item {
                    CategoryRankingCard(
                        categories = cats,
                        childrenByParent = childrenByParent
                    )
                }
                item { Spacer(Modifier.height(12.dp)) }
                if (topTransactions.isNotEmpty()) {
                    item { DetailRankingCard(topTransactions, isIncome = dataType == "income") }
                }
            } else {
                // 结余：每日/每月概况大表格
                item { DailyOverviewTable(buckets) }
            }
        }
    }
}

/**
 * 顶部账本标题：复用共享 BookHeader（默认账本 + 切换 / 搜索图标）。
 */

/* ────────── KPI 网格 ────────── */

private data class KpiSpec(val title: String, val value: String, val accent: Color, val icon: String)

/**
 * 根据时间维度计算「均值」标签与除数：
 * - 按月：日均，除数 30
 * - 按年：月均，除数 12
 * - 自定义：≤2月→日均(天数)；>2月 且 ≤2年→月均(月数)；>2年→年均(年数)
 */
private fun avgLabelAndDivisor(periodMode: String, period: String): Pair<String, Double> {
    return when (periodMode) {
        "year" -> "月均" to 12.0
        "custom" -> {
            val parts = period.split("~")
            if (parts.size == 2) {
                val s = parseDate(parts[0]); val e = parseDate(parts[1])
                if (s != null && e != null) {
                    val days = ((e.timeInMillis - s.timeInMillis) / 86_400_000L).toInt() + 1
                    if (days <= 60) return "日均" to days.toDouble().coerceAtLeast(1.0)
                    val months = (e.get(Calendar.YEAR) - s.get(Calendar.YEAR)) * 12 +
                        (e.get(Calendar.MONTH) - s.get(Calendar.MONTH))
                    if (months > 24) return "年均" to (e.get(Calendar.YEAR) - s.get(Calendar.YEAR)).toDouble().coerceAtLeast(1.0)
                    return "月均" to months.toDouble().coerceAtLeast(1.0)
                }
            }
            "日均" to 30.0
        }
        else -> "日均" to 30.0
    }
}

/** "YYYY-MM" 或 "YYYY-MM-DD" → Calendar（解析失败返回 null） */
private fun parseDate(d: String): Calendar? {
    val m = Regex("(\\d{4})-(\\d{2})(?:-(\\d{2}))?").find(d) ?: return null
    val y = m.groupValues[1].toIntOrNull() ?: return null
    val mo = m.groupValues[2].toIntOrNull()?.minus(1) ?: return null
    val day = m.groupValues[3].toIntOrNull() ?: 1
    return Calendar.getInstance().apply { set(y, mo, day) }
}

private fun buildKpis(dataType: String, report: com.xinwallet.app.data.model.FinanceReport, periodMode: String = "month", period: String): List<KpiSpec> {
    val s = report.summary
    val main = Color(0xFF995F2C) // 暖棕主色
    // 预算前缀：本月 / 本年 / (自定义无前缀)
    val periodPrefix = when (periodMode) {
        "year" -> "本年"
        "custom" -> ""
        else -> "本月"
    }
    val (avgLabel, avgDivisor) = avgLabelAndDivisor(periodMode, period)
    return when (dataType) {
        "income" -> listOf(
            // 多币种 P2-2e：收入金额按 breakdown 智能格式化（多币种账本自动附注其他货币）
            KpiSpec("收入金额", formatMoneyMix(s.incomeBreakdown), Color(0xFFC11435), "💵"),
            KpiSpec("${avgLabel}收入", formatMoneyMix(s.incomeBreakdown, s.currency), Color(0xFFC11435), "📅")
        )
        "balance" -> listOf(
            // balance = income - expense 主货币值；非多币种混显场景直接按主货币格式化
            KpiSpec("结余金额", formatMoney(s.balance, s.currency), main, "🎯"),
            KpiSpec("${avgLabel}结余", formatMoney(s.balance / avgDivisor, s.currency), main, "📅")
        )
        else -> {
            // 支出：4 张 = 支出金额 / (日均|月均|年均)支出 / (本月|本年)预算 / 剩余预算
            val totalBudget = report.budgetExecution.sumOf { it.budget }
            val totalActual = report.budgetExecution.sumOf { it.actual }
            val remaining = totalBudget - totalActual
            val green = Color(0xFF009558)
            listOf(
                KpiSpec("支出金额", formatMoneyMix(s.expenseBreakdown), green, "💸"),
                KpiSpec("${avgLabel}支出", formatMoneyMix(s.expenseBreakdown, s.currency), green, "📅"),
                // 预算总额 = sumOf{it.budget}，预算 amount 自身是 CNY 单货币（stats.js/reports.js 一致）
                KpiSpec(if (periodPrefix.isEmpty()) "预算" else "${periodPrefix}预算", formatMoney(totalBudget), main, "💰"),
                // 剩余预算 = 总额 - 主货币实际，多币种账本下近似按主货币展示（预算天然 CNY 单货币）
                KpiSpec("剩余预算", formatMoney(remaining), main, "⏳")
            )
        }
    }
}

@Composable
private fun KpiGrid(specs: List<KpiSpec>) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        specs.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { sp -> KpiCard(sp, Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun KpiCard(s: KpiSpec, modifier: Modifier = Modifier) {
    Card(
        modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(26.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text(s.icon, fontSize = 14.sp) }
                }
                Spacer(Modifier.width(8.dp))
                Text(s.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            Text(s.value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = s.accent)
        }
    }
}

/* ────────── 趋势卡片 ────────── */

@Composable
private fun TrendCard(
    dataType: String,
    buckets: List<DailyTrendPoint>,
    series: List<Double>,
    peakIndex: Int?
) {
    // 选中日索引：默认峰值日；点击图表切换为点中的那一天
    var selectedIndex by remember(series) { mutableStateOf(peakIndex) }

    // 多币种 P2-2e：series 是按 bucket 主货币提取的序列，整期主货币取首个非零 bucket 的 currency
    // （混币种账本下 series 不严格同币种，但「累计」/「选中点」展示用单一 currency 比拼接更可读）
    val primaryCurrency = remember(buckets) {
        buckets.firstOrNull { it.income > 0 || it.expense > 0 }?.currency ?: "CNY"
    }

    val (title, color, dayLabelPrefix, cumLabel) = when (dataType) {
        "income" -> Quadruple(
            "收入趋势",
            Color(0xFFC11435),
            "收入",
            "累计收入 ${formatMoney(series.sum(), primaryCurrency)}"
        )
        "balance" -> Quadruple(
            "结余趋势",
            Color(0xFF995F2C),
            "结余",
            "期末结余 ${formatMoney(series.lastOrNull() ?: 0.0, primaryCurrency)}"
        )
        else -> Quadruple(
            "支出趋势",
            Color(0xFF009558),
            "支出",
            "累计支出 ${formatMoney(series.sum(), primaryCurrency)}"
        )
    }

    // 左：选中桶 + 该桶值（无 ¥ 符号）；累计始终为整期累计
    val dayLabel = selectedIndex
        ?.takeIf { it in buckets.indices && it in series.indices }
        ?.let {
            // 多币种 P2-2e：选中点的 currency 取该 bucket 的 currency（单日多币种混显场景）
            val cur = buckets[it].currency
            "${bucketLabel(buckets, it)}  $dayLabelPrefix ${formatMoney(series[it], cur)}"
        }
        ?: "本期暂无数据"

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(dayLabel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(cumLabel, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = color)
            }
            Spacer(Modifier.height(8.dp))
            if (series.isEmpty() || (series.maxOrNull() ?: 0.0) <= 0) {
                EmptyState("该周期暂无数据")
            } else {
                com.xinwallet.app.ui.components.TrendLineChartSingle(
                    series, color,
                    peakIndex = selectedIndex,
                    onTapIndex = { selectedIndex = it }
                )
                Spacer(Modifier.height(2.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    // X 轴标签必须来自**实际数据桶**，不能硬编码。
                    // 原来写死 (1..12) / listOf("01","05",...,"30")：
                    //   · 31 天的月份最后一个数据点是 31 号，标签却写「30」——差一天，
                    //     而峰值往往就在月末，用户对不上号
                    //   · 2 月只有 28 天，标签仍标到「30」
                    //   · 自定义区间（比如 3 个月）标签完全对不上
                    // 现在按 SpaceBetween 能容纳的数量（约 7 个）从桶里等距抽样。
                    val labels = remember(buckets) {
                        val n = buckets.size
                        if (n == 0) emptyList()
                        else {
                            // 12 而不是 7：卡内可用约 300dp，labelSmall 2 位数字约 12.1dp，
                            // 12 个标签占 145dp、间隙 14.1dp，很宽松。
                            // 取 7 的话按年会被抽成「01 03 05 07 09 11 12」——
                            // 用户点「按年」本来就是想看齐 12 个月，抽掉一半反而更难读。
                            val maxTicks = 12
                            val idxs = if (n <= maxTicks) (0 until n).toList()
                            else {
                                val step = kotlin.math.ceil((n - 1).toDouble() / (maxTicks - 1)).toInt().coerceAtLeast(1)
                                val out = (0 until n step step).toMutableList()
                                // 末尾必标，否则看不到区间终点
                                if (out.last() != n - 1) {
                                    if (n - 1 - out.last() < step / 2) out.removeAt(out.size - 1)
                                    out.add(n - 1)
                                }
                                out
                            }
                            idxs.map { i ->
                                val d = buckets[i].date
                                // 月桶 "2026-08" → "08"；日桶 "2026-08-12" → "12"
                                if (d.length == 7) d.substring(5, 7) else d.takeLast(2)
                            }
                        }
                    }
                    labels.forEach {
                        Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/* ────────── 分类排行（一级分类环图 + 选中项的二级子类列表） ────────── */

/**
 * 分类排行卡片。
 *
 * 层级表达方式（与 web 端下钻式样等价，但触屏上不需要「返回」按钮）：
 * - 环图只画一级分类，永远不换数据源；
 * - 点击色块 → 环心显示该分类金额与占比（行为与改造前一致）；
 * - 下方列表跟着选中项走，展开它的二级子类。
 *
 * 若选中的一级分类没有子类（本身就是叶子，如「转账」），列表退化为显示它自己
 * —— 空列表会让人以为出了 bug，而它其实是「这个类没有更细的划分」。
 *
 * @param categories 一级分类（已过滤零金额、按金额降序，顺序必须与环图一致）。
 * @param childrenByParent parentId → 该父类下的二级子类（已过滤零金额、降序）。
 */
@Composable
private fun CategoryRankingCard(
    categories: List<ReportCategorySlice>,
    childrenByParent: Map<Int, List<ReportCategorySlice>>
) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("分类排行", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            if (categories.isEmpty()) {
                EmptyState("该周期暂无分类数据")
            } else {
                // 选中的分类（默认金额最大的分类），点击环形图色块切换
                var selectedName by remember(categories) { mutableStateOf(categories.maxByOrNull { it.total }?.name) }
                val selected = categories.find { it.name == selectedName } ?: categories.firstOrNull()
                Spacer(Modifier.height(6.dp))
                // 稳定 data：避免每次点击都重建 DonutChart 手势检测器导致卡顿
                val pieData = remember(categories) { categories.map { it.name to it.total } }
                // 环心第一行带占比：环图去掉四角引线标注后（对齐 web 无引线式样），
                // 百分比没有别的落点。web 靠 hover tooltip 给「¥金额 (32.5%)」，
                // 触屏没有 hover，环心就是它的等价物。
                val totalAmount = remember(categories) { categories.sumOf { it.total } }
                val centerTitle = selected?.let {
                    if (totalAmount > 0) {
                        "${it.name} · ${"%.1f".format(it.total / totalAmount * 100)}%"
                    } else it.name
                }
                DonutChart(
                    data = pieData,
                    centerTitle = centerTitle,
                    // 多币种 P2-2e：环心金额按该分类的 breakdown 智能格式化（多币种账本自动附注）
                    centerAmount = selected?.let { formatMoneyMix(it.totalBreakdown) },
                    selectedLabel = selected?.name,
                    onSliceClick = { name -> selectedName = name }
                )
                Spacer(Modifier.height(8.dp))
                // 列表 = 选中一级分类的二级子类；无子类时退化为它自己
                val children = selected?.let { childrenByParent[it.id] }.orEmpty()
                val listItems = if (children.isNotEmpty()) children else listOfNotNull(selected)
                if (selected != null) {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "${selected.name} · ${if (children.isNotEmpty()) "二级明细" else "无二级分类"}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                // 占比分母用选中大类的总额（而非子类之和）：大类金额里可能有一部分
                // 没细分到子类，用子类之和当分母会把占比虚高到 100%，与环图读数冲突。
                CategoryBars(
                    items = listItems,
                    baseTotal = selected?.total,
                    colorOffset = categories.indexOfFirst { it.name == selected?.name }.coerceAtLeast(0)
                )
            }
        }
    }
}

/* ────────── 明细排行 ────────── */

@Composable
private fun DetailRankingCard(items: List<TopTransaction>, isIncome: Boolean) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(vertical = 4.dp)) {
            Text(
                "明细排行",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
            )
            items.forEach { tx ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(36.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) { Text(tx.categoryIcon ?: "📌") }
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(
                        tx.categoryName ?: "交易",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f)
                    )
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            // 多币种 P2-2e：按交易账户币种格式化（reports.js top-transactions 已加 currency 字段）
                            (if (isIncome) "" else "-") + formatMoney(tx.amount, tx.currency),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isIncome) Color(0xFFC11435) else Color(0xFF009558)
                        )
                        Text(
                            tx.date.take(10).replace("-", "."),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/* ────────── 结余：每日概况大表格 ────────── */

@Composable
private fun DailyOverviewTable(buckets: List<DailyTrendPoint>) {
    val monthly = isMonthBucket(buckets)
    // 多币种 P2-2e：汇总行主货币取首个非零 bucket 的 currency；行级用各 bucket 自带 currency
    val primaryCurrency = remember(buckets) {
        buckets.firstOrNull { it.income > 0 || it.expense > 0 }?.currency ?: "CNY"
    }
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column {
            Text(
                if (monthly) "每月概况" else "每日概况",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
            )
            // 表头（暖棕品牌色，截图是薄荷绿——这里保留暖棕保持一致）
            Row(
                Modifier.fillMaxWidth().background(Color(0xFF995F2C)),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically
            ) {
                    listOf(if (monthly) "月份" else "日期", "支出", "收入", "结余").forEach {
                        Text(
                            it,
                            color = Color.White,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(vertical = 12.dp).weight(1f),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                }
                // 与趋势图共用同一套桶：按年时这里是 12 行月汇总，不是 365 行。
                // 原来直接读 report.dailyTrend，按年会渲染 365 个 Row。
                buckets.forEach { p ->
                    val balance = p.income - p.expense
                    // 多币种 P2-2e：每行用该 bucket 的 currency；balance 用同币种
                    val rowCur = p.currency
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceAround,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        listOf(
                            // 日桶 "2026-08-12" → "08.12"；月桶 "2026-08" → "8月"
                            if (monthly) "${p.date.substring(5, 7).trimStart('0')}月"
                            else p.date.takeLast(5).replace("-", "."),
                            // 四列等分 weight(1f)，360dp 屏每列仅约 82dp；
                            // 12sp 下 -¥123,456.00 需约 92dp 会换行，导致表格行高参差。
                            // 这里是「一行内并排多项金额」，用 formatMoneyShort（≥1万才缩）
                            if (p.expense > 0) "-${formatMoneyShort(p.expense, rowCur)}" else "—",
                            if (p.income > 0) "+${formatMoneyShort(p.income, rowCur)}" else "—",
                            if (balance != 0.0) formatMoneyShort(balance, rowCur) else "—"
                        ).forEachIndexed { idx, text ->
                            val color = when (idx) {
                                // ⚠️ 原来这里写反了：支出用 0xFFC11435（红）、收入用 0xFF009558（绿），
                                // 注释还写着「支出按收入红」。而 Color.kt 定义的是
                                // ExpenseColor = 0xFF009558（绿）、IncomeColor = 0xFFC11435（红），
                                // 账单页 TransactionsScreen.kt:521 也是 isExpense -> ExpenseColor。
                                // 即这张表的支出/收入配色与全 App 相反（中国习惯：支出绿、收入红）。
                                // 改用 token 而不是再硬编码一遍，避免下次又对不上。
                                1 -> ExpenseColor
                                2 -> IncomeColor
                                3 -> if (balance < 0) ExpenseColor else IncomeColor
                                else -> MaterialTheme.colorScheme.onSurface
                            }
                            Text(
                                text,
                                style = MaterialTheme.typography.bodySmall,
                                color = color,
                                maxLines = 1,
                                softWrap = false,
                                modifier = Modifier.padding(vertical = 10.dp).weight(1f),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        }
                    }
                }
                // 汇总行。从 buckets 累加而不是读 report.summary。
                // 核实过两者当前口径一致（服务端两条 SQL 的 WHERE 与 CASE WHEN 相同），
                // 改成同源相加是**结构性保证**：表格每行来自 buckets，汇总是这些行的和，
                // 必然平账。读 summary 则依赖「服务端两条 SQL 恰好口径相同」这个外部约定，
                // 哪天有人改了 summary 的 WHERE，表格就会「各行加起来 ≠ 汇总」，
                // 而这种错不报错，只有用户按计算器才会发现。
                val totalExpense = buckets.sumOf { it.expense }
                val totalIncome = buckets.sumOf { it.income }
                val totalBalance = totalIncome - totalExpense
                Row(
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    listOf(
                        "汇总",
                        // 多币种 P2-2e：汇总行用 primaryCurrency（取首个非零 bucket）
                        if (totalExpense > 0) "-${formatMoney(totalExpense, primaryCurrency)}" else "—",
                        if (totalIncome > 0) "+${formatMoney(totalIncome, primaryCurrency)}" else "—",
                        formatMoney(totalBalance, primaryCurrency)
                    ).forEachIndexed { idx, text ->
                        Text(
                            text,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            // 与数据行同一套 token（原来这里也把支出写成红、收入写成绿）
                            color = when (idx) {
                                3 -> if (totalBalance < 0) ExpenseColor else IncomeColor
                                1 -> ExpenseColor
                                2 -> IncomeColor
                                else -> MaterialTheme.colorScheme.onSurface
                            },
                            modifier = Modifier.padding(vertical = 12.dp).weight(1f),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                }
            }
        }
}

/* ────────── 工具 ────────── */

private data class Quadruple<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

@Composable
private fun Modifier.noRippleClickable(onClick: () -> Unit): Modifier =
    this.then(
        Modifier.clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = onClick
        )
    )

/* ────────── 统计页时间选择器弹窗（三 tab：按月/按年/自定义） ────────── */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportPeriodPickerDialog(
    initialPeriod: String,      // "YYYY-MM" 或 "YYYY"
    initialMode: String,        // "month" / "year" / "custom"
    minYear: Int,               // 最早交易年份（按年视图首页起点）
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit   // (period, mode)
) {
    val currentYear = Calendar.getInstance().get(Calendar.YEAR)
    val currentMonthInt = Calendar.getInstance().get(Calendar.MONTH) + 1

    val initYear = initialPeriod.take(4).toIntOrNull() ?: currentYear
    val initMonth = if (initialPeriod.length >= 7) initialPeriod.substring(5, 7).trimStart('0').toIntOrNull() ?: currentMonthInt else currentMonthInt

    var mode by remember { mutableStateOf(initialMode) }
    var selYear by remember { mutableStateOf(initYear) }
    var selMonth by remember { mutableStateOf(initMonth) }
    // 按年视图：12 年一页
    var selYearBase by remember {
        mutableStateOf(((initYear - minYear).coerceAtLeast(0) / 12) * 12 + minYear)
    }
    // 自定义：起止月份（格式 YYYY-MM）
    var customStart by remember { mutableStateOf(if (initialMode == "custom" && initialPeriod.contains("~")) initialPeriod.substringBefore("~") else "") }
    var customEnd by remember { mutableStateOf(if (initialMode == "custom" && initialPeriod.contains("~")) initialPeriod.substringAfter("~") else "") }

    val months = remember { (1..12).toList() }
    val monthYears = remember { (currentYear - 8)..(currentYear + 3) }
    val pageYears = remember(selYearBase) { (selYearBase..selYearBase + 11).toList() }

    // 选中色：青绿色（与截图一致）
    val accentColor = ExpenseColor

    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null
    ) {
        Column(Modifier.padding(horizontal = 24.dp)) {
            // 顶部 tab：按月查看 / 按年查看 / 自定义（无背景，选中显示下划线）
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                listOf("month" to "按月查看", "year" to "按年查看", "custom" to "自定义").forEach { (key, label) ->
                    val on = mode == key
                    Column(
                        Modifier.clickable { mode = key }.padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            label,
                            color = if (on) accentColor else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp
                        )
                        if (on) {
                            Spacer(Modifier.height(6.dp))
                            Box(Modifier.width(28.dp).height(2.dp).background(accentColor))
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))

            when (mode) {
                "month" -> {
                    // 第二行：年份选择
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = { selYear -= 1 }, enabled = selYear > monthYears.first()) {
                            Icon(Icons.Filled.ChevronLeft, "上一年", tint = accentColor)
                            Spacer(Modifier.width(4.dp))
                            Text("${selYear - 1}", color = accentColor, fontSize = 13.sp)
                        }
                        Text("$selYear", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { selYear += 1 }, enabled = selYear < monthYears.last()) {
                            Text("${selYear + 1}", color = accentColor, fontSize = 13.sp)
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Filled.ChevronRight, "下一年", tint = accentColor)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    // 12 个月份网格，点击即确认
                    val cols = 4
                    months.chunked(cols).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { m ->
                                val isSelected = m == selMonth && selYear == initYear
                                val isCurrent = m == currentMonthInt && currentYear == selYear
                                // 未来月份置灰（当前年且月份 > 当前月）
                                val isFuture = currentYear == selYear && m > currentMonthInt
                                Box(
                                    Modifier
                                        .weight(1f)
                                        .aspectRatio(2.2f)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(
                                            when {
                                                isSelected -> accentColor
                                                isCurrent -> Color(0xFFE8F5E9)
                                                isFuture -> Color(0xFFF0EDEE)
                                                else -> Color(0xFFF5F5F5)
                                            }
                                        )
                                        .clickable(enabled = !isFuture) {
                                            onConfirm(String.format("%04d-%02d", selYear, m), "month")
                                        },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "${m}月",
                                        color = when {
                                            isSelected -> Color.White
                                            isCurrent -> accentColor
                                            isFuture -> Color(0xFFBDBDBD)
                                            else -> MaterialTheme.colorScheme.onSurface
                                        },
                                        fontWeight = if (isSelected || isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                        fontSize = 14.sp
                                    )
                                }
                            }
                            repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                }
                "year" -> {
                    // 第二行：年份翻页（12 年一页）
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = { selYearBase = (selYearBase - 12).coerceAtLeast(minYear) }, enabled = selYearBase > minYear) {
                            Icon(Icons.Filled.ChevronLeft, "上一页", tint = accentColor)
                            Spacer(Modifier.width(4.dp))
                            Text("${selYearBase - 1}", color = accentColor, fontSize = 13.sp)
                        }
                        Text("年份", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { selYearBase += 12 }) {
                            Text("${selYearBase + 12}", color = accentColor, fontSize = 13.sp)
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Filled.ChevronRight, "下一页", tint = accentColor)
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
                                                isSelected -> accentColor
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
                                            isCurrent -> accentColor
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
                "custom" -> {
                    // 自定义：按月选择起止（开始/结束切换 + 年份箭头 + 12 月网格）
                    var editing by remember { mutableStateOf("start") }
                    var sy by remember { mutableStateOf(customStart.take(4).toIntOrNull() ?: currentYear) }
                    var ey by remember { mutableStateOf(customEnd.take(4).toIntOrNull() ?: currentYear) }
                    val cols = 4
                    val activeYear = if (editing == "start") sy else ey

                    // 开始 / 结束 切换（无背景，选中白底）
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFF0EDEE)).padding(3.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        listOf("start" to "开始", "end" to "结束").forEach { (key, label) ->
                            val on = editing == key
                            Box(
                                Modifier.weight(1f).clip(RoundedCornerShape(9.dp))
                                    .background(if (on) Color.White else Color.Transparent)
                                    .clickable { editing = key }
                                    .padding(vertical = 7.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    label,
                                    color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))

                    // 当前编辑字段的年份箭头
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = { if (editing == "start") sy -= 1 else ey -= 1 }) {
                            Icon(Icons.Filled.ChevronLeft, "上一年", tint = accentColor)
                            Spacer(Modifier.width(4.dp))
                            Text("${activeYear - 1}", color = accentColor, fontSize = 13.sp)
                        }
                        Text("$activeYear", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { if (editing == "start") sy += 1 else ey += 1 }) {
                            Text("${activeYear + 1}", color = accentColor, fontSize = 13.sp)
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Filled.ChevronRight, "下一年", tint = accentColor)
                        }
                    }
                    Spacer(Modifier.height(16.dp))

                    // 12 个月份网格：点击设置当前编辑字段
                    months.chunked(cols).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { m ->
                                val mm = String.format("%04d-%02d", activeYear, m)
                                val isSel = if (editing == "start") mm == customStart else mm == customEnd
                                Box(
                                    Modifier
                                        .weight(1f)
                                        .aspectRatio(2.2f)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(if (isSel) accentColor else Color(0xFFF5F5F5))
                                        .clickable { if (editing == "start") customStart = mm else customEnd = mm },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "${m}月",
                                        color = if (isSel) Color.White else MaterialTheme.colorScheme.onSurface,
                                        fontWeight = if (isSel) FontWeight.SemiBold else FontWeight.Normal,
                                        fontSize = 14.sp
                                    )
                                }
                            }
                            repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                        Spacer(Modifier.height(10.dp))
                    }

                    Spacer(Modifier.height(8.dp))
                    // 已选范围提示
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        Text(
                            "${if (customStart.isEmpty()) "开始?" else customStart}  ~  ${if (customEnd.isEmpty()) "结束?" else customEnd}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    // 确定按钮
                    androidx.compose.material3.Button(
                        onClick = { onConfirm("$customStart~$customEnd", "custom") },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = accentColor),
                        enabled = customStart.isNotEmpty() && customEnd.isNotEmpty()
                    ) {
                        Text("确定", color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}
