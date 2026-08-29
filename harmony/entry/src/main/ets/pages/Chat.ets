/**
 * AI 记账对话（对齐安卓 ChatScreen.kt）：
 * 空态介绍 + 对话列表（AI 内嵌交易卡片）+ 上下文 chips + 输入栏（麦克风/文本/图片/发送）。
 * 语音：鸿蒙原生 AudioCapturer 录音 → 后端 /ai/transcribe（Whisper）转写，根治 GMS 语音超时 Bug。
 *
 * AI v0.2：文本优先走确定性记账通道（parse → 确认卡片 → commit），
 * AI 输出【永不直接写账本】；识别不出交易时（422）才回退 legacy /ai/chat 保留咨询能力。
 */
import router from '@ohos.router';
import { ChatMessage, OcrResponse } from '../common/models';
import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import geoLocationManager from '@ohos.geoLocationManager';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import buffer from '@ohos.buffer';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import dataPreferences from '@ohos.data.preferences';
import { COLORS, fmtMoney, withAlpha } from '../common/theme';
import { AppBackground, DropdownField, DropdownOption } from '../common/components/Components';
import { startRecord, stopRecord } from '../common/audio';
import { TransactionItem } from '../common/models';
import {
  Account, AccountsResponse, Book, BooksResponse, Category, AiCandidateTxn, AiTxnValidation,
  AiFieldVerdict, AiPerFieldMap, AiConfidenceMap, AiEvidenceMap
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
  @State @Watch('saveHistory') messages: ChatMsg[] = [];
  /** 顶部标题固定「AI助手」；对话里 AI 署名 / 欢迎语昵称取 web 端起的名字，未起名回退「AI」/「小鑫」 */
  @State aiName: string = 'AI助手';
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
  // 底部上下文 chip 联动用：当前选中的账户/账本会同步到所有候选卡片
  @State selectedAccountId: number = 0;
  @State books: Book[] = [];
  @State currentBookId: number = 0;
  @State currentBookName: string = '个人账本';
  @State showBookSheet: boolean = false;
  @State showAccountSheet: boolean = false;
  @State showClearConfirm: boolean = false;

  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private timer: number = 0;
  /** 对话持久化：重启 App 后仍在，仅用户主动「删除记录」才清空 */
  private historyLoaded: boolean = false;
  private chatPrefs: dataPreferences.Preferences | null = null;

  async aboutToAppear(): Promise<void> {
    // 1. 初始化对话持久化存储 + 拉取 web 端 AI 名字（用于署名 / 欢迎语昵称）
    try {
      this.chatPrefs = await dataPreferences.getPreferences(this.ctx, 'chat_history');
    } catch (e) { /* 持久化不可用则降级为仅内存会话 */ }
    try {
      const s = await Api.getAiSettings();
      if (s.success && s.data && s.data.settings && s.data.settings.ai_name) {
        this.aiName = s.data.settings.ai_name;
      }
    } catch (e) { /* 静默回退「AI助手」 */ }

    // 2. 恢复本地对话记录（图片 base64 本就未进 messages；过滤失效交易卡片）
    await this.loadHistory();

    // 3. 恢复后为空才显示欢迎语（动态昵称，未起名回退「小鑫」）
    if (this.messages.length === 0) {
      this.pushWelcome();
    }

    // 4. 确认卡片需要账户/分类做下拉；失败不阻塞对话主流程
    try {
      const rs = await Promise.all([Api.getAccounts(), Api.getCategories(), Api.getBooks()]);
      const ar = rs[0];
      const cr = rs[1];
      const br = rs[2];
      if (ar.success && ar.data) {
        const d = ar.data as AccountsResponse;
        // 已销户账户不该出现在下拉里，否则用户能把钱记到一个关闭的账户上
        this.accounts = (d.accounts || []).filter((a: Account) => (a.status ?? 'active') !== 'closed');
        const def = this.accounts.find((a: Account) => a.is_default === true);
        this.defaultAccountId = def ? def.id : (this.accounts.length > 0 ? this.accounts[0].id : 0);
        this.selectedAccountId = this.defaultAccountId;
      }
      if (cr.success && cr.data) this.categories = cr.data as Category[];
      if (br.success && br.data) {
        const d = br.data as BooksResponse;
        this.books = d.books || [];
        this.currentBookId = d.currentBookId;
        const cur = this.books.find((b: Book) => b.id === d.currentBookId);
        this.currentBookName = cur ? cur.name : (this.books.length > 0 ? this.books[0].name : '个人账本');
      }
    } catch (e) { /* 静默降级：确认卡片仍可展示，只是下拉为空 */ }
  }

  /** 对话里 AI 的显示名：web 端起的名字，未起名回退「AI」 */
  private aiDisplayName(): string {
    return this.aiName === 'AI助手' ? 'AI' : this.aiName;
  }

  /** 推动态欢迎语（昵称取 web 起的名字，未起名回退「小鑫」） */
  private pushWelcome(): void {
    const name = this.aiName === 'AI助手' ? '小鑫' : this.aiName;
    this.messages = [{
      role: 'assistant',
      content: `你好，我是${name}。你可以直接说「今天午饭花了28元」，或发一张小票截图，我来帮你记账～`
    }];
  }

  /** 从本地存储恢复对话记录 */
  private async loadHistory(): Promise<void> {
    if (this.chatPrefs) {
      try {
        const json = await this.chatPrefs.get('chat_messages', '') as string;
        if (json && json.length > 0) {
          const arr = JSON.parse(json) as ChatMsg[];
          // 过滤失效交易卡片：仅保留 id>0 的真实交易（重启后临时/无效 id 丢弃）
          const filtered = arr.map((m: ChatMsg): ChatMsg => {
            if (m.txs && m.txs.length > 0) {
              const valid = m.txs.filter((t: TransactionItem) => (t.id ?? 0) > 0);
              return { role: m.role, content: m.content, txs: valid };
            }
            return m;
          });
          this.messages = filtered;
        }
      } catch (e) { /* 损坏则忽略，回到空会话 */ }
    }
    this.historyLoaded = true;
  }

  /** messages 变化即落盘（@Watch 触发；historyLoaded 置位前不写，避免空列表覆盖历史） */
  private saveHistory(): void {
    if (!this.historyLoaded || !this.chatPrefs) return;
    try {
      this.chatPrefs.put('chat_messages', JSON.stringify(this.messages));
      this.chatPrefs.flush();
    } catch (e) { /* 持久化失败不阻塞对话 */ }
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

    // 带图片 → v0.2 图片记账通道（/ai/ocr）。
    // ⛔ 绝不走 legacy /ai/chat：那里没有记账工具，system prompt 会让 AI 回复
    //   「我没法直接帮你落账，请走旁边的智能记账按钮」（用户实测踩坑 2026-08-26）。
    if (img) {
      await this.tryParseImage(img);
      return;
    }

    // 纯文本优先走 v0.2 确定性记账通道；识别不出（422）才回退 legacy chat 保留咨询能力
    const handled = await this.tryParseAsTransaction(text);
    if (handled) return;

    try {
      const r = await Api.chat({ message: text, history });
      if (r.success && r.data) {
        this.messages.push({ role: 'assistant', content: r.data.reply || '', txs: r.data.transactions || [] });
      }
    } catch (e) {
      this.messages.push({ role: 'assistant', content: '出错了：' + (e as ApiError).message });
    }
  }

  /**
   * 图片 → v0.2 图片记账通道（/ai/ocr：转录 → 票据预处理 → parse → 预测快照）。
   * 识别出交易 ⇒ 弹与文字通道同款的确认卡片；识别不出 ⇒ 文字回执。
   * 与文字通道共用同一套确认态字段（predictionId/candidates/...）与 commit/discard 逻辑。
   */
  async tryParseImage(b64: string): Promise<void> {
    try {
      // 失败会走 catch（Http 层 !success 即 throw ApiError），这里 r.data 必为有效响应
      const r = await Api.ocr(b64, this.defaultAccountId || undefined);
      const d = r.data as OcrResponse;
      const txns: AiCandidateTxn[] = d.transactions ? d.transactions : [];
      const pid: number = d.prediction_id ? d.prediction_id : 0;

      if (pid > 0 && txns.length > 0) {
        // 需要确认时补拉字段级裁决明细，用于高亮低置信字段
        let pt: AiTxnValidation[] = [];
        if (d.needs_confirmation) {
          try {
            const snap = await Api.aiGetPrediction(pid);
            if (snap.success && snap.data && snap.data.validation && snap.data.validation.per_txn) {
              pt = snap.data.validation.per_txn as AiTxnValidation[];
            }
          } catch (e) { /* 拉不到就不高亮，不阻塞主流程 */ }
        }

        this.predictionId = pid;
        this.originalCandidates = cloneTxns(txns);
        this.candidates = cloneTxns(txns);
        this.ensureCandidateAccounts();
        this.aiVerdict = d.verdict ? d.verdict : 'needs_confirmation';
        this.aiReasons = d.reasons ? d.reasons : [];
        this.aiOverall = d.overall_confidence === undefined ? -1 : d.overall_confidence;
        this.perTxn = pt;
        this.committing = false;
        this.idemKey = `harmony-${pid}-${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(0, 64);

        const tip = d.needs_confirmation ? '，其中有字段置信度偏低，请核对后确认' : '，请确认后入账';
        this.messages.push({
          role: 'assistant',
          content: `我从图片里识别到 ${txns.length} 笔记录${tip}`
        });
      } else {
        this.messages.push({
          role: 'assistant',
          content: (d.reason && d.reason.length > 0)
            ? d.reason
            : '这张图里没认出交易，可以换个角度拍，或直接用文字告诉我（如「午饭 28 元」）'
        });
      }
    } catch (e) {
      const err = e as ApiError;
      this.messages.push({ role: 'assistant', content: '出错了：' + err.message });
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
      this.ensureCandidateAccounts();
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

  /** 候选交易进入确认态时，自动把当前选中的默认账户填充到缺账户的交易上 */
  ensureCandidateAccounts(): void {
    if (this.selectedAccountId <= 0 || this.candidates.length === 0) return;
    const next = this.candidates.map((t: AiCandidateTxn): AiCandidateTxn => {
      if (t.type === 'transfer' || t.account_id) return t;
      const copy = cloneTxn(t);
      copy.account_id = this.selectedAccountId;
      return copy;
    });
    this.candidates = next;
  }

  /** 底部账户 chip：把当前选中账户同步到所有非转账候选卡片 */
  applyAccountToAll(id: number): void {
    if (id <= 0 || this.candidates.length === 0) return;
    this.selectedAccountId = id;
    const next = this.candidates.map((t: AiCandidateTxn): AiCandidateTxn => {
      if (t.type === 'transfer' || t.account_id === id) return t;
      const copy = cloneTxn(t);
      copy.account_id = id;
      return copy;
    });
    this.candidates = next;
  }

  /** 切换账本 chip：同步前端全局账本状态。账本是后端 commit 时的 req.bookId，不需 candidate 字段承载 */
  applyBookToAll(id: number): void {
    if (id <= 0) return;
    this.currentBookId = id;
    const cur = this.books.find((b: Book) => b.id === id);
    this.currentBookName = cur ? cur.name : '个人账本';
  }

  /** 地点 chip：调起 GPS 定位，拿到经纬度后批量追加到候选卡片备注 */
  async requestLocation(): Promise<void> {
    try {
      const at = abilityAccessCtrl.createAtManager();
      const res = await at.requestPermissionsFromUser(this.ctx,
        ['ohos.permission.LOCATION', 'ohos.permission.APPROXIMATELY_LOCATION']);
      if (!res.authResults.every((r: number) => r === 0)) return;
      const loc = await geoLocationManager.getCurrentLocation({ scenario: 0x301 });
      this.applyLocationToAll(`${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`);
    } catch (e) { /* 定位失败静默 —— 与手动记账一致 */ }
  }

  /** 把定位/地点字符串追加到所有候选卡片备注（GPS 直接传经纬度，文本输入也已兼容） */
  applyLocationToAll(loc: string): void {
    const trimmed = loc.trim();
    if (!trimmed || this.candidates.length === 0) return;
    const next = this.candidates.map((t: AiCandidateTxn): AiCandidateTxn => {
      const copy = cloneTxn(t);
      const prefix = copy.note ? `${copy.note} · ` : '';
      copy.note = `${prefix}${trimmed}`;
      return copy;
    });
    this.candidates = next;
  }

  /** 切换当前账本，成功后刷新页面默认账户；同时把账本同步到所有候选 */
  async switchBookAndReload(id: number): Promise<void> {
    if (id === this.currentBookId) {
      this.showBookSheet = false;
      return;
    }
    try {
      const r = await Api.switchBook(id);
      if (r.success && r.data) {
        this.applyBookToAll(id);
        // 切换账本后账户列表会变化，刷新并重新选默认账户
        const ar = await Api.getAccounts();
        if (ar.success && ar.data) {
          const d = ar.data as AccountsResponse;
          this.accounts = (d.accounts || []).filter((a: Account) => (a.status ?? 'active') !== 'closed');
          const def = this.accounts.find((a: Account) => a.is_default === true);
          this.defaultAccountId = def ? def.id : (this.accounts.length > 0 ? this.accounts[0].id : 0);
          this.selectedAccountId = this.defaultAccountId;
          this.applyAccountToAll(this.selectedAccountId);
        }
      }
    } catch (e) { /* 失败静默，不打扰 */ }
    this.showBookSheet = false;
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
    this.pushWelcome();
  }

  @Builder Bubble(m: ChatMsg) {
    Column({ space: 6 }) {
      // 署名：用户「我」/ AI 动态昵称（未起名回退「AI」）
      Text(m.role === 'user' ? '我' : this.aiDisplayName())
        .fontSize(11).fontColor(COLORS.textSecondary)
        .alignSelf(m.role === 'user' ? ItemAlign.End : ItemAlign.Start)
        .margin({ bottom: 2 })
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

  /** 单笔候选交易的编辑行（新版）：收据式卡片 + 字段网格 + 底部联动感知 */
  @Builder CandidateRow(t: AiCandidateTxn) {
    Column({ space: 0 }) {
      // 头部：类型图标 + 标题（商户 / 备注 / 原文） + 大金额 + 移除
      Row({ space: 10 }) {
        // 类型色环
        Column() {
          Text(t.type === 'income' ? '↓' : (t.type === 'transfer' ? '⇄' : '↑'))
            .fontSize(16).fontColor('#FFFFFF').textAlign(TextAlign.Center)
        }
        .width(36).height(36).borderRadius(18)
        .backgroundColor(t.type === 'income' ? '#1B7F4B' : (t.type === 'transfer' ? '#4A6FA5' : '#C55A1E'))
        .justifyContent(FlexAlign.Center)

        Column({ space: 2 }) {
          Text(t.merchant || t.note || t.raw_segment || '交易')
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(COLORS.textPrimary).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Row({ space: 6 }) {
            Text(`${t.seq}`).fontSize(10).fontColor(COLORS.brand)
              .padding({ left: 4, right: 4, top: 1, bottom: 1 })
              .backgroundColor(withAlpha(COLORS.brandBgLight, 0.5)).borderRadius(4)
            if (t.raw_segment && t.raw_segment !== (t.merchant || t.note || '')) {
              Text(`「${t.raw_segment}」`).fontSize(11).fontColor(COLORS.textSecondary)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
          }.width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)

        Column({ space: 2 }) {
          Text(`${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}`)
            .fontSize(22).fontWeight(FontWeight.Bold)
            .fontColor(t.type === 'income' ? '#1B7F4B' : (t.type === 'transfer' ? '#4A6FA5' : COLORS.textPrimary))
          this.FieldBadge(t.seq, 'amount')
        }.alignItems(HorizontalAlign.End)

        Text('✕').fontSize(16).fontColor(COLORS.textSecondary)
          .width(28).height(28).textAlign(TextAlign.Center)
          .onClick(() => this.removeCandidate(t.seq))
      }.width('100%').alignItems(VerticalAlign.Center)

      // 字段编辑网格：类型 + 金额
      Row({ space: 10 }) {
        // 类型
        Column({ space: 2 }) {
          Row({ space: 4 }) {
            this.FieldLabel('类型')
            this.FieldBadge(t.seq, 'type')
          }.width('100%')
          Row() {
            Text(typeLabelOf(t.type)).fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
            Text('›').fontSize(16).fontColor(COLORS.textSecondary)
          }.width('100%').padding({ left: 10, right: 10, top: 10, bottom: 10 })
          .backgroundColor(withAlpha(COLORS.surface, 0.6))
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(10)
          .onClick(() => this.cycleType(t.seq, t.type))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)

        // 金额
        Column({ space: 2 }) {
          this.FieldLabel('金额')
          Row() {
            TextInput({ text: trimAmount(t.amount) })
              .type(InputType.NUMBER_DECIMAL).fontSize(15).height(40).layoutWeight(1)
              .onChange((v: string) => this.setAmount(t.seq, v))
          }.width('100%').padding({ left: 10, right: 10, top: 6, bottom: 6 })
          .backgroundColor(withAlpha(COLORS.surface, 0.6))
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(10)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').margin({ top: 14 })

      if (t.type === 'transfer') {
        Column({ space: 10 }) {
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
        }.width('100%').margin({ top: 10 }).alignItems(HorizontalAlign.Start)
      } else {
        Row({ space: 10 }) {
          DropdownField({
            label: '账户',
            value: this.accountName(t.account_id),
            options: this.accountOptions(),
            emptyHint: '选择账户',
            onSelected: (id: number) => this.setAccountById(t.seq, id)
          }).layoutWeight(1)
          DropdownField({
            label: '分类',
            value: t.category_name ? t.category_name : '',
            options: this.categoryOptions(t.type),
            emptyHint: '选择分类',
            onSelected: (id: number) => this.setCategoryById(t.seq, id)
          }).layoutWeight(1)
        }.width('100%').margin({ top: 10 }).alignItems(VerticalAlign.Top)
      }

      Row({ space: 10 }) {
        // 日期
        Column({ space: 2 }) {
          Row({ space: 4 }) {
            this.FieldLabel('日期')
            this.FieldBadge(t.seq, 'date')
          }.width('100%')
          Row() {
            Text(t.date || '—').fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
          }.width('100%').padding({ left: 10, right: 10, top: 10, bottom: 10 })
          .backgroundColor(withAlpha(COLORS.surface, 0.6))
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(10)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)

        // 备注
        Column({ space: 2 }) {
          this.FieldLabel('备注')
          Row() {
            TextInput({ text: t.note || '', placeholder: '备注' })
              .fontSize(14).height(40).layoutWeight(1)
              .onChange((v: string) => this.setNote(t.seq, v))
          }.width('100%').padding({ left: 10, right: 10, top: 6, bottom: 6 })
          .backgroundColor(withAlpha(COLORS.surface, 0.6))
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(10)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').margin({ top: 10 })

      // 证据链：弱化为浅灰小字，不抢视觉重心
      if (this.evidenceText(t)) {
        Text(this.evidenceText(t)).fontSize(10).fontColor(COLORS.textSecondary)
          .width('100%').margin({ top: 10 })
      }
    }
    .width('100%').padding(14).borderRadius(14)
    .backgroundColor(COLORS.card)
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  /** 字段标签：精简版 */
  @Builder FieldLabel(text: string) {
    Text(text).fontSize(11).fontColor(COLORS.textSecondary)
  }

  /** 字段级置信度徽标 */
  @Builder FieldBadge(seq: number, field: string) {
    if (this.fieldVerdict(seq, field) !== undefined) {
      Text(`${Math.round((this.fieldVerdict(seq, field)!.score) * 100)}%`)
        .fontSize(9).fontWeight(FontWeight.Bold)
        .fontColor(this.fieldVerdict(seq, field)!.ok ? OK_GREEN : WARN_AMBER)
        .backgroundColor(this.fieldVerdict(seq, field)!.ok ? OK_GREEN_BG : WARN_AMBER_BG)
        .padding({ left: 4, right: 4, top: 1, bottom: 1 })
        .borderRadius(6)
    }
  }

  /** AI v0.2 确认卡片（新版）：收据式汇总头部 + 候选卡片 + 底部动作 */
  @Builder ConfirmCard() {
    Column({ space: 12 }) {
      // 裁决头部：左侧状态圆点 + 主文案 + 置信度
      Row({ space: 10 }) {
        Column() {
          Text(this.aiVerdict === 'ready' ? '✓' : '!')
            .fontSize(14).fontColor('#FFFFFF').fontWeight(FontWeight.Bold)
            .textAlign(TextAlign.Center)
        }
        .width(28).height(28).borderRadius(14)
        .backgroundColor(this.aiVerdict === 'ready' ? OK_GREEN : WARN_AMBER)
        .justifyContent(FlexAlign.Center)

        Column({ space: 2 }) {
          Text(this.aiVerdict === 'ready'
            ? `各字段置信度达标，核对后入账${this.overallText()}`
            : `有字段置信度偏低，请核对后入账${this.overallText()}`)
            .fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(COLORS.textPrimary)
          if (this.aiReasons.length > 0) {
            Text(this.aiReasons.slice(0, 3).join(' · '))
              .fontSize(11).fontColor(COLORS.textSecondary)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }
      .width('100%').padding(14).borderRadius(14)
      .backgroundColor(this.aiVerdict === 'ready' ? OK_GREEN_BG : WARN_AMBER_BG)
      .alignItems(VerticalAlign.Center)

      ForEach(this.candidates, (t: AiCandidateTxn) => {
        this.CandidateRow(t)
      }, (t: AiCandidateTxn) => t.seq.toString())

      // 汇总金额
      Row({ space: 4 }) {
        Text('合计').fontSize(13).fontColor(COLORS.textSecondary)
        Text(`${fmtMoney(this.totalAmount())}`).fontSize(16).fontWeight(FontWeight.Bold)
          .fontColor(COLORS.textPrimary)
        Text(`(${this.candidates.length} 笔)`).fontSize(12).fontColor(COLORS.textSecondary)
      }.width('100%').justifyContent(FlexAlign.End)

      Row({ space: 10 }) {
        Button(this.committing
          ? '提交中…'
          : (this.isDirty()
              ? `按修正后入账（${this.candidates.length} 笔）`
              : `确认入账（${this.candidates.length} 笔）`))
          .fontSize(15).fontColor('#FFFFFF')
          .layoutWeight(1).height(46)
          .backgroundColor(this.committing ? COLORS.textSecondary : COLORS.brand)
          .borderRadius(12)
          .onClick(() => { if (!this.committing) this.commitPrediction(); })
        Button('弃置')
          .fontSize(15).fontColor(COLORS.danger)
          .height(46).padding({ left: 20, right: 20 })
          .backgroundColor(withAlpha(COLORS.surface, 0.6))
          .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(12)
          .onClick(() => { if (!this.committing) this.discardPrediction(); })
      }.width('100%')
    }
    .width('100%').padding(14).borderRadius(16)
    .backgroundColor(withAlpha(COLORS.card, 0.98))
    .border({ width: 0.5, color: COLORS.outlineVariant })
  }

  /** 候选交易总金额 */
  totalAmount(): number {
    let sum = 0;
    for (const t of this.candidates) sum += (t.amount || 0);
    return sum;
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

  /** 底部上下文 chip 条：账本 / 账户 / 地点，对齐手动记账字段，联动 AI 候选卡片 */
  @Builder ContextChipBar() {
    Row({ space: 8 }) {
      // 账本
      this.ContextChip(
        '📒', this.currentBookName,
        () => { this.showBookSheet = true; },
        false
      )
      // 账户：显示当前选中账户，点一下弹出账户选择（名称过长截断，避免挤出其他 chip）
      this.ContextChip(
        '💳',
        this.selectedAccountId > 0 ? this.accountName(this.selectedAccountId) : '选择账户',
        () => { this.showAccountSheet = true; },
        this.selectedAccountId > 0,
        120
      )
      // 地点：直接调 GPS 定位，拿到经纬度后追加到所有候选卡片备注
      this.ContextChip(
        '📍', '地点',
        () => { this.requestLocation(); },
        false
      )
    }
    .width('100%').padding({ left: 12, right: 12, top: 8, bottom: 8 })
    .backgroundColor(withAlpha(COLORS.surface, 0.95))
    .border({ width: { top: 0.5 }, color: COLORS.outlineVariant })
    .justifyContent(FlexAlign.Start)
  }

  @Builder ContextChip(icon: string, label: string, onClick: () => void, active: boolean, maxLabelWidth: number = 0) {
    Row({ space: 4 }) {
      Text(icon).fontSize(13)
      if (maxLabelWidth > 0) {
        Text(label).fontSize(13).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(active ? COLORS.brand : COLORS.textPrimary)
          .fontWeight(active ? FontWeight.Medium : FontWeight.Normal)
          .constraintSize({ maxWidth: maxLabelWidth })
      } else {
        Text(label).fontSize(13).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(active ? COLORS.brand : COLORS.textPrimary)
          .fontWeight(active ? FontWeight.Medium : FontWeight.Normal)
      }
    }
    .padding({ left: 10, right: 10, top: 6, bottom: 6 })
    .backgroundColor(active ? COLORS.brandBgLight : withAlpha(COLORS.surface, 0.6))
    .border({ width: 0.5, color: active ? COLORS.brand : COLORS.outlineVariant })
    .borderRadius(16)
    .flexShrink(0)
    .onClick(onClick)
  }

  /** 账本选择 sheet */
  @Builder BookSheet() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text('切换账本').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text('✕').fontSize(18).fontColor(COLORS.textSecondary)
          .onClick(() => this.showBookSheet = false)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)

      ForEach(this.books, (b: Book) => {
        Row({ space: 10 }) {
          Text(b.id === this.currentBookId ? '✓' : '').fontSize(14).fontColor(COLORS.brand).width(20)
          Text(b.name).fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
        }
        .width('100%').padding({ top: 14, bottom: 14 })
        .backgroundColor(b.id === this.currentBookId ? COLORS.brandBgLight : COLORS.surface)
        .borderRadius(10)
        .onClick(() => this.switchBookAndReload(b.id))
      }, (b: Book) => b.id.toString())
    }
    .width('100%').padding(16).borderRadius({ topLeft: 16, topRight: 16 })
    .backgroundColor(COLORS.card)
  }

  /** 账户选择 sheet */
  @Builder AccountSheet() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        Text('选择账户').fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
        Text('✕').fontSize(18).fontColor(COLORS.textSecondary)
          .onClick(() => this.showAccountSheet = false)
      }.width('100%').justifyContent(FlexAlign.SpaceBetween)

      ForEach(this.accounts, (a: Account) => {
        Row({ space: 10 }) {
          Text(a.id === this.selectedAccountId ? '✓' : '').fontSize(14).fontColor(COLORS.brand).width(20)
          Text(a.name).fontSize(15).fontColor(COLORS.textPrimary).layoutWeight(1)
        }
        .width('100%').padding({ top: 14, bottom: 14 })
        .backgroundColor(a.id === this.selectedAccountId ? COLORS.brandBgLight : COLORS.surface)
        .borderRadius(10)
        .onClick(() => {
          this.applyAccountToAll(a.id);
          this.showAccountSheet = false;
        })
      }, (a: Account) => a.id.toString())
    }
    .width('100%').padding(16).borderRadius({ topLeft: 16, topRight: 16 })
    .backgroundColor(COLORS.card)
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
        Text('AI助手').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
          .margin({ left: 4 })
        Text('🗑').fontSize(20).fontColor(COLORS.textSecondary).width(40).textAlign(TextAlign.Center)
          .onClick(() => { this.showClearConfirm = true; })
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

      // 上下文 chip 条：仅在有 AI 确认卡片时显示（账户/不关联/地点都是给候选交易用的）
      if (this.predictionId > 0) {
        this.ContextChipBar()
      }

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

      // 浮层：底部 sheet / 居中 dialog，放在 Stack 最上层
      if (this.showBookSheet) {
        Column() {
          this.BookSheet()
        }.width('100%').height('100%')
        .justifyContent(FlexAlign.End)
        .backgroundColor('rgba(0,0,0,0.35)')
      }
      if (this.showAccountSheet) {
        Column() {
          this.AccountSheet()
        }.width('100%').height('100%')
        .justifyContent(FlexAlign.End)
        .backgroundColor('rgba(0,0,0,0.35)')
      }
      // 清空对话确认：「删除记录」语义，对齐安卓（不可撤销）
      if (this.showClearConfirm) {
        Column() {
          Column({ space: 14 }) {
            Text('删除记录').fontSize(18).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
            Text('确认删除全部对话记录吗？该操作不可撤销，删除后无法恢复。')
              .fontSize(14).fontColor(COLORS.textSecondary).width('100%')
            Row({ space: 12 }) {
              Button('取消', { type: ButtonType.Normal })
                .fontSize(15).height(44).layoutWeight(1)
                .backgroundColor(withAlpha(COLORS.surface, 0.6))
                .border({ width: 0.5, color: COLORS.outlineVariant }).borderRadius(12)
                .onClick(() => { this.showClearConfirm = false; })
              Button('删除', { type: ButtonType.Normal })
                .fontSize(15).fontColor('#FFFFFF').height(44).layoutWeight(1)
                .backgroundColor(COLORS.danger).borderRadius(12)
                .onClick(() => { this.showClearConfirm = false; this.clearMessages(); })
            }.width('100%')
          }.padding(20).width('88%').backgroundColor(COLORS.card).borderRadius(16)
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
        .backgroundColor('rgba(0,0,0,0.35)')
      }
    }.width('100%').height('100%')
  }
}
