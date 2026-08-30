/**
 * 应用锁（对齐安卓 AppLockScreen.kt 设置视图）：启用开关 + 设置/修改 4 位 PIN（SHA256 存储）。
 * PIN 持久化在 Session 同名的 preferences 文件中（key: appLockEnabled / appLockPinHash）。
 * 注：全屏解锁覆盖层（mode=Unlock）可在 Main 外层叠加，本文件先提供设置能力。
 */
import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import dataPreferences from '@ohos.data.preferences';
import cryptoFramework from '@ohos.security.cryptoFramework';
import util from '@ohos.util';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, AppBackground } from '../common/components/Components';

async function sha256(s: string): Promise<string> {
  const encoder = new util.TextEncoder();
  const md = cryptoFramework.createMd('SHA256');
  await md.update({ data: encoder.encode(s) });
  const dg = await md.digest();
  return Array.from(dg.data).map((b: number) => b.toString(16).padStart(2, '0')).join('');
}

@Entry
@Component
struct AppLock {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State isEnabled: boolean = false;
  @State hasPin: boolean = false;
  @State showSet: boolean = false;
  @State step: number = 1;        // 1 输入 / 2 确认
  @State cur: string = '';
  @State tmp: string = '';
  @State err: string = '';
  private ctx: common.UIAbilityContext = getContext(this) as common.UIAbilityContext;

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    const prefs = await dataPreferences.getPreferences(this.ctx, 'xinwallet_session');
    this.isEnabled = (await prefs.get('appLockEnabled', false)) as boolean;
    const h = (await prefs.get('appLockPinHash', '')) as string;
    this.hasPin = !!h;
  }

  async put(key: string, val: Object): Promise<void> {
    const prefs = await dataPreferences.getPreferences(this.ctx, 'xinwallet_session');
    prefs.put(key, val);
    await prefs.flush();
  }

  async toggleEnable(v: boolean): Promise<void> {
    this.isEnabled = v;
    await this.put('appLockEnabled', v);
    if (v && !this.hasPin) this.openSet();
  }

  openSet(): void {
    this.step = 1; this.cur = ''; this.tmp = ''; this.err = ''; this.showSet = true;
  }

  onDigit(d: string): void {
    if (this.cur.length < 4) this.cur += d;
    if (this.cur.length === 4) {
      if (this.step === 1) {
        this.tmp = this.cur; this.cur = ''; this.step = 2;
      } else {
        if (this.tmp === this.cur) {
          sha256(this.cur).then(h => {
            this.put('appLockPinHash', h).then(() => {
              this.hasPin = true; this.showSet = false;
            });
          });
        } else {
          this.err = '两次输入不一致';
          this.cur = ''; this.tmp = ''; this.step = 1;
        }
      }
    }
  }

  onDel(): void { this.cur = this.cur.slice(0, -1); }
  onClear(): void { this.cur = ''; }

  @Builder PinDots() {
    Row({ space: 20 }) {
      ForEach([0, 1, 2, 3], (i: number) => {
        Column().width(16).height(16)
          .borderRadius(8)
          .backgroundColor(this.cur.length > i ? COLORS.brand : COLORS.divider)
      })
    }.margin({ top: 14, bottom: 14 })
  }

  @Builder KeyPad() {
    Column() {
      Column({ space: 20 }).width('86%') {
        ForEach([
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          ['清空', '0', '⌫']
        ], (row: string[]) => {
          Row({ space: 20 }).width('100%') {
            ForEach(row, (k: string) => {
              if (k === '⌫') {
                Column() {
                  Image($r('app.media.ic_backspace'))
                    .width(28)
                    .height(28)
                    .fillColor(COLORS.brand)
                }.width('100%').height(76).justifyContent(FlexAlign.Center)
                .backgroundColor(COLORS.brandBg)
                .borderRadius(999)
                .onClick(() => this.onDel())
              } else {
                Column() {
                  Text(k)
                    .fontSize(k === '清空' ? 20 : 32)
                    .fontColor(COLORS.brand)
                    .fontWeight(k === '清空' ? FontWeight.Normal : FontWeight.Bold)
                }.width('100%').height(76).justifyContent(FlexAlign.Center)
                .backgroundColor(k === '清空' ? COLORS.brandBg : COLORS.brandBgLight)
                .borderRadius(999)
                .onClick(() => {
                  if (k === '清空') this.onClear();
                  else this.onDigit(k);
                })
              }
            }, (k: string) => k)
          }.width('100%')
        }, (row: string[]) => row.join())
      }
    }.margin({ top: 24 }).width('100%')
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '应用锁', onBack: () => router.back() })
        if (this.showSet) {
          Column({ space: 8 }) {
            Text(this.step === 1 ? '设置 4 位 PIN' : '再次输入确认').fontSize(16).fontWeight(FontWeight.Bold)
            if (this.err) { Text(this.err).fontSize(13).fontColor(COLORS.danger) }
            this.PinDots()
            this.KeyPad()
          }.width('100%').padding(20).alignItems(HorizontalAlign.Center)
        } else {
          Column({ space: 0 }) {
            Row({ space: 12 }) {
              Text('启用应用锁').fontSize(15).layoutWeight(1).fontColor(COLORS.textPrimary)
              Toggle({ type: ToggleType.Switch, isOn: this.isEnabled })
                .onChange((v: boolean) => this.toggleEnable(v))
            }.width('100%').padding({ top: 16, bottom: 16, left: 16, right: 16 })
              .backgroundColor(COLORS.cardGlass).borderRadius(12)
              .border({ width: 0.5, color: COLORS.outlineVariant })
            if (this.hasPin) {
              Row({ space: 12 }) {
                Text('修改 PIN').fontSize(15).layoutWeight(1).fontColor(COLORS.textPrimary)
                Text('›').fontSize(20).fontColor(COLORS.placeholder)
              }.width('100%').padding({ top: 16, bottom: 16, left: 16, right: 16 })
                .backgroundColor(COLORS.cardGlass).borderRadius(12).margin({ top: 8 })
                .border({ width: 0.5, color: COLORS.outlineVariant })
                .onClick(() => this.openSet())
            }
          }.width('100%').padding(12)
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
