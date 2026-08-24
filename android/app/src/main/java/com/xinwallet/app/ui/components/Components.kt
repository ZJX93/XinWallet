package com.xinwallet.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.Transaction
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.ExpenseColorDark
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.ui.theme.IncomeColorDark
import com.xinwallet.app.ui.theme.LocalIsDark
import com.xinwallet.app.ui.theme.GlassBox
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.util.formatMoney
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.graphics.Brush

@Composable
fun TopBar(title: String, onBack: (() -> Unit)? = null) {
    GlassBox(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(0.dp),
        elevated = true
    ) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().height(56.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            }
            Text(title, style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp)
    )
}

@Composable
fun BalanceCard(title: String, amount: Double, subtitle: String? = null, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Card(
        modifier = Modifier.fillMaxWidth().then(modifier).then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.height(6.dp))
            Text(formatMoney(amount), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            if (subtitle != null) {
                Spacer(Modifier.height(4.dp))
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
            }
        }
    }
}

/**
 * Hero 渐变卡：用于首页"本月支出 ¥1.00"类醒目头卡（暖棕渐变 + 大数字）。
 * 副标题区支持左右两段（本月收入 / 日均支出 等对照指标）。
 */
@Composable
fun HeroGradientCard(
    amount: Double,
    topLeft: String,
    topRight: String? = null,
    bottomLeft: String? = null,
    bottomRight: String? = null,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    val gradient = Brush.linearGradient(
        colors = listOf(Brown500, Brown300)
    )
    Surface(
        modifier = Modifier.fillMaxWidth().then(modifier).then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
        shape = RoundedCornerShape(20.dp),
        color = Color.Transparent
    ) {
        Box(
            Modifier.fillMaxWidth().background(gradient).padding(20.dp)
        ) {
            Column {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(topLeft, style = MaterialTheme.typography.titleMedium, color = Color.White)
                    if (topRight != null) {
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = Color.White.copy(alpha = 0.22f)
                        ) {
                            Text(
                                topRight,
                                style = MaterialTheme.typography.labelMedium,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    // formatMoney 已带 ¥ 前缀，不要再拼一个
                    formatMoney(amount),
                    style = MaterialTheme.typography.displayMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                if (bottomLeft != null || bottomRight != null) {
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(24.dp)
                    ) {
                        bottomLeft?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.92f))
                        }
                        bottomRight?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.92f))
                        }
                    }
                }
            }
        }
    }
}

/**
 * 2x2 KPI 网格小卡：用于"支出金额/日均支出/本月预算/剩余预算"四联展示。
 * 每张卡片左侧一个圆形小图标 + 标题，下方大数字。
 */
@Composable
fun StatKpiCard(
    title: String,
    amount: Double,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    GlassBox(
        Modifier.then(modifier).then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
        shape = RoundedCornerShape(16.dp),
        elevated = true
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(50),
                    color = Brown50,
                    modifier = Modifier.size(28.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(icon, contentDescription = null, tint = Brown500, modifier = Modifier.size(16.dp))
                    }
                }
                Spacer(Modifier.width(8.dp))
                Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                // formatMoney 已带 ¥ 前缀，不要再拼一个
                formatMoney(amount),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = Brown500
            )
        }
    }
}

fun accountTypeLabel(type: String): String = when (type) {
    "cash" -> "现金"
    "bank_card" -> "储蓄卡"
    "credit_card" -> "信用卡"
    "electronic_payment" -> "电子支付"
    "financial_account" -> "理财账户"
    "digital" -> "数字资产"
    else -> "其他"
}

