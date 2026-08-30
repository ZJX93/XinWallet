/* AI v0.2 记忆键归一一致性测试（防「学到的规则永远命中不了自己」复发）。
 *
 * ⛔ 历史事故（2026-08-25 端到端验证发现，静默失败、无任何报错）：
 *
 *   写侧 evidence-engine.learnableKey 与读侧 memory-retrieval.buildRetrievalKeys
 *   各自手写一套正则从文本里取键。写侧对备注跑 /[\u4e00-\u9fa5A-Za-z]{2,10}/
 *   取首个中文片段，「在验证商家花了38元」学成了 match_key = "在验证商家"；
 *   而读侧下次用「验证商家」去查 —— 永远查不到自己刚学的规则。
 *
 *   表征极其隐蔽：ai_rules 里分数在涨、状态在升级、ai_rule_evidence 有完整流水，
 *   一切看起来都在「学习」，但识别结果永远不变。没有任何异常日志。
 *
 *   ⇒ 修法：抽出 memory/keys.js 作为唯一真相，读写两侧一律走它。
 *     本测试即为此设防：任何一侧绕过 keys.js 自己写正则，都会在这里失败。
 *
 * 本测试不连数据库、不调模型，纯函数级断言。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
    normalizeKey, isUsefulKey, chunkKeys, splitByParticles, stripDateTime,
    LEADING_PARTICLES, TRAILING_PARTICLES, NOISE_KEYS, productKey,
} = require('../server/modules/ai/memory/keys');
const { buildRetrievalKeys } = require('../server/modules/ai/memory/memory-retrieval');
const { learnableKey } = require('../server/modules/ai/learning/evidence-engine');
const { extractMerchant } = require('../server/modules/ai/extraction/merchant-extractor');

// ============================================================
// 1) 核心不变式：读侧与写侧对同一输入必须产出一致的键
// ============================================================
test('读写两侧的键必须一致（学习闭环的命门）', () => {
    // 每条 case 模拟一次真实记账：commit 时写侧学到什么键，
    // 下次 parse 时读侧就必须能用同一个键查到它。
    const cases = [
        { text: '在老王超市花了38元', merchant: '老王超市' },
        { text: '去老王超市买了水 12', merchant: '老王超市' },
        { text: '今天在星巴克喝咖啡 35', merchant: '星巴克' },
        { text: '昨天去麦当劳吃了45', merchant: '麦当劳' },
        { text: '饿了么点了个外卖 28', merchant: '饿了么' },
    ];

    for (const c of cases) {
        // 写侧：commit 之后 evidence-engine 会用这个键建规则
        const written = learnableKey({ merchant: c.merchant, note: c.text });
        // 读侧：下次 parse 会用这批键去查规则
        const readKeys = buildRetrievalKeys(c.text, [c.merchant]);

        assert.ok(written, `[${c.text}] 写侧必须能提炼出键`);
        assert.ok(
            readKeys.includes(written),
            `[${c.text}] 写侧存「${written}」，但读侧的检索键是 [${readKeys.join(', ')}]\n` +
            `  ⇒ 规则永远命中不了自己，「越用越聪明」失效且不报错`
        );
    }
});

test('抽取出的商家名可直接作为规则键（无需二次清洗）', () => {
    // merchant 会原样成为 ai_rules.match_key，所以抽取阶段就必须是干净的
    const cases = [
        ['在老王超市花了38元', '老王超市'],
        ['去老王超市买了水 12', '老王超市'],
        ['在老王超市 38元', '老王超市'],
        ['今天在星巴克喝咖啡 35', '星巴克'],
        ['饿了么点了个外卖 28', '饿了么'],
    ];
    for (const [text, expected] of cases) {
        const m = extractMerchant(text, []);
        assert.ok(m, `[${text}] 应抽到商家`);
        assert.strictEqual(m.value, expected,
            `[${text}] 商家应为「${expected}」，实际「${m.value}」——脏值会直接写进 ai_rules.match_key`);
        // 抽取值必须已是归一态：再过一遍 normalizeKey 不应改变它
        assert.strictEqual(normalizeKey(m.value), m.value,
            `[${text}] 抽取值「${m.value}」不是归一态，说明抽取器绕过了 keys.js`);
    }
});

// ============================================================
// 2) normalizeKey 行为
// ============================================================
test('normalizeKey 剥离首尾虚词', () => {
    const cases = [
        ['在验证商家', '验证商家'],
        ['去星巴克', '星巴克'],
        ['到公司', '公司'],
        ['星巴克花了', '星巴克'],
        ['麦当劳消费', '麦当劳'],
        ['在到星巴克花', '星巴克'],   // 叠加虚词需反复剥离
        ['星巴克', '星巴克'],         // 干净输入原样返回
    ];
    for (const [input, expected] of cases) {
        assert.strictEqual(normalizeKey(input), expected, `normalizeKey(${JSON.stringify(input)})`);
    }
});

test('normalizeKey 不会把键剥到少于 2 字', () => {
    // 「在家」若剥成「家」会失去区分度，且单字键会命中海量无关历史
    assert.strictEqual(normalizeKey('在家'), '在家');
    assert.strictEqual(normalizeKey('去吃'), '去吃');
    // 空输入不得抛异常（学习路径全程不许 throw）
    assert.strictEqual(normalizeKey(''), '');
    assert.strictEqual(normalizeKey(null), '');
    assert.strictEqual(normalizeKey(undefined), '');
});

test('normalizeKey 幂等（归一后再归一不变）', () => {
    // 不幂等意味着「读一次少一层虚词」，多跳一次链路键就变了
    const samples = ['在验证商家', '去星巴克买', '到公司花了', '星巴克', '在家', '饿了么'];
    for (const s of samples) {
        const once = normalizeKey(s);
        assert.strictEqual(normalizeKey(once), once, `normalizeKey 对 ${JSON.stringify(s)} 不幂等`);
    }
});

// ============================================================
// 3) isUsefulKey 过滤
// ============================================================
test('isUsefulKey 拒绝噪声与无区分度的键', () => {
    for (const bad of ['', 'x', '今天', '花了', '消费', '元', '123', '38', '¥', '   ']) {
        assert.strictEqual(isUsefulKey(bad), false, `「${bad}」不该作为键`);
    }
    for (const good of ['星巴克', '老王超市', 'Netflix', '饿了么']) {
        assert.strictEqual(isUsefulKey(good), true, `「${good}」应该可作为键`);
    }
});

test('NOISE_KEYS 里的词全部被 isUsefulKey 拒绝', () => {
    // 防止有人往 NOISE_KEYS 加词但过滤没生效
    for (const n of NOISE_KEYS) {
        assert.strictEqual(isUsefulKey(n), false, `NOISE_KEYS 含「${n}」但未被过滤`);
    }
});

// ============================================================
// 4) chunkKeys 切段
// ============================================================
test('chunkKeys 在虚词与时间词处切开', () => {
    // 只剥首尾拿不掉中间的虚词：「今天在星巴克喝咖啡」必须切出「星巴克」
    assert.ok(chunkKeys('今天在星巴克喝咖啡 35').includes('星巴克'),
        '时间词+介词粘连时必须切出商家名');
    assert.ok(chunkKeys('昨天去麦当劳吃了45').includes('麦当劳'));
    assert.ok(chunkKeys('中午外卖 25 晚上电影 60').includes('外卖'),
        '切剩单段时不得丢弃切分结果（曾因三元判断写错而丢）');
    assert.ok(chunkKeys('中午外卖 25 晚上电影 60').includes('电影'));
});

test('chunkKeys 不误伤含虚词字的商家名', () => {
    // 「饿了么」含「了」，但「了」不在虚词表 ⇒ 不该被切成「饿」+「么」
    const keys = chunkKeys('饿了么点了个外卖 28');
    assert.ok(keys.some(k => k.includes('饿了么')),
        `「饿了么」被切碎了：${JSON.stringify(keys)}`);
});

test('chunkKeys 不把数字带进键', () => {
    for (const k of chunkKeys('星巴克 38元 2026-08-25')) {
        assert.ok(!/\d/.test(k), `键「${k}」含数字（金额/日期不该进键）`);
    }
});

test('splitByParticles 保留原段兜底', () => {
    // 商家名本身可能含虚词（如「买买提」），切碎后必须有原值可选
    const parts = splitByParticles('今天在星巴克');
    assert.ok(parts.includes('今天在星巴克'), '切分结果应含原段兜底');
    assert.ok(parts.some(p => p === '星巴克'), '切分结果应含干净子段');
    // 无虚词可切时只返回自身，不该重复
    assert.deepStrictEqual(splitByParticles('星巴克'), ['星巴克']);
});

// ============================================================
// 5) 结构约束：禁止绕过 keys.js 自己写取键正则
// ============================================================
test('读写两侧都必须 require keys.js（防未来重新分叉）', () => {
    const files = [
        'server/modules/ai/memory/memory-retrieval.js',
        'server/modules/ai/learning/evidence-engine.js',
        'server/modules/ai/extraction/merchant-extractor.js',
        // note-composer 的日期剥离也必须复用 stripDateTime，
        // 否则备注剥干净了、学习键还粘着日期残渣（或反之），且零报错
        'server/modules/ai/extraction/note-composer.js',
    ];
    for (const f of files) {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        assert.ok(/require\(['"][^'"]*memory\/keys['"]\)|require\(['"]\.\/keys['"]\)/.test(src),
            `${f} 未 require keys.js —— 极可能又自己写了一套取键正则`);
    }
});

test('虚词表不含单字「了」（否则「饿了么」会被切碎）', () => {
    // 这条约束看似琐碎，但一旦有人往表里加「了」，
    // 「饿了么」「麦德龙了」这类键会静默碎成无意义片段
    assert.ok(!LEADING_PARTICLES.includes('了'), 'LEADING_PARTICLES 不得含「了」');
    assert.ok(!TRAILING_PARTICLES.includes('了'), 'TRAILING_PARTICLES 不得含「了」');
});

// ============================================================
// 6) 日期单位汉字残渣（2026-08-26 实测发现的真实缺陷）
// ============================================================
/*  缺陷全貌：`chunkKeys` 原先直接按数字切段，`2026年8月20日老乡鸡` 的数字被切掉后
    单位汉字 `日` 留在原地，粘出脏键 `日老乡鸡`。而同一家店说「昨天老乡鸡吃饭」
    学到的是干净的 `老乡鸡` ⇒ 一个商家两个键、各攒各的分数、
    **永远升不到 verified**，规则表看着在长、识别结果永不改善、零报错。

    ⛔ 修法的关键是【剥离必须在切段之前】：那时数字还在，才分得清
       「20日」（日期）和「日本料理」（商家名首字）。 */
