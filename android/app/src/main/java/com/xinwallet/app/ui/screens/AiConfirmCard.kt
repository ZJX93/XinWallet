package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.AiCandidateTxn
import com.xinwallet.app.data.model.Book
import com.xinwallet.app.data.model.Category
import com.xinwallet.app.ui.components.accountTypeLabel
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.viewmodel.AiConfirmState
import com.xinwallet.app.util.formatMoney

/* ============================================================
 * AI v0.2 预测确认卡片（chip 化重构）
 * ------------------------------------------------------------
 * 与手动记账 chip 栏对齐：
 *   - 每行候选单据下方有两行 chip：分类/账户/转出/转入 + 日期/时间/备注
 *   - 类型切换做成横排 3 chip（支出/收入/转账）
 *   - chip 文本实时反映 item 当前值；点 chip 展开底部弹层 / DatePicker / TimePicker / 备注对话框
 *   - 后端 commitPrediction 仅消费 type/amount/category_id/account_id/transfer/date/note，
 *     因此账本/标签/预算/地点不在 chip 栏中显示（落账通道不支持，做 UI 也是装饰）
 *
 * 关键设计约束（对齐 server/modules/ai/validation/result-validator.js）：
 *   1. 是否需要确认由后端 verdict 决定，本组件【不】拿 overall 与阈值比较；
 *      字段级红标同样取后端 validation.per_txn[].per_field。
 *   2. 用户改动过的字段由 ViewModel 标记 user_corrected 并把置信度提到 1.0。
 * ============================================================ */

private val OkGreen = Color(0xFF1B7F4B)
private val OkGreenBg = Color(0xFFE7F5EC)
private val WarnAmber = Color(0xFF9A6300)
private val WarnAmberBg = Color(0xFFFDF3E0)
private val DisabledGray = Color(0xFF9E9E9E)

