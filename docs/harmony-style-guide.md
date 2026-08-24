# 鸿蒙端视觉规范（XinWallet Harmony · 阶段 6）

> 适用于 `harmony/entry/src/main/ets/` 下所有页面与组件。
> 精修时间：2026-08-22 / 配套 `theme.ts` + `Components.ets`。

---

## 1. 颜色 Token

### 1.1 主品牌（暖棕系）

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `brand` | `#995F2C` | `#B6753B` | 主品牌色（按钮激活态、关键操作） |
| `brandLight` | `#D39562` | `#D39562` | 渐变末端、辅助品牌 |
| `brandLighter` | `#EBB890` | `#61370D` | 浅底强调 |
| `brandBg` | `#F8D7BE` | `#342C26` | 卡片大块底色 |
| `brandBgLight` | `#FCEFE5` | `#3F342B` | 浅填充（chip 默认态、icon 圆底） |
| `onPrimary` | `#FFFFFF` | `#0D0804` | 主色上的文字 |
| `onPrimaryContainer` | `#2E1200` | `#F8D7BE` | 主色容器上的文字 |

### 1.2 语义色

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `income` | `#C11435` | `#ED324B` | 收入金额（亮色与 error 复用） |
| `expense` | `#009558` | `#00B870` | 支出金额 |
| `teal` | `#4DD0C4` | `#4DD0C4` | 筛选条 / 小竖条强调 |
| `fabBg` | `#111827` | `#111827` | FAB 底色（与品牌色解耦） |

### 1.3 文字层级

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `textPrimary` | `#1A1A1A` | `#EAE3DE` | 一级文字 |
| `textSecondary` | `#4F4944` | `#AAA39D` | 二级文字（说明、标签） |
| `placeholder` | `#BDBDBD` | `#8A817A` | 占位符 |

### 1.4 表面层级（Material 3）

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `background` / `pageBg` | `#FDFBFA` | `#18130E` | 页面背景（**暖白**，不再用 `#F5F6F8`） |
| `surface` / `card` | `#FFFFFF` | `#29231D` | 卡片表面 |
| `surfaceVariant` | `#EBE7E3` | `#39312B` | 分组底色（与 divider 区分层次） |

### 1.5 边框 / 分隔线

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `divider` | `#EBE7E3` | `#39312B` | 暖灰分隔线（**升级**：`#EEEEEE → #EBE7E3`） |
| `outline` | `#B9B3AE` | `#5E5650` | M3 outline 主边框 |
| `outlineVariant` | `#D8D3CF` | `#3A332E` | M3 outlineVariant 浅边框 |

### 1.6 错误色

| Token | 亮色 | 暗色 |
|-------|------|------|
| `danger` / `error` | `#E54D42` / `#C11435` | `#ED324B` / `#ED324B` |
| `onError` | `#FFFFFF` | `#0D0804` |
| `errorContainer` | `#FBE7E9` | `#3A1018` |
| `onErrorContainer` | `#7A0B22` | `#ED324B` |

---

## 2. 栅格常量

### 2.1 间距 SPACING（必须从这 6 档取值）

```ts
SPACING.xs   = 4     // 微间距（图标与文字、紧密 chip 内 padding）
SPACING.sm   = 8     // 紧凑间距（行内元素间距）
SPACING.md   = 12    // 标准卡片内边距
SPACING.lg   = 16    // 大块卡片内边距 / 段落间距
SPACING.xl   = 24    // 区域间距（卡片与卡片之间）
SPACING.xxl  = 32    // 顶部大留白
```

### 2.2 圆角 RADIUS（5 档收敛）

```ts
RADIUS.sm   = 8     // 小元素（chip / 标签）
RADIUS.md   = 12    // 中等（卡片 / 输入框）
RADIUS.lg   = 16    // 标准卡片（**默认** Card 组件圆角）
RADIUS.xl   = 24    // 大型（Hero 渐变卡 / BottomSheet 顶部）
RADIUS.pill = 999   // 胶囊（chip 按钮 / FAB）
```

### 2.3 阴影 SHADOW

```ts
SHADOW.card  = '#0000000A'   // 卡片 1dp 轻浮（页面主要表面）
SHADOW.fab   = '#995F2C55'   // FAB 抬起（强品牌色阴影）
SHADOW.sheet = '#0000001A'   // 底部弹窗升起（中性深色阴影）
```

### 2.4 字号 FONT_SIZE

```ts
FONT_SIZE.display = 34   // Hero 大额数字
FONT_SIZE.title   = 22   // 弹层标题 / 卡片标题
FONT_SIZE.body    = 15   // 正文
FONT_SIZE.label   = 13   // chip / 按钮
FONT_SIZE.caption = 11   // 时间戳 / 提示
```

---

## 3. 组件库（`common/components/Components.ets`）

### 3.1 已有组件（保留使用）

| 组件 | 用途 |
|------|------|
| `TopBar` | 顶部栏（标题 + 返回键），高度 52，padding left 12 |
| `BalanceCard` | 金额卡（账户页"总资产"用） |
| `HeroGradientCard` | 暖棕渐变大额卡（首页"本月支出"用） |
| `RowItem` | 标准行项（左图标 + 标题 + 右值/箭头） |
| `TransactionRow` | 交易行（含分类图标、备注、金额、账户） |
| `AccountListItem` | 账户行（含余额、信用卡显示额度） |
| `CategoryIcon` | 分类图标圆（emoji 圆底） |
| `IconCircle` | 通用图标圆底容器 |
| `LinearProgress` | 线性进度条（预算/分类占比） |
| `CategoryBars` | 分类条形排行（统计页） |
| `StatKpiCard` | 2x2 KPI 小卡（统计页） |
| `SectionTitle` | 旧版"竖条+文字"标题（**保留旧接口**，新代码用 V2） |
| `EmptyState` | 旧版空状态（**保留旧接口**，新代码用 V2） |
| `ErrorState` | 错误态（带重试/重新登录按钮） |
| `LoadingBox` | 加载中态 |
| `FloatingButton` | 悬浮 FAB（圆 + 号或药丸形） |
| `PullRefreshBox` | 下拉刷新容器 |
| `DropdownField` | 只读下拉选择框 |
| `DatePickerField` | 日期选择框 |
| `DateTimePickerField` | 日期+时间（到秒）选择框 |
| `BookHeader` | 顶部账本切换头 |
| `BookSwitcherSheet` | 账本切换底部弹层 |
| `DonutChart` / `TrendChart` | 环形图 / 趋势图 |

### 3.2 新增组件（精修阶段 2）

| 组件 | 用途 | 关键参数 |
|------|------|----------|
| `Card` | 统一卡片容器 | `padding=16` `radius=16` `shadow=true` `onTap?` |
| `Chip` | 统一 chip | `label` `icon?` `active` `onTap?` |
| `SheetHeader` | 弹层标题 | `title` `subtitle?` `onClose?` |
| `BottomSheet` | 统一底部弹层 | `show` `maxHeight='80%'` `onDismiss` `@BuilderParam content` |
| `EmptyStateV2` | 升级空状态 | `icon` `title` `subtitle?` `actionText?` `onAction?` |
| `SectionTitleV2` | 图标圆 + 标题 | `icon` `text` `actionText?` `onAction?` |

### 3.3 使用示例

```ets
// 卡片
Card() {
  Column({ space: 8 }) {
    SectionTitleV2({ icon: '🧾', text: '今日账单' })
    TransactionRow({ item: it })
  }.alignItems(HorizontalAlign.Start)
}

// Chip 分段
Row({ space: 6 }) {
  Chip({ label: '支出', active: this.type === 'expense', onTap: () => ... })
  Chip({ label: '收入', active: this.type === 'income', onTap: () => ... })
}

// BottomSheet
BottomSheet({ show: this.showAdd, maxHeight: '85%', onDismiss: () => { this.showAdd = false; } }) {
  Column({ space: 12 }) {
    SheetHeader({ title: '新增账户', onClose: () => { this.showAdd = false; } })
    // 表单字段
    Button('保存').width('100%').onClick(() => this.save())
  }
}
```

---

## 4. 卡片 / 列表 / 弹层使用规范

### 4.1 卡片

- 列表型卡片统一用 `<Card>` 组件（圆角 16、padding 16、轻阴影）
- 不要再用 `padding(14).backgroundColor(COLORS.card).borderRadius(14)` 这种内联组合
- 卡片内边距统一 16；卡片间距用 `space: 12`
- 大型 Hero 卡（首页月支出/总资产）保留 `HeroGradientCard` / `BalanceCard`

### 4.2 列表行

- 行间分隔：用 Card 容器 + `space: 8` 间距替代每个 RowItem 自带的 1px border
- 已基本到位但仍带 border 的旧组件：`RowItem` / `TransactionRow` / `AccountListItem`——阶段 4+ 的子页面已避免直接调用，改用 Card 容器内嵌

### 4.3 弹层

- 底部抽屉 → 必须用 `<BottomSheet>`
- 居中确认 → 用居中 Column + 遮罩（删除确认等场景）
- 不要直接复制 Stack + 半透明 Column 的旧实现
- 所有 sheet 标题统一用 `<SheetHeader>`

### 4.4 Chip

- 任何分段选择（流水/日历、支出/收入/结余）→ 统一用 `<Chip>`
- 选中态：实心品牌色（`brand`）+ 白字
- 默认态：浅棕底（`brandBgLight`）+ 主文字色

---

## 5. 已精修页面清单

| 阶段 | 文件 |
|------|------|
| 1 | `common/theme.ts` |
| 2 | `common/components/Components.ets` |
| 3 | `pages/Home.ets` `pages/Transactions.ets` `pages/Reports.ets` `pages/Profile.ets` |
| 4A | `pages/Accounts.ets` `pages/Category.ets` `pages/Tags.ets` `pages/Budgets.ets` |
| 4B | `pages/Debts.ets` `pages/SavingsGoals.ets` `pages/AccountDetail.ets` `pages/Search.ets` `pages/Settings.ets` `pages/Chat.ets` `pages/Home.ets`(EditSheet) |
| 5 | 全 23 页铺 `AppBackground` + TopBar/Card/底部导航半透明（见 §13~§15） |
| 6 | 二级页系统性精修：8 页手拼卡片底收口半透明、7 页 loading 骨架屏、6 页写操作反馈、5 页删除确认（见 §19~§20） |

### 5.1 未单独精修但已受益的页面

（仅享受主题/组件 token 升级，未做结构改动）

~~`InvestmentDetail.ets` `InvestmentTransactions.ets` `Investments.ets` `AiScan.ets` `DataManagement.ets` `AppLock.ets` `AddTransaction.ets`~~
→ **已在阶段 6 补齐**（卡片底色收口 / 语义色修正 / 确认弹窗收口）。

仍未单独精修：`Planning.ets` `Login.ets`。

如需进一步精修，可参考 `Accounts.ets` 的模式（导入新组件、用 BottomSheet 替换自写弹层、用 Chip 替换内联分段）。

---

## 6. 兼容性说明

- 旧 token 名（`card` / `pageBg` / `danger` / `divider`）保留，新值已对齐
- 旧组件（`TopBar` / `RowItem` / `BalanceCard` / `HeroGradientCard` / `StatKpiCard` / `CategoryBars` 等）保留，新值已用新 token
- 旧版 `EmptyState` / `SectionTitle` 保留，**新增场景优先用 V2 版**
- `pageBg` 由冷灰 `#F5F6F8` 改为暖白 `#FDFBFA`：如页面背景颜色明显变化属预期升级
- `divider` 由 `#EEEEEE` 改为 `#EBE7E3`：暖灰分组底，避免冷灰破坏整体暖色基调

---

## 7. 验证清单

升级后建议本地确认：

- [ ] 亮色 / 暗色 / system 三态切换正常（`@StorageProp('themeMode')` 同步重绘）
- [ ] 所有页面背景统一为 `#FDFBFA` 暖白
- [ ] 所有 `<BottomSheet>` 点击遮罩能关闭
- [ ] 所有 `<Chip>` 选中态切到品牌色实心
- [ ] 卡片边缘不再有 1px 灰边（除 RowItem 组件内部保留）
- [ ] 弹层顶部圆角 24、底部留白与屏幕齐平
- [ ] 字体使用 FONT_SIZE 五档
- [ ] Chip 内边距不再有 14/15 混用（统一 sm-xs+2）

---

## 8. 首页卡片体系（注册表驱动）

首页功能卡片走「注册表驱动」，单一数据源在 `common/store/HomeCards.ts`。

### 新增一张卡片的完整流程

**只需三步**，编辑弹层的开关列表会自动出现对应条目，不需要改弹层代码：

1. **注册表加一条** —— `common/store/HomeCards.ts` 的 `CARD_REGISTRY` 追加：

```ts
{
  key: 'card_debt',          // 前缀 card_，落库为 home_card_debt
  title: '负债概览',
  subtitle: '待还金额与本月应还',   // 一句话说明这张卡看什么
  icon: '📉',
  defaultOn: false           // 新卡默认关闭，避免首页越用越挤
}
```

2. **Home.ets 加一个 `@Builder`** —— 命名 `XxxCard()`，套 `Card` 容器 + `CardHeader`：

```ts
@Builder DebtCard() {
  Card({ contentPadding: SPACING.lg }) {
    Column({ space: 0 }) {
      CardHeader({ icon: '📉', title: '负债概览',
        onMore: () => { router.pushUrl({ url: 'pages/Debts' }); } })
      if (this.debts.length === 0) {
        this.CardEmpty('📉', '还没有负债记录', '有贷款或欠款可以记在这里')
      } else {
        // 列表：compact 行内分隔线，不要每行独立卡片
      }
    }.alignItems(HorizontalAlign.Start)
  }
}
```

3. **`renderCard()` 加一个分支** + 若需拉数据，在 `loadExtraCards()` 和 `toggleCard()` 里各加一行。

### 必须遵守的四条

| 规则 | 原因 |
|---|---|
| 新卡 `defaultOn: false` | 「按需显示」的前提是默认克制，默认全开就失去意义 |
| 列表用 `compact: true` + `showTopDivider: index !== 0` | 一张总卡片内用行内分隔线，**不是每行一个独立卡片** |
| 数据请求放 `loadExtraCards()` 里判断开关 | 关掉的卡片不该产生网络开销 |
| 空态用 `this.CardEmpty(icon, title, hint)` | 六张卡空态样式必须一致 |

### 持久化

- 开关：`home_card_*`（`Session.getCardVisible` / `setCardVisible`）
- 顺序：`home_card_order`（逗号分隔 key 串）
- `loadOrder()` 会自动剔除已下线 key、追加新增 key，**版本升级不会让用户的自定义顺序失效，新卡也不会消失**

---

## 9. 配色红线（踩过的坑）

### 不要用 accent1~4

`theme.ts` 里的 `accent1 #6366F1`（紫蓝）/ `accent2 #10B981`（翠绿）/ `accent3 #F59E0B`（琥珀）/ `accent4 #EC4899`（粉）
是 V2 阶段定义后**从未使用**的 token，全部与暖棕主色系冲突。紫蓝配暖棕看起来像两套设计拼在一起。

**需要多级色阶时用品牌同色系明度递进：**

```
brand #995F2C → brandLight #D39562 → brandLighter #EBB890 → brandBg #F8D7BE
```

分类支出榜的五条色带就是这么做的：既分出主次，又不破坏暖色调。

### 进度条不要用 income 红

`income #C11435` 在进度条里容易被读成「警告 / 超限」。储蓄目标、预算未超支这类**正向进度**统一用 `brand` 棕。
红色只留给真正的异常态（预算超支）。

### 异常态要双重编码

不能只靠颜色传达异常。预算超支的做法：

1. 进度条变 `expense` 色
2. 金额数字加粗
3. **补一行文字「超支 ¥380.00」**

色盲用户只看颜色识别不出，第 3 条是必须的。

### 负数金额单独着色

账户余额为负（信用卡欠款）时用 `expense` 色，一眼分清资产与负债。

### 语义色（红涨绿跌）必须降饱和才能与暖棕共存

`income` / `expense` 的原始值是从安卓端直接搬过来的高饱和色，在暖棕体系里
是明显的撞色 —— 尤其 `expense #009558` 这种青绿，和 `#995F2C` 放在一起
像两套 App。

更糟的是 `#009558` 在所有实际背景上对比度只有 **3.42~3.66:1**，
**本来就不达 AA** —— 不只是审美问题，是可访问性缺陷。

| token | 旧值 | 新值 | 饱和 | 全场景对比度 |
|---|---|---|---|---|
| `income`（亮） | `#C11435` | `#B02E43` | 90%→74% | 5.61~6.33:1 ✓ |
| `expense`（亮） | `#009558` | `#2C7657` | 100%→63% | 4.85~5.47:1 ✓ |
| `income`（暗） | `#ED324B` | `#F0707F` | — | 5.37:1 ✓ |
| `expense`（暗） | `#00B870` | `#5CAE8A` | 100%→47% | 5.77:1 ✓ |

**核算时必须取最严苛的背景**，不是卡片底。日历格的 `brandBgLight #FCEFE5`
比卡片更亮，`#2F7D5C` 在卡片上有 4.73:1 但在那里只有 4.42:1 —— 差一点点
也是不达标，所以最终压到 `#2C7657`。

**暗色模式方向相反**：暗底上要「提亮」而非降饱和 —— 降饱和会同时降亮度，
对比更差。实测 `#ED324B`（3.78:1 ✗）降饱和到 `#E05A6E` 反而只有 4.29:1，
必须往 `#F0707F`（V=94%）提亮才达标。

红绿色相距离 164°，色盲以外均可辨；语义方向仍是中国习惯的红涨绿跌。

---

## 10. 可访问性基线（WCAG AA）

已核算的关键配对（正文需 ≥4.5:1，18px+ 大字需 ≥3.0:1）：

| 配对 | 对比度 | 判定 |
|---|---|---|
| `textPrimary #1A1A1A` on 白 | 17.40:1 | 通过 |
| `textSecondary #4F4944` on 白 | 8.86:1 | 通过 |
| `textSecondary` on `surfaceVariant` | 7.21:1 | 通过 |
| `income #C11435` on 白 | 6.14:1 | 通过 |
| `brand #995F2C` on 白 | 5.21:1 | 通过 |
| `brand` on `brandBgLight` | 4.62:1 | 通过 |
| `expense #009558` on 白 | 3.86:1 | 仅大字通过（只用于 16px 加粗金额，可接受） |
| `placeholder #948C84` on 暖白 | 3.21:1 | 次要信息可接受 |

**`placeholder` 已从 `#BDBDBD` 改为 `#948C84`** —— 原值对比度仅 1.82:1，远低于标准且是中性灰与暖色板不搭。
没有拉到 4.5 是刻意的：placeholder 语义上就该弱于正文，过高会抢注意力。

新增颜色前请先核算对比度（WCAG 相对亮度公式），不要凭肉眼判断。

