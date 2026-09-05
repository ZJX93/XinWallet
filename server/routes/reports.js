// ==========================================
// 综合报表 API
// ==========================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { success, fail, handleServerError, fmtDateOnly } = require('./_helpers');

// ==========================================
// 轻量内存缓存：避免同一周期内重复聚合
// ==========================================
// 报表端点一次性聚合 15+ 条查询（transactions / accounts / investments / debts / budgets
// 以及资产负债表与现金流量表）。仪表盘往往在同一周期反复拉取，短 TTL 缓存可直接吃掉重复聚合，
// 把"数据库 15+ 次查询"降为"命中缓存时 0 次查询"。
// - TTL 默认 30s：个人财务数据近实时，30s 陈旧可忽略；可通过 ?fresh=1 强制刷新。
// - 按 userId 隔离键，杜绝跨用户数据泄漏；仅缓存成功结果，不缓存异常。
// - 单容器部署（docker-compose 单 app 实例）下内存缓存有效；多实例需换为共享缓存（如 Redis）。
const REPORT_CACHE_TTL_MS = 30 * 1000;
const REPORT_CACHE_MAX = 200;
const reportCache = new Map();

function reportCacheKey(userId, bookId, type, period) {
    // 用归一化后的 type 做 key：`yearly` 与 `annual` 是同一份数据，
    // 不归一化会各存一份，缓存命中率减半且两份可能新旧不一致。
    return `${userId}:${bookId}:${normalizeReportType(type)}:${period}`;
}

function getCachedReport(key) {
    const hit = reportCache.get(key);
    if (!hit) return null;
    if (hit.expires > Date.now()) return hit.data;
    reportCache.delete(key); // 过期则顺手清理
    return null;
}

function setCachedReport(key, data) {
    reportCache.set(key, { data, expires: Date.now() + REPORT_CACHE_TTL_MS });
    // 容量保护：超过上限时清理最旧的一部分，避免长会话内存膨胀
    if (reportCache.size > REPORT_CACHE_MAX) {
        const oldKeys = Array.from(reportCache.keys()).slice(0, 50);
        oldKeys.forEach(k => reportCache.delete(k));
    }
}

// ==========================================
// 多币种 P2-2d 辅助函数：rows → breakdown 字典，主货币按 amount 绝对值最大选
// ==========================================
function _rowsToBreakdown(rows, valueKey) {
    const out = {};
    (rows || []).forEach(r => {
        const cur = r.currency || 'CNY';
        out[cur] = parseFloat(r[valueKey] || 0);
    });
    return out;
}

function _rowsToBreakdownMulti(rows, valueKeys) {
    const out = {};
    (rows || []).forEach(r => {
        const cur = r.currency || 'CNY';
        out[cur] = out[cur] || {};
        valueKeys.forEach(k => { out[cur][k] = parseFloat(r[k] || 0); });
    });
    return out;
}

function _pickPrimaryCurrency(breakdown) {
    let primary = 'CNY', max = -1;
    Object.entries(breakdown).forEach(([cur, v]) => {
        let total = 0;
        if (typeof v === 'object' && v !== null) {
            total = Math.abs(v.income || 0) + Math.abs(v.expense || 0)
                  + Math.abs(v.total_value || 0) + Math.abs(v.total_cost || 0)
                  + Math.abs(v.total_income || 0) + Math.abs(v.total_expense || 0);
        } else {
            total = Math.abs(v);
        }
        if (total > max) { max = total; primary = cur; }
    });
    return primary;
}

// 从 breakdown 取主货币值
function _primaryValue(breakdown, key) {
    const cur = _pickPrimaryCurrency(breakdown);
    const v = breakdown[cur];
    if (typeof v === 'object' && v !== null) return parseFloat(v[key] || 0);
    return parseFloat(v || 0);
}

// 日趋势按 date × currency 双维度分组：[{date, currency, income, expense}] → [{date, breakdown}]
function _groupDailyByCurrency(rows) {
    const map = {};
    (rows || []).forEach(r => {
        if (!map[r.date]) map[r.date] = {};
        map[r.date][r.currency || 'CNY'] = {
            income: parseFloat(r.income || 0),
            expense: parseFloat(r.expense || 0)
        };
    });
    return Object.entries(map).map(([date, breakdown]) => {
        const cur = _pickPrimaryCurrency(breakdown);
        const v = breakdown[cur] || { income: 0, expense: 0 };
        return {
            date, currency: cur,
            income: v.income, expense: v.expense,
            incomeBreakdown: breakdown, expenseBreakdown: breakdown
        };
    }).sort((a, b) => a.date.localeCompare(b.date));
}

// 解析 budget 子查询返回的 JSON 字符串为 breakdown（与 stats.js 严格一致）
function _parseJsonBreakdown(jsonStr) {
    if (!jsonStr) return { CNY: 0 };
    try {
        const obj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => { out[k] = parseFloat(v) || 0; });
        return Object.keys(out).length ? out : { CNY: 0 };
    } catch (_) {
        return { CNY: 0 };
    }
}

// ==========================================
// 辅助函数
// ==========================================

function lastDayOfMonth(y, m) {
    return new Date(y, m, 0).getDate();
}

/**
 * 客户端粒度别名 → 服务端内部类型。
 *
 * ⚠️ 两端（安卓 ReportsViewModel:90-94、鸿蒙 Reports.ets:108）一直发的是
 * `yearly` 和 `custom`，而这里原本只认 `annual`，导致「按年查看」和
 * 「自定义区间」全部走到 throw('不支持的报表类型') → HTTP 400。
 * 客户端拿到 400 后只显示空态，看起来像「这一年没数据」而不是「请求失败」，
 * 所以这个 bug 一直没被发现。
 *
 * 这里做兼容而不是改客户端：`yearly` 比 `annual` 更符合 monthly 的构词，
 * 且已有两端在用，改服务端只需一处。
 */
const PERIOD_TYPE_ALIAS = {
    yearly: 'annual',
    annually: 'annual',
    year: 'annual',
    month: 'monthly',
    quarter: 'quarterly'
};

function normalizeReportType(type) {
    return PERIOD_TYPE_ALIAS[type] || type;
}

