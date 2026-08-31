/* ============================================
   鑫钱包 · 认证模块 (Auth)
   提供密码哈希、JWT 签发与校验、路由鉴权中间件
   ============================================ */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 安全检查：生产环境下不允许使用默认 JWT 密钥
// 修复（P2）：检查列表加入 docker-compose.yml 中使用的默认值 'please-change-this-secret'
const JWT_SECRET = process.env.JWT_SECRET;
const DEFAULT_SECRETS = new Set([
    'zhicai-dev-secret-change-me',
    'please-change-this-to-a-long-random-secret-string',
    'please-change-this-secret', // docker-compose.yml default
    'zhicai-super-secret-jwt-key-2026-fixed', // 已泄露的提交密钥，禁止再次使用
]);
if (!JWT_SECRET || DEFAULT_SECRETS.has(JWT_SECRET)) {
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ 安全错误：生产环境必须设置 JWT_SECRET 环境变量（不得使用默认值）');
        console.error('   请运行: openssl rand -hex 32  生成一个随机密钥，并写入 .env 文件的 JWT_SECRET');
        process.exit(1);
    } else {
        console.warn('⚠️ 安全警告：JWT_SECRET 未配置或使用默认值，仅开发环境允许。');
        console.warn('   生产环境请务必设置 JWT_SECRET 环境变量。');
    }
}
const EFFECTIVE_SECRET = JWT_SECRET || 'zhicai-dev-secret-change-me';
// Token 有效期缩短到 1 小时（短期凭证），演示 / 离线环境可通过 JWT_EXPIRES 覆盖
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';

// 异步哈希（避免阻塞事件循环）
async function hashPassword(plain) {
    return bcrypt.hash(plain, 10);
}

// 异步校验密码
async function verifyPassword(plain, hash) {
    try {
        return await bcrypt.compare(plain, hash);
    } catch {
        return false;
    }
}

// 修复（P4）：删除 verifyPasswordSync 死代码（无任何调用方，且 bcrypt.compareSync 阻塞事件循环，
// 与设计意图"避免阻塞"相悖）。已确认项目内仅 export 和 require 中出现。

// 签发 JWT：显式声明算法，避免未来库默认值变更
function signToken(user) {
    return jwt.sign(
        { id: Number(user.id), username: user.username },
        EFFECTIVE_SECRET,
        { algorithm: 'HS256', expiresIn: JWT_EXPIRES }
    );
}
// 签发 Refresh Token（默认 7 天、独立 secret、payload 带 type='refresh' 区分）
function signRefreshToken(user) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET || EFFECTIVE_SECRET;
    return jwt.sign(
        { id: Number(user.id), type: 'refresh' },
        refreshSecret,
        { algorithm: 'HS256', expiresIn: '30d' }
    );
}

// 路由鉴权中间件：校验 Bearer Token，注入 req.userId
function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, message: '未授权，请先登录' });
    }
    try {
        const payload = jwt.verify(token, EFFECTIVE_SECRET, { algorithms: ['HS256'] });
        // 防御：refresh token 不可用于访问受保护资源
        if (payload.type === 'refresh') {
            return res.status(401).json({ success: false, message: 'Refresh token 不可用于访问受保护资源' });
        }
        req.userId = payload.id;
        next();
    } catch {
        return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
}

module.exports = { hashPassword, verifyPassword, signToken, signRefreshToken, authMiddleware };
