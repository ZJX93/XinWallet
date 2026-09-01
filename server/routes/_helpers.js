/* ============================================
   鑫钱包 · 公共辅助函数（从 routes.js 提取）
   供所有路由模块复用
   ============================================ */

const db = require('../db');
const logger = require('../logger');
const { calcDebtDueSummary } = require('../services/debt-summary');
// 金额精度工具（修复审核报告 M3：浮点累加分位漂移）
const { sumAmounts, addAmounts, subtractAmounts, roundAmount, percentOf } = require('../services/money');

function success(data, msg = '') {
    return { success: true, data, message: msg };
}

function fail(msg, code = 400) {
    return { success: false, message: msg, code };
}

// ==========================================
// 语义化错误码常量
// 400 = 参数缺失/格式错误（请求语义错误）
// 401 = 未授权（鉴权失败，token 缺失/过期）
// 403 = 无权限（资源不允许该用户访问）
// 404 = 资源不存在
// 409 = 冲突（如余额不足、唯一键冲突）
// 422 = 业务校验失败（请求合法但业务规则不允许）
// 429 = 频率超限
// 500 = 服务器错误
// 502 = 外部依赖不可用
// ==========================================
const ErrorCodes = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_FAILED: 422,
    RATE_LIMITED: 429,
    SERVER_ERROR: 500,
    UPSTREAM_ERROR: 502
};

// 语义快捷方法（推荐使用以保持一致性）
const failValidation = (msg) => fail(msg, ErrorCodes.VALIDATION_FAILED); // 业务规则拒绝
const failNotFound = (msg = '资源不存在') => fail(msg, ErrorCodes.NOT_FOUND);
const failConflict = (msg) => fail(msg, ErrorCodes.CONFLICT);
const failForbidden = (msg = '无权访问该资源') => fail(msg, ErrorCodes.FORBIDDEN);
const failBadRequest = (msg) => fail(msg, ErrorCodes.BAD_REQUEST);

/**
 * 日期归一化为「YYYY-MM-DD HH:MM:SS」（精确到秒）。
 * 兼容三种前端输入：datetime-local（带 T）、ISO（带 Z/毫秒）、纯日期（YYYY-MM-DD）。
 * 必须去除 Z 与毫秒——否则直接写入 TIMESTAMP/DATETIME 在 PG/MySQL 下会报格式错误。
 */
function normDate(d) {
    if (!d) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return String(d).replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').slice(0, 19);
}

function fmtDateOnly(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) {
        return v.getFullYear() + '-' +
            String(v.getMonth() + 1).padStart(2, '0') + '-' +
            String(v.getDate()).padStart(2, '0');
    }
    return String(v).slice(0, 10);
}

function fmtDateTime(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) {
        return v.getFullYear() + '-' +
            String(v.getMonth() + 1).padStart(2, '0') + '-' +
            String(v.getDate()).padStart(2, '0') + ' ' +
            String(v.getHours()).padStart(2, '0') + ':' +
            String(v.getMinutes()).padStart(2, '0') + ':' +
            String(v.getSeconds()).padStart(2, '0');
    }
    const s = String(v).replace('T', ' ').replace('Z', '');
    return s.slice(0, 19);
}

// 余额下限等业务校验错误：带明确语义的 4xx（而非 500），
// 避免被前端/用户误报为"服务器内部错误"。所有 routes 的 catch 共用 handleServerError，
// 因此只要 enforceBalanceLimit 抛出 BalanceLimitError，相关端点都会正确返回 409。
class BalanceLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BalanceLimitError';
    }
}

function handleServerError(res, err, label = '操作') {
    // 余额下限等业务校验：返回 409 + 真实原因，前端可直接提示用户
    if (err instanceof BalanceLimitError ||
        (err && err.message && err.message.includes('余额不能低于'))) {
        return res.status(ErrorCodes.CONFLICT).json(failConflict(err.message));
    }
    logger.error(`[ERROR] ${label}: ${err && err.stack ? err.stack : err}`);
    return res.status(500).json(fail('服务器内部错误，请稍后重试', 500));
}

function maskKey(key) {
    if (!key) return '';
    // 加密后的 hex 密文通常超过 64 字符，展示前后几位不直观；统一显示为已加密占位符
    if (key.length >= 48) return '已加密 (AES-256-GCM)';
    if (key.length <= 8) return '***';
    return key.slice(0, 6) + '...' + key.slice(-4);
}

