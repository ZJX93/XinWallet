package com.xinwallet.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.repository.AuthRepository
import com.xinwallet.app.di.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class LoginUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    val showDemo: Boolean = true
)

class LoginViewModel(private val repo: AuthRepository) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state

    /**
     * 登录。remember=true 时在**成功后**加密保存用户名+密码。
     * ⛔ 保存必须放在 Success 分支里 —— 放在方法开头会把错误密码也存进去，
     *    下次自动填入一个错的，用户完全不知道为什么登不上。
     */
    fun login(username: String, password: String, remember: Boolean = false) {
        if (username.isBlank() || password.isBlank()) {
            _state.value = LoginUiState(error = "请输入用户名和密码")
            return
        }
        viewModelScope.launch {
            _state.value = LoginUiState(loading = true)
            when (val r = repo.login(username, password)) {
                is ApiResult.Success -> {
                    // 勾选则存，未勾选则清（用户可能上次勾了这次取消，必须真删）
                    if (remember) AppContainer.credentialStore.save(username, password)
                    else AppContainer.credentialStore.clear()
                    _state.value = LoginUiState(success = true)
                }
                is ApiResult.Error -> _state.value = LoginUiState(error = r.message)
            }
        }
    }

    fun demoLogin() {
        viewModelScope.launch {
            _state.value = LoginUiState(loading = true)
            when (val r = repo.demoLogin()) {
                is ApiResult.Success -> _state.value = LoginUiState(success = true)
                is ApiResult.Error -> _state.value = LoginUiState(error = r.message)
            }
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    /** 拉取登录页配置：服务端未开启演示账号时隐藏「体验 Demo 账号」按钮 */
    fun loadConfig() {
        viewModelScope.launch {
            when (val r = repo.isDemoEnabled()) {
                is ApiResult.Success -> _state.value = _state.value.copy(showDemo = r.data)
                is ApiResult.Error -> { /* 接口异常时保持默认（显示） */ }
            }
        }
    }
}
