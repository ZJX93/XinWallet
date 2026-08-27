/* ============================================
<<<<<<< HEAD
   Evaluation Dataset
   ------------------------------------------------
   覆盖的 12 类场景，逐条给出期望值：
=======
   AI v0.2 · §12 Evaluation Dataset
   ------------------------------------------------
   方案 §12 要求覆盖的 12 类场景，逐条给出期望值：
>>>>>>> d1bc26ad4a8e4ace5968e3c651ba9e0742fd1fb0
     单笔、多笔、收入、支出、转账、模糊表达、日期表达、多个金额、
     中文口语、错误输入、矛盾历史、习惯变化

   ⛔ 期望里的 category_id 全部取自 schema.sql 的真实种子 id（非臆造）：
      23 早午晚餐 / 24 外卖小吃 / 25 零食饮料 / 29 公交地铁 / 30 打车拼车
      31 加油充电 / 33 火车飞机 / 39 房租月供 / 42 话费宽带 / 46 电影演出
      51 会员订阅 / 56 培训考试 / 71 工资薪水 / 74 理财收益 / 14 其他支出 / 21 其他收入
      改类目种子后必须同步本文件，否则评测会集体变红且原因是"期望过时"而非"引擎退化"。

   ⛔ 每条 case 的 expect 只写【真正该断言的字段】：
      写死不该管的字段（如 merchant）会让评测在无关改动上误报。
   ============================================ */

const DATASET_VERSION = 'v1';

// 参考日期：所有相对日期期望都基于此日固定计算，保证评测结果可复现。
// ⛔ 绝不能用 new Date() —— 那样「昨天」的期望值每天都在变，评测无法回归比较。
const REF_DATE = new Date(2026, 7, 25);   // 2026-08-25（月份 0-based）

