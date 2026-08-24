/**
 * 「记住密码」凭据存储（鸿蒙端）。
 *
 * 密码用 HUKS（@ohos.security.huks，华为通用密钥库）做 AES-256-GCM 加密后，
 * 密文以 base64 存进 preferences；**密钥本体永不出安全环境**，只能通过
 * keyAlias 引用做加解密操作 —— 这是与"自己写个异或/base64 混淆"的本质区别。
 *
 * ⛔⛔ 改这个文件前必读的三条 HUKS 铁律 ⛔⛔
 * 1. **GCM 加密必须传 NONCE，解密必须同时传 NONCE + AE_TAG**。
 *    加密后 authTag 从 finishSession 的 outData **尾部 16 字节**取，
 *    HUKS 不像 Web Crypto 会自动把 tag 拼进密文让你无脑传回去。
 *    漏传 AE_TAG 解密会直接报错（不是返回乱码），别以为是密钥坏了。
 * 2. **HuksParam.value 的类型必须与 tag 的 HuksTagType 前缀对应**：
 *    HUKS_TAG_TYPE_UINT → number，HUKS_TAG_TYPE_BYTES → Uint8Array。
 *    传错类型不一定编译报错，但运行期抛 401 参数错误。
 * 3. **finishSession 之后 handle 即失效**，任何异常路径都要 abortSession
 *    释放会话，否则 HUKS 会话数有上限、泄漏几次后后续加解密全失败。
 *
 * ⚠️ ArkTS 限制：不能用 any、不能用对象字面量当类型（要显式 interface），
 *    catch 里 e 是 unknown，要 as BusinessError 或转字符串。
 */
import huks from '@ohos.security.huks';
import cryptoFramework from '@ohos.security.cryptoFramework';
import dataPreferences from '@ohos.data.preferences';
import util from '@ohos.util';
import common from '@ohos.app.ability.common';

const PREF_NAME = 'xinwallet_credential';
// keyAlias 一旦改动，旧密文全部无法解密（等于强制所有人重新勾选一次），别随意改
const KEY_ALIAS = 'xinwallet_pwd_key_v1';
const NONCE_LEN = 12;   // GCM 标准 nonce 长度
const TAG_LEN = 16;     // GCM authTag 长度

/** 加密结果：密文 + nonce + authTag，三者缺一不可解密 */
interface CipherBundle {
  cipher: string;  // base64
  nonce: string;   // base64
  tag: string;     // base64
}

class CredentialStoreImpl {
  private prefs: dataPreferences.Preferences | null = null;
  private context: common.Context | null = null;