---

## 11. 路由规则：底部 tab 页不能 pushUrl

`Main.ets` 的底部 tab 是靠 `selectedIndex` 切换内嵌组件，**不是路由栈**：

```ts
if (this.selectedIndex === 0) { HomePage() }
else if (this.selectedIndex === 1) { TransactionsPage() }
else if (this.selectedIndex === 2) { ReportsPage() }
else { ProfilePage() }
```

这四个页面（`Home` / `Transactions` / `Reports` / `Profile`）**不再注册独立路由**，
从根上消除了误跳的可能。历史上它们同时注册在 `main_pages.json` 且各有一个
`@Entry` 包装 struct（`TopBar` + `XxxPage`），但**用 `pushUrl` 跳过去会压出
一个没有底部导航栏的孤立页面**，返回行为也会错乱。

**已做的清理**（2026-08-22）：
- `main_pages.json` 移除 `pages/Transactions` / `pages/Reports` / `pages/Profile` 三条死路由
- 三个文件末尾的 `@Entry struct Transactions/Reports/Profile` 包装 struct 一并删除，
  位置替换为说明注释
- 验证依据：全项目 `grep pages/Transactions|pages/Reports|pages/Profile` 只命中注释，
  无任何实际跳转调用；三个 `XxxPage` 各自内部已自带头部区
  （`ToolBar()` / `Seg()` / 头像块），删掉 wrapper 的 `TopBar` 不影响 tab 显示
- `Home` 从来只作为组件存在，本身不是 `@Entry`

**跳 tab 的正确做法** —— 改 `@StorageLink('mainTabIndex')`：

```ts
// 页面里声明
@StorageLink('mainTabIndex') mainTabIndex: number = 0;
// 跳统计 tab
this.mainTabIndex = 2;
```

该 key 在 `EntryAbility.onCreate` 用 `AppStorage.setOrCreate('mainTabIndex', 0)` 建立初值。

**需要带参数进 tab 时**（如「查看某月账单」）：参数走 `AppStorage`，不要走
`router.getParams()`。原 `Transactions` wrapper 用 `getParams().month` 接月份，
随 wrapper 一起删除了。

**判断某页面能否 pushUrl**：在 `main_pages.json` 里有注册的就能跳，没有的就是 tab 内容。
现在这两件事一一对应，不再有「既是 tab 又有路由」的暧昧状态。
`Accounts` / `Budgets` / `SavingsGoals` / `AccountDetail` 等不是 tab，`pushUrl` 是对的。

---

## 12. ArkTS 语法陷阱汇总

| 陷阱 | 现象 | 解法 |
|---|---|---|
| `@Component` 字段名与组件方法重名 | `Property 'shadow' in type 'Card' is not assignable` | 改名 `withShadow` / `contentPadding` / `cardRadius` |
| 表达式体 lambda | `arkts-no-implicit-return-types` | 一律用块体 `() => { x = y; }` |
| `.shadow()` 传数组 | `No overload matches this call` | **只接受单个 `ShadowOptions`**，用大半径+低不透明模拟多层 |
| `.shadow(undefined)` | 类型错 | 传 `{ radius: 0, color: '#00000000', offsetX: 0, offsetY: 0 }` |
| 三元返回异形对象 | 类型推断失败 | 两支必须**同一形状**（如 `border.width` 不能一支对象一支 number） |
| `Color.Transparent` 混用 string | 类型冲突 | 统一用 `'#00000000'` |
| **`ForEach` 内部写 `if`** | **开关切换后不刷新（diff 不可靠）** | **先过滤成数组再交给 `ForEach`**，如 `visibleCards()` |
| 混用 `@kit.*` 导入 | 风格不一致 | 项目统一 `@ohos.*` 老式导入 |

### 废弃 API 收敛约定

不要在页面里直接调废弃 API，统一收口到工具模块，未来 API 移除只改一处：

- **Toast** → `common/ui.ts` 的 `toast()` / `toastLong()`，不要直接用 `promptAction.showToast`
- **AppStorage** → 用 `get()` / `setOrCreate()`，`Get()` / `Set()` 已废弃

`router.pushUrl` / `replaceUrl` / `back` / `getParams` / `AlertDialog.show` / `PhotoViewPicker`
仍有大量历史调用（约百余处），属机械迁移，不阻断编译，暂未处理。

---

## 13. ⛔ 颜色格式红线：ArkUI 是 `#AARRGGBB`，Alpha 在最前

这是本项目踩过的**最严重的一个坑**，优先级高于本文档其他所有规则。

### 规则

| 平台 | 格式 | Alpha 位置 |
|---|---|---|
| CSS / Web | `#RRGGBBAA` | 最**后** |
| Android XML | `#AARRGGBB` | 最前 |
| **ArkUI** | **`#AARRGGBB`** | **最前** |

按 CSS 习惯书写会**静默出错**——ArkTS 把它当合法色值字符串，零编译告警，但真机渲染全部错乱。

### 实际造成过的后果

| 错误写法 | 本意 | 真机实渲 | 现象 |
|---|---|---|---|
| `'#FFE8DC00'` | 透明暖橘（渐变收尾） | `rgb(232,220,0)` a=100% | 背景出现**不透明黄绿色块** |
| `'#FFFFFFCC'` | 80% 白（毛玻璃） | `rgb(255,255,204)` a=100% | 毛玻璃变淡黄不透明 |
| `'#0000000A'` | 4% 黑（卡片阴影） | a=**00** 全透明 | **阴影完全消失**，卡片没有立体感 |
| `'#00000066'` | 40% 黑（弹层遮罩） | a=00 | 遮罩不生效 |
| `'#995F2C55'` | 33% 品牌棕（FAB 阴影） | `rgb(95,44,26)` a=60% | 变成深褐色脏边框 |
| `'#29231DCC'` | 80% 深棕（暗色玻璃） | `rgb(35,29,204)` a=16% | 色相跑偏成蓝紫 |

**最难排查的是 alpha 落 `00` 的情况** —— 元素直接隐形，看起来像「忘记写阴影」而不像「写错了格式」。

### 正确做法：不要手写 8 位色值

`theme.ts` 已提供工具函数，**一律使用它们**：

```ts
import { withAlpha, TRANSPARENT } from '../theme';

// ❌ 不要这样写
.backgroundColor('#FFFFFFCC')
.shadow({ radius: 12, color: '#0000000A' })
colors: [[color, 0], [color + '00', 1]]

// ✅ 正确
.backgroundColor(withAlpha('#FFFFFF', 0.8))
.shadow({ radius: 12, color: withAlpha('#000000', 0.04) })
colors: [[withAlpha(color, 0.8), 0], [withAlpha(color, 0), 1]]
```

| 不要写 | 改用 | 产出 |
|---|---|---|
| `'#FFFFFFCC'` | `withAlpha('#FFFFFF', 0.8)` | `#CCFFFFFF` |
| `'#0000000A'` | `withAlpha('#000000', 0.04)` | `#0A000000` |
| `color + '00'` | `withAlpha(color, 0)` | `#00RRGGBB` |
| `'#00000000'` | `TRANSPARENT` | `#00000000` |

（`'#00000000'` 两种顺序恰好等价，但用 `TRANSPARENT` 语义更清晰。）

### Alpha 换算表（需要手动核对时）

| 不透明度 | AA | 不透明度 | AA |
|---|---|---|---|
| 100% | `FF` | 20% | `33` |
| 90% | `E6` | 15% | `26` |
| 80% | `CC` | 10% | `1A` |
| 60% | `99` | 8% | `14` |
| 50% | `80` | 4% | `0A` |
| 33% | `55` | 0% | `00` |

### 复发自查

新增颜色后跑一遍：扫描所有 `'#XXXXXXXX'`，若**末**两位是典型 alpha 值（`00`/`0A`/`14`/`1A`/`33`/`55`/`66`/`80`/`CC`/`E6`）
而**首**两位不是 → 大概率写反了。同时检查 `+ 'XX'` 形式的字符串拼接。
（注意：文档注释里的反例说明会误报，需排除注释行。）

---

## 14. 环境光背景（AppBackground）

### 必须用 radialGradient

柔光团要的是**圆形**径向扩散。`linearGradient({ angle })` 是沿某个角度线性扫过去，
出来的是一条斜向色带，不是柔光——这是本项目原先的写法，视觉上完全不对。

```ts
.radialGradient({
  center: ['50%', '50%'],
  radius: '100%',
  colors: [
    [withAlpha(color, opacity), 0.0],
    [withAlpha(color, opacity * 0.45), 0.55],  // 中段过渡，避免硬边
    [withAlpha(color, 0), 1.0]                  // 必须用 withAlpha，不能写 color + '00'
  ]
})
.blur(60)
```

### ambient 色值要足够淡

判据：**叠在 `background #FDFBFA` 上，合成色与底色的单通道最大差值 ≤ 22**。
超过就是「色块」而非「环境光」。

| Token | 值 | 用途 | opacity | 叠底后与底色最大差 |
|---|---|---|---|---|
| `ambient1` | `#FBEADF` | 暖橘，右上主光源 | 0.85 | 23（主光源刻意略强） |
| `ambient2` | `#F9E4E4` | 暮霞粉，左上次光源 | 0.70 | 16 |
| `ambient3` | `#F6EDE2` | 米杏，左下收边 | 0.50 | 12 |
| `ambient4` | `#F7E6E0` | 藕荷粉，右下平衡 | 0.60 | 16 |

旧值 `#FFE8DC` / `#FFD6BA` / `#F8D5B0` / `#F4CFC0` 饱和度过高已废弃。

### 布局约定

4 团，opacity 逐层递减（0.85 → 0.70 → 0.60 → 0.50）形成主次；位置用**百分比**不用 px，
保证不同屏幕尺寸下相对位置一致。

### 预览必须与代码同参

`docs/*-preview.html` 里的光团参数（宽高 %、位置 %、blur、opacity）
必须与 `AppBackground.Glow()` **一一对应**。
之前预览用旧 ambient 值 + px 定位 + 只画 3 团，导致「预览和真机不一样」——
预览失真比没有预览更糟，因为它会让人以为代码是对的。

### ⛔ 环境光必须是静态的，不做漂移 / 呼吸

**全端约定：环境光背景层不挂任何 `infinite` 动画。**

web 端曾在 `body::before` / `body::after` 两层全屏 `position: fixed` 覆盖层上
各挂一条 `blobDrift1 14s` / `blobDrift2 18s` 的 `infinite` 动画，做 `translate + scale`。
单看 keyframes 位移量很小（2%~3%、scale 0.92~1.08），像是「几乎看不见的呼吸」，
但因为作用对象是**整块全屏渐晕层**，实际观感就是**背景色一直在来回移动**，
用户明确要求去掉。

三条判据：

1. **环境光的作用是给页面定调，不是吸引注意力。** 它铺满整屏且常驻，
   任何持续位移都会进入余光，长时间阅读数字（记账应用的核心动作）时尤其干扰。
   入场动画只播一次，可以接受；`infinite` 常驻动画不行。
2. **位移量小 ≠ 不明显。** 判断背景动画是否干扰，看的是「动的面积 × 常驻时长」，
   而不是 keyframes 里的百分比数值。全屏 × 无限循环，再小的位移也是显著的。
3. **`filter: saturate(2)` 会放大位移感。** 该层同时挂了饱和度提升，
   光斑边缘移动时色相变化被一起放大，比裸渐变移动更扎眼。

去除时**只摘 `animation` 声明，保留静态渐变本身**——
诉求是「不要动」，不是「不要背景」。`body` 的 `background-image`（4 个 `radial-gradient`）、
`background-attachment: fixed`、`::after` 叠加层、`--blob-*` token 全部原样保留。

同时清掉了 `glassShimmer`（`background-position` 0%→100% 循环）：
它无任何选择器引用，属死代码，但语义同为「背景循环移动」，一并移除避免以后被误用。

**不要误杀的白名单**（这三个 `infinite` 与背景无关，必须保留）：

| 动画 | 作用对象 | 为何保留 |
|---|---|---|
| `shimmer` | 骨架屏 | 加载态反馈，有明确起止（数据到达即消失） |
| `spin` | 加载图标 | 同上 |
| `blobFloat` | 空状态 emoji | 局部小元素，非背景层 |

排查时**不能直接搜 `infinite` 一刀切**，要看动画作用在哪个选择器上——
是全屏背景层，还是局部反馈元素。

回归校验：`node scripts/verify-no-bg-animation.js`（16 项，同时断言
「动画已移除」与「静态背景仍在」两个方向，防止修过头）。

鸿蒙 / 安卓端的 `AppBackground` 本身就是静态实现，无需改动，但**不要**后续再给它加
`animateTo` 循环或 `rememberInfiniteTransition`。

---

## 15. ⛔ 页面背景三层结构（背景统一不只是「有 AppBackground」）

写完 `AppBackground` 组件不等于背景统一。本项目曾出现「只有 `Main.ets` 用了
`AppBackground`，另外 20 个二级页各自铺不透明 `pageBg` 纯色」，
结果**每次切页背景都断裂一次**，环境光只在首页出现。

背景统一由三层共同保证，缺一层就穿帮：

### 第 1 层：每个 @Entry 页面都要铺 AppBackground

```ts
@Entry
@Component
struct AccountsEntry {
  build() {
    Stack() {
      AppBackground()                                    // 背景层
      Column() { AccountsPage() }                        // 内容层
        .width('100%').height('100%')
    }
    .width('100%').height('100%')
  }
}
```

**注意**：根节点必须是原生 `Stack`，不能封装成自定义组件（见第 16 节）。

### 第 2 层：内容层禁写不透明底色

- ❌ `.backgroundColor(COLORS.pageBg)` — 会把下面的柔光整块盖掉
- ✅ 不设 backgroundColor，或用 `withAlpha(...)` 半透明

**例外**：`Main.ets:209` 保留 `pageBg`，但它位于 `AppBackground` **之下**做兜底，
不是盖在上面，所以不影响。

**tab 内嵌页不要重复叠 `AppBackground`**：`Home` / `Transactions` / `Reports` /
`Profile` 是 `Main` 的 tab 内容，`Main` 已经铺了一层。它们**既不能再叠一层**
（会加深柔光），**也不能铺 `pageBg`**（会遮住 Main 的柔光）。
`Reports.ets:180` 原先铺了 `pageBg`，已移除。

### 第 3 层：TopBar / Card / 底部导航必须半透明

不透明的顶栏、卡片、底部导航会在环境光上「切」出可见断层和白方块——
背景是渐晕的，压一块纯色上去边界立刻现形。

| 组件 | 错误写法 | 正确写法 | 症状 |
|---|---|---|---|
| `TopBar` | 渐变收尾用 `COLORS.surface`（不透明） | 整段 `withAlpha(surface, 0.94→0.86→0.72)` | 顶栏下沿一条横向断层 |
| `Card` | `.backgroundColor(COLORS.surface)` | `.backgroundColor(COLORS.cardGlass)` | 柔光被切成白方块 |
| `Main.BottomNav` | `COLORS.card` + `border({width:1})` | `withAlpha(surface, 0.88)` + `border({width:{top:0.5}})` | 栏顶横向断层 + 左右两条多余竖线 |
| `Chat` 顶栏/输入栏 | `COLORS.card` | `withAlpha(surface, 0.9)` | 同上 |

`cardGlass` = 亮色 `#9EFFFFFF`（62% 白）/ 暗色 `#8C2A2320`（55% 深棕）。
62% 透明度下 `textPrimary` 对比度仍有 **16.62:1**，远超 AA 的 4.5:1，
所以「怕看不清」不是拒绝半透明的理由。

底部导航 88% 的实测对比度（叠在最强柔光 `ambient1 @0.85` 上）：

| 前景 | 亮色 vs 导航栏 | 暗色 vs 导航栏 |
|---|---|---|
| `textSecondary` | 5.89:1 ✓ | 7.04:1 ✓ |
| `brand` | 5.14:1 ✓ | 8.65:1 ✓ |
| `textPrimary` | 15.53:1 ✓ | 13.56:1 ✓ |

导航栏（88%）与卡片（62%）合成底色单通道差 **8**，边界可辨但不生硬。

`glassFill` / `glassHighlight` 这两个 token 在暗色下语义方向相反
（20% 白在深色背景上会拉出发亮浅灰带），**不要**拿来做 TopBar 渐变。

### 例外：这些地方应该保持不透明

- **`BottomSheet` 面板底**：弹层的职责就是遮挡下层，半透明会让下面内容干扰阅读
- **FAB（中间记账按钮）**：实体按钮，透光会失去「可按压」的物理感
- **Chat 气泡**：内容元素，半透明会显脏

---

## 16. ⛔ @Entry 根节点必须是原生容器组件

ArkTS 硬约束，编译期报错 `10905210`：

> In an '@Entry' decorated component, the 'build' method can have only one root node,
> which must be a container component

「容器组件」指的是**原生**容器：`Column` / `Row` / `Stack` / `Flex` / `Grid` /
`List` / `Scroll` / `Swiper` / `RelativeContainer` 等。
自定义 `@Component`（即使它内部根节点是 `Stack`）**不被接受**。

### 踩坑记录

为了消除 23 个页面的重复模板，曾抽了一个 `PageContainer` 组件：

```ts
// ❌ 这个方案编译不过，19 个页面全报 10905210
@Component
export struct PageContainer {
  @BuilderParam content: () => void
  build() {
    Stack() { AppBackground(); Column() { this.content() } }
  }
}

// @Entry 页面里
build() {
  PageContainer() { AccountsPage() }   // ← 报错：根节点不是容器组件
}
```

结论：**@Entry 页面的背景模板无法抽成组件，只能接受这 6 行重复**。
`PageContainer` 已从 `Components.ets` 移除，位置替换为约束说明注释块，
防止后人再走一遍。

### 什么情况下可以用自定义组件做根

非 `@Entry` 的普通 `@Component` 没有这个限制，根节点可以是任意自定义组件。
所以模板抽取要往**内容层**抽（如 `AccountsPage`），而不是往外层抽。

---

## 17. ⛔ 半透明导航栏的连带责任：滚动内容必须留底部安全区

把底部导航栏改成 88% 半透明之后，出现了一个**改造引入的新问题**：
不透明白底时它至少能「挡住」滚动到底的内容，半透明后内容直接从导航栏下方
透出，和「首页 / 账单 / 统计 / 我的」四个标签**叠字**。

真机截图里首页日历卡最后一行、账单列表最后一条都糊在导航栏上。

### 规则

所有可滚动页面的内容底部必须留 `LAYOUT.bottomNavSafe`（= 64 栏高 + 16 呼吸）。

```ts
// ❌ 四边均匀 padding —— 底部只有 12，一定叠字
}.padding(12)

// ❌ 用 Blank 兜底且值不够
Blank().height(20)
}.padding(12)

// ✅
}.padding({ left: 12, right: 12, top: 12, bottom: LAYOUT.bottomNavSafe })
```

