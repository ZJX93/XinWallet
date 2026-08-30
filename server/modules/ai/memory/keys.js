/* ============================================
   记忆检索键归一（Retrieval Key Normalization）
   ------------------------------------------------
   ⛔ 为什么必须单独成一个模块：
      「从文本里取出可作为记忆主键的片段」这件事，同时被两处需要：
        · memory-retrieval.buildRetrievalKeys —— 读侧（拿键去查规则/记忆）
        · evidence-engine.learnableKey        —— 写侧（拿键去建规则）
      两侧各写一遍正则，必然漂移。一旦写侧存成「在星巴克」而读侧查「星巴克」，
      规则就永远命中不了自己 —— 学习系统看着在攒分，实际零效果，且完全不报错。

   ⛔ 已发生的真实缺陷（2026-08-25 端到端验证发现）：
      写侧对备注跑 /[\u4e00-\u9fa5A-Za-z]{2,10}/ 取首个中文片段，
      「在验证商家花了38元」学成了 match_key = "在验证商家"。
      用户下次输入「验证商家 25元」（没有"在"）就匹配不上。
   ============================================ */

/**
 * 类目词表（唯一真相）—— 商品词候选打分用，见 categoryWordRank。
 *
 * ⛔ 依赖方向：memory/keys → extraction/category-matcher，单向。
 *    category-matcher 不 require 本模块（已确认），不会成环。
 * ⚠️ 本模块被 extraction/note-composer 复用，故这里是「底层 → 上层」的反向依赖，
 *    只取词表做打分、不改变任何既有键的归一结果，保持幂等。
 */
const { KEYWORD_TO_CATEGORY } = require('../extraction/category-matcher');

// 前置虚词：出现在商家名之前的介词/动词，不属于商家本身。
// 按长度降序剥离，避免「在到」这类叠词只剥掉一层。
const LEADING_PARTICLES = ['在', '去', '到', '从', '给', '用', '找', '往', '于'];

// 后置虚词：紧跟商家名之后的动作词，同样不属于商家。
const TRAILING_PARTICLES = [
    '花了', '花掉', '付了', '买了', '充了', '交了', '刷了', '转了',
    '消费', '支出', '收入', '买', '吃', '喝', '花', '付', '充', '办', '加油',
];

// 高频噪声词：出现在几乎所有记账文本里，作为检索键毫无区分度。
// ⚠️ 与「虚词剥离」是两件事：剥离处理的是键的边缘，这里丢弃的是整个键。
const NOISE_KEYS = new Set([
    '今天', '昨天', '前天', '明天', '早上', '中午', '晚上', '上午', '下午',
    '花了', '花掉', '支出', '收入', '付了', '买了', '消费', '元', '块钱',
    '一个', '两个', '这个', '那个', '还有', '然后', '另外',
    '一共', '总共', '大概', '左右', '差不多', '记一笔', '记账',
]);

/**
 * 归一化一个候选键：剥掉首尾虚词、去空白。
 * @param {string} raw
 * @returns {string} 归一后的键（可能变短，也可能为空串）
 */
function normalizeKey(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';

    // 反复剥离，处理「在去星巴克」这类叠加
    let changed = true;
    while (changed && s.length > 0) {
        changed = false;
        for (const p of LEADING_PARTICLES) {
            // 剥离后至少要留 2 字，否则「在家」会被剥成「家」这种无意义单字
            if (s.startsWith(p) && s.length - p.length >= 2) {
                s = s.slice(p.length); changed = true; break;
            }
        }
        for (const p of [...TRAILING_PARTICLES].sort((a, b) => b.length - a.length)) {
            if (s.endsWith(p) && s.length - p.length >= 2) {
                s = s.slice(0, s.length - p.length); changed = true; break;
            }
        }
    }
    return s.trim();
}

/**
 * 判断一个键是否值得用于检索/学习。
 * @param {string} key
 */
