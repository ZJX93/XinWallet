package com.xinwallet.app.di

import android.content.Context
import com.google.gson.GsonBuilder
import com.google.gson.TypeAdapter
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
import com.xinwallet.app.BuildConfig
import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.data.model.Book
import com.xinwallet.app.data.model.BookIdResponse
import com.xinwallet.app.data.model.BooksResponse
import com.xinwallet.app.data.model.CreateBookRequest
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.ApiResult
import com.xinwallet.app.data.remote.AuthInterceptor
import com.xinwallet.app.data.repository.AccountRepository
import com.xinwallet.app.data.repository.AiRepository
import com.xinwallet.app.data.repository.BackupRepository
import com.xinwallet.app.data.repository.BudgetRepository
import com.xinwallet.app.data.repository.CategoryRepository
import com.xinwallet.app.data.repository.DebtRepository
import com.xinwallet.app.data.repository.ReportRepository
import com.xinwallet.app.data.repository.TagRepository
import com.xinwallet.app.data.repository.AuthRepository
import com.xinwallet.app.data.repository.DashboardRepository
import com.xinwallet.app.data.repository.InvestmentRepository
import com.xinwallet.app.data.repository.SavingsGoalRepository
import com.xinwallet.app.data.repository.TransactionRepository
import com.xinwallet.app.data.repository.BookRepository
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * 轻量手动依赖容器：在 Application.onCreate 初始化，避免引入额外 DI 框架。
 * 支持运行时切换 NAS 基地址（setBaseUrl 重建 Retrofit）。
 */
object AppContainer {

    lateinit var sessionManager: SessionManager
        private set
    /** 「记住密码」加密凭据存储（EncryptedSharedPreferences / Android KeyStore） */
    lateinit var credentialStore: com.xinwallet.app.data.local.CredentialStore
        private set
    lateinit var api: ApiService
        private set

    lateinit var authRepository: AuthRepository
        private set
    lateinit var accountRepository: AccountRepository
        private set
    lateinit var transactionRepository: TransactionRepository
        private set
    lateinit var investmentRepository: InvestmentRepository
        private set
    lateinit var categoryRepository: CategoryRepository
        private set
    lateinit var dashboardRepository: DashboardRepository
        private set
    lateinit var aiRepository: AiRepository
        private set
    lateinit var budgetRepository: BudgetRepository
        private set
    lateinit var savingsGoalRepository: SavingsGoalRepository
        private set
    lateinit var debtRepository: DebtRepository
        private set
    lateinit var reportRepository: ReportRepository
        private set
    lateinit var tagRepository: TagRepository
        private set
    lateinit var bookRepository: BookRepository
        private set
    lateinit var backupRepository: BackupRepository
        private set

    /**
     * 多账本共享状态：currentBookId 变化时，各屏 LaunchedEffect 重新拉取数据；
     * AuthInterceptor 同时把该 id 注入 X-Book-Id，后端据此隔离数据。
     */
    val currentBookId = MutableStateFlow(0)
    val books = MutableStateFlow<List<Book>>(emptyList())

    /** 全局认证过期事件：AuthInterceptor 在 401 且刷新失败时发射，AppRoot 收集后回到登录页 */
    val authExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /**
     * 回到前台信号：AppRoot 在 Lifecycle ON_START 且已登录时发射，
     * 各常驻页（首页/账单/统计/理财/账户/我的）收集后重新拉取数据，
     * 避免「后台回来页面停留在过期数据、且因 token 过期无法刷新」。
     */
    val onForeground = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /**
     * 用户主动离开 App 信号：MainActivity.onUserLeaveHint() 在用户按 HOME / 最近任务键时发射。
     * 关键：通过 Intent 启动系统相册/分享/系统对话框**不会**触发 onUserLeaveHint，
     * 因此此信号专用于「应用锁」——只有用户真正离开 App 才重新上锁，
     * 从系统选择器返回不会误触发（生命周期 ON_STOP 会因跨进程跳转误判，故不用它）。
     */
    val userLeaveHint = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    private lateinit var retrofit: Retrofit
    private lateinit var okHttpClient: OkHttpClient
    private lateinit var gson: com.google.gson.Gson

    fun init(context: Context, session: SessionManager) {        sessionManager = session
        // 用 applicationContext：CredentialStore 生命周期与进程一致，
        // 传 Activity context 会泄漏（EncryptedSharedPreferences 由 lazy 长期持有）
        credentialStore = com.xinwallet.app.data.local.CredentialStore(context.applicationContext)

        gson = GsonBuilder()
            .setLenient()
            .registerTypeAdapter(Double::class.java, DoubleTypeAdapter)
            .registerTypeAdapter(Double::class.javaPrimitiveType!!, DoubleTypeAdapter)
            .create()
        // release 包必须关请求行日志：BASIC 会打印每条请求的 URL 与状态码，
        // 在日志采集/投屏等场景下等于外泄用户的接口访问轨迹。
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }
        val interceptor = AuthInterceptor(session, authExpired) { if (::api.isInitialized) api else null }
        okHttpClient = OkHttpClient.Builder()
            .addInterceptor(interceptor)
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            // OCR 走「腾讯云识别 + 大模型抽取」，端到端可能十几秒，读写超时放宽到 60s
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        // 首次未配置地址时使用占位符，避免 Retrofit baseUrl 为空崩溃；UI 会强制用户填写真实地址。
        // 本地开发默认指向 adb reverse 后的本机后端（18888 是 docker-compose 暴露的端口）。
        val saved = normalizeBaseUrl(runBlocking { session.baseUrl() })
        val baseUrl = saved.ifBlank { "http://localhost:18888/api/" }
        retrofit = buildRetrofit(baseUrl, gson)
        api = retrofit.create(ApiService::class.java)

