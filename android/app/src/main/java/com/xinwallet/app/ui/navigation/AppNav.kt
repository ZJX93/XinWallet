@file:OptIn(ExperimentalMaterial3Api::class)

package com.xinwallet.app.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavDestination
import androidx.navigation.NavGraph
import com.xinwallet.app.ui.theme.Brown100
import com.xinwallet.app.ui.theme.Brown300
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.screens.AccountDetailScreen
import com.xinwallet.app.ui.screens.AccountsScreen
import com.xinwallet.app.ui.screens.AddTransactionScreen
import com.xinwallet.app.ui.screens.AiScanScreen
import com.xinwallet.app.ui.screens.AiInsightScreen
import com.xinwallet.app.ui.screens.RuleListScreen
import com.xinwallet.app.ui.screens.RuleEvidenceScreen
import com.xinwallet.app.ui.screens.ProviderListScreen
import com.xinwallet.app.ui.screens.ProviderEditScreen
import com.xinwallet.app.ui.screens.AiAdviceScreen
import com.xinwallet.app.ui.screens.LearningStatsScreen
import com.xinwallet.app.ui.screens.EvaluationScreen
import com.xinwallet.app.ui.screens.AppLockScreen
import com.xinwallet.app.ui.screens.CategoryScreen
import com.xinwallet.app.ui.screens.ChatScreen
import com.xinwallet.app.ui.screens.DataManagementScreen
import com.xinwallet.app.ui.screens.HomeScreen
import com.xinwallet.app.ui.screens.InvestmentDetailScreen
import com.xinwallet.app.ui.screens.InvestmentTransactionsScreen
import com.xinwallet.app.ui.screens.InvestmentsScreen
import com.xinwallet.app.ui.screens.LoginScreen
import com.xinwallet.app.ui.screens.PlanningScreen
import com.xinwallet.app.ui.screens.ProfileScreen
import com.xinwallet.app.ui.screens.ReportsScreen
import com.xinwallet.app.ui.screens.TagsScreen
import com.xinwallet.app.ui.screens.TransactionsScreen
import com.xinwallet.app.ui.screens.BudgetScreen
import com.xinwallet.app.ui.screens.SavingsGoalsScreen
import com.xinwallet.app.ui.screens.LoanScreen
import com.xinwallet.app.ui.screens.SettingsScreen
import com.xinwallet.app.ui.screens.SearchScreen
import com.xinwallet.app.ui.theme.Brown500
import com.xinwallet.app.ui.theme.GlassBox
import com.xinwallet.app.ui.theme.GlassFab
import androidx.compose.foundation.border
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Edit
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(val route: String) {
    object Home : Screen("home")
    object Accounts : Screen("accounts")
    object AccountDetail : Screen("account/{id}") {
        fun create(id: Int) = "account/$id"
    }
    object Transactions : Screen("transactions?month={month}&view={view}") {
        fun create(month: String? = null, view: String? = null): String {
            val sb = StringBuilder("transactions")
            if (month != null) sb.append("?month=$month")
            if (view != null) sb.append(if (sb.contains("?")) "&view=$view" else "?view=$view")
            return sb.toString()
        }
    }
    object AddTransaction : Screen("add")
    object EditTransaction : Screen("edit/{id}?month={month}") {
        fun create(id: Int, month: String? = null) =
            if (month != null) "edit/$id?month=$month" else "edit/$id"
    }
    /**
     * 转账编辑：与支出/收入一致，也跳记账页改，只是走 PUT /transfers/{id}。
     * 单独一条路由而不是复用 EditTransaction 的原因：这里的 id 是 transfers 表主键，
     * 与 transactions 表主键是两套 id 空间，混用会改错记录。
     */
    object EditTransfer : Screen("edit-transfer/{id}?month={month}") {
        fun create(id: Int, month: String? = null) =
            if (month != null) "edit-transfer/$id?month=$month" else "edit-transfer/$id"
    }
    object AiScan : Screen("ai-scan")
    object AiInsight : Screen("ai-insight")
    object ProviderList : Screen("provider-list")
    /** id=0 表示新建；其他表示编辑 */
    object ProviderEdit : Screen("provider-edit/{id}") {
        fun create(id: Int) = if (id == 0) "provider-edit/0" else "provider-edit/$id"
    }
    /** 规则管理列表（GET /ai/rules） */
    object RuleList : Screen("rule-list")
    /** 单条规则证据流水（GET /ai/rules/:id/evidence） */
    object RuleEvidence : Screen("rule-evidence/{id}?title={title}") {
        fun create(id: Int, title: String) = "rule-evidence/$id?title=$title"
    }
    /** AI 财务建议（POST /ai/advice） */
    object AiAdvice : Screen("ai-advice")
    /** AI 学习统计（GET /ai/learning/stats） */
    object LearningStats : Screen("learning-stats")
    /** AI 模型评测（POST /ai/evaluation/run + GET /ai/evaluation/runs） */
    object Evaluation : Screen("evaluation")
    object Investments : Screen("investments")
    object InvestmentDetail : Screen("investment/{id}") {
        fun create(id: Int) = "investment/$id"
    }
    object InvestmentTransactions : Screen("investment/{id}/transactions") {
        fun create(id: Int) = "investment/$id/transactions"
    }
    object Profile : Screen("profile")
    object Planning : Screen("planning")
    object Reports : Screen("reports")
    object Search : Screen("search")
    object Tags : Screen("tags")
    object Categories : Screen("categories")
    object Chat : Screen("chat")
    object Budgets : Screen("budgets")
    object SavingsGoals : Screen("savings-goals")
    object Debts : Screen("debts")
    object Settings : Screen("settings")
    object AppLock : Screen("app_lock")
    object DataManagement : Screen("data-management")
}