  init(context: common.Context): void {
    this.context = context;
    dataPreferences.getPreferences(context, PREF_NAME)
      .then((p: dataPreferences.Preferences) => { this.prefs = p; })
      .catch((e: Error) => { console.error('Credential init failed: ' + JSON.stringify(e)); });
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
      console.error('Credential getPreferences failed: ' + JSON.stringify(e));
      return null;
    }
  }

  // ── HUKS 密钥管理 ──────────────────────────────────────────────

  /** 生成 AES-256-GCM 密钥（幂等：已存在则跳过） */
  private async ensureKey(): Promise<boolean> {
    try {
      const emptyOpt: huks.HuksOptions = { properties: [] };
      const exist = await huks.isKeyItemExist(KEY_ALIAS, emptyOpt);
      if (exist) {
        return true;
      }
    } catch (e) {
      // isKeyItemExist 在密钥不存在时部分版本会 reject 而非返回 false，继续走生成
      console.info('isKeyItemExist threw, will generate: ' + JSON.stringify(e));
    }
    try {
      const genProps: huks.HuksParam[] = [
        { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
        { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
        // 同一把密钥要同时能加、能解，purpose 必须按位或
        {
          tag: huks.HuksTag.HUKS_TAG_PURPOSE,
          value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT | huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT
        },
        { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
        { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
        { tag: huks.HuksTag.HUKS_TAG_DIGEST, value: huks.HuksKeyDigest.HUKS_DIGEST_NONE }
      ];
      await huks.generateKeyItem(KEY_ALIAS, { properties: genProps });
      return true;
    } catch (e) {
      console.error('generateKeyItem failed: ' + JSON.stringify(e));
      return false;
    }
  }

  /**
   * 生成 12 字节 GCM nonce。
   * ⛔ 必须用 cryptoFramework.createRandom()（密码学安全随机源），**不能用 Math.random()** ——
   *    Math.random 是可预测的 PRNG，同一密钥下 nonce 可预测/重复会严重削弱 GCM
   *    （攻击者可做 forbidden attack 恢复认证密钥）。
   * 真随机不可用时返回 null，让调用方放弃保存，而不是退回弱随机。
   */
  private genNonce(): Uint8Array | null {
    try {
      const rand = cryptoFramework.createRandom();
      const blob = rand.generateRandomSync(NONCE_LEN);
      if (blob && blob.data && blob.data.length === NONCE_LEN) {
        return blob.data;
      }
      return null;
    } catch (e) {
      console.error('generateRandomSync failed: ' + JSON.stringify(e));
      return null;
    }
  }

  /** GCM 加密：返回 密文 / nonce / authTag 三段 base64 */
  private async encrypt(plain: string): Promise<CipherBundle | null> {
    const ok = await this.ensureKey();
    if (!ok) {
      return null;
    }
    const nonce = this.genNonce();
    if (!nonce) {
      // 拿不到安全随机就不加密 —— 宁可功能失效，不用弱 nonce
      return null;
    }
    const props: huks.HuksParam[] = [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
      { tag: huks.HuksTag.HUKS_TAG_DIGEST, value: huks.HuksKeyDigest.HUKS_DIGEST_NONE },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce }
    ];
    let handle = -1;
    try {
      // ⚠️ 用 encodeIntoUint8Array 而非 encodeInto(input) —— 后者 since 9 已 deprecated。
      //    需先按 UTF-8 最坏情况（每字符 4 字节）预分配，再按 written 截断。
      const textEncoder = util.TextEncoder.create('utf-8');
      const buf = new Uint8Array(plain.length * 4);
      const info = textEncoder.encodeIntoUint8Array(plain, buf);
      const inData = buf.subarray(0, info.written);
      const session = await huks.initSession(KEY_ALIAS, { properties: props });
      handle = session.handle;
      const res = await huks.finishSession(handle, { properties: props, inData: inData });
      handle = -1; // finish 成功后 handle 已失效，避免 finally 里误 abort
      const out = res.outData;
      if (!out || out.length <= TAG_LEN) {
        return null;
      }
      // ⛔ GCM 的 authTag 在 outData 尾部 16 字节，必须切出来单独存
      const cipherBytes = out.subarray(0, out.length - TAG_LEN);
      const tagBytes = out.subarray(out.length - TAG_LEN);
      const b64 = new util.Base64Helper();
      const bundle: CipherBundle = {
        cipher: b64.encodeToStringSync(cipherBytes),
        nonce: b64.encodeToStringSync(nonce),
        tag: b64.encodeToStringSync(tagBytes)
      };
      return bundle;
    } catch (e) {
      console.error('encrypt failed: ' + JSON.stringify(e));
      return null;
    } finally {
      if (handle >= 0) {
        try {
          await huks.abortSession(handle, { properties: props });
        } catch (_) { /* abort 失败无补救手段，忽略 */ }
      }
    }
  }

  /** GCM 解密：nonce 与 authTag 都必须与加密时一致 */
  private async decrypt(bundle: CipherBundle): Promise<string> {
    const b64 = new util.Base64Helper();
    let nonce: Uint8Array;
    let cipherBytes: Uint8Array;
    let tagBytes: Uint8Array;
    try {
      nonce = b64.decodeSync(bundle.nonce);
      cipherBytes = b64.decodeSync(bundle.cipher);
      tagBytes = b64.decodeSync(bundle.tag);
    } catch (e) {
      console.error('base64 decode failed: ' + JSON.stringify(e));
      return '';
    }
    const props: huks.HuksParam[] = [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT },
      { tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE },
      { tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM },
      { tag: huks.HuksTag.HUKS_TAG_DIGEST, value: huks.HuksKeyDigest.HUKS_DIGEST_NONE },
      { tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce },
      // ⛔ 解密独有：必须回传 authTag，否则 GCM 无法校验完整性、直接失败
      { tag: huks.HuksTag.HUKS_TAG_AE_TAG, value: tagBytes }
    ];
    let handle = -1;
    try {
      const session = await huks.initSession(KEY_ALIAS, { properties: props });
      handle = session.handle;
      const res = await huks.finishSession(handle, { properties: props, inData: cipherBytes });
      handle = -1;
      const out = res.outData;
      if (!out) {
        return '';
      }
      // ⚠️ decodeToString 而非 decodeWithStream（后者 since 12 已 deprecated）
      return util.TextDecoder.create('utf-8').decodeToString(out);
    } catch (e) {
      // 解密失败最常见原因：应用被重装 / 迁移设备导致 HUKS 密钥已失效。
      // 此时静默返回空串让用户手动输密码即可，不要弹错误吓人。
      console.error('decrypt failed (key may be invalidated): ' + JSON.stringify(e));
      return '';
    } finally {
      if (handle >= 0) {
        try {
          await huks.abortSession(handle, { properties: props });
        } catch (_) { /* ignore */ }
      }
    }
  }

  // ── 对外 API ──────────────────────────────────────────────────

  /** 是否勾选了「记住密码」 */
  async isRemember(): Promise<boolean> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('remember', false)) as boolean) : false;
  }

  /** 已保存的用户名（仅勾选记住密码时有值） */
  async getUsername(): Promise<string> {
    const prefs = await this.getPrefs();
    return prefs ? ((await prefs.get('username', '')) as string) : '';
  }

  /** 已保存的密码（解密）；未勾选/密钥失效时返回空串 */
  async getPassword(): Promise<string> {
    const remember = await this.isRemember();
    if (!remember) {
      return '';
    }
    const prefs = await this.getPrefs();
    if (!prefs) {
      return '';
    }
    const cipher = (await prefs.get('pwdCipher', '')) as string;
    const nonce = (await prefs.get('pwdNonce', '')) as string;
    const tag = (await prefs.get('pwdTag', '')) as string;
    if (!cipher || !nonce || !tag) {
      return '';
    }
    const bundle: CipherBundle = { cipher: cipher, nonce: nonce, tag: tag };
    return await this.decrypt(bundle);
  }

  /**
   * 登录成功后保存凭据。
   * ⛔ 只能在**登录成功后**调用 —— 密码错误时保存会导致下次自动填错密码。
   */
  async save(username: string, password: string): Promise<void> {
    if (!username || !password) {
      return;
    }
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    const bundle = await this.encrypt(password);
    if (!bundle) {
      // 加密失败就不要落盘明文，宁可功能失效
      console.error('save credential aborted: encrypt failed');
      return;
    }
    prefs.put('remember', true);
    prefs.put('username', username);
    prefs.put('pwdCipher', bundle.cipher);
    prefs.put('pwdNonce', bundle.nonce);
    prefs.put('pwdTag', bundle.tag);
    await prefs.flush();
  }

  /** 取消勾选时清除。⛔ 必须真删密文，不能只把 remember 置 false */
  async clear(): Promise<void> {
    const prefs = await this.getPrefs();
    if (!prefs) {
      return;
    }
    prefs.put('remember', false);
    prefs.put('username', '');
    prefs.put('pwdCipher', '');
    prefs.put('pwdNonce', '');
    prefs.put('pwdTag', '');
    await prefs.flush();
  }
}

export const CredentialStore = new CredentialStoreImpl();
