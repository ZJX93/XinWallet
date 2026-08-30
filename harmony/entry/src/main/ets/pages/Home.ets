/**
 * 首页 Home（对齐安卓 HomeScreen.kt）
 *
 * 结构：账本切换头 + 暖棕渐变月支出卡 + N 张按需功能卡片。
 * 功能卡片走「注册表驱动」：卡片元数据集中在 common/store/HomeCards.ts，
 * 用户在编辑弹层里开关与调序，结果落 preferences，重启保留。
 * 新增一张卡片 = 注册表加一条 + 这里加一个 @Builder + renderCard 加一个分支。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney, fmtMoneyShort, SPACING, RADIUS, FONT_SIZE, LAYOUT } from '../common/theme';
import {
  TransactionItem, Dashboard, CalendarSummary, CalendarDay, Book, BooksResponse,
  Budget, Goal, Account, AccountsResponse, CategoryStat, TxRef
} from '../common/models';
import {
  TransactionRow, HeroGradientCard, BookHeader, BookSwitcherSheet, IconCircle,
  Card, BottomSheet, SheetHeader, CardHeader, RankBarRow, LinearProgress
} from '../common/components/Components';
import { SharedCalendarCell, buildMonthCells, CalCell, calCellKey } from '../common/components/CalendarCell';
import { Session } from '../common/store/Session';
import {
  CARD_REGISTRY, HomeCardMeta, CardVisibleMap,
  loadOrder, saveOrder, loadVisibility, moveCard, metaOf
} from '../common/store/HomeCards';

function ym(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function todayStr(): string { const d = new Date(); return `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`; }
function dayNum(s: string): string {
  if (!s) return '';
  const parts = s.split(/[- T:]/);
  return parts.length >= 3 ? parts[2] : '';
}
function weekdayOf(s: string): number {
  const d = new Date(s.replace(/-/g, '/'));
  let w = d.getDay() - 1; if (w < 0) w = 6; return w;
}

interface DashMonth { income?: number; expense?: number; balance?: number; }
interface DashData { month?: DashMonth; income?: number; expense?: number; balance?: number; }

@Component

export struct HomePage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State month: string = ym(new Date());
  @State dash: Dashboard | null = null;
  @State today: TransactionItem[] = [];
  @State cal: CalendarSummary | null = null;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State books: Book[] = [];
  @State currentBookId: number = 0;
  @State bookName: string = '默认账本';
  @State showBookSheet: boolean = false;
  /** 卡片配置弹层是否展示 */
  @State showEditSheet: boolean = false;
  /** 底部 tab 索引：卡片「查看全部」跳统计页时改这个，而不是 pushUrl（否则丢底部导航栏） */
  @StorageLink('mainTabIndex') mainTabIndex: number = 0;
  @State monthExpenseVal: number = 0;
  @State monthIncomeVal: number = 0;
  @State selectedDate: string = '';

  /** 卡片可见性（key -> bool），来源 preferences */
  @State cardVisible: CardVisibleMap = {};
  /** 卡片排列顺序（key 数组），来源 preferences */
  @State cardOrder: string[] = [];

  /* ---- 扩展卡片的数据源（仅在对应卡片开启时才请求） ---- */
  @State budgets: Budget[] = [];
  @State goals: Goal[] = [];
  @State accounts: Account[] = [];
  @State totalAssets: number = 0;
  @State catStats: CategoryStat[] = [];

  todayDate: string = todayStr();
  /** 本月全量交易缓存：分类榜在本地聚合，避免额外请求 */
  private monthTxns: TransactionItem[] = [];

  aboutToAppear(): void {
    this.bootstrap();
  }

  /** 先读卡片配置，再按配置决定要拉哪些数据（关掉的卡片不产生请求） */
  async bootstrap(): Promise<void> {
    await this.loadCardPrefs();
    await this.load();
  }

  /** 读取首页卡片开关与顺序（重启后保留用户选择） */
  async loadCardPrefs(): Promise<void> {
    try {
      const vis = await loadVisibility();
      const ord = await loadOrder();
      this.cardVisible = vis;
      this.cardOrder = ord;
    } catch (e) {
      // 读取失败时退回注册表默认值，保证首页仍可用
      const fallback: CardVisibleMap = {};
      CARD_REGISTRY.forEach((c: HomeCardMeta) => { fallback[c.key] = c.defaultOn; });
      this.cardVisible = fallback;
      this.cardOrder = CARD_REGISTRY.map((c: HomeCardMeta) => c.key);
    }
  }

  private isOn(key: string): boolean {
    return this.cardVisible[key] === true;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      await this.loadBooks();
      const _r = await Promise.all([
        Api.getDashboard(),
        // ⚠️ 必须用 this.month 而不是 new Date()：日历卡有上/下月导航，
        // changeMonth 改的是 this.month。若这里写死当月，翻到 7 月时网格按
        // 7 月铺格（calCells 用 this.month），金额却还是 8 月的 —— 数字会
        // 落在错误的日期上，比不显示更糟。
        Api.getStatsCalendar(Number(this.month.split('-')[0]), Number(this.month.split('-')[1])),
        Api.getTransactions({ month: this.month, limit: 300 })
      ]);
      const d = _r[0];
      const c = _r[1];
      const t = _r[2];
      if (d.success) {
        this.dash = d.data;
        const dd = d.data as DashData;
        this.monthExpenseVal = (dd.month?.expense ?? dd.expense ?? 0) as number;
        this.monthIncomeVal = (dd.month?.income ?? dd.income ?? 0) as number;
      }
      if (c.success) this.cal = c.data;
      if (t.success) {
        const all = t.data || [];
        this.monthTxns = all;
        const td = todayStr();
        this.today = all.filter(x => (x.date || '').startsWith(td));
        if (this.isOn('card_category')) this.buildCategoryStats();
      }
      await this.loadExtraCards();
    } catch (e) { console.error('Home load:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  /** 按需加载扩展卡片数据：关掉的卡片不发请求，省流量也省首屏时间 */
  async loadExtraCards(): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.isOn('card_budget')) tasks.push(this.loadBudgets());
    if (this.isOn('card_goals')) tasks.push(this.loadGoals());
    if (this.isOn('card_assets')) tasks.push(this.loadAccounts());
    if (tasks.length > 0) await Promise.all(tasks);
  }

  async loadBudgets(): Promise<void> {
    try {
      const r = await Api.getBudgets();
      if (r.success) this.budgets = (r.data as Budget[]) || [];
    } catch (e) { /* 卡片级失败不影响首页其余部分 */ }
  }

  async loadGoals(): Promise<void> {
    try {
      const r = await Api.getSavingsGoals();
      if (r.success) this.goals = (r.data as Goal[]) || [];
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  async loadAccounts(): Promise<void> {
    try {
      const r = await Api.getAccounts();
      if (r.success && r.data) {
        const d = r.data as AccountsResponse;
        const list = (d.accounts || []).filter((a: Account) => a.status !== 'closed');
        // 余额降序，首页只露前 3 个大头
        this.accounts = list.sort((a: Account, b: Account) => (b.balance ?? 0) - (a.balance ?? 0));
        this.totalAssets = d.totalAssets ?? this.accounts.reduce(
          (s: number, a: Account) => s + (a.balance ?? 0), 0);
      }
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  /** 本月支出按分类聚合，取金额前 5（纯本地计算，复用已拉取的 monthTxns） */
  buildCategoryStats(): void {
    const nameMap = new Map<string, number>();
    const iconMap = new Map<string, string>();
    this.monthTxns.forEach((t: TransactionItem) => {
      if (t.type !== 'expense') return;
      const c: TxRef | undefined = t.category;
      const key = c && c.name ? c.name : '未分类';
      nameMap.set(key, (nameMap.get(key) ?? 0) + (t.amount ?? 0));
      if (c && c.icon && !iconMap.has(key)) iconMap.set(key, c.icon);
    });
    const arr: CategoryStat[] = [];
    nameMap.forEach((amount: number, name: string) => {
      arr.push({ name: name, icon: iconMap.get(name) ?? '📦', amount: amount, ratio: 0 });
    });
    arr.sort((a: CategoryStat, b: CategoryStat) => b.amount - a.amount);
    const top = arr.slice(0, 5);
    // ratio 相对榜首（条宽表达相对关系），percent 相对总支出（文案表达占比）
    const max = top.length > 0 ? top[0].amount : 0;
    top.forEach((s: CategoryStat) => { s.ratio = max > 0 ? s.amount / max : 0; });
    this.catStats = top;
  }

  private totalExpenseOfStats(): number {
    return this.catStats.reduce((s: number, c: CategoryStat) => s + c.amount, 0);
  }

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
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  changeMonth(delta: number): void {
    const _parts = this.month.split('-').map(Number);
    const y = _parts[0];
    const m = _parts[1];
    let ny = y, nm = m + delta;
    if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; }
    this.month = `${ny}-${String(nm).padStart(2, '0')}`;
    this.load();
  }

  /* ============================ 卡片配置弹层 ============================ */

  /** 切换某张卡片显隐：立即落盘，并在打开时补拉该卡数据 */
  async toggleCard(key: string, v: boolean): Promise<void> {
    const next: CardVisibleMap = {};
    Object.keys(this.cardVisible).forEach((k: string) => { next[k] = this.cardVisible[k]; });
    next[key] = v;
    this.cardVisible = next;
    await Session.setCardVisible(key, v);
    if (v) {
      // 刚打开的卡片此前没拉过数据，这里补一次，避免出现空卡
      if (key === 'card_budget') await this.loadBudgets();
      else if (key === 'card_goals') await this.loadGoals();
      else if (key === 'card_assets') await this.loadAccounts();
      else if (key === 'card_category') this.buildCategoryStats();
    }
  }

  /** 卡片上移/下移一格并落盘 */
  async shiftCard(key: string, delta: number): Promise<void> {
    const next = moveCard(this.cardOrder, key, delta);
    this.cardOrder = next;
    await saveOrder(next);
  }

  @Builder EditSheetContent() {
    Column({ space: 0 }) {
      SheetHeader({
        title: '编辑首页卡片',
        subtitle: '开关卡片，或用箭头调整先后顺序',
        onClose: () => { this.showEditSheet = false; }
      })
      Scroll() {
        Column({ space: 0 }) {
          ForEach(this.cardOrder, (key: string, index: number) => {
            this.CardToggleRow(key, index)
          }, (key: string) => key)
        }
      }.layoutWeight(1).align(Alignment.Top)
      Button('完成')
        .width('100%').height(46)
        .backgroundColor(COLORS.brand).fontColor(COLORS.onPrimary)
        .borderRadius(RADIUS.md)
        .margin({ top: SPACING.sm })
        .onClick(() => { this.showEditSheet = false; })
    }
    .width('100%')
  }

  /** 卡片配置行：图标圆 + 标题/副文案 + 调序箭头 + 开关 */
  @Builder CardToggleRow(key: string, index: number) {
    Row({ space: SPACING.sm }) {
      IconCircle({
        icon: metaOf(key)?.icon ?? '🗂',
        boxSize: 38, iconSize: 18, bg: COLORS.brandBgLight
      })
      Column({ space: 2 }) {
        Text(metaOf(key)?.title ?? key)
          .fontSize(FONT_SIZE.body).fontWeight(FontWeight.Medium)
          .fontColor(COLORS.textPrimary)
        Text(metaOf(key)?.subtitle ?? '')
          .fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)

      // 调序：首/尾项对应箭头置灰不可点
      Row({ space: 2 }) {
        this.OrderArrow('↑', index > 0, () => { this.shiftCard(key, -1); })
        this.OrderArrow('↓', index < this.cardOrder.length - 1, () => { this.shiftCard(key, 1); })
      }

      Toggle({ type: ToggleType.Switch, isOn: this.isOn(key) })
        .selectedColor(COLORS.brand)
        .onChange((v: boolean) => { this.toggleCard(key, v); })
    }
    .width('100%')
    .padding({ top: SPACING.sm, bottom: SPACING.sm })
    .alignItems(VerticalAlign.Center)
    .border({
      width: { top: index === 0 ? 0 : 0.5, bottom: 0, left: 0, right: 0 },
      color: COLORS.outlineVariant
    })
  }

  /** 调序小箭头（不可用时置灰且不响应点击） */
  @Builder OrderArrow(label: string, enabled: boolean, onTap: () => void) {
    Text(label)
      .fontSize(15)
      .fontColor(enabled ? COLORS.brand : COLORS.placeholder)
      .width(26).height(26).textAlign(TextAlign.Center)
      .backgroundColor(enabled ? COLORS.brandBgLight : COLORS.surfaceVariant)
      .borderRadius(13)
      .onClick(() => { if (enabled) { onTap(); } })
  }

  monthExpense(): number {
    return this.monthExpenseVal;
  }
  monthIncome(): number {
    return this.monthIncomeVal;
  }

  /* ============================ 各功能卡片 ============================ */

  @Builder MonthSummaryCard() {
    HeroGradientCard({
      topLeft: '本月支出',
      amount: fmtMoney(this.monthExpenseVal),
      topRight: this.monthRangeLabel(),
      topRightPill: true,
      bottomLeft: '本月收入 ' + fmtMoney(this.monthIncomeVal),
      bottomRight: '日均支出 ' + fmtMoney(this.monthExpenseVal / this.daysInCurMonth())
    })
  }

  // 下面两个写成普通方法而不是 get 访问器：ArkTS 在 @Component struct 里
  // 对 getter 的状态依赖收集不可靠 —— @Builder 内经过 getter 访问 @State 时，
  // 依赖路径会丢，month 变化后可能不重渲染。项目其余地方（sumCal / budgetUsed）
  // 也都是普通方法，保持一致。

  /** 右上角区间标签：「8月1日-8月31日」比「2026-08」好读（对齐安卓端） */
  monthRangeLabel(): string {
    const parts = this.month.split('-');
    const m = Number(parts[1]);
    return `${m}月1日-${m}月${this.daysInCurMonth()}日`;
  }

  /** 当月实际天数 —— 原先日均固定除以 30，2 月会算少、大月会算多 */
  daysInCurMonth(): number {
    const parts = this.month.split('-');
    return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
  }

  /** ① 今日流水 —— 单个总卡片，内部用行内分隔线而非每行独立卡 */
  @Builder TodayBillsCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: 0 }) {
        // 标题行：左标题 + 右收支金额（对齐安卓端，金额比笔数有用）。
        // 金额用 fmtMoneyShort：可用宽仅 304vp（页面 12×2 + 卡片 16×2），
        // fmtMoney 下「今日账单 + 收入¥19,023.00 + 支出¥1,797.00」已占 282vp，
        // 余量 22vp —— 一个 ¥123,456.00 的大额日就会把某一项挤到换行。
        // maxLines(1) 兜底：系统字号放大时宁可省略号也不换行。
        Row() {
          Text('今日账单')
            .fontSize(FONT_SIZE.title - 4).fontWeight(FontWeight.Bold)
            .fontColor(COLORS.textPrimary)
            .maxLines(1)
          Blank()
          Row({ space: 8 }) {
            Row({ space: 4 }) {
              Text('收入').fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
              Text(fmtMoneyShort(this.todayInc()))
                .fontSize(FONT_SIZE.label).fontWeight(FontWeight.Medium)
                .fontColor(COLORS.income).maxLines(1)
            }
            Row({ space: 4 }) {
              Text('支出').fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
              Text(fmtMoneyShort(this.todayExp()))
                .fontSize(FONT_SIZE.label).fontWeight(FontWeight.Medium)
                .fontColor(COLORS.expense).maxLines(1)
            }
          }
        }.width('100%').alignItems(VerticalAlign.Center)

        if (this.today.length === 0) {
          this.CardEmpty('🪴', '今日还没有记账', '点点底部 + 记一笔吧～')
        } else {
          Column({ space: 0 }) {
            ForEach(this.today, (it: TransactionItem, index: number) => {
              TransactionRow({
                item: it,
                compact: true,
                showTopDivider: index !== 0,
                onItemClick: () => router.pushUrl({ url: 'pages/AddTransaction', params: { editId: it.id } })
              })
            }, (it: TransactionItem) => it.id.toString())
          }.padding({ top: SPACING.sm })
        }
      }.alignItems(HorizontalAlign.Start)
    }
  }

  /** ② 账单日历 */
  @Builder CalendarCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: SPACING.md }) {
        // 标题行：‹ 圆按钮 + 年月胶囊居中 + › 圆按钮。
        // 原先是「图标圆 + 年月左对齐 + 两个箭头挤在右边」，读起来像工具栏而不像
        // 日历标题 —— 上/下月是一对对称操作，把它们分列两端、年月居中，
        // 才能一眼看出「这里可以左右翻」（对齐安卓端）。
        Row() {
          this.MonthNavBtn('‹', () => { this.changeMonth(-1); })
          // 标题读 this.month（唯一真源），不读 this.cal —— cal 是异步返回的，
          // 翻月后新数据到位前 cal 还是上个月的，标题会先显示旧月份再跳，
          // 而网格已经按新月份铺好了，两者短暂矛盾。
          Text(this.calTitle())
            .fontSize(FONT_SIZE.body).fontWeight(FontWeight.Medium)
            .fontColor(COLORS.brand)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .padding({ top: 7, bottom: 7 })
            .margin({ left: SPACING.sm, right: SPACING.sm })
            .backgroundColor(COLORS.brandBgLight)
            .borderRadius(RADIUS.pill)
          this.MonthNavBtn('›', () => { this.changeMonth(1); })
        }.width('100%').alignItems(VerticalAlign.Center)

        // 周标题行
        Row() {
          ForEach(['一', '二', '三', '四', '五', '六', '日'], (w: string) => {
            Text(w).fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
              .fontWeight(FontWeight.Medium)
              .textAlign(TextAlign.Center).layoutWeight(1)
          })
        }.width('100%')

        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.calCells(), (c: CalCell) => {
            SharedCalendarCell({
              cell: c,
              isSelected: c.kind === 'CURRENT' && c.date === this.selectedDate,
              isToday: c.kind === 'CURRENT' && c.date === this.todayDate,
              onTap: () => { if (c.date) { this.selectedDate = c.date; } }
            }).width(`${100 / 7}%`)
          }, (c: CalCell) => calCellKey(c))
        }

        // 当月收支汇总：细字、不带底（汇总信息是辅助信息，
        // 不该用胶囊底抢格子的视觉权重——格子才是日历的主体）
        Row({ space: SPACING.xl }) {
          Row({ space: 4 }) {
            Text('收').fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
            Text(fmtMoney(this.sumCal('income'))).fontSize(FONT_SIZE.caption)
              .fontWeight(FontWeight.Medium).fontColor(COLORS.income)
          }
          Row({ space: 4 }) {
            Text('支').fontSize(FONT_SIZE.caption).fontColor(COLORS.textSecondary)
            Text(fmtMoney(this.sumCal('expense'))).fontSize(FONT_SIZE.caption)
              .fontWeight(FontWeight.Medium).fontColor(COLORS.expense)
          }
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
      }.alignItems(HorizontalAlign.Start)
    }
  }

  /** ③ 预算进度 —— 每条一个进度条，超支变红并标「超支 ¥x」 */
  @Builder BudgetCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: 0 }) {
        CardHeader({
          icon: '🎯',
          title: '预算进度',
          onMore: () => { router.pushUrl({ url: 'pages/Budgets' }); }
        })
        if (this.budgets.length === 0) {
          this.CardEmpty('🎯', '还没有设置预算', '设个月度预算，花钱更有数')
        } else {
          Column({ space: 0 }) {
            ForEach(this.budgets.slice(0, 4), (b: Budget, index: number) => {
              this.BudgetRow(b, index !== 0)
            }, (b: Budget) => b.id.toString())
          }.padding({ top: SPACING.sm })
        }
      }.alignItems(HorizontalAlign.Start)
    }
  }

  @Builder BudgetRow(b: Budget, showDivider: boolean) {
    Column({ space: 6 }) {
      Row({ space: SPACING.sm }) {
        Text(b.name)
          .fontSize(FONT_SIZE.body).fontColor(COLORS.textPrimary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(fmtMoney(this.budgetUsed(b)) + ' / ' + fmtMoney(b.amount))
          .fontSize(FONT_SIZE.label)
          .fontColor(this.budgetOver(b) ? COLORS.expense : COLORS.textSecondary)
      }.width('100%').alignItems(VerticalAlign.Center)

      LinearProgress({
        value: this.budgetRatio(b),
        color: this.budgetOver(b) ? COLORS.expense : COLORS.brand,
        barHeight: 6
      })

      if (this.budgetOver(b)) {
        Text('超支 ' + fmtMoney(this.budgetUsed(b) - b.amount))
          .fontSize(FONT_SIZE.caption).fontColor(COLORS.expense)
      }
    }
    .width('100%')
    .padding({ top: SPACING.sm, bottom: SPACING.sm })
    .alignItems(HorizontalAlign.Start)
    .border({
      width: { top: showDivider ? 0.5 : 0, bottom: 0, left: 0, right: 0 },
      color: COLORS.outlineVariant
    })
  }

  budgetUsed(b: Budget): number { return b.spent ?? b.used ?? 0; }
  budgetRatio(b: Budget): number {
    const amt = b.amount ?? 0;
    return amt > 0 ? this.budgetUsed(b) / amt : 0;
  }
  budgetOver(b: Budget): boolean { return this.budgetUsed(b) > (b.amount ?? 0); }

  /** ④ 分类支出榜 —— 本月支出 TOP5 横向条形 */
  @Builder CategoryRankCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: 0 }) {
        CardHeader({
          icon: '📊',
          title: '分类支出榜',
          // 统计是底部 tab 页，切 index 而非 pushUrl，保留底部导航栏
          onMore: () => { this.mainTabIndex = 2; }
        })
        if (this.catStats.length === 0) {
          this.CardEmpty('📊', '本月还没有支出', '记几笔账就能看到分布了')
        } else {
          Column({ space: 0 }) {
            ForEach(this.catStats, (c: CategoryStat, index: number) => {
              RankBarRow({
                icon: c.icon,
                name: c.name,
                amountText: fmtMoney(c.amount),
                ratio: c.ratio,
                percentText: this.catPercent(c),
                barColor: this.rankColor(index)
              })
            }, (c: CategoryStat) => c.name)
          }.padding({ top: SPACING.xs })
        }
      }.alignItems(HorizontalAlign.Start)
    }
  }

  catPercent(c: CategoryStat): string {
    const total = this.totalExpenseOfStats();
    if (total <= 0) return '';
    return Math.round((c.amount / total) * 100) + '%';
  }

  /**
   * 榜单条形色：品牌棕同色系由深到浅递进。
   * 不用 accent1（#6366F1 紫蓝）——与暖棕主色系冲突，视觉上像两套设计拼在一起。
   * 同色系明度递进既能分出主次，又不破坏整体暖色调。
   */
  rankColor(index: number): string {
    if (index === 0) return COLORS.brand;         // #995F2C 深棕，榜首最重
    if (index === 1) return COLORS.brandLight;    // #D39562
    if (index === 2) return COLORS.brandLighter;  // #EBB890
    return COLORS.brandBg;                        // #F8D7BE 最浅，尾部轻
  }

  /** ⑤ 账户资产 —— 净资产合计 + 前 3 账户余额 */
  @Builder AssetsCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: 0 }) {
        CardHeader({
          icon: '💳',
          title: '账户资产',
          onMore: () => { router.pushUrl({ url: 'pages/Accounts' }); }
        })
        if (this.accounts.length === 0) {
          this.CardEmpty('💳', '还没有添加账户', '添加账户后可跟踪资产变化')
        } else {
          Column({ space: 0 }) {
            // 净资产强调条
            Row() {
              Text('净资产').fontSize(FONT_SIZE.label).fontColor(COLORS.textSecondary)
                .layoutWeight(1)
              Text(fmtMoney(this.totalAssets))
                .fontSize(FONT_SIZE.title - 2).fontWeight(FontWeight.Bold)
                .fontColor(COLORS.textPrimary)
            }
            .width('100%')
            .padding(SPACING.md)
            .backgroundColor(COLORS.surfaceVariant)
            .borderRadius(RADIUS.md)
            .margin({ top: SPACING.sm, bottom: SPACING.xs })
            .alignItems(VerticalAlign.Center)

            ForEach(this.accounts.slice(0, 3), (a: Account, index: number) => {
              this.AccountRow(a, index !== 0)
            }, (a: Account) => a.id.toString())
          }
        }
      }.alignItems(HorizontalAlign.Start)
    }
  }

  @Builder AccountRow(a: Account, showDivider: boolean) {
    Row({ space: SPACING.sm }) {
      Text(a.icon && a.icon.length > 0 ? a.icon : '🏦').fontSize(15)
      Text(a.name)
        .fontSize(FONT_SIZE.body).fontColor(COLORS.textPrimary)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text(fmtMoney(a.balance ?? 0))
        .fontSize(FONT_SIZE.body).fontWeight(FontWeight.Medium)
        // 负余额（如信用卡欠款）用支出色，一眼区分资产与负债
        .fontColor((a.balance ?? 0) < 0 ? COLORS.expense : COLORS.textPrimary)
    }
    .width('100%')
    .padding({ top: SPACING.md, bottom: SPACING.md })
    .alignItems(VerticalAlign.Center)
    .border({
      width: { top: showDivider ? 0.5 : 0, bottom: 0, left: 0, right: 0 },
      color: COLORS.outlineVariant
    })
    .onClick(() => { router.pushUrl({ url: 'pages/AccountDetail', params: { id: a.id } }); })
  }

  /** ⑥ 储蓄目标 —— 攒钱进度 */
  @Builder GoalsCard() {
    Card({ contentPadding: SPACING.lg }) {
      Column({ space: 0 }) {
        CardHeader({
          icon: '🏆',
          title: '储蓄目标',
          onMore: () => { router.pushUrl({ url: 'pages/SavingsGoals' }); }
        })
        if (this.goals.length === 0) {
          this.CardEmpty('🏆', '还没有储蓄目标', '定个目标，攒钱更有动力')
        } else {
          Column({ space: 0 }) {
            ForEach(this.goals.slice(0, 3), (g: Goal, index: number) => {
              this.GoalRow(g, index !== 0)
            }, (g: Goal) => g.id.toString())
          }.padding({ top: SPACING.sm })
        }
      }.alignItems(HorizontalAlign.Start)
    }
  }

  @Builder GoalRow(g: Goal, showDivider: boolean) {
    Column({ space: 6 }) {
      Row({ space: SPACING.sm }) {
        Text(g.icon && g.icon.length > 0 ? g.icon : '🎯').fontSize(15)
        Text(g.name)
          .fontSize(FONT_SIZE.body).fontColor(COLORS.textPrimary)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(fmtMoney(g.current ?? 0) + ' / ' + fmtMoney(g.target ?? 0))
          .fontSize(FONT_SIZE.label).fontColor(COLORS.textSecondary)
      }.width('100%').alignItems(VerticalAlign.Center)

      LinearProgress({
        value: this.goalRatio(g),
        // 用品牌棕而非 income 红：进度条里的红容易被读成"警告/超限"，
        // 而储蓄目标进度是正向信息，用品牌色更贴合语义
        color: COLORS.brand,
        barHeight: 6,
        showPercent: true
      })
    }
    .width('100%')
    .padding({ top: SPACING.sm, bottom: SPACING.sm })
    .alignItems(HorizontalAlign.Start)
    .border({
      width: { top: showDivider ? 0.5 : 0, bottom: 0, left: 0, right: 0 },
      color: COLORS.outlineVariant
    })
  }

  goalRatio(g: Goal): number {
    const t = g.target ?? 0;
    return t > 0 ? (g.current ?? 0) / t : 0;
  }

  /** 卡片内统一空态（图标 + 主文案 + 引导语），避免各卡空态样式不一 */
  @Builder CardEmpty(icon: string, title: string, hint: string) {
    Column({ space: SPACING.sm }) {
      Text(icon).fontSize(36)
      Text(title).fontSize(FONT_SIZE.body)
        .fontColor(COLORS.textPrimary).fontWeight(FontWeight.Medium)
      Text(hint).fontSize(FONT_SIZE.label).fontColor(COLORS.textSecondary)
    }
    .width('100%')
    .padding({ top: SPACING.lg, bottom: SPACING.lg })
    .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
  }

  /** 日历月份切换圆钮（浅底圆形，替代裸文字箭头） */
  @Builder MonthNavBtn(label: string, onTap: () => void) {
    Text(label)
      .fontSize(20).fontColor(COLORS.brand).fontWeight(FontWeight.Bold)
      .width(30).height(30).textAlign(TextAlign.Center)
      .backgroundColor(COLORS.brandBgLight)
      .borderRadius(15)
      .onClick(onTap)
  }

  /** 首页卡片配置入口（虚线描边占位卡，暗示"这里还能加卡片"） */
  @Builder EditCardsEntry() {
    Row({ space: SPACING.sm }) {
      Text('＋').fontSize(18).fontColor(COLORS.brand).fontWeight(FontWeight.Bold)
      Text('编辑首页卡片').fontSize(FONT_SIZE.body)
        .fontColor(COLORS.brand).fontWeight(FontWeight.Medium)
    }
    .width('100%').height(52)
    .justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
    .borderRadius(RADIUS.lg)
    .border({ width: 1, color: COLORS.brandBg, style: BorderStyle.Dashed })
    .backgroundColor(COLORS.brandBgLight)
    .onClick(() => { this.showEditSheet = true; })
  }

  /** 按 key 渲染对应卡片（注册表新增卡片时在此加分支） */
  @Builder renderCard(key: string) {
    if (key === 'card_today') {
      this.TodayBillsCard()
    } else if (key === 'card_calendar') {
      this.CalendarCard()
    } else if (key === 'card_budget') {
      this.BudgetCard()
    } else if (key === 'card_category') {
      this.CategoryRankCard()
    } else if (key === 'card_assets') {
      this.AssetsCard()
    } else if (key === 'card_goals') {
      this.GoalsCard()
    }
  }

  sumCal(t: string): number {
    let s = 0;
    (this.cal?.monthDays || []).forEach((d: CalendarDay) => { s += t === 'income' ? (d.income ?? 0) : (d.expense ?? 0); });
    return s;
  }

  /** 今日收入合计（今日账单卡标题右侧） */
  todayInc(): number {
    let s = 0;
    this.today.forEach((it: TransactionItem) => { if (it.type === 'income') s += it.amount; });
    return s;
  }

  /** 今日支出合计（今日账单卡标题右侧） */
  todayExp(): number {
    let s = 0;
    this.today.forEach((it: TransactionItem) => { if (it.type === 'expense') s += it.amount; });
    return s;
  }

  /**
   * 当前应渲染的卡片 key 列表（已按用户顺序排好、已剔除关闭的）。
   * 先过滤再交给 ForEach，而不是在 ForEach 内部写 if —— ArkTS 对
   * ForEach 里的条件渲染做 diff 时不可靠，开关切换后可能不刷新。
   */
  visibleCards(): string[] {
    return this.cardOrder.filter((k: string) => this.cardVisible[k] === true);
  }

  /** 日历卡标题：`2026年8月`。以 this.month 为准，避免与网格月份脱节 */
  calTitle(): string {
    const p = this.month.split('-');
    return `${p[0]}年${Number(p[1])}月`;
  }

  calCells(): CalCell[] {
    const days: ESObject[] = (this.cal && this.cal.monthDays) ? this.cal.monthDays as ESObject[] : [];
    const parts = this.month.split('-');
    return buildMonthCells(Number(parts[0]), Number(parts[1]), days, this.selectedDate, this.todayDate);
  }

  build() {
    Stack() {
      Column() {
        // 账本头（组件化，对齐安卓 BookHeader）
        BookHeader({
          bookName: this.bookName,
          onSwapBook: () => { this.showBookSheet = true; },
          onSearch: () => router.pushUrl({ url: 'pages/Search' })
        })

        Scroll() {
          Column({ space: 12 }) {
            this.MonthSummaryCard()
            // 功能卡片按用户配置的顺序渲染（visibleCards 已过滤掉关闭的）
            ForEach(this.visibleCards(), (key: string) => {
              this.renderCard(key)
            }, (key: string) => key)
            this.EditCardsEntry()
          }.padding({ left: 12, right: 12, top: 12, bottom: LAYOUT.bottomNavSafe })
        }.layoutWeight(1)
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
            this.load();
          });
        },
        onCreate: (name: string) => {
          Api.createBook({ name }).then(() => { this.loadBooks(); });
        }
      })
      if (this.showEditSheet) {
        BottomSheet({ show: this.showEditSheet, maxHeight: '75%', onDismiss: () => { this.showEditSheet = false; } }) {
          this.EditSheetContent()
        }
      }
    }.width('100%').height('100%')
  }
}
