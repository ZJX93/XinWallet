/* ============================================
   预测存储（Prediction Store）
   ------------------------------------------------
   核心职责：
   1. 不可变快照写入（status='pending'）
   2. 原子提交（事务内：INSERT 账本 → 关联 → 更新 prediction → 写入反馈）
   3. 幂等（idempotency_key 唯一约束 → 23505 捕获 → 回滚并返回首次结果）
   4. 弃置（discard，记录事件但不下结论）

   ⚠️ commit 复用了现有 routes/ai.js 的落账逻辑：
     - computeAccountBalance + enforceBalanceLimit + syncCreditCardDebt 的副作用
     - 字段映射完全对齐 transactions 表（source_account_id / destination_account_id）
     - 转账三笔链路（transfers + transfer_out + transfer_in）
   ============================================ */

const db = require('../../../db');
const { computeAccountBalance, enforceBalanceLimit } = require('../../../routes/_helpers');
const { syncCreditCardDebt, resolveNote } = require('../../../routes/utils');
const { validateResult } = require('../validation/result-validator');
const { toAmount, toNumber } = require('../../../validate');

/**
 * 创建不可变预测快照。
 * @returns {Promise<number>} prediction_id
 */
async function createPrediction({
    userId, bookId, source, text, context, transactions, validation, decisionTrace,
    memorySnapshot = null, modelRequest = null, modelResponse = null, route = 'local',
}) {
    // ⚠️ 不要手写 RETURNING id：db.js 的 autoReturning() 会在 PG 侧自动追加，
    //    MySQL 侧则依赖原生 insertId。手写会破坏 MySQL 兼容（MySQL 不支持 RETURNING）。
    const ins = await db.query(
        `INSERT INTO ai_predictions
           (user_id, book_id, source, request, candidate_txns, validation, decision_trace,
            memory_snapshot, model_request, model_response, route, prediction_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId, bookId || null, source || 'parse',
            JSON.stringify({ text, context: context || {} }),
            JSON.stringify(transactions),
            JSON.stringify(validation),
            JSON.stringify(decisionTrace || {}),
            JSON.stringify(memorySnapshot || {}),
            modelRequest ? JSON.stringify(modelRequest) : null,
            modelResponse ? JSON.stringify(modelResponse) : null,
            route || 'local',
            (decisionTrace && decisionTrace.prediction_version) || 2,
        ]
    );
    return ins.insertId;
}

/**
 * 获取预测（含所有权检查）。
 * @returns {object|null} prediction 或 null（不存在或非属主）
 */
async function getPrediction(id, userId) {
    const row = await db.queryOne(
        `SELECT * FROM ai_predictions WHERE id = ? AND user_id = ?`,
        [id, userId]
    );
    if (!row) return null;
    // 解 JSONB 列
    row.request = safeParse(row.request, {});
    row.candidate_txns = safeParse(row.candidate_txns, []);
    row.validation = safeParse(row.validation, {});
    row.decision_trace = safeParse(row.decision_trace, {});
    row.final_txns = safeParse(row.final_txns, null);
    row.final_diff = safeParse(row.final_diff, null);
    row.memory_snapshot = safeParse(row.memory_snapshot, {});
    row.model_request = safeParse(row.model_request, null);
    row.model_response = safeParse(row.model_response, null);
    return row;
}

/**
 * 原子提交 —— 事务内完成所有落账操作。
 *
 * @param {number} id        prediction_id
 * @param {number} userId    当前用户
 * @param {number} bookId    当前账本
 * @param {'confirmed'|'corrected'} action
 * @param {Array}  [correctedTxns]   action='corrected' 时用户修正的交易集
 * @param {string} [idempotencyKey] 幂等键
 * @returns {Promise<{status:number, body:object}>} 可直接作为 HTTP 响应的 {status, body}
 */
async function commitPrediction(id, userId, bookId, action, correctedTxns, idempotencyKey) {
    // 幂等键兜底：未传时用 prediction_id 保证单次提交天然幂等
    const idem = idempotencyKey || `pred-${id}`;

    let result;
    try {
        result = await doCommit(id, userId, bookId, action, correctedTxns, idem);
    } catch (err) {
        // 幂等竞态兜底：并发双提交时，后到者在写入 idempotency_key 时触发唯一冲突（23505）。
        // 此时事务已回滚（db.transaction 内部 ROLLBACK），账本无重复写入 —— 这正是我们要的。
        // 改为读取首次提交的结果返回 200，让客户端重试表现为「已成功」而非报错。
        const code = err && (err.code || err.errno);
        const isDup = code === '23505' || code === 1062 /* MySQL ER_DUP_ENTRY */;
        if (isDup) {
            const winner = await db.queryOne(
                `SELECT id, final_txns FROM ai_predictions
                  WHERE idempotency_key = ? AND user_id = ? AND status = 'committed'`,
                [idem, userId]
            );
            if (winner) {
                return {
                    status: 200,
                    body: {
                        message: '已提交（并发幂等返回）',
                        prediction_id: winner.id,
                        transactions: safeParse(winner.final_txns, []),
                    },
                };
            }
        }
        throw err;
    }

    // ⛔ 方案 §11：「Commit 成功后异步触发 Learning/Evidence。
    //    学习失败不得回滚已成功保存的账本。」
    //    ⇒ 必须在【事务之外】、且只在真正首次落账（非幂等重放）时触发。
    //    _learn 由 doCommit 在成功路径上挂载；幂等返回时不带该字段，天然不重复学习。
    if (result && result.status === 200 && result._learn) {
        const payload = result._learn;
        delete result._learn;
        // 不 await：学习是后台增强，不让用户等；异常在内部被吞掉
        setImmediate(() => {
            triggerLearning(payload).catch(err => {
                console.error(`[ai] learning failed for prediction ${payload.predictionId}`, err);
            });
        });
    }

    return result;
}

/** 触发 Evidence Engine（独立函数便于测试直接 await） */
async function triggerLearning(payload) {
    // 懒加载避免循环依赖（evidence-engine → rule-store → 无回环，但保持一致风格）
    const { learnFromCommit } = require('../learning/evidence-engine');
    return learnFromCommit(db, payload);
}

/** commit 的事务主体（被 commitPrediction 包裹以处理幂等竞态） */
async function doCommit(id, userId, bookId, action, correctedTxns, idem) {
    return db.transaction(async (conn) => {
        // 1) 锁行
        const pred = await conn.queryOne(
            `SELECT * FROM ai_predictions WHERE id = ? FOR UPDATE`,
            [id]
        );
        if (!pred) {
            return { status: 404, body: { error: '预测不存在' } };
        }
        if (pred.user_id !== userId) {
            return { status: 404, body: { error: '预测不存在' } }; // 不泄露存在性
        }

        // 2) 幂等检查：已 committed 且 idempotency_key 相同 → 直接返回
        if (pred.status === 'committed' && pred.idempotency_key === idem) {
            const finalTxns = safeParse(pred.final_txns, []);
            return { status: 200, body: { message: '已提交（幂等返回）', prediction_id: id, transactions: finalTxns } };
        }
        if (pred.status === 'committed') {
            return { status: 409, body: { error: '该预测已经被提交，且 idempotency_key 不匹配' } };
        }
        if (pred.status === 'discarded') {
            return { status: 409, body: { error: '该预测已被弃置，无法提交' } };
        }

        // 3) 解析候选交易
        const candidates = safeParse(pred.candidate_txns, []);
        const rawFinal = action === 'corrected' ? (correctedTxns || []) : candidates;

        /*  ⛔ 修正分支必须把候选的 raw_segment 按 seq 补回来（2026-08-25 加）：
            前端提交的修正交易只带用户可编辑的字段（金额/类目/账户/备注），
            【不含】raw_segment —— 那是抽取阶段的原文快照。
            而 evidence-engine.learnableKey 在「无商家」时靠 raw_segment 取学习键；
            拿不到就退到 note，note 又已被 note-composer 规范化成「场景-对象」，
            无商家时会退化成纯类目名（如「其他支出」）⇒ 所有无商家交易共用
            学习键「其他」，规则互相污染、学习静默失效。
            补回是安全的：raw_segment 用户不可编辑，候选里的值就是真相。 */
        const finalTxns = Array.isArray(rawFinal) ? rawFinal.map((t) => {
            if (t && t.raw_segment) return t;
            const orig = candidates.find(c => c.seq === (t && t.seq));
            return (orig && orig.raw_segment) ? { ...t, raw_segment: orig.raw_segment } : t;
        }) : rawFinal;

        if (!Array.isArray(finalTxns) || finalTxns.length === 0) {
            return { status: 422, body: { error: '无有效交易可提交' } };
        }

        // 4) 重跑验证（修正后的交易可能仍不合法）
        const revalidation = validateResult(finalTxns);
        if (revalidation.verdict === 'invalid') {
            return { status: 422, body: { error: '交易数据校验失败', details: revalidation } };
        }

        // 5) 逐笔落账
        const committedTxns = [];
        const diffItems = [];

        for (const txn of finalTxns) {
            // 查找候选中的原始置信度（用于 diff）
            const orig = candidates.find(c => c.seq === txn.seq);

            // 正常交易（income / expense）
            if (txn.type === 'income' || txn.type === 'expense') {
                const amount = toAmount(txn.amount);
                if (amount === null || amount <= 0) {
                    return { status: 422, body: { error: `第${txn.seq}笔金额无效` } };
                }
                const accountId = txn.account_id || null;
                if (!accountId) {
                    return { status: 422, body: { error: `第${txn.seq}笔未指定账户` } };
                }
                // 类目回退：用抽取结果，若为空则按类型查默认类目（其他支出/其他收入）
                let categoryId = txn.category_id || null;
                if (!categoryId) {
                    const fallback = await conn.queryOne(
                        `SELECT id FROM categories WHERE name = ? AND type = ? AND (user_id IS NULL OR user_id = ?) LIMIT 1`,
                        [txn.type === 'expense' ? '其他支出' : '其他收入', txn.type, userId]
                    );
                    categoryId = fallback ? fallback.id : null;
                }
                const date = txn.date || new Date().toISOString().slice(0, 10);
                const note = await resolveNote(conn, userId, categoryId, txn.note, txn.merchant);

                if (!categoryId) {
                    return { status: 422, body: { error: `第${txn.seq}笔无法确定类目` } };
                }

                const ins = await conn.query(
                    `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, source_account_id, destination_account_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, bookId, accountId, categoryId, txn.type, amount, note, date,
                     txn.type === 'expense' ? accountId : null,
                     txn.type === 'income' ? accountId : null]
                );
                const txId = ins.insertId;

                // 余额更新（复用现有副作用）
                const newBal = await computeAccountBalance(conn, userId, accountId);
                await enforceBalanceLimit(conn, userId, accountId, newBal);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBal, accountId]);
                await syncCreditCardDebt(conn, userId, accountId);

                /*  ⚠️ 必须回填 note 与 date：这两个字段在服务端会被改写
                    （note 经 note-composer 规范化成「场景-对象」、date 有默认值兜底），
                    不返回的话前端只能显示自己提交的原值，与真实落账内容不一致。 */
                committedTxns.push({ id: txId, seq: txn.seq, type: txn.type, amount, category_id: categoryId, account_id: accountId, note, date });
            }

            // 转账 —— 需要走 transfer_out + transfer_in 双分录
            else if (txn.type === 'transfer') {
                const fromId = txn.from_account_id || txn.source_account_id;
                const toId = txn.to_account_id || txn.destination_account_id;
                if (!fromId || !toId) {
                    return { status: 422, body: { error: `第${txn.seq}笔转账缺少转出/转入账户` } };
                }
                const amount = toNumber(txn.amount);
                if (amount === null || amount <= 0) {
                    return { status: 422, body: { error: `第${txn.seq}笔转账金额无效` } };
                }
                const note = txn.note || '';
                const date = txn.date || new Date().toISOString().slice(0, 10);

                // 查转账类目 id（与旧 /chat 落账逻辑一致：优先按名称'转账'匹配，避免命中其它 transfer 类目）
                const transferCat = await conn.queryOne(
                    `SELECT id FROM categories WHERE name = '转账' AND type = 'transfer' AND (user_id IS NULL OR user_id = ?) LIMIT 1`,
                    [userId]
                ) || await conn.queryOne(
                    `SELECT id FROM categories WHERE type = 'transfer' AND (user_id IS NULL OR user_id = ?) LIMIT 1`,
                    [userId]
                );
                if (!transferCat) {
                    return { status: 422, body: { error: '系统未配置转账类目' } };
                }

                const ins = await conn.query(
                    `INSERT INTO transfers (user_id, book_id, from_account_id, to_account_id, amount, note, date, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
                    [userId, bookId, fromId, toId, amount, note, date]
                );
                const transferId = ins.insertId;

                // 转出/转入分录（备注措辞与旧 /chat 落账保持一致）
                const fromAcc = await conn.queryOne('SELECT name FROM accounts WHERE id = ?', [fromId]);
                const toAcc = await conn.queryOne('SELECT name FROM accounts WHERE id = ?', [toId]);
                await conn.query(
                    `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                     VALUES (?, ?, ?, ?, 'transfer_out', ?, ?, ?, ?, ?, NULL)`,
                    [userId, bookId, fromId, transferCat.id, amount,
                     `转账至${toAcc ? toAcc.name : '转账'}`, date, transferId, fromId]
                );

                // 转入分录
                await conn.query(
                    `INSERT INTO transactions (user_id, book_id, account_id, category_id, type, amount, note, date, transfer_id, source_account_id, destination_account_id)
                     VALUES (?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, NULL, ?)`,
                    [userId, bookId, toId, transferCat.id, amount,
                     `来自${fromAcc ? fromAcc.name : '转账'}`, date, transferId, toId]
                );

                // 双方余额更新
                const fromBal = await computeAccountBalance(conn, userId, fromId);
                const toBal = await computeAccountBalance(conn, userId, toId);
                await enforceBalanceLimit(conn, userId, fromId, fromBal);
                await enforceBalanceLimit(conn, userId, toId, toBal);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [fromBal, fromId]);
                await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [toBal, toId]);

                committedTxns.push({ id: transferId, seq: txn.seq, type: 'transfer', amount, from_account_id: fromId, to_account_id: toId });
            } else {
                return { status: 422, body: { error: `第${txn.seq}笔交易类型非法（${txn.type}）` } };
            }

            // 计算 diff（供学习使用）
            if (orig) {
                const diff = {};
                for (const key of ['type', 'amount', 'category_id', 'account_id', 'date', 'merchant', 'note']) {
                    if (String(orig[key] ?? '') !== String(txn[key] ?? '')) {
                        diff[key] = { from: orig[key], to: txn[key] };
                    }
                }
                diffItems.push({ seq: txn.seq, diff });
            }
        }

        // 6) 关联 prediction → transactions
        for (const ct of committedTxns) {
            // 对转账，ct.id 是 transfer_id 而非 transaction_id，忽略（不关联到 ai_prediction_transactions）
            if (ct.type === 'transfer') {
                // 转账涉及两条 transactions（transfer_out + transfer_in），但两条的 transfer_id 相同
                // 分别关联
                const txns = await conn.query(
                    `SELECT id FROM transactions WHERE transfer_id = ? ORDER BY id`,
                    [ct.id]
                );
                for (const t of txns) {
                    await conn.query(
                        `INSERT INTO ai_prediction_transactions (prediction_id, transaction_id, seq) VALUES (?, ?, ?)`,
                        [id, t.id, ct.seq]
                    );
                }
            } else {
                await conn.query(
                    `INSERT INTO ai_prediction_transactions (prediction_id, transaction_id, seq) VALUES (?, ?, ?)`,
                    [id, ct.id, ct.seq]
                );
            }
        }

        // 7) 更新 prediction 状态
        const finalTxnsJson = JSON.stringify(finalTxns.map(t => ({
            seq: t.seq, type: t.type, amount: t.amount,
            category_id: t.category_id, account_id: t.account_id || t.from_account_id,
            date: t.date, note: t.note,
        })));
        const finalDiffJson = JSON.stringify({
            action,
            diff_items: diffItems,
            corrected_count: diffItems.length,
        });

        await conn.query(
            `UPDATE ai_predictions
                SET status = 'committed', verdict = ?, final_txns = ?, final_diff = ?,
                    idempotency_key = ?, committed_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [revalidation.verdict, finalTxnsJson, finalDiffJson, idem, id]
        );

        // 8) 写入反馈事件（学习信号）
        const eventType = action === 'confirmed' ? 'explicit_confirmation' : 'explicit_correction';
        const evidenceScore = action === 'confirmed' ? 2 : 6;
        // 从候选交易提取 context（取首笔的 account_id / book_id）
        const firstTxn = finalTxns[0] || {};
        const accountId = firstTxn.account_id || firstTxn.from_account_id || null;

        let feedbackEventId = null;
        try {
            const fbIns = await conn.query(
                `INSERT INTO ai_feedback_events (user_id, book_id, account_id, prediction_id, event_type, evidence_score, payload)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, bookId, accountId, id, eventType, evidenceScore,
                 JSON.stringify({ action, transaction_count: committedTxns.length, corrected: action === 'corrected' })]);
            feedbackEventId = fbIns.insertId;
        } catch (_) {
            // 学习类写入失败不回滚已落账数据（只记日志，后续由 cron 兜底）
            console.error(`[ai] feedback event insert failed for prediction ${id}`, _);
        }

        // 9) 幂等竞态由外层 commitPrediction() 捕获 23505/1062 处理（见上方 catch），
        //    事务回滚保证账本无重复写入，客户端重试会拿到首次提交结果。

        // 10) 学习载荷 —— ⛔ 只作为返回值传出，【绝不在事务内执行学习】。
        //     外层 commitPrediction 在事务提交后用 setImmediate 异步触发（方案 §11）。
        //     matched_rule_ids 从 decision_trace 里取：那是 parse 当时真实命中的规则。
        const trace = safeParse(pred.decision_trace, {});
        const matchedRuleIds = (trace.memory && trace.memory.matched_rule_ids) || [];

        return {
            status: 200,
            body: { message: '提交成功', prediction_id: id, transactions: committedTxns },
            _learn: {
                userId, bookId, predictionId: id, feedbackEventId, action,
                candidateTxns: candidates, finalTxns, matchedRuleIds,
            },
        };
    });
}

/**
 * 弃置预测（不形成负面学习）。
 */
async function discardPrediction(id, userId, bookId, reason) {
    const pred = await db.queryOne(`SELECT * FROM ai_predictions WHERE id = ? AND user_id = ?`, [id, userId]);
    if (!pred) return { status: 404, body: { error: '预测不存在' } };
    if (pred.status === 'committed') return { status: 409, body: { error: '已提交的预测不能弃置' } };
    if (pred.status === 'discarded') return { status: 200, body: { message: '已弃置（幂等）' } };

    // 不包裹在事务中——discard 不涉及账本写入，写入失败可重试
    try {
        const candidates = safeParse(pred.candidate_txns, []);
        const firstTxn = candidates[0] || {};
        const accountId = firstTxn.account_id || null;

        await db.query(
            `INSERT INTO ai_feedback_events (user_id, book_id, account_id, prediction_id, event_type, evidence_score, payload)
             VALUES (?, ?, ?, ?, 'discard', 0, ?)`,
            [userId, bookId, accountId, id, JSON.stringify({ reason: reason || '', source: 'user_discard' })]
        );
    } catch (_) {
        console.error(`[ai] discard feedback event failed for prediction ${id}`, _);
    }

    await db.query(`UPDATE ai_predictions SET status = 'discarded' WHERE id = ?`, [id]);
    return { status: 200, body: { message: '已弃置' } };
}

function safeParse(val, fallback) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = { createPrediction, getPrediction, commitPrediction, discardPrediction, triggerLearning };