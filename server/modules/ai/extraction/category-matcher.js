/* ============================================
   确定性抽取器 —— 类目匹配
   ------------------------------------------------
   类目必须落到【真实存在的 categories.id】，绝不能凭模型臆造 id。
   匹配顺序：关键词 → 类目名直配 → 兜底「其他支出/其他收入」。
   兜底时置信度压到阈值以下，强制用户确认（落实 v0.2「不确定就问」）。

   ⛔ 词表维护铁律（2026-08-25 合并 legacy 词表时确立）：
   1. `cat` 必须写【真实 categories 表里的叶子类目名】，不要写「交通」「居住」这类
      臆想的一级名 —— 真表叫「交通出行 / 居家生活」，写错会静默退化成「其他支出」
      （靠 findCategory 的包含匹配只能兜住一部分，兜不住的置信度掉到 0.55）。
   2. 本表是【收支方向的单一真相】：type-extractor.js 的 INCOME_WORDS / EXPENSE_WORDS
      从本表派生，禁止在那边另写一份词表（曾因两份不同步导致「基金收益」被判成支出）。
   3. 改动后必须跑 `server/modules/ai/__tests__/category-consistency.test.js`，
      它会校验每个 cat 都能在真实类目表命中。

   📌 本表已合并原 `server/routes/ai.js:fallbackExtractItems`（344 行 legacy OCR 解析器）
      的商户名词库（肯德基/星巴克/滴滴/顺丰/中石化…），这是 legacy 唯一的独有资产。
      legacy 的「按支付时间推断早/午/晚餐」逻辑【刻意未移植】：真实类目表已把三餐
      合并为单一叶子「早午晚餐」，时间推断没有落点了。
   ============================================ */

