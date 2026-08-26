@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.navigation.Screen
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.theme.Brown500

/**
 * AI 工具聚合页 — 收纳「我的」页宫格里所有 AI 子模块，集中跳转入口。
 *
 * 6 个子项（v0.2.1 起：AI 洞察已合并进 AI 建议，洞察/建议在 AiAdviceScreen 内分段展示）：
 *   ① 截图记账   — 上传截图/选图自动识别（Web 端对应"AI 识别"），页面 AiScanScreen
 *                   ⭐ 用户明确"AI 工具里的截图记账不能删除"：除了用本页进入，底栏 FAB → AI 记账对话
 *                   也可以发送图片（不与本页重复）。
 *   ② AI 建议    — 个性化财务改善建议 + 消费洞察（AiAdviceScreen，insight 已合并）
 *   ③ AI 服务商  — 配置 / 切换 AI 模型与服务商（ProviderListScreen）
 *   ④ AI 规则    — 查看 / 管理类目识别规则与样本（RuleListScreen）
 *   ⑤ 学习统计   — 规则样本量、准确率与置信度分布（LearningStatsScreen）
 *   ⑥ AI 评测    — 跑离线评测，对比模型准确率（EvaluationScreen）
 *
 * 设计：参照 SettingsScreen 的 TopBar + Card + SettingsRow 模式，
 * 与「我的」页 row1 第 1 位「AI 工具」宫格相配套，点击跳转对应 AI 子页。
 */
@Composable
fun AiToolsScreen(navController: NavHostController) {
    Scaffold(
        topBar = { TopBar("AI 工具", onBack = { navController.popBackStack() }) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
        ) {
            Spacer(Modifier.height(8.dp))
            // 顶部说明：与 SettingsScreen 顶部留白风格保持一致
            Text(
                "智能记账相关功能集中入口",
                modifier = Modifier.padding(horizontal = 20.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(12.dp))

            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column {
                    AiToolsRow(
                        icon = Icons.Filled.CameraAlt,
                        title = "截图记账",
                        subtitle = "上传截图或照片，AI 自动识别金额、商家、类目",
                        onClick = { navController.navigate(Screen.AiScan.route) }
                    )
                    RowDivider()
                    AiToolsRow(
                        icon = Icons.Filled.Lightbulb,
                        title = "AI 建议",
                        subtitle = "基于消费习惯生成的个性化财务改善建议（含消费洞察）",
                        onClick = { navController.navigate(Screen.AiAdvice.route) }
                    )
                    RowDivider()
                    AiToolsRow(
                        icon = Icons.Filled.Cloud,
                        title = "AI 服务商",
                        subtitle = "配置 / 切换 AI 模型与服务商（OpenAI / Anthropic / 自定义）",
                        onClick = { navController.navigate(Screen.ProviderList.route) }
                    )
                    RowDivider()
                    AiToolsRow(
                        icon = Icons.Filled.AccountTree,
                        title = "AI 规则",
                        subtitle = "查看 / 管理学到的类目识别规则与样本",
                        onClick = { navController.navigate(Screen.RuleList.route) }
                    )
                    RowDivider()
                    AiToolsRow(
                        icon = Icons.Filled.School,
                        title = "学习统计",
                        subtitle = "规则样本量、准确率与置信度分布",
                        onClick = { navController.navigate(Screen.LearningStats.route) }
                    )
                    RowDivider()
                    AiToolsRow(
                        icon = Icons.Filled.Assessment,
                        title = "模型评测",
                        subtitle = "跑离线评测，对比不同模型 / Prompt 的准确率",
                        onClick = { navController.navigate(Screen.Evaluation.route) }
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Text(
                "提示：所有数据保存在你自己的服务器，不上传给第三方。",
                modifier = Modifier.padding(horizontal = 20.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** 仿 SettingsScreen.SettingsRow 的私有行组件 — 图标 + 标题 + 副文案 */
@Composable
private fun AiToolsRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    onClick: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(Brown50),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = title, tint = Brown500, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2
                )
            }
        }
        Text(
            "›",
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            fontSize = 18.sp
        )
    }
}

/** 行间分隔线 — 1dp 浅色，避免 Card 内连续 7 行挤在一起 */
@Composable
private fun RowDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 70.dp, end = 16.dp)
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
    )
}
