/**
 * AI 智能记账（对齐安卓 AiScanScreen.kt）：OCR 配置提示 + 选图识别 + 逐条确认 + 批量入账。
 */
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import picker from '@ohos.file.picker';
import fs from '@ohos.file.fs';
import buffer from '@ohos.buffer';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { TopBar, LoadingBox, CategoryIcon, EmptyState, AppBackground } from '../common/components/Components';
import { TransactionItem, Category } from '../common/models';
import { toast, toastLong } from '../common/ui';

interface ScanRow { picked: boolean; id: number; seq: number; merchant: string; amount: number; type: string; categoryId: number; date: string; note: string; categoryName?: string; }

@Entry
@Component
struct AiScan {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State ocrConfigured: boolean = true;
  @State rows: ScanRow[] = [];
  @State accounts: ESObject[] = [];
  @State categories: Category[] = [];
  @State loading: boolean = false;
  @State picking: boolean = false;
  @State done: number = 0;
  /**
   * v0.2 OCR 预测快照 ID：提交时优先走 /ai/predictions/:id/commit 形成学习闭环。
   * 0 = 老路径回退（识别失败 / 旧版 OCR / 老服务端）。
   */
  @State predictionId: number = 0;
  private lastB64: string = '';
  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  aboutToAppear(): void { this.init(); }
  async init(): Promise<void> {
    try {
      const _r = await Promise.all([Api.getOcrConfig(), Api.getAccounts(), Api.getCategories()]);
      const c = _r[0];
      const a = _r[1];
      const cat = _r[2];
      if (c.success) this.ocrConfigured = !!(c.data as ESObject)?.configured;
      if (a.success) this.accounts = (a.data as ESObject)?.accounts || [];
      if (cat.success) this.categories = cat.data || [];
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  async pickAndOcr(): Promise<void> {
    if (this.picking) return;
    this.picking = true;
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
        const b64 = buffer.from(buf).toString('base64');
        this.lastB64 = b64;
        this.loading = true;
        const r = await Api.ocr(b64);
        const rd: ESObject = r.data as ESObject;
        const items: ESObject[] = ((rd.transactions as ESObject[]) || (rd.items as ESObject[]) || []);
        this.predictionId = (rd.prediction_id as number) || 0;
        this.rows = items.map((t: ESObject, i: number): ScanRow => ({
          picked: true,
          id: i,
          seq: i,
          merchant: t.merchant || t.note || t.category?.name || '消费',
          amount: t.amount || 0,
          type: t.type || 'expense',
          categoryId: this.categories.find(c => c.type === (t.type || 'expense'))?.id || (this.categories[0]?.id || 0),
          categoryName: (t.category_name as string) || (t.category?.name as string) || '',
          date: (t.date || '').slice(0, 10) || this.today(),
          note: t.note || ''
        }));
      }
    } catch (e) { console.error('ocr:', (e as ApiError).message); }
    finally { this.loading = false; this.picking = false; }
  }

  today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 按 categoryId 取类目名（用于拼接「场景-对象」备注） */
  categoryNameOf(id: number): string {
    return this.categories.find(c => c.id === id)?.name ?? '';
  }

  /** 组装 AI 记账备注：类目名-对象（如「晚餐-大味王」）；对象为空时仅用类目名 */
  buildNote(categoryId: number, object: string): string {
    const cat = this.categoryNameOf(categoryId);
    const obj = (object || '').trim();
    if (cat && obj) return `${cat}-${obj}`;
    return cat || obj;
  }

  async confirm(): Promise<void> {
    const picked = this.rows.filter(r => r.picked);
    this.done = 0;
    if (picked.length === 0) {
      toastLong('请至少勾选一条记录');
      return;
    }

    // ── v0.2 commit 闭环（与安卓 AiScanViewModel.submitAll 同根因同改法）──
    if (this.predictionId > 0) {
      try {
        const accountId = (this.accounts[0] as ESObject)?.id as number || 0;
        const corrected: Api.AiCandidateTxn[] = picked.map(r => ({
          seq: r.seq,
          type: r.type,
          amount: r.amount,
          merchant: r.merchant || undefined,
          category_id: r.categoryId,
          category_name: r.categoryName || '',
          account_id: accountId,
          date: r.date,
          note: r.note || undefined
        }));
        const idemKey = 'harmony-' + this.predictionId + '-' + Math.random().toString(36).slice(2, 18);
        const r = await Api.aiCommitPrediction(this.predictionId, {
          action: 'corrected',
          transactions: corrected,
          idempotency_key: idemKey
        });
        if (r.success) {
          const txns = (r.data as Api.AiCommitResponse)?.transactions || [];
          toast('已入账 ' + txns.length + ' 笔');
          router.back();
          return;
        }
        // commit 失败不静默回退——保留完整错误给用户（铁律 1：验证系统行为不验证假设）
        toastLong('提交失败：' + ((r as ESObject).message as string || '请重新识别后重试'));
        return;
      } catch (e) {
        toastLong('提交失败：' + ((e as ApiError).message || '请检查网络'));
        return;
      }
    }

    // ── 老路径兜底（predictionId=0：旧版 OCR / 识别失败）────
    let failed = 0;
    let lastErr = '';
    for (const r of picked) {
      try {
        await Api.createTransaction({
          account_id: (this.accounts[0] as ESObject)?.id || 0,
          category_id: r.categoryId,
          type: r.type,
          amount: r.amount,
          note: r.note || undefined,
          date: r.date,
          merchant: r.merchant || undefined
        });
        this.done++;
      } catch (e) {
        failed++;
        lastErr = (e as ApiError).message || '请检查网络';
      }
    }
    if (failed === 0) {
      toast('已入账 ' + this.done + ' 笔');
      router.back();
    } else if (this.done > 0) {
      toastLong('已入账 ' + this.done + ' 笔，' + failed + ' 笔失败：' + lastErr);
    } else {
      toastLong('入账失败：' + lastErr);
    }
  }

