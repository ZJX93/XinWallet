/**
 * AI 记账对话（对齐安卓 ChatScreen.kt）：
 * 空态介绍 + 对话列表（AI 内嵌交易卡片）+ 上下文 chips + 输入栏（麦克风/文本/图片/发送）。
 * 语音：鸿蒙原生 AudioCapturer 录音 → 后端 /ai/transcribe（Whisper）转写，根治 GMS 语音超时 Bug。
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
import { AppBackground } from '../common/components/Components';
import { startRecord, stopRecord } from '../common/audio';
import { TransactionItem } from '../common/models';

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
  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;
  private timer: number = 0;

  aboutToAppear(): void {
    this.messages = [{
      role: 'assistant',
      content: '你好，我是小鑫。你可以直接说「今天午饭花了28元」，或发一张小票截图，我来帮你记账～'
    }];
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
    const history: ChatMessage[] = this.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m: ChatMessage): ChatMessage => ({ role: m.role, content: m.content }));
    this.messages.push({ role: 'user', content: text || '[图片]' });
    this.input = '';
    const img = this.pendingImage;
    this.pendingImage = '';
    try {
      const r = await Api.chat({ message: text, history, imageBase64: img || undefined });
      if (r.success && r.data) {
        this.messages.push({ role: 'assistant', content: r.data.reply || '', txs: r.data.transactions || [] });
      }
    } catch (e) {
      this.messages.push({ role: 'assistant', content: '出错了：' + (e as ApiError).message });
    }
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
          .onClick(() => this.messages = [this.messages[0]])
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
