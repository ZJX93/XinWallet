/**
 * 统计（对齐安卓 ReportsScreen.kt）。
 *
 * 结构（与安卓严格一致）：
 *   账本头（账本名 ⇄ / 🔍）
 *   [支出|收入|结余 分段]        ‹ 2026年8月 ›     ← 同一行，左右各占一半
 *   ─ 支出：4 KPI（金额/日均/预算/剩余预算）→ 支出趋势 → 分类排行 → 明细排行
 *   ─ 收入：2 KPI（金额/日均）        → 收入趋势 → 分类排行 → 明细排行
 *   ─ 结余：2 KPI（金额/日均）        → 结余趋势（累计曲线）
 *
 * 与安卓刻意不同的两处，见 kpis() 与 CategoryRankingCard 的注释。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtDayLabel, fmtMoney, fmtMoneyMix, fmtMoneyShort, LAYOUT, RADIUS, SPACING, TRANSPARENT } from '../common/theme';
import { Book, BooksResponse } from '../common/models';
import { DonutChart, DonutPiece, TrendChart } from '../common/components/Charts';
import {
  LoadingBox, EmptyState, CategoryBars, Card, CategoryIcon,
  BookHeader, BookSwitcherSheet
} from '../common/components/Components';
import { PeriodPickerSheet } from '../common/components/PeriodPickerSheet';

function ym(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

/**
 * 以「年+月」为单位平移并归一化为 'YYYY-MM'。
 * 用绝对月序（y*12 + m-1）做加减，避免手写 if (m<1) m+=12; y-- 这类跨年回绕，
 * 平移超过 12 个月时那种写法会算错（只回绕一次）。
 */
function shiftMonth(y: number, m: number, byMonths: number): string {
  const t = y * 12 + (m - 1) + byMonths;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}

interface RSummary { income?: number; expense?: number; balance?: number; savingsRate?: number; transactionCount?: number; avgDailyExpense?: number; currency?: string; incomeBreakdown?: Record<string, number>; expenseBreakdown?: Record<string, number>; }
/**
 * ⚠️ 服务端 SQL 是 `SELECT c.id, c.name, c.icon, c.parent_id, agg.total`——
 * 字段名是 **parent_id**（下划线），不是 parentId。原来这里写 `parentId?: number`
 * 恒为 undefined，任何基于父子层级的过滤都会静默失效（不报错、不崩，只是结果错）。
 * 安卓端靠 `@SerializedName("parent_id")` 做了映射，鸿蒙没有序列化框架，
 * 必须按服务端原名声明。
 */
interface RSlice { id?: number; name?: string; icon?: string; parent_id?: number; total?: number; color?: string; currency?: string; totalBreakdown?: Record<string, number>; }
interface RTrend { date?: string; income?: number; expense?: number; currency?: string; incomeBreakdown?: Record<string, number>; expenseBreakdown?: Record<string, number>; }
interface RBudgetExec { id?: number; name?: string; icon?: string; budget?: number; actual?: number; usage?: number; currency?: string; actualBreakdown?: Record<string, number>; }
interface RTopTx { id?: number; date?: string; amount?: number; note?: string; category_name?: string; category_icon?: string; currency?: string; }
interface RData {
  type?: string; period?: string; label?: string; days?: number;
  summary?: RSummary; dailyTrend?: RTrend[];
  expenseByCategory?: RSlice[]; incomeByCategory?: RSlice[];
  topExpenses?: RTopTx[]; budgetExecution?: RBudgetExec[];
}
/**
 * top-transactions 响应体。
 *
 * ⚠️ 字段名是 `items` 不是 `transactions` —— 服务端
 * server/routes/reports.js:745 写的是 `success({ items: rows.map(...) })`。
 * 安卓 model 里是 `val items: List<TopTransaction>`（对的），
 * 鸿蒙这里原本写 `transactions`，取值恒为 undefined → 明细排行卡永远是空的，
 * 而且因为有 `|| []` 兜底，不报错、不崩，只是卡片里一条都没有。
 * 又一次印证 §40：接口字段必须按服务端原名声明。
 */
interface TopTxResponse { items?: RTopTx[]; }

/** KPI 卡数据 */
interface KpiSpec { title: string; value: string; accent: string; icon: string; }
/** 均值标签与除数 */
interface AvgSpec { label: string; divisor: number; }
/** 每日概况表格的一行（结余维度） */
interface DailyRow {
  day: string;
  expense: string;
  income: string;
  balance: string;
  balanceNeg: boolean;
}

