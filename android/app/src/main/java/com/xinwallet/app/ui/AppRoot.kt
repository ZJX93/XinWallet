package com.xinwallet.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import android.os.SystemClock
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.navigation.MainScaffold
import com.xinwallet.app.ui.screens.AppLockScreen
import com.xinwallet.app.ui.screens.LoginScreen
import com.xinwallet.app.ui.theme.AmbientBackground
import com.xinwallet.app.ui.theme.XWalletTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@Composable
fun AppRoot() {
    // null = 启动验证中；true = 已登录进入主界面；false = 未登录/会话失效，显示登录页
    var loggedIn by remember { mutableStateOf<Boolean?>(null) }
    val themeMode by AppContainer.sessionManager.themeModeFlow().collectAsState(initial = "system")

    // —— 应用锁 ——
    // needUnlock：当前是否需要先解锁才能看到主界面。
    // 进入后台（ON_STOP）时若已启用应用锁则重新置位，回到前台再要求输入 PIN。
    var needUnlock by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val session = AppContainer.sessionManager

    suspend fun lockConfigured(): Boolean =
        session.appLockEnabledFlow().first() && session.appLockPinHashFlow().first().isNotBlank()

    LaunchedEffect(Unit) {
        val ok = AppContainer.authRepository.validateSession()
        if (ok) {
            // 登录态有效：拉取账本列表并写入当前账本（供 X-Book-Id 注入与切换 UI 使用）
            try { AppContainer.loadBooks() } catch (_: Exception) { }
        }
        loggedIn = ok
        // 启动时若启用了应用锁 → 先弹解锁页（覆盖在主界面上方，保留其导航状态）
        if (ok && lockConfigured()) {
            needUnlock = true
        }
    }

    // —— 应用锁：仅「用户离开 App 达到一定时长」时上锁 ——
    // 关键设计：
    //   · 选照片/分享等 Intent 跳转（独立进程）会让 ProcessLifecycleOwner 触发 ON_STOP，
    //     因为本 App 的所有 Activity 确实都不可见——这是 Android 平台现实，不可避免。
    //   · 用户按 HOME / 最近任务键 同样会触发 ON_STOP。区别在于：Intent 跳转在几秒～几十秒内
    //     会自动返回，按 HOME/最近任务键则可能离开分钟级。
    //   · 因此**正确做法是计时而不是防触发**：记录 ON_STOP 的时刻 `leftAtMs`，
    //     在 ON_START 时计算 elapsed：< APP_LOCK_GRACE_MS 不上锁；>= 才上锁。配合
    //     onUserLeaveHint（仅在用户主动离开时触发，不受 Intent 跳转影响）做时间戳冗余。
    //   · APP_LOCK_GRACE_MS = 1 分钟：覆盖"看条消息就回""查个截图就回"的场景，超过 1 分钟
    //     视为真正离开，重新上锁。
    val APP_LOCK_GRACE_MS = 60_000L  // 应用锁宽限时长：选照片/分享后 1 分钟内返回不重锁
    var leftAtMs by remember { mutableStateOf(0L) }

    val processLifecycleOwner = remember { ProcessLifecycleOwner.get() }
    DisposableEffect(processLifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    // App 整体退到后台（Intent 跳系统相册、HOME、最近任务…）时记录时间。
                    // 不在这里直接上锁——Intent 跳转几秒到几十秒就会回，要留给 ON_START 计时决定。
                    leftAtMs = SystemClock.elapsedRealtime()
                }
                Lifecycle.Event.ON_START -> {
                    // 回到前台：先判断是否超过宽限时长，再决定是否上锁；并续期 token + 广播。
                    val now = SystemClock.elapsedRealtime()
                    val elapsed = if (leftAtMs > 0) now - leftAtMs else 0L
                    // 重置时间戳，避免反复 ON_START/ON_STOP 累计
                    leftAtMs = 0L
                    if (loggedIn == true) {
                        scope.launch {
                            // 先续期（避免 token 过期后首屏 401 空白）
                            AppContainer.authRepository.refresh()
                            AppContainer.onForeground.emit(Unit)
                        }
                        if (elapsed >= APP_LOCK_GRACE_MS) {
                            // 离开 ≥ 1 分钟 → 视为真正离开，触发应用锁
                            scope.launch { if (lockConfigured()) needUnlock = true }
                        }
                        // < 1 分钟 不上锁（例如从系统相册返回、看条消息就回）
                    }
                }
                else -> {}
            }
        }
        processLifecycleOwner.lifecycle.addObserver(observer)
        onDispose { processLifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // 冗余：HOME/最近任务键（onUserLeaveHint 触发）也写一次时间戳，便于未来扩展。
    // 当前逻辑上 ON_STOP 已经覆盖所有退后台场景（包括 HOME），此处仅作记录。
    LaunchedEffect(Unit) {
        AppContainer.userLeaveHint.collect { leftAtMs = SystemClock.elapsedRealtime() }
    }

    // 认证过期全局监听：AuthInterceptor 在 401 且刷新失败时发射，自动回到登录页
    LaunchedEffect(Unit) {
        AppContainer.authExpired.collect { loggedIn = false }
    }

    val darkTheme = when (themeMode) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }

    XWalletTheme(darkTheme = darkTheme) {
        when (loggedIn) {
            null -> {
                // 启动验证中：避免已过期 token 直接进首页造成卡 loading
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }
            true -> {
                // 主界面 + 应用锁覆盖层：解锁屏盖在主界面上方，解锁后移除，保留导航状态
                Box(Modifier.fillMaxSize()) {
                    AmbientBackground()
                    MainScaffold(onLogout = { loggedIn = false })
                    if (needUnlock) {
                        AppLockScreen(
                            mode = "Unlock",
                            onUnlocked = { needUnlock = false },
                            onForgotPin = { needUnlock = false; loggedIn = false }
                        )
                    }
                }
            }
            false -> LoginScreen(onLoginSuccess = { loggedIn = true })
        }
    }
}
