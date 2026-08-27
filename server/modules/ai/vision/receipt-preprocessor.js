/* ============================================
   AI v0.2 · 票据版式预处理器（Receipt Text → 干净语句）
   ------------------------------------------------
   ⛔⛔ 这个模块存在的唯一理由，是一次实测打出来的：
        把账单截图 OCR 出的【原文】直接喂给 v0.2 的 Deterministic Extractor，
        结果是灾难性的（2026-08-25 实测，见 __tests__ 用例）：

          · 交易单号 `4200002891202608201234567890`
              → 被当成金额，抽出一笔 **4.2e27 元** 的交易
          · 支付时间 `2026年8月20日 08:12:33`
              → `08` 被当成金额，抽出一笔 **8 元** 的交易
          · 商户名一个都没抽到（全部落到「其他支出」）

        根因：v0.2 的抽取器是为【自然语言】设计的（「今天星巴克 35」），
        它假设文本里的数字就是金额。而账单版式文本满是长数字、时间戳、
        单号，且商户名与金额分处不同行 —— 两者的输入假设根本不同。

   ⇒ 正确的分层不是「再写一套抽取器」（那就是老实现的错，双通道各一个大脑），
      而是在抽取器【之前】加一层版式整理：
        账单版式原文 → 本模块 → 「老乡鸡 18元」这类干净语句 → v0.2 主链路

      这样 v0.2 抽取器的输入假设重新成立，记忆/规则/学习全部照常生效，
      腾讯 OCR 也仍然只是「转录器」，不掺和任何抽取与学习。

   ------------------------------------------------
   本模块的版式策略，主体迁自 routes/ai.js 的 legacy `fallbackExtractItems`
   （2026-08-25 迁移）。它们是真实踩出来的账单版式经验，勿凭直觉简化：
     策略1  微信支付单笔：「商户名」行 +「支付金额 ¥18.00」同行
     策略1b 竖排标签版式：标签与值各占一行（微信账单详情页的真实形态）
              ⚠️ 这条是迁移时【新补】的 —— legacy 5 套策略全漏，
                 因为它当年总能靠 LLM 兜住；现在 LLM 只管转录，必须补齐
     策略2  支付宝单笔：  商户名在上一行，「消费 ¥19.90」在本行
     策略3  通用同行：    「老乡鸡 ¥18.00」
     策略4  同行带类型：  「老乡鸡 消费 ¥18.00」
     策略5  微信账单列表：金额是独立负数行「-18.00」，向上找商户名/商品名

   ⚠️ legacy 的「按支付时间推断早/午/晚餐」刻意不迁：真实类目表已把三餐
      合并成单一叶子「早午晚餐」，餐别推断没有落点。
   ============================================ */

/** 汇总行：这些行的金额不是一笔交易，必须整行丢掉 */
const SKIP_KEYWORDS = /合计|总计|小计|总金额|优惠|退款|实付|找零|应付|应收|余额|折扣|满减|立减/i;

/** 结构性标签行：它本身不是商户名，但其后的金额可能有效 */
const NOISE_KEYWORDS = /支付金额|支付|消费|收款|订单|交易|当前状态|付款方式|账单详情/i;

/** 金额上限：超过即视为单号/卡号误识别，绝不当交易 */
const MAX_AMOUNT = 999999;

/**
 * 判断一段文本是否「像账单版式」而不是自然语言。
 *
 * ⛔ 这个判定决定了走不走预处理，写松了会误伤手打文字：
 *    用户手打「今天星巴克 35.5，打车 28」绝不能被当成账单版式去做行解析。
 *    判据取「结构性特征」而非「有没有数字」。
 */
function looksLikeReceipt(text) {
    const s = String(text || '');
    if (!s.trim()) return false;
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);

    // 自然语言通常就一两行；账单截图 OCR 出来必然是多行短文本
    if (lines.length < 3) return false;

    let signals = 0;
    // ① 出现账单专有标签
    if (/支付金额|支付时间|交易单号|商户单号|商户全称|付款方式|收单机构|账单详情|交易成功|创建时间/.test(s)) signals += 2;
    // ② 出现独立的金额行（含负数行）
    if (lines.some(l => /^[-+]?\s*[¥￥]?\s*\d{1,10}(?:\.\d{1,2})?\s*$/.test(l))) signals += 1;
    // ③ 出现超长数字（单号）—— 自然语言里几乎不会有
    if (/\d{12,}/.test(s)) signals += 1;
    // ④ 短行占比高（版式文本的典型形态）
    const shortRatio = lines.filter(l => l.length <= 12).length / lines.length;
    if (shortRatio >= 0.6) signals += 1;

    return signals >= 2;
}

