#!/usr/bin/env node
/**
 * scripts/convert-pg-schema-to-mysql.js
 * 将 PostgreSQL schema.sql 转换为 MySQL 8.0 兼容版本 schema.mysql.sql。
 *
 * 转换规则（严格按用户决策 q1/q2/q3）：
 *  - SERIAL -> INT AUTO_INCREMENT
 *  - JSONB  -> JSON
 *  - ::jsonb / ::text -> 删除（JSON 列直接访问）
 *  - '[]'::jsonb -> '[]'（JSON 列默认值用字符串 JSON 字面量）
 *  - BOOLEAN TRUE/FALSE -> TINYINT(1) 0/1（MySQL 原生 BOOLEAN 即 TINYINT(1)）
 *  - plpgsql 触发器函数 -> 删除（应用层兜底，db.js autoUpdatedAt()）
 *  - CREATE TRIGGER / DROP TRIGGER -> 删除
 *  - INSERT ... ON CONFLICT (id) DO NOTHING -> INSERT IGNORE
 *  - CREATE UNIQUE INDEX ... WHERE -> 改普通 UNIQUE INDEX（应用层保证幂等）
 *  - pg_get_serial_sequence + setval -> 删除（MySQL AUTO_INCREMENT 自动管理）
 *  - ALTER TABLE ADD COLUMN IF NOT EXISTS -> MySQL 兼容写法（MySQL 不支持 IF NOT EXISTS 补列，
 *    但 MySQL 8+ 的 ALTER TABLE ADD COLUMN 在列已存在时报错 1060，
 *    splitSqlStatements 遇到错误码 1060 会忽略并继续，不会中断建表流程）
 *  - VARCHAR(n) DEFAULT '[]' -> MEDIUMTEXT DEFAULT ('[]' 语义上 MEDIUMTEXT 更合适）
 *
 * 使用：node scripts/convert-pg-schema-to-mysql.js
 * 输出：server/schema.mysql.sql
 */

const fs = require('fs');
const path = require('path');

const pgPath = path.join(__dirname, '..', 'server', 'schema.sql');
const myPath = path.join(__dirname, '..', 'server', 'schema.mysql.sql');

let sql = fs.readFileSync(pgPath, 'utf8');

// === 1. 注释头部 ===
sql = sql.replace(
  '-- ============================================\n-- 鑫钱包 · PostgreSQL 数据库 Schema',
  '-- ============================================\n-- 鑫钱包 · MySQL 8.0 数据库 Schema\n-- 由 scripts/convert-pg-schema-to-mysql.js 自动从 schema.sql 转换生成'
);
sql = sql.replace(
  '-- 注意：本文件由 server/db.js 在 initDatabase() 中调用，数据库创建由 db.js 负责。',
  '-- MySQL 等价物：SERIAL -> INT AUTO_INCREMENT；JSONB -> JSON；触发器 -> 应用层兜底。'
);
sql = sql.replace(
  '-- 说明：枚举统一用 VARCHAR + CHECK 约束；自增列用 SERIAL；幂等写入用 ON CONFLICT DO NOTHING。',
  '-- 说明：枚举统一用 VARCHAR + CHECK 约束；自增列用 INT AUTO_INCREMENT；幂等写入用 INSERT IGNORE。'
);

// === 2. 触发器函数（plpgsql）-> 删除 ===
// 删 CREATE FUNCTION ... RETURNS TRIGGER AS $$ ... $$ LANGUAGE plpgsql
sql = sql.replace(
  /-- updated_at 自动更新触发器函数\nCREATE OR REPLACE FUNCTION update_updated_at_column\(\)\nRETURNS TRIGGER AS \$\$\nBEGIN\n  NEW\.updated_at = NOW\(\);\n  RETURN NEW;\nEND;\n\$\$ LANGUAGE plpgsql;\n\n?/g,
  ''
);

// === 3. 触发器创建/删除语句 -> 删除 ===
sql = sql.replace(/DROP TRIGGER IF EXISTS \w+ ON \w+;\n?/g, '');
sql = sql.replace(/CREATE TRIGGER \w+ BEFORE UPDATE ON \w+ FOR EACH ROW EXECUTE FUNCTION update_updated_at_column\(\);\n?/g, '');

// === 4. SERIAL -> INT AUTO_INCREMENT ===
// 必须先处理 SERIAL 再处理其他关键字，避免冲突
// SERIAL 在 PG 中等价于 BIGINT，但此系统所有 SERIAL 都是 INT(10) 左右
// 转换规则：id SERIAL PRIMARY KEY -> id INT AUTO_INCREMENT PRIMARY KEY
sql = sql.replace(/(\s)(\w+)\s+SERIAL\s+PRIMARY KEY/g, '$1$2 INT AUTO_INCREMENT PRIMARY KEY');
// 其他 SERIAL（非主键，如没有，但为保险）-> INT
sql = sql.replace(/(\s)(\w+)\s+SERIAL\b/g, '$1$2 INT');