function isUsefulKey(key) {
    const s = String(key || '');
    if (s.length < 2 || s.length > 60) return false;
    if (NOISE_KEYS.has(s)) return false;
    // 纯数字/纯符号不是商家
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(s)) return false;
    return true;
}

/*  绝对日期 / 时间的完整形态。
    ⛔⛔ 必须在「按数字切段」之【前】整体剥掉，否则日期的**单位汉字**会粘住商家名
       （2026-08-26 实测发现的真实缺陷）：

         `2026年8月20日老乡鸡 18元`
            按数字切段 → `年`(单字丢弃) / `月`(丢弃) / `日老乡鸡`  ❌
            同一家店换成「昨天老乡鸡吃饭」→ `老乡鸡`               ✅
         ⇒ 同一商家学成两个键（`日老乡鸡` 与 `老乡鸡`），各攒各的分数，
           **永远升不到 verified**，且规则表看着在长、零报错。

    ⛔ 为什么不能简单地把「年/月/日/号/点/分」当虚词切分：
       「日本料理」「日昌餐厅」「三月花」都含这些字，按字切会被腰斩。
       判据必须是【紧跟数字】—— 所以规则里数字与单位捆绑，靠正则保证：
         `8月20日日本料理` → 剥掉 `8月20日` → `日本料理` 完整保留。 */
const DATETIME_PATTERNS = [
    /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g,   // 2026年8月20日
    /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,                   // 2026-08-20
    /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,                 // 8月20日
    /\d{1,2}\s*[-/]\s*\d{1,2}\s*[日号]/g,               // 8/20日
    /\d{4}\s*年/g,                                      // 单独的 2026年
    /\d{1,2}\s*月(?![饼团])/g,                          // 单独的 8月（「3月饼礼盒」不剥）
    /\d{1,2}\s*[日号](?!本|式|料)/g,                    // 单独的 20日（「2日本料理」不剥）
    /\d{1,2}:\d{2}(:\d{2})?/g,                          // 08:12:33
    /\d{1,2}\s*点(\s*\d{1,2}\s*分)?/g,                  // 8点30分
];

/**
 * 剥掉文本中的绝对日期与时间，只留语义部分。
 *
 * ⚠️ 只处理【与数字捆绑】的日期时间。相对日期（今天/昨天）不在这里剥 ——
 *    它们由 TIME_WORDS 在虚词切分阶段处理，两套机制职责不同：
 *    这里解决「单位汉字残渣」，那里解决「时间词整体粘连」。
 *
 * ⛔ 唯一真相：`extraction/note-composer.js` 的备注剥离也复用本函数，
 *    别再写第二套日期正则（本项目已因「读写两侧各写一套」踩坑三次）。
 *
 * @param {string} text
 * @returns {string}
 */
