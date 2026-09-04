/* ============================================
   鑫钱包 · 应用一键更新（Web 端检测 / 应用 Docker 镜像更新）
   依赖：宿主 /var/run/docker.sock 挂载进容器 + 容器内已装 docker CLI
   安全：本路由受 routes.js 全局 authMiddleware 保护（仅登录用户可调）
   ============================================ */

const express = require('express');
const { execFile } = require('child_process');
const router = express.Router();

// 镜像与容器名：优先读 compose 注入的环境变量，缺省与 docker-compose.yml 保持一致
const UPDATE_IMAGE = process.env.UPDATE_IMAGE || 'ghcr.io/zjx93/xin-wallet/xinwallet:latest';
const UPDATE_CONTAINER = process.env.UPDATE_CONTAINER || 'xinwallet-app';
const GITHUB_REPO = process.env.UPDATE_GITHUB_REPO || 'ZJX93/XinWallet';
// 当前运行版本：CI 构建镜像时通过 APP_VERSION 注入（Dockerfile ARG VERSION -> ENV APP_VERSION）
const CURRENT_VERSION = process.env.APP_VERSION || process.env.npm_package_version || 'dev';

// docker CLI 是否可用（容器内是否已安装且能访问 docker.sock）
function dockerAvailable() {
    return new Promise((resolve) => {
        execFile('docker', ['--version'], (err) => resolve(!err));
    });
}

// 查询 GitHub 最新 release tag（与 APP_VERSION 同为 v*.*.* 形态）
async function fetchLatestVersion() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: { 'User-Agent': 'XinWallet' },
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) throw new Error('github ' + r.status);
        const j = await r.json();
        return typeof j.tag_name === 'string' ? j.tag_name : null;
    } catch (e) {
        return null;
    }
}

// GET /api/update/check —— 检测是否有新版本（不执行任何 docker 操作）
router.get('/check', async (req, res) => {
    const latest = await fetchLatestVersion();
    const hasUpdate = !!(latest && latest !== CURRENT_VERSION);
    res.json({
        success: true,
        data: {
            currentVersion: CURRENT_VERSION,
            latestVersion: latest,
            hasUpdate,
            dockerAvailable: await dockerAvailable(),
            image: UPDATE_IMAGE,
            checkedAt: new Date().toISOString(),
        },
    });
});

// POST /api/update/apply —— 拉取最新镜像并重启当前容器（自更新）
// 立即返回「已开始」，后台异步执行 docker pull + docker restart；
// 容器重启会中断本进程，故不能在请求内等待完成。
router.post('/apply', (req, res) => {
    res.json({
        success: true,
        message: '已开始更新，服务即将重启，请稍后刷新页面',
        data: { image: UPDATE_IMAGE },
    });

    // 后台异步：先拉取最新镜像，再重启自身容器（compose 因 :latest tag 漂移而载入新层）
    execFile('docker', ['pull', UPDATE_IMAGE], (pullErr) => {
        if (pullErr) {
            console.error('[update] docker pull failed:', pullErr.message);
            return;
        }
        execFile('docker', ['restart', UPDATE_CONTAINER], (restartErr) => {
            if (restartErr) console.error('[update] docker restart failed:', restartErr.message);
            // 重启成功则当前进程被终止；失败则仅记录，不影响已返回的响应。
        });
    });
});

module.exports = router;