`LAYOUT` 常量定义在 `theme.ts`，不要各页各写魔数：

| 常量 | 值 | 用途 |
|---|---|---|
| `LAYOUT.bottomNavH` | 64 | 底部导航栏高度 |
| `LAYOUT.bottomNavSafe` | 80 | 滚动内容底部安全区 |
| `LAYOUT.topBarH` | 52 | 顶栏高度 |

已处理：`Home` / `Transactions`（流水 + 日历两个 Scroll）/ `Reports` / `Profile`。

### 更普遍的教训

**半透明化是有连带成本的**。任何一处从不透明改半透明，都要回头检查
「原来靠这块不透明色挡住的东西，现在会不会露出来」。这类问题编译期
零信号，只有真机能发现。

---

## 18. ⛔ 图表与数据可视化红线

真机 QA 一次抓出 4 个图表问题，全部是「编译通过但读不出信息」。

### 18.1 不要用后端 `category.color` 当颜色

后端 `category.color` / `tag.color` 是历史遗留字段，存的是高饱和值
（大量亮绿 `#4CAF50` 系），而且**多数类目为 null**。

```ts
// ❌ 记一笔页面：整屏 40 个亮绿圆底，与暖棕品牌完全冲突
CategoryIcon({ bg: c.color || COLORS.brandBgLight })

// ❌ 统计页饼图：多数类目 color 为 null → 全部回落同一个 brand
//    → 环图渲染成一个纯棕色圆环，完全没有分色
color: c.color || COLORS.brand

// ✅ 图标：不传 bg，用 iconBgNeutral 暖色中性底；选中态用 selected prop
CategoryIcon({ icon: c.icon, selected: this.catId === c.id })

// ✅ 饼图：不传 color，让组件按 index 取 SLICE_PALETTE（莫兰迪 10 色）
{ name: c.name, value: c.total, icon: c.icon }
```

好处是环图和下方 `CategoryBars` 排行条**同 index 同色**，图例关系天然成立，
不需要额外画图例。

`SLICE_PALETTE` 相邻色单通道差 18~51（全部 ≥12 可辨），另有 2px 卡片色
分隔线兜底。

### 18.2 折线图必须有轴

原 `TrendChart` 只画了一条基线：没有 Y 轴金额刻度、没有 X 轴日期，
`labels` prop 声明了却**从未使用**，调用方也从没传过。
31 个数据点挤在 340px 里 —— 是「好看的装饰」，不是图表。

必须有的四件事：

1. **非对称内边距**：左 44 给 Y 轴刻度、底 22 给 X 轴。四边统一 pad 则刻度无处可画
2. **Y 轴刻度用「好看」的上限**：`niceCeil()` 把 20904 提到 50000，而不是拿 max 直接当轴顶
3. **X 轴只标首/中/尾**：31 天全标一定重叠
4. **点数多时只画峰值点**：`n > 14` 时其余点不画，否则糊成一条珠链；峰值加白描边 + 数值标注

### 18.3 Grid 在 Scroll 里不要写 `rowsTemplate`

```ts
// ❌ 无高度约束的 Scroll 内，Grid 会把两行按可用高度均分
//    → 4 张 KPI 卡上下两组之间撑出巨大空白（真机截图里非常明显）
.columnsTemplate('1fr 1fr').rowsTemplate('1fr 1fr')

// ✅ 只给列模板 + 显式高度
.columnsTemplate('1fr 1fr').rowsGap(10).columnsGap(10).height(184)
```

### 18.4 窄格金额必须去小数

`formatCompact()` 在 1 万以下输出两位小数：`3458.00` 是 7 个字符，
日历格宽度只有屏宽 1/7 ≈ 50px，必然溢出。

日历里的小数**没有信息价值** —— 用户看日历是找「哪天花得多」，不是核对分位。

用 `formatCalAmount()`：`>=1万 → 3.5万` / 其余取整。
同时格高从 48 提到 54（三行 13+9+9 + 行间 2 + padding 10 = 43，留 11px 余量），
两个金额行都要加 `textOverflow: Ellipsis` 兜底。

---

## 19. ⛔ 改了公共组件 ≠ 改了产品

这是 §15「背景统一不只是有 AppBackground」的**孪生规则**，两轮踩了同一个坑。

阶段 5 把 `Card` / `RowItem` / `StatKpiCard` 等公共组件改成半透明后，
以为「表面层级」这件事就完成了。阶段 6 一 grep 才发现：

```
Budgets.ets        Card 组件 = 0 次   手拼 backgroundColor(COLORS.card) = 3 处
Category.ets       Card 组件 = 0 次   手拼 = 2 处
Tags.ets           Card 组件 = 0 次   手拼 = 2 处
SavingsGoals.ets   Card 组件 = 0 次   手拼 = 3 处
Investments.ets    Card 组件 = 0 次   手拼 = 2 处
Debts.ets          Card 组件 = 0 次   手拼 = 2 处
AddTransaction.ets Card 组件 = 0 次   手拼 = 4 处
AiScan.ets         Card 组件 = 0 次   手拼 = 1 处
```

**8 个二级页一个都没用 `Card` 组件**，全是各自手拼。组件改了半透明，
产品里 24 处卡片依然是不透明白底 —— 环境光背景被一块块白色补丁切碎。

同类落地缺口还有：`toast()` 工具函数写好后，全项目只有 1 个页面在调用。

### 规则

改动任何公共组件的**视觉属性**（底色、透明度、圆角、间距）后，必须做两步验证：

```bash
# 1. 谁在用这个组件？
grep -rn "Card({" entry/src/main/ets/pages/ | wc -l

# 2. 谁在绕过它手拼同样的东西？
grep -rn "backgroundColor(COLORS.card)" entry/src/main/ets/
```

第 2 步比第 1 步重要。**手拼的调用方不会因为组件改了而受益，但会因为组件改了而变得不一致。**

### 手拼卡片底的正确写法

不强求所有页面都改用 `Card` 组件（有些卡片带自定义头部/嵌套结构，
硬套组件反而绕），但底色必须走同一个 token：

```ts
// ❌ 不透明白底，把环境光背景切出一块补丁
.backgroundColor(COLORS.card)
.borderRadius(RADIUS.lg)

// ✅ 半透明 + 0.5px 描边（描边补回失去的边界感）
.backgroundColor(COLORS.cardGlass)
.borderRadius(RADIUS.lg)
.border({ width: 0.5, color: COLORS.outlineVariant })
```

### 哪些表面**故意**保持不透明（不要顺手改）

判据：**卡片表面** → 半透明；**输入控件 / 弹层 / 实体按钮** → 不透明。

| 组件 | 为什么保持不透明 |
|---|---|
| `DropdownField` / `DatePickerField` / `DateTimePickerField` | 输入控件需要明确的「可点区域」边界，半透明会让它看起来像装饰 |
| `SecPickerDialog` / `BookSwitcherSheet` / `ConfirmDialog` | 弹层的职责就是**遮挡下层 + 聚焦**，透出内容与职责矛盾 |
| `FloatingButton` | 实体按钮，浮在内容上方需要绝对可见 |

阶段 6 复核了 13 处不透明表面，全部属于上表情形，无需改动。

---

## 20. ⛔ 交互完整性：状态、反馈、确认

阶段 6 的另一半工作与配色无关 —— 是**功能层面的系统性缺失**。
这类问题编译零信号、静态看代码也不显眼，但用户一定会撞上。

### 20.1 loading 骨架屏三要素

7 个页面（`Accounts` / `Budgets` / `Category` / `Debts` / `Investments`
/ `SavingsGoals` / `Tags`）写了 `LoadingBox` 分支，但**永远不会进入**：

```ts
// ❌ 初值就是 false → 骨架屏分支永不命中，首屏是「空白闪现」
@State loading: boolean = false;

async load() {
  try {
    this.items = await api.list();
  } catch (e) { /* ... */ }
  // ❌ 没有 finally，异常路径下 loading 永远不复位
}
```

正确写法必须**同时**满足三点：

```ts
// 1) 初值 true（首帧就该是骨架屏）
@State loading: boolean = true;

async load() {
  this.loading = true;          // 2) 每次刷新都重新置 true
  try {
    this.items = await api.list();
  } catch (e) {
    toastLong('加载失败：' + (e as Error).message);
  } finally {
    this.loading = false;       // 3) finally 复位，异常也要退出骨架屏
  }
}

// 4) 渲染分支
if (this.loading) { LoadingBox() } else if (!this.items.length) { EmptyStateV2(...) } else { ... }
```

**三个初值都写成 `false` 说明这是模板复制的系统性错误，不是个别疏漏。**
新增列表页时照抄上面这段。

#### `loading` 有两种语义，不要一刀切改 true

同一个变量名承担两种含义，改之前必须先分清：

| 语义 | 判据 | 初值 |
|---|---|---|
| **首屏加载中** | `aboutToAppear()` 里直接调 `load()` / `doSearch()` | `true` |
| **某个动作进行中** | 由用户点击触发（OCR 识别、数据导入、表单提交） | **必须 `false`** |

后者若初值给 `true`，一进页面就假装在忙，比原来的 bug 更糟。

已登记（改动前先查这张表）：

```
初值 true（13 页，首屏立即拉数据）：
  AccountDetail / Accounts / Budgets / Category / Debts / InvestmentDetail
  Investments / Reports / SavingsGoals / Tags / Transactions / Search / Home

初值 false（4 页，「动作进行中」语义）：
  AiScan（OCR 识别中）/ DataManagement（导入中）
  AddTransaction（提交中）/ Login（登录中）
```

⚠️ 阶段 6 第一遍只改了 `load()` 里的 `this.loading = true` 和 `finally`，
**漏掉了 `@State` 初值**，13 个页面的骨架屏依然永不命中 ——
grep `loading: boolean = false` 才发现。改这类"三要素"务必逐项 grep 复核，
不能因为改完了两项就认为整件事完成了。

### 20.2 写操作必须有 toast 反馈

全项目曾有 22 处：

```ts
// ❌ 用户点了保存，网络失败 —— 界面零反应，看起来就像 App 卡死
try { await api.save(x); await this.load(); } catch (e) { /* ignore */ }

// ❌ 校验不通过静默 return —— 用户不知道该填哪一栏
if (!this.fName) return;
```

规则：

| 场景 | 必须做 |
|---|---|
| 保存 / 新增 / 更新成功 | `toast('已保存')` |
| 删除成功 | `toast('已删除')` |
| 任何失败 | `toastLong('保存X失败：' + (e as Error).message)`（要带原因，长时） |
| 表单校验不通过 | `toast('请填写X名称')`，**禁止静默 return** |

`Debts.ets` 原本**完全没有校验** —— 名称空着也能提交。

#### 读操作可以静默，写操作不行

不是所有 `catch` 都该弹 toast。判据是**这次失败用户需不需要知道**：

```ts
// ✅ 读失败静默降级：首页某张卡片拉不到数据，不显示即可，弹 toast 是打扰
async loadGoals() {
  try { this.goals = await api.getSavingsGoals(); }
  catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
}

// ❌ 写失败静默：用户以为存进去了，实际没有 —— 涉及金额时后果更严重
async doAlloc() {
  try { await api.allocateSavings(id, { amount }); }
  catch (e) { /* ignore */ }
}
```

**注释必须写明「静默是有意的」**，只写 `/* ignore */` 下次排查一定会被当成遗漏。
项目里保留的 6 处静默全部是读操作，注释已统一改成
`/* 读失败静默降级：该区块不显示即可，不打扰用户 */`。

#### 批量写操作要报「部分成功」

`AiScan.ets` 批量入账原先逐条 `catch` 吞掉，然后**无条件 `router.back()`**
—— 选了 10 条只成 3 条，用户毫不知情就被送回上一页。

```ts
let failed = 0; let lastErr = '';
for (const r of picked) {
  try { await api.createTransaction(...); this.done++; }
  catch (e) { failed++; lastErr = (e as ApiError).message; }
}
if (failed === 0) { toast('已入账 ' + this.done + ' 笔'); router.back(); }
else if (this.done > 0) {
  // 部分成功：停在当前页，让用户看到还剩哪些没成 —— 不要 back()
  toastLong('已入账 ' + this.done + ' 笔，' + failed + ' 笔失败：' + lastErr);
} else { toastLong('入账失败：' + lastErr); }
```

关键是**部分成功时不要跳走**。跳走等于让用户去别处猜哪几条丢了。

### 20.3 破坏性操作必须有 ConfirmDialog

5 个页面（`Category` / `Tags` / `Budgets` / `Debts` / `SavingsGoals`）
的删除是**点一下就删**。垃圾桶图标 16px，紧挨编辑图标（间距 14px）——
误触代价是数据永久丢失。

统一走 `ConfirmDialog`（`Components.ets`，阶段 6 新增，同时收口了
`InvestmentTransactions.ets` 里 18 行的内联重复实现）：

```ts
@State pendingDelete: CategoryType | null = null;

// 删除入口只置 state，不直接执行
Image($r('app.media.ic_delete'))
  .onClick(() => { this.pendingDelete = c; })

// 页面栈顶挂弹窗
ConfirmDialog({
  show: this.pendingDelete !== null,
  title: '删除类目',
  // ✅ message 必须带具体名称，让用户确认「删的是不是那一个」
  message: '删除「' + (this.pendingDelete?.name ?? '') + '」后无法恢复',
  confirmText: '删除',
  onConfirm: () => { const t = this.pendingDelete; this.pendingDelete = null; if (t) this.remove(t); },
  onCancel: () => { this.pendingDelete = null; },
})
```

要点：
- message **带具体名称**，`确定删除吗？` 无法帮用户识别误触
- 遮罩 55% 黑（`withAlpha('#000000', 0.55)`）。40% 时弹窗与背景对比仅 3.21:1，聚焦不足；55% 达 5.25:1
- 点遮罩空白处 = 取消（比只能点按钮更顺手）

---

## 21. ⛔ 前景色与填充色必须是两个 token

`danger` 一个 token 撑两种用途，两边都不达标：

| 用法 | 对比度 | 结论 |
|---|---|---|
| `danger #E54D42` 上放白字（实心删除按钮） | **3.84:1** | ✗ 不达 AA 4.5:1 |
| `danger #E54D42` 作删除图标画在卡片上 | **3.64:1** | ✗ 偏浅 |

直接把 `danger` 压深能救按钮，但图标会显闷（前景色压深 = 视觉变脏）。
所以拆成两个：

```ts
// 前景场景：删除图标、警示文字、错误提示文案
danger:       '#E54D42'   // 亮色
// 填充场景：实心破坏性按钮的背景
dangerStrong: '#CC3E35'   // 亮色 → 白字 4.87:1 ✓
```

### 暗色模式要镜像对称，不是简单调亮

暗色下 `onError` 是**深色**（与亮色相反），所以填充色要往**亮**走：

```
亮色：深底红 #CC3E35 + 白字   → 4.87:1
暗色：亮底红 #F2607A + 深字   → 5.86:1
```

写任何一对「填充 + 其上文字」的暗色值时，先确认 `onXxx` 在暗色下是什么明度，
不要照着亮色的思路平移。

---

## 22. ⛔ `border({ width: 1 })` 会画四条边

```ts
// ❌ 想画一条底部分隔线，实际画了闭合矩形的四条边
// 无 borderRadius 时，左右两条竖线在连续列表里会与相邻项叠成 2px 粗线
Row() { ... }
.border({ width: 1, color: COLORS.divider })
```

`RowItem` 就是这么写的，真机上列表左右两侧多出两条竖线。

规则：

```ts
// ✅ 只要分隔线 → 显式指定单边
.border({ width: { bottom: 1 }, color: COLORS.divider })

// ✅ 要闭合边框 → 必须同时有 borderRadius，四边全画才是对的
.border({ width: 0.5, color: COLORS.outlineVariant })
.borderRadius(RADIUS.lg)
```

判据：**有 `borderRadius` 的四边全画 = 正确；没有 `borderRadius` 的四边全画 = 八成是想画分隔线写错了。**

---

## 23. 用户可选调色板：饱和度一致性 > 颜色丰富度

`Tags.ets` 和 `Category.ets` 各自维护一份本地 `PALETTE`，内容是**两套体系混装**：

```
前 7 个：S = 63~100%   高饱和（老版 Material 风）
后 3 个：S = 8~13%     莫兰迪（后来从 SLICE_PALETTE 抄的）
                      ↓
        饱和度极差 92 —— 用户随手选两个色，画面必然打架
```

**调色板本身在诱导用户做出难看的选择。** 这不是用户的问题。

统一收口到 `theme.ts` 的 `USER_PALETTE`（10 色）：

| 色值 | 名称 | 色值 | 名称 |
|---|---|---|---|
| `#C8A184` | 暖棕 | `#9DC2B4` | 青瓷 |
| `#D3A19C` | 赭红 | `#9FB8C9` | 雾蓝 |
| `#DFB795` | 橘杏 | `#BCAECB` | 藕紫 |
| `#D6C48F` | 芥黄 | `#D4A8BC` | 玫粉 |
| `#B8C098` | 橄榄 | `#BFB8B0` | 石灰 |

四项量化指标（新增色时必须复核）：

1. **饱和度一致**：S 统一 8~34%（极差 26，旧板 92）
2. **明度一致**：V 75~87%
3. **相邻可辨**：相邻色单通道差 13~30（全部 ≥12）
4. **其上 emoji / 文字可读**：与深色文字对比 4.81~6.58:1

新增用户可选色时，先算 HSV 落在上面区间内再加。**极差是设计缺陷指标，不是丰富度指标。**

---
## 24. ⛔ 多列等分布局：字号与对齐必须按列数分档

一张卡里横向排 N 列「标签 + 数值」时，**列数变了字号和对齐都要跟着变**，不能只改列数。

### 判据一：先算列宽，再定字号

360vp 屏，卡片左右 margin 16×2、内 padding 20×2，可用宽 **288vp**：

| 列数 | 每列宽 | 数值可用字号 | 依据 |
|---|---|---|---|
| 2 | 144vp | 14sp | 宽松 |
| 3 | 96vp | 14sp | 刚好 |
| **4** | **72vp** | **12sp** | 14sp 下 `¥20,904.00` 截断成 `¥20,90…` |

```ts
Text(c.value)
  .fontSize(this.bottomCells.length >= 4 ? 12 : 14)
  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
```

**数字被截断比字小一号严重得多** —— 小一号还能读，截断直接读不出这是多少钱。
金额类数值宁可缩字号，绝不允许 `Ellipsis` 真的生效。

### 判据二：末列必须右对齐

`layoutWeight(1)` 等分下如果所有列都 `HorizontalAlign.Start`，最后一列右侧会空出
「列宽 − 文字宽」的空白，卡片**左边缘齐平、右边缘不齐**，看着像排版塌了半边。

```ts
.alignItems(idx === this.bottomCells.length - 1
  ? HorizontalAlign.End : HorizontalAlign.Start)
```

