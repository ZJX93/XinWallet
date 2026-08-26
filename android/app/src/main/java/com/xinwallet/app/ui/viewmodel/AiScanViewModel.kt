package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.model.Account
import com.xinwallet.app.data.model.Category
import com.xinwallet.app.data.model.CreateTransactionRequest
import com.xinwallet.app.data.model.OcrItem
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.AiRepository
import com.xinwallet.app.data.repository.CategoryRepository
import com.xinwallet.app.util.todayDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** 识别结果中的一条待确认交易，用户可逐条改分类/金额/日期或取消勾选 */
data class ScanRow(
    val key: Int,
    val selected: Boolean = true,
    val name: String = "",
    val amount: Double = 0.0,
    val type: String = "expense",
    val date: String = todayDate(),
    val time: String = "00:00:00",
    val categoryId: Int? = null,
    val categoryName: String? = null,
    /** 后端建议但本地没匹配上的分类名，用于提示用户手动选 */
    val suggestedCategory: String? = null,
    /** AI 识别返回的原始 note（「类目名-对象」格式），提交时优先使用 */
    val note: String? = null,
    /** 服务端 LLM 识别出的对象（商家/个人姓名），提交时透传给服务端用于格式拼接 */
    val merchant: String? = null
)

data class AiScanUiState(
    val loadingOptions: Boolean = true,
    val recognizing: Boolean = false,
    val submitting: Boolean = false,
    val error: String? = null,
    val toast: String? = null,
    val accounts: List<Account> = emptyList(),
    val categories: List<Category> = emptyList(),
    val accountId: Int? = null,
    val rows: List<ScanRow> = emptyList(),
    /** OCR 原始文字，识别不出条目时展示给用户排查 */
    val rawText: String = "",
    /** 后端解释为什么没提取到条目 */
    val reason: String? = null,
    /** 是否已配置腾讯云 OCR 密钥；false 时提示去 Web 端配置 */
    val ocrConfigured: Boolean = true,
    val doneCount: Int = 0,
    val finished: Boolean = false,
    /** 腾讯 OCR 重转录进行中（用户说「识别有误」时的兜底路径） */
    val retranscribing: Boolean = false
)