/**
 * 把账单版式文本整理成 v0.2 抽取器能正确理解的干净语句。
 *
 * @param {string} text            OCR / 模型转录出的原文
 * @param {object} [opts]
 * @param {string} [opts.defaultDate] 'YYYY-MM-DD'，缺日期时使用
 * @returns {{ ok:boolean, lines:string[], text:string, items:Array, strategy:string }}
 *   ok=false 表示没能整理出任何交易行 → 调用方应退回原文直接交给主链路
 */
function preprocessReceipt(text, opts = {}) {
    const raw = String(text || '');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const defaultDate = opts.defaultDate || new Date().toISOString().slice(0, 10);

    // 全局日期：整张票据共用（单笔账单只有一个日期）
    const ctx = extractContextDate(raw, defaultDate);

    const items = [];
    const seen = new Set();
    const used = new Set();   // 记录哪些策略真的命中了，便于调试与回归

    const add = (name, amount, date, strategy) => {
        const cleanName = sanitizeName(name);
        if (!cleanName) return;
        if (!(amount > 0) || amount > MAX_AMOUNT) return;
        const key = `${cleanName}|${amount.toFixed(2)}`;
        if (seen.has(key)) return;
        seen.add(key);
        used.add(strategy);
        items.push({ name: cleanName, amount, date: date || ctx.date });
    };

    runStrategy1(lines, ctx, add);
    runStrategy1b(lines, ctx, add);
    runStrategy2(lines, ctx, add);
    runStrategy3(lines, ctx, add);
    runStrategy4(lines, ctx, add);
    runStrategy5(lines, ctx, add);

    if (!items.length) {
        return { ok: false, lines: [], text: '', items: [], strategy: 'none' };
    }

    /*  组装成 v0.2 抽取器最擅长的自然语句形状：「<日期> <商家> <金额>元」。
        ⛔ 必须带「元」：抽取器对裸数字只给 0.6 置信度（evidence='bare_number'），
           带单位才会给到 0.9（'amount_with_unit'）—— 直接影响是否需要用户确认。
        ⛔ 日期用「YYYY年M月D日」而不是「YYYY-MM-DD」：实测抽取器对
           `2026-08-20` 这种连字符日期会把 `08` 也当候选金额（就是本模块要修的 bug）。 */
    const sentences = items.map(it => {
        const d = formatDateForNL(it.date, ctx.date);
        return `${d}${it.name} ${it.amount}元`;
    });

    return {
        ok: true,
        lines: sentences,
        text: sentences.join('\n'),
        items,
        strategy: Array.from(used).join('+'),
    };
}

/* ── 版式策略 ───────────────────────────────────────────── */

/** 策略1：微信支付单笔 —「商户名」行 +「支付金额 ¥18.00」行 */
function runStrategy1(lines, ctx, add) {
    for (let i = 1; i < lines.length; i++) {
        const m = lines[i].match(/支付金额\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/);
        if (!m) continue;
        const amount = parseFloat(m[1]);

        // 商户名向上找：可能被「商户全称」标签行、日期行隔开
        let name = null;
        for (let k = 1; k <= 5 && i - k >= 0; k++) {
            const cand = lines[i - k];
            if (isNoiseLine(cand)) continue;
            const prod = cand.match(/^商品\s*(.+)/);
            if (prod) { name = prod[1].trim(); break; }
            name = cand;
            break;
        }
        add(name, amount, findDateNear(lines, i, ctx), 's1_wechat_pay_amount');
    }
}

/**
 * 策略1b：竖排版式 — 标签与值【各占一行】。
 *
 * ⛔ 这是 2026-08-25 实测新补的版式，legacy 的 5 套策略全都漏掉它：
 *      商户全称 / 老乡鸡（合肥政务区店） / 商品 / 早餐套餐 /
 *      支付金额 / ¥18.00 / 支付方式 / 零钱 / 支付时间 / 2026年8月20日 ...
 *    这是微信支付「账单详情页」的实际形态（标签在上、值在下），
 *    legacy 之所以没暴露，是因为它总能靠 LLM 兜住；现在 LLM 只负责转录，
 *    版式解析全落在本模块，这个洞就必须补上。
 *
 * 做法：找到「支付金额」这类标签行 → 取紧随其后的第一个纯金额行；
 *      商户名同理取「商户全称/商品」标签行的下一行（优先「商品」，它更具体）。
 */