（Compose 侧用 `Arrangement.SpaceBetween` + 每列 `CenterHorizontally` 达到同样效果，
ArkUI 的 `FlexAlign.SpaceBetween` 在列宽不等时会让列间距不均，故用 weight + 末列右对齐。）

---

## 25. ⛔ 嵌套圆角：内圆角 = 外圆角 − padding

分段控件、Chip 组、任何「槽 + 内部滑块」结构，内圆角必须是算出来的，**不能随手取 token**。

```ts
// 槽
.padding(3)
.borderRadius(RADIUS.md)     // 12

// 内部滑块
.borderRadius(9)             // 12 − 3 = 9，硬编码
```

用 `RADIUS.sm`(8) 只差 1px，但滑块会看起来**比槽更圆**、四周留白不均。
这是嵌套圆角的同心条件，不是可以近似的地方。**注释里写清算式**，否则下次会被
「统一用 token」的好意改坏。

---

## 26. ⛔ 占位数据不要跨端照抄

对齐另一端实现时，**先分辨这是「设计」还是「没做完」**。

实例：安卓 `SummaryCard` 的「本月预算 / 本月剩余」两列是 `KpiCell("${prefix}预算", 0.0)`
—— 硬编码 0.0 的占位。照抄过来就是：界面上写着「本月预算」，永远显示 ¥0.00。

**这比不显示这两列更糟** —— 用户会以为自己没设预算，而不是以为 App 没做。

正确做法是接真实数据，同时处理边界：

```ts
/** 没设预算时返回 0 而不是负数 —— 预算为 0 时「剩余 -1692.67」是错的，
 *  那不叫超支，那叫没设预算。 */
budgetRemain(): number {
  if (this.budgetTotal <= 0) return 0;
  return this.budgetTotal - this.budgetSpent;
}
```

聚合口径也要在注释里交代死：只统计 `period === '月'` 的预算，
年度/自定义周期摊到当月没有确定算法，混进来「本月预算」这个数就失去含义。

### 连带规则：新增数据请求不要并进主 Promise.all

```ts
finally { this.loading = false; }
this.loadBudget();       // 单独发，失败不拖累主列表
```

装饰性/补充性数据失败时，主内容必须照常显示。

---

## 27. ⛔ 跨端对齐时先查另一端有没有同类 bug

用户给的安卓截图上写着 `¥ ¥21,201.34` —— `formatMoney()` 自带 `¥` 前缀，
调用处又拼了一个 `"¥ ${formatMoney(x)}"`。全仓 grep 找到 3 处（
`TransactionsScreen.kt:422`、`Components.kt:179`、`Components.kt:236`）。

**对齐工作天然是双向的**：既然已经在逐像素比对两端，顺手把发现的对端 bug 修掉，
成本几乎为零。只改自己这端、明知对端有 bug 不动，下一轮还会被同一张截图问一次。

---
## 28. ⛔⛔ 稀疏数据不能当连续数组用（本项目最严重的一类 bug）

**这是本项目出现过的最严重视觉 bug，而且它不是视觉问题，是数据问题。**

### 事故复盘

日历网格显示成「7月 1 **3** 4 5 6 7」—— 2 号凭空消失，整月日期与星期列全部错位。

原因链：
1. 服务端 `/stats/calendar` 用 `GROUP BY CAST(date AS CHAR(10))` 返回 `monthDays`
   —— **只包含有交易的日期**，2 号没记账就没有 2 号这条
2. `buildMonthCells` 用 `days.forEach(d => cells.push(...))` 直接把返回项铺成格子
3. 结果：网格里 1 号后面直接接 3 号，当月总格数变少，后续全部左移
4. 附加错误：`firstW` 用 `days[0].date` 推首列偏移 —— 1 号没记账时会拿 2 号去算

### 判据：聚合接口的返回一律视为稀疏

**只要 SQL 里有 `GROUP BY`，返回的就是稀疏集合，不是连续序列。**
凡是「按天 / 按月 / 按类目」聚合的接口，都不能假设它每个槽位都有值。

```ts
// ❌ 把返回项当连续序列铺进网格
days.forEach((d) => cells.push({ day: parseDay(d.date), ... }));

// ✅ 骨架自己算，返回值只当查表用
const incByDate = new Map<string, number>();
days.forEach((d: ESObject) => { incByDate.set(String(d.date), Number(d.income) || 0); });

const first = new Date(year, month - 1, 1);      // 首列偏移看日历，不看数据
for (let d = 1; d <= daysInMonth(year, month); d++) {
  const key = `${year}-${mm}-${String(d).padStart(2, '0')}`;
  cells.push({ day: d, date: key, income: incByDate.get(key) ?? 0, ... });
}
```

**「结构由日历/枚举决定，数值由数据决定」** —— 这两件事必须分开算。
同理适用于：月度柱状图（某月无数据不能跳过那根柱）、类目饼图占比、
连续日期的折线图 X 轴。

### 连带教训：公共函数出 bug，影响面 = 所有调用方

`buildMonthCells` 有两个调用方（`Home.ets:779` 首页日历、`Transactions.ets` 账单页日历），
**同一个错位 bug 在首页也一直存在**，只是首页日历格子小、用户没注意。

修公共函数前先 `grep` 一遍调用方，报告里要说清「顺带修好了哪几处」。

### 附带：残日补齐按整周，不要硬凑 42

```ts
// ❌ const need = 42 - cells.length;
// ✅
const rows = Math.ceil(cells.length / 7);
const need = rows * 7 - cells.length;
```
2 月 28 天且从周一开头时只需 4 行，硬补到 42 会拖出两整行纯灰空白。

### ArkTS 限制：Map 泛型实参不能用 ESObject

```ts
const m = new Map<string, ESObject>();   // ❌ arkts-no-any-unknown
const inc = new Map<string, number>();   // ✅ 拆成多个基础类型 Map
const exp = new Map<string, number>();
```

---

## 29. ⛔ 可点元素必须有可见的点击结果

日历格子原实现：`onTap: () => { this.selectedDate = c.date }`，
下方列表始终 `ForEach(this.items)` 列全月流水。

**点下去除了换个高亮，页面内容一个字没变。** 用户点两下发现「没反应」，
就会认定日历是不能点的装饰图，从此再也不点。

### 三条硬性要求

**① 点击必须改变内容，不只改变外观**

```ts
if (this.selectedDate !== '') {
  // 汇总行 + 当天流水
} else {
  Text('点击日期查看当天账单')   // 未选中时明说可点，而不是默默列全月
}
```

未选中态**不要直接展示「全部」** —— 那样点击前后看起来差不多，
用户读不出「刚才那一下起了作用」。

**② 单选态必须可取消**

```ts
onTap: () => {
  this.selectedDate = (this.selectedDate === c.date) ? '' : c.date;
}
```
否则选了某天就再也回不到全月视图，只能切 tab 绕一圈。
凡是「点一下进入过滤态」的交互，都要能原地退出。

**③ 上下文变化时清掉选中态**

```ts
changeMonth(delta: number) {
  this.month = ...;
  this.selectedDate = '';   // 选的是 8-20，切到 9 月后这日期已不存在
  this.load();
}
```
`pickMonth()` 里同样要清 —— **两个入口都改，不要只改一个**。
不清的后果是汇总行显示「2026-08-20 收 ¥0 支 ¥0」这种跨月空数据。

---

## 30. ⛔ 金额取整要分档：小额的小数位是信息，大额的不是

日历格宽只有屏宽 1/7（约 46vp），9sp 下最多 6 字符，必须缩写。
但缩写方式不能一刀切：

```ts
export function formatCalAmount(v: number): string {
  const n = Math.abs(Number(v) || 0);
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n < 100) return n.toFixed(2);        // 5.47 —— 分位必须留
  return n.toFixed(0);                      // 1045 —— 分位可以丢
}
```

**为什么 100 以下必须保留小数**：全局 `toFixed(0)` 会把「0.50」显示成「1」
（四舍五入还变错了）、「5.47」显示成「5」。而早餐 9 块、零食 5.47 这种小额
恰恰是记账最高频的场景 —— 取整等于**显示了一个错数字**。

**为什么 100 以上可以丢**：`1045` vs `1045.10`，用户看日历是找「哪天花得多」，
量级已经足够，多两个字符换不来任何判断力。

判据一句话：**数值本身量级越小，小数位的信息占比越高。**

（安卓端 `formatCompact` 统一 `toFixed(2)`，8sp 下 7 字符刚好塞进；
鸿蒙字号大 1 塞不下，这是刻意不照抄的地方 —— 见 §26。）

---

## 31. ⛔ 网格/列表类内容必须有卡片边界

日历网格原先裸铺在页面背景上：星期表头「一二三四五六日」和下方格子之间
没有任何边界，整体读起来像「一堆排列整齐的按钮」，而不是「一张月历」。

```ts
Column({ space: 4 }) {
  // 星期表头
  // 格子网格
}
.padding(12)
.backgroundColor(COLORS.cardGlass)
.borderRadius(RADIUS.lg)
.border({ width: 0.5, color: COLORS.outlineVariant })
.shadow({ radius: 8, color: COLORS.shadowAmbient, offsetY: 2 })
```

**判据**：一组元素在语义上是「一个整体对象」（一张月历、一份报表、一组统计）时，
必须有容器把它框起来。只有「同级并列的多个独立条目」才可以裸列。

---

## 32. ⛔ 系统选择器不是「免费的正确答案」

`DatePickerDialog` / `TimePickerDialog` 用起来只有几行，但它是**系统外观 + 系统语义**，
两者都可能和当前场景对不上。账单页选月份原先就是直接调它：

```ts
// ✗ 账单页选月份用系统日期滚轮
DatePickerDialog.show({ start, end, selected, onAccept: (v) => { ... } });
```

三处不对：

| 问题 | 表现 |
|---|---|
| **语义多余** | 滚轮是「年 / 月 / **日**」三列，而这里要选的是一个月。选 8月1日 和 8月31日 结果完全一样，用户却被迫为「日」做一次无效决策 |
| **配色外来** | 系统蓝在整套暖棕（`#995F2C`）配色里是异色，弹出来像是另一个 app 的界面 |
| **多一步操作** | 滚到位 → 点「确定」，两步；月份网格 12 个格子全可见，点一下即完成 |

改为自绘 `PeriodPickerSheet`（底部弹层 + 4×3 月份网格，点击即确认）。

**判据（何时可以用系统选择器）**：
- 选择范围大且无法穷举（选任意一天：365 个选项，网格放不下）→ 用系统滚轮，如
  `DatePickerField` / `DateTimePickerField`（记一笔账要精确到秒，滚轮是对的）
- 选项可穷举且数量 ≤ 约 16 个（12 个月、12 个年份）→ 自绘网格，一屏全见、一击即中

**不要因为「系统组件更省事」就接受它带来的语义冗余和视觉断裂。**

---

## 33. ⛔ 补新维度时要顺着查一遍所有依赖它的计算

给账单页加「按年查看」时，`month` 字段的取值从 `'YYYY-MM'` 变成了可能是 `'YYYY'`。
这一个变化牵连出四处必须同时改的地方 —— 漏掉任何一处都是运行时崩溃或静默错数：

| 位置 | 不改会怎样 |
|---|---|
| `changeMonth(delta)` | 顶部写着「2026年」时点 ›，跳到「2026年9月」而不是「2027年」 |
| `getStatsCalendar(y, m)` | `'2026'.split('-')[1]` 是 `undefined` → `Number()` 得 `NaN` → 整张日历网格算不出来 |
| 切到日历视图 | 月历网格没有「整年」形态，必须强制退回按月并补一个月份 |
| 汇总卡标签 | 四列还写着「本月支出」，而数据是整年的 → **界面在说谎** |

**判据**：新增一个「模式 / 维度 / 开关」时，用被它改变的那个字段名全局搜一遍
（这里是 `this.month`），逐个确认每处调用在新模式下的行为。
**能编译通过 ≠ 新维度接好了。**

---

## 34. ⛔ 放宽 limit 前先确认列表是不是懒加载

给「按年查看」拉数据时的第一反应是把 `limit` 从 500 提到 2000 —— 整年嘛，500 条不够。
但账单列表是 `Scroll + ForEach`（**全量建节点**），不是 `LazyForEach`：
2000 行会在切到按年的瞬间一次性建出来，卡死主线程。

```ts
// ✗ 想当然地放宽
Api.getTransactions({ month: this.month, limit: isYear ? 2000 : 500 })

// ✓ 维持上限，改为在列表末尾明示截断
Api.getTransactions({ month: this.month, limit: TX_LIMIT })
...
if (this.truncated()) {
  Text(`仅显示最近 ${TX_LIMIT} 笔，切到「按月查看」可看全部`)
}
```

**截断必须说出来**：顶部汇总卡的合计来自服务端 `SUM`（不受 limit 影响），
列表却被截断 —— 两个数字对不上而没有任何解释，比少显示几条严重得多。

**判据**：改 `limit` 之前先看渲染方式。`ForEach` → 不要放宽，改为明示截断或换 `LazyForEach`。

---

## 35. ⛔ 分组粒度要随时间跨度变

同一份 `groups()` 在按月和按年下要用不同粒度：

```ts
const byMonth = this.periodMode === 'year';
const k = (it.date || '').slice(0, byMonth ? 7 : 10);   // 'YYYY-MM' / 'YYYY-MM-DD'
```

按年仍按天分组会分出 300+ 个日期 header，屏幕上近一半的行都是分组标题 ——
那已经不是「一份流水」而是一张日期清单。而按年的真实诉求是「哪个月花得多」，
按月分组正好回答这个问题。

**判据**：分组粒度应让**分组数量落在 10~40 之间**。超过就该升一级粒度（日→月→季）。

---

## 36. ⛔ 子组件接异步数据的字段必须是 @Prop，ForEach 的 key 必须包含会变的值

这是本项目出现过的**最隐蔽的一类 bug**：编译无错、无警告、逻辑正确、数据也真的拉回来了，
但界面上那部分内容**永远停在首帧的空值**。

### 症状

首页日历格子里的金额一直不显示（全空），而同一个组件在账单页里是正常的。

### 根因（两个独立缺陷叠加）

**缺陷一：子组件用普通成员变量接数据**

```ts
@Component
export struct SharedCalendarCell {
  cell: CalCell = { kind: 'EMPTY' };   // ❌ 普通成员：只在节点创建时赋值一次
}
```

普通成员变量不建立状态同步链路。父组件重渲染时，ArkUI 不会把新值写进已存在的子节点。

**缺陷二：ForEach 的 key 不含会变化的字段**

```ts
}, (c: CalCell) => c.kind + (c.date ?? ''))    // ❌ 只有 kind + 日期
```

日历数据是异步拉的：

| 时刻 | `this.cal` | 格子金额 | ForEach key |
|---|---|---|---|
| 首帧 | `null` | 全 0 | `CURRENT2026-08-01` |
| 数据到位 | 有值 | 有金额 | `CURRENT2026-08-01` ← **一模一样** |

key 没变 → ForEach 判定「该节点无变化」→ 不重建；普通成员又不会被更新
→ 格子永远是首帧那份 0。**两个缺陷各自都能被另一个掩盖**，所以必须同时修。

### 为什么账单页没暴露

```ts
if (this.loading) { LoadingBox() }
else { this.CalendarView() }        // loading 期间根本不建日历节点
```

数据到位后 `loading` 翻转，整个 `CalendarView` 首次创建，此时 `cell` 已有金额。
**这是侥幸躲过，不是正确实现** —— 一旦有二次刷新（切账本、翻月）同样会中招。

### 正确写法

```ts
// 1) 所有承载「会变化的数据」的入参都要 @Prop
@Prop cell: CalCell = { kind: 'EMPTY' };
@Prop isSelected: boolean = false;
@Prop isToday: boolean = false;
onTap?: () => void;                 // 回调不参与状态同步，保持普通成员

// 2) key 编入所有会变的值
export function calCellKey(c: CalCell): string {
  const id = c.date ?? c.dayLabel ?? (c.day !== undefined ? c.day.toString() : '');
  return `${c.kind}_${id}_${c.income ?? 0}_${c.expense ?? 0}`;
}
```

### 判据（写子组件时逐条过）

1. 这个入参的值**会在组件生命周期内变化**吗？会 → `@Prop`（或 `@Link`/`@ObjectLink`）
2. `ForEach` 的 key 是否包含了**所有会变化且影响渲染的字段**？
3. 反向自查：**「这个组件在 loading 分支保护下才正常」本身就是缺陷信号** ——
   正确的组件不该依赖「父层恰好在数据到位后才创建我」。

### 复现记录：同一个坑第二次出现在 `TrendChart.peakIndex`

统计页改造时发现 `TrendChart` 的 `peakIndex` 是普通成员：

```ts
peakIndex: number = -1;                          // ❌
@Prop @Watch('redraw') peakIndex: number = -1;   // ✅
```

表现：用户点折线换选中日 → 父组件 `@State trendSel` 变了、父组件确实重渲染了，
但 `TrendChart` 内部的高亮点**不动**。用户会连点几下，然后认为图表不可交互。

Canvas 类组件比普通组件更容易漏，因为它还要额外挂 `@Watch` 触发重绘 ——
**光加 `@Prop` 不加 `@Watch` 一样不动**（值同步了但没人调 `redraw`）。

**追加判据**：Canvas / 自绘组件的每一个影响绘制的入参，
必须同时具备 `@Prop` **和** `@Watch('redraw')` 两者，缺一个都是静默失效。

---

## 37. ⛔ 同一份状态只能有一个真源，派生显示不要反读异步结果

首页日历原本这么写：

```ts
Api.getStatsCalendar(new Date().getFullYear(), new Date().getMonth() + 1)   // ❌ 写死当月
```

而网格是 `buildMonthCells(this.month …)` 铺的，`changeMonth()` 改的也是 `this.month`。
两边不同源 → 翻到 7 月时**网格按 7 月铺格、金额还是 8 月的**，
数字落在错误的日期上 —— 比不显示更糟，因为用户会当成真数据。

标题同理：

```ts
Text(`${this.cal?.year}年${this.cal?.month}月`)   // ❌ 反读异步返回值
```

`cal` 是请求结果，翻月后新数据到位前它还是上个月的 —— 标题会先显示旧月份再跳一下，
而网格早已切好，两者短暂矛盾。

**判据**：`this.month` 这类导航状态是**唯一真源**，
① 发请求的参数、② 网格计算、③ 标题显示 全部从它派生；
异步返回值只用来填充**数值**，绝不用来反推**当前处于哪个周期**。

---

## 38. ⛔ 一行多项时先算宽度账，`layoutWeight` 决定谁被牺牲

**症状**：账单页日历视图选中某天，汇总行的日期断成两行 —— `2026-08-2` / `8`。

### 先算账，不要凭感觉

