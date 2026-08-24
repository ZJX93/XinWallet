/**
 * 设置（对齐安卓 SettingsScreen.kt）：外观主题三态 + 服务器地址 + 关于/检查更新。
 */
import router from '@ohos.router';
import { Session } from '../common/store/Session';
import { normalizeBaseUrl } from '../common/config';
import { COLORS, applyTheme } from '../common/theme';
import { TopBar, RowItem, LoadingBox, BottomSheet, AppBackground } from '../common/components/Components';

function themeLabel(mode: string): string {
  if (mode === 'light') return '浅色';
  if (mode === 'dark') return '深色';
  return '跟随系统';
}

@Entry
@Component
struct Settings {
  @State themeMode: string = 'system';
  @State serverDisplay: string = '';
  @State showServer: boolean = false;
  @State newServer: string = '';
  @State version: string = '1.0.0';

  aboutToAppear(): void {
    this.themeMode = (AppStorage.get('themeMode') as string) || 'system';
    Session.getBaseUrl().then(u => { this.serverDisplay = (u || '').replace('/api/', ''); });
  }

  cycleTheme(): void {
    const order = ['light', 'dark', 'system'];
    const i = order.indexOf(this.themeMode);
    this.themeMode = order[(i + 1) % 3];
    AppStorage.setOrCreate('themeMode', this.themeMode);
    applyTheme();
  }

  async saveServer(): Promise<void> {
    if (!this.newServer) return;
    await Session.setBaseUrl(normalizeBaseUrl(this.newServer));
    this.serverDisplay = this.newServer.replace(/\/api\/?$/, '');
    this.showServer = false;
  }

  @Builder ServerSheet() {
    Column({ space: 12 }) {
      Text('服务器地址').fontSize(16).fontWeight(FontWeight.Bold)
      TextInput({ placeholder: 'https://host:18888', text: this.newServer }).onChange((v: string) => this.newServer = v)
      Button('保存').width('100%').onClick(() => this.saveServer())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showServer = false)
    }
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({ title: '设置' })
        Scroll() {
          Column({ space: 8 }) {
            RowItem({ icon: '🎨', title: '外观主题', value: themeLabel(this.themeMode), onItemClick: () => this.cycleTheme() })
            RowItem({ icon: '🌐', title: '服务器地址', value: this.serverDisplay || '未设置', onItemClick: () => { this.newServer = this.serverDisplay; this.showServer = true; } })
            RowItem({ icon: 'ℹ️', title: '关于我们', value: 'v' + this.version, onItemClick: () => {/* 双击检查更新：简化为展示版本 */ } })
            Blank().height(20)
          }.padding(12)
        }.layoutWeight(1)
        if (this.showServer) {
          BottomSheet({ show: this.showServer, maxHeight: '65%', onDismiss: () => { this.showServer = false; } }) {
            this.ServerSheet()
          }
        }
      }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
