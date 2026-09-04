/* ============================================
   鑫钱包 · 独立登录/注册页逻辑
   ============================================ */

// 认证相关 key 统一由 auth-keys.js（window.XIN_AUTH_KEYS）提供单一来源，避免多端字面量分叉。
// 带兜底默认值：即使 auth-keys.js 未加载也不至于崩溃（极端降级）。
const KEYS = (typeof window !== 'undefined' && window.XIN_AUTH_KEYS) || {};
const TOKEN_KEY = KEYS.TOKEN_KEY || 'xin_token';
const REFRESH_TOKEN_KEY = KEYS.REFRESH_TOKEN_KEY || 'zhicai_refresh_token';
const USER_KEY = KEYS.USER_KEY || 'zhicai_user';

/* ============================================
   「记住密码」加密存储（WebCrypto AES-GCM）

   ⛔⛔ 安全设计要点，改之前必读 ⛔⛔
   1. **密码密文存 localStorage，密钥存 IndexedDB 且 extractable:false**。
      CryptoKey 以不可导出方式持久化，JS 代码（包括 XSS 注入的脚本）
      拿不到密钥字节，只能调 API 做加解密。这是浏览器端能做到的最强边界。
      ⛔ 绝不允许把密钥也塞 localStorage —— 那等于把锁和钥匙放同一个抽屉。
   2. **GCM 的 iv 每次加密都要新生成**，同密钥下 iv 重复会严重削弱 GCM。
      iv 不是秘密，跟密文一起存明文即可。
   3. WebCrypto 的 encrypt 已把 authTag 拼在密文尾部，**不需要像 HUKS 那样手工切**。
   4. 全部 API 都是异步的，且在非 HTTPS（且非 localhost）下 crypto.subtle 为
      undefined —— 所有函数必须容错降级为"不记住"，不能抛异常挡住登录。
   ============================================ */
const CRED_DB = 'xin_cred';
const CRED_STORE = 'keys';
const CRED_KEY_ID = 'pwd_key_v1';
const CRED_CIPHER_KEY = 'zhicai_pwd_cipher';   // base64 密文
const CRED_IV_KEY = 'zhicai_pwd_iv';           // base64 iv
const CRED_USER_KEY = 'zhicai_pwd_user';       // 配套用户名（明文，用户名不是秘密）
const CRED_REMEMBER_KEY = 'zhicai_remember_pwd';
const CRED_WEAK_FLAG = 'zhicai_pwd_weak';     // 标记：当前密文为弱混淆存储（非 AES-GCM）
const WEAK_KEY = [0x5a, 0x3c, 0x9f, 0x1b];   // 弱混淆盐（非加密，仅防明文裸奔，可被还原）

function credAvailable() {
    return typeof indexedDB !== 'undefined' && window.crypto && window.crypto.subtle;
}

function credOpenDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CRED_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CRED_STORE)) db.createObjectStore(CRED_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function credIdbGet(db, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CRED_STORE, 'readonly');
        const r = tx.objectStore(CRED_STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

function credIdbPut(db, key, val) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CRED_STORE, 'readwrite');
        const r = tx.objectStore(CRED_STORE).put(val, key);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
    });
}

function credIdbDel(db, key) {
    return new Promise((resolve) => {
        const tx = db.transaction(CRED_STORE, 'readwrite');
        const r = tx.objectStore(CRED_STORE).delete(key);
        r.onsuccess = () => resolve();
        r.onerror = () => resolve();   // 删不掉也不该阻断流程
    });
}

/** 取（或首次生成）不可导出的 AES-GCM 密钥 */
async function credGetKey(createIfMissing) {
    if (!credAvailable()) return null;
    try {
        const db = await credOpenDb();
        let key = await credIdbGet(db, CRED_KEY_ID);
        if (!key && createIfMissing) {
            // ⛔ extractable = false：生成后连我们自己的代码都导不出密钥字节
            key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            await credIdbPut(db, CRED_KEY_ID, key);
        }
        return key || null;
    } catch (e) {
        console.warn('[cred] 密钥获取失败，记住密码功能降级:', e);
        return null;
    }
}

function credB64Encode(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
}

function credB64Decode(str) {
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

// 弱混淆（非加密）：crypto.subtle 在非安全上下文（http:// 非 localhost）下不可用，
// 此时无法走 AES-GCM，退化为可被还原的简单 XOR+base64，仅防止密码以明文存储在 localStorage。
// ⚠️ 安全性远低于 AES-GCM，仅适用于本机/局域网 http 部署；生产环境请上 HTTPS。
function weakEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ^ WEAK_KEY[i % WEAK_KEY.length] ^ 0x37);
    return btoa(s);
}

