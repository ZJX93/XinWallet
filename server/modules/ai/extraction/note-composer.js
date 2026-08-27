/* ============================================
   备注生成器（「场景-对象」格式）
   ------------------------------------------------
   ⛔⛔ 这个模块存在的理由是一次实测暴露的能力回归（2026-08-25）：

     legacy 的做法是在 OCR prompt 里写一整段规则，请 LLM【自己】把 note
     写成「场景-对象」（例：`早餐-老乡鸡`、`买菜-张三`）。legacy 解析器删除后，
     那段 prompt 一起消失，而 v0.2 抽取器给的是 `note: seg`（原始片段），
     `resolveNote()` 第一行又是 `if (note) return note` 直接放行 ⇒
     真实落账备注变成：

       ❌ `2026年8月20日老乡鸡 18元`      ← 日期、金额全冗余在备注里
       ✅ `早午晚餐-老乡鸡`               ← 本模块产出

     `deterministic-extractor.js:69` 当时的注释写着「commit 时经 resolveNote
     规范化」，但 resolveNote 从来没做过规范化 —— 注释与实现不符，
     而且不报任何错，只能靠人肉看备注才能发现。

   ⛔ 为什么放服务端而不是塞回 prompt：
      备注格式是【确定性规则】，不该依赖模型听不听话。同一笔交易
      在图片通道和文字通道必须得到完全一致的备注，靠 prompt 做不到这点
      （不同服务商、不同温度、甚至同一模型两次调用都可能不一样）。

   ⛔ 唯一真相：全项目只有这里生成「场景-对象」备注。
      别在路由层、prompt 或客户端再写第二套 —— 两份实现漂移后，
      用户会看到「有些账的备注是这个格式，有些不是」，且极难定位。
   ============================================ */

/*  ⛔ 日期/时间剥离【复用】`memory/keys.js` 的 `stripDateTime`，不在这里重写。
    本项目已因「同一逻辑两侧各写一套」踩坑三次（记忆键归一、note 规范化、
    多模态 content 构造）。日期规则若在这里再写一份，两份漂移后的表现是：
    备注剥干净了、学习键却还粘着日期残渣（或反之），而且完全不报错。 */
const { stripDateTime } = require('../memory/keys');

// 商家名不该出现在「场景」位置。这些是明显的噪声词，做场景时一律跳过。
const SCENE_STOPWORDS = new Set(['消费', '支出', '收入', '付款', '收款', '交易', '订单', '其他']);

/*  需要从原始片段里剥掉的成分（日期时间已由 stripDateTime 处理，这里只管其余）。
    ⛔ 顺序有讲究：必须先剥「带单位的金额」再剥「裸数字」——
       否则 `18元` 的 `18` 先被裸数字规则吃掉，留下孤零零的 `元`。 */
const STRIP_PATTERNS = [
    // 相对日期（stripDateTime 只处理与数字捆绑的绝对日期，相对日期在此剥）
    /(前天|昨天|今天|明天|后天|上午|下午|中午|早上|晚上|凌晨)/g,
    // 金额：¥18.00 / 18元 / 18块 / 花了18 / -26.5
    /[¥￥]\s*\d+(\.\d+)?/g,
    /\d+(\.\d+)?\s*(元|块|块钱|圆|rmb|cny)/gi,
    /(花了|花|付了|付|支出|收入|收到|赚了)\s*\d+(\.\d+)?/g,
    // 裸小数/整数（放最后，前面该带单位的都已剥掉）
    /-?\d+(\.\d+)?/g,
];