/** @type {Array<{id:string, scenario:string, text:string, expect:object}>} */
const CASES = [
    // ---------- 场景 1：单笔支出（最基本）----------
    { id: 'single-001', scenario: 'single', text: '午饭25元',
      expect: { count: 1, txns: [{ type: 'expense', amount: 25, category_id: 23, date: '2026-08-25' }] } },
    { id: 'single-002', scenario: 'single', text: '打车38.5',
      expect: { count: 1, txns: [{ type: 'expense', amount: 38.5, category_id: 30 }] } },
    { id: 'single-003', scenario: 'single', text: '星巴克咖啡36',
      expect: { count: 1, txns: [{ type: 'expense', amount: 36, category_id: 25, merchant: '星巴克' }] } },
    { id: 'single-004', scenario: 'single', text: '地铁5块',
      expect: { count: 1, txns: [{ type: 'expense', amount: 5, category_id: 29 }] } },

    // ---------- 场景 2：多笔 ----------
    { id: 'multi-001', scenario: 'multi', text: '早饭12，打车30',
      expect: { count: 2, txns: [
          { type: 'expense', amount: 12, category_id: 23 },
          { type: 'expense', amount: 30, category_id: 30 }] } },
    { id: 'multi-002', scenario: 'multi', text: '午饭25 晚饭38 打车15',
      expect: { count: 3, txns: [
          { type: 'expense', amount: 25, category_id: 23 },
          { type: 'expense', amount: 38, category_id: 23 },
          { type: 'expense', amount: 15, category_id: 30 }] } },
    { id: 'multi-003', scenario: 'multi', text: '加油300；停车20；洗车50',
      expect: { count: 3, txns: [
          { type: 'expense', amount: 300, category_id: 31 },
          { type: 'expense', amount: 20, category_id: 32 },
          { type: 'expense', amount: 50, category_id: 34 }] } },

    // ---------- 场景 3：收入 ----------
    { id: 'income-001', scenario: 'income', text: '工资到账15000',
      expect: { count: 1, txns: [{ type: 'income', amount: 15000, category_id: 71 }] } },
    { id: 'income-002', scenario: 'income', text: '基金收益1200元',
      expect: { count: 1, txns: [{ type: 'income', amount: 1200, category_id: 74 }] } },
    { id: 'income-003', scenario: 'income', text: '收到年终奖50000',
      expect: { count: 1, txns: [{ type: 'income', amount: 50000, category_id: 72 }] } },
    { id: 'income-004', scenario: 'income', text: '房租收入3000',
      expect: { count: 1, txns: [{ type: 'income', amount: 3000, category_id: 75 }] } },

    // ---------- 场景 4：转账 ----------
    { id: 'transfer-001', scenario: 'transfer', text: '转账给妈妈2000',
      expect: { count: 1, txns: [{ type: 'transfer', amount: 2000 }] } },
    { id: 'transfer-002', scenario: 'transfer', text: '从工商银行转 5000 到微信支付',
      expect: { count: 1, txns: [{ type: 'transfer', amount: 5000 }] } },
    { id: 'transfer-003', scenario: 'transfer', text: '还信用卡3800',
      expect: { count: 1, txns: [{ type: 'transfer', amount: 3800 }] } },

    // ---------- 场景 5：模糊表达（应触发 needs_confirmation）----------
    { id: 'fuzzy-001', scenario: 'fuzzy', text: '50',
      expect: { count: 1, verdict: 'needs_confirmation', txns: [{ amount: 50 }] } },
    { id: 'fuzzy-002', scenario: 'fuzzy', text: '买东西100',
      expect: { count: 1, verdict: 'needs_confirmation', txns: [{ type: 'expense', amount: 100 }] } },
    { id: 'fuzzy-003', scenario: 'fuzzy', text: '花了80',
      expect: { count: 1, verdict: 'needs_confirmation', txns: [{ type: 'expense', amount: 80 }] } },

    // ---------- 场景 6：日期表达 ----------
    { id: 'date-001', scenario: 'date', text: '昨天午饭30',
      expect: { count: 1, txns: [{ amount: 30, date: '2026-08-24', category_id: 23 }] } },
    { id: 'date-002', scenario: 'date', text: '前天加油200',
      expect: { count: 1, txns: [{ amount: 200, date: '2026-08-23', category_id: 31 }] } },
    { id: 'date-003', scenario: 'date', text: '8月20日房租2500',
      expect: { count: 1, txns: [{ amount: 2500, date: '2026-08-20', category_id: 39 }] } },
    { id: 'date-004', scenario: 'date', text: '今天话费99',
      expect: { count: 1, txns: [{ amount: 99, date: '2026-08-25', category_id: 42 }] } },

    // ---------- 场景 7：多个金额（单笔里出现数量词）----------
    { id: 'amounts-001', scenario: 'amounts', text: '买了3个苹果15元',
      expect: { count: 1, txns: [{ type: 'expense', amount: 15 }] } },
    { id: 'amounts-002', scenario: 'amounts', text: '2张电影票120',
      expect: { count: 1, txns: [{ type: 'expense', amount: 120, category_id: 46 }] } },

    // ---------- 场景 8：中文口语 ----------
    { id: 'spoken-001', scenario: 'spoken', text: '今天中午跟同事吃了个火锅人均128',
      expect: { count: 1, txns: [{ type: 'expense', amount: 128, category_id: 23 }] } },
    { id: 'spoken-002', scenario: 'spoken', text: '给娃报了个培训班花了3800',
      expect: { count: 1, txns: [{ type: 'expense', amount: 3800, category_id: 56 }] } },
    { id: 'spoken-003', scenario: 'spoken', text: '续费了个视频会员25块',
      expect: { count: 1, txns: [{ type: 'expense', amount: 25, category_id: 51 }] } },
    { id: 'spoken-004', scenario: 'spoken', text: '高铁票买了553',
      expect: { count: 1, txns: [{ type: 'expense', amount: 553, category_id: 33 }] } },

    // ---------- 场景 9：错误输入（不得产出虚假交易）----------
    { id: 'invalid-001', scenario: 'invalid', text: '今天天气不错',
      expect: { count: 0 } },
    { id: 'invalid-002', scenario: 'invalid', text: '',
      expect: { count: 0 } },
    { id: 'invalid-003', scenario: 'invalid', text: '你好啊',
      expect: { count: 0 } },
    { id: 'invalid-004', scenario: 'invalid', text: '午饭 -50',
      // 负金额：抽取器取绝对值或剔除均可，但绝不能落成负数污染账本
      expect: { count: 1, txns: [{ amount: 50 }] } },

    // ---------- 场景 10：矛盾历史（记忆与关键词冲突时，关键词优先）----------
    { id: 'conflict-001', scenario: 'conflict', text: '美团外卖35',
      expect: { count: 1, txns: [{ type: 'expense', amount: 35, category_id: 24 }] },
      // 注入一条指向「零食饮料」的 verified 规则：置信度 0.88 < 关键词 0.90，不应覆盖
      memory: { candidates: [{ layer: 'procedural', source: 'learned_rule_verified', priority: 30,
          match_key: '美团', field: 'category', category_id: 25, confidence: 0.88, rule_id: 9001 }] } },
    { id: 'conflict-002', scenario: 'conflict', text: '美团外卖35',
      expect: { count: 1, txns: [{ category_id: 25 }] },
      // 同样的输入，但规则是 manual（0.97 > 0.90）→ 必须覆盖关键词
      memory: { candidates: [{ layer: 'procedural', source: 'manual_rule', priority: 10,
          match_key: '美团', field: 'category', category_id: 25, confidence: 0.97, rule_id: 9002 }] } },

    // ---------- 场景 11：习惯变化（兜底类目应被记忆覆盖）----------
    { id: 'habit-001', scenario: 'habit', text: '老王家小卖部28',
      expect: { count: 1, txns: [{ category_id: 14 }] } },   // 无记忆时兜底「其他支出」
    { id: 'habit-002', scenario: 'habit', text: '老王家小卖部28',
      expect: { count: 1, txns: [{ category_id: 35 }] },     // 有习惯记忆时应改判「日用百货」
      memory: { candidates: [{ layer: 'semantic', source: 'semantic_memory', priority: 40,
          match_key: '老王家小卖部', field: 'category', category_id: 35, confidence: 0.82 }] } },

    // ---------- 场景 12：负面记忆（否证后不应采纳）----------
    { id: 'negative-001', scenario: 'negative', text: '京东耳机399',
      expect: { count: 1, txns: [{ category_id: 37 }] } },    // 关键词「耳机」→ 数码电器

    // ---------- 场景 13：商家键归一（学习闭环的命门）----------
    // ⛔ 这组用例锁死 2026-08-25 抓到的真实缺陷：
    //    抽取出的 merchant 会直接成为 ai_rules.match_key（写侧），
    //    而下次识别按归一后的键去查规则（读侧）。若抽取时带上「在」这类介词，
    //    写进去的是「在老王超市」、查出来用的是「老王超市」——
    //    规则永远命中不了自己，「越用越聪明」彻底失效，而且【完全不报错】。
    //    所以商家值本身必须断言，不能只断言类目。
    { id: 'mkey-001', scenario: 'merchant_key', text: '在老王超市花了38元',
      expect: { count: 1, txns: [{ amount: 38, merchant: '老王超市' }] } },
    { id: 'mkey-002', scenario: 'merchant_key', text: '去老王超市买了水 12',
      expect: { count: 1, txns: [{ amount: 12, merchant: '老王超市' }] } },
    // 商家后直接跟金额、无动词：最自然的输入之一，原先抽不到商家 ⇒ 学不到任何习惯
    { id: 'mkey-003', scenario: 'merchant_key', text: '在老王超市 38元',
      expect: { count: 1, txns: [{ amount: 38, merchant: '老王超市' }] } },
    // 时间词粘连：「今天在」不该出现在商家名里
    { id: 'mkey-004', scenario: 'merchant_key', text: '今天在星巴克喝咖啡 35',
      expect: { count: 1, txns: [{ amount: 35, merchant: '星巴克', category_id: 25 }] } },
    // 含「了」的商家名不得被虚词切分误伤（饿了么 ≠ 饿 + 么）
    { id: 'mkey-005', scenario: 'merchant_key', text: '饿了么点了个外卖 28',
      expect: { count: 1, txns: [{ amount: 28, merchant: '饿了么', category_id: 24 }] } },
];

