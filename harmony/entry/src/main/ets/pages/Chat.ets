/**
 * AI 记账对话（对齐安卓 ChatScreen.kt）：
 * 空态介绍 + 对话列表（AI 内嵌交易卡片）+ 上下文 chips + 输入栏（麦克风/文本/图片/发送）。
 * 语音：鸿蒙原生 AudioCapturer 录音 → 后端 /ai/transcribe（Whisper）转写，根治 GMS 语音超时 Bug。
 *
 * AI v0.2：文本优先走确定性记账通道（parse → 确认卡片 → commit），
 * AI 输出【永不直接写账本】；识别不出交易时（422）才回退 legacy /ai/chat 保留咨询能力。
 */
import router from '@ohos.router';
import { ChatMessage } from '../common/models';
import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import buffer from '@ohos.buffer';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney, withAlpha } from '../common/theme';
import { AppBackground, DropdownField, DropdownOption } from '../common/components/Components';
import { startRecord, stopRecord } from '../common/audio';
import { TransactionItem } from '../common/models';
import {
  Account, AccountsResponse, Category, AiCandidateTxn, AiTxnValidation, AiFieldVerdict,
  AiPerFieldMap, AiConfidenceMap, AiEvidenceMap
} from '../common/models';

interface ChatMsg {
  role: string;
  content: string;
  txs?: TransactionItem[];
}

/** 空态快捷示例。用真实、具体的口语句子 —— 泛泛的「记一笔支出」示范不了任何东西 */
const QUICK_EXAMPLES: string[] = [
  '午饭 28',
  '打车回家 35 支付宝',
  '昨天超市买菜 126',
  '发工资 12000',
  '这个月房租 3500'
];

/** 达标 / 低置信的视觉语义色（不复用涨跌色，避免与收支红绿语义冲突） */
const OK_GREEN: string = '#1B7F4B';
const OK_GREEN_BG: string = '#E7F5EC';
const WARN_AMBER: string = '#9A6300';
const WARN_AMBER_BG: string = '#FDF3E0';

function typeLabelOf(t: string): string {
  if (t === 'income') return '收入';
  if (t === 'transfer') return '转账';
  return '支出';
}