/**
 * 尝试解密凭证，并返回是否成功 + 解密后的明文（用于诊断密钥是否匹配）
 * @param {string} key 密文（hex）
 * @returns {{ ok: boolean, value: string, error?: string }}
 */
function tryDecrypt(key) {
    if (!key) return { ok: true, value: '' };
    try {
        const buf = Buffer.from(key, 'hex');
        if (buf.length < 32) {
            // 不是加密格式（旧数据明文），直接返回
            return { ok: true, value: key };
        }
        // 通过 _helpers 暴露的内部解密（这里用相对路径的 crypto 模块）
        const { decrypt } = require('../crypto');
        const decrypted = decrypt(key);
        // 如果解密返回原密文（说明失败 fallback），则不 ok
        if (decrypted === key) {
            return { ok: false, value: '', error: '密钥不匹配或数据已损坏' };
        }
        return { ok: true, value: decrypted };
    } catch (err) {
        return { ok: false, value: '', error: err.message };
    }
}

/**
 * 剥离思考模型（如 deepseek-r1、qwen 等）在输出里夹带的 <think>...</think> 标记，
 * 避免「已记一笔」文案里混入推理过程污染前端展示。
 * 同时处理未闭合的 <think>（某些流式实现会漏掉闭合标签）与残留的 <think> 起始标签。
 * @param {string|null|undefined} text
 * @returns {string}
 */
function stripThinkingTokens(text) {
    if (text == null) return '';
    let s = String(text);
    // 1) 去掉 <think>...</think> 整段（含换行/嵌套）
    s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
    // 2) 处理未闭合的 <think ...> 一直到结尾（流式截断常见）
    s = s.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
    // 3) 清理多余的空行
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return s;
}

/**
 * AI 记账对话回复修饰器：
 *  - 去掉 LLM 常见的「机械化前缀」（"我已为你…", "好的，我来…"等），让对话更像真人
 *  - 隐藏内部工具名 / 函数名 / 占位调试字样，避免把后端实现细节暴露到用户视角
 *  - 当真实落账时（hasTransactions=true）追加一句自然口语化的「记账小尾巴」，否则保持纯自然
 *  - 不会修改 reply 之外的 transactions 卡片数据（前端 ChatBubble 渲染完全不变）
 *
 * @param {string} text 模型原始 reply
 * @param {boolean} hasTransactions 本次对话是否真的写入了记账
 * @returns {string}
 */