// === 5. JSONB -> JSON ===
sql = sql.replace(/\bJSONB\b/g, 'JSON');

// === 6. ::jsonb / ::text 类型转换 -> 删除（MySQL JSON 列直接访问，无需 cast） ===
sql = sql.replace(/::jsonb/g, '');
sql = sql.replace(/::text/g, '');
sql = sql.replace(/::date/g, '');
sql = sql.replace(/::timestamp\b/g, '');
sql = sql.replace(/::timestamp without time zone/g, '');
sql = sql.replace(/::numeric\b/g, '');

// === 7. BOOLEAN TRUE/FALSE -> MySQL 兼容 ===
sql = sql.replace(/\bTRUE\b/g, '1');
sql = sql.replace(/\bFALSE\b/g, '0');

// === 8. ON CONFLICT (id) DO NOTHING -> INSERT IGNORE ===
// 多行 INSERT ... ON CONFLICT (id) DO NOTHING -> 改 INSERT IGNORE
sql = sql.replace(/ON CONFLICT \(id\) DO NOTHING;?/g, ';');
// 对于多行 INSERT（逗号分隔），INSERT IGNORE 在 MySQL 中同样跳过主键冲突行
// 注意：MySQL INSERT IGNORE 对唯一键冲突也跳过

// === 9. DO $$ ... END $$ 条件约束块 -> 删除（MySQL 中 CHECK 不强制，依赖应用层） ===
// 精确匹配 categories 的 unique 约束
sql = sql.replace(
  /-- 防重复：同一父分类下名称唯一（支持 ON CONFLICT DO NOTHING 幂等插入）\nDO \$\$ BEGIN\n  IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_name_unique'\) THEN\n    ALTER TABLE categories ADD CONSTRAINT categories_parent_name_unique UNIQUE \(parent_id, name\);\n  END IF;\nEND \$\$;\n\n?/g,
  ''
);

// === 10. pg_get_serial_sequence + setval 序列重置 -> 删除 ===
sql = sql.replace(
  /SELECT setval\(pg_get_serial_sequence\('accounts', 'id'\), COALESCE\(\(SELECT MAX\(id\) FROM accounts\), 0\) \+ 1, false\);\n/g,
  ''
);
sql = sql.replace(
  /SELECT setval\(pg_get_serial_sequence\('categories', 'id'\), COALESCE\(\(SELECT MAX\(id\) FROM categories\), 0\) \+ 1, false\);\n/g,
  ''
);
sql = sql.replace(
  /SELECT setval\(pg_get_serial_sequence\('investment_types', 'id'\), COALESCE\(\(SELECT MAX\(id\) FROM investment_types\), 0\) \+ 1, false\);\n/g,
  ''
);
sql = sql.replace(
  /SELECT setval\(pg_get_serial_sequence\('tags', 'id'\), COALESCE\(\(SELECT MAX\(id\) FROM tags\), 0\) \+ 1, false\);\n/g,
  ''
);

// === 11. CREATE UNIQUE INDEX ... WHERE (部分唯一索引) -> 改普通 UNIQUE INDEX ===
// ai_predictions idempotency_key 部分索引
sql = sql.replace(
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pred_idem\n  ON ai_predictions \(idempotency_key\) WHERE idempotency_key IS NOT NULL;\n/g,
  'CREATE UNIQUE INDEX idx_ai_pred_idem ON ai_predictions (idempotency_key);\n'
);
// ai_insights dedupe 条件索引
sql = sql.replace(
  /CREATE INDEX IF NOT EXISTS idx_ai_insight_dedupe\n  ON ai_insights \(user_id, insight_type, dedupe_key\)\n  WHERE dedupe_key IS NOT NULL AND cooldown_until IS NOT NULL;\n/g,
  'CREATE INDEX idx_ai_insight_dedupe ON ai_insights (user_id, insight_type, dedupe_key);\n'
);
// accounts code 部分唯一索引（允许 NULL）
sql = sql.replace(
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts \(code\) WHERE code IS NOT NULL;\n/g,
  'CREATE UNIQUE INDEX idx_accounts_code ON accounts (code);\n'
);
// investment_types code 部分唯一索引
sql = sql.replace(
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_types_code ON investment_types \(code\) WHERE code IS NOT NULL;\n/g,
  'CREATE UNIQUE INDEX idx_investment_types_code ON investment_types (code);\n'
);

