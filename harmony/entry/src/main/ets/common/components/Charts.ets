/**
 * Canvas 图表组件（1:1 对齐安卓端 Charts.kt 的 DonutChart / TrendLineChartSingle）。
 * - DonutChart：细环（cutout 72%）+ 圆角扇区 + 暖白细缝 + 中心读数，式样对齐 web Chart.js doughnut。
 * - TrendChart：单系列折线 + 浅色填充 + 峰值点高亮 + 点击取点联动。
 * - SLICE_PALETTE：莫兰迪 10 色低饱和配色，供环图/条形共用。
 */
import { COLORS } from '../theme';

/**
 * 分类占比配色：莫兰迪低饱和色系。
 *
 * 三端同源（安卓 Charts.kt:SLICE_PALETTE / web chart.js:cats），
 * 由 scripts/gen-morandi-palette.js 按 HSV 换算并校验后固化 —— 改色请改脚本重跑，
 * 不要手改 hex，三处不一致时同一笔支出在三端会是三种颜色。
 *
 * 约束（脚本强制校验，全部通过）：
 *   S=16~32%  低饱和莫兰迪区间
 *   相邻色相距离 ≥90°  环图按金额降序上色，数组相邻项必然在环上并排
 *   白底/暗底对比 ≥1.6:1  低于此值色块会和卡片底融掉
 */
export const SLICE_PALETTE: string[] = [
  '#B89881', // 暖陶棕（品牌同调）
  '#84B3AC', // 青瓷绿
  '#B38581', // 赭石红
  '#88A4B8', // 雾霾蓝
  '#BDAF84', // 芥末黄
  '#AA8FB8', // 藕荷紫
  '#9AB388', // 橄榄绿
  '#B88C9A', // 干玫瑰
  '#9797B8', // 灰蓝紫
  '#A7C7AC'  // 浅灰绿
];

export interface DonutPiece {
  name: string;
  value: number;
  color?: string;
  icon?: string;
}

/**
 * 环形图 —— 对齐 web 端 Chart.js doughnut 式样（public/js/managers/chart.js:230-267）
 * 与安卓 Charts.kt:DonutChart 完全同构。
 *
 * web 观感由四个参数构成，逐项等价实现：
 *   cutout: '72%'    → 内径 = 外径 × 0.72，细环 + 大留白中心
 *   spacing: 2 + borderWidth: 3 → 扇区两端各内缩，透出卡片底色成「暖白细缝」
 *   borderRadius: 6  → 扇区四角圆角（胶囊感）
 *   hoverOffset: 8   → 选中扇区径向外扩
 *   legend: false    → 无图例，中心数字代替
 *
 * 相比旧实现去掉了两样东西（都是为了贴 web）：
 *   1) 灰色轨道整圆 —— web 没有 track，细环下那道灰边非常显眼
 *   2) 四角引线标注 —— web 用 tooltip；引线在细环上斜穿整图是原先显乱的主因，
 *      移动端的等价物是「中心文字切换为选中分类」，已由调用方 centerTitle 承担
 */
@Component
export struct DonutChart {
  @Prop @Watch('redraw') data: DonutPiece[] = [];
  @Prop @Watch('redraw') selectedIndex: number = -1;
  @Prop centerTitle: string = '';
  @Prop centerValue: string = '';
  onSliceClick?: (index: number) => void;
  private context: CanvasRenderingContext2D = new CanvasRenderingContext2D();
  private ready: boolean = false;

  // ──── 环图几何（数值来源：web Chart.js 配置，与安卓 Charts.kt 常量一一对应）────
  /** 画布尺寸：环外径 + 选中外扩余量 ×2 */
  private readonly SIZE: number = 220;
  /** 环外径 */
  private readonly OUTER: number = 200;
  /** 内径占外径比，对齐 web cutout: '72%' */
  private readonly CUTOUT: number = 0.72;
  /** 扇区间隙弧长(vp)，对齐 web spacing:2 + borderWidth:3 */
  private readonly GAP: number = 4;
  /** 扇区圆角(vp)，对齐 web borderRadius: 6 */
  private readonly CORNER: number = 6;
  /** 选中外扩(vp)，对齐 web hoverOffset: 8 */
  private readonly HOVER: number = 8;

