/* ============================================
   交易拆分器单元测试
   覆盖 v0.3 新增的「系统噪音段过滤」能力
   —— 解决「支付宝账单截图里 K/s-76.3 K/s 这种流量信息被误拆成第二笔」
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    splitTransactions,
    looksLikeTxn,
    hasStandaloneTxnSemantics,
    isSystemNoiseSegment,
} = require('../server/modules/ai/extraction/transaction-splitter');

/* ─────────── isSystemNoiseSegment ─────────── */

test('isSystemNoiseSegment: K/s 网速单位是噪音', () => {
    assert.equal(isSystemNoiseSegment('K/s-76.3 K/s'), true);
});

test('isSystemNoiseSegment: KB/s 网速单位是噪音', () => {
    assert.equal(isSystemNoiseSegment('上行 KB/s 12.5'), true);
});

test('isSystemNoiseSegment: 流量描述是噪音', () => {
    assert.equal(isSystemNoiseSegment('本月流量 30G 剩余 5G'), true);
});

test('isSystemNoiseSegment: 网速描述是噪音', () => {
    assert.equal(isSystemNoiseSegment('实时网速 2.3 MB/s'), true);
});

test('isSystemNoiseSegment: 普通交易文本不是噪音', () => {
    assert.equal(isSystemNoiseSegment('物业维修 638.4元'), false);
    assert.equal(isSystemNoiseSegment('午餐 25'), false);
    assert.equal(isSystemNoiseSegment('早餐咖啡 18.5元'), false);
});

test('isSystemNoiseSegment: 空字符串不是噪音', () => {
    assert.equal(isSystemNoiseSegment(''), false);
    assert.equal(isSystemNoiseSegment(null), false);
});

/* ─────────── hasStandaloneTxnSemantics（回归保护） ─────────── */

test('hasStandaloneTxnSemantics: 中午+数字 → 有独立语义', () => {
    assert.equal(hasStandaloneTxnSemantics('午饭25'), true);
});

test('hasStandaloneTxnSemantics: 纯数字无中文 → 不算独立一笔', () => {
    assert.equal(hasStandaloneTxnSemantics('25元'), false);
});

/* ─────────── splitTransactions: 多笔拆分 ─────────── */

test('splitTransactions: 用户截图里的真实场景 — K/s 噪音段应被剔除，只剩物业维修', () => {
    // 用户截图还原：支付宝账单页同时显示了「K/s-76.3 K/s」网络状态和
    // 「物业维修 638.4元」两个有金额的段。期望：噪音段被剔除，只剩真交易。
    const text = 'K/s-76.3 K/s 物业维修 638.4元 永升物业樾溪臺';
    const r = splitTransactions(text);
    assert.equal(r.segments.length, 1, 'K/s 噪音段必须被剔除，只剩一笔');
    assert.match(r.segments[0], /物业维修/);
    assert.match(r.segments[0], /638/);
});

test('splitTransactions: 两笔正常交易都保留', () => {
    const text = '午饭25元 咖啡12元';
    const r = splitTransactions(text);
    assert.equal(r.segments.length, 2);
    assert.match(r.segments[0], /午饭/);
    assert.match(r.segments[1], /咖啡/);
});

test('splitTransactions: 第一个 anchor 段含 K/s → 该段被剔除，剩下 1 段', () => {
    // 用户的截图里，「K/s-76.3 K/s 物业维修 638.4元」是一段连续的文本。
    // amount_anchor 二次切分时，会把整段从 K/s 到 638.4 元 当成"含噪音"段剔除。
    // 这正是用户报告的"一张账单被识别成两个"修复点。
    const text = 'K/s-76.3 K/s 物业维修 638.4元 午餐25元';
    const r = splitTransactions(text);
    assert.equal(r.segments.length, 1, 'K/s 段 + 物业维修段都被剔除，只剩午餐');
    assert.match(r.segments[0], /午餐/);
});

test('splitTransactions: 单笔交易原文不变', () => {
    const text = '物业维修 638.4元';
    const r = splitTransactions(text);
    assert.equal(r.segments.length, 1);
    assert.match(r.segments[0], /物业维修/);
});

test('splitTransactions: 换行/分号分隔的多段，噪音段被剔除', () => {
    // 用户截图 OCR 转录文本里常见「K/s 流量状态」+「真消费」混在一起：
    //   63元 K/s-76.3 K/s
    //   638.4元 物业维修-永升物业樾溪臺
    // 期望：hard_separator 拆分后，K/s 段被噪音过滤剔除，只剩物业维修这一笔。
    const text = '63元 K/s-76.3 K/s\n638.4元 物业维修-永升物业樾溪臺';
    const r = splitTransactions(text);
    assert.equal(r.segments.length, 1, 'K/s 噪音段被剔除，只剩物业维修');
    assert.match(r.segments[0], /物业维修/);
    assert.match(r.segments[0], /638/);
});

/* ─────────── looksLikeTxn ─────────── */

test('looksLikeTxn: 含金额 → 是交易', () => {
    assert.equal(looksLikeTxn('物业维修 638.4元'), true);
});

test('looksLikeTxn: 无金额 → 不是交易', () => {
    assert.equal(looksLikeTxn('今天天气不错'), false);
});
