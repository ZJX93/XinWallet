/* ============================================
   鑫钱包 · 日期范围工具（审计 H6 + 附带正确性修复）
   ------------------------------------------------------------
   背景 1（性能）：SQL 里用 CAST(date AS CHAR(10)) LIKE 'YYYY-MM%' 做月度
   筛选时，对 date 列套函数会让 (user_id, date) 复合索引全部失效，
     月度汇总/报表/仪表盘随数据量线性退化。
   改为「date >= 月初 AND date < 次月初」的范围条件即可走索引
     （双方言安全：PG/MySQL 都会把 'YYYY-MM-DD' 字面量转为时间戳零点）。

   背景 2（正确性）：date 列是 TIMESTAMP（精确到秒），而
     `date <= '2025-07-31'` 在 PG/MySQL 都会把右值Cast成「当天 00:00:00」,
     导致月末/周末当天的交易全部被排除在报表之外。
   统一改用「左闭右开」区间：>= start AND < endExclusive，
     endExclusive 由 nextDay() 计算（含当天全部时刻）。
   ============================================ */

const _pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' → { start:'YYYY-MM-01', endExclusive:'次月-01' }；非法输入返回 null */
function monthRange(ym) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(ym || '').trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    const start = `${y}-${_pad(mo)}-01`;
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    return { start, endExclusive: `${ny}-${_pad(nm)}-01` };
}

/** 'YYYY' → { start:'YYYY-01-01', endExclusive:'(YYYY+1)-01-01' }；非法输入返回 null */
function yearRange(y) {
    const yr = Number(String(y || '').trim());
    if (!Number.isInteger(yr) || yr < 1000 || yr > 9999) return null;
    return { start: `${yr}-01-01`, endExclusive: `${yr + 1}-01-01` };
}

/**
 * 'YYYY-MM-DD' → 次日 'YYYY-MM-DD'（用于构造左闭右开区间的右界）。
 * 跨月/跨年/闰年均由 Date 运算处理，不自己拼字符串。
 */
function nextDay(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

/** 日期字符串加 n 天（n 可为负），返回 'YYYY-MM-DD'；非法输入返回 null */
function addDays(dateStr, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(n));
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

module.exports = { monthRange, yearRange, nextDay, addDays };
