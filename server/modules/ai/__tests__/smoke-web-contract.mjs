/**
 * web 端 v0.2 接入契约验证
 * ----------------------------------------------------------------
 * 复现 ai-smart-entry.js 的真实调用序列，验证前端假设与后端契约一致：
 *   1. parse 响应字段名（prediction_id / transactions / needs_confirmation / overall_confidence）
 *   2. GET /predictions/:id 的 validation.per_txn[].per_field 结构（前端据此做字段级高亮）
 *   3. action='confirmed' 不回传 transactions 也能落账
 *   4. action='corrected' 回传修正后 transactions，final_diff 正确记录
 *   5. idempotency_key 重放不二次落账
 *   6. discard 链路
 *   7. 转账候选的 from/to 账户字段名
 * 用法：node server/modules/ai/__tests__/smoke-web-contract.mjs
 */

const BASE = process.env.BASE || 'http://127.0.0.1:18888';
let token = null;
let bookId = null;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, extra) {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else {
        fail++; failures.push(label);
        console.log(`  ❌ ${label}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
    }
}

async function call(path, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (bookId) headers['X-Book-Id'] = String(bookId);
    const res = await fetch(`${BASE}/api${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { json = { success: false, message: 'non-json' }; }
    return { status: res.status, json };
}

// 模拟前端 api()：只返回 data.data，失败抛出并挂 payload
async function api(path, method = 'GET', body = null) {
    const r = await call(path, method, body);
    if (!r.json.success) {
        const err = new Error(r.json.message || `HTTP ${r.status}`);
        err.payload = r.json; err.status = r.status;
        throw err;
    }
    return r.json.data;
}

// ===== 复刻 ai-smart-entry.js 的 _isDirty 判定 =====
function isDirty(items, original) {
    if (items.length !== original.length) return true;
    const KEYS = ['type', 'amount', 'category_id', 'account_id',
                  'from_account_id', 'to_account_id', 'date', 'note'];
    for (let i = 0; i < items.length; i++) {
        const a = items[i], b = original[i];
        if (!b || a.seq !== b.seq) return true;
        for (const k of KEYS) {
            const av = a[k] == null ? null : a[k];
            const bv = b[k] == null ? null : b[k];
            if (k === 'amount') {
                if (Math.abs(Number(av || 0) - Number(bv || 0)) > 1e-9) return true;
            } else if (String(av) !== String(bv)) return true;
        }
    }
    return false;
}

function newIdemKey(pid) {
    return `web-${pid}-${Math.random().toString(36).slice(2)}`.slice(0, 64);
}

async function main() {
    console.log('\n=== web 端 v0.2 接入契约验证 ===\n');

    // ---------- 登录 ----------
    console.log('[0] 演示登录');
    const login = await call('/auth/demo', 'POST');
    ok(login.json.success, '演示登录成功', login.json);
    token = login.json.data && login.json.data.token;
    ok(!!token, '拿到 token');

    const books = await api('/books');
    const bookList = books.books || books;
    bookId = Array.isArray(bookList) && bookList.length ? bookList[0].id : null;
    ok(!!bookId, `拿到 book_id=${bookId}`);

    const accData = await api('/accounts');
    const accounts = accData.accounts || accData;
    ok(Array.isArray(accounts) && accounts.length > 0, `账户数=${accounts.length}`);
    // 挑余额最充足的非信用卡账户：账户余额保护（不得低于 0）是正确的业务行为，
    // 反复跑测试会耗尽小额账户，取 accounts[0] 会撞出与被测逻辑无关的 409。
    const defAcc = accounts
        .filter(a => a.type !== 'credit_card' && (a.status ?? 'active') !== 'closed')
        .sort((x, y) => Number(y.balance) - Number(x.balance))[0] || accounts[0];

    const cats = await api('/categories?flat=1');
    ok(Array.isArray(cats) && cats.length > 0, `分类数=${cats.length}`);

    const balBefore = Number(defAcc.balance);
    console.log(`  ℹ️  默认账户「${defAcc.name}」余额=${balBefore}`);

    // ---------- 场景 A：ready 直接确认（不回传 transactions） ----------
    console.log('\n[A] 单笔 · confirmed（不回传 transactions）');
    const ctx = { account_id: defAcc.id, date: new Date().toISOString().slice(0, 10) };
    const pA = await api('/ai/transactions/parse', 'POST',
        { text: '星巴克咖啡35.5', context: ctx, source: 'parse' });

    ok(typeof pA.prediction_id === 'number', 'parse 返回 prediction_id', pA.prediction_id);
    ok(Array.isArray(pA.transactions), 'parse 返回 transactions 数组');
    ok(typeof pA.needs_confirmation === 'boolean', 'parse 返回 needs_confirmation');
    ok('overall_confidence' in pA, 'parse 返回 overall_confidence（非 overall）');
    ok(['ready', 'needs_confirmation'].includes(pA.verdict), `verdict=${pA.verdict}`);

    const tA = pA.transactions[0];
    ok(typeof tA.seq === 'number' && tA.seq === 1, 'candidate.seq 从 1 开始');
    ok(Number(tA.amount) > 0, `candidate.amount=${tA.amount} > 0`);
    ok('category_id' in tA, 'candidate 含 category_id（前端无需按名猜 ID）');
    ok('category_name' in tA, 'candidate 含 category_name');
    ok(tA.account_id === defAcc.id, 'context.account_id 被带入 candidate');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(tA.date), `candidate.date 为 10 字符纯日期: ${tA.date}`);
    ok(tA.confidence && typeof tA.confidence.amount === 'number', 'candidate.confidence 字段级存在');
    ok(tA.evidence && typeof tA.evidence.amount === 'string', 'candidate.evidence 字段级存在');

    // 前端 _isDirty=false ⇒ action=confirmed
    const dirtyA = isDirty(JSON.parse(JSON.stringify(pA.transactions)), pA.transactions);
    ok(dirtyA === false, '_isDirty 对未修改判定为 false');

    const cA = await api(`/ai/predictions/${pA.prediction_id}/commit`, 'POST',
        { action: 'confirmed', idempotency_key: newIdemKey(pA.prediction_id) });
    ok(Array.isArray(cA.transactions) && cA.transactions.length === 1, 'confirmed 落账 1 笔');
    ok(typeof cA.transactions[0].id === 'number', '落账结果含交易 id');

    // ---------- 场景 B：GET 快照 + validation.per_field 结构 ----------
    console.log('\n[B] GET 预测快照（前端字段级高亮数据源）');
    const gB = await api(`/ai/predictions/${pA.prediction_id}`);
    ok(gB.status === 'committed', `快照 status=${gB.status}`);
    ok(Array.isArray(gB.transactions), 'GET 用 transactions 键（非 candidate_txns）');
    ok(gB.validation && typeof gB.validation === 'object', 'GET 返回 validation');
    ok(Array.isArray(gB.validation.per_txn), 'validation.per_txn 是数组');
    const pf = gB.validation.per_txn[0] && gB.validation.per_txn[0].per_field;
    ok(pf && typeof pf === 'object', 'per_txn[0].per_field 存在');
    if (pf) {
        for (const f of ['amount', 'type', 'category', 'date']) {
            ok(pf[f] && typeof pf[f].score === 'number'
                && typeof pf[f].threshold === 'number'
                && typeof pf[f].ok === 'boolean',
                `per_field.${f} 含 {score,threshold,ok}`, pf[f]);
        }
    }
    ok(gB.validation.thresholds && typeof gB.validation.thresholds.amount === 'number',
        'validation.thresholds 存在');
    ok(gB.final_txns !== null, '已提交快照 final_txns 非空');

    // ---------- 场景 C：corrected（修正金额与分类） ----------
    console.log('\n[C] 单笔 · corrected（修正金额）');
    const pC = await api('/ai/transactions/parse', 'POST',
        { text: '午饭28', context: ctx, source: 'parse' });
    const origC = JSON.parse(JSON.stringify(pC.transactions));
    const itemsC = JSON.parse(JSON.stringify(pC.transactions));

    itemsC[0].amount = 33.5;
    // 复刻前端 _markCorrected：人工修正 ⇒ 置信度 1.0 + evidence 标记
    itemsC[0].confidence = { ...(itemsC[0].confidence || {}), amount: 1.0 };
    itemsC[0].evidence = { ...(itemsC[0].evidence || {}), amount: 'user_corrected' };
    if (!itemsC[0].account_id) itemsC[0].account_id = defAcc.id;

    ok(isDirty(itemsC, origC) === true, '_isDirty 对修改后判定为 true');

    const cC = await api(`/ai/predictions/${pC.prediction_id}/commit`, 'POST',
        { action: 'corrected', transactions: itemsC, idempotency_key: newIdemKey(pC.prediction_id) });
    ok(cC.transactions.length === 1, 'corrected 落账 1 笔');
    ok(Math.abs(Number(cC.transactions[0].amount) - 33.5) < 1e-9,
        `落账金额为修正值 33.5`, cC.transactions[0].amount);

    const gC = await api(`/ai/predictions/${pC.prediction_id}`);
    // final_diff 真实结构：{ action, corrected_count, diff_items:[{ seq, diff:{ field:{from,to} } }] }
    ok(gC.final_diff && gC.final_diff.action === 'corrected',
        'final_diff.action = corrected', gC.final_diff);
    ok(gC.final_diff && Array.isArray(gC.final_diff.diff_items) && gC.final_diff.diff_items.length === 1,
        'final_diff.diff_items 含 1 项', gC.final_diff && gC.final_diff.diff_items);
    const dItem = gC.final_diff && gC.final_diff.diff_items && gC.final_diff.diff_items[0];
    ok(dItem && dItem.seq === 1, 'diff_items[0].seq = 1', dItem);
    ok(dItem && dItem.diff && dItem.diff.amount,
        'diff_items[0].diff 记录了 amount 变更', dItem && dItem.diff);
    if (dItem && dItem.diff && dItem.diff.amount) {
        ok(Math.abs(Number(dItem.diff.amount.from) - 28) < 1e-9,
            'diff.amount.from = 28（原始快照值）', dItem.diff.amount);
        ok(Math.abs(Number(dItem.diff.amount.to) - 33.5) < 1e-9,
            'diff.amount.to = 33.5（用户修正值）', dItem.diff.amount);
    }
    ok(gC.final_diff && gC.final_diff.corrected_count === 1,
        'final_diff.corrected_count = 1', gC.final_diff && gC.final_diff.corrected_count);

    // ---------- 场景 D：幂等重放 ----------
    console.log('\n[D] 幂等重放（网络重试不二次落账）');
    const pD = await api('/ai/transactions/parse', 'POST',
        { text: '打车18', context: ctx, source: 'parse' });
    const keyD = newIdemKey(pD.prediction_id);
    const d1 = await api(`/ai/predictions/${pD.prediction_id}/commit`, 'POST',
        { action: 'confirmed', idempotency_key: keyD });
    const accMid = await api('/accounts');
    const balMid = Number((accMid.accounts || accMid).find(a => a.id === defAcc.id).balance);

    const d2 = await api(`/ai/predictions/${pD.prediction_id}/commit`, 'POST',
        { action: 'confirmed', idempotency_key: keyD });
    ok(/幂等/.test(d2.message || ''), `重放返回幂等提示: ${d2.message}`);

    const accAfter2 = await api('/accounts');
    const balAfter2 = Number((accAfter2.accounts || accAfter2).find(a => a.id === defAcc.id).balance);
    ok(Math.abs(balMid - balAfter2) < 1e-9, '幂等重放余额未二次变动', { balMid, balAfter2 });

    // 不同 key 提交已提交预测 → 409
    let conflict = null;
    try {
        await api(`/ai/predictions/${pD.prediction_id}/commit`, 'POST',
            { action: 'confirmed', idempotency_key: newIdemKey(pD.prediction_id) + 'x' });
    } catch (e) { conflict = e; }
    ok(conflict && conflict.status === 409, '不同 key 重复提交返回 409', conflict && conflict.status);
    ok(conflict && /已经被提交/.test(conflict.payload.message),
        '409 文案含「已经被提交」（前端据此重置）', conflict && conflict.payload.message);

    // ---------- 场景 E：多笔拆分 ----------
    console.log('\n[E] 多笔拆分');
    const pE = await api('/ai/transactions/parse', 'POST',
        { text: '早餐12，打车25，午饭38', context: ctx, source: 'parse' });
    ok(pE.transactions.length === 3, `拆出 3 笔，实际 ${pE.transactions.length}`);
    const seqs = pE.transactions.map(t => t.seq);
    ok(JSON.stringify(seqs) === '[1,2,3]', `seq 连续 [1,2,3]，实际 ${JSON.stringify(seqs)}`);
    const cE = await api(`/ai/predictions/${pE.prediction_id}/commit`, 'POST',
        { action: 'confirmed', idempotency_key: newIdemKey(pE.prediction_id) });
    ok(cE.transactions.length === 3, '3 笔全部落账');

    // ---------- 场景 F：discard ----------
    console.log('\n[F] 弃置');
    const pF = await api('/ai/transactions/parse', 'POST',
        { text: '奶茶19', context: ctx, source: 'parse' });
    const accBeforeF = await api('/accounts');
    const balBeforeF = Number((accBeforeF.accounts || accBeforeF).find(a => a.id === defAcc.id).balance);
    const dF = await api(`/ai/predictions/${pF.prediction_id}/discard`, 'POST',
        { reason: 'user_discarded' });
    ok(/已弃置/.test(dF.message || ''), `discard 返回: ${dF.message}`);
    const accAfterF = await api('/accounts');
    const balAfterF = Number((accAfterF.accounts || accAfterF).find(a => a.id === defAcc.id).balance);
    ok(Math.abs(balBeforeF - balAfterF) < 1e-9, '弃置不影响余额');

    let discardCommit = null;
    try {
        await api(`/ai/predictions/${pF.prediction_id}/commit`, 'POST', { action: 'confirmed' });
    } catch (e) { discardCommit = e; }
    ok(discardCommit && discardCommit.status === 409, '提交已弃置预测返回 409');
    ok(discardCommit && /已被弃置/.test(discardCommit.payload.message),
        '409 文案含「已被弃置」', discardCommit && discardCommit.payload.message);

    // ---------- 场景 G：错误分支 ----------
    console.log('\n[G] 错误分支（前端提示文案依据）');
    let e422 = null;
    try {
        await api('/ai/transactions/parse', 'POST', { text: '今天天气不错', context: ctx });
    } catch (e) { e422 = e; }
    ok(e422 && e422.status === 422, '无金额文本返回 422', e422 && e422.status);
    ok(e422 && /未能从文本中识别/.test(e422.payload.message),
        '422 文案匹配前端引导判断条件', e422 && e422.payload.message);

    let e400 = null;
    try { await api('/ai/transactions/parse', 'POST', { text: '' }); } catch (e) { e400 = e; }
    ok(e400 && e400.status === 400, '空文本返回 400');

    let e404 = null;
    try { await api('/ai/predictions/99999999'); } catch (e) { e404 = e; }
    ok(e404 && e404.status === 404, '不存在的预测返回 404');

    let eAct = null;
    try {
        const pG = await api('/ai/transactions/parse', 'POST', { text: '测试9.9', context: ctx });
        await api(`/ai/predictions/${pG.prediction_id}/commit`, 'POST', { action: 'bogus' });
    } catch (e) { eAct = e; }
    ok(eAct && eAct.status === 400, '非法 action 返回 400');

    // 回归：source 是【输入通道】枚举，非法值必须在入口被拦成 400，
    // 而不是落到 INSERT 撞 ai_predictions_source_check 抛 500
    let eSrc = null;
    try {
        await api('/ai/transactions/parse', 'POST',
            { text: '咖啡20', context: ctx, source: 'web_text' });
    } catch (e) { eSrc = e; }
    ok(eSrc && eSrc.status === 400, '非法 source 返回 400（非 500）', eSrc && eSrc.status);
    ok(eSrc && /source 必须是/.test(eSrc.payload.message),
        '非法 source 文案明确', eSrc && eSrc.payload.message);

    // 四个合法通道均可写入（三端分别会用到 parse / chat / ocr / voice）
    for (const s of ['parse', 'chat', 'ocr', 'voice']) {
        const pS = await api('/ai/transactions/parse', 'POST',
            { text: '咖啡20', context: ctx, source: s });
        ok(typeof pS.prediction_id === 'number', `source='${s}' 可正常创建预测`);
        await api(`/ai/predictions/${pS.prediction_id}/discard`, 'POST', { reason: 'test_cleanup' });
    }

    // ---------- 场景 H：转账字段名 ----------
    console.log('\n[H] 转账候选字段名（前端 from/to 下拉依据）');
    // 重新拉账户：前面场景已改变余额；转出账户须挑余额最充足的，
    // 否则会撞账户余额保护（该保护是正确业务行为，不应被测试绕过）
    const accH = await api('/accounts');
    const accListH = (accH.accounts || accH).slice()
        .sort((a, b) => Number(b.balance) - Number(a.balance));
    const richest = accListH[0];
    const target = accListH.find(a => a.id !== richest.id);

    if (accListH.length >= 2 && Number(richest.balance) > 100) {
        const pH = await api('/ai/transactions/parse', 'POST',
            { text: '从工资卡转账50到余额宝', context: ctx, source: 'parse' });
        const tH = pH.transactions.find(t => t.type === 'transfer');
        if (tH) {
            const itemsH = JSON.parse(JSON.stringify(pH.transactions));
            const idx = itemsH.findIndex(t => t.type === 'transfer');
            itemsH[idx].from_account_id = richest.id;
            itemsH[idx].to_account_id = target.id;
            itemsH[idx].amount = 50;
            const cH = await api(`/ai/predictions/${pH.prediction_id}/commit`, 'POST',
                { action: 'corrected', transactions: itemsH, idempotency_key: newIdemKey(pH.prediction_id) });
            const tr = cH.transactions.find(t => t.type === 'transfer');
            ok(!!tr, '转账落账成功');
            if (tr) {
                ok('from_account_id' in tr && 'to_account_id' in tr,
                    '转账结果用 from_account_id / to_account_id', Object.keys(tr));
            }
        } else {
            console.log('  ℹ️  该文本未被识别为转账（抽取器能力范围），跳过转账断言');
            await api(`/ai/predictions/${pH.prediction_id}/discard`, 'POST', { reason: 'test_cleanup' });
        }
    } else {
        console.log('  ℹ️  账户不足或余额不足，跳过转账场景');
    }

    // ---------- 汇总 ----------
    console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
    if (fail) {
        console.log('失败项：');
        failures.forEach(f => console.log('  - ' + f));
        process.exit(1);
    }
    console.log('✅ web 端接入契约全部验证通过\n');
}

main().catch(e => {
    console.error('\n💥 验证脚本异常:', e.message);
    if (e.payload) console.error('payload:', JSON.stringify(e.payload));
    console.error(e.stack);
    process.exit(1);
});