/** 时间正则，与 ChatViewModel.TIME_IN_DATE 保持一致 */
private val TIME_IN_DATE = Regex("""\d{2}:\d{2}(:\d{2})?""")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiConfirmCard(
    confirm: AiConfirmState,
    accounts: List<Account>,
    categories: List<Category>,
    /** 账本列表 + 当前账本 id：卡片级账本 chip 用（与手动记账一致） */
    books: List<Book>,
    currentBookId: Int,
    onPickBook: (Int) -> Unit,
    onSetType: (Int, String) -> Unit,
    onSetAmount: (Int, Double) -> Unit,
    onSetCategory: (Int, Int?, String?) -> Unit,
    onSetAccount: (Int, Int?) -> Unit,
    onSetTransferAccounts: (Int, Int?, Int?) -> Unit,
    onSetDate: (Int, String) -> Unit,
    /** 新增：单独改时间（HH:mm:ss）。与 setCandidateDate 不冲突，前者替换日期部分、保留时间；后者替换时间部分、保留日期 */
    onSetTime: (Int, String) -> Unit,
    onSetNote: (Int, String) -> Unit,
    /** 地点：写入 transactions.location（对齐手动记账）；空串清空 */
    onSetLocation: (Int, String?) -> Unit,
    /** 一键 GPS 定位：由调用方处理权限后回调 ViewModel.requestGpsForSeq */
    onRequestGps: (Int) -> Unit,
    /** GPS 定位进行中标记，用于禁用地点 chip 并显示「定位中…」 */
    isLocating: Boolean = false,
    onRemove: (Int) -> Unit,
    onCommit: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showBookSheet by remember { mutableStateOf(false) }

    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            // ---- 账本 chip（卡片级，整批共用一个账本；切账本走全局 switchBook）----
            val currentBook = books.firstOrNull { it.id == currentBookId }
            AiQuickChip(
                icon = Icons.Filled.MenuBook,
                label = currentBook?.name ?: "选择账本",
                active = currentBook != null,
                onClick = { showBookSheet = true },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(10.dp))

            confirm.items.forEach { item ->
                AiCandidateRow(
                    item = item,
                    confirm = confirm,
                    accounts = accounts,
                    categories = categories,
                    isLocating = isLocating,
                    onSetType = onSetType,
                    onSetAmount = onSetAmount,
                    onSetCategory = onSetCategory,
                    onSetAccount = onSetAccount,
                    onSetTransferAccounts = onSetTransferAccounts,
                    onSetDate = onSetDate,
                    onSetTime = onSetTime,
                    onSetNote = onSetNote,
                    onSetLocation = onSetLocation,
                    onRequestGps = onRequestGps,
                    onRemove = onRemove
                )
                Spacer(Modifier.height(8.dp))
            }

            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = onCommit,
                    enabled = !confirm.committing,
                    modifier = Modifier.weight(1f)
                ) {
                    if (confirm.committing) {
                        CircularProgressIndicator(Modifier.width(16.dp).height(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("提交中…")
                    } else {
                        Text(
                            if (confirm.isDirty) "✅ 按修正后入账（${confirm.items.size} 笔）"
                            else "✅ 确认入账（${confirm.items.size} 笔）"
                        )
                    }
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onDiscard, enabled = !confirm.committing) { Text("弃置") }
            }
        }
    }

    // —— 账本选择弹层（卡片级，整批共用）——
    if (showBookSheet) {
        ModalBottomSheet(
            onDismissRequest = { showBookSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(
                    "选择账本",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                books.forEach { book ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { onPickBook(book.id); showBookSheet = false }
                            .padding(vertical = 12.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(book.icon.ifBlank { "📒" }, fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(book.name, style = MaterialTheme.typography.bodyLarge)
                            if (book.isDefault) Text("默认账本", style = MaterialTheme.typography.labelSmall, color = Brown500)
                        }
                        if (currentBookId == book.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiCandidateRow(
    item: AiCandidateTxn,
    confirm: AiConfirmState,
    accounts: List<Account>,
    categories: List<Category>,
    isLocating: Boolean = false,
    onSetType: (Int, String) -> Unit,
    onSetAmount: (Int, Double) -> Unit,
    onSetCategory: (Int, Int?, String?) -> Unit,
    onSetAccount: (Int, Int?) -> Unit,
    onSetTransferAccounts: (Int, Int?, Int?) -> Unit,
    onSetDate: (Int, String) -> Unit,
    onSetTime: (Int, String) -> Unit,
    onSetNote: (Int, String) -> Unit,
    onSetLocation: (Int, String?) -> Unit,
    onRequestGps: (Int) -> Unit,
    onRemove: (Int) -> Unit
) {
    val isTransfer = item.type == "transfer"
    // 金额用本地草稿：直接双向绑定 Double 会让用户输入中间态（如 "3."）被吞掉
    var amountText by remember(item.seq, item.amount) {
        mutableStateOf(if (item.amount > 0) trimAmount(item.amount) else "")
    }

    // 弹层 / 对话框开关
    var showCategorySheet by remember { mutableStateOf(false) }
    var showAccountSheet by remember { mutableStateOf(false) }       // 普通: 选 account
    var showFromAccountSheet by remember { mutableStateOf(false) }   // 转账: 选 from
    var showToAccountSheet by remember { mutableStateOf(false) }     // 转账: 选 to
    var showDatePicker by remember { mutableStateOf(false) }
    var showTimePicker by remember { mutableStateOf(false) }
    var showNoteDialog by remember { mutableStateOf(false) }
    var noteDraft by remember(item.seq, item.note) { mutableStateOf(item.note ?: "") }
    var showLocationDialog by remember { mutableStateOf(false) }
    var locationDraft by remember(item.seq, item.location) { mutableStateOf(item.location ?: "") }

    // 当前显示的日期（yyyy-MM-dd）与时间（HH:mm:ss）
    val currentDate = item.date?.take(10) ?: "—"
    val currentTime = item.date?.let { TIME_IN_DATE.find(it)?.value }.orEmpty()
    // 后端在时间缺失时会回退占位 "00:00:00"，这并非真实时刻，应视为「未识别时间」
    val hasRealTime = currentTime.isNotEmpty() && currentTime != "00:00:00"

    Column(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
            .padding(10.dp)
    ) {
        // —— 行头：序号 + 商户 + 原文 + 移除 ——
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "第 ${item.seq} 笔",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            item.merchant?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.width(6.dp))
                Text(it, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            item.rawSegment?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.width(6.dp))
                Text(
                    "「$it」",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { onRemove(item.seq) }) { Text("移除", style = MaterialTheme.typography.labelSmall) }
        }

        // —— 金额（大字 + 数字键盘式输入）+ 类型 3 chip（支出 / 收入 / 转账） ——
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1.3f)) {
                FieldLabel("金额", confirm, item.seq, "amount")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "¥",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(end = 4.dp)
                    )
                    BasicTextField(
                        value = amountText,
                        onValueChange = { raw ->
                            val cleaned = raw.filter { it.isDigit() || it == '.' }
                            if (cleaned.count { it == '.' } <= 1) {
                                amountText = cleaned
                                cleaned.toDoubleOrNull()?.let { onSetAmount(item.seq, it) }
                            }
                        },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.titleMedium.copy(
                            fontSize = 16.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(36.dp)
                            .border(1.dp, Brown100, RoundedCornerShape(8.dp))
                            .padding(horizontal = 12.dp),
                        decorationBox = { innerTextField ->
                            Box(
                                Modifier.fillMaxSize(),
                                contentAlignment = Alignment.CenterStart
                            ) {
                                if (amountText.isEmpty()) {
                                    Text(
                                        "0.00",
                                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 16.sp),
                                        color = MaterialTheme.colorScheme.outline
                                    )
                                } else {
                                    innerTextField()
                                }
                            }
                        }
                    )
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1.7f)) {
                FieldLabel("类型", confirm, item.seq, "type")
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf(
                        "expense" to "支出",
                        "income" to "收入",
                        "transfer" to "转账"
                    ).forEach { (key, label) ->
                        val on = item.type == key
                        Box(
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(50))
                                .background(if (on) Brown500 else Brown50)
                                .border(1.dp, if (on) Brown500 else Brown100, RoundedCornerShape(50))
                                .clickable { onSetType(item.seq, key) }
                                .padding(vertical = 7.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                label,
                                style = MaterialTheme.typography.labelMedium,
                                color = if (on) Color.White else MaterialTheme.colorScheme.onSurface,
                                maxLines = 1
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // —— chip 行1：账户 / 分类（转账：转出 → 转入 / 分类）——
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (isTransfer) {
                val fromAcc = accounts.firstOrNull { it.id == item.fromAccountId }
                AiQuickChip(
                    icon = Icons.Filled.AccountBox,
                    label = fromAcc?.name ?: "选择转出",
                    active = fromAcc != null,
                    onClick = { showFromAccountSheet = true },
                    modifier = Modifier.weight(1.3f),
                    maxLines = 1
                )
                Text(
                    "→",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                val toAcc = accounts.firstOrNull { it.id == item.toAccountId }
                AiQuickChip(
                    icon = Icons.Filled.SwapHoriz,
                    label = toAcc?.name ?: "选择转入",
                    active = toAcc != null,
                    onClick = { showToAccountSheet = true },
                    modifier = Modifier.weight(1.3f),
                    maxLines = 1
                )
            } else {
                // 兜底账户（AI 未从账单识别）：用 chip 高亮"未识别"状态，强制用户选择
                val accSource = item.evidence["account"] ?: ""
                val isFallback = accSource.startsWith("fallback") || accSource.startsWith("channel_no_match")
                val acc = if (isFallback) null else accounts.firstOrNull { it.id == item.accountId }
                AiQuickChip(
                    icon = Icons.Filled.AccountBox,
                    label = acc?.name ?: "选择账户",
                    active = acc != null,
                    onClick = { showAccountSheet = true },
                    modifier = Modifier.weight(1.5f),
                    maxLines = 1
                )
            }
            val catLabel = item.categoryName
                ?: categories.firstOrNull { it.id == item.categoryId }?.name
                ?: "选择分类"
            AiQuickChip(
                icon = Icons.Filled.LocalOffer,
                label = catLabel,
                active = item.categoryId != null,
                onClick = { showCategorySheet = true },
                modifier = Modifier.weight(1f),
                maxLines = 1
            )
        }

        Spacer(Modifier.height(6.dp))

        // —— chip 行2：日期 / 时间 ——
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AiQuickChip(
                icon = Icons.Filled.CalendarToday,
                label = currentDate,
                active = item.date != null,
                onClick = { showDatePicker = true },
                modifier = Modifier.weight(1.5f),
                maxLines = 1
            )
            AiQuickChip(
                icon = Icons.Filled.Schedule,
                label = if (hasRealTime) currentTime.take(8) else "时间",
                active = hasRealTime,
                onClick = { showTimePicker = true },
                modifier = Modifier.weight(1f),
                maxLines = 1
            )
        }

        Spacer(Modifier.height(6.dp))

        // —— chip 行3：备注 / 地点（允许 2 行，尽量完整显示）——
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AiQuickChip(
                icon = Icons.Filled.Edit,
                label = if (item.note.isNullOrBlank()) "添加备注" else item.note!!,
                active = !item.note.isNullOrBlank(),
                onClick = {
                    noteDraft = item.note ?: ""
                    showNoteDialog = true
                },
                modifier = Modifier.weight(1.5f),
                maxLines = 2
            )
            AiQuickChip(
                icon = Icons.Filled.LocationOn,
                label = if (item.location.isNullOrBlank()) "地点" else item.location!!,
                active = !item.location.isNullOrBlank(),
                onClick = {
                    locationDraft = item.location ?: ""
                    showLocationDialog = true
                },
                modifier = Modifier.weight(1f),
                maxLines = 2
            )
        }
    }

    // ============== 弹层 / 对话框区 ==============

    if (showCategorySheet) {
        AiCategorySheet(
            title = "选择分类",
            categories = categories,
            type = if (item.type == "income") "income" else "expense",
            currentId = item.categoryId,
            onDismiss = { showCategorySheet = false },
            onPick = { id, name -> onSetCategory(item.seq, id, name); showCategorySheet = false }
        )
    }

    if (showAccountSheet) {
        AiAccountSheet(
            title = "选择账户",
            accounts = accounts,
            currentId = item.accountId,
            onDismiss = { showAccountSheet = false },
            onPick = { id ->
                onSetAccount(item.seq, id)
                showAccountSheet = false
            }
        )
    }
    if (showFromAccountSheet) {
        AiAccountSheet(
            title = "选择转出账户",
            accounts = accounts,
            currentId = item.fromAccountId,
            excludedId = item.toAccountId,
            onDismiss = { showFromAccountSheet = false },
            onPick = { id ->
                onSetTransferAccounts(item.seq, id, item.toAccountId)
                showFromAccountSheet = false
            }
        )
    }
    if (showToAccountSheet) {
        AiAccountSheet(
            title = "选择转入账户",
            accounts = accounts,
            currentId = item.toAccountId,
            excludedId = item.fromAccountId,
            onDismiss = { showToAccountSheet = false },
            onPick = { id ->
                onSetTransferAccounts(item.seq, item.fromAccountId, id)
                showToAccountSheet = false
            }
        )
    }

    if (showDatePicker) {
        val initialDate = try {
            SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(currentDate)
        } catch (_: Exception) { null } ?: Date()
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = initialDate.time)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        val formatted = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                            .format(Date(millis))
                        onSetDate(item.seq, formatted)
                    }
                    showDatePicker = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("取消") } }
        ) {
            DatePicker(state = datePickerState)
        }
    }

    if (showTimePicker) {
        val parts = currentTime.split(":").mapNotNull { it.toIntOrNull() }
        val hour = parts.getOrNull(0) ?: 0
        val minute = parts.getOrNull(1) ?: 0
        val second = parts.getOrNull(2) ?: 0
        val timePickerState = rememberTimePickerState(initialHour = hour, initialMinute = minute, is24Hour = true)
        var seconds by remember { mutableStateOf(second) }
        AlertDialog(
            onDismissRequest = { showTimePicker = false },
            title = { Text("选择时间（到秒）") },
            text = {
                Column {
                    TimePicker(state = timePickerState)
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("秒：", style = MaterialTheme.typography.bodyLarge)
                        LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(60) { s ->
                                val on = seconds == s
                                Box(
                                    Modifier
                                        .clip(RoundedCornerShape(50))
                                        .background(if (on) Brown500 else Brown50)
                                        .clickable { seconds = s }
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "%02d".format(s),
                                        color = if (on) Color.White else MaterialTheme.colorScheme.onSurface,
                                        style = MaterialTheme.typography.labelMedium
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val formatted = "%02d:%02d:%02d".format(timePickerState.hour, timePickerState.minute, seconds)
                    onSetTime(item.seq, formatted)
                    showTimePicker = false
                }) { Text("确定") }
            },
            dismissButton = { TextButton(onClick = { showTimePicker = false }) { Text("取消") } }
        )
    }

    if (showNoteDialog) {
        AlertDialog(
            onDismissRequest = { showNoteDialog = false },
            title = { Text("备注") },
            text = {
                OutlinedTextField(
                    value = noteDraft,
                    onValueChange = { noteDraft = it },
                    singleLine = false,
                    maxLines = 3,
                    placeholder = { Text("最多 30 个字符") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onSetNote(item.seq, noteDraft.take(30))
                    showNoteDialog = false
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showNoteDialog = false }) { Text("取消") } }
        )
    }

    // —— 地点对话框：文本输入 + 一键 GPS 定位（写入 transactions.location）——
    if (showLocationDialog) {
        AlertDialog(
            onDismissRequest = { showLocationDialog = false },
            title = { Text("地点") },
            text = {
                Column {
                    OutlinedTextField(
                        value = locationDraft,
                        onValueChange = { locationDraft = it },
                        singleLine = true,
                        maxLines = 1,
                        placeholder = { Text("输入地点，或一键定位") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { onRequestGps(item.seq) },
                        enabled = !isLocating,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (isLocating) {
                            CircularProgressIndicator(Modifier.width(14.dp).height(14.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Filled.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp))
                        }
                        Spacer(Modifier.width(6.dp))
                        Text(if (isLocating) "定位中…" else "📍 使用当前位置")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    onSetLocation(item.seq, locationDraft.takeIf { it.isNotBlank() })
                    showLocationDialog = false
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showLocationDialog = false }) { Text("取消") } }
        )
    }
}

/** 字段标签 + 置信度徽标；数据源为后端 validation，本组件不做阈值判断 */
@Composable
private fun FieldLabel(text: String, confirm: AiConfirmState, seq: Int, field: String?) {
    val fv = field?.let { confirm.fieldVerdict(seq, it) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (fv != null) {
            Spacer(Modifier.width(4.dp))
            val score = (fv.score * 100).toInt()
            Text(
                "$score%",
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = if (fv.ok) OkGreen else WarnAmber,
                modifier = Modifier
                    .background(if (fv.ok) OkGreenBg else WarnAmberBg, RoundedCornerShape(6.dp))
                    .padding(horizontal = 4.dp, vertical = 1.dp)
            )
        }
    }
}

/**
 * AI 卡片专用 chip：与 AddTransactionScreen.QuickChip 视觉一致（Brown50/Brown500 风格），
 * 但本组件走的是 internal modifier 以兼容跨文件调用 —— 这里重写一个独立副本保证本文件可编译。
 */
@Composable
private fun AiQuickChip(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    onClick: (() -> Unit)? = null,
    tintIcon: Color? = null,
    modifier: Modifier = Modifier,
    maxLines: Int = 1
) {
    val mod = if (onClick != null) modifier.clickable { onClick() } else modifier
    val bg = if (active) Brown500 else Brown50
    val border = if (active) Brown500 else Brown100
    val fg = if (active) Color.White else MaterialTheme.colorScheme.onSurface
    val iconColor = when {
        active -> Color.White
        tintIcon != null -> tintIcon
        else -> Brown500
    }
    Row(
        modifier = mod
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(13.dp), tint = iconColor)
        Spacer(Modifier.width(3.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = fg,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 通用选项弹层（分类等） */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiOptionSheet(
    title: String,
    options: List<Pair<String, String>>,
    currentValue: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            if (options.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "暂无可选项",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                options.forEach { (label, value) ->
                    val on = value == currentValue
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { onPick(value) }
                            .padding(vertical = 12.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        if (on) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** 账户类型展示顺序，与账户管理页保持一致 */
private val AI_ACCOUNT_TYPE_ORDER = listOf(
    "cash", "bank_card", "credit_card", "electronic_payment",
    "financial_account", "digital", "other"
)

/** 账户选择弹层：图标 + 名称 + 余额；按类型分组；与转账另一端互斥 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiAccountSheet(
    title: String,
    accounts: List<Account>,
    currentId: Int?,
    excludedId: Int? = null,
    onDismiss: () -> Unit,
    onPick: (Int?) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            if (accounts.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "暂无账户",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                // 按账户类型分组，便于查找（与账户管理页一致）
                AI_ACCOUNT_TYPE_ORDER.forEach { type ->
                    val list = accounts.filter { it.type == type }
                    if (list.isEmpty()) return@forEach
                    Text(
                        "${accountTypeLabel(type)}（${list.size}）",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp, top = 16.dp, bottom = 4.dp)
                    )
                    list.forEach { acc ->
                        val disabled = excludedId != null && acc.id == excludedId
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable(enabled = !disabled) { onPick(acc.id) }
                                .padding(vertical = 12.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                acc.icon ?: "💰",
                                fontSize = 22.sp,
                                modifier = Modifier.padding(end = 12.dp)
                            )
                            Column(Modifier.weight(1f)) {
                                Text(acc.name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    "余额 ${formatMoney(acc.balance)}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (currentId == acc.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                            if (disabled) Text(
                                "（与对端相同）",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** 分类选择弹层：按父级/子级分级显示，便于查找；父级和子级都可点选 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiCategorySheet(
    title: String,
    categories: List<Category>,
    type: String,
    currentId: Int?,
    onDismiss: () -> Unit,
    onPick: (Int, String?) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            val filtered = remember(categories, type) { categories.filter { it.type == type } }
            val roots = remember(filtered) { filtered.filter { it.parentId == null } }
            val childrenMap = remember(filtered) { filtered.filter { it.parentId != null }.groupBy { it.parentId } }
            val orphanParents = remember(filtered) {
                filtered.filter { it.parentId != null }.mapNotNull { it.parentId }.toSet() -
                    roots.map { it.id }.toSet()
            }
            if (filtered.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "暂无可选项",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                roots.forEach { root ->
                    AiCategoryOptionRow(
                        cat = root,
                        currentId = currentId,
                        isChild = false,
                        onClick = { onPick(root.id, root.name) }
                    )
                    childrenMap[root.id]?.forEach { child ->
                        AiCategoryOptionRow(
                            cat = child,
                            currentId = currentId,
                            isChild = true,
                            onClick = { onPick(child.id, child.name) }
                        )
                    }
                }
                // 父级不在可见列表中的孤立子分类，也平级显示出来避免找不到
                orphanParents.forEach { parentId ->
                    childrenMap[parentId]?.forEach { child ->
                        AiCategoryOptionRow(
                            cat = child,
                            currentId = currentId,
                            isChild = true,
                            onClick = { onPick(child.id, child.name) }
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun AiCategoryOptionRow(
    cat: Category,
    currentId: Int?,
    isChild: Boolean,
    onClick: () -> Unit
) {
    val on = currentId == cat.id
    Row(
        Modifier.fillMaxWidth()
            .clickable { onClick() }
            .padding(
                start = if (isChild) 28.dp else 4.dp,
                end = 4.dp,
                top = if (isChild) 8.dp else 12.dp,
                bottom = if (isChild) 8.dp else 12.dp
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            cat.icon?.ifBlank { "📌" } ?: "📌",
            fontSize = if (isChild) 18.sp else 20.sp,
            modifier = Modifier.padding(end = 12.dp)
        )
        Text(
            cat.name,
            style = if (isChild) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
            color = if (isChild) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.85f) else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        if (on) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
}

// 金额显示统一复用 AddTransactionScreen.kt 的 internal trimAmount()：
// 同 package 内不得重名（顶层函数 private 也拦不住冲突），且 AiScanScreen 走的就是它。
