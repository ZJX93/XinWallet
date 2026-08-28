/* ============================================
   Few-shot 样例选择器
   ------------------------------------------------
     让第三方模型「看懂这个用户以前怎么记账」：
     从历史交易里挑出与当前输入最相似的几条，作为示例注入 prompt。

     为什么需要它：
       模型看到「物业维修-永升物业樾溪臺 638.4元」时，只能凭常识猜类目。
       但如果同时看到这个用户过去 3 次同类消费都记成了「居家 + 花呗」，
       它的判断就有了依据 —— 这才是「越用越懂我」的关键一环。

   ⛔ 隐私：本模块产出的样例会随 prompt 发给【第三方模型】。
      因此只挑选必要字段（备注/金额/类型/类目名/账户名），
      绝不输出交易 id、book_id 等标识符；并由 AI_FEWSHOT_ENABLED 总开关控制。

   ⛔ 性能：每次 parse 都会跑，必须走索引且 LIMIT 有界（沿用 Episodic 的
      LOOKBACK_DAYS / 候选上限约定）。
   ============================================ */

const { LOOKBACK_DAYS } = require('./episodic-memory');

// 候选池上限：超过这个量级就没必要再比，纯 CPU 相似度计算
const CANDIDATE_ROWS = 200;
// 最终注入的样例条数：再多会挤占 prompt 预算且边际收益递减
const DEFAULT_LIMIT = 4;
// 相似度下限：低于此值说明「不相关」，宁可不给样例（噪声比缺失更糟）
const MIN_SIMILARITY = 0.12;

/**
 * 挑选与当前输入最相似的历史交易作为 few-shot 样例。
 *
 * @param {object} db
 * @param {object} wm      Working Memory（.userId / .bookId / .refDate）
 * @param {object} params
 * @param {string} params.text       用户原文
 * @param {Array}  params.merchants  已抽取的商家名（用于精准命中历史）
 * @param {number} [params.limit]    返回条数
 * @returns {Promise<Array>} [{ note, amount, type, category_id, category_name,
 *                              account_id, account_name, date, score }]
 */
