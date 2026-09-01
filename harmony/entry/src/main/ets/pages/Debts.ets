/**
 * 债务管理（对齐安卓 DebtsScreen.kt）：汇总 4 卡 + 应付/应收分组 + 还款/编辑/删除。
 */
import router from '@ohos.router';
import { DebtRequest, DebtDetail, RepaymentItem } from '../common/models';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, fmtMoney, LAYOUT } from '../common/theme';
import { TopBar, SectionTitle, EmptyState, LoadingBox, LinearProgress, CategoryIcon, FloatingButton, BottomSheet, AppBackground , ConfirmDialog } from '../common/components/Components';

interface Debt { id: number; name: string; type?: string; principal?: number; remaining?: number; monthly?: number; paid?: number; dueDate?: string; icon?: string; }

@Component
export struct DebtsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State data: ESObject = null;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showEdit: boolean = false;
  // 待删除项：非 null 即弹确认框。删除是不可撤销操作，不能一点即删
  @State pendingDelete: Debt | null = null;
  @State showRepay: boolean = false;
  @State editingId: number = 0;
  @State fName: string = '';
  @State fType: string = 'payable';
  @State fPrincipal: string = '';
  @State fMonthly: string = '';
  @State repayId: number = 0;
  @State repayAmt: string = '';
  // 债务明细（含还款记录列表）+ 编辑还款
  @State showDetail: boolean = false;
  @State detailDebt: Debt | null = null;
  @State detailRepayments: RepaymentItem[] = [];
  @State detailLoading: boolean = false;
  @State editRepay: RepaymentItem | null = null;   // 正在编辑的还款记录（非 null 即编辑态）

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getDebts();
      if (r.success) this.data = r.data;
    } catch (e) { console.error('Debts:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  payable(): Debt[] { return (this.data?.payable || this.data?.debts || []) as Debt[]; }
  receivable(): Debt[] { return (this.data?.receivable || []) as Debt[]; }

  openAdd(): void { this.editingId = 0; this.fName = ''; this.fType = 'payable'; this.fPrincipal = ''; this.fMonthly = ''; this.showEdit = true; }
  openEdit(d: Debt): void { this.editingId = d.id; this.fName = d.name; this.fType = d.type || 'payable'; this.fPrincipal = String(d.principal || ''); this.fMonthly = String(d.monthly || ''); this.showEdit = true; }

  async save(): Promise<void> {
    // 原先完全无校验：名称空着也会提交，后端返回 400 又被静默吞掉，用户毫无感知
    if (!this.fName) { toast('请填写欠款名称'); return; }
    const req: DebtRequest = {
      name: this.fName,
      type: this.fType,
      principal: Number(this.fPrincipal) || 0,
      monthlyPayment: Number(this.fMonthly) || 0
    };
    try {
      if (this.editingId) await Api.updateDebt(this.editingId, req);
      else await Api.createDebt(req);
      this.showEdit = false; this.load();
      toast('已保存');
    } catch (e) {
      toastLong('保存欠款失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  async remove(d: Debt): Promise<void> {
    try {
      await Api.deleteDebt(d.id);
      toast('已删除');
      this.load();
    } catch (e) {
      // 静默吞掉删除失败会让用户以为删成功了，刷新后条目又回来 —— 必须提示
      toastLong('删除欠款失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  openRepay(d: Debt): void { this.repayId = d.id; this.repayAmt = ''; this.showRepay = true; }

  /** 打开债务明细：拉取该债务的还款记录列表（GET /debts/:id） */
  openDetail(d: Debt): void {
    this.detailDebt = d;
    this.showDetail = true;
    this.loadRepayments(d.id);
  }
  async loadRepayments(id: number): Promise<void> {
    this.detailLoading = true;
    try {
      const r = await Api.getDebt(id);
      this.detailRepayments = r.data?.repayments ?? [];
    } catch (e) { /* 读失败静默降级：列表留空 */ }
    finally { this.detailLoading = false; }
  }
  /** 进入编辑还款：回填金额，RepaySheet 切换为编辑态 */
  openEditRepay(r: RepaymentItem): void {
    this.editRepay = r;
    this.repayAmt = String(r['amount'] ?? '');
    this.showRepay = true;
  }
  async doRepay(): Promise<void> {
    const amt = Number(this.repayAmt);
    if (!amt) { toast('请填写还款金额'); return; }
    try {
      await Api.createRepayment(this.repayId, { amount: amt });
      this.showRepay = false;
      toast('已记录还款');
      this.load();
    } catch (e) {
      // 还款是写操作，失败必须说明原因 —— 否则用户以为记上了，实际没有
      toastLong('还款失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  /** 删除还款记录：DELETE /debts/:id/repayments/:rid */
  async removeRepay(r: RepaymentItem): Promise<void> {
    const debtId = (r['debt_id'] ?? this.detailDebt?.id ?? 0) as number;
    try {
      await Api.deleteRepayment(debtId, r['id'] as number);
      toast('已删除还款记录');
      this.loadRepayments(debtId);
    } catch (e) {
      toastLong('删除失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  /** 编辑还款：PUT /debts/:id/repayments/:rid，金额可改、其余沿用原记录 */
  async doEditRepay(): Promise<void> {
    if (!this.editRepay) return;
    const amt = Number(this.repayAmt);
    if (!amt) { toast('请填写还款金额'); return; }
    const orig: RepaymentItem = this.editRepay as RepaymentItem;
    const debtId = (orig['debt_id'] ?? this.detailDebt?.id ?? 0) as number;
    try {
      await Api.updateRepayment(debtId, orig['id'] as number, {
        amount: amt,
        paid_at: orig['paid_at'] ?? null,
        note: orig['note'] ?? null,
        account_id: (orig['account_id'] ?? 0) as number
      });
      this.showRepay = false;
      this.editRepay = null;
      toast('已更新还款');
      this.loadRepayments(debtId);
    } catch (e) {
      toastLong('更新失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  @Builder DebtRow(d: Debt) {
    Column({ space: 6 }) {
      Row({ space: 12 }) {
        CategoryIcon({ icon: d.icon || '🤝', iconSize: 40 })
        Column() {
          Text(d.name).fontSize(15).fontColor(COLORS.textPrimary)
          if (d.dueDate) Text(`到期 ${d.dueDate}`).fontSize(11).fontColor(COLORS.textSecondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Column() {
          Text(fmtMoney(d.remaining ?? d.principal ?? 0)).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(d.type === 'receivable' ? COLORS.expense : COLORS.income)
        }.alignItems(HorizontalAlign.End)
      }
      Row() {
        Text(`本金 ${fmtMoney(d.principal || 0)}`).fontSize(12).fontColor(COLORS.textSecondary).layoutWeight(1)
        if (d.monthly) Text(`月供 ${fmtMoney(d.monthly)}`).fontSize(12).fontColor(COLORS.textSecondary)
      }
      if ((d.principal || 0) > 0 && (d.remaining ?? 0) >= 0) {
        LinearProgress({ value: 1 - (d.remaining ?? 0) / (d.principal || 1), color: COLORS.brand, showPercent: true })
      }
      Row({ space: 12 }) {
        Text('明细').fontSize(13).fontColor(COLORS.textSecondary).onClick(() => this.openDetail(d))
        Text('还款').fontSize(13).fontColor(COLORS.brand).onClick(() => this.openRepay(d))
        Text('编辑').fontSize(13).fontColor(COLORS.textSecondary).onClick(() => this.openEdit(d))
        Text('删除').fontSize(13).fontColor(COLORS.danger).onClick(() => this.pendingDelete = d)
      }.justifyContent(FlexAlign.End)
    }.width('100%').padding(14).backgroundColor(COLORS.cardGlass).borderRadius(12)
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  @Builder EditSheet() {
    Column({ space: 12 }) {
      Text(this.editingId ? '编辑债务' : '新增债务').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '名称', text: this.fName }).onChange((v: string) => this.fName = v)
      Row({ space: 8 }) {
        Text('类型').fontSize(14).fontColor(COLORS.textSecondary)
        Text('我欠别人').fontSize(13).padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.fType === 'payable' ? COLORS.brand : COLORS.brandBgLight)
          .fontColor(this.fType === 'payable' ? '#FFFFFF' : COLORS.textPrimary).borderRadius(14)
          .onClick(() => this.fType = 'payable')
        Text('别人欠我').fontSize(13).padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(this.fType === 'receivable' ? COLORS.brand : COLORS.brandBgLight)
          .fontColor(this.fType === 'receivable' ? '#FFFFFF' : COLORS.textPrimary).borderRadius(14)
          .onClick(() => this.fType = 'receivable')
      }
      TextInput({ placeholder: '本金', text: this.fPrincipal }).type(InputType.Number).onChange((v: string) => this.fPrincipal = v)
      TextInput({ placeholder: '月供', text: this.fMonthly }).type(InputType.Number).onChange((v: string) => this.fMonthly = v)
      Button('保存').width('100%').onClick(() => this.save())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showEdit = false)
    }
  }

  @Builder RepaySheet() {
    Column({ space: 12 }) {
      Text(this.editRepay ? '编辑还款' : '记还款').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '还款金额', text: this.repayAmt }).type(InputType.Number).onChange((v: string) => this.repayAmt = v)
      Button('确定').width('100%').onClick(() => { if (this.editRepay) { this.doEditRepay(); } else { this.doRepay(); } })
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => { this.showRepay = false; this.editRepay = null; })
    }
  }

  build() {
    Column() {
      TopBar({ title: '债务管理' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            // 汇总
            if (this.data) {
              Row({ space: 8 }) {
                this.SumCell('我欠别人', fmtMoney(this.data.totalPayable ?? 0), COLORS.income)
                this.SumCell('别人欠我', fmtMoney(this.data.totalReceivable ?? 0), COLORS.expense)
              }
              Row({ space: 8 }) {
                this.SumCell('本月待还', fmtMoney(this.data.monthDue ?? 0), COLORS.textPrimary)
                this.SumCell('逾期未还', fmtMoney(this.data.overdue ?? 0), COLORS.danger)
              }
            }
            if (this.payable().length > 0) {
              SectionTitle({ text: '我欠别人（应付）' })
              ForEach(this.payable(), (d: Debt) => { this.DebtRow(d) }, (d: Debt) => d.id.toString())
            }
            if (this.receivable().length > 0) {
              SectionTitle({ text: '别人欠我（应收）' })
              ForEach(this.receivable(), (d: Debt) => { this.DebtRow(d) }, (d: Debt) => d.id.toString())
            }
            if (!this.data) { EmptyState({ text: '暂无债务' }) }
            // FAB 悬浮在 88%，最后一项需避让，否则被圆钮压住无法点击
            Blank().height(LAYOUT.fabSafe)
          }.padding(12)
        }.layoutWeight(1)
      }
      FloatingButton({ onTap: () => this.openAdd() })
      ConfirmDialog({
        show: this.pendingDelete !== null,
        title: '确认删除',
        message: '删除「' + (this.pendingDelete?.name ?? '') + '」后无法恢复',
        confirmText: '删除',
        onCancel: () => { this.pendingDelete = null; },
        onConfirm: () => {
          const target = this.pendingDelete;
          this.pendingDelete = null;
          if (target) { this.remove(target); }
        }
      })
      BottomSheet({ show: this.showEdit, maxHeight: '85%', onDismiss: () => { this.showEdit = false; } }) {
        this.EditSheet()
      }
      BottomSheet({ show: this.showRepay, maxHeight: '65%', onDismiss: () => { this.showRepay = false; this.editRepay = null; } }) {
        this.RepaySheet()
      }
      BottomSheet({ show: this.showDetail, maxHeight: '80%', onDismiss: () => { this.showDetail = false; } }) {
        Column({ space: 12 }) {
          Text((this.detailDebt?.name ?? '债务') + ' · 还款记录').fontSize(16).fontWeight(FontWeight.Bold)
          if (this.detailLoading) { LoadingBox() }
          if (!this.detailLoading && this.detailRepayments.length === 0) {
            EmptyState({ text: '暂无还款记录' })
          }
          ForEach(this.detailRepayments, (r: ESObject) => {
            Row({ space: 8 }) {
              Column() {
                Text(fmtMoney(r['amount'] ?? 0)).fontSize(15).fontColor(COLORS.income)
                Text((r['paid_at'] ? (r['paid_at'] as string).slice(0, 10) : '') + (r['note'] ? ' · ' + (r['note'] as string) : ''))
                  .fontSize(11).fontColor(COLORS.textSecondary)
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              Text('编辑').fontSize(13).fontColor(COLORS.brand).onClick(() => this.openEditRepay(r))
              Text('删除').fontSize(13).fontColor(COLORS.danger).onClick(() => { this.removeRepay(r); })
            }.padding(10).backgroundColor(COLORS.cardGlass).borderRadius(10)
          }, (r: ESObject) => (r['id'] ?? '').toString())
        }.padding(16)
      }
    }.width('100%').height('100%')
  }

  @Builder SumCell(title: string, value: string, color: string) {
    Column({ space: 4 }) {
      Text(title).fontSize(12).fontColor(COLORS.textSecondary)
      Text(value).fontSize(16).fontWeight(FontWeight.Bold).fontColor(color)
    }.layoutWeight(1).padding(12).backgroundColor(COLORS.cardGlass).borderRadius(12)
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }
}

@Entry
@Component
struct Debts {
  build() {
    Stack() {
      AppBackground()
      Column() { DebtsPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
