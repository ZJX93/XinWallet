/**
 * 会话持久化：用 @ohos.data.preferences 保存 token / refreshToken / 当前账本 id / 服务器地址。
 * 在 EntryAbility.onCreate 调用 Session.init(context) 初始化。
 */
import dataPreferences from '@ohos.data.preferences';
import common from '@ohos.app.ability.common';
import { CredentialStore } from './Credential';

const PREF_NAME = 'xinwallet_session';

class SessionStore {
  private prefs: dataPreferences.Preferences | null = null;
  private context: common.Context | null = null;

  init(context: common.Context): void {
    this.context = context;
    // 异步加载，不阻塞
    dataPreferences.getPreferences(context, PREF_NAME)
      .then((prefs) => {
        this.prefs = prefs;
      })
      .catch((e) => {
        console.error('Session init failed: ' + JSON.stringify(e));
      });
  }

  private async getPrefs(): Promise<dataPreferences.Preferences | null> {
    if (this.prefs) {
      return this.prefs;
    }
    if (!this.context) {
      return null;
    }
    try {
      this.prefs = await dataPreferences.getPreferences(this.context, PREF_NAME);
      return this.prefs;
    } catch (e) {
      console.error('getPreferences failed: ' + JSON.stringify(e));
      return null;
    }
  }

  async getAccessToken(): Promise<string> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return '';
    }
    // P0-11：优先读加密 token
    const c = (await prefs.get('tokAccessCipher', '')) as string;
    if (c && c.length > 0) {
      const n = (await prefs.get('tokAccessNonce', '')) as string;
      const t = (await prefs.get('tokAccessTag', '')) as string;
      const plain = await CredentialStore.decryptSecret({ cipher: c, nonce: n, tag: t });
      if (plain && plain.length > 0) {
        return plain;
      }
    }
    // 迁移：旧版明文 token 仍在 preferences，读出来加密后落到密文键并清除明文
    const legacy = (await prefs.get('accessToken', '')) as string;
    if (legacy && legacy.length > 0) {
      const r = (await prefs.get('refreshToken', '')) as string;
      await this.saveTokens(legacy, r);
      return legacy;
    }
    return '';
  }

  async getRefreshToken(): Promise<string> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return '';
    }
    const c = (await prefs.get('tokRefreshCipher', '')) as string;
    if (c && c.length > 0) {
      const n = (await prefs.get('tokRefreshNonce', '')) as string;
      const t = (await prefs.get('tokRefreshTag', '')) as string;
      const plain = await CredentialStore.decryptSecret({ cipher: c, nonce: n, tag: t });
      if (plain && plain.length > 0) {
        return plain;
      }
    }
    const legacy = (await prefs.get('refreshToken', '')) as string;
    if (legacy && legacy.length > 0) {
      const a = (await prefs.get('accessToken', '')) as string;
      await this.saveTokens(a, legacy);
      return legacy;
    }
    return '';
  }

  async getCurrentBookId(): Promise<number> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('bookId', 0)) as number) : 0;
  }

  async getBaseUrl(): Promise<string> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('baseUrl', '')) as string) : '';
  }

  /** 记住最后成功登录用户名（登出不清除），供登录页预填 */
  async getLastUsername(): Promise<string> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('lastUsername', '')) as string) : '';
  }

  async saveLastUsername(username: string): Promise<void> {
    if (!username) {
      return;
    }
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('lastUsername', username);
    await prefs.flush();
  }

  /** 读取首页功能卡片开关（key 如 'card_today' / 'card_calendar'），缺省 true */
  async getCardVisible(key: string, def: boolean = true): Promise<boolean> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('home_' + key, def)) as boolean) : def;
  }

  /** 写入首页功能卡片开关 */
  async setCardVisible(key: string, visible: boolean): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('home_' + key, visible);
    await prefs.flush();
  }

  /** 读取首页卡片排列顺序（逗号分隔的 key 串，空串表示用注册表默认序） */
  async getCardOrder(): Promise<string> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('home_card_order', '')) as string) : '';
  }

  /** 写入首页卡片排列顺序 */
  async setCardOrder(order: string): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('home_card_order', order);
    await prefs.flush();
  }

  /** 暴露 AbilityContext（供文件下载/上传等需要 context 的 API 使用） */
  getContext(): common.Context | null {
    return this.context;
  }

  /** 当前 Ability 的缓存目录（导出文件临时存放） */
  getCacheDir(): string {
    const c = this.context as common.UIAbilityContext;
    return c && c.cacheDir ? c.cacheDir : '';
  }

  /**
   * 保存 token（P0-11 加固）：经 HUKS AES-256-GCM 加密后存 preferences，不再明文落盘。
   * 加密失败时**不回退明文**（宁可重启需重登，也不把 bearer token 明文留在磁盘）。
   */
  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    const aBundle = await CredentialStore.encryptSecret(accessToken);
    let rBundle: { cipher: string; nonce: string; tag: string } | null = null;
    if (refreshToken && refreshToken.length > 0) {
      rBundle = await CredentialStore.encryptSecret(refreshToken);
    }
    prefs.put('tokAccessCipher', aBundle ? aBundle.cipher : '');
    prefs.put('tokAccessNonce', aBundle ? aBundle.nonce : '');
    prefs.put('tokAccessTag', aBundle ? aBundle.tag : '');
    prefs.put('tokRefreshCipher', rBundle ? rBundle.cipher : '');
    prefs.put('tokRefreshNonce', rBundle ? rBundle.nonce : '');
    prefs.put('tokRefreshTag', rBundle ? rBundle.tag : '');
    // 清掉可能残留的旧明文 token，避免双重存储
    prefs.put('accessToken', '');
    prefs.put('refreshToken', '');
    await prefs.flush();
  }

  async setCurrentBookId(bookId: number): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('bookId', bookId);
    await prefs.flush();
  }

  async setBaseUrl(baseUrl: string): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('baseUrl', baseUrl);
    await prefs.flush();
  }

  async isLoggedIn(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token.length > 0;
  }

  async clear(): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    // 清密文 token 与明文 token（双保险）
    prefs.put('tokAccessCipher', '');
    prefs.put('tokAccessNonce', '');
    prefs.put('tokAccessTag', '');
    prefs.put('tokRefreshCipher', '');
    prefs.put('tokRefreshNonce', '');
    prefs.put('tokRefreshTag', '');
    prefs.put('accessToken', '');
    prefs.put('refreshToken', '');
    prefs.put('bookId', 0);
    await prefs.flush();
  }
}

export const Session = new SessionStore();