@Composable
fun AccountListItem(account: Account, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) { Text(account.icon ?: "💰", style = MaterialTheme.typography.titleMedium) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(account.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(accountTypeLabel(account.type), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(formatMoney(account.balance), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
            if (account.type == "credit_card" && account.creditLimit > 0) {
                Text("额度 ${formatMoney(account.creditLimit)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun TransactionRow(item: TransactionItem) {
    val dark = LocalIsDark.current
    /**
     * 折叠转账：一笔转账在列表里只出一条（服务端 SQL 折叠），这条记录要能
     * 自己表达完整的「A → B」。
     *
     * 判据用 item.transfer 而不是 type == "transfer_out"：服务端要求
     * transfer_id + 双端账户名齐全才构造 transfer，账户被删时它是 null，
     * 此时退回普通渲染，而不是显示「? → ?」。
     */
    val tf = item.transfer
    /**
     * 判据优先用 transfer 字段（新后端下发，两端账户名齐全）。
     * 兜底：老后端不返回 transfer，但 type 仍是 "transfer_out"/"transfer_in"，
     * 此时也要按转账渲染（🔄 + 中性色 + 无符号），否则老后端下转账会退化成
     * 普通支出显示成红色负号。flow 的兜底拼装在下方 sub 里。
     */
    val isTransfer = tf != null || item.type.startsWith("transfer")
    val isIncome = !isTransfer && item.type == "income"
    val isExpense = !isTransfer && item.type == "expense"
    val color = when {
        // 转账用中性色：钱只是从一个口袋换到另一个口袋，总资产没变。
        // 原先 transfer_out 走 isExpense 分支显示红色 -1000，看着像花掉了。
        isTransfer -> MaterialTheme.colorScheme.onSurface
        isIncome -> if (dark) IncomeColorDark else IncomeColor
        isExpense -> if (dark) ExpenseColorDark else ExpenseColor
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(if (isTransfer) "🔄" else (item.category?.icon ?: "📌"), style = MaterialTheme.typography.bodyLarge)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            /*
             * 两行分工对齐 web 端表格的列语义：
             *   第一行 = 分类列（web 的 .trans-category）
             *   第二行 = 账户列（web 的 .trans-account，转账时正是 "A → B"）
             *
             * 早前版本把 "A → B" 放在第一行、第二行写死 "转账"，有两个问题：
             *   1. 转账在库里是有真实分类的（如「一般转账 🏦」），第一行被占用后这条信息看不到；
             *   2. 第二行写死 "转账" 是常量，与左侧 🔄 图标重复表意，白占一整行。
             * 现在第一行让位给分类名，第二行承载 "A → B · 备注"，三条信息都能读到。
             */
            Text(
                item.category?.name ?: if (isTransfer) "转账" else "交易",
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            val sub = when {
                // 转账第二行：账户流向优先，备注跟在后面。
                // 顺序不能反 —— 备注长度不可控，若放前面会把 "A → B" 挤进省略号里；
                // 现在截断只会吃掉备注尾部，资金流向始终完整可见。
                isTransfer -> {
                    val flow = if (tf != null) {
                        // 主路径：新后端下发 transfer，两端账户名齐全，直接拼。
                        "${tf.from?.name ?: "?"} → ${tf.to?.name ?: "?"}"
                    } else {
                        // 兜底：老后端不返回 transfer。按 type 方向用 source /
                        // counterparty / destination 拼出 A → B，保证转账行始终
                        // 显示完整流向，而不是退化成单边的 "→ 对方"。
                        val out = item.type != "transfer_in"
                        val from = if (out) (item.source?.name ?: item.account?.name)
                                   else (item.counterparty?.name ?: item.source?.name)
                        val to = if (out) (item.counterparty?.name ?: item.destination?.name)
                                 else (item.destination?.name ?: item.account?.name)
                        "${from ?: "?"} → ${to ?: "?"}"
                    }
                    if (item.note.isNullOrBlank()) flow else "$flow · ${item.note}"
                }
                else -> item.counterparty?.let { "${it.dir ?: ""}${it.name}" } ?: item.account?.name ?: item.date.take(10)
            }
            Text(sub, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(
            // 转账不带正负号（见上方 color 注释）
            (if (isIncome) "+" else if (isExpense) "-" else "") + formatMoney(if (isTransfer) kotlin.math.abs(item.amount) else item.amount),
            style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = color
        )
    }
}

@Composable
fun RecentTransactionRow(tx: Transaction) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(40.dp)) {
            Box(contentAlignment = Alignment.Center) { Text(tx.catIcon ?: "📌", style = MaterialTheme.typography.bodyLarge) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(tx.catName ?: "交易", style = MaterialTheme.typography.bodyLarge)
            Text(tx.date.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(formatMoney(tx.amount), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun LinearProgress(percent: Float, color: Color, modifier: Modifier = Modifier) {
    LinearProgressIndicator(
        progress = { percent.coerceIn(0f, 1f) },
        modifier = modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
        color = color,
        trackColor = MaterialTheme.colorScheme.surfaceVariant
    )
}

@Composable
fun EmptyState(message: String, modifier: Modifier = Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector? = Icons.Filled.ReceiptLong) {
    Column(modifier.fillMaxWidth().padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        icon?.let {
            Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f), modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
        }
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun LoadingBox() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/**
 * 下拉刷新容器：包裹可滚动内容（LazyColumn / LazyRow / Column(scroll)），
 * 顶部居中显示 Material3 风格的刷新指示器。refreshing 传入 VM 的 loading/refreshing 状态。
 */
@OptIn(ExperimentalMaterialApi::class)
@Composable
fun PullRefreshBox(
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.() -> Unit
) {
    val state = rememberPullRefreshState(refreshing, onRefresh)
    Box(modifier.pullRefresh(state), contentAlignment = contentAlignment) {
        content()
        PullRefreshIndicator(refreshing, state, Modifier.align(Alignment.TopCenter))
    }
}

/**
 * 只读下拉选择框。选项为 (显示文本, id) 列表，空列表时展示 emptyHint。
 * 抽到公共组件，供记一笔 / AI 记账 / 账户表单共用。
 */
@Composable
fun DropdownField(
    label: String,
    value: String,
    options: List<Pair<String, Int>>,
    modifier: Modifier = Modifier,
    emptyHint: String? = null,
    onSelected: (Int) -> Unit
) {
    var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    Column(modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = {
                IconButton(onClick = { expanded = true }) {
                    Icon(Icons.Filled.ArrowDropDown, contentDescription = "展开")
                }
            },
            modifier = Modifier.fillMaxWidth().clickable { expanded = true }
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.fillMaxWidth()
        ) {
            if (options.isEmpty()) {
                DropdownMenuItem(
                    text = { Text(emptyHint ?: "暂无选项", color = MaterialTheme.colorScheme.outline) },
                    onClick = { expanded = false }
                )
            } else {
                options.forEach { (name, id) ->
                    DropdownMenuItem(text = { Text(name) }, onClick = { onSelected(id); expanded = false })
                }
            }
        }
    }
}

/** 只读日期输入框，点击弹出 Material3 日期选择器 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DatePickerField(
    label: String,
    date: String,
    modifier: Modifier = Modifier,
    onDateChange: (String) -> Unit
) {
    var show by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    OutlinedTextField(
        value = date,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        singleLine = true,
        trailingIcon = {
            IconButton(onClick = { show = true }) { Icon(Icons.Filled.DateRange, contentDescription = "选择日期") }
        },
        modifier = modifier.fillMaxWidth().clickable { show = true }
    )
    if (show) {
        val pickerState = androidx.compose.material3.rememberDatePickerState(
            initialSelectedDateMillis = parseDateMillis(date) ?: System.currentTimeMillis()
        )
        androidx.compose.material3.DatePickerDialog(
            onDismissRequest = { show = false },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { onDateChange(formatDateMillis(it)) }
                    show = false
                }) { Text("确定") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { show = false }) { Text("取消") }
            }
        ) { androidx.compose.material3.DatePicker(state = pickerState) }
    }
}

private fun parseDateMillis(date: String): Long? = try {
    java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.CHINA).parse(date)?.time
} catch (_: Exception) { null }

private fun formatDateMillis(millis: Long): String {
    val c = java.util.Calendar.getInstance().apply { timeInMillis = millis }
    return String.format(
        java.util.Locale.CHINA, "%04d-%02d-%02d",
        c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH)
    )
}

/**
 * 只读「日期 + 时间（到秒）」输入框，值格式固定为 yyyy-MM-dd HH:mm:ss。
 *
 * 交互：点输入框或日历图标改日期，点时钟图标改时间；时间弹窗里除了 Material3 的
 * 时/分转盘，额外给一个「秒」输入框，满足按秒记账的需求（后端 date 字段本来就是 datetime）。
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DateTimePickerField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    onValueChange: (String) -> Unit
) {
    var showDate by remember { mutableStateOf(false) }
    var showTime by remember { mutableStateOf(false) }
    val parts = remember(value) { parseDateTimeParts(value) }

    OutlinedTextField(
        value = value,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        singleLine = true,
        trailingIcon = {
            Row {
                IconButton(onClick = { showDate = true }) { Icon(Icons.Filled.DateRange, contentDescription = "选择日期") }
                IconButton(onClick = { showTime = true }) { Icon(Icons.Filled.Schedule, contentDescription = "选择时间") }
            }
        },
        modifier = modifier.fillMaxWidth().clickable { showDate = true }
    )

    if (showDate) {
        val pickerState = androidx.compose.material3.rememberDatePickerState(
            initialSelectedDateMillis = utcMidnightMillis(parts[0], parts[1], parts[2])
        )
        androidx.compose.material3.DatePickerDialog(
            onDismissRequest = { showDate = false },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply { timeInMillis = millis }
                        onValueChange(
                            buildDateTime(
                                c.get(java.util.Calendar.YEAR),
                                c.get(java.util.Calendar.MONTH) + 1,
                                c.get(java.util.Calendar.DAY_OF_MONTH),
                                parts[3], parts[4], parts[5]
                            )
                        )
                    }
                    showDate = false
                }) { Text("确定") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showDate = false }) { Text("取消") }
            }
        ) { androidx.compose.material3.DatePicker(state = pickerState) }
    }

    if (showTime) {
        val timeState = androidx.compose.material3.rememberTimePickerState(
            initialHour = parts[3], initialMinute = parts[4], is24Hour = true
        )
        var secText by remember { mutableStateOf(String.format(java.util.Locale.CHINA, "%02d", parts[5])) }
        AlertDialog(
            onDismissRequest = { showTime = false },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    val sec = (secText.toIntOrNull() ?: 0).coerceIn(0, 59)
                    onValueChange(buildDateTime(parts[0], parts[1], parts[2], timeState.hour, timeState.minute, sec))
                    showTime = false
                }) { Text("确定") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showTime = false }) { Text("取消") }
            },
            title = { Text("选择时间") },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    androidx.compose.material3.TimePicker(state = timeState)
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("秒", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.width(10.dp))
                        OutlinedTextField(
                            value = secText,
                            onValueChange = { input -> secText = input.filter { it.isDigit() }.take(2) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.width(96.dp)
                        )
                    }
                }
            }
        )
    }
}

/** 解析 yyyy-MM-dd HH:mm:ss（兼容只有日期的旧值），返回 [年, 月1-12, 日, 时, 分, 秒] */
private fun parseDateTimeParts(value: String): IntArray {
    val text = value.trim()
    val parsed = runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA).apply { isLenient = false }.parse(text)
    }.getOrNull() ?: runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.CHINA).apply { isLenient = false }.parse(text.take(10))
    }.getOrNull()

    val c = java.util.Calendar.getInstance()
    if (parsed != null) c.time = parsed
    return intArrayOf(
        c.get(java.util.Calendar.YEAR),
        c.get(java.util.Calendar.MONTH) + 1,
        c.get(java.util.Calendar.DAY_OF_MONTH),
        c.get(java.util.Calendar.HOUR_OF_DAY),
        c.get(java.util.Calendar.MINUTE),
        c.get(java.util.Calendar.SECOND)
    )
}

private fun buildDateTime(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int): String =
    String.format(java.util.Locale.CHINA, "%04d-%02d-%02d %02d:%02d:%02d", year, month, day, hour, minute, second)

/** DatePicker 用 UTC 零点表示"某一天"，这里按 UTC 构造，避免时区把日期挪一天 */
private fun utcMidnightMillis(year: Int, month: Int, day: Int): Long =
    java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(year, month - 1, day)
    }.timeInMillis

@Composable
fun ErrorState(
    message: String,
    /**
     * 可选副文案：告诉用户「接下来能做什么」。
     *
     * 光有一行 message（多为服务端原文或"数据加载失败"）不足以让人行动 ——
     * 报表页按年失败的真实原因是服务端版本旧，用户看着"数据加载失败"只会
     * 反复切周期。默认为空，不影响其他页面既有呈现。
     *
     * ⚠️ 位置必须在 onRetry / onLogin **之前**。全项目有 9 处调用写成尾随
     * lambda 形式 `ErrorState(msg) { vm.refresh() }`，而尾随 lambda 只会匹配
     * **最后一个**参数 —— 把 hint 放到末尾会让那 9 处全部报
     * 「actual type is Function0<Unit>, but String? was expected」。
     * 给共用组件加参数时，新参数插在函数类型参数前面。
     */
    hint: String? = null,
    onRetry: (() -> Unit)? = null,
    onLogin: (() -> Unit)? = null
) {
    val scope = rememberCoroutineScope()
    val isAuthError = remember(message) {
        message.contains("登录") || message.contains("过期") || message.contains("401") ||
            message.contains("Unauthorized", ignoreCase = true) || message.contains("token", ignoreCase = true)
    }
    val effectiveOnLogin: (() -> Unit)? = onLogin ?: if (isAuthError) {
        {
            scope.launch {
                AppContainer.authRepository.logout()
                AppContainer.authExpired.emit(Unit)
            }
        }
    } else null
    Column(
        Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(Icons.Filled.ErrorOutline, "错误", tint = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center
        )
        if (!hint.isNullOrBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                hint,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                maxLines = 2
            )
        }
        if (effectiveOnLogin != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = effectiveOnLogin) { Text("重新登录") }
        }
        if (onRetry != null) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onRetry) { Text("重试") }
        }
    }
}

/**
 * 顶部账本标题（截图统一样式）：居中"当前账本名 ⇄"，右侧搜索图标。
 * 首页 / 账单 / 统计 三页共用。账本名由 AppContainer 的当前账本状态驱动，自动随切换刷新。
 */
@Composable
fun BookHeader(
    onSwapBook: () -> Unit = {},
    onSearch: () -> Unit = {}
) {
    val books = AppContainer.books.collectAsState().value
    val curId = AppContainer.currentBookId.collectAsState().value
    val bookName = books.find { it.id == curId }?.name?.takeIf { it.isNotBlank() } ?: "默认账本"
    GlassBox(
        Modifier.fillMaxWidth().statusBarsPadding(),
        shape = RoundedCornerShape(0.dp),
        elevated = true
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Row(
                Modifier.clickable(onClick = onSwapBook),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(bookName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(4.dp))
                // 账本切换箭头用暖棕主色强化锚点（与全局暖棕主题统一）
                Text("⇄", style = MaterialTheme.typography.titleMedium, color = Brown500)
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onSearch) {
                Icon(Icons.Filled.Search, contentDescription = "搜索", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * 账本切换底部弹窗：列出全部账本（当前项打勾）、支持新建账本。
 * 选择/新建均通过回调上抛，由调用方调用 AppContainer.switchBook / createBook 并刷新数据。
 */
@Composable
fun BookSwitcherSheet(
    show: Boolean,
    onDismiss: () -> Unit,
    onSelect: (Int) -> Unit,
    onCreate: (String) -> Unit
) {
    if (!show) return
    val books = AppContainer.books.collectAsState().value
    val curId = AppContainer.currentBookId.collectAsState().value
    var newName by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        title = { Text("切换账本") },
        text = {
            Column(Modifier.fillMaxWidth()) {
                LazyColumn(Modifier.fillMaxHeight(0.45f)) {
                    items(books, key = { it.id }) { b ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(b.id) }
                                .padding(vertical = 12.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(b.icon.takeIf { !it.isNullOrBlank() } ?: "📒", Modifier.width(28.dp))
                            Text(
                                b.name,
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = if (b.id == curId) FontWeight.Bold else FontWeight.Normal
                            )
                            if (b.id == curId) Icon(Icons.Filled.Check, "当前", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text("新建账本", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    placeholder = { Text("如：旅行账本") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onDismiss) { Text("取消") }
                Button(
                    onClick = {
                        val name = newName.trim()
                        if (name.isNotBlank()) {
                            onCreate(name)
                            newName = ""
                        }
                    },
                    enabled = newName.trim().isNotBlank()
                ) { Text("创建") }
            }
        }
    )
}

/**
 * 操作 chip：emoji + 文字的方块按钮，用于详情页顶部的操作区（编辑 / 删除 / 计息…）。
 *
 * 原先只存在于 InvestmentDetailScreen 内部（private TxnActionChip）。账户详情页也要
 * 同一排操作入口时提取到这里 —— 详情页操作区必须两端两页长一个样，
 * 各自复制一份必然在下次改动时走形。
 *
 * ⚠️ 详情页的操作入口必须是**可见 chip**，不要退回「藏在长按/⋯里」。
 * 账户列表页踩过这个坑：功能全都实现了，用户依然反馈「没有编辑删除功能」。
 *
 * @param danger true = 用 error 色渲染（删除类破坏性操作），让它在一排 chip 里可区分
 */
@Composable
fun ActionChip(
    emoji: String,
    label: String,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val contentColor = when {
        !enabled -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f)
        danger -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurface
    }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = if (enabled) modifier.clickable(onClick = onClick) else modifier
    ) {
        Column(
            Modifier.padding(12.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(emoji, fontSize = 20.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