/**
 * 底部 4 tab：首页 / 账单 / 统计 / 我的
 * 中间圆形「记账」按钮由 MainScaffold 单独叠加（不是 NavigationBarItem）。
 */
private val bottomItems = listOf(
    Screen.Home to ("首页" to Icons.Outlined.Home),
    Screen.Transactions to ("账单" to Icons.Outlined.ReceiptLong),
    Screen.Reports to ("统计" to Icons.Outlined.PieChart),
    Screen.Profile to ("我的" to Icons.Outlined.Person)
)

/** 单个底部文字 tab（图标 + 文字，整体垂直居中，参考 com.miaoa.cola 紧凑布局） */
@Composable
private fun TabItem(
    screen: Screen,
    pair: Pair<String, ImageVector>,
    current: String?,
    navigateRoot: (String) -> Unit
) {
    val (label, icon) = pair
    val selected = current == screen.route
    val tint = if (selected) MaterialTheme.colorScheme.primary
               else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .clickable { navigateRoot(screen.route) }
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier.offset(y = 0.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // 选中态：仅图标底部柔和阴影（无底色填充），阴影随选中平滑出现，整体下移使其留在 tab 栏内
            val elev by animateDpAsState(
                targetValue = if (selected) 3.dp else 0.dp,
                animationSpec = tween(durationMillis = 220),
                label = "tabElev"
            )
            Box(
                Modifier
                    .shadow(elevation = elev, shape = CircleShape, clip = false, ambientColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f), spotColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f))
                    .padding(4.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, label, tint = tint, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.height(4.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = tint)
        }
    }
}

/** 当前路由命中到哪个底部 tab（子路由归并到所属 tab） */
fun routeKey(route: String?): String? = when {
    route == null -> null
    route.startsWith("account") -> Screen.Profile.route
    route.startsWith("reports") -> Screen.Reports.route
    route.startsWith("edit") -> Screen.Transactions.route
    route.startsWith("ai") -> Screen.Transactions.route
    route.startsWith("add") -> Screen.AddTransaction.route  // 记账独立 tab
    route.startsWith("chat") -> Screen.Profile.route       // 对话下沉到「我的」
    route.startsWith("budgets") -> Screen.Profile.route
    route.startsWith("savings") -> Screen.Profile.route
    route.startsWith("debts") -> Screen.Profile.route
    route.startsWith("transactions") -> Screen.Transactions.route
    route.startsWith("investment") -> Screen.Profile.route   // 理财从「我的」进入，归到「我的」
    route.startsWith("planning") -> Screen.Profile.route    // 规划下沉到「我的」
    route.startsWith("data-management") -> Screen.Profile.route  // 数据管理从「我的」宫格进入
    else -> route.substringBefore("/")
}

