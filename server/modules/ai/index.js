/* ============================================
   AI 模块桶文件
   ------------------------------------------------
   对外只暴露用例入口，routes/ai.js 只依赖本文件，
   内部分层（extraction/parser/memory/rules/learning/
   providers/runtime/validation/prediction/evaluation）可自由重构。

   ⛔ routes/ai.js 不得直接 require 子目录文件：
      否则内部重构会连带改动路由层，分层就白做了。
   ============================================ */

const { parseTransactions, loadContext, parseOffline, PREDICTION_VERSION } =
    require('./parser/transaction-parser');
const {
    createPrediction, getPrediction, commitPrediction, discardPrediction,
} = require('./prediction/prediction-store');
const { validateResult, FIELD_THRESHOLDS } = require('./validation/result-validator');
const { extractTransactions } = require('./extraction/deterministic-extractor');
// 备注「场景-对象」生成（服务端确定性，唯一真相）
const { composeNote } = require('./extraction/note-composer');

// 规则演化与证据
const {
    createManualRule, disableRule, enableRule, detectContradictions, evidenceStats,
} = require('./learning/evidence-engine');
const { EVIDENCE_WEIGHTS, STATUS_THRESHOLDS, HALF_LIFE_DAYS, listRules, ruleEvidenceTrail } =
    require('./rules/rule-store');

// 运行时（复杂度路由 / 熔断 / 成本）
const { breakerStates, resetBreakers } = require('./runtime/model-router');
const { usageMetrics } = require('./runtime/cost-tracker');
const { analyzeComplexity } = require('./runtime/complexity-analyzer');

// 评测
const {
    runOfflineEvaluation, collectOnlineMetrics, compareWithBaseline, persistRun, latestRun,
} = require('./evaluation/runner');
const { DATASET_VERSION } = require('./evaluation/dataset');

// 事件总线：路由层 /ai/events/* 要触发事件并查看统计/历史。
// 此前桶未导出这些符号，routes/ai/_shared.js 与 routes/ai/events.js 只好
// 各自直连 ./events/event-bus，破坏了「路由只依赖桶」的约束。
// 收归到桶后该约束可以无例外执行（由 test/ai-architecture.test.js 静态守护）。
const {
    emit: emitEvent,
    getStats: getEventBusStats,
    getHistory: getEventBusHistory,
} = require('./events/event-bus');

// ============================================
// AI 模块扩展服务
// ============================================

// AI 识别行为设置（DB 优先，env 兜底；供 /ai/settings 路由与解析链路使用）
const { getAiSettings, updateAiSettings } = require('./services/ai-settings-service');

// 洞察引擎
const insightEngine = require('./services/insight-engine');
const {
runFullAnalysis, getInsights, getRankedInsights, getInsightStats,
markRead, dismissInsight, dismissAllOfType, cleanupOldInsights,
INSIGHT_TYPES,
} = insightEngine;

// 对话与消息
const conversationService = require('./services/conversation-service');
const messageService = require('./services/message-service');

// 用户 Profile
const profileService = require('./services/profile-service');

// ============================================
// 运行时代理：规则证据批量学习定时器（server/index.js 启动，24h 一次）
// 2026-08-29：同批预留的 tool-registry / intent-router / context-planner /
// memory-retrieval-chat 已确认零消费（消费链为空）并删除，见 git 历史。
// ============================================
// Evidence Scheduler
const { runBatchLearning, startScheduler, pendingFeedbackCount } = require('./learning/evidence-scheduler');

// Forecast & Simulation
const forecastService = require('./services/forecast-service');

// 财务分析工具（只读）：让对话式 AI 能查询账本全量数据（交易/债务/预算/理财/储蓄）
// 并据此分析、给出决策建议。与 tools/tool-registry.js 的区别见该文件头注释 ——
// 这套是字段与 schema 对齐、带 book_id 隔离、真正被 /ai/chat 调用的实现。
const financeTools = require('./tools/finance-tools');

// Feature Flags & Metrics
const { isEnabled, areEnabled, getAllFlags, getUserFeatures } = require('./features/feature-flags');
const metricsCleanup = require('./features/metrics-cleanup');

// 图片通道：转录层（大模型 vision 主路 / 腾讯云 OCR 兜底）
// ⛔ 腾讯 OCR 在本方案里【只提供识别能力，不参与学习】——
//    它的产物是纯文字，之后与用户手打文字走完全相同的下游链路。
const { transcribeImage } = require('./vision/image-transcriber');
const { resolveVisionSupport, guessVisionByModel } = require('./vision/vision-capability');
// 票据版式预处理：账单版式文本直接喂给抽取器会严重误判（单号被当金额），
// 必须先整理成干净语句。详见 receipt-preprocessor.js 文件头的实测记录。
const { looksLikeReceipt, preprocessReceipt } = require('./vision/receipt-preprocessor');

module.exports = {
    // ---- 预测闭环 ----
    parseTransactions,
    createPrediction,
    getPrediction,
    commitPrediction,
    discardPrediction,

    // ---- 规则管理（§4）----
    listRules,
    ruleEvidenceTrail,
    createManualRule,
    disableRule,
    enableRule,
    detectContradictions,
    evidenceStats,
    EVIDENCE_WEIGHTS,
    STATUS_THRESHOLDS,
    HALF_LIFE_DAYS,

    // ---- 运行时可观测（§10 / §12）----
    breakerStates,
    resetBreakers,
    usageMetrics,
    analyzeComplexity,

    // ---- 事件总线（路由层 /ai/events/* 依赖，统一走桶）----
    emitEvent,
    getEventBusStats,
    getEventBusHistory,

    // ---- 评测（§12）----
    runOfflineEvaluation,
    collectOnlineMetrics,
    compareWithBaseline,
    persistRun,
    latestRun,
    DATASET_VERSION,

    // ---- 图片通道（转录 → 版式预处理 → 主链路）----
    transcribeImage,
    resolveVisionSupport,
    guessVisionByModel,
    looksLikeReceipt,
    preprocessReceipt,

    // ---- 供测试 / 其它模块复用的纯函数 ----
    extractTransactions,
    composeNote,
    validateResult,
    loadContext,
    parseOffline,
    FIELD_THRESHOLDS,
    PREDICTION_VERSION,

    // ---- 洞察引擎 ----
    runFullAnalysis,
    getInsights,
    getRankedInsights,
    getInsightStats,
    markRead,
    dismissInsight,
    dismissAllOfType,
    cleanupOldInsights,
    INSIGHT_TYPES,
    // 对话与消息
    conversationService,
    messageService,
    // 用户 Profile
    profileService,

    // ---- Evidence Scheduler ----
    runBatchLearning,
    startScheduler,
    pendingFeedbackCount,

    // ---- Forecast & Simulation ----
    forecastService,

    // ---- 财务分析工具（只读，供 /ai/chat 调用）----
    financeTools,

    // ---- Feature Flags & Metrics ----
    isEnabled,
    areEnabled,
    getAllFlags,
    getUserFeatures,
    metricsCleanup,

    // ---- AI 识别行为设置 ----
    getAiSettings,
    updateAiSettings,
};
