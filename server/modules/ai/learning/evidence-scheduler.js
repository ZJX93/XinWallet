const logger = require('../../../../../../../../logger');
/* ============================================
   Evidence Scheduler
   ------------------------------------------------
   批量学习调度器。

   设计依据：
     - 「积累」：Feedback 事件先写入 ai_feedback_events，不立即学习
     - 「调度」：定时任务（如每日凌晨）或积累到阈值（如 10 条）时触发批量学习
     - 「评估」：用 evidence-engine.learnFromCommitBatch 批量处理
     - 「回滚保护」：学习失败不影响已落账数据

   触发条件（满足任一）：
     1. 定时触发：每 24 小时运行一次（通过外置 cron 或 setInterval）
     2. 阈值触发：累积未处理的 feedback_events >= 10 条时立即触发
   ============================================ */

const db = require('../../../db');

// 批量学习阈值（未处理的 feedback 达到此数量时触发立即学习）
const BATCH_THRESHOLD = 10;

/**
 * 检查是否需要触发批量学习（阈值检查）
 * @returns {Promise<number>} 待处理的 feedback 数量
 */
async function pendingFeedbackCount() {
    try {
        const row = await db.queryOne(
            `SELECT COUNT(*) AS cnt FROM ai_feedback_events WHERE processed = FALSE`
        );
        return parseInt(row?.cnt, 10) || 0;
    } catch (_) {
        return 0;
    }
}

/**
 * 获取待处理的反馈事件（批量）
 * @param {number} [limit=50]
 */
async function fetchPendingFeedback({ limit = 50 } = {}) {
    try {
        return await db.query(
            `SELECT f.*, p.user_id, p.book_id
               FROM ai_feedback_events f
               JOIN ai_predictions p ON f.prediction_id = p.id
               WHERE f.processed = FALSE
               ORDER BY f.created_at ASC
               LIMIT ?`,
            [limit]
        );
    } catch (_) {
        return [];
    }
}

/**
 * 批量学习主入口
 *
 * @param {object} options
 * @param {boolean} options.forceRun  强制执行（忽略阈值检查）
 * @param {number}  options.limit     最多处理多少条（默认 50）
 * @returns {Promise<{processed: number, created: number, updated: number, errors: string[]}>}
 */
async function runBatchLearning({ forceRun = false, limit = 50 } = {}) {
    const errors = [];

    // 阈值检查
    if (!forceRun) {
        const count = await pendingFeedbackCount();
        if (count < BATCH_THRESHOLD) {
            return { processed: 0, created: 0, updated: 0, skipped: true, reason: `未达阈值（${count}/${BATCH_THRESHOLD}）` };
        }
    }

    // 获取待处理事件
    const events = await fetchPendingFeedback({ limit });
    if (events.length === 0) return { processed: 0, created: 0, updated: 0, skipped: true, reason: '无待处理事件' };

    let created = 0, updated = 0, processed = 0;

    // 懒加载 evidence-engine
    let evidenceEngine;
    try {
        evidenceEngine = require('./evidence-engine');
    } catch (_) {
        return { processed: 0, created: 0, updated: 0, errors: ['evidence-engine 加载失败'] };
    }

    for (const event of events) {
        try {
            // 构建与 learnFromCommit 相同的 payload 结构
            const payload = {
                predictionId: event.prediction_id,
                userId: event.user_id,
                bookId: event.book_id,
                action: event.event_type === 'explicit_confirmation' ? 'confirmed'
                     : event.event_type === 'explicit_correction' ? 'corrected'
                     : event.event_type === 'discard' ? 'discarded'
                     : 'feedback',
                feedbackEventId: event.id,
            };

            const result = await evidenceEngine.learnFromCommit(db, payload);

            // 标记为已处理
            await db.query(
                `UPDATE ai_feedback_events SET processed = TRUE WHERE id = ?`,
                [event.id]
            );

            if (result) {
                created += result.created || 0;
                updated += result.updated || 0;
            }
            processed++;
        } catch (err) {
            errors.push(`event ${event.id}: ${err.message}`);
            // 单条失败不影响其他，继续处理
        }
    }

    return { processed, created, updated, errors };
}

/**
 * 创建定时调度的 setInterval 句柄（进程内调度，用于没有 cron 的环境）
 * @param {number} intervalHours  间隔小时数（默认 24）
 * @returns {NodeJS.Timeout} setInterval 句柄
 */
function startScheduler(intervalHours = 24) {
    const ms = intervalHours * 3600 * 1000;
    const timer = setInterval(async () => {
        try {
            const result = await runBatchLearning({ forceRun: true, limit: 50 });
            logger.info(`[evidence-scheduler] 批量学习完成: processed=${result.processed}, created=${result.created}, updated=${result.updated}`);
        } catch (err) {
            logger.error('[evidence-scheduler] 批量学习异常:', err.message);
        }
    }, ms);

    // 启动时立即运行一次
    runBatchLearning({ forceRun: false }).catch(err => {
        logger.warn('[evidence-scheduler] 启动时批量学习跳过:', err.message);
    });

    return timer;
}

/**
 * 停止调度器
 */
function stopScheduler(timer) {
    if (timer) clearInterval(timer);
}

module.exports = {
    runBatchLearning,
    pendingFeedbackCount,
    fetchPendingFeedback,
    startScheduler,
    stopScheduler,
    BATCH_THRESHOLD,
};
