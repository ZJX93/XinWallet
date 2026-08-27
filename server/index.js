/* ============================================
   鑫钱包 · Express Server Entry Point
   ============================================ */

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const db = require('./db');
const routes = require('./routes');
const logger = require('./logger');
const { hashPassword } = require('./auth');
const { ensureUserSeed } = require('./seed-data');

const app = express();
const PORT = process.env.PORT || 18888;

// ==========================================
// 安全配置
// ==========================================

// CORS：允许同源访问；如需跨域前端，配置 CORS_ORIGIN（逗号分隔）
const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// CORS：前端由本服务同源托管，默认无需跨域；仅当显式配置 CORS_ORIGIN 时才允许跨域，
// 且严格校验来源白名单（避免任意站点携带凭据发起请求）。
app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: allowedOrigins.length > 0
}));

// 登录/注册接口限流，防止暴力破解与凭据爆破
// 默认：5 分钟内每 IP 最多 20 次尝试（可通过 AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW_MIN 调整）
// 修复（P2 降级点）：原实现依赖 req.body.username，但 limiter 早于 express.json 挂载，
// username 永远为空导致 keyGenerator 退化为纯 IP。改用纯 IP 限流 + 数据库层 per-account
// 锁定（users.fail_count + locked_until）作为第二道防线，效果更强也更可靠。
const authLimiter = rateLimit({
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MIN || '5', 10) * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: '操作过于频繁，请稍后再试' },
    keyGenerator: (req) => req.ip
});
app.use('/api/auth', authLimiter);

// Helmet：开启 CSP（前端已完全离线自包含，Chart.js / 字体均为本地资源；
// 2026-07-22 优化：移除 scriptSrc 的 'unsafe-inline'——所有内联 onclick 处理器
// 已重构为事件委托 + addEventListener 绑定（详见 js/managers/report.js）；
// styleSrc 仍保留 'unsafe-inline' 是因为页面大量使用内联 style 属性（约 200+ 处），
// 短期内重构这些样式属性到 CSS 类需要单独迭代。
// 关闭 upgrade-insecure-requests：容器 18888 默认仅 HTTP，内网 NAS 直接访问时不强制升级 HTTPS。
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],                                      // Phase 0 收紧：内联脚本已全部外置为外部文件
            scriptSrcAttr: ["'none'"],                                  // 禁止 onclick/onchange 等内联事件属性
            styleSrc: ["'self'", "'unsafe-inline'"],                    // 暂保留：CSS-in-JS 或内联 style 属性需逐步外置
            fontSrc: ["'self'", "data:"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null
        }
    }
}));

// Gzip/Brotli 压缩：静态资源（CSS/JS/HTML）通常可压缩 60-80%，显著减少传输时间
app.use(compression({
    // 仅压缩大于 1KB 的响应，小文件压缩收益低
    threshold: 1024,
    // 压缩级别 6：在压缩率与 CPU 开销之间取得平衡
    level: 6
}));

// 中间件
// 修复（P1/P2）：生产环境使用 combined 日志格式（无色彩，含完整 URL 与响应时间，更适合采集）
// 请求日志接入结构化 logger（替代默认 morgan 控制台输出，统一日志出口）
app.use(morgan((tokens, req, res) => {
    const duration = parseFloat(tokens['response-time'](req, res)) || 0;
    logger.http(req, res, duration);
    return undefined; // 交由 logger 统一输出，morgan 不再直接写控制台
}, { skip: (req) => req.path === '/healthz' || req.path === '/readyz' }));
// 修复（P1）：显式 body limit，防止 DoS。Express 4.x 默认 100kb 对 /backup/import 等导入接口可能不足，
// 但过大会放大单请求攻击面；选 1mb 与 csv 单笔最大 5mb 之间留出余量，超出请客户端分批。
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// API 路由（含公开 /auth 与受保护业务路由）
// 注：图片上传（multer）已收敛到 /api/ai/ocr 路由局部（见 server/routes/ai.js），
// 不再对所有 /api 请求套用内存上传中间件，缩小 DoS / 内存放大面。
app.use('/api', routes);

