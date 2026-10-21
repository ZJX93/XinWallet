/**
 * 鑫钱包 · 结构化日志
 * 统一日志输出格式（JSON 行 / 可读格式），便于容器日志收集和 grep
 * 默认使用 pino 风格 API，但零依赖实现，避免引入新 npm 包
 */

// 日志级别（数值越小越严重）
const LEVELS = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10,
};

// 解析环境变量
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LEVELS[envLevel] !== undefined ? LEVELS[envLevel] : LEVELS.info;

// 格式：'json' 输出结构化日志（生产），其他输出人类可读格式（开发）
const envFormat = (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')).toLowerCase();

/**
 * 格式化日志行（pretty 格式）
 * @param {string} level 日志级别
 * @param {string} msg 消息
 * @param {Object} ctx 上下文对象（可选）
 * @param {number} time 时间戳
 */
function formatPretty(level, msg, ctx, time) {
    const timeStr = new Date(time).toLocaleString('zh-CN', { hour12: false });
    const levelStr = level.toUpperCase().padEnd(5);
    const ctxStr = ctx && Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
    return `[${timeStr}] ${levelStr} ${msg}${ctxStr}`;
}

/**
 * 格式化日志行（JSON 格式）
 */
function formatJson(level, msg, ctx, time) {
    return JSON.stringify({
        time: new Date(time).toISOString(),
        level,
        msg,
        ...ctx,
    });
}

/**
 * 输出日志（按级别过滤）
 */
function log(level, msg, ctx = {}) {
    const levelValue = LEVELS[level] || LEVELS.info;
    if (levelValue < minLevel) return;

    const time = Date.now();
    const line = envFormat === 'json' ? formatJson(level, msg, ctx, time) : formatPretty(level, msg, ctx, time);

    // error/fatal 走 stderr，其他走 stdout（容器日志规范）
    if (levelValue >= LEVELS.error) {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

// 公开 API
const logger = {
    fatal: (msg, ctx) => log('fatal', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    debug: (msg, ctx) => log('debug', msg, ctx),
    trace: (msg, ctx) => log('trace', msg, ctx),

    // Express 请求日志中间件
    http(req, res, durationMs) {
        const ctx = {
            method: req.method,
            url: req.originalUrl || req.url,
            status: res.statusCode,
            durationMs: Math.round(durationMs),
            ip: req.ip || req.connection?.remoteAddress,
            userId: req.user?.id,
        };
        if (res.statusCode >= 500) {
            log('error', 'HTTP', ctx);
        } else if (res.statusCode >= 400) {
            log('warn', 'HTTP', ctx);
        } else {
            log('info', 'HTTP', ctx);
        }
    },

};

module.exports = logger;