test('⛔ 日期不得留下单位汉字残渣粘住商家名', () => {
    const withDate = chunkKeys('2026年8月20日老乡鸡 18元', 10);
    const withRelDate = chunkKeys('昨天老乡鸡吃饭18元', 10);

    assert.ok(withDate.includes('老乡鸡'),
        `绝对日期场景应学到干净键「老乡鸡」，实得 ${JSON.stringify(withDate)}`);
    assert.ok(!withDate.some(k => /^[年月日号点分]/.test(k)),
        `键不得以日期单位汉字开头（脏键如「日老乡鸡」），实得 ${JSON.stringify(withDate)}`);

    // 核心不变式：同一商家、不同日期写法，必须落到同一个键
    const shared = withDate.filter(k => withRelDate.includes(k));
    assert.ok(shared.includes('老乡鸡'),
        `同一商家的绝对/相对日期写法必须共用键，实得交集 ${JSON.stringify(shared)}`);
});

test('剥日期不得腰斩含日期字样的商家名', () => {
    /*  「日本料理」「日式烧肉」的首字就是日期单位，「月饼」同理。
        ⚠️ 用例必须选【没有完整日期前缀】的写法才能真正考到负向断言 ——
           `8月20日日本料理` 会先被「8月20日」整体规则吃掉，
           根本走不到单独的 `\d{1,2}日` 规则，用它做用例是【假测试】
           （2026-08-26 突变测试实证：去掉负向断言，带前缀的用例依然全绿）。 */
    assert.ok(chunkKeys('2日本料理店 200元', 10).some(k => k.includes('日本料理')),
        `「2日本料理店」的商家名被腰斩，实得 ${JSON.stringify(chunkKeys('2日本料理店 200元', 10))}`);
    assert.ok(chunkKeys('3月饼礼盒 120元', 10).some(k => k.includes('月饼')),
        `「3月饼礼盒」的商品名被腰斩，实得 ${JSON.stringify(chunkKeys('3月饼礼盒 120元', 10))}`);
    assert.ok(chunkKeys('买了2日式便当 40元', 10).some(k => k.includes('日式')),
        `「2日式便当」被腰斩，实得 ${JSON.stringify(chunkKeys('买了2日式便当 40元', 10))}`);

    // 带完整日期前缀的常见写法同样不能腰斩（走的是另一条规则，一并锁住）
    assert.ok(chunkKeys('8月20日日本料理 200元', 10).includes('日本料理'), '「日本料理」被腰斩');
    assert.ok(chunkKeys('20日日式烧肉 88元', 10).includes('日式烧肉'), '「日式烧肉」被腰斩');
    // 商家名整体含日期字样时，靠整段兜底保住
    assert.ok(chunkKeys('3月8日三月花咖啡 30元', 10).some(k => k.includes('三月花')),
        '「三月花咖啡」应有整段兜底键');
});

