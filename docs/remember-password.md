# 三端「记住密码」实现说明

登录页勾选「记住密码」后，**密码本体加密落盘**，下次打开登录页自动回填。
不是延长 refreshToken（那样密码框仍是空的，不符合用户对勾选框的直观预期）。

## 加密方案

三端机制不同，但对外行为完全一致。

| 端 | 加密机制 | 密钥保护级别 | 密文存放 | 实现文件 |
|---|---|---|---|---|
| 安卓 | `EncryptedSharedPreferences`（key `AES256_SIV` / value `AES256_GCM`） | 密钥托管于 **Android KeyStore**，可用 TEE/StrongBox 硬件保护 | 独立加密文件 `xin_wallet_credential` | `android/.../data/local/CredentialStore.kt` |
| 鸿蒙 | **HUKS** AES-256-GCM，手工 `initSession`/`finishSession` | 密钥**永不出安全环境**，仅通过 keyAlias 引用做加解密 | `preferences` 存 base64 的密文 + nonce + tag | `harmony/.../common/store/Credential.ts` |
| Web | **WebCrypto** AES-256-GCM | CryptoKey 以 `extractable: false` 持久化到 IndexedDB，**JS 拿不到密钥字节**（含 XSS 注入的脚本） | `localStorage` 存 base64 的密文 + iv | `public/js/login.js` |

依赖：安卓 `androidx.security:security-crypto:1.1.0-alpha06`（`app/build.gradle.kts`）；
鸿蒙 `@ohos.security.huks` + `@ohos.security.cryptoFramework`（系统 API，无需 ohpm 依赖）；Web 无依赖。

## 五条安全约定（三端必须一致，改任一端要同步核对另两端）

1. **只在登录成功后保存** —— 保存代码必须放在 `ApiResult.Success` / `resp.success` 分支内。
   放在方法开头会把**错误密码**存进去，下次自动填一个错的，用户完全不知道为什么登不上。
2. **取消勾选立刻 `clear()`**，不能等下次登录。用户点掉就该真删密文。
   Web 端要连 IndexedDB 里的密钥一起删 —— 只删一边不算删干净。
3. **未勾选也要 `clear()`** —— 覆盖「上次勾了这次取消」的场景。
4. **登出刻意不清凭据** —— 记住密码的意义就是登出后下次还能自动填。
   与 `LAST_USERNAME`「logout 不清」的既有约定一致。要清凭据只有两条路：登录页取消勾选，或直接调 `clear()`。
5. **演示账号不保存凭据** —— demo 的密码不属于用户本人，存了会在下次真实登录时填入不属于该用户的密码。

附加约定：

- **加密失败宁可功能失效，绝不落盘明文**（鸿蒙 `save()` 里 `if (!bundle) return;`）。
- **KeyStore / HUKS 异常只降级不崩溃**：安卓全部方法 `runCatching` 兜底、`prefs` 懒加载失败返回 `null`；
  鸿蒙解密失败静默返回空串（应用重装 / 换设备导致密钥失效是常态，不该弹错误吓人）。
- 与 `HashUtil.kt` 里「不存明文」的注释**不冲突** —— 那条针对**服务端**存储。
- ⚠️ 固有代价：即便加密，密码在本机仍可被本应用解密使用。这是「记住密码」功能本身的性质，非实现缺陷。

## 鸿蒙 HUKS 四条铁律

API 名与结构字段极易记错，写之前先 grep
`sdk/default/openharmony/ets/api/@ohos.security.huks.d.ts` 核实，不要凭记忆写。

1. **加密必须传 `HUKS_TAG_NONCE`；解密必须同时传 `NONCE` + `HUKS_TAG_AE_TAG`。**
   加密后 authTag 位于 `finishSession` 返回的 `outData` **尾部 16 字节**，必须手工 `subarray` 切出来单独存 ——
   HUKS 不像 WebCrypto 会自动把 tag 拼进密文。漏传 `AE_TAG` 解密**直接报错**，不是返回乱码。
   注意 `HUKS_TAG_AE_TAG` 与 `HUKS_TAG_AE_TAG_LEN` 是两个不同 tag。
2. **`HuksParam.value` 的类型必须与 tag 的 `HuksTagType` 前缀对应**：
   `HUKS_TAG_TYPE_UINT` → `number`，`HUKS_TAG_TYPE_BYTES` → `Uint8Array`。
   传错类型不一定编译报错，但运行期抛 401。
3. **`finishSession` 之后 handle 即失效**（本实现在 finish 成功后立刻把 `handle = -1`，防止 `finally` 误 abort）。
   任何异常路径都要 `abortSession` 释放，否则 HUKS 会话数有上限、泄漏几次后全部加解密失败。
   `isKeyItemExist` 在部分版本密钥不存在时会 reject 而非返回 `false` ⇒ 单独 try/catch 后继续走生成流程。
4. **nonce 必须用 `cryptoFramework.createRandom().generateRandomSync(12)`**，
   ⛔ **不能用 `Math.random()`** —— 那是可预测的 PRNG，同一密钥下 nonce 可预测/重复会严重削弱 GCM
   （攻击者可做 forbidden attack 恢复认证密钥）。项目 `AppLock.ets` 早已引入 cryptoFramework，无需新增依赖。
   拿不到安全随机源时返回 `null` 让调用方放弃保存，而不是退回弱随机。

