package com.xinwallet.app.data.remote

import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.data.model.RefreshRequest
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import okhttp3.Interceptor
import okhttp3.Response

/**
 * 自动注入 Bearer Token；遇到 401 时尝试用 refreshToken 刷新并重试一次。
 * apiProvider 延迟提供 ApiService，避免与 OkHttp/Retrofit 构造形成循环依赖。
 */
class AuthInterceptor(
    private val session: SessionManager,
    private val authExpired: MutableSharedFlow<Unit>,
    private val apiProvider: () -> ApiService?
) : Interceptor {

    /**
     * 刷新单飞锁：并发 401 时多个请求会同时尝试刷新 token。
     * 若服务端对 refreshToken 做「刷新即轮换/失效旧 token」，并发刷新会让后到的请求
     * 拿到已失效的旧 refreshToken -> 刷新失败 -> 误清会话登出（表现就是「后台回来页面掉了/不能刷新」）。
     * 用 Mutex 串行化，保证同一时刻只有一个刷新在进行，后续请求复用最新 refreshToken。
     */
    private val refreshMutex = Mutex()

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val token = runBlocking { session.accessToken() }
        val bookId = runBlocking { session.currentBookId() }
        val authed = original.newBuilder().apply {
            if (token.isNotEmpty()) header("Authorization", "Bearer $token")
            // 多账本：默认携带当前账本 id，后端据此隔离数据；0 表示未设置（后端退化为默认账本）。
            // 若请求自身已带 X-Book-Id（如搜索页临时选定账本），则尊重调用方、不再覆盖。
            if (bookId > 0 && original.header("X-Book-Id") == null) header("X-Book-Id", bookId.toString())
        }.build()

        val response = chain.proceed(authed)
        if (response.code == 401 && original.header("Authorization") != null) {
            val refreshed = runBlocking { refreshTokenSerialized() }
            response.close()
            if (refreshed != null) {
                val retry = original.newBuilder().header("Authorization", "Bearer $refreshed").build()
                return chain.proceed(retry)
            }
            // 刷新失败：清掉会话并通知 AppRoot 回到登录页
            runBlocking {
                session.clearSession()
                authExpired.tryEmit(Unit)
            }
        }
        return response
    }

    /** 串行化刷新，避免并发 401 的 refreshToken 竞态误登出 */
    private suspend fun refreshTokenSerialized(): String? = refreshMutex.withLock {
        tryRefresh()
    }

    private suspend fun tryRefresh(): String? {
        val rt = session.refreshToken() ?: return null
        return try {
            val api = apiProvider() ?: return null
            // 刷新 token 不应占用长超时（OCR 读写 60s），卡住会导致页面长时间 loading
            val resp = withTimeout(10_000) { api.refresh(RefreshRequest(rt)) }
            if (resp.isSuccessful && resp.body()?.success == true) {
                val auth = resp.body()!!.data
                if (auth != null && auth.token.isNotEmpty()) {
                    session.saveTokens(auth.token, auth.refreshToken)
                    auth.token
                } else null
            } else null
        } catch (_: Exception) {
            null
        }
    }
}
