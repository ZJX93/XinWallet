package com.xinwallet.app.data.repository

import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.data.model.AuthConfigResponse
import com.xinwallet.app.data.model.AuthResponse
import com.xinwallet.app.data.model.LoginRequest
import com.xinwallet.app.data.model.RefreshRequest
import com.xinwallet.app.data.model.UpdateProfileRequest
import com.xinwallet.app.data.model.UserWrapper
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import kotlinx.coroutines.withTimeoutOrNull

class AuthRepository(
    private val session: SessionManager,
    private val apiProvider: () -> ApiService
) {
    suspend fun login(username: String, password: String): ApiResult<AuthResponse> {
        return when (val r = safeApiCall { apiProvider().login(LoginRequest(username, password)) }) {
            is ApiResult.Success -> {
                r.data?.let {
                    session.saveTokens(it.token, it.refreshToken)
                    session.saveUsername(username)
                    session.saveLastUsername(username)   // 记住用户名，供下次登录页预填
                }
                r
            }
            else -> r
        }
    }

    suspend fun demoLogin(): ApiResult<AuthResponse> {
        return when (val r = safeApiCall { apiProvider().demoLogin() }) {
            is ApiResult.Success -> {
                r.data?.let { session.saveTokens(it.token, it.refreshToken); session.saveUsername("demo") }
                r
            }
            else -> r
        }
    }

    /** 查询服务端是否开启演示账号（ALLOW_DEMO=true）。失败时按保守策略返回 true（保持按钮可见）。 */
    suspend fun isDemoEnabled(): ApiResult<Boolean> {
        return when (val r = safeApiCall { apiProvider().authConfig() }) {
            is ApiResult.Success -> ApiResult.Success(r.data?.allowDemo ?: true)
            is ApiResult.Error -> r
        }
    }

    suspend fun refresh(): ApiResult<AuthResponse> {
        val rt = session.refreshToken() ?: return ApiResult.Error("未登录")
        return when (val r = safeApiCall { apiProvider().refresh(RefreshRequest(rt)) }) {
            is ApiResult.Success -> { r.data?.let { session.saveTokens(it.token, it.refreshToken) }; r }
            else -> r
        }
    }

    suspend fun hasSession(): Boolean = session.accessToken().isNotEmpty()
    /**
     * 登出只清会话（token / username / bookId）。
     * ⛔ **刻意不清「记住密码」凭据** —— 记住密码的意义就是登出后下次还能自动填。
     *    与 LAST_USERNAME「logout 不清」的既有约定一致。
     *    要清凭据只有两条路：用户在登录页取消勾选，或调用 CredentialStore.clear()。
     */
    suspend fun logout() = session.clearSession()
    suspend fun username(): String = session.username()

    /** 拉取当前用户资料（用户名/昵称/头像），成功后同步回 DataStore。 */
    suspend fun profile(): ApiResult<UserWrapper> {
        return when (val r = safeApiCall { apiProvider().profile() }) {
            is ApiResult.Success -> {
                r.data?.user?.let { u ->
                    if (u.username.isNotBlank()) session.saveUsername(u.username)
                    u.nickname?.takeIf { it.isNotBlank() }?.let { session.saveNickname(it) }
                }
                r
            }
            else -> r
        }
    }

    /**
     * 修改个人资料（用户名/昵称/头像/改密）。
     * 成功后将 username 同步写回 DataStore，保证 ProfileScreen 立即更新。
     */
    suspend fun updateProfile(req: UpdateProfileRequest): ApiResult<UserWrapper> {
        return when (val r = safeApiCall { apiProvider().updateProfile(req) }) {
            is ApiResult.Success -> {
                r.data?.user?.username?.takeIf { it.isNotBlank() }?.let { session.saveUsername(it) }
                r.data?.user?.nickname?.takeIf { it.isNotBlank() }?.let { session.saveNickname(it) }
                r
            }
            else -> r
        }
    }

    /**
     * 冷启动时验证会话有效性：
     * - 有 refreshToken 则尝试刷新（拿到新 accessToken），成功视为已登录；
     * - refresh 失败/无 refreshToken/超时，则清空本地会话并返回 false，让 UI 回到登录页。
     * 避免仅检查 accessToken 是否存在导致的「过期 token 进首页 -> 请求 401 -> 刷新失败卡 loading」问题。
     */
    suspend fun validateSession(): Boolean {
        return withTimeoutOrNull(10_000) {
            val rt = session.refreshToken()
            if (rt.isNullOrBlank()) {
                session.clearSession()
                return@withTimeoutOrNull false
            }
            when (val r = refresh()) {
                is ApiResult.Success -> true
                is ApiResult.Error -> {
                    session.clearSession()
                    false
                }
            }
        } ?: run {
            session.clearSession()
            false
        }
    }
}
