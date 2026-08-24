package com.xinwallet.app.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 「记住密码」凭据存储。
 *
 * ⛔⛔ 安全边界（改这个文件前必读）⛔⛔
 * 1. 密码**必须**经 EncryptedSharedPreferences 落盘，密钥由 Android KeyStore 托管
 *    （AES256_GCM，可用 TEE/StrongBox 硬件保护）。**绝不允许**退回普通
 *    SharedPreferences / DataStore —— 那等于明文，root 或 adb backup 就能读走。
 * 2. 即便加密，密码在本机仍可被本应用解密使用。这是「记住密码」功能的固有代价，
 *    与 HashUtil.kt 里「不存明文」的原则并不冲突（那条针对的是**服务端**存储）。
 * 3. 取消勾选时**必须**立刻 clear()，否则用户以为关了、其实密码还躺在磁盘上。
 *
 * ⚠️ 与 SessionManager(DataStore) 刻意分开的原因：
 *    EncryptedSharedPreferences 是同步 API 且底层不是 DataStore，混进去会破坏
 *    SessionManager 全异步的契约；且加密文件独立更便于"一键清除凭据"。
 *
 * ⚠️ 首次创建 MasterKey 可能抛异常（KeyStore 损坏、厂商 ROM 魔改、
 *    应用被恢复到新设备导致密钥失效）。所有方法都必须 runCatching 兜底 ——
 *    记住密码失效只该降级成"要手动输密码"，绝不能让登录页崩溃。
 */
class CredentialStore(private val context: Context) {

    companion object {
        private const val FILE_NAME = "xin_wallet_credential"
        private const val KEY_REMEMBER = "remember_pwd"
        private const val KEY_USERNAME = "saved_username"
        private const val KEY_PASSWORD = "saved_password"
    }

    // 懒加载 + 失败降级为 null：KeyStore 异常时整个功能静默失效，不影响正常登录
    private val prefs: SharedPreferences? by lazy {
        runCatching {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }.getOrNull()
    }

    /** 是否勾选了「记住密码」 */
    fun isRemember(): Boolean = runCatching { prefs?.getBoolean(KEY_REMEMBER, false) ?: false }
        .getOrDefault(false)

    /** 已保存的用户名（仅在勾选记住密码时有值；未勾选走 SessionManager.LAST_USERNAME） */
    fun savedUsername(): String = runCatching { prefs?.getString(KEY_USERNAME, "") ?: "" }
        .getOrDefault("")

    /** 已保存的密码；未勾选或读取失败时返回空串 */
    fun savedPassword(): String = runCatching {
        if (!isRemember()) "" else prefs?.getString(KEY_PASSWORD, "") ?: ""
    }.getOrDefault("")

    /**
     * 登录成功后保存凭据。
     * ⛔ 只能在**登录成功后**调用 —— 密码错误时保存会导致下次自动填入错密码。
     */
    fun save(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) return
        runCatching {
            prefs?.edit()
                ?.putBoolean(KEY_REMEMBER, true)
                ?.putString(KEY_USERNAME, username)
                ?.putString(KEY_PASSWORD, password)
                ?.apply()
        }
    }

    /** 取消勾选 / 登出时清除。⛔ 必须真删 key，不能只把 remember 置 false */
    fun clear() {
        runCatching {
            prefs?.edit()
                ?.putBoolean(KEY_REMEMBER, false)
                ?.remove(KEY_USERNAME)
                ?.remove(KEY_PASSWORD)
                ?.apply()
        }
    }
}
