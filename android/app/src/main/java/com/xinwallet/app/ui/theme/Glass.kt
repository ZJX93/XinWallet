package com.xinwallet.app.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/* =========================================================================
 * 三端统一「毛玻璃」设计语言（与 Web tokens.css / 鸿蒙 theme.ts 同源）
 * - 环境光 blob：暖琥珀 / 珊瑚 / 薄荷 / 桃（与 Web --blob-1..4 完全一致）
 * - 玻璃表面：半透明填充 + 发丝边 + 顶部高光 + 柔和暖色阴影
 * - 安卓因 minSdk=24 不依赖 API31+ 的 Modifier.blur，采用「半透明 + 描边 + 高光」
 *   近似真毛玻璃；鸿蒙用原生 backgroundBlurStyle 真模糊，Web 用 backdrop-filter，
 *   三者视觉语言一致。
 * ========================================================================= */

/* 环境光 blob 调色（OKLCH 近似 hex，与 Web 同源） */
private val BlobAmber = Color(0xFFF6C77A) // 暖琥珀
private val BlobCoral = Color(0xFFE8A59B) // 珊瑚
private val BlobMint  = Color(0xFFBFE3D0) // 薄荷
private val BlobPeach = Color(0xFFF4CFC0) // 桃

private val BaseLight = Color(0xFFFBF7F2) // 暖白近透明底
private val BaseDark  = Color(0xFF18130E) // 深暖炭灰底

/**
 * 全屏环境光背景：暖色底 + 四团柔光 blob。
 * 作为根布局最底层绘制，所有页面内容覆盖其上，玻璃表面透出柔光即呈毛玻璃质感。
 */
@Composable
fun AmbientBackground(modifier: Modifier = Modifier.fillMaxSize()) {
    val isDark = LocalIsDark.current
    val base = if (isDark) BaseDark else BaseLight
    val a = if (isDark) 0.20f else 0.55f // 暗色下降低不透明度，避免抢戏
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val r = max(w, h)
        drawRect(base)
        val blobs = listOf(
            BlobAmber to Offset(w * 0.12f, h * 0.06f), // 左上 暖琥珀
            BlobCoral to Offset(w * 0.94f, h * 0.10f), // 右上 珊瑚
            BlobMint  to Offset(w * 0.08f, h * 0.94f), // 左下 薄荷
            BlobPeach to Offset(w * 0.96f, h * 0.96f)  // 右下 桃
        )
        blobs.forEach { (color, center) ->
            drawCircle(
                brush = Brush.radialGradient(
                    0.0f to color.copy(alpha = a),
                    1.0f to color.copy(alpha = 0.0f)
                ),
                radius = r * 0.55f,
                center = center
            )
        }
    }
}

/** 玻璃表面填充色 */
private fun glassFill(isDark: Boolean): Color =
    if (isDark) Color(0xFF29231D).copy(alpha = 0.55f) else Color.White.copy(alpha = 0.62f)

/** 玻璃发丝边色 */
private fun glassBorder(isDark: Boolean): Color =
    if (isDark) Color.White.copy(alpha = 0.14f) else Color.White.copy(alpha = 0.60f)

/** 玻璃顶部高光（白 → 透明，仅顶部约 64px） */
private fun glassHighlight(isDark: Boolean): Brush =
    Brush.verticalGradient(
        0.0f to Color.White.copy(alpha = if (isDark) 0.10f else 0.35f),
        1.0f to Color.White.copy(alpha = 0.0f),
        startY = 0f, endY = 64f
    )

/** 柔和暖色阴影（暖棕 tint） */
private fun glassShadow(isDark: Boolean): Color =
    if (isDark) Color.Black.copy(alpha = 0.35f) else Color(0xFF995F2C).copy(alpha = 0.18f)

/**
 * 通用玻璃容器：半透明填充 + 发丝边 + 顶部高光 + 可选柔和阴影。
 * 用于顶栏、底部导航、卡片、弹层、chip 等一切需要玻璃质感的表面。
 */
@Composable
fun GlassBox(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    elevated: Boolean = true,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.() -> Unit
) {
    val isDark = LocalIsDark.current
    Box(
        modifier
            .then(
                if (elevated) Modifier.shadow(
                    10.dp, shape, clip = false,
                    ambientColor = glassShadow(isDark), spotColor = glassShadow(isDark)
                ) else Modifier
            )
            .background(glassFill(isDark), shape)
            .border(1.dp, glassBorder(isDark), shape),
        contentAlignment = contentAlignment
    ) {
        // 顶部高光（绘制在内容之下）
        Box(
            Modifier
                .matchParentSize()
                .clip(shape)
                .background(glassHighlight(isDark))
        )
        content()
    }
}

/**
 * 玻璃 FAB（快速记账 / 悬浮操作）：玻璃圆 + 暖棕发丝环 + 品牌色图标 + 暖色阴影。
 */
@Composable
fun GlassFab(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 46.dp,
    clickableEnabled: Boolean = true
) {
    val isDark = LocalIsDark.current
    val ringColor = if (isDark) Brown300 else Brown500
    val iconColor = if (isDark) Brown300 else Brown500
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .shadow(
                6.dp, CircleShape, clip = false,
                ambientColor = Brown500.copy(alpha = 0.45f),
                spotColor = Brown500.copy(alpha = 0.45f)
            )
            .background(glassFill(isDark), CircleShape)
            .border(1.5.dp, ringColor, CircleShape)
            .then(if (clickableEnabled) Modifier.clickable { onClick() } else Modifier),
        contentAlignment = Alignment.Center
    ) {
        // 顶部高光
        Box(
            Modifier.matchParentSize().clip(CircleShape)
                .background(glassHighlight(isDark))
        )
        Box(Modifier.padding(0.dp), contentAlignment = Alignment.Center) {
            androidx.compose.material3.Icon(
                icon, contentDescription = contentDescription,
                tint = iconColor, modifier = Modifier.size(size * 0.6f)
            )
        }
    }
}
