/* ============================================
   Event Handlers
   ------------------------------------------------
   Event Bus 的事件处理器：监听事件 → 触发洞察分析

   处理的事件：
     transaction.created  → 实时洞察分析（spending_spike / merchant_new 等）
     budget.exceeded     → 即时生成 budget_exceeded 洞察
     balance.anomaly    → 即时生成 balance_anomaly 洞察

   设计原则：
     - 所有 Handler 均为 fire-and-forget（不阻塞主事务）
     - Handler 异常在 event-bus 层面被吞掉，不污染主流程
   ============================================ */

const { emit } = require('./event-bus');
const insightEngine = require('../services/insight-engine');
const logger = require('../../../logger');

// ============================================
// transaction.created Handler
// ============================================

async function onTransactionCreated(event) {
    const { userId, bookId, transaction } = event.payload;
    if (!userId) return;

    try {
        // 并发运行多个分析器（独立无依赖）
        const analyzers = [];

        // 商家新检测：当天新增的商家
        if (transaction.merchant) {
            analyzers.push(
                insightEngine.generateInsight({
                    userId, bookId,
                    insightType: 'merchant_new',
                    title: `新商家出现：${transaction.merchant}`,
                    content: `首次在账本中记录「${transaction.merchant}」，消费 ${Math.abs(parseFloat(transaction.amount)).toFixed(2)} 元。`,
                    evidence: { merchant: transaction.merchant, amount: parseFloat(transaction.amount) },
                    dedupeKeySuffix: `merchant_${transaction.merchant}`,
                    importance: 2,
                })
            );
        }

        // 消费突增检测：异步运行完整分析（不阻塞）
        analyzers.push(
            runDeferredAnalysis(userId, bookId).catch(err =>
                logger.warn('[event-handler] spending_spike 分析失败:', err.message)
            )
        );

        await Promise.allSettled(analyzers);
    } catch (err) {
        // 异常不抛出，event-bus fire-and-forget 会吞掉
        logger.warn('[event-handler] transaction.created 处理异常:', err.message);
    }
}

/**
 * 延迟执行：交易突增分析需要「今天」数据 vs 「过去 4 周」数据，
 * 单独一条 transaction.created 不够，需要等当天数据积累。
 * 用 setTimeout(0) 让出主线程，让本轮 HTTP 响应先返回。
 */
function runDeferredAnalysis(userId, bookId) {
    return new Promise((resolve) => {
        setTimeout(async () => {
            try {
                await insightEngine.runFullAnalysis(userId, bookId);
                resolve();
            } catch (err) {
                resolve(); // 不管成功失败都 resolve，不阻塞
            }
        }, 0);
    });
}

// ============================================
// budget.exceeded Handler（实时触发）
// ============================================

async function onBudgetExceeded(event) {
    const { userId, bookId, budgetId, budgetName, exceededAmount, totalSpent } = event.payload;
    if (!userId) return;

    try {
        await insightEngine.generateInsight({
            userId, bookId,
            insightType: 'budget_exceeded',
            title: `预算超支：${budgetName}`,
            content: `「${budgetName}」已超支 ${Math.abs(exceededAmount).toFixed(2)} 元，当前消费 ${Math.abs(totalSpent).toFixed(2)} 元。`,
            evidence: { budget_id: budgetId, budget_name: budgetName,
                       exceeded_amount: exceededAmount, total_spent: totalSpent },
            dedupeKeySuffix: `budget_${budgetId}`,
            importance: 5,
        });
    } catch (err) {
        logger.warn('[event-handler] budget.exceeded 处理异常:', err.message);
    }
}

// ============================================
// balance.anomaly Handler（实时触发）
// ============================================

async function onBalanceAnomaly(event) {
    const { userId, bookId, accountId, accountName, balance } = event.payload;
    if (!userId) return;

    try {
        await insightEngine.generateInsight({
            userId, bookId,
            insightType: 'balance_anomaly',
            title: `账户余额为负：${accountName}`,
            content: `账户「${accountName}」余额为 ${parseFloat(balance).toFixed(2)} 元，请检查是否有未到账支出。`,
            evidence: { account_id: accountId, account_name: accountName, balance: parseFloat(balance) },
            dedupeKeySuffix: `account_${accountId}_negative`,
            importance: 5,
        });
    } catch (err) {
        logger.warn('[event-handler] balance.anomaly 处理异常:', err.message);
    }
}

// ============================================
// 初始化：注册所有 Handler
// ============================================

let _initialized = false;
let _unsubFns = [];

/**
 * 初始化事件处理器（在应用启动时调用一次）
 * @param {object} [options]
 * @param {boolean} [options.skipExisting]  跳过已初始化（用于热重载）
 */
function initEventHandlers(options = {}) {
    if (_initialized && options.skipExisting) return;
    if (_initialized) {
        logger.warn('[event-handlers] initEventHandlers 已调用，忽略重复初始化');
        return;
    }

    _unsubFns = [
        // transaction.created
        emit('transaction.created', null), // 先订阅，再等待事件（确保注册了再 emit）
    ];

    // 正确订阅方式：直接调用 subscribe
    const { subscribe } = require('./event-bus');

    _unsubFns.push(subscribe('transaction.created', onTransactionCreated));
    _unsubFns.push(subscribe('budget.exceeded', onBudgetExceeded));
    _unsubFns.push(subscribe('balance.anomaly', onBalanceAnomaly));

    _initialized = true;
    logger.info('[event-handlers] 已初始化，监听事件：transaction.created, budget.exceeded, balance.anomaly');
}

/**
 * 关闭事件处理器（用于测试/热重载）
 */
function destroyEventHandlers() {
    for (const unsub of _unsubFns) {
        if (typeof unsub === 'function') unsub();
    }
    _unsubFns = [];
    _initialized = false;
}

module.exports = {
    onTransactionCreated,
    onBudgetExceeded,
    onBalanceAnomaly,
    initEventHandlers,
    destroyEventHandlers,
};