  /**
   * 识别有误时换腾讯 OCR 重新识别（POST /ai/ocr/retranscribe）。
   * 服务端强制走 tencent_ocr 引擎，结果与主链路结构一致，直接复用同一套映射。
   */
  async retranscribe(): Promise<void> {
    if (this.lastB64.length === 0) return;
    this.loading = true;
    try {
      const r = await Api.aiOcrRetranscribe(this.lastB64);
      const rd: ESObject = (r.data as ESObject) || {};
      const items: ESObject[] = ((rd['transactions'] as ESObject[]) || (rd['items'] as ESObject[]) || []);
      this.predictionId = (rd['prediction_id'] as number) || 0;
      this.rows = items.map((t: ESObject, i: number): ScanRow => ({
        picked: true,
        id: i,
        seq: i,
        merchant: (t['merchant'] as string) || (t['note'] as string) || (t['category']?.['name'] as string) || '消费',
        amount: (t['amount'] as number) || 0,
        type: (t['type'] as string) || 'expense',
        categoryId: this.categories.find((c: Category) => c.type === ((t['type'] as string) || 'expense'))?.id || (this.categories[0]?.id || 0),
        categoryName: ((t['category_name'] as string) || (t['category']?.['name'] as string) || ''),
        date: ((t['date'] as string) || '').slice(0, 10) || this.today(),
        note: (t['note'] as string) || ''
      }));
      toast('已用腾讯 OCR 重新识别');
    } catch (e) {
      toastLong('重识别失败：' + ((e as ApiError).message || '请检查网络'));
    } finally {
      this.loading = false;
    }
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: 'AI 智能记账' })
        Scroll() {
          Column({ space: 12 }) {
            if (!this.ocrConfigured) {
              Column({ space: 4 }) {
                Text('未配置 OCR 密钥').fontSize(14).fontColor(COLORS.danger)
                Text('请在服务端 AI 设置中配置 OCR（如 MiniMax/百度）后使用').fontSize(12).fontColor(COLORS.textSecondary)
              }.width('100%').padding(14).backgroundColor('#FDECEA').borderRadius(12)
            }
            Button(this.picking ? '选择图片中...' : '拍照 / 从相册选择').width('100%')
              .onClick(() => this.pickAndOcr())
            if (this.loading) { LoadingBox() }
            else if (this.rows.length > 0) {
              Row() {
                Text(`识别 ${this.rows.length} 笔，已勾选 ${this.rows.filter(r => r.picked).length} 笔`).fontSize(13).layoutWeight(1).fontColor(COLORS.textSecondary)
              }
              ForEach(this.rows, (r: ScanRow) => {
                Column({ space: 6 }) {
                  Row({ space: 10 }) {
                    Checkbox({ name: 'p' + r.id, group: 'scan' }).select(r.picked).onChange((v: boolean) => { r.picked = v; })
                    Column() {
                      Text(r.merchant).fontSize(15).fontColor(COLORS.textPrimary)
                      Text(r.date).fontSize(11).fontColor(COLORS.textSecondary)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    Text(`${r.type === 'income' ? '+' : '-'}${fmtMoney(r.amount)}`).fontSize(15).fontColor(r.type === 'income' ? COLORS.income : COLORS.expense)
                  }
                  Row({ space: 8 }) {
                    Text(r.type === 'income' ? '收入' : '支出').fontSize(12)
                      .onClick(() => r.type = r.type === 'income' ? 'expense' : 'income')
                    Text('选择分类').fontSize(12).fontColor(COLORS.brand)
                      .onClick(() => {/* 简化为切换首个分类 */ r.categoryId = this.categories.find(c => c.type === r.type)?.id || r.categoryId; })
                    TextInput({ placeholder: '金额', text: String(r.amount) }).type(InputType.Number)
                      .layoutWeight(1).onChange((v: string) => r.amount = Number(v) || 0)
                  }
                }.width('100%').padding(12).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
              }, (r: ScanRow) => r.id.toString())
              Button(`确认入账 ${this.rows.filter(r => r.picked).length} 笔`).width('100%')
                .onClick(() => this.confirm())
              if (this.lastB64.length > 0) {
                Button('🔄 识别有误？换腾讯 OCR 重试')
                  .width('100%').height(44).fontSize(14).fontColor(COLORS.brand)
                  .backgroundColor(COLORS.brandBg).borderRadius(12)
                  .onClick(() => this.retranscribe())
              }
            } else {
              EmptyState({ icon: '📷', text: '选择一张小票照片，自动识别记账' })
            }
            Blank().height(20)
          }.padding(12)
        }.layoutWeight(1)
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
