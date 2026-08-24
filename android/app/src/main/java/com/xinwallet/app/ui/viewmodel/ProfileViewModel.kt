package com.xinwallet.app.ui.viewmodel

import android.content.Context
import android.os.Environment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.data.model.UpdateProfileRequest
import com.xinwallet.app.data.repository.AuthRepository
import com.xinwallet.app.data.repository.UpdateRepository
import com.xinwallet.app.di.AppContainer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ProfileUiState(
    val themeMode: String = "system",
    val baseUrl: String = "",
    val username: String = "",
    val nickname: String = "",
    val avatar: String? = null,
    val memberDays: Int = 0,
    val editing: Boolean = false,
    val message: String? = null
)

/** 应用内升级状态机 */
data class UpdateUiState(
    val checking: Boolean = false,
    val currentVersion: String = "",
    val latestVersion: String = "",
    val apkUrl: String = "",
    val hasUpdate: Boolean = false,
    val error: String? = null,
    val downloading: Boolean = false,
    val progress: Int = 0,
    val localApkPath: String? = null
)

/**
 * 服务器自检结果（用于 [设置] 页一键探测当前 baseUrl 是否含 transfer 字段）。
 *
 * 为什么单独建一个 state 而不是塞进 ProfileUiState：
 *  - 探测生命周期独立于资料态，不需要每次切换设置重置
 *  - AlertDialog 关闭后清空，不污染下次显示
 */
data class ServerProbeState(
    val probing: Boolean = false,
    /** 三态文本：✅ 支持转账合并 / ❌ 不支持 / ⚠ 网络/鉴权错误 */
    val summary: String? = null,
    /** 补充说明：当前 baseUrl、HTTP code、响应样本（截短 240 字符） */
    val detail: String = ""
)

private fun isPlaceholderUrl(url: String): Boolean =
    url.isBlank() || url.contains("127.0.0.1") || url.contains("localhost")