function parseReportPeriod(type, period) {
    type = normalizeReportType(type);
    // 自定义区间：period 形如 'YYYY-MM~YYYY-MM'（含首月 1 日到末月最后一日）
    // 也兼容 'YYYY-MM-DD~YYYY-MM-DD' 的日级区间
    if (type === 'custom') {
        const parts = String(period).split('~');
        if (parts.length !== 2) throw new Error('自定义区间格式错误');
        const rawStart = parts[0].trim();
        const rawEnd = parts[1].trim();
        const mStart = rawStart.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
        const mEnd = rawEnd.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
        if (!mStart || !mEnd) throw new Error('自定义区间格式错误');
        const sy = parseInt(mStart[1]), sm = parseInt(mStart[2]);
        const ey = parseInt(mEnd[1]), em = parseInt(mEnd[2]);
        // ⚠️ 正则里的 \d{2} 只保证「两位数字」，13 月、02-30 号都能通过。
        // 不做语义校验的后果不是抛错，而是**算出一个看似合法的日期串直接进 SQL**：
        //   '2026-13~2026-14' → start='2026-13-01' end='2026-14-28'
        //   （lastDayOfMonth(2026,14) 里 new Date(2026,14,0) 溢出到 2027-02 返回 28）
        // 而 start > end 是字符串比较，'2026-13-01' < '2026-14-28' 所以那道校验也放行。
        // 最终 Postgres 报 date/time field value out of range，或在别的驱动下静默返回空集。
        if (sm < 1 || sm > 12 || em < 1 || em > 12) throw new Error('自定义区间格式错误');
        // 日级区间还要校验「这一天在该月真实存在」——2 月 30 号同样能过正则
        const sd = mStart[3] ? parseInt(mStart[3]) : 1;
        const ed = mEnd[3] ? parseInt(mEnd[3]) : 1;
        if (sd < 1 || sd > lastDayOfMonth(sy, sm)) throw new Error('自定义区间格式错误');
        if (ed < 1 || ed > lastDayOfMonth(ey, em)) throw new Error('自定义区间格式错误');
        const start = mStart[3]
            ? rawStart
            : `${sy}-${String(sm).padStart(2, '0')}-01`;
        const end = mEnd[3]
            ? rawEnd
            : `${ey}-${String(em).padStart(2, '0')}-${lastDayOfMonth(ey, em)}`;
        if (start > end) throw new Error('自定义区间格式错误');
        const label = start.slice(0, 7) === end.slice(0, 7)
            ? `${sy}年${sm}月`
            : `${start.slice(0, 7)} ~ ${end.slice(0, 7)}`;
        return { start, end, label };
    }
    if (type === 'monthly') {
        const match = period.match(/^(\d{4})-(\d{2})$/);
        if (!match) throw new Error('月份格式错误');
        const y = parseInt(match[1]), m = parseInt(match[2]);
        // \d{2} 只管位数不管范围：'2026-13' 会算出 start='2026-13-01' end='2026-13-31'
        // 直接进 SQL。必须显式校验 1~12。
        if (m < 1 || m > 12) throw new Error('月份格式错误');
        return {
            start: `${y}-${String(m).padStart(2, '0')}-01`,
            end: `${y}-${String(m).padStart(2, '0')}-${lastDayOfMonth(y, m)}`,
            label: `${y}年${m}月`
        };
    }
    if (type === 'quarterly') {
        const match = period.match(/^(\d{4})-Q(\d)$/);
        if (!match) throw new Error('季度格式错误');
        const y = parseInt(match[1]), q = parseInt(match[2]);
        // 'Q0' → sm=-2 会拼出 '2026--2-01' 这种畸形串；'Q7' → '2026-19-01'
        if (q < 1 || q > 4) throw new Error('季度格式错误');
        const sm = (q - 1) * 3 + 1, em = q * 3;
        return {
            start: `${y}-${String(sm).padStart(2, '0')}-01`,
            end: `${y}-${String(em).padStart(2, '0')}-${lastDayOfMonth(y, em)}`,
            label: `${y}年 Q${q}`
        };
    }
    if (type === 'annual') {
        if (!/^\d{4}$/.test(period)) throw new Error('年份格式错误');
        const y = parseInt(period);
        return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}年` };
    }
    throw new Error('不支持的报表类型');
}

function prevPeriod(type, period) {
    type = normalizeReportType(type);
    if (type === 'custom') {
        // 自定义区间的环比：往前挪一个「等长区间」。
        // 例如 2026-01~2026-03（3 个月）→ 2025-10~2025-12。
        // 不能简单减 1 个月，否则 3 个月区间的环比只覆盖 1 个月，比值毫无意义。
        const parts = String(period).split('~');
        if (parts.length !== 2) return null;
        const s = parts[0].trim().slice(0, 7).split('-').map(Number);
        const e = parts[1].trim().slice(0, 7).split('-').map(Number);
        if (s.length < 2 || e.length < 2) return null;
        const span = (e[0] * 12 + e[1]) - (s[0] * 12 + s[1]) + 1;
        const shift = (y, m, by) => {
            const t = y * 12 + (m - 1) - by;
            return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
        };
        return {
            type: 'custom',
            period: `${shift(s[0], s[1], span)}~${shift(e[0], e[1], span)}`
        };
    }
    if (type === 'monthly') {
        const [y, m] = period.split('-').map(Number);
        const d = new Date(y, m - 2, 1);
        return { type: 'monthly', period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
    }
    if (type === 'quarterly') {
        const match = period.match(/^(\d{4})-Q(\d)$/);
        let y = parseInt(match[1]), q = parseInt(match[2]);
        q--;
        if (q < 1) { y--; q = 4; }
        return { type: 'quarterly', period: `${y}-Q${q}` };
    }
    if (type === 'annual') {
        return { type: 'annual', period: String(parseInt(period) - 1) };
    }
    return null;
}

function monthsInRange(start, end) {
    const months = [];
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return months;
}

function daysInRange(start, end) {
    const a = new Date(start), b = new Date(end);
    return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

async function buildReport(userId, bookId, type, period) {
    const range = parseReportPeriod(type, period);
    const start = range.start, end = range.end;
    const days = daysInRange(start, end);
    const periodMonths = monthsInRange(start, end);

    const prev = prevPeriod(type, period);
    const prevRange = prev ? parseReportPeriod(prev.type, prev.period) : null;
    const hasMonths = periodMonths.length > 0;

    // 性能优化：原实现串行执行约 13 次 DB 查询（接口延迟≈各查询耗时之和）。
    // 这些查询彼此独立、仅依赖 userId/start/end 等已知参数，统一用 Promise.all 并发执行，
    // 接口延迟降为「最慢一次查询」，在交易量大时收益明显。输出结构与重构前完全一致。
    const [
        summaryRows, dailyRows, expByCat, incByCat, accountFlows, topExpenses,
        budgetRows,
        accountAssets, invAssets,
        prevRows,
        debtAll, debtRepayments,
    ] = await Promise.all([
        // 多币种 P2-2d：本期合计按账户币种 GROUP BY，rows 数组 → JS 端折 breakdown
        db.query(
            `SELECT a.currency AS currency,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
                COUNT(*) AS tx_count
             FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type IN ('expense','income','transfer_in','transfer_out')
             GROUP BY a.currency`,
            [userId, bookId, start, end]
        ),
        // 多币种 P2-2d：日趋势按 date × currency 双维度分组；JS 端用 _groupDailyByCurrency 折 breakdown
        db.query(
            `SELECT CAST(t.date AS CHAR(10)) AS date, a.currency AS currency,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
             FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.date >= ? AND t.date <= ?
               AND t.type IN ('expense','income','transfer_in','transfer_out')
             GROUP BY CAST(t.date AS CHAR(10)), a.currency ORDER BY date`,
            [userId, bookId, start, end]
        ),
        // 分类金额「子级向父级汇总」——在数据库层用递归 CTE 完成，语义同财务成本科目：
        // 每个分类的 total = 自身发生额 + 其全部子孙（任意层级）发生额之和。
        // 做法：先由 categories 自联结生成 (node, ancestor_id) 闭包（每个分类到其所有祖先的映射），
        // 再把每笔交易按其分类 node 累加到该分类及其所有祖先 ancestor_id 上。
        // 多币种 P2-2d：在 CTE 末端按 (cat_id, currency) 聚合，JSON_OBJECTAGG 返回该分类的币种字典
        db.query(
            `WITH RECURSIVE anc AS (
               SELECT c.id AS node, c.id AS ancestor_id, c.parent_id AS parent_id
               FROM categories c
               UNION ALL
               SELECT a.node, p.id AS ancestor_id, p.parent_id AS parent_id
               FROM anc a
               JOIN categories p ON p.id = a.parent_id
             ),
             raw AS (
               SELECT a.ancestor_id AS cat_id, a2.currency AS currency, t.amount AS amount
               FROM anc a
               JOIN transactions t
                 ON t.category_id = a.node
                AND t.user_id = ? AND t.book_id = ? AND t.type = 'expense'
                AND t.date >= ? AND t.date <= ?
               LEFT JOIN accounts a2 ON t.account_id = a2.id
             ),
             agg AS (
               SELECT cat_id, currency, COALESCE(SUM(amount), 0) AS total
               FROM raw GROUP BY cat_id, currency
             )
             SELECT c.id, c.name, c.icon, c.parent_id,
                    COALESCE(JSON_OBJECTAGG(agg.currency, agg.total), JSON_OBJECT()) AS total_breakdown_json
             FROM agg
             JOIN categories c ON c.id = agg.cat_id
             GROUP BY c.id, c.name, c.icon, c.parent_id
             ORDER BY (SELECT COALESCE(SUM(total), 0) FROM agg a2 WHERE a2.cat_id = c.id) DESC`,
            [userId, bookId, start, end]
        ),
        db.query(
            `WITH RECURSIVE anc AS (
               SELECT c.id AS node, c.id AS ancestor_id, c.parent_id AS parent_id
               FROM categories c
               UNION ALL
               SELECT a.node, p.id AS ancestor_id, p.parent_id AS parent_id
               FROM anc a
               JOIN categories p ON p.id = a.parent_id
             ),
             raw AS (
               SELECT a.ancestor_id AS cat_id, a2.currency AS currency, t.amount AS amount
               FROM anc a
               JOIN transactions t
                 ON t.category_id = a.node
                AND t.user_id = ? AND t.book_id = ? AND t.type = 'income'
                AND t.date >= ? AND t.date <= ?
               LEFT JOIN accounts a2 ON t.account_id = a2.id
             ),
             agg AS (
               SELECT cat_id, currency, COALESCE(SUM(amount), 0) AS total
               FROM raw GROUP BY cat_id, currency
             )
             SELECT c.id, c.name, c.icon, c.parent_id,
                    COALESCE(JSON_OBJECTAGG(agg.currency, agg.total), JSON_OBJECT()) AS total_breakdown_json
             FROM agg
             JOIN categories c ON c.id = agg.cat_id
             GROUP BY c.id, c.name, c.icon, c.parent_id
             ORDER BY (SELECT COALESCE(SUM(total), 0) FROM agg a2 WHERE a2.cat_id = c.id) DESC`,
            [userId, bookId, start, end]
        ),
        // 多币种 P2-2d：账户净流加 currency 列（每账户单货币——账户本身就是 currency 的载体）
        db.query(
            `SELECT a.id, a.name, a.icon, a.type, a.currency,
                COALESCE(SUM(CASE WHEN t.type IN ('income','transfer_in') THEN t.amount ELSE -t.amount END), 0) as net
             FROM transactions t JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.date >= ? AND t.date <= ? AND t.type IN ('expense','income','transfer_in','transfer_out')
             GROUP BY a.id, a.name, a.icon, a.type, a.currency
             ORDER BY ABS(COALESCE(SUM(CASE WHEN t.type IN ('income','transfer_in') THEN t.amount ELSE -t.amount END), 0)) DESC`,
            [userId, bookId, start, end]
        ),
        // 多币种 P2-2d：top 交易附加 currency（LEFT JOIN accounts）——前端展示按交易币种格式化
        db.query(
            `SELECT t.id, t.date, t.amount, t.note, c.name as category_name, c.icon as category_icon, a.currency
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.type = 'expense' AND t.date >= ? AND t.date <= ?
             ORDER BY t.amount DESC LIMIT 5`,
            [userId, bookId, start, end]
        ),
        // 仅当周期含月份时才查预算（无月份范围时预算执行无意义）
        // 多币种 P2-2d：actual 子查询用 JSON_OBJECTAGG 按账户币种 GROUP BY，合并到 budgetRows 单次查询
        hasMonths
            ? db.query(
                `SELECT b.id, b.name, b.amount as budget_amount, b.period_type,
                        c.id as cat_id, c.icon,
                        (SELECT COALESCE(JSON_OBJECTAGG(a.currency, sums.cnt), JSON_OBJECT('CNY', 0))
                           FROM (SELECT t.account_id, SUM(t.amount) AS cnt FROM transactions t
                                 LEFT JOIN categories c2 ON t.category_id = c2.id
                                 WHERE t.user_id = b.user_id AND t.book_id = b.book_id AND t.type = 'expense'
                                   AND DATE(t.date) BETWEEN b.start_date AND b.end_date
                                   AND (t.budget_id = b.id OR (c2.name = b.name AND c2.type = 'expense'))
                                 GROUP BY t.account_id) sums
                           LEFT JOIN accounts a ON sums.account_id = a.id) AS actual_breakdown_json
                 FROM budgets b
                 LEFT JOIN categories c ON c.name = b.name AND c.type = 'expense'
                 WHERE b.user_id = ? AND b.book_id = ? AND b.start_date <= ? AND b.end_date >= ?
                 ORDER BY b.amount DESC`,
                [userId, bookId, end, start]
            )
            : Promise.resolve([]),
        // 多币种 P2-2d：账户余额合计按 currency GROUP BY（账户本身就带 currency）
        db.query(
            `SELECT currency, COALESCE(SUM(balance), 0) as total FROM accounts
             WHERE user_id = ? AND book_id = ? AND status = 'active'
             GROUP BY currency`,
            [userId, bookId]
        ),
        // 多币种 P2-2d：持仓合计按 investments.currency GROUP BY（P2-2d 已加 currency 列）
        db.query(
            `SELECT currency,
                COALESCE(SUM(current_value), 0) as total_value,
                COALESCE(SUM(total_cost), 0) as total_cost
             FROM investments WHERE user_id = ? AND book_id = ? AND status = 'holding'
             GROUP BY currency`,
            [userId, bookId]
        ),
        // 多币种 P2-2d：环比按账户币种 GROUP BY
        prev
            ? db.query(
                `SELECT a.currency AS currency,
                    COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
                 FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
                 WHERE t.user_id = ? AND t.book_id = ? AND t.date >= ? AND t.date <= ?
                 GROUP BY a.currency`,
                [userId, bookId, prevRange.start, prevRange.end]
            )
            : Promise.resolve([]),
        // 多币种 P2-2c：debts.currency 列已加，SELECT 显式读出
        db.query(
            `SELECT id, name, type, principal, remaining, monthly_payment, status, due_date, currency
             FROM debts WHERE user_id = ? AND book_id = ? AND status != 'paid_off'`,
            [userId, bookId]
        ),
        // 多币种 P2-2d：debt_repayments.currency 列已加（跟随债务币种），SELECT 显式读出
        db.query(
            `SELECT debt_id, amount, principal_part, interest_part, paid_at, note, currency
             FROM debt_repayments WHERE user_id = ? AND book_id = ? AND paid_at >= ? AND paid_at <= ? ORDER BY paid_at DESC`,
            [userId, bookId, start, end]
        ),
    ]);

    // 多币种 P2-2d：summary 按 currency GROUP BY → breakdown 字典，主货币按 amount 绝对值最大选
    const summaryBreakdown = _rowsToBreakdownMulti(summaryRows, ['income', 'expense']);
    // 同时算 tx_count（全部交易笔数，不分币种）
    const txCountTotal = summaryRows.reduce((s, r) => s + parseInt(r.tx_count || 0, 10), 0);
    const summaryCurrency = _pickPrimaryCurrency(summaryBreakdown);
    const income = (summaryBreakdown[summaryCurrency] && summaryBreakdown[summaryCurrency].income) || 0;
    const expense = (summaryBreakdown[summaryCurrency] && summaryBreakdown[summaryCurrency].expense) || 0;
    const balance = income - expense;

    // 多币种 P2-2d：日趋势按 date × currency 双维度分组，JS 端折 breakdown
    const dailyMap = _groupDailyByCurrency(dailyRows);
    // 补齐无交易日期——空日期填充 0 值的 breakdown
    const dailyTrend = [];
    const cur = new Date(start), last = new Date(end);
    while (cur <= last) {
        const iso = fmtDateOnly(cur);
        const found = dailyMap.find(d => d.date === iso);
        if (found) {
            dailyTrend.push(found);
        } else {
            dailyTrend.push({ date: iso, currency: 'CNY', income: 0, expense: 0, incomeBreakdown: { CNY: 0 }, expenseBreakdown: { CNY: 0 } });
        }
        cur.setDate(cur.getDate() + 1);
    }

    // 预算执行（多币种 P2-2d：actual 子查询已合并到 budgetRows，每行带 actual_breakdown_json）
    let budgetExecution = [];
    if (hasMonths) {
        // 按预算名称去重合并（同一名称可能有不同周期的预算，取时间重叠的）
        const seen = new Set();
        for (const b of budgetRows) {
            const key = b.name;
            if (seen.has(key)) continue;
            seen.add(key);
            const actualBreakdown = _parseJsonBreakdown(b.actual_breakdown_json);
            const actualCur = _pickPrimaryCurrency(actualBreakdown);
            const actual = actualBreakdown[actualCur] || 0;
            const budget = parseFloat(b.budget_amount);
            budgetExecution.push({
                id: b.cat_id || b.id,
                name: b.name,
                icon: b.icon || '💰',
                currency: actualCur,
                budget, actual,
                actualBreakdown,
                usage: budget > 0 ? (actual / budget * 100) : 0
            });
        }
        budgetExecution = budgetExecution
            .filter(b => b.budget > 0 || b.actual > 0)
            .sort((a, b) => b.actual - a.actual);
    }

    // 多币种 P2-2d：账户/持仓余额合计按 currency GROUP BY → breakdown 字典
    const accountsBreakdown = _rowsToBreakdown(accountAssets, 'total');
    const accountsCurrency = _pickPrimaryCurrency(accountsBreakdown);
    const accountsTotal = accountsBreakdown[accountsCurrency] || 0;
    const invBreakdown = _rowsToBreakdownMulti(invAssets, ['total_value', 'total_cost']);
    const invCurrency = _pickPrimaryCurrency(invBreakdown);
    const investmentsTotal = (invBreakdown[invCurrency] && invBreakdown[invCurrency].total_value) || 0;
    const investmentsTotalCost = (invBreakdown[invCurrency] && invBreakdown[invCurrency].total_cost) || 0;
    // 总额 = 账户余额 + 持仓市值（主货币值；前端 kpiHero 用 FxManager 折算 baseCurrency）
    const totalAssets = accountsTotal + investmentsTotal;

    // 多币种 P2-2d：环比按 currency GROUP BY → breakdown
    let compare = null;
    if (prev && prevRows && prevRows.length) {
        const compareBreakdown = _rowsToBreakdownMulti(prevRows, ['income', 'expense']);
        const compareCurrency = _pickPrimaryCurrency(compareBreakdown);
        const pi = (compareBreakdown[compareCurrency] && compareBreakdown[compareCurrency].income) || 0;
        const pe = (compareBreakdown[compareCurrency] && compareBreakdown[compareCurrency].expense) || 0;
        compare = {
            period: prev.period, label: prevRange.label,
            currency: compareCurrency,
            income: pi, expense: pe, balance: pi - pe,
            incomeBreakdown: compareBreakdown, expenseBreakdown: compareBreakdown
        };
    }

    // 债务数据汇总（本期）—— debtAll / debtRepayments 已在上方 Promise.all 并发获取，此处直接消费
    // 多币种 P2-2d：debtRepayments 自身带 currency（P2-2d 加列）；按 currency 累加得 periodPaidBreakdown
    const repByDebt = {};
    const periodPaidBreakdown = {};
    let periodPaid = 0;
    debtRepayments.forEach(r => {
        const amt = parseFloat(r.amount);
        const cur = r.currency || 'CNY';
        periodPaid += amt;
        periodPaidBreakdown[cur] = (periodPaidBreakdown[cur] || 0) + amt;
        (repByDebt[r.debt_id] = repByDebt[r.debt_id] || []).push({
            amount: amt,
            principal_part: parseFloat(r.principal_part || 0),
            interest_part: parseFloat(r.interest_part || 0),
            currency: cur,
            paid_at: r.paid_at.toISOString ? r.paid_at.toISOString().slice(0, 10) : String(r.paid_at).slice(0, 10),
            note: r.note || ''
        });
    });
    let overdueCount = 0;
    // 债务余额合计（多币种 P2-2d：debts.currency 已在 P2-2c 加列）
    const debtRemainingBreakdown = {};
    const debtList = debtAll.map(d => {
        const reps = repByDebt[d.id] || [];
        const periodPaidForDebt = reps.reduce((s, r) => s + r.amount, 0);
        if (d.status === 'overdue') overdueCount++;
        const cur = d.currency || 'CNY';
        debtRemainingBreakdown[cur] = (debtRemainingBreakdown[cur] || 0) + parseFloat(d.remaining);
        return {
            id: d.id,
            name: d.name,
            type: d.type,
            currency: cur,
            principal: parseFloat(d.principal),
            remaining: parseFloat(d.remaining),
            monthly_payment: parseFloat(d.monthly_payment || 0),
            status: d.status,
            due_date: d.due_date ? (d.due_date.toISOString ? d.due_date.toISOString().slice(0, 10) : String(d.due_date).slice(0, 10)) : null,
            periodRepayments: reps.length,
            periodPaid: Math.round(periodPaidForDebt * 100) / 100
        };
    });
    const debtRemainingCurrency = _pickPrimaryCurrency(debtRemainingBreakdown);
    const totalRemaining = debtRemainingBreakdown[debtRemainingCurrency] || 0;
    const flatRepayments = [];
    Object.keys(repByDebt).forEach(did => {
        const debt = debtAll.find(d => d.id == did);
        repByDebt[did].forEach(r => {
            flatRepayments.push({
                debt_id: parseInt(did),
                debt_name: debt ? debt.name : '',
                amount: r.amount,
                currency: r.currency,
                principal_part: r.principal_part,
                interest_part: r.interest_part,
                paid_at: r.paid_at,
                note: r.note
            });
        });
    });

    // 资产负债表与现金流量表彼此独立，与上方查询也无依赖，并发执行进一步压缩延迟
        const [balanceSheet, cashFlow] = await Promise.all([
        buildBalanceSheet(userId, bookId, start, end, totalAssets),
        buildCashFlow(userId, bookId, start, end, income, expense, periodPaid, periodPaidBreakdown),
    ]);

    return {
        type, period,
        label: range.label,
        start, end, days,
        summary: {
            income, expense, balance,
            currency: summaryCurrency,
            incomeBreakdown: summaryBreakdown, expenseBreakdown: summaryBreakdown,
            savingsRate: income > 0 ? ((balance / income) * 100) : 0,
            transactionCount: txCountTotal,
            avgDailyExpense: expense / days
        },
        dailyTrend,
        expenseByCategory: expByCat.map(r => ({
            ...r,
            totalBreakdown: _parseJsonBreakdown(r.total_breakdown_json),
            currency: _pickPrimaryCurrency(_parseJsonBreakdown(r.total_breakdown_json)),
            total: (() => { const bd = _parseJsonBreakdown(r.total_breakdown_json); const cur = _pickPrimaryCurrency(bd); return bd[cur] || 0; })()
        })),
        incomeByCategory: incByCat.map(r => ({
            ...r,
            totalBreakdown: _parseJsonBreakdown(r.total_breakdown_json),
            currency: _pickPrimaryCurrency(_parseJsonBreakdown(r.total_breakdown_json)),
            total: (() => { const bd = _parseJsonBreakdown(r.total_breakdown_json); const cur = _pickPrimaryCurrency(bd); return bd[cur] || 0; })()
        })),
        accountFlows: accountFlows.map(r => ({ ...r, net: parseFloat(r.net), currency: r.currency || 'CNY' })),
        topExpenses: topExpenses.map(t => ({ ...t, amount: parseFloat(t.amount), currency: t.currency || 'CNY' })),
        budgetExecution,
        assets: {
            totalAssets,
            netWorth: totalAssets - totalRemaining,
            accounts: accountsTotal,
            investments: investmentsTotal,
            currency: accountsCurrency,
            accountsBreakdown,
            investmentsBreakdown: invBreakdown
        },
        debts: {
            count: debtList.length,
            totalRemaining,
            currency: debtRemainingCurrency,
            totalRemainingBreakdown: debtRemainingBreakdown,
            paidInPeriod: Math.round(periodPaid * 100) / 100,
            paidInPeriodBreakdown: periodPaidBreakdown,
            repaymentCount: debtRepayments.length,
            overdue: overdueCount,
            list: debtList,
            repayments: flatRepayments
        },
        compare,
        balanceSheet,
        cashFlow,
        // ===== 关键财务比率 =====
        ratios: {
            savingsRate: income > 0 ? Math.round((balance / income * 100) * 10) / 10 : 0,
            debtRatio: totalAssets > 0 ? Math.round((totalRemaining / totalAssets * 100) * 10) / 10 : 0,
            debtPaymentRatio: income > 0 ? Math.round((periodPaid / income * 100) * 10) / 10 : 0,
            assetLiabilityRatio: totalAssets > 0 ? Math.round((totalRemaining / totalAssets * 100) * 10) / 10 : 0,
            currentRatio: totalAssets > 0 ? Math.round((accountsTotal / Math.max(0.01, totalRemaining)) * 100) / 100 : 0
        }
    };
}

// ==================== 资产负债表（期末快照+期初对比）====================
async function buildBalanceSheet(userId, bookId, periodStart, periodEnd, currentTotalAssets) {
    // 资产明细 / 投资持仓 / 长期负债 / 期初前交易净额 —— 彼此独立，并发查询压缩延迟
    // 多币种 P2-2d：accounts/investments/debts.currency 列已就位（P2-2a/2c/2d），SELECT 显式读出
    const [accounts, investments, longTermDebts, txBefore] = await Promise.all([
        db.query(
            'SELECT id, name, type, balance, credit_limit, currency FROM accounts WHERE user_id = ? AND book_id = ? AND status = \'active\' ORDER BY balance DESC',
            [userId, bookId]
        ),
        db.query(
            `SELECT i.id, i.name, i.total_cost, i.current_value, i.investment_type_id, i.currency, it.category, it.name AS type_name
             FROM investments i
             LEFT JOIN investment_types it ON i.investment_type_id = it.id
             WHERE i.user_id = ? AND i.book_id = ? AND i.status = 'holding'`,
            [userId, bookId]
        ),
        db.query(
            `SELECT id, name, type, remaining, term_months, currency FROM debts
             WHERE user_id = ? AND book_id = ? AND status != 'paid_off'
             ORDER BY term_months DESC`,
            [userId, bookId]
        ),
        db.queryOne(
            `SELECT
                COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) as net,
                COUNT(*) as cnt
             FROM transactions WHERE user_id = ? AND book_id = ? AND date < ?`,
            [userId, bookId, periodStart]
        ),
    ]);

    // 现金 = 余额为正的账户
    const liquidAssets = accounts.filter(a => parseFloat(a.balance) > 0);
    // 多币种 P2-2d：流动资产按 currency 分组得 breakdown；主货币按余额绝对值最大选
    const liquidTotalBreakdown = {};
    liquidAssets.forEach(a => {
        const cur = a.currency || 'CNY';
        liquidTotalBreakdown[cur] = (liquidTotalBreakdown[cur] || 0) + parseFloat(a.balance);
    });
    const liquidTotalCurrency = _pickPrimaryCurrency(liquidTotalBreakdown);
    const liquidTotal = liquidTotalBreakdown[liquidTotalCurrency] || 0;

    // 投资资产——多币种 P2-2d：按 investments.currency 分组
    const investTotalBreakdown = {};
    investments.forEach(i => {
        const cur = i.currency || 'CNY';
        investTotalBreakdown[cur] = (investTotalBreakdown[cur] || 0) + parseFloat(i.current_value);
    });
    const investTotalCurrency = _pickPrimaryCurrency(investTotalBreakdown);
    const investTotal = investTotalBreakdown[investTotalCurrency] || 0;

    // 信用卡已用额度：余额为负时 = -balance（欠款）；余额为正时 = limit - balance（可用额度）
    // 多币种 P2-2d：按 currency 分组
    const ccDebtBreakdown = {};
    accounts.filter(a => a.credit_limit).forEach(a => {
        const limit = parseFloat(a.credit_limit) || 0;
        const bal = parseFloat(a.balance) || 0;
        const owed = bal <= 0 ? Math.max(0, -bal) : Math.max(0, limit - bal);
        if (owed <= 0) return;
        const cur = a.currency || 'CNY';
        ccDebtBreakdown[cur] = (ccDebtBreakdown[cur] || 0) + owed;
    });
    const ccDebtCurrency = _pickPrimaryCurrency(ccDebtBreakdown);
    const ccDebt = ccDebtBreakdown[ccDebtCurrency] || 0;

        // 账户类型 → 显示名称
    const accountTypeNames = {
        cash: '现金',
        bank_card: '储蓄卡',
        credit_card: '信用卡',
        electronic_payment: '电子支付',
        financial_account: '理财账户',
        digital: '数字钱包',
        other: '其他'
    };
    // 投资品类 → 显示名称
    const investmentCategoryNames = {
        stock: 'A股',
        fund: '基金',
        deposit: '理财产品',
        crypto: '加密货币',
        hk_stock: '港股',
        us_stock: '美股',
        commodity: '商品',
        forex: '外汇',
        other: '其他'
    };

    // 流动资产按账户类型汇总（信用卡只在负债端展示，已用额度不计入资产）
    const currentByType = {};
    liquidAssets.forEach(a => {
        const key = a.type || 'other';
        currentByType[key] = (currentByType[key] || 0) + parseFloat(a.balance);
    });
    const currentItems = Object.entries(currentByType)
        .filter(([, total]) => Math.abs(total) > 0.005)
        .map(([type, total]) => ({
            type,
            name: accountTypeNames[type] || '其他',
            total: Math.round(total * 100) / 100
        }));

    // 投资资产按品类汇总；「其他」类按具体投资类型名拆分显示
    const investByCategory = {};
    investments.forEach(i => {
        const cat = i.category || 'other';
        const isOther = cat === 'other';
        const key = isOther ? `other:${i.type_name || '其他'}` : cat;
        const name = isOther ? (i.type_name || '其他') : (investmentCategoryNames[cat] || '其他');
        if (!investByCategory[key]) investByCategory[key] = { name, total: 0 };
        investByCategory[key].total += parseFloat(i.current_value);
    });
    const investmentItems = Object.entries(investByCategory)
        .filter(([, item]) => Math.abs(item.total) > 0.005)
        .map(([, item]) => ({
            category: 'other',
            name: item.name,
            total: Math.round(item.total * 100) / 100
        }));

    // 多币种 P2-2d：长期/短期负债均按 currency 分组
    const longTermDebtBreakdown = {};
    longTermDebts.filter(d => (parseInt(d.term_months) || 0) >= 12).forEach(d => {
        const cur = d.currency || 'CNY';
        longTermDebtBreakdown[cur] = (longTermDebtBreakdown[cur] || 0) + parseFloat(d.remaining);
    });
    const longTermDebtCurrency = _pickPrimaryCurrency(longTermDebtBreakdown);
    const longTermDebt = longTermDebtBreakdown[longTermDebtCurrency] || 0;
    // 短期负债：term < 12 个月 或 term = 0（如个人借款、无期限）且 type != credit_card
    const shortTermDebtBreakdown = {};
    longTermDebts.filter(d => (parseInt(d.term_months) || 0) < 12 && d.type !== 'credit_card').forEach(d => {
        const cur = d.currency || 'CNY';
        shortTermDebtBreakdown[cur] = (shortTermDebtBreakdown[cur] || 0) + parseFloat(d.remaining);
    });
    const shortTermDebtCurrency = _pickPrimaryCurrency(shortTermDebtBreakdown);
    const shortTermDebt = shortTermDebtBreakdown[shortTermDebtCurrency] || 0;
    // 信用卡已用部分 = 信用卡的负债（按 credit_limit 减去可用余额）
    const creditCardLiab = ccDebt;

    const totalLiabilities = longTermDebt + shortTermDebt + creditCardLiab;
    const totalAssets = liquidTotal + investTotal;
    const netWorth = totalAssets - totalLiabilities;

    // 期末/期初对比：通过查 periodStart 之前的资产估算期初
    const netBefore = parseFloat(txBefore.net);
    const openingAssets = totalAssets - netBefore;
    const openingNetWorth = openingAssets - totalLiabilities;

    // 多币种 P2-2d：负债总额按 currency 合并 breakdown（长/短/信用卡三段同币种叠加）
    const liabilitiesBreakdown = {};
    Object.entries(longTermDebtBreakdown).forEach(([k, v]) => { liabilitiesBreakdown[k] = (liabilitiesBreakdown[k] || 0) + v; });
    Object.entries(shortTermDebtBreakdown).forEach(([k, v]) => { liabilitiesBreakdown[k] = (liabilitiesBreakdown[k] || 0) + v; });
    Object.entries(ccDebtBreakdown).forEach(([k, v]) => { liabilitiesBreakdown[k] = (liabilitiesBreakdown[k] || 0) + v; });

    return {
        period: { start: periodStart, end: periodEnd },
        assets: {
            current: {
                items: currentItems,
                total: Math.round(liquidTotal * 100) / 100,
                currency: liquidTotalCurrency,
                totalBreakdown: liquidTotalBreakdown
            },
            investment: {
                items: investmentItems,
                total: Math.round(investTotal * 100) / 100,
                currency: investTotalCurrency,
                totalBreakdown: investTotalBreakdown
            },
            total: Math.round(totalAssets * 100) / 100,
            currency: liquidTotalCurrency,
            totalBreakdown: { [liquidTotalCurrency]: totalAssets }
        },
        liabilities: {
            shortTerm: {
                items: longTermDebts.filter(d => (parseInt(d.term_months) || 0) < 12 && d.type !== 'credit_card').map(d => ({
                    id: d.id, name: d.name, type: d.type, currency: d.currency || 'CNY', remaining: parseFloat(d.remaining), term_months: d.term_months
                })),
                total: Math.round(shortTermDebt * 100) / 100,
                currency: shortTermDebtCurrency,
                totalBreakdown: shortTermDebtBreakdown
            },
            creditCard: {
                total: Math.round(creditCardLiab * 100) / 100,
                currency: ccDebtCurrency,
                totalBreakdown: ccDebtBreakdown,
                note: '信用卡已用额度（实时余额为负时表示欠款）'
            },
            longTerm: {
                items: longTermDebts.filter(d => (parseInt(d.term_months) || 0) >= 12 || d.type === 'loan').filter((d, idx, arr) => arr.findIndex(x => x.id === d.id) === idx).map(d => ({
                    id: d.id, name: d.name, type: d.type, currency: d.currency || 'CNY', remaining: parseFloat(d.remaining), term_months: d.term_months
                })),
                total: Math.round(longTermDebt * 100) / 100,
                currency: longTermDebtCurrency,
                totalBreakdown: longTermDebtBreakdown
            },
            total: Math.round(totalLiabilities * 100) / 100,
            currency: _pickPrimaryCurrency(liabilitiesBreakdown),
            totalBreakdown: liabilitiesBreakdown
        },
        netWorth: Math.round(netWorth * 100) / 100,
        netWorthBreakdown: { [liquidTotalCurrency]: netWorth },
        openingNetWorth: Math.round(openingNetWorth * 100) / 100,
        change: Math.round((netWorth - openingNetWorth) * 100) / 100
    };
}

// ==================== 现金流量表（按活动分类）====================
async function buildCashFlow(userId, bookId, start, end, income, expense, debtRepayment, periodPaidBreakdown = null) {
    // 经营活动：日常收支（expense + income，不含投资交易和转账的净额）
    const operatingIncome = income;
    const operatingExpense = expense;
    const operatingNet = operatingIncome - operatingExpense;

    // 投资活动：投资增减（买入/卖出/新借债务彼此独立，并发查询）
    // 多币种 P2-2d：investment_transactions.currency 与 debts.currency 列已就位，
    // 按 currency GROUP BY 直接返回 breakdown，JS 端不再 JOIN
    const [investBuy, investSell, debtNew] = await Promise.all([
        db.query(
            `SELECT currency, COALESCE(SUM(amount), 0) AS total FROM investment_transactions
             WHERE user_id = ? AND book_id = ? AND type = 'buy' AND date BETWEEN ? AND ?
             GROUP BY currency`,
            [userId, bookId, start, end]
        ),
        db.query(
            `SELECT currency, COALESCE(SUM(amount), 0) AS total FROM investment_transactions
             WHERE user_id = ? AND book_id = ? AND type = 'sell' AND date BETWEEN ? AND ?
             GROUP BY currency`,
            [userId, bookId, start, end]
        ),
        db.query(
            `SELECT currency, COALESCE(SUM(principal), 0) AS total FROM debts
             WHERE user_id = ? AND book_id = ? AND status != 'paid_off' AND created_at BETWEEN ? AND ?
             GROUP BY currency`,
            [userId, bookId, start + ' 00:00:00', end + ' 23:59:59']
        ),
    ]);
    // 多币种 P2-2d：投资活动按 currency 累加得 breakdown；主货币按绝对值最大选
    const investInflowBreakdown = _rowsToBreakdown(investSell, 'total');
    const investOutflowBreakdown = _rowsToBreakdown(investBuy, 'total');
    const investInflowCur = _pickPrimaryCurrency(investInflowBreakdown);
    const investOutflowCur = _pickPrimaryCurrency(investOutflowBreakdown);
    const investInflow = investInflowBreakdown[investInflowCur] || 0;  // 卖出 = 现金流入
    const investOutflow = investOutflowBreakdown[investOutflowCur] || 0;  // 买入 = 现金流出
    const investNet = investInflow - investOutflow; // 正数表示投资变现>投入

    // 筹资活动：债务增减 + 转账净额——多币种 P2-2d：breakdown
    const financingInflowBreakdown = _rowsToBreakdown(debtNew, 'total');
    const financingInflowCur = _pickPrimaryCurrency(financingInflowBreakdown);
    const financingInflow = financingInflowBreakdown[financingInflowCur] || 0; // 借入
    // 还款 outflow 来自 buildReport 主段的 debtRepayments 累加（已含 currency breakdown → periodPaidBreakdown）
    const financingOutflowBreakdown = periodPaidBreakdown || { CNY: debtRepayment };
    const financingOutflowCur = _pickPrimaryCurrency(financingOutflowBreakdown);
    const financingOutflow = financingOutflowBreakdown[financingOutflowCur] || debtRepayment; // 还款流出
    const financingNet = financingInflow - financingOutflow;

    const netChange = operatingNet + investNet + financingNet;

    return {
        operating: {
            inflow: Math.round(operatingIncome * 100) / 100,
            outflow: Math.round(operatingExpense * 100) / 100,
            net: Math.round(operatingNet * 100) / 100,
            label: '日常收支'
        },
        investing: {
            inflow: Math.round(investInflow * 100) / 100,
            outflow: Math.round(investOutflow * 100) / 100,
            net: Math.round(investNet * 100) / 100,
            currency: investInflowCur,
            inflowBreakdown: investInflowBreakdown,
            outflowBreakdown: investOutflowBreakdown,
            label: '投资活动'
        },
        financing: {
            inflow: Math.round(financingInflow * 100) / 100,
            outflow: Math.round(financingOutflow * 100) / 100,
            net: Math.round(financingNet * 100) / 100,
            currency: financingInflowCur,
            inflowBreakdown: financingInflowBreakdown,
            outflowBreakdown: financingOutflowBreakdown,
            label: '筹资活动（债务）'
        },
        netChange: Math.round(netChange * 100) / 100,
        note: '净变化 = 经营 + 投资 + 筹资；正值表示现金增加'
    };
}

// ==========================================
// 路由
// ==========================================

// ==========================================
// Top5 交易排行（按 支出/收入 分别取）
// 综合 /reports 的 topExpenses 只返回支出 Top5，收入页需要独立的 Top5。
// 参数：period=YYYY-MM（锁月），type=expense|income
// ==========================================
router.get('/top-transactions', async (req, res) => {
    try {
        const { period, type = 'expense' } = req.query;
        // 支持三种周期形态，与 /reports 的 period 保持一致：
        //   'YYYY-MM'            按月
        //   'YYYY'               按年（原本会被 regex 拒掉 → 按年查看时明细排行一直是空的）
        //   'YYYY-MM~YYYY-MM'    自定义区间
        // 只认 YYYY-MM 的话，客户端在按年/自定义下拿到 400，
        // 而前端对这个请求做了 catch 降级（失败就不显示卡片），所以一直没人发现。
        let start;
        let end;
        if (!period) {
            return res.status(400).json(fail('请指定周期（YYYY-MM / YYYY / YYYY-MM~YYYY-MM）'));
        }
        if (/^\d{4}-\d{2}$/.test(period)) {
            const y = parseInt(period.slice(0, 4), 10);
            const m = parseInt(period.slice(5, 7), 10);
            start = `${period}-01`;
            end = `${period}-${lastDayOfMonth(y, m)}`;
        } else if (/^\d{4}$/.test(period)) {
            start = `${period}-01-01`;
            end = `${period}-12-31`;
        } else if (period.indexOf('~') > 0) {
            try {
                const range = parseReportPeriod('custom', period);
                start = range.start;
                end = range.end;
            } catch (e) {
                return res.status(400).json(fail('自定义区间格式错误'));
            }
        } else {
            return res.status(400).json(fail('请指定周期（YYYY-MM / YYYY / YYYY-MM~YYYY-MM）'));
        }
        const tType = type === 'income' ? 'income' : 'expense';
        // 多币种 P2-2d：LEFT JOIN accounts 取 currency——交易本身无 currency 列，币种跟随账户
        const rows = await db.query(
            `SELECT t.id, t.date, t.amount, t.note, c.name as category_name, c.icon as category_icon, a.currency
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts a ON t.account_id = a.id
             WHERE t.user_id = ? AND t.book_id = ? AND t.type = ? AND t.date >= ? AND t.date <= ?
             ORDER BY t.amount DESC LIMIT 5`,
            [req.userId, req.bookId, tType, start, end]
        );
        res.json(success({
            items: rows.map(r => ({
                ...r,
                amount: parseFloat(r.amount),
                currency: r.currency || 'CNY'
            }))
        }));
    } catch (err) {
        handleServerError(res, err, '查询 Top 交易');
    }
});

router.get('/', async (req, res) => {
    try {
        const { type = 'monthly', period } = req.query;
        if (!period) return res.status(400).json(fail('请指定报表周期'));

        const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
        const key = reportCacheKey(req.userId, req.bookId, type, period);

        if (!fresh) {
            const cached = getCachedReport(key);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.set('Cache-Control', `public, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
                return res.json(success(cached));
            }
        }

        const data = await buildReport(req.userId, req.bookId, type, period);
        setCachedReport(key, data);
        res.set('X-Cache', fresh ? 'BYPASS' : 'MISS');
        res.set('Cache-Control', `public, max-age=${Math.floor(REPORT_CACHE_TTL_MS / 1000)}`);
        res.json(success(data));
    } catch (err) {
        if (err.message && (err.message.includes('格式错误') || err.message.includes('不支持的报表类型'))) {
            return res.status(400).json(fail(err.message));
        }
        handleServerError(res, err, '生成报表');
    }
});

module.exports = router;