function stripDateTime(text) {
    let s = String(text || '');
    for (const re of DATETIME_PATTERNS) s = s.replace(re, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * 从自由文本里切出候选键（读侧与写侧共用）。
 *
 * 三级处理：
 *   ⓿ 剥绝对日期/时间 —— 防日期单位汉字（年/月/日/点）粘住商家名，
 *      必须在切段之前做（那时数字还在，才分得清「20日」和「日本料理」）
 *   ① 数字/标点切段 —— 金额、单号天然是分隔符，不该进键
 *   ② 虚词切段     —— 「今天在星巴克喝咖啡」若只按①切，会得到整块
 *      「今天在星巴克喝咖」（首尾剥离拿不掉中间的「今天在」），
 *      这个脏键既查不到规则、也会污染规则表。必须在虚词处断开。
 *
 * @param {string} text
 * @param {number} [maxLen] 单个片段最长字数
 * @returns {string[]} 已归一 + 已过滤的键
 */
function chunkKeys(text, maxLen = 8) {
    const raw = stripDateTime(text);
    const re = new RegExp(`[\\u4e00-\\u9fa5A-Za-z]{2,${maxLen}}`, 'g');
    const out = [];

    for (const seg of (raw.match(re) || [])) {
        // 在所有虚词处断开，取各子段
        for (const sub of splitByParticles(seg)) {
            const k = normalizeKey(sub);
            if (isUsefulKey(k)) out.push(k);
        }
    }
    return [...new Set(out)];
}

// 全部虚词（含时间词），按长度降序拼成一个分隔符正则。
// ⚠️ 时间词也要参与切分：「今天在星巴克」的「今天」不是商家名的一部分。
const TIME_WORDS = ['今天', '昨天', '前天', '明天', '早上', '中午', '晚上', '上午', '下午', '刚才', '这个月', '上个月'];
const ALL_PARTICLES = [...LEADING_PARTICLES, ...TRAILING_PARTICLES, ...TIME_WORDS]
    .sort((a, b) => b.length - a.length);
const PARTICLE_SPLIT_RE = new RegExp(ALL_PARTICLES.map(escapeRe).join('|'), 'g');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * 在虚词处切段，原段一并返回作兜底。
 *
 * ⚠️ 不能写成「切剩 1 段就丢弃切分结果」：
 *    「中午外卖」切出 ['外卖']（只 1 段），但那正是我们要的键，
 *    丢掉它会把时间词永久粘在键上。判据应是「切分结果是否等于原段」。
 */
function splitByParticles(seg, keepOriginal = true) {
    const s = String(seg);
    const parts = s.split(PARTICLE_SPLIT_RE).filter(Boolean);
    // 无虚词可切：split 原样返回 [seg]
    if (parts.length === 1 && parts[0] === s) return [s];
    // 商家名本身可能恰好含虚词（如「买买提」），故保留原段兜底，由 Decision Engine 择优
    // ⛔ 商品词场景要传 keepOriginal=false：原段会带回「在/喝」这类残渣
    //    （实测「在星巴克喝咖啡」竟切出「喝咖啡」抢在「咖啡」前面）
    return keepOriginal ? [...parts, s] : parts;
}

/* ── 商品词 / 门店后缀（2026-08-29 新增）───────────────────── */

/**
 * 剥掉门店后缀：「蜜雪冰城(龙湖星悦广场店)」→「蜜雪冰城」。
 *
 * ⛔ 不剥的后果：换一家分店就是另一个键，学到的规则永远命中不了，
 *    而且完全不报错（学习看着在攒分，实际零效果）。
 *    读写两侧必须都归一 —— 这正是本模块存在的理由。
 */
function stripStoreSuffix(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/[（(][^）)]*[）)]/g, '');                     // 括号里的门店名
    s = s.replace(/(?:旗舰店|专营店|直营店|加盟店|连锁店|分店|门店)$/g, '').trim();
    // 裸「店」只在不会把词剥残时才剥（「便利店」不能变成「便利」）
    if (s.length >= 4 && s.endsWith('店')) s = s.slice(0, -1).trim();
    return s.trim();
}

/**
 * 通用动作/渠道词 —— 不是商品，绝不能当类目学习键。
 * 「外卖订单」可以是奶茶、可以是盒饭、也可以是药品，
 * 学「外卖订单 → 零食饮料」等于给所有外卖都盖上同一个类目。
 */
const NON_PRODUCT_KEYS = new Set([
    '外卖', '订单', '配送', '配送费', '支付', '付款', '消费', '支出', '收入',
    '购买', '交易', '账单', '快递', '退款', '优惠', '立减', '红包', '会员', '充值',
    '转账', '收款', '扫码', '商家', '店铺', '商品', '说明', '备注', '详情',
    '数量', '单价', '合计', '总计', '小计', '套餐', '一份', '一杯', '现金', '余额',

    /*  场所 / 渠道：只说明【在哪儿买的】，不说明【买了什么】。
        ⛔ 2026-08-30 实测补入：「超市 买洗衣液」学成了「超市」——
           因为类目词表里「超市」排在日用百货条目第一位，rank 比「洗衣液」还高，
           靠排序救不回来，只能在候选池里就把它剔掉（买菜同理，别去学「菜市场」）。 */
    '超市', '便利店', '商场', '购物中心', '市场', '菜市场', '生鲜超市',
    '食堂', '餐厅', '饭店', '快餐店', '饮品店', '商店', '小卖部', '杂货店',
    '药店', '加油站', '服务区', '网点', '专柜', '门店', '分店',
    '网购', '电商', '平台', '官网', '小程序', '旗舰店',
]);