class ProfileViewModel(
    private val session: SessionManager,
    private val authRepo: AuthRepository,
    private val updateRepo: UpdateRepository = UpdateRepository()
) : ViewModel() {

    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state

    private val _updateState = MutableStateFlow(UpdateUiState())
    val updateState: StateFlow<UpdateUiState> = _updateState

    private val _probeState = MutableStateFlow(ServerProbeState())
    /** 当前 baseUrl 是否支持转账合并字段（用于 [设置] 页一键自检） */
    val probeState: StateFlow<ServerProbeState> = _probeState

    init {
        viewModelScope.launch {
            _state.value = ProfileUiState(
                themeMode = session.themeMode(),
                baseUrl = session.baseUrl().takeUnless(::isPlaceholderUrl) ?: "",
                username = session.username(),
                nickname = session.nickname(),
                memberDays = session.memberDays()
            )
            // 从服务端拉取最新资料（用户名/昵称/头像），覆盖本地缓存
            when (val r = authRepo.profile()) {
                is com.xinwallet.app.data.remote.ApiResult.Success -> {
                    val u = r.data?.user
                    _state.value = _state.value.copy(
                        username = u?.username?.takeIf { it.isNotBlank() } ?: _state.value.username,
                        nickname = u?.nickname ?: _state.value.nickname,
                        avatar = u?.avatar
                    )
                }
                else -> Unit
            }
        }
    }

    fun setTheme(mode: String) {
        viewModelScope.launch {
            session.saveTheme(mode)
            _state.value = _state.value.copy(themeMode = mode)
        }
    }

    fun saveServer(url: String) {
        viewModelScope.launch {
            val fixed = AppContainer.normalizeBaseUrl(url)
            if (fixed.isBlank()) {
                _state.value = _state.value.copy(message = "服务器地址不能为空")
                return@launch
            }
            session.saveBaseUrl(fixed)
            AppContainer.setBaseUrl(fixed)
            _state.value = _state.value.copy(baseUrl = fixed, message = "服务器地址已保存")
        }
    }

    fun clearMessage() {
        _state.value = _state.value.copy(message = null)
    }

    /** 提交资料修改（头像 / 用户名 / 昵称 / 改密）。 */
    fun submitProfile(avatar: String?, username: String?, nickname: String?, oldPwd: String?, newPwd: String?) {
        viewModelScope.launch {
            _state.value = _state.value.copy(editing = true, message = null)
            val req = UpdateProfileRequest(
                avatar = avatar?.takeIf { it.isNotBlank() },
                username = username?.takeIf { it.isNotBlank() },
                nickname = nickname?.takeIf { it.isNotBlank() },
                oldPassword = oldPwd?.takeIf { it.isNotBlank() },
                newPassword = newPwd?.takeIf { it.isNotBlank() }
            )
            when (val r = authRepo.updateProfile(req)) {
                is com.xinwallet.app.data.remote.ApiResult.Success -> {
                    val u = r.data?.user
                    _state.value = _state.value.copy(
                        editing = false,
                        username = u?.username ?: _state.value.username,
                        nickname = u?.nickname ?: _state.value.nickname,
                        avatar = u?.avatar ?: _state.value.avatar,
                        message = if (oldPwd.isNullOrBlank() && newPwd.isNullOrBlank()) "资料已更新" else "密码已更新"
                    )
                }
                is com.xinwallet.app.data.remote.ApiResult.Error -> {
                    _state.value = _state.value.copy(editing = false, message = r.message)
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch { authRepo.logout() }
    }

    // ---------- 服务器自检（transfer 字段） ----------

    /**
     * 用当前 baseUrl + token 发 GET /transactions?limit=1，扫描响应 JSON 中是否
     * 含字段名 "transfer"。
     *
     * 为什么不用 Retrofit list()：
     *  - 后端若不返回 transfer 字段，Gson 反序列化的 TransactionItem.transfer 仍是 null，
     *    调用者区分不了「后端没返回」和「后端返回了 null」，判据不稳。
     *  - 直接扫字节流最准，且只取一条数据，开销极小。
     *
     * 失败模式覆盖在 [probeTransferField] 中：网络层 / HTTP code / 字段缺失 / 找到。
     */
    fun probeServerSupportsTransfer() {
        viewModelScope.launch {
            _probeState.value = ServerProbeState(probing = true)
            val rawBase = session.baseUrl()
            val baseUrl = AppContainer.normalizeBaseUrl(rawBase)
            if (baseUrl.isBlank()) {
                _probeState.value = ServerProbeState(
                    probing = false,
                    summary = "⚠ 服务器地址未配置",
                    detail = "请先在「服务器地址」中填入你的 NAS 地址，例如 http://10.0.2.2:18888"
                )
                return@launch
            }
            val token = session.accessToken()
            val r = withContext(Dispatchers.IO) { probeTransferField(baseUrl, token) }
            _probeState.value = ServerProbeState(
                probing = false,
                summary = r.summary,
                detail = r.detail
            )
        }
    }

    fun clearProbe() {
        _probeState.value = ServerProbeState()
    }

    private data class ProbeResult(val summary: String, val detail: String)

    /**
     * 实际探测逻辑。返回的 summary/detail 直接喂给 AlertDialog。
     *
     * 用 HttpURLConnection 而非 OkHttp 是因为 AppContainer 没把 client 导出；
     * 再开一个 5 秒超时的短连接对设置页的一次性点击完全够用。
     */
    private fun probeTransferField(baseUrl: String, token: String): ProbeResult {
        // baseUrl 形如 https://nas.com:18888/api/，拼接到 /transactions?limit=1
        val urlStr = baseUrl.trimEnd('/') + "/transactions?limit=1"
        return try {
            val url = URL(urlStr)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 5000
                readTimeout = 5000
                requestMethod = "GET"
                setRequestProperty("Accept", "application/json")
                if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            conn.disconnect()
            when {
                code !in 200..299 ->
                    ProbeResult("⚠ HTTP $code", "baseUrl=$baseUrl\n响应：${body.take(240)}")
                body.contains("\"transfer\"") ->
                    ProbeResult("✅ 当前服务器支持转账合并", "baseUrl=$baseUrl\n响应样本：${body.take(240)}")
                else ->
                    ProbeResult(
                        "❌ 当前服务器不含 transfer 字段",
                        "baseUrl=$baseUrl\n响应样本：${body.take(240)}\n这通常是 NAS 上的旧 Docker 镜像，需要重新部署最新镜像。"
                    )
            }
        } catch (e: Exception) {
            ProbeResult(
                "⚠ 网络失败",
                "baseUrl=$baseUrl\n${e.javaClass.simpleName}: ${e.message}\n请检查 baseUrl 是否正确、设备与服务器是否同网。"
            )
        }
    }

    // ---------- 应用内升级 ----------

    fun checkUpdate(currentVersion: String) {
        val s = _updateState.value
        if (s.checking || s.downloading) return
        viewModelScope.launch {
            _updateState.value = s.copy(checking = true, error = null, currentVersion = currentVersion)
            try {
                val rel = updateRepo.latestAndroidRelease()
                val newer = isVersionNewer(rel.version, currentVersion)
                _updateState.value = _updateState.value.copy(
                    checking = false,
                    latestVersion = rel.version,
                    apkUrl = rel.apkUrl,
                    hasUpdate = newer
                )
            } catch (e: Exception) {
                _updateState.value = _updateState.value.copy(checking = false, error = e.message ?: "检查更新失败")
            }
        }
    }

    fun downloadUpdate(context: Context) {
        val s = _updateState.value
        val url = s.apkUrl
        if (url.isBlank() || s.downloading) return
        viewModelScope.launch {
            val dir = context.applicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: run {
                    _updateState.value = s.copy(error = "无法访问本机存储")
                    return@launch
                }
            val dest = File(dir, "xinwallet_update.apk")
            _updateState.value = s.copy(downloading = true, progress = 0, error = null, localApkPath = null)
            // 主域名（github.com 302 到 release-assets.githubusercontent.com）不通时，回退到公共镜像加速器
            val candidates = buildList {
                add(url)
                if (!url.contains("ghproxy", ignoreCase = true)) {
                    add("https://ghproxy.net/$url")
                    add("https://mirror.ghproxy.com/$url")
                }
            }
            var lastErr: String? = null
            var ok = false
            for (cand in candidates) {
                try {
                    updateRepo.downloadApk(cand, dest) { p ->
                        _updateState.value = _updateState.value.copy(progress = p)
                    }
                    ok = true
                    break
                } catch (e: Exception) {
                    lastErr = e.message ?: "下载失败"
                }
            }
            if (ok) {
                _updateState.value = _updateState.value.copy(downloading = false, localApkPath = dest.absolutePath, error = null)
            } else {
                _updateState.value = _updateState.value.copy(
                    downloading = false,
                    localApkPath = null,
                    error = "下载失败：$lastErr\n可能是手机网络访问 GitHub 下载服务器不稳定。可点下方“复制链接”在手机浏览器中打开下载，或开启网络代理后重试。"
                )
            }
        }
    }

    fun consumeUpdateError() {
        _updateState.value = _updateState.value.copy(error = null)
    }

    /** 语义化版本比较：latest 是否比 current 新（X.Y.Z 数值逐段比较） */
    private fun isVersionNewer(latest: String, current: String): Boolean {
        val parse: (String) -> List<Int> = { v -> v.split('.').map { it.toIntOrNull() ?: 0 } }
        val l = parse(latest)
        val c = parse(current)
        val n = maxOf(l.size, c.size)
        for (i in 0 until n) {
            val a = l.getOrElse(i) { 0 }
            val b = c.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }
}
