/**
 * 主框架（对齐安卓 AppNav.kt 的 MainScaffold）：底部 5 槽导航栏
 * 首页 / 账单 / 【●记账】 / 统计 / 我的，FAB 嵌栏内垂直居中（SpaceEvenly 等距）；
 * 记账浮钮弹 AI记账→Chat / 手动记账→AddTransaction。
 */
import router from '@ohos.router';
import { COLORS, withAlpha, TRANSPARENT, SHADOW } from '../common/theme';
import { AppBackground } from '../common/components/Components';
import { HomePage } from './Home';
import { TransactionsPage } from './Transactions';
import { ReportsPage } from './Reports';
import { ProfilePage } from './Profile';

@Entry
@Component
struct Main {
  @StorageProp('themeMode') themeMode: string = 'system';
  // 用 StorageLink 而非 State：首页卡片的「查看全部」需要切到统计 tab，
  // 直接 pushUrl 到 pages/Reports 会压出一个没有底部导航栏的孤立页面。
  @StorageLink('mainTabIndex') selectedIndex: number = 0;
  @State showAddMenu: boolean = false;
  @State fabRotation: number = 0;

  /** 记账速选卡：主选项(AI)实心品牌渐变 + 次选项(手动)浅卡，图标 chip + 标题 + 副文案，错峰弹起 */
  @Builder AddOption(label: string, sub: string, iconRes: Resource, primary: boolean, delay: number, onClick: () => void) {
    Stack() {
      Column().width('100%').height('100%').borderRadius(16)
        .linearGradient({
          angle: 135,
          colors: primary
            ? [[COLORS.brand, 0.0], [COLORS.brandLight, 1.0]]
            : [[COLORS.card, 0.0], [COLORS.card, 1.0]]
        })
      Row({ space: 12 }) {
        Column() {
          Image(iconRes).width(24).height(24)
            .fillColor(primary ? '#FFFFFF' : COLORS.brand)
        }.width(44).height(44).borderRadius(14)
          .backgroundColor(primary ? '#28FFFFFF' : COLORS.brandBgLight)
          .justifyContent(FlexAlign.Center)
        Column({ space: 2 }) {
          Text(label).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(primary ? '#FFFFFF' : COLORS.textPrimary)
          Text(sub).fontSize(12)
            .fontColor(primary ? '#CCFFFFFF' : COLORS.textSecondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text('›').fontSize(18).fontColor(primary ? '#99FFFFFF' : COLORS.placeholder)
      }.width('100%').height('100%').padding({ left: 12, right: 14 })
    }
    .width(248).height(64).borderRadius(16)
    .border({ width: primary ? 0 : 1, color: COLORS.divider })
    .shadow(primary
      ? { radius: 18, color: '#55665F2C', offsetY: 8 }
      : { radius: 10, color: '#14000000', offsetY: 4 })
    .onClick(onClick)
    .transition(
      TransitionEffect.OPACITY.animation({ duration: 220, delay: delay, curve: Curve.EaseOut })
        .combine(TransitionEffect.translate({ y: 30 }).animation({ duration: 320, delay: delay, curve: Curve.EaseOut }))
        .combine(TransitionEffect.scale({ x: 0.92, y: 0.92 }).animation({ duration: 320, delay: delay, curve: Curve.EaseOut }))
    )
  }

  private toggleMenu(): void {
    const open: boolean = !this.showAddMenu;
    animateTo({ duration: 280, curve: Curve.EaseInOut }, () => {
      this.showAddMenu = open;
      this.fabRotation = open ? 45 : 0;
    });
  }

  private closeMenu(): void {
    animateTo({ duration: 220, curve: Curve.EaseInOut }, () => {
      this.showAddMenu = false;
      this.fabRotation = 0;
    });
  }

  private goChat(): void {
    this.closeMenu();
    router.pushDestination({ url: 'pages/Chat' });
  }

  private goAdd(): void {
    this.closeMenu();
    router.pushDestination({ url: 'pages/AddTransaction' });
  }

  /**
   * 环境光柔光团（径向渐变：中心色 → 透明）。
   * 注意：收尾色必须用 withAlpha(color, 0)，不能写 color + '00' ——
   * ArkUI 是 #AARRGGBB，CSS 顺序的 '00' 后缀会被当成 B 分量，渲染成不透明色块。
   */
  @Builder Blob(x: string, y: string, color: string) {
    Column()
      .width('75%').height('42%')
      .position({ x: x, y: y })
      .radialGradient({
        center: ['50%', '50%'],
        radius: '100%',
        colors: [
          [withAlpha(color, 0.8), 0.0],
          [withAlpha(color, 0.35), 0.55],
          [withAlpha(color, 0), 1.0]
        ]
      })
      .blur(60)
  }

  /**
   * 账单图标：小票（严格对齐参照图/安卓 Icons.Outlined.ReceiptLong 的**描边线性**风格）。
   *
   * ⚠️⚠️ 三代坑记录，别再踩：
   *
   * 【坑一】`Image($r('app.media.ic_receipt')).fillColor(c)`
   *   fillColor() 只作用于 SVG 的 **fill** 属性。ic_receipt.svg 是描边式
   *   （fill="none" stroke="#000"），fillColor 把 fill="none" 覆盖成实色 → 整块深色。
   *
   * 【坑二】`Path().fill(Color.Transparent).stroke(c).strokeWidth(1.8)` —— 真机=小黑方块
   *   a) `fill(value: ResourceColor)` 传 Color.Transparent 能过编译，但在 Path 上
   *      **不等价于 SVG 的 fill="none"**，闭合子路径仍被默认色（黑）填满。
   *   b) `Path` **没有 viewPort()**（只有 Shape 有，shape.d.ts:500），commands 是 vp
   *      绝对坐标、不做 viewBox 缩放。
   *   c) 本项目内唯一真机验证通过的 Path 写法是 `Search.ets:FunnelIcon` 的
   *      **`fill(color) + strokeWidth(0)`** —— 即 **只有 fill 通道可靠，stroke 通道不要用**。
   *
   * 【坑三】改成实心填充块 —— 与参照图不符（参照图是线性描边），已撤回。
   *
   * 【本版做法】描边效果用「外轮廓顺时针 + 内轮廓逆时针」按 nonzero winding 挖空，
   * 全程只用 `fill(color)` 一个着色通道 —— 既得到线性描边观感，又完全绕开 stroke 通道。
   * 环宽 1.7vp，与同栏 SymbolGlyph 24vp 的笔画重量对齐。
   *
   * 形状规格（用户 2026-08-24 最终拍板，**勿再改动**）：
   *   · 顶边平直
   *   · 底边 3 个撕口锯齿（小票撕下来的毛边）
   *   · 中间 2 条条目横线
   * 期间曾按口述改成「顶锯齿 + 底卷筒」，用户看过渲染预览后选回本版。
   *
   * 【几何构造】整体只有 4 条子路径，全部靠 nonzero winding：
   *   ① 票身外轮廓（顺时针）→ ② 票身内轮廓（逆时针，挖空得到 1.7vp 环宽描边）
   *   ③④ 两条条目横线（顺时针细矩形，落在挖空区内 → winding 回到 1 正常填充）
   * ⚠️ 新增笔画时注意方向：与外轮廓同向（顺时针）才会填充，反向会挖出白洞。
   */
  @Builder ReceiptIcon(color: string) {
    Path()
      .width(24).height(24)
      .commands(
        // ① 票身外轮廓（顺时针）：顶边平直，底边 3 个撕口锯齿
        'M5 3 L19 3 L19 21 L16.5 19.2 L14 21 L11.5 19.2 L9 21 L6.5 19.2 L5 20.3 Z ' +
        // ② 票身内轮廓（逆时针：先沿左边向下）→ 挖空形成 1.7vp 描边
        'M6.7 4.7 L6.7 17.55 L9 19.2 L11.5 17.4 L14 19.2 L16.5 17.4 L17.3 17.98 L17.3 4.7 Z ' +
        // ③④ 两条条目横线
        'M8.9 7.4 L15.1 7.4 L15.1 8.9 L8.9 8.9 Z ' +
        'M8.9 10.7 L15.1 10.7 L15.1 12.2 L8.9 12.2 Z'
      )
      .fill(color)
      .strokeWidth(0)
  }

  /**
   * 统计图标：饼图（对齐参照图/安卓 Icons.Outlined.PieChart 的描边线性风格）。
   *
   * 形状规格（用户 2026-08-24 最终拍板，**勿再改动**）：
   *   · 圆环 + **12 点方向 + 3 点方向两条半径**，切出右上角一块扇形
   *   期间曾按口述改成「一条竖线贯穿全圆」，用户看过渲染预览后选回本版。
   *
   * 【几何构造】外圆顺时针 + 内圆逆时针挖空 → 圆环；两条半径为独立顺时针细矩形，
   * 压在挖空区上方（winding 回到 1 → 正常填充）：
   *   · 圆必须用两段半圆弧 A 命令拼（Path 的 commands 不支持 <circle> 元素）
   *   · 内圆 sweep 取 0（与外圆的 1 相反）才是逆时针、才能挖空
   */
  @Builder PieIcon(color: string) {
    Path()
      .width(24).height(24)
      .commands(
        // 外圆 r=9.5（顺时针 sweep=1）
        'M2.5 12 A9.5 9.5 0 1 1 21.5 12 A9.5 9.5 0 1 1 2.5 12 Z ' +
        // 内圆 r=7.8（逆时针 sweep=0）挖空 → 1.7vp 圆环
        'M4.2 12 A7.8 7.8 0 1 0 19.8 12 A7.8 7.8 0 1 0 4.2 12 Z ' +
        // 12 点方向半径（竖）
        'M11.15 4.2 L12.85 4.2 L12.85 12.85 L11.15 12.85 Z ' +
        // 3 点方向半径（横）
        'M11.15 11.15 L19.8 11.15 L19.8 12.85 L11.15 12.85 Z'
      )
      .fill(color)
      .strokeWidth(0)
  }

  /** 按 kind 分派图标：house/person 用系统 SymbolGlyph，receipt/pie 用 Path 自绘（见上方注释） */
  @Builder NavIcon(kind: string, color: string) {
    if (kind === 'home') {
      SymbolGlyph($r('sys.symbol.house')).fontSize(24).fontColor([color])
    } else if (kind === 'receipt') {
      this.ReceiptIcon(color)
    } else if (kind === 'pie') {
      this.PieIcon(color)
    } else {
      SymbolGlyph($r('sys.symbol.person')).fontSize(24).fontColor([color])
    }
  }

  /**
   * 单个底部文字 tab（图标 + 文字，整体垂直居中），严格对齐安卓 AppNav.kt 的 TabItem。
   *
   * 安卓那边选中态只做两件事，这里不多不少照搬：
   *   1. 图标 tint 与文字 color 一起切到 primary（未选中 onSurfaceVariant）
   *   2. animateDpAsState 0→3dp 阴影，tween 220ms，阴影色 primary @35% alpha
   *
   * 选中态照参照图（367b365…jpg）实现，只做图上看得见的两件事：
   *   1. 图标 + 文字一起切品牌色（未选中 textSecondary）
   *   2. 图标背后一层**浅品牌色圆底**（参照图「我的」那圈明显的浅色圆），220ms 淡入
   *
   * ⚠️ 刻意 **不做** 的（参照图上没有，加了就是自己创新）：
   *   · 不放大图标（无 scale）
   *   · 文字不加粗
   *   · 不加投影（参照图是纯平的浅色圆底，没有柔光/阴影）
   *
   * 按压反馈用 clickEffect（等价安卓 clickable 默认 ripple），旧代码完全没有，
   * 这是用户反馈"点击效果差距大"的直接原因。
   */
  @Builder NavTab(index: number, label: string, kind: string) {
    Column({ space: 4 }) {
      Stack() {
        this.NavIcon(kind, this.selectedIndex === index ? COLORS.brand : COLORS.textSecondary)
      }
      .width(34).height(34)
      .borderRadius(17)
      .backgroundColor(this.selectedIndex === index ? withAlpha(COLORS.brand, 0.10) : TRANSPARENT)
      .animation({ duration: 220, curve: Curve.EaseOut })

      Text(label).fontSize(11)
        .fontColor(this.selectedIndex === index ? COLORS.brand : COLORS.textSecondary)
        .animation({ duration: 220, curve: Curve.EaseOut })
    }
    .height(64).justifyContent(FlexAlign.Center)
    .padding({ left: 4, right: 4 })
    .clickEffect({ level: ClickEffectLevel.LIGHT, scale: 0.88 })
    .onClick(() => { this.selectedIndex = index; })
  }

  /** 底部 5 槽导航栏：首页 / 账单 / 【●记账】 / 统计 / 我的（对齐安卓 SpaceEvenly 均分） */
  @Builder BottomNav() {
    Row() {
      this.NavTab(0, '首页', 'home')
      this.NavTab(1, '账单', 'receipt')
      // 中间「记账」暖棕圆形按钮：嵌栏内垂直居中，作为 Row 第 3 个成员参与等距分布；
      // 展开时旋转 45° 成「×」并填充品牌色，作为关闭态
      Column() {
        SymbolGlyph($r('sys.symbol.plus')).fontSize(30)
          .fontColor([this.showAddMenu ? '#FFFFFF' : COLORS.brand])
      }.width(46).height(46)
        .backgroundColor(this.showAddMenu ? COLORS.brand : COLORS.card)
        .border({ width: 1.5, color: COLORS.brand })
        .borderRadius(23)
        .shadow({ radius: 6, color: '#55995F2C' })
        .rotate({ angle: this.fabRotation })
        .clickEffect({ level: ClickEffectLevel.MIDDLE, scale: 0.9 })
        .onClick(() => this.toggleMenu())
      this.NavTab(2, '统计', 'pie')
      this.NavTab(3, '我的', 'person')
    }
    .width('100%').height(64)
    // 半透明底 + 仅上边框：不透明白底会把环境光在栏顶切出横向断层，
    // 也让「内容从导航栏下方透出」的层次感消失。0.88 是可读性与透光的平衡点
    // （图标/文字对比度仍远超 AA）。border 只能给 bottom/top 单边，
    // 写 { width: 1 } 会四边全画线，左右两条竖线在真机上肉眼可见。
    .backgroundColor(withAlpha(COLORS.surface, 0.88))
    .border({ width: { top: 0.5 }, color: COLORS.outlineVariant })
    .justifyContent(FlexAlign.SpaceEvenly)
    .alignItems(VerticalAlign.Center)
    .shadow({ radius: 10, color: SHADOW.card, offsetY: -2 })
  }

  /**
   * 系统返回键 / 侧滑返回。
   *
   * Main 是 Tab 容器（首页/账单/统计/我的），是路由栈的根 —— 默认行为是退栈，
   * 而根页退栈就是退出应用。于是速选卡浮层展开时按返回键会直接退出 App，
   * 而不是先关掉浮层，这是所有平台的通用预期。
   *
   * 返回 true = 已消费，不再执行默认退栈。
   */
  onBackPress(): boolean {
    if (this.showAddMenu) {
      this.closeMenu();
      return true;
    }
    return false;   // 交给系统默认行为（根页退出应用）
  }

  build() {
    Stack() {
      // 环境光背景（统一 AppBackground 组件 — 与设计 token 同源，自动适配亮/暗主题）
      AppBackground()
      Column() {
        // 内容区：按选中索引切换页面（对齐安卓 routeKey 归并逻辑，点击切换无滑动）
        Stack() {
          if (this.selectedIndex === 0) {
            HomePage()
          } else if (this.selectedIndex === 1) {
            TransactionsPage()
          } else if (this.selectedIndex === 2) {
            ReportsPage()
          } else {
            ProfilePage()
          }
        }.layoutWeight(1).width('100%')

        this.BottomNav()
      }.width('100%').height('100%')

      // 记账浮钮菜单（覆盖内容区，FAB 仍在导航栏内可点）：软渐变遮罩 + 自 FAB 上方弹起的速选卡
      if (this.showAddMenu) {
        // ⚠️ 这里用 Column 把「遮罩区」和「导航栏留空区」显式切开，而不是
        // 「Stack + 遮罩 height('100%') + margin bottom 64」。原因见下方两条注释。
        Column() {
          // 遮罩区：layoutWeight(1) 让它精确等于「屏高 − 导航栏 64」。
          // 旧写法给遮罩 height('100%') 再 margin bottom 64，布局盒总高变成
          // 100%+64，渐变色标是按盒高算的 —— 1.0 那档（最深）会落到屏幕外，
          // 栏顶实际拿到的是 ~93% 处的颜色，比设计值浅。用 layoutWeight 后
          // 渐变 1.0 正好压在栏顶，与安卓一致。
          Stack({ alignContent: Alignment.Bottom }) {
            // 遮罩：自上而下由透明过渡到品牌深底，避免"死黑"呆板感
            Column().width('100%').height('100%')
              .linearGradient({
                angle: 90,
                colors: [
                  [TRANSPARENT, 0.0],
                  [withAlpha(COLORS.fabBg, 0.55), 0.55],
                  [withAlpha(COLORS.fabBg, 0.9), 1.0]
                ]
              })
              .onClick(() => this.closeMenu())
              .transition(TransitionEffect.OPACITY.animation({ duration: 220, curve: Curve.EaseOut }))
            // 自底部导航栏上方弹起的两张速选卡（错峰入场：AI 先、手动后）。
            //
            // ⚠️ 贴底靠的是父 Stack 的 alignContent，不是子节点的 .align()。
            // 旧代码在这个 Column 上写 .align(Alignment.Bottom) 是死代码 ——
            // align() 是「在自身富余空间内摆放内容」，而 Column 高度由内容撑开、
            // 富余空间恒为 0，所以它什么都不做。真正生效的是外层 Stack 默认的
            // alignContent: Center，于是两张卡飘在屏幕正中，离拇指有大半屏距离。
            //
            // margin.bottom 20 对齐安卓 AppNav.kt:341 的 padding(bottom = 84.dp)
            // ——那个 84 是从屏底算的，减去 64 栏高正好是 20。
            Column({ space: 14 }) {
              this.AddOption('AI 记账', '对话或拍照，一句话入账', $r('app.media.ic_camera'), true, 0,
                () => this.goChat())
              this.AddOption('手动记账', '逐项填写，精确记录', $r('app.media.ic_receipt'), false, 80,
                () => this.goAdd())
            }
            .margin({ bottom: 20 })
          }
          .layoutWeight(1).width('100%')

          // 导航栏留空区：不画任何东西，只为把遮罩顶住在栏顶之上。
          // HitTestMode.None = 自身不响应事件且不阻塞下层，否则这块会吃掉点击，
          // 展开状态下 FAB（此时是「×」关闭按钮）按不动。
          Column().width('100%').height(64)
            .hitTestBehavior(HitTestMode.None)
        }
        .width('100%').height('100%')
        // Transparent = 自身可响应但不阻塞同层兄弟节点，
        // 保证事件能穿到下面那层（内容区 + BottomNav）。
        .hitTestBehavior(HitTestMode.Transparent)
      }
    }.width('100%').height('100%').backgroundColor(COLORS.pageBg)
  }
}