function weakDecode(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) ^ WEAK_KEY[i % WEAK_KEY.length] ^ 0x37;
    return new TextDecoder().decode(out);
}

/** 保存密码（加密）。⛔ 只能在登录成功后调用，否则会存下错误密码 */
async function credSave(password, username) {
    if (!password) return;
    // 优先走 AES-GCM（需要 crypto.subtle，即 https 或 localhost）。
    if (credAvailable()) {
        const key = await credGetKey(true);
        if (key) {
            try {
                const iv = crypto.getRandomValues(new Uint8Array(12));   // GCM 标准 12 字节
                const data = new TextEncoder().encode(password);
                const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
                localStorage.setItem(CRED_CIPHER_KEY, credB64Encode(cipher));
                localStorage.setItem(CRED_IV_KEY, credB64Encode(iv));
                localStorage.setItem(CRED_REMEMBER_KEY, '1');
                localStorage.removeItem(CRED_WEAK_FLAG);   // 成功升级为强加密，清掉弱标记
                // 用户名跟着凭据一起存（明文即可，用户名不是秘密）。
                if (username) localStorage.setItem(CRED_USER_KEY, username);
                return;
            } catch (e) {
                console.warn('[cred] AES 加密失败，降级弱存储:', e);
            }
        }
    }
    // 降级：非安全上下文（http:// 局域网等）crypto.subtle 不可用，用轻量混淆存储。
    try {
        localStorage.setItem(CRED_CIPHER_KEY, weakEncode(password));
        localStorage.setItem(CRED_REMEMBER_KEY, '1');
        localStorage.setItem(CRED_WEAK_FLAG, '1');
        if (username) localStorage.setItem(CRED_USER_KEY, username);
    } catch (e) {
        console.warn('[cred] 弱存储失败，未保存密码:', e);
    }
}

/** 读回密码（解密）；失败一律返回空串让用户手动输 */
async function credLoad() {
    if (localStorage.getItem(CRED_REMEMBER_KEY) !== '1') return '';
    const cipherB64 = localStorage.getItem(CRED_CIPHER_KEY);
    if (!cipherB64) return '';
    // 弱存储分支（http 等非安全上下文）：直接弱解码
    if (localStorage.getItem(CRED_WEAK_FLAG) === '1') {
        try {
            return weakDecode(cipherB64);
        } catch (e) {
            console.warn('[cred] 弱解密失败:', e);
            return '';
        }
    }
    // AES-GCM 分支（https / localhost）
    const ivB64 = localStorage.getItem(CRED_IV_KEY);
    if (!ivB64) return '';
    const key = await credGetKey(false);
    if (!key) return '';
    try {
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: credB64Decode(ivB64) }, key, credB64Decode(cipherB64)
        );
        return new TextDecoder().decode(plain);
    } catch (e) {
        // 常见于清过 IndexedDB 但 localStorage 还在，或换了浏览器配置
        console.warn('[cred] 解密失败（密钥可能已失效）:', e);
        return '';
    }
}

/** 取消勾选时清除。⛔ 密文和密钥都要删，只删一边等于没删干净 */
async function credClear() {
    localStorage.removeItem(CRED_CIPHER_KEY);
    localStorage.removeItem(CRED_IV_KEY);
    localStorage.removeItem(CRED_USER_KEY);
    localStorage.removeItem(CRED_REMEMBER_KEY);
    localStorage.removeItem(CRED_WEAK_FLAG);
    if (!credAvailable()) return;
    try {
        const db = await credOpenDb();
        await credIdbDel(db, CRED_KEY_ID);
    } catch (_) { /* 密钥删不掉也无妨：密文已删，解不出任何东西 */ }
}

function setSession(token, refreshToken, user) {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // 记住用户名（与「记住密码」独立）：下次进入登录页预填
    if (user && user.username) localStorage.setItem('zhicai_last_user', user.username);
}

function setHint(msg, isError) {
    const el = document.getElementById('authHint');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'auth-hint' + (isError ? ' error' : '');
    // 错误提示升级为 role=alert 以便屏幕阅读器立刻播报
    el.setAttribute('role', isError ? 'alert' : 'status');
}

// 直接调用 utils.js 暴露的 window.api，避免任何命名冲突
function loginApi(path, method = 'GET', body = null) {
    return window.api(path, method, body, { silent: true });
}

