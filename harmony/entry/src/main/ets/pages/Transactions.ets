/**
 * 账单（对齐安卓 TransactionsScreen.kt）：流水/日历双视图。
 * 仅作为 Main 的 Tab 内嵌组件（TransactionsPage）——独立路由已移除，
 * 见文件末尾注释与 docs/harmony-style-guide.md 第 11 节。
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, fmtMoney, fmtMoneyShort, fmtMoneyMix, fmtDayLabel, sumByCurrency, isSingleCurrency, LAYOUT, RADIUS, TRANSPARENT, CurrencyAmount } from '../common/theme';
import { TransactionItem, TxSummary, Book, Budget, BooksResponse, Account } from '../common/models';
import {
  TransactionRow, LoadingBox, PullRefreshBox, HeroGradientCard,
  BookHeader, BookSwitcherSheet, BottomSheet, SheetHeader,
  DropdownField, DropdownOption, DatePickerField
} from '../common/components/Components';
import { SharedCalendarCell, buildMonthCells, CalCell, calCellKey } from '../common/components/CalendarCell';
import { PeriodPickerSheet } from '../common/components/PeriodPickerSheet';

interface Iface1 {
  date: string;
  rows: TransactionItem[];
}

/**
 * 单次拉取上限。按年查看时整年很容易超过这个数 —— 但下方列表是
 * Scroll + ForEach 全量建节点，放大 limit 只会把卡顿换个地方发生。
 * 截断在列表末尾用文字明示，让用户知道「下面还有，去按月看」。
 */
const TX_LIMIT: number = 500;

