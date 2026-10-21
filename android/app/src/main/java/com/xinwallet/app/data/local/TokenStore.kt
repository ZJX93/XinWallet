package com.xinwallet.app.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 访问令牌 / 刷新令牌存储（P0-11 加固）。
 *
 * ⛔ 安全边界（改这个文件前必读）⛔
 * 此前 SessionManager 把 token 明文存进 DataStore（preferencesDataStore），等于明文落盘——
 * root 或 adb backup 就能读走 bearer token，进而冒用用户身份。现改用
 * EncryptedSharedPreferences（与 CredentialStore 同源模式，密钥由 Android KeyStore 托管
 * AES256_GCM，可用 TEE/StrongBox 硬件保护）。**绝不允许**退回明文 DataStore。
 *
 * 与 CredentialStore 刻意分开：加密文件独立，便于"登出时只清 token 不清密码"。
 * 首次创建 MasterKey 可能抛异常（KeyStore 损坏 / 厂商 ROM 魔改 / 应用迁移到新设备），
 * 所有读取必须兜底返回空串——token 读取失败只该降级成"要重新登录"，绝不能让 App 崩溃。
 */
class TokenStore(private val context: Context) {

    companion object {
        private const val FILE_NAME = "xin_wallet_token"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
    }

    private val prefs by lazy {
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

    fun accessToken(): String = runCatching { prefs?.getString(KEY_ACCESS, "") ?: "" }.getOrDefault("")

    fun refreshToken(): String? =
        runCatching { prefs?.getString(KEY_REFRESH, "") ?: "" }.getOrNull()?.takeIf { it.isNotBlank() }

    fun save(access: String, refresh: String?) {
        if (access.isBlank()) return
        runCatching {
            prefs?.edit()?.apply {
                putString(KEY_ACCESS, access)
                if (!refresh.isNullOrBlank()) putString(KEY_REFRESH, refresh)
                apply()
            }
        }
    }

    fun clear() {
        runCatching {
            prefs?.edit()?.apply {
                remove(KEY_ACCESS)
                remove(KEY_REFRESH)
                apply()
            }
        }
    }
}
