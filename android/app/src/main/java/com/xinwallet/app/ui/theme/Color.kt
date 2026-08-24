package com.xinwallet.app.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * 暖棕主题（与 Web 端 Design Token 完全一致）
 * 主色取自 Web tokens.css「Warm Brown 智财品牌色」：accent-500 = oklch(54% 0.10 60) → #995F2C
 * OKLCH → hex 由脚本精确换算（见会话记录）。语义色保持：收入红 / 支出绿（与 Web 约定一致）。
 * 品牌强调色 Brown* 直接引用，供图表 / 选中态 / 渐变卡使用（非 ColorScheme）。
 */

/* ====== 亮色 ====== */
val md_theme_light_primary = Color(0xFF995F2C)             // accent-500 主品牌（暖棕）
val md_theme_light_onPrimary = Color(0xFFFFFFFF)
val md_theme_light_primaryContainer = Color(0xFFF8D7BE)    // accent-100 浅填充
val md_theme_light_onPrimaryContainer = Color(0xFF2E1200)  // accent-900 深字
val md_theme_light_secondary = Color(0xFFD39562)           // accent-300 次强调
val md_theme_light_onSecondary = Color(0xFF2E1200)
val md_theme_light_secondaryContainer = Color(0xFFEBB890)  // accent-200
val md_theme_light_onSecondaryContainer = Color(0xFF2E1200)
val md_theme_light_tertiary = Color(0xFFB58300)            // warning-500 备用强调（会员/积分/预算告警）
val md_theme_light_onTertiary = Color(0xFFFFFFFF)
val md_theme_light_tertiaryContainer = Color(0xFFFCEFE5)   // accent-50
val md_theme_light_onTertiaryContainer = Color(0xFF2E1200)

val md_theme_light_background = Color(0xFFFDFBFA)          // gray-0 近白暖灰
val md_theme_light_onBackground = Color(0xFF120C07)        // gray-900
val md_theme_light_surface = Color(0xFFFFFFFF)            // 卡片白
val md_theme_light_onSurface = Color(0xFF120C07)
val md_theme_light_surfaceVariant = Color(0xFFEBE7E3)      // gray-100 分组底
val md_theme_light_onSurfaceVariant = Color(0xFF4F4944)    // gray-600 次级文字
val md_theme_light_outline = Color(0xFFB9B3AE)             // gray-300 浅边框
val md_theme_light_outlineVariant = Color(0xFFD8D3CF)      // gray-200
val md_theme_light_error = Color(0xFFC11435)              // error-500 红
val md_theme_light_onError = Color(0xFFFFFFFF)
val md_theme_light_errorContainer = Color(0xFFFBE7E9)      // 浅红容器
val md_theme_light_onErrorContainer = Color(0xFF7A0B22)

/* ====== 暗色（深暖炭灰，对齐 Web dark token） ====== */
val md_theme_dark_primary = Color(0xFFB6753B)              // accent-400 暗色交互主色
val md_theme_dark_onPrimary = Color(0xFF0D0804)
val md_theme_dark_primaryContainer = Color(0xFF342C26)    // dark-container
val md_theme_dark_onPrimaryContainer = Color(0xFFF8D7BE)
val md_theme_dark_secondary = Color(0xFFD39562)
val md_theme_dark_onSecondary = Color(0xFF0D0804)
val md_theme_dark_secondaryContainer = Color(0xFF61370D)  // accent-700
val md_theme_dark_onSecondaryContainer = Color(0xFFF8D7BE)
val md_theme_dark_tertiary = Color(0xFFB58300)
val md_theme_dark_onTertiary = Color(0xFF0D0804)
val md_theme_dark_tertiaryContainer = Color(0xFF342C26)
val md_theme_dark_onTertiaryContainer = Color(0xFFFCEFE5)

val md_theme_dark_background = Color(0xFF18130E)          // dark-bg 深暖炭灰（非纯黑）
val md_theme_dark_onBackground = Color(0xFFEAE3DE)
val md_theme_dark_surface = Color(0xFF29231D)            // dark-surface
val md_theme_dark_onSurface = Color(0xFFEAE3DE)
val md_theme_dark_surfaceVariant = Color(0xFF39312B)      // dark-surfaceVariant
val md_theme_dark_onSurfaceVariant = Color(0xFFAAA39D)
val md_theme_dark_outline = Color(0xFF5E5650)             // dark-outline
val md_theme_dark_outlineVariant = Color(0xFF3A332E)
val md_theme_dark_error = Color(0xFFED324B)              // error-400
val md_theme_dark_onError = Color(0xFF0D0804)
val md_theme_dark_errorContainer = Color(0xFF3A1018)
val md_theme_dark_onErrorContainer = Color(0xFFED324B)

/* ====== 语义色（收入红 / 支出绿，与 Web 完全一致：income=error-500, expense=success-500） ====== */
val IncomeColor = Color(0xFFC11435)        // error-500 红
val ExpenseColor = Color(0xFF009558)       // success-500 绿
val IncomeColorDark = Color(0xFFED324B)    // error-400 亮红
val ExpenseColorDark = Color(0xFF00B870)   // success-400 亮绿

/* ====== 品牌强调色（暖棕系，供图表/选中态/渐变卡直接引用，非 ColorScheme） ====== */
val Brown500 = Color(0xFF995F2C)   // accent-500
val Brown300 = Color(0xFFD39562)   // accent-300
val Brown200 = Color(0xFFEBB890)   // accent-200
val Brown100 = Color(0xFFF8D7BE)   // accent-100
val Brown50  = Color(0xFFFCEFE5)   // accent-50

/* FAB 专用：黑色大圆 + 白色 + 号（与暖棕品牌色解耦，强调"加号"动作） */
val FabBackground = Color(0xFF111827)      // gray-900
val FabForeground = Color(0xFFFFFFFF)

/* ====== 薄荷青备选强调色（保留备用，目前未启用） ====== */
/* 搜索筛选的选中态/分组竖条/应用按钮统一改用品牌棕 Brown500，
   与账单页、鸿蒙端保持一致，避免青色在暖棕体系里显突兀。 */
val Teal400 = Color(0xFF4DD0C4)            // 主填充
val Teal600 = Color(0xFF26A69A)            // 文本/按压
val Teal200 = Color(0xFFB2EBE6)            // 浅高亮底
