/**
 * Harmony 端 AI v0.2 契约冒烟测试。
 *
 * 复刻 harmony/entry/src/main/ets/common/http/Http.ts 的 doRequest 语义：
 *   - 返回完整 ApiResponse<T>（不像 web 的 api() 只返 data）
 *   - parsed.success === false 时抛 ApiError(message, resp.responseCode)
 *     —— 注意 code 取【HTTP 状态码】而非响应体里的 code，这是 Chat.ets
 *        用 `err.code === 422` 判定「不是一笔交易、应回退 /ai/chat」的前提。
 *
 * 同时复刻 Chat.ets 的 isDirty() / cloneTxns() / commitPrediction() 前置自检逻辑，
 * 确保客户端侧的 confirmed / corrected 推导与服务端 final_diff 一致。
 *
 * 跑法：node server/modules/ai/__tests__/smoke-harmony-contract.mjs
 * 前置：本机服务监听 18888，PG 可用，ALLOW_DEMO=true
 */

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:18888';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '';

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label, extra) {
    if (cond) {
        pass++;
        console.log(`  ✓ ${label}`);
    } else {
        fail++;
        failures.push(label);
        console.log(`  ✗ ${label}${extra ? ' → ' + JSON.stringify(extra) : ''}`);
    }
}

/** Harmony 的 ApiError：code 是 HTTP 状态码 */
class ApiError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

let TOKEN = '';

