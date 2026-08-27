/* ============================================
   日期提取器单元测试
   覆盖 v0.2 新增的「精确到秒」能力以及向后兼容的纯日期路径
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractDate, extractTime } = require('../server/modules/ai/extraction/date-extractor');

const REF = new Date('2026-08-28T10:00:00Z');

test('extractDate: 仅日期 YYYY-MM-DD 不带时间', () => {
    const r = extractDate('今天午餐花了30元', REF);
    assert.equal(r.hasTime, false);
    assert.match(r.value, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.source, 'relative_day');
});

test('extractDate: YYYY-MM-DD HH:mm:ss 输出精确到秒', () => {
    const r = extractDate('支付时间 2026-08-25 08:12:33 金额 638.4 元', REF);
    assert.equal(r.value, '2026-08-25 08:12:33');
    assert.equal(r.hasTime, true);
    assert.equal(r.source, 'full_with_seconds');
    assert.equal(r.time.second, 33);
});

test('extractDate: YYYY/MM/DD HH:mm 也输出（秒默认 0）', () => {
    const r = extractDate('订单时间 2026/08/25 09:30 金额 12.5', REF);
    assert.equal(r.value, '2026-08-25 09:30:00');
    assert.equal(r.hasTime, true);
});

test('extractDate: YYYYMMDD + 时间 一行紧凑格式', () => {
    const r = extractDate('20260825 14:05:08 餐饮 88.00', REF);
    assert.equal(r.value, '2026-08-25 14:05:08');
    assert.equal(r.source, 'compact_with_seconds');
});

test('extractDate: 中文年月日 + 中文时间', () => {
    const r = extractDate('2026年08月25日08时12分33秒 物业费 638.4', REF);
    assert.equal(r.value, '2026-08-25 08:12:33');
    assert.equal(r.hasTime, true);
});

test('extractDate: 中文时间「上午九点零五分」', () => {
    const r = extractDate('2026年8月25日 上午九点零五分 早餐', REF);
    assert.equal(r.value, '2026-08-25 09:05:00');
    assert.equal(r.hasTime, true);
});

test('extractDate: 相对日（昨天/前天）只回退到日', () => {
    const y = extractDate('昨天买咖啡 28', REF);
    assert.equal(y.value, '2026-08-27');
    assert.equal(y.hasTime, false);
    const q = extractDate('前天晚餐 80', REF);
    assert.equal(q.value, '2026-08-26');
});

test('extractDate: 「3天前」回退到日', () => {
    const r = extractDate('3天前买书 45', REF);
    assert.equal(r.value, '2026-08-25');
});

test('extractDate: 完全无法识别 → 默认今天（带秒级时间戳）', () => {
    // v0.3 升级：default_today 路径输出 YYYY-MM-DD HH:MM:SS，
    // 避免同日多笔交易日期完全相同导致下游排序/幂等键冲突。
    const r = extractDate('随便什么文本没有日期', REF);
    assert.match(r.value, /^2026-08-28 \d{2}:\d{2}:\d{2}$/);
    assert.equal(r.source, 'default_today_now');
    assert.equal(r.hasTime, true);
});

test('extractDate: 文本非字符串 → 默认今天（带秒级）', () => {
    const r = extractDate(null, REF);
    assert.match(r.value, /^2026-08-28 \d{2}:\d{2}:\d{2}$/);
    assert.equal(r.source, 'default_today_now');
});

test('extractTime: HH:mm:ss 命中并补零', () => {
    const t = extractTime('time 8:5:9 → 9:08:09 done');
    // 只取第一个命中；8:5:9 命中，hour=8 minute=5 second=9
    assert.equal(t.value, '08:05:09');
});

test('extractTime: 无时间 → null', () => {
    assert.equal(extractTime('no time here'), null);
});

test('extractTime: 中文「上午9点」', () => {
    const t = extractTime('上午9点05分');
    assert.equal(t.value, '09:05:00');
});

test('extractTime: 中文「晚上8点12分33秒」', () => {
    const t = extractTime('晚上8点12分33秒');
    assert.equal(t.value, '20:12:33');
});

test('extractDate: 小票典型格式（OCR 输出）— 时间精确到秒', () => {
    // 模拟 OCR：永升物业收据通常会带「交易时间 2026-08-25 08:12:33」
    const r = extractDate('永升物业管理处\n交易时间 2026-08-25 08:12:33\n金额 638.40', REF);
    assert.equal(r.value, '2026-08-25 08:12:33');
    assert.equal(r.hasTime, true);
});
