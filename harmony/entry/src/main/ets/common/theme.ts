/**
 * 主题常量：对齐安卓端 Material 3 暖棕主题（Brown500 + 配套语义色）。
 * 收入红 / 支出绿 与 Web Design Token 一致。
 *
 * 升级要点（鸿蒙深度精修 · 阶段 1）：
 *   1) ColorTokens 补齐 surfaceVariant / onSurfaceVariant / outline / outlineVariant / errorContainer /
 *      onPrimary / onPrimaryContainer / onError / onErrorContainer，对齐安卓 Material 3 命名
 *   2) pageBg 由 #F5F6F8（冷灰）改 #FDFBFA（暖白），与品牌色更搭
 *   3) divider 由 #EEEEEE 改 #EBE7E3（暖灰分组底）
 *   4) 新增 SPACING / RADIUS / SHADOW 栅格常量，统一页面布局节奏
 *   5) 采用「可变 activeColors + applyTheme() 同步」方案：COLORS 始终是同一引用对象，
 *      切换主题时只更新其字段，配合页面 @StorageProp('themeMode') 重绘即可生效
 *
 * ⚠️ 颜色格式红线（踩过的坑，务必遵守）：
 *   ArkUI 的 8 位十六进制色值是 #AARRGGBB —— **Alpha 在最前**，与 CSS 的 #RRGGBBAA 正好相反。
 *   写成 CSS 顺序会静默出错（不报编译错），后果举例（左侧是错误写法）：
 *     #FFFFFFCC 本意「80% 白」→ 实际解析 A=FF R=FF G=FF B=CC = 不透明淡黄色
 *     #0000000A 本意「4% 黑阴影」→ 实际 A=00 = 完全透明，阴影直接消失
 *     #FFE8DC00 本意「透明暖橘」→ 实际 A=FF R=E8 G=DC B=00 = 不透明黄绿色块
 *   **不要手写 8 位色值，一律用下面的 withAlpha() 生成。**
 */

/* ====================== 颜色工具 ====================== */

/** 0~1 不透明度 → 两位十六进制 AA 分量 */
function alphaHex(opacity: number): string {
  let o: number = opacity;
  if (isNaN(o)) {
    o = 1;
  }
  o = Math.max(0, Math.min(1, o));
  const v: number = Math.round(o * 255);
  const s: string = v.toString(16).toUpperCase();
  return s.length === 1 ? '0' + s : s;
}

/**
 * 给 6 位色值挂上不透明度，输出 ArkUI 正确的 #AARRGGBB。
 *
 *   withAlpha('#FFFFFF', 0.8)  → '#CCFFFFFF'（80% 白）
 *   withAlpha('#000000', 0.04) → '#0A000000'（4% 黑，用于阴影）
 *   withAlpha('#995F2C', 0)    → '#00995F2C'（全透明，用于渐变收尾）
 *
 * 传入已带 alpha 的 8 位色值时会替换其 alpha 分量（按 ArkUI 顺序解析）。
 */
export function withAlpha(hex: string, opacity: number): string {
  const h: string = hex.replace('#', '');
  // 8 位输入按 ArkUI #AARRGGBB 解析，取后 6 位 RGB
  const rgb: string = h.length === 8 ? h.substring(2) : h;
  return '#' + alphaHex(opacity) + rgb.toUpperCase();
}

/** 完全透明（渐变收尾 / 无阴影占位常用），比 '#00000000' 语义清晰 */
export const TRANSPARENT: string = '#00000000';

/* ====================== Color Tokens ====================== */
export interface ColorTokens {
  /* —— 品牌主色 —— */
  brand: string;             // Brown500 主品牌（暖棕）
  brandLight: string;        // Brown300
  brandLighter: string;      // Brown200
  brandBg: string;           // Brown100 浅填充（primaryContainer）
  brandBgLight: string;      // Brown50 更浅填充
  iconBgNeutral: string;     // emoji 图标中性底（不要用后端 category.color）
  onPrimary: string;         // 主色上的文字（白）
  onPrimaryContainer: string;// 主色容器上的文字（深棕）

