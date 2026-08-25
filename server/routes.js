/* ============================================
   鑫钱包 · Express API Routes (模块化入口)
   所有子路由模块位于 routes/ 目录下。
   本文件仅负责注册鉴权中间件与挂载子模块，不含业务逻辑。
   ============================================ */

const express = require('express');
const { authMiddleware } = require('./auth');
const { validate, rules } = require('./validate');
const { apiLimiter, writeLimiter, aiLimiter } = require('./rate-limit-user');

const router = express.Router();

// ==========================================
// 公开路由：认证（无需鉴权）
// ==========================================
const authRoutes = require('./routes/auth');
router.use('/auth', authRoutes);

const { resolveBookContext, router: booksRouter } = require('./routes/books');

// ==========================================
// 受保护路由统一鉴权
// ==========================================
router.use((req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    return authMiddleware(req, res, next);
});

// 多账本：解析当前账本（X-Book-Id / 默认账本 / 自动创建），写入 req.bookId。
// 必须置于 authMiddleware 之后，确保 req.userId 已就绪再按用户隔离账本。
router.use(resolveBookContext);

// ==========================================
// M5 · 用户级速率限制（按 userId 限速，防刷接口 / 防 AI 成本失控）
//   apiLimiter: 已认证接口 200 次/分；writeLimiter: 写操作 60 次/分
// /auth 已在 app 层用 authLimiter(IP) 限流，此处跳过避免重复计数。
// ==========================================
router.use((req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    return apiLimiter(req, res, next);
});
router.use((req, res, next) => {
    if (req.path.startsWith('/auth') || req.method === 'GET') return next();
    return writeLimiter(req, res, next);
});

// ==========================================
// M4 · 通用参数防护（受保护路由统一接入 validate 中间件）
// 仅校验“存在的值”，不强制字段必填，故不影响无参路由的正常行为：
//   - :id / :rid 必须为正整数（挡 NaN / 负数 / 0，防越权与错误查询）
//   - ?limit=  必须为 1..1000 整数（防大查询 DoS）
// /auth 路由已在上方子路由内处理，不会经过此处。
// ==========================================
router.use(validate({
    params: { id: rules.routeId, rid: rules.routeId },
    query: { limit: rules.limit },
}));

// ==========================================
// 业务路由模块（按域拆分的路由）
// ==========================================
router.use('/accounts', require('./routes/accounts'));
router.use('/ai', aiLimiter, require('./routes/ai'));
router.use('/transfers', require('./routes/transfers'));
router.use('/transactions', require('./routes/transactions'));   // /transactions, /transactions/months, /transactions/summary, /ledger
router.use('/budgets', require('./routes/budgets'));
router.use('/reports', require('./routes/reports'));
// investments 路由同时挂到两个前缀：/investment-types（类型 CRUD）、/investments（持仓）
const investmentsRoutes = require('./routes/investments');
router.use('/investment-types', investmentsRoutes);
router.use('/investments', investmentsRoutes);
router.use('/stats', require('./routes/stats'));   // 含 /stats/dashboard + /stats/investments
router.use('/categories', require('./routes/categories'));
router.use('/tags', require('./routes/tags'));
router.use('/savings-goals', require('./routes/savings'));
router.use('/debts', require('./routes/debts'));
router.use('/books', booksRouter);
router.use('/backup', require('./routes/backup'));   // /backup/export, /backup/import（xlsx 3 工作表备份）

// ==========================================
// 导出
// ==========================================
module.exports = router;
