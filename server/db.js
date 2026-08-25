/* ============================================
   鑫钱包 · Database Connection Pool（双数据库：PostgreSQL / MySQL）
   ============================================ */

// 方言配置：默认 PostgreSQL；可选 mysql / mariadb
//   通过环境变量 DB_DIALECT 切换，无需改动业务代码。
const DB_DIALECT = (process.env.DB_DIALECT || 'postgres').toLowerCase();
const IS_PG = DB_DIALECT === 'postgres' || DB_DIALECT === 'pg' || DB_DIALECT === 'postgresql';

// 提升到模块作用域，供 initDatabase() 中建库用的 adminPool 复用（避免块级作用域导致 Pool is not defined）
const { Pool } = require('pg');
let pool;
if (IS_PG) {
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
} else {
  // MySQL / MariaDB：mysql2 原生支持 ? 占位符，与项目既有 SQL 风格一致。
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xinwallet',
    connectionLimit: 10,
    charset: 'utf8mb4',
    // 以 UTC 读写 TIMESTAMP，尽量贴近 PostgreSQL 的存储语义
    timezone: 'Z',
  });
}

// 按分号切分 SQL 语句；跳过 $$ ... $$ 美元引号块（PL/pgSQL 函数体），避免块内分号被误切。
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
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
  if (/ON\s+CONFLICT[\s\S]*DO\s+NOTHING/i.test(trimmed)) return sql;
  return sql + ' RETURNING id';
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

/**
 * MySQL 占位符归一化：将静态 `$N` 风格占位符转回 `?`（MySQL 原生占位符），保留已有 `?`。
 * 仅处理引号外的 `$N`，避免误伤字符串内容。
 */
function toMysqlPlaceholders(sql) {
  let out = '';
  let inS = false, inD = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inD) { inS = !inS; out += ch; continue; }
    if (ch === '"' && !inS) { inD = !inD; out += ch; continue; }
    if (!inS && !inD && ch === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      out += '?'; // $N -> ?（参数顺序已由原 $N 决定）
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * MySQL 方言的 UPSERT / 幂等写入翻译（PostgreSQL 的 ON CONFLICT 在 MySQL 无对应原生语法）：
 *   - ON CONFLICT (...) DO NOTHING            -> INSERT IGNORE INTO ...
 *   - ON CONFLICT (...) DO UPDATE SET x = EXCLUDED.x -> ON DUPLICATE KEY UPDATE x = VALUES(x)
 * 依赖表中已存在的唯一 / 主键约束（与 PostgreSQL 端一致）。
 */
function translateConflict(sql) {
  if (!/ON CONFLICT/i.test(sql)) return sql;
  if (/DO\s+NOTHING/i.test(sql)) {
    let s = sql.replace(/\s+ON CONFLICT\s*(?:\([^)]*\))?\s+DO\s+NOTHING/gi, '');
    s = s.replace(/^(\s*)INSERT INTO /i, '$1INSERT IGNORE INTO ');
    return s;
  }
  if (/DO\s+UPDATE\s+SET/i.test(sql)) {
    let s = sql.replace(/EXCLUDED\.(\w+)/gi, 'VALUES($1)');
    s = s.replace(/ON CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET/i, 'ON DUPLICATE KEY UPDATE');
    return s;
  }
  return sql;
}

/**
 * MySQL 方言的 PostgreSQL 函数翻译（best-effort，未经真实 MySQL 回归，生产前需在 MySQL 环境验证）。
 *   - TO_CHAR(expr, 'FMT') -> DATE_FORMAT(expr, 'mysqlFmt')（覆盖 YYYY-MM / YYYY-MM-DD 等）
 *   - expr - INTERVAL 'N unit' -> expr - INTERVAL N UNIT（去引号、单位单数化，MySQL 原生支持）
 * 仅处理引号外的函数调用；字符串字面量内的同名写法不受影响。
 */
function pgFmtToMysql(fmt) {
  return fmt
    .replace(/YYYY/gi, '%Y')
    .replace(/MM/gi, '%m')
    .replace(/DD/gi, '%d')
    .replace(/HH24/gi, '%H')
    .replace(/MI/gi, '%i')
    .replace(/SS/gi, '%s');
}
function translatePgFunctionsToMysql(sql) {
  let out = sql.replace(/TO_CHAR\(\s*([^,]+?)\s*,\s*'([^']*)'\s*\)/gi,
    (m, expr, fmt) => `DATE_FORMAT(${expr.trim()}, '${pgFmtToMysql(fmt)}')`);
  out = out.replace(/INTERVAL\s+'?(\d+)\s*(days|day|months|month|years|year)'?/gi,
    (m, n, unit) => {
      const u = { day: 'DAY', days: 'DAY', month: 'MONTH', months: 'MONTH', year: 'YEAR', years: 'YEAR' }[unit.toLowerCase()] || unit.toUpperCase();
      return `INTERVAL ${n} ${u}`;
    });
  return out;
}

// 归一化 + 方言适配：把业务 SQL 转换为当前数据库可执行的语句。
function prepare(sql) {
  if (IS_PG) return autoReturning(toPgPlaceholders(sql));
  return translateConflict(toMysqlPlaceholders(translatePgFunctionsToMysql(sql)));
}

function attachInsertId(rows) {
  if (rows.length > 0 && rows[0].id !== undefined) {
    rows.insertId = rows[0].id;
  }
  return rows;
}

