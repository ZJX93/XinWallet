package com.xinwallet.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "xin_wallet_session")

/**
 * 用 DataStore 持久化：访问令牌、刷新令牌、NAS API 基地址、主题模式、用户名。
 */
class SessionManager(private val context: Context) {

    companion object {
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val BASE_URL = stringPreferencesKey("base_url")
        val THEME_MODE = stringPreferencesKey("theme_mode") // system / light / dark
        val USERNAME = stringPreferencesKey("username")
        val NICKNAME = stringPreferencesKey("nickname")
        // 记住用户名（登出后保留，用于登录页预填）；与 USERNAME 区分，logout 不清它
        val LAST_USERNAME = stringPreferencesKey("last_username")
        // 当前账本 id：前端切换账本后持久化，AuthInterceptor 据此注入 X-Book-Id。
        // 0 表示未设置（后端退化为默认账本）。
        val CURRENT_BOOK_ID = intPreferencesKey("current_book_id")
        // 首次启动时间戳（毫秒）。为空时会在首次访问时回写今天 0 点，从而稳定计算「陪伴天数」。
        val FIRST_LAUNCH_AT = longPreferencesKey("first_launch_at")
        // 首页卡片可见性：逗号分隔的卡片 id（month_summary / today_bills / calendar）。
        // 空串表示全部展示（默认值）。
        val HOME_CARDS = stringPreferencesKey("home_cards")
        // 应用锁：PIN 哈希值（SHA-256 hex）；空串 = 未启用应用锁
        val APP_LOCK_PIN_HASH = stringPreferencesKey("app_lock_pin_hash")
        val APP_LOCK_ENABLED = stringPreferencesKey("app_lock_enabled")
        // AI 智能分析缓存（v0.2.1：insight 与 advice 合并进 /ai/advice，缓存两段 JSON）
        // 用 JSON 字符串承载结构化数据，避免每字段一个 key 导致 API 演进需迁移
        val AI_ADVICE_CACHE = stringPreferencesKey("ai_advice_cache_json")
        val AI_INSIGHT_CACHE = stringPreferencesKey("ai_insight_cache_json")
        val AI_ADVICE_GENERATED_AT = stringPreferencesKey("ai_advice_generated_at")
    }

    suspend fun saveTokens(access: String, refresh: String) {
        // 后端 refresh 可能不返回新 refreshToken；空串时不要覆盖本地已有的，避免会话失效
        context.dataStore.edit {
            it[ACCESS_TOKEN] = access
            if (refresh.isNotBlank()) it[REFRESH_TOKEN] = refresh
        }
    }

    suspend fun saveBaseUrl(url: String) {
        context.dataStore.edit { it[BASE_URL] = url }
    }

    suspend fun saveTheme(mode: String) {
        context.dataStore.edit { it[THEME_MODE] = mode }
    }

    suspend fun saveUsername(name: String) {
        context.dataStore.edit { it[USERNAME] = name }
    }

    /** 记住最后成功登录的用户名（登出不清除），供登录页预填 */
    suspend fun saveLastUsername(name: String) {
        if (name.isNotBlank()) context.dataStore.edit { it[LAST_USERNAME] = name }
    }
    suspend fun lastUsername(): String = context.dataStore.data.first()[LAST_USERNAME] ?: ""

    suspend fun saveNickname(name: String) {
        context.dataStore.edit { it[NICKNAME] = name }
    }

    suspend fun nickname(): String = context.dataStore.data.first()[NICKNAME] ?: ""
    fun nicknameFlow(): Flow<String> = context.dataStore.data.map { it[NICKNAME] ?: "" }

    suspend fun clearSession() {
        context.dataStore.edit {
            it.remove(ACCESS_TOKEN)
            it.remove(REFRESH_TOKEN)
            it.remove(USERNAME)
            it.remove(CURRENT_BOOK_ID)
        }
    }

    suspend fun accessToken(): String = context.dataStore.data.first()[ACCESS_TOKEN] ?: ""
    suspend fun refreshToken(): String? = context.dataStore.data.first()[REFRESH_TOKEN]
    suspend fun baseUrl(): String = context.dataStore.data.first()[BASE_URL] ?: ""
    suspend fun themeMode(): String = context.dataStore.data.first()[THEME_MODE] ?: "system"
    suspend fun username(): String = context.dataStore.data.first()[USERNAME] ?: ""

