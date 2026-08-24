/**
 * 周期选择底部弹层（对齐安卓 TransactionsScreen.kt 的 PeriodPickerDialog）。
 *
 * 为什么不用 DatePickerDialog：
 *   系统日期滚轮是「年 / 月 / 日」三列 + 蓝色系统主题，用在账单页选月份有三处不对 ——
 *   ① 多出「日」这一列，而这里的语义是选一个月，滚到几号毫无意义（选中 8月1日
 *      和 8月31日 结果完全一样，用户却要为此做一次无效决策）；
 *   ② 系统蓝在整套暖棕配色里是外来色，弹出来像是另一个 app 的界面；
 *   ③ 滚轮要先滚到位再点「确定」，两步操作；月份网格一眼看到 12 个月，点一下即完成。
 *
 * 结构：
 *   [按月查看 | 按年查看 | 自定义]   ← allowYear 时才有（日历视图无「按年」语义，隐藏）
 *   ‹ 2025      2026      2027 ›
 *   [1月][2月][3月][4月]
 *   [5月][6月][7月][8月]   ← 点击即确认，无「确定」按钮
 *   [9月][10月][11月][12月]
 *
 * 按年模式下第二行改为 12 年一页翻页，网格改为 12 个年份。
 *
 * 自定义模式（对齐安卓 ReportsScreen.kt:984-1088）额外有：
 *   [ 开始 | 结束 ]        ← 分段控件，决定下方月份网格改的是起点还是终点
 *   ‹ 2025   2026   2027 ›  ← 改的是「当前编辑字段」的年份
 *   12 个月网格             ← 点击设置当前编辑字段，不立即确认
 *   2026-01 ~ 2026-03      ← 已选范围回显
 *   [        确定        ]  ← 起止都选好才可点
 * 自定义模式必须有「确定」按钮：它要收集两个值，点一次月份无法表达完整意图。
 */
import { COLORS, RADIUS, SPACING, TRANSPARENT } from '../theme';

@Component
export struct PeriodPickerSheet {
  /** 用 @Prop + @Watch 而非普通属性：show 从 false→true 时必须把内部选中态
   *  重置回 initialPeriod。否则用户上次翻到 2030 年没选就关掉，再打开还停在 2030。 */
  @Prop @Watch('onShowChange') show: boolean = false;
  /** 'YYYY-MM'（按月）、'YYYY'（按年）或 'YYYY-MM~YYYY-MM'（自定义） */
  @Prop initialPeriod: string = '';
  @Prop initialMode: string = 'month';
  /** 日历视图传 false：月历网格没有「按年」这种展示形态 */
  @Prop allowYear: boolean = true;
  /** 是否提供「自定义」区间 tab。账单页/日历不需要跨月区间，只有统计页开 */
  @Prop allowCustom: boolean = false;
  /** 最早一笔交易的年份，决定按年视图首页起点与左翻边界；<=0 表示未知 */
  @Prop minYear: number = 0;
  onDismiss?: () => void;
  /** (period, mode) → period 为 'YYYY-MM' / 'YYYY' / 'YYYY-MM~YYYY-MM' */
  onConfirm?: (period: string, mode: string) => void;

  @State mode: string = 'month';
  @State selYear: number = 0;
  @State selMonth: number = 0;
  /** 打开弹层时生效的年份。选中高亮只在这一年上显示 ——
   *  翻到别的年份时 12 个格子应该全是未选中态，否则「2027年8月」会顶着高亮，
   *  看起来像已经选好了，但其实还没点。 */
  @State baseYear: number = 0;
  /** 按年模式的分页起点（12 年一页） */
  @State yearBase: number = 0;

  /* ── 自定义区间态 ── */
  /** 当前正在编辑哪一端：'start' | 'end' */
  @State editing: string = 'start';
  /** 起止值，'YYYY-MM'；空串表示未选 */
  @State customStart: string = '';
  @State customEnd: string = '';
  /** 自定义面板年份行的年份（跟着 editing 切换，起止各记一个） */
  @State startYear: number = 0;
  @State endYear: number = 0;

  aboutToAppear(): void { this.reset(); }

  onShowChange(): void { if (this.show) { this.reset(); } }

