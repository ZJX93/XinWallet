/* ============================================
   Insight Engine
   ------------------------------------------------
   主动洞察生成引擎。
   13 种洞察类型：
     spending_spike / spending_drop / budget_near /
     budget_exceeded / income_increase / income_decrease /
     balance_anomaly / merchant_new / category_shift /
     savings_opportunity / debt_alert / investment_alert /
     habit_change / trend / other

   触发方式：
     - transaction.created Event Bus 触发（实时分析）
     - 定时任务定期扫描（每日/每周）
     - 手动触发（用户下拉刷新）

   设计原则：
     - importance >= 3 才推送
     - cooldown 防止短期内重复推送
     - 去重键 dedupe_key 避免同一洞察重复生成
     - 所有异常吞掉，不污染主事务
   ============================================ */

const db = require('../../../db');

/**
 * 相对今天的截止日期（YYYY-MM-DD），n 为负数表示过去。
 * ⛔ 为什么必须这么做：项目是 MySQL / PostgreSQL 双方言，而两者的 INTERVAL 字面量
 *    语法互不兼容（MySQL `INTERVAL 30 DAY` vs PG `INTERVAL '30 days'`），
 *    原生写法在 PG 下直接语法错误。统一改为 JS 侧算好日期再参数绑定下发（与 debts.js 同款处理）。
 * @param {number} n 正数=今天起 N 天后；负数=N 天前
 */
function daysOffset(n) {
    const d = new Date();
    d.setDate(d.getDate() + Number(n));
    return d.toISOString().slice(0, 10);
}

/**
 * 取某日期所在自然周的周一（本地时间，YYYY-MM-DD）。
 * 用于替代方言相关的 `DATE_TRUNC('week', date)`（PG 专属，MySQL 无此函数）。
 */
