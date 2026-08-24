package com.xinwallet.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.xinwallet.app.data.model.CalendarDay
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.ExpenseColor
import com.xinwallet.app.ui.theme.IncomeColor

/**
 * 日历单元格数据（共享给账单页与首页日历，周一起头 / 6×7 网格）
 */
data class CalendarCellData(
    val kind: CellKind,
    val date: String?,
    val day: Int?,
    val dayLabel: String?
)

enum class CellKind { CURRENT, PREV, NEXT }

/**
 * 金额紧凑缩写（保留 2 位小数，无千分位）：
 *  - < 1 万：原样（1234.56）
 *  - ≥ 1 万：X.XX万
 *  - ≥ 1 亿：X.XX亿
 */
fun formatCompact(v: Double): String {
    return when {
        v >= 100_000_000 -> String.format("%.2f", v / 100_000_000) + "亿"
        v >= 10_000 -> String.format("%.2f", v / 10_000) + "万"
        else -> String.format("%.2f", v)
    }
}

/**
 * 日历单元格（与首页日历保持一致：固定 44dp + 三行紧凑位置固定，颜色逻辑统一）
 *  - 选中：暖棕满底 / 白字
 *  - 有记录：暖棕淡主题色方块
 *  - 当月空白：淡灰方块
 *  - 上月/下月：更淡灰方块 + 月名（"八月"/"九月"）
 *  - 三行固定同一位置：日期 / 支出 / 收入；无数据行用透明色"占位"保持位置
 */
@Composable
fun SharedCalendarCell(
    cell: CalendarCellData,
    isSelected: Boolean,
    isToday: Boolean,
    dayData: CalendarDay?,
    onClick: () -> Unit
) {
    val isCurrent = cell.kind == CellKind.CURRENT
    val bgColor = when {
        isSelected -> Brown500                                      // 选中：满主题色
        !isCurrent -> Color(0xFFF0EDEE)                            // 上下月：淡灰方块
        dayData?.hasRecord == true -> Brown100.copy(alpha = 0.7f)  // 有记录：淡主题色方块
        else -> Color(0xFFF0EDEE)                                  // 空白：淡灰方块
    }
    val dateColor = when {
        isSelected -> Color.White
        !isCurrent -> Color(0xFFB3BEC4)
        else -> Color.Black
    }
    val exp = dayData?.expense ?: 0.0
    val inc = dayData?.income ?: 0.0

    Column(
        Modifier
            .height(44.dp)
            .padding(2.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(bgColor)
            .clickable(enabled = cell.date != null && isCurrent, onClick = onClick)
            .padding(vertical = 2.dp, horizontal = 2.dp)
            .fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        // 第一行：日期 / 上下月月名
        Text(
            text = if (!isCurrent && cell.dayLabel != null) cell.dayLabel
                   else cell.day?.toString() ?: "",
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 11.sp,
                lineHeight = 13.sp
            ),
            color = dateColor,
            fontWeight = if (isSelected || isToday) FontWeight.Bold else FontWeight.SemiBold,
            maxLines = 1,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )
        if (isCurrent && cell.day != null) {
            // 第二行：支出纯数字（绿）
            Text(
                text = if (exp > 0) formatCompact(exp) else " ",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 8.sp,
                    lineHeight = 10.sp
                ),
                color = when {
                    isSelected -> Color.White
                    exp > 0 -> ExpenseColor
                    else -> Color.Transparent
                },
                maxLines = 1,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
            // 第三行：收入纯数字（红）
            Text(
                text = if (inc > 0) formatCompact(inc) else " ",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 8.sp,
                    lineHeight = 10.sp
                ),
                color = when {
                    isSelected -> Color.White
                    inc > 0 -> IncomeColor
                    else -> Color.Transparent
                },
                maxLines = 1,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        } else {
            // 上月 / 下月或 cell 为空：保留两行透明占位维持三行位置
            Text(" ", style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 10.sp), color = Color.Transparent, maxLines = 1, modifier = Modifier.fillMaxWidth())
            Text(" ", style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 10.sp), color = Color.Transparent, maxLines = 1, modifier = Modifier.fillMaxWidth())
        }
    }
}