/** 商品词尾部要剥掉的通用词（「蜜雪冰城外卖订单」→「蜜雪冰城」） */
const NON_PRODUCT_TAILS = [
    '外卖订单', '配送费', '订单', '外卖', '配送', '支付', '付款', '消费', '交易',
    '账单', '快递', '退款', '优惠', '立减', '红包', '充值', '套餐', '商品',
    '说明', '备注', '详情', '一份', '一杯',
];

/** 反复剥离尾部的非商品词，剥到不能再剥为止（至少保留 2 字） */
function stripNonProductTail(raw) {
    let s = normalizeKey(raw);
    const tails = [...NON_PRODUCT_TAILS].sort((a, b) => b.length - a.length);
    let changed = true;
    while (changed && s.length > 0) {
        changed = false;
        for (const w of tails) {
            if (s.endsWith(w) && s.length - w.length >= 2) {
                s = s.slice(0, s.length - w.length);
                changed = true;
                break;
            }
        }
    }
    return s.trim();
}

/**
 * 商品词前导动作词：「买洗衣液」「充话费」「交房租」的动词不是商品。
 *
 * ⚠️ 剥离结果【不直接替换】原词，而是与原词一起进候选池（见 productKey），
 *    由 categoryWordRank 择优 —— 否则会误伤真商品：
 *      「充电宝」剥成「电宝」、「打车」剥成「车」。
 *    而「充电宝」「打车」本身就在类目词表里，rank 更优 → 自动保留原词。
 */
const PRODUCT_LEAD_VERBS = [
    '买了', '买了个', '买的', '买', '充了', '充值', '充', '交了', '交', '付了', '付',
    '吃了', '吃', '喝了', '喝', '点了', '点', '订了', '订', '叫了', '叫',
    '打了', '打', '坐了', '坐', '还了', '还', '存了', '存', '取了', '取', '加了', '加',
];

/** 反复剥离前导动作词，剥到不能再剥为止（至少保留 2 字） */
function stripProductLeadVerb(raw) {
    let s = String(raw || '').trim();
    const verbs = [...PRODUCT_LEAD_VERBS].sort((a, b) => b.length - a.length);
    let changed = true;
    while (changed && s.length > 0) {
        changed = false;
        for (const v of verbs) {
            if (s.startsWith(v) && s.length - v.length >= 2) {
                s = s.slice(v.length); changed = true; break;
            }
        }
    }
    return s.trim();
}

/**
 * 商户名与商品粘连时，剥掉商户、留下商品部分。
 *   「中石化加油」 merchant=中石化 → 「加油」
 *   「淘宝闪购奶茶」merchant=淘宝闪购 → 「奶茶」
 *
 * ⛔ 不剥的后果（2026-08-30 实测）：整段因「包含商户名」被 productKey 剔除，
 *    候选池空 → 回退成用商户当商品词 → 学到的又是商户，白改一圈。
 *
 * @returns {string[]} [剩余部分, 原段]（剩余部分为空时只返回原段）
 */
function splitOffMerchant(seg, mer) {
    if (!mer) return [seg];
    const i = seg.indexOf(mer);
    if (i < 0) return [seg];
    const rest = (seg.slice(0, i) + seg.slice(i + mer.length)).trim();
    return rest ? [rest, seg] : [seg];
}

