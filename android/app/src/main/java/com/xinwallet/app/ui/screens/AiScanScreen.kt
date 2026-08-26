package com.xinwallet.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.DateTimePickerField
import com.xinwallet.app.ui.components.DropdownField
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.AiScanViewModel
import com.xinwallet.app.ui.viewmodel.ScanRow
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.PreparedImage
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.prepareImage
import kotlinx.coroutines.launch
import java.io.File

/**
 * AI 智能记账：拍照或从相册选账单截图 → 上传后端做 OCR + 交易项抽取 →
 * 逐条确认（可改金额/分类/日期/备注、可取消勾选）→ 选择入账账户批量写入流水。
 * 抽成不含独立 Scaffold 的可复用内容，供「记一笔」页面内联嵌入。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiScanContent(navController: NavHostController, contentPadding: androidx.compose.foundation.layout.PaddingValues = androidx.compose.foundation.layout.PaddingValues()) {
    val context = LocalContext.current
    val vm: AiScanViewModel = viewModel(factory = viewModelFactory {
        AiScanViewModel(
            AppContainer.aiRepository,
            AppContainer.accountRepository,
            AppContainer.categoryRepository,
            AppContainer.transactionRepository
        )
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var image by remember { mutableStateOf<PreparedImage?>(null) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    var preparing by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    // 解码 + 压缩放到 IO 线程，避免大图卡住主线程
    fun consume(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            preparing = true
            val prepared = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { prepareImage(context, uri) }
            preparing = false
            if (prepared == null) {
                snackbar.showSnackbar("图片读取失败，请换一张试试")
            } else {
                image = prepared
                vm.clearRows()
            }
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { consume(it) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) consume(cameraUri)
    }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.finished) { if (state.finished) navController.popBackStack() }

    if (state.loadingOptions) {
        LoadingBox()
        return
    }

    Box(Modifier.fillMaxSize().padding(contentPadding)) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f)) {
                if (!state.ocrConfigured) {
                    item { NoticeCard("尚未配置腾讯云 OCR 密钥，请先在 Web 端「AI 配置」页面填写 SecretId / SecretKey，否则识别会失败。") }
                }

                item {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                // 相机输出到 cache/images，路径需与 res/xml/file_paths.xml 中的 cache-path 对应。
                                // 整段包 try/catch：部分机型没有可用相机 App（ActivityNotFoundException），
                                // 或系统对拍照 Intent 有额外限制（SecurityException），不能让它直接崩掉页面。
                                try {
                                    val dir = File(context.cacheDir, "images").apply { mkdirs() }
                                    val file = File(dir, "bill_${System.currentTimeMillis()}.jpg")
                                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                    cameraUri = uri
                                    takePhoto.launch(uri)
                                } catch (e: Exception) {
                                    cameraUri = null
                                    scope.launch {
                                        snackbar.showSnackbar("无法调起相机（${e.javaClass.simpleName}），请改用「从相册选择」")
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Filled.PhotoCamera, null, Modifier.height(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("拍照")
                        }
                        OutlinedButton(onClick = { pickImage.launch("image/*") }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Filled.PhotoLibrary, null, Modifier.height(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("从相册选择")
                        }
                    }
                }

                image?.let { img ->
                    item {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                Image(
                                    bitmap = img.preview.asImageBitmap(),
                                    contentDescription = "账单图片",
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier.fillMaxWidth().heightIn(max = 260.dp)
                                )
                            }
                            Spacer(Modifier.height(12.dp))
                            Button(
                                onClick = { vm.recognize(img.bytes, "bill.jpg", "image/jpeg") },
                                enabled = !state.recognizing,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                if (state.recognizing) {
                                    CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text("识别中…")
                                } else Text(if (state.rows.isEmpty()) "开始识别" else "重新识别")
                            }
                            if (state.recognizing) {
                                Spacer(Modifier.height(8.dp))
                                LinearProgressIndicator(Modifier.fillMaxWidth())
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "正在做文字识别与交易项抽取，通常需要 3–15 秒",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (state.rows.isNotEmpty() && !state.recognizing) {
                                Spacer(Modifier.height(8.dp))
                                OutlinedButton(
                                    onClick = { image?.let { vm.retranscribe(it.bytes, "bill.jpg", "image/jpeg") } },
                                    enabled = !state.retranscribing,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    if (state.retranscribing) {
                                        CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp)
                                        Spacer(Modifier.width(8.dp))
                                        Text("腾讯 OCR 重新识别中…")
                                    } else {
                                        Text("🔄 识别有误？换腾讯 OCR 重试")
                                    }
                                }
                            }
                            Spacer(Modifier.height(12.dp))
                        }
                    }
                }

                if (image == null) {
                    item {
                        if (preparing) LoadingBox()
                        else EmptyState("拍一张账单/支付截图，AI 会自动提取每一笔消费")
                    }
                }

                state.reason?.let { reason ->
                    item { NoticeCard(reason) }
                }

                if (state.rows.isNotEmpty()) {
                    item {
                        Column(Modifier.padding(horizontal = 16.dp)) {
                            DropdownField(
                                label = "入账账户",
                                value = state.accounts.find { it.id == state.accountId }?.let { "${it.icon ?: ""} ${it.name}" } ?: "请选择",
                                options = state.accounts.map { "${it.icon ?: ""} ${it.name}" to it.id },
                                emptyHint = "暂无可用账户，请先在「账户」页添加",
                                onSelected = { vm.selectAccount(it) }
                            )
                            Spacer(Modifier.height(12.dp))
                            val total = state.rows.filter { it.selected }.sumOf { if (it.type == "income") it.amount else -it.amount }
                            Text(
                                "识别到 ${state.rows.size} 笔，已勾选 ${state.rows.count { it.selected }} 笔，合计 ${formatMoney(total)}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                    items(state.rows, key = { it.key }) { row ->
                        ScanRowCard(
                            row = row,
                            categories = state.categories.filter { it.type == row.type }.map { "${it.icon ?: ""} ${it.name}" to it.id },
                            onToggle = { vm.toggle(row.key) },
                            onAmount = { vm.setAmount(row.key, it) },
                            onNote = { vm.setNote(row.key, it) },
                            onDateTime = { vm.setDateTime(row.key, it) },
                            onType = { vm.setType(row.key, it) },
                            onCategory = { id -> state.categories.find { it.id == id }?.let { vm.setCategory(row.key, it) } }
                        )
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
            if (state.rows.isNotEmpty()) {
                val picked = state.rows.count { it.selected }
                Button(
                    onClick = { vm.submitAll() },
                    enabled = !state.submitting && picked > 0,
                    modifier = Modifier.fillMaxWidth().padding(16.dp)
                ) {
                    if (state.submitting) {
                        CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("入账中 ${state.doneCount}/$picked")
                    } else {
                        Text("确认入账 $picked 笔")
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiScanScreen(navController: NavHostController) {
    Scaffold(
        topBar = { TopBar("AI 智能记账", onBack = { navController.popBackStack() }) }
    ) { padding ->
        AiScanContent(navController, padding)
    }
}

@Composable
private fun NoticeCard(text: String) {
    Card(
        Modifier.fillMaxWidth().padding(16.dp),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
    ) {
        Text(
            text,
            Modifier.padding(14.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer
        )
    }
}

@Composable
private fun ScanRowCard(
    row: ScanRow,
    categories: List<Pair<String, Int>>,
    onToggle: () -> Unit,
    onAmount: (Double) -> Unit,
    onNote: (String) -> Unit,
    onDateTime: (String) -> Unit,
    onType: (String) -> Unit,
    onCategory: (Int) -> Unit
) {
    var amountText by remember(row.key) { mutableStateOf(trimAmount(row.amount)) }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (row.selected) MaterialTheme.colorScheme.surfaceVariant
            else MaterialTheme.colorScheme.surface
        )
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = row.selected, onCheckedChange = { onToggle() })
                OutlinedTextField(
                    value = row.name,
                    onValueChange = onNote,
                    label = { Text("备注 / 商户") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = amountText,
                    onValueChange = {
                        amountText = it.filter { c -> c.isDigit() || c == '.' }
                        onAmount(amountText.toDoubleOrNull() ?: 0.0)
                    },
                    label = { Text("金额") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.width(110.dp)
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                FilterChip(selected = row.type == "expense", onClick = { onType("expense") }, label = { Text("支出") })
                FilterChip(selected = row.type == "income", onClick = { onType("income") }, label = { Text("收入") })
            }
            Spacer(Modifier.height(8.dp))
            DropdownField(
                label = "分类",
                value = row.categoryName ?: "请选择",
                options = categories,
                emptyHint = "暂无可用分类",
                onSelected = onCategory
            )
            row.suggestedCategory?.let {
                Spacer(Modifier.height(4.dp))
                Text(
                    "AI 建议「$it」，本地没有同名分类，请手动选择",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
            Spacer(Modifier.height(8.dp))
            DateTimePickerField(
                label = "日期时间",
                value = "${row.date} ${row.time}",
                onValueChange = onDateTime
            )
        }
    }
}
