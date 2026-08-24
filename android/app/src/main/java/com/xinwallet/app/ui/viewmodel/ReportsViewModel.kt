package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.FinanceReport
import com.xinwallet.app.data.model.TopTransaction
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.ReportRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * 统计页状态。
 * - dataType: 当前查看维度 = expense(支出) / income(收入) / balance(结余)，默认支出。
 * - period: 锁月，格式 YYYY-MM。
 * - report: 当月完整报表（由 /reports 获取，切换 dataType 不重拉）。
 * - topTransactions: 当前 dataType 的 Top5 交易（由 /reports/top-transactions 获取）。
 */
data class ReportsUiState(
    val loading: Boolean = false,
    val error: String? = null,
    /** 当前选中周期：按月="YYYY-MM"，按年="YYYY"，自定义="YYYY-MM-DD~YYYY-MM-DD" */
    val period: String = currentMonth(),
    /** 时间维度："month"(按月) / "year"(按年) / "custom"(自定义) */
    val periodMode: String = "month",
    val dataType: String = "expense",
    val report: FinanceReport? = null,
    val topTransactions: List<TopTransaction> = emptyList()
)

fun currentMonth(): String {
    val c = Calendar.getInstance()
    return String.format(Locale.CHINA, "%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1)
}

fun shiftMonth(period: String, delta: Int): String {
    val m = Regex("(\\d{4})-(\\d{2})").find(period)
    val y = m?.groupValues?.get(1)?.toInt() ?: Calendar.getInstance().get(Calendar.YEAR)
    val mo = m?.groupValues?.get(2)?.toInt() ?: 1
    val c = Calendar.getInstance().apply { set(y, mo - 1, 1); add(Calendar.MONTH, delta) }
    return String.format(Locale.CHINA, "%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1)
}

class ReportsViewModel(private val repo: ReportRepository) : ViewModel() {
    private val _state = MutableStateFlow(ReportsUiState(loading = true))
    val state: StateFlow<ReportsUiState> = _state

    init { loadReport() }

    /** 账本切换后重新拉取报表（X-Book-Id 由 AuthInterceptor 注入，后端按当前账本隔离） */
    fun reload() {
        loadReport()
    }

    /**
     * 周期切换的**唯一**入口：mode 与 period 一次赋值、一次请求（对齐鸿蒙 applyPeriod）。
     *
     * ⚠️ 不要退回 `setPeriodMode(mode); setPeriod(period)` 那种两段式写法。
     * 两个 setter 各自带去重 guard 且各自 loadReport()，串起来会打出「中间态请求」：
     *
     *   年 → 月（2026 切到 2026-03）
     *     setPeriodMode("month") 把 "2026" 补成当前月 "2026-08" 并发一次请求
     *     setPeriod("2026-03")   才发用户真正要的那次
     *     → 白耗一次往返；两次响应乱序回来还会把 8 月的数据渲染出来
     *
     *   月 → 自定义
     *     setPeriodMode("custom") 的 custom 分支保持 period 原值 "2026-08"
     *     → 先拿「custom + 2026-08」打一次，服务端按区间解析月份串必然出错
     *
     *   自定义 → 月
     *     setPeriodMode("month") 见 period 长度不是 4，原样保留区间串
     *     → 先拿「monthly + 2026-01-01~2026-06-30」打一次
     *
     * 只有「月 → 年」这一条路径碰巧对（setPeriodMode 内部截出的 "2026" 与
     * 随后 setPeriod("2026") 相同、被 guard 拦掉），所以问题在最常用的
     * 操作上不显形，容易被当成没有问题。
     *
     * 见 scripts/verify-period-atomic-apply.js 与 docs/harmony-style-guide.md 第 54 节。
     */
    fun applyPeriod(period: String, mode: String) {
        val s = _state.value
        // 同一维度同一周期重复点：不发请求（等价于两个 setter 的 guard，但只判一次）
        if (period == s.period && mode == s.periodMode) return
        _state.value = s.copy(periodMode = mode, period = period)
        loadReport()
    }

    fun setPeriod(period: String) {
        if (period == _state.value.period) return
        _state.value = _state.value.copy(period = period)
        loadReport()
    }

    /**
     * 只切维度、由 ViewModel 推算新 period（顶部维度切换按钮用）。
     *
     * UI 上如果同时知道目标 period 和目标 mode（周期弹层、左右箭头），
     * 一律走 applyPeriod，不要调这个再补一次 setPeriod。
     */
    fun setPeriodMode(mode: String) {
        if (mode == _state.value.periodMode) return
        val s = _state.value
        val newPeriod = when (mode) {
            "year" -> s.period.take(4)           // "2026-08" → "2026"
            "custom" -> s.period                  // 自定义保持原值（由选择器设置完整范围）
            else -> {
                // 年→月：补当前月
                val m = s.period
                if (m.length == 4) "$m-${currentMonth().substring(5)}" else m
            }
        }
        _state.value = s.copy(periodMode = mode, period = newPeriod)
        loadReport()
    }

    fun setDataType(type: String) {
        if (type == _state.value.dataType) return
        _state.value = _state.value.copy(dataType = type)
        if (type != "balance") loadTopTransactions(type)
    }

    private fun loadReport() {
        val s = _state.value
        // 报表粒度。
        //
        // ⚠️ 按年发 "annual" 而不是 "yearly"。二者在**新**服务端等价
        // （PERIOD_TYPE_ALIAS 把 yearly 映射成 annual），但 "annual" 是
        // 旧服务端唯一认识的写法 —— 旧版 parseReportPeriod 只有
        // monthly / quarterly / annual 三个分支，收到 "yearly" 直接
        // throw("不支持的报表类型") → HTTP 400。
        //
        // 客户端发新旧都认的值，按年就不依赖服务端部署顺序。
        // 反过来（发 yearly + 服务端加别名）要求两端同时升级，
        // 用户装了新 APK 而服务端还是旧的，按年功能就是坏的。
        val granularity = when (s.periodMode) {
            "year" -> "annual"
            "custom" -> "custom"
            else -> "monthly"
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            when (val r = repo.getReport(granularity, s.period)) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(loading = false, report = r.data)
                    if (_state.value.dataType != "balance") loadTopTransactions(_state.value.dataType)
                }
                is ApiResult.Error -> {
                    // ⚠️ 失败必须把 report 清成 null，不能留着上一次的响应。
                    // periodMode / period 是本地状态，切换立即生效：顶部导航已显示
                    // 「2026年」、KPI 已按年算月均，而 report 还是上个月那份
                    // —— 一个页面同时显示两个周期的数据，看着像图表没更新，
                    // 实际是请求失败了。静默保留旧数据在这里比报错有害得多。
                    //
                    // 「服务端太旧不认识 custom」要说清楚，否则用户以为是自己选错了区间。
                    // 但不能一律按 periodMode == "custom" 就说「需要升级服务端」——
                    // 那样部署完新服务端之后，真正的网络错误、401、区间格式错误
                    // 全都会被这句话盖掉，用户会一直去查服务端版本。
                    // 判据用服务端实际回复：旧版 parseReportPeriod 落到最后一行
                    // throw new Error('不支持的报表类型')。
                    val serverTooOld = r.message.contains("不支持的报表类型")
                    _state.value = _state.value.copy(
                        loading = false,
                        report = null,
                        error = if (s.periodMode == "custom" && serverTooOld)
                            "自定义区间需要升级服务端"
                        else r.message
                    )
                }
            }
        }
    }

    /** Top5 交易：仅支出/收入维度需要；余额维度不展示单笔排行 */
    private fun loadTopTransactions(type: String) {
        val period = _state.value.period
        viewModelScope.launch {
            when (val r = repo.getTopTransactions(type, period)) {
                is ApiResult.Success -> _state.value = _state.value.copy(topTransactions = r.data.items)
                is ApiResult.Error -> { /* Top5 为增强信息，失败静默，不影响主报表 */ }
            }
        }
    }

    fun consumeError() { _state.value = _state.value.copy(error = null) }
}