/**
 * 构造评测所需的类目表（与 schema.sql 种子一致的最小子集）。
 * 离线跑批不连库，故此处内联；id 必须与 schema.sql 完全一致。
 */
const CATEGORIES = [
    // 支出一级
    { id: 1, name: '餐饮', type: 'expense', parent_id: null },
    { id: 2, name: '交通出行', type: 'expense', parent_id: null },
    { id: 3, name: '购物消费', type: 'expense', parent_id: null },
    { id: 4, name: '居家生活', type: 'expense', parent_id: null },
    { id: 5, name: '休闲娱乐', type: 'expense', parent_id: null },
    { id: 6, name: '医疗健康', type: 'expense', parent_id: null },
    { id: 7, name: '学习进修', type: 'expense', parent_id: null },
    { id: 9, name: '人情往来', type: 'expense', parent_id: null },
    { id: 11, name: '育儿亲子', type: 'expense', parent_id: null },
    { id: 14, name: '其他支出', type: 'expense', parent_id: null },
    { id: 901, name: '投资理财', type: 'expense', parent_id: null },
    // 餐饮
    { id: 23, name: '早午晚餐', type: 'expense', parent_id: 1 },
    { id: 24, name: '外卖小吃', type: 'expense', parent_id: 1 },
    { id: 25, name: '零食饮料', type: 'expense', parent_id: 1 },
    { id: 26, name: '烟酒', type: 'expense', parent_id: 1 },
    { id: 27, name: '聚餐请客', type: 'expense', parent_id: 1 },
    { id: 28, name: '生鲜食材', type: 'expense', parent_id: 1 },
    { id: 281, name: '粮油调味', type: 'expense', parent_id: 1 },
    // 交通
    { id: 29, name: '公交地铁', type: 'expense', parent_id: 2 },
    { id: 30, name: '打车拼车', type: 'expense', parent_id: 2 },
    { id: 31, name: '加油充电', type: 'expense', parent_id: 2 },
    { id: 32, name: '停车过路', type: 'expense', parent_id: 2 },
    { id: 33, name: '火车飞机', type: 'expense', parent_id: 2 },
    { id: 34, name: '维保车险', type: 'expense', parent_id: 2 },
    // 购物
    { id: 35, name: '日用百货', type: 'expense', parent_id: 3 },
    { id: 36, name: '服饰美容', type: 'expense', parent_id: 3 },
    { id: 37, name: '数码电器', type: 'expense', parent_id: 3 },
    { id: 38, name: '家居家具', type: 'expense', parent_id: 3 },
    // 居家
    { id: 39, name: '房租月供', type: 'expense', parent_id: 4 },
    { id: 40, name: '水电燃气', type: 'expense', parent_id: 4 },
    { id: 41, name: '物业维修', type: 'expense', parent_id: 4 },
    { id: 42, name: '话费宽带', type: 'expense', parent_id: 4 },
    { id: 43, name: '社保保险', type: 'expense', parent_id: 4 },
    { id: 44, name: '日用杂货', type: 'expense', parent_id: 4 },
    { id: 45, name: '快递邮寄', type: 'expense', parent_id: 4 },
    // 娱乐
    { id: 46, name: '电影演出', type: 'expense', parent_id: 5 },
    { id: 47, name: '游戏电竞', type: 'expense', parent_id: 5 },
    { id: 48, name: '运动健身', type: 'expense', parent_id: 5 },
    { id: 49, name: '旅游度假', type: 'expense', parent_id: 5 },
    { id: 50, name: '宠物开销', type: 'expense', parent_id: 5 },
    { id: 51, name: '会员订阅', type: 'expense', parent_id: 5 },
    // 医疗
    { id: 52, name: '门诊药品', type: 'expense', parent_id: 6 },
    { id: 53, name: '体检住院', type: 'expense', parent_id: 6 },
    { id: 54, name: '牙科眼科', type: 'expense', parent_id: 6 },
    { id: 55, name: '保健养生', type: 'expense', parent_id: 6 },
    // 学习
    { id: 56, name: '培训考试', type: 'expense', parent_id: 7 },
    { id: 57, name: '书本文具', type: 'expense', parent_id: 7 },
    { id: 58, name: '知识付费', type: 'expense', parent_id: 7 },
    // 人情
    { id: 59, name: '孝敬父母', type: 'expense', parent_id: 9 },
    { id: 60, name: '送礼红包', type: 'expense', parent_id: 9 },
    { id: 61, name: '慈善捐赠', type: 'expense', parent_id: 9 },
    { id: 62, name: '请客招待', type: 'expense', parent_id: 9 },
    // 育儿
    { id: 67, name: '奶粉尿布', type: 'expense', parent_id: 11 },
    { id: 68, name: '玩具童书', type: 'expense', parent_id: 11 },
    { id: 69, name: '学费培训', type: 'expense', parent_id: 11 },
    { id: 70, name: '医疗保健', type: 'expense', parent_id: 11 },
    // 投资
    { id: 902, name: '投资买入', type: 'expense', parent_id: 901 },
    { id: 903, name: '理财保险', type: 'expense', parent_id: 901 },
    // 收入
    { id: 15, name: '职业收入', type: 'income', parent_id: null },
    { id: 17, name: '被动收入', type: 'income', parent_id: null },
    { id: 18, name: '兼职副业', type: 'income', parent_id: null },
    { id: 21, name: '其他收入', type: 'income', parent_id: null },
    { id: 71, name: '工资薪水', type: 'income', parent_id: 15 },
    { id: 72, name: '奖金绩效', type: 'income', parent_id: 15 },
    { id: 73, name: '补贴报销', type: 'income', parent_id: 15 },
    { id: 74, name: '理财收益', type: 'income', parent_id: 17 },
    { id: 75, name: '房租收入', type: 'income', parent_id: 17 },
    { id: 76, name: '分红利息', type: 'income', parent_id: 17 },
    { id: 77, name: '自由职业', type: 'income', parent_id: 18 },
    { id: 78, name: '咨询服务', type: 'income', parent_id: 18 },
    { id: 79, name: '自媒体创作', type: 'income', parent_id: 18 },
    { id: 80, name: '电商微商', type: 'income', parent_id: 18 },
    // 转账
    { id: 22, name: '一般转账', type: 'transfer', parent_id: null },
    { id: 91, name: '贷款债务', type: 'transfer', parent_id: null },
    { id: 92, name: '其他转账', type: 'transfer', parent_id: null },
    { id: 93, name: '银行转账', type: 'transfer', parent_id: 22 },
    { id: 94, name: '信用卡还款', type: 'transfer', parent_id: 22 },
    { id: 95, name: '存款取款', type: 'transfer', parent_id: 22 },
];

/** 按场景分组统计（便于报告分场景准确率） */
function scenarios() {
    return [...new Set(CASES.map(c => c.scenario))];
}

module.exports = { CASES, CATEGORIES, REF_DATE, DATASET_VERSION, scenarios };
