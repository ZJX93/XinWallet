/* ============================================
   鑫钱包 · 认证路由
   ============================================ */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hashPassword, verifyPassword, signToken, signRefreshToken, authMiddleware } = require('../auth');
const { success, fail, handleServerError } = require('./_helpers');
const { ensureUserSeed } = require('../seed-data');
const { validate, rules } = require('../validate');

// 登录失败次数阈值 + 锁定期（可通过环境变量调整，默认较宽松）
const MAX_FAIL_COUNT = parseInt(process.env.AUTH_LOCK_MAX_FAIL || '10', 10);
const LOCK_MINUTES = parseInt(process.env.AUTH_LOCK_MINUTES || '5', 10);

// 密码强度校验：≥8 位 + 字母 + 数字（避免弱密码）
function validatePasswordStrength(pw) {
    if (typeof pw !== 'string' || pw.length < 8) return '密码长度至少 8 位';
    if (!/[a-zA-Z]/.test(pw)) return '密码必须包含字母';
    if (!/[0-9]/.test(pw)) return '密码必须包含数字';
    return null;
}

// 注册（新用户从空白开始，不自动注入演示数据）
router.post('/register', validate({
    body: {
        username: rules.username,
        password: rules.password,
        nickname: { type: 'string', min: 1, max: 32, required: false },
    }
}), async (req, res) => {
    try {
        const { username, password, nickname } = req.body;

        const strengthErr = validatePasswordStrength(password);
        if (strengthErr) return res.status(400).json(fail(strengthErr));

        const exists = await db.queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (exists) return res.status(400).json(fail('用户名已存在'));

        const hash = await hashPassword(password);
        const result = await db.query(
            'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
            [username, hash, nickname || username]
        );
        // 回查用户（含 avatar 默认值），避免登录响应缺失 avatar 导致前端回退默认头像
        const user = await db.queryOne(
            'SELECT id, username, nickname, avatar FROM users WHERE id = ?',
            [result.insertId]
        );
        res.json(success({ token: signToken(user), refreshToken: signRefreshToken(user), user }, '注册成功'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 登录：基于 users.fail_count / users.locked_until 持久化锁定（重启不失效）
router.post('/login', validate({
    body: {
        username: { type: 'string', required: true, min: 1, max: 64 },
        password: { type: 'string', required: true, min: 1, max: 128 },
    }
}), async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await db.queryOne(
            'SELECT id, username, password_hash, nickname, avatar, fail_count, locked_until FROM users WHERE username = ?',
            [username]
        );

        // 账号被锁定
        if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(423).json(fail(`账号已被锁定，请于 ${new Date(user.locked_until).toLocaleString('zh-CN')} 后再试`));
        }

        const passwordOk = user && await verifyPassword(password, user.password_hash);
        if (!user || !passwordOk) {
            const failCount = (user?.fail_count || 0) + 1;
            const shouldLock = failCount >= MAX_FAIL_COUNT;
            const lockedUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null;
            await db.query(
                'UPDATE users SET fail_count = ?, locked_until = ?, last_fail_at = NOW() WHERE username = ?',
                [failCount, lockedUntil, username]
            );
            // 安全加固：移除登录失败的人为 sleep —— 该延迟可被滥用为连接占用型 DoS，
            // 真正的暴力破解防护已由 IP 级限流 + 账号锁定（fail_count/locked_until）承担。
            const msg = shouldLock
                ? `登录失败次数过多，账号已锁定 ${LOCK_MINUTES} 分钟`
                : '用户名或密码错误';
            return res.status(401).json(fail(msg));
        }

        // 成功登录：清除失败计数器与锁定
        if (user.fail_count > 0 || user.locked_until) {
            await db.query('UPDATE users SET fail_count = 0, locked_until = NULL WHERE username = ?', [username]);
        }
        const token = signToken({ id: user.id, username: user.username });
        const refreshToken = signRefreshToken({ id: user.id, username: user.username });
        res.json(success({
            token,
            refreshToken,
            user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar }
        }, '登录成功'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// 登录页配置（公开，无需认证）：供各端登录页判断「演示账号」按钮是否展示
// 服务端未设置 ALLOW_DEMO=true 时，多端登录页隐藏快捷登录演示账号的入口
router.get('/config', (req, res) => {
    res.json(success({ allowDemo: process.env.ALLOW_DEMO === 'true' }));
});

// 演示账号登录（无密码，仅开发/演示环境使用）
router.post('/demo', async (req, res) => {
    try {
        // 修复（P2）：所有环境统一要求 ALLOW_DEMO=true，避免 NAS 内网转发暴露时成为后门
        if (process.env.ALLOW_DEMO !== 'true') {
            return res.status(403).json(fail('演示登录未启用，请设置环境变量 ALLOW_DEMO=true'));
        }

        let user = await db.queryOne('SELECT * FROM users WHERE username = ?', ['demo']);
        if (!user) {
            // 自动创建演示账号
            const demoHash = await hashPassword('demo123456');
            const result = await db.query(
                'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)',
                ['demo', demoHash, '演示用户']
            );
            user = { id: result.insertId, username: 'demo', nickname: '演示用户', avatar: '👤' };
        }

        // 智能种子：演示账号如已有数据则复用，否则注入演示数据
        // 场景 1：旧库中存在 demo 账号但数据归属 user_id=1（迁移期兼容），则为 demo 补一份种子
        // 场景 2：demo 账号没有任何数据，注入完整种子数据
        try {
            const userHasTransactions = await db.queryOne(
                'SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ?', [user.id]
            );
            if (parseInt(userHasTransactions.cnt) === 0) {
                await ensureUserSeed(user.id);
                console.log(`✅ 演示账号 ${user.id} 已注入演示数据`);
            }
        } catch (seedErr) {
            console.warn('⚠️ 演示账号注入种子数据失败:', seedErr.message);
        }

        const token = signToken({ id: user.id, username: user.username });
        const refreshToken = signRefreshToken({ id: user.id, username: user.username });
        res.json(success({
            token,
            refreshToken,
            user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar }
        }, '演示登录成功'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// POST /api/auth/refresh — 使用 refresh token 换取新的 access token
// 修复（P2 降级点 #4）：原 validate() 传入数组而非对象，导致校验被完全跳过。
// 这里 jwt.verify 仍是真实的安全保障（签名 + type 检查 + 用户存在性），被绕过的仅是 body 长度约束。
router.post('/refresh', validate({
    body: {
        refreshToken: { type: 'string', required: true, min: 10, max: 1024, label: 'RefreshToken' }
    }
}), (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(400).json(fail('缺少 refreshToken'));
    }
    try {
        const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'zhicai-dev-secret-change-me';
        const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
        // 仅允许 refresh token
        if (payload.type !== 'refresh') {
            return res.status(401).json(fail('非法的 refresh token 类型'));
        }
        // 二次校验用户是否仍存在
        db.queryOne('SELECT id, username FROM users WHERE id = ?', [payload.id])
            .then(user => {
                if (!user) {
                    return res.status(401).json(fail('用户不存在或已被禁用'));
                }
                const newToken = signToken(user);
                const newRefreshToken = signRefreshToken(user);
                res.json(success({ token: newToken, refreshToken: newRefreshToken }, '令牌刷新成功'));
            })
            .catch(err => {
                console.error('refresh: db error', err.message);
                res.status(500).json(fail('服务器内部错误'));
            });
    } catch (err) {
        return res.status(401).json(fail('Refresh token 无效或已过期'));
    }
});

// ============================================
// 用户个人资料
// ============================================

// GET /api/auth/profile — 获取当前用户信息
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await db.queryOne(
            'SELECT id, username, nickname, avatar, created_at FROM users WHERE id = ?',
            [req.userId]
        );
        if (!user) return res.status(404).json(fail('用户不存在'));
        res.json(success({ user }));
    } catch (err) {
        handleServerError(res, err);
    }
});

// PUT /api/auth/profile — 更新昵称 / 修改密码 / 修改用户名
router.put('/profile', authMiddleware, validate({
    body: {
        username: { type: 'string', min: 3, max: 32, required: false },
        nickname: { type: 'string', min: 1, max: 32, required: false },
        avatar: { type: 'string', min: 1, max: 10, required: false },
        oldPassword: { type: 'string', min: 1, max: 128, required: false },
        newPassword: { type: 'string', min: 1, max: 128, required: false },
    }
}), async (req, res) => {
    try {
        const { username, nickname, avatar, oldPassword, newPassword } = req.body;
        const userId = req.userId;

        // 获取当前用户完整信息
        const user = await db.queryOne(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );
        if (!user) return res.status(404).json(fail('用户不存在'));

        const updates = [];
        const params = [];

        // 更新昵称
        if (nickname !== undefined && nickname !== user.nickname) {
            updates.push('nickname = ?');
            params.push(nickname);
        }

        // 更新用户名（需唯一性检查）
        if (username !== undefined && username !== user.username) {
            // 用户名格式：字母数字下划线，3-32 位
            if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
                return res.status(400).json(fail('用户名仅支持字母/数字/下划线，长度 3-32 位'));
            }
            const exists = await db.queryOne('SELECT id FROM users WHERE username = ? AND id <> ?', [username, userId]);
            if (exists) return res.status(400).json(fail('该用户名已被使用'));
            updates.push('username = ?');
            params.push(username);
        }

        // 更新头像
        if (avatar !== undefined && avatar !== user.avatar) {
            updates.push('avatar = ?');
            params.push(avatar);
        }

        // 修改密码
        if (oldPassword || newPassword) {
            if (!oldPassword) return res.status(400).json(fail('请输入旧密码'));
            if (!newPassword) return res.status(400).json(fail('请输入新密码'));

            const passwordOk = await verifyPassword(oldPassword, user.password_hash);
            if (!passwordOk) return res.status(400).json(fail('旧密码不正确'));

            const strengthErr = validatePasswordStrength(newPassword);
            if (strengthErr) return res.status(400).json(fail(strengthErr));

            if (oldPassword === newPassword) {
                return res.status(400).json(fail('新密码不能与旧密码相同'));
            }

            const newHash = await hashPassword(newPassword);
            updates.push('password_hash = ?');
            params.push(newHash);
        }

        if (updates.length === 0) {
            return res.json(success({ user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar } }, '资料未变更'));
        }

        params.push(userId);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        // 返回更新后的信息
        const updated = await db.queryOne(
            'SELECT id, username, nickname, avatar, created_at FROM users WHERE id = ?',
            [userId]
        );
        res.json(success({ user: updated }, '资料更新成功'));
    } catch (err) {
        handleServerError(res, err);
    }
});

module.exports = router;