// 已认证 API 的用户级限流（在 auth 中间件之后生效，由 routes.js 内逐路由挂载）
// 见 server/rate-limit-user.js

// 全局错误处理中间件：统一所有 API 错误的响应格式
app.use((err, req, res, next) => {
    // 记录错误日志（生产环境可接入日志系统）
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.stack || err);
    
    // Multer 文件大小限制错误
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '文件大小超过限制（最大 5MB）' });
    }
    
    // JSON 解析错误
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, message: '请求数据格式错误' });
    }
    
    // 默认 500 错误，不泄露堆栈信息
    res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? '服务器内部错误，请稍后重试' 
            : err.message || '未知错误'
    });
});

// 静态文件（前端）：白名单只暴露 public/ 目录，根目录的源码与配置文件不会被列出
// 这彻底避免了黑名单遗漏导致的敏感文件暴露（新加 .env/secrets.json 等无需改 server 代码）
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.includes('vendor')) {
            // 第三方库：长期缓存（先于 .js 匹配）
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        } else if (/\.html$/.test(filePath)) {
            // 入口 HTML：不缓存，保证部署后始终拉取最新入口（由它再引用当前 css/js）
            res.setHeader('Cache-Control', 'no-store');
        } else if (/\.(css|js)$/.test(filePath)) {
            // 应用代码：无内容哈希指纹，采用较短 max-age + 必须重校验，
            // 兼顾「减少重复下载」与「部署后不至长期陈旧」。彻底的 immutable 长缓存
            // 需配合构建期的文件名哈希（属前端重模块化工作，见 review-report.md）。
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        } else if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/.test(filePath)) {
            // 静态资源：短期缓存
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        res.removeHeader('Pragma');
        res.removeHeader('Expires');
    }
}));