360vp 屏，日历视图内容可用宽 = 360 − 12×2（页面）− 12×2（卡片）= **328vp**。
再减行内 `padding({left:4,right:4})` = 320vp。原实现需要：

| 元素 | 内容 | 字号 | 宽度 |
|---|---|---|---|
| 日期 | `2026-08-28` | 15sp | ~83vp |
| 收 | `收 ¥19,023.00` | 12sp | ~82vp |
| 间距 | | | 12vp |
| 支 | `支 ¥1,797.00` | 12sp | ~75vp |
| 间距 | | | 12vp |
| 结余 | `结余 +¥17,226.00` | 12sp | ~101vp |
| **合计** | | | **365vp** |

超 45vp。**这不是「有点挤」，是必然溢出**，只要金额上万就一定发生。

粗算口径（够用）：中文全角 ≈ 字号 ×1.0，数字/字母/`¥`/`,`/`.` ≈ 字号 ×0.55。

### `layoutWeight(1)` 是在指定「谁去承受不够的部分」

```ts
Text(this.selectedDate).fontSize(15).layoutWeight(1)   // ❌ 日期成了唯一被压缩者
Text('收 ' + fmtMoney(...)).fontSize(12)                // 内容宽，不让
```

`layoutWeight(1)` 的含义是「你吃剩下的空间」。剩余空间是负的时候，
它就变成「**你被压到装不下也得认**」—— 320 − 258 = 62vp，
日期只剩 62vp 装 10 个字符，于是换行。

**同一个 Row 里，`layoutWeight` 必须给「可以被截断且截断后仍可读」的元素**
（比如商家名、备注）。日期、金额都是**不可截断信息**，一个字符都不能少，
不该挂 `layoutWeight`。

改用 `Blank()` 顶开：右侧各项按内容取宽，日期也按内容取宽，
空间由中间的 `Blank` 吸收 —— 没有任何元素被迫压缩。

### 三处同时改，少一处仍然溢出

```ts
Text(fmtDayLabel(this.selectedDate))         // ① 83 → 53vp（8月28日）
  .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
Blank()                                      // ③ 由它吸收剩余空间
Text('收 ' + fmtMoneyShort(inc))             // ② 82 → 62vp（¥1.90万）
Text('支 ' + fmtMoneyShort(exp)).margin({ left: 10 })
Text('结余 ' + this.dayBalanceLabel()).margin({ left: 10 })
```

改完 53 + 62 + 10 + 55 + 10 + 74 = **264vp**，余量 56vp。

**① 缩短日期不是妥协，是删掉真正冗余的信息。**
这个标签出现在「月份导航已写明 2026年8月」的上下文里，
再写一遍年份 = 用 4 个字符表达 0 比特。`fmtDayLabel` 只在
传入 `'YYYY-MM'`（按年查看的月分组）时保留年份 —— 那时跨年数据里
只写「8月」才真有歧义。**判断信息是否冗余要看上下文，不是看字段完整性。**

**② 金额按量级分档，不要统一缩写。**
`fmtMoneyShort`：<1万 完整保留分，≥1万 才缩成 `¥1.90万`。
日常单天金额几乎都在 1 万以下，这部分**零精度损失**；
只有大额日才缩写，而那恰好正是宽度最紧张的时候。
统一缩写会让 `¥50.00` 变 `¥0.01万` —— 为了 1% 的场景牺牲 99%。

**③ 同一行内金额格式必须统一。**
`dayBalanceLabel()` 当时还在用 `fmtMoney`，一行里混出
`收 ¥1.90万` 和 `结余 +¥17,226.00` 两种精度，
会让人以为这是两类不同的数据。结余项还是三项里最长的（多「结余」两字 + 正负号），
是宽度瓶颈本身，漏了它前面两处白改。

### `maxLines(1)` 是兜底，不是方案

算过账之后仍要加 `maxLines(1)`：系统字号放大 130% 时任何计算都会失效，
此时**省略号远好于换行** —— 换行会把整行高度撑开、连带下方所有内容位移，
而省略号只损失这一个元素的尾部。
但如果不先算账就只加 `maxLines(1)`，结果是「稳定地显示不全」，那不叫修好。

### 同类结构要一起查

日期 header（流水视图）、今日账单标题行（首页）都是同一结构。
首页那行算出来 282vp / 可用 304vp —— **没溢出，但余量只有 22vp**，
一个 `¥123,456.00` 就会挤。同一轮一起换成短格式，成本为零。
而且若只改一处，同一页会出现「2026-08-28」和「8月28日」两种日期写法，
用户会以为它们是两种不同的东西。

**判据**：
1. 一个 `Row` 里有 ≥3 个内容不定长的元素 → **必须列表算一遍宽度**，用最坏值（上万金额、4 位年份）
2. `layoutWeight` 只给可截断元素；日期/金额一律用 `Blank()` 顶开
3. 长度超标先问「有没有冗余信息可删」（上下文已给的年份），再考虑缩写数值
4. 缩写要**分档**，不要一刀切；同一行内格式必须一致
5. 算完账仍加 `maxLines(1)` 兜底；但只加 `maxLines(1)` 不算修好
6. 修完立刻 grep 同类结构（`'收 '`、`'支 '`），一次改齐

---

## 39. ⛔ 修复往另一端同步时，同步的是「函数语义」不是「代码文本」

一端修好的布局/格式化缺陷，另一端往往有同一处实例（同一份设计稿、同一个人写的）。
往回同步时最容易犯的错是「照着改一遍界面」，而把格式化逻辑各写一套。

### 必须建对端的同名函数，而不是内联写表达式

鸿蒙 `theme.ts#fmtMoneyShort` / `fmtDayLabel`
→ 安卓 `MoneyUtils.kt#formatMoneyShort` / `formatDayLabel`。

如果安卓这边图省事写成 `if (v >= 10000) "¥%.2f万".format(v/10000) else formatMoney(v)` 内联在 Composable 里，
下次调阈值（比如改成 ≥10 万才缩）就必须两端分别找、分别改，
而**漏改一端不会有任何报错** —— 表现是两端同一天的同一笔金额显示不同，
用户会怀疑是数据不同步，而不是格式不同。

### 同步时要顺带比对两端实现的**兜底完整度**

本轮安卓端写 `p[2].take(2).toIntOrNull()` 时才发现：
鸿蒙端 `Number(p[2])` 若收到 `'2026-08-28 14:30:00'` 会得 `NaN`，界面显示「8月NaN日」。
当前两个调用点传的都是已 `slice(0,10)` 的值，所以没暴露 ——
但那是**调用方的约定，不是函数的保证**，下一个调用者直接传 `item.date` 就会中招。

**写第二端时是审查第一端的最好时机**：同一个逻辑写两遍，
第二遍会自然暴露第一遍隐含的前提。发现了就回头补，不要因为「现在没出错」放过。

### 不是所有同名场景都要跟着改

`ReportsScreen` 的「期末结余 ¥xxx」是**独立一行、不与其他金额争宽度**，
保留 `formatMoney` 的完整精度是对的。

**判据**：`formatMoneyShort` 只用于「一行内并排 ≥2 项金额」；
单独展示一个金额的地方（详情页、大卡主数值、独立标签）一律用完整格式。
缩写是为解决宽度竞争，没有竞争就不该损失精度。

**判据（同步动作清单）**：
1. 先在对端 grep 同类结构，确认实例数量（本轮安卓 4 处）
2. 建**同名同语义**的格式化函数，注释里写明「与另一端 XXX 严格同语义」
3. 逐处替换时比对两端兜底逻辑，不一致就补齐**两边**
4. 用最坏值实测函数分支（含畸形输入：空串、带时间、非法格式）
5. 两端各编译一次；不要只编译改动多的那端

### grep 关键词会漏检：按「布局意图」而非「文案」搜

本轮第一遍用 `"收 ${` / `"支 ${` 搜，只找到 3 处。
第 4 处是统计页「每日概况」表格 —— 它每行并排四项金额，
但文案是列表头 `listOf("日期","支出","收入","结余")` + 数据行 `"-${formatMoney(x)}"`，
**一个字都不含「收 」**，模式完全对不上。

这处比前三处更容易溢出：四列 `weight(1f)` 均分，360dp 屏每列仅约 82dp，
`-¥123,456.00` 在 12sp 下需约 92dp —— 而它在表格里，一行换行会让**整张表行高参差**。

**判据**：找同类结构要搜「布局意图」而不是「文案」。至少三轮：
1. 文案模式（`"收 `、`"支 `）
2. **函数调用聚集**（一个 `Row`/`listOf` 里出现 ≥2 次 `formatMoney(`）
3. **等分布局**（`weight(1f)` 出现 ≥3 次的 `Row`；等分意味着每列宽度被硬限死）

第 2、3 条才是真正的判据 —— 文案会变，布局结构不会。

---

## 40. ⛔⛔ 接口字段必须按服务端原名声明（下划线 vs 驼峰）

本项目服务端是 Node + MySQL，SQL 里 `SELECT c.parent_id` **没有起别名**，
所以 JSON 出来的 key 就是 `parent_id`（下划线）。

安卓靠 Gson 的 `@SerializedName("parent_id") val parentId: Int?` 做映射，
**鸿蒙没有任何序列化框架** —— `JSON.parse` 出来是什么 key 就是什么 key。
在 ArkTS 里写：

```ts
interface RSlice { parentId?: number }   // ❌ 恒为 undefined
interface RSlice { parent_id?: number }  // ✅
```

### 为什么这是最危险的一类错

写错**不报错、不崩、不警告**。TS 的 interface 只在编译期存在，
运行时 `obj.parentId` 读一个不存在的属性只会得到 `undefined`。

于是下游这段过滤：

```ts
raw.filter(c => c.parent_id === null || c.parent_id === undefined)
```

在字段名写错时会返回**全部**分类（因为每一项的 `parentId` 都是 undefined）——
过滤器还在，还在跑，只是**永远不过滤任何东西**。界面照样出图、照样有数字，
只是数字是错的。这比崩溃难查一个量级。

**判据**：
1. 鸿蒙侧新增 interface 前，先 grep 服务端 `SELECT` 语句确认真实 key，
   或者直接 grep 安卓 `@SerializedName` —— 括号里的字符串才是真名，变量名不是
2. 服务端字段有下划线的，鸿蒙 interface **就写下划线**，不要为了「代码风格统一」改驼峰
3. 需要驼峰的话在**转换层**做一次显式 map，不要指望框架

**已知同类字段**（服务端下划线）：`parent_id`、`book_id`、`category_id`、`user_id`、`account_id`。

---

## 41. ⛔⛔ 上卷聚合过的数据不能整份直接渲染

服务端 `/reports` 的分类金额用递归 CTE 做了**子级向父级汇总**
（`server/routes/reports.js:166`，语义同财务成本科目）：
每个分类的 `total` = 自身发生额 + 全部子孙发生额。

这意味着返回的数组里，**父类和子类是同时存在的，且父类已经包含了子类的钱**。

```
餐饮 300（= 早餐 100 + 晚餐 200）
早餐 100
晚餐 200
转账  50
```

整份丢给环形图 → 合计 650，而真实支出是 350。**同一笔钱算了两次。**
本项目鸿蒙统计页此前就是这样，环形图金额一直是错的（与 KPI「支出金额」对不上）。

### 展示前必须选定一个层级切面

```ts
// 大类：只留顶层
raw.filter(c => c.parent_id === null || c.parent_id === undefined)

// 小类：只留末级（注意——「无子类的顶层」也算末级，比如「转账」）
const parentIds: number[] = [];
raw.forEach(c => { if (c.parent_id !== null && c.parent_id !== undefined) parentIds.push(c.parent_id); });
raw.filter(c => parentIds.indexOf(c.id ?? -1) < 0);
```

「末级」不能简单写成「有 parent_id 的项」—— 本项目的「转账」是顶层叶子、不设子项
（见类目规范），那样写会把它整个漏掉，小类合计对不上。
正确定义是**「没有任何人把它当 parent」**。

### 验收方式：两个切面合计必须相等

```
major: 餐饮 300 + 转账 50 = 350
minor: 早餐 100 + 晚餐 200 + 转账 50 = 350
不过滤:                          = 650   ← 旧行为
```

**判据**：
1. 拿到任何「带层级的聚合数组」，先问一句「父级的值含不含子级」
2. 含 → 渲染前必须过滤到单一层级，两个层级不能混在一张图/一个列表里
3. 上线前用 `major 合计 == minor 合计 == KPI 总额` 三方对账，
   对不上就是重复计数（这个断言比看图靠谱得多）

---

## 42. ⛔ 图表组件内部若会重排数据，调用方索引就不能直接复用

`DonutChart` 内部是这样的：

```ts
positive() { return this.data.filter(d => d.value > 0).sort(...) }
```

它**过滤 + 重排**之后才画扇区，回调给出的 index 是「过滤后数组」的下标。
而调用方的分类列表（`CategoryBars`）、中心标题（`donutCenterTitle()`）
用的是**传入前**那份数组的下标。

只要传入数组里存在一个 `value <= 0` 的项，两个索引空间就错位：
**点第 3 个扇区，高亮第 3 条列表项 —— 但它们是两个不同分类。**

不报错、不崩，只是「点了 A 高亮 B」。看代码几乎看不出来，
因为两边下标变量名都叫 `selectedIdx`，类型也都是 number。

### 修法：在调用方就把零值滤掉，让两个空间同源

```ts
pieces(): DonutPiece[] {
  return this.cats().filter(c => (c.total ?? 0) > 0).map(...);
}
```

零金额分类在本项目确实会出现（`amount = 0` 的交易，或上卷后某父类只挂了 0 元子项）。

**判据**：
1. 任何图表组件，先读它内部有没有 `filter` / `sort` / `slice`
2. 有 → 要么调用方预先做同样的过滤排序（推荐，简单），
   要么回调改传**业务 id** 而不是 index（更稳，但要改组件签名）
3. 永远不要假设「我传进去的顺序就是它画出来的顺序」

---

## 43. ⛔ Canvas 宽度必须由调用方按容器实算后传入

ArkUI 的 `Canvas` 给 `width('100%')` 时，绘图上下文里**拿不到解析后的实际像素宽**，
所以图表组件通常只能硬编码一个 `W`。

`TrendChart` 原来写死 `W = 340`。而它所在的卡片实际可用宽度：

```
360vp 屏
- 页面左右 padding 16 × 2 = 32
- 卡片内 contentPadding 14 × 2 = 28
→ 卡内可用 300vp，留 12 余量取 288vp
```

340 比 288 宽了 52vp，**溢出部分被卡片圆角裁掉** ——
表现是「月末最后几天的数据点看不见」。用户会以为是没数据，而不是被裁了。

### 改法：`W` 改成 `@Prop`，由页面算好传入

```ts
@Prop W: number = 288;
```

同时 X 轴刻度数量要跟着宽度自适应，不能写死条数：

```ts
const maxTicks = Math.max(2, Math.floor(plotW / 30));   // 每个刻度至少 30vp
```

否则窄屏上刻度文字会互相叠。

**判据**：
1. 组件里出现硬编码像素宽度（尤其 Canvas 的 `W`/`H`）→ 一律改 `@Prop`
2. 页面传值前把 padding 账算出来写在注释里（下次改 padding 才知道要同步改这里）
3. 检查项：**最后一个数据点是否完整可见**。图表 bug 通常出现在右边缘，
   左边总是对的，只看左半张图会漏掉

### 顺带：环形图外径安全，但**环心**是另一个瓶颈

`DonutChart` 外径 280vp < 288vp，画布本身不溢出。
但中心文字的可用宽是 `DIAMETER(160) - STROKE(36) = 124vp`，
20sp 下 `¥1,234,567.89 = 127.2vp` 会**压到色带上**，视觉上文字「骑」在环里。

已加自适应缩字（`minFontSize 14 / maxFontSize 20`）+ 显式 `width(124 - 8)`。

**判据**：环形/圆形容器里放文字，可用宽是**内圆直径**而不是组件宽度。
两者可以差一倍以上，只看组件宽度必然算错。

---

## 44. ⛔⛔ 决定缩写金额之前必须先量宽度，不能手估

用户指出统计页 KPI 卡「金额可以显示具体数据，空间足够」。**用户是对的** ——
我上一轮凭手感估出「每卡可用 131vp、`-¥123,456.78` ≈ 132vp 越界」，
于是给 6 个 KPI 值全部套上 `fmtMoneyShort`。

写脚本按字符 advance 实测后：

| 值 | 20sp 实宽 | 卡内可用 131vp |
|---|---|---|
| `¥20,904.00` | 99.8 | 放得下 |
| `¥123,456.78` | 110.8 | 放得下 |
| `-¥123,456.78` | **118.0** | 放得下（我估的 132 错了 14vp） |
| `¥1,234,567.89` | 127.2 | 放得下 |

手估错了 14vp，而这 14vp 恰好是「要不要缩写」的分界线。

### 缩写的代价被我低估了

缩写不是「少显示几个字符」，是**丢掉区分度**：

```
本月预算  ¥1.91万        ← 实际 ¥19,100.00
剩余预算  ¥1.91万        ← 实际 ¥19,148.00
```

两张卡看起来一模一样，实际差 48 块。用户看不出差别，
会以为「预算没花」或者「数据错了」—— 比金额被截断更糟，
因为**截断有省略号提示，缩写没有任何提示**。

### 宽度不足时的正确处理顺序

1. **先量**：写脚本按字符 advance 算（数字 ≈0.55em、`,`/`.` ≈0.27em、`¥` ≈0.60em、
   `-` ≈0.36em、汉字 =1.0em），别用眼估
2. **能放下 → 用完整格式**，什么都不做
3. **放不下 → 先删冗余信息**：本轮趋势副标题超 2.3vp，
   把 `2026-08-12` 换成 `8月12日`（顶部导航已写明年月，重复年份是 0 比特信息）
   直接腾出 18vp，最坏值也余 15.3vp
4. **仍放不下 → 等比缩字**，不缩写不截断：
   ```ts
   .minFontSize(15).maxFontSize(20)
   .heightAdaptivePolicy(TextHeightAdaptivePolicy.LAYOUT_CONSTRAINT_FIRST)
   .maxLines(1)
   .width('100%')       // ⚠️ 必须给宽度约束，否则自适应无参照、不生效
   ```
5. **最后才考虑缩写**，且仅限「一行内 ≥2 项金额真实争抢同一宽度」

### `minFontSize` 取多少：按最坏真实值倒推

```
320vp 屏 KPI 卡内可用 111vp
-¥1,234,567.89（百万级负数，个人记账现实上限）→ 需 16sp
¥12,345,678.90（千万级）                      → 需 16sp
```

取 15sp 留一档余量。**不要按理论最大值（亿级）定**，
那会让常见值也被压小，为极端情况牺牲日常可读性。

### 跨端偏离要当成错误信号

