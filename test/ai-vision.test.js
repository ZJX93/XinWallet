/* 图片通道单测：vision 能力三态判定 + 票据版式预处理。
 *
 * 用户对本方案的三条硬约束（务必先读懂再改这些测试）：
 *   1. 大模型多模态是【主路】
 *   2. 用户说识别有误 → 腾讯云 OCR 兜底
 *   3. 模型不具备图片理解能力 → 腾讯云 OCR 兜底
 *   且腾讯 OCR【只提供识别，不参与学习】。
 */
const test = require('node:test');
const assert = require('node:assert');
const {
    resolveVisionSupport, guessVisionByModel, looksLikeVisionUnsupported,
} = require('../server/modules/ai/vision/vision-capability');
const {
    looksLikeReceipt, preprocessReceipt,
} = require('../server/modules/ai/vision/receipt-preprocessor');

/* ============ vision 能力判定 ============ */

test('模型名白名单：确定支持图片理解的模型判为 yes', () => {
    for (const m of ['gpt-4o', 'gpt-4o-2024-08-06', 'claude-3-5-sonnet', 'gemini-1.5-pro', 'qwen-vl-max', 'glm-4v']) {
        assert.strictEqual(guessVisionByModel(m), true, `${m} 应判为支持`);
    }
});

test('⛔ 拒绝名单必须先于白名单（gpt-4o-mini-tts 会被 gpt-4o 误伤）', () => {
    /*  这条顺序错了会造成：给语音合成模型发图片请求，白等一次超时。 */
    assert.strictEqual(guessVisionByModel('gpt-4o-mini-tts'), false);
    assert.strictEqual(guessVisionByModel('whisper-1'), false);
    assert.strictEqual(guessVisionByModel('text-embedding-3-large'), false);
});

test('未知模型返回 unknown（乐观尝试一次），而不是武断判 no', () => {
    /*  ⚠️ 本函数返回 true/false/【null】——null 表示「不知道」。
        三态字符串 unknown/yes/no 是 resolveVisionSupport 那一层的契约，
        两层别混：混了会把「没试过」当成「不支持」，直接跳过大模型主路。 */
    assert.strictEqual(guessVisionByModel('deepseek-chat'), null);
    assert.strictEqual(guessVisionByModel(''), null);
    assert.strictEqual(guessVisionByModel(null), null);
});

test('⛔ 三态而非布尔：DB 里的确定结论优先于模型名猜测', () => {
    /*  用布尔会分不清「没试过」和「不支持」，导致每次上传都白试一次失败调用。 */
    assert.strictEqual(resolveVisionSupport({ model: 'gpt-4o', vision_support: 'no' }), 'no',
        'DB 已验证不支持时，不得被白名单覆盖');
    assert.strictEqual(resolveVisionSupport({ model: 'deepseek-chat', vision_support: 'yes' }), 'yes');
    // DB 是 unknown 时才回落到模型名判断
    assert.strictEqual(resolveVisionSupport({ model: 'gpt-4o', vision_support: 'unknown' }), 'yes');
    assert.strictEqual(resolveVisionSupport({ model: 'deepseek-chat', vision_support: 'unknown' }), 'unknown');
});

test('⛔ HTTP 200 但回复「我看不到图片」也必须识别为不支持', () => {
    /*  这是最致命的一种：JSON 解析失败后会被误判成「模型格式错」，
        于是重试、报错、扣 token，而用户只看到「识别失败」。 */
    assert.ok(looksLikeVisionUnsupported({ replyText: '抱歉，我无法查看图片' }));
    assert.ok(looksLikeVisionUnsupported({ replyText: "I'm unable to view images" }));
    assert.ok(looksLikeVisionUnsupported({ errorMessage: 'model does not support image input' }));
    // 正常识别结果不得误判
    assert.ok(!looksLikeVisionUnsupported({ replyText: '2026年8月20日 老乡鸡 18元' }));
});

/* ============ 票据版式预处理 ============ */

