/*
 * ui.js —— 从 app.js 抽离的纯 DOM 占位 / 空态渲染（审计 id 18：app.js god-file 分解第二刀）。
 *
 * showSkeleton / showEmpty 只依赖 utils.js 已挂载到 window 的 escapeHtml，不依赖 app.js
 * 的任何局部变量，因此独立成经典脚本，在 index.html 里于 utils.js / core.js 之后、app.js
 * 之前加载。抽离后 app.js 直接复用全局定义，god-file 体积继续下降。
 *
 * ⚠️ 改动此文件后务必跑 `node --test test/app-dom.test.js`（jsdom 安全网已锁死
 *    showSkeleton / showEmpty 的行为）—— 任一回归此处必红。
 */
// 骨架屏：加载占位（list / grid / text 三种形态），只写 innerHTML，不碰业务状态
function showSkeleton(el, rows = 3, variant = 'list') {
    if (!el) return;
    let html = '';
    if (variant === 'list') {
        for (let i = 0; i < rows; i++) {
            html += `<div class="skeleton-row"><div class="skeleton-avatar shimmer"></div><div class="skeleton-lines"><div class="skeleton-line shimmer" style="width:45%"></div><div class="skeleton-line shimmer" style="width:70%"></div></div><div class="skeleton-amt shimmer"></div></div>`;
        }
    } else if (variant === 'grid') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-card shimmer"></div>`;
    } else if (variant === 'text') {
        for (let i = 0; i < rows; i++) html += `<div class="skeleton-line shimmer" style="width:${60 + (i % 3) * 12}%"></div>`;
    }
    el.innerHTML = `<div class="skeleton-wrap" data-skeleton="${variant}">${html}</div>`;
}

// 空状态：纯文字提示（图标已按 UI 规范移除，保留 icon 参数仅为兼容历史调用）。
// text 经 escapeHtml 转义，避免存储型 XSS（与 utils.escapeHtml 同源防护）。
function showEmpty(el, text, icon = '') {
    if (!el) return;
    el.innerHTML = `<div class="empty-state">${icon ? `<div class="empty-icon">${icon}</div>` : ''}<div class="empty-text">${escapeHtml(text)}</div></div>`;
}

