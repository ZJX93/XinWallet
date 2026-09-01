/**
 * 理财交易记录（对齐安卓 InvestmentTransactionsScreen.kt）：展示某产品的买入/卖出/分红等流水。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney, withAlpha } from '../common/theme';
import { LoadingBox, TopBar, AppBackground, ConfirmDialog, BottomSheet } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';

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
  // 编辑理财流水（对齐安卓 InvestmentTxnSheet 的编辑态）
  @State showTxEdit: boolean = false;
  @State editTx: Tx | null = null;
  @State eType: string = 'buy';
  @State ePrice: string = '';
  @State eQuantity: string = '';
  @State eAmount: string = '';
  @State eFee: string = '';
  @State eDate: string = '';
  @State eNote: string = '';

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

  /** 打开编辑：回填原流水字段（interest→dividend，reinvest→buy） */
  openEdit(tx: Tx): void {
    this.editTx = tx;
    this.eType = tx.type === 'interest' ? 'dividend' : (tx.type === 'reinvest' ? 'buy' : tx.type);
    this.ePrice = (tx.price ?? 0).toString();
    this.eQuantity = (tx.quantity ?? 0).toString();
    this.eAmount = (tx.amount ?? 0).toString();
    this.eFee = (tx.fee ?? 0).toString();
    this.eDate = (tx.date ?? '').slice(0, 10);
    this.eNote = tx.note ?? '';
    this.showTxEdit = true;
  }

  /** 保存编辑：PUT /investments/:id/transactions/:txnId（金额按类型推导） */
  async doTxEdit(): Promise<void> {
    if (!this.editTx) return;
    const price = Number(this.ePrice);
    const quantity = Number(this.eQuantity);
    const amount = Number(this.eAmount);
    const fee = Number(this.eFee);
    if (this.eType === 'dividend') {
      if (!amount) { toast('请填写金额'); return; }
    } else if (price <= 0 || quantity <= 0) {
      toast('请填写有效的价格与数量');
      return;
    }
    const amt = this.eType === 'dividend' ? amount : price * quantity;
    try {
      await Api.updateInvestmentTransaction(this.itemId, this.editTx.id, {
        type: this.eType,
        amount: amt,
        price: price,
        quantity: quantity,
        date: this.eDate,
        note: this.eNote || null,
        fee: fee
      });
      this.showTxEdit = false;
      toast('已更新');
      this.load();
    } catch (e) {
      toastLong('更新失败：' + ((e as ApiError).message || '请检查网络'));
    }
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
        Button('改')
          .fontSize(11).fontColor('#fff').backgroundColor(COLORS.brand)
          .width(36).height(24).padding(0)
          .onClick(() => { this.openEdit(tx); })
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
        BottomSheet({ show: this.showTxEdit, maxHeight: '85%', onDismiss: () => { this.showTxEdit = false; } }) {
          Column({ space: 12 }) {
            Text('编辑流水').fontSize(16).fontWeight(FontWeight.Bold)
            Row({ space: 8 }) {
              ForEach(['buy', 'sell', 'dividend'], (t: string) => {
                Text(t === 'buy' ? '买入' : t === 'sell' ? '卖出' : '分红')
                  .fontSize(13)
                  .fontColor(this.eType === t ? '#FFFFFF' : COLORS.textSecondary)
                  .padding({ left: 10, right: 10, top: 4, bottom: 4 })
                  .backgroundColor(this.eType === t ? COLORS.brand : COLORS.cardGlass)
                  .borderRadius(8)
                  .onClick(() => { this.eType = t; })
              }, (t: string) => t)
            }
            if (this.eType === 'dividend') {
              TextInput({ placeholder: '金额', text: this.eAmount }).type(InputType.Number).onChange((v: string) => this.eAmount = v)
            } else {
              TextInput({ placeholder: '单价', text: this.ePrice }).type(InputType.Number).onChange((v: string) => this.ePrice = v)
              TextInput({ placeholder: '数量', text: this.eQuantity }).type(InputType.Number).onChange((v: string) => this.eQuantity = v)
            }
            TextInput({ placeholder: '手续费', text: this.eFee }).type(InputType.Number).onChange((v: string) => this.eFee = v)
            TextInput({ placeholder: '日期 yyyy-mm-dd', text: this.eDate }).onChange((v: string) => this.eDate = v)
            TextInput({ placeholder: '备注', text: this.eNote }).onChange((v: string) => this.eNote = v)
            Button('确定').width('100%').onClick(() => this.doTxEdit())
          }.padding(16)
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
