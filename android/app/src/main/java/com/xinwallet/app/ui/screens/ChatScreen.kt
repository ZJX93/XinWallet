package com.xinwallet.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.ChatMessage
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.viewmodel.ChatViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.formatMoney
import com.xinwallet.app.util.prepareImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/* ============================================================
 * 公共色（按截图蓝色信息气泡 / 暖棕系强调色）
 * ============================================================ */
private val IntroBubbleBg = Color(0xFFFCEFE5)
private val IntroBubbleBorder = Color(0xFFD39562)
private val IntroBubbleText = Color(0xFF2E1200)

/* ============================================================
 * 屏幕
 * ============================================================ */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(navController: NavHostController) {
    val context = LocalContext.current
    val app = context.applicationContext as android.app.Application
    val vm: ChatViewModel = viewModel(factory = viewModelFactory { ChatViewModel(app, AppContainer.aiRepository, AppContainer.transactionRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val scope = rememberCoroutineScope()

    val recordPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.startVoice()
        else scope.launch { snackbar.showSnackbar("需要录音权限才能使用语音输入") }
    }

    fun consume(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            val prepared = withContext(Dispatchers.IO) { prepareImage(context, uri) }
            if (prepared == null) snackbar.showSnackbar("图片读取失败，请换一张试试")
            else vm.sendImage(Base64.encodeToString(prepared.bytes, Base64.NO_WRAP), "image/jpeg")
        }
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { consume(it) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) consume(cameraUri) }

    var showClearConfirm by remember { mutableStateOf(false) }

    // 上下文 chips 状态
    val books by AppContainer.books.collectAsState()
    val currentBookId by AppContainer.currentBookId.collectAsState()
    var notReimbursable by remember { mutableStateOf(false) }
    var chatLocation by remember { mutableStateOf("") }
    var showBookSheet by remember { mutableStateOf(false) }
    var showLocationDialog by remember { mutableStateOf(false) }
    var locationDraft by remember { mutableStateOf("") }

    // 地点定位：权限 + 定位中状态
    var isLocating by remember { mutableStateOf(false) }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { perms ->
        val granted = perms[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            perms[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) {
            isLocating = true
            scope.launch {
                val addr = getCurrentLocation(context)
                if (addr != null) locationDraft = addr
                isLocating = false
                if (addr == null) snackbar.showSnackbar("无法获取定位，请检查GPS是否开启")
            }
        } else {
            isLocating = false
            scope.launch { snackbar.showSnackbar("未授予定位权限") }
        }
    }

    var accounts by remember { mutableStateOf<List<com.xinwallet.app.data.model.Account>>(emptyList()) }
    var selectedAccountId by remember { mutableStateOf<Int?>(null) }
    var showAccountSheet by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val resp = AppContainer.accountRepository.getAccounts()
        if (resp is ApiResult.Success) {
            accounts = resp.data.accounts
            selectedAccountId = accounts.firstOrNull { it.isDefault }?.id ?: accounts.firstOrNull()?.id
        }
    }

    fun launchCamera() {
        try {
            val dir = File(context.cacheDir, "images").apply { mkdirs() }
            val file = File(dir, "chat_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            cameraUri = uri
            takePhoto.launch(uri)
        } catch (e: Exception) {
            pickImage.launch("image/*")
        }
    }

    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.clearError() } }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.clearToast() } }

    val listState = rememberLazyListState()
    LaunchedEffect(state.messages.size, state.thinking) {
        if (state.messages.isNotEmpty() || state.thinking) {
            val target = if (state.thinking) state.messages.size else state.messages.size - 1
            if (target >= 0) listState.animateScrollToItem(target)
        }
    }

    // 录音计时
    var elapsed by remember { mutableStateOf(0) }
    LaunchedEffect(state.recording) {
        if (state.recording) {
            elapsed = 0
            while (state.recording) { delay(500); elapsed += 500 }
        }
    }

    val isEmpty = state.messages.isEmpty() && !state.thinking

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        topBar = {
            ChatTopBar(
                onBack = { navController.popBackStack() },
                onClear = { showClearConfirm = true }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            Column(Modifier.background(MaterialTheme.colorScheme.background).imePadding()) {
                // 输入区上方的快捷 chips 行（账本/账户/不关联/地点）
                ChatContextChipsRow(
                    bookName = books.find { it.id == currentBookId }?.name ?: "默认账本",
                    accountName = accounts.find { it.id == selectedAccountId }?.name ?: "选择账户",
                    notReimbursable = notReimbursable,
                    location = chatLocation,
                    onPickBook = { showBookSheet = true },
                    onPickAccount = { showAccountSheet = true },
                    onToggleNotReimbursable = { notReimbursable = !notReimbursable },
                    onPickLocation = { locationDraft = chatLocation; showLocationDialog = true }
                )
                // 输入栏
                ChatInputBar(
                    input = state.input,
                    onInput = { vm.onInputChange(it) },
                    recording = state.recording,
                    elapsedMs = elapsed.toLong(),
                    transcribing = state.transcribing,
                    onVoice = {
                        if (state.recording) {
                            vm.stopVoice()
                        } else {
                            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                                android.content.pm.PackageManager.PERMISSION_GRANTED
                            if (granted) vm.startVoice() else recordPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    onCamera = { launchCamera() },
                    onImage = { pickImage.launch("image/*") },
                    onSend = { vm.sendText() },
                    sending = state.sending
                )
            }

            if (showClearConfirm) {
                AlertDialog(
                    onDismissRequest = { showClearConfirm = false },
                    title = { Text("清空对话") },
                    text = { Text("确认清空当前对话历史吗？该操作不可撤销。") },
                    confirmButton = {
                        TextButton(onClick = { showClearConfirm = false; vm.clearMessages() }) { Text("清空", color = MaterialTheme.colorScheme.error) }
                    },
                    dismissButton = { TextButton(onClick = { showClearConfirm = false }) { Text("取消") } }
                )
            }
            // 账本选择
            if (showBookSheet) {
                androidx.compose.material3.ModalBottomSheet(
                    onDismissRequest = { showBookSheet = false },
                    sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text("选择账本", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                        books.forEach { book ->
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable {
                                        scope.launch { AppContainer.switchBook(book.id) }
                                        showBookSheet = false
                                    }
                                    .padding(vertical = 12.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(book.icon.ifBlank { "📒" }, fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(book.name, style = MaterialTheme.typography.bodyLarge)
                                    if (book.isDefault) Text("默认账本", style = MaterialTheme.typography.labelSmall, color = Brown500)
                                }
                                if (currentBookId == book.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                            }
                            androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        }
                    }
                }
            }
            // 账户选择
            if (showAccountSheet) {
                androidx.compose.material3.ModalBottomSheet(
                    onDismissRequest = { showAccountSheet = false },
                    sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text("选择账户", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                        accounts.forEach { acc ->
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable { selectedAccountId = acc.id; showAccountSheet = false }
                                    .padding(vertical = 12.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(acc.icon ?: "💰", fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(acc.name, style = MaterialTheme.typography.bodyLarge)
                                    Text("余额 ${formatMoney(acc.balance)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (selectedAccountId == acc.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                            }
                            androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        }
                    }
                }
            }
            // 地点输入
            if (showLocationDialog) {
                AlertDialog(
                    onDismissRequest = { showLocationDialog = false },
                    title = { Text("地点") },
                    text = {
                        Column {
                            OutlinedTextField(
                                value = locationDraft,
                                onValueChange = { locationDraft = it },
                                singleLine = true,
                                placeholder = { Text("输入地点（如：合肥、公司）") },
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(
                                onClick = {
                                    val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                                        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                                    if (hasPermission) {
                                        isLocating = true
                                        scope.launch {
                                            val addr = getCurrentLocation(context)
                                            if (addr != null) locationDraft = addr
                                            isLocating = false
                                            if (addr == null) snackbar.showSnackbar("无法获取定位，请检查GPS是否开启")
                                        }
                                    } else {
                                        locationPermissionLauncher.launch(arrayOf(
                                            Manifest.permission.ACCESS_FINE_LOCATION,
                                            Manifest.permission.ACCESS_COARSE_LOCATION
                                        ))
                                    }
                                },
                                enabled = !isLocating,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Filled.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp), tint = Brown500)
                                Spacer(Modifier.width(6.dp))
                                Text(if (isLocating) "定位中…" else "获取设备定位")
                            }
                        }
                    },
                    confirmButton = { TextButton(onClick = { chatLocation = locationDraft.trim(); showLocationDialog = false }) { Text("保存") } },
                    dismissButton = {
                        Row {
                            if (chatLocation.isNotBlank()) {
                                TextButton(onClick = { chatLocation = ""; locationDraft = ""; showLocationDialog = false }) { Text("清除", color = MaterialTheme.colorScheme.error) }
                            }
                            TextButton(onClick = { showLocationDialog = false }) { Text("取消") }
                        }
                    }
                )
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (isEmpty) {
                // 空态：AI 信息气泡（截图风格）
                AiIntroPanel()
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.messages.size) { index ->
                        val msg = state.messages[index]
                        ChatBubble(
                            msg = msg,
                            onEdit = { txnId -> navController.navigate("edit/$txnId") },
                            onDelete = { txnId -> vm.deleteTransaction(txnId) }
                        )
                    }
                    if (state.thinking) {
                        item { ThinkingBubble() }
                    }
                }
            }
        }
    }
}

/* ============================================================
 * 顶部栏：返回 / AI记账 / 内容由AI生成（右上副标题）/ 清空
 * ============================================================ */
@Composable
private fun ChatTopBar(onBack: () -> Unit, onClear: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .statusBarsPadding()
            .height(56.dp)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
        }
        Text(
            "AI记账",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        IconButton(onClick = onClear) {
            Icon(Icons.Filled.Delete, contentDescription = "清空", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/* ============================================================
 * 空态：AI 自我介绍蓝色信息气泡 + 右上「清空」按钮
 * ============================================================ */
@Composable
private fun AiIntroPanel() {
    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 12.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(IntroBubbleBg)
                .border(1.dp, IntroBubbleBorder, RoundedCornerShape(14.dp))
                .padding(14.dp)
        ) {
            Text(
                """Hi您好 我是小鑫，您的AI记账助手！
只要像聊天一样告诉我花费，我就能帮您快速记账：
1、直接输入一段描述，例如「中午吃牛肉面28元」
2、拍照或从相册上传小票/截图，我来帮您识别
3、点麦克风开始说话，再点一下结束，语音自动转文字
4、识别完成后会生成账单，您可以在卡片里修改或删除
小提示：包含金额、类别/用途、时间(可选)信息会更准确哦""",
                style = MaterialTheme.typography.bodyMedium,
                color = IntroBubbleText,
                lineHeight = 20.sp
            )
        }
        Spacer(Modifier.weight(1f))
    }
}

/* ============================================================
 * 上下文 chip 行：账本 / 账户 / 不关联 / 地点（可点击交互）
 * ============================================================ */
@Composable
private fun ChatContextChipsRow(
    bookName: String,
    accountName: String,
    notReimbursable: Boolean,
    location: String,
    onPickBook: () -> Unit,
    onPickAccount: () -> Unit,
    onToggleNotReimbursable: () -> Unit,
    onPickLocation: () -> Unit
) {
    val scroll = rememberScrollState()
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(scroll)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ChatChip(icon = Icons.Filled.MenuBook, label = bookName, onClick = onPickBook)
        ChatChip(icon = Icons.Filled.AccountBox, label = accountName, onClick = onPickAccount)
        ChatChip(
            icon = Icons.Filled.LinkOff,
            label = if (notReimbursable) "不关联 ✓" else "不关联",
            active = notReimbursable,
            onClick = onToggleNotReimbursable
        )
        ChatChip(
            icon = Icons.Filled.LocationOn,
            label = if (location.isBlank()) "添加地点" else location,
            onClick = onPickLocation
        )
    }
}

@Composable
private fun ChatChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    val mod = if (onClick != null) Modifier.clickable { onClick() } else Modifier
    val bg = if (active) Brown500 else Brown50
    val border = if (active) Brown500 else Brown100
    val fg = if (active) Color.White else MaterialTheme.colorScheme.onSurface
    val iconColor = if (active) Color.White else Brown500
    Row(
        modifier = mod
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}

/* ============================================================
 * 聊天气泡（保留）
 * ============================================================ */
@Composable
private fun ChatBubble(
    msg: ChatMessage,
    onEdit: (Int) -> Unit = {},
    onDelete: (Int) -> Unit = {}
) {
    val isUser = msg.role == "user"
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (isUser) Alignment.End else Alignment.Start) {
        Text(
            if (isUser) "我" else "AI",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 2.dp)
        )
        if (isUser && msg.imageBase64 != null) {
            val bytes = Base64.decode(msg.imageBase64, Base64.NO_WRAP)
            val bmp = remember(msg.imageBase64) { android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.padding(bottom = 4.dp)
            ) {
                bmp?.let {
                    androidx.compose.foundation.Image(
                        bitmap = it, contentDescription = "截图",
                        modifier = Modifier.width(180.dp).padding(6.dp)
                    )
                } ?: Text("📷 截图", Modifier.padding(10.dp))
            }
        }
        Card(
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
            ),
            modifier = Modifier.fillMaxWidth(0.82f)
        ) {
            Column(Modifier.padding(12.dp)) {
                if (msg.content.isNotBlank()) {
                    Text(
                        msg.content,
                        color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                msg.transactions.forEach { tx ->
                    val actionLabel = when (tx.action) {
                        "updated" -> "已更新"
                        "deleted" -> "已删除"
                        else -> "已记一笔"
                    }
                    val typeLabel = when (tx.type) {
                        "income" -> "收入"
                        "transfer" -> "转账"
                        else -> "支出"
                    }
                    val sign = when {
                        tx.action == "deleted" -> ""
                        tx.type == "income" -> "+"
                        else -> "-"
                    }
                    val containerColor = when (tx.action) {
                        "updated" -> MaterialTheme.colorScheme.secondaryContainer
                        "deleted" -> MaterialTheme.colorScheme.errorContainer
                        else -> MaterialTheme.colorScheme.primaryContainer
                    }
                    val contentColor = when (tx.action) {
                        "updated" -> MaterialTheme.colorScheme.onSecondaryContainer
                        "deleted" -> MaterialTheme.colorScheme.onErrorContainer
                        else -> MaterialTheme.colorScheme.onPrimaryContainer
                    }
                    Card(
                        Modifier.fillMaxWidth().padding(top = 8.dp),
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = containerColor)
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text("$actionLabel · $typeLabel", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium, color = contentColor)
                            Text("$sign${formatMoney(tx.amount)}", style = MaterialTheme.typography.titleMedium, color = contentColor)
                            val sub = listOfNotNull(tx.categoryName, tx.accountName, tx.date).joinToString(" · ")
                            if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.labelSmall, color = contentColor)
                            // 修改 / 删除 按钮（仅对已创建或已更新的交易显示，已删除的不显示）
                            if (tx.action != "deleted" && tx.id > 0) {
                                Row(
                                    Modifier.fillMaxWidth().padding(top = 6.dp),
                                    horizontalArrangement = Arrangement.End
                                ) {
                                    Row(
                                        Modifier
                                            .clip(RoundedCornerShape(50))
                                            .background(contentColor.copy(alpha = 0.12f))
                                            .clickable { onEdit(tx.id) }
                                            .padding(horizontal = 12.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Filled.Edit, contentDescription = "修改", modifier = Modifier.size(14.dp), tint = contentColor)
                                        Spacer(Modifier.width(4.dp))
                                        Text("修改", style = MaterialTheme.typography.labelSmall, color = contentColor)
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    Row(
                                        Modifier
                                            .clip(RoundedCornerShape(50))
                                            .background(contentColor.copy(alpha = 0.12f))
                                            .clickable { onDelete(tx.id) }
                                            .padding(horizontal = 12.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(Icons.Filled.Delete, contentDescription = "删除", modifier = Modifier.size(14.dp), tint = contentColor)
                                        Spacer(Modifier.width(4.dp))
                                        Text("删除", style = MaterialTheme.typography.labelSmall, color = contentColor)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ThinkingBubble() {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.width(18.dp), strokeWidth = 2.dp)
        Text(" AI 思考中…", Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/* ============================================================
 * 输入栏（按截图：麦克风 / 文本 / 相机 / 相册 / 发送）
 * ============================================================ */
@Composable
private fun ChatInputBar(
    input: String,
    onInput: (String) -> Unit,
    recording: Boolean,
    elapsedMs: Long = 0,
    transcribing: Boolean = false,
    onVoice: () -> Unit,
    onCamera: () -> Unit,
    onImage: () -> Unit,
    onSend: () -> Unit,
    sending: Boolean
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp)) {
        if (recording) {
            val transition = rememberInfiniteTransition()
            val alpha by transition.animateFloat(
                initialValue = 1f, targetValue = 0.25f,
                animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse)
            )
            val secs = (elapsedMs / 1000).toInt()
            val time = "%02d:%02d".format(secs / 60, secs % 60)
            Row(
                Modifier.fillMaxWidth().padding(bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error.copy(alpha = alpha)))
                Spacer(Modifier.width(8.dp))
                Text("正在聆听…说完点麦克风停止", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                Spacer(Modifier.weight(1f))
                Text(time, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
            }
        }
        if (transcribing) {
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("正在识别语音…", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onVoice, enabled = !sending && !transcribing, modifier = Modifier.size(40.dp)) {
                if (transcribing) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                } else {
                    Icon(if (recording) Icons.Filled.Stop else Icons.Filled.Mic, if (recording) "停止" else "语音",
                        tint = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val interactionSource = remember { MutableInteractionSource() }
            val isFocused by interactionSource.collectIsFocusedAsState()
            val enabled = !recording
            BasicTextField(
                value = input,
                onValueChange = onInput,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 36.dp, max = 100.dp),
                enabled = enabled,
                singleLine = false,
                maxLines = 4,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                interactionSource = interactionSource,
                decorationBox = { innerTextField ->
                    Box(
                        Modifier.fillMaxWidth(),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        if (input.isBlank()) {
                            Text(
                                "点击输入文字",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyLarge,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        innerTextField()
                    }
                }
            )
            IconButton(onClick = onCamera, enabled = !recording, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Filled.CameraAlt, contentDescription = "拍照", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onImage, enabled = !recording, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Filled.Image, contentDescription = "图片", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onSend, enabled = input.isNotBlank() && !sending, modifier = Modifier.size(40.dp)) {
                Icon(
                    Icons.Filled.Send,
                    contentDescription = "发送",
                    tint = if (input.isNotBlank() && !sending) Brown500 else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}