  /* —— 语义色 —— */
  income: string;            // 收入红
  expense: string;           // 支出绿
  teal: string;              // 薄荷青（筛选/强调）
  fabBg: string;             // FAB 底色（近黑）

  /* —— 文字层级 —— */
  textPrimary: string;       // 一级文字
  textSecondary: string;     // 二级文字
  placeholder: string;       // 占位符

  /* —— 表面/背景层级（Material 3）—— */
  background: string;        // 页面背景（暖白 #FDFBFA）
  surface: string;           // 卡片/容器表面
  surfaceVariant: string;    // 次级表面（分组底）
  card: string;              // 等价 surface（保留旧名兼容）
  cardGlass: string;         // 玻璃表面半透明填充
  pageBg: string;            // 等价 background（保留旧名兼容）
  glassBorder: string;       // 发丝边框
  glassHi: string;           // 顶部高光边

  /* —— 边框/分隔线 —— */
  divider: string;           // 暖灰分隔线 #EBE7E3
  outline: string;           // M3 outline 边框 #B9B3AE
  outlineVariant: string;    // M3 outlineVariant 浅边框 #D8D3CF

  /* —— 错误色 —— */
  danger: string;            // 等价 error；用于「前景」场景：删除图标、警示文字
  dangerStrong: string;      // 实心按钮填充专用（压深一档，保证白字达 AA）
  error: string;             // M3 error
  onError: string;           // 错误色上的文字
  errorContainer: string;    // 错误容器（浅红）
  onErrorContainer: string;  // 错误容器上的文字（深红）

  /* —— 品牌渐变三档（用于卡片/按钮的横向渐变填充） —— */
  brandGradStart: string;    // 渐变起始（深）
  brandGradMid: string;      // 渐变中段（主）
  brandGradEnd: string;      // 渐变结束（深）

  /* —— 强调色（三档用于图表/标签分类） —— */
  accent1: string;           // 紫蓝 — 信息
  accent2: string;           // 翠绿 — 收入/进度
  accent3: string;           // 琥珀 — 提醒
  accent4: string;           // 粉 — 标签

  /* —— 环境光团（页面背景柔光，与背景 pageBg 同调） —— */
  ambient1: string;          // 暖橘柔光
  ambient2: string;          // 暮霞粉
  ambient3: string;          // 薄荷青
  ambient4: string;          // 藕荷粉

  /* —— 玻璃材质（毛玻璃面板） —— */
  glassFill: string;         // 玻璃填充（半透明白）
  glassStroke: string;       // 玻璃描边
  glassHighlight: string;    // 玻璃顶部高光

  /* —— 多层阴影 —— */
  shadowCard: string;        // 卡片主阴影色
  shadowAmbient: string;     // 环境阴影色
}

