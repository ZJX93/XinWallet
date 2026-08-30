package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown50
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.util.HashUtil
import kotlinx.coroutines.launch

/**
 * 应用锁（PIN）页面。
 *
 * - mode = "Settings"：我的页入口，总开关 + 设置/修改 PIN
 * - mode = "Unlock"  ：App 启动拦截，输入正确 PIN 后调用 [onUnlocked] 放行
 */
@Composable
fun AppLockScreen(
    navController: NavHostController? = null,
    mode: String = "Settings",          // "Settings" | "Unlock"
    onUnlocked: (() -> Unit)? = null,   // 解锁成功回调（启动锁用；null 时默认 popBackStack）
    onForgotPin: (() -> Unit)? = null   // 忘记 PIN 出口（清除登录会话与锁设置，需重新登录）
) {
    val session = AppContainer.sessionManager
    val scope = rememberCoroutineScope()
    val savedHash by session.appLockPinHashFlow().collectAsState(initial = "")
    val enabled by session.appLockEnabledFlow().collectAsState(initial = false)

    // 设置页内部流程状态：idle / create / confirm / verify
    var setupStep by remember { mutableStateOf("idle") }
    var pinInput by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf<String?>(null) }
    var pendingNewHash by remember { mutableStateOf<String?>(null) }
    var showForgotDialog by remember { mutableStateOf(false) }

    fun resetPin() { pinInput = ""; pinError = null }

    fun submitUnlock() {
        if (HashUtil.sha256(pinInput) == savedHash) {
            if (onUnlocked != null) onUnlocked() else navController?.popBackStack()
        } else {
            pinError = "PIN 不正确，请重试"
            pinInput = ""
        }
    }

    fun submitSetup() {
        when (setupStep) {
            "verify" -> {
                if (HashUtil.sha256(pinInput) == savedHash) {
                    setupStep = "create"; resetPin()
                } else {
                    pinError = "当前 PIN 不正确，请重试"
                    pinInput = ""
                }
            }
            "create" -> {
                pendingNewHash = HashUtil.sha256(pinInput)
                setupStep = "confirm"; resetPin()
            }
            "confirm" -> {
                if (HashUtil.sha256(pinInput) == pendingNewHash) {
                    val hash = pendingNewHash!!
                    scope.launch {
                        session.saveAppLockPinHash(hash)
                        session.setAppLockEnabled(true)
                    }
                    setupStep = "idle"; resetPin()
                } else {
                    pinError = "两次输入不一致，请重新设置"
                    setupStep = "create"; pinInput = ""
                }
            }
        }
    }

    if (mode == "Unlock") {
        // —— 全屏解锁视图（启动拦截，无 TopBar，不可返回） ——
        Column(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .statusBarsPadding()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(48.dp))
            Icon(Icons.Filled.Lock, contentDescription = null, tint = Brown500, modifier = Modifier.size(56.dp))
            Spacer(Modifier.height(16.dp))
            Text("应用已锁定", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "请输入 4 位 PIN 解锁",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(36.dp))
            PinDots(pinInput, length = 4)
            Spacer(Modifier.height(12.dp))
            Text(
                pinError ?: "",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.labelMedium
            )
            Spacer(Modifier.height(24.dp))
            PinKeypad(
                onDigit = { d ->
                    if (pinInput.length >= 4) return@PinKeypad
                    pinInput += d
                    if (pinInput.length == 4) submitUnlock()
                },
                onBackspace = { if (pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1) },
                onClear = { resetPin() }
            )
            Spacer(Modifier.weight(1f))
            if (onForgotPin != null) {
                TextButton(onClick = { showForgotDialog = true }) {
                    Text("忘记 PIN？", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }

    // 忘记 PIN 确认：清除登录会话 + 清除锁设置，回到登录页重新登录
    if (showForgotDialog) {
        AlertDialog(
            onDismissRequest = { showForgotDialog = false },
            title = { Text("忘记 PIN？") },
            text = { Text("将清除应用锁设置并退出当前登录，你需要重新登录后才能使用。此操作不会删除任何账单数据。") },
            confirmButton = {
                TextButton(onClick = {
                    showForgotDialog = false
                    scope.launch {
                        session.setAppLockEnabled(false)
                        session.saveAppLockPinHash("")
                        session.clearSession()
                        onForgotPin?.invoke()
                    }
                }) { Text("确认清除并退出") }
            },
            dismissButton = {
                TextButton(onClick = { showForgotDialog = false }) { Text("取消") }
            }
        )
    }

    if (mode == "Unlock") {
        return
    }

    // —— 设置页视图 ——
    Scaffold(topBar = { TopBar("应用锁", onBack = { navController?.popBackStack() }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            // 总开关
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 1.dp
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("启用应用锁", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            if (enabled) "每次打开 App 都要求输入 PIN" else "关闭后任何人打开 App 都可直接进入",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = enabled,
                        onCheckedChange = { on ->
                            scope.launch {
                                if (on && savedHash.isBlank()) {
                                    // 还没有 PIN → 引导设置
                                    setupStep = "create"; resetPin()
                                } else {
                                    session.setAppLockEnabled(on)
                                }
                            }
                        }
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // 修改 PIN（仅已设置 PIN 时显示）
            if (savedHash.isNotBlank()) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 1.dp
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text("修改 PIN", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "修改前需先输入当前 PIN 验证",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = { setupStep = "verify"; resetPin() }) {
                            Text("修改 PIN")
                        }
                    }
                }
            }
        }
    }

    // PIN 输入弹窗（设置/确认/验证 三个步骤复用同一个九宫格）
    if (setupStep != "idle") {
        AlertDialog(
            onDismissRequest = { setupStep = "idle"; resetPin() },
            title = {
                Text(
                    when (setupStep) {
                        "verify" -> "输入当前 PIN"
                        "create" -> "设置新 PIN（4 位数字）"
                        "confirm" -> "再次输入以确认"
                        else -> ""
                    },
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center
                )
            },
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    PinDots(pinInput, length = 4)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        pinError ?: "",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelSmall
                    )
                    Spacer(Modifier.height(8.dp))
                    PinKeypad(
                        onDigit = { d ->
                            if (pinInput.length >= 4) return@PinKeypad
                            pinInput += d
                            if (pinInput.length == 4) submitSetup()
                        },
                        onBackspace = { if (pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1) },
                        onClear = { pinInput = "" }
                    )
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { setupStep = "idle"; resetPin() }) { Text("取消") }
            }
        )
    }
}