/**
 * 定位 NavGraph 的起始目的地（处理嵌套 NavGraph）。
 * navigation-compose 未提供此扩展，底部导航 popUpTo 时依赖它回到首页。
 */
private fun NavGraph.findStartDestination(): NavDestination {
    var current: NavDestination = this
    while (current is NavGraph) {
        val graph = current
        val next = graph.findNode(graph.startDestinationId)
        if (next == null) break
        current = next
    }
    return current
}

/** 不显示底部 tab 栏的路由（AI 记账 / 手动记账为沉浸式交互页，避开 5 槽均分干扰） */
private fun isNoTabRoute(route: String?): Boolean {
    if (route == null) return false
    return route.startsWith("chat") || route.startsWith("add") || route.startsWith("edit")
}

@Composable
fun MainScaffold(onLogout: () -> Unit) {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val current = routeKey(navBackStackEntry?.destination?.route)
    val currentRoute = navBackStackEntry?.destination?.route
    val showBottomBar = !isNoTabRoute(currentRoute)
    var showAddMenu by remember { mutableStateOf(false) }
    // FAB 旋转 45° → 「×」，作为关闭态
    val fabRotation by animateFloatAsState(
        targetValue = if (showAddMenu) 45f else 0f,
        animationSpec = tween(durationMillis = 280),
        label = "fabRotation"
    )

    // 必须是 val lambda 而不是局部 fun：fun 名不能直接当 (String)->Unit 传递，
    // 而 TabItem 需要把它当值传过去（之前内联 clickable 直接调用没问题）。
    val navigateRoot: (String) -> Unit = { route ->
        // 底部 tab 传的是 Screen.route 模式串（含 {month}/{view} 占位符），
        // 直接 navigate 会把字面量 "{view}" 当作参数值，导致 viewMode 既不匹配 list 也不匹配 calendar。
        // 这里对 transactions 用无参 create() 规范化，保证默认进入「流水」视图。
        val actual = if (route == Screen.Transactions.route) Screen.Transactions.create() else route
        navController.navigate(actual) {
            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            // 透出根布局的环境光背景，玻璃表面才能透出柔光
            containerColor = Color.Transparent,
            bottomBar = {
                // 沉浸页（chat/add/edit）直接隐藏整条 tab 栏，避免给输入区让出 64dp 视觉噪音
                if (showBottomBar) {
                    // 底部栏：玻璃本体 64dp（用户反馈 79dp 过高），圆 46dp 垂直居中，5 槽均分（首页/账单/圆/统计/我的）
                    // contentWindowInsets=0 让 64dp 栏高度精确（不被系统栏撑高）；点击响应由各 TabItem 自行处理。
                    val navH = 64.dp
                    GlassBox(
                        Modifier.fillMaxWidth().height(navH),
                        shape = RoundedCornerShape(0.dp),
                        elevated = true
                    ) {
                        Row(
                            Modifier.fillMaxWidth().fillMaxHeight(),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // 5 个图标等距分布：首页 / 账单 / 圆 / 统计 / 我的
                            //   - 图标大小可以不一致（圆比 tab 图标大）
                            //   - 图标之间的空白间距全部相等（SpaceEvenly）
                            bottomItems.take(1).forEach { (screen, pair) ->
                                TabItem(screen, pair, current, navigateRoot)
                            }
                            bottomItems.drop(1).take(1).forEach { (screen, pair) ->
                                TabItem(screen, pair, current, navigateRoot)
                            }
                            // 中间「记账」玻璃圆钮：作为 Row 第 3 个成员参与等距分布；
                            // 展开时旋转 45° 成「×」，再次点击关闭菜单
                            Box(Modifier.rotate(fabRotation)) {
                                GlassFab(
                                    icon = Icons.Filled.Add,
                                    contentDescription = "记账",
                                    onClick = { showAddMenu = !showAddMenu },
                                    size = 46.dp
                                )
                            }
                            bottomItems.drop(2).take(1).forEach { (screen, pair) ->
                                TabItem(screen, pair, current, navigateRoot)
                            }
                            bottomItems.drop(3).forEach { (screen, pair) ->
                                TabItem(screen, pair, current, navigateRoot)
                            }
                        }
                    }
                }
            }
        ) { padding ->
            AppNavHost(navController, padding, onLogout)
        }

        AnimatedVisibility(
            visible = showAddMenu,
            enter = fadeIn(tween(durationMillis = 220)),
            exit = fadeOut(tween(durationMillis = 180))
        ) {
            // 遮罩仅覆盖导航栏以上区域（底部 64dp 留白，使 FAB 仍可点 = 关闭），
            // 由透明过渡到深色，避免"死黑"呆板感
            Box(Modifier.fillMaxSize()) {
                Box(
                    Modifier.matchParentSize().padding(bottom = 64.dp)
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Black.copy(alpha = 0.5f))
                            )
                        )
                        .clickable { showAddMenu = false }
                )
                // 自导航栏上方弹起的速选面板（错峰入场：AI 先、手动后）
                Column(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 84.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    AnimatedVisibility(
                        visible = true,
                        enter = fadeIn(tween(220, 0))
                            + slideInVertically(animationSpec = tween(320, 0)) { 30 }
                            + scaleIn(initialScale = 0.92f, animationSpec = tween(320, 0))
                    ) {
                        AddOptionRow("AI 记账", "对话或拍照，一句话入账", Icons.Filled.AutoAwesome, primary = true) {
                            showAddMenu = false
                            navigateRoot(Screen.Chat.route)
                        }
                    }
                    AnimatedVisibility(
                        visible = true,
                        enter = fadeIn(tween(220, 80))
                            + slideInVertically(animationSpec = tween(320, 80)) { 30 }
                            + scaleIn(initialScale = 0.92f, animationSpec = tween(320, 80))
                    ) {
                        AddOptionRow("手动记账", "逐项填写，精确记录", Icons.Filled.Edit, primary = false) {
                            showAddMenu = false
                            navigateRoot(Screen.AddTransaction.route)
                        }
                    }
                }
            }
        }

    }
}