/* ====================== 亮色（对齐安卓 md_theme_light_* / Brown*） ====================== */
export const LIGHT: ColorTokens = {
  brand: '#995F2C',
  brandLight: '#D39562',
  brandLighter: '#EBB890',
  brandBg: '#F8D7BE',
  brandBgLight: '#FCEFE5',
  iconBgNeutral: '#F5EFE9',   // emoji 图标中性底：暖灰米，托住 emoji 而不抢戏
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#2E1200',

  // 语义色：红涨绿跌（中国习惯）。饱和度已从 90%/100% 降到 74%/63%，
  // 与暖棕品牌共存而不撞色。取值经过全背景场景核算 —— 最严苛的是日历格
  // brandBgLight #FCEFE5 浅底（比卡片更亮），必须在那里也达 AA 4.5:1。
  income: '#B02E43',   // S=74% 全场景 5.61~6.33:1（原 #C11435 S=90% 撞色）
  expense: '#2C7657',  // S=63% 全场景 4.85~5.47:1（原 #009558 S=100% 仅 3.42~3.66 ✗ 不达 AA）
  teal: '#4DD0C4',
  fabBg: '#111827',

  textPrimary: '#1A1A1A',
  textSecondary: '#4F4944',
  // 升级：原 #BDBDBD 在暖白底上对比度仅 1.82:1（远低于 WCAG AA），且是中性灰与暖色板不搭。
  // 改暖灰 #948C84 → 3.21:1，满足次要信息/大字标准，又不至于抢正文的注意力。
  placeholder: '#948C84',

  background: '#FDFBFA',     // 暖白（升级：原 #F5F6F8 偏冷）
  surface: '#FFFFFF',
  surfaceVariant: '#EBE7E3', // M3 分组底
  card: '#FFFFFF',
  cardGlass: '#9EFFFFFF',    // 62% 白 — Card 组件底色，让环境光柔光透过卡片
  pageBg: '#FDFBFA',         // 与 background 同值
  glassBorder: '#99FFFFFF',  // 修正：60% 白发丝边（原 #FFFFFF99 顺序写反）
  glassHi: '#FFFFFF',

  divider: '#EBE7E3',        // 升级：原 #EEEEEE → 暖灰分组底
  outline: '#B9B3AE',        // M3 outline
  outlineVariant: '#D8D3CF', // M3 outlineVariant

  // danger 用于前景（删除图标、警示文字）；实心按钮填充必须用 dangerStrong。
  // #E54D42 上压白字只有 3.84:1 不达 AA，压深到 #CC3E35 后 4.87:1。
  // 不直接改 danger 本身 —— 它作为图标色时压深会显闷。
  danger: '#E54D42',
  dangerStrong: '#CC3E35',   // 白字 4.87:1 ✓
  error: '#C11435',
  onError: '#FFFFFF',
  errorContainer: '#FBE7E9',
  onErrorContainer: '#7A0B22',

  brandGradStart: '#7A4823',
  brandGradMid: '#995F2C',
  brandGradEnd: '#5A3517',

  accent1: '#6366F1',  // 紫蓝
  accent2: '#10B981',  // 翠绿
  accent3: '#F59E0B',  // 琥珀
  accent4: '#EC4899',  // 粉

  // 环境光团（页面背景柔光）。
  // 修正：原值 #FFE8DC / #FFD6BA / #F8D5B0 / #F4CFC0 饱和度过高，直接铺在页面上是「色块」而非柔光；
  // 且其中两支偏橘黄（#F8D5B0 命名「薄荷青」实为杏色，与注释不符）。
  // 现全部收敛到暖白基底 #FDFBFA 附近、只保留极轻色相偏移，靠 AppBackground 的 alpha + blur 出效果。
  ambient1: '#FBEADF',       // 暖橘柔光（右上）
  ambient2: '#F9E4E4',       // 暮霞粉（左上）
  ambient3: '#F6EDE2',       // 米杏（左下）
  ambient4: '#F7E6E0',       // 藕荷粉（右下）

  // 修正：以下三个原按 CSS #RRGGBBAA 写，真机渲染成不透明淡黄，毛玻璃效果完全失效
  glassFill: '#CCFFFFFF',     // 80% 白
  glassStroke: '#80FFFFFF',   // 50% 白
  glassHighlight: '#E0FFFFFF',// 88% 白

  // 修正：原 '#995F2C1A' → A=99(60%) R=5F G=2C B=1A，把 10% 棕阴影渲染成 60% 深褐，卡片像贴了脏边
  shadowCard: '#1A995F2C',    // 10% 棕
  // 修正：原 '#0A000000' → A=00 完全透明，阴影直接消失（这是「没有立体感」的直接原因）
  shadowAmbient: '#0A000000'  // 4% 黑
};

