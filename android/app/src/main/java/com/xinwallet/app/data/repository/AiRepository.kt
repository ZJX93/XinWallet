package com.xinwallet.app.data.repository

import com.xinwallet.app.data.model.AiCandidateTxn
import com.xinwallet.app.data.model.AiCommitRequest
import com.xinwallet.app.data.model.AiDiscardRequest
import com.xinwallet.app.data.model.AiParseContext
import com.xinwallet.app.data.model.AiParseRequest
import com.xinwallet.app.data.model.ChatRequest
import com.xinwallet.app.data.model.TranscribeRequest
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

class AiRepository(private val apiProvider: () -> ApiService) {

    /**
     * 上传账单图片做 OCR + 交易项提取。
     * 后端 multer 限制 5MB 且只接受图片格式，字段名固定为 image。
     */
    suspend fun ocr(bytes: ByteArray, fileName: String = "bill.jpg", mime: String = "image/jpeg") =
        safeApiCall {
            val body = bytes.toRequestBody(mime.toMediaTypeOrNull())
            val part = MultipartBody.Part.createFormData("image", fileName, body)
            apiProvider().ocr(part)
        }

    suspend fun getOcrConfig() = safeApiCall { apiProvider().getOcrConfig() }

    /** AI 对话记账：把完整对话历史发给后端，后端用 function calling 建账/查账 */
    suspend fun chat(req: ChatRequest) = safeApiCall { apiProvider().chat(req) }

    /** 云端语音转写：audio 为 base64 */
    suspend fun transcribe(audio: String, mime: String? = null) =
        safeApiCall { apiProvider().transcribe(TranscribeRequest(audio, mime)) }

    /* ---------------- AI v0.2 预测闭环 ---------------- */

    /**
     * 解析文本为候选交易，仅产出预测快照，【不落账】。
     * @param source 输入通道，必须是 parse / chat / ocr / voice；平台信息走 context.platform
     */
    suspend fun parseTransactions(
        text: String,
        accountId: Int? = null,
        date: String? = null,
        source: String = "parse"
    ) = safeApiCall {
        apiProvider().parseTransactions(
            AiParseRequest(
                text = text,
                context = AiParseContext(accountId = accountId, date = date),
                source = source
            )
        )
    }

    /** 读取预测快照（含字段级裁决明细，用于确认界面高亮） */
    suspend fun getPrediction(id: Int) = safeApiCall { apiProvider().getPrediction(id) }

    /**
     * 提交预测并原子落账。
     * @param corrected 用户修正后的交易；为 null 表示原样确认（action=confirmed）
     * @param idempotencyKey 固定后重试不会重复落账；调用方应在进入确认界面时生成并复用
     */
    suspend fun commitPrediction(
        id: Int,
        corrected: List<AiCandidateTxn>? = null,
        idempotencyKey: String? = null
    ) = safeApiCall {
        apiProvider().commitPrediction(
            id,
            AiCommitRequest(
                action = if (corrected == null) "confirmed" else "corrected",
                transactions = corrected,
                idempotencyKey = idempotencyKey
            )
        )
    }

    /** 弃置预测：仅记录事件，不形成负向学习 */
    suspend fun discardPrediction(id: Int, reason: String = "user_discarded") =
        safeApiCall { apiProvider().discardPrediction(id, AiDiscardRequest(reason)) }

    /** 生成幂等键（服务端限制 64 字符） */
    fun newIdempotencyKey(predictionId: Int): String =
        "android-$predictionId-${UUID.randomUUID().toString().replace("-", "")}".take(64)
}
