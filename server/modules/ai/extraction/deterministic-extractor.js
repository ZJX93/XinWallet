/* ============================================
   确定性抽取器 · 编排层
   ------------------------------------------------
   职责：把 splitter + 各字段 extractor 组合成【候选交易数组】，
   每笔自带 confidence 对象（字段级），供 result-validator 做逐字段裁决。

   v0.2 原则落实：
   #1 确定性优先 —— 全程纯规则，零模型调用、零网络 IO，可离线跑、可单测。
   #5 字段级置信度 —— 绝不输出单一 overall 让上层「一刀切」。
   ============================================ */

const { extractAmount } = require('./amount-extractor');
const { extractDate } = require('./date-extractor');
const { extractType } = require('./type-extractor');
const { extractMerchant, extractCurrency } = require('./merchant-extractor');
const { matchCategory } = require('./category-matcher');
const { splitTransactions } = require('./transaction-splitter');
// 账户解析：基于 OCR 文本里的「支付宝/微信/银行/现金」关键词，覆盖客户端默认账户。
// 用户投诉「账户识别错误·固定账户」时新增（Phase 1）。
const { resolveAccount } = require('./account-resolver');
// 备注规范化：「场景-对象」格式在服务端确定性生成，不靠 prompt 求模型听话。
// ⛔ 唯一真相在 note-composer.js —— 别在路由层或 prompt 里再写第二套。
const { composeNote } = require('./note-composer');

/**
 * 确定性抽取：文本 → 候选交易数组（含字段级置信度）
 *
 * @param {string} text 用户原始输入
 * @param {object} ctx  上下文
 * @param {Array}  ctx.categories     可用类目 [{id,name,type,parent_id}]
 * @param {number} [ctx.account_id]   默认账户
 * @param {number} [ctx.book_id]      账本
 * @param {Date}   [ctx.refDate]      参考日期（测试注入）
 * @param {string[]} [ctx.userMerchants] 用户历史商家（Phase 3）
 * @returns {{transactions:Array, multi:boolean, split_source:string}}
 */
function extractTransactions(text, ctx = {}) {
    const {
        categories = [], account_id = null, refDate = new Date(), userMerchants = [],
        accounts = [],
    } = ctx;

    const { segments, source: splitSource, multi } = splitTransactions(text);
    if (segments.length === 0) {
        return { transactions: [], multi: false, split_source: splitSource };
    }

    // 日期常写在整句开头（「昨天早饭12，打车30」中的「昨天」对两笔都生效），
    // 因此先从全文抽一次作为各笔的默认日期，段内若有更具体日期则覆盖。
    const globalDate = extractDate(text, refDate);

    const transactions = segments.map((seg, idx) => {
        const amount = extractAmount(seg);
        const type = extractType(seg);
        const currency = extractCurrency(seg);
        const merchant = extractMerchant(seg, userMerchants);

        // 段内日期：若该段自己带日期线索（非默认回退）则用它，否则继承全文日期
        const segDate = extractDate(seg, refDate);
        const date = segDate.source === 'default_today' ? globalDate : segDate;

        // 类目匹配基于「段文本 + 商家」，商家常是最强类目线索（星巴克→餐饮）
        const catText = merchant ? `${seg} ${merchant.value}` : seg;
        const category = matchCategory(catText, type.value, categories);

        // 账户解析：用 OCR/原文里出现的「支付宝/微信/银行/现金」关键词，
        // 优先于请求体里的默认账户（解决「账户像被锁死」的用户投诉）。
        // 文本里完全没线索时才回退到默认账户（含「上次使用」兜底）。
        const accountResolved = resolveAccount(seg, {
            accounts,
            account_id,
            last_account_name: wm && wm.lastAccountName ? wm.lastAccountName : null,
        });

        return {
            seq: idx + 1,
            type: type.value,
            amount: amount ? amount.value : null,
            currency: currency.value,
            merchant: merchant ? merchant.value : null,
            category_id: category.category_id,
            category_name: category.value,
            account_id: accountResolved.account_id,
            account_match_source: accountResolved.source,
            account_match_confidence: accountResolved.confidence,
            date: date.value,
            /*  备注：服务端确定性生成「场景-对象」（如 `早午晚餐-老乡鸡`）。
                ⛔ 曾经这里是 `note: seg`（原始片段）并注释「commit 时经 resolveNote
                   规范化」—— 但 resolveNote 第一行就是 `if (note) return note`，
                   从来没规范化过。真实落账备注长这样：
                     ❌ `2026年8月20日老乡鸡 18元`（日期金额全冗余）
                   而且不报错，只能人肉看备注才发现。详见 note-composer.js 文件头。 */
            note: composeNote({
                segment: seg,
                merchant: merchant ? merchant.value : null,
                categoryName: category.value,
            }),
            raw_segment: seg,
            // 字段级置信度：缺失字段给 0，让 validator 判 invalid
            confidence: {
                amount: amount ? amount.confidence : 0,
                type: type.confidence,
                category: category.confidence,
                date: date.confidence,
                currency: currency.confidence,
                merchant: merchant ? merchant.confidence : 0,
            },
            // 抽取来源（可解释性：告诉用户「为什么这么判」）
            evidence: {
                amount: amount ? amount.source : 'missing',
                type: type.source,
                category: category.source,
                date: date.source,
                currency: currency.source,
                merchant: merchant ? merchant.source : 'missing',
                // 账户识别路径：渠道匹配 / 上次使用兜底 / 默认账户 等。
                // 前端 _evidenceText 会把它显示为「账户=last_used:支付宝 花呗」一类。
                account: accountResolved.source,
            },
            // 账户识别详细说明（给前端「识别依据」展示用，含兜底账户名）
            account_match_details: accountResolved.details || null,
        };
    })
        // ⚠️ 金额是记账的必要条件：无金额的段不是交易（如「今天天气不错」）。
        //    绝不能产出 amount=null 的候选 —— 那会让前端显示一条空交易，
        //    违反 v0.2「不生成虚假数据」原则。此处直接剔除，
        //    若全部被剔除则 transactions=[]，由路由层返回 422「未识别出交易」。
        .filter(t => t.amount !== null && t.amount > 0)
        // 剔除后重新编号，保证 seq 连续（前端按 seq 渲染/回传修正）
        .map((t, i) => ({ ...t, seq: i + 1 }));

    return { transactions, multi, split_source: splitSource };
}

module.exports = { extractTransactions };