/* ====================== 暗色（对齐安卓 md_theme_dark_*：深暖炭灰，非纯黑） ====================== */
export const DARK: ColorTokens = {
  brand: '#B6753B',
  brandLight: '#D39562',
  brandLighter: '#61370D',
  brandBg: '#342C26',
  brandBgLight: '#3F342B',
  iconBgNeutral: '#332B25',   // 暗色 emoji 图标底：略亮于卡片，托住 emoji
  onPrimary: '#0D0804',
  onPrimaryContainer: '#F8D7BE',

  // 暗色语义色：暗底上要「提亮」而非降饱和 —— 降饱和会同时降亮度，对比更差。
  // 原 #ED324B 对比仅 3.78:1 不达 AA；降饱和候选 #E05A6E 反而只有 4.29:1。
  income: '#F0707F',   // V=94% 对比 5.37:1
  expense: '#5CAE8A',  // S 从 100%→47% 对比 5.77:1
  teal: '#4DD0C4',
  fabBg: '#111827',

  textPrimary: '#EAE3DE',
  textSecondary: '#AAA39D',
  placeholder: '#8A817A',

  background: '#18130E',
  surface: '#29231D',
  surfaceVariant: '#39312B',
  card: '#29231D',
  cardGlass: '#8C29231D',    // 55% 深棕 — 暗色下的 Card 底，同样透柔光
  pageBg: '#18130E',
  glassBorder: '#26FFFFFF',  // 修正：15% 白发丝边
  glassHi: '#33FFFFFF',      // 修正：20% 白高光

  divider: '#39312B',
  outline: '#5E5650',
  outlineVariant: '#3A332E',

  // 暗色下 onError 是深色 #0D0804，所以 dangerStrong 走「亮底红 + 深字」路线
  // （与亮色的「深底红 + 白字」镜像对称）。#F2607A 上深字 5.86:1 ✓
  danger: '#ED324B',
  dangerStrong: '#F2607A',   // 深字 5.86:1 ✓（#ED324B 只有 4.49:1）
  error: '#ED324B',
  onError: '#0D0804',
  errorContainer: '#3A1018',
  onErrorContainer: '#ED324B',

  brandGradStart: '#9F6440',
  brandGradMid: '#B6753B',
  brandGradEnd: '#7A4823',

  accent1: '#818CF8',  // 亮蓝紫
  accent2: '#34D399',  // 薄荷绿
  accent3: '#FBBF24',  // 暖琥珀
  accent4: '#F472B6',  // 亮粉

  // 暗色环境光：在 #18130E 深底上做极轻的暖调提亮，同样避免色块
  ambient1: '#33261B',       // 暖橘微光（右上）
  ambient2: '#302119',       // 暮霞微光（左上）
  ambient3: '#2A2620',       // 米杏微光（左下）
  ambient4: '#312320',       // 藕荷微光（右下）

  // 修正 ARGB 顺序（原按 CSS 写，暗色下毛玻璃变蓝紫）
  glassFill: '#CC29231D',    // 80% 深棕
  glassStroke: '#26FFFFFF',  // 15% 白
  glassHighlight: '#33FFFFFF',// 20% 白

  shadowCard: '#40000000',   // 修正：25% 黑（原 '#00000040' → A=00 阴影消失）
  shadowAmbient: '#26000000' // 修正：15% 黑
};

const _active: ColorTokens = { ...LIGHT };
/** 当前生效色板（同一引用，页面直接 import 使用） */
export const COLORS: ColorTokens = _active;

function syncTokens(t: ColorTokens): void {
  _active.brand = t.brand;
  _active.brandLight = t.brandLight;
  _active.brandLighter = t.brandLighter;
  _active.brandBg = t.brandBg;
  _active.brandBgLight = t.brandBgLight;
  _active.onPrimary = t.onPrimary;
  _active.onPrimaryContainer = t.onPrimaryContainer;

  _active.income = t.income;
  _active.expense = t.expense;
  _active.teal = t.teal;
  _active.fabBg = t.fabBg;

  _active.textPrimary = t.textPrimary;
  _active.textSecondary = t.textSecondary;
  _active.placeholder = t.placeholder;

  _active.background = t.background;
  _active.surface = t.surface;
  _active.surfaceVariant = t.surfaceVariant;
  _active.card = t.card;
  _active.cardGlass = t.cardGlass;
  _active.pageBg = t.pageBg;
  _active.glassBorder = t.glassBorder;
  _active.glassHi = t.glassHi;

  _active.divider = t.divider;
  _active.outline = t.outline;
  _active.outlineVariant = t.outlineVariant;

  _active.danger = t.danger;
  _active.error = t.error;
  _active.onError = t.onError;
  _active.errorContainer = t.errorContainer;
  _active.onErrorContainer = t.onErrorContainer;

  _active.brandGradStart = t.brandGradStart;
  _active.brandGradMid = t.brandGradMid;
  _active.brandGradEnd = t.brandGradEnd;

  _active.accent1 = t.accent1;
  _active.accent2 = t.accent2;
  _active.accent3 = t.accent3;
  _active.accent4 = t.accent4;

  _active.ambient1 = t.ambient1;
  _active.ambient2 = t.ambient2;
  _active.ambient3 = t.ambient3;
  _active.ambient4 = t.ambient4;

  _active.glassFill = t.glassFill;
  _active.glassStroke = t.glassStroke;
  _active.glassHighlight = t.glassHighlight;

  _active.shadowCard = t.shadowCard;
  _active.shadowAmbient = t.shadowAmbient;
}