function polishChatReply(text, hasTransactions) {
    if (text == null) return text;
    let s = String(text).trim();
    if (!s) return s;

    // 1) 循环剥除「机械化前缀」——按顺序套规则，每条规则只匹配一次，
    //    直到没有规则能继续剥为止。"好的，我来帮你…"这种长开场白也能被一层层剥掉。
    const PREFIX_RULES = [
        // 完整开场（"好的，"/"嗯…"/"哦…"）
        /^[，,。!！\s]*(好的|嗯|哦|行[吧]?|可以|明白|当然)[，,。!！！\s]*/i,
        // "下面我将…"/"下面是…"等说明式开场
        /^[，,。!！\s]*(下面(?:我(?:[来帮]*)?|这?(?:是)?)|下面为?(?:你|您))[，,。!！！\s]*/i,
        // "我已为你…"/"我来帮你…"/"我会…"/"让我…"
        /^[，,。!！\s]*我(?:已[为帮]*?|来[帮为]*?|会[帮为]*?)[，,。!！！\s]*/i,
        // 残留"为您…"/"请看…"/"这个…"
        /^[，,。!！\s]*(为您|请看|这个)[，,。!！！\s]*/i,
    ];
    let prefixIter = 0;
    let prevS;
    do {
        prevS = s;
        for (const r of PREFIX_RULES) {
            const next = s.replace(r, '');
            if (next !== s) { s = next.replace(/^[，,。!！！\s]+/, ''); break; }
        }
        prefixIter += 1;
    } while (s !== prevS && prefixIter < 6);

    // 2) 先隐藏函数调用风格的 JSON 整段（避免后面工具名替换污染 JSON 字符串）
    s = s.replace(/\{\s*"name"\s*:\s*"(?:create_|update_|delete_|list_|get_|ensure_)[a-z_]+"[\s\S]*?\}/gi, '');
    s = s.replace(/^\s*[\{\[].*[\}\]]\s*$/gm, '');

    // 3) 隐藏内部工具/函数名（剥完 JSON 后再剥孤立工具名；保留自然"查账户/记一笔"等口语）
    s = s.replace(/\b(create_transaction|create_transfer|update_transaction|delete_transaction|list_accounts|list_categories|list_budgets|get_account_balance|ensure_category)\b/gi, m => {
        const friendly = {
            create_transaction: '记一笔', create_transfer: '转账', update_transaction: '改一笔',
            delete_transaction: '删一笔', list_accounts: '查账户', list_categories: '查分类',
            list_budgets: '查预算', get_account_balance: '查余额', ensure_category: '找分类'
        };
        return friendly[m.toLowerCase()] || m;
    });

    // 4) 隐藏明显的调试/占位字样
    s = s.replace(/(<\/?(tool|function_call|response|reasoning|chain_of_thought|internal)[^>]*>)/gi, '');
    s = s.replace(/^\s*(DEBUG|LOG|TODO|FIXME|XXX|UNUSED)\b.*$/gmi, '');

    // 5) 折叠 3+ 连续空行 + 修剪多余标点
    s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    s = s.replace(/([。！!？\?])\1+/g, '?');

    // 6) 当本次真的落账 + reply 没有「已记」类提示时，追加一句自然口语
    //    注意：如果之前的安全网已改写 reply（"很抱歉，这笔其实没有记录成功…"），这里不会再追加"已记好"
    const alreadyConfirmed = /已记|已写|已存|记下了|记好了|记了一笔|搞定|落账/.test(s);
    if (hasTransactions && !alreadyConfirmed) {
        s = s ? s.replace(/[。！!？\?\.！]*$/, '') + '，已记好啦~' : '已记好啦~';
    }
    return s;
}

// 从模型输出中安全提取 JSON（兼容 markdown 代码块包裹）
function extractJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { }
    const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { } }
    const m2 = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m2) { try { return JSON.parse(m2[1]); } catch (e) { } }
    return null;
}

// 复式记账：仅账本流水净额（不含期初）
async function sumLedgerEffects(conn, userId, accountId) {
    const rows = await conn.query(
        `SELECT COALESCE(SUM(
            CASE
                WHEN source_account_id = ? THEN -amount
                WHEN destination_account_id = ? THEN amount
                WHEN account_id = ? AND type IN ('income','transfer_in') THEN amount
                WHEN account_id = ? AND type IN ('expense','transfer_out') THEN -amount
                ELSE 0
            END), 0) AS bal
        FROM transactions
        WHERE user_id = ? AND (source_account_id = ? OR destination_account_id = ? OR account_id = ?)`,
        [accountId, accountId, accountId, accountId, userId, accountId, accountId, accountId]
    );
    return parseFloat(rows[0] && rows[0].bal != null ? rows[0].bal : 0);
}