function runStrategy1b(lines, ctx, add) {
    const AMOUNT_LABEL = /^(?:支付金额|订单金额|交易金额|付款金额|实付金额|金额)$/;
    const NAME_LABEL = /^(?:商户全称|商户名称|商家名称|收款方|商品|商品名称)$/;
    const PURE_AMOUNT = /^[-+]?\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)\s*(?:元)?$/;

    // 先找商户名：「商品」优先于「商户全称」——商品名比店名更能反映消费内容
    let byProduct = null;
    let byMerchant = null;
    for (let i = 0; i < lines.length - 1; i++) {
        if (!NAME_LABEL.test(lines[i])) continue;
        const val = lines[i + 1];
        if (isNoiseLine(val)) continue;
        if (/^(?:商品|商品名称)$/.test(lines[i])) { if (!byProduct) byProduct = val; }
        else if (!byMerchant) byMerchant = val;
    }
    const name = byProduct || byMerchant;
    if (!name) return;

    for (let i = 0; i < lines.length - 1; i++) {
        if (!AMOUNT_LABEL.test(lines[i])) continue;
        const m = lines[i + 1].match(PURE_AMOUNT);
        if (!m) continue;
        add(name, parseFloat(m[1]), findDateNear(lines, i, ctx, 8), 's1b_vertical_label');
    }
}

/** 策略2：支付宝单笔 — 商户名在上一行，「消费 ¥19.90」在本行 */
function runStrategy2(lines, ctx, add) {
    for (let i = 1; i < lines.length; i++) {
        const m = lines[i].match(/^(?:消费|收款|支出|收入)\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/);
        if (!m) continue;
        let name = lines[i - 1];
        if (isDateLine(name)) name = lines[i - 2] || name;
        if (isNoiseLine(name)) continue;
        add(name, parseFloat(m[1]), findDateNear(lines, i, ctx), 's2_alipay_inline');
    }
}

/** 策略3：通用同行 —「老乡鸡 ¥18.00」 */
function runStrategy3(lines, ctx, add) {
    const re = /^(.{1,50}?)\s+[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)\s*(?:元)?\s*$/;
    for (const line of lines) {
        if (isNoiseLine(line) || line.length > 100) continue;
        if (/(?:消费|收款|支出|收入)/.test(line)) continue;   // 留给策略4
        const m = line.match(re);
        if (!m) continue;
        add(m[1].replace(/^\d{4}[-/]\d{2}[-/]\d{2}\s*/, ''), parseFloat(m[2]), ctx.date, 's3_generic_inline');
    }
}

/** 策略4：同行带类型 —「老乡鸡 消费 ¥18.00」 */
function runStrategy4(lines, ctx, add) {
    const re = /^(.{1,40}?)\s+(?:消费|收款|支出|收入)\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)/;
    for (const line of lines) {
        if (SKIP_KEYWORDS.test(line) || line.length > 100) continue;
        const m = line.match(re);
        if (!m) continue;
        add(m[1], parseFloat(m[2]), ctx.date, 's4_inline_with_type');
    }
}

/** 策略5：微信账单列表 — 金额是独立负数行「-18.00」，向上找商户名/商品名 */
function runStrategy5(lines, ctx, add) {
    const re = /^-\s*[¥￥]?\s*(\d{1,10}(?:\.\d{1,2})?)\s*$/;
    for (let i = 1; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;

        // 优先「商品」行
        let name = null;
        for (let k = 1; k <= 8 && i - k >= 0; k++) {
            const prod = lines[i - k].match(/^商品\s*(.+)/);
            if (prod) { name = prod[1].trim(); break; }
        }
        // 其次向上找第一个非噪声行
        if (!name) {
            for (let k = 1; k <= 8 && i - k >= 0; k++) {
                if (isNoiseLine(lines[i - k])) continue;
                name = lines[i - k];
                break;
            }
        }
        if (!name) continue;

        /*  日期：【必须先往上找】。
            ⛔ 账单列表的版式是「日期 → 商户名 → 金额」三行一组，
               所以本笔的日期在上方，而下方最近的日期属于【下一组】。
               先往下找会把「滴滴出行 8月20日」错记成 8月19日 —— 实测已踩，
               表现为「记账日期莫名比实际早一天」，且只在多笔账单里出现。 */
        let date = findDateNear(lines, i, ctx, -6);
        if (date === ctx.date) date = findDateNear(lines, i, ctx, 6);
        add(name, parseFloat(m[1]), date, 's5_wechat_negative_row');
    }
}

/* ── 工具 ───────────────────────────────────────────────── */

/**
 * 噪声行判定。
 * ⛔ 这是整个模块的防线：v0.2 抽取器被单号/时间戳骗到 4.2e27 元，
 *    就是因为没有这一层。任何新增版式策略都必须先过它。
 */