/** 根据 themeMode / 系统暗色，把 COLORS 同步为对应色板 */
export function applyTheme(): void {
  syncTokens(isDarkMode() ? DARK : LIGHT);
}

/** 读取当前主题模式：'light' | 'dark' | 'system' */
export function themeMode(): string {
  return (AppStorage.get('themeMode') as string) || 'system';
}

/** 是否深色模式（system 时跟随系统，此处用 AppStorage.isSystemDark 标记，由 EntryAbility 写入） */
export function isDarkMode(): boolean {
  const m = themeMode();
  if (m === 'dark') return true;
  if (m === 'light') return false;
  return (AppStorage.get('isSystemDark') as boolean) || false;
}

/** 收入为正、支出为负时的金额颜色 */
export function amountColor(type: string): string {
  if (type === 'income') return COLORS.income;
  if (type === 'expense') return COLORS.expense;
  return COLORS.textPrimary;
}

/** 货币符号表（ISO 4217）。未列出的代码用「代码+空格」兜底（如「KRW 」）。 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  HKD: 'HK$', TWD: 'NT$', KRW: '₩', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', CHF: 'CHF ', NZD: 'NZ$', THB: '฿', INR: '₹',
  RUB: '₽', BRL: 'R$', MXN: 'MX$'
};

/**
 * 多币种 P2-3a：取货币符号。null/undefined/空串统一兜底 CNY。
 *
 * ⚠️ 为什么参数是 string 而不是 string | null：
 * ArkTS 1.1 严格模式下函数签名不允许 `?:` 标记可空参数，调用方必须传值。
 * 但服务端返回的 currency 字段可能是 undefined（字段缺失）或空串（脏数据），
 * 内部统一 `(cur || 'CNY')` 兜底，保证 UI 不显示「undefined」、「 」这种脏值。
 */
export function currencySymbol(cur: string): string {
  const c = (cur || 'CNY').toUpperCase();
  const sym = CURRENCY_SYMBOLS[c];
  if (sym) return sym;
  return c + ' ';
}

/** ¥ 金额格式化，保留两位。多币种 P2-3a：currency 可选，默认 CNY，向后兼容。 */
export function fmtMoney(n: number, currency: string = 'CNY'): string {
  const v = Number(n) || 0;
  const neg = v < 0;
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + currencySymbol(currency) + s;
}

/** 带正负号金额（收支/收益用），多币种 P2-3a：currency 可选 */
export function fmtMoneySigned(n: number, currency: string = 'CNY'): string {
  const sign = n >= 0 ? '+' : '-';
  return sign + fmtMoney(Math.abs(n), currency);
}

/**
 * 多币种 P2-3a：按 breakdown 智能格式化。
 *
 * - breakdown 为空：返回「¥0.00」
 * - 单币种：等同于 fmtMoney
 * - 多币种：主货币值用大字号展示，附属币种以小括号附注
 *   例：¥1,000.00 ($50.00) +€20.00
 *
 * baseCurrency 默认 CNY；调用方传对应主货币（dashboard.month.currency
 * / report.summary.currency 等）以决定哪个币种被放到主位。
 */
