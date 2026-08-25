/* AI v0.2 类目/方向词表一致性测试（防「静默退化成其他支出」复发）。
 *
 * ⛔ 历史事故（2026-08-25 审计发现，均为静默失败、无报错）：
 *
 *   事故 A：两份平行词表不同步
 *     type-extractor.js 手写的 INCOME_WORDS 少了「基金收益/月薪/年终奖/红包」等 7 个词，
 *     而 category-matcher.js 把它们标为 income。
 *     ⇒「基金收益1200元」判成 expense，且因 matchCategory 第一层
 *       `if (entry.type !== type) continue` 会整段跳过该方向的类目，
 *       类目连锁退化成「其他支出」——一个词漏了同时打坏 type 和 category。
 *     ⇒ 修法：INCOME_WORDS / EXPENSE_WORDS 改为从 KEYWORD_TO_CATEGORY 派生（keywordsOfType）。
 *
 *   事故 B：词表 cat 值对不上真实 categories 表
 *     词表写「交通/居住/购物/教育」，而真表叫「交通出行/居家生活/购物消费/学习进修」。
 *     findCategory 的包含匹配能兜住一部分（餐饮→餐饮美食），兜不住的置信度掉到 0.55
 *     甚至 0.35，用户看到的就是「房租2000 → 其他支出」。
 *     ⇒ 根因是类目表后来改过名，词表没跟。本测试即为此设防。
 *
 * 本测试不连数据库：把 schema 里的种子类目作为「真表」快照维护在下方。
 * 若将来改动了种子类目名，本测试会失败 —— 那正是提醒你同步词表的时机。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    KEYWORD_TO_CATEGORY, keywordsOfType, matchCategory,
} = require('../server/modules/ai/extraction/category-matcher');
const { INCOME_WORDS, EXPENSE_WORDS } = require('../server/modules/ai/extraction/type-extractor');

/* 真实种子类目快照（对应 categories 表 user_id IS NULL 的行）。
   ⚠️ 改 schema 种子类目时必须同步这里。 */
const SEED_CATEGORIES = [
    // 一级（parent_id = null）
    ['餐饮', 'expense', null], ['交通出行', 'expense', null], ['购物消费', 'expense', null],
    ['居家生活', 'expense', null], ['休闲娱乐', 'expense', null], ['医疗健康', 'expense', null],
    ['学习进修', 'expense', null], ['人情往来', 'expense', null], ['育儿亲子', 'expense', null],
    ['其他支出', 'expense', null], ['投资理财', 'expense', null],
    // 餐饮
    ['早午晚餐', 'expense', 1], ['外卖小吃', 'expense', 1], ['零食饮料', 'expense', 1],
    ['烟酒', 'expense', 1], ['聚餐请客', 'expense', 1], ['生鲜食材', 'expense', 1],
    ['粮油调味', 'expense', 1],
    // 交通出行
    ['公交地铁', 'expense', 2], ['打车拼车', 'expense', 2], ['加油充电', 'expense', 2],
    ['停车过路', 'expense', 2], ['火车飞机', 'expense', 2], ['维保车险', 'expense', 2],
    // 购物消费
    ['日用百货', 'expense', 3], ['服饰美容', 'expense', 3], ['数码电器', 'expense', 3],
    ['家居家具', 'expense', 3],
    // 居家生活
    ['房租月供', 'expense', 4], ['水电燃气', 'expense', 4], ['物业维修', 'expense', 4],
    ['话费宽带', 'expense', 4], ['社保保险', 'expense', 4], ['日用杂货', 'expense', 4],
    ['快递邮寄', 'expense', 4],
    // 休闲娱乐
    ['电影演出', 'expense', 5], ['游戏电竞', 'expense', 5], ['运动健身', 'expense', 5],
    ['旅游度假', 'expense', 5], ['宠物开销', 'expense', 5], ['会员订阅', 'expense', 5],
    // 医疗健康
    ['门诊药品', 'expense', 6], ['体检住院', 'expense', 6], ['牙科眼科', 'expense', 6],
    ['保健养生', 'expense', 6],
    // 学习进修
    ['培训考试', 'expense', 7], ['书本文具', 'expense', 7], ['知识付费', 'expense', 7],
    // 人情往来
    ['孝敬父母', 'expense', 9], ['送礼红包', 'expense', 9], ['慈善捐赠', 'expense', 9],
    ['请客招待', 'expense', 9],
    // 育儿亲子
    ['奶粉尿布', 'expense', 11], ['玩具童书', 'expense', 11], ['学费培训', 'expense', 11],
    ['医疗保健', 'expense', 11],
    // 投资理财
    ['投资买入', 'expense', 901], ['理财保险', 'expense', 901],
    // 收入
    ['职业收入', 'income', null], ['被动收入', 'income', null], ['兼职副业', 'income', null],
    ['其他收入', 'income', null],
    ['工资薪水', 'income', 15], ['奖金绩效', 'income', 15], ['补贴报销', 'income', 15],
    ['理财收益', 'income', 17], ['房租收入', 'income', 17], ['分红利息', 'income', 17],
    ['自由职业', 'income', 18], ['咨询服务', 'income', 18], ['自媒体创作', 'income', 18],
    ['电商微商', 'income', 18],
    // 转账
    ['一般转账', 'transfer', null],
].map(([name, type, parent_id], i) => ({ id: i + 1, name, type, parent_id }));