async function selectFewShotExamples(db, wm, { text = '', merchants = [], limit = DEFAULT_LIMIT } = {}) {
    if (!db || !wm || wm.userId == null) return [];

    // 总开关：默认开启（见 isFewShotEnabled 的隐私权衡说明）。
    // 关闭时不查库 —— 让"不发送历史消费"成为零成本、可验证的行为。
    if (!isFewShotEnabled()) return [];

    const rows = await fetchCandidates(db, wm, merchants);
    if (!rows.length) return [];

    const query = buildQueryText(text, merchants);
    if (!query) return [];

    // 同一句备注可能出现多次（同一个商家反复消费），只保留【字段最完整】的那条：
    // 有类目的样例才有归类示范价值，无类目的几乎是噪声。
    const byNote = new Map();

    for (const r of rows) {
        const note = String(r.note || '').trim();
        if (!note) continue;

        const sim = diceSimilarity(query, note);
        if (sim < MIN_SIMILARITY) continue;

        // 质量加权：有类目/账户的样例示范价值更高
        const weight = qualityWeight(r);
        const dedupKey = note.toLowerCase();
        const existing = byNote.get(dedupKey);
        if (existing && existing.weight >= weight) continue;

        byNote.set(dedupKey, {
            weight,
            example: {
                note,
                amount: toNum(r.amount),
                type: r.type,
                category_id: r.category_id ?? null,
                category_name: r.category_name || null,
                account_id: r.account_id ?? null,
                account_name: r.account_name || null,
                date: normalizeDate(r.date),
                score: Number((sim * weight).toFixed(4)),
            },
        });
    }

    return [...byNote.values()]
        .map(x => x.example)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/* ─────────── 候选获取 ─────────── */

/**
 * 取候选历史交易。
 * 两条路径合并：
 *   1) 商家名 LIKE 命中 —— 精准，能捞到「同一商家过去怎么记的」
 *   2) 最近交易兜底     —— 处理原文里没有商家名的口语化输入
 */
async function fetchCandidates(db, wm, merchants = []) {
    const cutoff = cutoffDate(wm.refDate);
    const out = [];
    const seenIds = new Set();

    const push = (rows) => {
        for (const r of rows || []) {
            if (r.id == null || seenIds.has(r.id)) continue;
            seenIds.add(r.id);
            out.push(r);
        }
    };

    const SELECT = `SELECT t.id, t.note, t.amount, t.type, t.date,
                           t.category_id, c.name AS category_name,
                           t.account_id,  a.name AS account_name
                      FROM transactions t
                      LEFT JOIN categories c ON c.id = t.category_id
                      LEFT JOIN accounts   a ON a.id = t.account_id
                     WHERE t.user_id = ?
                       AND t.book_id = ?
                       AND t.type IN ('income','expense')
                       AND t.note IS NOT NULL AND t.note <> ''
                       AND t.date >= ?`;

    try {
        // 路径 1：按商家名精准命中（每个 key 一次查询，key 已在调用侧限量）
        for (const m of merchants.slice(0, 3)) {
            if (!m || m.length < 2) continue;
            const rows = await db.query(
                `${SELECT} AND t.note LIKE ? ORDER BY t.date DESC LIMIT 40`,
                [wm.userId, wm.bookId, cutoff, `%${m}%`]
            );
            push(rows);
            if (out.length >= CANDIDATE_ROWS) break;
        }

        // 路径 2：最近交易兜底
        if (out.length < CANDIDATE_ROWS) {
            const rows = await db.query(
                `${SELECT} ORDER BY t.date DESC LIMIT ?`,
                [wm.userId, wm.bookId, cutoff, CANDIDATE_ROWS - out.length]
            );
            push(rows);
        }
    } catch (_) {
        // 历史检索是增强项：数据库异常不能让记账链路失败
        return [];
    }

    return out;
}

/* ─────────── 相似度 ─────────── */

/**
 * 中文没有空格分词，用字符 bigram 的 Dice 系数即可：
 * 「物业维修」与「物业费维修」能算出较高重合，且不依赖任何分词库。
 */
function diceSimilarity(a, b) {
    const A = bigrams(a);
    const B = bigrams(b);
    if (!A.length || !B.length) return 0;
    const setB = new Set(B);
    let inter = 0;
    for (const g of A) if (setB.has(g)) inter++;
    return (2 * inter) / (A.length + B.length);
}

function bigrams(s) {
    const t = String(s || '').replace(/\s+/g, '').toLowerCase();
    const out = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
}

/** 样例质量权重：字段越完整，示范价值越高 */
function qualityWeight(r) {
    let w = 1;
    if (r.category_id != null) w *= 1.25;   // 有类目才有归类示范价值
    if (r.account_id != null) w *= 1.1;     // 有账户顺带能教账户选择
    else w *= 0.9;
    return w;
}

/* ─────────── 小工具 ─────────── */

function buildQueryText(text, merchants = []) {
    // 商家名权重更高：拼两遍等于提权（bigram 集合去重，只是让它在长文本里不被淹没）
    const parts = [String(text || '').trim(), ...merchants.filter(Boolean), ...merchants.filter(Boolean)];
    return parts.filter(Boolean).join(' ').trim();
}

function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function normalizeDate(d) {
    if (!d) return null;
    const s = String(d);
    return s.length > 10 ? s.slice(0, 10) : s;
}

function cutoffDate(refDate) {
    const base = refDate instanceof Date ? refDate : new Date();
    const d = new Date(base.getTime());
    d.setDate(d.getDate() - LOOKBACK_DAYS);
    return d.toISOString().slice(0, 10);
}

/**
 * Few-shot 先例是否启用。
 *
 * 默认【开启】—— 它是【类目】匹配准确率的主要增量：
 *   账单文本通常只写商家名，不会写明"这笔该记到哪个类目"，
 *   而用户过往对同一商家的真实归类正是这个缺失的信号。
 *
 * ⚠️ 它【不是】账户的可靠依据 —— 商家与账户之间没有稳定映射：
 *    同一个商家今天用支付宝、明天用微信、下次刷信用卡，
 *    历史归类根本无法说明本次用的是哪张卡。
 *    账户必须来自本次账单原文写明的支付渠道；先例只作弱参考，
 *    其措辞已在 prompts/parser-prompt.js 的 formatFewShot 中显式降权。
 *
 * 隐私权衡：会把最多 DEFAULT_LIMIT(4) 条历史消费发给第三方模型。
 *   已做脱敏 —— 只输出 备注/金额/类目名/账户名，不输出交易 id、book_id 等标识符
 *   （见 prompts/parser-prompt.js 的 formatFewShot）。
 *   若部署方不接受，设 AI_FEWSHOT_ENABLED=false 关闭；
 *   关闭后 v3 prompt 自动退化为 v2（先例区块为空串），不影响其余能力。
 */
function isFewShotEnabled() {
    const raw = String(process.env.AI_FEWSHOT_ENABLED || '').toLowerCase();
    // 未配置时默认开启；只认显式关闭
    return !(raw === 'false' || raw === '0' || raw === 'no');
}

module.exports = {
    selectFewShotExamples,
    diceSimilarity,
    isFewShotEnabled,
    // 供测试与调优参考
    MIN_SIMILARITY, DEFAULT_LIMIT, CANDIDATE_ROWS,
};
