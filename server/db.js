/* ============================================
  鑫钱包 · Database Connection Pool（PostgreSQL / MySQL 双方言）
  ------------------------------------------------------------
  通过环境变量 DB_DIALECT 切换，默认 'pg'。
  - pg     : 使用 pg 驱动，占位符 ? -> $N，自动 RETURNING id
  - mysql  : 使用 mysql2 驱动，占位符保持 ?，结果集结果归一化，
             并由应用层在 UPDATE 时自动补 updated_at（替代 PG 触发器）
  PostgreSQL 行为与此前完全一致（默认方言）。
  ============================================ */

// 当前数据库方言：'pg' | 'mysql'。默认 PostgreSQL，保持向后兼容。
const DB_DIALECT = (process.env.DB_DIALECT || 'pg').toLowerCase() === 'mysql' ? 'mysql' : 'pg';

let pool;
if (DB_DIALECT === 'mysql') {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xinwallet',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    enableKeepAlive: true,
    // 中文环境显式 utf8mb4，避免 GBK 往返
  });
} else {
  const { Pool } = require('pg');
  pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xinwallet',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // 显式指定客户端编码为 UTF-8，避免在 Windows / Git Bash 中文 locale 环境下
    // pg 驱动读取 LC_* / LANG 环境变量导致中文被错误地按 GBK 编码往返。
    options: '-c client_encoding=UTF8',
  });
}