test('⛔ looksLikeReceipt 不得误伤手打的自然语言', () => {
    /*  误判为票据会让正常文字走版式策略，全部抽不到 ⇒ 用户记不上账。 */
    assert.ok(!looksLikeReceipt('今天在星巴克喝咖啡花了35元'));
    assert.ok(!looksLikeReceipt('午饭 18'));
    assert.ok(!looksLikeReceipt(''));
    assert.ok(!looksLikeReceipt(null));
});

test('微信支付单笔（竖排标签版式）能被识别并整理', () => {
    /*  ⛔ 策略 1b：真实微信账单详情页是【标签在上、值在下】。
        legacy 的 5 套策略全漏了这种版式（当年总能靠 LLM 兜住）。 */
    const text = [
        '微信支付',
        '支付金额',
        '¥18.00',
        '商户全称',
        '老乡鸡',
        '支付时间',
        '2026年8月20日 08:12:33',
        '交易单号',
        '4200002891202608201234567890',
    ].join('\n');
    assert.ok(looksLikeReceipt(text), '应识别为票据');
    const r = preprocessReceipt(text);
    assert.ok(r.ok, `预处理应成功，实际 ${JSON.stringify(r).slice(0, 200)}`);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].amount, 18);
    assert.strictEqual(r.items[0].name, '老乡鸡');   // ⚠️ 字段名是 name
});

test('⛔ 交易单号/时间戳不得被当成金额（曾抽出 4.2e27 元）', () => {
    const text = [
        '支付金额', '¥18.00',
        '商户全称', '老乡鸡',
        '支付时间', '2026年8月20日 08:12:33',
        '交易单号', '4200002891202608201234567890',
    ].join('\n');
    const r = preprocessReceipt(text);
    assert.ok(r.ok);
    for (const it of r.items) {
        assert.ok(it.amount < 1e6, `金额 ${it.amount} 明显异常（单号被当成金额了）`);
    }
});

test('⛔ 输出语句必须带「元」单位（裸数字只有 0.6 置信度）', () => {
    /*  抽取器对裸数字给 evidence=bare_number/0.6，带单位给 amount_with_unit/0.98
        —— 直接决定要不要弹用户确认。 */
    const text = ['支付金额', '¥18.00', '商户全称', '老乡鸡'].join('\n');
    const r = preprocessReceipt(text);
    assert.ok(r.ok);
    assert.match(r.text, /元/, `预处理输出必须带「元」，实际 ${JSON.stringify(r.text)}`);
});

test('⛔ 输出日期用「YYYY年M月D日」而非 YYYY-MM-DD', () => {
    /*  实测：抽取器对 `2026-08-20` 会把 `08` 也当候选金额 —— 就是本模块要修的 bug。 */
    const text = ['支付金额', '¥18.00', '商户全称', '老乡鸡', '支付时间', '2026年8月20日 08:12:33'].join('\n');
    const r = preprocessReceipt(text);
    assert.ok(r.ok);
    assert.doesNotMatch(r.text, /\d{4}-\d{2}-\d{2}/, '不得输出 YYYY-MM-DD 格式日期');
});

test('账单列表多笔：日期须向上找（向下会串到下一组）', () => {
    /*  版式是「日期 → 商户 → 金额」三行一组，本笔日期在【上方】；
        向下找会撞到下一组的日期 ⇒ 记账日期莫名早一天，且只在多笔账单里出现。 */
    const text = [
        '8月20日',
        '老乡鸡',
        '-18.00',
        '滴滴出行',
        '-26.50',
        '8月19日',
        '永辉超市',
        '-128.50',
    ].join('\n');
    const r = preprocessReceipt(text);
    assert.ok(r.ok, `多笔账单应能解析，实际 ${JSON.stringify(r).slice(0, 200)}`);
    const didi = r.items.find(i => i.name && i.name.includes('滴滴'));
    assert.ok(didi, '应解析出滴滴那笔');
    assert.ok(!didi.date || /8月20日|08-20/.test(String(didi.date)),
        `滴滴那笔日期应属 8-20（上方那组），实际 ${didi.date}`);
});
