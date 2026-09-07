/* ============================================
   鑫钱包 · 应用一键更新（Web 端检测 / 应用 Docker 镜像更新）
   依赖：宿主 /var/run/docker.sock 挂载进容器 + 容器内已装 docker CLI
   安全：本路由受 routes.js 全局 authMiddleware 保护（仅登录用户可调）

   2026-09-07 加固「点了更新却静默失败」问题（原实现 update.js）：
   - 原辅助容器用 `docker run -d --rm` 异步跑 compose up，应用容器拿不到容器
     内命令的 exit code / 输出，一旦 compose 文件把 image pin 到旧 tag、或 up
     失败，服务端日志只会显示「辅助容器已启动」——假成功。
   - 现在辅助容器把 exit code + 日志回写到 /app/data/.update（与主容器同一
     持久卷，通过 docker inspect 宿主卷 Source 挂进辅助容器），主容器据此
     新增 GET /status：返回上次更新结果，并实时对比「容器实际运行镜像 vs
     UPDATE_IMAGE(:latest) 解析出的镜像 ID」，Web 端据此红字告警。
   ============================================ */

const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const router = express.Router();

// 镜像与容器名：优先读 compose 注入的环境变量，缺省与 docker-compose.yml 保持一致
const UPDATE_IMAGE = process.env.UPDATE_IMAGE || 'ghcr.io/zjx93/xin-wallet/xinwallet:latest';
const UPDATE_CONTAINER = process.env.UPDATE_CONTAINER || 'xinwallet-app';
const GITHUB_REPO = process.env.UPDATE_GITHUB_REPO || 'ZJX93/XinWallet';
// 当前运行版本：CI 构建镜像时通过 APP_VERSION 注入（Dockerfile ARG VERSION -> ENV APP_VERSION）
const CURRENT_VERSION = process.env.APP_VERSION || process.env.npm_package_version || 'dev';

// 更新状态回写目录：应用容器内固定路径（docker-compose.yml 将 xinwallet-app-data 卷挂到 /app/data）。
// 辅助容器经 docker inspect 拿到该卷的宿主 Source 并挂到 /update-state，
// 把 exit_code / ts / last.log 写进同一卷；重建后的新容器（同一卷）即可读到。
const STATE_DIR = '/app/data/.update';

// 辅助容器镜像：官方 docker CLI 镜像（自带 sh，仅需 docker.sock + 卷即可工作）
const DOCKER_IMG = 'docker:cli';

// 端点点位限流（在路由内细分，避免 GET /status 被 about 页轮询挤占 apply 配额）：
//   POST /apply：会真正重建容器，最严（5 次 / 10 分钟）
//   GET  /check：打 GitHub API（10 次 / 10 分钟）
//   GET  /status：只读本地状态 + inspect，最松（60 次 / 10 分钟）
function makeLimiter(max) {
    return rateLimit({
        windowMs: 10 * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: '更新操作过于频繁，请稍后再试' },
    });
}
const applyLimiter = makeLimiter(5);
const checkLimiter = makeLimiter(10);
const statusLimiter = makeLimiter(60);

// docker CLI 是否可用（容器内是否已安装且能访问 docker.sock）
function dockerAvailable() {
    return new Promise((resolve) => {
        execFile('docker', ['--version'], (err) => resolve(!err));
    });
}

