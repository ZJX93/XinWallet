/**
 * 搜索（对齐安卓 SearchScreen.kt）：防抖搜索 + 高级筛选(金额/日期/类型) + 结果列表。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, TRANSPARENT } from '../common/theme';
import { TopBar, EmptyState, LoadingBox, TransactionRow, Chip, AppBackground } from '../common/components/Components';
import { TransactionItem, Book } from '../common/models';

interface Iface1 {
  key: string;
  label: string;
}

interface SearchParams {
  limit: number;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  types?: string;
}

const TYPE_OPTS: Iface1[] = [
  { key: 'income', label: '收入' },
  { key: 'expense', label: '支出' },
  { key: 'transfer', label: '转账' }
];

@Entry
@Component
struct SearchEntry {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State kw: string = '';
  @State results: TransactionItem[] = [];
  @State loading: boolean = false;  // 首屏不自动搜，无请求在飞 → 不显示骨架屏
  @State showFilter: boolean = false;
  @State minAmt: string = '';
  @State maxAmt: string = '';
  @State startD: string = '';
  @State endD: string = '';
  @State types: string[] = [];
  @State books: Book[] = [];
  @State selBook: number | null = null; // null = 跟随当前账本；具体 id = 本次搜索只看该账本
  private debounce: number = 0;

  // 首屏不自动搜：搜索页一进来就列出全部账单，用户分不清「这是搜索结果」
  // 还是「这是全部账单」，且和账单 tab 功能重复。安卓端首屏是引导空态，
  // 这里对齐 —— loading 初值随之改为 false（无请求在飞，不该显示骨架屏）。
  aboutToAppear(): void {
    Api.getBooks().then((r) => {
      if (r.success) this.books = r.data?.books || [];
    }).catch(() => { /* 账本列表拉取失败不阻断搜索 */ });
  }

  onKw(v: string): void {
    this.kw = v;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.doSearch(), 350);
  }

  toggleType(k: string): void {
    if (this.types.includes(k)) this.types = this.types.filter(x => x !== k);
    else this.types = [...this.types, k];
  }

  async doSearch(): Promise<void> {
    // 无关键词且无筛选条件 → 不发请求，回到引导空态。
    // 否则空条件会拉回全量账单，和账单 tab 重复。
    if (this.kw === '' && !this.hasFilter()) {
      this.results = [];
      this.loading = false;
      return;
    }
    this.loading = true;
    try {
      const params: SearchParams = { limit: 100 };
      if (this.kw) params.search = this.kw;
      if (this.minAmt) params.minAmount = Number(this.minAmt);
      if (this.maxAmt) params.maxAmount = Number(this.maxAmt);
      if (this.startD) params.startDate = this.startD;
      if (this.endD) params.endDate = this.endD;
      if (this.types.length) params.types = this.types.join(',');
      // 账本筛选：选了具体账本时临时覆盖全局 X-Book-Id；跟随当前则不传（Http 自动注入当前账本）
      const headers: Record<string, string> | undefined =
        this.selBook != null ? { 'X-Book-Id': this.selBook.toString() } : undefined;
      const r = await Api.getTransactions(params as ESObject as Record<string, Object>, headers);
      if (r.success) this.results = r.data || [];
    } catch (e) { console.error('Search:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  /**
   * 是否有任一筛选条件生效（筛选入口变色、结果为空时文案区分）。
   * 写成普通方法而不是 get 访问器：ArkTS 在 @Component struct 里对 getter 的
   * 状态依赖收集不可靠，经过 getter 访问 @State 会丢依赖路径、导致不重渲染。
   */
  hasFilter(): boolean {
    return this.types.length > 0 || this.minAmt !== '' || this.maxAmt !== ''
      || this.startD !== '' || this.endD !== '' || this.selBook !== null;
  }

  resetFilter(): void {
    this.minAmt = '';
    this.maxAmt = '';
    this.startD = '';
    this.endD = '';
    this.types = [];
    this.selBook = null;
  }

  /**
   * 漏斗图标（对齐安卓端 Icons.Outlined.FilterAlt）。
   * 用 Path 自绘而不是 SymbolGlyph($r('sys.symbol.xxx'))：系统符号名一旦写错，
   * 编译期不报错、运行时静默不显示（图标位置直接空白），排查成本高；
   * Path 是 ArkUI 内置组件、零资源依赖，画出来就一定在。
   * 坐标系 14×14：上宽下窄的梯形收成一根竖柄。
   */
  @Builder FunnelIcon(color: string) {
    Path()
      .width(13).height(13)
      .commands('M1 2 L13 2 L8.4 7.2 L8.4 12.6 L5.6 11.2 L5.6 7.2 Z')
      .fill(color)
      .strokeWidth(0)
  }

  /** 筛选分组标签：左侧品牌色竖线 + 标签文字（对齐安卓端的分组视觉） */
  @Builder FilterGroup(label: string) {
    Row({ space: 8 }) {
      Divider().vertical(true).height(14).strokeWidth(3).color(COLORS.brand)
      Text(label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ top: 18, bottom: 10 })
  }

  /** 胶囊输入框：暖灰底、无描边、居中占位（对齐安卓端的填充式输入） */
  @Builder PillInput(ph: string, val: string, numeric: boolean, onCh: (v: string) => void) {
    TextInput({ placeholder: ph, text: val })
      .type(numeric ? InputType.Number : InputType.Normal)
      .layoutWeight(1)
      .height(52)
      .fontSize(14)
      .placeholderColor(COLORS.placeholder)
      .backgroundColor(COLORS.surfaceVariant)
      .borderRadius(14)
      .padding({ left: 14, right: 14 })
      .onChange(onCh)
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '搜索' })
        // 搜索框：白底 + 细描边 + 大圆角（对齐安卓端）。
        // 原先是暖棕淡底，看着像「已激活的筛选态」而不是可输入的框 ——
        // 输入控件的底色应该比页面底更亮，暗示「这里可以写字」。
        Row({ space: 10 }) {
          Row({ space: 8 }) {
            Text('🔍').fontSize(17).fontColor(COLORS.textSecondary)
            TextInput({ placeholder: '输入关键词搜索账单', text: this.kw })
              .layoutWeight(1)
              .backgroundColor(TRANSPARENT)
              .placeholderColor(COLORS.placeholder)
              .fontSize(15)
              .padding({ left: 0, right: 0 })
              .onChange((v: string) => this.onKw(v))
          }
          .layoutWeight(1)
          .height(48)
          .padding({ left: 16, right: 12 })
          .backgroundColor(COLORS.surface)
          .borderRadius(24)
          .border({ width: 1, color: COLORS.outlineVariant })
          .alignItems(VerticalAlign.Center)

          // 筛选入口：文字 + 漏斗图标，有筛选条件时变品牌色。
          // 字色写在每个 Text 上而不是外层 Row —— Row 没有 fontColor 属性，
          // ArkUI 不做字色继承。
          Row({ space: 4 }) {
            Text('筛选').fontSize(14)
              .fontColor(this.hasFilter() ? COLORS.brand : COLORS.textSecondary)
            this.FunnelIcon(this.hasFilter() ? COLORS.brand : COLORS.textSecondary)
          }
          .padding({ left: 4, right: 4 })
          .alignItems(VerticalAlign.Center)
          .onClick(() => this.showFilter = true)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .alignItems(VerticalAlign.Center)

        if (this.loading) { LoadingBox() }
        else if (this.results.length === 0) {
          // 两种空态要分开：还没输入 = 引导；搜过但没命中 = 告知无结果。
          // 原先写的是 `text: this.kw || '请输入…'`，搜不到时会把用户刚输入的
          // 关键词当成提示文案显示出来（用户看到的是自己输的字，不是提示）。
          EmptyState({
            icon: '🔍',
            text: (this.kw !== '' || this.hasFilter())
              ? '没有找到匹配的账单，换个关键词试试'
              : '请输入关键词进行搜索~'
          })
        } else {
          Scroll() {
            Column({ space: 8 }) {
              ForEach(this.results, (it: TransactionItem) => {
                TransactionRow({ item: it, onItemClick: () => router.pushDestination({ url: 'pages/AddTransaction', params: { editId: it.id } }) })
              }, (it: TransactionItem) => it.id.toString())
              Blank().height(20)
            }.padding(12)
          }.layoutWeight(1)
        }
        if (this.showFilter) {
          // 筛选面板直接内联（不走 BottomSheet 的 @BuilderParam 闭包）：
          // 否则 @BuilderParam 闭包内引用的父 @State（selBook/types/books）变化时，
          // 因 BottomSheet 的 show 不变而不重渲染，导致账本/类型 chip 选中态刷新失效。
          Stack() {
            Column().layoutWeight(1).backgroundColor('#66000000')
              .onClick(() => { this.showFilter = false; })
            Column() {
            Column({ space: 0 }) {
              // 标题行：左标题 + 右「重置」（对齐安卓端。原先是 SheetHeader 的
              // 关闭叉 + 底部「取消」按钮，两个都是「退出」语义、功能重复；
              // 用户在筛选面板真正需要的第二个动作是「清空重填」而不是「关掉」）
              Row() {
                Text('高级筛选')
                  .fontSize(17).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
                Blank()
                Text('重置')
                  .fontSize(14).fontColor(COLORS.textSecondary)
                  .onClick(() => this.resetFilter())
              }.width('100%').alignItems(VerticalAlign.Center)
              .padding({ bottom: 20 })

              // 账本：选中具体账本时本次搜索只看该账本；默认「当前账本」跟随全局账本切换
              this.FilterGroup('账本')
              Row({ space: 8 }) {
                Chip({ label: '当前账本', active: this.selBook === null, onTap: () => { this.selBook = null; } })
                ForEach(this.books, (b: Book) => {
                  Chip({ label: b.name, active: this.selBook === b.id, onTap: () => { this.selBook = b.id; } })
                }, (b: Book) => b.id.toString())
              }.width('100%')

              this.FilterGroup('金额')
              Row({ space: 10 }) {
                this.PillInput('最低金额', this.minAmt, true, (v: string) => this.minAmt = v)
                Text('—').fontSize(14).fontColor(COLORS.textSecondary)
                this.PillInput('最高金额', this.maxAmt, true, (v: string) => this.maxAmt = v)
              }.width('100%').alignItems(VerticalAlign.Center)

              this.FilterGroup('日期')
              Row({ space: 10 }) {
                this.PillInput('起始日期', this.startD, false, (v: string) => this.startD = v)
                Text('—').fontSize(14).fontColor(COLORS.textSecondary)
                this.PillInput('结束日期', this.endD, false, (v: string) => this.endD = v)
              }.width('100%').alignItems(VerticalAlign.Center)

              this.FilterGroup('类型')
              Row({ space: 8 }) {
                ForEach(TYPE_OPTS, (t: Iface1) => {
                  Chip({ label: t.label, active: this.types.includes(t.key), onTap: () => { this.toggleType(t.key); } })
                }, (t: Iface1) => t.key)
              }.width('100%')

              // 主按钮：品牌棕实心 + 大圆角，视觉权重压过上方所有输入框。
              // 安卓端用的是黑底，这里改品牌棕 —— 纯黑在暖棕体系里是个外来色，
              // 会显得是从别的 App 抄来的按钮。
              Button('应用筛选')
                .width('100%').height(52)
                .fontSize(16).fontWeight(FontWeight.Medium)
                .fontColor(COLORS.onPrimary)
                .backgroundColor(COLORS.brand)
                .borderRadius(26)
                .margin({ top: 28 })
                .onClick(() => { this.showFilter = false; this.doSearch(); })
            }
            .width('100%')
            .padding({ left: 20, right: 20, top: 4, bottom: 12 })
            .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
            .backgroundColor(COLORS.card)
            .border({ width: 1, color: COLORS.divider })
            .borderRadius({ topLeft: 16, topRight: 16 })
            .constraintSize({ maxHeight: '85%' })
          }
          .width('100%').height('100%').position({ x: 0, y: 0 }).zIndex(20)
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
