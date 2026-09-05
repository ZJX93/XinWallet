package com.xinwallet.app.util

import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// 多币种 P2-2e：货币符号表（与 public/js/utils.js#_currencySymbol 严格同语义）
// 鸿蒙 theme.ts 也引用本表，保证三端展示一致
private val CURRENCY_SYMBOLS = mapOf(
    "CNY" to "¥", "USD" to "$", "EUR" to "€", "HKD" to "HK$",
    "JPY" to "¥", "GBP" to "£", "AUD" to "A$", "CAD" to "C$"
)

fun currencySymbol(currency: String?): String {
    val cur = (currency ?: "CNY").uppercase()
    return CURRENCY_SYMBOLS[cur] ?: "$cur "
}

/**
 * 金额格式化。
 *
 * ⚠️ currency 声明为 String? 是**有意为之**，不是笔误：
 * Gson 反序列化 Kotlin data class 时走 Unsafe 分配对象（不调构造器），
 * 所以 `val currency: String = "CNY"` 的默认值**不生效** —— 服务端还没
 * 返回该字段的老部署 / 旧缓存数据里，它实际是 null。声明为非空 String
 * 只在编译期好看，运行期照样是 null，一调 .uppercase() 就 NPE。
 * 因此这里全部按可空收，内部统一兜底 "CNY"。
 */
fun formatMoney(value: Double, currency: String? = "CNY"): String {
    val df = DecimalFormat("#,##0.00")
    // 负数标准格式：-¥X.XX（负号在货币符号前），例如 -74.14 CNY → "-¥74.14"
    return (if (value < 0) "-" else "") + currencySymbol(currency) + df.format(kotlin.math.abs(value))
}

fun formatMoneySigned(value: Double, currency: String? = "CNY"): String {
    val sign = if (value >= 0) "+" else "-"
    return sign + formatMoney(kotlin.math.abs(value), currency)
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
 *
 * 多币种 P2-2e：currency 非 CNY 时退回 formatMoney（保留两位小数不压缩），
 * 避免对非中文货币做语义不明的"万/亿"压缩。
 */
fun formatMoneyShort(value: Double, currency: String? = "CNY"): String {
    val cur = (currency ?: "CNY").uppercase()
    if (cur != "CNY") return formatMoney(value, cur)
    val a = kotlin.math.abs(value)
    val sign = if (value < 0) "-" else ""
    return when {
        a >= 100_000_000 -> sign + "¥" + String.format("%.2f", a / 100_000_000) + "亿"
        a >= 10_000 -> sign + "¥" + String.format("%.2f", a / 10_000) + "万"
        else -> formatMoney(value, cur)
    }
}

/**
 * 多币种 P2-2e：合计 breakdown 智能格式化（与 public/js/utils.js#fmtMix 严格同语义）
 *   空 / 全零              → formatMoney(0, baseCurrency)
 *   单货币                → formatMoney(value, currency)
 *   多货币 + 主货币 == base → 主值 + 括号附注其他货币明细（"¥1,000.00 ($50.00)"）
 *   多货币 + 主货币 != base → 降级主货币 + 附注（无 FxManager 暂不折算）
 *
 * 输入 breakdown 形如 { "CNY": 1000.0, "USD": 50.0 }；主货币按 amount 绝对值最大选。
 */
fun formatMoneyMix(breakdown: Map<String, Double>?, baseCurrency: String? = "CNY"): String {
    // 同上：baseCurrency 可能是 null（Gson 不走构造器，默认值不生效），统一兜底
    val base = ((baseCurrency ?: "CNY").ifBlank { "CNY" }).uppercase()
    if (breakdown.isNullOrEmpty()) return formatMoney(0.0, base)
    val entries = breakdown.entries.filter { it.value != null && kotlin.math.abs(it.value) > 0.001 }
    if (entries.isEmpty()) return formatMoney(0.0, base)
    if (entries.size == 1) {
        val e = entries.first()
        return formatMoney(e.value, e.key)
    }
    // 多货币：选主货币（amount 绝对值最大）
    val primaryEntry = entries.maxBy { kotlin.math.abs(it.value) }
    val primary = primaryEntry.key
    val primaryVal = primaryEntry.value
    if (primary == base) {
        val others = entries.filter { it.key != primary }
            .joinToString(" + ") { formatMoney(it.value, it.key) }
        return formatMoney(primaryVal, primary) + if (others.isNotEmpty()) " ($others)" else ""
    }
    // 主货币 != base：安卓端无 FxManager → 降级主货币 + 附注其他
    val others = entries.filter { it.key != primary }
        .joinToString(" + ") { formatMoney(it.value, it.key) }
    return formatMoney(primaryVal, primary) + if (others.isNotEmpty()) " ($others)" else ""
}

/**
 * 多币种 P2-2e：把一组带 currency 的对象按币种分组累加，得到 breakdown。
 *
 * 用途：后端很多合计（accounts.totalAssets、debts summary 的 remaining /
 * monthlyPayment 等）是 SQL SUM 不分 currency 的单值，混币种账本下没有意义。
 * 客户端拿到明细列表后可以用这个函数重新按币种分组，再交给 formatMoneyMix。
 *
 * 例：sumByCurrency(debts, { it.currency }, { it.remaining })
 *     → { "CNY": 1000.0, "USD": 50.0 }
 *
 * ⚠️ currencyOf 返回 null 时兜底 "CNY"（Gson 反序列化不调构造器，data class
 * 的 `= "CNY"` 默认值不生效，老部署数据里 currency 实际是 null）。
 */
fun <T> sumByCurrency(
    items: List<T>,
    currencyOf: (T) -> String?,
    amountOf: (T) -> Double
): Map<String, Double> {
    val out = linkedMapOf<String, Double>()
    items.forEach { item ->
        @Suppress("USELESS_ELVIS")
        val cur = (currencyOf(item) ?: "CNY").uppercase()
        out[cur] = (out[cur] ?: 0.0) + amountOf(item)
    }
    return out
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
