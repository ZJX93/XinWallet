/* ============================================
   鑫钱包 · 应用引导模块 (Boot)
   负责注册路由切换、各 Manager 的初始化顺序
   ============================================ */

// 统一通过 ES Module 导入所有 Manager（utils.js 已在 index.html 中先加载，注入 window 全局）
import ThemeManager from './theme.js';
import AccountManager from './account.js';
import TransactionManager from './transaction.js?v=17';
import BudgetManager from './budget.js';
import InvestmentManager from './investment.js';
import DebtManager from './debt.js';
import TagManager from './tag.js';
import DataManager from './data.js';
import SavingsGoalManager from './savings.js';
import AIRecognition from './ai-recognition.js';
import AISmartEntry from './ai-smart-entry.js?v=26';
import AIAdvice from './ai-advice.js?v=1';
import AIInsights from './ai-insights.js?v=1';
import AIRules from './ai-rules.js?v=1';
import AILearning from './ai-learning.js?v=1';
import AIEvaluation from './ai-evaluation.js?v=1';
import AIProviderManager from './ai-provider.js';
import AISettings from './ai-settings.js';
import ReportManager from './report.js';
import QuickAdd from './quick-add.js';
import DashboardManager from './dashboard.js?v=19';
import ChartManager from './chart.js?v=19';

// app.js 是经典 script（非 module），所有函数自动在 window 上，直接用
const boot = window.boot;
const initCache = window.initCache;

// 把导入的 Manager 挂到全局，让 app.js 中残留的内联调用仍能访问
window.ThemeManager = ThemeManager;
window.AccountManager = AccountManager;
window.TransactionManager = TransactionManager;
window.BudgetManager = BudgetManager;
window.InvestmentManager = InvestmentManager;
window.DebtManager = DebtManager;
window.TagManager = TagManager;
window.DataManager = DataManager;
window.SavingsGoalManager = SavingsGoalManager;
window.AIRecognition = AIRecognition;
window.AISmartEntry = AISmartEntry;
window.AIAdvice = AIAdvice;
window.AIInsights = AIInsights;
window.AIRules = AIRules;
window.AILearning = AILearning;
window.AIEvaluation = AIEvaluation;
window.AIProviderManager = AIProviderManager;
window.AISettings = AISettings;
window.ReportManager = ReportManager;
window.QuickAdd = QuickAdd;
window.DashboardManager = DashboardManager;
window.ChartManager = ChartManager;

// ==========================================
// 应用启动（防止重复调用 + 错误兜底）
// ==========================================
let _booted = false;
async function safeBoot() {
    if (_booted) return;
    _booted = true;
    try {
        await boot();
    } catch (e) {
        console.error('❌ 启动失败:', e.message, e.stack);
        // CSP scriptSrcAttr 'none' 会拦截内联 onclick，必须事后用 addEventListener 绑定
        document.body.innerHTML = '<div style=\"padding:40px;text-align:center;font-size:18px\">⚠️ 应用启动失败<br><small>' + escapeHtml(e.message) + '</small><br><br><button id=\"btnBootReload\">刷新重试</button></div>';
        document.getElementById('btnBootReload')?.addEventListener('click', () => location.reload());
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeBoot);
} else {
    safeBoot();
}
