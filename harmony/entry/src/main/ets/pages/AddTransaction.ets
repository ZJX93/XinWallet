/**
 * 记一笔（对齐安卓 AddTransactionScreen.kt）：支出/收入/转账 三段 + 分类网格 + 账户/日期 + 金额键盘。
 *
 * 编辑模式支持三类入参：
 *   - editId            →  PUT /transactions/:id   （普通支出/收入）
 *   - editTransferId    →  PUT /transfers/:id      （折叠转账，金额/转出/转入/日期/备注回填）
 *
 * ⚠️ 转账编辑必须走 PUT /transfers/:id 而非 PUT /transactions/:id：
 * 折叠行 it.id 只是 transfer_out 腿的 id，普通交易更新只会动一条腿，导致两个账户
 * 余额永久对不上。详见 Transactions.ets openRow() 的注释。
 *
 * 定位改用鸿蒙 @ohos.geoLocationManager（根治无 GMS 机型 NETWORK_PROVIDER 失效导致的定位失败）。
 */
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import geoLocationManager from '@ohos.geoLocationManager';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { Category, CreateTransactionRequest } from '../common/models';
import { TopBar, CategoryIcon, LoadingBox, DropdownField, DateTimePickerField, DatePickerField, DropdownOption, AppBackground, BottomSheet } from '../common/components/Components';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowDateTime(): string {
  const d = new Date();
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Entry
@Component
struct AddTransaction {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State editId: number = 0;
  /** 转账编辑模式：从账单页带过来的 transfer.id；非 0 即进入转账编辑路径 */
  @State editTransferId: number = 0;
  @State type: string = 'expense';
  @State categories: Category[] = [];
  @State accounts: ESObject[] = [];
  @State catId: number = 0;
  @State accId: number = 0;
  @State accName: string = '';
  @State date: string = nowDateTime();
  @State amount: string = '';
  @State note: string = '';
  @State location: string = '';
  @State loading: boolean = false;
  @State loadingData: boolean = false;
  // 转账专用字段
  @State tfFromId: number = 0;
  @State tfFromName: string = '';
  @State tfToId: number = 0;
  @State tfToName: string = '';
  @State tfAmount: string = '';
  @State tfDate: string = today();
  @State tfNote: string = '';
  @State tfError: string = '';
  @State tfSaving: boolean = false;
  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  aboutToAppear(): void {
    const p: ESObject = (router.getParams() as ESObject) || {};
    if (p.editId) this.editId = p.editId;
    if (p.editTransferId) {
      // 转账编辑模式：直接进入转账 tab，把预填值从 params 灌进表单
      this.editTransferId = p.editTransferId;
      this.type = 'transfer';
      this.tfFromId = Number(p.fromId) || 0;
      this.tfToId = Number(p.toId) || 0;
      this.tfAmount = String(p.amount ?? '');
      this.tfDate = String(p.date ?? today());
      this.tfNote = String(p.note ?? '');
    }
    this.load();
  }

  async load(): Promise<void> {
    this.loadingData = true;
    try {
      const _r = await Promise.all([Api.getCategories(), Api.getAccounts()]);
      const c = _r[0];
      const a = _r[1];
      if (c.success) this.categories = c.data || [];
      if (a.success) {
        this.accounts = (a.data as ESObject)?.accounts || [];
        this.accId = this.accounts[0]?.id || 0;
        this.accName = this.accounts[0]?.name || '';
      }
      if (this.editId) {
        const r = await Api.getTransactions({ limit: 1 });
        // 简化：通过账单页传入的 editId 直接编辑（后端按 id 更新）
      }
      // 选默认分类
      const def = this.categories.find(x => x.type === this.type);
      if (def) this.catId = def.id;
    } catch (e) { console.error('AddTx load:', (e as ApiError).message); }
    finally { this.loadingData = false; }
  }

  visibleCats(): Category[] {
    return this.categories.filter(c => (c.type || 'expense') === this.type);
  }

  onTypeChange(t: string): void {
    this.type = t;
    if (t === 'transfer') {
      // 转账模式无分类，重置提示并清掉上次残留的分类选择
      this.catId = 0;
      return;
    }
    const def = this.categories.find(x => x.type === t);
    if (def) this.catId = def.id;
  }

  async requestLoc(): Promise<void> {
    try {
      const at = abilityAccessCtrl.createAtManager();
      const res = await at.requestPermissionsFromUser(this.ctx, ['ohos.permission.LOCATION', 'ohos.permission.APPROXIMATELY_LOCATION']);
      if (!res.authResults.every((r: number) => r === 0)) return;
      const loc = await geoLocationManager.getCurrentLocation({ scenario: 0x301 });
      this.location = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
    } catch (e) { console.error('loc:', (e as ApiError)?.message); }
  }

  onKey(k: string): void {
    if (k === '⌫' || k === '删除') { this.amount = this.amount.slice(0, -1); return; }
    if (k === '清空') { this.amount = ''; return; }
    if (k === '确定') { this.submit(false); return; }
    // 小数点：最多一个，空时补0
    if (k === '.') { if (!this.amount.includes('.')) this.amount += this.amount ? '.' : '0.'; return; }
    // 运算符：直接追加
    if (['+', '-', '*', '/', '(', ')'].includes(k)) { this.amount += k; return; }
    // 数字
    if (/[0-9]/.test(k)) {
      if (this.amount === '0') this.amount = k;
      else this.amount += k;
      // 小数位限制（最多2位）
      const dotIdx = this.amount.indexOf('.');
      if (dotIdx >= 0 && this.amount.length - dotIdx - 1 > 2) {
        this.amount = this.amount.slice(0, dotIdx + 3);
      }
    }
  }

  async submit(again: boolean): Promise<void> {
    // 转账走单独分支（无论新增还是编辑，都走 /transfers 全量替换语义）
    if (this.type === 'transfer') {
      await this.submitTransfer();
      if (again) {
        this.tfAmount = ''; this.tfNote = '';
      } else if (!this.tfError) {
        router.back();
      }
      return;
    }
    const amt = Number(this.amount);
    if (!amt || !this.catId || !this.accId) { return; }
    this.loading = true;
    try {
      const req: CreateTransactionRequest = {
        account_id: this.accId,
        category_id: this.catId,
        type: this.type,
        amount: amt,
        note: this.note,
        date: this.date,
        location: this.location || undefined
      };
      if (this.editId) await Api.updateTransaction(this.editId, req);
      else await Api.createTransaction(req);
      if (again) {
        this.amount = ''; this.note = ''; this.location = '';
      } else {
        router.back();
      }
    } catch (e) { console.error('submit:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  /**
   * 转账提交：编辑时 PUT /transfers/:id（全量替换两条腿并重算两个账户余额），
   * 新增时 POST /transfers/。前置校验与 Transactions.ets.saveTransfer() 一致。
   */
  async submitTransfer(): Promise<void> {
    const amt = Number(this.tfAmount);
    if (!this.tfFromId || !this.tfToId) { this.tfError = '请选择转出和转入账户'; return; }
    if (this.tfFromId === this.tfToId) { this.tfError = '转出和转入账户不能相同'; return; }
    if (!amt || amt <= 0 || isNaN(amt)) { this.tfError = '请输入有效金额'; return; }
    this.tfSaving = true;
    this.tfError = '';
    try {
      const req: TransferEditRequest = {
        from_account_id: this.tfFromId,
        to_account_id: this.tfToId,
        amount: amt,
        note: this.tfNote,
        date: this.tfDate
      };
      if (this.editTransferId) {
        await Api.updateTransfer(this.editTransferId, req);
      } else {
        await Api.createTransfer(req);
      }
    } catch (e) {
      this.tfError = (e instanceof ApiError && e.message) ? e.message : '保存失败，请重试';
    } finally {
      this.tfSaving = false;
    }
  }

  @Builder Key(key: string, isPrimary?: boolean, isAction?: boolean, isOperator?: boolean) {
    Column() {
      if (key === '⌫') {
        Text('⌫').fontSize(20).fontColor(isPrimary ? '#FFFFFF' : COLORS.textPrimary)
      } else {
        Text(key).fontSize(isPrimary || isAction || isOperator ? 18 : 22)
          .fontColor(isPrimary ? '#FFFFFF' : COLORS.textPrimary)
          .fontWeight(isPrimary || isAction || isOperator ? FontWeight.Medium : FontWeight.Normal)
      }
    }.width('100%').height(50).justifyContent(FlexAlign.Center)
      .backgroundColor(
        isPrimary ? COLORS.brand : (isAction ? COLORS.brandBgLight : (isOperator ? COLORS.brandBgLight : COLORS.card))
      ).borderRadius(isPrimary ? 12 : 10)
      .onClick(() => this.onKey(key))
  }

  /**
   * 转账表单：转出/转入下拉 + 金额 + 日期 + 备注 + 错误条。
   * 与 Transactions.ets.TransferEditSheet() 字段一致。
   */
  @Builder TransferForm() {
    Column({ space: 12 }) {
      DropdownField({
        label: '转出账户',
        value: this.tfFromName || '选择转出账户',
        options: (this.accounts as ESObject[]).map((a: ESObject): DropdownOption => ({ name: a.name as string, id: a.id as number })),
        emptyHint: '暂无可用账户',
        onSelected: (id: number) => {
          const list: ESObject[] = this.accounts as ESObject[];
          const a: ESObject | undefined = list.find((x: ESObject): boolean => x.id === id);
          if (a) { this.tfFromId = id; this.tfFromName = a.name as string; this.tfError = ''; }
        }
      })
      DropdownField({
        label: '转入账户',
        value: this.tfToName || '选择转入账户',
        options: (this.accounts as ESObject[]).map((a: ESObject): DropdownOption => ({ name: a.name as string, id: a.id as number })),
        emptyHint: '暂无可用账户',
        onSelected: (id: number) => {
          const list: ESObject[] = this.accounts as ESObject[];
          const a: ESObject | undefined = list.find((x: ESObject): boolean => x.id === id);
          if (a) { this.tfToId = id; this.tfToName = a.name as string; this.tfError = ''; }
        }
      })
      Column({ space: 6 }).width('100%').alignItems(HorizontalAlign.Start) {
        Text('金额').fontSize(13).fontColor(COLORS.textSecondary)
        TextInput({ text: this.tfAmount, placeholder: '0.00' })
          .type(InputType.Number)
          .onChange((v: string) => { this.tfAmount = v; this.tfError = ''; })
          .width('100%').backgroundColor(COLORS.card).borderRadius(10).border({ width: 1, color: COLORS.divider })
      }
      DatePickerField({ label: '日期', date: this.tfDate, onDateChange: (d: string) => { this.tfDate = d; } })
      Column({ space: 6 }).width('100%').alignItems(HorizontalAlign.Start) {
        Text('备注').fontSize(13).fontColor(COLORS.textSecondary)
        TextInput({ text: this.tfNote, placeholder: '选填' })
          .onChange((v: string) => { this.tfNote = v; })
          .width('100%').backgroundColor(COLORS.card).borderRadius(10).border({ width: 1, color: COLORS.divider })
      }
      if (this.tfError !== '') {
        Text(this.tfError).fontSize(13).fontColor(COLORS.danger).width('100%')
      }
      Button(this.tfSaving ? '保存中…' : (this.editTransferId ? '保存' : '记转账'))
        .width('100%').height(44).backgroundColor(COLORS.brand)
        .fontColor('#FFFFFF').fontWeight(FontWeight.Medium).borderRadius(12)
        .enabled(!this.tfSaving)
        .onClick(() => { this.submit(false); })
      if (this.editTransferId) {
        // 转账编辑模式：暴露删除按钮（直接调 DELETE /transfers/:id，
        // 服务端在事务里两条腿一起删并重算两个账户余额）。
        // 普通转账提交页不显示 —— 新增的转账直接点保存就行。
        Button('删除这笔转账').width('100%').height(44)
          .backgroundColor(COLORS.divider).fontColor(COLORS.danger).fontWeight(FontWeight.Medium).borderRadius(12)
          .enabled(!this.tfSaving)
          .onClick(() => { this.confirmDeleteTransfer(); })
      }
      Blank().height(20)
    }.width('100%')
  }

  @State showDeleteConfirm: boolean = false;

  /** 转账删除的二次确认弹窗 */
  @Builder DeleteTransferConfirm() {
    Column({ space: 12 }) {
      Text('删除这笔转账？').fontSize(17).fontWeight(FontWeight.Bold)
      Text('转账在账本里是一进一出两条记录，删除会同时移除双方，'
        + '并重算 ' + this.tfFromName + ' 和 ' + this.tfToName + ' 的余额。此操作不可恢复。')
        .fontSize(13).fontColor(COLORS.textSecondary)
      if (this.tfError !== '') {
        Text(this.tfError).fontSize(13).fontColor(COLORS.danger).width('100%')
      }
      Button(this.tfSaving ? '删除中…' : '确认删除').width('100%')
        .backgroundColor(COLORS.danger).enabled(!this.tfSaving)
        .onClick(() => { this.doDeleteTransfer(); })
      Button('取消').width('100%').backgroundColor(COLORS.divider).fontColor(COLORS.textPrimary)
        .onClick(() => { this.showDeleteConfirm = false; this.tfError = ''; })
    }
  }

  confirmDeleteTransfer(): void {
    this.tfError = '';
    this.showDeleteConfirm = true;
  }

  async doDeleteTransfer(): Promise<void> {
    if (!this.editTransferId) return;
    this.tfSaving = true;
    try {
      await Api.deleteTransfer(this.editTransferId);
      this.showDeleteConfirm = false;
      router.back();
    } catch (e) {
      this.tfError = (e instanceof ApiError && e.message) ? e.message : '删除失败，请重试';
    } finally {
      this.tfSaving = false;
    }
  }

  /** 安卓对齐 NewKeypad：4行×5列（含运算符/小数点/括号/⌫/确定） */
  @Builder NewKeypad() {
    Column({ space: 6 }).width('100%').padding({ left: 8, right: 8 }) {
      ForEach([
        ['+', '1', '2', '3', '⌫'],
        ['-', '4', '5', '6', '清空'],
        ['×', '7', '8', '9', '.'],
        ['/', '(', '0', ')', '确定']
      ], (row: string[], rIdx: number) => {
        Row({ space: 6 }) {
          ForEach(row, (k: string) => {
            Column() {
              this.Key(k,
                k === '确定',
                ['⌫', '清空', '+', '-', '×', '/'].includes(k),
                ['+', '-', '×', '/', '(', ')'].includes(k)
              )
            }.layoutWeight(1)
          }, (k: string) => k)
        }.width('100%')
      }, (row: string[]) => row.join())
    }
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: (this.editId || this.editTransferId) ? '编辑' : '记一笔', onBack: () => router.back() })
        if (this.loadingData) { LoadingBox() }
        else {
          Scroll() {
            Column({ space: 12 }) {
              // 类型分段：支出 / 收入 / 转账
              Row() {
                Text('支出').fontSize(16).fontColor(this.type === 'expense' ? COLORS.brand : COLORS.textSecondary)
                  .fontWeight(this.type === 'expense' ? FontWeight.Bold : FontWeight.Normal)
                  .layoutWeight(1).textAlign(TextAlign.Center).padding({ top: 10, bottom: 10 })
                  .backgroundColor(this.type === 'expense' ? COLORS.brandBgLight : '#00000000')
                  .borderRadius(10).onClick(() => this.onTypeChange('expense'))
                Text('收入').fontSize(16).fontColor(this.type === 'income' ? COLORS.brand : COLORS.textSecondary)
                  .fontWeight(this.type === 'income' ? FontWeight.Bold : FontWeight.Normal)
                  .layoutWeight(1).textAlign(TextAlign.Center).padding({ top: 10, bottom: 10 })
                  .backgroundColor(this.type === 'income' ? COLORS.brandBgLight : '#00000000')
                  .borderRadius(10).onClick(() => this.onTypeChange('income'))
                Text('转账').fontSize(16).fontColor(this.type === 'transfer' ? COLORS.brand : COLORS.textSecondary)
                  .fontWeight(this.type === 'transfer' ? FontWeight.Bold : FontWeight.Normal)
                  .layoutWeight(1).textAlign(TextAlign.Center).padding({ top: 10, bottom: 10 })
                  .backgroundColor(this.type === 'transfer' ? COLORS.brandBgLight : '#00000000')
                  .borderRadius(10).onClick(() => this.onTypeChange('transfer'))
              }.width('100%').backgroundColor(COLORS.divider).borderRadius(10)

              // 转账模式：转出/转入/金额/日期/备注
              if (this.type === 'transfer') {
                this.TransferForm()
              } else {
                // 支出/收入：分类网格
                Grid() {
                  ForEach(this.visibleCats(), (c: Category) => {
                    GridItem() {
                      Column({ space: 4 }) {
                        CategoryIcon({ icon: c.icon || '📌', selected: this.catId === c.id, iconSize: 40 })
                        Text(c.name).fontSize(12)
                          .fontColor(this.catId === c.id ? COLORS.brand : COLORS.textPrimary)
                          .fontWeight(this.catId === c.id ? FontWeight.Medium : FontWeight.Normal)
                          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      }.width('100%').padding({ top: 8, bottom: 8 })
                        .onClick(() => this.catId = c.id)
                    }
                  }, (c: Category) => c.id.toString())
                }.columnsTemplate('1fr 1fr 1fr 1fr 1fr').rowsGap(6).columnsGap(6)

                // 上下文：账户 + 日期
                DropdownField({
                  label: '账户',
                  value: this.accName || '选择账户',
                  options: (this.accounts as ESObject[]).map((a: ESObject): DropdownOption => ({ name: a.name as string, id: a.id as number })),
                  onSelected: (id: number) => {
                    const list: ESObject[] = this.accounts as ESObject[];
                    const a: ESObject | undefined = list.find((x: ESObject): boolean => x.id === id);
                    if (a) { this.accId = id; this.accName = a.name as string; }
                  }
                })
                DateTimePickerField({ label: '日期时间', value: this.date, onValueChange: (d: string) => this.date = d })
                // 地点
                Row({ space: 6 }) {
                  Text('📍').fontSize(16)
                  Text(this.location ? '已定位' : '地点').fontSize(14).fontColor(COLORS.textPrimary)
                }.padding({ left: 12, right: 12, top: 8, bottom: 8 }).backgroundColor(COLORS.brandBgLight).borderRadius(16)
                  .onClick(() => this.requestLoc())
              }

              // 金额 + 备注
              Row({ space: 8 }) {
                Text('¥').fontSize(26).fontColor(COLORS.textPrimary)
                Text(this.amount || '0.00').fontSize(32).fontWeight(FontWeight.Bold).layoutWeight(1).fontColor(COLORS.textPrimary)
              }.width('100%').padding(12).backgroundColor(COLORS.cardGlass).borderRadius(12)
              .border({ width: 0.5, color: COLORS.outlineVariant })
              TextInput({ placeholder: '备注（可选）', text: this.note }).onChange((v: string) => this.note = v)

              // 金额键盘（对齐安卓 NewKeypad 4×5）
              this.NewKeypad()

              Button('再记一笔').width('100%').height(44).backgroundColor(COLORS.brandBgLight)
                .fontColor(COLORS.brand).fontWeight(FontWeight.Medium).borderRadius(12)
                .onClick(() => this.submit(true))
              Blank().height(20)
            }.padding(12)
          }.layoutWeight(1)
        }
      }.width('100%').height('100%')

      // 转账删除二次确认
      BottomSheet({ show: this.showDeleteConfirm, maxHeight: '55%', onDismiss: () => { this.showDeleteConfirm = false; this.tfError = ''; } }) {
        this.DeleteTransferConfirm()
      }
    }.width('100%').height('100%')
  }
}

// DatePickerResult 兼容（不同 API 版本字段可能为 year/month/day 或 date）
interface DatePickerResult { year: number; month: number; day: number; }
function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 转账编辑/新增请求（与 Api.createTransfer / Api.updateTransfer 入参一致） */
interface TransferEditRequest {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  note: string;
  date: string;
}