  /** 把内部状态对齐到传入的 initialPeriod / initialMode */
  reset(): void {
    const now = new Date();
    const p = this.initialPeriod || '';
    // 自定义区间进来时 period 是 'YYYY-MM~YYYY-MM'，年月要从起点那一段取，
    // 否则 slice(0,4) 拿到的仍然对（起点年份），但 slice(5,7) 会拿到起点月份 —— 恰好也对。
    // 不过为了语义清晰这里显式拆开。
    const isRange = p.indexOf('~') >= 0;
    const head = isRange ? p.split('~')[0].trim() : p;
    const tail = isRange ? p.split('~')[1].trim() : p;
    const y = Number(head.slice(0, 4)) || now.getFullYear();
    // 'YYYY-MM' 取月份；'YYYY'（按年）没有月份，回落到当前月
    const m = head.length >= 7 ? (Number(head.slice(5, 7)) || (now.getMonth() + 1)) : (now.getMonth() + 1);
    let wanted = this.initialMode;
    if (wanted === 'year' && !this.allowYear) wanted = 'month';
    if (wanted === 'custom' && !this.allowCustom) wanted = 'month';
    this.mode = wanted;
    this.selYear = y;
    this.selMonth = m;
    this.baseYear = y;
    const floor = this.minYearSafe();
    this.yearBase = Math.floor(Math.max(y - floor, 0) / 12) * 12 + floor;

    // 自定义区间：带着范围进来就沿用，否则起止都落到当前月（而不是留空）——
    // 留空会让「确定」一开始就是禁用态，用户不知道要点两次月份才能启用。
    this.editing = 'start';
    if (isRange && head.length >= 7 && tail.length >= 7) {
      this.customStart = head.slice(0, 7);
      this.customEnd = tail.slice(0, 7);
    } else {
      const cur = `${y}-${String(m).padStart(2, '0')}`;
      this.customStart = cur;
      this.customEnd = cur;
    }
    this.startYear = Number(this.customStart.slice(0, 4)) || y;
    this.endYear = Number(this.customEnd.slice(0, 4)) || y;
  }

  minYearSafe(): number {
    return this.minYear > 0 ? this.minYear : new Date().getFullYear();
  }

  /** 按月模式可选年份区间：当前年 −8 … +3（对齐安卓 monthYears） */
  yearFloor(): number { return new Date().getFullYear() - 8; }
  yearCeil(): number { return new Date().getFullYear() + 3; }

  monthRows(): number[][] {
    return [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];
  }

  yearRows(): number[][] {
    const rows: number[][] = [];
    for (let r = 0; r < 3; r++) {
      const row: number[] = [];
      for (let c = 0; c < 4; c++) { row.push(this.yearBase + r * 4 + c); }
      rows.push(row);
    }
    return rows;
  }

  build() {
    if (this.show) {
      Stack() {
        // 遮罩：55% 黑。弹层的职责是遮挡与聚焦，卡片那套半透明玻璃不适用
        Column()
          .width('100%').height('100%')
          .backgroundColor('#8C000000')
          .onClick(() => { if (this.onDismiss) this.onDismiss(); })

        Column() {
          Column({ space: 0 }) {
            if (this.allowYear || this.allowCustom) { this.ModeTabs() }
            if (this.mode === 'month') {
              this.MonthPane()
            } else if (this.mode === 'year') {
              this.YearPane()
            } else {
              this.CustomPane()
            }
          }
          .width('100%')
          .padding({ left: SPACING.xl, right: SPACING.xl, top: SPACING.md, bottom: SPACING.xl })
        }
        .width('100%')
        .backgroundColor(COLORS.surface)
        .borderRadius({ topLeft: 20, topRight: 20 })
      }
      .width('100%').height('100%')
      .alignContent(Alignment.Bottom)
      .position({ x: 0, y: 0 })
      .zIndex(30)
    } else {
      Column() {}
    }
  }

  /** 可用的 tab 列表。按需拼装 —— 账单页只有「按月/按年」，统计页多一个「自定义」 */
  modeTabs(): string[] {
    const out: string[] = ['month'];
    if (this.allowYear) out.push('year');
    if (this.allowCustom) out.push('custom');
    return out;
  }

  tabLabel(k: string): string {
    if (k === 'month') return '按月查看';
    if (k === 'year') return '按年查看';
    return '自定义';
  }

  /** 按月 / 按年 / 自定义 tab：无背景槽，仅靠品牌棕文字 + 28×2 下划线表达选中（对齐安卓） */
  @Builder ModeTabs() {
    Row() {
      ForEach(this.modeTabs(), (k: string) => {
        Column({ space: 6 }) {
          Text(this.tabLabel(k))
            .fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(this.mode === k ? COLORS.brand : COLORS.textSecondary)
          // 未选中时也占一条同高的透明线，否则切 tab 时整块内容会上下跳 2vp
          Divider()
            .width(28).strokeWidth(2)
            .color(this.mode === k ? COLORS.brand : TRANSPARENT)
        }
        // 三段时左右各 18 会让总宽逼近屏宽，压到 14
        .padding({ left: this.allowCustom ? 14 : 18, right: this.allowCustom ? 14 : 18, top: 12, bottom: 10 })
        .onClick(() => { this.mode = k; })
      }, (k: string) => k)
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .margin({ bottom: SPACING.sm })
  }

  @Builder MonthPane() {
    // 年份行：‹ 上一年   本年   下一年 ›
    Row() {
      this.StepBtn('‹', String(this.selYear - 1), true, this.selYear > this.yearFloor(),
        () => { this.selYear = this.selYear - 1; })
      Text(String(this.selYear))
        .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
      this.StepBtn('›', String(this.selYear + 1), false, this.selYear < this.yearCeil(),
        () => { this.selYear = this.selYear + 1; })
    }
    .width('100%')
    .justifyContent(FlexAlign.SpaceBetween)
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: SPACING.lg })