  // ──── 动效状态（对齐 web animation 配置）────
  //
  // Canvas 不像声明式组件那样能被 animateTo 自动补间 —— 必须自己驱动进度值，
  // 每帧用新进度重画。两个进度：
  //   growth  0→1：入场，同时驱动扫过角度与半径缩放（= animateRotate + animateScale）
  //   selProg 0→1：选中扇区外扩量，让 hoverOffset 有过渡而非瞬跳
  /** 入场进度 0→1 */
  @State private growth: number = 0;
  /** 选中外扩进度 0→1 */
  @State private selProg: number = 0;
  /** 上一次选中索引，用于判断「换了扇区」只跑外扩动画、不重播入场 */
  private lastSel: number = -1;
  private growthTimer: number = -1;
  private selTimer: number = -1;

  /** easeOutQuart —— 与 web 端 easing 一致：起步快、尾段柔和收住 */
  private easeOutQuart(t: number): number {
    const c = 1 - t;
    return 1 - c * c * c * c;
  }

  /** 仅取正数并按值降序（与安卓一致） */
  private positive(): DonutPiece[] {
    return this.data.filter((d) => (d.value || 0) > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
  }

  private total(): number {
    let s = 0;
    this.positive().forEach((d) => { s += (d.value || 0); });
    return s || 0.0001;
  }

  redraw(): void {
    if (!this.ready) return;
    // 选中索引变化 → 只跑外扩过渡，不重播入场动画。
    // 否则每点一次色块整个环图都从 0 重新长出来，点击变成一件「有代价」的事。
    if (this.selectedIndex !== this.lastSel) {
      this.lastSel = this.selectedIndex;
      this.animateSelection();
      return;
    }
    // 数据变化（切周期/切维度）→ 重播入场
    this.animateGrowth();
  }

  /** 入场：扫过角度 + 半径缩放，对齐 web animateRotate + animateScale */
  private animateGrowth(): void {
    if (this.growthTimer >= 0) { clearInterval(this.growthTimer); this.growthTimer = -1; }
    this.growth = 0;
    const DUR = 800;          // 与 web duration: 800 一致
    const STEP = 16;          // ≈60fps
    let elapsed = 0;
    this.growthTimer = setInterval(() => {
      elapsed += STEP;
      const raw = elapsed / DUR;
      if (raw >= 1) {
        this.growth = 1;
        clearInterval(this.growthTimer);
        this.growthTimer = -1;
      } else {
        this.growth = this.easeOutQuart(raw);
      }
      this.draw();
    }, STEP);
  }

  /** 选中外扩过渡：对齐 web hoverOffset 的滑出感（比入场短，交互反馈要快） */
  private animateSelection(): void {
    if (this.selTimer >= 0) { clearInterval(this.selTimer); this.selTimer = -1; }
    if (this.selectedIndex < 0) {
      // 取消选中：直接归零并重画（外扩块本来就要收回去，不需要过渡）
      this.selProg = 0;
      this.draw();
      return;
    }
    this.selProg = 0;
    const DUR = 260;
    const STEP = 16;
    let elapsed = 0;
    this.selTimer = setInterval(() => {
      elapsed += STEP;
      const raw = elapsed / DUR;
      if (raw >= 1) {
        this.selProg = 1;
        clearInterval(this.selTimer);
        this.selTimer = -1;
      } else {
        this.selProg = this.easeOutQuart(raw);
      }
      this.draw();
    }, STEP);
  }

  aboutToDisappear(): void {
    // 页面销毁时必须清定时器 —— 否则 setInterval 持续回调已析构的组件，
    // 且每次进出统计页都会多留一个计时器，越用越卡。
    if (this.growthTimer >= 0) clearInterval(this.growthTimer);
    if (this.selTimer >= 0) clearInterval(this.selTimer);
  }

  private handleTouch(e: TouchEvent): void {
    if (!this.onSliceClick) return;
    const ev: TouchObject | undefined = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!ev) return;
    const cx = this.SIZE / 2;
    const cy = this.SIZE / 2;
    const dx = ev.x - cx;
    const dy = ev.y - cy;
    // 命中带用「满半径」而不是当前动画半径 —— 入场途中半径在 88%~100% 渐变，
    // 跟着动画走会让判定带在 800ms 内浮动，同一位置点两次可能一次中一次不中。
    // 两侧各放宽 6vp 容错（手指比细环粗，环厚只有 28vp）。
    const rOuter = this.OUTER / 2;
    const rInner = rOuter * this.CUTOUT;
    const slack = 6;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rInner - slack || dist > rOuter + slack) return;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a < -90) a += 360;
    const pos = this.positive();
    const tot = this.total();
    let acc = -90;
    for (let i = 0; i < pos.length; i++) {
      const sweep = (pos[i].value / tot) * 360;
      if (a >= acc && a < acc + sweep) { this.onSliceClick!(i); return; }
      acc += sweep;
    }
  }

  /**
   * 描出「四角圆角的环形扇区」路径 —— web borderRadius: 6 的等价实现。
   *
   * 为什么不用 arc + lineWidth 描边：Canvas 的 lineCap='round' 圆头半径固定 = lineWidth/2
   * （细环下是 14vp），压不到 web 的 6；且 lineCap 只能圆两端，做不出「四角都圆」。
   *
   * 路径顺序：外弧 → 末端外圆角 → 径向内收 → 末端内圆角 → 内弧(反向) → 起端两圆角 → 闭合。
   * 圆角用二次贝塞尔近似（控制点取真实直角顶点），6vp 尺度下与真圆弧偏差 <0.4vp，肉眼不可辨。
   *
   * 角度单位为弧度。corner 传 0 得到直角扇区（入场途中用）。
   */
  private ringSegment(
    cx: number, cy: number, rOuter: number, rInner: number,
    start: number, sweep: number, corner: number
  ): void {
    const ctx = this.context;
    const px = (r: number, a: number): number => cx + r * Math.cos(a);
    const py = (r: number, a: number): number => cy + r * Math.sin(a);
    const end = start + sweep;

    // 圆角在外/内弧上占的角度不同（同弧长，半径小则角度大）。
    // 扇区太窄放不下圆角时退化为直角 —— 硬塞会让路径自交，渲染出「打结」的色块。
    const dOut = corner / Math.max(rOuter, 1);
    const dIn = corner / Math.max(rInner, 1);
    const fits = corner > 0 && sweep > (dOut + dIn) * 1.6 && (rOuter - rInner) > corner * 2;

    ctx.beginPath();
    if (!fits) {
      ctx.arc(cx, cy, rOuter, start, end);
      ctx.lineTo(px(rInner, end), py(rInner, end));
      ctx.arc(cx, cy, rInner, end, start, true);
      ctx.closePath();
      return;
    }

    // 1) 外弧（两端各让出圆角）
    ctx.arc(cx, cy, rOuter, start + dOut, end - dOut);
    // 2) 末端外角：外弧 → 径向内收
    ctx.quadraticCurveTo(px(rOuter, end), py(rOuter, end), px(rOuter - corner, end), py(rOuter - corner, end));
    // 3) 末端径向边
    ctx.lineTo(px(rInner + corner, end), py(rInner + corner, end));
    // 4) 末端内角：径向 → 内弧
    ctx.quadraticCurveTo(px(rInner, end), py(rInner, end), px(rInner, end - dIn), py(rInner, end - dIn));
    // 5) 内弧（反向回到起端）
    ctx.arc(cx, cy, rInner, end - dIn, start + dIn, true);
    // 6) 起端内角：内弧 → 径向外扩
    ctx.quadraticCurveTo(px(rInner, start), py(rInner, start), px(rInner + corner, start), py(rInner + corner, start));
    // 7) 起端径向边
    ctx.lineTo(px(rOuter - corner, start), py(rOuter - corner, start));
    // 8) 起端外角：径向 → 外弧起点
    ctx.quadraticCurveTo(px(rOuter, start), py(rOuter, start), px(rOuter, start + dOut), py(rOuter, start + dOut));
    ctx.closePath();
  }

  draw(): void {
    const ctx = this.context;
    const S = this.SIZE;
    ctx.clearRect(0, 0, S, S);
    const pos = this.positive();
    if (pos.length === 0) return;
    const tot = this.total();
    const cx = S / 2;
    const cy = S / 2;

    // 入场：animateScale 半径 88%→100%（不从 0 起，从一点炸开会在前 200ms 糊成一团）
    const g = this.growth;
    const rOuter = (this.OUTER / 2) * (0.88 + 0.12 * g);
    const rInner = rOuter * this.CUTOUT;
    const thickness = rOuter - rInner;
    // animateRotate：扫过总角度 0→2π
    const sweepTotal = Math.PI * 2 * g;
    // 间隙角度：GAP 弧长换算到外半径处
    const gapRad = this.GAP / Math.max(rOuter, 1);
    // 圆角不能超过环厚一半，否则圆角自交
    const corner = Math.min(this.CORNER, thickness / 2);
    const explode = this.HOVER * this.selProg;
    const single = pos.length === 1;

    let start = -Math.PI / 2;
    pos.forEach((d, i) => {
      const sweepFull = (d.value / tot) * Math.PI * 2;
      // 入场裁剪：只画落在 [起点, 起点+sweepTotal] 内的部分
      const drawn = Math.max(0, Math.min(sweepFull, (-Math.PI / 2 + sweepTotal) - start));
      if (drawn <= 0) { start += sweepFull; return; }

      // 两端各内缩 gap/2 形成暖白细缝。单一分类占满整圈时不留缝
      // —— 留了会在正上方出现一道无意义的豁口。
      const half = single ? 0 : gapRad / 2;
      const a0 = start + half;
      const a1 = start + drawn - half;
      if (a1 <= a0) { start += sweepFull; return; }

      // 选中扇区：径向外扩（web hoverOffset）+ 略加厚。
      // 触屏没有 hover，只靠位移不够明显，加厚让它「浮」出来。
      const isSel = i === this.selectedIndex;
      const mid = (a0 + a1) / 2;
      const ox = isSel ? Math.cos(mid) * explode : 0;
      const oy = isSel ? Math.sin(mid) * explode : 0;
      const ro = isSel ? rOuter + 2 * this.selProg : rOuter;
      const ri = isSel ? rInner - 1 * this.selProg : rInner;

      // 圆角只在整段画完后收 —— 入场途中末端是「正在生长的切口」，圆角会让端点看起来在抖
      const complete = drawn >= sweepFull - 1e-6;
      this.ringSegment(cx + ox, cy + oy, ro, ri, a0, a1 - a0, complete ? corner : 0);
      ctx.fillStyle = d.color || SLICE_PALETTE[i % SLICE_PALETTE.length];
      ctx.fill();
      start += sweepFull;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Stack() {
        Canvas(this.context)
          .width(this.SIZE).height(this.SIZE)
          .onReady(() => {
            this.ready = true;
            this.lastSel = this.selectedIndex;
            this.animateGrowth();     // 首次进入播入场动画（对齐 web 的进场观感）
          })
      }.width(this.SIZE).height(this.SIZE).onTouch((e: TouchEvent) => this.handleTouch(e))

      // 中心读数（对齐 web centerTextPlugin：小字标题 + 大字金额，无图例）
      Column({ space: 2 }) {
        if (this.centerTitle) {
          Text(this.centerTitle).fontSize(13).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            .width(this.OUTER * this.CUTOUT - 20)
            .textAlign(TextAlign.Center)
        }
        if (this.centerValue) {
          // 环心可用宽 = 内径(144) - 20 余量 = 124vp。
          // 22sp 下 ¥123,456.78 约 122vp 刚好，但 ¥1,234,567.89 会超 —— 超出部分会压到色带上，
          // 视觉上文字「骑」在环里。这里等比缩字而不缩写，保留完整精度
          //（环心是本页最主要的读数位置）。
          Text(this.centerValue)
            .fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
            .minFontSize(15).maxFontSize(22)
            .heightAdaptivePolicy(TextHeightAdaptivePolicy.LAYOUT_CONSTRAINT_FIRST)
            .maxLines(1)
            .width(this.OUTER * this.CUTOUT - 20)
            .textAlign(TextAlign.Center)
        }
      }
      .hitTestBehavior(HitTestMode.None)
    }.width(this.SIZE).height(this.SIZE)
  }
}