function applyTheme() {
    const saved = localStorage.getItem('zhicai_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
}
applyTheme();

// 已登录直接进应用
if (localStorage.getItem(TOKEN_KEY)) {
    location.href = '/';
}

document.addEventListener('DOMContentLoaded', () => {
    const rememberBox = document.getElementById('authRemember');

    // 记住用户名 / 记住密码：未登录时回填
    if (!localStorage.getItem(TOKEN_KEY)) {
        const u = document.getElementById('authUser');
        // 优先用凭据里配套的用户名，退回 zhicai_last_user
        const credUser = localStorage.getItem(CRED_USER_KEY);
        const lastUser = credUser || localStorage.getItem('zhicai_last_user');
        if (lastUser && u) u.value = lastUser;
        // 勾选过记住密码则解密回填（异步，不阻塞页面渲染）
        if (localStorage.getItem(CRED_REMEMBER_KEY) === '1') {
            if (rememberBox) rememberBox.checked = true;
            credLoad().then((pwd) => {
                if (!pwd) return;
                const p = document.getElementById('authPass');
                if (p) p.value = pwd;
            });
        }
    }

    // ⛔ 取消勾选立刻清除，不能等下次登录 —— 用户点掉就该真删密文+密钥
    if (rememberBox) rememberBox.addEventListener('change', () => {
        if (!rememberBox.checked) credClear();
    });

    // 非安全上下文（http:// 非 localhost）下 crypto.subtle 不可用，记住密码降级为弱加密，给个提示
    if (rememberBox && !window.isSecureContext) {
        const row = rememberBox.closest('.remember-row');
        if (row) {
            const tip = document.createElement('small');
            tip.textContent = '（当前为 http，密码以弱加密保存）';
            tip.style.cssText = 'color:var(--text-muted,#888);font-size:11px;margin-left:6px;font-weight:normal;';
            row.appendChild(tip);
        }
    }

    const tabs = document.querySelectorAll('.auth-tab');
    const nickGroup = document.getElementById('authNickGroup');
    const submitBtn = document.getElementById('authSubmit');
    const demoBtn = document.getElementById('demoLoginBtn');
    let mode = 'login';

    // 根据服务端开关隐藏演示账号入口（未设置 ALLOW_DEMO=true 时隐藏）
    (async () => {
        try {
            const cfg = await loginApi('/auth/config', 'GET');
            if (cfg && cfg.allowDemo === false) {
                const demoHint = document.querySelector('.demo-hint');
                if (demoHint) demoHint.style.display = 'none';
            }
        } catch (_) { /* 接口异常时保持默认（显示） */ }
    })();

    tabs.forEach(t => t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        mode = t.dataset.tab;
        if (nickGroup) nickGroup.style.display = mode === 'register' ? 'block' : 'none';
        if (submitBtn) submitBtn.textContent = mode === 'login' ? '登 录' : '注 册';
        setHint('');
    }));

    const form = document.getElementById('authForm');
    if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('authUser').value.trim();
        const password = document.getElementById('authPass').value;
        const nickname = document.getElementById('authNick').value.trim();
        if (!username || !password) { setHint('请输入用户名和密码', true); return; }
        if (submitBtn) submitBtn.disabled = true;

        try {
            let data;
            if (mode === 'login') {
                data = await loginApi('/auth/login', 'POST', { username, password });
                setHint('登录成功，正在进入...');
            } else {
                data = await loginApi('/auth/register', 'POST', { username, password, nickname });
                setHint('注册成功，正在进入...');
            }
            setSession(data.token, data.refreshToken, data.user);
            // 记住密码：⛔ 必须在成功之后才保存，否则会把错密码存下来。
            //    未勾选则清（覆盖"上次勾了这次取消"）。await 保证跳转前写盘完成。
            if (rememberBox && rememberBox.checked) await credSave(password, username);
            else await credClear();
            location.href = '/';
        } catch (err) {
            console.error('[login] 失败:', err.message, err);
            setHint(err.message || '操作失败，请重试', true);
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    if (demoBtn) demoBtn.addEventListener('click', async () => {
        setHint('正在登录演示账号...');
        if (submitBtn) submitBtn.disabled = true;
        try {
            const data = await loginApi('/auth/demo', 'POST');
            setSession(data.token, data.refreshToken, data.user);
            // ⛔ 演示账号刻意不保存凭据：demo 的密码不是用户自己的，
            //    存了会在下次真实登录时填入一个不属于该用户的密码。
            location.href = '/';
        } catch (err) {
            setHint(err.message || '演示账号登录失败', true);
            if (submitBtn) submitBtn.disabled = false;
        }
    });
});
