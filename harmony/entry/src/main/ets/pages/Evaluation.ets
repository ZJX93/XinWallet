/**
 * AI 模型评测（对齐安卓 EvaluationScreen.kt）：
 * 运行离线评测套件 → 展示各识别维度命中率 + 与基线的回归对比 + 历史跑批列表。
 * 不依赖对话服务商（纯本地 CPU 跑批，可能耗时数秒）。
 * 注：@Builder/build 内禁止 const/let（ArkTS UI 语法限制），所有计算抽到私有方法。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, AppBackground } from '../common/components/Components';
import { toast } from '../common/ui';

@Entry
@Component
struct Evaluation {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State running: boolean = false;
  @State result: ESObject | null = null;
  @State history: ESObject[] = [];
  @State errorMsg: string = '';

  aboutToAppear(): void { this.loadHistory(); }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.errorMsg = '';
    try {
      const r = await Api.aiEvaluationRun({ label: 'harmony-manual', persist: true });
      if (r.success && r.data) {
        this.result = r.data as ESObject;
        toast('评测完成');
        this.loadHistory();
      } else {
        this.errorMsg = (r.message as string) || '评测失败';
      }
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? (e.message as string) : '网络异常';
    } finally {
      this.running = false;
    }
  }

  async loadHistory(): Promise<void> {
    try {
      const r = await Api.aiEvaluationRuns(10);
      if (r.success && r.data) {
        this.history = ((r.data as ESObject)['runs'] as ESObject[]) || [];
      }
    } catch (e) { /* 历史加载失败静默：不影响本次结果展示 */ }
  }

  // ===== 数据抽取辅助（供 @Builder 调用，UI 块内不允许声明局部变量）=====

  private summaryOf(res: ESObject): ESObject {
    return (res['summary'] as ESObject) || {};
  }

  private passedOf(res: ESObject): number {
    return Number(this.summaryOf(res)['passed_cases']) || 0;
  }

  private totalOf(res: ESObject): number {
    return Number(this.summaryOf(res)['total_cases']) || 0;
  }

  private dsVerOf(res: ESObject): string {
    return (this.summaryOf(res)['dataset_version'] as string) || '?';
  }

  /** 只保留 metrics 里 *_total/*_hit 成对存在的维度 */
  private validBases(metrics: ESObject): Array<[string, string]> {
    const all: Array<[string, string]> = [
      ['count', '笔数'], ['amount', '金额'], ['type', '类型'],
      ['category', '类目'], ['date', '日期'], ['verdict', '结论']
    ];
    return all.filter((b: [string, string]) =>
      !isNaN(Number(metrics[b[0] + '_total'])) && !isNaN(Number(metrics[b[0] + '_hit'])));
  }

  private metricCell(metrics: ESObject, base: string): string {
    const total: number = Number(metrics[base + '_total']);
    const hit: number = Number(metrics[base + '_hit']);
    const acc: number = total > 0 ? (hit / total * 100) : 0;
    return hit + ' / ' + total + ' (' + acc.toFixed(1) + '%)';
  }

  private hasBaselineOf(r: ESObject): boolean {
    return r['has_baseline'] === true;
  }

  private deltasOf(r: ESObject): ESObject {
    return (r['deltas'] as ESObject) || {};
  }

  private deltaKeysOf(r: ESObject): string[] {
    return Object.keys(this.deltasOf(r));
  }

  private deltaText(deltas: ESObject, k: string): string {
    const dv: number = Number(deltas[k]);
    return '· ' + k + ' 变化：' + (dv * 100).toFixed(1) + '%';
  }

  private regressionsOf(r: ESObject): ESObject[] {
    return (r['regressions'] as ESObject[]) || [];
  }

  private improvementsOf(r: ESObject): ESObject[] {
    return (r['improvements'] as ESObject[]) || [];
  }

  private esText(it: ESObject): string {
    if (it === null || it === undefined) {
      return '';
    }
    return typeof it === 'string' ? (it as string) : JSON.stringify(it);
  }

  private runTitle(run: ESObject): string {
    const id: string = (run['id'] as string) || '?';
    const label: string = (run['label'] as string) || '';
    return '#' + id + (label.length > 0 ? ' · ' + label : '');
  }

  private runSub(run: ESObject): string {
    const dsVer: string = (run['dataset_version'] as string) || '?';
    const total: number = Number(run['total_cases']) || 0;
    const passed: number = Number(run['passed_cases']) || 0;
    return '通过 ' + passed + '/' + total + ' · 数据集 ' + dsVer;
  }

  private runCreated(run: ESObject): string {
    return (run['created_at'] as string) || '';
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '📊 模型评测', onBack: () => router.back() })

        if (this.running && this.result === null) {
          LoadingBox()
        } else {
          Scroll() {
            Column({ space: 14 }) {
              // 说明 + 运行按钮
              Column() {
                Text('离线评测套件').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
                Text('在固定评测集上跑批，比对各识别维度的命中率，并自动与最近一次跑批做回归对比。不依赖对话服务商。')
                  .fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 4 })
                Button(this.running ? '评测中…可能耗时数秒' : '▶ 运行评测')
                  .width('100%').height(44).fontSize(15).fontColor(COLORS.onPrimary)
                  .backgroundColor(COLORS.brand).borderRadius(12).margin({ top: 12 })
                  .enabled(!this.running)
                  .onClick(() => this.run())
                if (this.running) {
                  LoadingProgress().width(20).height(20).color(COLORS.brand).margin({ top: 8 })
                }
              }.width('100%').padding(16).backgroundColor(COLORS.surface).borderRadius(14)

              if (this.errorMsg) {
                Text(this.errorMsg).fontSize(13).fontColor(COLORS.error).padding({ left: 4 })
              }

              if (this.result) {
                this.ResultSection(this.result as ESObject)
              }

              Text('历史跑批').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
                .margin({ left: 4, top: 4 })
              if (this.history.length === 0) {
                Text('暂无历史记录').fontSize(12).fontColor(COLORS.textSecondary).padding({ left: 4 })
              } else {
                ForEach(this.history, (run: ESObject, idx: number) => {
                  this.HistoryRow(run)
                }, (run: ESObject, idx: number) => 'run_' + (run['id']?.toString() ?? idx))
              }
              Blank().height(20)
            }.padding({ left: 12, right: 12, top: 12, bottom: 12 })
          }.layoutWeight(1)
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }

  @Builder
  private ResultSection(res: ESObject) {
    Column({ space: 12 }) {
      // 本次结果
      Column() {
        Text('本次结果').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.brand).margin({ left: 4, bottom: 8 })
        Column() {
          Text('通过用例：' + this.passedOf(res) + ' / ' + this.totalOf(res)).fontSize(13).fontColor(COLORS.textPrimary)
          Text('数据集版本：' + this.dsVerOf(res)).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 4 })
        }.width('100%').padding(12).backgroundColor(COLORS.surface).borderRadius(14)
      }.width('100%').padding({ left: 4, right: 4 })

      this.MetricsGrid((res['metrics'] as ESObject) || {})
      this.RegressionView((res['regression'] as ESObject) || {})
    }.width('100%')
  }

  /** 识别维度命中率：count/amount/type/category/date/verdict 各 *_total / *_hit 成对 */
  @Builder
  private MetricsGrid(metrics: ESObject) {
    Column() {
      Text('识别维度命中率').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
        .margin({ left: 4, bottom: 8 })
      Column() {
        Column({ space: 6 }) {
          ForEach(this.validBases(metrics), (b: [string, string]) => {
            Row() {
              Text(b[1]).fontSize(13).fontColor(COLORS.textSecondary).layoutWeight(1)
              Text(this.metricCell(metrics, b[0])).fontSize(13).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
            }.width('100%')
          }, (b: [string, string]) => b[0])
        }.width('100%').padding(12).backgroundColor(COLORS.surface).borderRadius(14)
      }.width('100%')
    }.width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  private RegressionView(regression: ESObject) {
    Column() {
      Text('回归对比').fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
        .margin({ left: 4, bottom: 8 })
      Column() {
        Column() {
          Text(this.hasBaselineOf(regression) ? '已与最近一次跑批对比' : '暂无基线（这是首次跑批）')
            .fontSize(12).fontColor(COLORS.textSecondary)
          ForEach(this.deltaKeysOf(regression), (k: string) => {
            Text(this.deltaText(this.deltasOf(regression), k)).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 4 })
          }, (k: string) => k)
          if (this.regressionsOf(regression).length > 0) {
            Text('⚠️ 回归 ' + this.regressionsOf(regression).length + ' 项')
              .fontSize(13).fontColor(COLORS.danger).fontWeight(FontWeight.Bold).margin({ top: 6 })
            ForEach(this.regressionsOf(regression), (it: ESObject, i: number) => {
              Text('  - ' + this.esText(it)).fontSize(12).fontColor(COLORS.danger)
            }, (it: ESObject, i: number) => 'reg_' + i)
          }
          if (this.improvementsOf(regression).length > 0) {
            Text('✅ 提升 ' + this.improvementsOf(regression).length + ' 项')
              .fontSize(13).fontColor(COLORS.income).fontWeight(FontWeight.Bold).margin({ top: 6 })
            ForEach(this.improvementsOf(regression), (it: ESObject, i: number) => {
              Text('  + ' + this.esText(it)).fontSize(12).fontColor(COLORS.income)
            }, (it: ESObject, i: number) => 'imp_' + i)
          }
        }.width('100%').padding(12).backgroundColor(COLORS.surface).borderRadius(14)
      }.width('100%')
    }.width('100%').padding({ left: 4, right: 4 })
  }

  @Builder
  private HistoryRow(run: ESObject) {
    Row() {
      Column() {
        Text(this.runTitle(run)).fontSize(14).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text(this.runSub(run)).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 2 })
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text(this.runCreated(run)).fontSize(12).fontColor(COLORS.textSecondary)
    }.width('100%').padding(14).backgroundColor(COLORS.surface).borderRadius(14)
      .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
  }
}
