/**
 * 通用 UI 组件库（对齐安卓端 Material 组件）。
 * 所有组件以 @Component struct 形式导出，供各页面 import 后以 <Xxx .../> 使用。
 */
import router from '@ohos.router';
import { COLORS, fmtMoney, SPACING, RADIUS, SHADOW, FONT_SIZE, withAlpha, TRANSPARENT } from '../theme';
import { TransactionItem, Account, Book } from '../models';
import { DonutPiece, SLICE_PALETTE } from './Charts';

/** 顶部栏：标题 + 可选返回键（对齐安卓 TopBar） */
@Component
export struct TopBar {
  title: string = '';
  showBack: boolean = true;
  /**
   * 返回回调。**不传即默认 router.back()** —— 不要改回「可选且无默认」。
   *
   * 原先声明成 `onBack?: () => void` 且点击处写 `this.onBack && this.onBack()`，
   * 于是 10 个页面（Accounts / Budgets / Category / DataManagement /
   * Debts / Planning / SavingsGoals / Search / Settings / Tags）都写成
   * `TopBar({ title: 'xxx' })` 漏传回调 —— 返回箭头照常渲染，点了毫无反应。
   *
   * 画出来却不响应比没有按钮更糟：用户会反复点，以为应用卡死。
   * 而漏传不会有任何编译告警，靠"记得传"是不可能覆盖 20+ 页面的。
   *
   * 判据：**默认值要落在「绝大多数调用方都想要」的那个行为上。**
   * 返回键 99% 的语义就是退栈，只有少数页面需要拦截（如表单未保存确认），
   * 那些页面显式传自己的实现即可覆盖。
   */
  onBack: () => void = () => { router.back(); };
  /** 右侧操作（图标或文字按钮）；不传则不渲染 */
  @BuilderParam trailing: () => void = this.defaultTrailing;
  @Builder defaultTrailing() {}
  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      // 顶栏底：从「几乎不透明」渐变到「半透明」，让下方的环境光柔光透过来。
      //
      // 为什么不用 COLORS.surface 收尾（原写法）：
      //   surface 是完全不透明的，顶栏会在环境光上切出一条横向断层 —— 上面是纯色
      //   顶栏、下面是柔光渐晕，中间一道硬边。改成整段半透明后柔光连续贯穿。
      // 为什么不直接用 glassFill/glassHighlight：
      //   那两个 token 在暗色下分别是 80% 深棕和 20% 白，20% 白用作渐变起点会在
      //   顶栏顶部拉出一条发亮的浅灰带 —— 亮暗两套语义方向是反的，不能通用。
      Row()
        .width('100%').height('100%')
        .linearGradient({
          angle: 180,
          colors: [
            [withAlpha(COLORS.surface, 0.94), 0.0],
            [withAlpha(COLORS.surface, 0.86), 0.6],
            [withAlpha(COLORS.surface, 0.72), 1.0]
          ]
        })
        .border({ width: { bottom: 0.5 }, color: COLORS.outlineVariant })
      Row() {
        if (this.showBack) {
          Text('‹')
            .fontSize(30).fontColor(COLORS.textPrimary).width(36).height(36)
            .textAlign(TextAlign.Center).borderRadius(18)
            .backgroundColor(COLORS.surfaceVariant)
            .onClick(() => this.onBack())
        }
        Text(this.title)
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
          .layoutWeight(1).margin({ left: this.showBack ? 12 : 4 })
        this.trailing()
      }
      .width('100%').height('100%')
      .padding({ left: 16, right: 16 })
    }
    .width('100%')
    .height(56)
  }
}

/** 区块标题（对齐安卓 SectionTitle）：品牌色竖条 + 文字 */
@Component
export struct SectionTitle {
  text: string = '';
  build() {
    Row({ space: 8 }) {
      Column().width(3).height(16).backgroundColor(COLORS.brand).borderRadius(2)
      Text(this.text)
        .fontSize(15).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
    }.margin({ left: 4, top: 6, bottom: 4 }).alignItems(VerticalAlign.Center)
  }
}

/** 金额卡（对齐安卓 BalanceCard）：primaryContainer 浅棕容器 + onPrimaryContainer 深棕文字 + 圆角20 + 可选点击 */
@Component
export struct BalanceCard {
  title: string = '';
  @Prop amount: number = 0;
  subtitle?: string = '';
  /**
   * 多币种 P2-3b：金额货币代码（ISO 4217）。amount 是该币种下的主货币值。
   * 不传时默认 CNY，向后兼容所有旧调用方。
   * 混币种账本下应传主货币（如 dashboard.month.currency）；
   * 多币种混显由调用方在 subtitle 文本里手工拼接（如「¥1,000.00 ($50.00)」）。
   */
  currency: string = 'CNY';
  onTap?: () => void;
  build() {
    Column({ space: 6 }) {
      Text(this.title).fontSize(14).fontColor(COLORS.brand)
      Text(fmtMoney(this.amount, this.currency)).fontSize(30).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
      if (this.subtitle) {
        Text(this.subtitle).fontSize(12).fontColor(COLORS.brand).opacity(0.7)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(20)
    .backgroundColor(COLORS.brandBg)
    .borderRadius(20)
    .onClick(() => this.onTap && this.onTap())
  }
}

/** 空状态（对齐 EmptyState） */
@Component
export struct EmptyState {
  icon: string = '🔍';
  text: string = '暂无数据';
  build() {
    Column({ space: 8 }) {
      Text(this.icon).fontSize(40)
      Text(this.text).fontSize(14).fontColor(COLORS.textSecondary)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 60, bottom: 60 })
  }
}

/** 加载态 */
@Component
export struct LoadingBox {
  build() {
    Column() {
      LoadingProgress().width(32).height(32).color(COLORS.brand)
      Text('加载中...').fontSize(13).fontColor(COLORS.textSecondary).margin({ top: 8 })
    }
    .width('100%').alignItems(HorizontalAlign.Center).padding({ top: 60, bottom: 60 })
  }
}

/** 错误态（对齐安卓 ErrorState：重试 + 鉴权重登）。
 * 当 message 命中 401/登录/过期/失效 等关键字时，自动提示「重新登录」，
 * 点击跳登录页；若传入 onLogin 则优先回调它（如清 token 后跳转）。 */
@Component
export struct ErrorState {
  message: string = '加载失败';
  onRetry?: () => void;
  onLogin?: () => void;
  private needLogin(): boolean {
    return /401|未登录|登录|过期|失效|token|鉴权|授权/.test(this.message);
  }
  build() {
    Column({ space: 10 }) {
      Text('⚠️').fontSize(36)
      Text(this.message).fontSize(14).fontColor(COLORS.textSecondary)
      if (this.onRetry) {
        Button('重试').height(36).onClick(() => this.onRetry!())
      }
      if (this.needLogin()) {
        Button('重新登录').height(36).backgroundColor(COLORS.brand)
          .onClick(() => {
            if (this.onLogin) { this.onLogin(); }
            else { router.replaceUrl({ url: 'pages/Login' }); }
          })
      }
    }
    .width('100%').alignItems(HorizontalAlign.Center).padding({ top: 60, bottom: 60 })
  }
}

/** 线性进度条（对齐 LinearProgress），value 0~1。
 * 用「轨道 Column + 填充 Row(百分比宽度)」标准写法，避免 Stack 内百分比子节点 + layoutWeight 冲突导致的测量崩溃。 */
@Component
export struct LinearProgress {
  value: number = 0;
  color: string = COLORS.brand;
  barHeight: number = 6;
  showPercent: boolean = false;

