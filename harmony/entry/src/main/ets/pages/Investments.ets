/**
 * 理财（对齐安卓 InvestmentsScreen.kt）：总市值 + 按类型分组列表 + 新增持仓。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, fmtMoney, LAYOUT } from '../common/theme';
import { Account } from '../common/models';
import { BalanceCard, SectionTitle, EmptyState, LoadingBox, CategoryIcon, TopBar, AppBackground,
  FloatingButton, BottomSheet, SheetHeader, Chip, DropdownField, DropdownOption } from '../common/components/Components';

interface Iface1 {
  type: string;
  list: Inv[];
}

interface Inv {
  id: number; name: string; code?: string; type?: string; accountId?: number; status?: string;
  buyPrice?: number; currentPrice?: number; quantity?: number;
  cost?: number; currentValue?: number; profit?: number; profitRate?: number; icon?: string;
}

/** 理财类型（investment_types 表，服务端预置 11 条） */
interface InvType {
  id: number;
  name: string;
  icon?: string;
}

const TYPES: string[] = ['股票', '基金', '数字货币', '债券', '其他'];
/** 风险等级：值与服务端白名单一致（low/medium/high/very_high），标签取中文 */
const RISK_KEYS: string[] = ['low', 'medium', 'high', 'very_high'];
const RISK_LABELS: string[] = ['低风险', '中风险', '高风险', '极高风险'];