本轮更该早发现的线索：安卓 `ReportsScreen.kt:436` 一直是
`KpiSpec("支出金额", formatMoney(s.expense), ...)` —— **完整格式**。
鸿蒙单方面改成缩写，等于在「对齐安卓」的任务里主动偏离了参考端。

**判据**：对齐任务中若某处「我的实现比参考端更保守/更激进」，
先假设自己错了，回去核对参考端为什么能那样写 —— 通常是它算过而我没算。

### 保留缩写的场景（本轮复查后确认不动）

| 位置 | 结构 | 为什么保留 |
|---|---|---|
| 账单页汇总行 | 一行三项「收 / 支 / 结余」并排 | 三项真实争抢同一行宽 |
| 首页今日账单 | 一行两项，可用宽仅 304vp | 真实竞争 |
| 安卓「每日概况」表 | 四列 `weight(1f)` 均分，每列仅 82dp | 宽度被硬限死 |

**判据**：缩写只用于「多项金额在同一行竞争宽度」。
单项独占一行、独占一列、或有自适应缩字兜底的位置，一律用完整精度。

---

## 45. ⛔⛔⛔ `ForEach` 的 key 必须编入「所有会影响这一项渲染的状态」，不只是数据本身

这是本项目**第三次**被同一类问题咬到，前两次是 §36（`@Prop` 缺失）和
「首页日历金额不显示」。这一次的表现最隐蔽。

### 复现：统计页切「支出 → 收入」，KPI 卡不动

```
点「收入」→ 顶部分段确实高亮到收入了
         → 趋势卡标题也变成「收入趋势」了
         → 但 KPI 卡还写着「支出金额 ¥20,904.00」
```

原代码：

```ts
ForEach(this.kpiRows(), (row: KpiSpec[], ri: number) => {
  Row() { /* ... */ }
}, (row: KpiSpec[], ri: number) => `r${ri}`)   // ← 纯行号
```

支出维度有 4 张卡（2 行），收入维度只有 2 张（1 行）。切过去时第 0 行的 key
仍然是 `r0` —— ArkUI 判定「这一项没变」，**整行连内层 `ForEach` 一起跳过重建**。
于是行内容停在上一个维度。

实测（`kpiRowKey` 隔离验证）：

```
旧 key：支出第0行 = "r0"   收入第0行 = "r0"    ← 碰撞
新 key：expense|month|2026-08|r0|支出金额=¥20,904.00;日均支出=¥674.32;
        income |month|2026-08|r0|收入金额=¥55,340.00;日均收入=¥1,785.16;
```

### 为什么特别难发现

1. **不报错、不崩、不白屏**，只是数字是旧的
2. **同页其它部分是对的** —— 分段高亮、趋势卡标题、环形图全都跟着变了，
   只有 KPI 这一块不动。看起来更像「这个维度的数据恰好一样」而不是 bug
3. **翻月份也会中招**，且更隐蔽：`title` 不变（还是「支出金额」），
   只有 `value` 变了。若 key 写成 `s.title`，翻月后卡片停在上月数字 ——
   金额本来就每月不同，用户不会怀疑是缓存问题

### 判据（写 `ForEach` key 时逐条过）

| 问自己 | 若答"是" |
|---|---|
| 这一项的渲染结果依赖某个 `@State` 吗？ | 那个 state 必须进 key |
| 数据对象里哪些字段会显示出来？ | 全部进 key，不只是 id |
| 列表长度会随状态变化吗？ | 下标绝对不能单独当 key |
| 两个不同状态下会产生相同下标吗？ | 会 → 必须加状态前缀 |

**反模式清单**（这四种写法在本项目都出过问题）：

```ts
}, (item, i) => `${i}`)              // ❌ 纯下标 —— 长度变化时必错
}, (item, i) => `r${i}`)             // ❌ 同上，加前缀不解决问题
}, (item) => item.title)             // ❌ 标题不变但值变（翻月场景）
}, (item) => `${item.id}`)           // ⚠️ id 唯一但显示受外部状态影响时不够
```

正确写法是把 key 当成「这一项的完整渲染签名」：

```ts
kpiRowKey(row: KpiSpec[], ri: number): string {
  let sig = '';
  row.forEach((s: KpiSpec) => { sig += `${s.title}=${s.value};`; });
  return `${this.type}|${this.periodMode}|${this.period}|r${ri}|${sig}`;
}
```

### 同一页的其它 `ForEach` 要一起查

发现一处就顺手把同文件所有 `ForEach` 过一遍 —— 这类坑通常成片出现。
本轮除 KPI 外还加固了明细排行：

```ts
// 原：(tx) => `${tx.id ?? i}`
// 现：(tx, i) => `${this.type}|${tx.id ?? i}|${tx.amount ?? 0}`
// 理由：正负号与颜色取决于 this.type。转账类交易在支出/收入两份 topTx 里
//      可能是同一条 id，切维度后这行会保留上个维度的符号。
```

---

## 46. ⛔⛔⛔ 客户端传的粒度参数，必须在服务端真实存在 —— 「空态」经常是 400 伪装的

本轮最严重的发现，而且**两端同时中招、已经上线很久**。

### 事实

```
安卓 ReportsViewModel:90-94   →  granularity = "yearly" / "custom" / "monthly"
鸿蒙 Reports.ets:108          →  gran        = "yearly" / "monthly"

服务端 parseReportPeriod()    →  只认 "monthly" / "quarterly" / "annual"
                                 其余一律 throw('不支持的报表类型')
路由 catch                    →  err.message 含「不支持的报表类型」→ HTTP 400
```

即：**两端的「按年查看」从来没工作过**，安卓的「自定义区间」也一样。

### 为什么长期没被发现

客户端对这个请求做了「失败即降级」：

```ts
try {
  const r = await Api.getReport(gran, this.period);
  if (r.success && r.data) { this.data = r.data as ESObject; }
} catch (e) { console.error(...); }     // ← 400 落到这里，data 保持旧值/null
finally { this.loading = false; }
```

于是界面表现是「顶部写着 2026年，下面一片空数据」——
看起来完全像「这一年确实没有记账」，而不是「请求失败了」。

**降级容错让功能性故障伪装成了正常空态。**

### 判据

1. **写下 `type` / `mode` / `granularity` 这类枚举参数时，去服务端 grep 一遍取值**
   —— 别信注释。本项目 `Reports.ets` 原注释还写着
   「后端 /reports 接口支持 monthly/yearly/custom」，而后端根本没这两个分支
2. **空态与失败态必须在 UI 上可区分**。至少：
   - 请求失败 → 「加载失败，点击重试」
   - 请求成功但无数据 → 「本期暂无记录」
   两者都画成同一个空白页，就等于把所有接口故障静音了
3. **catch 里只 `console.error` 等于没有错误处理** —— 真机上没人看 hilog

### 本轮修法（改服务端而非客户端）

```js
const PERIOD_TYPE_ALIAS = {
    yearly: 'annual', annually: 'annual', year: 'annual',
    month: 'monthly', quarter: 'quarterly'
};
function normalizeReportType(type) { return PERIOD_TYPE_ALIAS[type] || type; }
```

选服务端的理由：`yearly` 与 `monthly` 构词一致（`annual` 才是那个不一致的），
且已有两端在用，改服务端一处即可，改客户端要动两端。

同时补了真正的 `custom` 分支（`'YYYY-MM~YYYY-MM'`，也兼容日级），
以及 `top-transactions` 的按年/自定义支持 —— 后者原本
`if (!/^\d{4}-\d{2}$/.test(period))` 直接 400，
**导致按年查看时明细排行也一直是空的**，同样被 catch 静音。

### 顺带：缓存 key 必须用归一化后的 type

```js
// 原：`${userId}:${bookId}:${type}:${period}`
// 现：`${userId}:${bookId}:${normalizeReportType(type)}:${period}`
```
不归一化，`yearly` 和 `annual` 会各存一份完全相同的数据，
命中率减半，且两份可能新旧不一致。

### 环比上期必须与本期等长

自定义区间的 `prevPeriod` 不能简单「减一个月」：
3 个月的区间对上 1 个月的上期，环比数字毫无意义。正确做法是整段平移：

```js
const span = (e[0]*12 + e[1]) - (s[0]*12 + s[1]) + 1;   // 本期月数
// 起止各往前挪 span 个月
```

同理，界面上「‹ ›」翻页自定义区间时也要整段平移（`span * delta`），
挪 1 个月会让相邻两页重叠 2 个月，用户以为在翻页、实际数据大半重复。

**月份加减一律用绝对月序 `y*12 + (m-1)`**，不要写
`if (m < 1) { m += 12; y--; }` —— 平移超过 12 个月时那种写法只回绕一次，会算错。

---

## 47. ⛔ 图标画的是什么，要和它代表的功能对得上

第 4 组截图指出鸿蒙底栏「统计」图标和安卓不一样。查下来不是配色问题：

```xml
<!-- 旧 ic_pie.svg —— 名字叫 pie，画的却是「圆环 + 对钩」 -->
<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 ... zm4.2 3.8L11 13.2l-3-2.9-1.3 1.4 4.3 4.2 6.4-7-1.2-1.1z"/>
                                              ↑ 这段是对钩
```

一个「已完成 / 已勾选」图标挂在「统计」位置上，而安卓同一槽位是
`Icons.Outlined.PieChart`（圆 + 扇区分割线）。

### 判据

1. **文件名不能当验证** —— `ic_pie.svg` 里可以画任何东西
2. **描边式与填充式不能混用在同一栏**：
   本项目底栏 house / person 走 `SymbolGlyph`（系统线性图标），
   而 pie / receipt 是自绘 `fill` 实心块 —— 真机上「账单」「统计」
   明显比「首页」「我的」更黑更重。已统一改为 `stroke-width 1.7~1.8` 的描边式
3. **识别特征不能省**：
   - 饼图 → 圆 + 至少一条半径分割线（没有分割线就只是个圆圈）
   - 小票 → 底边锯齿（没锯齿就退化成普通「文件」图标）+ 内部条目横线
4. 自绘 SVG 要 `fill="none" stroke="#000000"`，由 `Image().fillColor()` 统一着色

### 改 SVG 后必须强制重打包验证

`hvigorw` 会把资源缓存到
`entry/build/default/intermediates/res/default/resources/base/media/`，
只改源文件重编译可能报 `UP-TO-DATE` 而不实际替换。删掉中间产物再编，
然后 `head` 一下中间产物确认是新内容。

---
## 48. ⛔⛔ `.align()` 加在 Column/Row 上是死代码 —— 贴边必须由父 Stack 的 `alignContent` 决定

用户指出记账浮钮弹出的两张速选卡「飘在屏幕中部，拇指伸不到」。
代码里明明写着 `Alignment.Bottom`，为什么没生效？

### 根因

```ts
Stack() {                                  // ← 默认 alignContent: Center
  Column() { /* 遮罩 */ }.height('100%').margin({ bottom: 64 })
  Column({ space: 14 }) {                  // 卡组，高度由内容撑开 = 142vp
    this.AddOption('AI 记账', ...)
    this.AddOption('手动记账', ...)
  }
  .align(Alignment.Bottom)                 // ❌ 死代码
  .margin({ bottom: 82 })
}
```

`align()` 的语义是「**在自身的富余空间内**摆放内容」。
`Column` 的高度由子节点撑开，富余空间恒为 0 → **它什么都不做**。
真正决定位置的是外层 `Stack` 默认的 `alignContent: Center`，
于是卡组被摆在屏幕正中，`margin.bottom: 82` 只是把它从中心又抬高一截。

实测（780vp 屏）：

```
旧：卡组底距屏底 360vp（大半屏），最远那张卡距 FAB 中心 438vp
新：卡组底距屏底  84vp，          最远那张卡距 FAB 中心 162vp
                                              ↑ 下移 276vp
```

### 判据

| 想让子节点贴边 | 正确写法 |
|---|---|
| 在 `Stack` 里贴底 | `Stack({ alignContent: Alignment.Bottom })` — 写在**父**上 |
| 在 `Column`/`Row` 里推到一端 | `justifyContent(FlexAlign.End)`，或给兄弟加 `Blank()` |
| 子节点自身有富余空间时 | `.align()` 才有意义（需先有 `layoutWeight` 或显式 `height`） |

反向自查：**看到 `.align()` 就先问「这个节点有富余空间吗」**。
若它的尺寸完全由内容决定，这行必然是死代码。
本项目仅 `Home.ets:270` 的 `.layoutWeight(1).align(Alignment.Top)` 是有效用法
—— 因为 `layoutWeight` 先给了它富余空间。

### 顺带修掉的第二个问题：`height('100%') + margin` 会撑坏渐变色标

```ts
// 旧：遮罩想「只盖导航栏以上」
Column().height('100%').margin({ bottom: 64 })
```
布局盒总高变成 `100% + 64`。而 `linearGradient` 的色标（0.0 / 0.55 / 1.0）
是**按盒高**换算的 —— 最深那档 `1.0` 落到了屏幕外，
栏顶实际拿到的是约 93% 处的颜色，比设计值浅。

正确做法是用 `Column` + `layoutWeight(1)` 显式切出两块：

```ts
Column() {
  Stack({ alignContent: Alignment.Bottom }) {
    /* 遮罩 height('100%') + 卡组 margin.bottom 20 */
  }.layoutWeight(1)                        // = 屏高 − 64，渐变 1.0 正好压在栏顶
  Column().height(64).hitTestBehavior(HitTestMode.None)   // 导航栏留空区
}
```

**判据**：需要「占满剩余高度」时用 `layoutWeight(1)`，不要用
`height('100%') + margin` 去减 —— 后者不减高度，只是把盒子推出可视区，
所有按百分比计算的东西（渐变色标、`height('50%')` 子节点）都会跟着错。

---

## 49. ⛔⛔ 全屏浮层挡住底栏按钮：`hitTestBehavior` 的两个值必须配对使用

浮层展开时 FAB 会旋转 45° 变成「×」充当关闭按钮 —— 但浮层本身是全屏的，
覆盖在导航栏之上，那块占位区会把点击吃掉，**「×」按不动**。

### 命中链路（本项目 `Main.ets` 实例）

```ts
Column() {                                     // 浮层根
  Stack({ alignContent: Alignment.Bottom }) {
    Column().height('100%').onClick(closeMenu) // 遮罩：Default，正常响应并阻塞
    Column({ space: 14 }) { /* 速选卡 */ }
  }.layoutWeight(1)

  Column().height(64)
    .hitTestBehavior(HitTestMode.None)         // ← 占位区：自身不响应且不阻塞下层
}
.hitTestBehavior(HitTestMode.Transparent)      // ← 根节点：自身可响应但不阻塞兄弟
```

- 点在占位区 → 占位 `None` 跳过自身 → 根 `Transparent` 不阻塞同层兄弟
  → 事件传到下层的 `BottomNav` → FAB 可点 ✅
- 点在遮罩区 → 遮罩是 Default（有 `onClick`）→ 正常关闭菜单并阻塞 ✅

### 三个值的区别（别记混）

| 值 | 自身响应 | 阻塞下层/兄弟 | 用途 |
|---|---|---|---|
| `Default` | ✅ | ✅ | 普通可点元素、遮罩 |
| `Transparent` | ✅ | ❌ | 全屏浮层的**根**节点 |
| `None` | ❌ | ❌ | 纯占位、纯装饰的**留空**块 |
| `Block` | ✅ | ✅（连子节点也拦） | 加载中禁用整块交互 |

**只加一个不够**：根节点漏了 `Transparent`，即使占位区是 `None`，
根自己仍会阻塞兄弟；占位区漏了 `None`，即使根是 `Transparent`，
占位自己仍是 Default 会吃掉点击。

### 判据

写全屏浮层时逐条过：
1. 浮层展开后，**下层还有哪个按钮必须保持可点**？（本项目是 FAB 的关闭态）
2. 覆盖那个按钮的是哪一块节点？→ 那块必须 `None`
3. 浮层根节点是否 `Transparent`？→ 否则事件到不了下层
4. 遮罩必须保留 Default —— 点空白处关闭是用户预期，别顺手也设成 `None`

---
## 50. ⛔⛔⛔ 服务端按天返回的数据，客户端必须按视图跨度重新分桶

用户指出「趋势在年的时候应该 12 个月」。查下来这不是标签问题，是**粒度问题**。

### 根因：服务端只有一种粒度

```js
// server/routes/reports.js:355  —— 不管请求的是月还是年，一律逐日补齐
const cur = new Date(start), last = new Date(end);
while (cur <= last) {
    dailyTrend.push({ date: fmtDateISO(cur), ...v });
    cur.setDate(cur.getDate() + 1);
}
```

字段名就叫 `dailyTrend`，语义是「逐日」。按年请求回来 **365 条**。
而两端都是 1:1 映射成折线点：

```ts
// 鸿蒙                              // 安卓
t.map(x => x.expense)                report.dailyTrend.map { it.expense }
```

### 算一下就知道画不出来

```
趋势图宽 288vp − padL 44 − padR 10 = 绘图区 234vp
365 个点 → 相邻间距 234 / 364 = 0.64vp
而数据点半径 r=2（直径 4vp）

→ 每个点盖住前后各 3 个邻居，整条折线糊成一团墨迹
→ X 轴 12 个月被抽成 7 个不规则日期
→ 「每日概况」表格同时渲染 365 行
```

**「按年」的语义单位本来就是月，不是日。**

### 修法：客户端加一层桶

```ts
trendBuckets(): RTrend[] {
  const t = (this.data as RData).dailyTrend || [];
  if (t.length <= 62) return t;          // 日桶，与原行为一致
  // 按 'YYYY-MM' 归并，date 只留 7 位 —— 长度就是粒度标记
  ...
}
isMonthBucket(): boolean {
  const b = this.trendBuckets();
  return b.length > 0 && (b[0].date || '').length === 7;
}
```

**阈值判断跨度，不判断 `periodMode`**：
自定义区间选了半年同样需要按月聚合，用 `periodMode === 'year'` 会漏掉它。
62 = 31×2，即「最多两个月仍按天看」，再长超出人对逐日曲线的分辨能力。

**趋势图和表格必须共用同一份桶** —— 曲线按月而表格按日，用户对不上号。

### 聚合的唯一硬指标：总额守恒

聚合是有损的（丢掉日内分布），但**钱不能丢**。验收脚本
`scripts/verify-trend-buckets.js` 36 项里最关键的就是这几条：

```
收入总额守恒 1095 = 1095
支出总额守恒 2555 = 2555
1月支出 = 31天×7 = 217
2月支出 = 28天×7 = 196（2026 非闰年）
闰年 2028 总额 366 天守恒
```

顺带覆盖：阈值边界（59/62/92）、跨年区间顺序、稀疏数据（零值月不能被丢掉）、
脏数据（空 date / 只有年）不混入金额。

### 汇总行要从桶累加，不要读 `summary`

```ts
// 原：const s = this.summary(); return fmtMoney(s.expense);
// 现：let ex = 0; this.trendBuckets().forEach(p => { ex += p.expense ?? 0; });
```

