/**
 * AI 智能分析（对齐安卓 AiAdviceScreen.kt，v0.2.1：insight 与 advice 合并）。
 * 服务端 /ai/advice 响应：{ advice: AdviceItem[], insights: InsightItem[], generatedAt }。
 *
 * 两段渲染：
 *   - 上：洞察区（warning/info/tip），数据来自 AiAdviceResponse.insights
 *   - 下：建议区（high/medium/low），数据来自 AiAdviceResponse.advice
 *
 * 缓存策略（用户要求）：
 *   - aboutToAppear 优先读 preferences（缓存键 ai_advice_cache_json/ai_insight_cache_json/ai_advice_generated_at）
 *   - 有缓存则渲染不发请求；无缓存才静默发一次 /ai/advice
 *   - 用户点右上角 🔄 才主动刷新覆盖缓存
 */
import router from '@ohos.router';
import dataPreferences from '@ohos.data.preferences';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, EmptyState, AppBackground } from '../common/components/Components';
import { toast } from '../common/ui';

interface AdviceItem {
  title: string;
  content: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

interface InsightItem {
  title: string;
  description: string;
  action: string;
  level: 'warning' | 'info' | 'tip';
}

const STORE_NAME = 'xin_ai_advice_cache';
const KEY_ADVICE = 'advice_json';
const KEY_INSIGHT = 'insight_json';
const KEY_GEN_AT = 'generated_at';

@Entry
@Component
struct Advice {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State advice: AdviceItem[] = [];
  @State insights: InsightItem[] = [];
  @State generatedAt: string = '';
  @State errorMsg: string = '';
  @State needsProvider: boolean = false;
  private cacheStore: dataPreferences.Preferences | null = null;

  aboutToAppear(): void {
    this.loadFromCacheThenMaybeFetch();
  }

  /**
   * 先读缓存 → 有则直接渲染（不发请求）→ 无缓存才发请求。
   * 缓存读取失败/字段损坏 → 静默降级到请求接口（避免卡在加载态）。
   */
  async loadFromCacheThenMaybeFetch(): Promise<void> {
    try {
      const store = await dataPreferences.getPreferences(getContext(), STORE_NAME);
      this.cacheStore = store;
      const adviceJson = (await store.get(KEY_ADVICE, '')) as string;
      const insightJson = (await store.get(KEY_INSIGHT, '')) as string;
      this.generatedAt = (await store.get(KEY_GEN_AT, '')) as string;
      try {
        this.advice = adviceJson ? JSON.parse(adviceJson) as AdviceItem[] : [];
        this.insights = insightJson ? JSON.parse(insightJson) as InsightItem[] : [];
      } catch (_) {
        this.advice = [];
        this.insights = [];
      }
      if (this.advice.length > 0 || this.insights.length > 0) {
        // 已有缓存，渲染（不发请求）
        return;
      }
    } catch (e) {
      console.warn('[Advice] cache read failed:', (e as ApiError).message);
    }
    // 无缓存则静默发请求
    await this.fetch();
  }

  async fetch(): Promise<void> {
    this.loading = true;
    this.errorMsg = '';
    this.needsProvider = false;
    try {
      const r = await Api.aiAdvice();
      if (r.success && r.data) {
        this.advice = (r.data.advice as AdviceItem[]) || [];
        this.insights = (r.data.insights as InsightItem[]) || [];
        this.generatedAt = r.data.generated_at || '';
        // 写入缓存（失败不致命——下次重启会重新拉）
        try {
          if (this.cacheStore == null) {
            this.cacheStore = await dataPreferences.getPreferences(getContext(), STORE_NAME);
          }
          await this.cacheStore.put(KEY_ADVICE, JSON.stringify(this.advice));
          await this.cacheStore.put(KEY_INSIGHT, JSON.stringify(this.insights));
          await this.cacheStore.put(KEY_GEN_AT, this.generatedAt);
          await this.cacheStore.flush();
        } catch (e) {
          console.warn('[Advice] cache write failed:', (e as ApiError).message);
        }
      } else {
        const msg = (r.message as string) || '获取建议失败';
        this.errorMsg = msg;
        this.needsProvider = /服务商|未配置|未激活/.test(msg);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const msg = (e.message as string) || '获取建议失败';
        this.errorMsg = msg;
        this.needsProvider = /服务商|未配置|未激活/.test(msg);
      } else {
        this.errorMsg = '网络错误，请重试';
      }
    } finally {
      this.loading = false;
    }
  }

