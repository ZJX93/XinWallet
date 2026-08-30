/* ============================================
   AI 识别行为设置服务回归测试
   ------------------------------------------------
   守护一个真实事故：PG 方言下 db.query 会对无 RETURNING 的 INSERT
   自动追加 `RETURNING id`，而 ai_settings 表只有 user_id 主键、
   没有 id 列 → 保存设置直接 500（column "id" does not exist）。

   updateAiSettings 的 db 是参数注入的，测试用假 db 直接锁死两种方言的
   最终 SQL 形态，不依赖真实数据库。
   ============================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    updateAiSettings, getAiSettings,
} = require('../server/modules/ai/services/ai-settings-service');

/** 构造一个方言可控的假 db：记录最后一次 query 的 SQL */
function makeDb(dialect) {
    let lastSql = null;
    let failFirst = 0; // 前 N 次 query 抛错（模拟老库无表 → 建表自愈路径）
    const db = {
        DB_DIALECT: dialect,
        queryOne: async () => null, // 假设无已有行
        upsertSql(table, pkCols, setCols) {
            // 与 server/db.js 相同的双方言构造逻辑
            const colList = [...pkCols, ...setCols].join(', ');
            const placeholders = [...pkCols, ...setCols].map(() => '?').join(', ');
            if (dialect === 'mysql') {
                const setClause = setCols.map(c => `${c} = VALUES(${c})`).join(', ');
                return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${setClause}`;
            }
            const excludedCols = setCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
            return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${pkCols.join(', ')}) DO UPDATE SET ${excludedCols}`;
        },
        async query(sql) {
            if (failFirst > 0) {
                failFirst -= 1;
                throw new Error('relation "ai_settings" does not exist');
            }
            lastSql = sql;
            return [];
        },
        get lastSql() { return lastSql; },
        set failFirst(n) { failFirst = n; },
    };
    return db;
}

test('PG 方言：upsert SQL 必须显式 RETURNING user_id（否则 autoReturning 会追加 RETURNING id 报错）', async () => {
    const db = makeDb('pg');
    const out = await updateAiSettings(db, 1, { few_shot: false });
    assert.equal(out.few_shot, false);
    assert.match(db.lastSql, /ON CONFLICT \(user_id\) DO UPDATE SET/);
    assert.match(db.lastSql, /RETURNING user_id/);
    assert.doesNotMatch(db.lastSql, /RETURNING id/);
});

test('MySQL 方言：upsert 用 ON DUPLICATE KEY UPDATE，不带 RETURNING', async () => {
    const db = makeDb('mysql');
    const out = await updateAiSettings(db, 1, { prompt_version: 'v3' });
    assert.equal(out.prompt_version, 'v3');
    assert.match(db.lastSql, /ON DUPLICATE KEY UPDATE settings = VALUES\(settings\)/);
    assert.doesNotMatch(db.lastSql, /RETURNING/);
});

test('老库无表时：首次失败自动建表并重试成功（PG 分支仍带 RETURNING user_id）', async () => {
    const db = makeDb('pg');
    db.failFirst = 1; // 第一次 upsert 失败 → 触发建表 + 重试
    const out = await updateAiSettings(db, 1, { llm_first: true });
    assert.equal(out.llm_first, true);
    assert.match(db.lastSql, /RETURNING user_id/);
});

test('getAiSettings：DB 无记录时回退 env 默认，绝不抛错', async () => {
    const db = makeDb('pg');
    const s = await getAiSettings(db, 1);
    assert.equal(typeof s.model_route, 'boolean');
    assert.equal(typeof s.model_route_simple, 'boolean');
    assert.equal(typeof s.llm_first, 'boolean');
    assert.equal(typeof s.few_shot, 'boolean');
    assert.ok(['v3'].includes(s.prompt_version));
});