// ==========================================
// 轻量提示 toast（审计 id 18：从 app.js 抽离）。
// 仅依赖 #toastContainer 与 setTimeout，无 app.js 局部状态；error 走 role=alert。
// ==========================================
function showToast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) { console.log(`[toast:${type}]`, msg); return; }
    // error 走 role=alert 让屏幕阅读器立刻播报；其他用 role=status 走 polite
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ==========================================
// 关于页「上次更新状态」渲染（审计 id18：从 app.js 抽离）。
// 仅依赖 #aboutUpdateLast 与 utils 的 tt，无 app.js 局部状态。
// ==========================================
function renderUpdateLast(d) {
    const el = document.getElementById('aboutUpdateLast');
    if (!el) return;
    if (!d) { el.hidden = true; return; }
    const fmtTs = s => {
        try { const dt = new Date(s); return Number.isNaN(dt.getTime()) ? (s || '') : dt.toLocaleString(); }
        catch (e) { return s || ''; }
    };
    const cur = d.current;
    const mismatch = !!(cur && cur.containerImage && cur.latestId && cur.isLatest === false);
    const items = [];

    // 1) 上次更新执行结果（exit code 由辅助容器真实回写）
    if (d.last) {
        const tsTxt = d.last.ts ? tt('update.lastAt', '（{time}）').replace('{time}', fmtTs(d.last.ts)) : '';
        const codeTxt = (d.last.exitCode != null)
            ? tt('update.exitCode', '退出码 {code}').replace('{code}', d.last.exitCode) : '';
        if (d.last.ok) {
            if (mismatch) {
                // 命令本身成功了，但容器并没有运行在 :latest —— 半成功，必须告警
                items.push({
                    kind: 'warn',
                    text: tt('update.okButNotLatest', '上次重建命令已执行，但容器未运行在最新镜像上{ts}').replace('{ts}', tsTxt),
                    log: d.last.logTail,
                });
            } else {
                items.push({ kind: 'ok', text: tt('update.lastOk', '上次更新成功') + tsTxt });
            }
        } else {
            items.push({
                kind: 'fail',
                text: tt('update.lastFail', '上次更新失败') + (codeTxt ? '（' + codeTxt + '）' : '') + tsTxt,
                log: d.last.logTail,
            });
        }
    }

    // 2) 无记录但当前运行镜像 ≠ :latest：更新从未真正生效（最典型的 pin 旧 tag 场景）
    if (!d.last && mismatch) {
        items.push({
            kind: 'warn',
            text: tt('update.notLatest', '当前运行镜像 {img} ≠ 最新 {latest}，自动更新未真正生效（compose 是否固定了旧 tag？）')
                .replace('{img}', cur.containerImage).replace('{latest}', cur.latestImage),
        });
    }
    // 失败记录 + 镜像确实没切换：追加一条原因提示
    if (d.last && d.last.ok === false && mismatch) {
        items.push({
            kind: 'warn',
            text: tt('update.notLatest', '当前运行镜像 {img} ≠ 最新 {latest}，自动更新未真正生效（compose 是否固定了旧 tag？）')
                .replace('{img}', cur.containerImage).replace('{latest}', cur.latestImage),
        });
    }

    // 3) /app/data 卷挂载诊断（2026-09-07 升级：替代旧版单一 "未挂载" 文案）
    //    新版 server 端返回 appData.{mounted,type,source,persistent}，按持久化状态分四档：
    //      type='none'      → 完全没挂 /app/data（最严重，重启丢所有持久数据，不只是更新记录）
    //      type='bind'/'volume' + !persistent → 类型字段异常，标记不持久化（兜底告警）
    //      type='bind'/'volume' +  persistent + !stateDirAvailable → 已挂但 /app/data/.update 子目录
    //                          还没被创建（首次更新前的正常态，不是问题）
    //      type='unknown'   → 拿不到 docker.sock（前端拿不到诊断，降级到原 "未挂载" 文案）
    if (d.appData && typeof d.appData === 'object') {
        const ad = d.appData;
        if (ad.type === 'none') {
            // 最严重的根因：连 ENCRYPTION_KEY 都不会持久化。每次重启 AI/OCR 凭证都解不开。
            // 必须挂上 /app/data 才会一切正常。
            items.push({
                kind: 'warn',
                text: tt('update.noStateNone', '容器内 /app/data 数据卷未挂载，加密密钥与更新记录均不持久化（重启后丢失）'),
            });
            items.push({ kind: 'fix', text: tt('update.mountFixTitle', '如何挂载 /app/data') });
        } else if (ad.persistent === false) {
            items.push({
                kind: 'warn',
                text: tt('update.noStateUnknown', '无法识别 /app/data 的挂载类型，请检查容器挂载配置'),
            });
            items.push({ kind: 'fix', text: tt('update.mountFixTitle', '如何挂载 /app/data') });
        }
        // type='bind'/'volume' + stateDirAvailable=false → 已挂，仅子目录未建（首次更新前的正常态），不告警
    } else if (d.stateDirAvailable === false) {
        // 旧镜像 / 容器内 docker 不可用时 appData 拿不到，降级到原文案
        items.push({ kind: 'warn', text: tt('update.noState', '服务器无法回写更新记录（未挂载 /app/data 数据卷），请手动确认镜像是否已更新') });
    }
    // 容器内 docker 不可用
    if (d.dockerAvailable === false) {
        items.push({ kind: 'warn', text: tt('update.noDocker', '容器内 docker 不可用，无法自动更新/校验镜像') });
    }

    if (!items.length) { el.hidden = true; return; }
    const ul = document.createElement('ul');
    items.forEach(it => {
        const li = document.createElement('li');
        const badge = document.createElement('span');
        badge.className = 'ul-badge ' + it.kind;
        badge.textContent = it.kind === 'ok' ? '✓'
            : it.kind === 'warn' ? '!'
                : it.kind === 'fix' ? '?'
                    : '✕';
        li.appendChild(badge);
        const txt = document.createElement('span');
        txt.textContent = it.text;
        li.appendChild(txt);
        // 'fix' 类：单独挂一段折叠的修复指引（docker compose / docker run 两套挂载示例），
        // 文案命令部分不在 i18n（命令固定，不分语言），描述性句子独立 i18n。
        if (it.kind === 'fix') {
            const det = document.createElement('details');
            const sum = document.createElement('summary');
            sum.textContent = tt('update.mountFixDetails', '查看修复示例');
            det.appendChild(sum);
            const guide = document.createElement('div');
            guide.className = 'ul-fix-guide';

            // 方式 1：docker compose（推荐 —— 沿用项目自带的 docker-compose.yml）
            const p1 = document.createElement('p');
            p1.textContent = tt('update.mountFixCompose', '方式 1：docker compose 部署（推荐）');
            guide.appendChild(p1);
            const pre1 = document.createElement('pre');
            pre1.textContent =
                '# docker-compose.yml → services.app.volumes 加一条挂载\n' +
                'volumes:\n' +
                '  - xinwallet-app-data:/app/data   # 命名卷（推荐，docker 自动管理）\n' +
                '  # 或者 bind-mount 到当前目录下的 data 子目录：\n' +
                '  # - ./data:/app/data\n' +
                '\n' +
                '# volumes 段保留命名卷定义：\n' +
                'volumes:\n' +
                '  xinwallet-app-data:';
            guide.appendChild(pre1);
            const p1Note = document.createElement('p');
            p1Note.textContent = tt('update.mountFixComposeNote', '改完保存后执行 docker compose up -d 即可生效；旧容器若已有密钥文件可一并迁移到新卷。');
            guide.appendChild(p1Note);

            // 方式 2：手动 docker run
            const p2 = document.createElement('p');
            p2.textContent = tt('update.mountFixRun', '方式 2：手动 docker run 部署');
            guide.appendChild(p2);
            const pre2 = document.createElement('pre');
            pre2.textContent =
                '# Linux / macOS 宿主机：\n' +
                'docker run -d --name xinwallet-app \\\n' +
                '  -v /var/lib/xinwallet/data:/app-data \\\n' +
                '  ...\n' +
                '\n' +
                '# Windows 宿主机（PowerShell，反斜杠需转义）：\n' +
                'docker run -d --name xinwallet-app ^\n' +
                '  -v "D:\\Docker\\XINWallet\\data:/app/data" ^\n' +
                '  ...';
            guide.appendChild(pre2);
            const p2Note = document.createElement('p');
            p2Note.textContent = tt('update.mountFixRunNote', '挂载的本机路径需提前创建（mkdir / mkdir New-Item）；Docker Desktop 默认会把 D:\\... 自动映射进 WSL2 内的 /mnt/host/...，无需额外配置。');
            guide.appendChild(p2Note);

            // 方式 3：临时绕过（不挂载 /app/data 时也能让 ENCRYPTION_KEY 持久化）
            const p3 = document.createElement('p');
            p3.textContent = tt('update.mountFixEnv', '方式 3：临时方案 —— 显式注入 ENCRYPTION_KEY');
            guide.appendChild(p3);
            const pre3 = document.createElement('pre');
            pre3.textContent =
                '# 在 docker run / docker-compose.yml 里加一个固定的 64 位 hex 密钥，\n' +
                '# 不挂载 /app/data 也能让 AI/OCR 凭证稳定解密（但更新记录仍无法落盘）：\n' +
                '-e ENCRYPTION_KEY=$(openssl rand -hex 32)';
            guide.appendChild(pre3);

            det.appendChild(guide);
            li.appendChild(det);
        } else if (it.log) {
            const det = document.createElement('details');
            const sum = document.createElement('summary');
            sum.textContent = tt('update.viewLog', '查看日志');
            det.appendChild(sum);
            const pre = document.createElement('pre');
            pre.textContent = it.log;
            det.appendChild(pre);
            li.appendChild(det);
        }
        ul.appendChild(li);
    });
    el.innerHTML = '';
    el.appendChild(ul);
    el.hidden = false;
}