/**
 * 候选词在类目词表里的命中次序 —— 越小越"像商品"。
 *
 * ⛔ 为什么不能用「取最长段」（2026-08-30 修正，实测 14 例错 8 例）：
 *    商户名/渠道名几乎总是比商品名长 —— 「淘宝闪购 奶茶」取到「淘宝闪购」、
 *    「午餐 公司食堂」取到「公司食堂」。长度排序在记账文本里方向是反的。
 *
 *    判据应是「这个词本身是不是某个类目的关键词」：
 *    词表是本项目对"什么东西算什么类"的唯一真相，命中它 = 它就是被分类的对象。
 *
 * ① 只认【候选包含词表词】（「珍珠奶茶」⊃「奶茶」），不反过来看
 *    （否则「中国」会因「中国移动」被当成话费类商品）。
 * ② 词表**条目内**的顺序也计入：早午晚餐那条里「午餐」排在「食堂」前，
 *    于是「午餐 公司食堂」取「午餐」而不是更长的「公司食堂」。
 *
 * ③ 命中方式分两档（2026-08-30 实测补正）：
 *    【完全命中】优于【包含命中】，包含时再按"多出来的字数"递增惩罚。
 *    否则「充话费」会因包含「话费」与「话费」同分，再被长度规则翻盘选走 ——
 *    同理「喝咖啡」会压过「咖啡」，前导动词剥离白做。
 *
 * @returns {number} 命中则返回 i*10000+j*10(+惩罚)，未命中返回 Infinity
 */
function categoryWordRank(word) {
    const w0 = String(word || '').toLowerCase();
    if (!w0) return Infinity;
    for (let i = 0; i < KEYWORD_TO_CATEGORY.length; i++) {
        const words = KEYWORD_TO_CATEGORY[i].words || [];
        for (let j = 0; j < words.length; j++) {
            const w = String(words[j] || '').toLowerCase();
            if (!w) continue;
            if (w0 === w) return i * 10000 + j * 10;
            // 包含命中：多出的字数越多越可疑（「打车去机场」⊃「打车」应让位给「打车」）
            if (w0.includes(w)) return i * 10000 + j * 10 + 5 + Math.min(w0.length - w.length, 4);
        }
    }
    return Infinity;
}

/**
 * 提取「商品词」—— 真正决定这笔算什么类的东西。
 *
 * ⛔ 商户名不是分类依据（2026-08-29）：一个商户可以卖任何东西
 *    （淘宝闪购今天买奶茶、明天买盒饭），「商户 → 类目」必然错一半。
 *    决定类目的是【买了什么】。
 *
 * ⛔ 必须优先看 raw_segment 而不是 note（2026-08-29 实测）：
 *    note 由 note-composer 拼成「场景-对象」，顺序还不固定 ——
 *    同一个语义能写出「午餐-盒饭」「奶茶-淘宝闪购」「外卖-麻辣烫」三种形态，
 *    按位置取必然取错。raw_segment 是原文，商品名就在里面，且带商户名可排除。
 *
 * 实测覆盖（2026-08-30 重写排序策略后，14 例全过；改前仅 6/14）：
 *   raw「淘宝闪购 盒饭 15元」        merchant=淘宝闪购 → 盒饭
 *   raw「淘宝闪购 奶茶 8元」         merchant=淘宝闪购 → 奶茶
 *   raw「淘宝闪购 奶茶 8元」         merchant=（空）  → 奶茶   ⛔ 改前取到「淘宝闪购」
 *   raw「美团外卖 麻辣烫 30元」      merchant=美团外卖 → 麻辣烫
 *   raw「20:19:15 淘宝闪购 12.71元 备注:蜜雪冰城(龙湖星悦广场店)外卖订单」→ 蜜雪冰城
 *   raw「蜜雪冰城 12元」             merchant=蜜雪冰城 → 蜜雪冰城（商户即品牌，回退）
 *   raw「午餐 公司食堂 刷卡 15元」   merchant=（空）  → 午餐   ⛔ 改前取到「公司食堂」
 *   raw「超市 买洗衣液 25元」        merchant=（空）  → 洗衣液 ⛔ 改前取到「买洗衣液」
 *   raw「在星巴克喝咖啡 35元」       merchant=星巴克   → 咖啡   ⛔ 改前回退成「星巴克」
 *   raw「中石化加油 300元」          merchant=中石化   → 加油   ⛔ 改前回退成「中石化」
 *   raw「充话费 100元」/「交房租 2000元」→ 话费 / 房租（前导动词不是商品）
 *   raw「瑞幸咖啡 生椰拿铁 16元」    merchant=瑞幸咖啡 → 生椰拿铁（词表未收录，按长度兜底）
 *
 * ⚠️ 反向用例（必须保持）：「充电宝」不剥成「电宝」、「打车」不剥成「车」——
 *    二者本身在类目词表里，rank 优于剥离后的残词，故自动保留。
 *
 * @param {string} raw       原文（raw_segment 优先，其次 note）
 * @param {string} [merchant] 已抽取的商户名，用于排除（渠道名不是商品）
 * @returns {string|null}
 */
