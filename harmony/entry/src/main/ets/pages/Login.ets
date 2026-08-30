import router from '@ohos.router';
import { Session } from '../common/store/Session';
import { CredentialStore } from '../common/store/Credential';
import { setBaseUrl } from '../common/http/Http';
import { normalizeBaseUrl } from '../common/config';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { AppBackground } from '../common/components/Components';

@Entry
@Component
struct Login {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State server: string = 'http://127.0.0.1:18888'; // 本地 mock 演示；真实服务器恢复后改回 xqb.kuaik.top:18888
  @State username: string = '';
  @State password: string = '';
  @State loading: boolean = false;
  @State error: string = '';
  @State allowDemo: boolean = true;
  /** 「记住密码」勾选态，初值由 aboutToAppear 从 CredentialStore 回填 */
  @State rememberPwd: boolean = false;

  async aboutToAppear(): Promise<void> {
    const _r = await Promise.all([Session.getBaseUrl(), Session.isLoggedIn()]);
    const savedUrl = _r[0];
    const loggedIn = _r[1];
    if (savedUrl) {
      this.server = savedUrl.replace(/\/api\/?$/, '');
      setBaseUrl(savedUrl);
    }
    if (loggedIn) {
      router.replacePath({ url: 'pages/Main' });
    }
    // 记住密码：勾选过则回填用户名+密码（密码由 HUKS 解密）
    this.rememberPwd = await CredentialStore.isRemember();
    if (this.rememberPwd) {
      const savedUser = await CredentialStore.getUsername();
      const savedPwd = await CredentialStore.getPassword();
      if (savedUser) {
        this.username = savedUser;
      }
      if (savedPwd) {
        this.password = savedPwd;
      }
    }
    // 未勾选记住密码时，退回只预填上次成功登录的用户名（密码交给系统密码管理器）
    if (!this.username) {
      this.username = await Session.getLastUsername();
    }
    // 查询服务端是否开启演示账号，未开启则隐藏「体验 Demo 账号」按钮
    try {
      const cfg = await Api.authConfig();
      if (cfg.success && cfg.data) {
        this.allowDemo = cfg.data.allowDemo;
      }
    } catch (_) {
      // 接口异常时保持默认（显示）
    }
  }

  async doLogin(demo: boolean): Promise<void> {
    this.error = '';
    if (!demo) {
      if (!this.server.trim()) {
        this.error = '请填写服务器地址';
        return;
      }
      if (!this.username.trim() || !this.password) {
        this.error = '请输入账号和密码';
        return;
      }
    }
    const normalized = normalizeBaseUrl(this.server);
    if (!normalized) {
      this.error = '服务器地址无效';
      return;
    }
    setBaseUrl(normalized);
    await Session.setBaseUrl(normalized);
    this.loading = true;
    try {
      const resp = demo
        ? await Api.demoLogin()
        : await Api.login({ username: this.username, password: this.password });
      if (resp.success && resp.data) {
        await Session.saveTokens(resp.data.token, resp.data.refreshToken);
        if (!demo) {
          await Session.saveLastUsername(this.username); // 记住用户名，供下次预填
          // ⛔ 凭据只在**登录成功后**保存 —— 密码错时保存会导致下次自动填错密码。
          //    未勾选则清，覆盖"上次勾了这次取消"的场景。
          if (this.rememberPwd) {
            await CredentialStore.save(this.username, this.password);
          } else {
            await CredentialStore.clear();
          }
        }
        router.replacePath({ url: 'pages/Main' });
      } else {
        this.error = resp.message ?? '登录失败';
      }
    } catch (e) {
      this.error = (e as ApiError).message ?? '网络错误，请检查服务器地址';
    } finally {
      this.loading = false;
    }
  }

  build() {
    Stack() {
      AppBackground()
      Column({ space: 14 }) {
        Image($r('app.media.logo'))
          .width(88)
          .height(88)
          .borderRadius(20)
          .margin({ top: 80, bottom: 4 })
        Text('鑫钱包')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor(COLORS.textPrimary)
        Text('个人财务管家')
          .fontSize(14)
          .fontColor($r('app.color.text_secondary'))
          .margin({ bottom: 16 })

        TextInput({ placeholder: '服务器地址，如 https://nas.com:18888', text: this.server })
          .onChange((v) => (this.server = v))
          .width('82%')
          .height(48)
          .backgroundColor(COLORS.card)
          .borderRadius(12)
          .padding({ left: 14, right: 14 })
        TextInput({ placeholder: '账号', text: this.username })
          .onChange((v) => (this.username = v))
          .enableAutoFill(true)
          .width('82%')
          .height(48)
          .backgroundColor(COLORS.card)
          .borderRadius(12)
          .padding({ left: 14, right: 14 })
        TextInput({ placeholder: '密码', text: this.password })
          .type(InputType.Password)
          .onChange((v) => (this.password = v))
          .enableAutoFill(true)
          .width('82%')
          .height(48)
          .backgroundColor(COLORS.card)
          .borderRadius(12)
          .padding({ left: 14, right: 14 })

        // 「记住密码」：与输入框同为 82% 宽、左对齐。整行可点（Row.onClick）比只点小方块好按。
        // ⛔ 取消勾选立刻 clear()，不能等下次登录 —— 用户点掉就该真删密文。
        Row() {
          Checkbox({ name: 'rememberPwd', group: 'loginOpts' })
            .select(this.rememberPwd)
            .selectedColor(COLORS.brand)
            .width(20)
            .height(20)
            .onChange((v: boolean) => {
              this.rememberPwd = v;
              if (!v) {
                CredentialStore.clear();
              }
            })
          Text('记住密码')
            .fontSize(14)
            .fontColor(COLORS.textPrimary)
            .margin({ left: 6 })
        }
        .width('82%')
        .justifyContent(FlexAlign.Start)
        .onClick(() => {
          this.rememberPwd = !this.rememberPwd;
          if (!this.rememberPwd) {
            CredentialStore.clear();
          }
        })

        if (this.error) {
          Text(this.error)
            .fontColor(Color.Red)
            .fontSize(13)
            .width('82%')
        }

        Button(this.loading ? '登录中...' : '登录')
          .width('82%')
          .height(48)
          .backgroundColor(COLORS.brand)
          .borderRadius(12)
          .enabled(!this.loading)
          .onClick(() => this.doLogin(false))
        if (this.allowDemo) {
          Button('体验 Demo 账号')
            .width('82%')
            .height(48)
            .backgroundColor(COLORS.brandBgLight)
            .fontColor(COLORS.brand)
            .borderRadius(12)
            .stateEffect(true)
            .onClick(() => this.doLogin(true))
        }
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
    }.width('100%').height('100%')
  }
}
