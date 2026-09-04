# ============================================
# 鑫钱包 · 多阶段 Docker 构建
# 运行阶段仅含生产依赖，并以非 root 用户运行
# 依赖以 server/package.json + server/package-lock.json（项目真实清单）为准，构建可复现
# 由 .github/workflows/release-image.yml 自动触发（推送 v*.*.* tag）
# ============================================

# ---- 阶段 1：安装生产依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
# 使用 npmmirror 镜像源加速，npm ci 在某些环境下有 bug
RUN npm config set registry https://registry.npmmirror.com && npm ci --omit=dev

# ---- 阶段 2：精简运行镜像 ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# 使用非 root 用户运行，提升容器安全性
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
# 前端静态资源统一收在 public/ 下，server 以 express.static(public/) 提供
COPY public ./public

# 容器自带健康检查：等待 /healthz 返回 200
COPY <<'EOF' /app/docker-healthcheck.js
const http = require('http');
const req = http.request({ host: '127.0.0.1', port: process.env.PORT || 18888, path: '/healthz', timeout: 2000 }, r => process.exit(r.statusCode === 200 ? 0 : 1));
req.on('error', () => process.exit(1));
req.on('timeout', () => process.exit(1));
req.end();
EOF

# 数据卷挂载点：存放加密密钥文件（/app/data/.encryption-key）
# 持久化到 docker volume，跨容器重启保持稳定
# 必须在降权前用 root 创建，避免 chown 失败
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

# 安装 docker CLI：Web 端「一键更新镜像」需容器内执行 docker pull / docker restart。
# 配合 docker-compose.yml 挂载的宿主 /var/run/docker.sock 使用。
# 因已挂载 docker.sock（等同宿主 root 权限），本容器以 root 运行，不再降权到 appuser，
# 否则非 root 用户无法访问属主为 root 的 docker.sock。
RUN apk add --no-cache docker-cli

# USER appuser   # 已禁用：与 docker.sock 自动更新方案互斥（sock 属主为 root）

# 生产环境强烈建议显式注入 ENCRYPTION_KEY（用于 AI 凭证等敏感字段加密）
# 不注入时，crypto.js 启动时会从 /app/data/.encryption-key 读取或自动生成
# 使用：docker run -e ENCRYPTION_KEY=$(openssl rand -hex 32) ...
ENV ENCRYPTION_KEY=

EXPOSE 18888
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node /app/docker-healthcheck.js

# OCI 镜像元数据（docker/build-push-action 会用 metadata-action 再次写入更完整的 labels）
ARG VERSION=dev
ENV APP_VERSION=$VERSION
LABEL org.opencontainers.image.title="XIN Wallet" \
      org.opencontainers.image.description="鑫钱包 - 个人财务助手 (Node.js + Express + PostgreSQL)" \
      org.opencontainers.image.source="https://github.com/ZJX93/XinWallet" \
      org.opencontainers.image.vendor="ZJX93" \
      org.opencontainers.image.licenses="MIT"

CMD ["node", "server/index.js"]