  // advice priority → 配色
  private adviceColor(p: string): string {
    if (p === 'high') return '#E53935';
    if (p === 'low') return '#43A047';
    return '#FF9800';
  }
  private adviceIcon(p: string): string {
    if (p === 'high') return '⚠️';
    if (p === 'low') return '✅';
    return '💡';
  }
  // insight level → 配色
  private insightColor(level: string): string {
    if (level === 'warning') return '#E53935';
    if (level === 'tip') return '#43A047';
    return '#1E88E5';
  }
  private insightIcon(level: string): string {
    if (level === 'warning') return '⚠️';
    if (level === 'tip') return '💡';
    return 'ℹ️';
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '💡 AI 智能分析', onBack: () => router.back() })
        const hasContent = this.advice.length > 0 || this.insights.length > 0;
        if (this.loading && !hasContent) {
          LoadingBox()
        } else if (this.needsProvider && !hasContent) {
          this.ProviderMissingView()
        } else if (this.errorMsg && !hasContent) {
          this.ErrorView()
        } else if (!hasContent) {
          EmptyState({ icon: '💡', text: '本月还没有内容，记几笔账后 AI 会基于你的财务数据给出建议' })
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
        Text(`洞察 ${this.insights.length} 条 · 建议 ${this.advice.length} 条`)
          .fontSize(16).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary).layoutWeight(1)
        if (this.loading) {
          Text('刷新中…').fontSize(12).fontColor(COLORS.textSecondary)
        } else {
          Text('🔄').fontSize(18).fontColor(COLORS.brand).onClick(() => this.fetch())
        }
      }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 4 })

      List({ space: 10 }) {
        // 洞察段（仅在有内容时渲染标题 + 列表）
        if (this.insights.length > 0) {
          ListItem() {
            Text('🧠 消费洞察').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
              .padding({ left: 4, top: 4 })
          }
          ForEach(this.insights, (item: InsightItem, idx: number) => {
            ListItem() { this.InsightCard(item) }
          }, (item: InsightItem, idx: number) => `ins_${idx}_${item.level}`)
        }
        // 建议段
        if (this.advice.length > 0) {
          ListItem() {
            Text('💡 财务建议').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
              .padding({ left: 4, top: 4 })
          }
          ForEach(this.advice, (item: AdviceItem, idx: number) => {
            ListItem() { this.AdviceCard(item) }
          }, (item: AdviceItem, idx: number) => `adv_${idx}_${item.priority}`)
        }
      }.width('100%').layoutWeight(1)
      .padding({ left: 12, right: 12, top: 4, bottom: 12 })
      .listDirection(Axis.Vertical).scrollBar(BarState.Off)

      if (this.generatedAt.length > 0) {
        Text(`生成于 ${this.generatedAt}`).fontSize(11).fontColor(COLORS.textSecondary)
          .width('100%').textAlign(TextAlign.Center).padding({ bottom: 12 })
      }
    }.width('100%').layoutWeight(1)
  }

  @Builder
  private InsightCard(item: InsightItem) {
    Row() {
      Text(this.insightIcon(item.level)).fontSize(22)
        .width(40).height(40).textAlign(TextAlign.Center)
        .borderRadius(20)
        .backgroundColor(this.insightColor(item.level) + '22')
      Column() {
        Text(item.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text(item.description).fontSize(13).fontColor(COLORS.textSecondary)
          .margin({ top: 4 }).lineHeight(18)
        if (item.action && item.action.length > 0) {
          Text('👉 ' + item.action).fontSize(12).fontColor(this.insightColor(item.level))
            .fontWeight(FontWeight.Medium).margin({ top: 6 })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 12 })
    }.width('100%').padding(14)
    .backgroundColor(COLORS.surface).borderRadius(14)
    .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
  }

  @Builder
  private AdviceCard(item: AdviceItem) {
    Row() {
      Text(this.adviceIcon(item.priority)).fontSize(22).width(40).height(40).textAlign(TextAlign.Center).borderRadius(20).backgroundColor(this.adviceColor(item.priority) + '22')
      Column() {
        Text(item.title).fontSize(15).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text(item.content).fontSize(13).fontColor(COLORS.textSecondary).margin({ top: 4 }).lineHeight(18)
        if (item.impact && item.impact.length > 0) {
          Text('📈 预期影响：' + item.impact).fontSize(12).fontColor(this.adviceColor(item.priority)).fontWeight(FontWeight.Medium).margin({ top: 6 })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 12 })
    }.width('100%').padding(14).backgroundColor(COLORS.surface).borderRadius(14).shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
  }

  @Builder
  private ProviderMissingView() {
    Column() {
      Text('💡').fontSize(48).fontColor(COLORS.brand)
      Text('还没配置 AI 服务商').fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary).margin({ top: 14 })
      Text('需要先在「服务商」中添加并激活一个对话模型（如 GPT-4o、Claude、国产大模型）才能生成建议')
        .fontSize(13).fontColor(COLORS.textSecondary).textAlign(TextAlign.Center).margin({ top: 8 }).padding({ left: 32, right: 32 })
      Text('去配置').fontSize(14).fontColor(COLORS.onPrimary).backgroundColor(COLORS.brand).padding({ left: 24, right: 24, top: 10, bottom: 10 }).borderRadius(999).margin({ top: 18 })
        .onClick(() => router.pushUrl({ url: 'pages/Settings' }))
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
  }

  @Builder
  private ErrorView() {
    Column() {
      Text(this.errorMsg).fontSize(14).fontColor(COLORS.error).textAlign(TextAlign.Center).padding({ left: 32, right: 32 })
      Text('重试').fontSize(13).fontColor(COLORS.brand).margin({ top: 14 }).padding({ left: 18, right: 18, top: 8, bottom: 8 }).border({ width: 1, color: COLORS.brand }).borderRadius(999).onClick(() => this.fetch())
    }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
  }
}