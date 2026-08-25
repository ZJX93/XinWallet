# CI 排障手册（GitHub Actions）

> 本机**没有安装 `gh` CLI**，以下流程全部走 REST API。
> 首次编写：2026-08-25（排查 `36d3634` 的 Android Build / Auto Tag 两处失败）

## 一、workflow 清单与触发方式

| workflow | 触发 | 是否编译移动端 |
|---|---|---|
| `pr-test.yml`（PR Test Gate） | `push` | ❌ **不含任何 gradlew / hvigor** |
| `security-scan.yml` | `push` | ❌ |
| `harmony-build.yml` | `push` + `workflow_dispatch` | ✅ HAP |
| `android-build.yml` | `workflow_dispatch` **only** | ✅ APK |
| `release-image.yml` | `workflow_dispatch` | ❌（Docker 镜像） |
| `auto-tag.yml` | `workflow_run`（跟在 PR Test Gate 之后） | ❌（打 tag 后 dispatch 上面三个） |

### ⛔ 关键盲区
**`push` 全绿 ≠ 安卓能编过。** `android-build.yml` 只在 `workflow_dispatch` 时跑，
所以安卓编译错误在 push 阶段完全不可见。

**改安卓代码后必须本地自查：**
```bash
cd android && env -u NODE_OPTIONS ./gradlew :app:compileDebugKotlin --console=plain
```
（`env -u NODE_OPTIONS` 是必需的 —— WorkBuddy 注入的 safe-delete shim 会劫持 `fs.rmSync`。）

## 二、取 PAT（免交互）

PAT 已存在 Windows 凭据管理器，`credential.helper=wincred`：

```bash
printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null \
  | grep "^password=" | cut -d= -f2-
```

⛔ 打印时务必脱敏（`sed 's/^password=.*/password=<REDACTED>/'`），别把 token 写进日志或提交。

## 三、三步定位失败

```bash
# 1) 列最近运行，找 conclusion=failure
GET /repos/ZJX93/XinWallet/actions/runs?per_page=10

# 2) 找出是哪个 step 红的
GET /repos/ZJX93/XinWallet/actions/runs/<runId>/jobs
#    → jobs[].steps[] 里筛 conclusion === 'failure'

# 3) 下完整日志
GET /repos/ZJX93/XinWallet/actions/jobs/<jobId>/logs
```

### ⛔ 四个环境坑（全都实际撞过）

**① `curl` 在 for 循环里报 `xargs: environment is too large for exec`**
环境变量过大导致 curl 根本没执行，只往文件里写了 41 字节的这句错误。
⇒ **改用 node `https.get` 落盘**，不要在循环里反复叠 curl。

**② node 把 `/tmp/x.json` 解析成 `D:\tmp\x.json`**
⇒ 一律用 `C:/Users/XIN/AppData/Local/Temp/` 绝对路径。
传给 node 的**脚本路径本身**也必须是 Windows 形式，否则 `MODULE_NOT_FOUND: d:\c\Users\...`。

**③ 日志接口会 302 到 blob 存储，跟随重定向时不能带 `Authorization`**（会被拒）。
⇒ 只对 `api.github.com` 加 `Authorization` 头。

**④ 日志正文是「一整行」超长文本**，`grep -n` 只会命中 1 行。
⇒ 先按时间戳切分再筛：

```js
const lines = s.split(/\r?\n/)
  .flatMap(l => l.split(/(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z )/));
lines.filter(l => /^\S*\s*e: |FAILURE:|What went wrong|##\[error\]/.test(l));
```

### 可复用下载脚本

`C:/Users/XIN/AppData/Local/Temp/ghlog.js`（用法 `node ghlog.js <jobId> <outName>`）：
读 `gh_tok.txt` 取 token、`https.get` 拉日志、跟随 302 时剥掉 Authorization、落盘。

## 四、区分真假失败

| 日志特征 | 判定 | 处置 |
|---|---|---|
| `HTTP 500: Failed to run workflow dispatch` | GitHub 侧故障 | **重跑即可**，与代码无关 |
| `e: file:///...kt:N:M <描述>` | Kotlin 真错误 | **本地复现确认**再改 |
| `Error Code: 00308018` + `[safe-delete]` | 本机 shim 干扰（仅本地会出现） | `env -u NODE_OPTIONS` |
| `ECONNREFUSED 127.0.0.1:5432` | PG 没起 | 起 PG，别读堆栈 |

**判定「测试/编译变红是否本次变更导致」的最快一步：**
```bash
git diff --name-only <上一个绿的 sha>..HEAD -- <相关目录>
```
空 = 与本次无关，直接查环境。比逐个读堆栈快得多。

## 五、已归档案例

### 案例 1：Android Build #153 失败（`36d3634`）

```
e: AiConfirmCard.kt:186:45 Overload resolution ambiguity between candidates:
     fun trimAmount(value: Double): String
     fun trimAmount(v: Double): String
e: AiConfirmCard.kt:408:1 Conflicting overloads:
```

**根因**：`ui/screens/` 下所有文件同属 `package com.xinwallet.app.ui.screens`，
顶层函数共享同一命名空间。`5e82c10` 新增的 `AiConfirmCard.kt:408`
定义了 `private fun trimAmount(v: Double)`，撞上 `7abbfd0` 就已存在的
`AddTransactionScreen.kt:1578` 的 `internal fun trimAmount(value: Double)`。

⛔ **`private` 拦不住** —— 编译期仍判 `Conflicting overloads`；
⛔ **参数名不同不构成重载区分** —— JVM 签名完全一致。

⚠️ **两版行为不等价，合并前必须比对**：

| 输入 | A（AddTransactionScreen，BigDecimal HALF_UP + trimEnd） | B（AiConfirmCard，toLong / `%.2f`） |
|---|---|---|
| `35.0` | `"35"` | `"35"` |
| `35.5` | `"35.5"` | `"35.50"` ⚠️ 不同 |
| `35.567` | `"35.57"` | `"35.57"` |

⇒ 直接删 B 会让 AI 确认卡里 `35.5` 从「35.50」变成「35.5」。修法需产品裁定。

**预防**：在 `ui/screens/` 新增工具函数前先
`grep -rn "fun <名字>" android/app/src/main/java/`。

### 案例 2：Auto Tag #210 失败（`36d3634`）

```
✅ gh workflow run release-image.yml  → 成功
✅ gh workflow run android-build.yml  → 成功
❌ gh workflow run harmony-build.yml
   could not create workflow dispatch event: HTTP 500: Failed to run workflow dispatch
```

GitHub API 侧 500，非代码问题。佐证：同一 push 触发的
`Build HarmonyOS HAP #74` 本身是 **success**，只是 tag 那次 dispatch 没发出去。
处置：重跑 `auto-tag`，或手动 dispatch `harmony-build.yml`。