/* ============================================================
 * PIN 输入组件
 * ============================================================ */

@Composable
private fun PinDots(value: String, length: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(length) { i ->
            val filled = i < value.length
            Box(
                Modifier
                    .size(16.dp)
                    .clip(CircleShape)
                    .background(if (filled) Brown500 else Brown100)
            )
        }
    }
}

@Composable
private fun PinKeypad(onDigit: (String) -> Unit, onBackspace: () -> Unit, onClear: () -> Unit) {
    val keys = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("清空", "0", "⌫")
    )
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        keys.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                row.forEach { key ->
                    when (key) {
                        "清空" -> KeypadBtn("清空", onClick = onClear, isAction = true)
                        "⌫" -> KeypadBtn("⌫", icon = Icons.Filled.Backspace, onClick = onBackspace, isAction = true)
                        else -> KeypadBtn(key, onClick = { onDigit(key) })
                    }
                }
            }
        }
    }
}

@Composable
private fun KeypadBtn(
    label: String,
    icon: ImageVector? = null,
    onClick: () -> Unit,
    isAction: Boolean = false
) {
    Box(
        Modifier
            .size(76.dp)
            .clip(CircleShape)
            .background(if (isAction) Brown100 else Brown50)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = label, tint = Brown500, modifier = Modifier.size(28.dp))
        } else {
            val fontSize = if (label.length > 1) 20.sp else 28.sp
            Text(label, fontSize = fontSize, fontWeight = FontWeight.SemiBold, color = Brown500)
        }
    }
}
