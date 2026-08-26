package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * 单条规则的证据流水（GET /ai/rules/:id/evidence）。
 *
 * 展示用户每一次确认/拒绝/修正的历史记录（最多 50 条，按时间倒序）。
 * 每条显示：日期 + 商家 + 类目 + 金额 + user_action。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuleEvidenceScreen(
    navController: NavHostController,
    ruleId: Int,
    title: String
) {
    var loading by remember { mutableStateOf(true) }
    var items by remember { mutableStateOf<List<Map<String, Any?>>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(ruleId) {
        scope.launch {
            loading = true
            when (val r = AppContainer.aiRepository.ruleEvidence(ruleId, limit = 50)) {
                is ApiResult.Success -> items = r.data.evidence ?: emptyList()
                is ApiResult.Error -> error = r.message
            }
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopBar(
                title = "📜 ${title.take(20)}",
                onBack = { navController.popBackStack() }
            )
        }
    ) { padding ->
        when {
            loading -> LoadingBox(modifier = Modifier.padding(padding))
            error != null -> EmptyState(
                title = "加载失败",
                desc = error!!,
                modifier = Modifier.padding(padding)
            )
            items.isEmpty() -> EmptyState(
                title = "暂无证据",
                desc = "用户尚未对此规则做过确认或修正",
                modifier = Modifier.padding(padding)
            )
            else -> {
                Column(modifier = Modifier.padding(padding).fillMaxSize()) {
                    Text(
                        "${items.size} 条证据",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
                    )
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(items, key = { (it["id"] ?: "").toString() }) { ev ->
                            EvidenceRow(ev)
                        }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EvidenceRow(ev: Map<String, Any?>) {
    val occurredAt = (ev["occurred_at"] ?: ev["created_at"]) as? String
    val userAction = (ev["user_action"] ?: ev["action"]) as? String ?: ""
    val merchant = (ev["merchant"] ?: ev["merchant_key"]) as? String
    val categoryName = (ev["category_name"] ?: ev["category"]) as? String
    val amount = (ev["amount"] as? Number)?.toDouble() ?: 0.0
    val note = ev["note"] as? String

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    formatDate(occurredAt),
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.weight(1f))
                ActionBadge(userAction)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "${merchant ?: "无商家"} → ${categoryName ?: "未知类目"}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "金额：¥${"%.2f".format(amount)}",
                style = MaterialTheme.typography.bodySmall,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            note?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(2.dp))
                Text(
                    "备注：$it",
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ActionBadge(action: String) {
    val (bg, label) = when (action) {
        "confirmed" -> androidx.compose.ui.graphics.Color(0xFF43A047) to "确认"
        "corrected" -> androidx.compose.ui.graphics.Color(0xFF1E88E5) to "修正"
        "rejected" -> androidx.compose.ui.graphics.Color(0xFFE53935) to "拒绝"
        else -> androidx.compose.ui.graphics.Color(0xFF888888) to action
    }
    androidx.compose.foundation.layout.Box(
        modifier = Modifier
            .background(
                color = bg,
                shape = androidx.compose.foundation.shape.RoundedCornerShape(4.dp)
            )
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            fontSize = 10.sp,
            color = androidx.compose.ui.graphics.Color.White,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Medium
        )
    }
}

private fun formatDate(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return try {
        val src = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        val date = src.parse(iso.take(19))
        val out = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
        out.format(date ?: return iso)
    } catch (_: Exception) { iso }
}