/** 折线趋势图（对齐安卓 TrendLineChartSingle：峰值高亮 + 点击取点） */
@Component
export struct TrendChart {
  @Prop @Watch('redraw') points: number[] = [];
  @Prop @Watch('redraw') labels: string[] = [];
  /**
   * 折线主色。默认品牌棕；统计页按维度传入（支出绿 / 收入红 / 结余棕）——
   * 卡内标题右侧的「累计支出」文字也是这个色，两者必须同色才能让人明白
   * 「这条线画的就是那个数」。硬编码品牌棕会让绿色的累计值配棕色的线。
   */
  @Prop @Watch('redraw') lineColor: string = COLORS.brand;
  @Prop @Watch('redraw') peakIndex: number = -1;
  onTapIndex?: (index: number) => void;
  private context: CanvasRenderingContext2D = new CanvasRenderingContext2D();
  private ready: boolean = false;
  /**
   * 画布宽。Canvas 必须给确定像素宽（'100%' 下 ctx 坐标系拿不到实际值），
   * 所以由调用方按容器算好传进来。
   * 288 = 360(屏) − 16×2(页面) − 16×2(卡片 padding)，正好铺满卡内可用宽。
   * 原先硬编码 340 会横向溢出 44vp，右侧最后几天被卡片圆角裁掉 ——
   * 而月末几天恰恰是用户最关心的。
   */
  @Prop W: number = 288;
  private readonly H: number = 170;