/** 记账速选卡：主选项(AI)实心品牌渐变 + 次选项(手动)浅卡，图标 chip + 标题 + 副文案 */
@Composable
private fun AddOptionRow(
    label: String,
    sub: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .width(260.dp).height(64.dp)
            .clip(RoundedCornerShape(16.dp))
            .then(
                if (primary) {
                    Modifier.background(Brush.horizontalGradient(listOf(Brown500, Brown300)))
                } else {
                    Modifier
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp))
                }
            )
            .shadow(
                if (primary) 14.dp else 8.dp,
                RoundedCornerShape(16.dp),
                ambientColor = Brown500.copy(alpha = 0.3f),
                spotColor = Brown500.copy(alpha = 0.3f)
            )
            .clickable { onClick() }
            .padding(start = 12.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(14.dp))
                .background(if (primary) Color.White.copy(alpha = 0.18f) else Brown100),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                icon, contentDescription = null,
                tint = if (primary) Color.White else Brown500,
                modifier = Modifier.size(24.dp)
            )
        }
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                label,
                color = if (primary) Color.White else MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp
            )
            Text(
                sub,
                color = if (primary) Color.White.copy(alpha = 0.8f) else MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp
            )
        }
        Text(
            "›",
            color = if (primary) Color.White.copy(alpha = 0.6f) else Color.Gray,
            fontSize = 18.sp
        )
    }
}

