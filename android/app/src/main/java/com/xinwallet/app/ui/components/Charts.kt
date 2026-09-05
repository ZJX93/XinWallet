package com.xinwallet.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOutQuart
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.xinwallet.app.data.model.ReportCategorySlice
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LinearProgress
import kotlin.math.roundToInt
import kotlin.math.atan2
import kotlin.math.sqrt
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.formatMoneyMix

/**
 * 单条趋势折线图（统计页按维度切换：支出线 / 收入线 / 结余累计线）。
 * 自动标出峰值点（series 中最大值）并高亮。
 *
 * @param values 单系列数值（按日顺序）。
 * @param color  线条颜色（支出=绿、收入=红、结余=品牌棕）。
 * @param peakIndex 需要高亮的点下标（如峰值日）；为 null 时不额外高亮。
 */
@Composable
fun TrendLineChartSingle(
    values: List<Double>,
    color: Color,
    modifier: Modifier = Modifier,
    peakIndex: Int? = null,
    onTapIndex: ((Int) -> Unit)? = null
) {
    val maxV = (values.maxOrNull() ?: 1.0).let { if (it <= 0) 1.0 else it }
    Canvas(
        modifier
            .fillMaxWidth()
            .height(170.dp)
            .pointerInput(values.size, onTapIndex) {
                if (onTapIndex != null) {
                    detectTapGestures { offset ->
                        val w = size.width.toFloat()
                        val n = values.size
                        if (n > 0 && w > 0f) {
                            val idx = if (n == 1) 0
                                      else ((offset.x / w) * (n - 1)).roundToInt().coerceIn(0, n - 1)
                            onTapIndex(idx)
                        }
                    }
                }
            }
    ) {
        val w = size.width
        val h = size.height
        val n = maxOf(values.size, 1)
        val pad = 18.dp.toPx()
        val usableH = h - pad * 2
        val xAt: (Int) -> Float = { i -> if (n == 1) w / 2f else (i.toFloat() / (n - 1)) * w }
        val yAt: (Double) -> Float = { v -> h - pad - (v / maxV).toFloat() * usableH }

        val line = Path().apply {
            values.forEachIndexed { i, v -> if (i == 0) moveTo(xAt(i), yAt(v)) else lineTo(xAt(i), yAt(v)) }
        }
        val fill = Path().apply {
            moveTo(xAt(0), h - pad)
            values.forEachIndexed { i, v -> lineTo(xAt(i), yAt(v)) }
            lineTo(xAt(values.lastIndex), h - pad)
            close()
        }
        drawPath(fill, color.copy(alpha = 0.12f))
        drawPath(line, color, style = Stroke(width = 3.dp.toPx()))
        values.forEachIndexed { i, v ->
            val isPeak = i == peakIndex
            drawCircle(color, if (isPeak) 6.dp.toPx() else 4.dp.toPx(), Offset(xAt(i), yAt(v)))
        }
    }
}

/**
 * 分类占比饼图：左侧 Canvas 自绘扇形，右侧图例（色块 + 图标名称 + 百分比 + 金额）。
 *
 * 分类多时只画前 6 个，剩下的合并成「其他」，否则扇区太碎、图例也放不下。
 *
 * @param onSliceClick 点击图例/扇区回调；ReportsScreen 用它实现「点击一级分类进入二级明细」。
 */
