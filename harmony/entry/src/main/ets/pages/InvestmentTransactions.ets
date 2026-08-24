/**
 * 理财交易记录（对齐安卓 InvestmentTransactionsScreen.kt）：展示某产品的买入/卖出/分红等流水。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney, withAlpha } from '../common/theme';
import { LoadingBox, TopBar, AppBackground, ConfirmDialog } from '../common/components/Components';

interface Tx {
  id: number; type: string; type_label?: string; amount?: number; price?: number;
  quantity?: number; fee?: number; date?: string; note?: string;
}

interface InvestmentItem { id: number; name?: string }
interface InvestmentsResp { investments?: InvestmentItem[] }

@Entry
@Component
struct InvestmentTransactions {
  @State itemId: number = 0;
  @State name: string = '';
  @State list: Tx[] = [];
  @State loading: boolean = true;
  @State showDeleteConfirm: boolean = false;
  @State pendingDeleteTxn: Tx | null = null;

  aboutToAppear(): void {
    const p: ESObject = (router.getParams() as ESObject) || {};
    if (p.id) this.itemId = p.id;
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getInvestments();
      const data = r.data as InvestmentsResp;
      const arr = data.investments || [];
      const inv = arr.find((x) => x.id === this.itemId);
      if (inv) this.name = inv.name || '理财';

      const tx = await Api.getInvestmentTransactions(this.itemId);
      const rows = (tx.data as Tx[]) || [];
      this.list = rows;
    } catch (e) { console.error('InvTxns:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  async doDelete(): Promise<void> {
    if (!this.pendingDeleteTxn) return;
    const txnId = this.pendingDeleteTxn.id;
    this.showDeleteConfirm = false;
    this.loading = true;
    try {
      await Api.deleteInvestmentTransaction(this.itemId, txnId);
      await this.load();
    } catch (e) { console.error('deleteInvTxn:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  isIncome(t: string): boolean {
    return t === 'sell' || t === 'dividend' || t === 'interest';
  }

  incomeColor(t: string): string {
    return this.isIncome(t) ? COLORS.income : COLORS.expense;
  }

  /** 系统自动备注（初始买入/加仓等）不展示，仅展示用户自定义备注 */
  noteText(tx: Tx): string {
    const SYS_NOTES: string[] = ['初始买入', '加仓', '部分卖出', '清仓卖出', '建仓'];
    return (tx.note && !SYS_NOTES.includes(tx.note)) ? ('📝 ' + tx.note) : '';
  }

  @Builder TxRow(tx: Tx) {
    Row({ space: 12 }) {
      Column({ space: 4 }) {
        Row({ space: 8 }) {
          Text(tx.type_label || tx.type).fontSize(13).fontColor(this.incomeColor(tx.type)).fontWeight(FontWeight.Medium)
            .backgroundColor(withAlpha(this.incomeColor(tx.type), 0.13)).borderRadius(4).padding({ left: 8, right: 8, top: 2, bottom: 2 })
          Text((tx.date || '').slice(0, 10)).fontSize(11).fontColor(COLORS.textSecondary)
        }
        Text(`单价 ${fmtMoney(tx.price || 0)} · 数量 ${tx.quantity ?? 0} · 手续费 ${fmtMoney(tx.fee || 0)}`)
          .fontSize(11).fontColor(COLORS.textSecondary)
        if (this.noteText(tx).length > 0) {
          Text(this.noteText(tx)).fontSize(11).fontColor(COLORS.textSecondary)
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Column({ space: 4 }) {
        Text(`${this.isIncome(tx.type) ? '+' : '-'}${fmtMoney(Math.abs(tx.amount || 0))}`)
          .fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.incomeColor(tx.type))
        Button('删')
          .fontSize(11).fontColor('#fff').backgroundColor(COLORS.danger)
          .width(36).height(24).padding(0)
          .onClick(() => {
            this.pendingDeleteTxn = tx;
            this.showDeleteConfirm = true;
          })
      }.alignItems(HorizontalAlign.End)
    }.width('100%').padding(12).backgroundColor(COLORS.cardGlass).borderRadius(12)
      .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        Column() {
          TopBar({ title: `${this.name} · 交易记录`, onBack: () => router.back() })
          if (this.loading) { LoadingBox() }
          else if (this.list.length === 0) {
            Column() { Text('暂无交易记录').fontSize(14).fontColor(COLORS.textSecondary) }
              .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          }
          else {
            Scroll() {
              Column({ space: 10 }) {
                ForEach(this.list, (tx: Tx) => {
                  this.TxRow(tx)
                }, (tx: Tx) => tx.id.toString())
                Blank().height(20)
              }.padding(12)
            }.layoutWeight(1)
          }
        }.width('100%').height('100%')

        // 原先这里是一份内联的确认弹窗实现（与 ConfirmDialog 完全重复，
        // 且按钮用 danger 填充白字仅 3.84:1、遮罩 40% 聚焦不足）。已收口到公共组件。
        ConfirmDialog({
          show: this.showDeleteConfirm,
          title: '确认删除',
          message: '删除该笔交易记录后无法恢复',
          confirmText: '删除',
          onCancel: () => { this.showDeleteConfirm = false; this.pendingDeleteTxn = null; },
          onConfirm: () => { this.doDelete(); }
        })
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
