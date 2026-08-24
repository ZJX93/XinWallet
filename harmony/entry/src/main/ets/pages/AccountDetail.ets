/**
 * 账户详情（对齐安卓 AccountDetailScreen.kt）：当前余额 + 操作区 + 交易记录。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { toast, toastLong } from '../common/ui';
import { Account, TransactionItem, AddAccountInterestRequest, AccountsResponse } from '../common/models';
import { BalanceCard, LoadingBox, EmptyState, TransactionRow, TopBar, BottomSheet, SheetHeader, Chip, ActionChip, AppBackground } from '../common/components/Components';

/** 与 Accounts.ets 保持同一套取值与顺序 —— 两页表单必须给出相同的候选项 */
const TYPES: string[] = ['现金', '储蓄卡', '信用卡', '电子支付', '金融账户', '数字货币', '其他'];
const ICONS: string[] = ['💵', '🏦', '💳', '📱', '📊', '🪙', '💰'];
const CYCLES: string[] = ['daily', 'monthly', 'quarterly', 'yearly'];

@Component
export struct AccountDetailPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @Prop itemId: number = 0;
  @State account: Account | null = null;
  @State txs: TransactionItem[] = [];
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showInterest: boolean = false;
  @State iAmount: string = '';
  @State iDate: string = '';
  @State iNote: string = '';

  /** 编辑表单显隐与字段（与 Accounts.ets 的编辑态字段一一对应） */
  @State showEdit: boolean = false;
  @State fName: string = '';
  @State fType: string = '现金';
  @State fLimit: string = '';
  @State fIcon: string = '💵';
  @State fAnnualRate: string = '';
  @State fInterestCycle: string = 'monthly';
  /** 二次确认：'close' 销户 | 'delete' 彻底删除 */
  @State confirmKind: string = '';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const _r = await Promise.all([
        Api.getAccounts(),
        Api.getTransactions({ account_id: this.itemId, limit: 200 })
      ]);
      const a = _r[0];
      const t = _r[1];
      if (a.success && a.data) {
        this.account = (a.data as AccountsResponse).accounts?.find((x: Account) => x.id === this.itemId) || null;
      }
      if (t.success) this.txs = t.data || [];
    } catch (e) { console.error('AccountDetail:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 打开编辑表单并回填当前账户资料 */
  openEdit(): void {
    const a = this.account;
    if (!a) return;
    this.fName = a.name || '';
    this.fType = a.type || '现金';
    this.fLimit = String(a.credit_limit ?? 0);
    this.fIcon = a.icon || '💵';
    this.fAnnualRate = a.annual_rate === undefined || a.annual_rate === null ? '' : String(a.annual_rate);
    this.fInterestCycle = a.interest_cycle || 'monthly';
    this.showEdit = true;
  }

  /**
   * 保存编辑。
   * 不传 opening_balance —— 余额由复式记账推导（见 Accounts.ets save() 同样注释），
   * 直接改会与流水对不上。
   */
  async saveEdit(): Promise<void> {
    const a = this.account;
    if (!a) return;
    if (!this.fName) { toast('请填写账户名称'); return; }
    try {
      await Api.updateAccount(a.id, {
        name: this.fName,
        type: this.fType,
        icon: this.fIcon,
        credit_limit: Number(this.fLimit) || 0,
        annual_rate: this.fAnnualRate.trim() === '' ? undefined : Number(this.fAnnualRate),
        interest_cycle: this.fInterestCycle
      });
      this.showEdit = false;
      await this.load();   // 重新拉取，顶部 TopBar 标题与余额卡片同步刷新
      toast('已更新');
    } catch (e) {
      toastLong('更新账户失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  /** 销户：不再计入总资产，历史流水保留。留在本页并刷新（账户仍存在） */
  async doClose(): Promise<void> {
    const a = this.account;
    if (!a) return;
    try {
      await Api.closeAccount(a.id);
      this.confirmKind = '';
      await this.load();
      toast('已销户');
    } catch (e) {
      toastLong('销户失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  /**
   * 彻底删除。成功后必须 router.back() —— 账户已不存在，
   * 留在详情页只会展示陈旧数据，下次刷新还会拉空。
   */
  async doDelete(): Promise<void> {
    const a = this.account;
    if (!a) return;
    try {
      await Api.deleteAccount(a.id);
      this.confirmKind = '';
      toast('已删除');
      router.back();
    } catch (e) {
      // 服务端拒绝时会说明原因（有流水/有持仓），必须原样展示 ——
      // 换成笼统的「删除失败」用户不知道该改用销户。
      toastLong('删除失败：' + ((e as ApiError).message || '该账户下已有流水，请改用销户'));
    }
  }

  async recordInterest(): Promise<void> {
    if (!this.account) return;
    const amount = Number(this.iAmount);
    if (!(amount > 0)) {
      toast('请输入正数利息金额');
      return;
    }
    try {
      const req: AddAccountInterestRequest = {
        amount: amount,
        date: this.iDate.trim() === '' ? undefined : this.iDate.trim(),
        note: this.iNote.trim() === '' ? undefined : this.iNote.trim()
      };
      const r = await Api.addAccountInterest(this.account.id, req);
      if (r.success && r.data) {
        this.account.balance = r.data.balance;
        if (r.data.last_interest_date) this.account.last_interest_date = r.data.last_interest_date;
        this.showInterest = false;
        this.iAmount = ''; this.iDate = ''; this.iNote = '';
        toast('利息已记录');
        this.load();   // 利息会生成一笔流水，交易记录列表需要同步
      } else {
        toast('计息失败');
      }
    } catch (e) {
      console.error('recordInterest:', (e as ApiError).message);
      toast('计息失败');
    }
  }

  @Builder InterestSheet() {
    Column({ space: 12 }) {
      Text('记利息').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: '利息金额(正数)', text: this.iAmount }).type(InputType.Number)
        .onChange((v: string) => this.iAmount = v)
      TextInput({ placeholder: '日期 YYYY-MM-DD(选填，默认今天)', text: this.iDate })
        .onChange((v: string) => this.iDate = v)
      TextInput({ placeholder: '备注(选填)', text: this.iNote })
        .onChange((v: string) => this.iNote = v)
      Button('记录').width('100%').onClick(() => this.recordInterest())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showInterest = false)
    }
  }

  /** 编辑表单：字段与 Accounts.ets 的编辑态一致（不含开户余额，理由见 saveEdit 注释） */
  @Builder EditSheet() {
    Column({ space: 12 }) {
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
      // 当前余额置灰不可改：余额由流水推导，留一个改了不生效的输入框会误导用户
      Column({ space: 4 }) {
        TextInput({ placeholder: '当前余额', text: String(this.account?.balance ?? 0) })
          .enabled(false).opacity(0.6)
        Text('余额由流水推导，如需调整请记一笔流水')
          .fontSize(11).fontColor(COLORS.textSecondary)
      }.alignItems(HorizontalAlign.Start).width('100%')
      TextInput({ placeholder: '信用额度(信用卡)', text: this.fLimit }).onChange((v: string) => this.fLimit = v)
      TextInput({ placeholder: '年利率(%) 选填', text: this.fAnnualRate })
        .type(InputType.Number).onChange((v: string) => this.fAnnualRate = v)
      Row({ space: 8 }) {
        Text('计息周期').fontSize(14).fontColor(COLORS.textSecondary)
        Scroll() {
          Row({ space: 8 }) {
            ForEach(CYCLES, (cyc: string) => {
              Text(cyc).fontSize(13).padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(this.fInterestCycle === cyc ? COLORS.brand : COLORS.brandBgLight)
                .fontColor(this.fInterestCycle === cyc ? '#FFFFFF' : COLORS.textPrimary)
                .borderRadius(14).onClick(() => this.fInterestCycle = cyc)
            })
          }
        }.scrollable(ScrollDirection.Horizontal).layoutWeight(1)
      }
      Button('保存').width('100%').onClick(() => this.saveEdit())
      Button('取消').width('100%').backgroundColor(COLORS.divider)
        .onClick(() => this.showEdit = false)
    }
  }

  /**
   * 销户 / 删除二次确认。
   * 两者语义差别很大，文案必须说清 —— 销户可逆（只是不计入总资产、流水保留），
   * 删除不可逆且账户下有流水时服务端会拒绝。
   */
  @Builder ConfirmSheet() {
    Column({ space: 10 }) {
      Text(this.confirmKind === 'close'
        ? '销户「' + (this.account?.name ?? '') + '」？'
        : '彻底删除「' + (this.account?.name ?? '') + '」？')
        .fontSize(17).fontWeight(FontWeight.Bold)
      Text(this.confirmKind === 'close'
        ? '销户后该账户不再计入总资产，历史流水会完整保留。'
        : '删除后不可恢复。若账户下已有流水或理财持仓，后端会拒绝删除，此时请改用「销户」。')
        .fontSize(13).fontColor(COLORS.textSecondary)
      Button(this.confirmKind === 'close' ? '确认销户' : '确认删除')
        .width('100%')
        .backgroundColor(this.confirmKind === 'close' ? COLORS.brand : COLORS.danger)
        .onClick(() => {
          if (this.confirmKind === 'close') this.doClose(); else this.doDelete();
        })
      Button('取消').width('100%').backgroundColor(COLORS.divider)
        .onClick(() => this.confirmKind = '')
    }
  }

  build() {
    Column() {
      TopBar({ title: this.account?.name ?? '账户', onBack: () => router.back() })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            BalanceCard({
              title: '当前余额',
              amount: this.account?.balance ?? 0,
              subtitle: `${this.account?.type ?? ''}${this.account?.credit_limit ? ' · 额度 ' + fmtMoney(this.account.credit_limit) : ''}${this.account?.last_interest_date ? ' · 上次计息 ' + this.account.last_interest_date : ''}${(this.account?.status ?? 'active') !== 'active' ? ' · 已销户' : ''}`
            })
            if (this.account) {
              /*
               * 操作区：记利息 / 编辑 / 销户 / 删除，与安卓 AccountDetailScreen 同款方块 chip。
               *
               * 之前这里只有一个「记利息」按钮，用户反馈「资产账户只有计息功能，
               * 修改删除功能没有」。功能在账户列表页其实是有的（长按/⋯），
               * 但用户是从详情页进来的 —— 入口必须出现在他正在看的那一页。
               *
               * 销户只对 active 账户有意义，已销户时该位置留空，
               * 方块数量从 4 变 3（layoutWeight 自适应，不会留空洞）。
               */
              Row({ space: 8 }) {
                if ((this.account.status ?? 'active') === 'active') {
                  ActionChip({
                    emoji: '💰', label: '记利息', onTap: () => {
                      this.iAmount = ''; this.iDate = ''; this.iNote = '';
                      this.showInterest = true;
                    }
                  })
                }
                ActionChip({ emoji: '✏️', label: '编辑', onTap: () => this.openEdit() })
                if ((this.account.status ?? 'active') === 'active') {
                  ActionChip({ emoji: '📥', label: '销户', onTap: () => this.confirmKind = 'close' })
                }
                ActionChip({ emoji: '🗑️', label: '删除', danger: true, onTap: () => this.confirmKind = 'delete' })
              }.width('100%')
            }
            if (this.txs.length === 0) {
              EmptyState({ text: '该账户暂无交易' })
            } else {
              ForEach(this.txs, (it: TransactionItem) => {
                TransactionRow({ item: it })
              }, (it: TransactionItem) => it.id.toString())
            }
            Blank().height(20)
          }.padding(12)
        }.layoutWeight(1)
      }
      if (this.showInterest) {
        BottomSheet({ show: this.showInterest, maxHeight: '85%', onDismiss: () => { this.showInterest = false; } }) {
          this.InterestSheet()
        }
      }
      BottomSheet({ show: this.showEdit, maxHeight: '85%', onDismiss: () => { this.showEdit = false; } }) {
        Column({ space: 12 }) {
          SheetHeader({
            title: '编辑账户',
            subtitle: '修改后立即生效',
            onClose: () => { this.showEdit = false; }
          })
          this.EditSheet()
        }
      }
      BottomSheet({ show: this.confirmKind !== '', maxHeight: '50%', onDismiss: () => { this.confirmKind = ''; } }) {
        Column({ space: 12 }) {
          SheetHeader({
            title: this.confirmKind === 'close' ? '确认销户' : '确认删除',
            subtitle: this.confirmKind === 'close' ? '可恢复：流水完整保留' : '不可恢复，请谨慎操作',
            onClose: () => { this.confirmKind = ''; }
          })
          this.ConfirmSheet()
        }
      }
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct AccountDetail {
  @State itemId: number = 0;
  aboutToAppear(): void {
    const p: ESObject = (router.getParams() as ESObject) || {};
    if (p.id) this.itemId = p.id;
  }
  build() {
    Stack() {
      AppBackground()
      Column() { AccountDetailPage({ itemId: this.itemId }) }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