// 当前余额 = 期初余额 + 账本净额 - 已分配储蓄目标
//
// 金额精度修复（审核报告 M3）：本函数的返回值会被写回 accounts.balance 列，
// 是"计算 → 落库 → 再读出参与下一轮计算"的闭环起点，也是浮点误差被放大
// 并永久固化的关键链路。此处改用整数分精确加法，杜绝分位漂移。
async function computeAccountBalance(conn, userId, accountId) {
    const acc = await conn.query('SELECT opening_balance FROM accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
    const opening = acc[0] ? acc[0].opening_balance : 0;
    const effects = await sumLedgerEffects(conn, userId, accountId);
    // 储蓄目标现已镜像关联账户的余额（current_amount = 账户余额），
    // 不再从账户可用余额中扣减 allocated，避免"账户余额 = 自身 - 自身"的循环抵消。
    return addAmounts(opening || 0, effects);
}

// 校验账户余额不能低于 -credit_limit（无信用额度则不允许负数）
// 用于交易/转账/还款/储蓄等可能改变余额的操作
async function enforceBalanceLimit(conn, userId, accountId, balance) {
    const rows = await conn.query(
        'SELECT name, type, credit_limit FROM accounts WHERE id = ? AND user_id = ?',
        [accountId, userId]
    );
    const acc = rows[0];
    if (!acc) return;
    const limit = parseFloat(acc.credit_limit) || 0;
    const bal = balance !== undefined ? parseFloat(balance) : 0;
    if (bal < -limit - 0.005) {
        throw new BalanceLimitError(`账户「${acc.name}」余额不能低于 -${limit.toFixed(2)}（当前将变为 ${bal.toFixed(2)}）`);
    }
}

/**
 * 理财净值周快照补齐
 *
 * 性能修复（审核报告 M5 · N+1）：
 *   原实现对每个持仓做 2 次查询（存在性预检 + 首笔交易日），再按周逐条 INSERT，
 *   复杂度 O(持仓数 × 周数) 次串行往返 —— 一个持有两年的持仓就是 104 次 round-trip，
 *   10 个持仓可产生上千次串行 IO，直接拖垮 /stats/investments 与仪表盘。
 * 现实现：
 *   1. 去掉存在性预检 —— INSERT 已带 ON CONFLICT DO NOTHING，本身幂等，预检纯属浪费；
 *   2. 首笔交易日改为一次 GROUP BY 批量取（顺带补上原先缺失的 user_id 归属校验）；
 *   3. 所有待补快照汇总后分批多值 INSERT。
 *   总往返次数从 O(持仓数 × 周数) 降到 O(1 + 批数)。
 */
async function ensureWeeklySnapshots(userId, investments) {
    if (!Array.isArray(investments) || investments.length === 0) return;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - dayOfWeek);
    const lastSundayStr = lastSunday.toISOString().slice(0, 10);

    const invIds = investments.map(i => i.id);

    // 一次性取回全部持仓的首笔交易日期（原为逐持仓查询）
    // 安全：原查询缺 user_id 条件，此处补齐归属限定
    const { sql: invSql, params: invParams } = db.buildInClause(invIds);
    const firstTxRows = await db.query(
        `SELECT investment_id, MIN(date) as first_date
           FROM investment_transactions
          WHERE user_id = ? AND investment_id ${invSql}
          GROUP BY investment_id`,
        [userId, ...invParams]
    );
    const firstTxMap = new Map(firstTxRows.map(r => [Number(r.investment_id), r.first_date]));

    // 汇总所有待写入的快照行
    const rows = [];
    for (const inv of investments) {
        const value = parseFloat(inv.current_value);
        const cost = parseFloat(inv.total_cost);

        // 本周快照
        rows.push([userId, inv.id, value, cost, lastSundayStr]);

        // 回填历史周快照
        const firstDate = firstTxMap.get(Number(inv.id));
        if (!firstDate) continue;

        const start = new Date(firstDate);
        start.setDate(start.getDate() + (7 - start.getDay()) % 7);
        const end = new Date(lastSunday);
        end.setDate(end.getDate() - 7);

        while (start <= end) {
            rows.push([userId, inv.id, value, cost, start.toISOString().slice(0, 10)]);
            start.setDate(start.getDate() + 7);
        }
    }
    if (rows.length === 0) return;

    // 分批多值 INSERT：每批 500 行 = 2500 个绑定参数，远低于 PostgreSQL 65535 上限
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
        // INSERT IGNORE = MySQL 等价幂等写；ON CONFLICT = PG 幂等写（schema 双方言都有 UNIQUE (investment_id, nav_date)）
        const suffix = db.DB_DIALECT === 'mysql'
            ? ''   // INSERT IGNORE 无需 ON CONFLICT
            : ' ON CONFLICT (investment_id, nav_date) DO NOTHING';
        await db.query(
            `INSERT INTO investment_snapshots (user_id, investment_id, total_value, total_cost, nav_date)
             VALUES ${placeholders}${suffix}`,
            chunk.flat()
        );
    }
}

module.exports = {
    success, fail, normDate, fmtDateOnly, fmtDateTime, handleServerError, maskKey,
    extractJson, stripThinkingTokens, polishChatReply, sumLedgerEffects, computeAccountBalance, enforceBalanceLimit, ensureWeeklySnapshots,
    calcDebtDueSummary,
    ErrorCodes, failValidation, failNotFound, failConflict, failForbidden, failBadRequest,
    tryDecrypt,
    // 金额精度工具（M3）：路由统一从 _helpers 取用，避免各处重复使用
    sumAmounts, addAmounts, subtractAmounts, roundAmount, percentOf
};