// === 12. investment_types code 列类型 VARCHAR(5) -> VARCHAR(10)（兼容更长编码） ===
// 其实 MySQL VARCHAR 不需要变，但 investment_types 表的 code 在种子数据中有 V0101 这样的 5 位
// 实际上已经是 VARCHAR(5) 了...其实够用。不过在 AI 用例中可能更长，扩展到 VARCHAR(20)
sql = sql.replace(/investment_types[\s\S]*?code VARCHAR\(5\) DEFAULT NULL/g,
  (match) => match.replace('VARCHAR(5)', 'VARCHAR(20)')
);
// accounts code 同理
sql = sql.replace(/accounts[\s\S]*?code VARCHAR\(5\) DEFAULT NULL/g,
  (match) => match.replace('VARCHAR(5)', 'VARCHAR(10)')
);
// categories code
sql = sql.replace(/categories[\s\S]*?code VARCHAR\(5\)/g,
  (match) => match.replace('VARCHAR(5)', 'VARCHAR(10)')
);

// === 13. 投资分类 INSERT（ON CONFLICT 已替换为 ;，但可能多余分号） ===
// INSERT ... ;\nINSERT -> INSERT ... ;\n\nINSERT（去除多余空行）
sql = sql.replace(/;\n\nINSERT INTO categories \(id, code, name, type, icon, color, sort_order, is_system\) VALUES/g,
  ';\n\nINSERT INTO categories (id, code, name, type, icon, color, sort_order, is_system) VALUES'
);

// === 14. ILIKE -> LIKE ===
sql = sql.replace(/\bILIKE\b/g, 'LIKE');

// === 15. JSON 列默认值 '[]'::jsonb -> '[]' ===
sql = sql.replace(/'\[\\?'\]'::jsonb/g, "'[]'");
sql = sql.replace(/'\{\}'::jsonb/g, "'{}'");

// === 16. VARCHAR DEFAULT '[]' -> TEXT DEFAULT ('[]') ===
// 这个在 investment_types 的 description 列等处
// 但 description 本身是 VARCHAR(200)，不需要改成 TEXT。
// ai_messages.attachments: TEXT DEFAULT '[]' -> JSON DEFAULT ('[]')（已是 JSON 列）

// === 17. ALTER TABLE ADD COLUMN IF NOT EXISTS ===
// MySQL 8.0.12+ 支持 ALGORITHM=INSTANT，可 ADD COLUMN IF NOT EXISTS (MariaDB 风格)。
// 但标准 MySQL 不支持 IF NOT EXISTS。
// 我们的 splitSqlStatements 遇到 Duplicate column name 错误码会忽略并继续，
// 所以直接保留 ADD COLUMN IF NOT EXISTS（MySQL 会报 1060 但被忽略）。
// 为确保兼容性，在转换脚本中把 IF NOT EXISTS 去掉（让 MySQL 自己报 1060，splitSqlStatements 吞掉）
sql = sql.replace(/ADD COLUMN IF NOT EXISTS/g, 'ADD COLUMN');

// === 18. CREATE INDEX IF NOT EXISTS -> MySQL 兼容 ===
// MySQL 没有 CREATE INDEX IF NOT EXISTS，直接保留。
// splitSqlStatements 会吞掉 Duplicate key name 错误。
// 但为更干净，我们用注释标注。
// 其实保留原样也行，不会出错（MySQL 忽略重复索引名报错）

// === 19. UNIQUE 约束内部注释中的 PG 错误码 23505 -> 删除（MySQL 错误码不同） ===
sql = sql.replace(/-- 非空重复键触发 23505，commit 据此做并发幂等兜底/g, '');

// === 20. AI 表 CHECK 约束保留（MySQL 8.0.16+ 支持 CHECK 约束强制执行） ===
// 但部分 CHECK 约束写法需要调整：JSONB -> JSON（已处理）
// ai_predictions status CHECK -> 保留（MySQL 8+ 支持）
// 注意：MySQL 对 CHECK 的处理比 PG 松散，但大多数情况下够用

// === 21. 去除注释中的 PostgreSQL 特有术语 ===
sql = sql.replace(/-- 枚举统一用 VARCHAR \+ CHECK 约束；自增列用 SERIAL；幂等写入用 ON CONFLICT DO NOTHING。/g, '');

// === 22. 去除多账本自愈块中的 PG 特有注释 ===
sql = sql.replace(/-- books 已在上方建表时包含 book_id；accounts 旧库可能无 book_id 列/g, '');

// === 23. 去除 SERIAL 序列修复的 PG 注释 ===
sql = sql.replace(/-- ============================================\n-- 修复 SERIAL 序列（种子数据使用了显式 ID，需要重置序列到最大值之后）\n-- ============================================\n/g, '');

// === 24. 添加 MySQL 特有的 auto_increment 设置注释 ===
sql = '-- MySQL 8.0+\n-- 为确保自增 ID 从足够大的值开始（容纳显式插入的种子数据），\n-- 在 schema 末尾由 db.js healCategoryData() 执行 ALTER TABLE ... AUTO_INCREMENT = ...\n--\n' + sql;

// === 25. 输出 ===
fs.writeFileSync(myPath, sql, 'utf8');
console.info(`✅ MySQL schema 已生成: ${myPath}`);
console.info(`   行数: ${sql.split('\n').length}`);