核实过服务端两条 SQL 当前口径一致（WHERE 与 CASE WHEN 相同），所以两种写法结果相同。
改成同源相加是**结构性保证**：表格每行来自 buckets，汇总是这些行的和，必然平账。
读 `summary` 则依赖「服务端两条 SQL 恰好口径相同」这个外部约定 ——
哪天有人给 summary 加上 transfer，表格就会「各行加起来 ≠ 汇总」，
而这种错不报错、不崩，只有用户按计算器才会发现。

**判据**：**列表的汇总行必须由列表自己的数据加出来。**

### 跨年才带年份

```ts
const crossYear = buckets[0].date.slice(0,4) !== buckets[last].date.slice(0,4);
label = crossYear ? `2026年11月` : `8月`;
```
按年查看时 12 个桶同属一年，顶部导航已写「2026年」，再写一遍是 0 比特信息。
自定义跨年区间（2026-11~2027-02）会出现两个「1月」，年份是必要的。

---

## 51. ⛔⛔ 图表轴标签必须来自实际数据，硬编码一定会差一天

修 §50 时在安卓端发现的，比鸿蒙那个抽样问题更直接：

```kotlin
// 旧 —— 与实际数据点毫无关系
val xLabels = if (periodMode == "year") {
    (1..12).map { String.format("%02d", it) }
} else {
    listOf("01", "05", "10", "15", "20", "25", "30")
}
```

后果：

| 场景 | 表现 |
|---|---|
| 31 天的月份 | 最后一个数据点是 31 号，标签写「30」—— 差一天，而**峰值常在月末** |
| 2 月（28 天） | 标签仍标到「30」，超出实际范围 |
| 自定义 3 个月区间 | 7 个硬编码日期全对不上 |
| 本月未过完 | 数据只到 15 号，标签照样标到 30 |

改成从桶等距抽样 + 末尾必标：

```kotlin
val step = ceil((n - 1).toDouble() / (maxTicks - 1)).toInt().coerceAtLeast(1)
val out = (0 until n step step).toMutableList()
if (out.last() != n - 1) {
    if (n - 1 - out.last() < step / 2) out.removeAt(out.size - 1)  // 太近则替换
    out.add(n - 1)
}
```

`maxTicks` 取 **12** 而不是 7：卡内约 300dp，`labelSmall` 两位数字约 12.1dp，
12 个占 145dp、间隙 14.1dp，很宽松。取 7 的话按年会被抽成
「01 03 05 07 09 11 12」—— 用户点「按年」就是想看齐 12 个月，抽掉一半更难读。

### 鸿蒙侧同一处的额外坑：slot 不能写死

```ts
// 旧：const maxTicks = Math.max(2, Math.floor(plotW / 30));
// 现：用 ctx.measureText() 实测本序列最长标签
```
30 这个常数是按日标签 `8/15` 拍的。月标签 `12月` 只要 18.9vp、`8月` 仅 13.9vp ——
按 30 算，12 个月桶只能标 7 个。

**间隙留 2vp 而不是 4**：12 个月桶间距 21.3vp、标签 18.9vp，
留 4 会差 1.6vp 被判为放不下 → 退化成隔月标。为 1.6vp 牺牲一半信息不值。

### 抽样算法两个要点

1. **步长取整**，不要用 `(n-1)/(maxTicks-1)` 的小数再四舍五入 ——
   小数步长产出「1月 3月 5月 6月 8月」这种忽 2 忽 1 的序列
2. **先算间距再定步长**，不要先算「最多放几个」再等距切 ——
   后者不保证抽完之后间距够。实测 31 个日期抽 10 个时相邻只有 15.6vp，
   而标签本身要 21.6vp，照样重叠

---

## 52. ⛔ 注释写反了比没有注释更坏

修 §50 时顺带发现安卓统计页「每日概况」表格的配色：

```kotlin
1 -> Color(0xFFC11435) // 支出按收入红 +符号位     ← 注释自己都绕不清
2 -> Color(0xFF009558) // 收入按支出绿
```

而 `Color.kt` 定义的是：

```kotlin
val IncomeColor  = Color(0xFFC11435)   // 红
val ExpenseColor = Color(0xFF009558)   // 绿
```

账单页 `TransactionsScreen.kt:521` 也是 `isExpense -> ExpenseColor`（绿）。
即**这张表的支出/收入配色与全 App 相反**，而那两行注释让人以为是刻意为之。

（中国习惯：涨/收入为红，跌/支出为绿。这是项目既定约定。）

### 判据

1. **硬编码色值就是这类错误的温床** —— 写 `Color(0xFFC11435)` 时没人会去想
   「这个值在 token 里叫什么」，而写 `IncomeColor` 时错了一眼就看得出
2. 发现注释与代码不符时，**先确认哪个是对的再改**，不要顺手让代码去迁就注释
   （本次是查 `Color.kt` 定义 + 账单页用法两处交叉验证后才确定注释错了）
3. 改完用 token 替换硬编码，避免下次又对不上

---

## 53. ⛔⛔⛔ 客户端必须发「新旧服务端都认」的枚举值 —— 否则功能取决于部署顺序

### 现场

用户截图：顶部写着 `‹ 2026年 ›`、月均支出 = 总额 ÷ 12、KPI 是「本年预算」，
但趋势图 X 轴是 `8/1 … 8/31`、副标题「8月12日」。

一个页面同时显示两个周期的数据。第一反应是「按年分桶没生效」，
实际上分桶代码从未拿到年数据。

### 根因链

```
客户端按年发 type='yearly'
  ↓
线上服务端是旧版：parseReportPeriod 只有 monthly / quarterly / annual
  ↓
throw('不支持的报表类型') → HTTP 400
  ↓
客户端 catch 只 console.error，this.data 保持上一次的值
  ↓
periodMode/period 是本地状态 → 顶部导航、KPI 立即变成「年」
report/data 是网络状态   → 趋势图、表格还是上个月
  ↓
「年壳子 + 月内脏」
```

### 两条规则

**1. 客户端发新旧都认的值。**

`annual` 旧服务端认，新服务端经 `PERIOD_TYPE_ALIAS` 原样透传也认。
发 `annual` → 功能不依赖服务端部署顺序。

反过来做（客户端发 `yearly` + 服务端加别名兼容）要求两端**同时**升级。
用户装了新 APK 而服务端还是旧的 —— 按年就是坏的。而这正是本次现场。

```ts
// ✅ 新旧都认
const gran = periodMode === 'year' ? 'annual' : ...;

// ❌ 只有新服务端认
const gran = periodMode === 'year' ? 'yearly' : ...;
```

判据：**能力协商的兼容层要加在「后升级的那一端」**。
服务端通常比客户端先升级（一次部署 vs 用户逐个装包），
所以客户端应当发保守值，服务端负责接受宽松集合。

**2. 请求失败必须清空数据 + 显性报错。**

```ts
// ❌ 静默保留旧数据 —— 本地状态已变、网络状态没变 = 两个周期同屏
catch (e) { console.error(e); }

// ✅
catch (e) {
  this.data = null;          // 不留上一次的响应
  this.loadError = msg;      // 渲染错误态而不是空态
}
```

错误态**不能复用空态**。「请求失败」和「这一年真的没记账」是两件事，
用同一个「暂无数据」表达，会让人一直往数据方向找原因 ——
本次 bug 存活这么久就是因为 400 被伪装成了空态。

### 安卓端两个连带缺陷（同一次发现）

**a. `consumeError()` 无条件调用 → `ErrorState` 永远走不到**

```kotlin
// ❌ error 立刻被清成 null，when 分支落到 EmptyState("暂无报表数据")
LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }

// ✅ 有内容可看时才用 snackbar 一闪而过；无内容时留着 error 交给 ErrorState
LaunchedEffect(state.error) {
    val e = state.error
    if (e != null && state.report != null) { snackbar.showSnackbar(e); vm.consumeError() }
}
```

**b. 重试按钮点了没反应**

```kotlin
fun setPeriod(period: String) {
    if (period == _state.value.period) return   // ← 传当前值直接 return
    ...
}

// ❌ onRetry = { vm.setPeriod(state.period) }   传的就是当前值，什么都不发生
// ✅ onRetry = { vm.reload() }
```

带「去重 guard」的 setter 不能用来做重试。重试的语义是
「参数不变但重新执行」，而去重 guard 恰好把这种调用拦掉。

### 自查清单

- [ ] 客户端发出的每个枚举值，**当前线上**服务端是否认识？（不是"工作区的服务端"）
- [ ] 服务端改动是否已提交/部署？只改工作区等于没改
- [ ] 请求失败时，本地状态（周期/维度）与网络状态（数据）会不会显示成不同周期？
- [ ] 失败态和空态是不是同一个 UI？
- [ ] 重试按钮走的路径有没有去重 guard？

---

## 54. ⛔⛔ 两个带去重 guard 的 setter 串起来调用 = 中间态请求

### 现场

安卓报表页周期切换：

```kotlin
onPeriodChange = { period, mode -> vm.setPeriodMode(mode); vm.setPeriod(period) }
```

两个 setter 各自：① 带 `if (新值 == 旧值) return` 去重 guard；② 各自 `loadReport()`。
串起来调用，第一个 setter 会拿**自己推算的 period** 先发一次请求。

鸿蒙这边是单一入口，天然没这个问题：

```ts
applyPeriod(period: string, mode: string): void {
  this.periodMode = mode;
  this.period = period;
  this.load();          // 一次赋值，一次请求
}
```

### 为什么很难被发现

只有最常用的那条路径**碰巧是对的**：

| 操作 | 两段式发出的请求 | 对不对 |
|---|---|---|
| 月 → 年 | `annual/2026` | ✅ 碰巧对（setPeriodMode 截出的 `2026` 与随后 setPeriod 参数相同，被 guard 拦掉） |
| **年 → 月**（切到 3 月） | `monthly/2026-08` 然后 `monthly/2026-03` | ⛔ 白发一次用户没选的当前月 |
| **月 → 自定义** | `custom/2026-08` 然后 `custom/2026-01-01~2026-06-30` | ⛔ custom 配月份串，服务端解析不了 |
| **自定义 → 月** | `monthly/2026-01-01~...` 然后 `monthly/2026-05` | ⛔ 月粒度配区间串 |

第一行对，所以日常点两下看不出毛病。而错的三行不只是"多一次请求"：
两次响应乱序回来时，**先发的那次后到**，页面会渲染成用户没选的周期。

### 规则

**UI 上如果同时知道目标 period 和目标 mode，必须走单一原子入口。**

```kotlin
// ✅ 一次赋值一次请求，guard 只判一次（两个字段都没变才 return）
fun applyPeriod(period: String, mode: String) {
    val s = _state.value
    if (period == s.period && mode == s.periodMode) return
    _state.value = s.copy(periodMode = mode, period = period)
    loadReport()
}

// ❌ 两个 setter 串起来
vm.setPeriodMode(mode); vm.setPeriod(period)
```

保留独立的 `setPeriodMode` 只用于「只切维度、让 ViewModel 推算 period」的场景
（顶部维度切换按钮）。周期弹层、左右箭头这些**已知完整目标**的入口一律走 `applyPeriod`。

### 判据

带去重 guard 的 setter 有两条隐含约定，二者必须同时成立才能串联：
1. 每次调用都是一个完整、自洽的状态变更
2. 中间态对外可见也无害

多字段联动时第 2 条一定不成立 —— 中间态会被 `loadReport()` 发出去。

同源问题：**带去重 guard 的 setter 不能用来做重试**（见第 53 节 b 小节）。
根因相同：guard 假定"值没变就没有新意图"，而重试和联动都是反例。

### 顺带：错误态要给「接下来能做什么」

```kotlin
// ❌ 只有一行 message（多是服务端原文或"数据加载失败"）
ErrorState(state.error!!, onRetry = { vm.reload() })

// ✅ 补一句指向真实原因的 hint（对齐鸿蒙 ErrorBlock 的副文案）
ErrorState(
    state.error!!,
    onRetry = { vm.reload() },
    hint = "检查网络连接，或确认服务端已更新到支持该周期的版本"
)
```

按年失败的真实原因是服务端版本旧，用户看着"数据加载失败"只会反复切周期。
`hint` 作为可选参数加进共用 `ErrorState`，默认空值，不影响其他页面既有呈现。

### 自查清单

- [ ] 一次用户操作要改多个联动字段时，是不是走单一入口？
- [ ] 每个带 guard 的 setter 是否只在「单字段独立变更」时被调用？
- [ ] 有没有哪条切换路径会打出参数自相矛盾的请求（粒度与 period 格式不匹配）？
- [ ] 错误态除了报错，有没有告诉用户下一步做什么？

---

## 55. ⛔ 给共用 Composable 加参数：新参数必须插在函数类型参数**之前**

### 现场

`ErrorState` 是全项目共用错误态组件。给它加一个可选副文案 `hint`，
按"可选参数往后放"的常规直觉写成：

```kotlin
fun ErrorState(
    message: String,
    onRetry: (() -> Unit)? = null,
    onLogin: (() -> Unit)? = null,
    hint: String? = null          // ← 放在末尾
)
```

一次编译爆出 9 个错误，全是同一句：

```
Argument type mismatch: actual type is 'kotlin.Function0<kotlin.Unit>',
but 'kotlin.String?' was expected.
```

### 根因

全项目 9 处调用写的是**尾随 lambda**：

```kotlin
ErrorState(state.error!!) { vm.refresh() }
```

Kotlin 的尾随 lambda 只会匹配**最后一个**参数。`hint` 一放到末尾，
这 9 处的 lambda 就被当成 `hint: String?` 传进去了。

### 规则

**共用组件新增参数，插在所有函数类型参数前面。**

```kotlin
fun ErrorState(
    message: String,
    hint: String? = null,          // ✅ 数据类参数在前
    onRetry: (() -> Unit)? = null, // 函数类型参数保持在末尾
    onLogin: (() -> Unit)? = null
)
```

这条比"可选参数往后放"优先级更高。函数类型参数的**位置本身是 API 契约**的一部分，
调用方靠它写尾随 lambda；数据类参数没有这个约束，可以随意插。

### 判据

改共用组件签名前，先数一下有多少处调用用了尾随 lambda：

```bash
grep -rn "ErrorState(" android/app/src/main/java --include=*.kt | grep -c "{"
```

只要 > 0，就不能动最后一个参数的位置。

顺带：报表页那处用的是具名参数 `hint = "..."`，不受位置影响。
**具名调用对签名调整免疫** —— 共用组件的新调用点优先写具名参数。

---

## 56. ⛔⛔⛔ 正则 `\d{2}` 只管位数不管范围 —— 越界日期会算成「看似合法」的串进 SQL

### 现场

`server/routes/reports.js` 的 `parseReportPeriod` 用同一套写法校验三种周期，
三处都漏了范围校验：

```js
const mStart = rawStart.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);  // 13 月能过
const m = period.match(/^(\d{4})-(\d{2})$/);                       // 13 月能过
const match = period.match(/^(\d{4})-Q(\d)$/);                     // Q0/Q7 能过
```

实测结果：

| 输入 | 算出的 start / end |
|---|---|
| `custom` `2026-13~2026-14` | `2026-13-01` / `2026-14-28` |
| `monthly` `2026-13` | `2026-13-01` / `2026-13-31` |
| `monthly` `2026-00` | `2026-00-01` / `2026-00-31` |
| `quarterly` `2026-Q7` | `2026-19-01` / `2026-21-30` |
| `quarterly` `2026-Q0` | `2026--2-01` / `2026-00-31` ← 畸形串 |

### 为什么两道「看起来能兜住」的防线都失效

**1. `lastDayOfMonth` 不会报错，会静默溢出。**

```js
const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate();
lastDayOfMonth(2026, 14)  // → 28   （new Date(2026,14,0) 溢出到 2027-02）
lastDayOfMonth(2026, 0)   // → 31   （回退到 2025-12）
```

于是 14 月拿到了一个「合理」的月末日 28，串看着完全正常。

**2. `if (start > end)` 是字符串比较，不是日期比较。**

```js
'2026-13-01' < '2026-14-28'   // true → 校验放行
```

日期串按字典序比较在**合法**日期上恰好等价于按时间比较，
这让人误以为它是一道日期校验 —— 越界时它什么也拦不住。

### 后果不是抛错，是更糟的东西

畸形串直接进 SQL：Postgres 报 `date/time field value out of range`（500 而非 400），
换个驱动或宽松模式则**静默返回空集** —— 用户看到「这个区间没有数据」，
而真相是参数非法。这类 bug 排查成本极高。

### 规则

**正则做形状校验，范围校验必须单独写。**

```js
// ✅
const sm = parseInt(mStart[2]);
if (sm < 1 || sm > 12) throw new Error('自定义区间格式错误');

// 日级还要校验「这一天在该月真实存在」——2 月 30 号同样能过正则
const sd = mStart[3] ? parseInt(mStart[3]) : 1;
if (sd < 1 || sd > lastDayOfMonth(sy, sm)) throw new Error('自定义区间格式错误');
```

判据：**凡是从字符串 `parseInt` 出来又要拼回日期串的数字，都要显式判范围。**
`\d{2}` 表达的是「两位数字」，`1~12` 是业务约束，正则表达不了（硬写
`(0[1-9]|1[0-2])` 可读性差且日期部分还得处理闰年，不如显式 if）。

### 闰年边界必须进用例

```
2024-02-01~2024-02-29   ✅ 闰年放行
2026-02-01~2026-02-29   ⛔ 平年拒绝
2026-04-31              ⛔ 4 月只有 30 天
```

`lastDayOfMonth(y, m)` 已经处理了闰年，直接用它做上界即可 —— 不要手写月份天数表。

### 自查清单

- [ ] 每个 `\d{2}` / `\d{1}` 捕获组，后面有没有对应的范围 if？
- [ ] 有没有把「字符串字典序比较」当成日期比较用？
- [ ] 日级输入是否校验了「该月是否真有这一天」（含闰年）？
- [ ] 越界输入的**实际输出**是什么？（跑一遍，不要靠读代码推断 —— 本条规范
      的所有结论都是跑出来的，读代码时我判断 `t % 12` 会产生负数月份，
      实测 `t` 恒为正，那个怀疑是错的；而真正的漏洞在别处。）

---

## 57. ⛔ 「客户端比服务端新」的错误提示不能无条件覆盖

### 现场

按 `periodMode` 一律替换错误文案：

```kotlin
error = if (s.periodMode == "custom") "自定义区间需要升级服务端" else r.message
```

部署新服务端之前它是对的。部署之后，**网络超时、401 过期、区间格式非法**
全都会显示「需要升级服务端」—— 用户会反复去查后端版本，而真实原因在别处。

### 规则

用**服务端的实际回复**做判据，不用本地状态猜。

