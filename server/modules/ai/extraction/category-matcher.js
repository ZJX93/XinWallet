/* ============================================
   AI v0.2 · 确定性抽取器 —— 类目匹配
   ------------------------------------------------
   类目必须落到【真实存在的 categories.id】，绝不能凭模型臆造 id。
   匹配顺序：关键词 → 商家推断 → 类目名直配 → 兜底「其他支出/其他收入」。
   兜底时置信度压到阈值以下，强制用户确认（落实 v0.2「不确定就问」）。
   ============================================ */

// 关键词 → 类目名（对齐项目中文类目约定：支出/收入/转账）
const KEYWORD_TO_CATEGORY = [
    // 餐饮
    { words: ['早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '吃饭', '外卖', '餐厅', 'food', '夜宵', '聚餐', '请客'], cat: '餐饮', type: 'expense' },
    { words: ['星巴克', '瑞幸', '咖啡', '奶茶', '喜茶', '蜜雪', '饮料'], cat: '餐饮', type: 'expense' },
    { words: ['买菜', '菜market', '超市', '超市购物', '生鲜', '盒马', '永辉'], cat: '日用百货', type: 'expense' },
    // 交通
    { words: ['打车', '滴滴', '出租车', '地铁', '公交', '高铁', '火车', '机票', '飞机', '加油', '停车', '过路费', '共享单车', '哈啰', '青桔'], cat: '交通', type: 'expense' },
    // 居住
    { words: ['房租', '物业', '水电', '电费', '水费', '燃气', '取暖', '宽带'], cat: '居住', type: 'expense' },
    // 通讯 / 订阅
    { words: ['话费', '流量', '手机费', '充值话费'], cat: '通讯', type: 'expense' },
    { words: ['会员', '订阅', 'netflix', 'spotify', '腾讯视频', '爱奇艺', '优酷', 'b站', '哔哩哔哩', 'icloud', 'chatgpt'], cat: '娱乐', type: 'expense' },
    // 购物
    { words: ['淘宝', '京东', '拼多多', '天猫', '衣服', '鞋', '数码', '电子产品', '化妆品', '购物'], cat: '购物', type: 'expense' },
    // 医疗 / 教育
    { words: ['医院', '药', '看病', '体检', '挂号', '牙医'], cat: '医疗', type: 'expense' },
    { words: ['学费', '书', '培训', '课程', '考试费', '文具'], cat: '教育', type: 'expense' },
    // 收入
    { words: ['工资', '薪水', '月薪', '发薪'], cat: '工资', type: 'income' },
    { words: ['奖金', '年终奖', '绩效'], cat: '奖金', type: 'income' },
    { words: ['报销'], cat: '报销', type: 'income' },
    { words: ['利息', '分红', '理财收益', '基金收益'], cat: '投资收益', type: 'income' },
    { words: ['退款', '返现', '红包'], cat: '其他收入', type: 'income' },
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

module.exports = { matchCategory, KEYWORD_TO_CATEGORY };