// 登录页干净路由：/login 映射到 login.html（/login.html 仍保留以兼容旧书签）
app.get('/login', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// 健康检查：Docker / k8s 探测
app.get('/healthz', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

// OpenAPI 规范 + Swagger UI（本地资源，离线可用，遵循 CSP 的 scriptSrc 'self'）
const openapiSpec = require('./openapi');
const swaggerUiDist = require('swagger-ui-dist');
const swaggerAssetPath = swaggerUiDist.getAbsoluteFSPath();

// 将 swagger-ui-dist 包内静态资源暴露在 /swagger-static/ 下（同源）
app.use('/swagger-static', express.static(swaggerAssetPath, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400'), // 1 天
}));

// 暴露 OpenAPI 规范（Swagger UI 通过 /openapi.json 拉取）
app.get('/openapi.json', (req, res) => res.json(openapiSpec));

// Swagger UI 页面（自定义 HTML，引用 /swagger-static 下的本地资源）
// 安全加固：生产环境关闭未鉴权的 API 文档，避免对内暴露完整接口清单。
app.get('/docs', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ success: false, message: 'Not Found' });
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>鑫钱包 API 文档</title>
<link rel="stylesheet" href="/swagger-static/swagger-ui.css">
<link rel="icon" type="image/png" href="/swagger-static/favicon-32x32.png" sizes="32x32">
</head>
<body>
<div id="swagger-ui"></div>
<script src="/swagger-static/swagger-ui-bundle.js" charset="UTF-8"></script>
<script>
SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis],
  layout: 'BaseLayout',
});
</script>
</body>
</html>`);
});

// 就绪检查：会实际 ping 数据库，失败时返回 503
app.get('/readyz', async (req, res) => {
    try {
        await db.queryOne('SELECT 1 AS ok');
        res.json({ success: true, data: { status: 'ready' } });
    } catch (err) {
        res.status(503).json({ success: false, message: 'database not ready' });
    }
});

// 深度健康检查：DB + 内存 + 运行时长（运维/监控系统用）
// 修复（P1）：移除 config / runtime 字段（暴露密钥配置状态、Node 版本、内存指纹等敏感信息），
// 数据库 + 内存 + 运行时长足够支持常规运维排查。
app.get('/health/deep', async (req, res) => {
    const checks = {};

    // 1. 数据库连接
    const dbStart = Date.now();
    try {
        await db.queryOne('SELECT 1 AS ok');
        checks.database = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (err) {
        checks.database = { ok: false, error: err.message };
    }

    // 2. 进程内存（运维可用，不含敏感信息）
    const mem = process.memoryUsage();
    checks.memory = {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
    };

    // 3. 运行时长
    checks.uptime = {
        seconds: Math.round(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    };

    // 与数据库可联通即视为健康；密钥存在性已挪到启动时的"密钥配置就绪"日志，不暴露在监控端点中
    const allOk = checks.database.ok;
    res.status(allOk ? 200 : 503).json({
        success: allOk,
        data: checks,
        timestamp: new Date().toISOString(),
    });
});

// SPA 兜底：未命中静态文件且非 /api 的 GET 请求，统一返回 index.html，
// 以支持 /transactions 这类干净路由（History API）。需放在静态文件之后。
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    // 仅对 HTML 导航请求返回 SPA 入口；其余（如 JSON/XHR 探测）返回 404，
    // 避免「任何未知路径一律 200」被当作探测靶。
    if (req.accepts('html')) {
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    } else {
        res.status(404).json({ success: false, message: 'Not Found' });
    }
});

// 等待数据库就绪并初始化（容器/NAS 环境下 PostgreSQL 可能尚未接受连接，避免启动竞态）
// 直接调用 initDatabase()：该函数幂等（自动 CREATE DATABASE + 建表，已存在则跳过），
// 因此无论是「自带 PostgreSQL 容器」还是「连接外部已有 PostgreSQL」都能正确建库建表 / 复用既有数据。
// 最多重试 30 次（约 60s），兼容 NAS 慢启动与外部库尚未就绪的场景。
async function waitForDatabaseAndInit(maxAttempts = 30, intervalMs = 2000) {
    // 首次启动：打印连接配置（密码脱敏）
    if (process.env.NODE_ENV !== 'production' || process.env.DB_DEBUG === '1') {
        console.log(`📡 数据库连接: ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`);
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const ok = await db.initDatabase();
            if (ok) {
                console.log('✅ 数据库已就绪');
                return true;
            }
        } catch (err) {
            // 详细打印最后一次连接错误（帮助诊断）
            if (attempt === 1 || attempt % 5 === 0) {
                console.error(`❌ 数据库初始化失败 (尝试 ${attempt}/${maxAttempts}): ${err.message}`);
                if (err.code) console.error(`   错误代码: ${err.code}`);
                // 输出排查建议
                console.error('   排查方向:');
                console.error('   1) 确认 PostgreSQL 已启动并监听 0.0.0.0:5432 (非仅 127.0.0.1)');
                console.error('   2) 确认用户有建表/建库权限 (CREATEDB, CREATE TABLE, ALTER, INDEX)');
                console.error('   3) 确认防火墙放行 5432 端口');
                console.error('   4) 在终端执行: psql -U postgres -h <HOST> 验证能登录');
            }
        }
        console.log(`⏳ 等待数据库就绪并初始化 (${attempt}/${maxAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
}

// 启动
async function start() {
    console.log('🚀 鑫钱包服务器启动中...');

    // 等待数据库就绪并初始化（幂等建库建表，复用既有数据）
    const ready = await waitForDatabaseAndInit();
    if (!ready) {
        console.error('❌ 数据库在限定重试次数内未就绪，请检查 PostgreSQL 容器状态或 .env 数据库连接配置');
        process.exit(1);
    }

    // AI/OCR 凭证自检：重部署后若加密密钥变更，已存凭证将无法解密，提前告警引导重新保存
    try {
        const { auditProviderKeys } = require('./services/ai');
        await auditProviderKeys();
    } catch (err) {
        console.warn('⚠️ AI 凭证自检未执行（不影响启动）:', err.message);
    }

<<<<<<< HEAD
    // AI Event Bus 初始化：注册 transaction.created / budget.exceeded / balance.anomaly 等事件处理器
    try {
        const { initEventHandlers } = require('./modules/ai/events/event-handlers');
        initEventHandlers();
    } catch (err) {
        console.warn('⚠️ Event Bus 初始化失败（不影响启动）:', err.message);
    }

    // AI Evidence Batch Scheduler 初始化（每 24h 批量学习）
    try {
        const { startScheduler } = require('./modules/ai/learning/evidence-scheduler');
        startScheduler(24);
    } catch (err) {
        console.warn('⚠️ Evidence Scheduler 启动失败（不影响启动）:', err.message);
    }

=======
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
    // 确保演示账号存在（使用 bcrypt 真实哈希，避免明文占位符）
    try {
        const demo = await db.queryOne("SELECT id FROM users WHERE username = 'demo'");
        if (!demo) {
            const demoPw = process.env.DEMO_PASSWORD || 'demo123456';
            const demoHash = await hashPassword(demoPw);
            await db.query(
                'INSERT INTO users (username, password_hash, nickname) VALUES ($1, $2, $3)',
                ['demo', demoHash, '演示用户']
            );
            console.log(`🔑 演示账号已创建  用户名: demo  密码: ******（已在 .env 中配置 DEMO_PASSWORD）`);
        }
    } catch (err) {
        console.warn('⚠️ 创建演示账号时出错:', err.message);
    }

    // 演示账号：自动注入种子数据（覆盖所有功能模块）
    try {
        const demoUser = await db.queryOne("SELECT id FROM users WHERE username = 'demo'");
        if (demoUser) {
            const demoUserId = demoUser.id;
            const hasData = await db.queryOne('SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ?', [demoUserId]);
            if (parseInt(hasData.cnt) === 0) {
                console.log('📝 为演示账号注入完整的演示数据...');
                const inserted = await ensureUserSeed(demoUserId);
                if (inserted) {
                    console.log('✅ 演示账号数据已就绪（账户/交易/转账/预算/理财/储蓄/债务/标签）');
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ 演示数据初始化失败:', err.message);
    }

    const server = app.listen(PORT, () => {
        logger.info('Server started', {
            port: PORT,
            env: process.env.NODE_ENV,
            nodeVersion: process.version,
            docs: `http://localhost:${PORT}/docs`,
        });
        logger.info('Frontend ready', { url: `http://localhost:${PORT}/index.html` });
    });

    // 优雅退出：SIGTERM/SIGINT 时先停止接收新请求，等在途请求结束，再关闭资源
    let isShuttingDown = false;
    const shutdown = async (signal) => {
        if (isShuttingDown) return; // 避免重复触发
        isShuttingDown = true;
        console.log(`\n🛑 收到 ${signal}，开始优雅退出...`);

        // 强制超时：最多等待 25 秒（K8s 默认给 30s）
        const forceExit = setTimeout(() => {
            console.error('❌ 25 秒内未完成收尾，强制退出');
            process.exit(1);
        }, 25_000);
        forceExit.unref();

        try {
            // 1. 停止接收新连接（继续完成在途请求）
            await new Promise((resolve) => {
                server.close(() => {
                    console.log('✅ HTTP server 已关闭');
                    resolve();
                });
            });

            // 2. 关闭数据库连接池
            if (db && db.pool) {
                await db.pool.end();
                console.log('✅ 数据库连接池已关闭');
            }
        } catch (err) {
            console.error('❌ 关闭过程中出错:', err.message);
        }

        clearTimeout(forceExit);
        console.log('👋 鑫钱包已退出');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // 未捕获异常 → 立即退出（容器编排器会自动重启）
    process.on('uncaughtException', (err) => {
        console.error('❌ Uncaught Exception:', err);
        shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
        console.error('❌ Unhandled Rejection:', reason);
    });
}

start();
