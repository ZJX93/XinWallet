/* ============================================
   鑫钱包 · 敏感数据加密模块
   使用 AES-256-GCM 对 API Key / Secret 进行加密存储。
   密钥优先级（从高到低）：
     1) 环境变量 ENCRYPTION_KEY（运维显式设置，最稳）
     2) /app/data/.encryption-key（容器启动时从数据卷读取，跨重启稳定）
     3) 首次启动自动生成并写入数据卷（最方便）
   这样：
     - docker-compose up -d → 密钥保持稳定（数据可解密）
     - docker-compose down -v → 数据+密钥一起清除（安全）
   ============================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH;

// 短密钥派生：使用 PBKDF2 替代单次 SHA256（密钥强化 + 抵御暴力）
const PBKDF2_SALT = Buffer.from('xin-wallet-v1-encryption-key', 'utf8');
const PBKDF2_ITERATIONS = 100000;

// 密钥持久化路径：放在数据卷内（/app/data/）
// 第一次启动生成并写入，后续启动读取——保证容器重启后密钥稳定
const KEY_FILE = process.env.ENCRYPTION_KEY_FILE || '/app/data/.encryption-key';

function readKeyFile() {
    try {
        return fs.readFileSync(KEY_FILE, 'utf8').trim();
    } catch {
        return null;
    }
}

function writeKeyFile(keyHex) {
    try {
        const dir = path.dirname(KEY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(KEY_FILE, keyHex, { mode: 0o600 }); // 仅 owner 可读
    } catch (err) {
        logger.warn(`⚠️ 无法写入加密密钥文件 ${KEY_FILE}: ${err.message}`);
    }
}

function getKey() {
    // 优先级 1：环境变量（非空字符串）
    let keyHex = process.env.ENCRYPTION_KEY;
    if (keyHex && keyHex.trim()) {
        return deriveKey(keyHex.trim());
    }
    // 优先级 2：从数据卷读取
    keyHex = readKeyFile();
    if (keyHex) {
        if (process.env.NODE_ENV !== 'production') {
            logger.info('🔐 从数据卷读取 ENCRYPTION_KEY');
        }
        return deriveKey(keyHex);
    }
    // 优先级 3：首次启动自动生成 + 持久化（仅非生产环境）
    // 生产环境严禁自动生成密钥，更禁止把密钥明文写进日志——任何可读日志/标准输出者
    // 即可解密全部已存的 AI/OCR 凭证。必须通过 ENCRYPTION_KEY 环境变量或数据卷密钥文件
    // 显式提供；缺失即拒绝启动（参考 auth.js 对 JWT_SECRET 的硬失败做法）。
    if (process.env.NODE_ENV === 'production') {
        logger.error('❌ 生产环境未提供 ENCRYPTION_KEY 且数据卷无可读密钥文件，拒绝以临时密钥启动'
            + '（避免密钥泄露与既有凭证不可解密）。请显式设置 ENCRYPTION_KEY 环境变量或挂载密钥文件后重启。');
        process.exit(1);
    }
    keyHex = crypto.randomBytes(32).toString('hex');
    writeKeyFile(keyHex);
    logger.warn('🔐 首次启动自动生成 ENCRYPTION_KEY（已写入 ' + KEY_FILE + '）');
    logger.warn('   后续容器重启将自动使用此密钥');
    return deriveKey(keyHex);
}

function deriveKey(keyHex) {
    // 64 hex 字符：直接作为 32 字节密钥使用
    if (keyHex.length === 64 && /^[0-9a-fA-F]+$/.test(keyHex)) {
        return Buffer.from(keyHex, 'hex');
    }
    // 短字符串：使用 PBKDF2 派生 32 字节密钥（防暴力破解）
    return crypto.pbkdf2Sync(keyHex, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha256');
}

const KEY = getKey();

/**
 * 加密明文，返回 hex 编码的密文（格式：IV[16] + TAG[16] + CIPHERTEXT）
 */
function encrypt(plaintext) {
    if (!plaintext) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // 格式: iv + tag + ciphertext (全部 hex)
    return iv.toString('hex') + tag.toString('hex') + encrypted;
}

/**
 * 解密密文，返回原始明文。
 *
 * 返回值语义（2026-07-29 安全修复）：
 *   - null  ：输入为空 / 真实解密失败（tag 校验未通过：密钥不匹配、数据损坏）
 *   - str   ：成功解密的明文；或在过渡期内、长度异常（疑似旧版明文存储）的原值
 *
 * 旧版本会"静默回退"——解密失败时返回 ciphertext 原文，导致 API Key
 * 等敏感字段变成被误用的"伪值"。本次拆分为两种语义：
 *   1. 长度不足 → 视为旧版明文，输出警告日志后过渡期返回原值（一次性迁移机会）
 *   2. tag 不通过 → 严格返回 null，强制调用方处理
 *
 * 调用方应当把 decrypt 结果视为"不可信的明文候选"，使用 tryDecrypt() 辅助函数
 * 区分 success / failure（routes/_helpers.js 已封装）。
 */
function decrypt(ciphertext) {
    if (!ciphertext) return null;
    const buf = Buffer.from(ciphertext, 'hex');
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
        // 安全加固：长度不足既非合法密文，也严禁当作明文原样返回（避免明文密钥/凭证泄露）。
        // 严格返回 null，由调用方按解密失败处理（需用户在「AI/OCR 配置」页重新保存凭证）。
        logger.warn(`[crypto] 数据长度异常（非合法密文），拒绝回退为明文：prefix=${ciphertext.slice(0, 6)}...`);
        return null;
    }
    try {
        const iv = buf.subarray(0, IV_LENGTH);
        const tag = buf.subarray(IV_LENGTH, TAG_POSITION + TAG_LENGTH);
        const encrypted = buf.subarray(TAG_POSITION + TAG_LENGTH);
        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        // tag 校验失败 = 密钥变更或数据已损坏。明确返回 null，不再静默回退。
        logger.error('[crypto] 解密失败（tag 校验未通过）：', err.message, `prefix=${ciphertext.slice(0, 6)}...`);
        return null;
    }
}

module.exports = { encrypt, decrypt };