  redraw(): void {
    if (this.ready) this.draw();
  }

  private handleTouch(e: TouchEvent): void {
    if (!this.onTapIndex || this.points.length === 0) return;
    const ev: TouchObject | undefined = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!ev) return;
    const n = this.points.length;
    const idx = n === 1 ? 0 : Math.round((ev.x / this.W) * (n - 1));
    this.onTapIndex(Math.max(0, Math.min(n - 1, idx)));
  }

  draw(): void {
    const ctx = this.context;
    const w = this.W, h = this.H;
    ctx.clearRect(0, 0, w, h);
    const pts = this.points;
    if (pts.length === 0) return;
    const maxV = Math.max(...pts, 0.0001);

    // 内边距非对称：左侧留 44 给 Y 轴金额刻度，底部留 22 给 X 轴日期。
    // 原来四边统一 pad=18 导致刻度无处可画 —— 折线是「好看的装饰」而非可读图表。
    const padL = 44, padR = 10, padT = 14, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const n = pts.length;
    const xAt = (i: number): number => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
    const yAt = (v: number): number => padT + plotH - (v / maxV) * plotH;

    // ---- Y 轴：4 条水平网格线 + 金额刻度（把「多高」变成可读数字）----
    const niceMax = this.niceCeil(maxV);
    const yAtNice = (v: number): number => padT + plotH - (v / niceMax) * plotH;
    ctx.font = '9vp sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const v = (niceMax / 3) * g;
      const y = yAtNice(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = COLORS.divider;
      ctx.stroke();
      ctx.fillStyle = COLORS.textSecondary;
      ctx.fillText(this.axisLabel(v), padL - 6, y);
    }

    // ---- 面积填充 ----
    ctx.beginPath();
    ctx.moveTo(xAt(0), padT + plotH);
    pts.forEach((p, i) => ctx.lineTo(xAt(i), yAtNice(p)));
    ctx.lineTo(xAt(n - 1), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = this.lineColor;
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 1;

    // ---- 折线 ----
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i), y = yAtNice(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.lineColor;
    ctx.stroke();

    // ---- 数据点 ----
    // 全部日期都画点（对齐安卓）：点是「这一天可以点」的可见提示，
    // 只画峰值时用户不知道折线是可交互的。密集时把半径压到 2 而不是省略 ——
    // 31 个 r=2 的点是刻度感，31 个 r=3 才糊成珠链。
    let max = pts[0];
    pts.forEach((p) => { if (p > max) max = p; });
    const peak = this.peakIndex >= 0 ? this.peakIndex : pts.indexOf(max);
    const dense = n > 14;
    const r = dense ? 2 : 3;
    pts.forEach((p, i) => {
      const isPeak = i === peak;
      ctx.beginPath();
      ctx.arc(xAt(i), yAtNice(p), isPeak ? 4.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = this.lineColor;
      ctx.fill();
      if (isPeak) {
        // 峰值加白色描边，从面积填充里「浮」出来
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.surface;
        ctx.stroke();
      }
    });

    // ---- 峰值数值标注（最有信息量的一个点，直接标出来）----
    if (peak >= 0 && pts[peak] > 0) {
      const px = xAt(peak), py = yAtNice(pts[peak]);
      ctx.font = '10vp sans-serif';
      ctx.fillStyle = this.lineColor;
      // 靠右边缘时标签左对齐避免出界
      const nearRight = px > w - 50;
      ctx.textAlign = nearRight ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.axisLabel(pts[peak]), nearRight ? px - 6 : px + 6, py - 4);
    }

    // ---- X 轴刻度标签 ----
    // 首/中/尾三个太稀（只知道起止，看不出峰值大概在月初还是月末）；
    // 31 个全标一定重叠。做法是**按最小可读间距倒推抽样步长**，而不是先算
    // 「最多放几个」再等距切 —— 后者算出的 maxTicks 不保证抽完之后间距够，
    // 实测 31 个日期抽 10 个时相邻只有 15.6vp，而标签本身要 21.6vp，照样重叠。
    //
    // ⚠️ 标签宽度必须实测，不能写死。按年是月标签（'12月' 18.9vp、'8月' 13.9vp），
    // 按月是日标签（'8/15' 17.6vp）。原来写死 30 的后果是：
    // 12 个月桶只标 7 个 → X 轴变成「1月 3月 5月 7月 8月 10月 12月」，
    // 用户点「按年」本来就是想看 12 个月，这种忽 2 忽 1 的序列比不标更难读。
    if (this.labels.length === n && n > 0) {
      ctx.font = '9vp sans-serif';
      ctx.fillStyle = COLORS.textSecondary;
      ctx.textBaseline = 'top';
      // 取本序列最长标签的实测宽度 + 2vp 间隙。
      // 间隙只留 2 而不是 4：标签是 textAlign center 居中在刻度上的，
      // 2vp 已足够分开；留 4 会让 12 个月桶（间距 21.3 vs slot 22.9）
      // 差 1.6vp 被判为放不下，退化成隔月标 —— 为 1.6vp 牺牲一半信息不值。
      let widest = 0;
      this.labels.forEach((s: string) => {
        const m = ctx.measureText(s);
        if (m.width > widest) widest = m.width;
      });
      const slot = (widest > 0 ? widest : 18) + 2;
      const marks: number[] = [];
      if (n === 1) {
        marks.push(0);
      } else {
        // 相邻数据点像素间距 → 每隔 step 个标一次，实际标签间距 = gapPx × step ≥ slot
        const gapPx = plotW / (n - 1);
        const step = Math.max(1, Math.ceil(slot / gapPx));
        for (let i = 0; i < n; i += step) marks.push(i);
        // 末尾必标：否则看不到区间终点。与前一个标记太近时替换掉它，避免压字。
        const lastIdx = n - 1;
        if (marks[marks.length - 1] !== lastIdx) {
          if (lastIdx - marks[marks.length - 1] < step / 2) { marks.pop(); }
          marks.push(lastIdx);
        }
      }
      marks.forEach((i) => {
        ctx.textAlign = i === 0 ? 'left' : (i === n - 1 ? 'right' : 'center');
        ctx.fillText(this.labels[i], xAt(i), padT + plotH + 6);
      });
    }
  }

  /** 把 max 向上取整到「好看」的刻度值（1/2/5 × 10^k），避免 ¥20904 这种轴上限 */
  private niceCeil(v: number): number {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const f = v / base;
    const nf = f <= 1 ? 1 : (f <= 2 ? 2 : (f <= 5 ? 5 : 10));
    return nf * base;
  }

  /** 轴刻度短格式：1234 → 1.2k，12345 → 1.2万 */
  private axisLabel(v: number): string {
    if (v <= 0) return '0';
    if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(0);
  }

  build() {
    Stack() {
      Canvas(this.context)
        .width(this.W).height(this.H)
        .onReady(() => { this.ready = true; this.draw(); })
        .onTouch((e: TouchEvent) => this.handleTouch(e))
    }.width(this.W).height(this.H)
  }
}