async function query(sql, params = []) {
  const text = prepare(sql);
  if (IS_PG) {
    const res = await pool.query(text, params);
    return attachInsertId(res.rows);
  }
  // mysql2/promise 返回 [rows, fields]；INSERT 时 rows(ResultSetHeader) 自带 insertId。
  const [rows] = await pool.query(text, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * 事务封装：传入的 fn 接收一个 client（PG）/ conn（MySQL），内部执行 SQL。
 * 覆盖的 client.query / conn.query 同样应用方言归一化（占位符 + RETURNING / UPSERT 翻译）。
 */
async function transaction(fn) {
  if (IS_PG) {
    const client = await pool.connect();
    const origQuery = client.query.bind(client);
    client.query = async (sql, params = []) => {
      const res = await origQuery(autoReturning(toPgPlaceholders(sql)), params);
      return attachInsertId(res.rows);
    };
    // 事务连接对齐顶层 db 的能力：补齐 queryOne，供 ensureDefaultBook 等
    // 在事务内调用（否则报 conn.queryOne is not a function）
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
  } else {
    const conn = await pool.getConnection();
    const origQuery = conn.query.bind(conn);
    conn.query = async (sql, params = []) => {
      const [rows] = await origQuery(translateConflict(toMysqlPlaceholders(translatePgFunctionsToMysql(sql))), params);
      return rows;
    };
    conn.queryOne = async (sql, params = []) => {
      const rows = await conn.query(sql, params);
      return rows[0] || null;
    };
    try {
      await origQuery('BEGIN');
      const result = await fn(conn);
      await origQuery('COMMIT');
      return result;
    } catch (err) {
      await origQuery('ROLLBACK');
      throw err;
    } finally {
      delete conn.queryOne;
      conn.release();
    }
  }
}

/**
 * 初始化数据库：确保目标库存在，并执行对应方言的 schema 文件（建表 / 索引 / 约束 / 种子数据）。
 * PostgreSQL -> schema.sql；MySQL / MariaDB -> schema.mysql.sql。
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
 * 每次启动由 initDatabase() 调用，无需人工干预。双方言兼容：
 *   - 占位符统一用 ?（query 会按方言转 $N 或保持 ?）；
 *   - 幂等写入用 ON CONFLICT (id) DO NOTHING（MySQL 端自动转 INSERT IGNORE）。
 *   - 仅序列/AUTO_INCREMENT 重置需按方言分支。
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
  for (const [id, code, name, type, icon, color, sort] of systemCats) {
    await query(
      'INSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE) ON CONFLICT (id) DO NOTHING',
      [id, code, name, type, icon, color, sort]
    );
  }
  // 5) 重置自增序列：schema.sql 末尾的 setval 早于本函数执行，
  //    本函数改动分类 id 后 MAX(id) 变化，必须在此重新校正，
  //    否则新分类可能撞到被腾出前的低位 id 之外的空隙。
  if (IS_PG) {
    await query("SELECT setval(pg_get_serial_sequence('categories','id'), COALESCE((SELECT MAX(id) FROM categories), 1), true)");
  } else {
    const maxRow = await query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM categories');
    const next = maxRow[0] && maxRow[0].next != null ? maxRow[0].next : 1;
    await query('ALTER TABLE categories AUTO_INCREMENT = ?', [next]);
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
    // 列已存在（Postgres 42701 / MySQL Duplicate column name）属预期，忽略
    if (/already exists|duplicate column|42701/i.test(err.message)) return;
    console.warn(`⚠️ 补列 ${table}.${column} 失败（不影响启动，下次启动重试）:`, err.message);
  }
}

async function healSchemaColumns() {
  // 投资理财：清仓当天保留 / 隔天归档所需的清仓日期
  await ensureColumn('investments', 'sold_date', 'DATE');
  // 交易流水：每笔买卖的手续费（实在成本），用于记录与展示
  await ensureColumn('investment_transactions', 'fee', 'DECIMAL(15,2) NOT NULL DEFAULT 0');
  // 资金账户计息：年利率 / 计息周期 / 上次计息日期（升级老库时补齐，新库由 CREATE TABLE 覆盖）
  await ensureColumn('accounts', 'annual_rate', 'DECIMAL(8,4) NOT NULL DEFAULT 0');
  await ensureColumn('accounts', 'interest_cycle', "VARCHAR(10) DEFAULT 'monthly'");
  await ensureColumn('accounts', 'last_interest_date', 'DATE');
}

async function initDatabase() {
  console.log('🔧 正在初始化数据库...');
  try {
    const dbName = process.env.DB_NAME || 'xinwallet';
    const schemaFile = IS_PG ? 'schema.sql' : 'schema.mysql.sql';

    if (IS_PG) {
      // 1) 连接到默认 postgres 库，确保目标数据库存在
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
          console.log(`✅ 数据库 ${dbName} 已创建`);
        }
      } finally {
        await adminPool.end();
      }
    } else {
      // 1) 以无库连接确保目标数据库存在（MySQL 不支持在单语句里参数化库名）
      const mysql = require('mysql2/promise');
      const adminPool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '3306'),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        connectionLimit: 1,
        charset: 'utf8mb4',
        timezone: 'Z',
      });
      try {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
          throw new Error(`非法数据库名: ${dbName}`);
        }
        await adminPool.query(
          `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`✅ 数据库 ${dbName} 已确保存在`);
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

    // 注：为保证「已部署库」升级兼容，上面仍运行幂等自愈步骤
    // （分类种子自愈 / 多账本回填 / 补齐新增列），对健康全新库均为 no-op，不会改动任何数据。

    console.log('✅ 数据库表结构已初始化');
    return true;
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err.message);
    return false;
  }
}

module.exports = { pool, query, queryOne, transaction, initDatabase, IS_PG, healBooks, ensureDefaultBookId };
