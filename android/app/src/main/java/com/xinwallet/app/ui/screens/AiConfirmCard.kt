package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.AiCandidateTxn
import com.xinwallet.app.data.model.Category
import com.xinwallet.app.ui.viewmodel.AiConfirmState

/* ============================================================
 * AI v0.2 预测确认卡片
 * ------------------------------------------------------------
 * 后端 parse 只产出不可变预测快照，落账必须经过本卡片的「确认入账」。
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

private val FIELD_LABEL = mapOf(
    "amount" to "金额", "type" to "类型", "category" to "分类",
    "date" to "日期", "currency" to "币种", "merchant" to "商户"
)

// 与后端 DECISIVE_FIELDS 对齐；merchant/currency 不参与裁决
private val DECISIVE_FIELDS = listOf("amount", "type", "category", "date")

@Composable
fun AiConfirmCard(
    confirm: AiConfirmState,
    accounts: List<Account>,
    categories: List<Category>,
    onSetType: (Int, String) -> Unit,
    onSetAmount: (Int, Double) -> Unit,
    onSetCategory: (Int, Int?, String?) -> Unit,
    onSetAccount: (Int, Int?) -> Unit,
    onSetTransferAccounts: (Int, Int?, Int?) -> Unit,
    onSetDate: (Int, String) -> Unit,
    onSetNote: (Int, String) -> Unit,
    onRemove: (Int) -> Unit,
    onCommit: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier
) {
    val needsConfirm = confirm.verdict != "ready"

    Card(
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            // ---- 裁决横幅：以后端 verdict 为唯一依据 ----
            val pctText = confirm.overall?.let { "（综合置信度 ${(it * 100).toInt()}%）" } ?: ""
            Box(
                Modifier.fillMaxWidth()
                    .background(if (needsConfirm) WarnAmberBg else OkGreenBg, RoundedCornerShape(10.dp))
                    .border(
                        1.dp,
                        if (needsConfirm) WarnAmber.copy(alpha = 0.5f) else OkGreen.copy(alpha = 0.5f),
                        RoundedCornerShape(10.dp)
                    )
                    .padding(10.dp)
            ) {
                Column {
                    Text(
                        if (needsConfirm) "⚠️ 有字段置信度偏低，请核对后入账$pctText"
                        else "✅ 各字段置信度达标，仍建议核对后入账$pctText",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (needsConfirm) WarnAmber else OkGreen
                    )
                    confirm.reasons.take(4).forEach { r ->
                        Text(
                            "· $r",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (needsConfirm) WarnAmber else OkGreen,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            confirm.items.forEach { item ->
                AiCandidateRow(
                    item = item,
                    confirm = confirm,
                    accounts = accounts,
                    categories = categories,
                    onSetType = onSetType,
                    onSetAmount = onSetAmount,
                    onSetCategory = onSetCategory,
                    onSetAccount = onSetAccount,
                    onSetTransferAccounts = onSetTransferAccounts,
                    onSetDate = onSetDate,
                    onSetNote = onSetNote,
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
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiCandidateRow(
    item: AiCandidateTxn,
    confirm: AiConfirmState,
    accounts: List<Account>,
    categories: List<Category>,
    onSetType: (Int, String) -> Unit,
    onSetAmount: (Int, Double) -> Unit,
    onSetCategory: (Int, Int?, String?) -> Unit,
    onSetAccount: (Int, Int?) -> Unit,
    onSetTransferAccounts: (Int, Int?, Int?) -> Unit,
    onSetDate: (Int, String) -> Unit,
    onSetNote: (Int, String) -> Unit,
    onRemove: (Int) -> Unit
) {
    val isTransfer = item.type == "transfer"
    // 金额用本地草稿：直接双向绑定 Double 会让用户输入中间态（如 "3."）被吞掉
    var amountText by remember(item.seq, item.amount) {
        mutableStateOf(if (item.amount > 0) trimAmount(item.amount) else "")
    }

    Column(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
            .padding(10.dp)
    ) {
        // 行头：序号 + 商户 + 原文 + 移除
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

        // 类型 + 金额
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                FieldLabel("类型", confirm, item.seq, "type")
                PickerField(
                    text = when (item.type) {
                        "income" -> "收入"; "transfer" -> "转账"; else -> "支出"
                    },
                    options = listOf("支出" to "expense", "收入" to "income", "转账" to "transfer"),
                    onPick = { onSetType(item.seq, it) }
                )
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                FieldLabel("金额", confirm, item.seq, "amount")
                OutlinedTextField(
                    value = amountText,
                    onValueChange = { raw ->
                        // 只允许数字与单个小数点，避免脏输入直接进模型
                        val cleaned = raw.filter { it.isDigit() || it == '.' }
                        if (cleaned.count { it == '.' } <= 1) {
                            amountText = cleaned
                            cleaned.toDoubleOrNull()?.let { onSetAmount(item.seq, it) }
                        }
                    },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        Spacer(Modifier.height(6.dp))

        if (isTransfer) {
            // 转账：转出 → 转入（后端用系统「转账」类目，无需选分类）
            FieldLabel("转出 → 转入", confirm, item.seq, null)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    PickerField(
                        text = accounts.firstOrNull { it.id == item.fromAccountId }?.name ?: "选择转出",
                        options = accounts.map { it.name to it.id.toString() },
                        onPick = { onSetTransferAccounts(item.seq, it.toIntOrNull(), item.toAccountId) }
                    )
                }
                Text(" → ", style = MaterialTheme.typography.labelSmall)
                Box(Modifier.weight(1f)) {
                    PickerField(
                        text = accounts.firstOrNull { it.id == item.toAccountId }?.name ?: "选择转入",
                        options = accounts.map { it.name to it.id.toString() },
                        onPick = { onSetTransferAccounts(item.seq, item.fromAccountId, it.toIntOrNull()) }
                    )
                }
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    FieldLabel("账户", confirm, item.seq, null)
                    // 账户来源区分：后端 evidence["account"] 标识了识别路径。
                    // fallback_default / channel_no_match 表示「AI 未从账单中识别出账户，
                    //   用的是客户端传入的默认账户兜底」——此时不应自动填入默认户名，
                    //   否则用户会误以为 AI 从账单里认出了该账户（实际是顶部 chip 的值）。
                    // channel:alipay / channel:wechat 等才是真正的文本命中，可以放心显示。
                    val accSource = item.evidence["account"] ?: ""
                    val isFallback = accSource.startsWith("fallback") || accSource.startsWith("channel_no_match")
                    val displayAccount = if (isFallback && item.accountId != null) {
                        // 兜底场景：显示为"未识别"，让用户主动选
                        null
                    } else {
                        accounts.firstOrNull { it.id == item.accountId }
                    }
                    PickerField(
                        text = displayAccount?.name ?: "选择账户",
                        options = accounts.map { it.name to it.id.toString() },
                        onPick = { onSetAccount(item.seq, it.toIntOrNull()) }
                    )
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    FieldLabel("分类", confirm, item.seq, "category")
                    val catList = categories.filter {
                        it.type == if (item.type == "income") "income" else "expense"
                    }
                    PickerField(
                        text = item.categoryName
                            ?: categories.firstOrNull { it.id == item.categoryId }?.name
                            ?: "未识别",
                        options = catList.map { it.name to it.id.toString() },
                        onPick = { picked ->
                            val id = picked.toIntOrNull()
                            onSetCategory(item.seq, id, catList.firstOrNull { it.id == id }?.name)
                        }
                    )
                }
            }
        }

        Spacer(Modifier.height(6.dp))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                FieldLabel("日期", confirm, item.seq, "date")
                // 日期可编辑：后端只给 yyyy-MM-dd（无时间），用户经常需要修正。
                // 点击弹出 DatePicker，选择后通过 onSetDate 回写候选快照。
                var showDatePicker by remember { mutableStateOf(false) }
                val displayDate = item.date ?: "—"
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clickable { showDatePicker = true }
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Text(
                        displayDate,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                if (showDatePicker) {
                    val initialDate = try {
                        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(item.date ?: "")
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
                        dismissButton = {
                            TextButton(onClick = { showDatePicker = false }) { Text("取消") }
                        }
                    ) {
                        DatePicker(state = datePickerState)
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(2f)) {
                FieldLabel("备注", confirm, item.seq, null)
                OutlinedTextField(
                    value = item.note ?: "",
                    onValueChange = { onSetNote(item.seq, it) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        // 证据链：解释「为什么这么判」
        val evidence = DECISIVE_FIELDS
            .filter { f -> item.evidence[f] != null && item.evidence[f] != "missing" }
            .joinToString("  ·  ") { f -> "${FIELD_LABEL[f]}=${item.evidence[f]}" }
        // 账户识别路径（不在 DECISIVE_FIELDS 中，单独展示以区分「AI 识别」与「默认兜底」）
        val accEvidence = item.evidence["account"]?.takeIf { it != "missing" }
        val accLabel = if (accEvidence != null) {
            val isFallback = accEvidence.startsWith("fallback") || accEvidence.startsWith("channel_no_match")
            if (isFallback) "账户=默认账户(未从账单识别)" else "账户=$accEvidence"
        } else null
        val fullEvidence = listOfNotNull(evidence, accLabel).joinToString("  ·  ")
        if (fullEvidence.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                "识别依据：$fullEvidence",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
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

/** 轻量下拉选择：避免为几个枚举字段引入额外依赖 */
@Composable
private fun PickerField(
    text: String,
    options: List<Pair<String, String>>,
    onPick: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
                .clickable { expanded = true }
                .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            Text("▾", style = MaterialTheme.typography.labelSmall)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (label, value) ->
                DropdownMenuItem(
                    text = { Text(label, style = MaterialTheme.typography.bodySmall) },
                    onClick = { expanded = false; onPick(value) }
                )
            }
        }
    }
}

// 金额显示统一复用 AddTransactionScreen.kt 的 internal trimAmount()：
// 同 package 内不得重名（顶层函数 private 也拦不住冲突），且 AiScanScreen 走的就是它。