// 剥离后残留的连接词/标点（单独成段就没意义了）
const TRIM_NOISE = /^[\s,，。;；:：、~～\-—_/|·"'`（）()【】\[\]{}和跟与在于了的]+|[\s,，。;；:：、~～\-—_/|·"'`（）()【】\[\]{}和跟与在于了的]+$/g;

/**
 * 从原始片段里剥掉日期/时间/金额，留下语义部分（可能为空）。
 * @param {string} seg
 * @returns {string}
 */
function stripQuantities(seg) {
    if (!seg || typeof seg !== 'string') return '';
    let s = stripDateTime(seg);   // 先整体剥绝对日期/时间（唯一真相在 memory/keys.js）
    for (const re of STRIP_PATTERNS) s = s.replace(re, ' ');
    return s.replace(/\s+/g, ' ').replace(TRIM_NOISE, '').trim();
}

/*  场景线索词：出现其中之一就说明这段残余描述的是「做了什么」，
    而不是商家名的一部分。刻意只收动词与明确场景名词，宁缺勿滥 ——
    误判为场景的代价是备注变怪（`出行-滴滴`），
    误判为商家尾巴的代价只是退回类目名（`打车拼车-滴滴`，完全可读）。 */
const SCENE_VERB_HINT = /[吃喝买充加办付缴修洗剪看学订租借还捐送购餐饭菜宵夜早午晚车]/;

/**
 * 判断「摘掉商家名后的残余」是否真的能当场景用。
 *
 * ⛔ 这个判断是本模块最容易写错的地方（实测踩过）：
 *    抽取到的商家常是【全称的一部分】（词典里是「滴滴」，票据上写「滴滴出行」；
 *    词典「永辉」vs 票据「永辉超市」）。直接 split 掉商家名，剩下的不是场景，
 *    而是被腰斩的商家名尾巴：
 *      ❌ 「滴滴出行」- 「滴滴」= 「出行」 → `出行-滴滴`（读起来莫名其妙）
 *      ❌ 「永辉超市」- 「永辉」= 「超市」 → `超市-永辉`
 *    正确结果应退回类目名：`打车拼车-滴滴`、`日用百货-永辉`。
 *
 * 判据是【残余在原文里是否与商家名直接相连，且不含动作线索】：
 * 相连且无动作词 ⇒ 它本就是同一个词的一部分，不是独立语义单元。
 * 「在老乡鸡吃午饭」的「吃午饭」虽也紧跟商家，但含动作词「吃」⇒ 可用。
 *
 * @param {string} scene 摘掉商家名后的残余
 * @param {string} leftover 摘除前的残余（已剥掉日期金额）
 * @param {string} obj 商家名
 * @returns {boolean}
 */
function isUsableScene(scene, leftover, obj) {
    if (!scene || SCENE_STOPWORDS.has(scene)) return false;
    if (!obj) return true;

    const glued = leftover.includes(`${obj}${scene}`) || leftover.includes(`${scene}${obj}`);
    if (glued && !SCENE_VERB_HINT.test(scene)) return false;

    return true;
}

/**
 * 生成「场景-对象」格式备注。
 *
 * 场景来源优先级（都是【已确定】的信息，不猜）：
 *   1. 原始片段里剥掉日期金额后的剩余语义（最贴近用户原话，如「买菜」「打车去机场」）
 *   2. 类目名（如「早午晚餐」「打车拼车」）—— 兜底但一定有意义
 * 对象来源：抽取到的商家名。
 *
 * ⚠️ 场景与对象重复时【只保留一个】：类目「打车拼车」+ 商家「滴滴」拼成
 *    `打车拼车-滴滴` 是对的；但剩余语义正好等于商家名时（片段就只有个商家名），
 *    拼成 `老乡鸡-老乡鸡` 是荒谬的 ⇒ 此时改用类目名作场景。
 *
 * @param {object} p
 * @param {string} [p.segment]      原始片段（抽取器的 raw_segment）
 * @param {string} [p.merchant]     商家名
 * @param {string} [p.categoryName] 类目名
 * @returns {string} 备注；信息完全不足时返回 ''（交由 resolveNote 兜底类目名）
 */
function composeNote({ segment, merchant, categoryName } = {}) {
    const obj = (merchant || '').trim();
    const leftover = stripQuantities(segment);

    /*  候选场景：优先用户原话残余，其次类目名。
        ⛔ 必须排除「残余就等于商家名」的情况 —— 否则出现 `老乡鸡-老乡鸡`。
           这种情况在图片通道是【常态】：票据预处理产出的语句往往就是
           「日期 + 商户名 + 金额」，剥完只剩商户名。 */
    let scene = '';
    const leftoverIsJustMerchant = obj && leftover
        && (leftover === obj || leftover.replace(/\s/g, '') === obj.replace(/\s/g, ''));

    if (leftover && !leftoverIsJustMerchant && !SCENE_STOPWORDS.has(leftover)) {
        /*  残余里可能仍夹着商家名（如「在老乡鸡吃午饭」剥完 = 「在老乡鸡吃午饭」）。
            把商家名摘掉后若还有内容，那才是纯粹的场景（「吃午饭」）。 */
        const withoutMerchant = obj
            ? leftover.split(obj).join(' ').replace(/\s+/g, ' ').replace(TRIM_NOISE, '').trim()
            : leftover;
        scene = isUsableScene(withoutMerchant, leftover, obj)
            ? withoutMerchant
            : (categoryName || '').trim();
    } else {
        scene = (categoryName || '').trim();
    }

    // 场景兜底：类目名也没有时，只能退回对象名单独成注
    if (!scene) return obj || '';
    if (!obj) return scene;
    // 场景已包含对象（如场景「滴滴打车」+ 对象「滴滴」）就不再拼，避免啰嗦
    if (scene.includes(obj)) return scene;

    return `${scene}-${obj}`;
}

module.exports = { composeNote, stripQuantities };
