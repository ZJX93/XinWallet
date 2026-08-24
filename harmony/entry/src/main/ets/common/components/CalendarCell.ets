/**
 * 共享日历格（对齐安卓端 CalendarCell.kt 的 SharedCalendarCell + CalendarCellData）。
 * 提供：
 *  - CalCell 数据接口（含 kind: 当前/上月/下月/空白，上下月带月名）
 *  - buildMonthCells 计算完整 6×7 网格（含上下月月名占位，对齐安卓周一起头）
 *  - SharedCalendarCell 单格组件：固定 44dp + 三行(日期/支出绿/收入红)固定位置
 *      选中=暖棕满底白字；有记录=暖棕淡底；空白=淡灰；上下月=更淡灰+月名
 *
 * 依赖 formatCalAmount（见 theme.ts）：日历专用超短格式，无小数，避免窄格溢出。
 *   注意不要用 formatCompact —— 它在 1 万以下输出两位小数（3458.00），格子放不下。
 */
import { COLORS, formatCalAmount } from '../theme';

export interface CalCell {
  kind: 'EMPTY' | 'PREV' | 'NEXT' | 'CURRENT';
  day?: number;
  dayLabel?: string; // 上下月月名，如 "8月"
  date?: string;
  expense?: number;
  income?: number;
  hasRecord?: boolean;
}

function daysInMonth(y: number, m: number): number {
  // m 为 1-based；用 Date(y, m, 0) 取上月最后一天即当月天数
  return new Date(y, m, 0).getDate();
}

/**
 * 生成完整日历网格（固定 42 格 = 6 行 × 7 列，周一起头）。
 * @param year 当前显示年(4位)
 * @param month 当前显示月(1-based)
 * @param days 当月有数据的日历天（CalendarDay[]，按日期升序）
 * @param selectedDate 选中日期(yyyy-MM-dd)，用于高亮
 * @param todayDate 今天(yyyy-MM-dd)，用于加粗
 */
export function buildMonthCells(
  year: number,
  month: number,
  days: ESObject[],
  selectedDate?: string,
  todayDate?: string
): CalCell[] {
  const cells: CalCell[] = [];

  // ⚠️ 关键：网格必须由「年月」自己算出完整天数，days 只能当查表用。
  //
  // 原实现是 days.forEach 直接把返回项一个个 push 成当月格子 —— 但服务端
  // /stats/calendar 的 monthDays 是 GROUP BY 的结果，**只包含有交易的日期**。
  // 2 号没记账 → monthDays 里没有 2 号 → 网格里 1 号后面直接接 3 号，
  // 当月整体少几格、后续日期全部左移，日期与星期列彻底错位。
  // 同理 firstW 用 days[0].date 推首列偏移：1 号没记账时会拿 2 号去算，偏移也错。
  //
  // 正确做法（对齐安卓 MonthCalendarGrid）：自己按 Calendar 铺满 6×7，
  // 再用日期字符串去 days 里查金额。

  // 建立 date -> 金额 的查找表。
  // 注意用两个 Map<string, number> 而不是 Map<string, ESObject> ——
  // ArkTS 的 arkts-no-any-unknown 不允许 ESObject 出现在泛型实参位置。
  const incByDate = new Map<string, number>();
  const expByDate = new Map<string, number>();
  days.forEach((d: ESObject) => {
    const key = String(d.date);
    incByDate.set(key, Number(d.income) || 0);
    expByDate.set(key, Number(d.expense) || 0);
  });

  const mm = String(month).padStart(2, '0');

  // 当月 1 号是周几（周一起头：0=周一 … 6=周日）
  const first = new Date(year, month - 1, 1);
  let firstW = first.getDay() - 1;
  if (firstW < 0) firstW = 6;

  // 上月残日（只有该区域第一格显示月名，对齐安卓）
  const prevMonth = month - 1 > 0 ? month - 1 : 12;
  const prevYear = month - 1 > 0 ? year : year - 1;
  const prevDays = daysInMonth(prevYear, prevMonth);
  for (let i = 0; i < firstW; i++) {
    cells.push({
      kind: 'PREV',
      day: prevDays - firstW + 1 + i,
      dayLabel: i === 0 ? `${prevMonth}月` : undefined
    });
  }

  // 当月：完整天数，逐日查表
  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d++) {
    const key = `${year}-${mm}-${String(d).padStart(2, '0')}`;
    const inc = incByDate.get(key) ?? 0;
    const exp = expByDate.get(key) ?? 0;
    cells.push({
      kind: 'CURRENT',
      day: d,
      date: key,
      expense: exp,
      income: inc,
      hasRecord: inc > 0 || exp > 0
    });
  }

  // 下月残日补齐（网格按整周收尾，不硬凑 42 —— 2 月恰好 28 天且周一开头时
  // 只需 4 行，硬补到 42 会拖出两整行空白）
  const nextMonth = month + 1 <= 12 ? month + 1 : 1;
  const rows = Math.ceil(cells.length / 7);
  const need = rows * 7 - cells.length;
  for (let i = 0; i < need; i++) {
    cells.push({
      kind: 'NEXT',
      day: i + 1,
      dayLabel: i === 0 ? `${nextMonth}月` : undefined
    });
  }
  return cells;
}

/**
 * ForEach 的 diff key。
 *
 * ⚠️ 必须把金额编进 key，只用「kind + 日期」是不够的。
 * 日历数据异步返回：首帧 cal=null，42 格金额全 0；数据回来后金额变了，
 * 但 kind 和日期没变 → key 完全相同 → ForEach 认为节点未变化，不重建、
 * 不更新，格子里的金额永远是首帧那份 0（就是「金额没显示」的直接原因）。
 * @Prop 解决了「节点存在时属性同步」，key 带金额则保证「节点必被重建」，
 * 两者一起才稳 —— 只改其中一个在不同 API 版本上表现不一致。
 */