export function fmtMoneyMix(
  breakdown: Record<string, number> | null | undefined,
  baseCurrency: string = 'CNY'
): string {
  const base = (baseCurrency || 'CNY').toUpperCase();
  if (breakdown == null) return fmtMoney(0, base);
  const entries: Array<[string, number]> = [];
  const keys = Object.keys(breakdown);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = breakdown[k];
    if (v != null && Math.abs(v) > 0.001) {
      entries.push([k.toUpperCase(), v]);
    }
  }
  if (entries.length === 0) return fmtMoney(0, base);
  let baseVal = 0;
  const others: Array<[string, number]> = [];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (item[0] === base) {
      baseVal = item[1];
    } else {
      others.push(item);
    }
  }
  let s = fmtMoney(baseVal, base);
  for (let i = 0; i < others.length; i++) {
    s += ' (' + fmtMoney(others[i][1], others[i][0]) + ')';
  }
  return s;
}

/**
 * 汇总行专用金额格式：<1万 完整保留分，≥1万 缩写成 ¥1.90万。
 *
 * ⚠️ 为什么需要它而不是直接用 fmtMoney：
 * 「日期 + 收 + 支 + 结余」这类一行四项的汇总行，宽度是硬约束。
 * 360vp 屏减去卡片与行内 padding 只剩 328vp，而 fmtMoney 下
 * `收 ¥19,023.00` + `支 ¥1,797.00` + `结余 +¥17,226.00` 就要 258vp，
 * 加上日期必然溢出 —— 表现为某一项被挤到换行（见 style-guide §38）。
 *
 * 分档而不是统一缩写：日常单天金额几乎都在 1 万以下（¥50.00 / ¥1,797.00），
 * 这部分零精度损失；只有大额日才缩写，而缩写恰好也是宽度最紧张的时候。
 * 保留 2 位小数 → ¥1.90万 精确到百元，配合下方明细列表足够读懂量级。
 *
 * 多币种 P2-3a：非 CNY 直接走 fmtMoney（不缩写，避免误读）。缩写档位
 * 仅对 CNY 生效，因为「¥1.90万」这种「中文 + 万」是大陆习惯，外币用
 * 全精度显示更准确。
 */
export function fmtMoneyShort(n: number, currency: string = 'CNY'): string {
  const cur = (currency || 'CNY').toUpperCase();
  if (cur !== 'CNY') return fmtMoney(n, cur);
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 100000000) return sign + '¥' + (a / 100000000).toFixed(2) + '亿';
  if (a >= 10000) return sign + '¥' + (a / 10000).toFixed(2) + '万';
  return fmtMoney(v, cur);
}

/**
 * 多币种 P2-3c：把一个含 (currency, amount) 的数组按 currency 聚合为 breakdown。
 *
 * 用法：传入 [{currency:'CNY',amount:100}, {currency:'USD',amount:50}, {currency:'CNY',amount:30}]
 *      返回 {CNY: 130, USD: 50} —— 后端 transactions.js summary 接口同构输出。
 *
 * 旧字段 amount 是同结构 number；TransactionItem.amount 也是 number。
 * 直接用 amount 当数值、currency 当键；缺币种时归到 CNY 兜底（与后端兜底链一致）。
 *
 * 与 fmtMoneyMix 配对：sumByCurrency 拿到 breakdown → fmtMoneyMix(breakdown) 智能混显。
 */
export function sumByCurrency(
  items: Array<{ currency?: string; amount: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it == null) continue;
    const cur = ((it.currency || 'CNY') + '').toUpperCase();
    const v = Number(it.amount) || 0;
    if (out[cur] == null) out[cur] = 0;
    out[cur] += v;
  }
  return out;
}

/**
 * 多币种 P2-3c：判断 breakdown 是否只含一种币种（或全空）。
 * 单币种账本下退化场景：直接用 fmtMoney(value, currency) 渲染比 fmtMoneyMix 更紧凑。
 */
export function isSingleCurrency(b: Record<string, number> | null | undefined): boolean {
  if (!b) return true;
  let n = 0;
  const keys = Object.keys(b);
  for (let i = 0; i < keys.length; i++) {
    if (Math.abs(Number(b[keys[i]]) || 0) > 0.001) n++;
    if (n > 1) return false;
  }
  return true;
}

