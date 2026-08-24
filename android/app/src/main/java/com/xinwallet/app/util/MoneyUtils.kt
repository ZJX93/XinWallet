package com.xinwallet.app.util

import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

fun formatMoney(value: Double): String {
    val df = DecimalFormat("#,##0.00")
    // 负数标准格式：-¥X.XX（负号在货币符号前），例如 -74.14 → "-¥74.14"
    return (if (value < 0) "-" else "") + "¥" + df.format(kotlin.math.abs(value))
}

fun formatMoneySigned(value: Double): String {
    val sign = if (value >= 0) "+" else "-"
    return sign + formatMoney(kotlin.math.abs(value))
}

/**
 * 金额短格式（与鸿蒙 theme.ts#fmtMoneyShort 严格同语义）：
 *   <1 万   → ¥19,023.00   完整保留分
 *   ≥1 万   → ¥1.90万
 *   ≥1 亿   → ¥1.23亿
 *
 * ⚠️ 分档而非一刀切缩写：日常单天金额几乎都在 1 万以下，这部分零精度损失；
 * 只有大额日才缩写，而那恰好就是宽度最紧张的时候。
 * 若统一缩写，¥50.00 会变成 ¥0.01万 —— 为 1% 的场景牺牲 99%。
 *
 * 用于「一行里并排多项金额」的场景（日期 + 收 + 支 + 结余）。
 * 单独展示一个金额的地方（详情、大卡主数值）仍用 formatMoney，不要缩。
 */
fun formatMoneyShort(value: Double): String {
    val a = kotlin.math.abs(value)
    val sign = if (value < 0) "-" else ""
    return when {
        a >= 100_000_000 -> sign + "¥" + String.format("%.2f", a / 100_000_000) + "亿"
        a >= 10_000 -> sign + "¥" + String.format("%.2f", a / 10_000) + "万"
        else -> formatMoney(value)
    }
}

/**
 * 日期标签紧凑化（与鸿蒙 theme.ts#fmtDayLabel 严格同语义）：
 *   '2026-08-28' → '8月28日'
 *   '2026-08'    → '2026年8月'
 *
 * ⚠️ 不是单纯为省宽度妥协，而是去掉真正冗余的信息：
 * 这个标签出现在「月份导航已写明 2026年8月」的上下文里，
 * 再重复一次年份等于用 4 个字符表达 0 比特信息。
 *
 * 但传 'YYYY-MM'（按年查看时的月分组）时必须保留年份 ——
 * 跨年数据里只写「8月」真的有歧义。
 */
fun formatDayLabel(d: String): String {
    val p = (d.ifBlank { "" }).split("-")
    return when {
        p.size >= 3 -> "${p[1].toIntOrNull() ?: p[1]}月${p[2].take(2).toIntOrNull() ?: p[2]}日"
        p.size == 2 -> "${p[0]}年${p[1].toIntOrNull() ?: p[1]}月"
        else -> d
    }
}

fun currentMonth(): String {
    val c = Calendar.getInstance()
    return String.format("%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1)
}

fun todayDateTime(): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(Date())
}

fun todayDate(): String {
    return SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date())
}
