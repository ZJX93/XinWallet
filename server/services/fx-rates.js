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
// 最新汇率源：currency-api 的 Cloudflare Pages 镜像（真正按日更新）。
// ⛔ 旧数据源 cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06 是【固定日期快照】，
//    无论何时访问都返回 2024-03-06 的汇率，也不含任意历史日期——此前 fx_rates 拿到的
//    实为 2024 年的旧汇率（2026-09-07 实测确认），必须切到 pages.dev 才能拿到最新值。
const SOURCE_URL_BASE = 'https://latest.currency-api.pages.dev/v1/currencies';
// 历史汇率源：frankfurter（欧洲央行参考汇率，免费、无 key、CORS 友好）。
// 支持「任意历史日期」+「最新」，覆盖主流货币（CNY/USD/EUR/JPY/HKD/KRW/GBP 等约 30 种）。
// 用于「按交易日期取当日汇率折算」；pages.dev 只提供最新，作小币种兜底。
const FRANKFURTER_BASE = 'https://api.frankfurter.app';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

let _memCache = null; // { data, expiresAt }
// 单次折算汇率缓存：key 'from:to:date' → { rate, date, source, expiresAt }
const _rateCache = new Map();

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

/**
 * 获取 from → to 的汇率（1 from = rate to），用于「外币消费折算成账户币种」。
 *
 * ⛔ 按【交易日期】取当日汇率：优先 frankfurter（欧洲央行，支持任意历史日期 +
 *    最新），失败再回退 pages.dev（仅最新，作小币种/故障兜底，cross rate 折算）。
 *    frankfurter 对周末/节假日会返回最近一个工作日的汇率，其 date 字段即为
 *    真实报价日期，落账时原样记到 rate_date。
 *
 * @param {string} from  源币种（ISO 4217，如 'USD'）
 * @param {string} to    目标币种（通常为账户币种，如 'CNY'）
 * @param {string} [date] 交易日期 'YYYY-MM-DD'；缺省取最新
 * @returns {Promise<{rate:number, date:string, source:string, from:string, to:string}>}
 */
async function getRate(from, to, date) {
  const f = String(from || '').toUpperCase();
  const t = String(to || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) {
    throw new Error(`币种代码非法：${from} → ${to}`);
  }
  if (f === t) return { rate: 1, date: date || todayIso(), source: 'identity', from: f, to: t };

  const key = `${f}:${t}:${date || 'latest'}`;
  const cached = _rateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { rate: cached.rate, date: cached.date, source: cached.source, from: f, to: t };
  }

  // 1) frankfurter：历史日期 + 最新
  const path = date ? `/${String(date).slice(0, 10)}` : '/latest';
  try {
    const json = await httpGetJson(`${FRANKFURTER_BASE}${path}?from=${f}&to=${t}`);
    const rate = json && json.rates ? Number(json.rates[t]) : 0;
    if (rate && rate > 0) {
      const d = (json && json.date) || date || todayIso();
      _rateCache.set(key, { rate, date: d, source: 'frankfurter', expiresAt: Date.now() + CACHE_TTL_MS });
      return { rate, date: d, source: 'frankfurter', from: f, to: t };
    }
  } catch (_) { /* fallthrough → pages.dev 兜底 */ }

  // 2) pages.dev 兜底：仅有最新。以请求币种为 base，反过来按 USD/from 视角算 cross rate
  try {
    const lc = f.toLowerCase();
    const json = await httpGetJson(`${SOURCE_URL_BASE}/${lc}.json`);
    const rates = normalizeRates(json && json[lc]);
    const baseRate = rates[f] || 1;
    const rate = rates[t] ? rates[t] / baseRate : 0;
    if (rate && rate > 0) {
      const d = (json && json.date) || todayIso();
      _rateCache.set(key, { rate, date: d, source: SOURCE_NAME, expiresAt: Date.now() + CACHE_TTL_MS });
      return { rate, date: d, source: SOURCE_NAME, from: f, to: t };
    }
  } catch (_) { /* fallthrough → 抛错 */ }

  throw new Error(`无法获取 ${f} → ${t} 汇率（${date ? `日期 ${date}` : '最新'}）`);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 把一笔外币金额折算成账户币种，返回落账所需字段（原币痕迹一并带回）。
 *
 * ⛔ 这是「方案B 折合成主账户币种」的唯一落账口径，手动记账（transactions.js）
 *    与 AI 预测落账（prediction-store.js）共用，避免两处各写一套折算逻辑。
 *    from === to（同币种）时不折算，原币字段一律为 null。
 *
 * @param {object} p
 * @param {number} p.amount 原币金额
 * @param {string} p.from    原币（如 'USD'）
 * @param {string} p.to      账户币种（如 'CNY'）
 * @param {string} [p.date] 交易日期 'YYYY-MM-DD'（取当日汇率）
 * @returns {Promise<{amount:number, currency:string, original_amount:number|null,
 *                    original_currency:string|null, exchange_rate:number|null, rate_date:string|null}>}
 */
async function convertAmount({ amount, from, to, date }) {
  const fromC = String(from || '').toUpperCase();
  const toC = String(to || '').toUpperCase();
  if (!fromC || fromC === toC) {
    return {
      amount, currency: toC,
      original_amount: null, original_currency: null,
      exchange_rate: null, rate_date: null,
    };
  }
  const r = await getRate(fromC, toC, date || null);
  const converted = Math.round(amount * r.rate * 100) / 100;
  return {
    amount: converted,
    currency: toC,
    original_amount: amount,
    original_currency: fromC,
    exchange_rate: r.rate,
    rate_date: r.date || date || null,
  };
}

module.exports = {
  getLatest,
  getRate,
  convertAmount,
  fetchAndStore,
  SOURCE_NAME,
  DEFAULT_BASE,
};
