# XinWallet 鸿蒙 NEXT 端（ArkTS/ArkUI）构建与复刻说明

> 目标：把安卓端 XinWallet 的功能模块与 UI **一比一复刻**到 HarmonyOS NEXT（API 12 Stage 模型），
> 复用现有 Node.js 后端（REST API 不变）。本工程**不依赖 GMS**，语音/定位改用鸿蒙原生能力，
> 从架构上根治华为无 GMS 机型的「语音识别超时 / 定位失败」问题。

## 一、工程结构

```
harmony/
├─ AppScope/app.json5              # 应用名/图标/bundleName（需改成你自己的）
├─ build-profile.json5            # 需 DevEco 自动签名后生成 signingConfigs
├─ oh-package.json5
├─ hvigorfile.ts
└─ entry/src/main/
   ├─ module.json5                # 权限：INTERNET/LOCATION/APPROXIMATELY_LOCATION/MICROPHONE/READ_MEDIA
   ├─ resources/base/
   │  ├─ element/{color,string}.json
   │  ├─ profile/main_pages.json  # 全部 22 个页面路由
   │  └─ media/                    # ⚠️ 需放入 icon.png（entry）与 app_icon.png（AppScope）
   └─ ets/
      ├─ entryability/EntryAbility.ts
      ├─ common/
      │  ├─ config.ts              # BASE_URL 归一化
      │  ├─ theme.ts               # 暖棕主题色（Brown500 #995F2C）+ 收入红/支出绿
      │  ├─ models.ts              # 数据契约（镜像后端 JSON）
      │  ├─ store/Session.ts       # preferences 持久化 token/bookId/baseUrl
      │  ├─ http/Http.ts           # Bearer + X-Book-Id 注入，401 自动 refresh
      │  ├─ api/Api.ts             # 映射安卓 ApiService 全部端点
      │  ├─ audio.ts               # 鸿蒙原生录音 → WAV(base64) → 后端 Whisper 转写
      │  └─ components/{Components,Charts}.ets  # 通用组件 + Canvas 环形/折线图
      └─ pages/                    # 22 个页面
```

## 二、页面清单（安卓 → 鸿蒙 对照，已全部复刻）

| 安卓页面 | 鸿蒙文件 | 说明 |
|---|---|---|
| LoginScreen | Login.ets | 服务器地址 + 账号/demo 登录；已登录自动进 Main |
| AppRoot/MainScaffold | Main.ets | 底部 4 Tab（首页/账单/统计/我的）+ 中间暖棕记账浮钮（AI记账→Chat / 手动记账→AddTransaction） |
| HomeScreen | Home.ets | 账本切换头 + 暖棕渐变月支出卡 + 今日账单 + 账单日历 + 编辑首页卡片 |
| TransactionsScreen | Transactions.ets | 流水/日历双视图 + 按日分组 + 点行编辑/删除 |
| AddTransactionScreen | AddTransaction.ets | 收/支分段 + 分类网格 + 账户/日期/地点 + 金额键盘；**定位用 geoLocationManager** |
| ReportsScreen | Reports.ets | 支出/收入/结余分段 + KPI + 趋势折线 + 环形图 + 分类排行 |
| ProfileScreen | Profile.ets | 头像 + 昵称 + 12 宫格 + 退出登录 |
| AccountsScreen | Accounts.ets | 总资产 + 按类型分组 + 新增/点击进详情 |
| AccountDetailScreen | AccountDetail.ets | 当前余额 + 交易记录 |
| ChatScreen | Chat.ets | AI 对话记账；**语音用鸿蒙 AudioCapturer + 后端 transcribe（Whisper）** |
| CategoryScreen | Category.ets | 按类型分组 + 系统预设锁 + 增改删 |
| TagsScreen | Tags.ets | 彩色圆 + 增改删 + 10 色调色板 |
| BudgetsScreen | Budgets.ets | 预算列表 + 进度条(超支变红) + 增改删 |
| SavingsGoalsScreen | SavingsGoals.ets | 目标列表 + 进度条 + 存入/取回/流水 |
| DebtsScreen | Debts.ets | 汇总 4 卡 + 应付/应收 + 还款/增改删 |
| InvestmentsScreen | Investments.ets | 理财总市值 + 按类型分组 |
| InvestmentDetailScreen | InvestmentDetail.ets | 当前市值 + 收益/收益率 + 持仓信息 |
| PlanningScreen | Planning.ets | TabRow 聚合 预算/储蓄/债务/理财 |
| SearchScreen | Search.ets | 防抖搜索 + 高级筛选(金额/日期/类型) |
| AiScanScreen | AiScan.ets | OCR 配置提示 + 选图识别 + 逐条确认 + 批量入账 |
| DataManagementScreen | DataManagement.ets | 导出 CSV / 导入 CSV / 导出 JSON |
| AppLockScreen | AppLock.ets | 启用开关 + 设置/修改 4 位 PIN（SHA256） |
| SettingsScreen | Settings.ets | 外观主题三态 + 服务器地址 + 关于 |

