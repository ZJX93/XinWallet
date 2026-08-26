/* note-composer：「场景-对象」备注生成的单测。
 *
 * 为什么必须有这个测试（2026-08-25 真实缺陷）：
 *   v0.2 抽取器曾直接 `note: seg`（原始片段），注释声称「commit 时经 resolveNote
 *   规范化」，但 resolveNote 第一行就是 `if (note) return note` —— 从来没规范化过。
 *   结果落账备注是 `2026年8月20日老乡鸡 18元`（日期金额全冗余），
 *   且【完全不报错】，只能靠人肉翻账单才能发现。
 *
 * 这里刻意覆盖那几个最容易写错的边界，见每个 case 的注释。
 */
const test = require('node:test');
const assert = require('node:assert');
const { composeNote, stripQuantities } = require('../server/modules/ai/extraction/note-composer');

test('剥离日期/时间/金额，只留语义', () => {
    assert.strictEqual(stripQuantities('2026年8月20日老乡鸡 18元'), '老乡鸡');
    assert.strictEqual(stripQuantities('2026-08-20 星巴克 ¥35.00'), '星巴克');
    assert.strictEqual(stripQuantities('支付时间 2026年8月20日 08:12:33'), '支付时间');
    // 超长交易单号必须剥净：它曾让抽取器抽出一笔 4.2e27 元的交易
    assert.strictEqual(stripQuantities('交易单号 4200002891202608201234567890'), '交易单号');
    assert.strictEqual(stripQuantities('-26.50'), '');
});

test('日期必须先于金额剥离（顺序反了会留下「2026年日」残渣）', () => {
    /*  ⛔ 这是 STRIP_PATTERNS 的顺序约束：
        若先剥金额，`2026年8月20日` 里的数字会被吃掉一部分，
        留下「年月日」这种残渣当场景，备注变成「年月日-老乡鸡」。 */
    const r = stripQuantities('2026年8月20日老乡鸡 18元');
    assert.ok(!/年|月|日/.test(r), `不得残留日期字符，实际 ${JSON.stringify(r)}`);
});

test('有商家 + 有场景 → 场景-对象', () => {
    assert.strictEqual(
        composeNote({ segment: '在星巴克喝咖啡 35元', merchant: '星巴克', categoryName: '咖啡奶茶' }),
        '喝咖啡-星巴克');
    assert.strictEqual(
        composeNote({ segment: '买菜 张三 50元', merchant: '张三', categoryName: '日用百货' }),
        '买菜-张三');
});

test('⛔ 商家是全称的一部分时，残渣不得当场景（曾产出「出行-滴滴」）', () => {
    /*  词典里是「滴滴」，票据上写「滴滴出行」；词典「永辉」vs 票据「永辉超市」。
        直接 split 掉商家名，剩下的是被腰斩的商家名尾巴，不是场景：
          ❌ 出行-滴滴 / 超市-永辉
        正确行为是退回类目名。 */
    assert.strictEqual(
        composeNote({ segment: '2026年8月20日滴滴出行 26.5元', merchant: '滴滴', categoryName: '打车拼车' }),
        '打车拼车-滴滴');
    assert.strictEqual(
        composeNote({ segment: '永辉超市 128.5元', merchant: '永辉', categoryName: '日用百货' }),
        '日用百货-永辉');
});

test('无商家 → 用原话残余（比类目名信息量大），仍不含金额', () => {
    assert.strictEqual(
        composeNote({ segment: '给妈妈转生活费 2000元', merchant: null, categoryName: '其他支出' }),
        '给妈妈转生活费');
    const r = composeNote({ segment: '老乡鸡 18元', merchant: null, categoryName: '其他支出' });
    assert.strictEqual(r, '老乡鸡');
    assert.ok(!/\d/.test(r), '备注不得含数字');
});

test('残余恰好等于商家名 → 用类目名作场景（不得产出「老乡鸡-老乡鸡」）', () => {
    /*  这在图片通道是【常态】：票据预处理产出的语句往往就是
        「日期 + 商户名 + 金额」，剥完只剩商户名。 */
    assert.strictEqual(
        composeNote({ segment: '2026年8月20日老乡鸡 18元', merchant: '老乡鸡', categoryName: '早午晚餐' }),
        '早午晚餐-老乡鸡');
});

test('场景已包含对象 → 不重复拼接', () => {
    assert.strictEqual(
        composeNote({ segment: '滴滴打车 30元', merchant: '滴滴', categoryName: '打车拼车' }),
        '打车-滴滴');
});

test('信息完全不足 → 返回空串（交由 resolveNote 兜底类目名）', () => {
    assert.strictEqual(composeNote({ segment: '18元', merchant: null, categoryName: '' }), '');
    assert.strictEqual(composeNote({}), '');
    assert.strictEqual(composeNote({ segment: null, merchant: null, categoryName: null }), '');
});

test('备注绝不含日期/金额噪声（总体不变量）', () => {
    const samples = [
        ['2026年8月20日老乡鸡 18元', '老乡鸡', '早午晚餐'],
        ['2026-08-20 08:12:33 ¥35.00 星巴克', '星巴克', '咖啡奶茶'],
        ['昨天下午打车 88元', '滴滴', '打车拼车'],
        ['永辉超市 128.5元', '永辉', '日用百货'],
    ];
    for (const [segment, merchant, categoryName] of samples) {
        const note = composeNote({ segment, merchant, categoryName });
        assert.ok(!/\d{4}年|\d{1,2}月\d{1,2}日|\d+\s*元|[¥￥]|\d{1,2}:\d{2}/.test(note),
            `「${segment}」→ ${JSON.stringify(note)} 仍含日期/金额噪声`);
    }
});
