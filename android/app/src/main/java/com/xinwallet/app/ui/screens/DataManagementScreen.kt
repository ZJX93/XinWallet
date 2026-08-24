@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.xinwallet.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.repository.BackupRepository
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.DataManagementViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 数据管理（账本备份）— 与鸿蒙 DataManagement.ets 功能对齐。
 *
 * 导出：GET /backup/export 下发 xlsx，落盘到 App 外部私有目录的 Download/ 下
 *      （该路径已在 res/xml/file_paths.xml 声明为 exports，可通过 FileProvider 分享给微信/网盘/文件管理器）。
 * 导入：系统选择器挑 .xlsx → 先复制到 cacheDir（content:// Uri 无法直接当 File 上传）→ 上传恢复。
 *
 * 导入是破坏性操作（后端先清空当前账本再恢复），所以必须过一次确认弹窗。
 */
@Composable
fun DataManagementScreen(navController: NavHostController) {
    val vm: DataManagementViewModel = viewModel(factory = viewModelFactory {
        DataManagementViewModel(AppContainer.backupRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val ctx = LocalContext.current

    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }

    /** 选中 xlsx 后待确认的 Uri；非空时弹出「覆盖恢复」确认框 */
    var pendingImport by remember { mutableStateOf<Uri?>(null) }

    // 用 GetContent 而非 OpenDocument：前者在国产 ROM 的文件管理器兼容性更好。
    // MIME 传 xlsx 精确类型，部分文件管理器不认时用户仍可切「全部文件」。
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) pendingImport = uri
    }

    fun doExport() {
        val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date())
        val dir = File(ctx.getExternalFilesDir(null), "Download")
        vm.export(File(dir, "xinwallet_backup_$stamp.xlsx"))
    }

    fun shareExported(file: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = BackupRepository.XLSX_MIME
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching { ctx.startActivity(Intent.createChooser(send, "保存或发送备份")) }
            .onFailure { vm.fail("没有可用的分享目标，文件已保存在：${file.absolutePath}") }
    }

    /** 把 content:// 复制成 cacheDir 下的真实文件，才能作为 multipart 上传 */
    fun stageForUpload(uri: Uri): File? = runCatching {
        val tmp = File(ctx.cacheDir, "import_${System.currentTimeMillis()}.xlsx")
        ctx.contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { out -> input.copyTo(out) }
        } ?: return null
        if (tmp.length() <= 0L) null else tmp
    }.getOrNull()

    Scaffold(
        topBar = { TopBar("数据管理", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (state.busy) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                state.status?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            ActionCard(
                title = "导出账本备份",
                desc = "导出 xlsx（账本配置页 / 账户页 / 账单流水页 / 理财流水页），可识别、可恢复",
                button = "导出备份",
                enabled = !state.busy,
                onClick = { doExport() }
            ) {
                // 导出成功后追加一个分享入口，方便存到网盘或发给自己
                state.exported?.let { file ->
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { shareExported(file) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Share, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("保存 / 发送备份文件")
                    }
                }
            }

            ActionCard(
                title = "导入账本备份",
                desc = "选择此前导出的 xlsx，恢复全部账本数据（损坏时可还原）",
                button = "导入备份",
                enabled = !state.busy,
                onClick = { pickFile.launch(BackupRepository.XLSX_MIME) }
            )

            state.detail?.let {
                Card(
                    Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Text(
                        it,
                        Modifier.padding(14.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Text(
                "提示：导入会先清空当前账本再按备份恢复，请确认选对了文件与账本。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    pendingImport?.let { uri ->
        AlertDialog(
            onDismissRequest = { pendingImport = null },
            title = { Text("确认恢复备份？") },
            text = { Text("当前账本的账户、交易、分类等数据会被清空，然后按所选备份文件重建。此操作不可撤销。") },
            confirmButton = {
                TextButton(onClick = {
                    pendingImport = null
                    val staged = stageForUpload(uri)
                    if (staged == null) vm.fail("无法读取所选文件，请重新选择") else vm.import(staged)
                }) { Text("确认恢复") }
            },
            dismissButton = {
                TextButton(onClick = { pendingImport = null }) { Text("取消") }
            }
        )
    }
}

/** 标题 + 说明 + 主按钮的卡片，可选追加内容（如导出后的分享按钮） */
@Composable
private fun ActionCard(
    title: String,
    desc: String,
    button: String,
    enabled: Boolean,
    onClick: () -> Unit,
    extra: @Composable (() -> Unit)? = null
) {
    Card(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
            Text(desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth()) {
                Button(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text(button) }
            }
            extra?.invoke()
        }
    }
}