/** 复刻 category-matcher.findCategory 的查找语义（精确 → 包含匹配） */
function canResolve(catName, type) {
    if (SEED_CATEGORIES.some(c => c.type === type && c.name === catName)) return 'exact';
    if (SEED_CATEGORIES.some(c => c.type === type && c.name.includes(catName))) return 'loose';
    return null;
}

test('⛔ 每个词表条目的 cat 都必须能在真实类目表命中（否则静默退化成「其他支出」）', () => {
    const failures = [];
    for (const entry of KEYWORD_TO_CATEGORY) {
        if (!canResolve(entry.cat, entry.type)) {
            failures.push(`${entry.cat} (${entry.type})`);
        }
    }
    assert.deepStrictEqual(
        failures, [],
        `以下 cat 在真实类目表里找不到，会导致命中关键词却退化成兜底类目（置信度 0.55）：\n  ${failures.join('\n  ')}\n` +
        '真表一级类目叫「交通出行/居家生活/购物消费/学习进修」，不是「交通/居住/购物/教育」。'
    );
});

test('⛔ cat 应优先写精确存在的叶子类目名（包含匹配只是兜底，不该成为常态）', () => {
    const loose = KEYWORD_TO_CATEGORY
        .filter(e => canResolve(e.cat, e.type) === 'loose')
        .map(e => `${e.cat} (${e.type})`);
    assert.deepStrictEqual(
        loose, [],
        `以下 cat 只能靠「名称包含匹配」命中，建议直接写真表里的名字，避免类目改名后失效：\n  ${loose.join('\n  ')}`
    );
});

test('⛔ INCOME_WORDS / EXPENSE_WORDS 必须从 KEYWORD_TO_CATEGORY 派生（杜绝两份词表不同步）', () => {
    // 词表里标 income 的词，必须全部出现在 INCOME_WORDS
    const missingIncome = keywordsOfType('income').filter(w => !INCOME_WORDS.includes(w));
    assert.deepStrictEqual(
        missingIncome, [],
        `以下词在类目词表里标为 income，却不在 INCOME_WORDS 中 —— 会被判成支出，` +
        `且类目连锁退化成「其他支出」：\n  ${missingIncome.join(' / ')}`
    );
    const missingExpense = keywordsOfType('expense').filter(w => !EXPENSE_WORDS.includes(w));
    assert.deepStrictEqual(missingExpense, [], `以下词在类目词表里标为 expense，却不在 EXPENSE_WORDS 中：\n  ${missingExpense.join(' / ')}`);
});

test('⛔ 收支方向词表不得有交集（同一个词不能既表示收入又表示支出）', () => {
    const both = INCOME_WORDS.filter(w => EXPENSE_WORDS.includes(w));
    assert.deepStrictEqual(
        both, [],
        `以下词同时出现在收入和支出词表，方向判定会取决于遍历顺序（不可预期）：\n  ${both.join(' / ')}\n` +
        '注意「红包」这类天然双向的词：应拆成「收红包/红包收入」(income) 与「送礼红包」(expense)。'
    );
});

test('端到端：典型语句必须落到正确的方向与叶子类目', () => {
    const cases = [
        ['星巴克35.5', 'expense', '零食饮料'],
        ['打车30', 'expense', '打车拼车'],
        ['房租2000', 'expense', '房租月供'],
        ['话费50', 'expense', '话费宽带'],
        ['看电影45', 'expense', '电影演出'],
        ['基金收益1200元', 'income', '理财收益'],
        ['月薪8000到账', 'income', '工资薪水'],
        ['年终奖20000', 'income', '奖金绩效'],
        ['报销1200', 'income', '补贴报销'],
        ['肯德基39', 'expense', '外卖小吃'],
        ['顺丰快递12', 'expense', '快递邮寄'],
        ['中石化加油300', 'expense', '加油充电'],
    ];
    for (const [text, type, wantCat] of cases) {
        const r = matchCategory(text, type, SEED_CATEGORIES);
        assert.strictEqual(
            r.value, wantCat,
            `「${text}」(${type}) 应归到「${wantCat}」，实际「${r.value}」(source=${r.source}, conf=${r.confidence})`
        );
        assert.ok(r.category_id, `「${text}」必须拿到真实 category_id，不能为 null`);
        assert.ok(r.confidence >= 0.9, `「${text}」置信度应 >= 0.9（关键词精确命中），实际 ${r.confidence}`);
    }
});

test('类目 id 只能来自传入的真实类目表，绝不臆造', () => {
    const validIds = new Set(SEED_CATEGORIES.map(c => c.id));
    for (const entry of KEYWORD_TO_CATEGORY) {
        const r = matchCategory(entry.words[0], entry.type, SEED_CATEGORIES);
        if (r.category_id !== null) {
            assert.ok(validIds.has(r.category_id), `「${entry.words[0]}」返回了不存在的 category_id=${r.category_id}`);
        }
    }
});

test('空类目表时不得凭空造 id（降级为 null + 低置信度强制确认）', () => {
    const r = matchCategory('星巴克35', 'expense', []);
    assert.strictEqual(r.category_id, null, '类目表为空时 category_id 必须是 null');
    assert.ok(r.confidence < 0.9, `类目表为空时必须压低置信度触发用户确认，实际 ${r.confidence}`);
});

test('OCR 侧已复用同一份词表（不得再有独立类目词表）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'ai.js'), 'utf8');
    assert.match(aiSrc, /require\('\.\.\/modules\/ai\/extraction\/category-matcher'\)/);
    // 原 fallbackExtractItems 内的 118 行独立词表不得回归
    assert.doesNotMatch(aiSrc, /const level1 = \[/);
    assert.doesNotMatch(aiSrc, /const level2 = \[/);
});