test('stripDateTime 只剥与数字捆绑的日期，不动相对日期', () => {
    // 分工：stripDateTime 解决「单位汉字残渣」，TIME_WORDS 虚词切分解决「时间词粘连」。
    // 混在一处会导致相对日期被剥两遍、或绝对日期漏剥。
    assert.strictEqual(stripDateTime('2026年8月20日老乡鸡').trim(), '老乡鸡');
    assert.strictEqual(stripDateTime('08:12:33 便利店').trim(), '便利店');
    assert.ok(stripDateTime('昨天老乡鸡').includes('昨天'),
        '相对日期不该在 stripDateTime 剥离（由虚词切分负责）');
});

// ============================================================
// 7) 商品词提取（2026-08-30：从「取最长段」改为「类目词表命中优先」）
// ============================================================
/*  ⛔ 历史缺陷：productKey 原按【最长段】选商品词，而商户名 / 渠道名几乎总比商品名长 ——
    实测 14 个真实账单样本错 8 个：

        「淘宝闪购 奶茶 8元」（无商户）  → 学到「淘宝闪购」
        「午餐 公司食堂 刷卡 15元」      → 学到「公司食堂」
        「在星巴克喝咖啡 35元」          → 剔掉商户后候选池空，回退成「星巴克」
        「中石化加油 300元」             → 回退成「中石化」
        「超市 买洗衣液 25元」           → 学到「超市」（场所不是商品）

    学到的规则指向渠道 / 场所而不是「买了什么」，等于把「按商户学类目」的旧病
    又原样带回来 —— 这正是当初做商品词学习要解决的问题。

    ⇒ 修法：候选按【是否命中类目词表】排序（词表里越靠前越优先），
      并区分「完全命中」优于「包含命中」，长度只作兜底 tiebreak。 */