    suspend fun saveCurrentBookId(id: Int) {
        context.dataStore.edit { it[CURRENT_BOOK_ID] = id }
    }
    /** 当前账本 id；0 表示未设置（后端退化为默认账本） */
    suspend fun currentBookId(): Int = context.dataStore.data.first()[CURRENT_BOOK_ID] ?: 0
    fun currentBookIdFlow(): Flow<Int> = context.dataStore.data.map { it[CURRENT_BOOK_ID] ?: 0 }

    fun themeModeFlow(): Flow<String> = context.dataStore.data.map { it[THEME_MODE] ?: "system" }
    fun baseUrlFlow(): Flow<String> = context.dataStore.data.map { it[BASE_URL] ?: "" }

    /** 首页卡片可见 id 集合（空串 = 全部展示）。点击「编辑首页卡片」后用逗号分隔串回写。 */
    fun homeCardsFlow(): Flow<String> = context.dataStore.data.map { it[HOME_CARDS] ?: "" }
    suspend fun saveHomeCards(csv: String) {
        context.dataStore.edit { it[HOME_CARDS] = csv }
    }

    // —— 应用锁（PIN）持久化 ——
    /** PIN 哈希值（SHA-256）；空串表示未设置 */
    fun appLockPinHashFlow(): Flow<String> = context.dataStore.data.map { it[APP_LOCK_PIN_HASH] ?: "" }
    suspend fun appLockPinHash(): String = context.dataStore.data.first()[APP_LOCK_PIN_HASH] ?: ""
    suspend fun saveAppLockPinHash(hash: String) {
        context.dataStore.edit { it[APP_LOCK_PIN_HASH] = hash }
    }
    fun appLockEnabledFlow(): Flow<Boolean> = context.dataStore.data.map { it[APP_LOCK_ENABLED] == "true" }
    suspend fun setAppLockEnabled(enabled: Boolean) {
        context.dataStore.edit { it[APP_LOCK_ENABLED] = if (enabled) "true" else "false" }
    }

    // —— AI 智能分析缓存（JSON 字符串）——
    /** 读 AI advice 缓存 JSON（服务端 AiAdviceResponse.advice 数组的 JSON 序列化）；空串表示无缓存 */
    suspend fun aiAdviceCacheJson(): String = context.dataStore.data.first()[AI_ADVICE_CACHE] ?: ""
    /** 读 AI insight 缓存 JSON（服务端 AiAdviceResponse.insights 数组的 JSON 序列化）；空串表示无缓存 */
    suspend fun aiInsightCacheJson(): String = context.dataStore.data.first()[AI_INSIGHT_CACHE] ?: ""
    /** 读 AI 报告生成时间（ISO8601）；空串表示未生成 */
    suspend fun aiAdviceGeneratedAt(): String = context.dataStore.data.first()[AI_ADVICE_GENERATED_AT] ?: ""
    /** 写入 AI advice/insight 缓存 + 生成时间。adviceJson/insightJson 是数组的 JSON 字符串；空串表示清空 */
    suspend fun saveAiAdviceCache(adviceJson: String, insightJson: String, generatedAt: String) {
        context.dataStore.edit {
            it[AI_ADVICE_CACHE] = adviceJson
            it[AI_INSIGHT_CACHE] = insightJson
            it[AI_ADVICE_GENERATED_AT] = generatedAt
        }
    }

    /**
     * 获取「陪伴天数」：自首次启动起算到今天的天数（含今天）。
     * 首次访问时若无记录，则写入今天 0 点的时间戳，保证后续调用得到稳定值。
     */
    suspend fun memberDays(): Int {
        val prefs = context.dataStore.data.first()
        val firstAt = prefs[FIRST_LAUNCH_AT] ?: run {
            val today0 = startOfTodayMillis()
            context.dataStore.edit { it[FIRST_LAUNCH_AT] = today0 }
            return 1
        }
        val now = System.currentTimeMillis()
        val diffMs = (now - firstAt).coerceAtLeast(0)
        val days = TimeUnit.MILLISECONDS.toDays(diffMs).toInt() + 1
        return days.coerceAtLeast(1)
    }

    private fun startOfTodayMillis(): Long {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.CHINA)
        return runCatching { fmt.parse(fmt.format(Date()))?.time }.getOrNull() ?: System.currentTimeMillis()
    }
}