function isNoiseLine(line) {
    const l = String(line || '').trim();
    if (!l) return true;
    if (l.length > 60) return true;
    if (SKIP_KEYWORDS.test(l)) return true;
    if (NOISE_KEYWORDS.test(l)) return true;
    if (isDateLine(l)) return true;
    if (/^\d{2}:\d{2}/.test(l)) return true;          // 时间行
    if (/^\d{10,}$/.test(l)) return true;             // 纯长数字 = 单号
    if (/^(?:交易单号|商户单号|收单机构|支付方式|商家小程序|账单服务|商户全称|商品|创建时间|支付时间)$/.test(l)) return true;
    return false;
}

function isDateLine(line) {
    const l = String(line || '');
    return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(l) || /^\d{4}年\d{1,2}月/.test(l) || /^\d{1,2}月\d{1,2}日/.test(l);
}

/** 商户名清洗：剥掉前后的标签与标点，太短/纯数字一律丢弃 */
function sanitizeName(name) {
    let n = String(name || '').trim();
    if (!n) return null;
    n = n.replace(/^(?:商户全称|商户名称|商品|收款方|付款方|对方)[:：]?\s*/, '');
    n = n.replace(/^[-–—•·]\s*/, '').replace(/[:：]\s*$/, '').trim();
    if (n.length < 2 || n.length > 50) return null;
    if (/^\d+$/.test(n)) return null;                  // 纯数字
    if (/^[a-zA-Z]$/.test(n)) return null;             // 单字母（状态栏噪声）
    if (/^\d+[a-zA-Z]$/.test(n) || /^[a-zA-Z]\d+$/.test(n)) return null;
    if (/^\d{2}:\d{2}/.test(n)) return null;
    if (SKIP_KEYWORDS.test(n)) return null;
    return n.slice(0, 50);
}

/** 提取整张票据的上下文日期（含时间，若有） */
function extractContextDate(raw, defaultDate) {
    // 「支付时间 2026年8月20日 08:12:33」优先级最高
    const m1 = raw.match(/(?:支付时间|创建时间|交易时间)\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (m1) return { date: `${m1[1]}-${pad(m1[2])}-${pad(m1[3])}`, explicit: true };
    const m2 = raw.match(/(?:支付时间|创建时间|交易时间)\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m2) return { date: `${m2[1]}-${pad(m2[2])}-${pad(m2[3])}`, explicit: true };

    const m3 = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (m3) return { date: `${m3[1]}-${pad(m3[2])}-${pad(m3[3])}`, explicit: true };
    const m4 = raw.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (m4) return { date: `${m4[1]}-${m4[2]}-${m4[3]}`, explicit: true };

    return { date: defaultDate, explicit: false };
}

/**
 * 在第 i 行附近找日期。
 * @param {number} span 正数向后找，负数向前找
 */
function findDateNear(lines, i, ctx, span = 5) {
    const forward = span > 0;
    const n = Math.abs(span);
    for (let k = 1; k <= n; k++) {
        const idx = forward ? i + k : i - k;
        if (idx < 0 || idx >= lines.length) break;
        const d = parseDateFromLine(lines[idx]);
        if (d) return d;
    }
    return ctx.date;
}

function parseDateFromLine(line) {
    const l = String(line || '');
    const a = l.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (a) return `${a[1]}-${pad(a[2])}-${pad(a[3])}`;
    const b = l.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (b) return `${b[1]}-${b[2]}-${b[3]}`;
    // 「8月20日」这种缺年份的：账单列表常见，年份用当前年
    const c = l.match(/^(\d{1,2})月(\d{1,2})日/);
    if (c) return `${new Date().getFullYear()}-${pad(c[1])}-${pad(c[2])}`;
    return null;
}

/**
 * 把 'YYYY-MM-DD' 转成抽取器友好的「YYYY年M月D日」。
 * ⛔ 不能直接拼 'YYYY-MM-DD'：实测抽取器会把 `08` 当候选金额（本模块要修的 bug 之一）。
 * 与上下文日期相同时省略不写 —— 抽取器缺日期会落到 refDate，而调用方传的
 * refDate 就是票据日期，结果一致且语句更干净。
 */
function formatDateForNL(date, ctxDate) {
    if (!date || date === ctxDate) return '';
    const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function pad(v) { return String(v).padStart(2, '0'); }

module.exports = {
    looksLikeReceipt,
    preprocessReceipt,
    // 导出供单测直接验证防线
    _internals: { isNoiseLine, sanitizeName, extractContextDate, parseDateFromLine, formatDateForNL },
};
