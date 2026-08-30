/**
 * 账户（对齐安卓 AccountsScreen.kt）：总资产 + 按类型分组列表 + 点击进详情 + 新增账户。
 * 编辑/销户/删除统一在 AccountDetail 页，本页不再提供第二套入口。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, LAYOUT } from '../common/theme';
import { Account, AccountsResponse } from '../common/models';
import { BalanceCard, SectionTitle, EmptyState, LoadingBox, AccountListItem, TopBar, FloatingButton, Chip, BottomSheet, SheetHeader, Card, AppBackground } from '../common/components/Components';

const TYPES: string[] = ['现金', '储蓄卡', '信用卡', '电子支付', '金融账户', '数字货币', '其他'];
const ICONS: string[] = ['💵', '🏦', '💳', '📱', '📊', '🪙', '💰'];

interface GroupedItem {
  type: string;
  list: Account[];
}

@Component
export struct AccountsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State accounts: Account[] = [];
  @State total: number = 0;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showAdd: boolean = false;
  @State fName: string = '';
  @State fType: string = '现金';
  @State fBalance: string = '';
  @State fLimit: string = '';
  @State fIcon: string = '💵';
  @State fAnnualRate: string = '';
  @State fInterestCycle: string = 'monthly';
  /**
   * 正在编辑的账户；null = 新增模式。
   * 表单（AddSheet）新增/编辑共用 —— 字段完全相同，分成两套只会漂移。
   */
  @State editing: Account | null = null;
  // 已移除 acting / confirmKind / confirmTarget：
  // 它们只服务于列表页的「⋯」操作面板与其二次确认，功能已收敛到 AccountDetail 页。

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getAccounts();
      if (r.success && r.data) {
        const d = r.data as AccountsResponse;
        this.accounts = d.accounts || [];
        this.total = d.totalAssets ?? this.accounts.reduce((s, a) => s + (a.balance || 0), 0);
      }
    } catch (e) { console.error('Accounts:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  grouped(): GroupedItem[] {
    const map = new Map<string, Account[]>();
    this.accounts.forEach(a => {
      const t = a.type || '其他';
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(a);
    });
    const res: GroupedItem[] = [];
    TYPES.forEach(t => { if (map.has(t)) res.push({ type: t, list: map.get(t)! }); });
    map.forEach((list, t) => { if (!TYPES.includes(t)) res.push({ type: t, list }); });
    return res;
  }

  /** 打开新增表单（清空字段） */
  openCreate(): void {
    this.editing = null;
    this.fName = ''; this.fType = '现金'; this.fBalance = ''; this.fLimit = '';
    this.fIcon = '💵'; this.fAnnualRate = ''; this.fInterestCycle = 'monthly';
    this.showAdd = true;
  }

  /** 打开编辑表单（回填字段） */
  openEdit(a: Account): void {
    this.editing = a;
    this.fName = a.name || '';
    this.fType = a.type || '现金';
    // 编辑时这一栏是「当前余额」而不是「开户余额」，且服务端不接受直接改余额
    // （余额由复式记账推导，见 server/routes/transactions.js 的 computeAccountBalance）。
    // 所以回填后置灰不可编辑，避免用户以为改了能生效。
    this.fBalance = String(a.balance ?? 0);
    this.fLimit = String(a.credit_limit ?? 0);
    this.fIcon = a.icon || '💵';
    this.fAnnualRate = a.annual_rate === undefined || a.annual_rate === null ? '' : String(a.annual_rate);
    this.fInterestCycle = a.interest_cycle || 'monthly';
    this.showAdd = true;
  }

  async save(): Promise<void> {
    if (!this.fName) { toast('请填写账户名称'); return; }
    try {
      const rate = this.fAnnualRate.trim() === '' ? undefined : Number(this.fAnnualRate);
      const target = this.editing;
      if (target) {
        // 编辑：不传 opening_balance —— 余额由账本推导，直接改会与流水对不上
        await Api.updateAccount(target.id, {
          name: this.fName,
          type: this.fType,
          icon: this.fIcon,
          credit_limit: Number(this.fLimit) || 0,
          annual_rate: rate,
          interest_cycle: this.fInterestCycle
        });
      } else {
        await Api.createAccount({
          name: this.fName,
          type: this.fType,
          icon: this.fIcon,
          opening_balance: Number(this.fBalance) || 0,
          credit_limit: Number(this.fLimit) || 0,
          annual_rate: rate,
          interest_cycle: this.fInterestCycle
        });
      }
      this.showAdd = false;
      this.editing = null;
      this.fName = ''; this.fBalance = ''; this.fLimit = ''; this.fAnnualRate = '';
      this.fInterestCycle = 'monthly';
      this.load();
      toast(target ? '已更新' : '已保存');
    } catch (e) {
      toastLong((this.editing ? '更新' : '保存') + '账户失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  /*
   * 已移除 doClose() / doDelete()：唯一调用方是列表页的操作面板，
   * 面板撤掉后它们就是死代码。销户/删除逻辑在 AccountDetail.ets 里有等价实现
   * （含服务端拒绝时「请改用销户」的原文提示），不必在此保留第二份。
   */

  @Builder AddSheet() {
    Column({ space: 12 }) {
      Text(this.editing ? '编辑账户' : '新增账户').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '账户名称', text: this.fName }).onChange((v: string) => this.fName = v)
      Row({ space: 8 }) {
        Text('类型').fontSize(14).fontColor(COLORS.textSecondary)
        Scroll() {
          Row({ space: 6 }) {
            ForEach(TYPES, (t: string) => {
              Chip({ label: t, active: this.fType === t, onTap: () => { this.fType = t; } })
            })
          }
        }.scrollable(ScrollDirection.Horizontal).layoutWeight(1)
      }
      Row({ space: 8 }) {
        Text('图标').fontSize(14).fontColor(COLORS.textSecondary)
        ForEach(ICONS, (ic: string) => {
          Chip({ label: ic, active: this.fIcon === ic, onTap: () => { this.fIcon = ic; } })
        })
      }
      // 编辑态下这一栏是「当前余额」，且服务端不接受直接改（余额由复式记账推导）。
      // 置灰 + 换 placeholder 说明原因，比留一个改了不生效的输入框诚实。
      if (this.editing) {
        Column({ space: 4 }) {
          TextInput({ placeholder: '当前余额', text: this.fBalance })
            .enabled(false).opacity(0.6)
          Text('余额由流水推导，如需调整请记一笔流水')
            .fontSize(11).fontColor(COLORS.textSecondary)
        }.alignItems(HorizontalAlign.Start).width('100%')
      } else {
        TextInput({ placeholder: '开户余额', text: this.fBalance }).onChange((v: string) => this.fBalance = v)
      }
      TextInput({ placeholder: '信用额度(信用卡)', text: this.fLimit }).onChange((v: string) => this.fLimit = v)
      TextInput({ placeholder: '年利率(%) 选填', text: this.fAnnualRate })
        .type(InputType.Number).onChange((v: string) => this.fAnnualRate = v)
      Row({ space: 8 }) {
        Text('计息周期').fontSize(14).fontColor(COLORS.textSecondary)
        Scroll() {
          Row({ space: 8 }) {
            ForEach(['daily', 'monthly', 'quarterly', 'yearly'], (cyc: string) => {
              Text(cyc).fontSize(13).padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(this.fInterestCycle === cyc ? COLORS.brand : COLORS.brandBgLight)
                .fontColor(this.fInterestCycle === cyc ? '#FFFFFF' : COLORS.textPrimary)
                .borderRadius(14).onClick(() => this.fInterestCycle = cyc)
            })
          }
        }.scrollable(ScrollDirection.Horizontal).layoutWeight(1)
      }
      Button('保存').width('100%').onClick(() => this.save())
      Button('取消').width('100%').backgroundColor(COLORS.divider)
        .onClick(() => { this.showAdd = false; this.editing = null; })
    }
  }

  /*
   * 已移除：ActionSheet（编辑/销户/彻底删除操作面板）与 ConfirmSheet（二次确认），
   * 以及配套的 doClose() / doDelete()。
   *
   * 这三个操作在 AccountDetail 页已完整实现（含同样的二次确认文案）。
   * 列表页再放一套是同一功能的第二份实现 —— 两套表单、两套确认，
   * 改一处必漏一处，用户也反馈「重复」。现收敛为：
   *   列表页 = 浏览 + 选择（点击进详情）
   *   详情页 = 管理（编辑 / 销户 / 删除）
   * 新增账户仍留在列表页的 FAB，因为新增时还没有「某个账户」可进详情。
   */

  build() {
    Column() {
      TopBar({ title: '账户' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            BalanceCard({ title: '总资产', amount: this.total, subtitle: '所有活跃账户余额合计' })
            if (this.accounts.length === 0) {
              EmptyState({ text: '还没有账户，点右下角「+」添加第一个' })
            } else {
              ForEach(this.grouped(), (g: ESObject) => {
                Column({ space: 6 }) {
                  SectionTitle({ text: g.type })
                  ForEach(g.list, (a: Account) => {
                    // 只保留「点击进详情」这一条路径。
                    //
                    // 原先这里还有可见的「⋯」+ 长按两个入口，弹出「编辑/销户/彻底删除」
                    // 操作面板 —— 但 AccountDetail 页顶部本来就有同样这三个操作，
                    // 属于同一功能在两处实现（两套表单、两套二次确认，改一处漏一处）。
                    // 用户反馈「这个功能重复」，故收敛到详情页作为唯一入口：
                    // 列表负责浏览与选择，详情负责管理。
                    AccountListItem({
                      account: a,
                      onTap: () => router.pushDestination({ url: 'pages/AccountDetail', params: { id: a.id } })
                    })
                  }, (a: Account) => a.id.toString())
                }
              }, (g: ESObject) => g.type)
            }
            // FAB 悬浮在 88%，最后一项需避让，否则被圆钮压住无法点击
            Blank().height(LAYOUT.fabSafe)
          }.padding(12)
        }.layoutWeight(1)
      }
      // FAB
      FloatingButton({ onTap: () => this.openCreate() })
      BottomSheet({ show: this.showAdd, maxHeight: '85%', onDismiss: () => { this.showAdd = false; this.editing = null; } }) {
        Column({ space: 12 }) {
          SheetHeader({
            title: this.editing ? '编辑账户' : '新增账户',
            subtitle: this.editing ? '修改后立即生效' : '创建后会出现在账户列表中',
            onClose: () => { this.showAdd = false; this.editing = null; }
          })
          this.AddSheet()
        }
      }
      // 「账户操作」与「确认销户/删除」两个 BottomSheet 已随操作面板一起移除，
      // 对应能力见 AccountDetail 页。
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct Accounts {
  build() {
    Stack() {
      AppBackground()
      Column() { AccountsPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