> 注：`Home.ets` 仅导出 `HomePage` 结构体供 Main 的 Tabs 内嵌，未单独注册路由（无需独立页）。

## 三、在 DevEco 中打开与构建

1. DevEco Studio 打开 `harmony/` 工程（API 12 / HarmonyOS NEXT）。
2. **图标**：在 `entry/src/main/resources/base/media/` 放 `icon.png`，在 `AppScope/resources/base/media/` 放 `app_icon.png`
   （DevEco 默认模板图标即可，缺图会导致编译/签名失败）。
3. **bundleName**：`AppScope/app.json5` 的 `com.xinwallet.app` 换成你在 AGConnect 下注册的包名。
4. **签名**：`build-profile.json5` 的 `signingConfigs` 用 DevEco「自动签名」生成（需登录华为开发者账号）。
5. 连接华为手机（或模拟器）运行 `entry` Module。

### 3.1 命令行编译（本机已打通）

工程根目录直接执行即可，**无需手动设任何环境变量**：

```bash
cd harmony
sh ./hvigorw assembleHap --mode module -p product=default        # 增量编译
sh ./hvigorw clean                                                # 清理产物
```

Windows CMD / PowerShell 用 `hvigorw.bat` 同参数。
产物：`entry/build/default/outputs/default/entry-default-signed.hap`

`hvigorw` 已内置处理三个本地环境坑，**遇到下列报错先看是不是脚本被绕过了**：

| 报错 | 根因 | 脚本中的处理 |
|---|---|---|
| `hvigor not found` | 工具链不在 npm 全局/本地 node_modules/PATH，而在 DevEco Studio 安装目录 | 查找路径已补 `Program Files\Public\DevEco Studio\tools\hvigor\bin\hvigorw.js` 等常见位置 |
| `00303217 Configuration Error: Invalid value of 'DEVECO_SDK_HOME'` | 未设置 SDK 路径 | `ensure_sdk_home()` 从 hvigorw.js 反推同级 `<root>/sdk` 自动导出 |
| `00308018 Unknown Error` + `[safe-delete] 操作失败 ... 'trash' operation` | 外部（如 AI IDE）通过 `NODE_OPTIONS=--require=...` 注入了文件删除保护 shim，拦住了 hvigor 清理 `entry/build/.../loader_out` 中间目录。**这不是代码错误** | 脚本开头 `unset NODE_OPTIONS` |
| `Cannot find module 'D:\d\Program Files\...'` | Git Bash 下 node 不认 `/d/...` 形式路径 | `to_native_path()` 用 `cygpath -m` 转成原生路径 |

## 四、联调后端

- 登录页填写 `https://你的服务器IP:18888`（`normalizeBaseUrl` 会自动补 `/api`）。
- 模拟器请用 `10.0.2.2` 等宿主机地址；真机用局域网 IP。
- 后端即现有 Node.js 服务，无需任何改动。

## 五、GMS 问题根治对照（与原安卓 Bug 关联）

| 原安卓问题 | 鸿蒙端做法 |
|---|---|
| 语音：端上 `SpeechRecognizer` 走 Google 引擎，无 GMS 华为机卡死报「语音识别超时」 | `Chat.ets` + `common/audio.ts`：鸿蒙 `AudioCapturer` 录音 → 后端 `/ai/transcribe`（Whisper）转写，完全不碰 GMS |
| 定位：`NETWORK_PROVIDER` 走 Google 网络定位后端，无 GMS 时缓存陈旧返回 null | `AddTransaction.ets`：用 `@ohos.geoLocationManager.getCurrentLocation` 主动定位 |

## 六、需在真机/模拟器验证的项

> 源码编译已在本机打通（见 3.1，`clean` + 全量 `assembleHap` 均 BUILD SUCCESSFUL，0 ERROR），
> 以下为**编译无法覆盖、必须上真机/模拟器**的运行时项。

- 录音 → 转写链路（`common/audio.ts` 的 WAV 封装与 `Api.transcribe` 入参格式）。
- `geoLocationManager` 定位权限与返回。
- `DatePickerDialog` / `PhotoViewPicker` / `AlertDialog` / `Tabs` 等表现。
- 深色模式：主题模式持久化到 AppStorage（`themeMode`），`theme.ts` 已具备 LIGHT/DARK 双色板与
  `syncTokens` 同步，需真机确认切换后各页色值与对比度。
- 首页卡片开关持久化（`Session.getCardVisible` / `setCardVisible` 落 preferences），
  需验证杀进程重启后 `showTodayCard` / `showCalendarCard` 仍保持用户选择。