function todayLocal(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`;
}

function trimAmount(v: number): string {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
}

/** 显式深拷贝候选：ArkTS 对 JSON.parse 转数组/泛型的支持不稳，手写更可靠。
 *  originalCandidates 是 dirty 判定的只读基准，必须与 candidates 完全断开引用 */
function cloneTxn(t: AiCandidateTxn): AiCandidateTxn {
  const c: AiConfidenceMap = {};
  if (t.confidence) {
    c.amount = t.confidence.amount;
    c.type = t.confidence.type;
    c.category = t.confidence.category;
    c.date = t.confidence.date;
    c.currency = t.confidence.currency;
    c.merchant = t.confidence.merchant;
  }
  const ev: AiEvidenceMap = {};
  if (t.evidence) {
    ev.amount = t.evidence.amount;
    ev.type = t.evidence.type;
    ev.category = t.evidence.category;
    ev.date = t.evidence.date;
    ev.currency = t.evidence.currency;
    ev.merchant = t.evidence.merchant;
  }
  return {
    seq: t.seq,
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    category_id: t.category_id,
    category_name: t.category_name,
    account_id: t.account_id,
    from_account_id: t.from_account_id,
    to_account_id: t.to_account_id,
    date: t.date,
    note: t.note,
    merchant: t.merchant,
    raw_segment: t.raw_segment,
    confidence: c,
    evidence: ev
  };
}

function cloneTxns(list: AiCandidateTxn[]): AiCandidateTxn[] {
  return list.map((t: AiCandidateTxn): AiCandidateTxn => cloneTxn(t));
}

@Entry
@Component
struct Chat {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State messages: ChatMsg[] = [];
  @State input: string = '';
  @State recording: boolean = false;
  @State recSeconds: number = 0;
  @State pendingImage: string = '';
  @State transcribing: boolean = false;

  /* ---- AI v0.2 确认态：非空即表示有待确认预测，落账只发生在 commit ---- */
  @State predictionId: number = 0;
  @State candidates: AiCandidateTxn[] = [];
  /** parse 返回的原始快照，只读基准，用于 dirty 判定（决定 confirmed / corrected） */
  private originalCandidates: AiCandidateTxn[] = [];
  @State aiVerdict: string = '';
  @State aiReasons: string[] = [];
  @State aiOverall: number = -1;
  @State perTxn: AiTxnValidation[] = [];
  @State committing: boolean = false;
  /** 进入确认态时固定，重试复用以保证不重复落账 */
  private idemKey: string = '';
  @State accounts: Account[] = [];
  @State categories: Category[] = [];
  @State defaultAccountId: number = 0;

  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private timer: number = 0;

  async aboutToAppear(): Promise<void> {
    this.messages = [{
      role: 'assistant',
      content: '你好，我是小鑫。你可以直接说「今天午饭花了28元」，或发一张小票截图，我来帮你记账～'
    }];
    // 确认卡片需要账户/分类做下拉；失败不阻塞对话主流程
    try {
      const rs = await Promise.all([Api.getAccounts(), Api.getCategories()]);
      const ar = rs[0];
      const cr = rs[1];
      if (ar.success && ar.data) {
        const d = ar.data as AccountsResponse;
        // 已销户账户不该出现在下拉里，否则用户能把钱记到一个关闭的账户上
        this.accounts = (d.accounts || []).filter((a: Account) => (a.status ?? 'active') !== 'closed');
        const def = this.accounts.find((a: Account) => a.is_default === true);
        this.defaultAccountId = def ? def.id : (this.accounts.length > 0 ? this.accounts[0].id : 0);
      }
      if (cr.success && cr.data) this.categories = cr.data as Category[];
    } catch (e) { /* 静默降级：确认卡片仍可展示，只是下拉为空 */ }
  }

  async requestMic(): Promise<boolean> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const res = await atManager.requestPermissionsFromUser(this.ctx, ['ohos.permission.MICROPHONE']);
      return res.authResults.every((r: number) => r === 0);
    } catch (e) { return false; }
  }

  async toggleVoice(): Promise<void> {
    if (this.recording) {
      this.recording = false;
      clearInterval(this.timer);
      this.transcribing = true;
      try {
        const b64 = await stopRecord();
        const r = await Api.transcribe({ audio: b64 });
        if (r.success && r.data?.text) {
          this.input = r.data.text;
        }
      } catch (e) {
        console.error('transcribe:', (e as ApiError).message);
      } finally {
        this.transcribing = false;
      }
    } else {
      const ok = await this.requestMic();
      if (!ok) return;
      const path = `${this.ctx.cacheDir}/rec_${Date.now()}.wav`;
      try {
        await startRecord(path);
        this.recording = true;
        this.recSeconds = 0;
        this.timer = setInterval(() => { this.recSeconds++; }, 1000);
      } catch (e) { console.error('record:', (e as ApiError).message); }
    }
  }

  async pickImage(): Promise<void> {
    try {
      const ph = new picker.PhotoViewPicker();
      const res = await ph.select({ MIMEType: picker.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1 });
      if (res && res.photoUris && res.photoUris.length > 0) {
        const uri = res.photoUris[0];
        const f = fs.openSync(uri, fs.OpenMode.READ_ONLY);
        const stat = fs.statSync(uri);
        const buf = new ArrayBuffer(stat.size);
        fs.readSync(f.fd, buf);
        fs.closeSync(f);
        this.pendingImage = buffer.from(buf).toString('base64');
      }
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  async send(): Promise<void> {
    const text = this.input.trim();
    if (!text && !this.pendingImage) return;
    // 已有待确认预测时先让用户处理完，避免多个快照并行造成状态混乱
    if (this.predictionId > 0) {
      this.messages.push({ role: 'assistant', content: '请先确认或弃置上一条识别结果～' });
      return;
    }

    const history: ChatMessage[] = this.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m: ChatMessage): ChatMessage => ({ role: m.role, content: m.content }));
    this.messages.push({ role: 'user', content: text || '[图片]' });
    this.input = '';
    const img = this.pendingImage;
    this.pendingImage = '';

    // 纯文本优先走 v0.2 确定性记账通道；带图片仍走 legacy 多模态对话
    if (text && !img) {
      const handled = await this.tryParseAsTransaction(text);
      if (handled) return;
    }

    try {
      const r = await Api.chat({ message: text, history, imageBase64: img || undefined });
      if (r.success && r.data) {
        this.messages.push({ role: 'assistant', content: r.data.reply || '', txs: r.data.transactions || [] });
      }
    } catch (e) {
      this.messages.push({ role: 'assistant', content: '出错了：' + (e as ApiError).message });
    }
  }

  /**
   * 尝试用 v0.2 通道解析为交易。
   * @returns true 表示已进入确认态（或已给出明确错误），无需回退对话；false 表示应回退 /ai/chat
   */
  async tryParseAsTransaction(text: string): Promise<boolean> {
    try {
      const r = await Api.aiParseTransactions({
        text,
        context: { account_id: this.defaultAccountId || undefined, date: todayLocal(), platform: 'harmony' },
        source: 'chat'      // 输入通道是对话；平台信息在 context.platform
      });
      if (!r.success || !r.data) return false;

      const d = r.data;
      // 需要确认时补拉字段级裁决明细，用于高亮低置信字段
      let pt: AiTxnValidation[] = [];
      if (d.needs_confirmation) {
        try {
          const snap = await Api.aiGetPrediction(d.prediction_id);
          if (snap.success && snap.data && snap.data.validation && snap.data.validation.per_txn) {
            pt = snap.data.validation.per_txn as AiTxnValidation[];
          }
        } catch (e) { /* 拉不到就不高亮，不阻塞主流程 */ }
      }

      this.predictionId = d.prediction_id;
      this.originalCandidates = cloneTxns(d.transactions);
      this.candidates = cloneTxns(d.transactions);
      this.aiVerdict = d.verdict;
      this.aiReasons = d.reasons ? d.reasons : [];
      this.aiOverall = d.overall_confidence === undefined ? -1 : d.overall_confidence;
      this.perTxn = pt;
      this.committing = false;
      this.idemKey = `harmony-${d.prediction_id}-${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(0, 64);

      const tip = d.needs_confirmation ? '，其中有字段置信度偏低，请核对后确认' : '，请确认后入账';
      this.messages.push({
        role: 'assistant',
        content: `我识别到 ${d.transactions.length} 笔记录${tip}`
      });
      return true;
    } catch (e) {
      const err = e as ApiError;
      // 仅在「识别不出交易」时回退对话；其他错误（网络/鉴权）直接暴露
      const notATransaction = err.code === 422 || (err.message ?? '').indexOf('未能从文本中识别') >= 0;
      if (notATransaction) return false;
      this.messages.push({ role: 'assistant', content: '出错了：' + err.message });
      return true;
    }
  }

  /* ---------------- v0.2 确认态操作 ---------------- */

  /** 是否被用户改动过 → 决定 action = corrected / confirmed */
  isDirty(): boolean {
    if (this.candidates.length !== this.originalCandidates.length) return true;
    for (let i = 0; i < this.candidates.length; i++) {
      const a = this.candidates[i];
      const b = this.originalCandidates[i];
      if (!b || a.seq !== b.seq) return true;
      if (a.type !== b.type) return true;
      if (Math.abs(a.amount - b.amount) > 1e-9) return true;
      if ((a.category_id ?? 0) !== (b.category_id ?? 0)) return true;
      if ((a.account_id ?? 0) !== (b.account_id ?? 0)) return true;
      if ((a.from_account_id ?? 0) !== (b.from_account_id ?? 0)) return true;
      if ((a.to_account_id ?? 0) !== (b.to_account_id ?? 0)) return true;
      if ((a.date ?? '') !== (b.date ?? '')) return true;
      if ((a.note ?? '') !== (b.note ?? '')) return true;
    }
    return false;
  }

  /** 取某笔某字段的服务端裁决；缺失返回 undefined（不高亮）。
   *  ArkTS 不允许对 interface 做字符串索引访问，只能显式分支 */
  fieldVerdict(seq: number, field: string): AiFieldVerdict | undefined {
    const t = this.perTxn.find((x: AiTxnValidation) => x.seq === seq);
    if (!t || !t.per_field) return undefined;
    const pf: AiPerFieldMap = t.per_field;
    if (field === 'amount') return pf.amount;
    if (field === 'type') return pf.type;
    if (field === 'category') return pf.category;
    if (field === 'date') return pf.date;
    if (field === 'merchant') return pf.merchant;
    return undefined;
  }

  /** 人工修正 ⇒ 该字段置信度置 1.0、evidence 标记 user_corrected，
   *  让 final_diff 与后续学习信号反映「人工已确认」 */
  private markCorrected(item: AiCandidateTxn, field: string): void {
    const c: AiConfidenceMap = item.confidence ? item.confidence : {};
    const ev: AiEvidenceMap = item.evidence ? item.evidence : {};
    if (field === 'amount') { c.amount = 1.0; ev.amount = 'user_corrected'; }
    else if (field === 'type') { c.type = 1.0; ev.type = 'user_corrected'; }
    else if (field === 'category') { c.category = 1.0; ev.category = 'user_corrected'; }
    else if (field === 'date') { c.date = 1.0; ev.date = 'user_corrected'; }
    item.confidence = c;
    item.evidence = ev;
  }

  /** 统一的候选更新入口：ArkTS 需整体重新赋值数组才能触发 UI 刷新 */
  private applyEdit(seq: number, mutate: (t: AiCandidateTxn) => void, correctedField?: string): void {
    const next = this.candidates.map((t: AiCandidateTxn): AiCandidateTxn => {
      if (t.seq !== seq) return t;
      const copy = cloneTxn(t);
      mutate(copy);
      if (correctedField) this.markCorrected(copy, correctedField);
      return copy;
    });
    this.candidates = next;
  }

  setAmount(seq: number, v: string): void {
    const n = Number.parseFloat(v);
    if (Number.isNaN(n)) return;
    this.applyEdit(seq, (t: AiCandidateTxn) => { t.amount = n; }, 'amount');
  }

  setNote(seq: number, v: string): void {
    this.applyEdit(seq, (t: AiCandidateTxn) => { t.note = v; });
  }

  /** 切换类型：类目候选集随之改变，旧类目必然失效需清空 */
  cycleType(seq: number, cur: string): void {
    const next = cur === 'expense' ? 'income' : (cur === 'income' ? 'transfer' : 'expense');
    this.applyEdit(seq, (t: AiCandidateTxn) => {
      t.type = next;
      t.category_id = undefined;
      t.category_name = undefined;
    }, 'type');
  }

  setCategory(seq: number, c: Category): void {
    this.applyEdit(seq, (t: AiCandidateTxn) => {
      t.category_id = c.id;
      t.category_name = c.name;
    }, 'category');
  }

  setAccount(seq: number, a: Account): void {
    this.applyEdit(seq, (t: AiCandidateTxn) => { t.account_id = a.id; });
  }

  setTransferFrom(seq: number, a: Account): void {
    this.applyEdit(seq, (t: AiCandidateTxn) => { t.from_account_id = a.id; });
  }

  setTransferTo(seq: number, a: Account): void {
    this.applyEdit(seq, (t: AiCandidateTxn) => { t.to_account_id = a.id; });
  }

  removeCandidate(seq: number): void {
    const rest = this.candidates.filter((t: AiCandidateTxn) => t.seq !== seq);
    if (rest.length === 0) {
      this.discardPrediction('用户移除了全部候选');
    } else {
      this.candidates = rest;
    }
  }

  private resetConfirm(): void {
    this.predictionId = 0;
    this.candidates = [];
    this.originalCandidates = [];
    this.aiVerdict = '';
    this.aiReasons = [];
    this.aiOverall = -1;
    this.perTxn = [];
    this.committing = false;
    this.idemKey = '';
  }

  /** 确认并落账 —— 唯一写账本的入口 */
  async commitPrediction(): Promise<void> {
    if (this.predictionId <= 0 || this.committing) return;

    // 前置自检：比服务端 422 更具体地定位问题
    for (const it of this.candidates) {
      const tag = `第 ${it.seq} 笔`;
      if (!(it.amount > 0)) {
        this.messages.push({ role: 'assistant', content: `${tag}金额无效，请修正后再入账` });
        return;
      }
      if (it.type === 'transfer') {
        if (!it.from_account_id || !it.to_account_id) {
          this.messages.push({ role: 'assistant', content: `${tag}请选择转出与转入账户` });
          return;
        }
        if (it.from_account_id === it.to_account_id) {
          this.messages.push({ role: 'assistant', content: `${tag}转出与转入账户不能相同` });
          return;
        }
      } else if (!it.account_id) {
        this.messages.push({ role: 'assistant', content: `${tag}请选择账户` });
        return;
      }
    }

    this.committing = true;
    const dirty = this.isDirty();
    const pid = this.predictionId;
    try {
      const r = await Api.aiCommitPrediction(pid, {
        action: dirty ? 'corrected' : 'confirmed',
        transactions: dirty ? this.candidates : undefined,
        idempotency_key: this.idemKey
      });
      if (r.success && r.data) {
        const n = r.data.transactions ? r.data.transactions.length : this.candidates.length;
        this.resetConfirm();
        this.messages.push({ role: 'assistant', content: `${r.data.message} · 已记账 ${n} 笔。` });
      } else {
        this.committing = false;
      }
    } catch (e) {
      const err = e as ApiError;
      const msg = err.message ?? '提交失败';
      // 409：快照已被提交或弃置（状态机单向不可逆），本地状态过期，清空避免反复点击。
      // 以 HTTP 状态码判定而非错误文案，后端改文案不会失效。
      if (err.code === 409) {
        this.resetConfirm();
        this.messages.push({ role: 'assistant', content: `${msg}，已重置识别结果` });
      } else {
        this.committing = false;
        this.messages.push({ role: 'assistant', content: '入账失败：' + msg });
      }
    }
  }

  /** 弃置预测：仅记录事件，不形成负向学习 */
  async discardPrediction(reason: string = 'user_discarded'): Promise<void> {
    if (this.predictionId <= 0) return;
    const pid = this.predictionId;
    this.resetConfirm();
    try {
      await Api.aiDiscardPrediction(pid, { reason });
      this.messages.push({ role: 'assistant', content: '已弃置本次识别，你可以重新描述～' });
    } catch (e) {
      // 弃置失败不阻塞用户继续使用
      this.messages.push({ role: 'assistant', content: '弃置未成功：' + (e as ApiError).message });
    }
  }

  /** 清空对话：必须同步弃置未确认预测，否则快照会永久挂在 pending 态 */
  async clearMessages(): Promise<void> {
    if (this.predictionId > 0) {
      const pid = this.predictionId;
      this.resetConfirm();
      try {
        await Api.aiDiscardPrediction(pid, { reason: 'cleared_conversation' });
      } catch (e) {
        // 清空是本地动作，弃置失败不该拦住用户
      }
    }
    this.messages = [this.messages[0]];
  }

  @Builder Bubble(m: ChatMsg) {
    Column({ space: 6 }) {
      if (m.role === 'user') {
        Text(m.content).fontSize(15).fontColor('#FFFFFF')
          .backgroundColor(COLORS.brand).padding(12).borderRadius(12)
          .alignSelf(ItemAlign.End).constraintSize({ maxWidth: '78%' })
      } else {
        Text(m.content).fontSize(15).fontColor(COLORS.textPrimary)
          .backgroundColor(COLORS.brandBgLight).padding(12).borderRadius(12)
          .alignSelf(ItemAlign.Start).constraintSize({ maxWidth: '85%' })
        if (m.txs && m.txs.length > 0) {
          ForEach(m.txs, (t: TransactionItem) => {
            Column({ space: 4 }) {
              Row({ space: 8 }) {
                Text(t.category?.icon || '📌').fontSize(18)
                Column() {
                  Text(`${t.category?.name || ''} ${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}`)
                    .fontSize(14).fontColor(COLORS.textPrimary)
                  Text(`${t.account?.name || ''} ${t.date || ''}`).fontSize(11).fontColor(COLORS.textSecondary)
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              }
              Row({ space: 12 }) {
                Text('修改').fontSize(13).fontColor(COLORS.brand)
                  .onClick(() => router.pushUrl({ url: 'pages/AddTransaction', params: { editId: t.id } }))
                Text('删除').fontSize(13).fontColor(COLORS.danger)
                  .onClick(() => { Api.deleteTransaction(t.id).then(() => {/* refresh */ }); })
              }.justifyContent(FlexAlign.End)
            }.width('100%').padding(10).backgroundColor(COLORS.card).borderRadius(10)
          }, (t: TransactionItem) => t.id.toString())
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  /** 空态快捷示例：把「能怎么说」示范出来，点一下直接填入并发送 */
  @Builder QuickStart() {
    Column({ space: 10 }) {
      Text('试试这样说')
        .fontSize(12).fontColor(COLORS.textSecondary)
        .margin({ top: 4 })
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center }) {
        ForEach(QUICK_EXAMPLES, (q: string) => {
          Text(q)
            .fontSize(13).fontColor(COLORS.brand)
            .padding({ left: 14, right: 14, top: 8, bottom: 8 })
            .backgroundColor(withAlpha(COLORS.surface, 0.72))
            .borderRadius(18)
            .border({ width: 0.5, color: COLORS.outlineVariant })
            .margin({ right: 8, bottom: 8 })
            .onClick(() => { this.input = q; this.send(); })
        }, (q: string) => q)
      }.width('100%')
      Row({ space: 6 }) {
        Text('📷').fontSize(13)
        Text('也可以直接发小票照片，自动识别金额和类目')
          .fontSize(12).fontColor(COLORS.textSecondary)
      }.margin({ top: 2 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ top: 20, bottom: 8, left: 8, right: 8 })
  }

  /** 字段标签 + 置信度徽标；数据源为服务端 validation，此处不做阈值判断 */
  @Builder FieldLabel(text: string, seq: number, field: string) {
    Row({ space: 4 }) {
      Text(text).fontSize(11).fontColor(COLORS.textSecondary)
      if (this.fieldVerdict(seq, field) !== undefined) {
        Text(`${Math.round((this.fieldVerdict(seq, field)!.score) * 100)}%`)
          .fontSize(9).fontWeight(FontWeight.Bold)
          .fontColor(this.fieldVerdict(seq, field)!.ok ? OK_GREEN : WARN_AMBER)
          .backgroundColor(this.fieldVerdict(seq, field)!.ok ? OK_GREEN_BG : WARN_AMBER_BG)
          .padding({ left: 4, right: 4, top: 1, bottom: 1 })
          .borderRadius(6)
      }
    }
  }

  /** 单笔候选交易的编辑行 */
  @Builder CandidateRow(t: AiCandidateTxn) {
    Column({ space: 6 }) {
      // 行头：序号 + 商户 + 原文 + 移除
      Row({ space: 6 }) {
        Text(`第 ${t.seq} 笔`).fontSize(11).fontWeight(FontWeight.Bold).fontColor(COLORS.brand)
        if (t.merchant) {
          Text(t.merchant).fontSize(12).fontColor(COLORS.textPrimary).maxLines(1)
        }
        if (t.raw_segment) {
          Text(`「${t.raw_segment}」`).fontSize(11).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        } else {
          Blank()
        }
        Text('移除').fontSize(12).fontColor(COLORS.danger)
          .onClick(() => this.removeCandidate(t.seq))
      }.width('100%')

      // 类型 + 金额
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          this.FieldLabel('类型', t.seq, 'type')
          Text(typeLabelOf(t.type)).fontSize(13).fontColor(COLORS.textPrimary)
            .width('100%').padding({ left: 8, right: 8, top: 8, bottom: 8 })
            .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(8)
            .onClick(() => this.cycleType(t.seq, t.type))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)

        Column({ space: 2 }) {
          this.FieldLabel('金额', t.seq, 'amount')
          TextInput({ text: trimAmount(t.amount) })
            .type(InputType.NUMBER_DECIMAL).fontSize(13).height(36)
            .onChange((v: string) => this.setAmount(t.seq, v))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').alignItems(VerticalAlign.Top)

      // 账户 / 转账双账户 + 分类。选择器复用项目既有 DropdownField，
      // 而非自造 bindMenu —— 视觉与 AddTransaction 页保持一致
      if (t.type === 'transfer') {
        Column({ space: 8 }) {
          DropdownField({
            label: '转出账户',
            value: this.accountName(t.from_account_id),
            options: this.accountOptions(),
            emptyHint: '选择转出账户',
            onSelected: (id: number) => this.setTransferSlot(t.seq, 'from', id)
          })
          DropdownField({
            label: '转入账户',
            value: this.accountName(t.to_account_id),
            options: this.accountOptions(),
            emptyHint: '选择转入账户',
            onSelected: (id: number) => this.setTransferSlot(t.seq, 'to', id)
          })
        }.width('100%').alignItems(HorizontalAlign.Start)
      } else {
        Column({ space: 8 }) {
          DropdownField({
            label: '账户',
            value: this.accountName(t.account_id),
            options: this.accountOptions(),
            emptyHint: '选择账户',
            onSelected: (id: number) => this.setAccountById(t.seq, id)
          })
          Column({ space: 2 }) {
            this.FieldLabel('分类', t.seq, 'category')
            DropdownField({
              label: '',
              value: t.category_name ? t.category_name : '',
              options: this.categoryOptions(t.type),
              emptyHint: '选择分类',
              onSelected: (id: number) => this.setCategoryById(t.seq, id)
            })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }.width('100%').alignItems(HorizontalAlign.Start)
      }

      // 日期（只读展示）+ 备注
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          this.FieldLabel('日期', t.seq, 'date')
          Text(t.date || '—').fontSize(12).fontColor(COLORS.textPrimary).margin({ top: 6 })
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Column({ space: 2 }) {
          Text('备注').fontSize(11).fontColor(COLORS.textSecondary)
          TextInput({ text: t.note || '', placeholder: '备注' })
            .fontSize(12).height(36).onChange((v: string) => this.setNote(t.seq, v))
        }.layoutWeight(2).alignItems(HorizontalAlign.Start)
      }.width('100%').alignItems(VerticalAlign.Top)

      // 证据链：解释「为什么这么判」
      if (this.evidenceText(t)) {
        Text(this.evidenceText(t)).fontSize(10).fontColor(COLORS.textSecondary)
          .width('100%').margin({ top: 2 })
      }
    }
    .width('100%').padding(10).borderRadius(10)
    .backgroundColor(withAlpha(COLORS.surface, 0.6))
  }

  /** AI v0.2 确认卡片：落账唯一入口，未确认前账本不会被改动 */
  @Builder ConfirmCard() {
    Column({ space: 10 }) {
      // 裁决横幅：以服务端 verdict 为唯一依据
      Column({ space: 2 }) {
        Text(this.aiVerdict === 'ready'
          ? `✅ 各字段置信度达标，仍建议核对后入账${this.overallText()}`
          : `⚠️ 有字段置信度偏低，请核对后入账${this.overallText()}`)
          .fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor(this.aiVerdict === 'ready' ? OK_GREEN : WARN_AMBER)
        ForEach(this.aiReasons.slice(0, 4), (r: string) => {
          Text(`· ${r}`).fontSize(10)
            .fontColor(this.aiVerdict === 'ready' ? OK_GREEN : WARN_AMBER)
        }, (r: string) => r)
      }
      .width('100%').padding(10).borderRadius(10)
      .backgroundColor(this.aiVerdict === 'ready' ? OK_GREEN_BG : WARN_AMBER_BG)
      .alignItems(HorizontalAlign.Start)

      ForEach(this.candidates, (t: AiCandidateTxn) => {
        this.CandidateRow(t)
      }, (t: AiCandidateTxn) => t.seq.toString())

      Row({ space: 8 }) {
        Text(this.committing
          ? '提交中…'
          : (this.isDirty()
              ? `✅ 按修正后入账（${this.candidates.length} 笔）`
              : `✅ 确认入账（${this.candidates.length} 笔）`))
          .fontSize(14).fontColor('#FFFFFF').textAlign(TextAlign.Center)
          .layoutWeight(1).padding({ top: 10, bottom: 10 })
          .backgroundColor(this.committing ? COLORS.textSecondary : COLORS.brand)
          .borderRadius(10)
          .onClick(() => { if (!this.committing) this.commitPrediction(); })
        Text('弃置').fontSize(14).fontColor(COLORS.danger)
          .padding({ left: 14, right: 14, top: 10, bottom: 10 })
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(10)
          .onClick(() => { if (!this.committing) this.discardPrediction(); })
      }.width('100%')
    }
    .width('100%').padding(12).borderRadius(14)
    .backgroundColor(withAlpha(COLORS.card, 0.95))
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  overallText(): string {
    return this.aiOverall >= 0 ? `（综合置信度 ${Math.round(this.aiOverall * 100)}%）` : '';
  }

  accountName(id?: number): string {
    if (!id) return '';
    const a = this.accounts.find((x: Account) => x.id === id);
    return a ? a.name : '';
  }

  /** 证据链文案。ArkTS 不能对 interface 做字符串索引，逐字段取 */
  evidenceText(t: AiCandidateTxn): string {
    if (!t.evidence) return '';
    const ev: AiEvidenceMap = t.evidence;
    const parts: string[] = [];
    if (ev.amount && ev.amount !== 'missing') parts.push(`金额=${ev.amount}`);
    if (ev.type && ev.type !== 'missing') parts.push(`类型=${ev.type}`);
    if (ev.category && ev.category !== 'missing') parts.push(`分类=${ev.category}`);
    if (ev.date && ev.date !== 'missing') parts.push(`日期=${ev.date}`);
    return parts.length > 0 ? `识别依据：${parts.join('  ·  ')}` : '';
  }

  /** 账户下拉选项（DropdownField 需要 {name, id}） */
  accountOptions(): DropdownOption[] {
    return this.accounts.map((a: Account): DropdownOption => ({ name: a.name, id: a.id }));
  }

  /** 分类下拉选项；按当前类型过滤（transfer 不需要分类，服务端也不要求） */
  categoryOptions(type: string): DropdownOption[] {
    const want = type === 'income' ? 'income' : 'expense';
    return this.categories
      .filter((c: Category) => c.type === want)
      .map((c: Category): DropdownOption => ({ name: c.name, id: c.id }));
  }

  setAccountById(seq: number, id: number): void {
    const a = this.accounts.find((x: Account) => x.id === id);
    if (a) this.setAccount(seq, a);
  }

  setTransferSlot(seq: number, slot: string, id: number): void {
    const a = this.accounts.find((x: Account) => x.id === id);
    if (!a) return;
    if (slot === 'from') this.setTransferFrom(seq, a);
    else this.setTransferTo(seq, a);
  }

  setCategoryById(seq: number, id: number): void {
    const c = this.categories.find((x: Category) => x.id === id);
    if (c) this.setCategory(seq, c);
  }

  build() {
    // 页面背景三层结构（见 docs/harmony-style-guide.md 第 15 节）：
    // 根节点必须是原生 Stack（@Entry 不接受自定义组件做根，会报 10905210）
    Stack() {
      AppBackground()
      Column() {
      // 顶栏（与 TopBar 组件对齐：高度 52，padding left 12 + right 16，右侧保留清空按钮）
      // 底色半透明 0.9：不透明会在环境光上切出横向断层
      Row() {
        Text('‹').fontSize(28).fontColor(COLORS.textPrimary).width(32).textAlign(TextAlign.Center)
          .onClick(() => router.back())
        Text('AI 记账').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
          .margin({ left: 4 })
        Text('🗑').fontSize(20).fontColor(COLORS.textSecondary).width(40).textAlign(TextAlign.Center)
          .onClick(() => this.clearMessages())
      }.width('100%').height(52).padding({ left: 12, right: 16 })
        .backgroundColor(withAlpha(COLORS.surface, 0.9))
        .border({ width: { bottom: 0.5 }, color: COLORS.outlineVariant })

      // 对话
      Scroll() {
        Column({ space: 12 }) {
          ForEach(this.messages, (m: ChatMsg) => {
            this.Bubble(m)
          }, (m: ChatMsg, i: number) => i.toString())
          // 空态引导：只有欢迎气泡时，整屏是大片死白 + 一个孤零零的气泡。
          // 给几个可点的示例把「能说什么」直接示范出来，比让用户自己想省事。
          if (this.messages.length <= 1 && !this.transcribing) {
            this.QuickStart()
          }
          if (this.transcribing) {
            Text('转写中...').fontSize(14).fontColor(COLORS.textSecondary).alignSelf(ItemAlign.Center)
          }
          // v0.2 确认卡片：AI 解析结果落在对话流末尾，用户确认后才写账本
          if (this.predictionId > 0) {
            this.ConfirmCard()
          }
          Blank().height(8)
        }.padding(12)
      }.layoutWeight(1)

      // 输入栏
      Column({ space: 6 }) {
        if (this.pendingImage) {
          Row() {
            Text('🖼 已选图片，将随消息发送').fontSize(12).fontColor(COLORS.textSecondary).layoutWeight(1)
            Text('✕').fontColor(COLORS.danger).onClick(() => this.pendingImage = '')
          }.padding({ left: 12, right: 12 })
        }
        Row({ space: 8 }) {
          // 麦克风
          Column() {
            Text(this.recording ? '■' : '🎤').fontSize(20)
              .fontColor(this.recording ? COLORS.danger : COLORS.textPrimary)
          }.width(40).height(40).borderRadius(20).backgroundColor(COLORS.brandBgLight)
            .onClick(() => this.toggleVoice())
          if (this.recording) {
            Text(`${this.recSeconds}s`).fontSize(13).fontColor(COLORS.danger)
          }
          // 文本
          TextInput({ placeholder: '说点什么，或按住麦克风说话', text: this.input })
            .layoutWeight(1).onChange((v: string) => this.input = v)
          // 图片
          Text('🖼').fontSize(20).width(40).textAlign(TextAlign.Center)
            .onClick(() => this.pickImage())
          // 发送
          Text('发送').fontSize(14).fontColor('#FFFFFF').padding({ left: 14, right: 14, top: 8, bottom: 8 })
            .backgroundColor(COLORS.brand).borderRadius(16)
            .onClick(() => this.send())
        }.width('100%').padding({ left: 12, right: 12, top: 8, bottom: 8 })
          .backgroundColor(withAlpha(COLORS.surface, 0.9))
          .border({ width: { top: 0.5 }, color: COLORS.outlineVariant })
      }.width('100%')
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
