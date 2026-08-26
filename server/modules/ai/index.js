/* ============================================
   AI v0.2 · 模块桶文件
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

// Phase 3：规则演化与证据
const {
    createManualRule, disableRule, enableRule, detectContradictions, evidenceStats,
} = require('./learning/evidence-engine');
const { EVIDENCE_WEIGHTS, STATUS_THRESHOLDS, HALF_LIFE_DAYS, listRules, ruleEvidenceTrail } =
    require('./rules/rule-store');

// Phase 4：运行时（复杂度路由 / 熔断 / 成本）
const { breakerStates, resetBreakers } = require('./runtime/model-router');
const { usageMetrics } = require('./runtime/cost-tracker');
const { analyzeComplexity } = require('./runtime/complexity-analyzer');

// Phase 5：评测
const {
    runOfflineEvaluation, collectOnlineMetrics, compareWithBaseline, persistRun, latestRun,
} = require('./evaluation/runner');
const { DATASET_VERSION } = require('./evaluation/dataset');

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
};
