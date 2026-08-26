/**
 * AI 规则管理（对齐安卓 RuleListScreen.kt）：
 * 列表展示服务端 ai_rules 表学到的规则，支持按状态过滤 + 启用/禁用。
 * 阈值从列表接口返回的 thresholds 读取（禁止硬编码，v0.2 验收铁律）。
 *
 * 状态枚举：candidate 候选 / verified 已生效 / trusted 高可信 / disabled 已禁用。
 * disable 不可逆（样本不会复活），enable 回到 candidate 重攒证据。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, EmptyState, AppBackground } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';

@Entry
@Component
struct RuleList {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State rules: Api.AiRule[] = [];
  @State total: number = 0;
  @State thresholds: ESObject = {};
  @State filter: string = 'all';     // all | verified | trusted | candidate | disabled
  @State pendingId: number = -1;
  @State errorMsg: string = '';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = this.rules.length === 0;
    this.errorMsg = '';
    try {
      const r = await Api.aiRules();
      if (r.success && r.data) {
        this.rules = (r.data.rules as Api.AiRule[]) || [];
        this.total = (r.data.total as number) || 0;
        this.thresholds = (r.data.thresholds as ESObject) || {};
        if (this.rules.length === 0) this.errorMsg = '还没有 AI 规则，记账几次后 AI 会自动学习';
      } else {
        this.errorMsg = (r.message as string) || '加载规则失败';
      }
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? (e.message as string) : '网络异常';
    }
    this.loading = false;
  }

  private get filtered(): Api.AiRule[] {
    if (this.filter === 'all') return this.rules;
    return this.rules.filter((it: Api.AiRule) => it.status === this.filter);
  }

  private thVerified(key: string): number {
    const v: ESObject = (this.thresholds['verified'] as ESObject) || {};
    return Number(v[key as string]) || (key === 'accuracy' ? 0.6 : key === 'min_sample' ? 2 : 8);
  }

  async disable(id: number): Promise<void> {
    this.pendingId = id;
    try {
      const r = await Api.aiRuleDisable(id, 'user_disabled');
      if (r.success) { toast('已禁用'); this.load(); }
      else toastLong('禁用失败：' + ((r.message as string) || ''));
    } catch (e) {
      toastLong('禁用出错：' + (e instanceof ApiError ? (e.message as string) : '网络异常'));
    } finally { this.pendingId = -1; }
  }

  async enable(id: number): Promise<void> {
    this.pendingId = id;
    try {
      const r = await Api.aiRuleEnable(id);
      if (r.success) { toast('已启用'); this.load(); }
      else toastLong('启用失败：' + ((r.message as string) || ''));
    } catch (e) {
      toastLong('启用出错：' + (e instanceof ApiError ? (e.message as string) : '网络异常'));
    } finally { this.pendingId = -1; }
  }

  private statusColor(s: string): string {
    if (s === 'trusted') return '#1E88E5';
    if (s === 'verified') return '#43A047';
    if (s === 'candidate') return '#FFA726';
    if (s === 'disabled') return '#E53935';
    return '#9E9E9E';
  }
  private statusLabel(s: string): string {
    if (s === 'trusted') return '高可信';
    if (s === 'verified') return '已生效';
    if (s === 'candidate') return '候选';
    if (s === 'disabled') return '已禁用';
    return s;
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '🧠 AI 规则管理', onBack: () => router.back() })

        if (this.loading && this.rules.length === 0) {
          LoadingBox()
        } else if (this.rules.length === 0) {
          EmptyState({ icon: '🧠', text: this.errorMsg || '还没有 AI 规则，记账几次后 AI 会自动学习' })
        } else {
          // 阈值说明 footer
          if (this.thresholds && Object.keys(this.thresholds).length > 0) {
            Column() {
              Text(`共 ${this.total} 条规则 · verified 阈值: score≥${Math.round(this.thVerified('score'))} · accuracy≥${Math.round(this.thVerified('accuracy') * 100)}% · sample≥${Math.round(this.thVerified('min_sample'))}`)
                .fontSize(12).fontColor(COLORS.textSecondary)
              Text('规则晋升：candidate → verified（达阈值）→ trusted · 禁用不可逆且不复活样本')
                .fontSize(11).fontColor(COLORS.textSecondary)
                .margin({ top: 4 })
            }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 4 })
          }

          // 状态过滤 chip
          Scroll() {
            Row() {
              ForEach([['all', '全部'], ['verified', '已生效'], ['trusted', '高可信'], ['candidate', '候选'], ['disabled', '已禁用']] as Array<[string, string]>,
                (f: [string, string]) => {
                  Text(f[1])
                    .fontSize(12)
                    .fontColor(this.filter === f[0] ? COLORS.onPrimary : COLORS.textSecondary)
                    .backgroundColor(this.filter === f[0] ? COLORS.brand : COLORS.surfaceVariant)
                    .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                    .borderRadius(999)
                    .onClick(() => { this.filter = f[0]; })
                }, (f: [string, string]) => f[0])
            }.width('100%').padding({ left: 16, right: 16, top: 4, bottom: 8 })
          }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off)

          if (this.filtered.length === 0) {
            EmptyState({ icon: '🔍', text: `「${this.filter}」状态下没有规则，切换其他过滤查看` })
          } else {
            List({ space: 10 }) {
              ForEach(this.filtered, (rule: Api.AiRule) => {
                ListItem() { this.RuleCard(rule) }
              }, (rule: Api.AiRule) => `rule_${rule.id}_${rule.status}`)
            }.width('100%').layoutWeight(1)
              .padding({ left: 12, right: 12, top: 4, bottom: 12 })
              .scrollBar(BarState.Off)
          }
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }

  @Builder
  private RuleCard(rule: Api.AiRule) {
    Column() {
      Row() {
        Text(rule.match_key).fontSize(15).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary).layoutWeight(1)
        // 状态徽标
        Row() {
          Text(this.statusLabel(rule.status)).fontSize(11).fontColor(this.statusColor(rule.status)).fontWeight(FontWeight.Medium)
        }.padding({ left: 8, right: 8, top: 3, bottom: 3 }).backgroundColor(this.statusColor(rule.status) + '22').borderRadius(999)
      }
      Text('类型：' + rule.rule_type).fontSize(12).fontColor(COLORS.textSecondary).margin({ top: 4 })
      Row() {
        Text('Score ' + Math.round(rule.score)).fontSize(11).fontColor(COLORS.textSecondary)
        Text('  Accuracy ' + Math.round((rule.accuracy || 0) * 100) + '%').fontSize(11).fontColor(COLORS.textSecondary).margin({ left: 12 })
        Text('  样本 ' + rule.sample_count).fontSize(11).fontColor(COLORS.textSecondary).margin({ left: 12 })
      }.margin({ top: 2 })
      if (rule.target_category_id) {
        Text('目标类目 ID: ' + rule.target_category_id).fontSize(11).fontColor(COLORS.textSecondary).margin({ top: 4 })
      }
      if (rule.target_account_id) {
        Text('目标账户 ID: ' + rule.target_account_id).fontSize(11).fontColor(COLORS.textSecondary)
      }

      Row() {
        if (rule.status === 'disabled') {
          Button('启用')
            .fontSize(13).fontColor(COLORS.onPrimary).backgroundColor(COLORS.brand)
            .height(34).layoutWeight(1)
            .onClick(() => this.enable(rule.id))
            .enabled(this.pendingId !== rule.id)
        } else {
          Button(this.pendingId === rule.id ? '处理中…' : '禁用')
            .fontSize(13).fontColor(COLORS.danger).backgroundColor(COLORS.errorContainer)
            .height(34).layoutWeight(1)
            .onClick(() => this.disable(rule.id))
            .enabled(this.pendingId !== rule.id)
        }
      }.margin({ top: 10 })
    }.width('100%').padding(14).backgroundColor(COLORS.surface).borderRadius(14)
      .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
  }
}
