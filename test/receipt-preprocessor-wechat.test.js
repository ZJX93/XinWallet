/* ============================================
   票据版式预处理器：微信支付【单笔详情页】回归
   ------------------------------------------------
   2026-09-07 用户截图实测缺陷：9 元的馄饨被记成「主页 9元」，
   且下游给了 98% 置信度 —— 错了却显得很确定，用户看高置信度直接确认入账，
   比留空危险得多。

   根因：微信「交易详情」页没有「支付金额」标签字（只有大字独立负数行
        "-9.00" + 下方一句「扫二维码付款·给福建千里香馄饨」），
        ⇒ 策略1（同行「支付金额 ¥X」）、策略1b（「支付金额」竖排标签）双双落空，
        ⇒ 只剩策略5（为「账单列表」设计）从金额行向上【猜】第一个非噪声行，
           而「主页」「交易服务」这些 UI 行当时不在噪声表里（旧 UI_NOISE 只认
           英文 Home / 中文「首页」，微信用的是「主页」），于是被当成商家。

   修复三处（纵深防御）：
        ① UI_NOISE 补中文 UI 词（主页 / 交易服务 / 对订单有疑惑 / …）
        ② 新增策略1c：直接认微信详情页强信号「扫二维码付款·给 X」
        ③ 策略5 向上猜商家时改用更严的 looksLikeMerchantName
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    preprocessReceipt, looksLikeReceipt, _internals,
} = require('../server/modules/ai/vision/receipt-preprocessor');

const DEFAULT_DATE = '2026-09-07';

/** 微信支付详情页：腾讯 OCR 的真实输出形态（含顶部 tab / 底部按钮 / 页脚噪声） */
const WECHAT_DETAIL_OCR = [
    '福建千里香馄饨',
    '留言',
    '主页',
    '交易详情',
    '-9.00',
    '扫二维码付款·给福建千里香馄饨',
    '当前状态　支付成功',
    '收款方备注　二维码收款',
    '支付方式　零钱',
    '转账时间　2026年09月07日 09:04:14',
    '转账单号　10001073012026090701899802900592',
    '交易服务',
    '对订单有疑惑',
    '发起群收款',
    '本服务由财付通提供',
].join('\n');

/** 多模态大模型转录（已按 TRANSCRIBE_PROMPT 滤掉 UI 控件），行更少更干净 */
const WECHAT_DETAIL_CLEAN = [
    '福建千里香馄饨',
    '-9.00',
    '扫二维码付款·给福建千里香馄饨',
    '当前状态　支付成功',
    '收款方备注　二维码收款',
    '支付方式　零钱',
    '转账时间　2026年09月07日 09:04:14',
    '转账单号　10001073012026090701899802900592',
].join('\n');

/** 顺序再乱一版：商家 header 被 OCR 排到了最后 */
const WECHAT_DETAIL_SHUFFLED = [
    '扫二维码付款·给福建千里香馄饨',
    '-9.00',
    '当前状态　支付成功',
    '收款方备注　二维码收款',
    '支付方式　零钱',
    '转账时间　2026年09月07日 09:04:14',
    '转账单号　10001073012026090701899802900592',
    '福建千里香馄饨',
].join('\n');

test('微信详情页（腾讯OCR含UI噪声）：商家取「扫二维码付款·给X」的 X，绝不取「主页」', () => {
    assert.equal(looksLikeReceipt(WECHAT_DETAIL_OCR), true);

    const r = preprocessReceipt(WECHAT_DETAIL_OCR, { defaultDate: DEFAULT_DATE });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, '福建千里香馄饨');
    assert.equal(r.items[0].amount, 9);
    assert.equal(r.items[0].date, '2026-09-07');
    assert.equal(r.items[0].time, '09:04:14');
    // 走详情页专用策略，而不是账单列表的兜底猜测
    assert.equal(r.strategy.includes('s1c_wechat_pay_detail'), true);
    // 净化后的句子里不能出现「主页」
    assert.equal(/\u4e3b\u9875/.test(r.text), false);
});

test('微信详情页（多模态干净转录）：同样命中策略1c 且商家正确', () => {
    const r = preprocessReceipt(WECHAT_DETAIL_CLEAN, { defaultDate: DEFAULT_DATE });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, '福建千里香馄饨');
    assert.equal(r.items[0].amount, 9);
    assert.equal(r.items[0].time, '09:04:14');
});

test('微信详情页（行序被打乱）：仍靠「扫二维码付款·给X」强信号命中', () => {
    const r = preprocessReceipt(WECHAT_DETAIL_SHUFFLED, { defaultDate: DEFAULT_DATE });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, '福建千里香馄饨');
    assert.equal(r.items[0].amount, 9);
});

test('looksLikeMerchantName：UI 行不是商家，真商家是商家', () => {
    const f = _internals.looksLikeMerchantName;
    // UI / 页脚
    assert.equal(f('主页'), false);
    assert.equal(f('交易服务'), false);
    assert.equal(f('对订单有疑惑'), false);
    assert.equal(f('本服务由财付通提供'), false);
    // 真商家
    assert.equal(f('福建千里香馄饨'), true);
    assert.equal(f('老乡鸡（合肥政务区店）'), true);
    assert.equal(f('Starbucks'), true);
});

test('回归：微信账单列表（策略5 兜底路径）不被更严的商家判定误伤', () => {
    const listText = ['微信支付账单明细', '2026年8月20日', '老乡鸡（合肥政务区店）', '-18.00'].join('\n');
    const r = preprocessReceipt(listText, { defaultDate: DEFAULT_DATE });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, '老乡鸡（合肥政务区店）');
    assert.equal(r.items[0].amount, 18);
    assert.equal(r.items[0].date, '2026-08-20');
});

test('回归：没有「给X」强信号时不误触发策略1c', () => {
    // 普通支出文本（不含付款说明），不应被 1c 命中
    const text = ['超市', '-30.00', '支付方式　零钱'].join('\n');
    const r = preprocessReceipt(text, { defaultDate: DEFAULT_DATE });
    const hit1c = r.ok && String(r.strategy).includes('s1c_wechat_pay_detail');
    assert.equal(hit1c, false);
});