function weekKey(dateVal) {
    // pg 驱动把 TIMESTAMP 列解析成 Date 对象；MySQL 与参数化查询可能返回 'YYYY-MM-DD' 字符串，两者都要兼容
    const raw = dateVal instanceof Date
        ? dateVal.toISOString().slice(0, 10)
        : String(dateVal == null ? '' : dateVal).slice(0, 10);
    if (!raw) return null;
    const d = new Date(raw + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const day = d.getDay();               // 0=周日
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

/** 所有洞察类型的定义（type → label + default importance） */
const INSIGHT_TYPES = {
  spending_spike:      { label: '消费突增',     defaultImportance: 4 },
  spending_drop:       { label: '消费骤降',     defaultImportance: 3 },
  budget_near:         { label: '预算临近',     defaultImportance: 4 },
  budget_exceeded:     { label: '预算超支',     defaultImportance: 5 },
  income_increase:     { label: '收入增加',     defaultImportance: 3 },
  income_decrease:     { label: '收入减少',     defaultImportance: 4 },
  balance_anomaly:     { label: '余额异常',     defaultImportance: 5 },
  merchant_new:        { label: '新商家出现',   defaultImportance: 2 },
  category_shift:       { label: '类目变化',     defaultImportance: 3 },
  savings_opportunity: { label: '储蓄建议',     defaultImportance: 3 },
  debt_alert:          { label: '债务提醒',     defaultImportance: 4 },
  investment_alert:    { label: '投资提醒',     defaultImportance: 3 },
  habit_change:        { label: '消费习惯变化', defaultImportance: 3 },
  trend:               { label: '趋势洞察',     defaultImportance: 2 },
  other:               { label: '其他洞察',     defaultImportance: 2 },
};

// 默认 cooldown（毫秒），同一类型洞察重复生成间隔
const DEFAULT_COOLDOWN_MS = {
  spending_spike:      7 * 24 * 3600 * 1000,  // 7 天
  spending_drop:       7 * 24 * 3600 * 1000,
  budget_near:         3 * 24 * 3600 * 1000,  // 3 天
  budget_exceeded:     1 * 24 * 3600 * 1000,  // 1 天（超支更要紧）
  income_increase:     14 * 24 * 3600 * 1000,
  income_decrease:     3 * 24 * 3600 * 1000,
  balance_anomaly:    1 * 24 * 3600 * 1000,
  merchant_new:        30 * 24 * 3600 * 1000, // 新商家不频繁，30天
  category_shift:      14 * 24 * 3600 * 1000,
  savings_opportunity: 7 * 24 * 3600 * 1000,
  debt_alert:          1 * 24 * 3600 * 1000,
  investment_alert:    7 * 24 * 3600 * 1000,
  habit_change:        14 * 24 * 3600 * 1000,
  trend:               7 * 24 * 3600 * 1000,
  other:               7 * 24 * 3600 * 1000,
};

/**
 * 生成去重键（cooldown 内的 dedupe_key 相同则认为是重复洞察）
 * @param {number} userId
 * @param {string} insightType
 * @param {string} keySuffix  类型特定的业务键（如 merchant_id, category_id）
 */
function makeDedupeKey(userId, insightType, keySuffix) {
  return `${userId}:${insightType}:${keySuffix}`;
}

/**
 * 检查是否在 cooldown 期内（cooldown_until > now）
 */
async function isInCooldown(userId, insightType, dedupeKey) {
  try {
    const row = await db.queryOne(
      `SELECT cooldown_until FROM ai_insights
        WHERE user_id = ? AND insight_type = ? AND dedupe_key = ?
          AND cooldown_until IS NOT NULL AND cooldown_until > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [userId, insightType, dedupeKey]
    );
    return !!row;
  } catch (_) {
    return false; // 表不存在时跳过 cooldown 检查
  }
}

/**
 * 写入一条洞察（幂等：cooldown 期内的重复写入会被 skip）
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {number} [params.bookId]
 * @param {string} params.insightType
 * @param {string} params.title
 * @param {string} params.content
 * @param {object} [params.evidence]
 * @param {string} [params.actionSuggestion]
 * @param {number} [params.importance]  默认使用 INSIGHT_TYPES 中的值
 * @param {string} [params.dedupeKeySuffix]  dedupe_key 的业务部分
 * @returns {Promise<{ok: boolean, id?: number, skipped?: boolean}>}
 */
async function generateInsight({
  userId, bookId = null, insightType, title, content,
  evidence = {}, actionSuggestion = null, importance = null,
  dedupeKeySuffix = '',
}) {
  try {
    const info = INSIGHT_TYPES[insightType] || INSIGHT_TYPES.other;
    const finalImportance = importance ?? info.defaultImportance;

    // cooldown 检查
    const dedupeKey = dedupeKeySuffix
      ? makeDedupeKey(userId, insightType, dedupeKeySuffix)
      : null;
    if (dedupeKey) {
      const inCooldown = await isInCooldown(userId, insightType, dedupeKey);
      if (inCooldown) return { ok: true, skipped: true };
    }

    const cooldownMs = DEFAULT_COOLDOWN_MS[insightType] || (7 * 24 * 3600 * 1000);
    const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();

    const result = await db.query(
      `INSERT INTO ai_insights
         (user_id, book_id, insight_type, importance, title, content,
          evidence, action_suggestion, dedupe_key, cooldown_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, bookId, insightType, finalImportance, title, content,
       JSON.stringify(evidence), actionSuggestion, dedupeKey, cooldownUntil]
    );

    return { ok: true, id: result.insertId };
  } catch (err) {
    // 唯一索引冲突（cooldown_until 非空时的 dedupe_key 重复）→ 静默跳过
    if (/duplicate key|ER_DUP_KEY|23505|1062/i.test(err.message)) {
      return { ok: true, skipped: true };
    }
    console.warn('⚠️ generateInsight 失败（不影响主流程）:', err.message);
    return { ok: false };
  }
}

// ============================================
// 洞察分析器（每种类型一个分析函数）
// ============================================

/**
 * 消费突增检测：与过去 4 周平均值比，当前周涨幅超过 50% 且绝对金额 > 500 元
 */
async function analyzeSpendingSpike(userId, bookId, weekStart) {
  // 读取最近 5 周支出明细，按自然周在 JS 侧聚合。
  // ⛔ 为什么不在 SQL 里 GROUP BY 周：`DATE_TRUNC('week', ...)` 是 PG 专属，
  //    MySQL 等价写法完全不同；同理 INTERVAL 字面量两侧语法也不兼容。
  //    统一改为 JS 分桶，双方言行为一致。
  const rows = await db.query(`
    SELECT t.date, t.amount
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE a.user_id = ? AND a.book_id = ?
      AND t.type = 'expense'
      AND t.date >= ?
      AND t.date < ?
  `, [userId, bookId, daysOffset(-35), weekStart]);

  const byWeek = new Map();
  for (const r of rows) {
    const wk = weekKey(r.date);
    if (!wk) continue;
    byWeek.set(wk, (byWeek.get(wk) || 0) + Math.abs(Number(r.amount) || 0));
  }
  const series = [...byWeek.entries()]
    .map(([week_start, total]) => ({ week_start, total }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  if (series.length < 5) return null;
  const recent = series.slice(-4); // 最近 4 周
  const baseline = series.slice(0, -1); // 对比基准
  if (recent.length < 1 || baseline.length < 1) return null;

  const avgRecent = recent.reduce((s, r) => s + Number(r.total), 0) / recent.length;
  const currentWeek = Number(recent[recent.length - 1].total);

  if (avgRecent < 500 || currentWeek < avgRecent * 1.5) return null;

  const pct = Math.round(((currentWeek - avgRecent) / avgRecent) * 100);
  const amount = Math.round(currentWeek - avgRecent);

  return {
    insightType: 'spending_spike',
    title: `本周消费突增 ${pct}%`,
    content: `本周消费 ${currentWeek.toFixed(2)} 元，比近 4 周均值（${avgRecent.toFixed(2)} 元）高出约 ${amount.toFixed(2)} 元。`,
    evidence: { weeks: rows.map(r => ({ week: String(r.week_start), total: Number(r.total) })),
               avg_recent: avgRecent, current: currentWeek, increase_pct: pct },
    dedupeKeySuffix: 'week',
    importance: currentWeek > avgRecent * 2 ? 5 : 4,
  };
}

/**
 * 预算临近/超支检测
 */
async function analyzeBudgetStatus(userId, bookId) {
  /* ⛔ 为什么重写：原 SQL 引用了 budgets 表根本不存在的列
     （b.period / b.category_id / b.status），且用 PG 不存在的 t.trans_date，
     在 PostgreSQL 下必然报 "column does not exist"，导致预算洞察整块失效。
     现按项目既定口径统计已用金额（与 budgets.js / stats.js 完全一致）：
     周期内「支出」且满足「直接关联 budget_id」或「分类名 == 预算名」之一。 */
  const budgets = await db.query(`
    SELECT b.id, b.name, b.amount AS budget_amount,
           COALESCE((
             SELECT SUM(ABS(t.amount)) FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = b.user_id AND t.book_id = b.book_id
               AND t.type = 'expense'
               AND DATE(t.date) BETWEEN b.start_date AND b.end_date
               AND (t.budget_id = b.id OR (c.name = b.name AND c.type = 'expense'))
           ), 0) AS spent
    FROM budgets b
    WHERE b.user_id = ? AND b.book_id = ?
  `, [userId, bookId]);

  const results = [];
  for (const b of budgets) {
    const ratio = Number(b.spent) / Number(b.budget_amount);
    if (ratio >= 1.0) {
      results.push({
        insightType: 'budget_exceeded',
        title: `预算超支：${b.name}`,
        content: `${b.name} 预算 ${Number(b.budget_amount).toFixed(2)} 元，已消费 ${Number(b.spent).toFixed(2)} 元，超出 ${(Number(b.spent) - Number(b.budget_amount)).toFixed(2)} 元。`,
        evidence: { budget_id: b.id, budget_name: b.name,
                    budget_amount: Number(b.budget_amount), spent: Number(b.spent), ratio },
        dedupeKeySuffix: `budget_${b.id}`,
        importance: ratio > 1.2 ? 5 : 4,
      });
    } else if (ratio >= 0.8) {
      results.push({
        insightType: 'budget_near',
        title: `预算临近：${b.name}`,
        content: `${b.name} 已消耗 ${(ratio * 100).toFixed(0)}%（${Number(b.spent).toFixed(2)} / ${Number(b.budget_amount).toFixed(2)} 元），注意控制支出。`,
        evidence: { budget_id: b.id, budget_name: b.name,
                    budget_amount: Number(b.budget_amount), spent: Number(b.spent), ratio },
        dedupeKeySuffix: `budget_${b.id}`,
        importance: 4,
      });
    }
  }
  return results;
}

/**
 * 新商家检测：过去 30 天内第一次出现的商家
 */
async function analyzeNewMerchants(userId, bookId, lookbackDays = 30) {
  const rows = await db.query(`
    SELECT t.merchant AS merchant, COUNT(*) AS cnt, SUM(ABS(t.amount)) AS total
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE a.user_id = ? AND a.book_id = ?
      AND t.merchant IS NOT NULL AND t.merchant != ''
      AND t.date >= ?
      AND t.date < ?
    GROUP BY merchant
    HAVING COUNT(*) = 1   -- 仅出现 1 次 = 新商家
    ORDER BY total DESC
    LIMIT 5
  `, [userId, bookId, daysOffset(-Number(lookbackDays)), daysOffset(-1)]);

  return rows.map(r => ({
    insightType: 'merchant_new',
    title: `新商家：${r.merchant}`,
    content: `首次在账本中记录「${r.merchant}」，消费 ${Number(r.total).toFixed(2)} 元。`,
    evidence: { merchant: r.merchant, count: Number(r.cnt), total: Number(r.total) },
    dedupeKeySuffix: `merchant_${r.merchant}`,
    importance: 2,
  }));
}

/**
 * 收入变化检测：月收入相比上月波动超过 20%
 */
async function analyzeIncomeChange(userId, bookId) {
  const rows = await db.query(`
    SELECT
      LEFT(CAST(t.date AS CHAR(10)), 7) AS month,
      SUM(ABS(t.amount)) AS total
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE a.user_id = ? AND a.book_id = ?
      AND t.type = 'income'
      AND t.date >= ?
    GROUP BY 1
    ORDER BY 1 ASC
  `, [userId, bookId, daysOffset(-90)]);

  if (rows.length < 2) return null;
  const last = Number(rows[rows.length - 1].total);
  const prev = Number(rows[rows.length - 2].total);
  if (prev < 100) return null;

  const pct = ((last - prev) / prev) * 100;
  if (Math.abs(pct) < 20) return null;

  const isIncrease = pct > 0;
  return {
    insightType: isIncrease ? 'income_increase' : 'income_decrease',
    title: `${isIncrease ? '收入增加' : '收入减少'} ${Math.abs(pct).toFixed(0)}%`,
    content: `${isIncrease ? '本月收入' : '本月收入'} ${last.toFixed(2)} 元，${isIncrease ? '比上月增长' : '比上月下降'} ${Math.abs(pct).toFixed(0)}%（上月 ${prev.toFixed(2)} 元）。`,
    evidence: { months: rows.map(r => ({ month: String(r.month), total: Number(r.total) })), pct, prev, last },
    dedupeKeySuffix: isIncrease ? 'income_up' : 'income_down',
    importance: Math.abs(pct) > 50 ? 5 : (isIncrease ? 3 : 4),
  };
}

/**
 * 余额异常检测：账户余额 < 0 或 账户余额突然下降超过 30%
 */
async function analyzeBalanceAnomaly(userId, bookId) {
  const accounts = await db.query(`
    SELECT id, name, balance FROM accounts
    WHERE user_id = ? AND book_id = ? AND status = 'active'
  `, [userId, bookId]);

  const results = [];
  for (const acc of accounts) {
    const bal = Number(acc.balance);
    if (bal < 0) {
      results.push({
        insightType: 'balance_anomaly',
        title: `账户余额为负：${acc.name}`,
        content: `账户「${acc.name}」余额为 ${bal.toFixed(2)} 元，请检查是否有未到账支出。`,
        evidence: { account_id: acc.id, account_name: acc.name, balance: bal },
        dedupeKeySuffix: `account_${acc.id}_negative`,
        importance: 5,
      });
    }
  }
  return results;
}

/**
 * 全量分析：对指定用户账本运行所有洞察检测器
 * 由 Event Bus 或定时任务调用
 */
async function runFullAnalysis(userId, bookId, options = {}) {
  const { weekStart = new Date() } = options;
  const generated = [];

  // 并发运行各分析器（各自独立，无依赖）
  const analyzers = [
    analyzeSpendingSpike(userId, bookId, weekStart),
    analyzeBudgetStatus(userId, bookId),
    analyzeNewMerchants(userId, bookId),
    analyzeIncomeChange(userId, bookId),
    analyzeBalanceAnomaly(userId, bookId),
  ];

  const results = await Promise.allSettled(analyzers);

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const items = Array.isArray(result.value) ? result.value : [result.value];
    for (const item of items) {
      if (!item.insightType) continue;
      const gen = await generateInsight({ userId, bookId, ...item });
      if (gen.ok && !gen.skipped) generated.push({ ...item, id: gen.id });
    }
  }

  return generated;
}

// ============================================
// 用户可见洞察查询
// ============================================

/**
 * 获取用户洞察列表（分页，支持过滤）
 */
async function getInsights(userId, { status, insightType, importanceGE, limit = 20, offset = 0 } = {}) {
  let sql = `SELECT * FROM ai_insights WHERE user_id = ?`;
  const params = [userId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (insightType) {
    sql += ` AND insight_type = ?`;
    params.push(insightType);
  }
  if (importanceGE != null) {
    sql += ` AND importance >= ?`;
    params.push(importanceGE);
  }

  sql += ` ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.query(sql, params);
}

/**
 * 标记洞察为已读
 */
async function markRead(userId, insightId) {
  return db.query(
    `UPDATE ai_insights SET status = 'read', read_at = NOW() WHERE id = ? AND user_id = ?`,
    [insightId, userId]
  );
}

/**
 * 忽略/驳回洞察
 */
async function dismissInsight(userId, insightId) {
  return db.query(
    `UPDATE ai_insights SET status = 'dismissed', dismissed_at = NOW() WHERE id = ? AND user_id = ?`,
    [insightId, userId]
  );
}

/**
 * 清理过期（> 90 天）且已读/已忽略的洞察，释放存储
 */
async function cleanupOldInsights(userId) {
  return db.query(
    `DELETE FROM ai_insights
       WHERE user_id = ? AND created_at < ?
         AND status IN ('read','dismissed','archived')`,
    [userId, daysOffset(-90)]
  );
}

// ============================================
// Insight Ranking
// ============================================

/**
 * 获取已排序且去重的洞察列表（供前端 Radar 使用）
 *
 * 排序规则：
 *   1. importance DESC（高重要性优先）
 *   2. created_at DESC（同类内，新者优先）
 *   3. 去重：同一 insight_type + dedupe_key 只保留最新一条
 *   4. cooldown_until 未过的洞察不显示（避免重复打扰）
 */
async function getRankedInsights(userId, {
  minImportance = 3,
  status = 'generated',
  limit = 20,
  offset = 0,
} = {}) {
  /* 按 type+dedupe_key 分组取每组最新一条，再在 JS 侧全局排序。
     ⛔ 为什么不用 `DISTINCT ON`：那是 PostgreSQL 专属语法，MySQL 完全没有；
        同理 `id::text` 的 `::` 强制转换也是 PG 专属。
        改用标准 SQL 窗口函数 ROW_NUMBER()（PG 8.4+ / MySQL 8.0+ 均支持）
        + 标准 CAST()，语义等价且双方言通用。 */
  const rows = await db.query(
    `SELECT id, insight_type, importance, title, content, dedupe_key,
            status, created_at, read_at, action_suggestion
       FROM (
         SELECT id, insight_type, importance, title, content, dedupe_key,
                status, created_at, read_at, action_suggestion,
                ROW_NUMBER() OVER (
                  PARTITION BY insight_type, COALESCE(dedupe_key, CAST(id AS CHAR))
                  ORDER BY created_at DESC
                ) AS rn
           FROM ai_insights
          WHERE user_id = ?
            AND status = ?
            AND importance >= ?
            AND (cooldown_until IS NULL OR cooldown_until <= NOW())
       ) t
      WHERE t.rn = 1`,
    [userId, status, minImportance]
  );

  const sorted = rows
    .sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return new Date(b.created_at) - new Date(a.created_at);
    })
    .slice(offset, offset + limit);

  return sorted;
}

/**
 * 获取洞察摘要统计（供 Radar 仪表盘使用）
 */
async function getInsightStats(userId) {
  try {
    const total = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM ai_insights WHERE user_id = ? AND status = 'generated'`,
      [userId]
    );
    const unread = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM ai_insights WHERE user_id = ? AND status = 'generated' AND read_at IS NULL`,
      [userId]
    );
    const byType = await db.query(
      `SELECT insight_type, COUNT(*) AS cnt
         FROM ai_insights
         WHERE user_id = ? AND status = 'generated' AND importance >= 3
         GROUP BY insight_type
         ORDER BY cnt DESC`,
      [userId]
    );

    return {
      total: parseInt(total?.cnt, 10) || 0,
      unread: parseInt(unread?.cnt, 10) || 0,
      byType: byType.reduce((acc, r) => { acc[r.insight_type] = parseInt(r.cnt, 10); return acc; }, {}),
    };
  } catch (_) {
    return { total: 0, unread: 0, byType: {} };
  }
}

/**
 * 批量忽略某类型的所有活跃洞察（如用户选择"不再提醒"某类洞察）
 */
async function dismissAllOfType(userId, insightType) {
  return db.query(
    `UPDATE ai_insights SET status = 'dismissed', dismissed_at = NOW()
       WHERE user_id = ? AND insight_type = ? AND status = 'generated'`,
    [userId, insightType]
  );
}

module.exports = {
  INSIGHT_TYPES,
  DEFAULT_COOLDOWN_MS,
  generateInsight,
  runFullAnalysis,
  getInsights,
  getRankedInsights,
  getInsightStats,
  markRead,
  dismissInsight,
  dismissAllOfType,
  cleanupOldInsights,
  makeDedupeKey,
};