        // Repository 通过 provider 获取当前 api，运行时 setBaseUrl 重建 api 后立即生效。
        authRepository = AuthRepository(session) { api }
        accountRepository = AccountRepository { api }
        transactionRepository = TransactionRepository { api }
        investmentRepository = InvestmentRepository { api }
        dashboardRepository = DashboardRepository { api }
        categoryRepository = CategoryRepository { api }
        aiRepository = AiRepository { api }
        budgetRepository = BudgetRepository { api }
        savingsGoalRepository = SavingsGoalRepository { api }
        debtRepository = DebtRepository { api }
        reportRepository = ReportRepository { api }
        tagRepository = TagRepository { api }
        bookRepository = BookRepository { api }
        backupRepository = BackupRepository { api }
    }

    /**
     * 拉取账本列表并写入当前账本 id（登录后 / 启动校验通过后调用）。
     * 后端 GET /books 会自动为该用户确保默认账本，因此首次调用即可得到 current_book_id。
     */
    suspend fun loadBooks() {
        val resp = bookRepository.getBooks()
        if (resp is ApiResult.Success) {
            val data: BooksResponse? = resp.data
            if (data != null) {
                books.value = data.books
                val cur = data.currentBookId
                currentBookId.value = cur
                sessionManager.saveCurrentBookId(cur)
            }
        }
    }

    /** 切换当前账本：调后端 /books/{id}/switch 并持久化，更新列表 current 标记 */
    suspend fun switchBook(id: Int) {
        val resp = bookRepository.switch(id)
        if (resp is ApiResult.Success) {
            currentBookId.value = id
            sessionManager.saveCurrentBookId(id)
            books.value = books.value.map { it.copy(isCurrent = it.id == id) }
        }
    }

    /** 新建账本后刷新列表 */
    suspend fun createBook(name: String, icon: String? = null, color: String? = null, setDefault: Boolean = false): ApiResult<BookIdResponse> {
        val resp = bookRepository.create(CreateBookRequest(name, icon, color, setDefault))
        if (resp is ApiResult.Success) loadBooks()
        return resp
    }

    /** 删除账本后刷新列表（后端会把数据并入默认账本） */
    suspend fun deleteBook(id: Int): ApiResult<Unit> {
        val resp = bookRepository.delete(id)
        if (resp is ApiResult.Success) loadBooks()
        return resp
    }

    private fun buildRetrofit(baseUrl: String, gson: com.google.gson.Gson): Retrofit {
        val safe = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(safe)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .build()
    }

    /** 用户配置 NAS 地址后重建 Retrofit 实例 */
    fun setBaseUrl(baseUrl: String) {
        retrofit = buildRetrofit(baseUrl, gson)
        api = retrofit.create(ApiService::class.java)
    }

    /**
     * 标准化 NAS 基地址：trim、去末尾斜杠、自动补全 `/api/` 后缀。
     * 用户可能输入 `https://nas.com:18888` 或 `https://nas.com:18888/`，
     * 统一输出 `https://nas.com:18888/api/`；空字符串则返回空。
     */
    fun normalizeBaseUrl(url: String): String {
        val trimmed = url.trim()
        if (trimmed.isBlank()) return ""
        val withoutTrailingSlash = trimmed.trimEnd('/')
        val withApi = if (withoutTrailingSlash.endsWith("/api")) withoutTrailingSlash else "$withoutTrailingSlash/api"
        return "$withApi/"
    }
}

/**
 * 数字/字符串兼容的 Double 适配器：服务端 PostgreSQL NUMERIC 列返回字符串（如 "1150.00"），
 * 本适配器同时接受 JSON 数字与字符串，null/空串回退 0.0，避免反序列化失败。
 */
private object DoubleTypeAdapter : TypeAdapter<Double>() {
    override fun write(out: JsonWriter, value: Double?) {
        if (value == null) out.nullValue() else out.value(value)
    }
    override fun read(`in`: JsonReader): Double? {
        if (`in`.peek() == com.google.gson.stream.JsonToken.NULL) {
            `in`.nextNull()
            return null
        }
        val raw = `in`.nextString()
        if (raw.isNullOrEmpty()) return 0.0
        return raw.toDoubleOrNull() ?: 0.0
    }
}