export function calCellKey(c: CalCell): string {
  const id = c.date ?? c.dayLabel ?? (c.day !== undefined ? c.day.toString() : '');
  return `${c.kind}_${id}_${c.income ?? 0}_${c.expense ?? 0}`;
}

@Component
export struct SharedCalendarCell {
  /**
   * ⚠️ 必须是 @Prop 而不是普通成员变量。
   * 普通成员只在节点创建时赋值一次：日历数据是异步拉回来的，首帧
   * cell 里金额全是 0，数据到位后父组件重渲染，但 ForEach 若判定
   * 该节点「没变」就不会重建，普通成员也不会被重新写入 —— 结果
   * 格子里的金额永远停在首帧的 0（表现为「金额不显示」）。
   * @Prop 建立单向同步，父层数据变化会推到子组件。
   */
  @Prop cell: CalCell = { kind: 'EMPTY' };
  // 同理必须 @Prop：selectedDate 变化时若不同步，点了日期格子底色不变，
  // 表现为「点了没反应」。onTap 是回调（父层闭包），不参与状态同步，保持普通成员。
  @Prop isSelected: boolean = false;
  @Prop isToday: boolean = false;
  onTap?: () => void;

  build() {
    // 外层只负责格间距：全格铺底之后，相邻格子会连成一片色块，
    // 必须靠 margin 撑出缝隙，网格线才读得出来。间隙不能做成 padding —— 
    // padding 会被内层背景吃掉，撑不出缝。
    Column() {
    Column({ space: 1 }) {
      // 第一行：日期 / 上下月月名
      Text(this.cell.kind !== 'CURRENT' && this.cell.dayLabel ? this.cell.dayLabel : (this.cell.day?.toString() ?? ''))
        .fontSize(this.isToday ? 13 : 12)
        .fontColor(
          this.isSelected ? '#FFFFFF'
            : (this.cell.kind !== 'CURRENT' ? COLORS.placeholder
              : (this.isToday ? COLORS.brand : COLORS.textPrimary))
        )
        .fontWeight(this.isSelected || this.isToday ? FontWeight.Bold : FontWeight.Medium)
        .textAlign(TextAlign.Center)
        .width('100%')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.cell.kind === 'CURRENT') {
        // 第二行：支出（绿，日历专用超短格式 —— formatCompact 在 1 万以下会输出
        // 两位小数，3458.00 是 7 个字符，在 1/7 屏宽的格子里必然溢出/截断）
        Text((this.cell.expense ?? 0) > 0 ? formatCalAmount(this.cell.expense ?? 0) : ' ')
          .fontSize(9)
          .fontColor(this.isSelected ? '#CCFFFFFF' : COLORS.expense)
          .textAlign(TextAlign.Center)
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        // 第三行：收入（红，同上）
        Text((this.cell.income ?? 0) > 0 ? formatCalAmount(this.cell.income ?? 0) : ' ')
          .fontSize(9)
          .fontColor(this.isSelected ? '#FFFFFFB3' : COLORS.income)
          .textAlign(TextAlign.Center)
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      } else {
        // 上月/下月：保留两行透明占位维持三行位置
        Text(' ').fontSize(9).fontColor('#00000000').width('100%')
        Text(' ').fontSize(9).fontColor('#00000000').width('100%')
      }
    }
    .height(50)
    .width('100%')
    // 对齐安卓 CalendarCell.kt：格子 44dp、日期 11sp、金额 8sp。
    // 鸿蒙这边字号取 12/9（比安卓大 1，鸿蒙默认字体偏小），故格子 50 而非 44。
    // 三行 12+9+9=30 + 行间 1×2 + 上下 padding 4×2 = 40，留 10px 应对系统字体缩放。
    // 原先 54 + 13/9/9 在真机上偏高偏方，6 行叠起来整张网格比安卓高一截。
    .padding({ top: 4, bottom: 4, left: 2, right: 2 })
    .backgroundColor(
      this.isSelected
        ? COLORS.brand
        : (this.cell.kind !== 'CURRENT'
            ? COLORS.surfaceVariant            // 上下月 = 暖灰分组底
            : (this.cell.hasRecord
                ? COLORS.brandBgLight          // 有记录 = 暖棕淡底
                : COLORS.surfaceVariant))      // 无记录 = 暖灰底（与上下月同色）
    )
    // 无记录格子刻意不用透明：42 格里只有小半数有底色时，网格散成一片斑点，
    // 读不出「日历是一张连续的表」。全部铺底、只用「暖棕淡底 vs 暖灰底」
    // 区分有无记录，网格才立得住（对齐安卓端）。
    .borderRadius(8)
    // 今日未选中时用品牌色描边标记，避免只靠字色难以分辨
    .border({
      width: (this.isToday && !this.isSelected) ? 1.5 : 0,
      color: COLORS.brand
    })
    // ArkTS 严格模式不接受 shadow(undefined)：未选中时给 0 半径等效无阴影
    .shadow(this.isSelected
      ? { radius: 6, color: COLORS.shadowAmbient, offsetY: 2 }
      : { radius: 0, color: '#00000000', offsetY: 0 })
    .justifyContent(FlexAlign.Center)
    .onClick(() => {
      if (this.onTap && this.cell.kind === 'CURRENT' && this.cell.date) { this.onTap(); }
    })
    }
    .padding(2)
  }
}
