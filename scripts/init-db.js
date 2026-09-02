#!/usr/bin/env node
/* ============================================
 * 鑫钱包 · 跨方言一键建库脚本（PostgreSQL / MySQL）
 * ------------------------------------------------------------
 * 复用 server/db.js 的 initDatabase()：
 *   - 自动按 DB_DIALECT 选择 schema.sql(PG) / schema.mysql.sql(MySQL)
 *   - 自动创建目标数据库（不存在时）
 *   - 执行建表 / 索引 / 约束 / 种子数据，并对已部署库做幂等自愈
 *     （分类种子 / 多账本回填 / 补列 / AI 约束，全新库均为 no-op）
 *
 * 用法（在项目根目录执行）：
 *   node scripts/init-db.js
 *
 * 环境变量（与 docker-compose.yml / .env 一致）：
 *   DB_DIALECT  pg(默认) | mysql
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 * ============================================ */

const path = require('path');
const fs = require('fs');

// 1) 先加载 .env（dotenv 已是生产依赖），必须在 require db 之前，
//    因为 db.js 顶层会按 process.env.DB_DIALECT 立即创建连接池。
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // 兼容在 scripts/ 目录下直接执行时找不到根 .env 的情况
  require('dotenv').config();
}

const dialect = (process.env.DB_DIALECT || 'pg').toLowerCase();
if (dialect !== 'mysql' && dialect !== 'pg') {
  console.error('❌ 非法 DB_DIALECT，仅支持 pg / mysql');
  process.exit(1);
}

const db = require('../server/db');

(async () => {
  console.log(`🚀 开始初始化数据库（方言：${dialect.toUpperCase()}）...`);
  try {
    const ok = await db.initDatabase();
    if (ok) {
      console.log('🎉 数据库初始化完成');
      process.exit(0);
    }
    console.error('❌ 数据库初始化失败，请检查上面的错误输出与数据库连接配置');
    process.exit(1);
  } catch (err) {
    console.error('❌ 初始化过程中发生未捕获异常:', err);
    process.exit(1);
  }
})();