// 统一 docker 调用（Promise 化），超时默认 30s
function dockerExec(args, timeoutMs) {
    return new Promise((resolve) => {
        execFile('docker', args, { timeout: timeoutMs || 30000 }, (err, stdout, stderr) => {
            resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

// ---- 更新状态读写（/app/data/.update/*，与应用同卷，重建后可读）----

function readStateFile(name) {
    try {
        return fs.readFileSync(path.join(STATE_DIR, name), 'utf8').trim();
    } catch (e) {
        return null;
    }
}

// 供 pull 失败等「主容器自己就能判断」的错误直接落盘（新容器起来后仍能看到）
function writeStateNow(code, logText) {
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(path.join(STATE_DIR, 'exit_code'), String(code));
        fs.writeFileSync(path.join(STATE_DIR, 'ts'), new Date().toISOString());
        fs.writeFileSync(path.join(STATE_DIR, 'last.log'), String(logText).slice(-200000));
    } catch (e) {
        console.warn('[update] 写入更新状态失败:', e.message);
    }
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

// 采集当前容器 compose 编排信息 + /app/data 卷宿主 Source。
// 一次 inspect 拿 Labels JSON，一次拿 Mounts JSON（绕开 Go template index 兼容 bug）。
// Mounts.Type ∈ {'bind','volume'}：前/后端均表示持久卷，挂错位置/缺失时为 'none'/'unknown'，
// 用此在 /status 返回 appData 诊断，前端可按持久化状态给出不同的修复指引，
// 不再像旧版仅看 /app/data/.update 子目录是否存在（首次更新前误报"未挂载"）。
async function collectContainerInfo() {
    const info = { project: null, service: null, workDir: null, appDataSource: null, appDataType: 'unknown' };
    const labelR = await dockerExec(['inspect', UPDATE_CONTAINER, '--format', '{{json .Config.Labels}}']);
    if (!labelR.err && labelR.stdout.trim()) {
        try {
            const labels = JSON.parse(labelR.stdout.trim());
            info.project = labels['com.docker.compose.project'] || null;
            info.service = labels['com.docker.compose.service'] || null;
            info.workDir = labels['com.docker.compose.project.working_dir'] || null;
        } catch (e) {
            console.error('[update] 解析 compose labels JSON 失败:', e.message);
        }
    }
    const mountR = await dockerExec(['inspect', UPDATE_CONTAINER, '--format', '{{json .Mounts}}']);
    if (!mountR.err && mountR.stdout.trim()) {
        try {
            const mounts = JSON.parse(mountR.stdout.trim());
            const m = (Array.isArray(mounts) ? mounts : []).find(x => x.Destination === '/app/data');
            if (m) {
                info.appDataSource = m.Source || null;
                // Type ∈ {'bind','volume'}：均为持久卷（前者 bind-mount，后者命名卷）
                info.appDataType = (m.Type === 'bind' || m.Type === 'volume') ? m.Type : 'unknown';
            } else {
                info.appDataSource = null;
                info.appDataType = 'none';
            }
        } catch (e) {
            console.error('[update] 解析容器挂载 JSON 失败:', e.message);
        }
    }
    return info;
}

// GET /api/update/check —— 检测是否有新版本（不执行任何 docker 操作）
router.get('/check', checkLimiter, async (req, res) => {
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

// GET /api/update/status —— 上次更新结果 + 当前容器是否真的运行在 :latest 上
// （2026-09-07 新增：解决「辅助容器启动成功 ≠ 更新成功」的假象。
//   若 compose 把 image 固定到旧 tag、或 up 中途失败，这里都能如实地暴露出来。
//   2026-09-07 又增：返回 /app/data 卷的挂载诊断（type / source），
//   让前端能区分「完全没挂」、「挂错位置」、「挂的是容器临时层」三种根因，
//   并把 ENCRYPTION_KEY 不能持久化的更严重后果也带上。）
router.get('/status', statusLimiter, async (req, res) => {
    const exitCodeRaw = readStateFile('exit_code');
    const ts = readStateFile('ts');
    let logTail = readStateFile('last.log');
    if (logTail && logTail.length > 8000) logTail = logTail.slice(-8000); // 只回传尾部，控制响应体积
    const hasStateDir = (() => { try { return fs.existsSync(STATE_DIR); } catch (e) { return false; } })();

    const last = exitCodeRaw === null ? null : {
        ok: exitCodeRaw === '0',
        exitCode: (() => { const n = parseInt(exitCodeRaw, 10); return Number.isFinite(n) ? n : null; })(),
        ts,
        logTail,
    };

    // 容器级诊断：/app/data 是否真挂上、挂的类型（决定能否跨容器重建持久化）。
    // collectContainerInfo 内部用 docker inspect，需 docker.sock 可见：
    // - 没 socket 时 appDataType 维持 'unknown'、appDataSource=null，前端文案降级到旧版。
    // - 'none' = 完全没挂 Destination==='/app/data' 的 mount（最严重，加密密钥也会丢）。
    // - 'bind' / 'volume' = 真持久卷，仅 .update 子目录尚未被创建（首次更新前的正常态）。
    let appDataDiag = { mounted: false, type: 'unknown', source: null, persistent: false };
    try {
        const info = await collectContainerInfo();
        appDataDiag = {
            mounted: !!info.appDataSource,
            type: info.appDataType,
            source: info.appDataSource,
            // 'bind' / 'volume' 跨容器重建后仍可读（外置 / 命名卷）；'none' / 'unknown' 视为不持久化
            persistent: info.appDataType === 'bind' || info.appDataType === 'volume',
        };
    } catch (e) {
        console.warn('[update] collectContainerInfo 失败:', e.message);
    }

    // 实时校验运行镜像（只有 pull + recreate 真正完成、且 compose 未被 pin 旧 tag，
    // runningId 才会等于本地 :latest 解析出的镜像 ID）
    let current = null;
    const dockerOk = await dockerAvailable();
    if (dockerOk) {
        const ins = await dockerExec(['inspect', '-f', '{{.Config.Image}}|{{.Image}}', UPDATE_CONTAINER]);
        if (!ins.err) {
            const [containerImage, runningId] = String(ins.stdout).trim().split('|');
            const latestR = await dockerExec(['image', 'inspect', '-f', '{{.Id}}', UPDATE_IMAGE]);
            const latestId = latestR.err ? null : String(latestR.stdout).trim();
            current = {
                containerImage: (containerImage || '').trim() || null,   // compose 配置里写的 tag（可能被 pin 成旧 tag）
                runningId: (runningId || '').trim() || null,              // 当前实际运行镜像 ID
                latestImage: UPDATE_IMAGE,
                latestId,
                isLatest: !!((runningId && runningId.trim()) && latestId && String(runningId).trim() === latestId),
            };
        }
    }

    res.json({
        success: true,
        data: {
            updateImage: UPDATE_IMAGE,
            dockerAvailable: dockerOk,
            // 旧字段保留：stateDirAvailable 直接反映 /app/data/.update 子目录是否存在
            stateDirAvailable: hasStateDir,
            // 新字段：详细的挂载诊断，前端优先用此给出差异化文案与修复指引
            appData: appDataDiag,
            last,
            current,
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
router.post('/apply', applyLimiter, (req, res) => {
    res.json({
        success: true,
        message: '已开始更新，服务即将重启，请稍后刷新页面',
        data: { image: UPDATE_IMAGE },
    });
    void runApply();
});

async function runApply() {
    // 先拉最新镜像（失败则不动现有容器，避免把可用服务弄挂），失败也落盘状态供 UI 如实展示
    const pull = await dockerExec(['pull', UPDATE_IMAGE], 10 * 60 * 1000);
    if (pull.err) {
        const reason = (pull.stderr || '').trim() || pull.err.message;
        console.error('[update] docker pull 失败，已保留当前版本:', reason);
        writeStateNow(1, `docker pull ${UPDATE_IMAGE} 失败：${reason}`);
        return;
    }
    console.log('[update] 镜像拉取完成，开始重建容器:', UPDATE_IMAGE);

    // 重建前记录当前运行的镜像 ID，更新成功后精准删除被替换掉的旧镜像，
    // 避免旧 :latest 变 dangling 长期占用 NAS 磁盘。
    const ins = await dockerExec(['inspect', '-f', '{{.Image}}', UPDATE_CONTAINER]);
    const oldImageId = (!ins.err && ins.stdout) ? String(ins.stdout).trim() : '';
    await recreateSelf(oldImageId);
}

/**
 * 用临时辅助容器重建自身，并把执行结果（exit code + 日志）回写到数据卷，
 * 供新容器启动后的 GET /status 读取 —— 根治「已启动 = 成功」的假象。
 * 优先走 compose（能完整还原端口/卷/网络/环境变量等编排配置）；
 * 容器缺少 compose 标签（如手工 docker run 启动）时退回 docker CLI 重建。
 */
async function recreateSelf(oldImageId) {
    const info = await collectContainerInfo();
    const args = ['run', '-d', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock'];
    let coreCmd;
    let mode;

    if (info.project && info.service && info.workDir) {
        // compose 路径：能完整还原端口/卷/网络/环境变量等编排配置。
        // 宿主项目目录挂到辅助容器内的固定路径 /compose-dir 并设为工作目录 ——
        // 不用「宿主路径:同名路径」，因为 Windows 宿主路径（D:\...）不是合法的
        // 容器内路径，同名挂载会直接失败。
        args.push('-v', `${info.workDir}:/compose-dir`, '-w', '/compose-dir');
        // --no-deps 只重建 app 不牵动数据库；--force-recreate 确保载入新镜像层。
        coreCmd = `docker compose -p ${info.project} up -d --no-deps --force-recreate ${info.service}`;
        mode = 'compose rebuild';
    } else {
        // 兜底：无 compose 标签（手工 docker run 启动）时无法还原编排配置，
        // 只能重启容器——此路径下镜像不会更新，需用户手动重建；状态里如实标注。
        console.warn('[update] 未取到 compose 标签，退化为重启容器（镜像不会更新）');
        coreCmd = `docker restart ${UPDATE_CONTAINER}`;
        mode = 'restart (no compose labels; image NOT switched)';
    }

    // 把 /app/data 卷的宿主 Source 挂给辅助容器，用于回写更新状态
    if (info.appDataSource) {
        args.push('-v', `${info.appDataSource}:/update-state`);
    }

    // sleep 2：等本容器把 HTTP 响应发送完，避免前端拿不到「已开始更新」。
    // 输出重定向到 /tmp/xw-update.log，随后连同 exit code 一起落盘到共享卷。
    // 重建后清理被替换掉的旧镜像：先精准 rmi（层被共享则忽略），再 prune 兜底
    // 清掉所有无容器引用的悬空镜像（不波及当前运行镜像，安全）。
    const writeState = info.appDataSource ? [
        'mkdir -p /update-state/.update 2>/dev/null || true',
        'echo "$code" > /update-state/.update/exit_code 2>/dev/null || true',
        'date -u +%Y-%m-%dT%H:%M:%SZ > /update-state/.update/ts 2>/dev/null || true',
        'cp /tmp/xw-update.log /update-state/.update/last.log 2>/dev/null || true',
        `docker inspect --format '{{.Config.Image}}' ${UPDATE_CONTAINER} > /update-state/.update/container_image 2>/dev/null || true`,
        `docker inspect --format '{{.Image}}' ${UPDATE_CONTAINER} > /update-state/.update/container_id 2>/dev/null || true`,
    ].join('\n') : [
        'echo "state-write-disabled: /app/data 卷不可见，无法回写更新结果" >> /tmp/xw-update.log',
    ].join('\n');
    const cleanCmd = [
        `docker rmi ${oldImageId} >/dev/null 2>&1 || true`,
        'docker image prune -f >/dev/null 2>&1 || true',
    ].join('\n');

    const script = [
        'sleep 2',
        `( echo "== ${mode} @ $(date -u +%Y-%m-%dT%H:%M:%SZ) =="; ${coreCmd}; ) > /tmp/xw-update.log 2>&1`,
        'code=$?',
        writeState,
        cleanCmd,
        'exit $code',
    ].join('\n');

    args.push(DOCKER_IMG, 'sh', '-c', script);

    // 辅助容器镜像首次使用可能需现场拉取，给足超时（拉取中断则后续不会重建）
    const run = await dockerExec(args, 10 * 60 * 1000);
    if (run.err) {
        console.error('[update] 启动重建辅助容器失败:', run.err.message);
        // 辅助容器都没起来：直接在本地落盘，让 UI 能显示失败原因
        writeStateNow(1, `启动重建辅助容器失败：${run.err.message}`);
        return;
    }
    console.log('[update] 重建辅助容器已启动:', String(run.stdout || '').trim().slice(0, 12));
    // 本进程随后会被辅助容器替换掉；重建结果由辅助容器回写状态目录，
    // 新容器启动后 GET /status 即可读到。无需在这里等待。
}

module.exports = router;
