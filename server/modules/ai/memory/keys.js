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
function splitByParticles(seg) {
    const s = String(seg);
    const parts = s.split(PARTICLE_SPLIT_RE).filter(Boolean);
    // 无虚词可切：split 原样返回 [seg]
    if (parts.length === 1 && parts[0] === s) return [s];
    // 商家名本身可能恰好含虚词（如「买买提」），故保留原段兜底，由 Decision Engine 择优
    return [...parts, s];
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
 * 实测覆盖：
 *   raw「淘宝闪购 盒饭 15元」        merchant=淘宝闪购 → 盒饭
 *   raw「淘宝闪购 奶茶 8元」         merchant=淘宝闪购 → 奶茶
 *   raw「美团外卖 麻辣烫 30元」      merchant=美团外卖 → 麻辣烫
 *   raw「20:19:15 淘宝闪购 12.71元 备注:蜜雪冰城(龙湖星悦广场店)外卖订单」→ 蜜雪冰城
 *   raw「蜜雪冰城 12元」             merchant=蜜雪冰城 → 蜜雪冰城（商户即品牌，回退）
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
        const t = stripNonProductTail(seg);
        if (!isUsefulKey(t)) continue;
        if (NON_PRODUCT_KEYS.has(t)) continue;
        // 商户名（渠道）不是商品：淘宝闪购只是下单的地方，不是买到的东西
        if (mer && (t === mer || t.includes(mer) || mer.includes(t))) continue;
        cands.push(t);
    }
    if (cands.length) return cands.sort((a, b) => b.length - a.length)[0];

    /*  整句只剩商户名（「蜜雪冰城 12元」）→ 商户本身就是品牌/商品，回退用它。
        「蜜雪冰城」既是商户也是商品，这种回退正是我们要的。 */
    return (mer && isUsefulKey(mer)) ? mer : null;
}

module.exports = {
    normalizeKey, isUsefulKey, chunkKeys, splitByParticles, stripDateTime,
    stripStoreSuffix, stripNonProductTail, productKey,
    NOISE_KEYS, LEADING_PARTICLES, TRAILING_PARTICLES, TIME_WORDS, NON_PRODUCT_KEYS,
};
