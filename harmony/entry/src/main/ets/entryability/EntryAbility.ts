import UIAbility from '@ohos.app.ability.UIAbility';
import type AbilityConstant from '@ohos.app.ability.AbilityConstant';
import type Want from '@ohos.app.ability.Want';
import ConfigurationConstant from '@ohos.app.ability.ConfigurationConstant';
import hilog from '@ohos.hilog';
import type window from '@ohos.window';
import dataPreferences from '@ohos.data.preferences';
import { Session } from '../common/store/Session';
import { CredentialStore } from '../common/store/Credential';
import { setBaseUrl } from '../common/http/Http';
import { applyTheme } from '../common/theme';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'EntryAbility', '%{public}s', 'Ability onCreate');
    Session.init(this.context);
    // 「记住密码」凭据库（HUKS 加密）也必须在此 init，否则 Login 页拿不到 context
    CredentialStore.init(this.context);
    // 底部 tab 索引初值：Main 用 @StorageLink 绑定，首页卡片「查看全部」靠改它切 tab，
    // 必须在此建键，否则首启时 StorageLink 拿不到值。
    AppStorage.setOrCreate('mainTabIndex', 0);
    // 启动时把已保存的 baseUrl 装载进 Http 层
    Session.getBaseUrl().then((url) => {
      if (url) {
        setBaseUrl(url);
      }
    });
    // 装载主题模式到 AppStorage（设置页可读写），默认 system
    dataPreferences.getPreferences(this.context, 'xinwallet_session').then(async (prefs) => {
      const mode = ((await prefs.get('themeMode', 'system')) as string) || 'system';
      AppStorage.setOrCreate('themeMode', mode);
    }).catch(() => { /* 读主题偏好失败就用默认 system，启动流程不能因此中断 */ });
    // 启动时按系统暗色初始化 isSystemDark 并应用主题
    this.syncSystemDark();
  }

  /** 读取系统 colorMode，写入 AppStorage.isSystemDark 并应用主题色板 */
  private syncSystemDark(): void {
    const dark = (this.context.config?.colorMode ?? 0) === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    AppStorage.setOrCreate('isSystemDark', dark);
    applyTheme();
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 入口固定为 Login，由 Login 页根据登录态决定是否跳 Main
    windowStage.loadContent('pages/Login', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'EntryAbility', 'loadContent failed: %{public}s', JSON.stringify(err));
      }
    });
  }
}
