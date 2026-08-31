/* ============================================
   Event Bus
   ------------------------------------------------
   事件总线：交易变更 → 洞察分析链路的触发器。

   设计原则：
     - 进程内内存 Pub/Sub（轻量、无额外依赖）
     - 每个事件类型独立 Handler List（可并发注册多个监听器）
     - Handler 异常不阻断主流程（fire-and-forget）
     - 支持订阅 filtered 事件（如仅账本 A 的 transaction.created）

   事件类型：
     transaction.created   — 新增交易
     transaction.updated   — 编辑交易
     transaction.deleted   — 删除交易
     budget.exceeded      — 预算超支（实时）
     balance.anomaly      — 余额异常（实时）

   使用方式（两种）：
     1. 主动 emit（routes 中调用）：
        const { emit } = require('./event-bus');
        emit('transaction.created', { userId, bookId, transaction });
     2. 订阅处理（启动时注册）：
        const { subscribe } = require('./event-bus');
        subscribe('transaction.created', async (event) => { ... });
   ============================================ */

// 事件处理器注册表
const handlers = new Map();

// 事件历史（用于调试/监控，最多保留 1000 条）
const eventHistory = [];
const MAX_HISTORY = 1000;

/**
 * 注册事件处理器
 * @param {string} eventType
 * @param {function} handler  async (event) => void
 * @returns {function} 取消订阅的函数
 */
function subscribe(eventType, handler) {
    if (!handlers.has(eventType)) {
        handlers.set(eventType, new Set());
    }
    handlers.get(eventType).add(handler);

    // 返回取消订阅函数
    return () => {
        handlers.get(eventType)?.delete(handler);
    };
}

/**
 * 订阅多个事件类型（通配符）
 * @param {string} pattern  如 'transaction.*' 匹配所有 transaction.* 事件
 * @param {function} handler
 */
function subscribeWildcard(pattern, handler) {
    const unsub = subscribe(pattern, handler);
    // 同时订阅所有已存在的匹配事件类型
    for (const eventType of handlers.keys()) {
        if (matchEventType(eventType, pattern)) {
            handlers.get(eventType)?.add(handler);
        }
    }
    return unsub;
}

/**
 * 触发事件（fire-and-forget，不等待所有 handler 完成）
 * @param {string} eventType
 * @param {object} payload
 */
function emit(eventType, payload) {
    const timestamp = new Date().toISOString();
    const event = { eventType, payload, timestamp, id: generateEventId() };

    // 记录历史
    eventHistory.push(event);
    if (eventHistory.length > MAX_HISTORY) eventHistory.shift();

    // 立即触发匹配的事件处理器
    const matchedTypes = findMatchingEventTypes(eventType);
    for (const type of matchedTypes) {
        const typeHandlers = handlers.get(type);
        if (!typeHandlers) continue;

        for (const handler of typeHandlers) {
            // fire-and-forget：用 setImmediate 异步执行，异常不传播
            setImmediate(() => {
                try {
                    handler(event);
                } catch (err) {
                    console.warn(`[event-bus] Handler for "${type}" threw:`, err.message);
                }
            });
        }
    }

    return event;
}

/**
 * 同步触发事件（等待所有 handler 完成，返回结果数组）
 * 仅用于测试/关键流程
 */
async function emitSync(eventType, payload) {
    const timestamp = new Date().toISOString();
    const event = { eventType, payload, timestamp, id: generateEventId() };

    const matchedTypes = findMatchingEventTypes(eventType);
    const results = [];

    for (const type of matchedTypes) {
        const typeHandlers = handlers.get(type);
        if (!typeHandlers) continue;

        for (const handler of typeHandlers) {
            try {
                results.push({ type, handler: 'ok', result: await handler(event) });
            } catch (err) {
                results.push({ type, handler: 'error', error: err.message });
            }
        }
    }

    return { event, results };
}

/**
 * 获取事件历史（用于调试）
 */
function getHistory({ limit = 100, eventType = null } = {}) {
    let history = eventHistory;
    if (eventType) {
        history = history.filter(e => e.eventType === eventType);
    }
    return history.slice(-limit);
}

/**
 * 清空事件历史
 */
function clearHistory() {
    eventHistory.length = 0;
}

// ============================================
// 辅助函数
// ============================================

function matchEventType(eventType, pattern) {
    if (eventType === pattern) return true;
    const patternParts = pattern.split('.');
    const eventParts = eventType.split('.');
    if (patternParts.length !== eventParts.length) return false;
    return patternParts.every((p, i) => p === '*' || p === eventParts[i]);
}

function findMatchingEventTypes(eventType) {
    const result = [eventType];
    for (const pattern of handlers.keys()) {
        if (pattern !== eventType && matchEventType(eventType, pattern)) {
            result.push(pattern);
        }
    }
    return result;
}

let _eventCounter = 0;
function generateEventId() {
    return `${Date.now()}-${++_eventCounter}`;
}

/**
 * 获取当前注册的所有事件类型和处理器数量（用于调试）
 */
function getStats() {
    const stats = {};
    for (const [type, handlerSet] of handlers.entries()) {
        stats[type] = handlerSet.size;
    }
    return {
        eventTypes: Object.keys(stats),
        handlerCounts: stats,
        historySize: eventHistory.length,
    };
}

module.exports = {
    subscribe,
    subscribeWildcard,
    emit,
    emitSync,
    getHistory,
    clearHistory,
    getStats,
};