@Composable
fun CategoryPie(
    items: List<ReportCategorySlice>,
    modifier: Modifier = Modifier,
    onSliceClick: ((ReportCategorySlice) -> Unit)? = null
) {
    val slices = remember(items) { toPieSlices(items) }
    if (slices.isEmpty()) {
        EmptyState("该周期暂无数据")
        return
    }
    val total = slices.sumOf { it.total }.coerceAtLeast(0.0001)
    // 扇区之间用卡片底色描一条细线，避免相邻色块糊在一起
    val gapColor = MaterialTheme.colorScheme.surface

    Row(
        modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Canvas(Modifier.size(132.dp)) {
            val d = size.minDimension
            val topLeft = Offset((size.width - d) / 2f, (size.height - d) / 2f)
            val arcSize = Size(d, d)

            var start = -90f
            slices.forEachIndexed { idx, slice ->
                val sweep = (slice.total / total * 360.0).toFloat()
                drawArc(SLICE_PALETTE[idx % SLICE_PALETTE.size], start, sweep, true, topLeft, arcSize)
                start += sweep
            }
            start = -90f
            slices.forEach { slice ->
                val sweep = (slice.total / total * 360.0).toFloat()
                drawArc(gapColor, start, sweep, true, topLeft, arcSize, style = Stroke(width = 2.dp.toPx()))
                start += sweep
            }
        }

        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            slices.forEachIndexed { idx, slice ->
                Row(
                    Modifier.fillMaxWidth()
                        .padding(vertical = 3.dp)
                        .clickable(enabled = onSliceClick != null) { onSliceClick?.invoke(slice.source) },
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        Modifier.size(10.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(SLICE_PALETTE[idx % SLICE_PALETTE.size])
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "${slice.icon} ${slice.name}",
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(6.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            pctLabel(slice.total / total),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            // 多币种 P2-2e：饼图扇区金额按该分类 breakdown 智能格式化
                            formatMoneyMix(slice.totalBreakdown),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

private data class PieSlice(
    val icon: String,
    val name: String,
    val total: Double,
    val source: ReportCategorySlice
)

private fun toPieSlices(items: List<ReportCategorySlice>, maxSlices: Int = 7): List<PieSlice> {
    val positive = items.filter { it.total > 0 }.sortedByDescending { it.total }
    if (positive.size <= maxSlices) {
        return positive.map { PieSlice(it.icon ?: "📌", it.name, it.total, it) }
    }
    val head = positive.take(maxSlices - 1).map { PieSlice(it.icon ?: "📌", it.name, it.total, it) }
    val rest = positive.drop(maxSlices - 1).sumOf { it.total }
    return head + PieSlice("🗂", "其他", rest, ReportCategorySlice(name = "其他", icon = "🗂"))
}

/** 占比文案：≥10% 取整，小占比保留一位小数，避免一堆 0% */
private fun pctLabel(ratio: Double): String {
    val pct = ratio * 100
    return if (pct >= 10) "${pct.toInt()}%" else String.format(java.util.Locale.CHINA, "%.1f%%", pct)
}

/**
 * 分类占比：横向条形 + 颜色 + 金额/百分比。
 *
 * @param baseTotal 占比分母。默认用 items 自身之和；当 items 是「某个父类的子类」时，
 *  应传父类总额 —— 否则子类之和若小于父类（存在未细分的部分），子类占比会被放大到 100%，
 *  和环图上那一块的读数对不上。
 * @param colorOffset 调色板起始偏移。子类列表传父类在环图中的色号，让「这一段颜色」
 *  与环图选中的色块产生视觉关联，而不是每个大类的子类都从暖灰棕重新开始。
 */
@Composable
fun CategoryBars(
    items: List<ReportCategorySlice>,
    modifier: Modifier = Modifier,
    baseTotal: Double? = null,
    colorOffset: Int = 0
) {
    if (items.isEmpty()) {
        EmptyState("该周期暂无数据")
        return
    }
    val total = (baseTotal ?: items.sumOf { it.total }).coerceAtLeast(0.0001)
    Column(modifier.fillMaxWidth()) {
        items.forEachIndexed { idx, it ->
            val pct = (it.total / total * 100)
            val color = SLICE_PALETTE[(idx + colorOffset) % SLICE_PALETTE.size]
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(vertical = 7.dp)
            ) {
                Text(
                    it.icon ?: "📌",
                    fontSize = 18.sp,
                    modifier = Modifier.width(30.dp)
                )
                Column(Modifier.weight(1f).padding(start = 4.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(it.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        Text(
                            // 多币种 P2-2e：分类排行柱状条目金额按该分类 breakdown 智能格式化
                            "${formatMoneyMix(it.totalBreakdown)} · ${pct.toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Box(Modifier.padding(top = 5.dp)) {
                        LinearProgress(
                            (pct / 100f).toFloat(),
                            color,
                            Modifier.fillMaxWidth().height(8.dp)
                                .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                        )
                    }
                }
            }
        }
    }
}

/**
 * 分类占比配色：莫兰迪低饱和色系。
 *
 * 三端同源（web public/js/managers/chart.js:cats / 鸿蒙 Charts.ets:SLICE_PALETTE），
 * 由 scripts/gen-morandi-palette.js 按 HSV 换算并校验后固化，改色请改脚本重跑，
 * 不要手改 hex —— 三处不一致时同一笔支出在三端会是三种颜色。
 *
 * 约束（脚本强制校验，全部通过）：
 *   S=16~32%  低饱和莫兰迪区间，不许混进高饱和色
 *   相邻色相距离 ≥90°  环图按金额降序上色，数组相邻项必然在环上并排
 *   白底/暗底对比 ≥1.6:1  低于此值色块会和卡片底融掉
 *
 * 首色贴品牌棕（26°，品牌色 #995F2C 为 27°）：占比最大的分类用品牌调。
 */
private val SLICE_PALETTE = listOf(
    Color(0xFFB89881),  // 暖陶棕（品牌同调）
    Color(0xFF84B3AC),  // 青瓷绿
    Color(0xFFB38581),  // 赭石红
    Color(0xFF88A4B8),  // 雾霾蓝
    Color(0xFFBDAF84),  // 芥末黄
    Color(0xFFAA8FB8),  // 藕荷紫
    Color(0xFF9AB388),  // 橄榄绿
    Color(0xFFB88C9A),  // 干玫瑰
    Color(0xFF9797B8),  // 灰蓝紫
    Color(0xFFA7C7AC)   // 浅灰绿
)

/**
 * 环形图 —— 对齐 web 端 Chart.js doughnut 式样（public/js/managers/chart.js:230-267）。
 *
 * web 的观感由四个参数构成，这里逐项等价实现：
 *   cutout: '72%'      → 内径 = 外径 × 0.72，细环 + 大留白中心（原实现 stroke 36 / 直径 160 太粗）
 *   spacing: 2         → 扇区之间留角度间隙
 *   borderWidth: 3     → 间隙用卡片底色，视觉上是「暖白细缝」
 *   borderRadius: 6    → 扇区四角圆角（胶囊感，不呆板）
 *   hoverOffset: 8     → 选中扇区径向外扩
 *   legend: false      → 无图例，中心数字代替
 *
 * 与旧实现的差异（都是为了贴 web）：
 *   1) 去掉灰色轨道整圆 —— web 没有 track，环本身就是全部数据；留着会在细环下变成一道显眼灰边
 *   2) 去掉四角引线标注 —— web 用 tooltip，移动端等价物是「中心切换为选中分类」，
 *      引线在细环上斜穿整图，是原先显得杂乱的主因
 *   3) 扇区用 Path 自绘而非 Stroke —— Stroke 的 StrokeCap.Round 圆角半径固定 = 环厚/2，
 *      压不到 web 的 6dp；自绘才能精确控制四角圆角
 *
 * @param data (标签, 数值) 列表，为空时返回 EmptyState。
 * @param centerTitle 中心第一行（未选中时传「总支出」，选中后传分类名）。
 * @param centerAmount 中心第二行金额。
 * @param selectedLabel 当前选中分类名；该扇区径向外扩 + 略微加厚。
 */
@Composable
fun DonutChart(
    data: List<Pair<String, Double>>,
    modifier: Modifier = Modifier,
    centerTitle: String? = null,
    centerAmount: String? = null,
    selectedLabel: String? = null,
    onSliceClick: ((String) -> Unit)? = null
) {
    // 稳定化：data 仅在周期切换时变化；用 remember 固定 identity，
    // 避免每次点击选中都重建 pointerInput 手势检测器，导致点击丢失/卡顿。
    val positive = remember(data) { data.filter { it.second > 0 }.sortedByDescending { it.second } }
    if (positive.isEmpty()) {
        EmptyState("该周期暂无数据")
        return
    }
    val total = positive.sumOf { it.second }.coerceAtLeast(0.0001)
    // 注：扇区间的「暖白细缝」不是描边画出来的，而是每段两端各内缩 gapDeg/2 度留出的空隙，
    // 透出的就是卡片底色（等价 web borderColor 暖白 + borderWidth:3 的观感）。
    // 用描边实现会在选中扇区外扩时露出错位的边线。
    val selIdx = if (selectedLabel != null) {
        positive.indexOfFirst { it.first == selectedLabel }.let { if (it >= 0) it else null }
    } else null

    // ──── 动效：对齐 web animation { animateScale, animateRotate, 800ms, easeOutQuart } ────
    //
    // 入场用 Animatable 而非 animateFloatAsState —— 需要在 data 变化时
    // 显式「从 0 重跑」，而 animateFloatAsState 只会从当前值补间到新目标。
    val growth = remember(positive) { Animatable(0f) }
    LaunchedEffect(positive) {
        growth.snapTo(0f)
        growth.animateTo(1f, animationSpec = tween(durationMillis = 800, easing = EaseOutQuart))
    }
    // 选中外扩：260ms 比入场短 —— 交互反馈要跟手，用 800ms 会显得拖沓。
    val selProgress by animateFloatAsState(
        targetValue = if (selIdx != null) 1f else 0f,
        animationSpec = tween(durationMillis = 260, easing = EaseOutQuart),
        label = "donutHoverOffset"
    )

    // 预计算各扇区角度（起始角 / 扫过角），Canvas 与命中测试共用
    val sliceGeo = remember(positive) {
        val list = mutableListOf<Pair<Float, Float>>()
        var start = -90f
        positive.forEach { (_, v) ->
            val sweep = (v / total * 360.0).toFloat()
            list.add(start to sweep)
            start += sweep
        }
        list
    }

    Column(
        modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(CANVAS_SIZE.dp)) {
            Canvas(
                Modifier
                    .size(CANVAS_SIZE.dp)
                    .pointerInput(positive) {
                        if (onSliceClick != null) {
                            detectTapGestures { offset ->
                                val cx: Float = size.width / 2f
                                val cy: Float = size.height / 2f
                                val dx: Float = offset.x - cx
                                val dy: Float = offset.y - cy
                                // 命中带 = 环本体 [内径, 外径]，两侧各放宽 6dp 容错（手指比环粗）
                                val rOuter: Float = RING_OUTER.dp.toPx() / 2f
                                val rInner: Float = rOuter * CUTOUT
                                val slack: Float = 6.dp.toPx()
                                val dist: Float = sqrt(dx * dx + dy * dy)
                                if (dist >= rInner - slack && dist <= rOuter + slack) {
                                    var a = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
                                    if (a < -90f) a += 360f
                                    var acc = -90f
                                    var hitIdx = -1
                                    for (idx in positive.indices) {
                                        val sweep = (positive[idx].second / total * 360.0).toFloat()
                                        if (a >= acc && a < acc + sweep) {
                                            hitIdx = idx
                                            break
                                        }
                                        acc += sweep
                                    }
                                    if (hitIdx >= 0) onSliceClick(positive[hitIdx].first)
                                }
                            }
                        }
                    }
            ) {
                val g = growth.value
                val c = Offset(size.width / 2f, size.height / 2f)
                // animateScale：半径 88%→100%。不从 0 起 —— 从一点炸开会让扇区在前 200ms 糊成一团，
                // web 的 animateScale 观感也是「略微放大到位」而非从无到有。
                val rOuterFull = RING_OUTER.dp.toPx() / 2f
                val scale = 0.88f + 0.12f * g
                val rOuter = rOuterFull * scale
                val rInner = rOuter * CUTOUT
                val thickness = rOuter - rInner
                // animateRotate：扫过角 0→360°
                val sweptTotal = 360f * g
                // 间隙：web spacing:2 + borderWidth:3 ≈ 4dp 弧长，换成角度（外半径处）
                val gapDeg = Math.toDegrees((GAP_DP.dp.toPx() / rOuter.coerceAtLeast(1f)).toDouble()).toFloat()
                // 圆角半径不能超过环厚的一半，否则圆角会自交（细环 + 大圆角时）
                val corner = minOf(CORNER_DP.dp.toPx(), thickness / 2f)
                val explode = HOVER_OFFSET.dp.toPx() * selProgress

                positive.forEachIndexed { idx, _ ->
                    val (s, sweep) = sliceGeo[idx]
                    // 入场裁剪：只画落在已扫过范围内的部分
                    val drawn = ((-90f + sweptTotal) - s).coerceIn(0f, sweep)
                    if (drawn <= 0f) return@forEachIndexed

                    // 两端各内缩 gap/2 形成暖白细缝。单一分类占满整圈时不留缝
                    // —— 留了会在正上方出现一道无意义的豁口。
                    val single = positive.size == 1
                    val half = if (single) 0f else gapDeg / 2f
                    val a0 = s + half
                    val a1 = s + drawn - half
                    if (a1 <= a0) return@forEachIndexed

                    // 选中扇区：径向外扩（web hoverOffset）+ 略微加厚，
                    // 触屏没有 hover，只靠位移不够明显，加厚 2dp 让它「浮」出来。
                    val isSel = selIdx == idx
                    val mid = Math.toRadians(((a0 + a1) / 2f).toDouble())
                    val dir = Offset(kotlin.math.cos(mid).toFloat(), kotlin.math.sin(mid).toFloat())
                    val center = if (isSel) c + dir * explode else c
                    val ro = if (isSel) rOuter + 2.dp.toPx() * selProgress else rOuter
                    val ri = if (isSel) rInner - 1.dp.toPx() * selProgress else rInner

                    // 圆角只在整段画完后收 —— 入场途中末端是「正在生长的切口」，
                    // 给它加圆角会让端点看起来在抖。
                    val complete = drawn >= sweep - 0.01f
                    val path = ringSegmentPath(
                        center = center,
                        rOuter = ro,
                        rInner = ri,
                        startDeg = a0,
                        sweepDeg = a1 - a0,
                        corner = if (complete) corner else 0f
                    )
                    drawPath(path, SLICE_PALETTE[idx % SLICE_PALETTE.size])
                }
            }
            // 中心读数（对齐 web centerTextPlugin：小字标题 + 大字金额，无图例）
            //
            // ⚠️ textAlign = Center 是必须的，不能只靠外层 horizontalAlignment。
            // 两行文字都设了固定 width（撑满环心可用宽，防止压到色带），
            // Column 的 horizontalAlignment 只负责「把这个固定宽度的框摆在中间」，
            // 框内文字仍按默认左对齐 —— 短文本（如「餐饮」）就会明显靠左，
            // 看起来整个环心读数偏了。
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                centerTitle?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        // 中心可用宽 = 内径 - 余量，超出会压到色带上
                        modifier = Modifier.width((RING_OUTER * CUTOUT - 16).dp)
                    )
                    Spacer(Modifier.height(2.dp))
                }
                centerAmount?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.width((RING_OUTER * CUTOUT - 16).dp)
                    )
                }
            }
        }
    }
}

/**
 * 生成「四角圆角的环形扇区」路径 —— web borderRadius: 6 的等价实现。
 *
 * 为什么不用 drawArc + Stroke：Stroke 的 StrokeCap.Round 圆角半径固定 = 线宽/2，
 * 细环下也压不到 6dp，而 StrokeCap.Butt 又完全没有圆角。只有自绘能精确控制。
 *
 * 路径顺序：外弧 → 末端圆角 → 径向内收 → 内弧（反向）→ 起端圆角 → 闭合。
 * 圆角用二次贝塞尔近似（控制点取真实直角顶点）—— 6dp 尺度下与真圆弧的偏差
 * 不足 0.4dp，肉眼无法分辨，但代码量和出错面小得多。
 *
 * @param corner 圆角半径(px)，传 0 得到直角扇区（入场动画途中用）。
 */
private fun ringSegmentPath(
    center: Offset,
    rOuter: Float,
    rInner: Float,
    startDeg: Float,
    sweepDeg: Float,
    corner: Float
): Path {
    val path = Path()
    val polar: (Float, Float) -> Offset = { r, deg ->
        val rad = Math.toRadians(deg.toDouble())
        Offset(center.x + r * kotlin.math.cos(rad).toFloat(), center.y + r * kotlin.math.sin(rad).toFloat())
    }
    val outerRect = androidx.compose.ui.geometry.Rect(
        center.x - rOuter, center.y - rOuter, center.x + rOuter, center.y + rOuter
    )
    val innerRect = androidx.compose.ui.geometry.Rect(
        center.x - rInner, center.y - rInner, center.x + rInner, center.y + rInner
    )
    val endDeg = startDeg + sweepDeg

    // 圆角在外/内弧上占用的角度不同（同样弧长，半径小则角度大）。
    // 若扇区太窄放不下圆角，退化成直角 —— 硬塞会让路径自交，渲染出「打结」的色块。
    val dOut = Math.toDegrees((corner / rOuter.coerceAtLeast(1f)).toDouble()).toFloat()
    val dIn = Math.toDegrees((corner / rInner.coerceAtLeast(1f)).toDouble()).toFloat()
    val fits = corner > 0f && sweepDeg > (dOut + dIn) * 1.6f && (rOuter - rInner) > corner * 2f

    if (!fits) {
        path.moveTo(polar(rOuter, startDeg).x, polar(rOuter, startDeg).y)
        path.arcTo(outerRect, startDeg, sweepDeg, false)
        path.lineTo(polar(rInner, endDeg).x, polar(rInner, endDeg).y)
        path.arcTo(innerRect, endDeg, -sweepDeg, false)
        path.close()
        return path
    }

    // 1) 外弧（起端已让出圆角）
    val pStartOuter = polar(rOuter, startDeg + dOut)
    path.moveTo(pStartOuter.x, pStartOuter.y)
    path.arcTo(outerRect, startDeg + dOut, sweepDeg - dOut * 2f, false)
    // 2) 末端外角：外弧 → 径向内收
    val cornerOuterEnd = polar(rOuter, endDeg)
    val pOuterEndIn = polar(rOuter - corner, endDeg)
    path.quadraticBezierTo(cornerOuterEnd.x, cornerOuterEnd.y, pOuterEndIn.x, pOuterEndIn.y)
    // 3) 末端径向边
    val pInnerEndOut = polar(rInner + corner, endDeg)
    path.lineTo(pInnerEndOut.x, pInnerEndOut.y)
    // 4) 末端内角：径向 → 内弧
    val cornerInnerEnd = polar(rInner, endDeg)
    val pInnerArcEnd = polar(rInner, endDeg - dIn)
    path.quadraticBezierTo(cornerInnerEnd.x, cornerInnerEnd.y, pInnerArcEnd.x, pInnerArcEnd.y)
    // 5) 内弧（反向回到起端）
    path.arcTo(innerRect, endDeg - dIn, -(sweepDeg - dIn * 2f), false)
    // 6) 起端内角：内弧 → 径向外扩
    val cornerInnerStart = polar(rInner, startDeg)
    val pInnerStartOut = polar(rInner + corner, startDeg)
    path.quadraticBezierTo(cornerInnerStart.x, cornerInnerStart.y, pInnerStartOut.x, pInnerStartOut.y)
    // 7) 起端径向边
    val pOuterStartIn = polar(rOuter - corner, startDeg)
    path.lineTo(pOuterStartIn.x, pOuterStartIn.y)
    // 8) 起端外角：径向 → 外弧起点
    val cornerOuterStart = polar(rOuter, startDeg)
    path.quadraticBezierTo(cornerOuterStart.x, cornerOuterStart.y, pStartOuter.x, pStartOuter.y)
    path.close()
    return path
}

// ──── 环图几何参数（数值来源：web Chart.js 配置，见 DonutChart 注释）────

/** 容器尺寸(dp)：环外径 + 选中外扩余量 ×2 */
private const val CANVAS_SIZE = 220
/** 环外径(dp) */
private const val RING_OUTER = 200f
/** 内径占外径比例，对齐 web cutout: '72%' */
private const val CUTOUT = 0.72f
/** 扇区间隙弧长(dp)，对齐 web spacing:2 + borderWidth:3 */
private const val GAP_DP = 4f
/** 扇区圆角(dp)，对齐 web borderRadius: 6 */
private const val CORNER_DP = 6f
/** 选中外扩(dp)，对齐 web hoverOffset: 8 */
private const val HOVER_OFFSET = 8f

/** 环形进度（预算/储蓄目标用） */
@Composable
fun DonutProgress(percent: Float, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primary) {
    val track = MaterialTheme.colorScheme.surfaceVariant
    Canvas(modifier.size(64.dp)) {
        val stroke = 9.dp.toPx()
        val r = (size.minDimension - stroke) / 2f
        val c = Offset(size.width / 2, size.height / 2)
        drawCircle(track, style = Stroke(stroke), radius = r, center = c)
        val sweep = percent.coerceIn(0f, 1f) * 360f
        drawArc(
            color = color, startAngle = -90f, sweepAngle = sweep, useCenter = false,
            style = Stroke(stroke), topLeft = Offset(c.x - r, c.y - r), size = Size(r * 2, r * 2)
        )
    }
}
