@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.ApiResponse
import com.xinwallet.app.data.model.TransactionItem
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.IncomeColor
import com.xinwallet.app.util.formatMoneySigned
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * 搜索结果页（参考截图设计）：
 * - 顶栏：返回 / 标题 / 筛选按钮（点击弹出 ModalBottomSheet）
 * - 圆角搜索输入框：放大镜 + 占位 + 清除键
 * - 空态卡片：插画 + 提示文案
 * - 筛选条支持：金额范围、日期范围、账本 chip、类型多选 chips
 * - AuthInterceptor 自动注入 X-Book-Id，结果按当前账本隔离
 */
private data class SearchFilter(
    val minAmount: Double? = null,
    val maxAmount: Double? = null,
    val startDate: LocalDate? = null,
    val endDate: LocalDate? = null,
    val types: Set<String> = emptySet(), // income / expense / transfer / debt(预留)
    val bookId: Int? = null // 账本筛选：null = 跟随全局当前账本；具体 id = 临时只看该账本
) {
    val isActive: Boolean
        get() = minAmount != null || maxAmount != null ||
                startDate != null || endDate != null || types.isNotEmpty() || bookId != null
}

@Composable
fun SearchScreen(navController: NavHostController) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<TransactionItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var showFilter by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(SearchFilter()) }
    // 筛选弹层：默认完全展开（skipPartiallyExpanded），不进入半隐藏状态
    val filterSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    // 输入防抖 350ms 后请求；筛选条件变化也触发
    LaunchedEffect(query, filter) {
        if (query.isBlank() && !filter.isActive) {
            results = emptyList(); loading = false; return@LaunchedEffect
        }
        loading = true
        delay(350)
        val list = runCatching {
            val resp = AppContainer.api.getTransactions(
                search = query.takeIf { it.isNotBlank() },
                startDate = filter.startDate?.toString(),
                endDate = filter.endDate?.toString(),
                minAmount = filter.minAmount,
                maxAmount = filter.maxAmount,
                types = filter.types.takeIf { it.isNotEmpty() }?.joinToString(","),
                bookId = filter.bookId,
                limit = 100
            )
            if (resp.isSuccessful) (resp.body() as? ApiResponse<List<TransactionItem>>)?.data.orEmpty()
            else emptyList()
        }.getOrDefault(emptyList())
        results = list
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = { Text("搜索", style = MaterialTheme.typography.titleMedium) },
                actions = {
                    TextButton(onClick = { showFilter = true }) {
                        Text(
                            "筛选",
                            color = if (filter.isActive) Brown500 else MaterialTheme.colorScheme.onSurface,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            Icons.Outlined.FilterAlt,
                            contentDescription = null,
                            tint = if (filter.isActive) Brown500 else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            SearchInputRow(
                query = query,
                onQueryChange = { query = it },
                onClear = { query = "" },
                focusRequester = focusRequester
            )
            when {
                query.isBlank() && !filter.isActive -> EmptyState()
                loading && results.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }
                results.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text("暂无匹配结果", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(results, key = { it.id }) { tx ->
                        SearchTxRow(tx) {
                            // 折叠转账必须走 EditTransfer（PUT /transfers/{id}）：
                            // tx.id 只是 transfer_out 那条腿的 id，拿它调 transactions/{id}
                            // 只会改一条腿，两个账户余额会永久对不上。
                            // transferId 有但 transfer 为 null（账户被删的残留）无法回填双端，不给编辑。
                            val tf = tx.transfer
                            when {
                                tf != null -> navController.navigate(Screen.EditTransfer.create(tf.id))
                                tx.transferId != null -> Unit
                                else -> navController.navigate(Screen.EditTransaction.create(tx.id))
                            }
                        }
                    }
                }
            }
        }
    }

    if (showFilter) {
        ModalBottomSheet(
            onDismissRequest = { showFilter = false },
            sheetState = filterSheetState,
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            FilterSheetContent(
                initial = filter,
                onApply = { newFilter ->
                    filter = newFilter
                    showFilter = false
                },
                onReset = {
                    filter = SearchFilter()
                    showFilter = false
                }
            )
        }
    }
}

/* ===================== 搜索输入 ===================== */

