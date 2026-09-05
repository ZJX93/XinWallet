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
// 返回 { tag, error }：区分「查到了」与「查不到（网络/限流/仓库无 release）」，
// 否则失败被当成 null，前端会误报成「已是最新」，把故障藏起来。
async function fetchLatestVersion() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: { 'User-Agent': 'XinWallet' },
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
            const hint = r.status === 403 ? 'GitHub API 限流（403）'
                : r.status === 404 ? '仓库暂无 Release（404）'
                    : 'GitHub 返回 ' + r.status;
            return { tag: null, error: hint };
        }
        const j = await r.json();
        if (typeof j.tag_name !== 'string' || !j.tag_name) {
            return { tag: null, error: 'GitHub 未返回版本号' };
        }
        return { tag: j.tag_name, error: null };
    } catch (e) {
        const reason = e && e.name === 'AbortError' ? '连接 GitHub 超时（8s）' : '无法连接 GitHub';
        return { tag: null, error: reason };
    }
}

// GET /api/update/check —— 检测是否有新版本（不执行任何 docker 操作）
router.get('/check', async (req, res) => {
    const { tag: latest, error } = await fetchLatestVersion();
    // 本地自建镜像 APP_VERSION 为 dev（未注入 VERSION build-arg），
    // 与任何 release tag 都不相等，不能据此判定「有新版本」。
    const isDev = CURRENT_VERSION === 'dev';
    const hasUpdate = !!(latest && !isDev && latest !== CURRENT_VERSION);
    res.json({
        success: true,
        data: {
            currentVersion: CURRENT_VERSION,
            latestVersion: latest,
            hasUpdate,
            isDevBuild: isDev,
            dockerAvailable: await dockerAvailable(),
            image: UPDATE_IMAGE,
            error,                 // 非空表示本次未能取到最新版本，前端需如实提示
            checkedAt: new Date().toISOString(),
        },
    });
});

// POST /api/update/apply —— 拉取最新镜像并以新镜像重建当前容器（自更新）
//
// ⚠️ 为什么不能用 docker restart：restart 只是重启现有容器实例，而容器的镜像在
//    创建时就已固定，重启后仍跑旧镜像 —— 表现为「点了更新、容器确实重启了，
//    但版本没变」。必须 recreate（删除旧容器 + 用新镜像创建）才能真正升级。
//
// ⚠️ 容器无法重建自己（删除自身时进程立即被杀，后续命令不会执行），因此把
//    「down + up」交给一个挂载了 docker.sock 的临时辅助容器执行，本进程只负责
//    把它拉起来就退出。辅助容器用 --rm 自清理。
//
// 立即返回「已开始」，后台异步执行，不在请求内等待完成。
router.post('/apply', (req, res) => {
    res.json({
        success: true,
        message: '已开始更新，服务即将重启，请稍后刷新页面',
        data: { image: UPDATE_IMAGE },
    });

    // 后台异步：先拉最新镜像（失败则不动现有容器，避免把可用服务弄挂）
    execFile('docker', ['pull', UPDATE_IMAGE], { timeout: 10 * 60 * 1000 }, (pullErr) => {
        if (pullErr) {
            console.error('[update] docker pull 失败，已保留当前版本:', pullErr.message);
            return;
        }
        console.log('[update] 镜像拉取完成，开始重建容器:', UPDATE_IMAGE);
        // 重建前记录当前运行的镜像 ID，更新成功后精准删除被替换掉的旧镜像，
        // 避免旧 :latest 变 dangling 长期占用 NAS 磁盘。
        execFile('docker', ['inspect', '-f', '{{.Image}}', UPDATE_CONTAINER], (insErr, insOut) => {
            const oldImageId = (!insErr && insOut) ? String(insOut).trim() : '';
            recreateSelf(oldImageId);
        });
    });
});

/**
 * 用临时辅助容器重建自身。
 * 优先走 compose（能完整还原端口/卷/网络/环境变量等编排配置）；
 * 容器缺少 compose 标签（如手工 docker run 启动）时退回 docker CLI 重建。
 */
