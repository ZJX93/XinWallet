/**
 * MySQL 数据库初始化脚本
 * 用途：从 schema.mysql.sql 初始化数据库表结构
 *
 * 前置条件：
 *   1. MySQL 8.0+ 服务运行中
 *   2. 已创建数据库：CREATE DATABASE xinwallet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
 *   3. .env 中配置 DB_DIALECT=mysql, DB_NAME=xinwallet 及相应连接信息
 *
 * 用法：
 *   node scripts/mysql-init.js
 *   DB_NAME=xinwallet DB_USER=root DB_PASSWORD=secret node scripts/mysql-init.js
 *
 * 不依赖项目 db.js（避免循环加载），直接使用 mysql2
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function init() {
  const dbName = process.env.DB_NAME || process.argv[2] || 'xinwallet';
  const dbUser = process.env.DB_USER || 'root';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
  const dbPass = process.env.DB_PASSWORD || '';

  console.info(`连接 MySQL ${dbHost}:${dbPort}...`);

  // 1. 连接（不指定数据库，先创建数据库）
  let conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    multipleStatements: true,
  });

  console.info(`创建数据库 ${dbName} (若不存在)...`);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);

  // 2. 读取 schema
  const schemaPath = path.join(__dirname, '..', 'server', 'schema.mysql.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.info(`执行 ${schemaPath}...`);

  // 3. 分块执行（每条语句独立执行，避免一次执行太多）
  // 先剔除整行注释：否则"注释行 + 语句"的片段会以 -- 开头，被下方过滤器误删，
  // 导致 CREATE TABLE 全部丢失、后续语句 ER_NO_SUCH_TABLE。
  const noComments = schemaSql.replace(/^\s*--.*$/gm, '');
  const statements = noComments
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let success = 0;
  let failed = 0;
  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    try {
      await conn.query(stmt);
      success++;
    } catch (err) {
      // 忽略 "索引/列/表已存在" 等幂等场景（旧库升级重复执行时）
      if (
        err.code === 'ER_DUP_KEYNAME' ||
        err.code === 'ER_TABLE_EXISTS_ERROR' ||
        err.code === 'ER_DUP_FIELDNAME'
      ) {
        console.info(`  [跳过] ${err.message.split('\n')[0]}`);
      } else {
        console.error(`  [错误] ${err.code}: ${stmt.slice(0, 80)}...`);
        failed++;
        // 遇到外键问题先跳过（MySQL 顺序敏感）
        if (err.code === 'ER_CANNOT_ADD_FOREIGN') continue;
      }
    }
  }

  console.info(`\n完成：${success} 成功, ${failed} 失败`);
  await conn.end();

  if (failed > 0) {
    console.warn('\n部分语句失败，建议检查错误信息或手动运行 schema.mysql.sql');
    process.exit(1);
  }
}

init().catch(err => {
  console.error('初始化失败:', err.message);
  process.exit(1);
});
