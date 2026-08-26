package com.xinwallet.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiEvaluationRunResponse
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.EvaluationViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 模型评测页：运行离线评测套件 → 展示各识别维度命中率 + 与基线的回归对比 + 历史跑批列表。
 * 不依赖对话服务商（纯本地 CPU 跑批）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EvaluationScreen(navController: NavHostController) {
    val vm: EvaluationViewModel = viewModel(factory = viewModelFactory { EvaluationViewModel(AppContainer.aiRepository) })
    val state by vm.state.collectAsState()

    Scaffold(
        topBar = { TopBar(title = "📊 模型评测", onBack = { navController.popBackStack() }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Column(Modifier.fillMaxWidth()) {
                    Text("离线评测套件", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text("在固定评测集上跑批，比对各识别维度的命中率，并自动与最近一次跑批做回归对比。不依赖对话服务商。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.run() }, enabled = !state.running, modifier = Modifier.fillMaxWidth()) {
                        if (state.running) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("评测中…可能耗时数秒")
                        } else {
                            Text("▶ 运行评测")
                        }
                    }
                }
            }
            if (state.error != null) item {
                Text(state.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            state.result?.let { res -> item { ResultSection(res) } }
            item { Text("历史跑批", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
            if (state.history.isEmpty()) item {
                Text("暂无历史记录", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(state.history, key = { (it["id"]?.toString() ?: "${state.history.indexOf(it)}") }) { run -> HistoryRow(run) }
        }
    }
}

@Composable
private fun ResultSection(res: AiEvaluationRunResponse) {
    val summary = res.summary
    val totalCases = (summary["total_cases"] as? Number)?.toInt() ?: 0
    val passedCases = (summary["passed_cases"] as? Number)?.toInt() ?: 0
    val dsVer = summary["dataset_version"]?.toString() ?: "?"

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(Modifier.padding(14.dp)) {
                Text("本次结果", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(6.dp))
                Text("通过用例：$passedCases / $totalCases", style = MaterialTheme.typography.bodyMedium)
                Text("数据集版本：$dsVer", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        MetricsGrid(res.metrics)
        RegressionView(res.regression)
    }
}

@Composable
private fun MetricsGrid(metrics: Map<String, Any?>) {
    val bases = listOf(
        "count" to "笔数", "amount" to "金额", "type" to "类型",
        "category" to "类目", "date" to "日期", "verdict" to "结论"
    )
    val rows = bases.mapNotNull { (base, label) ->
        val total = (metrics["${base}_total"] as? Number)?.toDouble()
        val hit = (metrics["${base}_hit"] as? Number)?.toDouble()
        if (total != null && hit != null) {
            val acc = if (total > 0) hit / total * 100 else 0.0
            label to "%s / %s  (%.1f%%)".format(hit.toLong().toString(), total.toLong().toString(), acc)
        } else null
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("识别维度命中率", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                rows.forEach { (label, v) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(v, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun RegressionView(regression: Map<String, Any?>) {
    val hasBaseline = regression["has_baseline"] as? Boolean ?: false
    val deltas = regression["deltas"] as? Map<*, *>
    val regressions = regression["regressions"] as? List<*> ?: emptyList<Any?>()
    val improvements = regression["improvements"] as? List<*> ?: emptyList<Any?>()

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text("回归对比", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(6.dp))
            Text(if (hasBaseline) "已与最近一次跑批对比" else "暂无基线（这是首次跑批）", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            deltas?.let {
                Spacer(Modifier.height(4.dp))
                for ((k, v) in it) {
                    val dv = (v as? Number)?.toDouble() ?: 0.0
                    Text("· $k 变化：${"%.1f".format(dv * 100)}%", style = MaterialTheme.typography.bodySmall)
                }
            }
            if (regressions.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("⚠️ 回归 ${regressions.size} 项", color = Color(0xFFE53935), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                regressions.forEach { Text("  - $it", style = MaterialTheme.typography.bodySmall, color = Color(0xFFE53935)) }
            }
            if (improvements.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("✅ 提升 ${improvements.size} 项", color = Color(0xFF43A047), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                improvements.forEach { Text("  + $it", style = MaterialTheme.typography.bodySmall, color = Color(0xFF43A047)) }
            }
        }
    }
}

@Composable
private fun HistoryRow(run: Map<String, Any?>) {
    val id = run["id"]?.toString() ?: "?"
    val label = run["label"]?.toString() ?: ""
    val dsVer = run["dataset_version"]?.toString() ?: "?"
    val total = (run["total_cases"] as? Number)?.toInt() ?: 0
    val passed = (run["passed_cases"] as? Number)?.toInt() ?: 0
    val created = run["created_at"]?.toString() ?: ""

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("#$id${if (label.isNotBlank()) " · $label" else ""}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Text("通过 $passed/$total · 数据集 $dsVer", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(created, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
