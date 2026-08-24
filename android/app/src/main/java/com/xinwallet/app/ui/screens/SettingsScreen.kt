@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class
)

package com.xinwallet.app.ui.screens

import android.Manifest
import android.app.AppOpsManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.BuildConfig
import com.xinwallet.app.data.repository.ApkVerifier
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.viewmodel.ProfileViewModel
import com.xinwallet.app.ui.viewmodel.UpdateUiState
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import java.io.File
import kotlinx.coroutines.launch

/**
 * 「设置」独立页面（从「我的」页 12 宫格点入）。
 * 包含外观主题、服务器地址、关于我们（双击=检查更新）+ 应用内升级状态行。
 */
@Composable
fun SettingsScreen(navController: NavHostController) {
    val vm: ProfileViewModel = viewModel(factory = viewModelFactory {
        ProfileViewModel(AppContainer.sessionManager, AppContainer.authRepository)
    })
    val state by vm.state.collectAsState()
    val updateState by vm.updateState.collectAsState()
    val probeState by vm.probeState.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(state.baseUrl) }
    var showServerDialog by remember { mutableStateOf(false) }
    var serverInput by remember { mutableStateOf(server) }

    LaunchedEffect(state.baseUrl) { server = state.baseUrl }
    LaunchedEffect(state.message) { state.message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }
    LaunchedEffect(Unit) { vm.checkUpdate(BuildConfig.VERSION_NAME) }

    fun installApk(ctx: Context, path: String?) {
        if (path == null) return
        val file = File(path)
        if (!file.exists()) { scope.launch { snackbar.showSnackbar("安装包不存在，请重新下载") }; return }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            ctx.startActivity(intent)
        } catch (e: Exception) {
            scope.launch { snackbar.showSnackbar("无法调起安装器：${e.message}") }
        }
    }

    fun openUnknownSourcesSettings(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:${ctx.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try { ctx.startActivity(intent) } catch (_: Exception) {}
        }
    }

    fun canInstallPackages(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            appOps.unsafeCheckOpNoThrow(
                "android:request_install_packages",
                android.os.Process.myUid(),
                ctx.packageName
            ) == AppOpsManager.MODE_ALLOWED
        } else {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.REQUEST_INSTALL_PACKAGES) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    fun startInstall() {
        val path = updateState.localApkPath ?: return
        val result = ApkVerifier.verifyApk(context, File(path))
        if (!result.ok) {
            scope.launch { snackbar.showSnackbar(result.reason ?: "安装包校验失败") }
            return
        }
        if (canInstallPackages(context)) installApk(context, path)
        else {
            openUnknownSourcesSettings(context)
            scope.launch { snackbar.showSnackbar("请先在设置中开启「允许安装未知应用」，再返回点击安装") }
        }
    }

    Scaffold(
        topBar = { TopBar("设置", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
        ) {
            Spacer(Modifier.height(8.dp))

            // 外观主题
            SettingsRow(
                icon = Icons.Filled.Palette,
                title = "外观主题",
                subtitle = when (state.themeMode) { "light" -> "浅色"; "dark" -> "深色"; else -> "跟随系统" },
                onClick = {
                    val modes = listOf("light", "dark", "system")
                    val labels = listOf("浅色", "深色", "跟随系统")
                    val idx = modes.indexOf(state.themeMode).let { if (it < 0) 0 else it }
                    val next = (idx + 1) % 3
                    vm.setTheme(modes[next])
                    scope.launch { snackbar.showSnackbar("外观主题：${labels[next]}") }
                }
            )

            // 服务器地址
            SettingsRow(
                icon = Icons.Filled.Dns,
                title = "服务器地址",
                subtitle = state.baseUrl.replace(Regex("/api/?$"), "").ifBlank { "未设置（首次打开会自动写入「设置」里）" },
                onClick = { serverInput = server; showServerDialog = true }
            )

            // 服务器自检：探测当前 baseUrl 是否下发 transfer 字段。
            // 不是 SettingsRow 风格而是独立 Button，因为它是诊断动作而非配置项。
            // 触发后由 vm.probeServerSupportsTransfer() 用 HttpURLConnection 拉一条
            // /transactions?limit=1 检查响应体中有没有 "transfer" 字段名。
            // 返回结果用 AlertDialog 展示，关闭后清空。
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
            ) {
                OutlinedButton(
                    onClick = { vm.probeServerSupportsTransfer() },
                    enabled = !probeState.probing,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (probeState.probing) "正在探测…" else "🔍 测试服务器是否支持转账合并")
                }
            }

            // 关于我们（双击 = 检查更新）
            SettingsRow(
                icon = Icons.Filled.Info,
                title = "关于我们",
                subtitle = if (BuildConfig.VERSION_NAME.isNotBlank()) "v${BuildConfig.VERSION_NAME}  ·  双击检查更新" else "双击检查更新",
                onClick = { scope.launch { snackbar.showSnackbar("双击「关于我们」检查更新") } },
                onDoubleClick = { vm.checkUpdate(BuildConfig.VERSION_NAME) }
            )

            Spacer(Modifier.height(8.dp))
            AboutUpdateItem(
                updateState = updateState,
                onDownload = { vm.downloadUpdate(context) },
                onInstall = { startInstall() },
                onRetry = { vm.consumeUpdateError(); vm.checkUpdate(BuildConfig.VERSION_NAME) },
                onCopyLink = {
                    val cm = context.getSystemService(ClipboardManager::class.java)
                    cm.setPrimaryClip(ClipData.newPlainText("apkUrl", updateState.apkUrl))
                    Toast.makeText(context, "下载链接已复制，可粘贴到手机浏览器打开", Toast.LENGTH_SHORT).show()
                }
            )

            Spacer(Modifier.height(32.dp))
        }
    }

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            title = { Text("服务器地址") },
            text = {
                OutlinedTextField(
                    value = serverInput.replace(Regex("/api/?$"), ""),
                    onValueChange = { serverInput = it },
                    label = { Text("服务器地址") },
                    placeholder = { Text("https://your-nas.com:18888") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    server = serverInput
                    vm.saveServer(serverInput)
                    showServerDialog = false
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showServerDialog = false }) { Text("取消") } }
        )
    }

    // 服务器自检结果弹窗。summary 为 null 表示无结果不应显示；
    // 关闭后调 clearProbe() 避免下次进入设置页时残留。
    if (!probeState.probing && probeState.summary != null) {
        AlertDialog(
            onDismissRequest = { vm.clearProbe() },
            title = { Text(probeState.summary!!) },
            text = {
                Text(
                    probeState.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = { TextButton(onClick = { vm.clearProbe() }) { Text("知道了") } }
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    onClick: () -> Unit,
    onDoubleClick: (() -> Unit)? = null
) {
    val modifier = Modifier.fillMaxWidth()
    val base = if (onDoubleClick != null) {
        modifier.combinedClickable(onClick = onClick, onDoubleClick = onDoubleClick)
    } else {
        modifier.clickable(onClick = onClick)
    }
    Row(
        base.padding(horizontal = 16.dp, vertical = 14.dp),
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
    }
}

@Composable
private fun AboutUpdateItem(
    updateState: UpdateUiState,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onRetry: () -> Unit,
    onCopyLink: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
        ) {
            Column(Modifier.padding(14.dp)) {
                val status = when {
                    updateState.checking -> "正在检查新版本…"
                    updateState.error != null -> "检查失败：${updateState.error}"
                    updateState.latestVersion.isNotBlank() && !updateState.hasUpdate ->
                        "已是最新（v${updateState.latestVersion}）"
                    updateState.hasUpdate -> "发现新版本 v${updateState.latestVersion}"
                    else -> "应用更新状态"
                }
                Text(status, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(10.dp))
                when {
                    updateState.downloading -> {
                        LinearProgressIndicator(progress = { updateState.progress / 100f }, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(6.dp))
                        Text("下载中 ${updateState.progress}%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    updateState.localApkPath != null -> {
                        Button(onClick = onInstall, modifier = Modifier.fillMaxWidth()) { Text("安装更新包") }
                    }
                    updateState.hasUpdate -> {
                        Button(onClick = onDownload, modifier = Modifier.fillMaxWidth()) { Text("下载并安装 v${updateState.latestVersion}") }
                    }
                }
                if (updateState.error != null) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text("重试") }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = onCopyLink, modifier = Modifier.fillMaxWidth()) { Text("复制下载链接") }
                }
            }
        }
    }
}