/**
 * 日期标签紧凑化：'2026-08-28' → '8月28日'。
 *
 * ⚠️ 这不是单纯为省宽度做的妥协，而是去掉真正冗余的信息：
 * 这个标签出现在「月份导航已写明 2026年8月」的上下文里，
 * 再重复一次年份等于用 4 个字符表达 0 比特信息。
 * 顺带把 10 字符压到 7 字符（15sp 下 83vp → 53vp）。
 *
 * 传入 'YYYY-MM'（按年查看时的月分组）时返回 '2026年8月' ——
 * 此时年份不冗余（跨年数据里 8月 有歧义），必须保留。
 */
export function fmtDayLabel(d: string): string {
  const s = d || '';
  const p = s.split('-');
  // ⚠️ p[2] 必须 slice(0,2)：若传入带时间的 '2026-08-28 14:30:00'，
  // Number('28 14:30:00') 得 NaN，界面会显示「8月NaN日」。
  // 当前两个调用点传的都是已 slice(0,10) 的值，但这是调用方的约定、不是函数的保证 ——
  // 下一个调用者直接传 item.date（含时间）就会中招。
  if (p.length >= 3) return `${Number(p[1])}月${Number(p[2].slice(0, 2))}日`;
  if (p.length === 2) return `${p[0]}年${Number(p[1])}月`;
  return s;
}

/** 金额紧凑缩写（对齐安卓 CalendarCell.formatCompact）：<1万原样，≥1万 X.XX万，≥1亿 X.XX亿 */
export function formatCompact(v: number): string {
  const n = Number(v) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(2) + '万';
  return n.toFixed(2);
}

/**
 * 日历格专用超短金额格式。
 *
 * 日历格只有屏宽 1/7 ≈ 46vp，9sp 下最多容纳 6 个字符。
 * 安卓端统一 toFixed(2)（1045.10 / 4974.01），8sp 下 7 字符刚好塞得进；
 * 鸿蒙字号大 1，同样内容会溢出，所以按量级分档而不是照抄。
 *
 * 规则：>=1亿 → 1.2亿 / >=1万 → 1.6万 / <100 → 5.47 保留分 / 其余取整 1045
 *
 * 为什么 100 以下必须保留小数：抹掉后「0.50」变「1」（四舍五入还会变错）、
 * 「5.47」变「5」—— 早餐 9 块、零食 5.47 这种小额记账是最高频场景，
 * 取整等于显示了个错数字。100 以上小数位对「哪天花得多」没有贡献，可以牺牲。
 */
export function formatCalAmount(v: number): string {
  const n = Math.abs(Number(v) || 0);
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n < 100) return n.toFixed(2);
  return n.toFixed(0);
}

/* ====================== 栅格常量（阶段 1 新增） ====================== */
/**
 * 间距栅格：8dp 为基础单元，所有 padding/spacing 必须从这套取值，避免 12/14/16/20 混用
 *   xs(4)  - 微间距（图标与文字、紧密 chip 内 padding）
 *   sm(8)  - 紧凑间距（行内元素间距）
 *   md(12) - 标准卡片内边距
 *   lg(16) - 大块卡片内边距 / 段落间距
 *   xl(24) - 区域间距（卡片与卡片之间）
 *   xxl(32) - 顶部大留白
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

/**
 * 布局尺寸常量。
 *
 * ⚠️ bottomNavSafe 是必须的，不是可选的美化：
 * 底部导航栏高 64 且已改为 88% 半透明 —— 半透明之前不透明白底还能"挡住"
 * 滚动到底的内容，改半透明后内容会直接从导航栏下方透出，和「首页/账单/统计/我的」
 * 四个标签叠字。所有可滚动页面的内容底部都必须留出 bottomNavSafe。
 *
 * 写法：Scroll 内层容器 .padding({ left:12, right:12, top:12, bottom: LAYOUT.bottomNavSafe })
 * 不要写 .padding(12) —— 四边均匀会让底部只有 12，一定叠字。
 */
export const LAYOUT = {
  bottomNavH: 64,        // 底部导航栏高度
  bottomNavSafe: 80,     // 64 栏高 + 16 呼吸空间：滚动内容底部安全区
  topBarH: 52,           // 顶栏高度
  fabSafe: 76            // FAB 定位在 88%，列表最后一项需留出避让空间
} as const;