function recreateSelf(oldImageId) {
    // compose 项目名/服务名/项目目录一律从自身容器标签读取，不硬编码：
    // 用户可能用 -p 自定义项目名，或把仓库放在任意路径。
    // docker --format 的 Go template `index` 函数对带点的 key
    // （如 "com.docker.compose.project"）在部分 docker CLI 版本上解析报错
    // （function "com" not defined），导致 inspect 失败、走 docker restart 兜底分支
    // ——容器只是被重启、镜像不变，表现为「点了立即更新、版本没变」。
    // 改用 {{json .Config.Labels}} 输出 JSON map，绕开该 bug。
    execFile('docker', [
        'inspect', UPDATE_CONTAINER, '--format', '{{json .Config.Labels}}'
    ], (inspectErr, stdout) => {
        let project, service, workDir;
        if (!inspectErr && stdout) {
            try {
                const labels = JSON.parse(String(stdout).trim());
                project = labels['com.docker.compose.project'];
                service = labels['com.docker.compose.service'];
                workDir = labels['com.docker.compose.project.working_dir'];
            } catch (e) {
                console.error('[update] 解析 compose labels JSON 失败:', e.message);
            }
        }

        // 更新完成后清理被替换掉的旧镜像：
        //  1) 精准 rmi 本次被替换的旧镜像 ID（层可能被新镜像共享，删不掉则忽略）；
        //  2) 再统一 image prune -f 清掉所有「无任何容器引用」的悬空镜像。
        //     pull 新版本后旧 :latest 变成 dangling，compose --force-recreate 删除旧容器后
        //     该旧镜像即无人引用，必须靠 prune 兜底清掉——否则单靠 rmi 在「新旧镜像共享层」
        //     时会失败（层被新镜像占用），旧镜像就残留在磁盘上长期占用 NAS 空间。
        //     prune 只删无引用的悬空镜像，绝不波及当前镜像，安全。
        // 两种路径都追加该清理：compose 路径真正换镜像后会清掉旧镜像；
        // 兜底 restart 路径虽不换镜像，但 prune 只清无引用悬空镜像，无害。
        const cleanCmd = `docker rmi ${oldImageId} >/dev/null 2>&1 || true; docker image prune -f >/dev/null 2>&1 || true`;

        const args = ['run', '-d', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock'];
        let script;

        if (!inspectErr && project && service && workDir) {
            // compose 路径：能完整还原端口/卷/网络/环境变量等编排配置。
            // 宿主项目目录挂到辅助容器内的固定路径 /compose-dir 并设为工作目录 ——
            // 不用「宿主路径:同名路径」，因为 Windows 宿主路径（D:\...）不是合法的
            // 容器内路径，同名挂载会直接失败。
            args.push('-v', `${workDir}:/compose-dir`, '-w', '/compose-dir');
            // sleep 2：等本容器把 HTTP 响应发送完，避免前端拿不到「已开始更新」。
            // --no-deps 只重建 app 不牵动数据库；--force-recreate 确保载入新镜像层。
            // 重建后立即清理被替换掉的旧镜像，避免 dangling 镜像长期占用 NAS 磁盘。
            script = `sleep 2 && docker compose -p ${project} up -d --no-deps --force-recreate ${service} && ${cleanCmd}`;
        } else {
            // 兜底：无 compose 标签（手工 docker run 启动）时无法还原编排配置，
            // 只能重启容器——此路径下镜像不会更新，需用户手动重建；
            // 仍追加 image prune 清理其它无引用的悬空镜像（不影响当前正在运行的镜像）。
            console.warn('[update] 未取到 compose 标签，退化为重启容器（镜像不会更新）');
            script = `sleep 2 && docker restart ${UPDATE_CONTAINER} && ${cleanCmd}`;
        }

        args.push('docker:cli', 'sh', '-c', script);

        execFile('docker', args, (runErr, out) => {
            if (runErr) {
                console.error('[update] 启动重建辅助容器失败:', runErr.message);
                return;
            }
            console.log('[update] 重建辅助容器已启动:', String(out || '').trim().slice(0, 12));
            // 本进程随后会被辅助容器替换掉，无需再做任何事。
        });
    });
}

module.exports = router;
