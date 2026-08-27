/* ============================================
   确定性抽取器 —— 日期
   ------------------------------------------------
   一律基于「参考日期」（默认服务端当天）做相对计算，且使用【本地时间】。
   ⚠️ 切勿用 toISOString()：那是 UTC，东八区凌晨会整体偏到前一天，
      导致「今天」记成昨天（项目内 backup.js 曾有同类 UTC/本地混用坑）。
   ============================================ */

/** 本地时间格式化为 YYYY-MM-DD（不经 UTC 转换） */
function fmtLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function shiftDays(base, delta) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + delta);
    return d;
}

// 相对日期词典：口语 → 相对天数
const RELATIVE = {
    今天: 0, 今日: 0, 本日: 0,
    昨天: -1, 昨日: -1, 昨儿: -1,
    前天: -2, 前日: -2,
    明天: 1, 明日: 1,
    后天: 2,
    大前天: -3, 大后天: 3,
};

/**
 * 抽取日期。
 * 置信度：显式日期 0.99 > 相对日期词 0.95 > 缺省回退今天 0.85
 *
 * ⚠️ 关于回退值 0.85（经实测调整，勿随意改回 0.70）：
 * 「记账时不写日期 = 就是今天」是极强的用户直觉，属于安全默认而非猜测。
 * 早期取 0.70（低于 §6 的 date 阈值 0.8），导致「工资到账15000元」「房租2000元」
 * 这类完全清晰的输入全被拖成 needs_confirmation —— 等于每笔都要用户点确认，
 * 违背了「确定性优先」的初衷（该确认的是真正模糊的字段，不是合理默认）。
 * 修正为 0.85（略高于阈值）：默认今天视为达标，而真正模糊的日期表达
 * （如「上周三」0.85 边界、「某天」无匹配）仍走各自置信度。
 *
 * @param {string} text
 * @param {Date}   refDate 参考日期（测试可注入）
 * @returns {{value:string, source:string, confidence:number, raw:string}}
 */
function extractDate(text, refDate = new Date()) {
    const fallback = { value: fmtLocalDate(refDate), source: 'default_today', confidence: 0.85, raw: '' };
    if (!text || typeof text !== 'string') return fallback;

    // 1) 完整日期：2026-08-25 / 2026/8/25 / 2026年8月25日
    const full = text.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/);
    if (full) {
        const [, y, m, d] = full;
        const dt = new Date(Number(y), Number(m) - 1, Number(d));
        // 校验真实存在（排除 2 月 30 日这类被 JS 自动顺延的非法输入）
        if (dt.getMonth() === Number(m) - 1 && dt.getDate() === Number(d)) {
            return { value: fmtLocalDate(dt), source: 'explicit_full', confidence: 0.99, raw: full[0] };
        }
    }

    // 2) 月日（无年份）：8月25日 / 8-25 —— 年份取参考年
    const md = text.match(/(?<!\d)(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?(?!\d)/);
    if (md) {
        const m = Number(md[1]), d = Number(md[2]);
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
            const dt = new Date(refDate.getFullYear(), m - 1, d);
            if (dt.getMonth() === m - 1 && dt.getDate() === d) {
                return { value: fmtLocalDate(dt), source: 'explicit_month_day', confidence: 0.95, raw: md[0] };
            }
        }
    }

    // 3) 相对日期词（长词优先，避免「大前天」被「前天」截断）
    const keys = Object.keys(RELATIVE).sort((a, b) => b.length - a.length);
    for (const k of keys) {
        if (text.includes(k)) {
            return {
                value: fmtLocalDate(shiftDays(refDate, RELATIVE[k])),
                source: 'relative_word', confidence: 0.95, raw: k,
            };
        }
    }

    // 4) 「N天前 / N天后」
    const nDays = text.match(/(\d+)\s*天\s*(前|后|以前|以后)/);
    if (nDays) {
        const n = Number(nDays[1]);
        const dir = nDays[2].startsWith('前') ? -1 : 1;
        return {
            value: fmtLocalDate(shiftDays(refDate, n * dir)),
            source: 'relative_days', confidence: 0.92, raw: nDays[0],
        };
    }

    // 5) 「上周X / 本周X」——粗粒度，仅定位到那一周的对应星期
    const weekday = text.match(/(上|本|这)\s*(?:周|星期)\s*([一二三四五六日天])/);
    if (weekday) {
        const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
        const target = map[weekday[2]];
        const cur = refDate.getDay();
        let delta = target - cur;
        if (weekday[1] === '上') delta -= 7;
        return {
            value: fmtLocalDate(shiftDays(refDate, delta)),
            source: 'relative_weekday', confidence: 0.85, raw: weekday[0],
        };
    }

    // 6) 「X号」——本月内某日（如「25号交房租」）
    const dayOnly = text.match(/(?<!\d)(\d{1,2})\s*号(?!\d)/);
    if (dayOnly) {
        const d = Number(dayOnly[1]);
        if (d >= 1 && d <= 31) {
            const dt = new Date(refDate.getFullYear(), refDate.getMonth(), d);
            if (dt.getDate() === d) {
                return { value: fmtLocalDate(dt), source: 'day_of_month', confidence: 0.88, raw: dayOnly[0] };
            }
        }
    }

    return fallback;
}

module.exports = { extractDate, fmtLocalDate };