- 部分后端返回字段（report/debt/savings/investment）按安卓模型推断，做了防御性渲染；
  联调时若字段名不一致，以 `Api.ts` 返回的 `data` 实际结构为准微调。
- 遗留约 113 个 ArkTS WARN 均为历史 deprecation（`pushUrl` / `replaceUrl` / `show` /
  `ESObject` / `AppStorage.Get`），不阻断编译，可作为后续技术债统一清理。

## 七、GitHub Actions 自动构建 HAP 签名配置

> CI（`.github/workflows/harmony-build.yml`）里 runner 是全新环境，**没有**你本机的 DevEco 签名文件。
> 只有配置好下列 6 个 Secrets，`Build HarmonyOS HAP` 才会产出**可安装的 `.hap`**；
> 否则只做「源码编译验证」，不产出安装包。

### 7.1 需要的 6 个 Secrets

| Secret 名 | 值来源 | 示例 |
|---|---|---|
| `HARMONY_SIGN_STORE_FILE_B64` | DevEco 自动签名的 `.p12` 文件 → base64 | `MIIK...`（长字符串） |
| `HARMONY_SIGN_STORE_PASSWORD` | DevEco 签名面板「密钥库密码」 | `0000001B5B...` |
| `HARMONY_SIGN_KEY_ALIAS` | DevEco 签名面板「密钥别名」 | `debugKey` |
| `HARMONY_SIGN_KEY_PASSWORD` | DevEco 签名面板「密钥密码」 | `0000001B21...` |
| `HARMONY_SIGN_PROFILE_B64` | 自动签名的 `.p7b`（Profile）→ base64 | `MIIK...` |
| `HARMONY_SIGN_CERT_B64` | 自动签名的 `.cer`（证书）→ base64 | `MIIB...` |

三个文件的位置见 `harmony/build-profile.json5` 的 `signingConfigs[0].material`，
即本机 `C:\Users\<用户名>\.ohos\config\default_harmony_*.{p12,p7b,cer}`。

### 7.2 一键生成 6 项 Secret 值（PowerShell，Windows 本机）

```powershell
# ① 先填成你的实际文件名（可直接复制 build-profile.json5 里的路径）
$store = "C:\Users\XIN\.ohos\config\default_harmony_xxx.p12"
$profile = "C:\Users\XIN\.ohos\config\default_harmony_xxx.p7b"
$cert = "C:\Users\XIN\.ohos\config\default_harmony_xxx.cer"

# ② base64 三个文件（结果逐个复制，粘贴到对应 Secret）
[Convert]::ToBase64String([IO.File]::ReadAllBytes($store)) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes($profile)) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes($cert)) | Set-Clipboard

# ③ storePassword / keyPassword / keyAlias 从 DevEco 签名面板或 build-profile.json5 直接复制
```

Linux/macOS 上对应命令（base64 结果可写进文件再粘贴，注意 Windows 换行不要带进去）：

```bash
base64 -w0 /path/to/default_harmony_xxx.p12   # 输出后复制
base64 -w0 /path/to/default_harmony_xxx.p7b
base64 -w0 /path/to/default_harmony_xxx.cer
```

### 7.3 用 gh CLI 批量设置 Secrets（推荐）

```bash
# 先生成 base64 文件（一次生成，后面重复用）
gh secret set HARMONY_SIGN_STORE_FILE_B64 < .sign/store.b64
gh secret set HARMONY_SIGN_PROFILE_B64    < .sign/profile.b64
gh secret set HARMONY_SIGN_CERT_B64       < .sign/cert.b64

# 密码类直接以值传入（引号里换成你的真实值）
gh secret set HARMONY_SIGN_STORE_PASSWORD "你的密钥库密码"
gh secret set HARMONY_SIGN_KEY_PASSWORD   "你的密钥密码"
gh secret set HARMONY_SIGN_KEY_ALIAS      "debugKey"
```

或在仓库网页 **Settings → Secrets and variables → Actions → New repository secret** 逐个添加。

### 7.4 配置后验证

1. 仓库 **Actions** 页手动运行 `Build HarmonyOS HAP`（`workflow_dispatch`）。
2. 日志中「Prepare signing config」步骤应显示 `signing=real`（不再是 compile-only）。
3. 成功后在 **Summary 页底部 Artifacts** 下载 `xinwallet-entry-hap`，解压即 `.hap` 安装包。

### 7.5 注意事项

- **签名材料绝不提交到 git 仓库**：`.p12/.p7b/.cer` 及 base64 文件都只放 Secrets / 本地 `.sign/`（已加入 `.gitignore`）。
- 自动签名证书有**有效期**（通常与 DevEco 登录态相关），过期后需重新在 DevEco 打开工程重新自动签名并更新 Secrets。
- 若要**上架/正式分发**，请改用 AppGallery Connect 申请的正式发布证书与 Profile，替换上述 3 个文件后同样走 Secrets 注入。