function ym(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function dayNum(s: string): string {
  if (!s) return '';
  const parts = s.split(/[- T:]/);
  return parts.length >= 3 ? parts[2] : '';
}
function weekdayOf(s: string): number {
  const d = new Date(s.replace(/-/g, '/'));
  let w = d.getDay() - 1; if (w < 0) w = 6; return w;
}

@Component
export struct TransactionsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @Prop month: string = ym(new Date());
  @State viewMode: string = 'list'; // list | calendar
  /**
   * 时间维度：month（按月）| year（按年）。对齐安卓 TxUiState.periodMode。
   * 鸿蒙端原本没有这个维度 —— 只能一个月一个月地翻，想看「今年一共花了多少」
   * 得翻 12 次并自己加。安卓端在月份弹层里给了「按年查看」tab，这里补齐。
   */
  @State periodMode: string = 'month';
  @State showPeriodSheet: boolean = false;
  /** 最早一笔交易的年份，供按年视图决定翻页下界（0=未知，回落到当前年） */
  @State minYear: number = 0;
  @State items: TransactionItem[] = [];
  @State summary: TxSummary | null = null;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State refreshing: boolean = false;
  @State showMonthDlg: boolean = false;
  @State calDays: ESObject[] = [];
  @State selectedDate: string = '';
  // 账本头（对齐安卓端：账单页顶部同样有「账本名 ⇄ / 🔍」一行，
  // 原先鸿蒙端直接从分段控件开始，缺了这层身份标识 —— 用户看不出当前在哪个账本记账）
  @State books: Book[] = [];
  @State currentBookId: number = 0;
  @State bookName: string = '默认账本';
  @State showBookSheet: boolean = false;
  // 本月预算与剩余（棕卡第 3、4 列）。
  // 安卓端这两列是硬编码 0.0 的占位，这里接真实预算数据 —— 界面上写着「本月预算」
  // 却永远显示 ¥0.00，比不显示更糟：用户会以为自己没设预算。
  @State budgetTotal: number = 0;
  @State budgetSpent: number = 0;
  /**
   * 折叠转账的编辑链路。
   * 一笔转账在列表里只出一条（服务端 SQL 折叠），点它要走 AddTransaction（transfer 分支）
   * 走 PUT /transfers/:id —— 普通交易 PUT /transactions/:id 只会动一条腿，
   * 两个账户余额会从此对不上。删除按钮也在 AddTransaction 内（事务删两条腿 + 重算余额）。
   * 这里不再保留 txAction/txEditing/txConfirmDel/tf* 等中间状态，
   * 跳转逻辑见 openRow() 与 editTransferViaPage()。
   */
  todayDate: string = `${ym(new Date())}-${String(new Date().getDate()).padStart(2, '0')}`;

  aboutToAppear(): void { this.load(); this.loadBooks(); this.loadMinYear(); }
  /**
   * 跳到 AddTransaction 编辑/删除后返回，触发列表刷新。
   * 用 onPageShow 而不是 aboutToAppear：tab 内容首次进入走 aboutToAppear，
   * 切走切回时只有 onPageShow 会再触发（AppStorage 不变时无意义重拉被
   * aboutToAppear 漏掉过）。改动金额会重算账户余额和影响跨月列表，整页重拉。
   */
  onPageShow(): void { this.load(); }

  /** 账本列表 + 当前账本（与首页同一套接口，切换后两页都要刷新） */
  async loadBooks(): Promise<void> {
    try {
      const r = await Api.getBooks();
      if (r.success && r.data) {
        const data = r.data as BooksResponse;
        this.books = data.books || [];
        this.currentBookId = data.currentBookId || 0;
        const b = this.books.find(x => x.id === this.currentBookId);
        this.bookName = b ? b.name : '默认账本';
      }
    } catch (e) { /* 读失败静默降级：账本名回落到默认值即可，不打扰用户 */ }
  }

  async load(): Promise<void> {
    this.loading = true;
    // 按年视图下 month 是 'YYYY'，服务端的 LIKE 'month%' 天然按年匹配（对齐安卓）。
    // 日历接口只接受 (year, month) 两个数字，按年时整年没有「月历」这种形态，
    // 所以按年模式跳过日历请求 —— 强行传个月份会让格子显示某一个月的数据，
    // 而顶部写着「2026年」，两者对不上。
    const isYear = this.periodMode === 'year';
    try {
      const _r = await Promise.all([
        // limit 500：日历视图点某天时直接从 items 里过滤（不再单发请求），
        // 所以这里必须是「当月全量」。单月超 500 笔会被截断 ——
        // 此时格子金额（来自 calDays，服务端 SUM 无上限）会和下方列表对不上。
        // 真实记账场景单月 500 笔已属极端，暂不做分页；若出现需改为按天单独取。
        //
        // 按年模式刻意仍用 500 而不是放宽到 2000：下方列表是
        // Scroll + ForEach 全量建节点（不是 LazyForEach），2000 行会在切到
        // 按年的瞬间卡住主线程。截断本身用 truncated() 在列表末尾明示，
        // 顶部棕卡的合计来自服务端 SUM、不受 limit 影响，仍然是准的。
        Api.getTransactions({ month: this.month, limit: TX_LIMIT }),
        Api.getTransactionSummary(this.month)
      ]);
      const t = _r[0];
      const s = _r[1];
      if (t.success) this.items = t.data || [];
      if (s.success) this.summary = s.data;
      if (isYear) {
        this.calDays = [];
      } else {
        const c = await Api.getStatsCalendar(
          Number(this.month.split('-')[0]), Number(this.month.split('-')[1]));
        if (c.success) { this.calDays = ((c.data as ESObject)?.monthDays as ESObject[]) ?? ([] as ESObject[]); }
      }
    } catch (e) { console.error('Tx load:', (e as ApiError).message); }
    finally { this.loading = false; }
    this.loadBudget();
  }

  /**
   * 最早一笔交易的年份：按年视图翻页的下界。
   * /transactions/months 返回倒序的 'YYYY-MM' 列表，末位即最早（对齐安卓
   * state.months.lastOrNull()）。拿不到就留 0，弹层里会回落到当前年。
   */
  async loadMinYear(): Promise<void> {
    try {
      const r = await Api.getTransactionMonths();
      if (!r.success) return;
      const list = r.data || [];
      if (list.length === 0) return;
      const y = Number(list[list.length - 1].slice(0, 4));
      if (y > 0) this.minYear = y;
    } catch (e) { /* 读失败静默降级：弹层回落到「当前年」为下界，不影响选月 */ }
  }

  /**
   * 预算汇总：只统计「月」周期的预算 —— 年度/自定义周期预算摊到当月没有确定算法，
   * 混进来会让「本月预算」这个数失去含义。
   * 单独一个请求而不并进上面的 Promise.all：预算失败不该拖累主列表加载。
   */
  async loadBudget(): Promise<void> {
    try {
      const r = await Api.getBudgets();
      if (!r.success) return;
      const list = (r.data as Budget[]) || [];
      let total = 0;
      let spent = 0;
      list.forEach((b: Budget) => {
        if ((b.period ?? '月') !== '月') return;
        total += b.amount ?? 0;
        spent += b.spent ?? b.used ?? 0;
      });
      this.budgetTotal = total;
      this.budgetSpent = spent;
    } catch (e) { /* 读失败静默降级：预算两列显示 0，不阻断主流程 */ }
  }

  /**
   * 上一个/下一个周期。按年模式下步进的是「年」而不是「月」——
   * 顶部写着「2026年」时点 ›，用户预期跳到 2027年，不是 2026年9月（对齐安卓）。
   */
  changeMonth(delta: number): void {
    if (this.periodMode === 'year') {
      const y = Number(this.month.slice(0, 4));
      this.month = String(y + delta);
    } else {
      const _parts = this.month.split('-').map(Number);
      const y = _parts[0];
      const m = _parts[1];
      let ny = y, nm = m + delta;
      if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; }
      this.month = `${ny}-${String(nm).padStart(2, '0')}`;
    }
    // 切月必须清选中：选的是 8-20，切到 9 月后这个日期在新网格里不存在，
    // 汇总行会显示「2026-08-20 收 ¥0 支 ¥0」这种跨月的空数据。
    this.selectedDate = '';
    this.load();
  }

  /** 打开周期选择弹层（自绘月份/年份网格，取代系统日期滚轮，见 PeriodPickerSheet 头注释） */
  pickMonth(): void { this.showPeriodSheet = true; }

  /**
   * 弹层回调：period 为 'YYYY-MM' 或 'YYYY'，mode 为 'month' | 'year'。
   * 日历视图只会回 month —— 弹层在 allowYear=false 下不显示按年 tab。
   */
  applyPeriod(period: string, mode: string): void {
    this.showPeriodSheet = false;
    this.periodMode = mode;
    this.month = period;
    this.selectedDate = '';   // 同 changeMonth：跨周期后旧选中日期已失效
    this.load();
  }

  /**
   * 流水分组。按月时按天分组（一个月最多 31 个 header）；
   * 按年时改为按月分组 —— 整年按天会分出 300+ 个日期 header，
   * 屏幕上一半的行都是分组标题，那已经不是「一份流水」而是一张日期清单了。
   * 按年的诉求是「哪个月花得多」，按月分组正好回答这个问题。
   */
  groups(): Iface1[] {
    const byMonth = this.periodMode === 'year';
    const map = new Map<string, TransactionItem[]>();
    this.items.forEach(it => {
      const k = (it.date || '').slice(0, byMonth ? 7 : 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0] < b[0] ? 1 : -1)
      .map((e: [string, TransactionItem[]]): Iface1 => ({ date: e[0], rows: e[1] }));
  }

  /**
   * 多币种 P2-3c：按 currency 分桶聚合的日收入/支出 breakdown。
   *
   * 原来直接 .reduce((s,r) => s + r.amount) 把所有金额累加 —— 混币种账本下是错的：
   * CNY 100 + USD 50 = 150 这种「跨币种累加」毫无业务意义。
   * 返回 breakdown 给 fmtMoneyMix 渲染，主币种居中、其他币种括号附注。
   */
  dayIncomeBreakdown(rows: TransactionItem[]): Record<string, number> {
    return sumByCurrency(rows.filter(r => r.type === 'income')
      .map((r: TransactionItem): CurrencyAmount =>
        ({ currency: r.currency, amount: r.amount })));
  }
  dayExpenseBreakdown(rows: TransactionItem[]): Record<string, number> {
    return sumByCurrency(rows.filter(r => r.type === 'expense')
      .map((r: TransactionItem): CurrencyAmount =>
        ({ currency: r.currency, amount: r.amount })));
  }
  /** 单货币账本下的日收入紧凑值（>=1万才缩），混币种账本退化为 0 由 fmtMoneyMix 单独展示。 */
  dayIncomeShort(rows: TransactionItem[]): string {
    const b = this.dayIncomeBreakdown(rows);
    if (!isSingleCurrency(b)) return '';   // 多币种：日期 header 让位给 fmtMoneyMix，下方汇总卡再展示
    const keys = Object.keys(b);
    const cur = keys.length > 0 ? keys[0] : 'CNY';
    return fmtMoneyShort(b[cur] ?? 0, cur);
  }
  dayExpenseShort(rows: TransactionItem[]): string {
    const b = this.dayExpenseBreakdown(rows);
    if (!isSingleCurrency(b)) return '';
    const keys = Object.keys(b);
    const cur = keys.length > 0 ? keys[0] : 'CNY';
    return fmtMoneyShort(b[cur] ?? 0, cur);
  }
  /**
   * 汇总行日收/日支文案：单币种取紧凑值，混币种由 fmtMoneyMix 展开。
   * 抽成普通方法而不是在 @Builder 里写 IIFE —— @Builder 体内只允许 UI 组件语法，
   * 内联箭头函数虽然能过 ArkTS，但可读性差且每次重渲染都要新建闭包。
   */
  dayIncomeLabel(rows: TransactionItem[]): string {
    const s = this.dayIncomeShort(rows);
    return s !== '' ? s : fmtMoneyMix(this.dayIncomeBreakdown(rows));
  }
  dayExpenseLabel(rows: TransactionItem[]): string {
    const s = this.dayExpenseShort(rows);
    return s !== '' ? s : fmtMoneyMix(this.dayExpenseBreakdown(rows));
  }

  @Builder ToolBar() {
    Row({ space: 10 }) {
      // 流水/日历分段：连体胶囊（一个暖灰底槽 + 内部滑块）。
      // 占据左侧 layoutWeight(1)、内部两项等分 —— 原先是内容宽度自适应，
      // 「流水」「日历」都是两个字，看起来是两个尺寸随机的标签而不是一个开关；
      // 定宽等分后滑块位置本身就在表达「二选一，现在在左边这个」。
      Row({ space: 2 }) {
        this.SegBtn('流水', 'list')
        this.SegBtn('日历', 'calendar')
      }
      .layoutWeight(1)
      .padding(3)
      .backgroundColor(COLORS.surfaceVariant)
      .borderRadius(RADIUS.md)
      // 月份导航：‹ 年月 › 三件一组（对齐安卓端）。
      // 原先是「上月 / 2026-08 / 下月」三个 Chip 并排，
      // 「上月」「下月」这两个字占了宽度却没提供比箭头更多的信息。
      Row({ space: 0 }) {
        this.NavArrow('‹', () => this.changeMonth(-1))
        Text(this.monthLabel())
          .fontSize(15).fontWeight(FontWeight.Bold)
          .fontColor(COLORS.textPrimary)
          .onClick(() => this.pickMonth())
        this.NavArrow('›', () => this.changeMonth(1))
      }.alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .alignItems(VerticalAlign.Center)
  }

  /** 分段按钮：选中=实心棕+白字，未选中=透明+次级字色。两项等分槽宽 */
  @Builder SegBtn(label: string, mode: string) {
    Text(label)
      .fontSize(14)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.viewMode === mode ? COLORS.onPrimary : COLORS.textSecondary)
      .textAlign(TextAlign.Center)
      .layoutWeight(1)
      .padding({ top: 7, bottom: 7 })
      .backgroundColor(this.viewMode === mode ? COLORS.brand : TRANSPARENT)
      // 内圆角 = 外圆角(RADIUS.md=12) − 槽 padding(3) = 9，这样滑块和槽的
      // 圆弧才同心。直接用 RADIUS.sm(8) 会让滑块看起来比槽更圆、边缘留白不均。
      .borderRadius(9)
      .onClick(() => {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        // 切到日历视图时必须退回按月：月历网格没有「整年」这种形态，
        // 而 month 此时是 'YYYY'，buildMonthCells 拿 split('-')[1] 会得到 NaN，
        // 整张网格算不出来（安卓端此处未做处理，是个隐患）。
        if (mode === 'calendar' && this.periodMode === 'year') {
          this.periodMode = 'month';
          const now = new Date();
          const y = this.month.slice(0, 4);
          this.month = `${y}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          this.selectedDate = '';
          this.load();
        }
      })
  }

  /**
   * 月份切换箭头：品牌棕色 + 32vp 方形点击区（对齐安卓 Brown500 / 32dp）。
   * 原先用 textSecondary 灰色，和旁边不可点的月份文字同色 —— 看不出这是能点的。
   * 32vp 是最小舒适点击区，20vp 的箭头字符本身撑不出这个尺寸。
   */
  @Builder NavArrow(label: string, onTap: () => void) {
    Text(label)
      .fontSize(20).fontColor(COLORS.brand)
      .width(32).height(32).textAlign(TextAlign.Center)
      .onClick(onTap)
  }

  /**
   * 「2026年8月」比「2026-08」好读。
   * 普通方法而非 get 访问器 —— ArkTS 在 @Component struct 里经过 getter
   * 访问 @Prop/@State 会丢状态依赖，month 变化后可能不重渲染。
   */
  monthLabel(): string {
    if (this.periodMode === 'year') { return `${this.month.slice(0, 4)}年`; }
    const p = this.month.split('-');
    return `${p[0]}年${Number(p[1])}月`;
  }

  /** 汇总卡标签前缀：按年时是「本年支出」而不是「本月支出」（对齐安卓 prefix） */
  periodPrefix(): string { return this.periodMode === 'year' ? '本年' : '本月'; }

  /**
   * 汇总卡数据服务方法。
   * 这些计算原先直接写在 @Builder SummaryStrip 体内（const 声明 + IIFE），
   * 但 ArkTS 禁止在 @Builder 方法体内写 const/let（报「Only UI component syntax」）。
   * 现提取为普通方法，@Builder 内只保留 UI 组件语法、用 this.xxx() 取派生值。
   */
  summaryIncBreak(): Record<string, number> | undefined {
    return this.summary?.incomeBreakdown;
  }
  summaryExpBreak(): Record<string, number> | undefined {
    return this.summary?.expenseBreakdown;
  }
  summarySingleCur(): string {
    return this.summary?.currency ?? 'CNY';
  }
  /** 单币种账本退回单值，否则 null（混币种由 fmtMoneyMix 展开） */
  summaryIncSingle(): Record<string, number> | null {
    const b = this.summaryIncBreak();
    return b && isSingleCurrency(b) ? b : null;
  }
  summaryExpSingle(): Record<string, number> | null {
    const b = this.summaryExpBreak();
    return b && isSingleCurrency(b) ? b : null;
  }
  /** 混币种账本：结余 = 各币种收入 − 支出（按币种相减）；收入/支出 breakdown 缺失时返回 null */
  summaryBalance(): Record<string, number> | null {
    const incBreak = this.summaryIncBreak();
    const expBreak = this.summaryExpBreak();
    if (!incBreak || !expBreak) return null;
    const b: Record<string, number> = {};
    const keys = new Set<string>([...Object.keys(incBreak), ...Object.keys(expBreak)]);
    keys.forEach((k: string) => { b[k] = (incBreak[k] ?? 0) - (expBreak[k] ?? 0); });
    return b;
  }
  summaryExpenseLabel(): string {
    const expBreak = this.summaryExpBreak();
    const expSingle = this.summaryExpSingle();
    const singleCur = this.summarySingleCur();
    return expSingle ? fmtMoney(Object.values(expSingle)[0] ?? 0, singleCur) : fmtMoneyMix(expBreak, singleCur);
  }
  summaryIncomeLabel(): string {
    const incBreak = this.summaryIncBreak();
    const incSingle = this.summaryIncSingle();
    const singleCur = this.summarySingleCur();
    return incSingle ? fmtMoney(Object.values(incSingle)[0] ?? 0, singleCur) : fmtMoneyMix(incBreak, singleCur);
  }

  @Builder SummaryStrip() {
    // 结余大字 + 下方四列小字，复用首页 HeroGradientCard（对齐安卓 SummaryCard）。
    // 「结余」是主角；收入/支出/预算/剩余是构成它的过程。第 4 列为预算（流水笔数列表里已可见）。
    // 多币种 P2-3c：优先 breakdown（混币种跨币种累加无意义），单币种退化 fmtMoney。
    Column() {
      HeroGradientCard({
        topLeft: '结余',
        amount: fmtMoneyMix(this.summaryBalance(), this.summarySingleCur()),
        bottomCells: [
          { label: this.periodPrefix() + '支出', value: this.summaryExpenseLabel() },
          { label: this.periodPrefix() + '收入', value: this.summaryIncomeLabel() },
          { label: this.periodPrefix() + '预算', value: fmtMoney(this.budgetTotal) },
          { label: this.periodPrefix() + '剩余', value: fmtMoney(this.budgetRemain()) }
        ]
      })
    }.padding({ left: 16, right: 16 })
  }

  /**
   * 本月剩余预算 = 预算总额 - 已用。
   * 没设预算时返回 0 而不是负数 —— 预算为 0 时「剩余 -1692.67」是错的，
   * 那不叫超支，那叫没设预算。
   */
  budgetRemain(): number {
    if (this.budgetTotal <= 0) return 0;
    return this.budgetTotal - this.budgetSpent;
  }

  /** 是否命中拉取上限（== 而非 >=：服务端不会返回多于 limit 的条数） */
  truncated(): boolean { return this.items.length >= TX_LIMIT; }

  @Builder ListView() {
    Column({ space: 12 }) {
      this.SummaryStrip()
      PullRefreshBox({ refreshing: $refreshing, onRefresh: () => { this.load().then(() => { this.refreshing = false; }); } }) {
        Scroll() {
          // 整月一张卡，内部按天分 header + 行内分隔线（对齐安卓端）。
          // 原先每天套一个独立卡片，一个月能堆出 30 个卡 —— 滚动时全是圆角和
          // 描边在闪，读不出「这是一份连续的流水」。日期只是分组标签，
          // 不该获得和「整月账单」同级的卡片容器。
          Column({ space: 0 }) {
            Column({ space: 0 }) {
              ForEach(this.groups(), (g: Iface1, gi: number) => {
                // 日期 header：裸文字，仅靠字号/字色和流水行区分层级。
                // 与日历视图汇总行用同一套格式化（fmtDayLabel + fmtMoneyShort）——
                // 同一页里若一处显示「2026-08-28」另一处「8月28日」，
                // 用户会以为这是两种不同的东西。
                // 按年查看时 g.date 是 'YYYY-MM'，fmtDayLabel 会输出「2026年8月」，
                // 此时年份不冗余（跨年数据里只写「8月」有歧义）。
                Row() {
                  Text(fmtDayLabel(g.date))
                    .fontSize(13).fontColor(COLORS.textSecondary)
                    .maxLines(1)
                  Blank()
                  // 多币种 P2-3c：日期 header 收/支。单币种账本显示 fmtMoneyShort（>=1万 才缩），
                  // 混币种账本退化为空让位给下方汇总卡展示 —— 同一天的「收 USD 5」和
                  // 「收 CNY 30」并列无意义。
                  //
                  // ArkTS @Builder 内不允许顶层 const。改成条件直接求值，省掉中间变量。
                  if (this.dayIncomeShort(g.rows) !== '') {
                    Text('收 ' + this.dayIncomeShort(g.rows))
                      .fontSize(12).fontColor(COLORS.textSecondary)
                      .maxLines(1)
                      .margin({ right: 10 })
                  }
                  if (this.dayExpenseShort(g.rows) !== '') {
                    Text('支 ' + this.dayExpenseShort(g.rows))
                      .fontSize(12).fontColor(COLORS.textSecondary)
                      .maxLines(1)
                  }
                }
                .width('100%')
                .padding({ left: 4, right: 4, top: gi === 0 ? 4 : 14, bottom: 8 })
                .alignItems(VerticalAlign.Center)

                ForEach(g.rows, (it: TransactionItem, ri: number) => {
                  TransactionRow({
                    item: it,
                    compact: true,
                    showTopDivider: ri !== 0,
                    onItemClick: () => this.openRow(it)
                  })
                }, (it: TransactionItem) => it.id.toString())
              }, (g: Iface1) => g.date)
            }
            .width('100%')
            .padding({ left: 12, right: 12, top: 12, bottom: 12 })
            .backgroundColor(COLORS.cardGlass)
            .borderRadius(RADIUS.lg)
            .border({ width: 0.5, color: COLORS.outlineVariant })

            // 命中 limit 时明示截断。按年查看整年很容易超过 500 条 ——
            // 不说的话用户会以为「今年就这么多流水」，而顶部棕卡的合计
            // （服务端 SUM，不受 limit 影响）又对不上列表，反而更困惑。
            if (this.truncated()) {
              Text(`仅显示最近 ${TX_LIMIT} 笔，切到「按月查看」可看全部`)
                .fontSize(12).fontColor(COLORS.textSecondary)
                .width('100%').textAlign(TextAlign.Center)
                .padding({ top: 14, bottom: 2 })
            }

            Blank().height(16)
          }.padding({ left: 12, right: 12, top: 4, bottom: LAYOUT.bottomNavSafe })
        }.layoutWeight(1).width('100%')
      }
    }.width('100%').height('100%')
  }

  calCells(): CalCell[] {
    const parts = this.month.split('-');
    return buildMonthCells(Number(parts[0]), Number(parts[1]), this.calDays, this.selectedDate, this.todayDate);
  }

  /**
   * 流水行点击分发。
   *
   * 改：与移动端约定一致 —— 转账行点击直接进入「编辑转账」全屏页（route 到 AddTransaction
   * 走 PUT /transfers/:id 全量替换），不再走中间操作弹窗。
   * 之前用 TransferActionSheet + TransferEditSheet 中转：操作选项弹一次 + 表单再弹一次，
   * 要点两下，且与安卓/收入/支出的「点一下直达编辑」路径不一致。
   *
   * ⚠️ 转账编辑必须走 PUT /transfers/:id 而非 PUT /transactions/:id：
   * 列表已在服务端 SQL 层把转账的两条腿折叠成一条展示，这条记录的 it.id 只是其中一条腿
   * （transfer_out）的 id。拿它去 PUT /transactions/:id 只会动一条腿：金额从 100 改成
   * 200 时转出账户扣了 200 而转入账户还是加 100，两个账户余额从此对不上。AddTransaction
   * 的 transfer 分支内部调用 Api.updateTransfer()，服务端先删 transfer_id 全部腿再重建。
   *
   * 删除则两条路都安全 —— DELETE /transactions/:id 已按 transfer_id 级联删掉所有腿
   * 和 transfers 主记录（transactions.js:491-501）。这里仍走 DELETE /transfers/:id，
   * 只是语义更直白：用户删的是「一笔转账」。
   *
   * 判据用 it.transfer 而不是 it.type === 'transfer_out'：
   * transfer 字段要求 transfer_id + 双端账户名三者齐全才由服务端构造，账户被删导致
   * JOIN 不到名字时它是 null，此时退回普通路径（至少能删掉）。
   */
  async openRow(it: TransactionItem): Promise<void> {
    if (it.transfer) { this.editTransferViaPage(it); return; }
    const data = await promptAction.showDialog({
      title: '交易操作',
      // 多币种 P2-3c：操作弹窗显示带币种金额（it.currency 由后端列表 SELECT 透出）
      message: `${it.category?.name ?? ''} ${fmtMoney(it.amount, it.currency)}`,
      buttons: [
        { text: '复制', color: COLORS.brand },
        { text: '编辑', color: COLORS.brand },
        { text: '删除', color: COLORS.danger }
      ]
    });
    if (data.index === 0) { this.copyTx(it); }
    else if (data.index === 1) { router.pushUrl({ url: 'pages/AddTransaction', params: { editId: it.id, month: this.month } }); }
    else if (data.index === 2) { Api.deleteTransaction(it.id).then(() => this.load()); }
  }

  /**
   * 复制交易：以原交易同账户/分类/类型/金额/备注生成一条【新】记录，
   * 日期取今天，去掉 link_type/link_id（避免利息关联交易再挂一次）。
   * 转账不支持复制（两条腿需走 /transfers，调用前已拦截）。
   */
  async copyTx(it: TransactionItem): Promise<void> {
    try {
      await Api.createTransaction({
        account_id: it.account?.id ?? 0,
        category_id: it.category?.id ?? 0,
        type: it.type,
        amount: it.amount,
        note: it.note ?? '',
        date: this.todayDate
      });
      toast('已复制为新交易');
      this.load();
    } catch (e) {
      toastLong('复制失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  /**
   * 跳转到 AddTransaction 编辑转账：把折叠行的当前值（id、转出/转入/金额/日期/备注）
   * 作为 params 传入，目标页的 transfer 分支会拉账户列表回填名称并展示。
   * 删改都在目标页完成，删成功回返后由 onPageShow 触发 reload（与编辑支出回返行为一致）。
   */
  editTransferViaPage(it: TransactionItem): void {
    const t = it.transfer;
    if (!t) return;
    const tDate = (it.date || '').slice(0, 10);
    const tAmount = String(Math.abs(it.amount));
    const fromId = t.from?.id ?? 0;
    const toId = t.to?.id ?? 0;
    router.pushUrl({
      url: 'pages/AddTransaction',
      params: {
        editTransferId: t.id,
        fromId: fromId,
        toId: toId,
        amount: tAmount,
        date: tDate,
        note: it.note || ''
      }
    });
  }



  @Builder CalendarView() {
    Scroll() {
      Column({ space: 0 }) {
        // 日历网格独立成卡（安卓端是一张 16dp 圆角白卡 + 2dp 投影）。
        // 原先网格是裸的、直接铺在页面背景上，星期表头和格子之间没有边界，
        // 读起来像「一堆按钮」而不是「一张月历」。
        Column({ space: 4 }) {
          Row() {
            ForEach(['一', '二', '三', '四', '五', '六', '日'], (w: string) => {
              Text(w).fontSize(12).fontColor(COLORS.textSecondary)
                .textAlign(TextAlign.Center).layoutWeight(1)
            })
          }.width('100%').padding({ top: 4, bottom: 4 })

          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.calCells(), (c: CalCell) => {
              SharedCalendarCell({
                cell: c,
                isSelected: c.kind === 'CURRENT' && c.date === this.selectedDate,
                isToday: c.kind === 'CURRENT' && c.date === this.todayDate,
                // 再点已选中的日期＝取消选择，回到全月列表。
                // 否则选了某天就再也回不到全月视图，只能切 tab 绕一圈。
                onTap: () => {
                  if (c.date) {
                    this.selectedDate = (this.selectedDate === c.date) ? '' : c.date;
                  }
                }
              }).width(`${100 / 7}%`)
            }, (c: CalCell) => calCellKey(c))
          }
        }
        .width('100%')
        .padding(12)
        .backgroundColor(COLORS.cardGlass)
        .borderRadius(RADIUS.lg)
        .border({ width: 0.5, color: COLORS.outlineVariant })
        .shadow({ radius: 8, color: COLORS.shadowAmbient, offsetY: 2 })

        // 选中某天 → 只列当天流水 + 当天收/支/结余汇总行（对齐安卓）。
        // 原实现点格子只换高亮、下方始终是全月流水 —— 点击没有任何可见结果，
        // 用户会以为日历是不能点的装饰。
        if (this.selectedDate !== '') {
          // ⚠️ 一行四项的宽度账（360vp 屏，可用宽 328vp）：
          // 原实现 `2026-08-28` + 收/支/结余 三项 fmtMoney 需 365vp，超 37vp。
          // 而 layoutWeight(1) 挂在日期上 —— 它成了唯一被压缩的元素，
          // 被压到 46vp 后 10 字符断成「2026-08-2 / 8」。
          //
          // 三处同时改，少一处仍会溢出：
          //  1. 日期去掉 layoutWeight、改 fmtDayLabel（83→53vp，年份在月份导航里已有）
          //  2. 金额用 fmtMoneyShort（¥19,023.00 → ¥1.90万，仅 ≥1万 时缩写）
          //  3. Blank() 顶开代替 layoutWeight，右侧三项按内容取宽、绝不被挤
          // 再加 maxLines(1) 兜底：极端字号放大下宁可省略号也不换行。
          Row() {
            Text(fmtDayLabel(this.selectedDate))
              .fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(COLORS.textPrimary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Blank()
            // 多币种 P2-3c：日历视图选中日的收/支/结余。单币种账本走 dayIncomeShort/dayExpenseShort；
            // 混币种账本直接用 fmtMoneyMix 智能混显（breakdown 取代累加）。
            // @Builder 内不写 const / 不写 IIFE，一律走上面的 dayIncomeLabel / dayExpenseLabel。
            Text('收 ' + this.dayIncomeLabel(this.selectedRows()))
              .fontSize(12).fontColor(COLORS.income).maxLines(1)
            Text('支 ' + this.dayExpenseLabel(this.selectedRows()))
              .fontSize(12).fontColor(COLORS.expense).margin({ left: 10 }).maxLines(1)
            Text('结余 ' + this.dayBalanceLabel())
              .fontSize(12)
              .fontColor(this.dayBalanceSign() >= 0 ? COLORS.income : COLORS.expense)
              .margin({ left: 10 })
              .maxLines(1)
          }
          .width('100%')
          .padding({ left: 4, right: 4, top: 14, bottom: 8 })
          .alignItems(VerticalAlign.Center)

          if (this.selectedRows().length === 0) {
            Text(this.selectedDate + ' 暂无记录')
              .fontSize(13).fontColor(COLORS.textSecondary)
              .width('100%').textAlign(TextAlign.Center)
              .padding({ top: 24, bottom: 24 })
          } else {
            Column({ space: 0 }) {
              ForEach(this.selectedRows(), (it: TransactionItem, i: number) => {
                TransactionRow({ item: it, onItemClick: () => this.openRow(it) })
                if (i < this.selectedRows().length - 1) {
                  Divider().color(COLORS.divider).strokeWidth(0.5)
                    .margin({ left: 52 })
                }
              }, (it: TransactionItem) => 'cal-' + it.id.toString())
            }
            .width('100%')
            .backgroundColor(COLORS.cardGlass)
            .borderRadius(RADIUS.lg)
            .border({ width: 0.5, color: COLORS.outlineVariant })
            .clip(true)
          }
        } else {
          // 未选中任何日期：提示可点，而不是默默列出全月
          Text('点击日期查看当天账单')
            .fontSize(13).fontColor(COLORS.textSecondary)
            .width('100%').textAlign(TextAlign.Center)
            .padding({ top: 28, bottom: 28 })
        }

        Blank().height(LAYOUT.bottomNavSafe)
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 8 })
    }
    .layoutWeight(1).width('100%')
    .scrollBar(BarState.Off)
  }

  /** 选中日期当天的流水（按时间倒序，对齐安卓 sortedByDescending） */
  selectedRows(): TransactionItem[] {
    if (this.selectedDate === '') return [];
    return this.items
      // 与 groups() 保持同一种切法：带 || '' 空值保护，
      // date 为 null 时 substring 会抛异常整页白屏
      .filter((it: TransactionItem) => (it.date || '').slice(0, 10) === this.selectedDate)
      .sort((a: TransactionItem, b: TransactionItem) => b.date.localeCompare(a.date));
  }

  /**
   * 多币种 P2-3c：结余 breakdown。混币种账本下逐币种相减（CNY 结余 = CNY 收 - CNY 支）。
   * 不再做跨币种累加 —— 那是错的。
   */
  dayBalanceBreakdown(): Record<string, number> {
    const rows = this.selectedRows();
    const incB = this.dayIncomeBreakdown(rows);
    const expB = this.dayExpenseBreakdown(rows);
    const out: Record<string, number> = {};
    const keys = new Set<string>([...Object.keys(incB), ...Object.keys(expB)]);
    keys.forEach(k => { out[k] = (incB[k] ?? 0) - (expB[k] ?? 0); });
    return out;
  }

  /**
   * 结余符号：取绝对值最大币种的符号当整行的正负号。
   * 多币种账本下「结余」整体的正负号无定义（不同币种符号可能相反），
   * 用主币种绝对值最大者的符号更接近用户的视觉直觉。
   */
  dayBalanceSign(): number {
    const b = this.dayBalanceBreakdown();
    const keys = Object.keys(b);
    if (keys.length === 0) return 0;
    let bestKey = keys[0];
    let bestAbs = Math.abs(b[bestKey]);
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      const a = Math.abs(b[k]);
      if (a > bestAbs) { bestAbs = a; bestKey = k; }
    }
    return b[bestKey] >= 0 ? 1 : -1;
  }

  /**
   * 结余带正号：+¥12.00 / -¥25.47 / +¥1.90万，单币种账本用 fmtMoneyShort 紧凑化；
   * 混币种账本走 fmtMoneyMix 智能混显。
   * 这一项在汇总行里最长（多「结余」两字 + 正负号），必须和同行的收/支用同一种格式 ——
   * 一行里混用 ¥1.90万 和 ¥17,226.00 两种精度会显得是两类数据。
   */
  dayBalanceLabel(): string {
    const b = this.dayBalanceBreakdown();
    const sign = this.dayBalanceSign() >= 0 ? '+' : '';
    if (isSingleCurrency(b)) {
      const keys = Object.keys(b);
      const cur = keys.length > 0 ? keys[0] : 'CNY';
      return sign + fmtMoneyShort(b[cur] ?? 0, cur);
    }
    return sign + fmtMoneyMix(b);
  }

  build() {
    // Stack 而非纯 Column：账本切换弹窗要浮在整页之上。
    // 背景由 Main 的 AppBackground 统一提供，这里不再铺一层。
    Stack() {
      Column() {
        // 账本头（与首页同一个组件、同一套交互）
        BookHeader({
          bookName: this.bookName,
          onSwapBook: () => { this.showBookSheet = true; },
          onSearch: () => router.pushUrl({ url: 'pages/Search' })
        })
        this.ToolBar()
        if (this.loading) { LoadingBox() }
        else if (this.viewMode === 'list') { this.ListView() }
        else { this.CalendarView() }
      }.width('100%').height('100%')

      BookSwitcherSheet({
        show: this.showBookSheet,
        books: this.books,
        currentId: this.currentBookId,
        onDismiss: () => { this.showBookSheet = false; },
        onSelect: (id: number) => {
          Api.switchBook(id).then(() => {
            const b = this.books.find(x => x.id === id);
            this.currentBookId = id;
            this.bookName = b ? b.name : this.bookName;
            this.showBookSheet = false;
            // 切账本后当前月的流水/概览/日历全变了，必须重拉
            this.load();
          });
        },
        onCreate: (name: string) => {
          Api.createBook({ name }).then(() => { this.loadBooks(); });
        }
      })

      // 周期选择弹层：取代原来的系统日期滚轮（DatePickerDialog）。
      // 放在 BookSwitcherSheet 之后 = 层级更高，两个弹层不会互相压住。
      PeriodPickerSheet({
        show: this.showPeriodSheet,
        initialPeriod: this.month,
        initialMode: this.periodMode,
        // 日历视图不给「按年查看」：月历网格没有整年形态
        allowYear: this.viewMode !== 'calendar',
        minYear: this.minYear,
        onDismiss: () => { this.showPeriodSheet = false; },
        onConfirm: (period: string, mode: string) => { this.applyPeriod(period, mode); }
      })

      // 转账编辑已迁到 AddTransaction 路由页（点击直接跳页），删除走 AddTransaction 内的删除按钮。
    }.width('100%').height('100%')
  }
}

// 注：原 @Entry struct Transactions 包装已删除（对应 main_pages.json 的死路由）。
// TransactionsPage 是 Main 的 tab 内容，pushUrl 过去会丢底部导航栏。
// 如需带月份参数进入账单 tab，请用 @StorageLink('mainTabIndex') 切 tab，
// 月份通过 AppStorage 传递，而不是 router.pushUrl。
// 详见 docs/harmony-style-guide.md 第 11 节。
