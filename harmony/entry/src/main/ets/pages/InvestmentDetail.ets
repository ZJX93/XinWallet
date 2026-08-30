/**
 * 理财详情（对齐安卓 InvestmentDetailScreen.kt）：当前市值 + 收益 + 持仓信息行。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { BalanceCard, LoadingBox, TopBar, AppBackground } from '../common/components/Components';

interface Inv {
  id: number; name: string; code?: string; type?: string; accountId?: number;
  buyPrice?: number; currentPrice?: number; quantity?: number;
  cost?: number; currentValue?: number; profit?: number; profitRate?: number;
}

@Component
export struct InvestmentDetailPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @Prop itemId: number = 0;
  @State inv: Inv | null = null;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getInvestments();
      const arr: ESObject[] = ((r.data as ESObject)?.investments as ESObject[]) || [];
      this.inv = arr.find((x: Inv) => x.id === this.itemId) || null;
    } catch (e) { console.error('InvDetail:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  @Builder InfoRow(label: string, value: string) {
    Row() {
      Text(label).fontSize(14).fontColor(COLORS.textSecondary).layoutWeight(1)
      Text(value).fontSize(14).fontColor(COLORS.textPrimary)
    }.width('100%').padding({ top: 10, bottom: 10 })
      .borderWidth({ bottom: 1 }).borderColor(COLORS.divider)
  }

  build() {
    Column() {
      TopBar({ title: this.inv?.name ?? '理财详情', onBack: () => router.back() })
      if (this.loading) { LoadingBox() }
      else if (!this.inv) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            BalanceCard({ title: '当前市值', amount: this.inv!.currentValue || 0, subtitle: `总成本 ${fmtMoney(this.inv!.cost || 0)}` })
            Row({ space: 10 }) {
              Column({ space: 4 }) {
                Text('收益').fontSize(13).fontColor(COLORS.textSecondary)
                Text(fmtMoney(this.inv!.profit || 0)).fontSize(18).fontWeight(FontWeight.Bold)
                  // 红涨绿跌：投资盈利用 income(红)、亏损用 expense(绿)。
                  // 原写法正负色反了（盈利显示绿色）——与项目其余部分及中国习惯矛盾
                  .fontColor((this.inv!.profit || 0) >= 0 ? COLORS.income : COLORS.expense)
              }.layoutWeight(1).padding(14).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
              Column({ space: 4 }) {
                Text('收益率').fontSize(13).fontColor(COLORS.textSecondary)
                Text(`${((this.inv!.profitRate || 0) * 100).toFixed(2)}%`).fontSize(18).fontWeight(FontWeight.Bold)
                  .fontColor((this.inv!.profit || 0) >= 0 ? COLORS.income : COLORS.expense)
              }.layoutWeight(1).padding(14).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
            }
            Column({ space: 0 }) {
              // 交易记录入口：跳转独立页展示买入/卖出/分红等流水
              Row() {
                Text('📋 交易记录').fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
                Text('›').fontSize(18).fontColor(COLORS.textSecondary)
              }.width('100%').padding({ top: 14, bottom: 14, left: 12, right: 12 })
                .backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
                .onClick(() => router.pushDestination({ url: 'pages/InvestmentTransactions', params: { id: this.inv!.id } }))

              SectionTitleLocal({ text: '持仓信息' })
              this.InfoRow('名称', this.inv!.name)
              if (this.inv!.code) this.InfoRow('代码', this.inv!.code!)
              this.InfoRow('类型', this.inv!.type || '-')
              this.InfoRow('买入价', fmtMoney(this.inv!.buyPrice || 0))
              this.InfoRow('现价', fmtMoney(this.inv!.currentPrice || 0))
              this.InfoRow('持有数量', String(this.inv!.quantity || 0))
            }.padding(12).backgroundColor(COLORS.cardGlass).borderRadius(12)
              .border({ width: 0.5, color: COLORS.outlineVariant })
            Blank().height(20)
          }.padding(12)
        }.layoutWeight(1)
      }
    }.width('100%').height('100%')
  }
}

// 局部 SectionTitle（避免与 Components 导入冲突时冗余导入）
@Component
struct SectionTitleLocal {
  text: string = '';
  build() {
    Text(this.text).fontSize(15).fontWeight(FontWeight.Medium).fontColor(COLORS.textPrimary)
      .margin({ left: 4, top: 6, bottom: 4 })
  }
}

@Entry
@Component
struct InvestmentDetail {
  @State itemId: number = 0;
  aboutToAppear(): void {
    const p: ESObject = (router.getParams() as ESObject) || {};
    if (p.id) this.itemId = p.id;
  }
  build() {
    Stack() {
      AppBackground()
      Column() { InvestmentDetailPage({ itemId: this.itemId }) }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