// 按分号切分 SQL 语句；跳过 $$ ... $$ 美元引号块（PL/pgSQL 函数体），避免块内分号被误切。
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      // 美元引号分隔符始终属于外层语句，必须加入 current
      current += '$$';
      inDollarQuote = !inDollarQuote;
      i++; // 跳过第 2 个 $
      continue;
    }
    if (sql[i] === ';' && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += sql[i];
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * 检测是否为 INSERT 语句且未包含 RETURNING，自动补全 RETURNING id（仅 PostgreSQL）。
 * 返回的 rows 数组上挂载 insertId 属性（兼容旧调用方读取 .insertId；PG 实际通过 RETURNING id 获取）。
 * ON CONFLICT DO NOTHING 是 fire-and-forget，不需要 RETURNING。
 */
function autoReturning(sql) {
  const trimmed = sql.trim();
  if (!/^INSERT\s/i.test(trimmed)) return sql;
  if (/RETURNING/i.test(trimmed)) return sql;
  // 含 ON CONFLICT 的 upsert（DO NOTHING / DO UPDATE）均由调用方自行决定返回列，
  // 不应盲补 RETURNING id：ai_settings 等以 user_id 为主键、无 id 列的表会因此报
  // "column \"id\" does not exist"。返回列需 id 时，调用方应显式写 RETURNING id
  // （如 ai-settings-service.js 对 ai_settings 显式 RETURNING user_id）。
  if (/ON\s+CONFLICT/i.test(trimmed)) return sql;
  return sql + ' RETURNING id';
}

/**
 * MySQL 专用：在 UPDATE 语句中若未显式设置 updated_at，自动补上 updated_at = NOW()，
 * 以替代 PostgreSQL 的 updated_at 触发器（应用层兜底，跨方言一致）。
 * 仅处理顶层 UPDATE ... SET ...，避免误伤子查询。
 */
function autoUpdatedAt(sql) {
  const m = /^\s*(?:WITH\s+[\s\S]*?)?UPDATE\s+[`"]?\w+[`"]?\s+SET\b/i.exec(sql);
  if (!m) return sql;
  if (/\bupdated_at\s*=/.test(sql)) return sql; // 已手动设置
  const setIdx = sql.search(/\bSET\s/i);
  const tail = sql.slice(setIdx + 3);
  let insertAt = tail.length;
  const whereMatch = /\bWHERE\b/i.exec(tail);
  if (whereMatch) insertAt = whereMatch.index;
  else {
    const endMatch = /\b(ORDER\s+BY|LIMIT)\b/i.exec(tail);
    if (endMatch) insertAt = endMatch.index;
  }
  const before = tail.slice(0, insertAt).replace(/,\s*$/, '');
  return sql.slice(0, setIdx + 3) + before + ',\n  updated_at = NOW()' + tail.slice(insertAt);
}

/**
 * PostgreSQL 占位符归一化：将 `?` 风格的占位符转换为 `$N`。
 * 已存在的 `$N` 占位符保持不变，且序号从现有最大 `$N` 之后继续累加，
 * 以兼容「静态 $N 与动态 ? 混合」的语句。仅处理引号外的 `?` / `$N`，避免误伤字符串内容与 $$。
 */
function toPgPlaceholders(sql) {
  let maxN = 0;
  let inS = false, inD = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inD) { inS = !inS; continue; }
    if (ch === '"' && !inS) { inD = !inD; continue; }
    if (!inS && !inD && ch === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1, num = '';
      while (j < sql.length && /[0-9]/.test(sql[j])) { num += sql[j]; j++; }
      const n = parseInt(num, 10);
      if (n > maxN) maxN = n;
      i = j - 1;
    }
  }
  let counter = maxN;
  let out = '';
  inS = false; inD = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inD) { inS = !inS; out += ch; continue; }
    if (ch === '"' && !inS) { inD = !inD; out += ch; continue; }
    if (!inS && !inD && ch === '?') { counter++; out += '$' + counter; continue; }
    if (!inS && !inD && ch === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      out += sql.slice(i, j);
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// 归一化：根据方言准备 SQL。
function prepare(sql) {
  if (DB_DIALECT === 'mysql') {
    // MySQL 占位符直接是 ?；仅对 UPDATE 做应用层 updated_at 兜底（替代 PG 触发器）。
    let out = sql;
    // 同时识别带 CTE 前缀的 UPDATE（WITH ... UPDATE ... SET），否则这类语句
    // 会因正则不匹配而跳过 updated_at 自动填充（仅 MySQL 需要此兜底）
    if (/^\s*(?:WITH\s+[\s\S]*?)?UPDATE\s/i.test(sql)) out = autoUpdatedAt(out);
    return out;
  }
  return autoReturning(toPgPlaceholders(sql));
}

function attachInsertId(rows) {
  if (rows.length > 0 && rows[0].id !== undefined) {
    rows.insertId = rows[0].id;
  }
  return rows;
}

async function query(sql, params = []) {
  const text = prepare(sql);
  if (DB_DIALECT === 'mysql') {
    const [rows] = await pool.query(text, params);
    const arr = Array.isArray(rows) ? rows : [rows];
    if (rows && rows.insertId !== undefined) arr.insertId = rows.insertId;
    if (rows && rows.affectedRows !== undefined) arr.affectedRows = rows.affectedRows;
    return arr;
  }
  const res = await pool.query(text, params);
  return attachInsertId(res.rows);
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * 事务封装：传入的 fn 接收一个 client，内部执行 SQL。
 * 覆盖的 client.query 同样应用方言归一化。
 */
async function transaction(fn) {
  if (DB_DIALECT === 'mysql') {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const origQuery = conn.query.bind(conn);
    conn.query = async (sql, params = []) => {
      const [rows] = await origQuery(prepare(sql), params);
      const arr = Array.isArray(rows) ? rows : [rows];
      if (rows && rows.insertId !== undefined) arr.insertId = rows.insertId;
      if (rows && rows.affectedRows !== undefined) arr.affectedRows = rows.affectedRows;
      return arr;
    };
    conn.queryOne = async (sql, params = []) => {
      const rows = await conn.query(sql, params);
      return rows[0] || null;
    };
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.query = origQuery;
      delete conn.queryOne;
      conn.release();
    }
  } else {
    const client = await pool.connect();
    const origQuery = client.query.bind(client);
    client.query = async (sql, params = []) => {
      const res = await origQuery(autoReturning(toPgPlaceholders(sql)), params);
      return attachInsertId(res.rows);
    };
    // 事务连接对齐顶层 db 的能力：补齐 queryOne，供 ensureDefaultBook 等
    // 在事务内调用（否则报 client.queryOne is not a function）
    client.queryOne = async (sql, params = []) => {
      const rows = await client.query(sql, params);
      return rows[0] || null;
    };
    try {
      await origQuery('BEGIN');
      const result = await fn(client);
      await origQuery('COMMIT');
      return result;
    } catch (err) {
      await origQuery('ROLLBACK');
      throw err;
    } finally {
      client.query = origQuery; // 还原原生 query，避免污染连接池
      delete client.queryOne;
      client.release();
    }
  }
}

/**
 * 初始化数据库：确保目标库存在，并执行 schema 文件（建表 / 索引 / 约束 / 种子数据）。
 */
function warnUnlessAlreadyExists(label, err) {
  if (!err) return;
  // 建表 / 加索引 / 幂等写入常因「已存在 / 重复」而报错，属预期，忽略；
  // 其余错误才输出告警。
  if (/already exists|duplicate|ER_DUP_KEYNAME|ER_TABLE_EXISTS_ERROR/i.test(err.message)) return;
  console.warn(`⚠️ ${label}`, err.message);
}

/**
 * 分类种子自愈（数据迁移）：修复旧版初始化（投资理财分类未显式指定 id）造成的
 * 种子 id 抢占——投资分类(投资理财/投资买入/理财保险)占用 id 1/2/3，
 * 导致系统分类 餐饮/交通/购物(id 1/2/3) 被 ON CONFLICT DO NOTHING 静默跳过而缺失。
 *
 * 完全幂等：在已健康（全新）库上执行均为 no-op；在损坏库上自动纠正。
 * 每次启动由 initDatabase() 调用，无需人工干预。
 */
async function healCategoryData() {
  // 1) 交易表跟随迁移：把指向错位投资分类的交易改到目标 id（避免悬空 / 误分类）
  for (const [code, newId] of [['E1100', 901], ['E1101', 902], ['E1102', 903]]) {
    await query(
      'UPDATE transactions SET category_id = ? WHERE category_id = (SELECT id FROM categories WHERE code = ?)',
      [newId, code]
    );
  }
  // 2) 子分类 parent 指向新父 901（按 code 精确定位，不影响用户自建分类）
  await query(
    'UPDATE categories SET parent_id = 901 WHERE code IN (?, ?) AND parent_id <> 901',
    ['E1101', 'E1102']
  );
  // 3) 投资分类自身改到 901/902/903，腾出 1/2/3
  await query("UPDATE categories SET id = 901 WHERE code = 'E1100' AND id <> 901");
  await query("UPDATE categories SET id = 902 WHERE code = 'E1101' AND id <> 902");
  await query("UPDATE categories SET id = 903 WHERE code = 'E1102' AND id <> 903");
  // 4) 补回缺失的系统分类（已存在则跳过）
  const systemCats = [
    [1, 'E0100', '餐饮',     'expense', '🍜', '#22c55e', 1],
    [2, 'E0200', '交通出行', 'expense', '🚗', '#22c55e', 2],
    [3, 'E0300', '购物消费', 'expense', '🛒', '#22c55e', 3],
  ];
  if (DB_DIALECT === 'mysql') {
    for (const [id, code, name, type, icon, color, sort] of systemCats) {
      await query(
        'INSERT IGNORE INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)',
        [id, code, name, type, icon, color, sort]
      );
    }
    // MySQL 自增序列重置：找 MAX(id)，ALTER TABLE AUTO_INCREMENT
    try {
      const rows = await query('SELECT COALESCE(MAX(id), 1) as m FROM categories');
      const maxId = rows[0]?.m || 1;
      await query(`ALTER TABLE categories AUTO_INCREMENT = ${maxId + 1}`);
    } catch (_) {} // 表不存在等异常可忽略
  } else {
    for (const [id, code, name, type, icon, color, sort] of systemCats) {
      await query(
        'INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE) ON CONFLICT (id) DO NOTHING',
        [id, code, name, type, icon, color, sort]
      );
    }
    // PG 序列重置
    await query("SELECT setval(pg_get_serial_sequence('categories','id'), COALESCE((SELECT MAX(id) FROM categories), 1), true)");
  }
}

/**
 * 多账本自愈：
 * 1) 为每位用户确保存在「默认账本」（无默认则取最早一个标记为默认，否则新建）。
 * 2) 将该用户 `book_id IS NULL` 的遗留财务数据回填到其默认账本，
 *    使升级前的旧数据全部归属默认账本，避免多账本上线后数据"消失"。
 * 注意：系统预设分类（user_id IS NULL）不回填，保持全局共享。
 * 幂等、双方言兼容（占位符统一用 ?，prepare 会自动转换为 $N 或保持 ?）。
 */
async function ensureDefaultBookId(userId) {
  const existing = await query('SELECT id FROM books WHERE user_id = ? AND is_default = TRUE', [userId]);
  if (existing.length) return existing[0].id;
  const any = await query('SELECT id FROM books WHERE user_id = ? ORDER BY id ASC LIMIT 1', [userId]);
  if (any.length) {
    await query('UPDATE books SET is_default = TRUE WHERE id = ?', [any[0].id]);
    return any[0].id;
  }
  const r = await query(
    'INSERT INTO books (user_id, name, icon, color, is_default) VALUES (?, ?, ?, ?, TRUE)',
    [userId, '默认账本', '📒', '#6366f1']
  );
  return r.insertId;
}

async function healBooks() {
  const users = await query('SELECT id FROM users');
  const tables = [
    'accounts', 'categories', 'transactions', 'transfers', 'budgets', 'tags',
    'savings_goals', 'debts', 'debt_repayments', 'investments',
    'investment_transactions', 'savings_transactions', 'investment_snapshots'
  ];
  for (const u of users) {
    const defaultId = await ensureDefaultBookId(u.id);
    for (const t of tables) {
      // categories 仅回填「用户私有」(user_id 非空) 的遗留分类；系统分类(user_id IS NULL)保持全局共享
      if (t === 'categories') {
        await query('UPDATE categories SET book_id = ? WHERE user_id = ? AND book_id IS NULL', [defaultId, u.id]);
      } else {
        await query(`UPDATE ${t} SET book_id = ? WHERE user_id = ? AND book_id IS NULL`, [defaultId, u.id]);
      }
    }
  }
}

/**
 * schema 列自愈（针对已部署库）：
 * 项目启动仅执行 `CREATE TABLE IF NOT EXISTS`，对已存在的表不会补列，
 * 导致「代码升级新增了列（如 sold_date）但老库没这列」时查询 500。
 * 这里用幂等的 ALTER ADD COLUMN 补齐已知新增列，覆盖所有已部署库，
 * 与 healCategoryData / healBooks 一样每次启动调用、对全新库为 no-op。
 */
async function ensureColumn(table, column, definition) {
  try {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`✅ 已补齐列 ${table}.${column}`);
  } catch (err) {
    // 列已存在（Postgres 42701）属预期，忽略
    if (/already exists|duplicate column|42701/i.test(err.message)) return;
    console.warn(`⚠️ 补列 ${table}.${column} 失败（不影响启动，下次启动重试）:`, err.message);
  }
}

