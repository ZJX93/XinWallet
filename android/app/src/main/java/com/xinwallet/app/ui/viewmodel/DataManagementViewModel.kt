package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.BackupRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

data class DataManagementUiState(
    /** 导出中 / 导入中，两个动作共用一把锁，避免同时读写同一账本 */
    val busy: Boolean = false,
    /** 当前进行到哪一步的文案，如「正在导出备份…」 */
    val status: String? = null,
    /** 最近一次导出成功后落盘的文件；非空时界面显示「分享 / 保存」按钮 */
    val exported: File? = null,
    /** 结果详情（导出路径 / 导入汇总），常驻显示直到下一次动作 */
    val detail: String? = null,
    val toast: String? = null,
    val error: String? = null
)

/**
 * 数据管理（账本备份）。功能与鸿蒙 DataManagement.ets 对齐：
 *   导出 → 服务端生成 xlsx，落盘到 App 私有目录，再交给系统分享面板保存；
 *   导入 → 用户从系统文件选择器挑 .xlsx，上传后服务端清空当前账本并恢复。
 *
 * 注意导入是**破坏性**操作（后端会先清空当前账本），因此界面上必须有二次确认。
 */
class DataManagementViewModel(private val repo: BackupRepository) : ViewModel() {

    private val _state = MutableStateFlow(DataManagementUiState())
    val state: StateFlow<DataManagementUiState> = _state

    /** 导出到指定文件（由界面提供 App 私有目录下的路径，规避分区存储限制） */
    fun export(dest: File) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.value = _state.value.copy(
                busy = true, status = "正在导出备份…", error = null, detail = null, exported = null
            )
            when (val r = repo.exportTo(dest)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    busy = false,
                    status = null,
                    exported = r.data,
                    detail = "已生成备份：${r.data.name}\n大小 ${humanSize(r.data.length())}",
                    toast = "备份已导出"
                )
                is ApiResult.Error -> _state.value = _state.value.copy(
                    busy = false, status = null, error = "导出失败：${r.message}"
                )
            }
        }
    }

    /**
     * 导入备份。[file] 必须是已复制到 App 可读位置的真实文件
     * （系统选择器给的是 content:// Uri，不能直接当 File 上传，需界面先落地到 cacheDir）。
     */
    fun import(file: File) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.value = _state.value.copy(
                busy = true, status = "正在上传并恢复…", error = null, detail = null
            )
            when (val r = repo.import(file)) {
                is ApiResult.Success -> {
                    val summary = r.data.imported.summary()
                    _state.value = _state.value.copy(
                        busy = false,
                        status = null,
                        detail = "账本已恢复 ✅" + if (summary.isNotBlank()) "\n$summary" else "",
                        toast = "备份已恢复"
                    )
                }
                is ApiResult.Error -> _state.value = _state.value.copy(
                    busy = false, status = null, error = "恢复失败：${r.message}"
                )
            }
            // 上传用的临时副本用完即删，避免 cacheDir 里堆备份文件
            runCatching { file.delete() }
        }
    }

    fun fail(message: String) { _state.value = _state.value.copy(error = message) }
    fun consumeToast() { _state.value = _state.value.copy(toast = null) }
    fun consumeError() { _state.value = _state.value.copy(error = null) }

    private fun humanSize(bytes: Long): String = when {
        bytes >= 1024 * 1024 -> String.format("%.1f MB", bytes / 1024.0 / 1024.0)
        bytes >= 1024 -> String.format("%.1f KB", bytes / 1024.0)
        else -> "$bytes B"
    }
}
