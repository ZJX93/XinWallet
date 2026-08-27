/* ============================================
   日期提取器
   ------------------------------------------------
   输入：自然语言文本（OCR 转录结果或手打输入）
   输出：{ value, confidence, source }

   v0.2 升级（用户投诉「识别时间要精确到秒」）:
     - 若文本中存在 HH:mm[:ss]，则 value 输出为 `YYYY-MM-DD HH:mm:ss`
       （与 DB TIMESTAMP 列对齐，前端可原样显示）
     - 仅有日期 → `YYYY-MM-DD`（保持兼容）
     - confidence 与 source 字段不受影响
   ============================================ */

const CN_NUM = { '〇': 0, '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

/* ──────────── 工具函数 ──────────── */

function pad(n) { return String(n).padStart(2, '0'); }

/**
 * 把常见中文数字串转成阿拉伯数字（用于「上午九点零五分」「八时三十分」）。
 * @param {string} s
 * @returns {string} 原样返回阿拉伯数字段；中文数字段尽量展开。
 */
function cnToArabicDigit(s) {
    if (!s) return s;
    // 1) 复合「X十Y」「X十」「十Y」先处理（贪婪匹配，避免被单字替换拆散）
    s = s.replace(/([零〇一二两三四五六七八九])十([零〇一二两三四五六七八九])?/g, (m, t, o) => {
        const tens = CN_NUM[t];
        const ones = o == null ? 0 : (CN_NUM[o] ?? NaN);
        if (Number.isNaN(ones)) return m;
        return String(tens * 10 + ones);
    });
    // 2) 单独的「十」→ 10
    s = s.replace(/十/g, '10');
    // 3) 单字中文数字 → 阿拉伯（零/〇/一/二/两/…/九）
    s = s.replace(/[零〇一二两三四五六七八九]/g, (m) => String(CN_NUM[m] ?? NaN));
    return s;
}

/* ──────────── 时间提取 ──────────── */

/**
 * 从文本中提取「HH:mm:ss」或「HH:mm」时间片段（出现位置无关）。
 * 优先匹配带秒的；只匹配到 HH:mm 时秒数置 0。
 * @param {string} text
 * @returns {{hour:number, minute:number, second:number, source:string, value:string} | null}
 */
function extractTime(text) {
    if (!text) return null;

    // 1) 标准 HH:mm:ss / HH:mm（24h 制）— 分钟/秒允许 1 位（OCR 经常漏前导 0）
    let m = text.match(/\b([01]?\d|2[0-3]):([0-5]?\d)(?::([0-5]?\d))?\b/);
    if (m) {
        const hour = Number(m[1]);
        const minute = m[2] != null ? Number(m[2]) : 0;
        const second = m[3] != null ? Number(m[3]) : 0;
        return {
            hour, minute, second,
            source: m[3] != null ? 'time_hh_mm_ss' : 'time_hh_mm',
            value: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
        };
    }

    // 2) 中文「上午九点零五分」「下午3点20」「08时12分33秒」
    const cn = cnToArabicDigit(text);
    m = cn.match(/(凌晨|早上|上午|中午|下午|晚上)?\s*([01]?\d|2[0-3])\s*[点时]\s*([0-5]?\d)\s*分(?:\s*([0-5]?\d)\s*秒)?/);
    if (m) {
        let hour = Number(m[2]);
        const minute = m[3] ? Number(m[3]) : 0;
        const second = m[4] ? Number(m[4]) : 0;
        // AM/PM 修正：下午 +12、晚上 +12；凌晨/早上/上午/中午 不变（中午 12 也保持 12）
        const mod = m[1];
        if ((mod === '下午' || mod === '晚上') && hour < 12) hour += 12;
        return {
            hour, minute, second,
            source: m[4] != null ? 'time_cn_hms' : 'time_cn_hm',
            value: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
        };
    }

    return null;
}

/* ──────────── 日期提取 ──────────── */

/**
 * 主入口。从文本中抽取日期；可选地拼上时间。
 * @param {string} text
 * @param {Date}   [refDate=new Date()]  默认回退值；测试可注入
 * @returns {{value:string, confidence:number, source:string, hasTime:boolean, time:object|null}}
 */
function extractDate(text, refDate = new Date()) {
    const safeRef = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : new Date();
    const today = isoDate(safeRef);
    if (!text || typeof text !== 'string') {
        return { value: today, confidence: 0.3, source: 'default_today', hasTime: false, time: null };
    }

    /* ── 1. 相对时间：今天/昨天/前天/明天（精度只到日，时间置 00:00:00） ── */
    const rel = text.match(/(今天|今儿|今|昨天|昨日|昨|前天|前日|前儿|明天|明儿|后天|大后天)/);
    if (rel) {
        const map = { 今天: 0, 今儿: 0, 今: 0, 昨天: -1, 昨日: -1, 昨: -1, 前天: -2, 前日: -2, 前儿: -2, 明天: 1, 明儿: 1, 后天: 2, 大后天: 3 };
        const offset = map[rel[1]];
        const d = new Date(refDate.getTime() + offset * 86400000);
        return { value: isoDate(d), confidence: 0.95, source: 'relative_day', hasTime: false, time: null };
    }

    /* ── 2. X天前 / X小时前 ── */
    const daysAgo = text.match(/(\d+)\s*天前/);
    if (daysAgo) {
        const d = new Date(refDate.getTime() - Number(daysAgo[1]) * 86400000);
        return { value: isoDate(d), confidence: 0.9, source: 'days_ago', hasTime: false, time: null };
    }

    /* ── 3. 完整日期：YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYYMMDD ── */
    const full = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (full) {
        const [, y, mo, d] = full;
        const iso = `${y}-${pad(mo)}-${pad(d)}`;
        const time = extractTime(text);
        if (time) {
            return {
                value: `${iso} ${time.value}`,
                confidence: 0.98,
                source: time.source === 'time_hh_mm_ss' ? 'full_with_seconds' : 'full_with_time',
                hasTime: true, time,
            };
        }
        return { value: iso, confidence: 0.95, source: 'full_date', hasTime: false, time: null };
    }

    const compact = text.match(/(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (compact) {
        const [, y, mo, d, h, mi, s] = compact;
        const iso = `${y}-${mo}-${d}`;
        if (h != null && mi != null) {
            const sec = s != null ? s : '00';
            return {
                value: `${iso} ${pad(h)}:${pad(mi)}:${pad(sec)}`,
                confidence: 0.95,
                source: s != null ? 'compact_with_seconds' : 'compact_with_time',
                hasTime: true,
                time: { hour: Number(h), minute: Number(mi), second: Number(sec), value: `${pad(h)}:${pad(mi)}:${pad(sec)}` },
            };
        }
        return { value: iso, confidence: 0.9, source: 'compact_date', hasTime: false, time: null };
    }

    /* ── 4. 中文日期：2026年8月25日 / 2026年08月25日 08:12:33 ── */
    const cn = cnToArabicDigit(text);
    const cnFull = cn.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (cnFull) {
        const [, y, mo, d] = cnFull;
        const iso = `${y}-${pad(mo)}-${pad(d)}`;
        const time = extractTime(text);
        if (time) {
            return {
                value: `${iso} ${time.value}`,
                confidence: 0.95,
                source: time.source === 'time_hh_mm_ss' ? 'cn_full_with_seconds' : 'cn_full_with_time',
                hasTime: true, time,
            };
        }
        return { value: iso, confidence: 0.9, source: 'cn_full_date', hasTime: false, time: null };
    }

    /* ── 5. M月D日（缺年 → 用 refDate 的年）── */
    const cnShort = cn.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cnShort) {
        const [, mo, d] = cnShort;
        const iso = `${refDate.getFullYear()}-${pad(mo)}-${pad(d)}`;
        const time = extractTime(text);
        if (time) {
            return {
                value: `${iso} ${time.value}`,
                confidence: 0.7,
                source: time.source === 'time_hh_mm_ss' ? 'cn_short_with_seconds' : 'cn_short_with_time',
                hasTime: true, time,
            };
        }
        return { value: iso, confidence: 0.65, source: 'cn_short_date', hasTime: false, time: null };
    }

    /* ── 6. 兜底：今天 ── */
    return { value: today, confidence: 0.3, source: 'default_today', hasTime: false, time: null };
}

function isoDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { extractDate, extractTime };
