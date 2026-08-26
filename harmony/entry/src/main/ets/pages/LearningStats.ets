/**
 * AI 学习统计（对齐安卓 LearningStatsScreen.kt）：
 * 把 /ai/learning/stats 的 5 个区块（反馈与记忆 / 规则冲突 / 在线指标 / 调用用量 / 模型熔断器）
 * 渲染成键值卡片。嵌套 Map 用 flatten() 安全展平（ESObject 兜底）。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, EmptyState, AppBackground } from '../common/components/Components';

@Entry
@Component
struct LearningStats {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State stats: Api.AiLearningStatsResponse | null = null;
  @State errorMsg: string = '';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = this.stats === null;
    this.errorMsg = '';
    try {
      const r = await Api.aiLearningStats();
      if (r.success && r.data) {
        this.stats = r.data;
      } else {
        this.errorMsg = (r.message as string) || '加载学习统计失败';
      }
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? (e.message as string) : '网络异常';
    }
    this.loading = false;
  }

  /** 递归展平嵌套 Map 为「标签 → 值」行；嵌套键用「 · 」连接。List 值显示为「N 项」。 */
  private flatten(prefix: string, v: ESObject | null): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    if (v === null || v === undefined) return out;
    const keys: string[] = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k: string = keys[i];
      const vv: ESObject = v[k] as ESObject;
      const label: string = prefix.length === 0 ? k : prefix + ' · ' + k;
      if (vv !== null && typeof vv === 'object' && !Array.isArray(vv)) {
        const sub: Array<[string, string]> = this.flatten(label, vv as ESObject);
        for (let j = 0; j < sub.length; j++) out.push(sub[j]);
      } else if (Array.isArray(vv)) {
        out.push([label, (vv as Array<ESObject>).length + ' 项']);
      } else {
        out.push([label, this.fmt(k, vv)]);
      }
    }
    return out;
  }

  /** 按字段名智能格式化：rate → 百分比；cost/micro → 人民币（÷1e6）；其余 Number → 原值。 */
  private fmt(key: string, value: ESObject): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') {
      const d: number = value as number;
      const k: string = key.toLowerCase();
      if (k.indexOf('rate') >= 0) return (d * 100).toFixed(1) + '%';
      if (k.indexOf('cost') >= 0 || k.indexOf('micro') >= 0) return '¥' + (d / 1000000).toFixed(4);
      if (d % 1 === 0) return d.toFixed(0);
      return d.toFixed(4);
    }
    return value.toString();
  }

  private colorOfSection(idx: number): string {
    const palette: string[] = [COLORS.brand, COLORS.teal, COLORS.income, COLORS.expense, COLORS.brandLight];
    return palette[idx % palette.length];
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '🧠 学习统计', onBack: () => router.back() })

        if (this.loading && this.stats === null) {
          LoadingBox()
        } else if (this.errorMsg && this.stats === null) {
          Column() {
            Text(this.errorMsg).fontSize(14).fontColor(COLORS.error).textAlign(TextAlign.Center).padding({ left: 32, right: 32 })
            Text('重试').fontSize(13).fontColor(COLORS.brand).margin({ top: 14 })
              .padding({ left: 18, right: 18, top: 8, bottom: 8 }).border({ width: 1, color: COLORS.brand }).borderRadius(999)
              .onClick(() => this.load())
          }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        } else if (this.stats === null) {
          EmptyState({ icon: '🧠', text: '暂无学习数据，记几笔账后 AI 会开始积累记忆与规则' })
        } else {
          Scroll() {
            Column({ space: 14 }) {
              Row() {
                Text('AI 自我学习情况').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary).layoutWeight(1)
                if (this.loading) {
                  LoadingProgress().width(20).height(20).color(COLORS.brand)
                } else {
                  Text('🔄').fontSize(18).fontColor(COLORS.brand).onClick(() => this.load())
                }
              }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 4 })

              this.KVSection('反馈与记忆', this.flatten('', (this.stats as Api.AiLearningStatsResponse).evidence as ESObject))
              this.ContradictionSection((this.stats as Api.AiLearningStatsResponse).contradictions as ESObject[])
              this.KVSection('在线指标', this.flatten('', (this.stats as Api.AiLearningStatsResponse).metrics as ESObject))
              this.KVSection('调用用量', this.flatten('', (this.stats as Api.AiLearningStatsResponse).usage as ESObject))
              this.KVSection('模型熔断器', this.flatten('', (this.stats as Api.AiLearningStatsResponse).breakers as ESObject))
              Blank().height(20)
            }.padding({ left: 12, right: 12, top: 4, bottom: 12 })
          }.layoutWeight(1)
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }

  /** 规则冲突：可能有变体与样本数 */
  @Builder
  private ContradictionSection(contradictions: ESObject[]) {
    Column() {
      Text('规则冲突').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
        .margin({ left: 4, bottom: 8 })
      if (!contradictions || contradictions.length === 0) {
        Text('无冲突规则 ✓').fontSize(13).fontColor(COLORS.textSecondary).padding(12)
          .backgroundColor(COLORS.surface).borderRadius(14)
      } else {
        Column({ space: 10 }) {
          ForEach(contradictions, (c: ESObject, idx: number) => {
            Column() {
              Text((c['match_key'] as string) || '?').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
              Text(this.confVariants(c)).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 2 })
              Text('样本数：' + this.confSamples(c)).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 2 })
            }.width('100%').padding(12).backgroundColor(COLORS.surface).borderRadius(14)
          }, (c: ESObject, idx: number) => 'conf_' + idx)
        }
      }
    }.width('100%').padding({ left: 4, right: 4 })
  }

  private confVariants(c: ESObject): string {
    const variants: ESObject[] = (c['variants'] as ESObject[]) || [];
    if (variants.length === 0) return '';
    let s = '';
    for (let i = 0; i < variants.length; i++) {
      if (i > 0) s += ' / ';
      s += variants[i]?.toString() ?? '';
    }
    return '变体：' + s;
  }

  private confSamples(c: ESObject): number {
    return ((c['samples'] as ESObject[]) || []).length;
  }

  @Builder
  private KVSection(title: string, rows: Array<[string, string]>) {
    Column() {
      Text(title).fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
        .margin({ left: 4, bottom: 8 })
      Column() {
        if (rows.length === 0) {
          Text('—').fontSize(12).fontColor(COLORS.textSecondary).padding(12)
        } else {
          Column({ space: 6 }) {
            ForEach(rows, (row: [string, string]) => {
              Row() {
                Text(row[0]).fontSize(13).fontColor(COLORS.textSecondary).layoutWeight(1)
                Text(row[1]).fontSize(13).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
              }.width('100%')
            }, (row: [string, string]) => row[0])
          }.width('100%').padding(12)
        }
      }.width('100%').backgroundColor(COLORS.surface).borderRadius(14)
        .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
    }.width('100%').padding({ left: 4, right: 4 })
  }
}
