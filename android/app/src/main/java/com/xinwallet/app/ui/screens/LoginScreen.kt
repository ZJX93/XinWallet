package com.xinwallet.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.viewmodel.LoginViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import kotlinx.coroutines.launch

// 占位判断：只挡"完全没值"与精确等于旧默认占位的两种情况。
// 带端口的 localhost/127.0.0.1（如 http://localhost:18888/api/）是真实地址，不算占位，
// 否则本地开发每次启动都强制弹服务器输入框会很烦。
private fun isPlaceholderUrl(url: String): Boolean =
    url.isBlank() || url == "http://localhost/api/" || url == "http://127.0.0.1/api/"

// UI 上隐藏 baseUrl 末尾的 /api 后缀（内部 Retrofit baseUrl 仍保留 /api 以正确拼接口路径）
private fun stripApiSuffix(url: String): String = url.replace(Regex("/api/?$"), "")

@Composable
fun LoginScreen(onLoginSuccess: () -> Unit) {
    val vm: LoginViewModel = viewModel(factory = viewModelFactory { LoginViewModel(AppContainer.authRepository) })
    val state by vm.state.collectAsState()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    // 「记住密码」勾选态。初值由 CredentialStore 在 LaunchedEffect 里回填
    var rememberPwd by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf("") }
    var showServer by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val saved = AppContainer.normalizeBaseUrl(AppContainer.sessionManager.baseUrl())
        serverUrl = if (isPlaceholderUrl(saved)) "" else saved
        showServer = serverUrl.isBlank()
        vm.loadConfig()
        // 记住密码：勾选过则回填用户名+密码（密码来自 EncryptedSharedPreferences）
        val cs = AppContainer.credentialStore
        rememberPwd = cs.isRemember()
        if (rememberPwd) {
            val u = cs.savedUsername()
            val p = cs.savedPassword()
            if (u.isNotBlank()) username = u
            if (p.isNotBlank()) password = p
        }
        // 未勾选记住密码时，退回只预填上次成功登录的用户名（密码交给系统 Autofill）
        if (username.isBlank()) username = AppContainer.sessionManager.lastUsername()
    }
    LaunchedEffect(state.success) {
        if (state.success) {
            // 登录成功后拉取账本列表，写入当前账本（供 X-Book-Id 注入与切换 UI）
            try { AppContainer.loadBooks() } catch (_: Exception) { }
            onLoginSuccess()
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            vm.clearError()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("鑫钱包", style = MaterialTheme.typography.headlineMedium)
            Text("个人财务管家", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))

            if (showServer) {
                OutlinedTextField(
                    value = stripApiSuffix(serverUrl), onValueChange = { serverUrl = it },
                    label = { Text("NAS 服务器地址") },
                    placeholder = { Text("https://your-nas.com:18888") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = {
                        val url = AppContainer.normalizeBaseUrl(serverUrl)
                        if (url.isBlank()) {
                            scope.launch { snackbarHostState.showSnackbar("服务器地址不能为空") }
                            return@Button
                        }
                        scope.launch {
                            AppContainer.sessionManager.saveBaseUrl(url)
                            AppContainer.setBaseUrl(url)
                            serverUrl = url
                            showServer = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                ) { Text("保存地址") }
                Spacer(Modifier.height(16.dp))
            } else {
                TextButton(onClick = { showServer = true }) {
                    Text("服务器：${if (serverUrl.isBlank()) "未设置" else stripApiSuffix(serverUrl)}（点击修改）")
                }
            }

            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("用户名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(4.dp))
            // 「记住密码」：整行可点（Row.clickable），比只点小方块好按。
            // ⛔ 取消勾选时立刻 clear()，不能等到下次登录 —— 用户点掉就该真删，
            //    否则密码还躺在磁盘上，与"我关了"的预期不符。
            Row(
                modifier = Modifier.fillMaxWidth().clickable {
                    rememberPwd = !rememberPwd
                    if (!rememberPwd) AppContainer.credentialStore.clear()
                },
                verticalAlignment = Alignment.CenterVertically
            ) {
                Checkbox(
                    checked = rememberPwd,
                    onCheckedChange = {
                        rememberPwd = it
                        if (!it) AppContainer.credentialStore.clear()
                    }
                )
                Text("记住密码", style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    val url = AppContainer.normalizeBaseUrl(serverUrl)
                    if (url.isBlank()) {
                        showServer = true
                        scope.launch { snackbarHostState.showSnackbar("请先设置服务器地址") }
                        return@Button
                    }
                    AppContainer.setBaseUrl(url)
                    serverUrl = url
                    vm.login(username, password, rememberPwd)
                },
                enabled = !state.loading,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp) else Text("登录")
            }
            if (state.showDemo) {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = {
                        val url = AppContainer.normalizeBaseUrl(serverUrl)
                        if (url.isBlank()) {
                            showServer = true
                            scope.launch { snackbarHostState.showSnackbar("请先设置服务器地址") }
                            return@OutlinedButton
                        }
                        AppContainer.setBaseUrl(url)
                        serverUrl = url
                        vm.demoLogin()
                    },
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("体验 Demo 账号")
                }
            }
        }
    }
}
