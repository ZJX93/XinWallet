package com.xinwallet.app.ui.viewmodel

import android.app.Application
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.AiCandidateTxn
import com.xinwallet.app.data.model.AiTxnValidation
import com.xinwallet.app.data.model.ChatMessage
import com.xinwallet.app.data.model.ChatRequest
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AiRepository
import com.xinwallet.app.data.repository.TransactionRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * AI v0.2 预测确认态。
 * 存在（非 null）时界面必须展示确认卡片；用户确认或弃置后才清空。
 * AI 输出【永不直接写账本】，落账只发生在 commitPrediction 之后。
 */
data class AiConfirmState(
    val predictionId: Int,
    /** parse 返回的原始快照，只读基准，用于 dirty 判定 */
    val original: List<AiCandidateTxn>,
    /** 可编辑副本 */
    val items: List<AiCandidateTxn>,
    val verdict: String,
    val reasons: List<String> = emptyList(),
    val overall: Double? = null,
    /** 字段级裁决明细，仅 needs_confirmation 时拉取；判定权在服务端 */
    val perTxn: List<AiTxnValidation> = emptyList(),
    /** 进入确认态时固定，重试复用以保证不重复落账 */
    val idempotencyKey: String,
    val committing: Boolean = false
) {
    /** 是否被用户改动过 → 决定 action = corrected / confirmed */
    val isDirty: Boolean
        get() {
            if (items.size != original.size) return true
            return items.indices.any { i ->
                val a = items[i]
                val b = original.getOrNull(i) ?: return@any true
                a.seq != b.seq ||
                    a.type != b.type ||
                    kotlin.math.abs(a.amount - b.amount) > 1e-9 ||
                    a.categoryId != b.categoryId ||
                    a.accountId != b.accountId ||
                    a.fromAccountId != b.fromAccountId ||
                    a.toAccountId != b.toAccountId ||
                    a.date != b.date ||
                    (a.note ?: "") != (b.note ?: "")
            }
        }

    fun fieldVerdict(seq: Int, field: String) =
        perTxn.firstOrNull { it.seq == seq }?.perField?.get(field)
}

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    val thinking: Boolean = false,
    val recording: Boolean = false,
    val recordingStart: Long? = null,
    val transcribing: Boolean = false,
    val error: String? = null,
    val toast: String? = null,
    /** 非 null 时展示 v0.2 确认卡片 */
    val aiConfirm: AiConfirmState? = null
)

