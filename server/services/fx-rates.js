/* ============================================
   鑫钱包 · 汇率服务（多币种 P2-2b）
   - 数据源：fawazahmed0 currency-api（jsdelivr CDN 镜像）
     URL: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06/v1/currencies/{base}.json
     每日凌晨更新；免费、无需 API key、CORS 友好、无 rate limit
     返回形如：{ "date": "2026-09-05", "usd": { "cny": 7.18, "eur": 0.91, ... } }
   - 缓存策略（三级 fallback）：
     1) 内存缓存 24h（最快，进程级）
     2) DB 最新快照（重启后仍可用）
     3) 远端 fetch + 落库（首次 / 强制刷新）
   - 持久化：fx_rates 表存每次 fetch 的快照，UNIQUE(base, date) 避免重复
   - 归一化：rates key 一律大写（API 返回小写如 cny → CNY），便于前端消费
   ============================================ */

const https = require('https');
const http = require('http');
const db = require('../db');

const SOURCE_NAME = 'fawazahmed0-currency-api';
const DEFAULT_BASE = 'USD';
// 固定版本号：避免 jsdelivr 的 @latest 跨天拉到不同 schema；2024-03-06 起的 schema 已稳定
const SOURCE_URL_BASE = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06/v1/currencies';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

let _memCache = null; // { data, expiresAt }

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'XinWallet/1.0' } }, (resp) => {
      // 跟随重定向
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        httpGetJson(resp.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (resp.statusCode >= 400) {
          return reject(new Error(`HTTP ${resp.statusCode}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('汇率响应非 JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('汇率请求超时')); });
    req.on('error', reject);
  });
}

/**
 * 归一化汇率对象：key 大写，过滤非正数。
 */
function normalizeRates(rawRates) {
  const out = {};
  if (!rawRates || typeof rawRates !== 'object') return out;
  for (const [k, v] of Object.entries(rawRates)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[String(k).toUpperCase()] = n;
  }
  return out;
}

/**
 * 拉取远端汇率并落库（双方言 upsert：db.upsertSql）。
 * @returns {Promise<{base, date, rates, source, fetchedAt}>}
 */
async function fetchAndStore() {
  const url = `${SOURCE_URL_BASE}/${DEFAULT_BASE.toLowerCase()}.json`;
  const json = await httpGetJson(url);
  const date = json && json.date;
  const baseRates = json && json[DEFAULT_BASE.toLowerCase()];
  if (!date || !baseRates || typeof baseRates !== 'object') {
    throw new Error('汇率响应缺少 date 或 rates 字段');
  }
  const rates = normalizeRates(baseRates);
  if (!rates.CNY) {
    // 防御：连基础货币 CNY 都没有 → 视为响应异常（API 几乎肯定有 CNY，否则数据源异常）
    throw new Error('汇率响应未包含 CNY 等基础货币');
  }
  const fetchedAt = new Date().toISOString();

  // 落库：双方言 upsert（UNIQUE(base, date)）
  const sql = db.upsertSql('fx_rates', ['base', 'date'], ['rates', 'source', 'fetched_at']);
  await db.query(sql, [DEFAULT_BASE, date, JSON.stringify(rates), SOURCE_NAME, fetchedAt]);

  const data = { base: DEFAULT_BASE, date, rates, source: SOURCE_NAME, fetchedAt };
  _memCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/**
 * 从 DB 取最新一条汇率快照。
 * @returns {Promise<{base, date, rates, source, fetchedAt}|null>}
 */
async function loadLatestFromDb() {
  const row = await db.queryOne(
    'SELECT base, date, rates, source, fetched_at FROM fx_rates ORDER BY fetched_at DESC LIMIT 1'
  );
  if (!row) return null;
  // 双方言 JSON 字段可能为对象或字符串，统一归一化
  let rates = row.rates;
  if (typeof rates === 'string') {
    try { rates = JSON.parse(rates); } catch (_) { rates = {}; }
  }
  return {
    base: row.base,
    date: typeof row.date === 'string' ? row.date : row.date.toISOString().slice(0, 10),
    rates: normalizeRates(rates),
    source: row.source,
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}

function withAge(data) {
  const ageMs = Date.now() - new Date(data.fetchedAt).getTime();
  const ageHours = Math.round((ageMs / 3600_000) * 10) / 10;
  return { ...data, ageHours, stale: ageMs > CACHE_TTL_MS };
}

/**
 * 取最新可用汇率。
 * - 内存 → DB → fetch 三级 fallback
 * - 强刷（forceRefresh=true）时直接 fetch；fetch 失败则回退 DB
 * - fetch 失败 + DB 也无 → 抛错
 * @returns {Promise<{base, date, rates, source, fetchedAt, ageHours, stale, warning?}>}
 */
async function getLatest({ forceRefresh = false } = {}) {
  // 1) 内存
  if (!forceRefresh && _memCache && _memCache.expiresAt > Date.now()) {
    return withAge(_memCache.data);
  }

  let warning;
  let data = null;

  // 2) 强刷：fetch（fetchAndStore 内部会更新内存）
  if (forceRefresh) {
    try {
      data = await fetchAndStore();
    } catch (e) {
      warning = `远程汇率拉取失败：${e.message}`;
    }
  }

  // 3) 退到 DB
  if (!data) {
    data = await loadLatestFromDb();
  }

  // 4) DB 也无 → 强制 fetch（覆盖 warning 也救不了）
  if (!data) {
    try {
      data = await fetchAndStore();
    } catch (e) {
      throw new Error(`无可用汇率（DB 为空且远程拉取失败：${e.message}）`);
    }
  }

  // 内存缓存（即使是 fallback 也缓存 24h，避免每个请求都查 DB）
  _memCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  const result = withAge(data);
  if (warning) result.warning = warning;
  return result;
}

module.exports = {
  getLatest,
  fetchAndStore,
  SOURCE_NAME,
  DEFAULT_BASE,
};
