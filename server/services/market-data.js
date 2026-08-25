/* ============================================
   鑫钱包 · 行情数据服务
   封装外部行情 API 调用，统一错误处理和降级策略

   数据源：
   - 腾讯证券 qt.gtimg.cn（A股/港股/美股/商品）：免费、GBK、无需 API key
   - 东方财富 fund.eastmoney.com（基金净值）
   - 币安 Binance API（加密货币）：免费公开接口

   支持的品类（category）：
   - stock（A股）     → 腾讯 qt.gtimg.cn/q=sh/sz+代码
   - hk_stock（港股）  → 腾讯 qt.gtimg.cn/q=hk+代码
   - us_stock（美股）  → 腾讯 qt.gtimg.cn/q=t_us+代码
   - fund（基金）      → 东方财富 api.fund.eastmoney.com
   - commodity（商品） → 腾讯 qt.gtimg.cn/q=hf_+代码
   - crypto（加密货币）→ 币安 api.binance.com
   - forex（外汇）     → 腾讯 qt.gtimg.cn/q=fx_+代码
   - deposit / other  → 不查行情
   ============================================ */

const https = require('https');
const http = require('http');

// ==========================================
// HTTP 工具
// ==========================================

/**
 * 通用 HTTP GET 请求
 * @param {string} url
 * @param {{ timeout?: number, headers?: Record<string,string> }|number} options
 * @returns {Promise<Buffer>}
 */
function httpGet(url, options = {}) {
  const { timeout = 8000, headers = {} } = typeof options === 'number' ? { timeout: options } : options;
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout, headers }, (resp) => {
      // 自动跟随重定向
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        httpGet(resp.headers.location, options).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      resp.on('data', chunk => chunks.push(chunk));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('行情请求超时')); });
    req.on('error', reject);
  });
}

// ==========================================
// 代码格式化与品类识别
// ==========================================

/**
 * 自动识别代码类型（sh/sz/bj 前缀=股票；纯 6 位数字=基金，保持与旧逻辑一致）
 */
function detectCodeType(code) {
  const c = String(code).trim();
  if (/^s[hz]\d{6}$/i.test(c)) return { type: 'stock', code: c.toLowerCase() };
  if (/^bj\d{6}$/i.test(c)) return { type: 'stock', code: c.toLowerCase() };
  if (/^\d{6}$/.test(c)) return { type: 'fund', code: c };
  return { type: 'unknown', code: c };
}

/**
 * 根据 A 股代码前几位推断交易所前缀
 * - sh：600/601/603/605/688/689/900...
 * - sz：000/001/002/003/300/301/200...
 * - bj：43/83/87/88/82/92...
 */
function inferAsharePrefix(numCode) {
  const c = String(numCode).trim();
  if (!/^\d{6}$/.test(c)) return 'sh';

  // 北交所：43/83/87/88/82/92 开头
  if (/^(43|83|87|88|82|92)\d{4}$/.test(c)) return 'bj';

  // 上海 A股（主板/科创板/B股）：6 或 9 开头
  if (/^[69]/.test(c)) return 'sh';

  // 深圳 A股（主板/创业板/B股）：0、2、3 开头
  if (/^[023]/.test(c)) return 'sz';

  // 上海场内基金 / ETF / LOF：50/51/55/56/58/59 开头
  if (/^(50|51|55|56|58|59)\d{4}$/.test(c)) return 'sh';

  // 深圳场内基金 / ETF / LOF：15/16/18 开头
  if (/^(15|16|18)\d{4}$/.test(c)) return 'sz';

  // 兜底：默认沪市（保持旧逻辑行为）
  return 'sh';
}

/**
 * 根据品类规范化用户输入的代码
 * - hk_stock：去除非数字，补零到5位 → hk00700
 * - us_stock：去点、去空格、转大写 → t_usAAPL
 * - commodity：hf_GC / hf_SI / hf_CL 直接使用
 * - crypto：BTCUSDT / ETHUSDT 转大写
 * - forex：fx_susdcnh 等
 */