@Composable
private fun SearchInputRow(
    query: String,
    onQueryChange: (String) -> Unit,
    onClear: () -> Unit,
    focusRequester: FocusRequester
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = {
            Text(
                "输入关键词搜索账单",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        leadingIcon = {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = onClear) {
                    Icon(
                        Icons.Filled.Clear,
                        contentDescription = "清除",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else null,
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .focusRequester(focusRequester),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface
        )
    )
}

/* ===================== 空态卡片 ===================== */

@Composable
private fun EmptyState() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(vertical = 80.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // 装饰图标：放大镜叠在卡片/账单图标上，模拟截图中的放大镜找单据插画
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.ReceiptLong,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(72.dp)
                )
                Icon(
                    Icons.Filled.Search,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.outline,
                    modifier = Modifier
                        .size(36.dp)
                        .offset(x = 12.dp, y = 12.dp)
                )
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "请输入关键词进行搜索~",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

/* ===================== 结果行 ===================== */

@Composable
private fun SearchTxRow(tx: TransactionItem, onClick: () -> Unit) {
    val title = tx.note?.takeIf { it.isNotBlank() }
        ?: tx.category?.name?.takeIf { it.isNotBlank() }
        ?: "交易"
    val subtitle = buildString {
        tx.account?.name?.takeIf { it.isNotBlank() }?.let { append(it) }
        if (tx.date.isNotBlank()) {
            if (isNotEmpty()) append(" · ")
            append(tx.date)
        }
    }
    val amountColor = when (tx.type) {
        "expense" -> ExpenseColor
        "income" -> IncomeColor
        else -> MaterialTheme.colorScheme.onSurface
    }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            tx.category?.icon?.takeIf { it.isNotBlank() } ?: "💸",
            Modifier.width(28.dp),
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            if (subtitle.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        // 多币种 P2-3c：搜索结果每行带币种（后端 transactions.js 列表已 SELECT 透出 currency）
        Text(formatMoneySigned(tx.amount, tx.currency), style = MaterialTheme.typography.bodyLarge, color = amountColor)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
}

/* ===================== 筛选底部弹层 ===================== */

@Composable
private fun FilterSheetContent(
    initial: SearchFilter,
    onApply: (SearchFilter) -> Unit,
    onReset: () -> Unit
) {
    var minAmountText by remember { mutableStateOf(initial.minAmount?.toString().orEmpty()) }
    var maxAmountText by remember { mutableStateOf(initial.maxAmount?.toString().orEmpty()) }
    var startDate by remember { mutableStateOf(initial.startDate) }
    var endDate by remember { mutableStateOf(initial.endDate) }
    var types by remember { mutableStateOf(initial.types) }
    var bookId by remember { mutableStateOf(initial.bookId) }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 12.dp)
    ) {
        // 标题 + 重置
        Row(
            Modifier.fillMaxWidth().padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "高级筛选",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f)
            )
            TextButton(onClick = {
                minAmountText = ""
                maxAmountText = ""
                startDate = null
                endDate = null
                types = emptySet()
                bookId = null
            }) {
                Text("重置", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        // 金额
        FilterSectionLabel("金额")
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            NumberField(
                value = minAmountText,
                onValueChange = { minAmountText = it.filter { c -> c.isDigit() || c == '.' } },
                placeholder = "最低金额",
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(12.dp))
            Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            NumberField(
                value = maxAmountText,
                onValueChange = { maxAmountText = it.filter { c -> c.isDigit() || c == '.' } },
                placeholder = "最高金额",
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(Modifier.height(16.dp))

        // 日期
        FilterSectionLabel("日期")
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            DateField(
                value = startDate,
                onChange = { startDate = it },
                placeholder = "起始日期",
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(12.dp))
            Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            DateField(
                value = endDate,
                onChange = { endDate = it },
                placeholder = "结束日期",
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(Modifier.height(16.dp))

        // 账本：选中具体账本时本次搜索只看该账本；默认「当前账本」= 跟随全局账本切换
        FilterSectionLabel("账本")
        val books = AppContainer.books.collectAsState().value
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            TypeChip(
                label = "当前账本",
                selected = bookId == null,
                onClick = { bookId = null }
            )
            books.forEach { b ->
                TypeChip(
                    label = b.name,
                    selected = bookId == b.id,
                    onClick = { bookId = b.id }
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // 类型（多选）
        FilterSectionLabel("类型")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TypeChip(
                label = "收入",
                selected = "income" in types,
                onClick = { types = types.toggle("income") }
            )
            TypeChip(
                label = "支出",
                selected = "expense" in types,
                onClick = { types = types.toggle("expense") }
            )
            TypeChip(
                label = "转账",
                selected = "transfer" in types,
                onClick = { types = types.toggle("transfer") }
            )
            TypeChip(
                label = "借贷",
                selected = "debt" in types,
                onClick = { types = types.toggle("debt") }
            )
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = {
                onApply(
                    SearchFilter(
                        minAmount = minAmountText.toDoubleOrNull(),
                        maxAmount = maxAmountText.toDoubleOrNull(),
                        startDate = startDate,
                        endDate = endDate,
                        types = types,
                        bookId = bookId
                    )
                )
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(24.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Brown500,
                contentColor = Color.White
            )
        ) {
            Text("应用筛选", style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(16.dp))
    }
}

private fun Set<String>.toggle(key: String): Set<String> =
    if (key in this) this - key else this + key

/* ===================== 筛选子组件 ===================== */

@Composable
private fun FilterSectionLabel(text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(bottom = 8.dp)
    ) {
        Box(
            Modifier
                .width(3.dp)
                .height(14.dp)
                .background(Brown500, RoundedCornerShape(2.dp))
        )
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun TypeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) Brown500 else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 8.dp)
    ) {
        Text(label, color = fg, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun NumberField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = {
            Text(
                placeholder,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Decimal,
            imeAction = ImeAction.Next
        ),
        shape = RoundedCornerShape(20.dp),
        modifier = modifier,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    )
}

@Composable
private fun DateField(
    value: LocalDate?,
    onChange: (LocalDate?) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier
) {
    var open by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable { open = true }
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Text(
            text = value?.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")) ?: placeholder,
            color = if (value != null) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
    }
    if (open) {
        val initial = value ?: LocalDate.now()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = initial.toEpochDay() * 86400000L
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        onChange(LocalDate.ofEpochDay(ms / 86400000L))
                    }
                    open = false
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { open = false }) { Text("取消") }
            }
        ) {
            DatePicker(state = state)
        }
    }
}