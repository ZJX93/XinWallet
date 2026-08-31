/* ============================================
   鑫钱包 · 账户/账本归属诊断脚本
   ------------------------------------------------
   目的：定位「AI 解析账户数 ≠ 资产页/手工记账账户数」的根因。
   - 资产页/手工记账：严格按 user_id + book_id（+ 视情况 status）查询
   - AI 解析（buildContext）：user_id + book_id + status='active'
   若两者对不上，通常是某些账户的 book_id 归属错乱（NULL 或别的账本）。

   用法：
     node scripts/check-accounts.js
   （需在能连上数据库的环境运行；docker 部署可：
     docker compose exec app node scripts/check-accounts.js）
   ============================================ */

const db = require('../server/db');

(async () => {
  try {
    const users = await db.query('SELECT id, username FROM users ORDER BY id');
    if (!users.length) { console.info('（无用户数据）'); return; }

    for (const u of users) {
      console.info(`\n===== 用户 id=${u.id}  username=${u.username} =====`);

      const books = await db.query(
        'SELECT id, name, is_default FROM books WHERE user_id = ? ORDER BY id',
        [u.id]
      );
      console.info('账本列表：', books.map(b => `#${b.id} ${b.name}${b.is_default ? '(默认)' : ''}`).join('  |  ') || '（无账本）');

      // 各账本 × 各状态的账户数
      const dist = await db.query(
        `SELECT book_id, status, COUNT(*) AS cnt
           FROM accounts WHERE user_id = ?
          GROUP BY book_id, status
          ORDER BY book_id, status`,
        [u.id]
      );
      console.info('账户分布（按账本 / 状态）：');
      for (const r of dist) {
        console.info(`  book_id=${r.book_id ?? 'NULL'}  status=${r.status}  数量=${r.cnt}`);
      }

      // 游离账户：active，但 book_id 不属于该用户任何账本（或 NULL）
      const bookIds = books.map(b => b.id);
      const placeholders = bookIds.length ? bookIds.map(() => '?').join(',') : 'NULL';
      const orphan = await db.query(
        `SELECT id, name, book_id, status
           FROM accounts
          WHERE user_id = ? AND status = 'active'
            AND (book_id IS NULL OR book_id NOT IN (${placeholders}))`,
        [u.id, ...bookIds]
      );
      console.info(`\n⚠️  游离活跃账户（book_id 不属于该用户任何账本 / NULL）：共 ${orphan.length} 个`);
      for (const a of orphan) console.info(`   id=${a.id}  ${a.name}  book_id=${a.book_id ?? 'NULL'}`);

      // 关键对比：默认账本下，AI 能拿到的(active) vs 资产页看到的(全部)
      const def = books.find(b => b.is_default) || books[0];
      if (def) {
        const aiCnt = (dist.find(r => r.book_id === def.id && r.status === 'active') || {}).cnt || 0;
        const allCnt = dist.filter(r => r.book_id === def.id).reduce((s, r) => s + Number(r.cnt), 0);
        console.info(`\n📌 默认账本 #${def.id}：AI 能拿到 ${aiCnt} 个 active 账户；资产页(全部) ${allCnt} 个`);
      }
    }
  } catch (e) {
    console.error('查询失败：', e.message);
    console.error('请确认在能连上数据库的环境运行（docker 部署用 `docker compose exec app node scripts/check-accounts.js`）。');
  } finally {
    process.exit(0);
  }
})();
