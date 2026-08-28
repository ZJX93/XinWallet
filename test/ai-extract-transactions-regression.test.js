/* ============================================
   extractTransactions 回归测试
   —— 保护 b1d04f6 / b4ef0b5 修复的「wm is not defined」回归
   —— 也覆盖 ctx.last_account_name → resolveAccount 透传路径
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const aiModule = require('../server/modules/ai');
const { parseTransactions } = aiModule;

/* ─────────── 保护修复 #1：wm is not defined ─────────── */

test('parseTransactions: 不会抛 ReferenceError（回归保护 b4ef0b5）', async () => {
    // b1d04f6 引入的 bug：extractTransactions 函数体内引用了未定义的 wm 变量，
    // 任何带 text 路径都会抛 ReferenceError，被 catch 兜成 500。
    // 修复后：改为从 ctx 解构的 last_account_name 局部变量。
    const dbStub = {
        query: async () => [],
        queryOne: async () => null,
    };
    let threwReferenceError = false;
    try {
        await parseTransactions(dbStub, {
            userId: 1,
            source: 'ocr',
            text: '物业维修 638.4元 永升物业樾溪臺',
            context: {
                channel: 'image',
                transcribe_source: 'tencent_ocr',
                account_id: null,
                last_account_name: '支付宝 花呗',
                platform: 'android',
            },
        });
    } catch (err) {
        if (err instanceof ReferenceError && /wm/.test(err.message)) {
            threwReferenceError = true;
        }
        // 其他错（如 DB 连接）也可接受，但 wm ReferenceError 必须为 false
        throw err;
    }
    assert.equal(threwReferenceError, false, 'extractTransactions 不应再抛 wm ReferenceError');
});

/* ─────────── 保护修复 #2：last_account_name 透传 ─────────── */

test('parseTransactions: last_account_name 透传到 evidence.account_match_details', async () => {
    const dbStub = {
        query: async () => [],
        queryOne: async () => null,
    };
    const r = await parseTransactions(dbStub, {
        userId: 1,
        source: 'ocr',
        text: '物业维修 638.4元',
        context: {
            channel: 'image',
            transcribe_source: 'tencent_ocr',
            account_id: null,
            last_account_name: '支付宝 花呗',
            platform: 'android',
        },
    });
    assert.ok(r.transactions.length >= 1, '应该抽到至少一笔');
    const txn = r.transactions[0];
    assert.ok(txn.evidence, 'candidate 应该有 evidence 字段');
    assert.equal(txn.evidence.account, 'fallback_default', 'evidence.account 应该是 fallback_default');
    assert.match(
        String(txn.account_match_details || ''),
        /上次使用.*支付宝 花呗/,
        'account_match_details 应含「上次使用：支付宝 花呗」'
    );
});