@Component
export struct InvestmentsPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State list: Inv[] = [];
  @State totalValue: number = 0;
  @State totalCost: number = 0;
  @State totalProfit: number = 0;
  @State includeSold: boolean = false;
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位

  /* ────────── 新增持仓表单 ────────── */
  @State showAdd: boolean = false;
  @State invTypes: InvType[] = [];
  @State accounts: Account[] = [];
  @State fTypeId: number = 0;
  @State fName: string = '';
  @State fCode: string = '';
  @State fAccountId: number = 0;
  @State fBuyPrice: string = '';
  @State fQuantity: string = '';
  @State fFee: string = '';
  @State fBuyDate: string = '';
  @State fRisk: string = '';
  @State fNote: string = '';
  @State submitting: boolean = false;

  aboutToAppear(): void { this.load(); }

  async load(includeSold: boolean = false): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getInvestments(includeSold);
      const arr: ESObject[] = ((r.data as ESObject)?.investments as ESObject[]) || [];
      this.list = arr as Inv[];
      this.totalValue = arr.reduce((s: number, x: Inv) => s + (x.currentValue || 0), 0);
      this.totalCost = arr.reduce((s: number, x: Inv) => s + (x.cost || 0), 0);
      this.totalProfit = this.totalValue - this.totalCost;
    } catch (e) { console.error('Investments:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  grouped(): Iface1[] {
    const map = new Map<string, Inv[]>();
    this.list.forEach(x => {
      const t = x.type || '其他';
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(x);
    });
    const res: Iface1[] = [];
    TYPES.forEach(t => { if (map.has(t)) res.push({ type: t, list: map.get(t)! }); });
    map.forEach((l, t) => { if (!TYPES.includes(t)) res.push({ type: t, list: l }); });
    return res;
  }

  /* ────────── 新增持仓 ────────── */

  /**
   * 打开新增表单。
   * 类型与账户列表懒加载并缓存 —— 浏览持仓时不需要它们，
   * 提前拉会给首屏多两次串行请求。
   */
  async openCreate(): Promise<void> {
    this.fName = ''; this.fCode = ''; this.fBuyPrice = ''; this.fQuantity = '';
    this.fFee = ''; this.fRisk = ''; this.fNote = '';
    this.fAccountId = 0;
    // 买入日期默认今天：绝大多数记录都是当天录入，省一次选择
    this.fBuyDate = new Date().toISOString().slice(0, 10);
    this.showAdd = true;

    if (this.invTypes.length === 0) {
      try {
        const r = await Api.getInvestmentTypes();
        this.invTypes = (r.data as InvType[]) || [];
        // 预选第一个类型：investment_type_id 是服务端必填项，
        // 留空会让用户填完所有字段才在提交时被拒。
        if (this.invTypes.length > 0 && this.fTypeId === 0) this.fTypeId = this.invTypes[0].id;
      } catch (e) { toastLong('理财类型加载失败：' + ((e as ApiError).message || '请检查网络')); }
    }
    if (this.accounts.length === 0) {
      try {
        const r = await Api.getAccounts();
        this.accounts = ((r.data as ESObject)?.accounts as Account[] ?? [])
          .filter((a: Account) => (a.status ?? 'active') === 'active');
      } catch (e) { /* 账户拉不到时下拉为空：account_id 可空，仍能建持仓（只是不扣款） */ }
    }
  }

  /** 类型下拉选项 */
  typeOptions(): DropdownOption[] {
    return this.invTypes.map((t: InvType): DropdownOption => ({ id: t.id, name: t.name }));
  }

  /** 账户下拉选项，含「不关联账户」空档 */
  accountOptions(): DropdownOption[] {
    const opts: DropdownOption[] = [{ id: 0, name: '不关联账户' }];
    this.accounts.forEach((a: Account) => opts.push({ id: a.id, name: a.name }));
    return opts;
  }

  typeName(): string {
    const t = this.invTypes.find((x: InvType) => x.id === this.fTypeId);
    return t ? t.name : '';
  }

  accountName(): string {
    if (this.fAccountId === 0) return '不关联账户';
    const a = this.accounts.find((x: Account) => x.id === this.fAccountId);
    return a ? a.name : '';
  }

  /**
   * 表单里的单笔总成本 = 买入价 × 数量 + 手续费。
   *
   * ⚠️ 命名不要用 totalCost —— 那是 @State 字段（全部持仓的成本合计），
   * 同名会直接把状态覆盖成方法。这里是「正在填的这一笔」，故叫 formCost。
   *
   * 服务端 total_cost 若不传会落 0，导致持仓成本为 0、收益率算成无穷大。
   * web 端是在界面上实时算好再提交（investment.js 的 recalc），这里同样本地算 ——
   * 让用户提交前就能看到这个数，而不是存完才发现不对。
   */
  formCost(): number {
    const p = parseFloat(this.fBuyPrice) || 0;
    const q = parseFloat(this.fQuantity) || 0;
    const f = parseFloat(this.fFee) || 0;
    return p * q + f;
  }

  async submitCreate(): Promise<void> {
    if (!this.fName.trim()) { toast('请输入产品名称'); return; }
    if (this.fTypeId === 0) { toast('请选择理财类型'); return; }
    this.submitting = true;
    try {
      const cost = this.formCost();
      await Api.createInvestment({
        investment_type_id: this.fTypeId,
        name: this.fName.trim(),
        code: this.fCode.trim(),
        // 0 表示「不关联账户」，服务端 parseInt(0)||null → null，不生成扣款流水
        account_id: this.fAccountId || null,
        buy_price: parseFloat(this.fBuyPrice) || 0,
        // 建仓时现价即买入价：此刻还没有行情变动，收益应为 0 而不是 -100%
        current_price: parseFloat(this.fBuyPrice) || 0,
        quantity: parseFloat(this.fQuantity) || 0,
        total_cost: cost,
        current_value: cost,
        fee: parseFloat(this.fFee) || 0,
        buy_date: this.fBuyDate,
        risk_level: this.fRisk || null,
        note: this.fNote.trim()
      });
      this.showAdd = false;
      toast('持仓已添加');
      this.load(this.includeSold);
    } catch (e) {
      toastLong('添加失败：' + ((e as ApiError).message || '请检查网络'));
    } finally {
      this.submitting = false;
    }
  }

  @Builder AddSheet() {
    Column({ space: 12 }) {
      DropdownField({
        label: '理财类型 *',
        value: this.typeName(),
        options: this.typeOptions(),
        emptyHint: '暂无类型',
        onSelected: (id: number) => { this.fTypeId = id; }
      })
      TextInput({ placeholder: '产品名称 *', text: this.fName })
        .onChange((v: string) => this.fName = v)
      TextInput({ placeholder: '代码（选填，如 000001）', text: this.fCode })
        .onChange((v: string) => this.fCode = v)
      DropdownField({
        label: '扣款账户',
        value: this.accountName(),
        options: this.accountOptions(),
        emptyHint: '暂无账户',
        onSelected: (id: number) => { this.fAccountId = id; }
      })
      Row({ space: 8 }) {
        TextInput({ placeholder: '买入价', text: this.fBuyPrice })
          .type(InputType.Number).layoutWeight(1)
          .onChange((v: string) => this.fBuyPrice = v)
        TextInput({ placeholder: '数量/份额', text: this.fQuantity })
          .type(InputType.Number).layoutWeight(1)
          .onChange((v: string) => this.fQuantity = v)
      }
      TextInput({ placeholder: '手续费（选填）', text: this.fFee })
        .type(InputType.Number)
        .onChange((v: string) => this.fFee = v)
      // 实时回显总成本：买入价×数量+手续费 是这张表单唯一的推导值，
      // 提交后才看到就晚了（改一次得删了重建）
      Row() {
        Text('总成本').fontSize(13).fontColor(COLORS.textSecondary).layoutWeight(1)
        Text(fmtMoney(this.formCost())).fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor(COLORS.textPrimary)
      }.width('100%')
      TextInput({ placeholder: '买入日期', text: this.fBuyDate })
        .onChange((v: string) => this.fBuyDate = v)
      Column({ space: 6 }) {
        Text('风险等级（选填）').fontSize(13).fontColor(COLORS.textSecondary)
        Row({ space: 6 }) {
          ForEach(RISK_KEYS, (k: string, i: number) => {
            Chip({
              label: RISK_LABELS[i],
              active: this.fRisk === k,
              // 再点一次取消选择：风险等级可空，选错了得能撤销
              onTap: () => { this.fRisk = this.fRisk === k ? '' : k; }
            })
          }, (k: string) => k)
        }
      }.alignItems(HorizontalAlign.Start).width('100%')
      TextInput({ placeholder: '备注（选填）', text: this.fNote })
        .onChange((v: string) => this.fNote = v)
      Button(this.submitting ? '提交中…' : '保存')
        .width('100%').enabled(!this.submitting)
        .onClick(() => this.submitCreate())
      Button('取消').width('100%').backgroundColor(COLORS.divider).fontColor(COLORS.textPrimary)
        .onClick(() => { this.showAdd = false; })
    }
  }

  build() {
    Column() {
      TopBar({ title: '理财管理', onBack: () => router.back() })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            BalanceCard({
              title: '理财总市值',
              amount: this.totalValue,
              subtitle: `总成本 ${fmtMoney(this.totalCost)} · 总收益 ${fmtMoney(this.totalProfit)}`
            })
            Row() {
              Text('显示已清仓').fontSize(14).fontColor(COLORS.textSecondary).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.includeSold })
                .onChange((v: boolean) => { this.includeSold = v; this.load(v); })
            }.width('100%').padding({ left: 12, right: 12, top: 4, bottom: 4 })
            if (this.list.length === 0) { EmptyState({ text: '暂无理财持仓' }) }
            else {
              ForEach(this.grouped(), (g: ESObject) => {
                Column({ space: 6 }) {
                  SectionTitle({ text: g.type })
                  ForEach(g.list, (x: Inv) => {
                    Row({ space: 12 }) {
                      CategoryIcon({ icon: x.icon || '📈', iconSize: 40 })
                      Column() {
                        Text(x.name).fontSize(15).fontColor(COLORS.textPrimary)
                        Row({ space: 6 }) {
                          if (x.code) Text(x.code).fontSize(11).fontColor(COLORS.textSecondary)
                          if (x.status === 'sold') {
                            Text('已清仓').fontSize(11).fontColor(COLORS.textSecondary)
                              .backgroundColor(COLORS.brandBgLight).borderRadius(4).padding({ left: 6, right: 6, top: 1, bottom: 1 })
                          }
                        }
                      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                      Column() {
                        Text(fmtMoney(x.currentValue || 0)).fontSize(15).fontWeight(FontWeight.Medium)
                        Text(`${(x.profit || 0) >= 0 ? '+' : ''}${fmtMoney(x.profit || 0)} (${((x.profitRate || 0) * 100).toFixed(2)}%)`)
                          .fontSize(11).fontColor((x.profit || 0) >= 0 ? COLORS.expense : COLORS.income)
                      }.alignItems(HorizontalAlign.End)
                    }.width('100%').padding({ top: 12, bottom: 12 }).backgroundColor(COLORS.cardGlass).borderRadius(12)
                    .border({ width: 0.5, color: COLORS.outlineVariant })
                      .onClick(() => router.pushUrl({ url: 'pages/InvestmentDetail', params: { id: x.id } }))
                  }, (x: Inv) => x.id.toString())
                }
              }, (g: ESObject) => g.type)
            }
            // FAB 悬浮在底部，末项需避让否则被圆钮压住点不到
            Blank().height(LAYOUT.fabSafe)
          }.padding(12)
        }.layoutWeight(1)
      }
      // 新增持仓入口。原先本页只能看不能加 —— 持仓只有从 web 端或详情页
      // 才建得出来，理财管理页反而没有创建能力。
      FloatingButton({ onTap: () => this.openCreate() })
      BottomSheet({ show: this.showAdd, maxHeight: '88%', onDismiss: () => { this.showAdd = false; } }) {
        Column({ space: 12 }) {
          SheetHeader({
            title: '新增持仓',
            subtitle: '关联账户后会自动生成一笔买入流水',
            onClose: () => { this.showAdd = false; }
          })
          this.AddSheet()
        }
      }
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct Investments {
  build() {
    Stack() {
      AppBackground()
      Column() { InvestmentsPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
