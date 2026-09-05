package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.alpha
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.saveable.rememberSaveable
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.theme.GlassBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Button
import java.util.Calendar
import java.util.TimeZone
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.accountTypeLabel
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.viewmodel.AddTransactionViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory
import com.xinwallet.app.util.todayDateTime
import com.xinwallet.app.util.formatMoney
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.Manifest
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/* ============================================================
 * 屏幕
 * 布局（按截图）：
 *   [顶栏 返回 | 支出 / 收入 | (空)]
 *   1) 一级标签 区（收起按钮 + 5 列分类网格）
 *   2) chips 行：默认账本 / 账户 / 日期 / 时间 / 不关联 / 收起（固定在分类下方）
 *   3) 位置 chip 行：合肥
 *   4) ¥0.00 + 备注占位
 *   5) 选择记账心情 5 个 chips
 *   6) 4×5 自定义键盘（+-×/ 数字 ( ) ⌫ 清空 . 确定）
 * ============================================================ */

/** GPS 定位：先取缓存位置（5 分钟内新鲜），取不到则发一次实时定位请求，最后反向地理编码为城市/区/街道。 */
internal suspend fun getCurrentLocation(context: android.content.Context): String? {
    return withContext(Dispatchers.IO) {
        try {
            val lm = context.getSystemService(android.content.Context.LOCATION_SERVICE) as? LocationManager ?: return@withContext null
            // 1) 优先使用 5 分钟内的缓存位置，避免每次都等卫星
            val cached = lm.allProviders
                .asSequence()
                .mapNotNull { provider ->
                    runCatching { @Suppress("MissingPermission") lm.getLastKnownLocation(provider) }.getOrNull()
                }
                .filter { System.currentTimeMillis() - it.time < 5 * 60 * 1000L }
                .maxByOrNull { it.time }
            // 2) 缓存不可用则单次实时定位（GPS > NETWORK），5 秒超时
            val loc = cached ?: requestSingleLocation(lm) ?: return@withContext null

            if (!Geocoder.isPresent()) return@withContext null
            val geocoder = Geocoder(context)
            val addrs = geocoder.getFromLocation(loc.latitude, loc.longitude, 1)
            val a = addrs?.firstOrNull() ?: return@withContext null
            // 拼接：city > subAdmin > featureName；优先显示"市-区"
            val parts = listOfNotNull(
                a.locality?.takeIf { it.isNotBlank() },
                a.subAdminArea?.takeIf { it.isNotBlank() }?.removeSuffix("市")?.removeSuffix("区"),
                a.thoroughfare?.takeIf { it.isNotBlank() }
            ).distinct()
            if (parts.isEmpty()) null else parts.joinToString("·")
        } catch (e: Exception) {
            null
        }
    }
}

/** 单次实时定位：发起一次定位请求，成功或 5 秒超时后结束。 */
private suspend fun requestSingleLocation(lm: LocationManager): Location? {
    val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
        ?: return null
    return withTimeoutOrNull(5000) {
        suspendCancellableCoroutine { cont ->
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    if (cont.isActive) cont.resume(location) {}
                }
                @Deprecated("Deprecated in Java")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
            }
            runCatching {
                @Suppress("MissingPermission")
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }.onFailure { if (cont.isActive) cont.resumeWith(Result.failure(it)) }
            cont.invokeOnCancellation { runCatching { lm.removeUpdates(listener) } }
        }
    }
}

/* 笔记心情功能已移除：原始 UI 为 5 个 emoji+文字 chips（选择记账心情 / 该花的 / 剁手了 / 情势我 / …），
 * 但未对接任何后端字段（无 API 落地、无数据持久化），完全冗余，移除以避免误导。 */