function normalizeCode(category, rawCode) {
  const c = String(rawCode || '').trim();
  if (!c) return c;

  switch (category) {
    case 'hk_stock': {
      // 去掉非数字字符（如 . 空格 -），确保为5位数字（不足左侧补0）
      const num = c.replace(/[^0-9]/g, '');
      return 'hk' + num.padStart(5, '0');
    }
    case 'us_stock': {
      // 去掉点号、空格，转大写，去除交易所后缀（.OQ .N .O 等）
      let us = c.replace(/[.\s]/g, '').toUpperCase();
      // 如果用户已输入 t_usXXX 格式，保持不变
      if (us.startsWith('T_US')) return us;
      // 去掉常见的雅虎/腾讯后缀
      us = us.replace(/\.(OQ|N|O|A|Q)$/, '');
      return 't_us' + us;
    }
    case 'commodity':
      // 如果用户输入了 hf_ 前缀则直接使用，否则补上
      if (c.startsWith('hf_')) return c;
      return 'hf_' + c;
    case 'crypto':
      // 统一转大写，去掉 / - 符号
      return c.replace(/[/\-\s]/g, '').toUpperCase();
    case 'forex':
      if (c.startsWith('fx_')) return c;
      return 'fx_' + c;
    default:
      return c;
  }
}

/**
 * 根据投资品类 + 代码决定查询策略
 */
function getQuoteStrategy(invTypeCategory, code) {
  const c = String(code || '').trim();
  if (!c) return null;

  // 存款/其他品类不查行情
  if (invTypeCategory === 'deposit' || invTypeCategory === 'other') return null;

  // A股 → 腾讯证券
  if (invTypeCategory === 'stock') {
    const normalized = c.toLowerCase();
    if (/^s[hz]\d{6}$/i.test(c)) {
      return { type: 'stock', code: normalized };
    }
    if (/^bj\d{6}$/i.test(c)) {
      return { type: 'stock', code: normalized };
    }
    if (/^\d{6}$/.test(c)) {
      return { type: 'stock', code: inferAsharePrefix(c) + c };
    }
    // 兜底，保留原样（如用户输入了其他格式）
    return { type: 'stock', code: c };
  }

  // 港股 → 腾讯证券
  if (invTypeCategory === 'hk_stock') {
    return { type: 'stock', code: normalizeCode('hk_stock', c) };
  }

  // 美股 → 腾讯证券
  if (invTypeCategory === 'us_stock') {
    return { type: 'stock', code: normalizeCode('us_stock', c) };
  }

  // 商品/黄金 → 腾讯证券（A股ETF如sh518880走stock，COMEX如GC走commodity）
  if (invTypeCategory === 'commodity') {
    // A股格式代码（sh/sz开头）→ 走股票行情（黄金ETF等场内品种）
    if (/^s[hz]/i.test(c)) {
      const prefix = c.substring(0, 2).toLowerCase();
      return { type: 'stock', code: prefix + c.replace(/^s[hz]/i, '') };
    }
    // 纯数字也走股票（如 518880/159934），按 A 股规则推断交易所
    if (/^\d{6}$/.test(c)) return { type: 'stock', code: inferAsharePrefix(c) + c };
    // 其他走商品行情（hf_GC等）
    return { type: 'commodity', code: normalizeCode('commodity', c) };
  }

  // 外汇 → 腾讯证券
  if (invTypeCategory === 'forex') {
    return { type: 'stock', code: normalizeCode('forex', c) };
  }

  // 加密货币 → 币安 API
  if (invTypeCategory === 'crypto') {
    return { type: 'crypto', code: normalizeCode('crypto', c) };
  }

  // 基金类型 → 东方财富（纯数字）；带前缀的走股票
  if (invTypeCategory === 'fund') {
    if (/^\d{6}$/.test(c)) return { type: 'fund', code: c };
    if (/^s[hz]/i.test(c)) return { type: 'stock', code: c };
    return { type: 'fund', code: c };
  }

  // 默认：自动识别
  const detected = detectCodeType(c);
  return detected.type === 'unknown' ? null : detected;
}

// ==========================================
// 基金行情（东方财富 API）
// ==========================================

/**
 * 查询基金名称（东方财富 pingzhongdata 接口，含 fS_name 字段）
 * 用于补充东方财富 lsjz 净值接口缺失的名称，使基金也能像 A股一样自动填名称。
 */
