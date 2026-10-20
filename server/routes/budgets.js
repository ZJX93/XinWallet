const express = require('express');
const router = express.Router();
const db = require('../db');
const { toAmount } = require('../validate');
const { success, fail, handleServerError, fmtDateOnly, fmtDateTime } = require('./_helpers');

// 多币种 P2-2e：解析预算 actual 子查询返回的 JSON 字符串为 breakdown 字典
// （与 stats.js / reports.js 的同名函数严格同语义，便于跨文件复用）
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

// 本地日期格式化（YYYY-MM-DD）。
// ⛔ 不能用 toISOString()：new Date(y, m+1, 0) 是「本地周日午夜」，UTC+8 下
//    toISOString 会返回前一天 16:00Z，周期截止日整体少一天（负时区反而多一天），
//    导致最后一天的交易被排除在预算 actual 统计之外。必须用本地口径输出。
function fmtLocalDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 计算周期时间范围辅助函数
function calcPeriodRange(type, baseDate) {
    // 兼容 monthly/weekly/yearly → month/week/year
    const typeMap = { monthly: 'month', weekly: 'week', yearly: 'year', quarterly: 'quarter', halfyear: 'half' };
    const t = typeMap[type] || type;
    const d = new Date(baseDate + 'T00:00:00');
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-11
    let start, end;
    switch (t) {
        case 'month':
            start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
            end = fmtLocalDate(new Date(y, m + 1, 0));
            break;
        case 'quarter': {
            const q = Math.floor(m / 3);
            start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
            end = fmtLocalDate(new Date(y, (q + 1) * 3, 0));
            break;
        }
        case 'half': {
            const half = m < 6 ? 0 : 1;
            start = `${y}-${half === 0 ? '01' : '07'}-01`;
            end = fmtLocalDate(new Date(y, half === 0 ? 6 : 12, 0));
            break;
        }
        case 'year':
            start = `${y}-01-01`;
            end = `${y}-12-31`;
            break;
        default:
            start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
            end = fmtLocalDate(new Date(y, m + 1, 0));
    }
    return { start, end };
}

// GET / → 预算列表
router.get('/', async (req, res) => {
    try {
        let { period, period_type } = req.query; // period 可选 YYYY-MM-DD（兼容 YYYY-MM，自动补 01）
        // 归一化：MySQL 对 'YYYY-MM' 与 DATE 比较宽容（自动按 1 号解析），
        // PostgreSQL 会报 invalid input syntax for type date → 500。这里统一补全到月首。
        if (period && /^\d{4}-\d{2}$/.test(period)) period += '-01';
        // 预算 actual 计算口径（修复：原实现用 LEFT JOIN t.budget_id 且完全不限日期，
        // 既要求交易显式带 budget_id（多数记账不会带），又累计预算周期外的全部历史支出，
        // 导致进度条要么恒为 0、要么虚高）。
        // 现统一为：周期内「分类名 == 预算名」的支出 + 直接关联 budget_id 的支出（OR 覆盖两种记账习惯）。
        // 日期用 CAST(date AS CHAR(10)) BETWEEN，跨方言且与 monthData 口径一致，且包含月末当天非零点时刻。
        let sql = `SELECT b.*,
            COALESCE((
              SELECT ${db.jsonAgg('a.currency', 'sums.cnt')} FROM (
                SELECT t.account_id, SUM(t.amount) AS cnt
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.user_id = b.user_id AND t.book_id = b.book_id
                  AND t.type = 'expense'
                  AND DATE(t.date) BETWEEN b.start_date AND b.end_date
                  AND (t.budget_id = b.id OR (c.name = b.name AND c.type = 'expense'))
                GROUP BY t.account_id
              ) sums LEFT JOIN accounts a ON sums.account_id = a.id
            ), ${db.jsonObj("'CNY'", '0')}) AS actual_breakdown_json
            FROM budgets b
            WHERE b.user_id = ? AND b.book_id = ?`;
        const params = [req.userId, req.bookId];
        // 如果传了 period，筛选时间范围重叠的预算
        if (period) {
            sql += ' AND ? BETWEEN b.start_date AND b.end_date';
            params.push(period);
        }
        // 按周期类型筛选
        if (period_type) {
            sql += ' AND b.period_type = ?';
            params.push(period_type);
        }
        sql += ' GROUP BY b.id ORDER BY b.start_date DESC, b.id DESC';
        const budgets = await db.query(sql, params);
        res.json(success(budgets.map(b => {
            // 多币种 P2-2e：actual 走 breakdown 字典（按交易账户币种累加）
            const actualBreakdown = _parseJsonBreakdown(b.actual_breakdown_json);
            const actualCur = Object.keys(actualBreakdown).length
                ? Object.entries(actualBreakdown).reduce((a, x) => Math.abs(x[1]) > Math.abs(actualBreakdown[a] || 0) ? x[0] : a, 'CNY')
                : 'CNY';
            return {
                ...b,
                start_date: fmtDateOnly(b.start_date),
                end_date: fmtDateOnly(b.end_date),
                created_at: fmtDateTime(b.created_at),
                updated_at: fmtDateTime(b.updated_at),
                amount: parseFloat(b.amount),
                actual: actualBreakdown[actualCur] || 0,
                currency: actualCur,
                actualBreakdown
            };
        })));
    } catch (err) {
        handleServerError(res, err);
    }
});

