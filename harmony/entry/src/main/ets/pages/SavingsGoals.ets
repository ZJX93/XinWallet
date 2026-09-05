/**
 * 储蓄目标（对齐安卓 SavingsGoalsScreen.kt）：列表 + 进度条 + 存入/取回/流水。
 */
import router from '@ohos.router';
import { SavingsGoalRequest, Goal } from '../common/models';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, fmtMoney, LAYOUT } from '../common/theme';
import { TopBar, SectionTitle, EmptyState, LoadingBox, LinearProgress, CategoryIcon, FloatingButton, BottomSheet, AppBackground , ConfirmDialog } from '../common/components/Components';

const ICONS: string[] = ['🎯', '🏠', '🚗', '✈️', '💍', '📱', '🎓', '🐱'];

@Component
export struct SavingsGoalsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State list: Goal[] = [];
  @State accounts: ESObject[] = [];
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showEdit: boolean = false;
  // 待删除项：非 null 即弹确认框。删除是不可撤销操作，不能一点即删
  @State pendingDelete: Goal | null = null;
  @State showAlloc: boolean = false;
  @State editingId: number = 0;
  @State fName: string = '';
  @State fIcon: string = '🎯';
  @State fTarget: string = '';
  @State fAccount: number = 0;
  @State allocId: number = 0;
  @State allocAmt: string = '';
  @State allocMode: string = '存入';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const _r = await Promise.all([Api.getSavingsGoals(), Api.getAccounts()]);
      const g = _r[0];
      const a = _r[1];
      if (g.success) this.list = g.data as Goal[] || [];
      if (a.success) this.accounts = (a.data as ESObject)?.accounts || [];
    } catch (e) { console.error('Savings:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  openAdd(): void { this.editingId = 0; this.fName = ''; this.fIcon = '🎯'; this.fTarget = ''; this.fAccount = this.accounts[0]?.id || 0; this.showEdit = true; }
  openEdit(g: Goal): void { this.editingId = g.id; this.fName = g.name; this.fIcon = g.icon || '🎯'; this.fTarget = String(g.target || ''); this.fAccount = g.accountId || 0; this.showEdit = true; }

  async save(): Promise<void> {
    const t = Number(this.fTarget);
    if (!this.fName) { toast('请填写目标名称'); return; }
    if (!t) { toast('请填写目标金额'); return; }
    const req: SavingsGoalRequest = { name: this.fName, icon: this.fIcon, target: t, accountId: this.fAccount };
    try {
      if (this.editingId) await Api.updateSavingsGoal(this.editingId, req);
      else await Api.createSavingsGoal(req);
      this.showEdit = false; this.load();
      toast('已保存');
    } catch (e) {
      toastLong('保存目标失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  async remove(g: Goal): Promise<void> {
    try {
      await Api.deleteSavingsGoal(g.id);
      toast('已删除');
      this.load();
    } catch (e) {
      // 静默吞掉删除失败会让用户以为删成功了，刷新后条目又回来 —— 必须提示
      toastLong('删除目标失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  openAlloc(g: Goal, mode: string): void {
    this.allocId = g.id; this.allocMode = mode; this.allocAmt = ''; this.showAlloc = true;
  }
  async doAlloc(): Promise<void> {
    const amt = Number(this.allocAmt);
    if (!amt) { toast('请填写金额'); return; }
    try {
      if (this.allocMode === '存入') await Api.allocateSavings(this.allocId, { amount: amt });
      else await Api.withdrawSavings(this.allocId, { amount: amt });
      this.showAlloc = false;
      toast(this.allocMode === '存入' ? '已存入' : '已取出');
      this.load();
    } catch (e) {
      // 涉及金额变动的写操作，静默失败最危险 —— 用户会以为钱已经划过去了
      toastLong(this.allocMode + '失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  @Builder EditSheet() {
    Column({ space: 12 }) {
      Text(this.editingId ? '编辑目标' : '新增目标').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '目标名称', text: this.fName }).onChange((v: string) => this.fName = v)
      Row({ space: 6 }) {
        ForEach(ICONS, (ic: string) => {
          Text(ic).fontSize(20).padding(6)
            .backgroundColor(this.fIcon === ic ? COLORS.brandBgLight : '#00000000').borderRadius(8)
            .onClick(() => this.fIcon = ic)
        })
      }
      TextInput({ placeholder: '目标金额', text: this.fTarget }).type(InputType.Number).onChange((v: string) => this.fTarget = v)
      Row({ space: 8 }) {
        Text('账户').fontSize(14).fontColor(COLORS.textSecondary)
        Scroll() {
          Row({ space: 8 }) {
            ForEach(this.accounts, (a: ESObject) => {
              Text(a.name).fontSize(13).padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(this.fAccount === a.id ? COLORS.brand : COLORS.brandBgLight)
                .fontColor(this.fAccount === a.id ? '#FFFFFF' : COLORS.textPrimary)
                .borderRadius(14).onClick(() => this.fAccount = a.id)
            })
          }
        }.scrollable(ScrollDirection.Horizontal).layoutWeight(1)
      }
      Button('保存').width('100%').onClick(() => this.save())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showEdit = false)
    }
  }

  @Builder AllocSheet() {
    Column({ space: 12 }) {
      Text(this.allocMode + '目标').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '金额', text: this.allocAmt }).type(InputType.Number).onChange((v: string) => this.allocAmt = v)
      Button('确定').width('100%').onClick(() => this.doAlloc())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showAlloc = false)
    }
  }

  build() {
    Column() {
      TopBar({ title: '储蓄目标' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 8 }) {
            if (this.list.length === 0) { EmptyState({ text: '还没有储蓄目标' }) }
            else {
              ForEach(this.list, (g: Goal) => {
                Column({ space: 6 }) {
                  Row({ space: 12 }) {
                    CategoryIcon({ icon: g.icon || '🎯', iconSize: 40 })
                    Column() {
                      Text(g.name).fontSize(15).fontColor(COLORS.textPrimary)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    Text(`${fmtMoney(g.current || 0, g.currency)} / ${fmtMoney(g.target || 0, g.currency)}`)
                      .fontSize(13).fontColor(COLORS.textSecondary)
                  }
                  LinearProgress({
                    value: (g.target ?? 0) > 0 ? (g.current || 0) / (g.target ?? 0) : 0,
                    color: (g.current || 0) >= (g.target || 0) ? COLORS.brand : COLORS.expense,
                    showPercent: true
                  })
                  Row({ space: 12 }) {
                    Text('存入').fontSize(13).fontColor(COLORS.brand).onClick(() => this.openAlloc(g, '存入'))
                    Text('取回').fontSize(13).fontColor(COLORS.brand).onClick(() => this.openAlloc(g, '取回'))
                    Text('编辑').fontSize(13).fontColor(COLORS.textSecondary).onClick(() => this.openEdit(g))
                    Text('删除').fontSize(13).fontColor(COLORS.danger).onClick(() => this.pendingDelete = g)
                  }.justifyContent(FlexAlign.End)
                }.width('100%').padding(14).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
              }, (g: Goal) => g.id.toString())
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
      BottomSheet({ show: this.showAlloc, maxHeight: '65%', onDismiss: () => { this.showAlloc = false; } }) {
        this.AllocSheet()
      }
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct SavingsGoals {
  build() {
    Stack() {
      AppBackground()
      Column() { SavingsGoalsPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