```kotlin
// 旧版 parseReportPeriod 落到最后一行 throw new Error('不支持的报表类型')
val serverTooOld = r.message.contains("不支持的报表类型")
error = if (s.periodMode == "custom" && serverTooOld) "自定义区间需要升级服务端"
        else r.message
```

副文案同样要分叉，不能一句话包打天下：

```kotlin
private fun reportErrorHint(error: String): String = when {
    error.contains("升级服务端") -> "当前服务端版本不支持自定义区间，请更新后端后重试"
    error.contains("登录") || error.contains("401") -> "登录状态可能已过期，请重新登录"
    error.contains("格式错误") -> "所选区间不合法，请重新选择起止月份"
    else -> "检查网络连接后重试；持续失败请确认服务端是否可访问"
}
```

鸿蒙侧对应 `Reports.ets` 的 `errorHint()`，逻辑逐条对齐。

### 判据

**「猜测型」错误文案的有效期只有一个版本。** 写的时候它准确，
一旦被猜测的那个前提消失（服务端升级了），它就变成误导。
诊断信息必须来自被诊断的对象本身。

---
## 58. 可选回调 + 无默认值 = 漏传温床（TopBar 返回键 13 页全失效）

`Components.ets` 的 `TopBar` 原先这么写：

```ts
export struct TopBar {
  onBack?: () => void;          // ← 可选
  // 点击处
  .onClick(() => this.onBack && this.onBack())   // ← 漏传就静默什么都不做
}
```

结果 **11 个页面**（Accounts / AiScan / Budgets / Category / DataManagement /
Debts / Planning / SavingsGoals / Search / Settings / Tags）都写成
`TopBar({ title: 'xxx' })` 漏传回调 —— 返回箭头照常渲染、有按压反馈，
点了毫无反应。ArkTS 对漏传可选属性不产生任何告警，靠"记得传"覆盖 20+ 页面不可能。

修法是把默认值落在「绝大多数调用方都想要」的行为上：

```ts
/**
 * 返回回调。**不传即默认 router.back()** —— 不要改回「可选且无默认」。
 */
onBack: () => void = () => { router.back(); };
```

点击处也从 `this.onBack && this.onBack()` 改成直接 `this.onBack()`。

`Main.ets` 是路由栈根，默认退栈等于退出应用，所以它单独实现 `onBackPress()`：
浮层展开时先关浮层。

### 判据

**画出来却不响应，比没有按钮更糟** —— 用户会反复点，以为应用卡死。
可选回调（`f?: () => void`）只适用于「不传就是明确不要这个行为」的场景；
凡是「几乎所有调用方都想要同一个行为」，就必须给默认值，而不是留空等人传。

---

## 59. HitTestMode.Default 会吞掉下层触摸（环图只能点一次）

统计页环图选中后，其余色块点击全部失效。第一反应是命中测试算错了，
但读 `handleTouch` 确认半径带（44~80）和角度换算都对 —— 真因在 build：
选中后会叠一层 280×280 的全尺寸标注层（画引线和数值），
它默认 `HitTestMode.Default`，会消费自身范围内的触摸并阻塞下层，
于是 Canvas 再也收不到点击。

```ts
// 纯展示层必须显式声明不参与命中测试
Stack() { /* 引线 + 数值标注 */ }
  .hitTestBehavior(HitTestMode.None)
```

* `HitTestMode.None` —— 自身不响应，也不阻塞下层（纯展示层用这个）
* `HitTestMode.Transparent` —— 自身响应但也放行下层
* `HitTestMode.Default` —— 自身响应并阻塞下层（默认值，就是这次的坑）

**这是鸿蒙独有的 bug**：安卓同样的全尺寸标签层不会导致此问题 ——
Compose 里没设 `clickable` 的 `Box` 不拦截手势。

### 判据

「只有第一下有用」这类症状，先查有没有新出现的覆盖层，
再怀疑命中测试算法。ArkUI 里任何盖在可交互元素之上的装饰层，
默认都是会吃掉点击的。

---

## 60. 隐藏手势不是入口（账户页"没有编辑删除功能"）

用户反馈「安卓账户管理页没有编辑删除功能」。读代码发现功能**一直都有**：
`combinedClickable` 的 `onLongClick` 呼出操作面板，副标题甚至写了
「· 长按管理」四个字。

问题不在功能缺失，在可发现性：`labelSmall` 灰字 + 隐藏手势，
不足以让人发现。修法是加可见的「⋯」按钮作主入口，长按降级为快捷方式：

```ts
AccountListItem({ account: a, onTap: ..., onMore: () => { this.acting = a; } })
  // 长按作为快捷方式（对齐安卓 combinedClickable），可见的「⋯」才是主入口
  .gesture(LongPressGesture().onAction(() => { this.acting = a; }))
```

安卓侧同时删掉副标题里的「· 长按管理」—— 有了可见按钮就不需要教用户手势了。

鸿蒙侧则是真缺功能：`Api.ts` 四个方法（create/update/close/delete）全都有，
但 `Accounts.ets` 一个都没接。

### 判据

**找不到的功能等于不存在。** 灰色小字提示 + 长按/滑动手势
不构成一个功能入口。任何用户可能主动去找的操作，
都必须有一个视觉上可见、可点的控件。

### 续集：入口要长在用户正在看的那一页（账户**详情**页复发）

上面这条修完列表页之后，用户又反馈「资产账户只有计息功能，修改删除功能没有」。

这次不是可发现性问题，是**页面覆盖问题**：编辑/销户/删除只做在账户**列表页**
（可见「⋯」+ 长按），而账户**详情页**从头到尾只有一个「记利息」按钮。
用户从列表点进详情页看完余额和流水，想改这个账户 —— 在他眼前那一页找不到入口。

```ts
// ❌ 详情页只有单个操作
if (this.account) {
  Button('记利息').width('100%').onClick(...)
}

// ✅ 一排可见方块，覆盖该实体的全部常用操作
Row({ space: 8 }) {
  if (active) { ActionChip({ emoji: '💰', label: '记利息', onTap: ... }) }
  ActionChip({ emoji: '✏️', label: '编辑', onTap: ... })
  if (active) { ActionChip({ emoji: '📥', label: '销户', onTap: ... }) }
  ActionChip({ emoji: '🗑️', label: '删除', danger: true, onTap: ... })
}
```

**判据升级：一个实体的常用操作，必须在「用户能看到这个实体的每一页」都可达。**
只在列表页提供，等于要求用户先退回去 —— 而他往往不知道要退回去。

配套的三条实现约定：

1. **提取公共 `ActionChip`**（两端各一份，安卓 `ui/components/Components.kt`、
   鸿蒙 `common/components/Components.ets`）。投资详情页原本有个私有
   `TxnActionChip`，账户详情页要用同款时**提取而非复制** —— 详情页操作区
   两端两页必须长一个样，各自一份必然在下次改动时走形。
   破坏性操作用 `danger: true` 走 error 色，在一排方块里可区分。
2. **表单复用列表页的，不另写一套。** 字段校验规则（信用卡必填额度、利率格式、
   计息周期取值）只应有一处实现。
   ⚠️ Kotlin 的 `private` 是**文件级**作用域 —— `AccountsScreen.kt` 里的
   `private fun AccountFormDialog` 同包不同文件也访问不到，
   必须放宽到 `internal`。报错形如 `Cannot access '...': it is private in file`。
3. **删除成功后必须离开详情页**（安卓 `popBackStack()` / 鸿蒙 `router.back()`）。
   实体已经不存在，留在原页只会展示陈旧数据，下次刷新还会拉空。
   销户与编辑相反 —— 账户仍存在，应留在原页刷新。
   安卓这里有个坑：`AccountsViewModel` 把新增/编辑/销户/删除都汇流到同一个
   `submit()`，成功后统一置 `formDone = true`，回调里**分辨不出刚才干的是哪件事**，
   所以要额外一个 `pendingDeleted` 标记来区分，不能只看 `formDone`。

回归校验：`node scripts/verify-account-detail-actions.js`（50 项）。

---

## 61. 转账折叠：判据、层级与编辑路由

一笔转账在库里是**两条腿**（`transactions` 表的 `transfer_out` + `transfer_in`，
靠 `transfer_id` 关联到 `transfers` 主表）。这个设计是对的 ——
每个账户的余额都要能独立从自己的流水推导（`computeAccountBalance`）。
问题只在展示层：列表把两条腿都渲染出来，用户看到同一笔转账重复两次。

### 折叠必须在 SQL 层

```js
sql += ` AND NOT (
  t.type = 'transfer_in' AND t.transfer_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM transactions x
    WHERE x.transfer_id = t.transfer_id
      AND x.type = 'transfer_out'
      AND x.user_id = t.user_id AND x.book_id = t.book_id
  )
)`;
```

拿到结果后在 JS 里 `filter` 是错的：分页是 SQL 的 `LIMIT/OFFSET`，
JS 过滤会让 `limit=20` 实际只显示 14 条，且「有没有下一页」的判断全错。

`EXISTS` 子查询必须带 `user_id` / `book_id` ——
否则另一个用户碰巧同 `transfer_id` 的 out 腿会隐藏本用户的 in 腿。

### 判据不能按 type 一刀切

必须是「有 `transfer_id` **且**存在配对 out 腿」：

1. `POST /transactions` 允许单独创建 `transfer_in` 且 `transfer_id` 为 NULL
   （用户手动记的单边入账），一刀切会让它消失
2. 历史脏数据里 out 腿被删而 in 腿残留，一刀切会让它永久不可见**也无法删除**

### 客户端判据用 `transfer` 字段，不用 type

服务端只在 `transfer_id` + 双端账户名三者齐全时才构造 `transfer`
（`{ id, from, to }`）。账户被删导致 JOIN 不到名字时它是 null，
此时退回普通渲染 —— 而不是显示「? → ?」。

```ts
private isTransfer(): boolean {
  const t = this.item?.transfer;
  return t !== undefined && t !== null;
}
```

### 转账用中性色 + 无正负号

钱只是换口袋，总资产没变。原先 `type !== 'income'` 一律红色 `-1000`
看着像花掉了。安卓侧同理：`isTransfer` 要先于 `isIncome`/`isExpense` 判断，
否则 `transfer_in` 会被当成收入涂绿加 `+`。

### 编辑必须走 `/transfers/:id`，删除两条路都行

**编辑**：那条列表记录的 id 只是两条腿之一。走 `PUT /transactions/:id`
只会改一条腿 —— 金额从 100 改成 200 时转出账户扣了 200 而转入账户还是加 100，
两个账户余额从此对不上。必须走 `PUT /transfers/:id`（内部删掉该
`transfer_id` 的所有腿再重建两条，并重算涉及的全部账户余额）。

**删除**：两条路都安全 —— `DELETE /transactions/:id` 已按 `transfer_id`
级联删掉所有腿和 `transfers` 主记录（`transactions.js:491-501`）。
仍走 `DELETE /transfers/:id` 只是语义更直白：用户删的是「一笔转账」。

`PUT /transfers/:id` 是**全量替换**语义，五个字段
（`from_account_id` / `to_account_id` / `amount` / `note` / `date`）必须全传，
漏传 `note` 会被清成空串。

回填时要剔掉服务端自动写的备注（`转账至X` / `来自X`）——
那是系统生成的，当成用户备注回填会让用户每次编辑都把它固化下来。

### `/summary` 不受影响（必须钉死）

`/summary` 只 `SUM` `income` / `expense`，转账从不计入，
所以折叠不影响任何汇总数字。**若哪天汇总口径改成含转账，
折叠就会导致列表与汇总对不上** —— 改口径时必须同步回看这里。

### web 端的隐藏回归

`public/js/app.js` 的 `mergeTransferPairs` 靠「列表里同时存在两条腿」配对。
服务端折叠后 in 腿不再返回，配对失败 → `_transferIn` 为 undefined →
渲染成「工资卡 → ?」。这是**只在部署新服务端后才暴露**的回归，
本地旧服务端测不出来。修法是优先吃服务端给的 `t.transfer`，
客户端配对逻辑保留作旧服务端兜底。

两个验证脚本钉住这些判据：

* `scripts/verify-transfer-collapse.js` —— 36 项（SQL 折叠、单边入账保留、
  残留腿保留、跨用户不误配对、余额与汇总不受影响、分页正确性、路由分发）
* `scripts/verify-transfer-merge-client.js` —— 24 项（web 端对「已折叠」
  与「未折叠」两种服务端返回形态都渲染成一条 A → B）

---

## 62. 复用现成组件前先确认 API 在当前版本可用

给安卓转账编辑写下拉时，第一版用了 `ExposedDropdownMenuBox` —— 编译报
`Unresolved reference 'ExposedDropdownMenu'`，且触发 6 处实验 API 报错。

grep 全项目发现**没人用过** `ExposedDropdown*`，
而 `Components.kt` 早有现成的 `DropdownField(label, value, options, emptyHint, onSelected)`
和 `DatePickerField(label, date, onDateChange)`，
用的是稳定的 `DropdownMenu` + 已处理好 `@OptIn` 的日期弹层。

换用公共组件后，自造的 40 行 `AccountDropdown` 和自建日期弹层全部删除，
且与「记一笔」页视觉一致。

### 判据

要用某个 Material3 API 前，先 grep 项目里有没有人用过。
**没人用过的 API 有两种可能：没人需要，或者它在当前 BOM 版本里不可用。**
后者会浪费一整轮编译。项目里已有的同类组件永远是第一选择 ——
它不仅能编译，还顺带保证了视觉一致性。

---
## 63. 单条接口必须自洽（转账编辑「无法定位转账记录」）

web 端编辑转账点保存，弹「无法定位转账记录」，一次都存不进去。判据是这行：

```js
const old = await api(`/transactions/${editId}`, 'GET');
if (!old || !old.transfer_id) { showToast('无法定位转账记录', 'error'); return; }
```

而 `GET /transactions/:id` **从来不返回 `transfer_id`** —— 它只
JOIN categories / accounts / budgets，不 JOIN transfers。
判据依赖的字段服务端压根没给过，所以这条路 100% 必挂。

### 为什么没早发现：回填是对的，保存是死的

同一个弹窗的**回填**走的是列表缓存 `_lastMergedTransfers`（里头有
服务端折叠给的 `transfer.to`），所以打开弹窗一切正常 ——
金额、双端账户、备注全都填对了。只有点「保存」才炸。

**只测「打开弹窗数据对不对」永远发现不了这个 bug。**
凡是「读一个源、写另一个源」的表单，必须把保存链路单独走一遍。

### 修法一：单条接口补齐 JOIN（根治）

```sql
LEFT JOIN transfers tr ON t.transfer_id = tr.id
LEFT JOIN accounts fa ON tr.from_account_id = fa.id
LEFT JOIN accounts ta ON tr.to_account_id = ta.id
```

并输出与列表接口**同名同形**的 `transfer_id` + `transfer`
（`{ id, from, to }`），客户端一套解析逻辑通吃两个接口。

注意加 JOIN 时别把 `WHERE t.user_id = ? AND t.book_id = ?` 弄丢。

### 修法二：客户端多级回退（不把命门交给单一字段）

```js
async resolveTransferId(editId) {
  // ① 打开弹窗时缓存的（零请求，且旧服务端也 work）
  if (this._editingTransferId && this._editingTxId === idNum) return this._editingTransferId;
  // ② 单条接口
  const tid = old?.transfer_id || old?.transfer?.id;
  if (tid) return tid;
  // ③ 列表缓存配对结果（旧服务端返回两条腿时）
  return hit?.transfer?.id || hit?.transfer_id || null;
}
```

缓存命中**必须校验 `txId` 匹配**，否则先编一笔转账、再编另一笔，
会拿上一笔的 `transfer_id` 去改 —— 改错记录比报错严重得多。
同理，编辑普通交易和新增时都要把缓存清空。

### 顺带修掉的方向错误

回填「转出账户」原先用 `t.account.id` —— 那是**这条腿自己**挂的账户。
点到 out 腿时它恰好是转出方，但点到残留的 in 腿时它是转入方，
直接填进「转出账户」就把方向弄反了，一保存钱倒着走。
应优先取 `transfer.from.id`。

### 判据

**接口要自洽。** 不能要求调用方「先拉一次列表、再从缓存里反查」——
列表缓存可能是上个月的、可能被筛选条件过滤掉、可能页面刚刷新还没有。
凡是详情接口，返回体必须够支撑该实体的全部编辑操作。

`scripts/verify-transfer-edit-resolve.js` 42 项钉住这些判据
（含源码级断言：JOIN 在不在、字段有没有输出、旧的单一判据有没有被写回去）。

---

## 64. `datetime-local step="1"` 必须回填到秒

截图里日期显示 `2026/08/23 00:02:00`，而库里存的是 `00:00:00`。

`index.html` 写的是 `<input type="datetime-local" id="transDate" step="1">` ——
**带 `step` 的控件会渲染秒位**。而回填用的 `fmtDate()` 只切到 16 位
（`YYYY-MM-DDTHH:mm`），秒位是**空的**。用户明明没碰过秒，
光标扫过去滚一下就变成 `00:02:00`，而且会当成用户输入提交上去。

### 不能直接把 fmtDate 改成 19 位

`fmtDate()` 还有三个 `type="date"` 的调用方
（`investBuyDate` / `reduceDate` / `interestDate`）。
`type="date"` 只接受 `YYYY-MM-DD`，多给时间部分会被浏览器
**直接拒收、value 变空**。所以拆成两个函数：

```js
function fmtDate(d)          { /* → YYYY-MM-DDTHH:mm，保持 16 位 */ }
function fmtDateTimeLocal(d) { /* → YYYY-MM-DDTHH:mm:ss，给 step="1" 用 */ }
```

`fmtDateTimeLocal` 要处理三种输入长度：纯日期（补 `T00:00:00`）、
只到分钟（补 `:00`）、已带秒（原样截 19 位）。

`quick-add.js` 里原本手写了一段拼接到秒的代码 —— 正好印证这个判据，
已换成统一函数。

### 连带修掉的预算筛选 bug

`updateBudgetSelect()` 拿 `transDate` 的值直接和 `b.end_date` 比：

```js
budgets.filter(b => transDate >= b.start_date && transDate <= b.end_date)
```

`b.end_date` 是纯 `'YYYY-MM-DD'`，而 `transDate` 带时间。
`'2026-08-31T10:00:00' <= '2026-08-31'` 为 **false** ——
预算区间**最后一天**记的账筛不出任何预算（除了 00:00:00 那一瞬）。
两边都 `.slice(0, 10)` 后再比。

### 判据

给日期控件回填前先确认它的 `type` 和 `step`：
* `type="date"` → `YYYY-MM-DD`，多一个字符都会被拒收
* `type="datetime-local"` 无 step → `YYYY-MM-DDTHH:mm`
* `type="datetime-local" step="1"` → **必须** `YYYY-MM-DDTHH:mm:ss`

**空的秒位不是"默认 0"，是"待用户填"** —— 控件会让它随手滚出值来。

---
