/**
 * MySQL 兼容性修复脚本
 * 功能1: 将所有 $N SQL 占位符统一改为 ?（MySQL 只支持 ? 占位符，PG 驱动会转为 $N）
 * 功能2: 将 NOW()-INTERVAL 'N unit' 改为 CURDATE()-INTERVAL N DAY
 *        (MySQL 8.0: INTERVAL N UNIT 不带引号；PG: INTERVAL 'N unit' 带引号)
 *
 * 用法: node scripts/mysql-compat-fix.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const SERVER_DIR = path.join(__dirname, '..', 'server');

// 需要跳过修改的关键文件/目录（db.js 内部的驱动层保留 $N）
const SKIP_FILES = new Set([
  'db.js', // db.js 内部只有 pool.createPool 是驱动专属，不改
]);

// 扫描 server/ 下所有 .js 文件
function getJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function convertPlaceholders(sql) {
  // 匹配 $1, $2, ... 在 SQL 字符串中
  // 替换 $1→?, $2→?, $3→? (去重，保持数量一致)
  return sql.replace(/\$(\d+)/g, '?');
}

function convertInterval(sql) {
  // PG: NOW() - INTERVAL '7 days' → MySQL: CURDATE() - INTERVAL 7 DAY
  // MySQL 8.0 支持 NOW() - INTERVAL 7 DAY（无引号，单数单位）
  // 也兼容 CURDATE() - INTERVAL 7 DAY
  // 模式: INTERVAL 'N unit' (PG) → INTERVAL N UNIT (MySQL)
  // 需要转换: '7 days' → 7 DAY, '1 day' → 1 DAY, '3 months' → 3 MONTH, etc.
  return sql.replace(/INTERVAL\s+'(\d+)\s+(\w+)'/gi, (match, num, unit) => {
    // 单位复数转单数: days→DAY, months→MONTH, years→YEAR, weeks→WEEK
    const singular = unit.replace(/s$/, '').toUpperCase();
    return `INTERVAL ${num} ${singular}`;
  });
}

function processFile(filePath) {
  if (SKIP_FILES.has(path.basename(filePath))) return 0;

  const content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  let changes = 0;

  // 跳过 db.js 内部的驱动创建语句（pg.createPool 等）
  // 但替换其余的 $N SQL 占位符
  let newContent = content;

  // 转换 $N 占位符 (在 SQL 字符串中)
  const before = newContent;
  newContent = convertPlaceholders(newContent);
  if (newContent !== before) {
    const count = (before.match(/\$\d+/g) || []).length;
    if (count > 0) {
      console.log(`  [占位符] ${filePath}: 替换 ${count} 处 $N → ?`);
      modified = true;
      changes += count;
    }
  }

  // 转换 INTERVAL 语法
  const before2 = newContent;
  newContent = convertInterval(newContent);
  if (newContent !== before2) {
    const count = (before2.match(/INTERVAL\s+'\d+/g) || []).length;
    if (count > 0) {
      console.log(`  [INTERVAL] ${filePath}: 替换 ${count} 处 INTERVAL 'N unit' → INTERVAL N UNIT`);
      modified = true;
      changes += count;
    }
  }

  if (modified && !DRY_RUN) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }

  return changes;
}

function main() {
  console.log('=== MySQL 兼容性修复 ===');
  if (DRY_RUN) console.log('[DRY RUN 模式 — 不写入文件]\n');

  const files = getJsFiles(SERVER_DIR);
  console.log(`扫描 ${files.length} 个 JS 文件...\n`);

  let total = 0;
  for (const file of files) {
    total += processFile(file);
  }

  console.log(`\n完成！共替换 ${total} 处。`);
  if (DRY_RUN) console.log('(以上为预览，运行时不带 --dry-run 才会写入)');
}

main();
