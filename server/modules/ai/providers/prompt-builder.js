/* ============================================
   Prompt Builder —— 把「用户记账习惯与规范」注入大模型
   ------------------------------------------------
     这是「让第三方模型理解我们的记账习惯」的核心补齐：

       Memory Retrieval 早已把用户习惯挖出来了
       （手工/学习规则、习惯假设、近 180 天历史分布、被否证项），
       但此前【只喂给本地 Decision Engine】—— 大模型一直在盲猜。

       本模块把这些结构化记忆翻译成自然语言，注入 system prompt，
       让模型在"修正/补全"时有据可依，而不是靠常识硬猜。

   ⛔ 设计约束：
     1. 纯函数、不写库、不碰数据库 —— 只做「结构 → 文本」的翻译。
     2. 记忆为空时必须返回空字符串：无历史的新用户不应看到空泛的
        「习惯」标题，也不应让 prompt 变长（省 token、防干扰）。
     3. 一切输出都要限量（条数/长度），避免长尾用户把 prompt 撑爆。
     4. 类目/账户 id 必须映射成名字：给模型 id 它记不住，给名字它才懂。

   ⚠️ 与 Context Builder 的分界（沿用既有约定）：
       Context Builder 给「确定事实」（类目表、账户表）；
       本模块给「历史推断」（习惯、否证）。前者错了是 bug，
       后者错了只是证据弱 —— 所以本模块产出的所有内容都标注为
       "习惯/历史"，模型被告知"优先级高于常识但仍可被本地值覆盖"。
   ============================================ */

// 各区块的条数上限：宁可少给几条，也不能让 prompt 无限膨胀
const MAX_HABITS = 8;
const MAX_NEGATED = 4;
const MAX_ACCOUNTS = 20;
const MAX_MERCHANTS = 20;

/**
 * 把记忆与上下文翻译成给大模型的「习惯提示词」。
 *
 * @param {object} params
 * @param {object} params.memory        Memory Retrieval 的结果
 * @param {Array}  params.categories    类目表 [{id, name, type}]
 * @param {Array}  params.accounts      账户表 [{id, name, type}]
 * @returns {string} 注入 prompt 的自然语言片段；无内容时返回 ''
 */
function buildMemoryHints({ memory = null, categories = [], accounts = [] } = {}) {
    // ⚠️ 刻意【不在开头就 if (!memory) return ''】：
    //    账户白名单取自 accounts（确定事实），与记忆是否存在无关。
    //    模型此前根本不知道用户有哪些账户，自然无法建议"用哪张卡"——
    //    这是旧 prompt 的另一个缺口，不该被 memory 为 null 连带跳过。

    // id → 名称映射：模型对「35」无感，对「居家」才有语义
    const catName = buildNameMap(categories);
    const acctName = buildNameMap(accounts);

    const blocks = [];

    // —— 以下两块依赖「历史记忆」——
    if (memory) {
        const habits = formatHabits(memory.candidates, catName, acctName);
        if (habits) blocks.push(habits);

        const negated = formatNegated(memory.negated, catName);
        if (negated) blocks.push(negated);
    }

    // —— 以下两块是「确定事实」，无历史的新用户也该看到 ——
    const accts = formatAccounts(accounts);
    if (accts) blocks.push(accts);

    if (memory) {
        const merchants = formatMerchants(memory.frequent_merchants);
        if (merchants) blocks.push(merchants);
    }

    return blocks.join('\n\n');
}

/* ─────────── 各区块格式化 ─────────── */

/** 习惯（规则 / 习惯假设 / 历史分布） */
function formatHabits(candidates, catName, acctName) {
    if (!Array.isArray(candidates) || candidates.length === 0) return '';

    const lines = [];
    const seen = new Set();     // 同一 key + 同样结论只说一次

    for (const c of candidates) {
        if (lines.length >= MAX_HABITS) break;

        const parts = [];
        if (c.category_id != null && catName.has(Number(c.category_id))) {
            parts.push(`类目「${catName.get(Number(c.category_id))}」`);
        }
        if (c.account_id != null && acctName.has(Number(c.account_id))) {
            parts.push(`账户「${acctName.get(Number(c.account_id))}」`);
        }
        if (c.type) parts.push(`方向「${typeLabel(c.type)}」`);

        // 既无类目也无账户也无方向 → 对模型没有信息量，跳过
        if (parts.length === 0) continue;

        const key = String(c.match_key || '').trim();
        const dedup = `${key}|${parts.join(',')}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);

        // 历史笔数比置信度更直观："见过 12 次" 比 "0.94" 更能让模型信服
        const support = Number(c.support) > 0 ? `（历史 ${c.support} 笔）` : '';
        const subject = key ? `「${key}」` : '该用户';
        lines.push(`- ${subject} → ${parts.join(' + ')}${support}`);
    }

    if (lines.length === 0) return '';
    return [
        '【用户记账习惯】以下来自该用户的真实历史数据，其优先级高于你的常识推断，请优先遵循；',
        '但若与本地已高置信抽出的金额/日期冲突，仍以本地值为准。',
        // ⚠️ 账户必须降权：商家与账户之间没有可靠映射 —— 同一个商家今天用支付宝、
        //    明天用微信、下次刷卡，历史归类无法说明本次用的是哪张卡。
        //    若不显式声明，模型会用这里的账户覆盖【账单原文写明的渠道】，
        //    造成"账单写着微信支付、却记成花呗"这类静默错账。
        '⚠️ 例外：其中的【账户】只是弱参考，仅当账单原文完全没写支付渠道时才可考虑；',
        '   账户一律以本次账单原文写明的渠道为准，习惯不得覆盖它。',
        ...lines,
    ].join('\n');
}

/** 否证项：用户亲手纠正过的错，提醒模型别再犯 */
function formatNegated(negated, catName) {
    if (!Array.isArray(negated) || negated.length === 0) return '';

    const lines = [];
    for (const n of negated.slice(0, MAX_NEGATED)) {
        const key = String(n.match_key || '').trim();
        const cat = (n.category_id != null && catName.has(Number(n.category_id)))
            ? catName.get(Number(n.category_id))
            : null;
        if (!key || !cat) continue;
        lines.push(`- 「${key}」不要归到「${cat}」（用户已纠正过）`);
    }

    if (lines.length === 0) return '';
    return ['【已被用户纠正，不要重犯】', ...lines].join('\n');
}

/** 可用账户白名单 */
function formatAccounts(accounts) {
    if (!Array.isArray(accounts) || accounts.length === 0) return '';
    const list = accounts
        .slice(0, MAX_ACCOUNTS)
        .map(a => `${a.id}:${a.name}`)
        .join(', ');
    return `【可用账户】只能从这些里选，不得臆造 id：${list}`;
}

/** 常消费商家（帮模型认出 OCR 里的别名/简写） */
function formatMerchants(merchants) {
    if (!Array.isArray(merchants) || merchants.length === 0) return '';
    const list = merchants.slice(0, MAX_MERCHANTS).join('、');
    return `【该用户常消费的商家】${list}`;
}

/* ─────────── 小工具 ─────────── */

function buildNameMap(rows) {
    const m = new Map();
    for (const r of rows || []) {
        if (r && r.id != null && r.name) m.set(Number(r.id), String(r.name));
    }
    return m;
}

function typeLabel(t) {
    if (t === 'income') return '收入';
    if (t === 'expense') return '支出';
    if (t === 'transfer') return '转账';
    return String(t);
}

module.exports = {
    buildMemoryHints,
    MAX_HABITS, MAX_NEGATED, MAX_ACCOUNTS, MAX_MERCHANTS,
};