@Component
export struct ReportsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State type: string = 'expense';
  /** 'YYYY-MM'（按月）或 'YYYY'（按年）—— 与账单页 month 同一约定 */
  @State period: string = ym(new Date());
  @State periodMode: string = 'month';
  @State data: ESObject = null;
  /** 加载失败原因（非空即显示错误态）。空串 = 无错误 */
  @State loadError: string = '';
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State selectedIdx: number = -1;
  /** 趋势图选中日索引（-1 = 用峰值）。安卓端点击折线可换选中日，这里对齐 */
  @State trendSel: number = -1;
  /** 明细排行（独立接口，仅支出/收入维度有） */
  @State topTx: RTopTx[] = [];
  // 账本头
  @State books: Book[] = [];
  @State currentBookId: number = 0;
  @State bookName: string = '默认账本';
  @State showBookSheet: boolean = false;
  // 周期弹层
  @State showPeriodSheet: boolean = false;
  @State minYear: number = 0;

  aboutToAppear(): void { this.load(); this.loadBooks(); this.loadMinYear(); }

  async loadBooks(): Promise<void> {
    try {
      const r = await Api.getBooks();
      if (r.success && r.data) {
        const d = r.data as BooksResponse;
        this.books = d.books || [];
        this.currentBookId = d.currentBookId || 0;
        const b = this.books.find(x => x.id === this.currentBookId);
        this.bookName = b ? b.name : '默认账本';
      }
    } catch (e) { /* 读失败静默降级：账本名回落默认值，不打扰用户 */ }
  }

  async loadMinYear(): Promise<void> {
    try {
      const r = await Api.getTransactionMonths();
      if (!r.success) return;
      const list = r.data || [];
      if (list.length === 0) return;
      const y = Number(list[list.length - 1].slice(0, 4));
      if (y > 0) this.minYear = y;
    } catch (e) { /* 读失败静默降级：弹层回落「当前年」为下界 */ }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    // 后端 /reports 的 type 是粒度，不是支出/收入维度。
    //
    // ⚠️ 按年发 'annual' 而不是 'yearly'。二者在**新**服务端等价
    // （PERIOD_TYPE_ALIAS 把 yearly 映射成 annual），但 'annual' 是
    // 旧服务端唯一认识的写法 —— 旧版 parseReportPeriod 只有
    // monthly / quarterly / annual 三个分支，收到 'yearly' 直接
    // throw('不支持的报表类型') → HTTP 400。
    //
    // 选 'annual' 而不是"让用户先升级服务端"：客户端发新旧都认的值，
    // 这个功能就不依赖部署顺序。反过来（客户端发 yearly + 服务端加别名）
    // 要求两端同时升级，用户装了新 APK 而服务端还是旧的，按年就是坏的
    // —— 而这正是本轮暴露出来的现场。
    const gran = this.periodMode === 'year'
      ? 'annual'
      : (this.periodMode === 'custom' ? 'custom' : 'monthly');
    try {
      const r = await Api.getReport(gran, this.period);
      if (r.success && r.data) {
        this.data = r.data as ESObject;
      } else {
        this.data = null;
        this.loadError = '数据加载失败';
      }
    } catch (e) {
      // ⚠️ 失败必须清空 data 并显性报错，不能静默保留上一次的响应。
      // 原来只 console.error 而留着旧 data：顶部导航（本地状态）已切到
      // 「2026年」、KPI 已按年算月均，而趋势图还是上次那个月的 31 天
      //  —— 一个页面同时显示两个周期的数据，看起来像"分桶没生效"，
      // 实际是请求失败了。静默降级在这里比报错有害得多。
      this.data = null;
      const msg: string = (e as ApiError).message || '';
      // 「服务端太旧不认识 custom」要说清楚，否则用户以为是自己选错了区间。
      //
      // ⚠️ 但不能一律按 periodMode === 'custom' 就说「需要升级服务端」——
      // 那样部署完新服务端之后，真正的网络错误、401、区间格式错误
      // 全都会被这句话盖掉，反而更难排查（用户会一直去查服务端版本）。
      // 判据用服务端的实际回复：旧版 parseReportPeriod 落到最后一行
      // throw new Error('不支持的报表类型')。
      const serverTooOld: boolean = msg.indexOf('不支持的报表类型') >= 0;
      if (this.periodMode === 'custom' && serverTooOld) {
        this.loadError = '自定义区间需要升级服务端';
      } else {
        this.loadError = msg.length > 0 ? msg : '数据加载失败';
      }
      console.error('Report load:', msg);
    }
    finally { this.loading = false; }
    // 切周期/维度后旧的选中态已无意义（第 12 天在新月份可能不存在）
    this.trendSel = -1;
    this.selectedIdx = -1;
    this.loadTopTx();
  }

  /**
   * 明细排行 Top5。单独一个请求而不并进主 load：
   * 它失败不该让整页报表消失。
   * 结余维度没有「最大单笔结余」这种东西，跳过。
   */
  async loadTopTx(): Promise<void> {
    if (this.type === 'balance') { this.topTx = []; return; }
    try {
      const r = await Api.getTopTransactions(this.type, this.period);
      if (r.success && r.data) {
        const d = r.data as TopTxResponse;
        this.topTx = d.items || [];
      }
    } catch (e) { this.topTx = []; /* 读失败降级为不显示该卡，主报表不受影响 */ }
  }

  /** 切数据维度（支出/收入/结余）：报表数据本身与维度无关，只需重取明细排行 */
  switchType(t: string): void {
    if (this.type === t) return;
    this.type = t;
    this.trendSel = -1;
    this.selectedIdx = -1;
    this.loadTopTx();
  }

  /** 箭头翻页：按月 ±1 月，按年 ±1 年，自定义 ±整段长度 */
  shiftPeriod(delta: number): void {
    if (this.periodMode === 'year') {
      const y = Number(this.period.slice(0, 4));
      if (!y) return;
      this.period = String(y + delta);
    } else if (this.periodMode === 'custom') {
      // 自定义区间整段平移：3 个月的区间往前翻就是往前挪 3 个月，
      // 而不是挪 1 个月 —— 后者会让相邻两次查看的区间重叠 2 个月，
      // 用户以为在「翻页」，实际数据大部分是重复的。
      const parts = this.period.split('~');
      if (parts.length !== 2) return;
      const s = parts[0].trim().slice(0, 7).split('-').map(Number);
      const e = parts[1].trim().slice(0, 7).split('-').map(Number);
      if (s.length < 2 || e.length < 2) return;
      const span = (e[0] * 12 + e[1]) - (s[0] * 12 + s[1]) + 1;
      this.period = `${shiftMonth(s[0], s[1], span * delta)}~${shiftMonth(e[0], e[1], span * delta)}`;
    } else {
      const p = this.period.split('-').map(Number);
      let ny = p[0];
      let nm = p[1] + delta;
      if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; }
      this.period = `${ny}-${String(nm).padStart(2, '0')}`;
    }
    this.load();
  }

  applyPeriod(period: string, mode: string): void {
    this.showPeriodSheet = false;
    this.periodMode = mode;
    this.period = period;
    this.load();
  }

  /** 顶部周期文案：按月「2026年8月」，按年「2026年」，自定义「2026-01 - 2026-03」 */
  periodLabel(): string {
    if (this.periodMode === 'custom') {
      // 对齐安卓截图的「2026-01 - 2026-03」。不写成「2026年1月-2026年3月」——
      // 那样 13 个字符在 14sp 下超过导航区可用宽（约 120vp），会被截断成
      // 「2026年1月-2026...」，反而看不出终点是哪个月。
      const parts = this.period.split('~');
      if (parts.length === 2) {
        return `${parts[0].trim().slice(0, 7)} - ${parts[1].trim().slice(0, 7)}`;
      }
      return this.period;
    }
    if (this.periodMode === 'year') return `${this.period.slice(0, 4)}年`;
    const p = this.period.split('-');
    return p.length >= 2 ? `${p[0]}年${Number(p[1])}月` : this.period;
  }

  summary(): RSummary {
    if (!this.data) return {};
    return (this.data as RData).summary || {};
  }

  /**
   * 均值标签与除数。
   * ⚠️ 除数不写死 30：服务端 summary 已返回本期实际天数 `days`
   * （2 月是 28/29，按年是 365/366）。写死 30 会让 2 月日均偏低 7%、
   * 按年时"日均"变成"每 30 天均值"这种无意义的数。
   */
  avgSpec(): AvgSpec {
    if (this.periodMode === 'year') return { label: '月均', divisor: 12 };
    const d = (this.data as RData) || {};
    const days = d.days ?? 0;
    // 自定义区间也走「日均」：区间可能是 1 个月也可能是 3 年，
    // 用月均得先判断跨度，而服务端 days 已经是准确的实际天数，直接用最省心。
    return { label: '日均', divisor: days > 0 ? days : 30 };
  }

  /** 当前维度的总额 */
  total(): number {
    const s = this.summary();
    if (this.type === 'income') return s.income ?? 0;
    if (this.type === 'balance') return s.balance ?? 0;
    return s.expense ?? 0;
  }

  kpis(): KpiSpec[] {
    const s = this.summary();
    const av = this.avgSpec();
    // 自定义区间不能叫「本月预算」也不能叫「本年预算」——区间可能横跨若干月。
    // 直接叫「预算」（安卓自定义模式截图里也是「预算」两个字）。
    const prefix = this.periodMode === 'year' ? '本年' : (this.periodMode === 'custom' ? '' : '本月');
    // ⚠️ KPI 值一律用 fmtMoney 完整格式，不用 fmtMoneyShort。
    // KPI 卡是「看具体数」的地方，缩写到 ¥1.91万 会让「本月预算」和「剩余预算」
    // 显示成同一个值，掩盖掉几百块的差额。宽度由 KpiCard 的自适应缩字负责。
    if (this.type === 'income') {
      // 多币种 P2-3b：收入金额按 breakdown 智能混显（多币种账本自动附注其他货币）
      return [
        { title: '收入金额', value: fmtMoneyMix(s.incomeBreakdown, s.currency), accent: COLORS.income, icon: '💵' },
        { title: `${av.label}收入`, value: fmtMoney((s.income ?? 0) / av.divisor, s.currency), accent: COLORS.income, icon: '📅' }
      ];
    }
    if (this.type === 'balance') {
      const b = s.balance ?? 0;
      return [
        // balance = income - expense 主货币值；按主货币格式化
        { title: '结余金额', value: fmtMoney(b, s.currency), accent: b >= 0 ? COLORS.income : COLORS.expense, icon: '🎯' },
        { title: `${av.label}结余`, value: fmtMoney(b / av.divisor, s.currency), accent: COLORS.brand, icon: '📅' }
      ];
    }
    // 支出：4 张。预算/剩余取 budgetExecution 汇总（服务端已按当期筛选）
    const d = (this.data as RData) || {};
    const be = d.budgetExecution || [];
    let budget = 0;
    let actual = 0;
    be.forEach((b: RBudgetExec) => { budget += b.budget ?? 0; actual += b.actual ?? 0; });
    const remain = budget - actual;
    return [
      // 多币种 P2-3b：支出金额按 breakdown 混显
      { title: '支出金额', value: fmtMoneyMix(s.expenseBreakdown, s.currency), accent: COLORS.expense, icon: '💸' },
      { title: `${av.label}支出`, value: fmtMoney((s.expense ?? 0) / av.divisor, s.currency), accent: COLORS.expense, icon: '📅' },
      // 预算 amount 自身是 CNY 单货币（reports.js / stats.js 一致），不参与混显
      { title: `${prefix}预算`, value: budget > 0 ? fmtMoney(budget) : '未设置', accent: COLORS.brand, icon: '💰' },
      // 未设预算时剩余是 0-实际=负数，显示「-¥1,692.67 剩余预算」纯属误导。
      // 安卓端就是这么显示的（截图里两个 ¥0.00），这里不照抄。
      { title: '剩余预算', value: budget > 0 ? fmtMoney(remain) : '—', accent: remain >= 0 ? COLORS.brand : COLORS.expense, icon: '⏳' }
    ];
  }

  /**
   * 趋势/表格的时间桶。**这是按年视图能看的关键。**
   *
   * 服务端 `dailyTrend` 恒按天补齐（reports.js:355 那个 while 循环逐日 push），
   * 所以按年请求回来的是 365 条、自定义 3 个月回来的是 ~90 条。
   * 原代码直接 1:1 映射成折线点，后果是：
   *
   *   绘图区宽 234vp ÷ 364 段 = 相邻点间距 0.64vp
   *   而数据点半径 r=2（直径 4vp）→ 每个点盖住前后各 3 个邻居
   *   → 整条折线糊成一团墨迹，X 轴 12 个月被抽样成 7 个不规则日期
   *
   * 「按年」的语义单位本来就是月，不是日。所以这里按桶聚合：
   *   跨度 > 62 天 → 月桶（按年固定 12 个，自定义 3 个月得 3 个）
   *   否则         → 日桶（按月 28~31 个，与原行为一致）
   *
   * 阈值取 62 而不是「periodMode === 'year'」：自定义区间选了半年
   * 同样需要按月聚合，用 periodMode 判断会漏掉它。
   * 62 = 两个月上限（31×2），即「最多两个月仍按天看」，
   * 再长就超出人对逐日曲线的分辨能力了。
   */
  trendBuckets(): RTrend[] {
    if (!this.data) return [];
    const t: RTrend[] = (this.data as RData).dailyTrend || [];
    if (t.length <= 62) return t;

    // 按 'YYYY-MM' 归并。用数组保序而不是只靠 Map ——
    // Map 的插入序在 ArkTS 里可靠，但显式 keys 数组更经得起后续改动。
    const keys: string[] = [];
    const inc: number[] = [];
    const exp: number[] = [];
    t.forEach((x: RTrend) => {
      const ym: string = (x.date || '').slice(0, 7);
      if (ym.length < 7) return;
      let at = keys.indexOf(ym);
      if (at < 0) { keys.push(ym); inc.push(0); exp.push(0); at = keys.length - 1; }
      inc[at] += x.income ?? 0;
      exp[at] += x.expense ?? 0;
    });
    const out: RTrend[] = [];
    for (let i = 0; i < keys.length; i++) {
      // date 只留 'YYYY-MM'（7 位）——下游 fmtDayLabel / labels / dailyRows
      // 都靠 split('-').length 判断粒度，长度就是粒度标记，不要补 '-01'。
      out.push({ date: keys[i], income: inc[i], expense: exp[i] });
    }
    return out;
  }

  /** 当前趋势是否按月聚合（影响副标题措辞与表格首列表头） */
  isMonthBucket(): boolean {
    const b = this.trendBuckets();
    return b.length > 0 && (b[0].date || '').length === 7;
  }

  /** 趋势序列。结余用累计曲线（对齐安卓：逐日累加），支出/收入用当期值 */
  trendPoints(): number[] {
    const t: RTrend[] = this.trendBuckets();
    if (this.type === 'balance') {
      const out: number[] = [];
      let acc = 0;
      t.forEach((x: RTrend) => { acc += (x.income ?? 0) - (x.expense ?? 0); out.push(acc); });
      return out;
    }
    return t.map((x: RTrend): number => this.type === 'income' ? (x.income ?? 0) : (x.expense ?? 0));
  }

  trendLabels(): string[] {
    const t: RTrend[] = this.trendBuckets();
    return t.map((x: RTrend): string => {
      const parts: string[] = (x.date || '').split('-');
      if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`;
      // 月桶：'2026-08' → '8月'。跨年区间（2026-11~2027-02）会出现两个
      // 「1月」「2月」，但 X 轴是有序的且顶部已写明区间，不歧义。
      if (parts.length === 2) return `${Number(parts[1])}月`;
      return x.date || '';
    });
  }

  /** 峰值索引（趋势默认选中它，与安卓一致） */
  peakIndex(): number {
    const pts = this.trendPoints();
    if (pts.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < pts.length; i++) { if (pts[i] > pts[idx]) idx = i; }
    return idx;
  }

  /** 实际生效的选中索引：用户点过用 trendSel，否则用峰值 */
  effTrendIdx(): number {
    const pts = this.trendPoints();
    if (pts.length === 0) return -1;
    if (this.trendSel >= 0 && this.trendSel < pts.length) return this.trendSel;
    return this.peakIndex();
  }

  /** 趋势卡副标题左侧：选中桶 + 该桶值 */
  trendDayLabel(): string {
    const i = this.effTrendIdx();
    const pts = this.trendPoints();
    if (i < 0 || !this.data) return '本期暂无数据';
    const t: RTrend[] = this.trendBuckets();
    if (i >= t.length || i >= pts.length) return '本期暂无数据';
    const word = this.type === 'income' ? '收入' : (this.type === 'balance' ? '结余' : '支出');
    const d: string = t[i].date || '';

    // 月桶：'2026-08' → 「8月」或「2026年8月」。
    // 是否带年份取决于**这批桶是否跨年**，而不是 periodMode：
    //   按年查看 → 12 个桶同属一年，顶部导航已写「2026年」，再写一遍是 0 比特信息
    //   自定义跨年（2026-11~2027-02）→ 会出现两个「1月」「2月」，年份是必要的
    if (d.length === 7) {
      const y0: string = (t[0].date || '').slice(0, 4);
      const yN: string = (t[t.length - 1].date || '').slice(0, 4);
      const label: string = y0 === yN ? `${Number(d.slice(5, 7))}月` : `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月`;
      // 多币种 P2-3b：选中点的 currency 取该 bucket 的 currency
      return `${label}  ${word} ${fmtMoney(pts[i], t[i].currency)}`;
    }

    // 日桶用 fmtDayLabel 压成「8月12日」而不是「2026-08-12」：
    // 顶部周期导航已写明「2026年8月」，这里重复年份等于用 5 个字符表达 0 比特信息。
    // 省下的约 18vp 正好让右侧累计金额可以用完整格式而不挤。
    return `${fmtDayLabel(d)}  ${word} ${fmtMoney(pts[i], t[i].currency)}`;
  }

  /** 趋势卡副标题右侧：累计（结余维度是累计曲线，取末值即期末结余） */
  trendCumLabel(): string {
    const pts = this.trendPoints();
    // 之前误写 this.dailyTrend() —— 该方法不存在（reports.js 列表只返回 dailyTrend 字段，
    // 鸿蒙侧统一用 trendBuckets() 读取并按年/自定义区间聚合）。手误 bug，现已修正。
    const t: RTrend[] = this.trendBuckets();
    // 多币种 P2-3b：series 提取了 bucket 主货币值，整期主货币取首个非零 bucket 的 currency
    const primaryCurrency: string = ((): string => {
      for (let i = 0; i < t.length; i++) {
        const item: RTrend = t[i];
        if ((item.income ?? 0) > 0 || (item.expense ?? 0) > 0) {
          return item.currency || 'CNY';
        }
      }
      return 'CNY';
    })();
    if (this.type === 'balance') {
      return `期末结余 ${fmtMoney(pts.length > 0 ? pts[pts.length - 1] : 0, primaryCurrency)}`;
    }
    let sum = 0;
    pts.forEach((v: number) => { sum += v; });
    return `${this.type === 'income' ? '累计收入' : '累计支出'} ${fmtMoney(sum, primaryCurrency)}`;
  }

  trendColor(): string {
    if (this.type === 'income') return COLORS.income;
    if (this.type === 'balance') return COLORS.brand;
    return COLORS.expense;
  }

  /** 原始分类切片（未按粒度过滤） */
  rawCats(): RSlice[] {
    if (!this.data) return [];
    const d = this.data as RData;
    return (this.type === 'income' ? d.incomeByCategory : d.expenseByCategory) || [];
  }

  /**
   * 环图数据源：固定只取一级分类（parent_id 为空，服务端已把子类金额上卷到此）。
   *
   * 「小类/大类」切换已移除 —— 原本那两个 chip 表达的是「整张图换一套数据」，
   * 用户得来回切才能看全层级；现在改成「环图选大类、下方列表展开它的小类」，
   * 一屏读完，且与 web 端「单击看金额、双击下钻」的层级语义一致。
   */
  cats(): RSlice[] {
    return this.rawCats().filter((c: RSlice) => c.parent_id === null || c.parent_id === undefined);
  }

  /**
   * 有效选中索引：未显式选中时回落到 0（pieces 已按金额降序，即金额最大的分类）。
   *
   * 必须有这个回落 —— 改造后下方列表要展示「选中大类的二级子类」，
   * selectedIdx 为 -1（切周期/切类型后会重置）时列表就空了，页面看起来像加载失败。
   * 安卓端 `remember(categories) { categories.maxByOrNull { it.total } }` 是同一语义，
   * 两端保持一致：进页面即默认展开占比最大的那个大类。
   */
  effIdx(): number {
    const n = this.pieces().length;
    if (n === 0) return -1;
    if (this.selectedIdx < 0 || this.selectedIdx >= n) return 0;
    return this.selectedIdx;
  }

  /**
   * 选中一级分类下的二级子类（已过滤零金额、按金额降序）。
   * 无子类时返回空数组，由调用方退化为显示该分类自身
   * —— 空列表会让人以为出了 bug，而它其实是「这个类没有更细的划分」。
   */
  childPieces(): DonutPiece[] {
    const p = this.pieces();
    const idx = this.effIdx();
    if (idx < 0) return [];
    const selName = p[idx].name;
    const parent = this.cats().find((c: RSlice) => (c.name || '') === selName);
    if (!parent || parent.id === undefined || parent.id === null) return [];
    const pid: number = parent.id;
    return this.rawCats()
      .filter((c: RSlice) => c.parent_id === pid && (c.total ?? 0) > 0)
      .sort((a: RSlice, b: RSlice) => (b.total ?? 0) - (a.total ?? 0))
      .map((c: RSlice): DonutPiece => ({
        name: c.name || '',
        value: c.total ?? 0,
        icon: c.icon || '📌'
      }));
  }

  /** 列表实际渲染项：优先二级子类，无子类则退化为选中项自身 */
  listPieces(): DonutPiece[] {
    const kids = this.childPieces();
    if (kids.length > 0) return kids;
    const idx = this.effIdx();
    if (idx >= 0) return [this.pieces()[idx]];
    return [];
  }

  pieces(): DonutPiece[] {
    // 不传 color —— 后端 category.color 是历史遗留高饱和值（绿/蓝），且多数为 null，
    // 一律回落 COLORS.brand 会让整个环变成单一纯棕块。留空让 DonutChart 按 index
    // 取 SLICE_PALETTE（莫兰迪 10 色）。
    //
    // ⚠️ 必须在这里就按金额降序排好，不能依赖 DonutChart 内部排序。
    // DonutChart.positive() 会 filter+降序重排，它回调的 selectedIndex 是「排序后」的下标；
    // 而本页的 donutCenterTitle() / CategoryBars 用的是这里返回数组的下标。
    // 若服务端返回的顺序不是降序，点第 3 个扇区就会高亮第 3 条列表项 —— 但两者是不同分类。
    // 这种错位不报错、不崩，只是「点了 A 高亮 B」，极难在代码里看出来。
    // 两边用同一套顺序即可根治；顺带让「分类排行」列表真的按金额排名。
    return this.cats()
      .filter((c: RSlice) => (c.total ?? 0) > 0)
      .sort((a: RSlice, b: RSlice) => (b.total ?? 0) - (a.total ?? 0))
      .map((c: RSlice): DonutPiece => ({
        name: c.name || '',
        value: c.total ?? 0,
        icon: c.icon || '📌',
        // 多币种 P2-3b：把源 RSlice 挂上去，环心按 breakdown 智能混显
        source: c
      }));
  }

  /**
   * 环心第一行：「分类名 · 占比」。
   *
   * 用 effIdx() 而非 selectedIdx —— 下方列表已经默认展开占比最大的大类，
   * 环心若还显示「总支出」，两处读的就不是同一个东西，用户会以为列表串了。
   *
   * 占比必须显示在这里 —— 环图去掉四角引线标注后（对齐 web 无引线的式样），
   * 百分比就没有别的落点了。web 端靠 hover tooltip 给出「¥金额 (32.5%)」，
   * 触屏没有 hover，中心区就是它的等价物。
   */
  donutCenterTitle(): string {
    const p = this.pieces();
    const idx = this.effIdx();
    if (idx >= 0) {
      const tot = this.total();
      const pct = tot > 0 ? (p[idx].value / tot) * 100 : 0;
      return `${p[idx].name} · ${pct.toFixed(1)}%`;
    }
    return this.type === 'income' ? '总收入' : '总支出';
  }

  donutCenterValue(): string {
    const p = this.pieces();
    const idx = this.effIdx();
    // 多币种 P2-3b：环心金额按该分类的 breakdown 智能混显
    if (idx >= 0) {
      const src = p[idx].source as RSlice | undefined;
      if (src != null) return fmtMoneyMix(src.totalBreakdown);
      return fmtMoney(p[idx].value);
    }
    return fmtMoney(this.total());
  }

  /* ────────── 顶部：类型分段 + 周期导航 ────────── */

  @Builder TypeSeg() {
    Row() {
      ForEach(['expense', 'income', 'balance'], (v: string) => {
        Text(v === 'expense' ? '支出' : (v === 'income' ? '收入' : '结余'))
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.type === v ? COLORS.onPrimary : COLORS.textSecondary)
          .textAlign(TextAlign.Center)
          .maxLines(1)
          .layoutWeight(1)
          .padding({ top: 5, bottom: 5 })
          .backgroundColor(this.type === v ? COLORS.brand : TRANSPARENT)
          // 内圆角 = 外圆角(12) - padding(3)，同心才不会显得比槽更圆
          .borderRadius(9)
          .onClick(() => this.switchType(v))
      }, (v: string) => v)
    }
    .layoutWeight(1)
    .padding(3)
    .backgroundColor(COLORS.surfaceVariant)
    .borderRadius(12)
  }

  @Builder PeriodNav() {
    Row() {
      Text('‹')
        .fontSize(22).fontColor(COLORS.brand)
        .width(32).height(32).textAlign(TextAlign.Center)
        .onClick(() => this.shiftPeriod(-1))
      Text(this.periodLabel())
        .fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        .maxLines(1)
        .onClick(() => { this.showPeriodSheet = true; })
      Text('›')
        .fontSize(22).fontColor(COLORS.brand)
        .width(32).height(32).textAlign(TextAlign.Center)
        .onClick(() => this.shiftPeriod(1))
    }
    .layoutWeight(1)
    .justifyContent(FlexAlign.End)
    .alignItems(VerticalAlign.Center)
  }

  /* ────────── KPI ────────── */

  @Builder KpiCard(s: KpiSpec) {
    // 用统一 Card 而不是自拼 backgroundColor + shadow ——
    // Card 承载的是「半透明 cardGlass + 柔和阴影 + 极浅描边」这套材质，
    // 自拼不透明 surface 会在环境光背景上切出一个白方块，和同页趋势卡质感不一致。
    Card({ contentPadding: 14 }) {
      Column() {
        Row({ space: 8 }) {
          Text(s.icon)
            .fontSize(14)
            .width(26).height(26)
            .textAlign(TextAlign.Center)
            .backgroundColor(COLORS.surfaceVariant)
            .borderRadius(13)
          Text(s.title)
            .fontSize(13).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Center)
        Text(s.value)
          .fontSize(20).fontWeight(FontWeight.Bold).fontColor(s.accent)
          // KPI 卡显示完整金额（¥20,904.00），不用 fmtMoneyShort 缩写。
          //
          // 之前误判成「宽度不够」而缩写，实测是算错了：
          //   360vp 屏 → 卡内可用 (360-32-10)/2-28 = 131vp
          //   20sp 下 ¥123,456.78 = 110.8vp、¥1,234,567.89 = 127.2vp，都放得下。
          // 缩写反而丢了小数位 —— 而「本月预算 ¥1.91万」和「剩余预算 ¥1.91万」
          // 缩写后看起来一模一样，实际可能差几百块，用户完全看不出来。
          //
          // 只在真正超宽时才等比缩字，不截断、不省略：
          //   maxFontSize 20 → minFontSize 15，覆盖到 320vp 小屏的千万级负数。
          .minFontSize(15).maxFontSize(20)
          .heightAdaptivePolicy(TextHeightAdaptivePolicy.LAYOUT_CONSTRAINT_FIRST)
          .maxLines(1)
          .width('100%')
          .margin({ top: 8 })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
    }
  }

  @Builder KpiGrid() {
    // 用 Column + Row 手工两两分组，不用 Grid ——
    // Grid 在无高度约束的 Scroll 内会按可用高度均分行，撑出巨大空白（见旧版注释）。
    // 且 KPI 数量随维度变化（2 或 4），固定高度必然对不上。
    Column({ space: 10 }) {
      ForEach(this.kpiRows(), (row: KpiSpec[], ri: number) => {
        Row({ space: 10 }) {
          ForEach(row, (s: KpiSpec) => {
            Column() { this.KpiCard(s) }.layoutWeight(1)
            // ⚠️ key 必须含 value，不能只用 title。
            // 翻月份时 title 不变（还是「支出金额」）但金额变了，
            // 只用 title 做 key 会让 ArkUI 判定该项未变化 → 卡片停在上个月的数字。
          }, (s: KpiSpec) => `${s.title}|${s.value}`)
          // 奇数张时补一个空位，避免单张卡拉伸成整行宽（比例失衡）
          if (row.length === 1) { Blank().layoutWeight(1) }
        }.width('100%').alignItems(VerticalAlign.Top)
        // ⚠️⚠️ 外层 key 原来是纯行号 `r${ri}` —— 这是一个 P0：
        // 从「支出」切到「收入」时，KPI 从 4 张变 2 张，但第 0 行的 key 仍是 `r0`，
        // ArkUI 认为这一项没变，整行（含内层 ForEach）直接跳过重建 ——
        // 于是标题还写着「支出金额」、数值还是支出的 ¥20,904.00。
        // 表现是「切了维度但 KPI 不动」，不报错、不崩，纯粹数据错。
        // key 必须编入所有会影响这一行内容的状态：维度 + 周期粒度 + 各卡标题与值。
      }, (row: KpiSpec[], ri: number) => this.kpiRowKey(row, ri))
    }
    .width('100%')
  }

  /**
   * KPI 行的 ForEach key。
   * 编入维度（type）、周期粒度（periodMode）、周期（period）以及该行每张卡的
   * 标题+值 —— 任一变化都必须触发重建。
   */
  kpiRowKey(row: KpiSpec[], ri: number): string {
    let sig = '';
    row.forEach((s: KpiSpec) => { sig += `${s.title}=${s.value};`; });
    return `${this.type}|${this.periodMode}|${this.period}|r${ri}|${sig}`;
  }

  /** KPI 两两分行 */
  kpiRows(): KpiSpec[][] {
    const all = this.kpis();
    const out: KpiSpec[][] = [];
    for (let i = 0; i < all.length; i += 2) { out.push(all.slice(i, i + 2)); }
    return out;
  }

  /* ────────── 趋势 ────────── */

  @Builder TrendBlock() {
    Card() {
      Column() {
        Text(this.type === 'income' ? '收入趋势' : (this.type === 'balance' ? '结余趋势' : '支出趋势'))
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        // 副标题行：左「选中日 + 当日值」右「累计」。
        // 这行是趋势图从「好看的装饰」变成「可读数据」的关键 —— 只有曲线时
        // 用户只知道哪天最高，不知道具体是几号、多少钱。
        Row() {
          Text(this.trendDayLabel())
            .fontSize(12).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(this.trendCumLabel())
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor(this.trendColor())
            .maxLines(1)
        }
        .width('100%').margin({ top: 8 })
        .alignItems(VerticalAlign.Center)

        if (this.trendPoints().length === 0 || this.trendMax() <= 0) {
          EmptyState({ text: '该周期暂无数据' })
        } else {
          TrendChart({
            points: this.trendPoints(),
            labels: this.trendLabels(),
            lineColor: this.trendColor(),
            peakIndex: this.effTrendIdx(),
            onTapIndex: (i: number) => { this.trendSel = i; }
          }).margin({ top: 8 })
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
    }
  }

  trendMax(): number {
    const pts = this.trendPoints();
    let m = 0;
    pts.forEach((v: number) => { if (v > m) m = v; });
    return m;
  }

  /* ────────── 分类排行（一级分类环图 + 选中项的二级子类列表） ────────── */

  @Builder CategoryRankingCard() {
    Card() {
      Column() {
        Text('分类排行')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
          .width('100%')

        if (this.pieces().length === 0) {
          EmptyState({ text: '该周期暂无分类数据' })
        } else {
          // 环图 + 其下说明文字单独包一层居中容器。
          //
          // ⚠️ 不能靠父 Column 改 HorizontalAlign.Center 来居中 —— 父列的
          // alignItems 是 Start，那是「分类排行」标题和下方 CategoryBars 需要的
          // （标题居中会和页面其它卡片标题不齐、条形图居中会让百分比数字错位）。
          // DonutChart 自身宽度固定 220vp，在 Start 的父列里必然贴左。
          // 故只把需要居中的两个元素套一层 width('100%') + Center 的子列。
          Column() {
            DonutChart({
              data: this.pieces(),
              // 传 effIdx 而非 selectedIdx：进页面即高亮占比最大的色块，
              // 与环心读数、下方列表三者指向同一个分类。
              selectedIndex: this.effIdx(),
              centerTitle: this.donutCenterTitle(),
              centerValue: this.donutCenterValue(),
              onSliceClick: (i: number) => { this.selectedIdx = i; }
            })
            if (this.effIdx() >= 0) {
              Text(`${this.pieces()[this.effIdx()].name} · ${this.childPieces().length > 0 ? '二级明细' : '无二级分类'}`)
                .fontSize(12).fontColor(COLORS.textSecondary)
                .margin({ top: 8, bottom: 2 })
            }
          }.width('100%').alignItems(HorizontalAlign.Center)
          CategoryBars({
            items: this.listPieces(),
            // 分母用选中大类的总额（而非子类之和）：大类金额里可能有一部分没细分到子类，
            // 用子类之和当分母会把占比虚高到 100%，与环图读数冲突。
            baseTotal: this.effIdx() >= 0 ? this.pieces()[this.effIdx()].value : 0,
            colorOffset: this.effIdx() >= 0 ? this.effIdx() : 0
          }).margin({ top: 8 })
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
    }
  }

  /* ────────── 明细排行 ────────── */

  @Builder DetailRankingCard() {
    Card() {
      Column() {
        Text('明细排行')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        ForEach(this.topTx, (tx: RTopTx, i: number) => {
          Row({ space: 12 }) {
            CategoryIcon({ icon: tx.category_icon || '📌', iconSize: 36 })
            Text(tx.category_name || '交易')
              .fontSize(14).fontColor(COLORS.textPrimary)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Column() {
              // 金额用完整格式：这一列宽度由内容决定（类目名吃 layoutWeight 被压缩），
              // 实测 14sp 下 -¥1,234,567.89 只占 94vp，类目名仍剩 142vp（约 10 个汉字），
              // 不构成宽度竞争 —— 按 §39 判据这里就该用完整精度。
              // 多币种 P2-3b：按交易账户币种格式化（reports.js top-transactions 已返回 currency 字段）
              Text((this.type === 'income' ? '' : '-') + fmtMoney(tx.amount ?? 0, tx.currency))
                .fontSize(14).fontWeight(FontWeight.Medium)
                .fontColor(this.type === 'income' ? COLORS.income : COLORS.expense)
                .maxLines(1)
              Text((tx.date || '').slice(0, 10).replace(/-/g, '.'))
                .fontSize(11).fontColor(COLORS.textSecondary)
                .margin({ top: 2 })
            }.alignItems(HorizontalAlign.End)
          }
          .width('100%')
          .padding({ top: 10, bottom: 10 })
          .alignItems(VerticalAlign.Center)
          if (i < this.topTx.length - 1) {
            Divider().color(COLORS.divider).strokeWidth(0.5)
          }
        // key 编入 type：这一行的正负号与颜色都取决于当前维度。
        // 只用 tx.id 的话，若支出/收入两份 topTx 里出现同一条 id（转账类交易两边都会命中），
        // 切维度后这一行会保留上个维度的符号与颜色。
        }, (tx: RTopTx, i: number) => `${this.type}|${tx.id ?? i}|${tx.amount ?? 0}`)
      }.alignItems(HorizontalAlign.Start).width('100%')
    }
  }

  /* ────────── 结余：每日概况表格 ────────── */

  /**
   * 结余维度的「每日概况」大表格（对齐安卓 DailyOverviewTable）。
   *
   * 为什么结余页必须有这张表：
   *   趋势图只能看出「哪天有跳变」，看不出具体数字。结余是三个维度里最需要
   *   逐日核对的一个 —— 用户看结余通常是在找「钱是哪天走的」。
   *   没这张表的话结余页在趋势图以下就是一整片空白。
   *
   * 四列等分，每列实测仅 75vp（360 屏：360−页面32−卡片28=300，÷4）。
   * 12sp 下 `-¥123,456.00` 要 70.8vp，加列间距即溢出 ——
   * 所以这里是 §44 说的「多项金额在同一行真实竞争宽度」，
   * 必须用 fmtMoneyShort（≥1万才缩），和安卓同一处的取舍一致。
   * 汇总行只有 4 格且是全宽强调行，用完整精度。
   */
  @Builder DailyOverviewCard() {
    Card({ contentPadding: 0 }) {
      Column() {
        Text(this.isMonthBucket() ? '每月概况' : '每日概况')
          .fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
          .width('100%')
          .padding({ left: 14, right: 14, top: 12, bottom: 10 })

        // 表头：品牌棕实底白字。安卓源码注释里写明截图是薄荷绿但代码保留暖棕，
        // 这里同样用暖棕 —— 绿色表头在这套配色里是外来色。
        Row() {
          ForEach([this.isMonthBucket() ? '月份' : '日期', '支出', '收入', '结余'], (h: string) => {
            Text(h)
              .fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(COLORS.onPrimary)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
          }, (h: string) => `h${h}`)
        }
        .width('100%')
        .padding({ top: 10, bottom: 10 })
        .backgroundColor(COLORS.brand)

        // 数据行
        ForEach(this.dailyRows(), (r: DailyRow, i: number) => {
          Row() {
            Text(r.day)
              .fontSize(12).fontColor(COLORS.textPrimary)
              .textAlign(TextAlign.Center).layoutWeight(1)
            Text(r.expense)
              .fontSize(12).fontColor(COLORS.expense)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center).layoutWeight(1)
            Text(r.income)
              .fontSize(12).fontColor(COLORS.income)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center).layoutWeight(1)
            Text(r.balance)
              .fontSize(12).fontColor(r.balanceNeg ? COLORS.expense : COLORS.income)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center).layoutWeight(1)
          }
          .width('100%')
          .padding({ top: 9, bottom: 9 })
          // 斑马纹：40 行纯白表格逐行看会串行，隔行浅底能锁住视线。
          // 用 surfaceVariant 而不是自定义灰，保持与全局 token 同源。
          .backgroundColor(i % 2 === 1 ? COLORS.surfaceVariant : TRANSPARENT)
        }, (r: DailyRow, i: number) => `d${r.day}|${r.expense}|${r.income}`)

        // 汇总行：与数据行区分开，否则最后一行会被当成 31 日的数据
        Row() {
          Text('汇总')
            .fontSize(12).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
            .textAlign(TextAlign.Center).layoutWeight(1)
          Text(this.sumCell('expense'))
            .fontSize(11).fontWeight(FontWeight.Medium).fontColor(COLORS.expense)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Center).layoutWeight(1)
          Text(this.sumCell('income'))
            .fontSize(11).fontWeight(FontWeight.Medium).fontColor(COLORS.income)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Center).layoutWeight(1)
          Text(this.sumCell('balance'))
            .fontSize(11).fontWeight(FontWeight.Medium)
            .fontColor((this.summary().balance ?? 0) < 0 ? COLORS.expense : COLORS.income)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.Center).layoutWeight(1)
        }
        .width('100%')
        .padding({ top: 11, bottom: 11 })
        .backgroundColor(COLORS.brandBgLight)
      }
      .width('100%')
      .clip(true)
    }
  }

  /** 表格数据行。空值显示「—」而不是 ¥0.00 —— 40 行 ¥0.00 会把有数据的行埋掉 */
  dailyRows(): DailyRow[] {
    // 与趋势图共用同一套桶：按年时这里是 12 行月汇总，不是 365 行。
    // 原来直接读 dailyTrend，按年会渲染 365 个 Row —— 既滚不动也没人逐日看一年。
    const t: RTrend[] = this.trendBuckets();
    const monthly = this.isMonthBucket();
    const out: DailyRow[] = [];
    t.forEach((p: RTrend) => {
      const ex = p.expense ?? 0;
      const inc = p.income ?? 0;
      const bal = inc - ex;
      const d: string = p.date || '';
      // 多币种 P2-3b：每行用该 bucket 的 currency
      const rowCur: string = p.currency || 'CNY';
      out.push({
        // 日桶：'YYYY-MM-DD' → '08.15'
        // 月桶：'YYYY-MM'    → '8月'
        day: monthly ? `${Number(d.slice(5, 7))}月` : d.slice(5, 10).replace('-', '.'),
        expense: ex > 0 ? `-${fmtMoneyShort(ex, rowCur)}` : '—',
        income: inc > 0 ? `+${fmtMoneyShort(inc, rowCur)}` : '—',
        balance: bal !== 0 ? fmtMoneyShort(bal, rowCur) : '—',
        balanceNeg: bal < 0
      });
    });
    return out;
  }

  /**
   * 汇总行单元格。
   *
   * 从 trendBuckets 累加而不是读 summary()。
   *
   * 核实过：服务端两条 SQL（summary 与 dailyTrend）当前口径是一致的 ——
   * WHERE 相同、CASE WHEN 也都只累加 income/expense，差异仅在 summary 多返回 tx_count。
   * 所以两种写法目前结果相同。
   *
   * 但仍改成从桶累加，理由是**结构性保证**而非当前正确性：
   * 表格每一行的数字来自 buckets，汇总行是这些行的和 ——
   * 同源相加必然平账。若读 summary，两者一致靠的是「服务端两条 SQL 恰好口径相同」
   * 这个外部约定，任何一天有人给 summary 加上 transfer 或改 WHERE，
   * 表格就会出现「各行加起来 ≠ 汇总」，而这种错没有任何报错，
   * 只有用户拿计算器按一遍才会发现。
   */
  sumCell(kind: string): string {
    const t: RTrend[] = this.trendBuckets();
    let ex = 0;
    let inc = 0;
    t.forEach((p: RTrend) => { ex += p.expense ?? 0; inc += p.income ?? 0; });
    // 多币种 P2-3b：汇总行主货币取首个非零 bucket 的 currency
    let primaryCurrency = 'CNY';
    for (let i = 0; i < t.length; i++) {
      const item = t[i];
      if ((item.income ?? 0) > 0 || (item.expense ?? 0) > 0) {
        primaryCurrency = item.currency || 'CNY';
        break;
      }
    }
    if (kind === 'expense') return ex > 0 ? `-${fmtMoney(ex, primaryCurrency)}` : '—';
    if (kind === 'income') return inc > 0 ? `+${fmtMoney(inc, primaryCurrency)}` : '—';
    return fmtMoney(inc - ex, primaryCurrency);
  }

  /**
   * 错误态副文案：告诉用户「接下来能做什么」。
   *
   * 必须按真实原因分叉。原来无条件写「检查网络连接，或确认服务端已更新」，
   * 服务端升级完之后遇到网络问题还是这句 —— 用户会一直去查服务端版本。
   */
  errorHint(): string {
    if (this.loadError.indexOf('升级服务端') >= 0) {
      return '当前服务端版本不支持自定义区间，请更新后端后重试';
    }
    if (this.loadError.indexOf('登录') >= 0 || this.loadError.indexOf('401') >= 0) {
      return '登录状态可能已过期，请重新登录';
    }
    if (this.loadError.indexOf('格式错误') >= 0) {
      return '所选区间不合法，请重新选择起止月份';
    }
    return '检查网络连接后重试；持续失败请确认服务端是否可访问';
  }

  /**
   * 加载失败态。有「重试」按钮 —— 失败原因多半是网络抖动或服务端版本旧，
   * 前者重试就好，后者至少让用户看到确切原因而不是空白图表。
   */
  @Builder ErrorBlock() {
    Column({ space: 12 }) {
      Text('📡').fontSize(40)
      Text(this.loadError)
        .fontSize(15).fontColor(COLORS.textPrimary)
        .textAlign(TextAlign.Center)
      Text(this.errorHint())
        .fontSize(12).fontColor(COLORS.textSecondary)
        .textAlign(TextAlign.Center)
        .maxLines(2)
      Text('重试')
        .fontSize(14).fontWeight(FontWeight.Medium)
        .fontColor(COLORS.onPrimary)
        .textAlign(TextAlign.Center)
        .width(96).height(40)
        .backgroundColor(COLORS.brand)
        .borderRadius(RADIUS.md)
        .onClick(() => { this.load(); })
    }
    .width('100%')
    .padding({ left: 32, right: 32, top: 56, bottom: 56 })
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    Stack() {
      Column() {
        BookHeader({
          bookName: this.bookName,
          onSwapBook: () => { this.showBookSheet = true; },
          onSearch: () => { router.pushUrl({ url: 'pages/Search' }); }
        })

        // 类型分段 + 周期导航同一行（对齐安卓：左右各占一半，不随下方内容滚动）
        Row({ space: 10 }) {
          this.TypeSeg()
          this.PeriodNav()
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 8, bottom: 8 })
        .alignItems(VerticalAlign.Center)

        if (this.loading) { LoadingBox() }
        else if (this.loadError.length > 0) {
          // 显性错误态 + 重试。不复用 EmptyState（「暂无数据」）——
          // 请求失败和「这一年真的没记账」是两件完全不同的事，
          // 用同一个空态表达会让人一直往数据方向找原因。
          this.ErrorBlock()
        }
        else {
          Scroll() {
            // 左右 16 统一加在这里而不是每张卡各写一遍 ——
            // KPI 网格里也是 16，任何一处写成 12 就会出现「卡片没对齐」的错位感，
            // 而这种错位在截图上比在代码里明显得多。
            Column({ space: 12 }) {
              this.KpiGrid()
              this.TrendBlock()
              // 结余维度没有「分类占比」这回事（结余是收入减支出的差，不属于任何分类），
              // 也没有「最大单笔结余」。安卓端同样只在支出/收入下显示这两张卡。
              if (this.type !== 'balance') {
                this.CategoryRankingCard()
                if (this.topTx.length > 0) { this.DetailRankingCard() }
              } else {
                // 结余维度改放「每日概况」大表格（对齐安卓 DailyOverviewTable）。
                // 不放这张表的话结余页在趋势图下面就是一整片空白 ——
                // 而结余恰恰是最需要逐日核对的维度（想知道钱是哪天走的）。
                this.DailyOverviewCard()
              }
            }
            .width('100%')
            .padding({ left: 16, right: 16, bottom: LAYOUT.bottomNavSafe })
          }.layoutWeight(1).scrollBar(BarState.Off)
        }
      }.width('100%').height('100%')

      BookSwitcherSheet({
        show: this.showBookSheet,
        books: this.books,
        currentId: this.currentBookId,
        onDismiss: () => { this.showBookSheet = false; },
        onSelect: (id: number) => {
          this.showBookSheet = false;
          Api.switchBook(id).then(() => { this.loadBooks(); this.load(); });
        },
        onCreate: (name: string) => {
          Api.createBook({ name }).then(() => { this.loadBooks(); });
        }
      })

      PeriodPickerSheet({
        show: this.showPeriodSheet,
        initialPeriod: this.period,
        initialMode: this.periodMode,
        allowYear: true,
        // 统计页才开「自定义」区间：账单页/日历是逐月浏览流水，
        // 跨月区间在那里没有对应的展示形态（日历画不出 3 个月）。
        allowCustom: true,
        minYear: this.minYear,
        onDismiss: () => { this.showPeriodSheet = false; },
        onConfirm: (period: string, mode: string) => { this.applyPeriod(period, mode); }
      })
    }.width('100%').height('100%')
  }
}

// 注：本文件原有一个 @Entry struct Reports 包装（TopBar + ReportsPage），
// 用于 main_pages.json 里的 "pages/Reports" 独立路由。但 ReportsPage 是 Main 的
// tab 内容，pushUrl 过去会压出一个没有底部导航栏的孤立页面——全项目无任何代码这么跳。
// 该死路由已从 main_pages.json 摘除，包装 struct 一并删除。
// 详见 docs/harmony-style-guide.md 第 11 节。
