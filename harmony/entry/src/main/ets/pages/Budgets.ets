/**
 * 预算管理（对齐安卓 BudgetsScreen.kt）：列表 + 进度条(超支变红) + 新增/编辑/删除。
 */
import router from '@ohos.router';
import { BudgetRequest, Budget } from '../common/models';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, fmtMoney, LAYOUT } from '../common/theme';
import { TopBar, SectionTitle, EmptyState, LoadingBox, LinearProgress, IconCircle, FloatingButton, Chip, BottomSheet, SheetHeader, AppBackground , ConfirmDialog } from '../common/components/Components';

const PERIODS: string[] = ['月', '周', '季', '半年', '年'];

@Component
export struct BudgetsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State list: Budget[] = [];
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showEdit: boolean = false;
  // 待删除项：非 null 即弹确认框。删除是不可撤销操作，不能一点即删
  @State pendingDelete: Budget | null = null;
  @State editingId: number = 0;
  @State fName: string = '';
  @State fAmount: string = '';
  @State fPeriod: string = '月';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getBudgets();
      if (r.success) this.list = r.data as Budget[] || [];
    } catch (e) { console.error('Budgets:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  used(b: Budget): number { return b.spent ?? b.used ?? 0; }

  openAdd(): void { this.editingId = 0; this.fName = ''; this.fAmount = ''; this.fPeriod = '月'; this.showEdit = true; }
  openEdit(b: Budget): void { this.editingId = b.id; this.fName = b.name; this.fAmount = String(b.amount); this.fPeriod = b.period || '月'; this.showEdit = true; }

  async save(): Promise<void> {
    const amt = Number(this.fAmount);
    if (!this.fName) { toast('请填写预算名称'); return; }
    if (!amt) { toast('请填写预算金额'); return; }
    const req: BudgetRequest = { name: this.fName, amount: amt, period: this.fPeriod };
    try {
      if (this.editingId) await Api.updateBudget(this.editingId, req);
      else await Api.createBudget(req);
      this.showEdit = false; this.load();
      toast('已保存');
    } catch (e) {
      toastLong('保存预算失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  async remove(b: Budget): Promise<void> {
    try {
      await Api.deleteBudget(b.id);
      toast('已删除');
      this.load();
    } catch (e) {
      // 静默吞掉删除失败会让用户以为删成功了，刷新后条目又回来 —— 必须提示
      toastLong('删除预算失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  @Builder EditSheet() {
    Column({ space: 12 }) {
      SheetHeader({ title: this.editingId ? '编辑预算' : '新增预算', onClose: () => { this.showEdit = false; } })
      TextInput({ placeholder: '预算名称', text: this.fName }).onChange((v: string) => this.fName = v)
      TextInput({ placeholder: '金额', text: this.fAmount }).type(InputType.Number).onChange((v: string) => this.fAmount = v)
      Row({ space: 8 }) {
        Text('周期').fontSize(14).fontColor(COLORS.textSecondary)
        ForEach(PERIODS, (p: string) => {
          Chip({ label: p, active: this.fPeriod === p, onTap: () => { this.fPeriod = p; } })
        })
      }
      Button('保存').width('100%').onClick(() => this.save())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showEdit = false)
    }
  }

  build() {
    Column() {
      TopBar({ title: '预算管理' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 8 }) {
            if (this.list.length === 0) { EmptyState({ text: '还没有预算' }) }
            else {
              ForEach(this.list, (b: Budget) => {
                Column({ space: 10 }) {
                  Row({ space: 10 }) {
                    IconCircle({ icon: '💰', boxSize: 36, iconSize: 18, bg: COLORS.brandBgLight })
                    Column({ space: 2 }) {
                      Text(b.name).fontSize(15).fontColor(COLORS.textPrimary)
                      Text(b.period || '月').fontSize(12).fontColor(COLORS.textSecondary)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                  }
                  Row() {
                    Text(fmtMoney(this.used(b))).fontSize(14).fontColor(COLORS.textPrimary)
                    Text(` / ${fmtMoney(b.amount)}`).fontSize(12).fontColor(COLORS.textSecondary)
                  }
                  LinearProgress({
                    value: b.amount > 0 ? this.used(b) / b.amount : 0,
                    color: this.used(b) > b.amount ? COLORS.danger : COLORS.brand,
                    showPercent: true
                  })
                  if (this.used(b) > b.amount) {
                    Text(`已超支 ${fmtMoney(this.used(b) - b.amount)}`).fontSize(12).fontColor(COLORS.danger)
                  }
                }.width('100%').padding(14).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
                  .onClick(() => this.openEdit(b))
                  .gesture(LongPressGesture().onAction(() => this.pendingDelete = b))
              }, (b: Budget) => b.id.toString())
            }
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
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct Budgets {
  build() {
    Stack() {
      AppBackground()
      Column() { BudgetsPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