test('productKey 取「买了什么」而非渠道 / 场所 / 商户', () => {
    const cases = [
        // [raw_segment, merchant, 期望商品词]
        ['淘宝闪购 盒饭 15元', '淘宝闪购', '盒饭'],
        ['淘宝闪购 奶茶 8元', '淘宝闪购', '奶茶'],
        // ⛔ 商户字段缺失时也不能退化成渠道名（改前取到「淘宝闪购」）
        ['淘宝闪购 奶茶 8元', '', '奶茶'],
        ['美团外卖 麻辣烫 30元', '美团外卖', '麻辣烫'],
        ['20:19:15 淘宝闪购 12.71元 备注:蜜雪冰城(龙湖星悦广场店)外卖订单', '淘宝闪购', '蜜雪冰城'],
        // 商户即品牌（店里只卖这个）时回退用商户，这是我们要的
        ['蜜雪冰城 12元', '蜜雪冰城', '蜜雪冰城'],
        // ⛔ 场所 / 场景并存时取更靠前的类目词（改前取到更长的「公司食堂」）
        ['午餐 公司食堂 刷卡 15元', '', '午餐'],
        ['超市 买洗衣液 25元', '', '洗衣液'],
        // ⛔ 前导动词不是商品
        ['充话费 100元', '', '话费'],
        ['交房租 2000元', '', '房租'],
        // ⛔ 虚词切段后取商品，别回退成商户
        ['在星巴克喝咖啡 35元', '星巴克', '咖啡'],
        ['打车去机场 58元', '', '打车'],
        // ⛔ 商户与商品粘连时剥出商品（改前整段被剔、回退成「中石化」）
        ['中石化加油 300元', '中石化', '加油'],
        // 词表未收录的新商品名：靠长度兜底，不能用渠道名顶替
        ['瑞幸咖啡 生椰拿铁 16元', '瑞幸咖啡', '生椰拿铁'],
        // ⛔ 商户抽取把一整句话当商户时（实测 merchant = 「超市 买洗衣液」），
        //    仍要取到商品词 —— 否则商品词被商户名吞掉、回退成整段「场所+动作」
        ['超市 买洗衣液 25元', '超市 买洗衣液', '洗衣液'],
    ];
    for (const [raw, mer, want] of cases) {
        assert.strictEqual(
            productKey(raw, mer), want,
            `productKey("${raw}", merchant="${mer}") 应取「${want}」`
        );
    }
});