    Column({ space: 10 }) {
      ForEach(this.monthRows(), (row: number[]) => {
        Row({ space: 10 }) {
          ForEach(row, (m: number) => {
            this.GridCell(
              `${m}月`,
              m === this.selMonth && this.selYear === this.baseYear,
              m === (new Date().getMonth() + 1) && this.selYear === new Date().getFullYear(),
              14,
              () => {
                if (this.onConfirm) {
                  this.onConfirm(`${this.selYear}-${String(m).padStart(2, '0')}`, 'month');
                }
              }
            )
          }, (m: number) => `m${m}`)
        }.width('100%')
      }, (row: number[]) => `mr${row[0]}`)
    }.width('100%')
  }

  @Builder YearPane() {
    // 年份翻页行：一页 12 年，左右各跳一整页（对齐安卓 selYearBase ± 12）
    Row() {
      this.StepBtn('‹', String(this.yearBase - 1), true, this.yearBase > this.minYearSafe(),
        () => { this.yearBase = Math.max(this.yearBase - 12, this.minYearSafe()); })
      Text(String(this.yearBase))
        .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
      this.StepBtn('›', String(this.yearBase + 12), false, true,
        () => { this.yearBase = this.yearBase + 12; })
    }
    .width('100%')
    .justifyContent(FlexAlign.SpaceBetween)
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: SPACING.lg })

    Column({ space: 10 }) {
      ForEach(this.yearRows(), (row: number[]) => {
        Row({ space: 10 }) {
          ForEach(row, (y: number) => {
            this.GridCell(
              String(y),
              y === this.selYear,
              y === new Date().getFullYear(),
              15,
              () => { if (this.onConfirm) { this.onConfirm(String(y), 'year'); } }
            )
          }, (y: number) => `y${y}`)
        }.width('100%')
      }, (row: number[]) => `yr${row[0]}`)
    }.width('100%')
  }

  /* ────────── 自定义区间 ────────── */

  /** 当前编辑端对应的年份 */
  activeYear(): number {
    return this.editing === 'start' ? this.startYear : this.endYear;
  }

  /** 当前编辑端已选的 'YYYY-MM' */
  activeValue(): string {
    return this.editing === 'start' ? this.customStart : this.customEnd;
  }

  /** 起止是否合法（都已选 且 起点不晚于终点） */
  rangeValid(): boolean {
    if (!this.customStart || !this.customEnd) return false;
    return this.customStart <= this.customEnd;
  }

  /** 范围回显文案 */
  rangeLabel(): string {
    const s = this.customStart || '开始?';
    const e = this.customEnd || '结束?';
    return `${s}  ~  ${e}`;
  }

  @Builder CustomPane() {
    // 开始 / 结束 分段控件：暖灰槽 + 选中白片（对齐安卓 editing 切换）
    Row() {
      ForEach(['start', 'end'], (k: string) => {
        Text(k === 'start' ? '开始' : '结束')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.editing === k ? COLORS.textPrimary : COLORS.textSecondary)
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .padding({ top: 7, bottom: 7 })
          .backgroundColor(this.editing === k ? COLORS.surface : TRANSPARENT)
          .borderRadius(9)
          .onClick(() => { this.editing = k; })
      }, (k: string) => `seg${k}`)
    }
    .width('100%')
    .padding(3)
    .backgroundColor(COLORS.surfaceVariant)
    .borderRadius(10)
    .margin({ bottom: SPACING.lg })

    // 当前编辑端的年份行
    Row() {
      this.StepBtn('‹', String(this.activeYear() - 1), true, this.activeYear() > this.yearFloor(),
        () => {
          if (this.editing === 'start') { this.startYear = this.startYear - 1; }
          else { this.endYear = this.endYear - 1; }
        })
      Text(String(this.activeYear()))
        .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
      this.StepBtn('›', String(this.activeYear() + 1), false, this.activeYear() < this.yearCeil(),
        () => {
          if (this.editing === 'start') { this.startYear = this.startYear + 1; }
          else { this.endYear = this.endYear + 1; }
        })
    }
    .width('100%')
    .justifyContent(FlexAlign.SpaceBetween)
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: SPACING.lg })

    // 12 月网格：点击只设置当前编辑端，不立即确认（自定义要收两个值）
    Column({ space: 10 }) {
      ForEach(this.monthRows(), (row: number[]) => {
        Row({ space: 10 }) {
          ForEach(row, (m: number) => {
            this.GridCell(
              `${m}月`,
              `${this.activeYear()}-${String(m).padStart(2, '0')}` === this.activeValue(),
              m === (new Date().getMonth() + 1) && this.activeYear() === new Date().getFullYear(),
              14,
              () => {
                const mm = `${this.activeYear()}-${String(m).padStart(2, '0')}`;
                if (this.editing === 'start') {
                  this.customStart = mm;
                  // 起点越过终点时把终点顶上去 —— 让「确定」始终可用，
                  // 而不是留一个非法区间让用户自己发现按钮点不动。
                  if (this.customEnd && mm > this.customEnd) {
                    this.customEnd = mm;
                    this.endYear = this.activeYear();
                  }
                  // 选完开始自动跳到结束：这是「选区间」的自然顺序，
                  // 少一次手动切 tab。
                  this.editing = 'end';
                } else {
                  this.customEnd = mm;
                  if (this.customStart && mm < this.customStart) {
                    this.customStart = mm;
                    this.startYear = this.activeYear();
                  }
                }
              }
            )
          }, (m: number) => `cm${m}`)
        }.width('100%')
      }, (row: number[]) => `cmr${row[0]}`)
    }.width('100%')

    // 已选范围回显：没有这行的话，用户切到「结束」后就看不到开始选的是哪个月了
    Text(this.rangeLabel())
      .fontSize(12).fontColor(COLORS.textSecondary)
      .width('100%').textAlign(TextAlign.Center)
      .margin({ top: SPACING.md, bottom: SPACING.md })

    // 确定按钮：起止非法时禁用并降透明度
    Text('确定')
      .fontSize(15).fontWeight(FontWeight.Medium)
      .fontColor(COLORS.onPrimary)
      .textAlign(TextAlign.Center)
      .width('100%').height(48)
      .backgroundColor(COLORS.brand)
      .borderRadius(12)
      .opacity(this.rangeValid() ? 1 : 0.4)
      .onClick(() => {
        if (!this.rangeValid()) return;
        if (this.onConfirm) {
          this.onConfirm(`${this.customStart}~${this.customEnd}`, 'custom');
        }
      })
  }

  /**
   * 翻页按钮：箭头 + 目标年份数字。
   * 只画箭头的话用户不知道点过去是哪一年，按年模式尤其明显（跳的是 12 年不是 1 年）。
   * 越界时降透明度并断开点击 —— 灰掉但仍可点会让人以为功能坏了。
   */
  @Builder StepBtn(arrow: string, label: string, arrowFirst: boolean, enabled: boolean, onTap: () => void) {    Row({ space: 4 }) {
      if (arrowFirst) {
        Text(arrow).fontSize(18).fontColor(COLORS.brand)
        Text(label).fontSize(13).fontColor(COLORS.brand)
      } else {
        Text(label).fontSize(13).fontColor(COLORS.brand)
        Text(arrow).fontSize(18).fontColor(COLORS.brand)
      }
    }
    .padding({ left: 8, right: 8, top: 6, bottom: 6 })
    .opacity(enabled ? 1 : 0.32)
    .alignItems(VerticalAlign.Center)
    .onClick(() => { if (enabled) { onTap(); } })
  }

  /**
   * 网格格子（月份 / 年份共用）：选中=品牌棕实底白字，今月/今年=暖棕淡底棕字，
   * 其余=暖灰底常规字色。
   *
   * 刻意不照抄安卓的 Color(0xFFE8F5E9)（浅绿）标记「当前月」——
   * 浅绿在这套暖棕体系里是外来色，一个绿格子插在 12 个暖灰格子中间比高亮更像故障。
   * 用 brandBgLight（暖棕淡底）表达「这是今天所在的周期」，与日历格子的
   * 「有记录=暖棕淡底」是同一套语言。
   */
  @Builder GridCell(label: string, selected: boolean, current: boolean, fontSize: number, onTap: () => void) {
    Text(label)
      .fontSize(fontSize)
      .fontWeight(selected || current ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(selected ? COLORS.onPrimary : (current ? COLORS.brand : COLORS.textPrimary))
      .textAlign(TextAlign.Center)
      .layoutWeight(1)
      .height(38)
      .backgroundColor(selected ? COLORS.brand : (current ? COLORS.brandBgLight : COLORS.surfaceVariant))
      .borderRadius(10)
      .onClick(onTap)
  }
}