/** 复刻 Http.ts doRequest：返回完整 ApiResponse，!success 抛 ApiError(message, httpCode) */
async function harmonyRequest(path, method = 'GET', body) {
    const headers = { 'Content-Type': 'application/json' };
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const resp = await fetch(`${BASE}/api/${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await resp.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new ApiError('响应不是合法 JSON: ' + text.slice(0, 200), resp.status);
    }
    if (!parsed.success) {
        throw new ApiError(parsed.message ?? '请求失败', resp.status);
    }
    return parsed;
}

const hGet = (p) => harmonyRequest(p, 'GET');
const hPost = (p, b) => harmonyRequest(p, 'POST', b);

/* ---------- 复刻 Chat.ets 的纯逻辑 ---------- */

function cloneTxn(t) {
    const c = {};
    if (t.confidence) {
        c.amount = t.confidence.amount;
        c.type = t.confidence.type;
        c.category = t.confidence.category;
        c.date = t.confidence.date;
        c.currency = t.confidence.currency;
        c.merchant = t.confidence.merchant;
    }
    const ev = {};
    if (t.evidence) {
        ev.amount = t.evidence.amount;
        ev.type = t.evidence.type;
        ev.category = t.evidence.category;
        ev.date = t.evidence.date;
        ev.currency = t.evidence.currency;
        ev.merchant = t.evidence.merchant;
    }
    return {
        seq: t.seq, type: t.type, amount: t.amount, currency: t.currency,
        category_id: t.category_id, category_name: t.category_name,
        account_id: t.account_id, from_account_id: t.from_account_id,
        to_account_id: t.to_account_id, date: t.date, note: t.note,
        merchant: t.merchant, raw_segment: t.raw_segment,
        confidence: c, evidence: ev
    };
}
const cloneTxns = (list) => list.map(cloneTxn);

function isDirty(candidates, original) {
    if (candidates.length !== original.length) return true;
    for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i];
        const b = original[i];
        if (!b || a.seq !== b.seq) return true;
        if (a.type !== b.type) return true;
        if (Math.abs(a.amount - b.amount) > 1e-9) return true;
        if ((a.category_id ?? 0) !== (b.category_id ?? 0)) return true;
        if ((a.account_id ?? 0) !== (b.account_id ?? 0)) return true;
        if ((a.from_account_id ?? 0) !== (b.from_account_id ?? 0)) return true;
        if ((a.to_account_id ?? 0) !== (b.to_account_id ?? 0)) return true;
        if ((a.date ?? '') !== (b.date ?? '')) return true;
        if ((a.note ?? '') !== (b.note ?? '')) return true;
    }
    return false;
}

/** markCorrected：人工改动的字段置信度置 1.0 + evidence 标记 */
function markCorrected(item, field) {
    const c = item.confidence ? item.confidence : {};
    const ev = item.evidence ? item.evidence : {};
    if (field === 'amount') { c.amount = 1.0; ev.amount = 'user_corrected'; }
    else if (field === 'type') { c.type = 1.0; ev.type = 'user_corrected'; }
    else if (field === 'category') { c.category = 1.0; ev.category = 'user_corrected'; }
    else if (field === 'date') { c.date = 1.0; ev.date = 'user_corrected'; }
    item.confidence = c;
    item.evidence = ev;
}

/** commitPrediction 的前置自检；返回错误文案或 null */
function precheck(candidates) {
    for (const it of candidates) {
        const tag = `第 ${it.seq} 笔`;
        if (!(it.amount > 0)) return `${tag}金额无效，请修正后再入账`;
        if (it.type === 'transfer') {
            if (!it.from_account_id || !it.to_account_id) return `${tag}请选择转出与转入账户`;
            if (it.from_account_id === it.to_account_id) return `${tag}转出与转入账户不能相同`;
        } else if (!it.account_id) {
            return `${tag}请选择账户`;
        }
    }
    return null;
}

function todayLocal() {
    const d = new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${d.getFullYear()}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`;
}

/* ---------- 主流程 ---------- */

async function main() {
    console.log(`\nHarmony 契约冒烟 @ ${BASE}\n${'='.repeat(60)}`);

    /* --- 登录 --- */
    console.log('\n[0] 登录（demo 通道）');
    const login = await hPost('auth/demo', {});
    ok(login.success === true, 'ApiResponse.success === true');
    ok(typeof login.data?.token === 'string' && login.data.token.length > 0, '拿到 token');
    TOKEN = login.data.token;

    const accRes = await hGet('accounts');
    // Harmony Chat.ets 用 AccountsResponse 取 accounts 并过滤 closed
    const accounts = (accRes.data.accounts || []).filter((a) => (a.status ?? 'active') !== 'closed');
    ok(accounts.length > 0, `账户列表非空（${accounts.length} 个可用）`);
    const catRes = await hGet('categories?flat=1');
    const categories = catRes.data || [];
    ok(Array.isArray(categories) && categories.length > 0, `分类列表非空（${categories.length} 个）`);

    // 优先默认账户；若其余额不足（反复跑测试会耗尽），退化为余额最充足的账户，
    // 避免撞上与被测逻辑无关的「余额不能低于 0」保护性 409。
    const byBalance = accounts
        .filter((a) => a.type !== 'credit_card' && (a.status ?? 'active') !== 'closed')
        .sort((x, y) => Number(y.balance) - Number(x.balance));
    const marked = accounts.find((a) => a.is_default === true);
    const defAcc = (marked && Number(marked.balance) > 500) ? marked : (byBalance[0] || accounts[0]);
    const defaultAccountId = defAcc.id;
    ok(defaultAccountId > 0, `默认账户解析成功（${defAcc.name} #${defaultAccountId}）`);

    /* --- A: 单笔 parse → confirmed 提交 --- */
    console.log('\n[A] 单笔：parse → confirmed（未改动）');
    const pA = await hPost('ai/transactions/parse', {
        text: '今天午饭花了 28 元',
        context: { account_id: defaultAccountId, date: todayLocal(), platform: 'harmony' },
        source: 'chat'
    });
    ok(pA.success === true, 'parse 返回 success');
    ok(typeof pA.data.prediction_id === 'number' && pA.data.prediction_id > 0, 'prediction_id 有效');
    ok(Array.isArray(pA.data.transactions) && pA.data.transactions.length === 1, '识别 1 笔');
    ok(['ready', 'needs_confirmation'].includes(pA.data.verdict), `verdict 合法（${pA.data.verdict}）`);
    ok(typeof pA.data.needs_confirmation === 'boolean', 'needs_confirmation 是布尔');

    const tA = pA.data.transactions[0];
    ok(tA.type === 'expense', `类型=expense（实际 ${tA.type}）`);
    ok(Math.abs(tA.amount - 28) < 1e-9, `金额=28（实际 ${tA.amount}）`);
    ok(typeof tA.date === 'string' && tA.date.length === 10, `date 是 10 字符纯日期（${tA.date}）`);

    // cloneTxns 深拷贝后 isDirty 必须为 false —— 这是 confirmed 路径的前提
    const origA = cloneTxns(pA.data.transactions);
    const candA = cloneTxns(pA.data.transactions);
    ok(isDirty(candA, origA) === false, 'cloneTxns 深拷贝后 isDirty=false（走 confirmed）');
    ok(candA[0].confidence !== pA.data.transactions[0].confidence, 'confidence 已断开引用（非同一对象）');

    ok(precheck(candA) === null, `前置自检通过（account_id=${candA[0].account_id}）`);

    // 快照可读，且 validation 结构符合客户端预期
    const snapA = await hGet(`ai/predictions/${pA.data.prediction_id}`);
    ok(snapA.data.status === 'pending', `快照 status=pending（实际 ${snapA.data.status}）`);
    ok(!!snapA.data.validation, 'validation 存在');
    const pf = snapA.data.validation.per_txn?.[0]?.per_field;
    ok(!!pf, 'per_txn[0].per_field 存在（字段徽标数据源）');
    if (pf) {
        ok(typeof pf.amount?.score === 'number' && typeof pf.amount?.ok === 'boolean',
            'per_field.amount 含 score + ok（AiFieldVerdict 契约）');
    }

    const balBefore = accounts.find((a) => a.id === candA[0].account_id)?.balance;
    const idemA = `harmony-${pA.data.prediction_id}-${Date.now()}`;
    const cA = await hPost(`ai/predictions/${pA.data.prediction_id}/commit`, {
        action: 'confirmed',
        transactions: undefined,     // confirmed 不回传，服务端用不可变快照
        idempotency_key: idemA
    });
    ok(cA.success === true, 'commit(confirmed) 成功');
    ok(Array.isArray(cA.data.transactions) && cA.data.transactions.length === 1, '落账 1 笔');
    ok(typeof cA.data.message === 'string' && cA.data.message.length > 0, 'message 非空（用于气泡文案）');
    ok(cA.data.prediction_id === pA.data.prediction_id, 'prediction_id 回显一致');

    // 幂等重放：余额不该二次变动
    const cA2 = await hPost(`ai/predictions/${pA.data.prediction_id}/commit`, {
        action: 'confirmed', idempotency_key: idemA
    });
    ok(cA2.success === true, '同 idempotency_key 重放成功（不报错）');
    const accAfter = (await hGet('accounts')).data.accounts;
    const balAfter = accAfter.find((a) => a.id === candA[0].account_id)?.balance;
    ok(Math.abs((Number(balBefore) - Number(balAfter)) - 28) < 0.01,
        `幂等重放后余额只扣一次 28（${balBefore} → ${balAfter}）`);

    /* --- B: 提交后再弃置 → 409，Chat.ets 应识别为 stale --- */
    console.log('\n[B] 状态机单向性：已 committed 再弃置');
    let bErr = null;
    try {
        await hPost(`ai/predictions/${pA.data.prediction_id}/discard`, { reason: 'test' });
    } catch (e) {
        bErr = e;
    }
    ok(bErr instanceof ApiError, '抛出 ApiError');
    ok(bErr?.code === 409, `ApiError.code === 409（实际 ${bErr?.code}）`);
    // 三端统一以 HTTP 409 判定 stale（不再字符串匹配错误文案）：
    // 后端有 3 种 409 文案（idempotency_key 不匹配 / 已弃置无法提交 / 已提交不能弃置），
    // 文案匹配必然漏，状态码判定才是稳定契约。
    ok((bErr?.message || '').length > 0, `409 附带可读文案（"${bErr?.message}"）`);

    /* --- C: 修正后提交 → corrected + final_diff --- */
    console.log('\n[C] 修正路径：corrected + final_diff');
    const pC = await hPost('ai/transactions/parse', {
        text: '打车 32',
        context: { account_id: defaultAccountId, date: todayLocal(), platform: 'harmony' },
        source: 'chat'
    });
    const origC = cloneTxns(pC.data.transactions);
    const candC = cloneTxns(pC.data.transactions);
    ok(isDirty(candC, origC) === false, '未改动时 isDirty=false');

    // 模拟用户改金额：applyEdit → markCorrected
    candC[0].amount = 45.5;
    markCorrected(candC[0], 'amount');
    ok(isDirty(candC, origC) === true, '改金额后 isDirty=true（走 corrected）');
    ok(candC[0].confidence.amount === 1.0, 'markCorrected 把 confidence.amount 置为 1.0');
    ok(candC[0].evidence.amount === 'user_corrected', 'markCorrected 把 evidence.amount 标记 user_corrected');
    ok(origC[0].amount !== 45.5, '原始快照未被污染（深拷贝有效）');

    const cC = await hPost(`ai/predictions/${pC.data.prediction_id}/commit`, {
        action: 'corrected',
        transactions: candC,
        idempotency_key: `harmony-${pC.data.prediction_id}-${Date.now()}`
    });
    ok(cC.success === true, 'commit(corrected) 成功');
    ok(Math.abs(cC.data.transactions[0].amount - 45.5) < 1e-9,
        `落账金额为修正值 45.5（实际 ${cC.data.transactions[0].amount}）`);

    const snapC = await hGet(`ai/predictions/${pC.data.prediction_id}`);
    ok(snapC.data.status === 'committed', 'status → committed');
    const fd = snapC.data.final_diff;
    ok(!!fd, 'final_diff 存在');
    ok(fd?.action === 'corrected', `final_diff.action === corrected（实际 ${fd?.action}）`);
    ok(fd?.corrected_count === 1, `corrected_count === 1（实际 ${fd?.corrected_count}）`);
    ok(Array.isArray(fd?.diff_items) && fd.diff_items.length === 1, 'diff_items 1 项');
    ok(fd?.diff_items?.[0]?.diff?.amount?.to === 45.5,
        `diff.amount.to === 45.5（实际 ${fd?.diff_items?.[0]?.diff?.amount?.to}）`);

    /* --- D: 弃置路径 --- */
    console.log('\n[D] 弃置路径');
    const pD = await hPost('ai/transactions/parse', {
        text: '买咖啡 19',
        context: { account_id: defaultAccountId, date: todayLocal(), platform: 'harmony' },
        source: 'chat'
    });
    const dD = await hPost(`ai/predictions/${pD.data.prediction_id}/discard`, { reason: 'cleared_conversation' });
    ok(dD.success === true, 'discard 成功（清空对话时同步弃置）');
    const snapD = await hGet(`ai/predictions/${pD.data.prediction_id}`);
    ok(snapD.data.status === 'discarded', 'status → discarded');
    let dErr = null;
    try {
        await hPost(`ai/predictions/${pD.data.prediction_id}/commit`, { action: 'confirmed' });
    } catch (e) { dErr = e; }
    ok(dErr?.code === 409, `已 discarded 再提交 → 409（实际 ${dErr?.code}）`);

    /* --- E: 非交易文本 → 422，Chat.ets 应回退 /ai/chat --- */
    console.log('\n[E] 非交易文本：回退判定');
    let eErr = null;
    try {
        await hPost('ai/transactions/parse', {
            text: '你好，帮我分析下这个月的消费结构',
            context: { platform: 'harmony' },
            source: 'chat'
        });
    } catch (e) { eErr = e; }
    ok(eErr instanceof ApiError, '非交易文本抛 ApiError');
    ok(eErr?.code === 422, `ApiError.code === 422（实际 ${eErr?.code}）—— Chat.ets 据此回退 /ai/chat`);
    const fallbackHit = eErr?.code === 422 || (eErr?.message ?? '').indexOf('未能从文本中识别') >= 0;
    ok(fallbackHit, 'tryParseAsTransaction 的回退条件命中，返回 false');

    /* --- F: source 白名单（本轮修掉的后端缺陷回归） --- */
    console.log('\n[F] source 白名单回归');
    let fErr = null;
    try {
        await hPost('ai/transactions/parse', {
            text: '午饭 20',
            context: { account_id: defaultAccountId, platform: 'harmony' },
            source: 'harmony'      // 平台名不是输入通道，必须被拒
        });
    } catch (e) { fErr = e; }
    ok(fErr?.code === 400, `非法 source 返回 400 而非 500（实际 ${fErr?.code}）`);
    ok((fErr?.message ?? '').indexOf('source 必须是') >= 0, `错误文案可读（"${fErr?.message}"）`);

    // Harmony 用的 'chat' 通道必须合法
    const pF = await hPost('ai/transactions/parse', {
        text: '地铁 4 元',
        context: { account_id: defaultAccountId, platform: 'harmony' },
        source: 'chat'
    });
    ok(pF.success === true, "source='chat' 合法（Harmony 实际使用值）");
    await hPost(`ai/predictions/${pF.data.prediction_id}/discard`, { reason: 'cleanup' }).catch(() => {});

    /* --- G: 转账 —— 双账户字段名契约 --- */
    console.log('\n[G] 转账：from_account_id / to_account_id');
    const fresh = (await hGet('accounts')).data.accounts
        .filter((a) => (a.status ?? 'active') !== 'closed')
        .sort((x, y) => Number(y.balance) - Number(x.balance));
    if (fresh.length >= 2) {
        const from = fresh[0];
        const to = fresh.find((a) => a.id !== from.id);
        const pG = await hPost('ai/transactions/parse', {
            text: `从${from.name}转 50 到${to.name}`,
            context: { account_id: from.id, date: todayLocal(), platform: 'harmony' },
            source: 'chat'
        });
        const tG = pG.data.transactions[0];
        ok(tG.type === 'transfer', `类型=transfer（实际 ${tG.type}）`);

        const candG = cloneTxns(pG.data.transactions);
        // 模拟用户在 DropdownField 里补全双账户（setTransferSlot）
        candG[0].from_account_id = from.id;
        candG[0].to_account_id = to.id;
        candG[0].amount = 50;
        ok(precheck(candG) === null, '转账前置自检通过（双账户齐备且不同）');

        // 自检应拦住同账户
        const same = cloneTxns(candG);
        same[0].to_account_id = same[0].from_account_id;
        ok((precheck(same) || '').indexOf('不能相同') >= 0, '自检拦住「转出=转入」');

        const cG = await hPost(`ai/predictions/${pG.data.prediction_id}/commit`, {
            action: isDirty(candG, cloneTxns(pG.data.transactions)) ? 'corrected' : 'confirmed',
            transactions: candG,
            idempotency_key: `harmony-${pG.data.prediction_id}-${Date.now()}`
        });
        ok(cG.success === true, `转账落账成功（${from.name} → ${to.name}）`);
        ok(cG.data.transactions[0].type === 'transfer', '回执 type=transfer（id 是 transfer_id）');
    } else {
        console.log('  - 账户不足 2 个，跳过转账场景');
    }

    /* --- H: 多笔拆分 --- */
    console.log('\n[H] 多笔拆分');
    const pH = await hPost('ai/transactions/parse', {
        text: '早饭 12，午饭 30，晚饭 45',
        context: { account_id: defaultAccountId, date: todayLocal(), platform: 'harmony' },
        source: 'chat'
    });
    ok(pH.data.transactions.length >= 2, `拆出多笔（${pH.data.transactions.length} 笔）`);
    const seqs = pH.data.transactions.map((t) => t.seq);
    ok(new Set(seqs).size === seqs.length, 'seq 唯一（ForEach keyGenerator 依赖）');
    const candH = cloneTxns(pH.data.transactions);
    // 模拟移除一笔（removeCandidate）
    const restH = candH.filter((t) => t.seq !== candH[0].seq);
    ok(isDirty(restH, cloneTxns(pH.data.transactions)) === true, '移除一笔后 isDirty=true');
    ok(precheck(restH) === null, '剩余候选自检通过');
    const cH = await hPost(`ai/predictions/${pH.data.prediction_id}/commit`, {
        action: 'corrected',
        transactions: restH,
        idempotency_key: `harmony-${pH.data.prediction_id}-${Date.now()}`
    });
    ok(cH.data.transactions.length === restH.length,
        `落账笔数=剩余候选数 ${restH.length}（实际 ${cH.data.transactions.length}）`);

    /* --- I: 缺 account_id 时服务端拒绝（客户端自检的兜底） --- */
    console.log('\n[I] account_id 必填');
    const pI = await hPost('ai/transactions/parse', {
        text: '买书 66',
        context: { date: todayLocal(), platform: 'harmony' },   // 故意不给 account_id
        source: 'chat'
    });
    const candI = cloneTxns(pI.data.transactions);
    candI[0].account_id = undefined;
    ok((precheck(candI) || '').indexOf('请选择账户') >= 0, '客户端自检先拦住缺账户（不发请求）');
    await hPost(`ai/predictions/${pI.data.prediction_id}/discard`, { reason: 'cleanup' }).catch(() => {});

    /* --- 汇总 --- */
    console.log(`\n${'='.repeat(60)}`);
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) {
        console.log('\n失败项：');
        failures.forEach((f) => console.log('  - ' + f));
        process.exit(1);
    }
    console.log('Harmony 契约全部通过 ✓\n');
}

main().catch((e) => {
    console.error('\n运行异常：', e.message, e.code ? `(code=${e.code})` : '');
    console.error(e.stack);
    process.exit(1);
});