/**
 * 索引自愈。
 * ⛔ 为什么必须有：schema 文件在 initDatabase 的第 2 步执行，而补列在第 3 步。
 *    老库若缺 ai_feedback_events.rule_id，schema 里的 `CREATE INDEX ... (rule_id)`
 *    会先报 "column rule_id does not exist" 被吞掉，列随后才补上 ——
 *    索引要等到【下一次启动】才建成。补列后立刻建索引，把这个窗口关掉。
 */
async function ensureIndex(name, table, columns) {
  try {
    await query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
  } catch (err) {
    if (/already exists|duplicate key name|1061|42P07/i.test(err.message)) return;
    console.warn(`⚠️ 建索引 ${name} 失败（不影响启动，下次启动重试）:`, err.message);
  }
}

async function healSchemaColumns() {
  // 投资理财：清仓当天保留 / 隔天归档所需的清仓日期
  await ensureColumn('investments', 'sold_date', 'DATE');
  // 交易流水：每笔买卖的手续费（实在成本），用于记录与展示
  await ensureColumn('investment_transactions', 'fee', 'DECIMAL(15,2) NOT NULL DEFAULT 0');
  // 资金账户计息：年利率 / 计息周期 / 上次计息日期（升级老库时补齐，新库由 CREATE TABLE 覆盖）
  const liType = DB_DIALECT === 'mysql' ? 'DATETIME' : 'TIMESTAMP';
  await ensureColumn('accounts', 'annual_rate', 'DECIMAL(8,4) NOT NULL DEFAULT 0');
  await ensureColumn('accounts', 'interest_cycle', "VARCHAR(10) DEFAULT 'monthly'");
  await ensureColumn('accounts', 'last_interest_date', `${liType} DEFAULT NULL`);
  // 理财类型：全局可见性开关（关闭后不再出现在新增理财下拉），升级老库时补齐，新库由 CREATE TABLE 覆盖
  await ensureColumn('investment_types', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE');
  // 老库 last_interest_date 原为 DATE（只到天），升级为带秒类型，使计息日期精确到秒（幂等，重复执行无害）
  try {
    if (DB_DIALECT === 'mysql') {
      await query('ALTER TABLE accounts MODIFY COLUMN last_interest_date DATETIME');
    } else {
      await query('ALTER TABLE accounts ALTER COLUMN last_interest_date TYPE timestamp USING last_interest_date::timestamp');
    }
  } catch (e) {
    if (!/does not exist|already|duplicate|42701|1060|1054|cannot alter/i.test(e.message)) {
      console.warn('⚠️ 升级 accounts.last_interest_date 类型失败（不影响启动，下次启动重试）:', e.message);
    }
  }
  // 理财交易日期：老库为 DATE（只到天），升级为带秒类型，使买/卖/分红/计息精确到秒（幂等）
  try {
    if (DB_DIALECT === 'mysql') {
      await query('ALTER TABLE investment_transactions MODIFY COLUMN date DATETIME');
    } else {
      await query('ALTER TABLE investment_transactions ALTER COLUMN date TYPE timestamp USING date::timestamp');
    }
  } catch (e) {
    if (!/does not exist|already|duplicate|42701|1060|1054|cannot alter/i.test(e.message)) {
      console.warn('⚠️ 升级 investment_transactions.date 类型失败（不影响启动）:', e.message);
    }
  }
  // 持仓买入日期：老库为 DATE（只到天），升级为带秒类型，使买入时间精确到秒（幂等，重复执行无害）
  try {
    if (DB_DIALECT === 'mysql') {
      await query('ALTER TABLE investments MODIFY COLUMN buy_date DATETIME');
    } else {
      await query('ALTER TABLE investments ALTER COLUMN buy_date TYPE timestamp USING buy_date::timestamp');
    }
  } catch (e) {
    if (!/does not exist|already|duplicate|42701|1060|1054|cannot alter/i.test(e.message)) {
      console.warn('⚠️ 升级 investments.buy_date 类型失败（不影响启动，下次启动重试）:', e.message);
    }
  }
  // 债务还款日期：老库为 DATE（只到天），升级为带秒类型，使还款时间精确到秒（幂等）
  try {
    if (DB_DIALECT === 'mysql') {
      await query('ALTER TABLE debt_repayments MODIFY COLUMN paid_at DATETIME');
    } else {
      await query('ALTER TABLE debt_repayments ALTER COLUMN paid_at TYPE timestamp USING paid_at::timestamp');
    }
  } catch (e) {
    if (!/does not exist|already|duplicate|42701|1060|1054|cannot alter/i.test(e.message)) {
      console.warn('⚠️ 升级 debt_repayments.paid_at 类型失败（不影响启动，下次启动重试）:', e.message);
    }
  }
  // 储蓄流水日期：老库为 DATE（只到天），升级为带秒类型，使存取时间精确到秒（幂等）
  try {
    if (DB_DIALECT === 'mysql') {
      await query('ALTER TABLE savings_transactions MODIFY COLUMN date DATETIME');
    } else {
      await query('ALTER TABLE savings_transactions ALTER COLUMN date TYPE timestamp USING date::timestamp');
    }
  } catch (e) {
    if (!/does not exist|already|duplicate|42701|1060|1054|cannot alter/i.test(e.message)) {
      console.warn('⚠️ 升级 savings_transactions.date 类型失败（不影响启动，下次启动重试）:', e.message);
    }
  }

  // AI v0.2 Phase 3/4：预测快照的三个新增维度 + 路由记录。
  // ⚠️ 老库的 ai_predictions 由 Phase 1 建成，CREATE TABLE IF NOT EXISTS 不会补列，
  //    缺列会让 prediction-store 的 INSERT 直接 500。
  const jsonType = DB_DIALECT === 'mysql' ? 'JSON' : 'JSONB';
  await ensureColumn('ai_predictions', 'memory_snapshot', `${jsonType} DEFAULT NULL`);
  await ensureColumn('ai_predictions', 'model_request', `${jsonType} DEFAULT NULL`);
  await ensureColumn('ai_predictions', 'model_response', `${jsonType} DEFAULT NULL`);
  await ensureColumn('ai_predictions', 'route', "VARCHAR(20) NOT NULL DEFAULT 'local'");
  // 反馈事件关联到规则（Evidence Engine 的溯源起点）
  await ensureColumn('ai_feedback_events', 'rule_id', 'INT DEFAULT NULL');

  // AI v0.2 图片通道：记录该服务商到底能不能读图。
  // ⛔ 三态而非布尔：'unknown' 表示还没试过（乐观尝试一次），
  //    'yes'/'no' 是真实调用验证过的结论。用布尔会分不清「没试过」和「不支持」，
  //    导致每次上传图片都要先白试一次失败调用（多等一轮超时 + 白烧 token）。
  await ensureColumn('ai_providers', 'vision_support', "VARCHAR(10) NOT NULL DEFAULT 'unknown'");

  // 补列后立刻补索引：schema 里这条索引在 rule_id 还不存在时已经失败过一次（见 ensureIndex 注释）
  // ⚠️ 只补 schema 里真实声明过的索引 —— 这里凭空多建的索引在全新库上不存在，会造成两种库结构不一致。
  // route 是 4 值低基数列，刻意不建索引（选择性太差，PG 也不会走它）。
  await ensureIndex('idx_ai_fb_rule', 'ai_feedback_events', 'rule_id');
}

/**
 * AI 表 CHECK 约束自愈（仅 Postgres 需要）。
 * ⛔ 背景：Phase 1 建库时 ai_feedback_events.event_type 的白名单只有 6 个值，
 *    Phase 3 的 Evidence Engine 会写入 consistent_reuse / negative_signal，
 *    在老库上会撞 23514（check constraint violation）—— 而 CREATE TABLE IF NOT EXISTS
 *    对已存在的表完全跳过，约束永远不会更新。故此处显式 DROP + ADD 重建。
 *
 * MySQL：CHECK 约束在 MySQL 8.0.16 之前不强制执行，且不支持 `DROP CONSTRAINT IF EXISTS`，
 *    因此对 MySQL 直接跳过；如有问题由 schema.mysql.sql 建表时确保正确。
 */
/**
 * 清除旧版信用卡/花呗自动同步债务遗留的硬编码利率 18.25%。
 * 该利率是被错误挂到消费账单上的行业上限，已改为「还款填利息、详情接口反推真实年化」。
 * 幂等：仅清 note 含「自动同步」且 interest_rate = 18.25 的记录，不影响正常手动录入的贷款。
 */
async function healDebtRate() {
  try {
    await query("UPDATE debts SET interest_rate = 0 WHERE note LIKE '%自动同步%' AND interest_rate = 18.25");
  } catch (err) {
    // 表不存在（全新库尚未建表）属预期，忽略
    if (/does not exist|42703|1054/i.test(err.message)) return;
    throw err;
  }
}

async function healAiConstraints() {
  if (DB_DIALECT === 'mysql') return; // MySQL 不走 PG 这套约束自愈
  // 两个约束互不阻塞：任一失败都不应吃掉另一个的自愈机会
  await healEventTypeConstraint();
  await healRuleTypeConstraint();
}

/** ai_feedback_events.event_type 取值集随版本扩张，老库需要重建约束 */
async function healEventTypeConstraint() {
  const allowed = [
    'explicit_confirmation', 'explicit_correction', 'discard',
    'manual_rule_creation', 'contradiction', 'rule_disabled',
    'consistent_reuse', 'negative_signal',
  ].map(v => `'${v}'`).join(',');
  try {
    // 约束名由 Postgres 按 <表>_<列>_check 规则自动生成
    await query('ALTER TABLE ai_feedback_events DROP CONSTRAINT IF EXISTS ai_feedback_events_event_type_check');
    await query(
      `ALTER TABLE ai_feedback_events
         ADD CONSTRAINT ai_feedback_events_event_type_check
         CHECK (event_type IN (${allowed}))`
    );
  } catch (err) {
    // 表还不存在（全新库尚未执行 schema）或约束已是新版，均属预期
    if (/does not exist|already exists/i.test(err.message)) return;
    console.warn('⚠️ AI 约束自愈警告（不影响启动，下次启动重试）:', err.message);
  }
}

/**
 * ai_rules.rule_type 的 CHECK 必须与后端 AI_RULE_TYPES 一致。
 *
 * 老库里这条约束写的是 'merchant_type'，而代码与前端实际用的是 'keyword_type'
 * （关键字 → 收支方向）。不一致时：PG 直接拒绝插入，applyEvidence 又静默吞异常，
 * 用户在 UI 上只看到「规则创建失败」——所以必须由自愈把约束拉回代码侧取值。
 */
async function healRuleTypeConstraint() {
  // ⛔ merchant_account 已移除：商户不固定支付方式，该规则类型会越学越错（2026-08-29）
  const allowed = ['merchant_category', 'keyword_category', 'keyword_type']
    .map(v => `'${v}'`).join(',');
  try {
    await query('ALTER TABLE ai_rules DROP CONSTRAINT IF EXISTS ai_rules_rule_type_check');
    await query(
      `ALTER TABLE ai_rules
         ADD CONSTRAINT ai_rules_rule_type_check
         CHECK (rule_type IN (${allowed}))`
    );
  } catch (err) {
    if (/does not exist|already exists/i.test(err.message)) return;
    console.warn('⚠️ AI 规则类型约束自愈警告（不影响启动，下次启动重试）:', err.message);
  }
}

async function initDatabase() {
  console.log('🔧 正在初始化数据库...');
  try {
    const dbName = process.env.DB_NAME || 'xinwallet';
    const schemaFile = DB_DIALECT === 'mysql' ? 'schema.mysql.sql' : 'schema.sql';

    // 1) 确保目标数据库存在
    if (DB_DIALECT === 'mysql') {
      // MySQL：连 information_schema 用单连接
      const mysql = require('mysql2/promise');
      const sysConn = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
      });
      try {
        const [rows] = await sysConn.query(
          'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [dbName]
        );
        if (rows.length === 0) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
            throw new Error(`非法数据库名: ${dbName}`);
          }
          await sysConn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          console.log(`✅ MySQL 数据库 ${dbName} 已创建`);
        }
      } finally {
        await sysConn.end();
      }
    } else {
      // PostgreSQL：连 postgres 系统库
      const { Pool } = require('pg');
      const adminPool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: 'postgres',
        max: 2,
      });
      try {
        const check = await adminPool.query(
          'SELECT 1 FROM pg_database WHERE datname = $1', [dbName]
        );
        if (check.rowCount === 0) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
            throw new Error(`非法数据库名: ${dbName}`);
          }
          await adminPool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8'`);
          console.log(`✅ PostgreSQL 数据库 ${dbName} 已创建`);
        }
      } finally {
        await adminPool.end();
      }
    }

    // 2) 读取并执行对应方言的 schema 文件
    const fs = require('fs');
    const path = require('path');
    const schemaPath = path.join(__dirname, schemaFile);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const statements = splitSqlStatements(schemaSql);
    for (const stmt of statements) {
      const meaningful = stmt.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
      if (meaningful.length === 0) continue;
      try {
        await pool.query(stmt);
      } catch (err) {
        warnUnlessAlreadyExists('Schema 执行警告:', err);
      }
    }

    // 3) 分类种子自愈：修复旧版（投资分类未显式指定 id）初始化造成的种子 id 抢占。
    //    幂等、双方言兼容；在健康库上为 no-op，在损坏库上自动纠正。
    try {
      await healCategoryData();
      console.log('✅ 分类种子自愈完成（无需修复时无任何变化）');
    } catch (err) {
      console.warn('⚠️ 分类种子自愈警告（不影响启动，下次启动会重试）:', err.message);
    }

    // 多账本自愈：为每位用户建立默认账本并回填遗留数据（幂等）
    try {
      await healBooks();
      console.log('✅ 多账本数据自愈完成（无需修复时无任何变化）');
    } catch (err) {
      console.warn('⚠️ 多账本数据自愈警告（不影响启动，下次启动会重试）:', err.message);
    }

    // schema 列自愈：补齐已部署库缺失的新增列（如 sold_date），避免升级后查询 500
    try {
      await healSchemaColumns();
      console.log('✅ schema 列自愈完成（无需补列时无任何变化）');
    } catch (err) {
      console.warn('⚠️ schema 列自愈警告（不影响启动，下次启动重试）:', err.message);
    }

    // 旧版信用卡/花呗债务遗留的硬编码利率 18.25% 清零：该利率本不该挂在消费账单上，
    // 改为「还款时如实填利息、详情接口反推真实年化」后，必须把历史脏值清掉，
    // 否则编辑债务时 debtRate 会回填 18.25。幂等：只清 note 以「自动同步」开头且值为 18.25 的。
    try {
      await healDebtRate();
      console.log('✅ 信用卡债务遗留利率自愈完成（无遗留值时无任何变化）');
    } catch (err) {
      console.warn('⚠️ 信用卡债务遗留利率自愈警告（不影响启动，下次启动重试）:', err.message);
    }

    // AI CHECK 约束自愈：把 Phase 1 建的旧白名单升级到 Phase 3 的 8 个事件类型
    try {
      await healAiConstraints();
      console.log('✅ AI 约束自愈完成（无需修复时无任何变化）');
    } catch (err) {
      console.warn('⚠️ AI 约束自愈警告（不影响启动，下次启动重试）:', err.message);
    }

    // 注：为保证「已部署库」升级兼容，上面仍运行幂等自愈步骤
    // （分类种子自愈 / 多账本回填 / 补齐新增列），对健康全新库均为 no-op，不会改动任何数据。

    console.log(`✅ 数据库表结构已初始化 (${DB_DIALECT.toUpperCase()})`);
    return true;
  } catch (err) {
    console.error(`❌ 数据库初始化失败 [${DB_DIALECT.toUpperCase()}]:`, err.message);
    return false;
  }
}