// 关键词 → 真实叶子类目名。顺序 = 优先级（先命中先返回），故具体条目必须排在泛化条目之前。
const KEYWORD_TO_CATEGORY = [
    // ========== 交通出行 ==========
    // ⚠️ 「美团单车」必须排在「外卖小吃」的「美团」之前，否则骑行费会被归到外卖
    { words: ['地铁', '公交', '一卡通', '交通卡', '共享单车', '哈啰', '青桔', '美团单车', '单车', '骑行'], cat: '公交地铁', type: 'expense' },
    { words: ['打车', '滴滴', '曹操出行', 't3出行', '首汽', '花小猪', '出租车', '的士', '拼车', '网约车'], cat: '打车拼车', type: 'expense' },
    { words: ['加油', '加油站', '中石化', '中石油', '汽油', '柴油', '充电桩', '特来电', '星星充电', '充电费'], cat: '加油充电', type: 'expense' },
    { words: ['停车', '停车场', '车位', '泊车', '过路费', '高速费', '通行费', 'etc'], cat: '停车过路', type: 'expense' },
    { words: ['火车', '高铁', '动车', '机票', '飞机', '12306', '航旅', '航班'], cat: '火车飞机', type: 'expense' },
    { words: ['保养', '维保', '车险', '洗车', '轮胎', '4s店', '年检', '违章'], cat: '维保车险', type: 'expense' },

    // ========== 餐饮 ==========
    { words: ['外卖', '美团', '饿了么', '配送费', '肯德基', '麦当劳', '汉堡王', '必胜客', '华莱士', '德克士', '汉堡', '炸鸡', '披萨', '麻辣烫', '冒菜', '米线', '盒饭', '盖饭', '便当', '小吃'], cat: '外卖小吃', type: 'expense' },
    { words: ['星巴克', '瑞幸', '咖啡', '奶茶', '喜茶', '奈雪', '蜜雪', '古茗', '霸王茶姬', '一点点', 'coco', '乐乐茶', '饮料', '可乐', '雪碧', '矿泉水', '零食', '薯片', '坚果', '瓜子', '巧克力', '冰淇淋', '雪糕', '甜品', '蛋糕', '面包', '烘焙', '水果'], cat: '零食饮料', type: 'expense' },
    { words: ['聚餐', '请客', '饭局', '酒席', '海底捞', '呷哺', '西贝', '太二', '绿茶餐厅', '外婆家', '探鱼', '宴请'], cat: '聚餐请客', type: 'expense' },
    // ⚠️ 不要收录裸「酒」字：会误命中「酒店」→ 应归旅游度假
    { words: ['香烟', '卷烟', '烟酒', '白酒', '啤酒', '红酒', '洋酒', '酒水'], cat: '烟酒', type: 'expense' },
    { words: ['买菜', '生鲜', '菜市场', '盒马', '永辉', '叮咚买菜', '每日优鲜', '蔬菜', '水产', '海鲜'], cat: '生鲜食材', type: 'expense' },
    { words: ['大米', '食用油', '面粉', '调味', '酱油', '食盐', '挂面'], cat: '粮油调味', type: 'expense' },
    { words: ['早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '吃饭', '食堂', '正餐', '夜宵', '宵夜', '烧烤', '火锅', '餐厅', '饭店', '炒菜', '面条', '饺子', '馄饨', '包子', '豆浆', '油条', '肠粉', '煎饼', '炒饭'], cat: '早午晚餐', type: 'expense' },

    // ========== 购物消费 ==========
    { words: ['超市', '便利店', '百货', '日用品', '纸巾', '洗衣液', '垃圾袋', '清洁用品', '沃尔玛', '山姆', '家乐福', '全家', '罗森'], cat: '日用百货', type: 'expense' },
    { words: ['衣服', '服装', '裤子', '鞋', '袜子', '帽子', '围巾', '化妆品', '护肤', '面膜', '精华', '乳液', '防晒', '洗面奶', '美容', '美发', '理发', '烫发', '染发', '洗剪吹', '美甲'], cat: '服饰美容', type: 'expense' },
    { words: ['数码', '手机', '电脑', '耳机', '平板', '充电宝', '鼠标', '键盘', '显示器', '相机', '冰箱', '洗衣机', '空调', '电视', '家电'], cat: '数码电器', type: 'expense' },
    { words: ['家居', '家具', '床垫', '桌子', '椅子', '衣柜', '沙发', '台灯', '窗帘', '收纳'], cat: '家居家具', type: 'expense' },

    // ========== 居家生活 ==========
    { words: ['房租', '租金', '房东', '中介费', '租房', '房贷', '月供'], cat: '房租月供', type: 'expense' },
    { words: ['水电', '电费', '水费', '燃气', '煤气', '天然气', '取暖', '暖气费'], cat: '水电燃气', type: 'expense' },
    { words: ['物业', '物管', '管理费', '维修', '修理', '疏通', '漏水', '家政', '保洁'], cat: '物业维修', type: 'expense' },
    { words: ['话费', '手机费', '流量', '充值话费', '宽带', '网费', '光纤', 'wifi', '中国移动', '中国联通', '中国电信'], cat: '话费宽带', type: 'expense' },
    { words: ['社保', '公积金', '保险', '保费', '医保'], cat: '社保保险', type: 'expense' },
    { words: ['快递', '顺丰', '圆通', '中通', '申通', '韵达', '邮政', 'ems', '菜鸟', '邮寄', '运费'], cat: '快递邮寄', type: 'expense' },
    { words: ['杂货', '五金', '电池', '灯泡'], cat: '日用杂货', type: 'expense' },

    // ========== 休闲娱乐 ==========
    // ⚠️ 「门票」归旅游度假：景点门票远多于演出门票
    { words: ['旅游', '旅行', '度假', '景点', '门票', '酒店', '民宿', '携程', '飞猪', '跟团', '签证'], cat: '旅游度假', type: 'expense' },
    { words: ['电影', '影院', '猫眼', '淘票票', 'imax', '演出', '话剧', '音乐会', '演唱会', '展览'], cat: '电影演出', type: 'expense' },
    { words: ['游戏', 'steam', 'switch', 'ps5', 'xbox', '手游', '点券', '皮肤', '电竞', '网吧'], cat: '游戏电竞', type: 'expense' },
    { words: ['健身', '健身房', '跑步', '瑜伽', '游泳', '私教', '羽毛球', '篮球', '足球', '运动', '器械'], cat: '运动健身', type: 'expense' },
    { words: ['宠物', '猫粮', '狗粮', '猫砂', '冻干', '宠物医院', '驱虫'], cat: '宠物开销', type: 'expense' },
    { words: ['会员', '订阅', 'netflix', 'spotify', '腾讯视频', '爱奇艺', '优酷', 'b站', '哔哩哔哩', 'icloud', 'chatgpt', '续费'], cat: '会员订阅', type: 'expense' },

    // ========== 医疗健康 ==========
    { words: ['门诊', '挂号', '看病', '诊所', '药', '药品', '药房', '药店', '处方', '输液', '化验'], cat: '门诊药品', type: 'expense' },
    { words: ['体检', '住院', '手术', '病房', '疫苗'], cat: '体检住院', type: 'expense' },
    { words: ['牙科', '补牙', '拔牙', '洗牙', '正畸', '牙医', '眼科', '配镜', '眼镜', '隐形眼镜'], cat: '牙科眼科', type: 'expense' },
    { words: ['保健', '养生', '按摩', '推拿', '中医', '理疗', '维生素', '保健品'], cat: '保健养生', type: 'expense' },

    // ========== 学习进修 ==========
    { words: ['培训', '课程', '网课', '补习', '辅导班', '学而思', '新东方', '考试', '报名费', '雅思', '托福', '考研', '考公', '学费', '驾校'], cat: '培训考试', type: 'expense' },
    { words: ['书籍', '教材', '书店', '当当', 'kindle', '文具', '本子', '书'], cat: '书本文具', type: 'expense' },
    { words: ['知识付费', '付费专栏', '得到', '喜马拉雅', '付费课'], cat: '知识付费', type: 'expense' },

    // ========== 人情往来 ==========
    { words: ['孝敬', '给父母', '给爸', '给妈', '赡养', '长辈'], cat: '孝敬父母', type: 'expense' },
    { words: ['红包', '送礼', '礼物', '份子钱', '彩礼', '伴手礼', '人情'], cat: '送礼红包', type: 'expense' },
    { words: ['捐款', '捐赠', '慈善', '公益'], cat: '慈善捐赠', type: 'expense' },
    { words: ['招待', '商务宴请', '接待'], cat: '请客招待', type: 'expense' },

    // ========== 育儿亲子 ==========
    { words: ['奶粉', '尿布', '纸尿裤', '辅食', '奶瓶'], cat: '奶粉尿布', type: 'expense' },
    { words: ['玩具', '童书', '积木', '绘本', '乐高'], cat: '玩具童书', type: 'expense' },

    // ========== 投资理财（支出侧：买入） ==========
    { words: ['买基金', '买股票', '申购', '定投', '加仓', '投资'], cat: '投资买入', type: 'expense' },
    { words: ['理财保险', '年金', '增额寿', '万能险'], cat: '理财保险', type: 'expense' },

    // ========== 收入 ==========
    { words: ['工资', '薪水', '月薪', '发薪', '工资条', '底薪', '薪资'], cat: '工资薪水', type: 'income' },
    { words: ['奖金', '年终奖', '绩效', '提成', '季度奖', '全勤'], cat: '奖金绩效', type: 'income' },
    { words: ['补贴', '报销', '差旅', '餐补', '交通补', '房补', '津贴'], cat: '补贴报销', type: 'income' },
    { words: ['理财收益', '基金收益', '余额宝', '投资收益', '收益到账'], cat: '理财收益', type: 'income' },
    { words: ['分红', '利息', '股息'], cat: '分红利息', type: 'income' },
    { words: ['房租收入', '收租', '出租收入'], cat: '房租收入', type: 'income' },
    { words: ['自由职业', '接单', '私活', '外包'], cat: '自由职业', type: 'income' },
    { words: ['咨询费', '顾问费'], cat: '咨询服务', type: 'income' },
    { words: ['自媒体', '稿费', '打赏收入', '广告分成', '创作收益'], cat: '自媒体创作', type: 'income' },
    { words: ['电商', '微商', '带货', '店铺收入'], cat: '电商微商', type: 'income' },
    { words: ['退款', '返现', '中奖', '收红包', '红包收入', '卖出所得', '二手卖'], cat: '其他收入', type: 'income' },
];

/**
 * 匹配类目。
 * @param {string} text 交易文本片段
 * @param {'income'|'expense'|'transfer'} type 已抽取的交易类型
 * @param {Array<{id:number,name:string,type:string,code?:string}>} categories 该用户可用类目
 * @returns {{value:string, category_id:number|null, source:string, confidence:number}}
 */
function matchCategory(text, type, categories = []) {
    const lower = (text || '').toLowerCase();

    // 转账不走类目关键词匹配：项目约定「转账」是顶层叶子类目
    if (type === 'transfer') {
        const t = categories.find(c => c.type === 'transfer' || c.name === '转账');
        return {
            value: t ? t.name : '转账',
            category_id: t ? t.id : null,
            source: t ? 'transfer_category' : 'transfer_missing',
            confidence: t ? 0.95 : 0.40,
        };
    }

    // 1) 关键词 → 类目名 → 在真实类目表里查 id
    for (const entry of KEYWORD_TO_CATEGORY) {
        if (entry.type !== type) continue;
        for (const w of entry.words) {
            if (lower.includes(w.toLowerCase())) {
                const hit = findCategory(categories, entry.cat, type);
                if (hit) {
                    return { value: hit.name, category_id: hit.id, source: 'keyword_match', confidence: 0.90 };
                }
                // 关键词命中但该类目在用户账本里不存在 → 降级为兜底，但记下语义
                const fb = fallbackCategory(categories, type);
                return {
                    value: fb ? fb.name : entry.cat,
                    category_id: fb ? fb.id : null,
                    source: 'keyword_hit_but_category_absent',
                    confidence: 0.55,
                };
            }
        }
    }

    // 2) 类目名直接出现在文本里（用户自建类目也能命中）
    const direct = categories
        .filter(c => c.type === type && c.name && c.name.length >= 2)
        .sort((a, b) => b.name.length - a.name.length)
        .find(c => lower.includes(c.name.toLowerCase()));
    if (direct) {
        return { value: direct.name, category_id: direct.id, source: 'category_name_direct', confidence: 0.88 };
    }

    // 3) 兜底：其他支出 / 其他收入 —— 低置信，强制确认
    const fb = fallbackCategory(categories, type);
    return {
        value: fb ? fb.name : (type === 'income' ? '其他收入' : '其他支出'),
        category_id: fb ? fb.id : null,
        source: 'fallback_other',
        confidence: 0.35,
    };
}

/** 在类目表里按名称+类型找（优先叶子类目：有 parent_id 的更具体） */
function findCategory(categories, name, type) {
    const same = categories.filter(c => c.type === type && c.name === name);
    if (same.length === 0) {
        // 名称包含匹配（如「餐饮」匹配到「餐饮美食」）
        const loose = categories.filter(c => c.type === type && c.name && c.name.includes(name));
        if (loose.length === 0) return null;
        return loose.sort((a, b) => (b.parent_id ? 1 : 0) - (a.parent_id ? 1 : 0))[0];
    }
    return same.sort((a, b) => (b.parent_id ? 1 : 0) - (a.parent_id ? 1 : 0))[0];
}

/** 兜底类目：其他支出 / 其他收入 */
function fallbackCategory(categories, type) {
    const target = type === 'income' ? '其他收入' : '其他支出';
    return categories.find(c => c.type === type && c.name === target)
        || categories.find(c => c.type === type && c.name && c.name.startsWith('其他'))
        || null;
}

/**
 * 按 type 派生该方向的全部关键词（去重）。
 * type-extractor.js 用它构造 INCOME_WORDS / EXPENSE_WORDS，
 * 保证「类目方向」与「收支方向判定」永不失步。
 * @param {'income'|'expense'} type
 * @returns {string[]}
 */
function keywordsOfType(type) {
    const set = new Set();
    for (const entry of KEYWORD_TO_CATEGORY) {
        if (entry.type !== type) continue;
        for (const w of entry.words) set.add(w);
    }
    return [...set];
}

module.exports = { matchCategory, KEYWORD_TO_CATEGORY, keywordsOfType };
