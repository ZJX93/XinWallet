/* ============================================
   AI v0.2 · 模块桶文件
   ------------------------------------------------
   对外只暴露四个用例入口，routes/ai.js 只依赖本文件，
   内部分层（extraction/parser/validation/prediction）可自由重构。
   ============================================ */

const { parseTransactions, loadContext } = require('./parser/transaction-parser');
const {
    createPrediction, getPrediction, commitPrediction, discardPrediction,
} = require('./prediction/prediction-store');
const { validateResult, FIELD_THRESHOLDS } = require('./validation/result-validator');
const { extractTransactions } = require('./extraction/deterministic-extractor');

module.exports = {
    // 用例入口
    parseTransactions,
    createPrediction,
    getPrediction,
    commitPrediction,
    discardPrediction,
    // 供测试 / 其它模块复用的纯函数
    extractTransactions,
    validateResult,
    loadContext,
    FIELD_THRESHOLDS,
};
