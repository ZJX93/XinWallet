package com.xinwallet.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.AiProvider
import com.xinwallet.app.data.model.AiProviderPayload
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.ProviderViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/**
 * AI 服务商编辑/新建页。路由参数 `id=0` 表示新建，否则为编辑模式。
 *
 * 字段约束（与 server/routes/ai.js validateProvider 对齐）：
 *   - name / baseUrl / model 必填
 *   - apiType ∈ {openai, anthropic}
 *   - apiKey 在编辑模式下可留空 = 不修改原值（服务端按 trim 判定）
 *   - isActive 触发「单选激活」语义
 *
 * 默认值设计：
 *   - openai: baseUrl=https://api.openai.com/v1, model=gpt-4o-mini
 *   - anthropic: baseUrl=https://api.anthropic.com, model=claude-3-5-sonnet
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderEditScreen(
    navController: NavHostController,
    providerId: Int = 0,
) {
    val vm: ProviderViewModel = viewModel(factory = viewModelFactory {
        ProviderViewModel(AppContainer.aiRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val editing = providerId != 0
    val original = state.providers.firstOrNull { it.id == providerId }

    LaunchedEffect(state.toast) {
        state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() }
    }

    if (editing && state.providers.isEmpty() && !state.loading) {
        // 列表还在加载，先显示 spinner 防止「找不到规则」误判
        LoadingBox()
        return
    }
    if (editing && state.providers.isNotEmpty() && original == null) {
        // id 找不到（被并发删了）—— 弹一行提示后退出
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("服务商不存在或已被删除")
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { navController.popBackStack() }) { Text("返回") }
            }
        }
        return
    }

    var name by remember(original) { mutableStateOf(original?.name ?: "") }
    var apiType by remember(original) { mutableStateOf(original?.apiType ?: "openai") }
    var baseUrl by remember(original) { mutableStateOf(original?.baseUrl ?: "https://api.openai.com/v1") }
    var model by remember(original) { mutableStateOf(original?.model ?: "gpt-4o-mini") }
    var apiKey by remember(original) { mutableStateOf("") }   // 编辑模式永远从空开始（服务端按 trim 判定不修改）
    var isActive by remember(original) { mutableStateOf(original?.isActive ?: false) }
    var apiTypeMenuOpen by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()

    Scaffold(
        topBar = { TopBar(title = if (editing) "编辑服务商" else "新增服务商", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp).verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 编辑模式下提示用户「API Key 显示是掩码，留空表示不修改」
            if (editing && original != null) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("当前 Key（服务端掩码）：${original.apiKey}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer)
                        Text("如需修改请在下方输入新值；留空则保留原 Key。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                }
            }

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("名称 *") },
                placeholder = { Text("如：MiniMax、Claude 主账户") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // apiType 选择
            Box {
                OutlinedTextField(
                    value = apiType,
                    onValueChange = {},
                    label = { Text("接口类型 *") },
                    readOnly = true,
                    trailingIcon = {
                        Icon(Icons.Filled.ArrowDropDown, contentDescription = null,
                            modifier = Modifier.padding(8.dp).clickable { apiTypeMenuOpen = true })
                    },
                    modifier = Modifier.fillMaxWidth()
                )
                DropdownMenu(expanded = apiTypeMenuOpen, onDismissRequest = { apiTypeMenuOpen = false }) {
                    listOf("openai", "anthropic").forEach { t ->
                        DropdownMenuItem(
                            text = { Text(when (t) { "openai" -> "OpenAI 兼容（含国产转 OpenAI 协议）"; else -> "Anthropic Claude" }) },
                            onClick = {
                                apiType = t
                                apiTypeMenuOpen = false
                                // 切换类型时给一组合理的默认值（用户首次填表场景）
                                if (!editing) {
                                    if (t == "anthropic") {
                                        baseUrl = "https://api.anthropic.com"
                                        model = "claude-3-5-sonnet-latest"
                                    } else {
                                        baseUrl = "https://api.openai.com/v1"
                                        model = "gpt-4o-mini"
                                    }
                                }
                            }
                        )
                    }
                }
            }

            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("接口地址 *") },
                placeholder = { Text("https://... 含协议头，不含 /chat/completions 后缀") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text("模型名 *") },
                placeholder = { Text("如 gpt-4o-mini / claude-3-5-sonnet") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text(if (editing) "新 API Key（留空不改）" else "API Key *") },
                placeholder = { Text("sk-...") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("设为激活", fontWeight = FontWeight.Medium)
                    Text("启用后会取代其他服务商成为默认对话/转写模型",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = isActive, onCheckedChange = { isActive = it })
            }

            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { navController.popBackStack() },
                    modifier = Modifier.weight(1f)
                ) { Text("取消") }
                Button(
                    onClick = {
                        val payload = AiProviderPayload(
                            name = name.trim(),
                            apiType = apiType,
                            baseUrl = baseUrl.trim(),
                            apiKey = apiKey.trim(),
                            model = model.trim(),
                            isActive = isActive,
                        )
                        if (editing) vm.update(providerId, payload) { navController.popBackStack() }
                        else vm.create(payload) { navController.popBackStack() }
                    },
                    modifier = Modifier.weight(1f),
                    enabled = name.isNotBlank() && baseUrl.isNotBlank() && model.isNotBlank() && (apiKey.isNotBlank() || editing)
                ) { Text(if (editing) "保存" else "创建") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
