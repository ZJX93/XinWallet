/* AI v0.2 Phase 1 端到端 smoke 测试 */
const BASE = 'http://127.0.0.1:18888';
// 幂等键必须每轮唯一：硬编码常量会让第二次运行命中上一轮的幂等记录，
// 后端正确返回历史快照（无 id、余额不再变动），而断言按「首次落账」写 → 假失败。
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let TOKEN = '', BOOK = '', pass = 0, fail = 0;

function ok(cond, label, extra) {
    if (cond) { pass++; console.log(`  OK   ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${extra ? '  → ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

async function api(method, path, body, hdrs = {}) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
            ...(BOOK ? { 'X-Book-Id': String(BOOK) } : {}),
            ...hdrs,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, json };
}

(async () => {
    // ---- 0) 登录 + 取账本/账户 ----
    console.log('\n[0] 准备：登录 / 账本 / 账户');
    const login = await api('POST', '/api/auth/demo');
    TOKEN = login.json?.data?.token || '';
    ok(!!TOKEN, 'demo 登录取得 token');

    const books = await api('GET', '/api/books');
    const bookList = books.json?.data?.books || books.json?.data || [];
    BOOK = Array.isArray(bookList) ? bookList[0]?.id : null;
    ok(!!BOOK, `取得账本 id=${BOOK}`);

    // 注意：必须在 BOOK 赋值之后再查账户，否则请求缺 X-Book-Id 头会返回空列表
    const accs = await api('GET', '/api/accounts');
    const accList = accs.json?.data?.accounts || [];
    const acc = accList
        .filter(a => a.type !== 'credit_card')
        .sort((x, y) => parseFloat(y.balance) - parseFloat(x.balance))[0] || accList[0];
    ok(!!acc, `取得账户 id=${acc?.id} (${acc?.name})`);
    const accountId = acc?.id;

    // 记录初始余额，用于验证落账副作用
    const balBefore = parseFloat(acc?.balance ?? 0);

    // ---- 1) parse：清晰输入应 ready ----
    console.log('\n[1] parse：清晰单笔（应 ready）');
    const p1 = await api('POST', '/api/ai/transactions/parse', {
        text: '昨天星巴克花了35.5元',
        context: { account_id: accountId },
    });
    ok(p1.status === 200, `HTTP 200 (实际 ${p1.status})`, p1.json);
    const d1 = p1.json?.data;
    ok(d1?.prediction_id > 0, `prediction_id=${d1?.prediction_id}`);
    ok(d1?.verdict === 'ready', `verdict=ready (实际 ${d1?.verdict})`);
    ok(d1?.needs_confirmation === false, 'needs_confirmation=false');
    ok(d1?.transactions?.length === 1, `1 笔交易 (实际 ${d1?.transactions?.length})`);
    const t1 = d1?.transactions?.[0];
    ok(t1?.amount === 35.5, `金额 35.5 (实际 ${t1?.amount})`);
    ok(t1?.type === 'expense', `类型 expense (实际 ${t1?.type})`);
    ok(!!t1?.confidence?.amount, `字段级置信度存在: ${JSON.stringify(t1?.confidence)}`);
    const pid1 = d1?.prediction_id;

    // ---- 2) GET 预测：应含证据链 ----
    console.log('\n[2] GET 预测快照（证据链可见）');
    const g1 = await api('GET', `/api/ai/predictions/${pid1}`);
    ok(g1.status === 200, `HTTP 200 (实际 ${g1.status})`);
    ok(g1.json?.data?.status === 'pending', `status=pending (实际 ${g1.json?.data?.status})`);
    ok(!!g1.json?.data?.decision_trace?.engine, `decision_trace.engine=${g1.json?.data?.decision_trace?.engine}`);
    ok(!!g1.json?.data?.decision_trace?.thresholds, 'decision_trace 含阈值');

    // ---- 3) 越权访问：别人的预测应 404 ----
    console.log('\n[3] 安全：不存在/越权的预测应 404');
    const g404 = await api('GET', '/api/ai/predictions/999999');
    ok(g404.status === 404, `HTTP 404 (实际 ${g404.status})`);

    // ---- 4) commit：原子落账 ----
    console.log('\n[4] commit：原子落账（confirmed）');
    const c1 = await api('POST', `/api/ai/predictions/${pid1}/commit`, {
        action: 'confirmed',
        idempotency_key: `smoke-${RUN_ID}-A`,
    });
    ok(c1.status === 200, `HTTP 200 (实际 ${c1.status})`, c1.json);
    const committed = c1.json?.data?.transactions || [];
    ok(committed.length === 1, `落账 1 笔 (实际 ${committed.length})`);
    ok(committed[0]?.id > 0, `transaction_id=${committed[0]?.id}`);

    // 验证账本真的多了这条交易（按 id 直查，避免列表排序/分页干扰：
    // 该笔日期是「昨天」，按日期倒序的前几条可能取不到它）
    const txnOne = await api('GET', `/api/transactions/${committed[0]?.id}`);
    const gotTxn = txnOne.json?.data;
    ok(txnOne.status === 200 && parseFloat(gotTxn?.amount) === 35.5,
       `新交易可按 id 查到且金额正确 (id=${committed[0]?.id}, amount=${gotTxn?.amount})`);

    // 验证余额变化（支出 35.5 → 余额应减少）
    const accs2 = await api('GET', '/api/accounts');
    const acc2 = (accs2.json?.data?.accounts || []).find(a => a.id === accountId);
    const balAfter = parseFloat(acc2?.balance ?? 0);
    ok(Math.abs((balBefore - balAfter) - 35.5) < 0.01,
       `余额减少 35.5 (${balBefore} → ${balAfter})`);

    // ---- 5) 幂等重放：同 key 再 commit 应返回相同结果、不重复落账 ----
    console.log('\n[5] 幂等：同 idempotency_key 重放');
    const c2 = await api('POST', `/api/ai/predictions/${pid1}/commit`, {
        action: 'confirmed',
        idempotency_key: `smoke-${RUN_ID}-A`,
    });
    ok(c2.status === 200, `HTTP 200 (实际 ${c2.status})`);
    ok(/幂等/.test(c2.json?.data?.message || ''), `消息含"幂等": ${c2.json?.data?.message}`);

    // 余额不应再变（无重复落账）
    const accs3 = await api('GET', '/api/accounts');
    const bal3 = parseFloat((accs3.json?.data?.accounts || []).find(a => a.id === accountId)?.balance ?? 0);
    ok(Math.abs(bal3 - balAfter) < 0.01, `余额未再变化（无重复落账）: ${bal3}`);

    // ---- 6) 不同 key 提交已提交预测 → 409 ----
    console.log('\n[6] 冲突：已提交预测用不同 key → 409');
    const c3 = await api('POST', `/api/ai/predictions/${pid1}/commit`, {
        action: 'confirmed',
        idempotency_key: `smoke-${RUN_ID}-DIFFERENT`,
    });
    ok(c3.status === 409, `HTTP 409 (实际 ${c3.status})`, c3.json);

    // ---- 7) 多笔拆分 ----
    console.log('\n[7] parse：多笔拆分');
    const p2 = await api('POST', '/api/ai/transactions/parse', {
        text: '早饭12元，打车30元，午饭25元',
        context: { account_id: accountId },
    });
    ok(p2.status === 200, `HTTP 200 (实际 ${p2.status})`);
    ok(p2.json?.data?.transactions?.length === 3, `拆出 3 笔 (实际 ${p2.json?.data?.transactions?.length})`);
    const pid2 = p2.json?.data?.prediction_id;

    // ---- 8) corrected 提交（用户修正金额）----
    console.log('\n[8] commit：corrected（用户修正）');
    const orig = p2.json?.data?.transactions || [];
    const corrected = orig.map((t, i) => ({ ...t, amount: i === 0 ? 15 : t.amount, account_id: accountId }));
    const c4 = await api('POST', `/api/ai/predictions/${pid2}/commit`, {
        action: 'corrected',
        transactions: corrected,
    });
    ok(c4.status === 200, `HTTP 200 (实际 ${c4.status})`, c4.json);
    ok(c4.json?.data?.transactions?.length === 3, `落账 3 笔 (实际 ${c4.json?.data?.transactions?.length})`);

    // 验证 final_diff 记录了修正
    const g2 = await api('GET', `/api/ai/predictions/${pid2}`);
    const diffItems = g2.json?.data?.final_diff?.diff_items || [];
    const hasAmountDiff = diffItems.some(d => d.diff?.amount);
    ok(hasAmountDiff, `final_diff 记录了金额修正: ${JSON.stringify(diffItems.find(d => d.diff?.amount)?.diff)}`);
    ok(g2.json?.data?.final_diff?.action === 'corrected', 'final_diff.action=corrected');

    // ---- 9) discard ----
    console.log('\n[9] discard：弃置预测');
    const p3 = await api('POST', '/api/ai/transactions/parse', {
        text: '买东西50', context: { account_id: accountId },
    });
    const pid3 = p3.json?.data?.prediction_id;
    ok(p3.json?.data?.verdict === 'needs_confirmation',
       `模糊输入 verdict=needs_confirmation (实际 ${p3.json?.data?.verdict})`);
    const dc = await api('POST', `/api/ai/predictions/${pid3}/discard`, { reason: 'smoke test' });
    ok(dc.status === 200, `HTTP 200 (实际 ${dc.status})`);
    const g3 = await api('GET', `/api/ai/predictions/${pid3}`);
    ok(g3.json?.data?.status === 'discarded', `status=discarded (实际 ${g3.json?.data?.status})`);

    // 已弃置不能提交
    const c5 = await api('POST', `/api/ai/predictions/${pid3}/commit`, { action: 'confirmed' });
    ok(c5.status === 409, `已弃置预测提交 → 409 (实际 ${c5.status})`);

    // ---- 10) 参数校验 ----
    console.log('\n[10] 参数校验');
    const e1 = await api('POST', '/api/ai/transactions/parse', { text: '' });
    ok(e1.status === 400, `空文本 → 400 (实际 ${e1.status})`);
    const e2 = await api('POST', '/api/ai/transactions/parse', { text: '今天天气不错' });
    ok(e2.status === 422, `无交易信息 → 422 (实际 ${e2.status})`, e2.json);
    const e3 = await api('POST', `/api/ai/predictions/${pid1}/commit`, { action: 'bogus' });
    ok(e3.status === 400, `非法 action → 400 (实际 ${e3.status})`);

    console.log(`\n${'='.repeat(50)}`);
    console.log(`结果: ${pass} 通过 / ${fail} 失败`);
    console.log(fail === 0 ? 'SMOKE_ALL_PASS' : 'SMOKE_HAS_FAILURES');
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('SMOKE_CRASH:', e); process.exit(2); });