test('productKey 不误伤以动作词开头的真商品', () => {
    /*  剥前导动词是启发式，必然有误伤面：
        「充电宝」剥「充」→「电宝」、「打车」剥「打」→「车」。
        防线是【剥离结果不替换原词，两者一起进候选池由词表 rank 择优】——
        「充电宝」「打车」本身就在类目词表里，rank 优于残词，故自动保留。 */
    assert.strictEqual(productKey('买了充电宝 129元', ''), '充电宝');
    assert.strictEqual(productKey('打车去公司 25元', ''), '打车');
    assert.strictEqual(productKey('买菜 45元', ''), '买菜');   // 「菜」单字不成键，保留原词
});

test('productKey 不把含空白的「整句式商户名」当作商品词', () => {
    /*  商户抽取偶发把一整句话填进 merchant（实测「超市 买洗衣液」）。
        此时候选池可能为空，若照旧回退 merchant，就会学出
        match_key = 「超市 买洗衣液」这种「场所+动作」的脏规则。
        ⇒ 宁可这次不学（返回 null），也不能污染规则表。 */
    assert.strictEqual(productKey('超市 便利店 25元', '超市 便利店'), null);
    // 干净的品牌型商户仍允许回退（「蜜雪冰城」既是商户也是商品）
    assert.strictEqual(productKey('蜜雪冰城 12元', '蜜雪冰城'), '蜜雪冰城');
});
