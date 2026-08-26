/**
 * AI 消费洞察（对齐安卓 AiInsightScreen.kt）：
 * 服务端用大模型从本月收支 / 预算 / 储蓄目标 / 债务多维度数据抽取 3-5 条结构化建议。
 *
 * 三级 level 渲染：warning 红 / info 蓝 / tip 绿。
 * 服务商未配置时显示引导，去「设置」配置。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { TopBar, LoadingBox, EmptyState, AppBackground } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';

interface InsightItem {
  title: string;
  description: string;
  action: string;
  level: 'warning' | 'info' | 'tip';
}

@Entry
@Component
struct Insight {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State items: InsightItem[] = [];
  @State generatedAt: string = '';
  @State errorMsg: string = '';
  @State needsProvider: boolean = false;

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    this.errorMsg = '';
    this.needsProvider = false;
    try {
      const r = await Api.aiInsight({});   // month 不传，服务端兜底当月
      if (r.success && r.data) {
        this.items = (r.data.insights as InsightItem[]) || [];
        this.generatedAt = r.data.generated_at || '';
        if (this.items.length === 0) {
          this.errorMsg = '本月无数据，记账后再来试试';
        }
      } else {
        const msg = (r.message as string) || '获取洞察失败';
        this.errorMsg = msg;
        this.needsProvider = /服务商|未配置|未激活/.test(msg);
      }
    } catch (e) {
      // ArkTS 严格模式：catch 变量类型用 ApiError 或 any 都行，但不能 unknown（项目惯例见 Chat.ets）
      if (e instanceof ApiError) {
        const msg = (e.message as string) || '获取洞察失败';
        this.errorMsg = msg;
        this.needsProvider = /服务商|未配置|未激活/.test(msg);
      } else {
        this.errorMsg = '网络错误，请重试';
      }
    } finally {
      this.loading = false;
    }
  }

  // level → 配色。ArkTS 不允许三元里赋值给 const，用 let
  private colorOf(level: string): string {
    if (level === 'warning') return '#E53935';
    if (level === 'tip') return '#43A047';
    return '#1E88E5';   // info 兜底
  }

  private iconOf(level: string): string {
    if (level === 'warning') return '⚠️';
    if (level === 'tip') return '💡';
    return 'ℹ️';
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '💡 消费洞察', onBack: () => router.back() })

        if (this.loading && this.items.length === 0) {
          LoadingBox()
        } else if (this.needsProvider) {
          this.ProviderMissingView()
        } else if (this.errorMsg && this.items.length === 0) {
          this.EmptyErrorView()
        } else if (this.items.length === 0) {
          EmptyState({ icon: '💡', text: '本月还没有洞察，记几笔账后 AI 会基于你的财务数据给出建议' })
        } else {
          this.ListView()
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }

  @Builder
  private ListView() {
    Column() {
      Row() {
        Text(`本月 ${this.items.length} 条洞察`)
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
          .layoutWeight(1)
        if (this.loading) {
          Text('刷新中…').fontSize(12).fontColor(COLORS.textSecondary)
        } else {
          Text('🔄').fontSize(18).fontColor(COLORS.brand)
            .onClick(() => this.load())
        }
      }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 4 })

      List({ space: 10 }) {
        ForEach(this.items, (item: InsightItem, idx: number) => {
          ListItem() {
            this.InsightCard(item)
          }
        }, (item: InsightItem, idx: number) => `${idx}_${item.level}`)
      }.width('100%').layoutWeight(1)
      .padding({ left: 12, right: 12, top: 4, bottom: 12 })
      .listDirection(Axis.Vertical)
      .scrollBar(BarState.Off)

      if (this.generatedAt.length > 0) {
        Text(`生成于 ${this.generatedAt}`).fontSize(11).fontColor(COLORS.textSecondary)
          .width('100%').textAlign(TextAlign.Center).padding({ bottom: 12 })
      }
    }.width('100%').layoutWeight(1)
  }

  @Builder
  private InsightCard(item: InsightItem) {
    Row() {
      Text(this.iconOf(item.level)).fontSize(22)
        .width(40).height(40).textAlign(TextAlign.Center)
        .borderRadius(20)
        .backgroundColor(this.colorOf(item.level) + '22')   // 加 alpha
      Column() {
        Text(item.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text(item.description).fontSize(13).fontColor(COLORS.textSecondary)
          .margin({ top: 4 }).lineHeight(18)
        if (item.action && item.action.length > 0) {
          Text('👉 ' + item.action).fontSize(12).fontColor(this.colorOf(item.level))
            .fontWeight(FontWeight.Medium).margin({ top: 6 })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 12 })
    }.width('100%').padding(14)
    .backgroundColor(COLORS.surface).borderRadius(14)
    .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
  }

  @Builder
  private ProviderMissingView() {
    Column() {
      Text('💡').fontSize(48).fontColor(COLORS.brand)
      Text('还没配置 AI 服务商').fontSize(18).fontWeight(FontWeight.Bold)
        .fontColor(COLORS.textPrimary).margin({ top: 14 })
      Text('需要先在「服务商」中添加并激活一个对话模型（如 GPT-4o、Claude、国产大模型）才能生成洞察')
        .fontSize(13).fontColor(COLORS.textSecondary)
        .textAlign(TextAlign.Center).margin({ top: 8 }).padding({ left: 32, right: 32 })
      Text('去配置').fontSize(14).fontColor(COLORS.onPrimary)
        .backgroundColor(COLORS.brand).padding({ left: 24, right: 24, top: 10, bottom: 10 })
        .borderRadius(999).margin({ top: 18 })
        .onClick(() => router.pushUrl({ url: 'pages/Settings' }))
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
  }

  @Builder
  private EmptyErrorView() {
    Column() {
      Text(this.errorMsg).fontSize(14).fontColor(COLORS.error)
        .textAlign(TextAlign.Center).padding({ left: 32, right: 32 })
      Text('重试').fontSize(13).fontColor(COLORS.brand)
        .margin({ top: 14 }).padding({ left: 18, right: 18, top: 8, bottom: 8 })
        .border({ width: 1, color: COLORS.brand }).borderRadius(999)
        .onClick(() => this.load())
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
  }
}