async function fetchFundName(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const buf = await httpGet(url, {
    timeout: 8000,
    headers: { 'Referer': 'https://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }
  });
  const text = buf.toString('utf8');
  const m = text.match(/fS_name\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('基金名称解析失败');
  return m[1];
}

/**
 * 查询基金最新净值
 * @param {string} code 6位基金代码
 * @param {boolean} withName 是否额外拉取基金名称（仅手动查行情时开启，避免刷新全部时重复下载大文件）
 */
async function fetchFundQuote(code, withName = false) {
  const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`;
  const buf = await httpGet(url, {
    timeout: 8000,
    headers: { 'Referer': 'https://fund.eastmoney.com/' }
  });
  const data = JSON.parse(buf.toString('utf8'));

  if (data.ErrCode !== 0 || !data.Data || !data.Data.LSJZList || data.Data.LSJZList.length === 0) {
    throw new Error(data.ErrMsg || '基金数据获取失败');
  }

  const d = data.Data.LSJZList[0];
  // 名称来自东方财富 pingzhongdata（best-effort）；失败不影响净值查询
  let name = '';
  if (withName) {
    try { name = await fetchFundName(code); } catch (_) { /* 名称缺失时留空 */ }
  }
  return {
    code,
    name,
    nav: parseFloat(d.DWJZ) || 0,
    navDate: d.FSRQ || '',
    estimatedNav: parseFloat(d.DWJZ) || 0,
    estimatedChange: parseFloat(d.JZZZL) || 0,
    lastNav: parseFloat(d.DWJZ) || 0
  };
}

// ==========================================
// 腾讯证券行情（A股/港股/美股/商品/外汇）
// ==========================================

/**
 * 解码腾讯接口返回的 GBK 文本
 */
function decodeTencentResponse(buf) {
  try {
    return require('iconv-lite').decode(buf, 'gbk');
  } catch (_) {
    return buf.toString('utf8');
  }
}

/**
 * 解析腾讯 A股/港股/美股 ~ 分隔格式
 * 格式: v_sh600519="1~名称~代码~价格~..."
 *        v_hk00700="100~名称~代码~价格~..."
 *        v_t_usAAPL="delay~名称~代码~价格~..."
 */
function parseTencentTilde(raw, code) {
  const vMatch = raw.match(/="([^"]+)"/);
  if (!vMatch) throw new Error('股票数据解析失败');

  const parts = vMatch[1].split('~');
  if (parts.length < 5) throw new Error('股票数据字段不足');

  // 美股第一字段是 "delay" 而非数字，字段整体右移一位
  const isUS = parts[0] === 'delay';
  const idxName    = isUS ? 1 : 1;   // 名称始终在 parts[1]
  const idxCode    = isUS ? 2 : 2;   // 代码在 parts[2]
  const idxPrice   = isUS ? 3 : 3;   // 当前价
  const idxOpen    = isUS ? 5 : 5;   // 开盘价
  const idxChange  = isUS ? 31 : 31; // 涨跌额
  const idxChangeP = isUS ? 32 : 32; // 涨跌幅
  const idxHigh    = isUS ? 33 : 33; // 最高价
  const idxLow     = isUS ? 34 : 34; // 最低价

  return {
    code: parts[idxCode] || code,
    name: parts[idxName] || '',
    price: parseFloat(parts[idxPrice]) || 0,
    change: parseFloat(parts[idxChange]) || 0,
    changePercent: parseFloat(parts[idxChangeP]) || 0,
    high: parseFloat(parts[idxHigh]) || 0,
    low: parseFloat(parts[idxLow]) || 0,
    open: parseFloat(parts[idxOpen]) || 0
  };
}

/**
 * 解析腾讯商品/期货 , 分隔格式
 * 格式: v_hf_GC="4096.38,-1.54,4097.60,4098.60,..."
 */
function parseTencentComma(raw, code) {
  const vMatch = raw.match(/="([^"]+)"/);
  if (!vMatch) throw new Error('商品数据解析失败');

  const parts = vMatch[1].split(',');
  if (parts.length < 4) throw new Error('商品数据字段不足');

  // parts[0]=最新价, parts[1]=涨跌额, parts[2]=昨收, parts[3]=开盘, parts[5]=最低, parts[4]=最高
  return {
    code,
    name: '',
    price: parseFloat(parts[0]) || 0,
    change: parseFloat(parts[1]) || 0,
    changePercent: 0, // 商品接口不直接提供涨跌幅
    high: parseFloat(parts[4]) || 0,
    low: parseFloat(parts[5]) || 0,
    open: parseFloat(parts[3]) || 0
  };
}

/**
 * 查询腾讯证券实时行情（A股/港股/美股/商品/外汇）
 */
async function fetchStockQuote(code) {
  const url = `https://qt.gtimg.cn/q=${code}`;
  const buf = await httpGet(url, 6000);
  const raw = decodeTencentResponse(buf);

  // 判断返回格式：逗号分隔（商品/期货）还是波浪号分隔（股票）
  const vMatch = raw.match(/="([^"]+)"/);
  if (!vMatch) throw new Error('行情数据解析失败');

  // 如果内容包含逗号且不以 ~ 分隔 → 商品格式
  const inner = vMatch[1];
  if (inner.includes(',') && !inner.includes('~')) {
    return parseTencentComma(raw, code);
  }

  return parseTencentTilde(raw, code);
}

// ==========================================
// 加密货币行情（币安 API）
// ==========================================

/**
 * 查询加密货币实时价格
 * 使用币安公开 ticker API，无需 API key
 */
async function fetchCryptoQuote(code) {
  const symbol = String(code).toUpperCase().replace(/[/\-\s]/g, '');
  // 币安 symbol 格式：BTCUSDT, ETHUSDT 等
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  const buf = await httpGet(url, { timeout: 6000 });
  const data = JSON.parse(buf.toString('utf8'));

  if (!data || data.code) {
    throw new Error(data.msg || '加密货币数据获取失败');
  }

  return {
    code: symbol,
    name: '',
    price: parseFloat(data.lastPrice) || 0,
    change: parseFloat(data.priceChange) || 0,
    changePercent: parseFloat(data.priceChangePercent) || 0,
    high: parseFloat(data.highPrice) || 0,
    low: parseFloat(data.lowPrice) || 0,
    open: parseFloat(data.openPrice) || 0
  };
}

// ==========================================
// 持仓行情刷新辅助
// ==========================================

/**
 * 统一行情查询：根据品类 + 代码返回归一化行情对象
 * - 基金（fund）优先走东方财富净值；若该代码无净值（ETF/场内基金），回退腾讯证券实时价
 * - 股票/商品/外汇走腾讯证券；加密货币走币安
 * 返回字段对前端两种渲染分支（nav / price）均兼容。
 */
async function fetchQuoteByCategory(invTypeCategory, code, opts = {}) {
  const withName = !!opts.withName;
  const strategy = getQuoteStrategy(invTypeCategory, code);
  if (!strategy) throw new Error('该品类不支持行情查询');

  // 加密货币 → 币安
  if (strategy.type === 'crypto') {
    const q = await fetchCryptoQuote(strategy.code);
    return {
      source: 'crypto', code: q.code, name: q.name,
      price: q.price, nav: q.price, navDate: new Date().toISOString().slice(0, 10),
      change: q.change, changePercent: q.changePercent,
      high: q.high, low: q.low, open: q.open
    };
  }

  // 基金 → 东方财富净值；失败（ETF/场内基金无净值）回退腾讯证券实时价
  if (strategy.type === 'fund') {
    try {
      const q = await fetchFundQuote(strategy.code, withName);
      return {
        source: 'fund', code: q.code, name: q.name,
        nav: q.nav, estimatedNav: q.estimatedNav, estimatedChange: q.estimatedChange,
        price: q.estimatedNav || q.nav, navDate: q.navDate,
        change: 0, changePercent: q.estimatedChange || 0
      };
    } catch (_) {
      const stock = await fetchStockQuote(inferAsharePrefix(strategy.code) + strategy.code);
      return {
        source: 'stock', code: stock.code, name: stock.name,
        price: stock.price, nav: stock.price, navDate: new Date().toISOString().slice(0, 10),
        change: stock.change, changePercent: stock.changePercent,
        high: stock.high, low: stock.low, open: stock.open
      };
    }
  }

  // 股票 / 商品 / 外汇 → 腾讯证券
  const q = await fetchStockQuote(strategy.code);
  return {
    source: invTypeCategory === 'commodity' ? 'commodity' : 'stock',
    code: q.code, name: q.name,
    price: q.price, nav: q.price, navDate: new Date().toISOString().slice(0, 10),
    change: q.change, changePercent: q.changePercent,
    high: q.high, low: q.low, open: q.open
  };
}

/**
 * 根据投资记录获取行情数据，返回 price / navDate / name
 */
async function fetchPriceForInvestment(inv) {
  const q = await fetchQuoteByCategory(inv.type_category, inv.code);
  return { price: q.price, navDate: q.navDate, name: q.name };
}

// 仅导出被 routes 使用的公共 API；httpGet/normalizeCode/fetchFundQuote/
// fetchFundName/fetchStockQuote/fetchCryptoQuote 等仅为内部调用，不对外暴露。
module.exports = {
  detectCodeType,          // 被 test/market-data.test.js 覆盖
  getQuoteStrategy,
  fetchQuoteByCategory,
  fetchPriceForInvestment
};