@Composable
fun AppNavHost(navController: NavHostController, padding: PaddingValues, onLogout: () -> Unit) {
    NavHost(
        navController = navController,
        startDestination = Screen.Home.route,
        modifier = Modifier.padding(padding)
    ) {
        composable(Screen.Home.route) { HomeScreen(navController) }
        composable(Screen.Accounts.route) { AccountsScreen(navController) }
        composable(
            Screen.AccountDetail.route,
            arguments = listOf(navArgument("id") { type = androidx.navigation.NavType.IntType })
        ) {
            AccountDetailScreen(navController, it.arguments?.getInt("id") ?: 0)
        }
        composable(
            route = Screen.Transactions.route,
            arguments = listOf(
                navArgument("month") { type = NavType.StringType; nullable = true; defaultValue = null },
                navArgument("view") { type = NavType.StringType; nullable = true; defaultValue = null }
            )
        ) { backStackEntry ->
            val monthArg = backStackEntry.arguments?.getString("month")
            val viewArg = backStackEntry.arguments?.getString("view")
            TransactionsScreen(navController, initialMonth = monthArg, initialViewMode = viewArg)
        }
        composable(Screen.AddTransaction.route) { AddTransactionScreen(navController) }
        composable(
            Screen.EditTransaction.route,
            arguments = listOf(
                navArgument("id") { type = androidx.navigation.NavType.IntType },
                navArgument("month") { type = androidx.navigation.NavType.StringType; nullable = true; defaultValue = null }
            )
        ) {
            val id = it.arguments?.getInt("id") ?: 0
            val month = it.arguments?.getString("month")
            AddTransactionScreen(navController, editId = id, month = month)
        }
        composable(
            Screen.EditTransfer.route,
            arguments = listOf(
                navArgument("id") { type = androidx.navigation.NavType.IntType },
                navArgument("month") { type = androidx.navigation.NavType.StringType; nullable = true; defaultValue = null }
            )
        ) {
            val id = it.arguments?.getInt("id") ?: 0
            val month = it.arguments?.getString("month")
            AddTransactionScreen(navController, editTransferId = id, month = month)
        }
        composable(Screen.AiScan.route) { AiScanScreen(navController) }
        composable(Screen.AiInsight.route) { AiInsightScreen(navController) }
        composable(Screen.ProviderList.route) { ProviderListScreen(navController) }
        composable(
            Screen.ProviderEdit.route,
            arguments = listOf(navArgument("id") { type = NavType.IntType })
        ) { entry ->
            val id = entry.arguments?.getInt("id") ?: 0
            ProviderEditScreen(navController, id)
        }
        composable(Screen.RuleList.route) { RuleListScreen(navController) }
        composable(
            Screen.RuleEvidence.route,
            arguments = listOf(
                navArgument("id") { type = NavType.IntType },
                navArgument("title") { type = NavType.StringType }
            )
        ) { entry ->
            RuleEvidenceScreen(navController, entry.arguments?.getInt("id") ?: 0, entry.arguments?.getString("title") ?: "规则证据")
        }
        composable(Screen.AiAdvice.route) { AiAdviceScreen(navController) }
        composable(Screen.LearningStats.route) { LearningStatsScreen(navController) }
        composable(Screen.Evaluation.route) { EvaluationScreen(navController) }
        composable(Screen.Investments.route) { InvestmentsScreen(navController) }
        composable(
            Screen.InvestmentDetail.route,
            arguments = listOf(navArgument("id") { type = androidx.navigation.NavType.IntType })
        ) {
            InvestmentDetailScreen(navController, it.arguments?.getInt("id") ?: 0)
        }
        composable(
            Screen.InvestmentTransactions.route,
            arguments = listOf(navArgument("id") { type = androidx.navigation.NavType.IntType })
        ) {
            InvestmentTransactionsScreen(navController, it.arguments?.getInt("id") ?: 0)
        }
        composable(Screen.Profile.route) { ProfileScreen(navController, onLogout) }
        composable(Screen.Planning.route) { PlanningScreen(navController) }
        composable(Screen.Reports.route) { ReportsScreen(navController) }
        composable(Screen.Search.route) { SearchScreen(navController) }
        composable(Screen.Chat.route) { ChatScreen(navController) }
        composable(Screen.Tags.route) { TagsScreen(navController) }
        composable(Screen.Categories.route) { CategoryScreen(navController) }
        composable(Screen.Budgets.route) { BudgetScreen(navController) }
        composable(Screen.SavingsGoals.route) { SavingsGoalsScreen(navController) }
        composable(Screen.Debts.route) { LoanScreen(navController) }
        composable(Screen.Settings.route) { SettingsScreen(navController) }
        composable(Screen.AppLock.route) { AppLockScreen(navController, mode = "Settings") }
        composable(Screen.DataManagement.route) { DataManagementScreen(navController) }
    }
}