/**
 * 记账页，一页四用：
 *   新增（editId=0, editTransferId=0）
 *   编辑普通交易（editId>0）→ PUT /transactions/{id}
 *   编辑转账（editTransferId>0）→ PUT /transfers/{id}
 *
 * 转账编辑之所以也进这一页（而不是列表里弹表单），是为了让「改支出 / 改收入 / 改转账」
 * 三种编辑体验一致。但**提交必须分流**：转账走 /transfers，否则只会改到两条腿里的一条，
 * 转出账户扣 200、转入账户仍加 100，双方余额永久对不上。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTransactionScreen(
    navController: NavHostController,
    editId: Int = 0,
    month: String? = null,
    editTransferId: Int = 0
) {
    val vm: AddTransactionViewModel = viewModel(factory = viewModelFactory {
        AddTransactionViewModel(AppContainer.transactionRepository, AppContainer.accountRepository, AppContainer.categoryRepository, AppContainer.budgetRepository, AppContainer.tagRepository)
    })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val isEditTransfer = editTransferId > 0
    val isEdit = editId > 0 || isEditTransfer

    // 顶层状态：支出/收入/转账（截图布局）
    // 转账编辑进来时直接锁定在 transfer，不能让用户切到支出/收入
    // （切了也没有可用的提交路径 —— transfers 表记录改不成 transactions 记录）
    var type by rememberSaveable { mutableStateOf(if (isEditTransfer) "transfer" else "expense") }
    var amount by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var accountId by rememberSaveable { mutableStateOf<Int?>(null) }
    // 转账专用：转出账户 accountId，转入账户 toAccountId
    var toAccountId by rememberSaveable { mutableStateOf<Int?>(null) }
    var categoryId by rememberSaveable { mutableStateOf<Int?>(null) }
    var date by rememberSaveable { mutableStateOf(todayDateTime()) }
    var prefilled by remember { mutableStateOf(false) }
    var notReimbursable by rememberSaveable { mutableStateOf(false) }
    var tagsCollapsed by rememberSaveable { mutableStateOf(false) }
    var location by rememberSaveable { mutableStateOf("") }
    var selectedBookId by rememberSaveable { mutableStateOf<Int?>(null) }
    /** 手动选择的预算关联（关联预算接口对接）；null = 不关联 */
    var linkedBudgetId by rememberSaveable { mutableStateOf<Int?>(null) }
    var showBudgetSheet by remember { mutableStateOf(false) }
    /** 手动选择的标签 id 集合（关联标签接口对接）；空集合 = 不关联 */
    var selectedTagIds by rememberSaveable { mutableStateOf<Set<Int>>(emptySet()) }
    var showTagSheet by remember { mutableStateOf(false) }

    // 选择类弹层 / 对话框状态
    var showAccountSheet by remember { mutableStateOf(false) }
    var showToAccountSheet by remember { mutableStateOf(false) } // 转账：转入账户
    var showBookSheet by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    var showTimePicker by remember { mutableStateOf(false) }
    var showNoteDialog by remember { mutableStateOf(false) }
    var showLocationDialog by remember { mutableStateOf(false) }
    var noteDraft by remember { mutableStateOf("") }
    var locationDraft by remember { mutableStateOf("") }

    val books by AppContainer.books.collectAsState()
    val currentBookId by AppContainer.currentBookId.collectAsState()

    // —— GPS 定位 ——
    val context = LocalContext.current
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

    LaunchedEffect(Unit) {
        vm.loadOptions(
            editId = if (editId > 0) editId else null,
            month = month,
            transferId = if (isEditTransfer) editTransferId else null
        )
    }

    // 账户加载完成后，若用户尚未手动选择，则默认选中「默认账户」(没有则首个)，避免永远卡在"请选择账户"
    // 转账编辑模式跳过：账户由 state.editingTransfer 回填，默认值会把回填结果覆盖掉
    LaunchedEffect(state.accounts) {
        if (!isEditTransfer && accountId == null && state.accounts.isNotEmpty()) {
            accountId = state.accounts.firstOrNull { it.isDefault }?.id ?: state.accounts.first().id
        }
    }
    // 账本默认选中当前账本
    LaunchedEffect(books) {
        if (selectedBookId == null && books.isNotEmpty()) {
            selectedBookId = currentBookId.takeIf { it > 0 } ?: books.firstOrNull()?.id
        }
    }
    LaunchedEffect(state.success) { if (state.success) navController.popBackStack() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it) } }

    LaunchedEffect(state.editing) {
        val tx = state.editing
        if (tx != null && !prefilled) {
            type = if (tx.type == "income") "income" else "expense"
            amount = trimAmount(tx.amount)
            note = tx.note.orEmpty()
            accountId = tx.account?.id
            categoryId = tx.category?.id
            date = tx.date.trim().let { if (it.length >= 19) it.substring(0, 19) else it.take(10) + " 00:00:00" }
            location = tx.location.orEmpty()
            notReimbursable = (tx.linkType == "none")
            // 标签回填：使用现有标签 id 集合（空时也允许清除，避免脏状态）
            selectedTagIds = tx.tags.map { it.id }.toSet()
            prefilled = true
        }
    }

    // 转账编辑回填：转账没有分类/标签/预算/位置概念，只回填双端账户 + 金额 + 备注 + 日期
    LaunchedEffect(state.editingTransfer) {
        val tf = state.editingTransfer
        if (tf != null && !prefilled) {
            type = "transfer"
            amount = trimAmount(tf.amount)
            note = tf.note.orEmpty()
            accountId = tf.fromAccountId
            toAccountId = tf.toAccountId
            date = tf.date.trim().replace('T', ' ').let {
                if (it.length >= 19) it.substring(0, 19) else it.take(10) + " 00:00:00"
            }
            prefilled = true
        }
    }

    fun doSubmit(keepOpen: Boolean) {
        val amt = amount.toDoubleOrNull() ?: 0.0
        if (amt <= 0) { scope.launch { snackbar.showSnackbar("请输入有效金额") }; return }
        // 转账走专门分支：校验转出/转入必填，且不能相同
        if (type == "transfer") {
            if (accountId == null) { scope.launch { snackbar.showSnackbar("请选择转出账户") }; return }
            if (toAccountId == null) { scope.launch { snackbar.showSnackbar("请选择转入账户") }; return }
            if (accountId == toAccountId) { scope.launch { snackbar.showSnackbar("转出和转入账户不能相同") }; return }
            // 编辑态必须走 PUT /transfers/{id}（全量替换两条腿并重算双方余额），
            // 不能退化成再 POST 一笔新转账，否则等于凭空多出一笔。
            if (isEditTransfer) {
                vm.submitTransferEdit(editTransferId, accountId!!, toAccountId!!, amt, note, date)
            } else {
                vm.submitTransfer(accountId!!, toAccountId!!, amt, note, date)
                if (keepOpen) { amount = ""; note = "" }
            }
            return
        }
        if (accountId == null) { scope.launch { snackbar.showSnackbar("请选择账户") }; return }
        if (categoryId == null) { scope.launch { snackbar.showSnackbar("请选择分类") }; return }
        val loc = location.takeIf { it.isNotBlank() }
        // 不关联 toggle 优先级最高（用户明确不想关联任何预算/报销）
        val budgetIdToSend: Int? = when {
            notReimbursable -> null
            else -> linkedBudgetId
        }
        val lt = if (notReimbursable) "none" else null
        if (isEdit) {
            vm.submitEdit(editId, accountId!!, categoryId!!, amt, note, type, date, loc, lt, null, budgetIdToSend, selectedTagIds.toList())
        } else {
            vm.submitExpense(accountId!!, categoryId!!, amt, note, type, date, loc, lt, null, budgetIdToSend, selectedTagIds.toList())
        }
        if (keepOpen) {
            amount = ""
            note = ""
        }
    }

    Scaffold(
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        topBar = { TopBarSegmented(type, onBack = { navController.popBackStack() }, onChange = {
            type = it
            categoryId = null
            // 在「支出/收入」与「转账」之间切换时，重置转入账户避免跨类型残留
            toAccountId = null
        }, allowedTypes = when {
            isEditTransfer -> listOf("transfer")            // 转账编辑：锁死
            editId > 0 -> listOf("expense", "income")       // 普通交易编辑：可改支出↔收入，但不能变成转账
            else -> listOf("expense", "income", "transfer") // 新增：三选
        }) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        if (state.loading && state.accounts.isEmpty() && state.categories.isEmpty()) {
            LoadingBox()
            return@Scaffold
        }

        Column(Modifier.fillMaxSize().padding(padding)) {
            // —— 上半部：可滚动
            //   转账模式：显示转出/转入账户选择卡（非分类网格）
            //   支出/收入：分类卡 —
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                if (type == "transfer") {
                    TransferAccountCard(
                        fromName = state.accounts.find { it.id == accountId }?.name ?: "请选择转出账户",
                        fromIcon = state.accounts.find { it.id == accountId }?.icon ?: "💰",
                        toName = state.accounts.find { it.id == toAccountId }?.name ?: "请选择转入账户",
                        toIcon = state.accounts.find { it.id == toAccountId }?.icon ?: "💰",
                        onPickFrom = { showAccountSheet = true },
                        onPickTo = { showToAccountSheet = true }
                    )
                } else {
                    CategorySection(
                        categories = state.categories.filter { it.type == type },
                        selectedId = categoryId,
                        collapsed = tagsCollapsed,
                        onToggleCollapsed = { tagsCollapsed = !tagsCollapsed },
                        onSelect = { newId ->
                            categoryId = newId
                            // 自动按同名预算联动：例如选「餐饮」分类，自动挂上「餐饮」预算
                            val catName = state.categories.find { it.id == newId }?.name
                            val match = state.budgets.firstOrNull { it.name == catName }
                            if (match != null) {
                                linkedBudgetId = match.id
                                notReimbursable = false
                            }
                        }
                    )
                }
            }

            // —— chips 行：固定在滚动区下方（转账模式下从账户 chip 也只显示转出）
            ContextChipsRow(
                date = date,
                accountName = state.accounts.find { it.id == accountId }?.name ?: (if (type == "transfer") "请选择转出账户" else "请选择账户"),
                toAccountName = state.accounts.find { it.id == toAccountId }?.name,
                bookName = books.find { it.id == selectedBookId }?.name ?: "默认账本",
                linkedBudget = state.budgets.find { it.id == linkedBudgetId },
                notReimbursable = notReimbursable,
                location = location,
                selectedTagNames = state.tags.filter { it.id in selectedTagIds }.map { it.icon + " " + it.name },
                isTransfer = type == "transfer",
                onToggleNotReimbursable = { notReimbursable = !notReimbursable },
                onPickAccount = { showAccountSheet = true },
                onPickToAccount = { showToAccountSheet = true },
                onPickBudget = { showBudgetSheet = true },
                onPickTags = { showTagSheet = true },
                onPickBook = { showBookSheet = true },
                onPickDate = { showDatePicker = true },
                onPickTime = { showTimePicker = true },
                onPickLocation = { locationDraft = location; showLocationDialog = true },
                onCollapse = { tagsCollapsed = !tagsCollapsed }
            )

            // —— 下半部：记账功能固定在底部（不随上半部滚动跑掉） ——
            //   金额 + 备注 + 心情 + 键盘 永远在视口下方；加 navigationBarsPadding 防系统手势条覆盖
            Column(Modifier.navigationBarsPadding()) {
                AmountBlock(
                    amount = amount,
                    note = note,
                    onAmountChange = { amount = it },
                    onNoteChange = { note = it },
                    onEditNote = { noteDraft = note; showNoteDialog = true }
                )

                NewKeypad(
                    value = amount,
                    onValueChange = { amount = it },
                    onSubmit = { doSubmit(false) },
                    onSubmitAndNew = { doSubmit(true) }
                )
            }

            // —— 账户选择底部弹层 ——
            if (showAccountSheet || showToAccountSheet) {
                val isTo = showToAccountSheet
                ModalBottomSheet(
                    onDismissRequest = { showAccountSheet = false; showToAccountSheet = false },
                    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        Text(if (isTo) "选择转入账户" else "选择账户", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                        Spacer(Modifier.height(4.dp))
                        // 与资产账户页一致：按类型分组显示（现金/储蓄卡/信用卡/电子支付/金融账户/数字货币/其他）
                        val grouped = ACCOUNT_TYPE_ORDER.mapNotNull { t ->
                            val list = state.accounts.filter { it.type == t }
                            if (list.isEmpty()) null else t to list
                        }
                        val known = ACCOUNT_TYPE_ORDER.toSet()
                        val other = state.accounts.filter { it.type !in known }
                        val allGroups = grouped + if (other.isNotEmpty()) listOf("other" to other) else emptyList()
                        allGroups.forEach { (type, list) ->
                            Text(
                                "${accountTypeLabel(type)}（${list.size}）",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp)
                            )
                            list.forEach { acc ->
                                // 转账的「转入」不允许跟当前「转出」相同
                                val disabled = isTo && acc.id == accountId
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable(enabled = !disabled) {
                                            if (isTo) {
                                                toAccountId = acc.id
                                            } else {
                                                accountId = acc.id
                                            }
                                            showAccountSheet = false; showToAccountSheet = false
                                        }
                                        .padding(vertical = 12.dp, horizontal = 8.dp)
                                        .alpha(if (disabled) 0.4f else 1f),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(acc.icon ?: "💰", fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(acc.name, style = MaterialTheme.typography.bodyLarge)
                                        Text("余额 ${formatMoney(acc.balance, acc.currency)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    val currentId = if (isTo) toAccountId else accountId
                                    if (currentId == acc.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                                    if (disabled) Text("(转出账户)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                            }
                        }
                    }
                }
            }

            // —— 日期选择 ——
            if (showDatePicker) {
                val dateState = rememberDatePickerState(initialSelectedDateMillis = dateToMillis(date))
                DatePickerDialog(
                    onDismissRequest = { showDatePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            dateState.selectedDateMillis?.let { date = millisToDateStr(it, date) }
                            showDatePicker = false
                        }) { Text("确定") }
                    },
                    dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("取消") } }
                ) {
                    DatePicker(state = dateState)
                }
            }

            // —— 时间选择（到秒）——
            if (showTimePicker) {
                val parts = date.split(" ").getOrNull(1)?.split(":") ?: listOf("0", "0", "0")
                val tpState = rememberTimePickerState(
                    initialHour = parts.getOrNull(0)?.toIntOrNull() ?: 0,
                    initialMinute = parts.getOrNull(1)?.toIntOrNull() ?: 0,
                    is24Hour = true
                )
                var seconds by remember { mutableStateOf(parts.getOrNull(2)?.toIntOrNull() ?: 0) }
                AlertDialog(
                    onDismissRequest = { showTimePicker = false },
                    title = { Text("选择时间（到秒）") },
                    text = {
                        Column {
                            TimePicker(state = tpState)
                            Spacer(Modifier.height(12.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("秒：", style = MaterialTheme.typography.bodyLarge)
                                // 横向滚动钟盘：0~59 逐秒选择
                                LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    items(60) { s ->
                                        val on = seconds == s
                                        Box(
                                            Modifier
                                                .clip(RoundedCornerShape(50))
                                                .background(if (on) Brown500 else Brown50)
                                                .clickable { seconds = s }
                                                .padding(horizontal = 10.dp, vertical = 6.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Text("%02d".format(s), color = if (on) Color.White else MaterialTheme.colorScheme.onSurface,
                                                style = MaterialTheme.typography.labelMedium)
                                        }
                                    }
                                }
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            val datePart = date.split(" ").getOrNull(0) ?: todayDateTime().split(" ").first()
                            date = "%s %02d:%02d:%02d".format(datePart, tpState.hour, tpState.minute, seconds)
                            showTimePicker = false
                        }) { Text("确定") }
                    },
                    dismissButton = { TextButton(onClick = { showTimePicker = false }) { Text("取消") } }
                )
            }

            // —— 预算选择底部弹层（关联预算接口对接）——
            if (showBudgetSheet) {
                ModalBottomSheet(
                    onDismissRequest = { showBudgetSheet = false },
                    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(
                        Modifier.fillMaxWidth()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        Text("关联预算", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "选择一笔预算，未选择则本次交易不计入预算统计。",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        // 不关联
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable {
                                    linkedBudgetId = null
                                    notReimbursable = true
                                    showBudgetSheet = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Filled.LinkOff, contentDescription = null, tint = Brown500)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("不关联任何预算", style = MaterialTheme.typography.bodyLarge)
                                Text("本次交易仅作为普通流水", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (notReimbursable) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        // 列出所有预算
                        if (state.budgets.isEmpty()) {
                            Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                                Text("暂无预算", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        state.budgets.forEach { b ->
                            val pct = if (b.amount > 0) (b.actual / b.amount * 100).toInt() else 0
                            val remain = (b.amount - b.actual).coerceAtLeast(0.0)
                            val on = linkedBudgetId == b.id
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable {
                                        linkedBudgetId = b.id
                                        notReimbursable = false
                                        showBudgetSheet = false
                                    }
                                    .padding(vertical = 12.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Filled.AccountBalanceWallet, contentDescription = null, tint = Brown500)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(b.name, style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        "${formatMoney(remain)} 剩余 · 已用 $pct%",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                if (on) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        }
                    }
                }
            }

            // —— 标签选择底部弹层（多选 + 搜索 + 跳转「标签管理」新建）——
            if (showTagSheet) {
                var tagQuery by remember { mutableStateOf("") }
                ModalBottomSheet(
                    onDismissRequest = { showTagSheet = false },
                    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        Text(
                            "关联标签",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 4.dp)
                        )
                        Text(
                            "可多选，未选择则不关联标签。",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        // 搜索框
                        OutlinedTextField(
                            value = tagQuery,
                            onValueChange = { tagQuery = it },
                            placeholder = { Text("搜索标签", style = MaterialTheme.typography.bodyMedium) },
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            trailingIcon = if (tagQuery.isNotEmpty()) {
                                {
                                    IconButton(onClick = { tagQuery = "" }) {
                                        Icon(Icons.Filled.Close, contentDescription = "清空", modifier = Modifier.size(18.dp))
                                    }
                                }
                            } else null,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                        )
                        // 已选数量 + 清空
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "已选 ${selectedTagIds.size} 个",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(Modifier.weight(1f))
                            if (selectedTagIds.isNotEmpty()) {
                                Text(
                                    "清空",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Brown500,
                                    modifier = Modifier.clickable { selectedTagIds = emptySet() }.padding(4.dp)
                                )
                            }
                        }
                        // 标签 chips 网格
                        val q = tagQuery.trim()
                        val filteredTags = if (q.isEmpty()) state.tags
                                          else state.tags.filter { it.name.contains(q, ignoreCase = true) }
                        if (filteredTags.isEmpty()) {
                            Box(
                                Modifier.fillMaxWidth().padding(vertical = 16.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    if (q.isEmpty()) "暂无标签，先去创建一个？" else "没有匹配 \"$q\" 的标签",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        } else {
                            // 简易 chip 网格：每行最多 3 个，超出换行
                            val rows = filteredTags.chunked(3)
                            rows.forEach { row ->
                                Row(
                                    Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    row.forEach { tg ->
                                        val on = tg.id in selectedTagIds
                                        Surface(
                                            onClick = {
                                                selectedTagIds = if (on) selectedTagIds - tg.id
                                                                 else selectedTagIds + tg.id
                                            },
                                            color = if (on) Brown500.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceVariant,
                                            shape = RoundedCornerShape(50),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Row(
                                                Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.Center
                                            ) {
                                                Text(
                                                    "${tg.icon} ${tg.name}",
                                                    style = MaterialTheme.typography.labelLarge,
                                                    color = if (on) Brown500 else MaterialTheme.colorScheme.onSurface,
                                                    maxLines = 1
                                                )
                                                if (on) {
                                                    Spacer(Modifier.width(4.dp))
                                                    Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500, modifier = Modifier.size(14.dp))
                                                }
                                            }
                                        }
                                    }
                                    // 不足 3 个的格子用透明占位，保证等宽对齐
                                    repeat(3 - row.size) {
                                        Spacer(Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                        // 跳转新建标签
                        Spacer(Modifier.height(8.dp))
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                showTagSheet = false
                                navController.navigate(com.xinwallet.app.ui.navigation.Screen.Tags.route)
                            }.padding(vertical = 12.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null, tint = Brown500)
                            Spacer(Modifier.width(8.dp))
                            Text("新建标签", style = MaterialTheme.typography.bodyLarge, color = Brown500)
                        }
                        // 完成按钮
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = { showTagSheet = false },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("完成（已选 ${selectedTagIds.size}）")
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }

            // —— 账本选择 ——
            if (showBookSheet) {
                ModalBottomSheet(
                    onDismissRequest = { showBookSheet = false },
                    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text("选择账本", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                        Spacer(Modifier.height(4.dp))
                        books.forEach { book ->
                            Row(
                                Modifier.fillMaxWidth()
                                    .clickable {
                                        selectedBookId = book.id
                                        showBookSheet = false
                                        scope.launch { AppContainer.switchBook(book.id) }
                                    }
                                    .padding(vertical = 12.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(book.icon.ifBlank { "📒" }, fontSize = 22.sp, modifier = Modifier.padding(end = 12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(book.name, style = MaterialTheme.typography.bodyLarge)
                                    if (book.isDefault) Text("默认账本", style = MaterialTheme.typography.labelSmall, color = Brown500)
                                }
                                if (selectedBookId == book.id) Icon(Icons.Filled.Check, contentDescription = null, tint = Brown500)
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        }
                    }
                }
            }

            // —— 地点输入 ——
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
                    confirmButton = { TextButton(onClick = { location = locationDraft.trim(); showLocationDialog = false }) { Text("保存") } },
                    dismissButton = {
                        Row {
                            if (location.isNotBlank()) {
                                TextButton(onClick = { location = ""; locationDraft = ""; showLocationDialog = false }) { Text("清除", color = MaterialTheme.colorScheme.error) }
                            }
                            TextButton(onClick = { showLocationDialog = false }) { Text("取消") }
                        }
                    }
                )
            }

            // —— 备注编辑 ——
            if (showNoteDialog) {
                AlertDialog(
                    onDismissRequest = { showNoteDialog = false },
                    title = { Text("备注") },
                    text = {
                        OutlinedTextField(
                            value = noteDraft,
                            onValueChange = { noteDraft = it },
                            singleLine = false,
                            maxLines = 3,
                            placeholder = { Text("最多30个字符") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    },
                    confirmButton = { TextButton(onClick = { note = noteDraft.take(30); showNoteDialog = false }) { Text("保存") } },
                    dismissButton = { TextButton(onClick = { showNoteDialog = false }) { Text("取消") } }
                )
            }
        }
    }
}

/* ============================================================
 * 私有组件
 * ============================================================ */

/**
 * 顶栏：返回 + 支出/收入/转账 3 段 tab（标题居中）。转账模式时不显示分类卡。
 *
 * [allowedTypes] 限定可选的段。编辑态必须收窄，因为两类记录走的是不同接口和不同 id 空间：
 *   编辑转账 → 只留「转账」（PUT /transfers/{id}）
 *   编辑普通交易 → 只留「支出 / 收入」（PUT /transactions/{id}）；
 *     若允许切到「转账」，提交会变成 POST 一笔新转账，等于凭空多出一笔记录。
 * 只剩一段时该段不可点。
 */
@Composable
private fun TopBarSegmented(
    current: String,
    onBack: () -> Unit,
    onChange: (String) -> Unit,
    allowedTypes: List<String> = listOf("expense", "income", "transfer")
) {
    GlassBox(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(0.dp),
        elevated = true
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(56.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
            }
            // 支出 / 收入 / 转账 段控件
            Row(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val segments = listOf(
                    "expense" to "支出",
                    "income" to "收入",
                    "transfer" to "转账"
                ).filter { it.first in allowedTypes }
                val single = segments.size <= 1
                segments.forEach { (key, label) ->
                    val on = current == key
                    Column(
                        Modifier
                            .then(if (single) Modifier else Modifier.clickable { onChange(key) })
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            label,
                            style = MaterialTheme.typography.titleMedium,
                            color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = if (on) FontWeight.Bold else FontWeight.Medium
                        )
                        Spacer(Modifier.height(2.dp))
                        if (on) {
                            Box(
                                Modifier
                                    .height(2.dp)
                                    .width(28.dp)
                                    .background(MaterialTheme.colorScheme.onSurface, RoundedCornerShape(1.dp))
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.width(48.dp)) // 与左侧 IconButton 视觉对齐
        }
    }
}

/* 快捷记账卡片已删除 */

/**
 * 2) 分类 卡片：一级 + 二级合并到同一 Card 内。
 *  - 顶部标题 + 收起/展开（控制整个一级卡的整体折叠）
 *  - 一级 5 列网格；点一级：选中 + 如有子级则在卡片内追加该一级的二级网格
 *  - 点同一已展开一级 → 折叠二级；点其他一级 → 切换展开到新的一级
 *  - 二级选中不改变展开状态
 */
@Composable
private fun CategorySection(
    categories: List<com.xinwallet.app.data.model.Category>,
    selectedId: Int?,
    collapsed: Boolean,
    onToggleCollapsed: () -> Unit,
    onSelect: (Int) -> Unit
) {
    val oneLevel = remember(categories) { categories.filter { it.parentId == null } }
    val childrenMap = remember(categories) {
        categories.filter { it.parentId != null }.groupBy { it.parentId!! }
    }
    var expandedId by remember { mutableStateOf<Int?>(null) }

    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) {
            // 顶部：标题 + 收起/展开
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                Text("一级标签：", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Surface(
                    shape = RoundedCornerShape(50),
                    color = Brown50,
                    modifier = Modifier.clickable(onClick = onToggleCollapsed)
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (collapsed) "展开" else "收起", style = MaterialTheme.typography.labelMedium, color = Brown500)
                        Spacer(Modifier.width(2.dp))
                        Icon(
                            if (collapsed) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp,
                            contentDescription = null,
                            tint = Brown500,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
            if (oneLevel.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text("暂无分类", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                return@Column
            }
            // 一级标签网格
            if (collapsed) {
                Row(Modifier.fillMaxWidth()) {
                    oneLevel.take(5).forEach { cat ->
                        CategoryCell(
                            cat = cat,
                            selected = selectedId == cat.id,
                            onClick = {
                                onSelect(cat.id)
                                val kids = childrenMap[cat.id].orEmpty()
                                expandedId = when {
                                    kids.isEmpty() -> null
                                    expandedId == cat.id -> null
                                    else -> cat.id
                                }
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                    if (oneLevel.size < 5) repeat(5 - oneLevel.size) { Spacer(Modifier.weight(1f)) }
                }
                return@Column
            }
            Column {
                val rows = oneLevel.chunked(5)
                rows.forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        row.forEach { cat ->
                            CategoryCell(
                                cat = cat,
                                selected = selectedId == cat.id || (childrenMap[cat.id].orEmpty().any { it.id == selectedId }),
                                onClick = {
                                    onSelect(cat.id)
                                    val kids = childrenMap[cat.id].orEmpty()
                                    expandedId = when {
                                        kids.isEmpty() -> null
                                        expandedId == cat.id -> null
                                        else -> cat.id
                                    }
                                },
                                modifier = Modifier.weight(1f)
                            )
                        }
                        if (row.size < 5) repeat(5 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
            // 二级展开区：在同一卡片内追加（不跳出卡片边界）
            val expandedCat = oneLevel.firstOrNull { it.id == expandedId }
            val children = expandedCat?.let { childrenMap[it.id].orEmpty() }.orEmpty()
            if (expandedCat != null && children.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text("${expandedCat.name} 二级标签：", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(6.dp))
                Column {
                    children.chunked(5).forEach { row ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            row.forEach { cat ->
                                CategoryCell(
                                    cat = cat,
                                    selected = selectedId == cat.id,
                                    onClick = { onSelect(cat.id) },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            if (row.size < 5) repeat(5 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}

/** 分类 cell：选中实心棕 + 白字；未选中浅棕背景 */
@Composable
private fun CategoryCell(
    cat: com.xinwallet.app.data.model.Category,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val bg = if (selected) Brown500 else Brown50
    val fg = if (selected) Color.White else MaterialTheme.colorScheme.onSurface
    Column(
        modifier = modifier.clickable(onClick = onClick).padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(bg),
            contentAlignment = Alignment.Center
        ) {
            Text(cat.icon?.takeIf { it.isNotBlank() } ?: "📌", fontSize = 22.sp, color = fg)
        }
        Spacer(Modifier.height(2.dp))
        Text(
            cat.name,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 3) 上下文 chips：两行布局
 *  - 第 1 行：账本(0.7) / 账户(0.7) / 关联预算|转入(1.0) / 关联标签(1.2)
 *    账本/账户收窄让位；标签可能为「🍜 餐饮 等3个」较长，给予最宽空间
 *  - 第 2 行：今天 / 时间 / 添加地点（3 列等宽）
 *  这样无论有几个 chip 都不会横向溢出，免去滑动
 *  「关联预算」与 BudgetRepository 数据打通：根据当前选择预算渲染已用百分比
 */
@Composable
private fun ContextChipsRow(
    date: String,
    accountName: String,
    toAccountName: String?,
    bookName: String,
    linkedBudget: com.xinwallet.app.data.model.Budget?,
    notReimbursable: Boolean,
    location: String,
    selectedTagNames: List<String>,
    isTransfer: Boolean = false,
    onToggleNotReimbursable: () -> Unit,
    onPickAccount: () -> Unit,
    onPickToAccount: (() -> Unit)? = null,
    onPickBudget: () -> Unit,
    onPickTags: () -> Unit,
    onPickBook: () -> Unit,
    onPickDate: () -> Unit,
    onPickTime: () -> Unit,
    onPickLocation: () -> Unit,
    onCollapse: () -> Unit
) {
    val dateLabel = remember(date) { date.split(" ").getOrNull(0)?.let { "今天" } ?: "今天" }
    val timeLabel = remember(date) {
        val t = date.split(" ").getOrNull(1)?.take(8) ?: "00:00:00"
        t
    }
    // 「关联预算」chip 文案：根据 state.budgets + selectedBudgetId 决定展示
    //   文案精简避免窄 chip 内被截断为 "..."：默认状态用「+ 预算」2 字，激活态保留百分比
    val budgetLabel = when {
        notReimbursable -> "不关联 ✓"
        linkedBudget == null -> "+ 预算"
        else -> {
            // 预算进度：actual 已花费 / amount 总额；贴百分比
            val pct = if (linkedBudget.amount > 0) (linkedBudget.actual / linkedBudget.amount * 100).toInt() else 0
            "${linkedBudget.name.take(3)}·${pct}%"
        }
    }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        // —— 第 1 行：账本 / 账户(收窄) / 关联预算(转入账户) / 关联标签(收窄后让位)
        //   4 列宽度策略：账本 0.9、账户 0.9、预算|转入 1.0、标签 1.0
        //   标签内容最长(可能 "🍜 餐饮 等3个")，与预算同宽；账本/账户略收窄但能装下 "默认账本" / "招商银行" (4 字)
        //   chip 间 spacing = 4dp，让 4 列总宽度更宽松；外层 padding 12dp
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Max),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            QuickChip(
                icon = Icons.Filled.MenuBook,
                label = bookName,
                onClick = onPickBook,
                modifier = Modifier.weight(0.9f).fillMaxHeight(),
                maxLines = 1
            )
            QuickChip(
                icon = Icons.Filled.AccountBox,
                label = accountName,
                onClick = onPickAccount,
                modifier = Modifier.weight(0.9f).fillMaxHeight(),
                maxLines = 1
            )
            if (isTransfer && onPickToAccount != null) {
                QuickChip(
                    icon = Icons.Filled.SwapHoriz,
                    label = toAccountName ?: "转入账户",
                    onClick = onPickToAccount,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    maxLines = 1
                )
            } else {
                // 关联预算 chip：激活态（已关联）/ 默认态（未关联）
                QuickChip(
                    icon = if (linkedBudget != null) Icons.Filled.AccountBalanceWallet else Icons.Filled.LinkOff,
                    label = budgetLabel,
                    active = linkedBudget != null || notReimbursable,
                    onClick = onPickBudget,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    maxLines = 1
                )
            }
            val tagChipLabel = when {
                selectedTagNames.isEmpty() -> "+ 标签"
                selectedTagNames.size == 1 -> selectedTagNames[0]
                else -> "${selectedTagNames[0].take(4)} 等${selectedTagNames.size}个"
            }
            QuickChip(
                icon = Icons.Filled.LocalOffer,
                label = tagChipLabel,
                onClick = onPickTags,
                active = selectedTagNames.isNotEmpty(),
                tintIcon = Brown500,
                modifier = Modifier.weight(1f).fillMaxHeight(),
                maxLines = 1
            )
        }
        // —— 第 2 行：今天 / 时间 / 添加地点（3 列等宽，与第 1 行 chip 同高）——
        Row(
            Modifier.fillMaxWidth().height(IntrinsicSize.Max),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            QuickChip(
                icon = Icons.Filled.CalendarToday,
                label = dateLabel,
                onClick = onPickDate,
                modifier = Modifier.weight(1f).fillMaxHeight()
            )
            QuickChip(
                icon = Icons.Filled.Schedule,
                label = timeLabel,
                onClick = onPickTime,
                modifier = Modifier.weight(1f).fillMaxHeight()
            )
            QuickChip(
                icon = Icons.Filled.LocationOn,
                label = if (location.isBlank()) "+ 地点" else location,
                onClick = onPickLocation,
                tintIcon = Brown500,
                modifier = Modifier.weight(1f).fillMaxHeight(),
                maxLines = 1
            )
        }
        // —— 收起分类按钮：单独一行右对齐 ——
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(50))
                    .clickable(onClick = onCollapse)
                    .padding(horizontal = 12.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("收起", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.width(2.dp))
                Icon(Icons.Filled.KeyboardArrowUp, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** 转账模式上半部分：转出 / 转入 两个账户选择卡（与截图风格对齐） */
@Composable
private fun TransferAccountCard(
    fromName: String,
    fromIcon: String,
    toName: String,
    toIcon: String,
    onPickFrom: () -> Unit,
    onPickTo: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
        Text("选择转出 / 转入账户：", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(bottom = 6.dp))
        Surface(
            Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp
        ) {
            Column(Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) {
                Row(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable(onClick = onPickFrom)
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("转出", style = MaterialTheme.typography.labelMedium, color = Brown500,
                        modifier = Modifier.width(48.dp))
                    Text(fromIcon, fontSize = 22.sp, modifier = Modifier.padding(end = 8.dp))
                    Text(fromName, style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Brown500)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                Row(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable(onClick = onPickTo)
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("转入", style = MaterialTheme.typography.labelMedium, color = Brown500,
                        modifier = Modifier.width(48.dp))
                    Text(toIcon, fontSize = 22.sp, modifier = Modifier.padding(end = 8.dp))
                    Text(toName, style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Brown500)
                }
            }
        }
    }
}

@Composable
private fun QuickChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    active: Boolean = false,
    onClick: (() -> Unit)? = null,
    tintIcon: Color? = null,
    modifier: Modifier = Modifier,
    maxLines: Int = 2
) {
    val mod = if (onClick != null) modifier.clickable { onClick() } else modifier
    val bg = if (active) Brown500 else Brown50
    val border = if (active) Brown500 else Brown100
    val fg = if (active) Color.White else MaterialTheme.colorScheme.onSurface
    val iconColor = when {
        active -> Color.White
        tintIcon != null -> tintIcon
        else -> Brown500
    }
    Row(
        modifier = mod
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(13.dp), tint = iconColor)
        Spacer(Modifier.width(3.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = fg,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 5) ¥0.00 + 备注占位（截图：金额大字 + 占位备注） */
@Composable
private fun AmountBlock(
    amount: String,
    note: String,
    onAmountChange: (String) -> Unit,
    onNoteChange: (String) -> Unit,
    onEditNote: () -> Unit = {}
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                "¥",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(end = 6.dp, bottom = 8.dp)
            )
            Text(
                if (amount.isBlank()) "0.00" else amount,
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
        Spacer(Modifier.height(2.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (note.isBlank()) "点击填写备注(最多30个字符)" else note,
                style = MaterialTheme.typography.bodyMedium,
                color = if (note.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).clickable { onEditNote() }
            )
            if (note.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Text("✕", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable { onNoteChange("") })
            }
        }
    }
}

/** 5) 4×5 自定义键盘
 *  - 操作符（+ - × /）与括号 ( ) 比数字键更大（字符更大、可点区更高）
 *  - 行高统一 60dp，确保按键整体放大而不至于太挤
 */
@Composable
private fun NewKeypad(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onSubmitAndNew: () -> Unit
) {
    fun append(ch: String) {
        var next = value + ch
        if (ch == ".") {
            if (value.contains(".")) return
            if (value.isEmpty()) next = "0."
        }
        val dotIdx = next.indexOf(".")
        if (dotIdx >= 0 && next.length - dotIdx - 1 > 2) return
        if (next.startsWith("0") && !next.startsWith("0.") && next.length > 1) next = next.trimStart('0').let { if (it.startsWith(".")) "0$it" else it }
        onValueChange(next)
    }
    fun backspace() { if (value.isNotEmpty()) onValueChange(value.dropLast(1)) }
    fun clear() = onValueChange("")

    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        // 4 列布局：移除 * / ( ) 键，剩余键位更宽更大
        val rows = listOf(
            listOf("1" to { append("1") }, "2" to { append("2") }, "3" to { append("3") }, "+" to { append("+") }),
            listOf("4" to { append("4") }, "5" to { append("5") }, "6" to { append("6") }, "-" to { append("-") }),
            listOf("7" to { append("7") }, "8" to { append("8") }, "9" to { append("9") }, "⌫" to { backspace() }),
            listOf("." to { append(".") }, "0" to { append("0") }, "清空" to { clear() }, "确定" to { onSubmit() })
        )
        rows.forEachIndexed { idx, row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, action) ->
                    val isPrimary = label == "确定"
                    val isAction = label in setOf("⌫", "清空", ".", "+", "-")
                    KeypadCell(
                        label = label,
                        onClick = action,
                        modifier = Modifier.weight(1f),
                        isPrimary = isPrimary,
                        isAction = isAction
                    )
                }
            }
            if (idx != rows.lastIndex) Spacer(Modifier.height(8.dp))
        }
        Spacer(Modifier.height(2.dp))
    }
}

@Composable
private fun KeypadCell(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    isPrimary: Boolean = false,
    isAction: Boolean = false
) {
    val bg = when {
        isPrimary -> Brown500
        isAction -> MaterialTheme.colorScheme.surfaceVariant
        else -> MaterialTheme.colorScheme.surface
    }
    val fg = if (isPrimary) Color.White else MaterialTheme.colorScheme.onSurface
    // 删除 * / ( ) 后改为 4 列，单元格更宽；高度/字号统一，不再对运算符单独放大
    val boxHeight = 56.dp
    Box(
        modifier = modifier
            .height(boxHeight)
            .clip(RoundedCornerShape(if (isPrimary) 12.dp else 10.dp))
            .background(bg)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        when (label) {
            "⌫" -> Icon(
                Icons.Filled.Backspace,
                contentDescription = "退格",
                tint = if (isAction) MaterialTheme.colorScheme.onSurfaceVariant else fg,
                modifier = Modifier.size(22.dp)
            )
            else -> Text(
                label,
                fontSize = if (isPrimary) 18.sp else 20.sp,
                color = fg,
                fontWeight = if (isPrimary || isAction) FontWeight.Bold else FontWeight.Medium
            )
        }
    }
}

internal fun trimAmount(value: Double): String {
    val s = java.math.BigDecimal(value).setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()
    return s.trimEnd('0').trimEnd('.').ifEmpty { "0" }
}

/** 将 "2026-08-15 10:16:00" 或 "2026-08-15" 转为 epoch millis（UTC 当天 00:00） */
internal fun dateToMillis(dateStr: String): Long {
    return try {
        val parts = dateStr.trim().split(" ")
        val datePart = parts[0]
        val (y, m, d) = datePart.split("-").map { it.toInt() }
        val cal = Calendar.getInstance()
        cal.clear()
        cal.set(y, m - 1, d)
        cal.timeInMillis
    } catch (_: Exception) { System.currentTimeMillis() }
}

/** 将 DatePicker 选中的 millis 转回 "yyyy-MM-dd HH:mm:ss"（保留原时间部分） */
internal fun millisToDateStr(millis: Long, originalDate: String): String {
    return try {
        val cal = Calendar.getInstance()
        cal.timeInMillis = millis
        val y = cal.get(Calendar.YEAR)
        val m = cal.get(Calendar.MONTH) + 1
        val d = cal.get(Calendar.DAY_OF_MONTH)
        val timePart = originalDate.trim().split(" ").getOrNull(1)?.take(8) ?: "00:00:00"
        "%04d-%02d-%02d %s".format(y, m, d, timePart)
    } catch (_: Exception) { originalDate }
}