  private ratio(): number {
    const v = Number(this.value);
    if (!v || isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  build() {
    Row({ space: 6 }) {
      Column() {
        Row().width(`${this.ratio() * 100}%`).height('100%')
          .backgroundColor(this.color).borderRadius(this.barHeight / 2)
      }.width('100%').height(this.barHeight).backgroundColor(COLORS.divider)
        .borderRadius(this.barHeight / 2).layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (this.showPercent) {
        Text(`${Math.round(this.ratio() * 100)}%`)
          .fontSize(11).fontColor(COLORS.textSecondary)
      }
    }.width('100%').alignItems(VerticalAlign.Center)
  }
}

/**
 * 分类条形排行（对齐安卓 CategoryBars）：emoji 图标 + 名称 + 金额·pct% 标签 + 进度条，
 * 按 SLICE_PALETTE 取色。用于统计页分类排行卡片，替代原内联简化版。
 */
@Component
export struct CategoryBars {
  /**
   * ⚠️ 必须 @Prop。统计页现在让这个列表随环图选中项切换数据（选中大类 → 展开其二级子类），
   * 而无装饰器的成员变量只在首次构造时赋值。一旦 ArkUI 复用了实例，
   * 列表就会永久停在第一次传入的那批子类上 —— 点别的色块列表不动，不报错也不崩。
   * 这是本项目已经踩过两次的坑（见 Chip.active / CategoryIcon.selected）。
   */
  @Prop items: DonutPiece[] = [];
  /**
   * 占比分母。留空则用 items 自身之和；当 items 是「某个父类的子类」时应传父类总额
   * —— 否则子类之和小于父类（存在未细分的部分）时，子类占比会被放大到 100%，
   * 与环图上那一块的读数对不上。
   */
  @Prop baseTotal: number = 0;
  /**
   * 多币种 P2-3b：金额货币代码（默认 CNY）。
   * 混币种账本下若需要每行混显，应在外层用 fmtMoneyMix 生成
   * 字符串后通过 items[i].value 转 string 后传入（未支持，留待 P2-3c）。
   */
  currency: string = 'CNY';
  /** 调色板起始偏移：传父类在环图中的色号，让这一段颜色与选中色块产生视觉关联 */
  @Prop colorOffset: number = 0;
  onItemClick?: (index: number) => void;
  private total(): number {
    if (this.baseTotal > 0) return this.baseTotal;
    return this.items.reduce((s, it) => s + (it.value || 0), 0) || 0.0001;
  }
  build() {
    Column() {
      if (this.items.length === 0) {
        EmptyState({ text: '暂无数据' })
      } else {
        ForEach(this.items, (it: DonutPiece, i: number) => {
          Row({ space: 10 }) {
            Text(it.icon || '📌').fontSize(18).width(30).textAlign(TextAlign.Center)
            Column() {
              Row() {
                Text(it.name).fontSize(14).fontColor(COLORS.textPrimary).fontWeight(FontWeight.Medium).layoutWeight(1)
                Text(`${fmtMoney(it.value, this.currency)} · ${Math.round((it.value || 0) / this.total() * 100)}%`)
                  .fontSize(12).fontColor(COLORS.textSecondary)
              }.width('100%')
              LinearProgress({
                value: (it.value || 0) / this.total(),
                color: it.color || SLICE_PALETTE[(i + this.colorOffset) % SLICE_PALETTE.length],
                barHeight: 8
              }).margin({ top: 5 }).width('100%')
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%').padding({ top: 7, bottom: 7 })
            .onClick(() => { if (this.onItemClick) this.onItemClick(i); })
        }, (it: DonutPiece) => it.name)
      }
    }.width('100%')
  }
}

/** 分类图标圆（对齐 CategoryIcon）：emoji + 可选底色
 *
 *  ⚠️ bg 不要直接传后端的 category.color / tag.color。
 *  那些值是历史遗留的高饱和色（大量 #4CAF50 系亮绿），emoji 压在上面
 *  既和暖棕品牌撞色，也让 emoji 本身的颜色看不清。
 *  正确做法：不传 bg（用暖色中性底），选中态传 COLORS.brandBgLight 或 COLORS.brand。
 */
@Component
export struct CategoryIcon {
  icon: string = '📌';
  /** 底色。默认暖色中性底 —— emoji 自带颜色，底色只负责托住它，不该抢戏 */
  bg: string = COLORS.iconBgNeutral;
  iconSize: number = 40;
  /**
   * true = 选中态，加品牌色描边（比换底色更轻，不影响 emoji 辨识）。
   * 同 Chip.active：必须 @Prop —— 类目图标总在 `ForEach(categories)` 里，
   * key 是稳定的 category id，实例会被复用，无装饰器的 selected 不会随父状态更新。
   */
  @Prop selected: boolean = false;
  build() {
    Text(this.icon)
      .fontSize(this.iconSize * 0.5)
      .width(this.iconSize).height(this.iconSize)
      .textAlign(TextAlign.Center)
      .backgroundColor(this.selected ? COLORS.brandBgLight : this.bg)
      .borderRadius(this.iconSize / 2)
      .border(this.selected
        ? { width: 1.5, color: COLORS.brand }
        : { width: 0, color: TRANSPARENT })
  }
}

/** 交易行（对齐 TransactionRow / TransactionRowClickable）
 *  - compact: true  = 作为「列表行」嵌在 Card 容器内，不画自己的 border/background；
 *                row 顶部画 0.5px 分隔线（首条除外，可用 showTopDivider 控制）
 *  - compact: false = 独立卡片形态（默认，向后兼容 Transactions / Search / AccountDetail 列表）
 */
@Component
export struct TransactionRow {
  item?: TransactionItem;
  onItemClick?: () => void;
  /** true = 嵌入大卡片内作为一行（流水卡片） */
  compact: boolean = false;
  /** true = 顶部画 0.5px 分隔线；首条 row 传 false */
  showTopDivider: boolean = true;
  /**
   * 多币种 P2-3c：金额货币代码。优先取 item.currency（后端 transactions.js
   * 已 SELECT 透出），调用方不传时也能拿到；显式传入 currency prop 仍能覆盖
   * （用于详情页根据上下文强制指定币种）。
   * 老数据没 currency 字段时回落到 CNY，单币种账本下表现完全正确。
   */
  currency: string = '';

  /**
   * 是否是「折叠后的转账」。
   * 判据用 transfer 字段而非 type === 'transfer_out' —— 只有服务端 JOIN 到了
   * 两端账户才会下发 transfer，此时才拼得出 A → B。若账户已被删（JOIN 不到名字），
   * transfer 为 null，退回按普通记录渲染，不会显示成「? → ?」。
   */
  private isTransfer(): boolean {
    const t = this.item?.transfer;
    return t !== undefined && t !== null;
  }

  /** 多币种 P2-3c：实际使用的币种。prop 优先，未传时取 item.currency，兜底 CNY。 */
  private effectiveCurrency(): string {
    if (this.currency && this.currency !== '') return this.currency;
    if (this.item?.currency && this.item.currency !== '') return this.item.currency;
    return 'CNY';
  }

  private amountText(): string {
    const raw = fmtMoney(this.item?.amount ?? 0, this.effectiveCurrency()).replace('¥', '');
    if (this.isTransfer()) return raw;          // 转账不带正负号
    return (this.item?.type === 'income' ? '+' : '-') + raw;
  }

  /**
   * 第二行文案。
   *
   * 两行分工对齐 web 端表格列语义：第一行 = 分类列，第二行 = 账户列。
   * 转账时账户列正是「A → B」，与 web 的 `.trans-account` 渲染一致。
   *
   * 「A → B」放在备注之前不能反：备注长度不可控（用户可以写很长），
   * 若备注在前，省略号会把资金流向吃掉；现在截断只吃备注尾部，A → B 始终完整。
   */
  private subText(): string {
    const it = this.item;
    if (this.isTransfer()) {
      const flow = (it?.transfer?.from?.name ?? '?') + ' → ' + (it?.transfer?.to?.name ?? '?');
      const note = it?.note ?? '';
      return note === '' ? flow : flow + ' · ' + note;
    }
    if (it?.note) return it.note;
    return it?.account?.name ?? '';
  }

  build() {
    Row({ space: 12 }) {
      CategoryIcon({ icon: this.isTransfer() ? '🔄' : (this.item?.category?.icon ?? '📌'), iconSize: 40 })
      Column() {
        // 第一行 = 分类名。转账在库里有真实分类（如「一般转账 🏦」），
        // 早前把「A → B」摆在这里、第二行写死「转账」，等于把分类信息挤掉，
        // 同时第二行是个常量、与左侧 🔄 图标重复表意，白占一整行。
        Row() {
          Text(this.item?.category?.name ?? (this.isTransfer() ? '转账' : '未分类'))
            .fontSize(15).fontColor(COLORS.textPrimary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          // 利息标记：账户记息产生的交易带 link_type='account_interest'，
          // 与安卓/web 一致显示「利息」标签（普通收入不显示）。
          if (this.item?.link_type === 'account_interest') {
            Text('利息')
              .fontSize(10).fontColor('#FFFFFF').backgroundColor(COLORS.brand)
              .borderRadius(4).padding({ left: 5, right: 5, top: 1, bottom: 1 })
              .margin({ left: 6 })
          }
        }
        if (this.subText() !== '') {
          Text(this.subText())
            .fontSize(12).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)

      Column() {
        // 转账用中性色 + 无正负号：钱只是从一个口袋进了另一个口袋，
        // 总资产没变。原先因为 type !== 'income' 一律显示成红色的 -1000，
        // 看着像花掉了 1000 块。
        Text(this.amountText())
          .fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor(this.isTransfer()
            ? COLORS.textSecondary
            : (this.item?.type === 'income' ? COLORS.income : COLORS.expense))
        // 转账不再在右下角重复写「转账」：左侧 🔄 + 第二行 A → B 已表达清楚，
        // 第三处重复只是噪声。普通记录仍显示所属账户（列表里区分账户的唯一线索）。
        if (!this.isTransfer() && this.item?.account?.name) {
          Text(this.item.account.name).fontSize(11).fontColor(COLORS.textSecondary)
        }
      }.alignItems(HorizontalAlign.End)
    }
    .width('100%')
    .padding({ top: 12, bottom: 12 })
    .backgroundColor(this.compact ? '#00000000' : COLORS.card)
    // 两个分支保持同一对象形状，避免 ArkTS 对象字面量类型推断报错
    .border({
      width: this.compact
        ? { top: this.showTopDivider ? 0.5 : 0, bottom: 0, left: 0, right: 0 }
        : { top: 1, bottom: 1, left: 1, right: 1 },
      color: this.compact ? COLORS.outlineVariant : COLORS.divider
    })
    .onClick(() => this.onItemClick && this.onItemClick())
  }
}

/** 标准行项（设置/列表通用，左图标 + 标题 + 右值/箭头） */
@Component
export struct RowItem {
  icon: string = '';
  iconBg: string = COLORS.brandBgLight;
  title: string = '';
  value: string = '';
  showArrow: boolean = true;
  onItemClick?: () => void;
  build() {
    Row({ space: 12 }) {
      if (this.icon) {
        CategoryIcon({ icon: this.icon, bg: this.iconBg, iconSize: 32 })
      }
      Text(this.title).fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
      if (this.value) {
        Text(this.value).fontSize(13).fontColor(COLORS.textSecondary)
      }
      if (this.showArrow) {
        Text('›').fontSize(20).fontColor(COLORS.placeholder)
      }
    }
    .width('100%')
    .padding({ top: 14, bottom: 14, left: 16, right: 16 })
    // 半透明：让 AppBackground 的环境光透过行项（详见规范第 15 节）
    .backgroundColor(COLORS.cardGlass)
    // 只画下分隔线。`border({ width: 1 })` 会四边全画，在连续列表里
    // 相邻两项之间叠成 2px 粗线、左右各多一条竖线（真机可见）
    .border({ width: { bottom: 0.5 }, color: COLORS.outlineVariant })
    .onClick(() => this.onItemClick && this.onItemClick())
  }
}

/**
 * 暖棕渐变头卡（对齐安卓 HeroGradientCard）。
 * 顶部一行主指标 + 大数字金额，下方左右对照副指标。用于首页月支出等醒目卡片。
 */
/** HeroGradientCard 底部列数据（标签 + 数值） */
export interface HeroCellData {
  label: string;
  value: string;
}

@Component
export struct HeroGradientCard {
  @Prop topLeft: string = '';
  @Prop amount: string = '';
  @Prop topRight: string = '';
  @Prop bottomLeft: string = '';
  @Prop bottomRight: string = '';
  /**
   * 底部多列模式（账单页用）：传入「标签/数值」成对的列。
   * 传了这个就忽略 bottomLeft/bottomRight —— 两者是同一块区域的两种排法，
   * 不该同时出现。首页用两项纯文字版，账单页用三项标签+数值版。
   */
  @Prop bottomCells: HeroCellData[] = [];
  /** 右上角是否用胶囊底（安卓端月份区间是带浅底胶囊，比裸文字更像一个标记） */
  @Prop topRightPill: boolean = false;
  onTap?: () => void;
  build() {
    Column({ space: 10 }) {
      Row() {
        Text(this.topLeft).fontSize(14).fontColor('#FFFFFF').opacity(0.92).layoutWeight(1)
        if (this.topRight) {
          if (this.topRightPill) {
            Text(this.topRight).fontSize(12).fontColor('#FFFFFF')
              .padding({ left: 10, right: 10, top: 4, bottom: 4 })
              .backgroundColor('#33FFFFFF')
              .borderRadius(RADIUS.pill)
          } else {
            Text(this.topRight).fontSize(13).fontColor('#FFFFFF').opacity(0.85)
          }
        }
      }.width('100%')
      Text(this.amount).fontSize(34).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      if (this.bottomCells.length > 0) {
        Row() {
          ForEach(this.bottomCells, (c: HeroCellData, idx: number) => {
            Column({ space: 3 }) {
              Text(c.label)
                .fontSize(this.bottomCells.length >= 4 ? 10 : 11)
                .fontColor('#FFFFFF').opacity(0.85)
                .maxLines(1)
              Text(c.value)
                // 4 列时列宽只剩约 72vp，14sp 下「¥20,904.00」会被截断成「¥20,90…」。
                // 数字被截断比字小一号严重得多 —— 小一号还能读，截断直接读不出这是多少钱。
                .fontSize(this.bottomCells.length >= 4 ? 12 : 14)
                .fontWeight(FontWeight.Medium).fontColor('#FFFFFF')
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .layoutWeight(1)
            // 末列右对齐、其余左对齐 —— 全部左对齐时最后一列右侧会空出一段，
            // 卡片左边缘齐平、右边缘不齐，看着像排版塌了半边。
            .alignItems(idx === this.bottomCells.length - 1
              ? HorizontalAlign.End : HorizontalAlign.Start)
          }, (c: HeroCellData) => c.label)
        }.width('100%')
      } else if (this.bottomLeft || this.bottomRight) {
        Row() {
          if (this.bottomLeft) {
            Column({ space: 2 }) {
              Text(this.bottomLeft).fontSize(11).fontColor('#FFFFFF').opacity(0.8)
            }.layoutWeight(1)
          }
          if (this.bottomRight) {
            Column({ space: 2 }) {
              Text(this.bottomRight).fontSize(11).fontColor('#FFFFFF').opacity(0.8)
            }.layoutWeight(1).alignItems(HorizontalAlign.End)
          }
        }.width('100%')
      }
    }
    .width('100%')
    .padding(20)
    .backgroundColor(COLORS.brand)
    .borderRadius(20)
    .linearGradient({
      angle: 135,
      colors: [[COLORS.brand, 0.0], [COLORS.brandLight, 1.0]]
    })
    .onClick(() => this.onTap && this.onTap())
  }
}

/** 账户类型中文标签（对齐安卓 accountTypeLabel） */
export function accountTypeLabel(type: string): string {
  switch (type) {
    case 'cash': return '现金';
    case 'bank_card': return '储蓄卡';
    case 'credit_card': return '信用卡';
    case 'electronic_payment': return '电子支付';
    case 'financial_account': return '理财账户';
    case 'digital': return '数字资产';
    default: return '其他';
  }
}

/** 下拉选项 */
export interface DropdownOption {
  name: string;
  id: number;
}

/**
 * 2x2 KPI 小卡（对齐安卓 StatKpiCard）：左侧圆形小图标 + 标题，下方大数字(品牌色)。
 * 通常四个一组排成 2x2 网格，用于统计页「金额/日均/笔数/预算」等展示。
 */
@Component
export struct StatKpiCard {
  title: string = '';
  @Prop amount: number = 0;
  icon: string = '💰';
  /** 多币种 P2-3b：amount 货币代码（默认 CNY 向后兼容） */
  currency: string = 'CNY';
  onTap?: () => void;
  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        CategoryIcon({ icon: this.icon, bg: COLORS.brandBgLight, iconSize: 28 })
        Text(this.title).fontSize(13).fontColor(COLORS.textSecondary)
      }
      Text(fmtMoney(this.amount, this.currency)).fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
    }
    .width('100%')
    .padding(14)
    .backgroundColor(COLORS.cardGlass)
    .border({ width: 0.5, color: COLORS.outlineVariant })
    .borderRadius(16)
    .shadow({ radius: 8, color: SHADOW.card, offsetX: 0, offsetY: 2 })
    .onClick(() => this.onTap && this.onTap())
  }
}

/** 账户行（对齐安卓 AccountListItem）：图标圆 + 名称/类型 + 余额(信用卡显示额度) */
@Component
export struct AccountListItem {
  account?: Account;
  onTap?: () => void;
  /**
   * 「⋯」更多操作。传了才渲染按钮。
   *
   * ⚠️ 必须是**可见按钮**，不能只挂长按。安卓端的账户编辑/删除功能其实一直都有
   * （AccountsScreen.kt 的 combinedClickable onLongClick），但唯一入口是长按且
   * 界面上没有任何提示 —— 用户直接反馈「没有编辑删除功能」。
   * 找不到的功能等于不存在。长按作为快捷方式保留，可见入口是主路径。
   */
  onMore?: () => void;
  build() {
    Row({ space: 12 }) {
      CategoryIcon({ icon: this.account?.icon || '💵', iconSize: 44 })
      Column() {
        Text(this.account?.name ?? '').fontSize(15).fontColor(COLORS.textPrimary)
        Text(accountTypeLabel(this.account?.type ?? '')).fontSize(12).fontColor(COLORS.textSecondary)
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Column() {
        // 多币种 P2-3b：账户余额跟随账户币种
        Text(fmtMoney(this.account?.balance ?? 0, this.account?.currency)).fontSize(15).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
        if (this.account?.type === 'credit_card' && (this.account?.credit_limit ?? 0) > 0) {
          // 多币种 P2-3b：信用额度跟随账户币种
          Text(`额度 ${fmtMoney(this.account?.credit_limit ?? 0, this.account?.currency)}`).fontSize(11).fontColor(COLORS.textSecondary)
        }
      }.alignItems(HorizontalAlign.End)
      if (this.onMore) {
        Text('⋯')
          .fontSize(20).fontColor(COLORS.textSecondary)
          .width(32).height(32).textAlign(TextAlign.Center)
          .borderRadius(16).backgroundColor(COLORS.surfaceVariant)
          // 阻止冒泡到整行的 onClick，否则点「⋯」会同时跳转详情页
          .onClick(() => { if (this.onMore) this.onMore(); })
      }
    }
    .width('100%')
    // 原先只有上下 padding，账户名/余额直接贴到卡片边缘
    .padding({ top: 12, bottom: 12, left: 14, right: 14 })
    .backgroundColor(COLORS.cardGlass)
    .border({ width: 0.5, color: COLORS.outlineVariant })
    .borderRadius(12)
    .onClick(() => this.onTap && this.onTap())
  }
}

/**
 * 下拉刷新容器（对齐安卓 PullRefreshBox）：用原生 Refresh 包裹可滚动内容，
 * 顶部居中显示刷新指示器。refreshing 由父组件通过 @Link 控制（加载完置 false）。
 */
@Component
export struct PullRefreshBox {
  @Link refreshing: boolean;
  onRefresh?: () => void;
  @BuilderParam content: () => void;
  build() {
    Refresh({ refreshing: this.refreshing, offset: 120, friction: 100 }) {
      this.content()
    }.onRefreshing(() => {
      this.refreshing = true;
      if (this.onRefresh) this.onRefresh();
    })
  }
}

/** 只读下拉选择框（对齐安卓 DropdownField）：选项 {name, id}，选中回调传 id */
@Component
export struct DropdownField {
  label: string = '';
  value: string = '';
  options: DropdownOption[] = [];
  emptyHint: string = '暂无选项';
  onSelected?: (id: number) => void;
  @State open: boolean = false;
  build() {
    Column({ space: 6 }) {
      Text(this.label).fontSize(13).fontColor(COLORS.textSecondary)
      Text(this.value || this.emptyHint)
        .fontSize(15).fontColor(this.value ? COLORS.textPrimary : COLORS.placeholder)
        .width('100%').padding(12).backgroundColor(COLORS.card)
        .borderRadius(10).border({ width: 1, color: COLORS.divider })
        .onClick(() => this.open = !this.open)
        .bindPopup(this.open, {
          builder: this.MenuBuilder,
          onStateChange: (e: ESObject) => { if (!e.isVisible) this.open = false; }
        })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder MenuBuilder() {
    Column() {
      if (this.options.length === 0) {
        Text(this.emptyHint).fontSize(14).fontColor(COLORS.placeholder).padding(16)
      } else {
        ForEach(this.options, (o: DropdownOption) => {
          Text(o.name).fontSize(15).fontColor(COLORS.textPrimary).width('100%')
            .padding({ top: 14, bottom: 14, left: 16, right: 16 })
            .onClick(() => { this.open = false; if (this.onSelected) this.onSelected(o.id); })
        }, (o: DropdownOption) => o.id.toString())
      }
    }.width('100%').backgroundColor(COLORS.card).borderRadius(10)
  }
}

/** yyyy-MM-dd -> Date（解析失败返回今天） */
function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}
/** 数字 -> yyyy-MM-dd */
function fmtYmd(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 只读日期输入框（对齐安卓 DatePickerField）：点击弹出系统日期选择器，值 yyyy-MM-dd */
@Component
export struct DatePickerField {
  label: string = '';
  date: string = '';
  onDateChange?: (date: string) => void;
  build() {
    Column({ space: 6 }) {
      Text(this.label).fontSize(13).fontColor(COLORS.textSecondary)
      Text(this.date || '选择日期')
        .fontSize(15).fontColor(this.date ? COLORS.textPrimary : COLORS.placeholder)
        .width('100%').padding(12).backgroundColor(COLORS.card)
        .borderRadius(10).border({ width: 1, color: COLORS.divider })
        .onClick(() => this.pick())
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  pick(): void {
    const d = parseYmd(this.date);
    DatePickerDialog.show({
      start: new Date('2000-01-01'),
      end: new Date(),
      selected: d,
      onAccept: (v: ESObject) => {
        const s = fmtYmd(v.year as number, v.month as number, v.day as number);
        if (this.onDateChange) this.onDateChange(s);
      }
    });
  }
}

/** yyyy-MM-dd HH:mm:ss 解析为 [年,月1-12,日,时,分,秒] */
function parseDateTimeParts(value: string): number[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(value || '');
  if (m) {
    return [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
      m[6] ? Number(m[6]) : 0
    ];
  }
  const n = new Date();
  return [n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()];
}
/** 拼 yyyy-MM-dd HH:mm:ss */
function fmtDateTime(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}

/**
 * 只读「日期 + 时间(到秒)」输入框（对齐安卓 DateTimePickerField）：值格式 yyyy-MM-dd HH:mm:ss。
 * 交互：点输入框先弹日期选择器，确定后再弹时间选择器（含秒），满足按秒记账。
 */
@Component
export struct DateTimePickerField {
  label: string = '';
  value: string = '';
  onValueChange?: (value: string) => void;
  @State private y: number = 0;
  @State private mo: number = 0;
  @State private d: number = 0;
  @State private h: number = 0;
  @State private mi: number = 0;
  private dialogController: CustomDialogController = new CustomDialogController({
    builder: SecPickerDialog({
      onConfirm: (sec: number): void => {
        const final = fmtDateTime(this.y, this.mo, this.d, this.h, this.mi, sec);
        if (this.onValueChange) this.onValueChange(final);
      }
    }),
    alignment: DialogAlignment.Center
  });
  build() {
    Column({ space: 6 }) {
      Text(this.label).fontSize(13).fontColor(COLORS.textSecondary)
      Text(this.value || '选择日期时间')
        .fontSize(15).fontColor(this.value ? COLORS.textPrimary : COLORS.placeholder)
        .width('100%').padding(12).backgroundColor(COLORS.card)
        .borderRadius(10).border({ width: 1, color: COLORS.divider })
        .onClick(() => this.pickDate())
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  pickDate(): void {
    const p = parseDateTimeParts(this.value);
    DatePickerDialog.show({
      start: new Date('2000-01-01'),
      end: new Date('2035-12-31'),
      selected: new Date(p[0], p[1] - 1, p[2]),
      onAccept: (v: ESObject) => {
        this.y = v.year as number;
        this.mo = v.month as number;
        this.d = v.day as number;
        TimePickerDialog.show({
          selected: new Date(2020, 0, 1, p[3], p[4], p[5]),
          useMilitaryTime: true,
          onAccept: (tv: ESObject) => {
            this.h = tv.hour as number;
            this.mi = tv.minute as number;
            this.dialogController.open();
          }
        });
      }
    });
  }
}

/** 秒选择弹层（对齐安卓 DateTimePickerField 的「秒」输入框）：0-59 */
@CustomDialog
struct SecPickerDialog {
  controller?: CustomDialogController;
  @State secText: string = '0';
  onConfirm?: (sec: number) => void;
  build() {
    Column({ space: 12 }) {
      Text('选择秒 (0-59)').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
      TextInput({ text: this.secText, placeholder: '0-59' })
        .type(InputType.Number).maxLength(2).width('60%')
        .onChange((t: string) => { this.secText = t; })
      Row({ space: 12 }) {
        Button('取消').onClick(() => this.controller?.close())
        Button('确定').onClick(() => {
          const sec = Math.min(59, Math.max(0, Number(this.secText) || 0));
          if (this.onConfirm) this.onConfirm(sec);
          this.controller?.close();
        })
      }
    }.backgroundColor(COLORS.card).borderRadius(16).padding(20)
  }
}

/** 顶部账本标题（对齐安卓 BookHeader）：居中账本名 + 切换箭头 + 右侧搜索 */
@Component
export struct BookHeader {
  bookName: string = '默认账本';
  onSwapBook?: () => void;
  onSearch?: () => void;
  build() {
    Row() {
      Row({ space: 6 }) {
        Text(this.bookName).fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text('⇄').fontSize(16).fontColor(COLORS.brand)
      }.onClick(() => this.onSwapBook && this.onSwapBook())
      Blank()
      if (this.onSearch) {
        Text('🔍').fontSize(22).onClick(() => this.onSearch!())
      }
    }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 8 })
    // 账本头是页面首屏的一部分，应完全透出环境光；
    // 原先铺不透明 card 底 + 一条无意义的上边框（它上面没有任何东西）
    .backgroundColor(TRANSPARENT)
  }
}

/**
 * 账本切换底部弹窗（对齐安卓 BookSwitcherSheet）：列出全部账本(当前项打勾) + 新建账本。
 * 由调用方用 show 状态控制显隐，点击遮罩/取消关闭；选择/新建通过回调上抛。
 */
@Component
export struct BookSwitcherSheet {
  show: boolean = false;
  books: Book[] = [];
  currentId: number = 0;
  onDismiss?: () => void;
  onSelect?: (id: number) => void;
  onCreate?: (name: string) => void;
  @State newName: string = '';
  build() {
    if (this.show) {
      Stack() {
        Column().layoutWeight(1).backgroundColor('#66000000').onClick(() => this.onDismiss && this.onDismiss())
        Column() {
          Column({ space: 8 }) {
            Text('切换账本').fontSize(16).fontWeight(FontWeight.Bold)
            List() {
              ForEach(this.books, (b: Book) => {
                ListItem() {
                  Row({ space: 10 }) {
                    Text(b.icon || '📒').fontSize(20)
                    Text(b.name).fontSize(15).layoutWeight(1).fontColor(COLORS.textPrimary)
                    if (b.id === this.currentId) { Text('✓').fontColor(COLORS.brand) }
                  }.padding({ top: 12, bottom: 12 })
                }.onClick(() => { if (this.onSelect) this.onSelect(b.id); })
              }, (b: Book) => b.id.toString())
            }.layoutWeight(1).height('45%')
            Text('新建账本').fontSize(13).fontColor(COLORS.textSecondary)
            TextInput({ placeholder: '如：旅行账本', text: this.newName }).onChange((v: string) => this.newName = v)
            Row({ space: 12 }) {
              Button('取消').layoutWeight(1).backgroundColor(COLORS.divider).onClick(() => this.onDismiss && this.onDismiss())
              Button('创建').layoutWeight(1).backgroundColor(COLORS.brand)
                .enabled(this.newName.trim().length > 0)
                .onClick(() => {
                  if (this.onCreate) this.onCreate(this.newName.trim());
                  this.newName = '';
                })
            }
          }.width('100%').padding(20)
        }.width('100%').backgroundColor(COLORS.card)
                    .border({ width: 1, color: COLORS.divider })
          .borderRadius({ topLeft: 16, topRight: 16 })
          .constraintSize({ maxHeight: '70%' })
      }.width('100%').height('100%').position({ x: 0, y: 0 }).zIndex(20)
    } else {
      Column() {}
    }
  }
}

/**
 * 统一图标圆底容器（阶段2 视觉统一规范）：给 emoji/字符图标套统一圆底(默认浅棕 brandBgLight)与尺寸，
 * 替代各页裸 emoji，作为全局图标语言。bg 可传品牌色/浅棕/分组底，iconSize 控制字号。
 */
@Component
export struct IconCircle {
  icon: string = '';
  boxSize: number = 44;
  bg: string = COLORS.brandBgLight;
  iconSize: number = 22;
  onTap?: () => void;
  build() {
    Column() {
      Text(this.icon)
        .fontSize(this.iconSize)
        .textAlign(TextAlign.Center)
    }
    .width(this.boxSize)
    .height(this.boxSize)
    .backgroundColor(this.bg)
    .borderRadius(this.boxSize / 2)
    .justifyContent(FlexAlign.Center)
    .onClick(() => { if (this.onTap) this.onTap(); })
  }
}

/**
 * 悬浮操作按钮（对齐安卓 ExtendedFloatingActionButton）。
 * 默认圆形 + 号（icon 模式）；传 text 则显示「图标+文字」扩展样式（药丸形）。
 * 固定悬浮在右下角 (88%,88%)，带品牌色阴影。用于列表页新增入口。
 */
@Component
export struct FloatingButton {
  icon: string = '+';
  text?: string;
  onTap?: () => void;
  posX: string | number = '88%';
  posY: string | number = '88%';
  build() {
    if (this.text) {
      Row({ space: 6 }) {
        Text(this.icon).fontSize(20).fontColor(COLORS.brand).fontWeight(FontWeight.Bold)
        Text(this.text).fontSize(14).fontColor(COLORS.brand).fontWeight(FontWeight.Medium)
      }.height(44).padding({ left: 16, right: 16 })
        .backgroundColor(COLORS.card).borderRadius(22)
                .border({ width: 1.5, color: COLORS.brand })
        .shadow({ radius: 8, color: '#55995F2C' })
        .position({ x: this.posX, y: this.posY })
        .onClick(() => { if (this.onTap) this.onTap(); })
    } else {
      Column() {
        Text(this.icon).fontSize(28).fontColor(COLORS.brand).fontWeight(FontWeight.Bold)
      }.width(52).height(52).backgroundColor(COLORS.card).borderRadius(26)
                .border({ width: 1.5, color: COLORS.brand })
        .shadow({ radius: 6, color: '#55995F2C' })
        .position({ x: this.posX, y: this.posY })
        .onClick(() => { if (this.onTap) this.onTap(); })
    }
  }
}

/* ============================================================
 * 阶段 2 新增组件（鸿蒙深度精修）：统一卡片/chip/弹层/标题
 * ------------------------------------------------------------ */

/**
 * 统一卡片容器（对齐安卓 Surface + Card 容器）
 *   - 圆角 RADIUS.lg(16)；背景 COLORS.surface；padding SPACING.lg(16)
 *   - 可选 shadow 轻浮 + 可选 onTap 整卡点击
 *   - 取代各页散落的 `backgroundColor(COLORS.card).borderRadius(14).padding(14)`
 */
@Component
export struct Card {
  @BuilderParam content: () => void;
  // 注意：字段名不能用 shadow/padding/radius — 与 Column 同名方法冲突，
  // ArkTS 严格类型要求字段名与方法名不重名。用下划线后缀避免冲突。
  withShadow: boolean = true;
  onTap?: () => void;
  contentPadding: number = SPACING.lg;
  cardRadius: number = RADIUS.lg;
  build() {
    Column() {
      this.content()
    }
    .width('100%')
    .padding(this.contentPadding)
    // 半透明而非不透明 surface：背景有环境光柔光后，不透明卡片会把柔光切成一个个
    // 白方块（这正是原先「没有毛玻璃质感」的根因）。用 cardGlass（亮色 62% 白 /
    // 暗色 55% 深棕）让柔光透过卡片，卡片才像浮在光晕上而不是贴在上面。
    .backgroundColor(COLORS.cardGlass)
    .borderRadius(this.cardRadius)
    // ArkTS 的 shadow() 只接受单个 ShadowOptions，不支持数组多层阴影。
    // 用「大半径 + 低不透明度 + 正 offsetY」的单层柔和阴影模拟浮起层次。
    .shadow(this.withShadow
      ? { radius: 12, color: COLORS.shadowCard, offsetX: 0, offsetY: 4 }
      : { radius: 0, color: TRANSPARENT, offsetX: 0, offsetY: 0 })
    // 四周极浅描边，配合阴影形成边界层次（顶部单边描边在圆角卡上会断裂）
    .border({ width: 0.5, color: COLORS.outlineVariant })
    .onClick(() => { if (this.onTap) this.onTap(); })
  }
}

/**
 * 统一 chip 组件（对齐安卓 FilterChip / AssistChip）
 *   - 3 态：默认 (brandBgLight 浅棕底 + 棕字) / 激活 (brand 实心棕底 + 白字)
 *   - 圆角 pill；padding sm-xs；字号 13sp；可带前置 icon
 *   - 取代 Accounts/Transactions/Reports 里散落的内联 chip 写法
 */
@Component
export struct Chip {
  label: string = '';
  icon?: string;
  /**
   * 选中态。**必须是 @Prop**：ArkTS 里子组件的无装饰器成员变量只在**首次构造**时赋值，
   * 父组件 @State 变化后不会同步。而 Chip 几乎总是写在 `ForEach` 里，ForEach 的 key
   * 通常是稳定 id（如 `b.id.toString()`），ArkUI 会**复用**已有实例而非重建 —— 于是
   * active 永远停在初始值，点击后状态变了但 UI 不刷新，表现为「选项点不动」。
   * @Prop 建立父→子单向同步，父状态一变子组件立即重渲染。
   */
  @Prop active: boolean = false;
  onTap?: () => void;
  /** true = 激活态用品牌渐变填充（更精致），false = 实心棕填充（更扁平） */
  @Prop useGradient: boolean = true;
  build() {
    Row({ space: SPACING.xs }) {
      if (this.icon) {
        Text(this.icon).fontSize(13)
          .fontColor(this.active ? COLORS.onPrimary : COLORS.brand)
      }
      Text(this.label).fontSize(FONT_SIZE.label)
        .fontColor(this.active ? COLORS.onPrimary : COLORS.textPrimary)
        .fontWeight(this.active ? FontWeight.Medium : FontWeight.Normal)
    }
    .padding({ left: SPACING.md, right: SPACING.md, top: SPACING.xs + 2, bottom: SPACING.xs + 2 })
    .backgroundColor(
      this.active
        ? (this.useGradient
            ? COLORS.brandGradMid   // 渐变将由外层 Column 提供，背景色仅作兜底
            : COLORS.brand)
        : COLORS.brandBgLight
    )
    .borderRadius(RADIUS.pill)
    .onClick(() => { if (this.onTap) this.onTap(); })
  }
}

/**
 * 操作方块（ActionChip）：emoji 在上、文字在下的方块按钮，用于详情页顶部的操作区。
 *
 * 与横向 pill 形态的 Chip 区分：Chip 是**筛选/选择**语义（类型、周期、标签），
 * ActionChip 是**动作**语义（编辑、删除、计息）。两者混用会让人以为点了会切换筛选。
 *
 * ⚠️ 详情页的操作入口必须是可见方块，不要藏进长按或「⋯」。
 * 账户列表页踩过这个坑：功能全都实现了，用户依然反馈「没有编辑删除功能」——
 * 隐藏手势 + 灰字提示不构成入口（见 docs/harmony-style-guide.md）。
 *
 * 与安卓 ui/components/Components.kt 的 ActionChip 保持同款（圆角 12、emoji 20、
 * 上下 padding 12），两端不要各长一个样。
 */
@Component
export struct ActionChip {
  emoji: string = '';
  label: string = '';
  /** true = 破坏性操作，用 danger 色渲染文字，让它在一排方块里可区分 */
  danger: boolean = false;
  onTap?: () => void;
  build() {
    Column({ space: 4 }) {
      Text(this.emoji).fontSize(20)
      Text(this.label)
        .fontSize(FONT_SIZE.label)
        .fontColor(this.danger ? COLORS.danger : COLORS.textPrimary)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .layoutWeight(1)
    .padding({ top: 12, bottom: 12 })
    .backgroundColor(COLORS.surfaceVariant)
    .borderRadius(RADIUS.md)
    .onClick(() => { if (this.onTap) this.onTap(); })
  }
}

/**
 * 弹层标题（SheetHeader）：底部弹窗顶部条 —— 标题 + 关闭按钮 + 可选副文案。
 * 用于 BottomSheet 内部顶部，让弹层与页面标题解耦。
 */
@Component
export struct SheetHeader {
  title: string = '';
  subtitle?: string = '';
  onClose?: () => void;
  build() {
    Column({ space: SPACING.xs }) {
      Row() {
        Text(this.title).fontSize(FONT_SIZE.title).fontWeight(FontWeight.Bold)
          .fontColor(COLORS.textPrimary).layoutWeight(1)
        if (this.onClose) {
          Text('✕').fontSize(18).fontColor(COLORS.textSecondary)
            .padding(SPACING.xs)
            .onClick(() => this.onClose && this.onClose())
        }
      }.width('100%').alignItems(VerticalAlign.Center)
      if (this.subtitle) {
        Text(this.subtitle).fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
      }
    }.width('100').alignItems(HorizontalAlign.Start)
  }
}

/**
 * 统一底部弹层容器（对齐安卓 ModalBottomSheet）
 *   - show 控制显隐；onDismiss 点击遮罩关闭；content 由调用方 @Builder 提供
 *   - 顶部圆角 24；80% 高度上限；半透明 #00000066 遮罩
 *   - 取代各页重复实现的"Stack 遮罩 + Column 底部栏"写法
 */
@Component
export struct BottomSheet {
  show: boolean = false;
  maxHeight: string = '80%';
  onDismiss?: () => void;
  @BuilderParam content: () => void;
  build() {
    if (this.show) {
      Stack() {
        Column().layoutWeight(1).backgroundColor('#66000000')
          .onClick(() => this.onDismiss && this.onDismiss())
        Column() {
          this.content()
        }
        .width('100%')
        .backgroundColor(COLORS.surface)
        .borderRadius({ topLeft: RADIUS.xl, topRight: RADIUS.xl })
        .padding(SPACING.lg)
        .constraintSize({ maxHeight: this.maxHeight })
        .shadow({ radius: 8, color: SHADOW.sheet, offsetY: -2 })
      }
      .width('100%').height('100%')
      .position({ x: 0, y: 0 })
      .zIndex(20)
    } else {
      Column() {}
    }
  }
}

/**
 * 升级版空状态（取代原 EmptyState）
 *   - 大图标 + 标题 + 副文案 + 可选行动按钮
 *   - 副文案可选；行动按钮为品牌色实心按钮
 */
@Component
export struct EmptyStateV2 {
  icon: string = '📭';
  title: string = '暂无数据';
  subtitle?: string = '';
  actionText?: string;
  onAction?: () => void;
  build() {
    Column({ space: SPACING.md }) {
      // 大图标圆 — 用品牌渐变底，圆角更大更具品质感
      Stack() {
        Text(this.icon).fontSize(54).fontColor(COLORS.brand)
      }
      .width(112).height(112)
      .borderRadius(56)
      .linearGradient({
        angle: 135,
        colors: [
          [COLORS.brandBgLight, 0.0],
          [COLORS.brandBg, 1.0]
        ]
      })
      .shadow({ radius: 8, color: COLORS.shadowCard, offsetY: 4 })
      Text(this.title).fontSize(FONT_SIZE.title).fontColor(COLORS.textPrimary)
        .fontWeight(FontWeight.Bold)
      if (this.subtitle) {
        Text(this.subtitle).fontSize(FONT_SIZE.body).fontColor(COLORS.textSecondary)
          .textAlign(TextAlign.Center).padding({ left: 24, right: 24 })
      }
      if (this.subtitle) {
        Text(this.subtitle).fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
          .textAlign(TextAlign.Center)
      }
      if (this.actionText && this.onAction) {
        Text(this.actionText).fontSize(FONT_SIZE.label).fontColor(COLORS.onPrimary)
          .fontWeight(FontWeight.Medium)
          .padding({ left: SPACING.xl, right: SPACING.xl, top: SPACING.sm, bottom: SPACING.sm })
          .backgroundColor(COLORS.brand)
          .borderRadius(RADIUS.pill)
          .onClick(() => this.onAction!())
      }
    }
    .width('100%').alignItems(HorizontalAlign.Center)
    .padding({ top: SPACING.xxl * 2, bottom: SPACING.xxl * 2 })
  }
}

/**
 * 升级版区块标题（SectionTitleV2）：图标圆 + 标题，比旧"竖条+文字"更有成品感
 *   - 默认 24dp 圆底图标盒（用 IconCircle 复用）+ 16sp 中等字重标题
 */
@Component
export struct SectionTitleV2 {
  icon: string = '📌';
  text: string = '';
  actionText?: string;
  onAction?: () => void;
  build() {
    Row() {
      Column() {
        Text(this.icon).fontSize(13)
      }
      .width(24).height(24)
      .backgroundColor(COLORS.brandBgLight)
      .borderRadius(RADIUS.md)
      .justifyContent(FlexAlign.Center)
      Text(this.text).fontSize(FONT_SIZE.body).fontWeight(FontWeight.Medium)
        .fontColor(COLORS.textPrimary).layoutWeight(1).margin({ left: SPACING.sm })
      if (this.actionText && this.onAction) {
        Text(this.actionText).fontSize(FONT_SIZE.label).fontColor(COLORS.brand)
          .onClick(() => this.onAction!())
      }
    }
    .width('100%').alignItems(VerticalAlign.Center)
    .padding({ top: SPACING.xs, bottom: SPACING.xs })
  }
}

/**
 * 环境光背景组件 — 把页面背景从「纯色」升级为「环境光团 + 暖白底」
 *
 * 使用方式（必须在 build() 顶部 Stack 第一层）：
 *   Stack({ alignContent: Alignment.TopStart }) {
 *     AppBackground()
 *     Column() { ...真实内容... }
 *   }
 *
 * 4 个柔光团（暖橘 / 暮霞粉 / 藕荷粉 / 薄荷青）以不同位置 + 半径铺在页面底层，
 * 与 pageBg（#FDFBFA）混合，呈现「自然光质感」，避免单调冷灰底。
 */
@Component
export struct AppBackground {
  /**
   * 单个柔光团。
   *
   * 关键点（踩坑记录）：
   *   1) 必须用 radialGradient 而非 linearGradient —— 线性渐变是沿某个角度扫过去，
   *      做不出圆形柔光，之前用 linearGradient({angle}) 出来的是一条斜向色带。
   *   2) 收尾色必须用 withAlpha(color, 0) 生成 ArkUI 顺序的 #00RRGGBB。
   *      写成 CSS 顺序的 color + '00' 会被解析成「不透明 + RGB 整体左移一位」，
   *      结果是一块饱和色块（这就是真机背景与预览差距巨大的直接原因）。
   *   3) 中心色也压到 opacity 以下，配合 blur 才是「环境光」而非「色斑」。
   *   4) 必须加 borderRadius('50%') —— Column 是矩形，radialGradient 是圆形。
   *      矩形四角在渐变半径之外，会被填成最后一个色标的纯色，真机上能看到
   *      可见的矩形硬边（AI 记账页那种「色块拼接感」）。borderRadius 把
   *      形状裁成椭圆，边界与渐变边界吻合。
   *   5) radius 用 70% 而非 100%：让渐变在形状边界「之前」就完全透明，
   *      留出一圈纯透明余量给 blur 去糊，边缘才真正化开。
   */
  @Builder
  Glow(w: string, h: string, x: string, y: string, color: string, opacity: number) {
    Column()
      .width(w).height(h)
      .position({ x: x, y: y })
      .borderRadius('50%')
      .radialGradient({
        center: ['50%', '50%'],
        radius: '70%',
        colors: [
          [withAlpha(color, opacity), 0.0],
          [withAlpha(color, opacity * 0.55), 0.42],
          [withAlpha(color, opacity * 0.18), 0.72],
          [withAlpha(color, 0), 1.0]
        ]
      })
      .blur(70)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      // 基础暖白底
      Column()
        .width('100%').height('100%')
        .backgroundColor(COLORS.background)

      // 尺寸比旧值放大约 1.4× —— radius 从 100% 收到 70% 后有效光斑变小，
      // 需要放大形状来补偿，否则柔光覆盖不到屏幕中段，会显得四角各一坨。
      // 右上 — 暖橘柔光（最强，作为主光源）
      this.Glow('110%', '48%', '18%', '-16%', COLORS.ambient1, 0.85)
      // 左上 — 暮霞粉（次光源，与主光源交叠出层次）
      this.Glow('94%', '40%', '-34%', '-8%', COLORS.ambient2, 0.7)
      // 右下 — 藕荷粉（平衡下半屏，避免上重下轻）
      this.Glow('100%', '46%', '22%', '62%', COLORS.ambient4, 0.6)
      // 左下 — 米杏（最弱，只做收边）
      this.Glow('86%', '38%', '-30%', '70%', COLORS.ambient3, 0.5)
    }
    .width('100%').height('100%')
    // clip 必须开：blur(70) 会让柔光溢出屏幕边界，不裁剪时溢出部分
    // 在某些设备上会被绘制成边缘亮带。
    .clip(true)
  }
}

/**
 * 卡片标题行（首页各功能卡共用）
 *   - 左：IconCircle 图标圆（brandBgLight 浅底）
 *   - 中：卡片标题（title-4 号加粗）
 *   - 右：可选统计 pill（如「共 3 笔」）或「查看全部 ›」跳转
 * 抽出来避免 6 张卡各写一遍标题行，也保证图标尺寸/字号/间距完全一致。
 */
@Component
export struct CardHeader {
  icon: string = '';
  title: string = '';
  /** 右侧统计胶囊文案，空串则不显示 */
  pill: string = '';
  /** 传入则右侧出现「查看全部 ›」 */
  onMore?: () => void;

  build() {
    Row({ space: SPACING.sm }) {
      IconCircle({ icon: this.icon, boxSize: 32, iconSize: 16, bg: COLORS.brandBgLight })
      Text(this.title)
        .fontSize(FONT_SIZE.title - 4).fontWeight(FontWeight.Bold)
        .fontColor(COLORS.textPrimary).layoutWeight(1)
      if (this.pill.length > 0) {
        Text(this.pill)
          .fontSize(FONT_SIZE.label).fontColor(COLORS.brand)
          .backgroundColor(COLORS.brandBgLight)
          .padding({ left: SPACING.sm, right: SPACING.sm, top: 4, bottom: 4 })
          .borderRadius(RADIUS.pill)
      }
      if (this.onMore) {
        Text('查看全部 ›')
          .fontSize(FONT_SIZE.label).fontColor(COLORS.brand)
          .onClick(() => { if (this.onMore) this.onMore(); })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }
}

/**
 * 横向条形榜单行（首页分类支出榜专用）
 *   - 上：分类图标 + 名称 + 金额 + 占比
 *   - 下：占比条（按 ratio 铺色，榜首满格）
 * 与 LinearProgress 的区别：这里条宽表达「相对榜首的比例」而非绝对进度，
 * 且图标/金额/条形是一个整体单元，故单独成组件。
 */
@Component
export struct RankBarRow {
  icon: string = '';
  name: string = '';
  amountText: string = '';
  /** 0~1，相对榜首的宽度比例 */
  ratio: number = 0;
  /** 占比文案，如 "32%" */
  percentText: string = '';
  barColor: string = COLORS.brand;

  private clamped(): number {
    const v = Number(this.ratio);
    if (!v || isNaN(v)) {
      return 0.04;
    }
    // 下限 4%：金额极小的分类也要看得见一截色条，否则像渲染失败
    return Math.max(0.04, Math.min(1, v));
  }

  build() {
    Column({ space: 6 }) {
      Row({ space: SPACING.sm }) {
        Text(this.icon).fontSize(15)
        Text(this.name)
          .fontSize(FONT_SIZE.body).fontColor(COLORS.textPrimary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(this.amountText)
          .fontSize(FONT_SIZE.body).fontWeight(FontWeight.Medium)
          .fontColor(COLORS.textPrimary)
        Text(this.percentText)
          .fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
          .width(38).textAlign(TextAlign.End)
      }.width('100%').alignItems(VerticalAlign.Center)

      Column() {
        Row()
          .width(this.clamped() * 100 + '%').height('100%')
          .backgroundColor(this.barColor)
          .borderRadius(3)
      }
      .width('100%').height(6)
      .backgroundColor(COLORS.surfaceVariant)
      .borderRadius(3)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding({ top: SPACING.sm, bottom: SPACING.sm })
  }
}


/*
 * 【已移除 PageContainer —— ArkTS 硬约束，勿再尝试】
 *
 * 曾想用一个 `PageContainer` 组件包裹页面内容来统一环境光背景：
 *     build() { PageContainer() { Column() { ... } } }
 * 编译直接报错：
 *     10905210  In an '@Entry' decorated component, the 'build' method can have
 *               only one root node, which must be a container component.
 *
 * 原因：**@Entry 组件的 build 根节点必须是「原生容器组件」**（Column/Row/Stack/Flex/
 * Scroll/List/Grid...），自定义 @Component 不被接受 —— 即使它内部就是一个 Stack。
 *
 * 正确写法：在页面里直接用原生 Stack 叠 AppBackground（见任意二级页 build 方法）：
 *
 *     build() {
 *       Stack() {
 *         AppBackground()
 *         Column() {
 *           TopBar({ title: 'xxx' })
 *           // ...
 *         }.width('100%').height('100%')      // 内容层不要再铺 pageBg
 *       }.width('100%').height('100%')
 *     }
 *
 * 两条配套约束：
 *   1) 内容层**不能**写 `.backgroundColor(COLORS.pageBg)`，否则把环境光整个盖住
 *      （这正是原先「首页有柔光、二级页一片平白」的根因）。需要分组底色用
 *      `COLORS.surfaceVariant` 或 `Card` 组件。
 *   2) Main.ets 的四个 tab 内嵌页（Home/Transactions/Reports/Profile）**不要**再叠
 *      AppBackground —— 它们已在 Main 的 AppBackground 之上，重复叠会出现两层柔光。
 */


/**
 * 破坏性操作确认弹窗。
 *
 * 为什么必须有：删除类操作原先在 5 个页面（分类/标签/预算/欠款/储蓄目标）
 * 都是「点垃圾桶图标 → 立即删除」，零确认、无撤销。图标只有 16px，
 * 紧挨在编辑图标右侧 14px 处 —— 误触概率很高，而误触的代价是数据永久丢失。
 *
 * 用法（页面里声明 pending 状态，弹窗只负责询问）：
 *   @State pendingDelete: Category | null = null;
 *   ConfirmDialog({
 *     show: this.pendingDelete !== null,
 *     title: '确认删除',
 *     message: '删除后无法恢复（建议带上具体名称）',
 *     confirmText: '删除',
 *     onCancel: () => { this.pendingDelete = null; },
 *     onConfirm: () => { const t = this.pendingDelete; this.pendingDelete = null; if (t) this.remove(t); }
 *   })
 *
 * 设计要点：
 *   - 遮罩 55% 黑 —— 弹层的职责就是遮挡与聚焦，卡片那套半透明玻璃不适用
 *   - 弹窗本体也用不透明 surface，不要跟着改 cardGlass
 *   - 确认按钮用 dangerStrong（填充专用色）+ 放在右侧；取消权重更低
 *   - 点遮罩空白处 = 取消，符合系统弹窗惯例
 *   - message 里带上具体名称，避免「确定删除吗」这种无信息量的询问
 */
@Component
export struct ConfirmDialog {
  show: boolean = false;
  title: string = '确认操作';
  message: string = '';
  confirmText: string = '确定';
  cancelText: string = '取消';
  onConfirm?: () => void;
  onCancel?: () => void;

  build() {
    if (this.show) {
      Column() {
        Column({ space: 14 }) {
          Text(this.title)
            .fontSize(FONT_SIZE.title).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
          if (this.message) {
            Text(this.message)
              .fontSize(FONT_SIZE.body).fontColor(COLORS.textSecondary)
              .width('100%').textAlign(TextAlign.Start)
          }
          Row({ space: 10 }) {
            Button(this.cancelText)
              .fontSize(FONT_SIZE.body).fontColor(COLORS.textSecondary)
              .backgroundColor(COLORS.surfaceVariant)
              .height(38).layoutWeight(1)
              .onClick(() => { if (this.onCancel) this.onCancel(); })
            Button(this.confirmText)
              .fontSize(FONT_SIZE.body).fontColor(COLORS.onError)
              // 实心按钮填充必须用 dangerStrong 而非 danger：
              // danger 上压白字只有 3.84:1，不达 AA 正文标准
              .backgroundColor(COLORS.dangerStrong)
              .height(38).layoutWeight(1)
              .onClick(() => { if (this.onConfirm) this.onConfirm(); })
          }.width('100%').margin({ top: 4 })
        }
        .width('82%').padding(20)
        // 弹层用不透明底：需要遮挡下层内容并建立聚焦，不适用玻璃半透明
        .backgroundColor(COLORS.surface)
        .borderRadius(RADIUS.lg)
        .shadow({ radius: 24, color: SHADOW.sheet, offsetX: 0, offsetY: 8 })
      }
      .width('100%').height('100%')
      // 55% 而非 40%：40% 下弹窗与遮罩后背景只有 3.21:1，聚焦感不足；
      // 55% 时 5.25:1，弹窗清晰浮在页面之上
      .backgroundColor(withAlpha('#000000', 0.55))
      .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
      .position({ x: 0, y: 0 }).zIndex(100)
      // 点遮罩空白处取消，符合系统弹窗惯例
      .onClick(() => { if (this.onCancel) this.onCancel(); })
    }
  }
}
