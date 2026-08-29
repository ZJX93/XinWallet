package com.xinwallet.app.data.repository

import com.xinwallet.app.data.model.AiCandidateTxn
import com.xinwallet.app.data.model.AiCommitRequest
import com.xinwallet.app.data.model.AiDiscardRequest
import com.xinwallet.app.data.model.AiParseContext
import com.xinwallet.app.data.model.AiEvaluationRunPayload
import com.xinwallet.app.data.model.AiInsightRequest
import com.xinwallet.app.data.model.AiParseRequest
import com.xinwallet.app.data.model.AiProviderPayload
import com.xinwallet.app.data.model.AiRuleCreatePayload
import com.xinwallet.app.data.model.AiRuleDisablePayload
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
     * @param accountId 必传（走 v0.2 闭环时）：抽取器不推断账户，快照缺它 commit 阶段 422
     */
    suspend fun ocr(bytes: ByteArray, fileName: String = "bill.jpg", mime: String = "image/jpeg", accountId: Int? = null) =
        safeApiCall {
            val body = bytes.toRequestBody(mime.toMediaTypeOrNull())
            val part = MultipartBody.Part.createFormData("image", fileName, body)
            val textPlain = "text/plain".toMediaTypeOrNull()
            val accPart = accountId?.toString()?.toRequestBody(textPlain)
            val platPart = "android".toRequestBody(textPlain)
            apiProvider().ocr(part, accPart, platPart)
        }

    /** AI 对话记账：把完整对话历史发给后端，后端用 function calling 建账/查账 */
    suspend fun chat(req: ChatRequest) = safeApiCall { apiProvider().chat(req) }

    /** 读取 AI 设置（含 web 端起的 ai_name，用于安卓端标题动态显示） */
    suspend fun getSettings() = safeApiCall { apiProvider().getAiSettings() }

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
        // ⛔ 绝不带 mock=1：服务端一旦命中 mock 分支就跳过真实 AI，直接返回硬编码样例
        //    （account_id 恒为 null / evidence.account='fallback_default'），
        //    前端会把账户判成「未识别」——表现为「AI 账户识别能力消失」。
        //    分发出去的是 debug APK，debug 自动 mock 会直接坑掉线上用户（2026-08-29 踩坑）。
        apiProvider().parseTransactions(
            AiParseRequest(
                text = text,
                context = AiParseContext(accountId = accountId, date = date),
                source = source
            ),
            mock = null
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

    /* ---------------- AI 消费洞察 ----------------
     * ⚠️ 2026-08-27 合并：insight 改由 advice() 一并返回（AiAdviceResponse.insights）。
     *   /ai/insight 路由服务端已置 410 软弃；此处不再提供 insight() 方法，
     *   AiInsightViewModel.kt 已删除。 */

    /* ---------------- AI 服务商配置 ----------------
     * GET 列表返回的 apiKey 是服务端掩码（如 sk-****abcd），不可用于回传；PUT 时若
     * 用户不修改 key 字段，传 "" 即可，服务端会自动保留原值。
     * 测试连接返回 {ok, reply} 或 {ok:false, error} —— 调用方按 ok 字段判定结果。 */

    suspend fun listProviders() =
        safeApiCall { apiProvider().aiProviders() }

    suspend fun createProvider(payload: AiProviderPayload) =
        safeApiCall { apiProvider().aiProviderCreate(payload) }

    suspend fun updateProvider(id: Int, payload: AiProviderPayload) =
        safeApiCall { apiProvider().aiProviderUpdate(id, payload) }

    suspend fun deleteProvider(id: Int) =
        safeApiCall { apiProvider().aiProviderDelete(id) }

    suspend fun activateProvider(id: Int) =
        safeApiCall { apiProvider().aiProviderActivate(id) }

    suspend fun testProvider(id: Int) =
        safeApiCall { apiProvider().aiProviderTest(id) }

    /* ---------------- AI 财务建议 ----------------
     * 与 insight 类似：服务端从财务数据抽取 3-5 条建议；输出多 impact + priority 三态。
     * 入参无（body 留空），调用前需要已激活一个对话服务商。 */
    suspend fun advice() =
        safeApiCall { apiProvider().aiAdvice() }

    /* ---------------- AI 规则 ----------------
     * 用户可手动管理（验收 #6「用户可 disable」客户端路径）。
     * listRules 必须把返回的 thresholds/weights 一起带回 UI，禁客户端硬编码阈值。 */

    suspend fun listRules(
        status: String? = null,
        limit: Int = 100,
        offset: Int = 0,
    ) = safeApiCall { apiProvider().aiRules(status = status, limit = limit, offset = offset) }

    suspend fun createRule(payload: AiRuleCreatePayload) =
        safeApiCall { apiProvider().aiRuleCreate(payload) }

    suspend fun disableRule(id: Int, reason: String? = null) =
        safeApiCall { apiProvider().aiRuleDisable(id, AiRuleDisablePayload(reason = reason)) }

    suspend fun enableRule(id: Int) =
        safeApiCall { apiProvider().aiRuleEnable(id) }

    suspend fun ruleEvidence(id: Int, limit: Int = 50) =
        safeApiCall { apiProvider().aiRuleEvidence(id, limit = limit) }

    /* ---------------- AI 学习统计 + 评测 ----------------
     * evaluation/run 任意时刻可调，但要在 UI 上明确「这会发起一次离线跑批（可能耗时数秒）」
     * —— 与 advice/insight 不同，evaluation 不依赖对话服务商，是纯本地 CPU 操作。 */

    suspend fun learningStats() =
        safeApiCall { apiProvider().aiLearningStats() }

    suspend fun runEvaluation(label: String? = null, persist: Boolean = true) =
        safeApiCall { apiProvider().aiEvaluationRun(AiEvaluationRunPayload(label = label, persist = persist)) }

    suspend fun listEvaluationRuns(limit: Int = 10) =
        safeApiCall { apiProvider().aiEvaluationRuns(limit = limit) }
}