class AiScanViewModel(
    private val aiRepo: AiRepository,
    private val accRepo: AccountRepository,
    private val catRepo: CategoryRepository,
    private val txRepo: com.xinwallet.app.data.repository.TransactionRepository
) : ViewModel() {

    private val _state = MutableStateFlow(AiScanUiState())
    val state: StateFlow<AiScanUiState> = _state

    fun load() {
        viewModelScope.launch {
            val acc = accRepo.getAccounts()
            val cat = catRepo.getCategories()
            val cfg = aiRepo.getOcrConfig()
            val accounts = (acc as? ApiResult.Success)?.data?.accounts.orEmpty().filter { it.status == "active" }
            _state.value = _state.value.copy(
                loadingOptions = false,
                accounts = accounts,
                categories = (cat as? ApiResult.Success)?.data.orEmpty(),
                accountId = accounts.firstOrNull { it.isDefault }?.id ?: accounts.firstOrNull()?.id,
                ocrConfigured = (cfg as? ApiResult.Success)?.data?.configured ?: true
            )
        }
    }

    fun selectAccount(id: Int) { _state.value = _state.value.copy(accountId = id) }

    fun recognize(bytes: ByteArray, fileName: String, mime: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(recognizing = true, error = null, rows = emptyList(), reason = null)
            when (val r = aiRepo.ocr(bytes, fileName, mime)) {
                is ApiResult.Success -> {
                    val rows = r.data.items.mapIndexed { idx, it -> it.toRow(idx) }
                    _state.value = _state.value.copy(
                        recognizing = false,
                        rows = rows,
                        rawText = r.data.text,
                        reason = r.data.reason?.takeIf { it.isNotBlank() && rows.isEmpty() }
                    )
                }
                is ApiResult.Error -> _state.value = _state.value.copy(recognizing = false, error = r.message)
            }
        }
    }

    /**
     * OCR 重转录：复用已选图片，强制走腾讯 OCR 引擎（用户说「识别有误」时的兜底路径）。
     * 响应结构与 /ocr 一致，复用 toRow 映射；成功后替换当前 rows 并提示已用腾讯 OCR 重新识别。
     */
    fun retranscribe(bytes: ByteArray, fileName: String, mime: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(retranscribing = true, error = null, rows = emptyList(), reason = null)
            when (val r = aiRepo.ocrRetranscribe(bytes, fileName, mime)) {
                is ApiResult.Success -> {
                    val rows = r.data.items.mapIndexed { idx, it -> it.toRow(idx) }
                    _state.value = _state.value.copy(
                        retranscribing = false,
                        rows = rows,
                        rawText = r.data.text,
                        reason = r.data.reason?.takeIf { it.isNotBlank() && rows.isEmpty() },
                        toast = "已用腾讯 OCR 重新识别"
                    )
                }
                is ApiResult.Error -> _state.value = _state.value.copy(retranscribing = false, error = r.message)
            }
        }
    }

    /** OCR 给的是分类「名称」，按同类型分类先精确后模糊匹配到本地 id */
    private fun OcrItem.toRow(index: Int): ScanRow {
        val type = if (this.type == "income") "income" else "expense"
        val pool = _state.value.categories.filter { it.type == type }
        val wanted = category?.trim().orEmpty()
        val matched = when {
            wanted.isBlank() -> null
            else -> pool.firstOrNull { it.name == wanted }
                ?: pool.firstOrNull { it.name.contains(wanted) || wanted.contains(it.name) }
        }
        val rawDate = date?.trim().orEmpty()
        val d = rawDate.substringBefore(' ').takeIf { it.length == 10 } ?: todayDate()
        val t = rawDate.substringAfter(' ', "").takeIf { it.length == 8 } ?: "00:00:00"
        return ScanRow(
            key = index,
            name = name.ifBlank { note.orEmpty() },
            amount = kotlin.math.abs(amount),
            type = type,
            date = d,
            time = t,
            categoryId = matched?.id,
            categoryName = matched?.name,
            suggestedCategory = if (matched == null && wanted.isNotBlank()) wanted else null,
            note = note?.trim()?.takeIf { it.isNotBlank() },
            merchant = merchant?.trim()?.takeIf { it.isNotBlank() }
        )
    }

    fun toggle(key: Int) = updateRow(key) { it.copy(selected = !it.selected) }
    fun setAmount(key: Int, amount: Double) = updateRow(key) { it.copy(amount = amount) }
    fun setDate(key: Int, date: String) = updateRow(key) { it.copy(date = date) }
    fun setDateTime(key: Int, datetime: String) = updateRow(key) {
        val d = datetime.substringBefore(' ').takeIf { it.length == 10 } ?: it.date
        val t = datetime.substringAfter(' ', "").takeIf { it.length == 8 } ?: it.time
        it.copy(date = d, time = t)
    }
    /** 用户手动改备注时同步覆盖 AI 原始 note，保证提交的是用户改后的内容 */
    fun setNote(key: Int, note: String) = updateRow(key) { it.copy(name = note, note = note.trim().ifBlank { null }) }
    fun setType(key: Int, type: String) = updateRow(key) {
        // 换类型后原分类可能不再适用，清空强制重选
        it.copy(type = type, categoryId = null, categoryName = null)
    }

    fun setCategory(key: Int, category: Category) =
        updateRow(key) { it.copy(categoryId = category.id, categoryName = category.name, suggestedCategory = null) }

    private fun updateRow(key: Int, block: (ScanRow) -> ScanRow) {
        _state.value = _state.value.copy(rows = _state.value.rows.map { if (it.key == key) block(it) else it })
    }

    fun clearRows() {
        _state.value = _state.value.copy(rows = emptyList(), rawText = "", reason = null, doneCount = 0)
    }

    /** 批量入账：逐条调 POST /transactions，任一条失败则中断并报告已成功数量 */
    fun submitAll() {
        val s = _state.value
        val accountId = s.accountId
        if (accountId == null) {
            _state.value = s.copy(error = "请先选择入账账户")
            return
        }
        val picked = s.rows.filter { it.selected }
        if (picked.isEmpty()) {
            _state.value = s.copy(error = "请至少勾选一条记录")
            return
        }
        val missing = picked.firstOrNull { it.categoryId == null }
        if (missing != null) {
            _state.value = s.copy(error = "「${missing.name.ifBlank { "未命名" }}」还没有选择分类")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(submitting = true, error = null, doneCount = 0)
            var ok = 0
            for (row in picked) {
                // 客户端不做格式拼接：note 直接透传（AI 在 prompt 里被要求按「场景-对象」格式生成完整 note）；
                // row.merchant 单独传给服务端作冗余字段（用于后续分析/兜底）。
                val note = row.note?.takeIf { it.isNotBlank() }?.take(100)
                val merchant = row.merchant?.takeIf { it.isNotBlank() }?.take(50)
                val req = CreateTransactionRequest(
                    accountId = accountId,
                    categoryId = row.categoryId!!,
                    type = row.type,
                    amount = row.amount,
                    note = note,
                    date = "${row.date} ${row.time}",
                    merchant = merchant
                )
                when (val r = txRepo.createTransaction(req)) {
                    is ApiResult.Success -> {
                        ok++
                        _state.value = _state.value.copy(doneCount = ok)
                    }
                    is ApiResult.Error -> {
                        _state.value = _state.value.copy(
                            submitting = false,
                            error = "已入账 $ok 笔，第 ${ok + 1} 笔失败：${r.message}"
                        )
                        return@launch
                    }
                }
            }
            _state.value = _state.value.copy(submitting = false, toast = "已入账 $ok 笔", finished = true)
        }
    }

    fun consumeToast() { _state.value = _state.value.copy(toast = null) }
    fun consumeError() { _state.value = _state.value.copy(error = null) }
}
