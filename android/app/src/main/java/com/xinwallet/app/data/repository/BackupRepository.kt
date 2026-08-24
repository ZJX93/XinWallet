package com.xinwallet.app.data.repository

import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

/**
 * 账本备份（数据管理）：导出 / 导入 xlsx。
 * 与鸿蒙 DataManagement.ets 走同一套服务端接口（GET /backup/export、POST /backup/import）。
 *
 * 导出的特殊性：服务端返回的是二进制流而非 { success, data }，
 * 因此不能用 safeApiCall，得手工判 HTTP 状态并把 byteStream 落盘。
 */
class BackupRepository(private val apiProvider: () -> ApiService) {

    companion object {
        const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }

    /**
     * 导出备份并写入 [dest]，成功返回落盘后的 File。
     * 失败时返回 Error 而不抛异常，与其他 Repository 的调用风格保持一致。
     */
    suspend fun exportTo(dest: File): ApiResult<File> = withContext(Dispatchers.IO) {
        try {
            val resp = apiProvider().exportBackup()
            if (!resp.isSuccessful) {
                // 错误分支返回的是 JSON（{ success:false, message }），尽量把后端文案透出来
                val msg = runCatching {
                    resp.errorBody()?.string()?.let { raw ->
                        com.google.gson.JsonParser.parseString(raw)
                            .asJsonObject.get("message")?.asString
                    }
                }.getOrNull()
                return@withContext ApiResult.Error(msg ?: "导出失败 HTTP ${resp.code()}", resp.code())
            }
            val body = resp.body() ?: return@withContext ApiResult.Error("导出失败：空响应")
            dest.parentFile?.mkdirs()
            body.byteStream().use { input ->
                dest.outputStream().use { out -> input.copyTo(out) }
            }
            if (dest.length() <= 0L) {
                dest.delete()
                return@withContext ApiResult.Error("导出失败：备份文件为空")
            }
            ApiResult.Success(dest)
        } catch (e: Exception) {
            ApiResult.Error(e.message ?: "导出失败")
        }
    }

    /**
     * 上传 xlsx 恢复账本。
     * 表单字段名固定为 file（后端 multer `upload.single('file')`）；
     * 文件名保留 .xlsx 后缀，后端 fileFilter 会按扩展名或 MIME 放行。
     */
    suspend fun import(file: File) = safeApiCall {
        val body = file.asRequestBody(XLSX_MIME.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData(
            "file",
            file.name.ifBlank { "backup.xlsx" },
            body
        )
        apiProvider().importBackup(part)
    }
}
