# 鑫钱包 · 版本发布与镜像构建

## 🎯 版本号统一规则（重要）

**整个仓库只有一套版本号：`vX.Y.Z`（其中 X.Y 永久锁定为 `0.1`，每次发布仅递增 Z，即 `v0.1.Z`），与安卓客户端完全一致。**

- Web/后端 Docker 镜像、安卓 APK、GitHub Release 全部使用同一个 `vX.Y.Z` 标签。
- 因此 `docker pull` 下来的镜像版本，永远等于你在安卓 App「我的 → 应用更新」里看到的版本。
- 历史 `v0.14.x` 与 `android-v*` 旧版本线均已停用：旧的独立 Web `v*` 版本线、旧的 `android-v*` 统一版本线都不再产生新标签；自 `v0.1.0` 起启用全新的 `v0.1.Z` 单版本线（X.Y 锁定 0.1）。

## 📦 自动构建机制（全自动，无需手动打 tag）

由 `.github/workflows/auto-tag.yml` 统一编排，流程如下：

1. `PR Test Gate` 在 `main` 分支 push 成功后触发 `auto-tag.yml`；
2. `auto-tag.yml` 按 Conventional Commits 规范推导下一个 `vX.Y.Z`（自 `v0.0.0` 起，每轮发布仅 Z+1），创建并推送该 tag；
3. 同一 tag 同时派发两个下游构建：
   - **`release-image.yml`** → 构建多架构镜像（amd64 + arm64）推送到 GHCR，镜像 tag 为 `:vX.Y.Z` 外加 `:latest`；
   - **`android-build.yml`** → 真编译安卓 APK 并创建 GitHub Release（含 `.apk` 资产，供应用内升级下载）。

> 版本推导规则：X.Y 永久锁定为 `0.1`，每轮发布仅 `Z+1`（即 `v0.1.Z`）；仅当自上次标签以来【全部】提交都是 `docs/chore/ci/test` 或 Merge/Revert 时才跳过发布，其余提交（含中文标题）均触发 `Z+1`；`BREAKING CHANGE` 同样只触发 Z+1（不再跳 major/minor）。

## 📥 拉取镜像

```bash
# 最新稳定版（始终等于最新安卓客户端版本）
docker pull ghcr.io/zjx93/xin-wallet/xinwallet:latest

# 指定版本（与安卓 APK 版本号完全一致）
docker pull ghcr.io/zjx93/xin-wallet/xinwallet:v0.1.69
```

## 🔧 配置 GitHub Packages 权限（首次）

1. 进入 https://github.com/ZJX93/XinWallet/settings/actions
2. "Workflow permissions" 选择 **Read and write permissions**
3. 勾选 "Allow GitHub Actions to create and approve pull requests"
4. 保存

否则 workflow 推送镜像到 GHCR 会因权限不足失败。

## 📊 查看构建进度

- 镜像构建：https://github.com/ZJX93/XinWallet/actions/workflows/release-image.yml
- 安卓构建：https://github.com/ZJX93/XinWallet/actions/workflows/android-build.yml
- 版本编排：https://github.com/ZJX93/XinWallet/actions/workflows/auto-tag.yml

## 🔄 本地测试构建

`docker-compose.yml` 中引用远程镜像时使用 `ghcr.io/zjx93/xin-wallet/xinwallet:latest`（即最新安卓对齐版本）：

```yaml
image: ghcr.io/zjx93/xin-wallet/xinwallet:latest
```

如需固定到某个具体版本，把 `latest` 换成对应的 `vX.Y.Z`（即 `v0.0.Z`）即可，例如：

```yaml
image: ghcr.io/zjx93/xin-wallet/xinwallet:v0.0.1
```

如果使用本地源码构建，将 `image:` 行改为：

```yaml
build:
  context: .
  dockerfile: Dockerfile
```