class ChatViewModel(
    private val app: Application,
    private val aiRepo: AiRepository,
    private val txnRepo: TransactionRepository
) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state

    private var inputBeforeVoice: String = ""

    fun onInputChange(text: String) { _state.value = _state.value.copy(input = text) }
    fun clearError() { _state.value = _state.value.copy(error = null) }
    fun clearToast() { _state.value = _state.value.copy(toast = null) }
    fun clearMessages() {
        // 清空会话时同步弃置未确认的预测，避免遗留 pending 快照
        _state.value.aiConfirm?.let { c ->
            viewModelScope.launch { aiRepo.discardPrediction(c.predictionId, "chat_cleared") }
        }
        _state.value = _state.value.copy(messages = emptyList(), input = "", aiConfirm = null)
    }

    fun deleteTransaction(txnId: Int) {
        viewModelScope.launch {
            _state.value = _state.value.copy(toast = "正在删除…")
            when (val r = txnRepo.deleteTransaction(txnId)) {
                is ApiResult.Success -> _state.value = _state.value.copy(toast = "已删除交易 #$txnId")
                is ApiResult.Error -> _state.value = _state.value.copy(error = "删除失败：${r.message}")
            }
        }
    }

    private fun appendUser(msg: ChatMessage): List<ChatMessage> {
        val next = _state.value.messages + msg
        _state.value = _state.value.copy(messages = next, input = "", sending = true, thinking = true, error = null)
        return next
    }

    private fun finalize(assistant: ChatMessage) {
        _state.value = _state.value.copy(messages = _state.value.messages + assistant, sending = false, thinking = false)
    }

    private fun fail(next: List<ChatMessage>, message: String) {
        _state.value = _state.value.copy(messages = next.dropLast(1), sending = false, thinking = false, error = message)
    }

    /**
     * 文本发送。优先走 AI v0.2 确定性记账通道（parse → 确认 → commit）：
     *   - parse 成功 ⇒ 进入确认态，绝不直接落账
     *   - parse 返回 422（识别不出交易，例如「这个月花了多少」）⇒ 回退 legacy /ai/chat 保留咨询能力
     * @param preferParse 传 false 可强制走对话通道（用于「换成对话」入口）
     */
    fun sendText(text: String? = null, preferParse: Boolean = true) {
        val content = (text ?: _state.value.input).trim()
        if (content.isBlank()) return
        // 已有待确认预测时，先让用户处理完，避免多个快照并行造成状态混乱
        if (_state.value.aiConfirm != null) {
            _state.value = _state.value.copy(error = "请先确认或弃置上一条识别结果")
            return
        }
        val next = appendUser(ChatMessage(role = "user", content = content))

        viewModelScope.launch {
            if (preferParse) {
                val parsed = aiRepo.parseTransactions(
                    text = content,
                    accountId = defaultAccountId,
                    date = todayLocal(),
                    source = "chat"          // 输入通道是对话；平台信息在 context.platform
                )
                if (parsed is ApiResult.Success) {
                    val d = parsed.data
                    // 需要确认时补拉字段级裁决明细，用于高亮低置信字段
                    val perTxn = if (d.needsConfirmation) {
                        when (val snap = aiRepo.getPrediction(d.predictionId)) {
                            is ApiResult.Success -> snap.data.validation?.perTxn ?: emptyList()
                            is ApiResult.Error -> emptyList()
                        }
                    } else emptyList()

                    val summary = buildString {
                        append("我识别到 ${d.transactions.size} 笔记录")
                        if (d.needsConfirmation) append("，其中有字段置信度偏低，请核对后确认")
                        else append("，请确认后入账")
                    }
                    _state.value = _state.value.copy(
                        messages = _state.value.messages + ChatMessage(role = "assistant", content = summary),
                        sending = false, thinking = false,
                        aiConfirm = AiConfirmState(
                            predictionId = d.predictionId,
                            original = d.transactions,
                            items = d.transactions,
                            verdict = d.verdict,
                            reasons = d.reasons,
                            overall = d.overallConfidence,
                            perTxn = perTxn,
                            idempotencyKey = aiRepo.newIdempotencyKey(d.predictionId)
                        )
                    )
                    return@launch
                }

                // parse 失败：仅在「识别不出交易」时回退对话；其他错误（网络/鉴权）直接暴露
                val err = parsed as ApiResult.Error
                val notATransaction = err.code == 422 || err.message.contains("未能从文本中识别")
                if (!notATransaction) {
                    fail(next, err.message)
                    return@launch
                }
            }

            // legacy 对话通道：查询/咨询类意图
            when (val r = aiRepo.chat(ChatRequest(messages = next))) {
                is ApiResult.Success -> finalize(
                    ChatMessage(role = "assistant", content = r.data.reply, transactions = r.data.transactions)
                )
                is ApiResult.Error -> fail(next, r.message)
            }
        }
    }

    /* ---------------- AI v0.2 确认态操作 ---------------- */

    /** 默认账户：由界面在加载账户后注入，作为 parse 的 context.account_id */
    var defaultAccountId: Int? = null

    private fun todayLocal(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

    private fun updateConfirm(block: (AiConfirmState) -> AiConfirmState) {
        val c = _state.value.aiConfirm ?: return
        _state.value = _state.value.copy(aiConfirm = block(c))
    }

    /** 修改某笔候选交易；人工修正的字段置信度置为 1.0 并标记 user_corrected */
    fun editCandidate(seq: Int, transform: (AiCandidateTxn) -> AiCandidateTxn, correctedField: String? = null) {
        updateConfirm { c ->
            c.copy(items = c.items.map { item ->
                if (item.seq != seq) item else {
                    val edited = transform(item)
                    if (correctedField == null) edited
                    else edited.copy(
                        confidence = edited.confidence + (correctedField to 1.0),
                        evidence = edited.evidence + (correctedField to "user_corrected")
                    )
                }
            })
        }
    }

    fun setCandidateAmount(seq: Int, amount: Double) =
        editCandidate(seq, { it.copy(amount = amount) }, "amount")

    fun setCandidateCategory(seq: Int, categoryId: Int?, categoryName: String?) =
        editCandidate(seq, { it.copy(categoryId = categoryId, categoryName = categoryName) }, "category")

    fun setCandidateAccount(seq: Int, accountId: Int?) =
        editCandidate(seq, { it.copy(accountId = accountId) })

    fun setCandidateDate(seq: Int, date: String) =
        editCandidate(seq, { it.copy(date = date) }, "date")

    fun setCandidateNote(seq: Int, note: String) =
        editCandidate(seq, { it.copy(note = note) })

    /** 切换类型：类目候选集随之改变，旧类目必然失效需清空 */
    fun setCandidateType(seq: Int, type: String) =
        editCandidate(seq, { it.copy(type = type, categoryId = null, categoryName = null) }, "type")

    fun setCandidateTransferAccounts(seq: Int, fromId: Int?, toId: Int?) =
        editCandidate(seq, { it.copy(fromAccountId = fromId, toAccountId = toId) })

    fun removeCandidate(seq: Int) {
        val c = _state.value.aiConfirm ?: return
        val rest = c.items.filter { it.seq != seq }
        if (rest.isEmpty()) {
            discardPrediction("用户移除了全部候选")
        } else {
            _state.value = _state.value.copy(aiConfirm = c.copy(items = rest))
        }
    }

    /** 确认并落账。落账是唯一写账本的入口。 */
    fun commitPrediction() {
        val c = _state.value.aiConfirm ?: return
        if (c.committing) return

        // 前置自检：比服务端 422 更具体地定位问题
        c.items.forEach { it ->
            val tag = "第 ${it.seq} 笔"
            if (it.amount <= 0) {
                _state.value = _state.value.copy(error = "${tag}金额无效"); return
            }
            if (it.type == "transfer") {
                if (it.fromAccountId == null || it.toAccountId == null) {
                    _state.value = _state.value.copy(error = "${tag}请选择转出与转入账户"); return
                }
                if (it.fromAccountId == it.toAccountId) {
                    _state.value = _state.value.copy(error = "${tag}转出与转入账户不能相同"); return
                }
            } else if (it.accountId == null) {
                _state.value = _state.value.copy(error = "${tag}请选择账户"); return
            }
        }

        updateConfirm { it.copy(committing = true) }
        viewModelScope.launch {
            val r = aiRepo.commitPrediction(
                id = c.predictionId,
                corrected = if (c.isDirty) c.items else null,
                idempotencyKey = c.idempotencyKey
            )
            when (r) {
                is ApiResult.Success -> {
                    val n = r.data.transactions.size
                    _state.value = _state.value.copy(
                        aiConfirm = null,
                        toast = "${r.data.message} · $n 笔已记账",
                        messages = _state.value.messages + ChatMessage(
                            role = "assistant",
                            content = "已记账 $n 笔。",
                            transactions = emptyList()
                        )
                    )
                }
                is ApiResult.Error -> {
                    // 409：快照已被提交或弃置（状态机单向不可逆），本地状态过期，
                    // 清空避免反复点击。以 HTTP 状态码判定而非错误文案，后端改文案不会失效。
                    if (r.code == 409) {
                        _state.value = _state.value.copy(
                            aiConfirm = null,
                            error = "${r.message}，已重置识别结果"
                        )
                    } else {
                        updateConfirm { it.copy(committing = false) }
                        _state.value = _state.value.copy(error = r.message)
                    }
                }
            }
        }
    }

    /** 弃置预测：仅记录事件，不形成负向学习 */
    fun discardPrediction(reason: String = "user_discarded") {
        val c = _state.value.aiConfirm ?: return
        _state.value = _state.value.copy(aiConfirm = null)
        viewModelScope.launch {
            when (val r = aiRepo.discardPrediction(c.predictionId, reason)) {
                is ApiResult.Success -> _state.value = _state.value.copy(toast = "已弃置本次识别")
                // 弃置失败不阻塞用户继续使用，仅提示
                is ApiResult.Error -> _state.value = _state.value.copy(toast = "弃置未成功：${r.message}")
            }
        }
    }

    /**
     * 图片发送：走 v0.2 图片记账通道（/ai/ocr：转录 → 票据预处理 → parse → 预测快照），
     * 识别出交易 ⇒ 弹与文字通道同款的确认卡片；识别不出 ⇒ 文字回执。
     * ⛔ 绝不走 legacy /ai/chat：那里没有记账工具，system prompt 会让 AI 回复
     *   「我没法直接帮你落账，请走旁边的智能记账按钮」（用户实测踩坑 2026-08-26）。
     */
    fun sendImage(bytes: ByteArray, mime: String) {
        // 与文字通道同规则：已有待确认预测时先处理完，避免多个快照并行
        if (_state.value.aiConfirm != null) {
            _state.value = _state.value.copy(error = "请先确认或弃置上一条识别结果")
            return
        }
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val next = appendUser(ChatMessage(role = "user", content = "", imageBase64 = b64, mime = mime))
        viewModelScope.launch {
            when (val r = aiRepo.ocr(bytes, "chat.jpg", mime, defaultAccountId)) {
                is ApiResult.Success -> {
                    val d = r.data
                    // 「识别不出交易」分支不返回 v0.2 字段（Gson 绕过默认值 → null），必须判空
                    val txns = d.transactions.orEmpty()
                    if (d.predictionId > 0 && txns.isNotEmpty()) {
                        val perTxn = if (d.needsConfirmation) {
                            when (val snap = aiRepo.getPrediction(d.predictionId)) {
                                is ApiResult.Success -> snap.data.validation?.perTxn ?: emptyList()
                                is ApiResult.Error -> emptyList()
                            }
                        } else emptyList()
                        val summary = buildString {
                            append("我从图片里识别到 ${txns.size} 笔记录")
                            if (d.needsConfirmation) append("，其中有字段置信度偏低，请核对后确认")
                            else append("，请确认后入账")
                        }
                        _state.value = _state.value.copy(
                            messages = _state.value.messages + ChatMessage(role = "assistant", content = summary),
                            sending = false, thinking = false,
                            aiConfirm = AiConfirmState(
                                predictionId = d.predictionId,
                                original = txns,
                                items = txns,
                                verdict = d.verdict ?: "needs_confirmation",
                                reasons = d.reasons.orEmpty(),
                                overall = d.overallConfidence,
                                perTxn = perTxn,
                                idempotencyKey = aiRepo.newIdempotencyKey(d.predictionId)
                            )
                        )
                    } else {
                        finalize(
                            ChatMessage(
                                role = "assistant",
                                content = d.reason?.takeIf { it.isNotBlank() }
                                    ?: "这张图里没认出交易，可以换个角度拍，或直接用文字告诉我（如「午饭 28 元」）"
                            )
                        )
                    }
                }
                is ApiResult.Error -> fail(next, r.message)
            }
        }
    }

    // ---- 语音识别：优先端上 SpeechRecognizer，不支持时回退 MediaRecorder + 后端转写 ----
    private var speechRecognizer: SpeechRecognizer? = null
    private var usingBackendVoice = false       // 是否在用后端转写模式
    private var mediaRecorder: MediaRecorder? = null
    private var audioFile: File? = null
    private var recordingJob: Job? = null

    private fun ensureSpeechRecognizer(): SpeechRecognizer? {
        if (speechRecognizer != null) return speechRecognizer
        if (!SpeechRecognizer.isRecognitionAvailable(app)) return null
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(app)
        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onError(error: Int) {
                val msg = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH -> "未识别到语音内容"
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "没有检测到语音，请重试"
                    SpeechRecognizer.ERROR_AUDIO -> "录音错误"
                    SpeechRecognizer.ERROR_NETWORK -> "网络错误"
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "网络超时"
                    SpeechRecognizer.ERROR_SERVER -> "语音服务异常"
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "语音识别忙，请重试"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "缺少录音权限"
                    else -> "语音识别错误($error)"
                }
                _state.value = _state.value.copy(
                    recording = false, recordingStart = null, transcribing = false,
                    input = inputBeforeVoice, error = msg
                )
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                if (!text.isNullOrBlank()) {
                    _state.value = _state.value.copy(
                        input = if (inputBeforeVoice.isBlank()) text else "$inputBeforeVoice $text"
                    )
                }
            }

            override fun onResults(results: Bundle?) {
                val text = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                _state.value = _state.value.copy(
                    recording = false, recordingStart = null, transcribing = false,
                    input = if (text.isNullOrBlank()) inputBeforeVoice
                            else if (inputBeforeVoice.isBlank()) text
                            else "$inputBeforeVoice $text",
                    error = if (text.isNullOrBlank()) "未识别到语音内容" else null
                )
            }
        })
        return speechRecognizer
    }

    /** 开始语音识别 */
    fun startVoice() {
        if (_state.value.recording) return
        inputBeforeVoice = _state.value.input

        // 方案1：尝试端上 SpeechRecognizer
        val recognizer = ensureSpeechRecognizer()
        if (recognizer != null) {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            try {
                recognizer.startListening(intent)
                usingBackendVoice = false
                _state.value = _state.value.copy(recording = true, recordingStart = System.currentTimeMillis(), error = null)
                return
            } catch (e: SecurityException) {
                // 华为等设备禁止绑定语音服务，销毁后回退
                try { speechRecognizer?.destroy() } catch (_: Exception) {}
                speechRecognizer = null
            }
        }

        // 方案2：回退到 MediaRecorder + 后端转写
        try {
            val dir = File(app.cacheDir, "voice").apply { mkdirs() }
            val file = File(dir, "voice_${System.currentTimeMillis()}.m4a")
            audioFile = file

            @Suppress("DEPRECATION")
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(app)
            } else {
                MediaRecorder()
            }
            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(16000)
                setAudioEncodingBitRate(32000)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            mediaRecorder = recorder
            usingBackendVoice = true
            _state.value = _state.value.copy(recording = true, recordingStart = System.currentTimeMillis(), error = null)
        } catch (e: Exception) {
            _state.value = _state.value.copy(error = "无法启动录音：${e.message}")
        }
    }

    /** 停止语音 → 端上模式等待 onResults；后端模式上传文件转写 */
    fun stopVoice() {
        if (!_state.value.recording) return
        _state.value = _state.value.copy(recording = false, recordingStart = null, transcribing = true)

        if (!usingBackendVoice) {
            // 端上模式：stopListening 等 onResults 回调
            speechRecognizer?.stopListening()
            viewModelScope.launch {
                delay(8000)
                if (_state.value.transcribing) {
                    // 部分设备 stopListening 后不回调 onResults，但 onPartialResults 已实时更新 input；
                    // 此时已有识别文字则视为成功，避免误报超时丢失内容
                    val hasPartial = _state.value.input.isNotBlank() && _state.value.input != inputBeforeVoice
                    _state.value = _state.value.copy(
                        transcribing = false,
                        error = if (hasPartial) null else "语音识别超时"
                    )
                }
            }
            return
        }

        // 后端模式：停止录音 → base64 → 上传后端转写
        val recorder = mediaRecorder
        val file = audioFile
        mediaRecorder = null
        audioFile = null

        recordingJob = viewModelScope.launch(Dispatchers.IO) {
            try {
                recorder?.apply {
                    try { stop() } catch (_: Exception) {}
                    release()
                }
                if (file == null || !file.exists() || file.length() < 200) {
                    _state.value = _state.value.copy(transcribing = false, error = "录音太短，请重试")
                    return@launch
                }
                val audioBase64 = Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
                file.delete()

                when (val r = aiRepo.transcribe(audioBase64, "audio/mp4")) {
                    is ApiResult.Success -> {
                        val text = r.data.text.trim()
                        if (text.isNotBlank()) {
                            val newInput = if (inputBeforeVoice.isBlank()) text else "$inputBeforeVoice $text"
                            _state.value = _state.value.copy(input = newInput, transcribing = false)
                        } else {
                            _state.value = _state.value.copy(transcribing = false, error = "未识别到语音内容")
                        }
                    }
                    is ApiResult.Error -> {
                        _state.value = _state.value.copy(transcribing = false, error = "语音转写失败：${r.message}")
                    }
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(transcribing = false, error = "语音处理出错：${e.message}")
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        recordingJob?.cancel()
        try { speechRecognizer?.stopListening() } catch (_: Exception) {}
        try { speechRecognizer?.destroy() } catch (_: Exception) {}
        speechRecognizer = null
        try { mediaRecorder?.apply { try { stop() } catch (_: Exception) {}; release() } } catch (_: Exception) {}
        try { audioFile?.delete() } catch (_: Exception) {}
    }
}