function productKey(raw, merchant = '') {
    const s = String(raw || '').trim();
    if (!s) return null;
    const mer = normalizeKey(stripStoreSuffix(merchant));

    // 去括号（门店名/规格）→ 去时间 → 去金额，剩下的才是「名词」
    const cleaned = s
        .replace(/[（(][^）)]*[）)]/g, ' ')
        .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
        .replace(/\d+(?:\.\d{1,2})?\s*(?:元|块钱|块)?/g, ' ');
    const segs = cleaned.split(/[\s\-—–_|,，、:：+]+/).filter(Boolean);

    const cands = [];
    for (const seg of segs) {
        // ① 虚词处切段：「在星巴克喝咖啡」→「咖啡」，「打车去机场」→「打车」
        //    ⛔ 必须保留原段兜底（keepOriginal 默认 true）：虚词表里「加油」这类词
        //    本身就是商品（油），只靠切分会把它当分隔符丢掉 ——
        //    实测「中石化加油」改回退成「中石化」。原段再经 ② 剥商户即可救回「加油」。
        //    原段带出的残渣（如「喝咖啡」）由 ④ 的 rank 分档压下去。
        for (const sub of splitByParticles(seg)) {
            // ② 商户与商品粘连时剥出商品部分：「中石化加油」→「加油」
            for (const piece of splitOffMerchant(sub, mer)) {
                // ③ 剥与不剥前导动词两个版本都进池（「买洗衣液」/「洗衣液」），由 ④ 择优
                for (const variant of new Set([piece, stripProductLeadVerb(piece)])) {
                    const t = stripNonProductTail(variant);
                    if (!isUsefulKey(t)) continue;
                    if (NON_PRODUCT_KEYS.has(t)) continue;
                    // 商户名（渠道）不是商品：淘宝闪购只是下单的地方，不是买到的东西
                    if (mer && (t === mer || t.includes(mer) || mer.includes(t))) continue;
                    cands.push(t);
                }
            }
        }
    }

    // ④ 择优：命中类目词表者优先（词表越靠前越优），都不命中时才长者胜
    const uniq = [...new Set(cands)];
    if (uniq.length) {
        return uniq.sort((a, b) => {
            const ra = categoryWordRank(a), rb = categoryWordRank(b);
            if (ra !== rb) return ra - rb;
            return b.length - a.length;
        })[0];
    }

    /*  整句只剩商户名（「蜜雪冰城 12元」）→ 商户本身就是品牌/商品，回退用它。
        「蜜雪冰城」既是商户也是商品，这种回退正是我们要的。 */
    return (mer && isUsefulKey(mer)) ? mer : null;
}

module.exports = {
    normalizeKey, isUsefulKey, chunkKeys, splitByParticles, stripDateTime,
    stripStoreSuffix, stripNonProductTail, productKey,
    stripProductLeadVerb, splitOffMerchant, categoryWordRank,
    NOISE_KEYS, LEADING_PARTICLES, TRAILING_PARTICLES, TIME_WORDS, NON_PRODUCT_KEYS,
};