/**
 * 用户自选色板 —— 分类 / 标签的 `color` 字段可选值。
 *
 * ⚠️ 为什么必须统一饱和度：
 * 旧板混了两套体系 —— 前 7 个是高饱和（S=63~100%，含已淘汰的 #C11435/#009558），
 * 后 3 个是从 Charts.ets 的 SLICE_PALETTE 抄来的莫兰迪色（S=8~13%）。
 * 结果是「用户挑到前 7 个就与暖棕品牌撞色，挑到后 3 个才和谐」——
 * 调色板本身在诱导用户做出难看的选择。饱和度极差 92 是设计缺陷，不是丰富度。
 *
 * 本板统一 S=8~34%（极差 26）、V=75~87%（极差 13），色相绕满一圈：
 *   暖棕 26° → 赭红 5° → 橘杏 28° → 芥黄 45° → 橄榄 72°
 *   → 青瓷 157° → 雾蓝 204° → 藕紫 269° → 玫粉 333° → 石灰 32°
 *
 * 核算依据（emoji 自身多为深色描边，按 #3A3A3A 判定）：
 *   - 作为 emoji 圆底时对比度 4.81~6.58:1，全部达 AA
 *   - 相邻色单通道差 13~30，全部 ≥12 可辨（0 处偏近）
 *   - 前 4 色刻意贴近品牌棕色相（距离 1~23°），让"默认选择"就是协调的
 *
 * ⚠️ 不要往这里加高饱和色。若需要强调，用 COLORS.brand 或语义色，
 * 不要指望用户自己挑出协调的颜色。
 */
export const USER_PALETTE: string[] = [
  '#C8A184', // 暖棕 — 与品牌同源，默认值
  '#D3A19C', // 赭红
  '#DFB795', // 橘杏
  '#D6C48F', // 芥黄
  '#B8C098', // 橄榄
  '#9DC2B4', // 青瓷
  '#9FB8C9', // 雾蓝
  '#BCAECB', // 藕紫
  '#D4A8BC', // 玫粉
  '#BFB8B0'  // 石灰
];

/**
 * 圆角档位（替代散落的 10/12/14/16/18/20/22/24/26/28/32/50）：
 *   sm(8)   - 小元素（chip / 标签）
 *   md(12)  - 中等（卡片 / 输入框）
 *   lg(16)  - 标准（卡片 / 弹层顶部）
 *   xl(24)  - 大型（Hero 渐变卡 / 弹窗）
 *   pill(999) - 胶囊（chip 按钮 / FAB）
 */
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999
} as const;

/**
 * 阴影色值（用 ShadowOptions.color 字符串传入）：
 *   card  - 卡片 1dp 轻浮（页面主要表面）
 *   fab   - FAB 抬起（强品牌色阴影）
 *   sheet - 底部弹窗升起（中性深色阴影）
 *
 * ⚠️ 全部按 ArkUI 的 #AARRGGBB 书写（Alpha 在前）。
 * 修正前三个值按 CSS #RRGGBBAA 写，导致 card/sheet 的 A=00 完全透明——
 * 「卡片没有立体感、弹层浮不起来」就是这里造成的。
 */
export const SHADOW = {
  card: '#0A000000',     // 4% 黑（原 #0000000A 顺序写反 → A=00 完全透明）
  fab: '#55995F2C',      // 33% 品牌棕（原 #995F2C55 → 渲染成 60% 深褐）
  sheet: '#1A000000'     // 10% 黑（原 #0000001A → A=00 完全透明）
} as const;

/* ====================== 字体 token（阶段 2/3 增量引入） ====================== */
/**
 * 字号档位（与 Material 3 Typography + 安卓 Type.kt 对齐）：
 *   display 34 - Hero 大额数字
 *   title   22 - 弹层标题 / 卡片标题
 *   body    15 - 正文
 *   label   13 - chip / 按钮
 *   caption 11 - 时间戳 / 提示
 */
export const FONT_SIZE = {
  display: 34,
  title: 22,
  body: 15,
  label: 13,
  caption: 11
} as const;

// 模块加载时按当前主题模式初始化一次色板（页面首帧前完成）
applyTheme();
