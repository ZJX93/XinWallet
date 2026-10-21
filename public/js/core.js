/*
 * core.js —— 从 app.js 抽离的纯展示 / 配对函数（审计 id 18：app.js god-file 分解第一刀）。
 *
 * 这批函数只依赖 utils.js 已挂载到 window 的 fmt / tt，不依赖 app.js 的任何局部变量，
 * 因此可安全独立成经典脚本，在 index.html 里于 utils.js 之后、app.js 之前加载。
 * 抽离后 app.js 直接复用这里的全局定义（不再重复声明），god-file 体积下降且单一真相收敛。
 *
 * ⚠️ 改动此文件后务必跑 `node --test test/app-dom.test.js`（jsdom 安全网已锁死
 *    fmtSigned / mergeTransferPairs 等行为）—— 任一回归此处必红。
 *
 * escapeHtml 已在 utils.js 中定义并挂载到 window，此处不再重复。
 */
// 带符号金额（收入 + / 支出 -），用于列表右侧。直接复用 utils.js 的 fmt（已按币种出符号）
function fmtSigned(n, type) {
    const v = Number(n);
    if (!isFinite(v)) return '¥0.00';
    // 取出 fmt 拼出的金额数字部分（去前缀符号/币符），避免双重符号：
    // fmt(正数, CNY) → '¥100.00'，此处只取 '100.00'。
    // 转出腿与支出同为资金流出，统一带 '-'；转入腿与收入带 '+'。
    // （成对的转账行显式传 'transfer_in'，不受此规则影响）
    const sign = (type === 'expense' || type === 'transfer_out') ? '-' : '+';
    const full = fmt(Math.abs(v));
    const numPart = full.replace(/^[^\d.-]+/, '');
    return sign + '¥' + numPart;
}
function fmtDate(d) {
    /**
     * 返回 datetime-local 的 value：YYYY-MM-DDTHH:mm
     *
     * ⚠️ 这里**不能**补到秒。调用方里有三个 `type="date"` 的框
     * （investBuyDate / reduceDate / interestDate），它们只接受
     * YYYY-MM-DD，多给时间部分会被浏览器直接拒收、value 变空。
     *
     * 需要秒粒度的 datetime-local 框请用 fmtDateTimeLocal()。
     */
    if (d) {
        const s = String(d).replace(' ', 'T');
        return s.slice(0, 16); // YYYY-MM-DDTHH:mm
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
}

/**
 * 给 `<input type="datetime-local" step="1">` 用的 value，精确到秒。
 *
 * 为什么必须补秒：带 step 的控件会渲染秒位。只回填到分钟时秒位是**空的**，
 * 用户明明没碰过秒，光标扫过去滚一下就变成 00:02:00 之类的值 ——
 * 而且会当成用户输入提交上去（截图里日期显示 2026/08/23 00:02:00
 * 而库里存的是 00:00:00，就是这么来的）。
 *
 * 只用在确认是 datetime-local 的框上（transDate / quickDate），
 * 不要拿去喂 type="date"。
 */
function fmtDateTimeLocal(d) {
    if (d) {
        const s = String(d).replace(' ', 'T').replace('Z', '');
        const base = s.slice(0, 19);
        if (base.length === 10) return base + 'T00:00:00';  // 只有日期
        if (base.length === 16) return base + ':00';        // 只到分钟
        return base;
    }
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
        + `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
// 显示用：datetime → 短格式（精确到秒）
function fmtDateTime(s) {
    if (!s) return '';
    const str = String(s).replace('T', ' ').replace('Z', '').trim();
    // 如果有秒就显示到秒
    if (str.length >= 19) return str.slice(0, 19);
    if (str.length >= 16) return str.slice(0, 16);
    return str.slice(0, 10);
}
function parseDateParts(s) {
    const str = String(s).replace('T', ' ').replace('Z', '').trim();
    const [datePart, timePart = ''] = str.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    return { y, m, d, time: timePart.slice(0, 5) };
}
// 本地日期 → YYYY-MM-DD（避免 toISOString 的 UTC 偏移问题）
function fmtLocalDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fmtDateGroupHeader(s) {
    const { y, m, d } = parseDateParts(s);
    const weekdays = [
        tt('app.date.weekday.sun', '星期日'),
        tt('app.date.weekday.mon', '星期一'),
        tt('app.date.weekday.tue', '星期二'),
        tt('app.date.weekday.wed', '星期三'),
        tt('app.date.weekday.thu', '星期四'),
        tt('app.date.weekday.fri', '星期五'),
        tt('app.date.weekday.sat', '星期六')
    ];
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return tt('app.date.groupFormat', '{y}年{m}月{d}日 {weekday}')
        .replace('{y}', y).replace('{m}', m).replace('{d}', d).replace('{weekday}', weekdays[day]);
}
function fmtTransTime(s) {
    const { time } = parseDateParts(s);
    return time || '00:00';
}

/**
 * 合并转账配对：把 transfer_in / transfer_out 归并成一条转账记录。
 *
 * ⚠️ 现在服务端已在 SQL 层折叠（transactions.js：命中配对 out 腿的
 * transfer_in 不再返回），所以列表里通常只有 out 腿一条，
 * 下面的 `transactions.find(...)` 找不到配对 —— 若仍依赖客户端配对，
 * 渲染就会变成「工资卡 → ?」。
 *
 * 因此优先吃服务端给的 t.transfer（{ id, from, to } 双端齐全），
 * 直接合成 _transferOut / _transferIn 的等价结构，让下游 renderRow
 * 与编辑弹窗的取值方式完全不变。
 *
 * 客户端配对逻辑保留作兜底：
 *   1. 旧版服务端（未部署折叠）仍会返回两条腿，此时走原路径
 *   2. transfer 字段要求双端账户名齐全才由服务端构造，账户被删时为 null
 */
function mergeTransferPairs(transactions) {
    const result = [];
    const pairedIds = new Set();
    for (const t of transactions) {
        if (pairedIds.has(t.id)) continue;
        // 路径 1：服务端已折叠并给出完整双端信息 —— 不需要在列表里找配对
        if (t.transfer && t.transfer.from && t.transfer.to) {
            const outLeg = { ...t, account: t.transfer.from };
            // in 腿在折叠后不存在于列表里，这里合成一个等价对象供渲染取 account.name。
            // 注意 id 仍用 out 腿的 —— 编辑/删除都按 transfer_id 走 /transfers/:id，
            // 不会真的用到这个合成 id 去操作单条 transactions。
            const inLeg = { ...t, account: t.transfer.to };
            pairedIds.add(t.id);
            result.push({
                ...t,
                _pairOut: outLeg, _pairIn: inLeg,
                _transferOut: outLeg, _transferIn: inLeg,
                amount: Math.abs(t.amount), _merged: true
            });
            continue;
        }
        // 路径 3：跨账户还款折叠腿（link_type='debt_repayment'，服务端给了 counterparty
        // 但没走 transfers 表，故无 transfer / transfer_id）。直接复用转账的 A→B 渲染模式：
        // 以自身 account 为 from、counterparty 为 to 合成双端，下游 renderRow 套用转账分支。
        if (t.link_type === 'debt_repayment' && t.counterparty) {
            const outIsSelf = t.type === 'transfer_out';
            const selfAcc = t.account;
            const peerAcc = { id: null, name: t.counterparty.name, icon: t.counterparty.icon };
            const outLeg = { ...t, account: outIsSelf ? selfAcc : peerAcc };
            const inLeg = { ...t, account: outIsSelf ? peerAcc : selfAcc };
            pairedIds.add(t.id);
            result.push({
                ...t,
                _pairOut: outLeg, _pairIn: inLeg,
                _transferOut: outLeg, _transferIn: inLeg,
                amount: Math.abs(t.amount), _merged: true
            });
            continue;
        }
        // 路径 2：旧版服务端返回两条腿，按 transfer_id 在列表内配对
        if ((t.type === 'transfer_in' || t.type === 'transfer_out') && t.transfer_id) {
            const pair = transactions.find(
                x => x.transfer_id === t.transfer_id && x.id !== t.id && !pairedIds.has(x.id)
            );
            if (pair) {
                const out = t.type === 'transfer_out' ? t : pair;
                const inn = t.type === 'transfer_in' ? t : pair;
                pairedIds.add(out.id);
                pairedIds.add(inn.id);
                result.push({ ...out, _pairOut: out, _pairIn: inn, _transferOut: out, _transferIn: inn, amount: out.amount, _merged: true });
                continue;
            }
        }
        result.push(t);
    }
    return result;
}

// ==========================================
// 缓存访问器（审计 id 18：从 app.js 抽离）。
// 原 app.js 用局部 lexical `cache`；此处改用 window.cache（app.js 顶部已执行
// window.cache = cache，且全仓未对 cache 重新赋值，二者为同一引用），
// 从而脱离 app.js 局部作用域、可在本文件直接复用。仅依赖 utils 的 tt。
// ==========================================
function getCat(id) { return window.cache.categories.find(c => c.id === id) || { id, name: tt('common.unknown', '未知'), icon: '📌' }; }
function getAcc(id) { return window.cache.accounts.find(a => a.id === id) || { id, name: tt('common.unknown', '未知'), icon: '💰' }; }
function getExpCats() { return window.cache.categories.filter(c => c.type === 'expense'); }
function getIncCats() { return window.cache.categories.filter(c => c.type === 'income'); }
function getTransferCats() { return window.cache.categories.filter(c => c.type === 'transfer'); }

// ==========================================
// 路由 URL 助手（审计 id 18：从 app.js 抽离）。
// 仅依赖 window.XIN_API_BASE / window.location，纯函数、无 app.js 局部状态。
// ==========================================
function siteBase() {
    return (window.XIN_API_BASE || '/api').replace(/\/api$/, '');
}
// 从 pathname 解析当前路由页（去掉站点根前缀与首尾斜杠）
function currentRoute() {
    let p = window.location.pathname;
    const base = siteBase();
    if (base && p.startsWith(base)) p = p.slice(base.length);
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p || 'dashboard';
}
// 路由页对应的 URL（所有页面统一为 /<page>，dashboard 也是 /dashboard）
function pageUrl(page) {
    const base = siteBase();
    return base + '/' + page;
}