密钥生成时 `HUKS_TAG_PURPOSE` 必须是 `ENCRYPT | DECRYPT` **按位或**，同一把密钥才能既加密又解密。
`KEY_ALIAS`（`xinwallet_pwd_key_v1`）一旦改动，旧密文全部无法解密（等于强制所有人重新勾选一次），别随意改。

## 鸿蒙 util 废弃 API

写编解码前先 grep d.ts 的 `@deprecated` 标记，不要沿用旧写法：

| 废弃 | since | 替代 |
|---|---|---|
| `TextEncoder.encodeInto(input)` | 9 | `util.TextEncoder.create('utf-8').encodeIntoUint8Array(plain, buf)` |
| `TextDecoder.decodeWithStream()` | 12 | `util.TextDecoder.create('utf-8').decodeToString(out)` |
| `new util.TextEncoder()` / `new util.TextDecoder('utf-8')` | — | 静态 `create()` |

`encodeIntoUint8Array` 需先按 UTF-8 最坏情况（每字符 4 字节）预分配 buffer，再按返回的 `info.written` 截断。
`new util.Base64Helper()` 构造式**未废弃**，`encodeToStringSync` / `decodeSync` 可继续用。

遗留待清：`harmony/.../pages/AppLock.ets:15` 仍在用 `new util.TextEncoder()` + `encode()`（只是编译告警）。

## Web 端两处细节

- **`.remember-row` 不能套 `.form-group`** —— 后者是 flex-column + gap，会把勾选框和文字拆成上下两行。
  用负 `margin-top` 抵掉 `.auth-form` 的 gap，让它贴近密码框、视觉上归属于密码字段。
- **凭据里配套存一份用户名**（明文即可，用户名不是秘密），与安卓/鸿蒙对齐 ——
  凭据自带用户名，不依赖 `zhicai_last_user` 是否被清过。
- ⛔ `login.html` 原本给 `login.css` / `login.js` **都没带 `?v=` 版本号**，本次首次加上。
  改这两个文件后必须 bump，否则浏览器一直吃缓存、表现为「代码改了没生效」。

## ⛔ Web 端已知限制：只在安全上下文生效（2026-08-24 裁定「不修」）

**这是浏览器安全模型的规定，不是代码缺陷。** `crypto.subtle` 仅在**安全上下文**下存在：

| 访问方式 | `isSecureContext` | `crypto.subtle` | 记住密码 |
|---|---|---|---|
| `https://域名` | true | 有 | ✅ 可用 |
| `http://localhost:18888` | true（浏览器白名单） | 有 | ✅ 可用 |
| `http://127.0.0.1:18888` | true（同上） | 有 | ✅ 可用 |
| **`http://192.168.x.x:18888`** | **false** | **undefined** | ❌ **静默失效** |

局域网 IP（手机/平板访问电脑后端）下 `credAvailable()` 返 `false` ⇒ `credGetKey()` 返 `null`
⇒ `credSave()` 直接 return。**勾了也白勾，且当前无任何提示。**

### 排障要点：认准这个表征，别去查登出逻辑

> **用户名保住了，但勾选框是空的**

因为用户名走的是普通 `localStorage`（`zhicai_last_user`，与加密无关），而
`zhicai_remember_pwd` 标志**从未被写入过**（`credSave` 提前 return 了）。

⛔ 这个表征极易误判成「登出时被清掉了」。已排除：`auth.js` 的 `clearSession()` 只删
`xin_token` / `xin_refresh` / `xin_user` / `xin_book`，**不碰任何 `zhicai_pwd_*` 键**；
`127.0.0.1` 下实测完整走过「勾选 → 登录 → 点登出 → 回登录页」，勾选框仍打勾、密码已回填。

### 若将来要修，两条路

1. **给本地后端上 HTTPS**（自签证书 + 手机装根证书）—— 一劳永逸，`crypto.subtle` 直接可用。
2. **降级加密路径**（纯 JS AES 或 XOR+盐）—— ⚠️ 强度远低于 WebCrypto，且密钥必须落在
   JS 可读处（IndexedDB 存不了不可导出 CryptoKey），XSS 即可解密。**若走这条，必须在
   UI 上明确告知用户"当前连接非加密，密码保护强度较低"**，不能静默降级。

**当前决定：不修。** 用 HTTPS 或 localhost 访问即正常工作。

## 验证记录（2026-08-24）

| 项 | 结果 |
|---|---|
| 安卓编译 | `BUILD SUCCESSFUL in 2m 9s` |
| 鸿蒙 HAP | `BUILD SUCCESSFUL in 11s 462ms`，产出 `entry-default-signed.hap` 6.7MB，`Credential.ts` 零 deprecated / 零 ESObject 告警 |
| Web 语法 | `node --check public/js/login.js` 通过；`login.css` 括号 30/30 平衡 |
| Web 加解密往返 | `roundTripOk: true`，`decrypted: "demo123456"`，`cipherLen: 36`、`ivLen: 16` |
| Web 明文泄露检查 | `plainTextLeakInLocalStorage: false`（遍历所有 localStorage key 查子串） |
| Web 密钥不可导出 | `keyExtractable: false` |
| Web 刷新回填 | `boxChecked: true`、`bothFilled: true`（用户名 demo + 密码 demo123456 均回填） |
| Web 取消勾选清除 | cipher / iv / user / flag 全为 `null`，`idbKey: "deleted"`，`credLoad()` 返回 `""` |

Web 端验证方法可复用：用 `crypto.subtle` 做一次加解密往返断言、遍历 `localStorage` 全量 key 查明文子串、
读 `CryptoKey.extractable` 断言为 `false`。三项都过才算真的没落明文。