// POST / → 新增/更新预算
router.post('/', async (req, res) => {
    try {
        const { name, amount, period_type, base_date } = req.body;
        const amountNum = toAmount(amount);
        if (!name || !name.trim() || amountNum === null || amountNum <= 0) {
            return res.status(400).json(fail('预算名称和金额必填'));
        }
        const pType = period_type || 'month';
        // M7：默认基准日取「本地今天」（UTC+8 凌晨用 toISOString 会落到前一天）
        const baseDate = base_date || fmtLocalDate(new Date());
        const range = calcPeriodRange(pType, baseDate);
        const nameStr = name.trim();
        // 多账本：预算归属当前账本；同名同期预算按本账本 upsert，避免跨账本误覆盖。
        // 数据一致性修复（审计 H2）：原「先 SELECT 再 UPDATE/INSERT」存在 TOCTOU 双插
        // 竞争——两个并发同名同期预算请求会双双通过存在性检查，最终依赖唯一约束兜底
        // 撞 500。现改为依赖唯一约束 (user_id, book_id, name, start_date, end_date)
        // 的原子 upsert：单条语句完成「存在则更新、不存在则插入」，无竞争窗口。
        // 注：updated_at 由 PG 触发器 / MySQL 侧保持创建时间维护，不参与 upsert 列。
        await db.query(
            db.upsertSql('budgets',
                ['user_id', 'book_id', 'name', 'start_date', 'end_date'],
                ['period_type', 'amount']),
            [req.userId, req.bookId, nameStr, range.start, range.end, pType, amountNum]
        );
        res.json(success(null, '预算已设置'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// PUT /:id → 更新预算
router.put('/:id', async (req, res) => {
    try {
        const { name, amount, period_type, base_date } = req.body;
        const amountNum = toAmount(amount);
        if (!name || !name.trim() || amountNum === null || amountNum <= 0) {
            return res.status(400).json(fail('名称和金额必填'));
        }
        const pType = period_type || 'month';
        // M7：默认基准日取「本地今天」（UTC+8 凌晨用 toISOString 会落到前一天）
        const baseDate = base_date || fmtLocalDate(new Date());
        const range = calcPeriodRange(pType, baseDate);
        await db.query(
            'UPDATE budgets SET name = ?, period_type = ?, start_date = ?, end_date = ?, amount = ? WHERE id = ? AND user_id = ? AND book_id = ?',
            [name.trim(), pType, range.start, range.end, amountNum, req.params.id, req.userId, req.bookId]
        );
        res.json(success(null, '预算已更新'));
    } catch (err) {
        handleServerError(res, err);
    }
});

// DELETE /:id → 删除预算
router.delete('/:id', async (req, res) => {
    try {
        // BUG-2 修复：transactions.budget_id 无外键约束，删除预算前需先置空引用，
        // 否则产生悬空 budget_id（预算列表/统计可能误关联已删除预算）。
        // 数据一致性修复（审计 H2）：两条语句并入同一事务，避免「引用已置空但预算
        // 删除失败」（或反向）留下的中间态。
        await db.transaction(async (conn) => {
            await conn.query('UPDATE transactions SET budget_id = NULL WHERE budget_id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
            await conn.query('DELETE FROM budgets WHERE id = ? AND user_id = ? AND book_id = ?', [req.params.id, req.userId, req.bookId]);
        });
        res.json(success(null, '预算已删除'));
    } catch (err) {
        handleServerError(res, err);
    }
});

module.exports = router;