/**
 * 双方言 upsert helper：生成 PostgreSQL ON CONFLICT 或 MySQL ON DUPLICATE KEY UPDATE 的 SQL。
 * @param {string} table - 表名
 * @param {string[]} pkCols - 冲突检测列（ON CONFLICT 或 ON DUPLICATE KEY 的依据列）
 * @param {string[]} setCols - 需要更新的列（不含主键）
 * @returns {string} 方言适配的 upsert SQL 片段
 *
 * 用法示例：
 *   const sql = db.pgUpsert('ai_ocr_config', ['user_id'], ['secret_id', 'secret_key', 'region']);
 *   // PG:  INSERT INTO ai_ocr_config (...) VALUES (...) ON CONFLICT (user_id) DO UPDATE SET secret_id = EXCLUDED.secret_id, ...
 *   // MySQL: INSERT INTO ai_ocr_config (...) VALUES (...) ON DUPLICATE KEY UPDATE secret_id = VALUES(secret_id), ...
 */
function upsertSql(table, pkCols, setCols) {
  const colList = [...pkCols, ...setCols].join(', ');
  const placeholders = [...pkCols, ...setCols].map((_, i) => `?`).join(', ');
  if (DB_DIALECT === 'mysql') {
    const setClause = setCols.map(c => `${c} = VALUES(${c})`).join(', ');
    return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${setClause}`;
  }
  const excludedCols = setCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${pkCols.join(', ')}) DO UPDATE SET ${excludedCols}`;
}

/**
 * 双方言 IN 子句构建器，替代 PG 专属的 `= ANY(?)` 数组语法。
 * @param {any[]} ids - ID 数组（自动过滤 null/undefined）
 * @returns {{ sql: string, params: any[] }}
 *
 * 用法：
 *   const { sql, params } = db.buildInClause(invIds);
 *   await query(`SELECT ... WHERE investment_id ${sql}`, params);
 *
 * MySQL: 生成 `IN (?,?,?)` + 展平参数数组
 * PG:    生成 `= ANY(?)` + 原始数组参数
 */
function buildInClause(ids) {
  const cleaned = ids.filter(id => id != null);
  if (cleaned.length === 0) return { sql: '= NULL', params: [] }; // 防误删全表
  if (DB_DIALECT === 'mysql') {
    return {
      sql: `IN (${cleaned.map(() => '?').join(', ')})`,
      params: cleaned,
    };
  }
  return { sql: '= ANY(?)', params: [cleaned] };
}

/**
 * 双方言「幂等插入」构造器：冲突时静默跳过，不报错。
 *
 * ⛔ 为什么必须封装：此前业务代码直接写死 MySQL 的 `INSERT IGNORE`，
 *    而 PostgreSQL 没有该语法（`prepare()` 只做占位符转换，不做方言改写），
 *    一旦走到带标签建交易 / 备份导入路径即在 PG（默认方言）下 syntax error。
 *    两端语义对齐：MySQL `INSERT IGNORE` ≡ PG `ON CONFLICT DO NOTHING`。
 *
 * 注意：裸 `ON CONFLICT DO NOTHING` 不带冲突目标，故不要求表上存在唯一索引；
 *      同时它会被 autoReturning 识别，不会追加 RETURNING id（关联表无 id 列）。
 *
 * @param {string} table - 表名
 * @param {string[]} cols - 插入列（顺序与调用方传入的 params 一致）
 * @returns {string} 方言适配的单行 INSERT 语句（占位符为 ?，由 prepare() 转换）
 *
 * 用法：
 *   await query(db.insertIgnoreSql('transaction_tags', ['transaction_id', 'tag_id']), [txId, tagId]);
 */
function insertIgnoreSql(table, cols) {
  const colList = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  if (DB_DIALECT === 'mysql') {
    return `INSERT IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
  }
  return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
}

module.exports = {
  pool, query, queryOne, transaction, initDatabase,
  healBooks, ensureDefaultBookId, DB_DIALECT, upsertSql,
  buildInClause, insertIgnoreSql,
};
