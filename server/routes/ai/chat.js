/* ============================================
   AI 对话（/chat）：工具调用循环 + 写操作确认卡 + 回复润色
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, db, success, fail, handleServerError, aiModule, getActiveProvider, checkProvider, chatWithTools, fmtDateTime, stripThinkingTokens, polishChatReply, toAmount, syncCreditCardDebt, computeAccountBalance, enforceBalanceLimit } = require('./_shared');
const router = express.Router();
router.post('/chat', async (req, res) => {
    try {
        const { messages, image, mime } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json(fail('消息不能为空'));
        const provider = await getActiveProvider(req.userId);
        if (!checkProvider(res, provider)) return;

        // 取用户类目与账户作为工具参考
        const cats = await db.query(
            `SELECT c.id, c.name, c.type, c.icon FROM categories c WHERE (c.user_id IS NULL OR (c.user_id = ? AND (c.book_id IS NULL OR c.book_id = ?))) ORDER BY c.type, c.sort_order`,
            [req.userId, req.bookId]
        );
        const accounts = await db.query(
            `SELECT id, name, icon, type FROM accounts WHERE user_id = ? AND book_id = ? AND status = 'active' ORDER BY sort_order`,
            [req.userId, req.bookId]
        );
        const transferCat = await db.queryOne("SELECT id FROM categories WHERE name='转账' AND type='transfer' AND (user_id IS NULL OR user_id=?) LIMIT 1", [req.userId]) || { id: 22 };

        const catRef = cats.length === 0
            ? '（空 — 当前账本没有可用类目，请提示用户去 App「分类管理」检查）'
            : cats.map(c => `- [${c.id}] ${c.name}（${c.type}${c.icon ? ' ' + c.icon : ''}）`).join('\n');
        const accRef = accounts.length === 0
            ? '（空 — 当前账本没有可用账户，请提示用户去 App「账户管理」检查）'
            : accounts.map(a => `- [${a.id}] ${a.name}（${a.type}${a.icon ? ' ' + a.icon : ''}）`).join('\n');

        // 归一化客户端消息：user 消息可携带 imageBase64
        const norm = messages.map(m => {
            if (m.role === 'user' && m.imageBase64) {
                return { role: 'user', content: [{ type: 'text', text: m.content || '' }, { type: 'image', mime: m.mime || 'image/jpeg', data: m.imageBase64 }] };
            }
            return { role: m.role, content: m.content };
        });
        // 顶层 image（可选）附加到最后一条 user 消息
        if (image) {
            const lastUser = [...norm].reverse().find(m => m.role === 'user');
            if (lastUser) {
                lastUser.content = Array.isArray(lastUser.content) ? lastUser.content : [{ type: 'text', text: lastUser.content || '' }];
                lastUser.content.push({ type: 'image', mime: mime || 'image/jpeg', data: image });
            }
        }

        const system = `你是「小鑫」，「鑫钱包」App 的 AI 记账助手，帮助用户查账、改账、答疑。
规则：
1. 只处理与记账/查账相关的请求；无关的礼貌拒绝。
2. 信息不全（金额或收支方向）时用一句中文追问，不要臆造。
3. ⛔ **你没有「新建交易」的能力**。本对话里不存在 create_transaction / create_transfer 工具。
   用户说「记一笔 / 帮我记账 / 花了多少」这类**新建**需求时，回复引导他用「智能记账」入口
   （输入框旁的记账按钮），那里会先展示识别结果、由用户确认后才落账。
   **绝不可**说「已记一笔 / 已入账 / 记好了」——你根本写不进账本，那是欺骗用户。
   （产品原则：AI 识别结果必须经用户确认才写账本，杜绝静默记错。）
4. 可用工具（共 6 个，均不新建交易）：
   - list_accounts（查账户）、list_categories（查类目）：**实时从数据库拿**，永远是最新的；遇到「用户说的账户/类目名我不确定」「以前看到的列表可能过期」「预投喂为空」时，第一选择是先调它们查到再决策
   - list_transactions（查交易，用于定位修改/删除目标）
   - update_transaction / delete_transaction（修改/删除**已存在**的交易）
   - query_stats（查账问答：余额、月度、排行等）
5. 用户说"把 XX 改成 YY""这笔记错了""删了这笔"时，先调 list_transactions 拿到 transaction_id，再调 update / delete。
6. **不知道账户/类目 id 时不要瞎猜、不要做软匹配**，先调 list_accounts / list_categories 拿到全量再选。
   - 若工具返回的列表里没有用户提到的名字，**立刻在回复里如实告诉用户**「没找到账户『XX』，现有账户：…；要用 YY 吗？」并请用户确认——不要自作主张用名字相近的项顶替。
7. list_accounts / list_categories 的 query 参数是**模糊匹配**（任意子串），可以用「微信」「零钱通」「早餐」等做关键词。
8. 金额用正数；时间默认当前时间；日期格式 YYYY-MM-DD HH:mm:ss。
9. update_transaction 只能修改普通收入/支出（type=income/expense），不能修改转账；删除无此限制。
10. 操作成功后用一句话向用户确认（如"已更新：午餐 13.9 → 外卖 15.0""已删除该笔支出"）。
11. 工具调用返回 {"ok": false, ...} 时表示修改/删除失败，**必须**如实告诉用户失败原因并请其补充或更正，**不得**说"已保存/已完成/已删除"。
    **只有** update_transaction / delete_transaction 真实返回了 {"ok": true, ...}，你才可以说"已更新/已删除"。
    若你只调了 list_* / query_stats 等**只读**工具、或根本没调任何写工具，就**绝不可**声称账本已变更。
12. 对话风格：像真人在微信/小爱里陪用户记账一样自然。**禁止**在回复中暴露后端工具名（list_accounts / query_stats 等）、函数调用 JSON 块、调试占位符、思考过程。回复尽量 1-2 句、简洁有温度；如有多个工具并行执行**只总结结果**，不写"我已经为您调用了 xxx 工具"之类机械化开场白。
补充：
- 下方「可用类目」「可用账户」两节是**预投喂**的快速参考（凭 system prompt 即可见），足以应对多数简单场景。但当用户提的账户名与预投喂列表不完全一致、或预投喂为空、或你对此前的列表没把握时，**必须**调 list_accounts / list_categories 实时确认——凭印象编一个 id 会导致记账失败。
- 用户那张截图中「我的工具集里没有列出账户和分类的接口」这句话是**错的**，从 v0.0.44 起本系统确实提供了 list_accounts / list_categories 工具，AI 可以调用它们直接拿到 id。
- 这两节若显式标注「空 — 当前账本没有...」，说明用户该账本下确实没建账户/类目，请建议他去 App「账户管理 / 分类管理」建好后重试。

可用类目：
${catRef}

可用账户：
${accRef}`;

        /**
         * ⛔ create_transaction / create_transfer 两个【直写账本】工具已于 2026-08-25 移除。
         * ------------------------------------------------
         * 移除原因：它们让模型输出绕过用户确认直接 INSERT INTO transactions，
         * 违反 v0.2 核心原则「AI 输出永不直接写账本」。三端已全部切换到新链路
         * （web 完全不用 /chat 记账，android/harmony 仅在 422 时回退到 /chat），
         * 原注释里写的移除条件「三端均切换后再删」已满足。
         *
         * ⚠️ 曾造成真实 bug：转出腿备注写成 `转账至${fromAcc.name}`（转出账户自己），
         *    而 transfers.js 早已把同样的错修成 toAcc.name —— 重复实现导致修复没同步。
         *
         * 记账链路（唯一）：
         *   POST /api/ai/transactions/parse     → 确定性抽取，产出不可变预测快照（不写账本）
         *   POST /api/ai/predictions/:id/commit → 用户确认后事务内原子落账（FOR UPDATE + 幂等键）
         *
         * /chat 现在只保留【只读咨询】+ update/delete（改删须用户给出明确交易 id，非凭空创建）。
         */
        const tools = [
            {
                name: 'list_accounts',
                description: '查当前账本下所有可用账户（可按名称模糊过滤）。返回 [{id, name, type, balance, icon}, ...]。**当你无法确定 account_id 或 from_account_id/to_account_id 时必须先调本工具**——绝不要凭「预投喂列表」硬猜，也不要做软匹配；调本工具后若仍找不到完全匹配的名字，**立刻在回复里告诉用户并请其确认**。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '名称模糊关键词（任意子串，如「微信」「零钱通」「招行」），可省略表示查全部' },
                        limit: { type: 'integer', description: '默认 50，最大 100' }
                    }
                }
            },
            {
                name: 'list_categories',
                description: '查当前账本下所有可用分类（可按名称/类型过滤）。返回 [{id, name, type, icon}, ...]。**当你无法确定 category_id 时必须先调本工具**。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '名称模糊关键词（任意子串，如「早餐」「交通」「外卖」），可省略' },
                        type_filter: { type: 'string', enum: ['income', 'expense'], description: '按收支类型过滤，可省略' },
                        limit: { type: 'integer', description: '默认 50，最大 100' }
                    }
                }
            },
            {
                name: 'list_transactions',
                description: '按关键词、金额、日期范围列出最近交易。两种用途：(a) 定位用户想修改或删除的目标交易（须返回的 transaction_id 喂给 update/delete）；(b) 创建交易时若账户/类目不能确定，可用商家名/场景名（如「大味王」「晚餐」「加油」）做 keyword，查最近 1–3 条同场景的过往交易，复用其 account_id/category_id。返回交易 id、时间、金额、类型、备注、分类、账户。',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: '备注/分类/账户/商家关键词，可省略' },
                        amount: { type: 'number', description: '精确金额，可省略' },
                        date_from: { type: 'string', description: 'YYYY-MM-DD，可省略' },
                        date_to: { type: 'string', description: 'YYYY-MM-DD，可省略' },
                        limit: { type: 'integer', description: '默认 10，最大 20；查历史同类时建议给 3' }
                    }
                }
            },
            {
                name: 'update_transaction',
                description: '修改一笔已存在的普通收入/支出交易（不能修改转账）。transaction_id 必须先从 list_transactions 获取。',
                parameters: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'integer', description: '交易 id' },
                        type: { type: 'string', enum: ['income', 'expense'], description: '新的收支方向' },
                        amount: { type: 'number', description: '新金额（正数）' },
                        category_id: { type: 'integer', description: '新分类 id' },
                        account_id: { type: 'integer', description: '新账户 id' },
                        date: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss，可省略表示不变' },
                        note: { type: 'string', description: '新备注，可省略表示不变' }
                    },
                    required: ['transaction_id', 'type', 'amount', 'category_id', 'account_id']
                }
            },
            {
                name: 'delete_transaction',
                description: '删除一笔已存在的交易（包括转账，会级联删除配对记录）。transaction_id 必须先从 list_transactions 获取。',
                parameters: {
                    type: 'object',
                    properties: {
                        transaction_id: { type: 'integer', description: '交易 id' }
                    },
                    required: ['transaction_id']
                }
            },
            {
                name: 'query_stats',
                description: '回答查账类问题（本月收入/支出/结余、当前总余额、本月各类目花费、最近交易）。',
                parameters: {
                    type: 'object',
                    properties: {
                        metric: { type: 'string', enum: ['month_income', 'month_expense', 'month_balance', 'total_balance', 'category_this_month', 'recent'] },
                        month: { type: 'string', description: 'YYYY-MM，可省略表示当前月' }
                    },
                    required: ['metric']
                }
            }
        ];

        /**
         * 工具执行器。
         * ⛔ 已移除 create_transaction / create_transfer（见上方 tools 定义处的说明）：
         *    新建交易一律走 /ai/transactions/parse → /ai/predictions/:id/commit。
         *    模型若仍尝试调用这两个名字，会落到末尾的 unknown_tool 分支返回错误，
         *    这是【期望行为】—— 宁可让模型报错，也不能绕过用户确认写账本。
         */
        async function executeTool(name, args) {
            if (name === 'create_transaction' || name === 'create_transfer') {
                return {
                    ok: false,
                    error: '新建交易请走「智能记账」确认流程，对话中不支持直接记账。',
                    hint: 'use_parse_commit_flow',
                };
            }
            if (name === 'query_stats') {
                const metric = args.metric;
                const month = args.month || new Date().toISOString().slice(0, 7);
                if (metric === 'total_balance') {
                    const rows = await db.query("SELECT COALESCE(SUM(balance),0) as b FROM accounts WHERE user_id = ? AND book_id = ? AND status='active'", [req.userId, req.bookId]);
                    return { ok: true, metric, value: parseFloat(rows[0].b) };
                }
                if (metric === 'month_income' || metric === 'month_expense' || metric === 'month_balance') {
                    const rows = await db.query(
                        `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) as inc,
                                COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) as exp
                         FROM transactions WHERE user_id = ? AND book_id = ? AND CAST(date AS CHAR(10)) LIKE ? AND type IN ('income','expense')`,
                        [req.userId, req.bookId, month + '%']
                    );
                    const inc = parseFloat(rows[0].inc), exp = parseFloat(rows[0].exp);
                    const value = metric === 'month_income' ? inc : metric === 'month_expense' ? exp : (inc - exp);
                    return { ok: true, metric, month, value };
                }
                if (metric === 'category_this_month') {
                    const rows = await db.query(
                        `SELECT c.name, COALESCE(SUM(t.amount),0) as amt FROM transactions t
                         LEFT JOIN categories c ON t.category_id = c.id
                         WHERE t.user_id = ? AND t.book_id = ? AND CAST(t.date AS CHAR(10)) LIKE ? AND t.type='expense'
                         GROUP BY c.name ORDER BY amt DESC LIMIT 8`,
                        [req.userId, req.bookId, month + '%']
                    );
                    return { ok: true, metric, month, rows: rows.map(r => ({ name: r.name, amount: parseFloat(r.amt) })) };
                }
                if (metric === 'recent') {
                    const rows = await db.query(
                        `SELECT t.amount, t.type, t.note, t.date, c.name as cat FROM transactions t
                         LEFT JOIN categories c ON t.category_id=c.id WHERE t.user_id=? AND t.book_id=? ORDER BY t.date DESC, t.id DESC LIMIT 5`,
                        [req.userId, req.bookId]
                    );
                    return { ok: true, metric, rows: rows.map(r => ({ amount: parseFloat(r.amount), type: r.type, note: r.note, date: r.date, category: r.cat })) };
                }
                return { ok: false, error: '不支持的查询类型' };
            }
            if (name === 'list_accounts') {
                const query = args.query ? `%${args.query}%` : null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 50, 1), 100);
                const rows = await db.query(
                    `SELECT id, name, type, balance, icon FROM accounts
                     WHERE user_id = ? AND book_id = ? AND status = 'active'
                       ${query ? 'AND name LIKE ?' : ''}
                     ORDER BY sort_order, id LIMIT ${limit}`,
                    query ? [req.userId, req.bookId, query] : [req.userId, req.bookId]
                );
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        account_id: r.id, name: r.name, type: r.type,
                        balance: parseFloat(r.balance), icon: r.icon
                    }))
                };
            }
            if (name === 'list_categories') {
                const query = args.query ? `%${args.query}%` : null;
                const typeFilter = args.type_filter || null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 50, 1), 100);
                const params = [req.userId, req.bookId];
                let sql = `SELECT id, name, type, icon FROM categories
                           WHERE (user_id IS NULL OR (user_id = ? AND (book_id IS NULL OR book_id = ?)))`;
                if (query) { sql += ' AND name LIKE ?'; params.push(query); }
                if (typeFilter) { params.push(typeFilter); sql += ` AND type = $${params.length}`; }
                sql += ' ORDER BY type, sort_order LIMIT ' + limit;
                const rows = await db.query(sql, params);
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        category_id: r.id, name: r.name, type: r.type, icon: r.icon
                    }))
                };
            }
            if (name === 'list_transactions') {
                const keyword = args.keyword ? `%${args.keyword}%` : null;
                const amount = toAmount(args.amount);
                const dateFrom = args.date_from || null;
                const dateTo = args.date_to || null;
                const limit = Math.min(Math.max(parseInt(args.limit) || 10, 1), 20);
                let sql = `SELECT t.id, t.amount, t.type, t.note, t.date, c.name as cat, a.name as acc
                           FROM transactions t
                           LEFT JOIN categories c ON t.category_id=c.id
                           LEFT JOIN accounts a ON t.account_id=a.id
                           WHERE t.user_id=? AND t.book_id = ?`;
                const params = [req.userId, req.bookId];
                if (keyword) { sql += ' AND (t.note LIKE ? OR c.name LIKE ? OR a.name LIKE ?)'; params.push(keyword, keyword, keyword); }
                if (amount !== null && amount > 0) { sql += ' AND t.amount = ?'; params.push(amount); }
                if (dateFrom) { sql += ' AND t.date >= ?'; params.push(dateFrom); }
                if (dateTo) { sql += ' AND t.date <= ?'; params.push(dateTo); }
                sql += ' ORDER BY t.date DESC, t.id DESC LIMIT ?';
                params.push(limit);
                const rows = await db.query(sql, params);
                return {
                    ok: true,
                    rows: rows.map(r => ({
                        transaction_id: r.id, amount: parseFloat(r.amount), type: r.type,
                        note: r.note, date: fmtDateTime(r.date), category: r.cat, account: r.acc
                    }))
                };
            }
            if (name === 'update_transaction') {
                const txId = parseInt(args.transaction_id);
                const type = args.type;
                if (!txId) return { ok: false, error: '缺少交易 id' };
                if (type !== 'income' && type !== 'expense') return { ok: false, error: '只能修改普通收入/支出' };
                const amount = toAmount(args.amount);
                if (amount === null || amount <= 0) return { ok: false, error: '金额无效' };
                const accountId = parseInt(args.account_id), categoryId = parseInt(args.category_id);
                const acc = await db.queryOne('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND book_id = ?', [accountId, req.userId, req.bookId]);
                if (!acc) return { ok: false, error: '账户不存在' };
                const cat = await db.queryOne('SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)', [categoryId, req.userId]);
                if (!cat) return { ok: false, error: '分类不存在' };
                const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [txId, req.userId, req.bookId]);
                if (!old) return { ok: false, error: '交易不存在' };
                if (old.type === 'transfer_in' || old.type === 'transfer_out') return { ok: false, error: '转账请删除后重新记账' };
                const date = args.date || fmtDateTime(old.date);
                const note = args.note !== undefined ? args.note : old.note;
                const src = type === 'expense' ? accountId : null;
                const dst = type === 'income' ? accountId : null;
                await db.transaction(async (conn) => {
                    await conn.query(
                        `UPDATE transactions SET account_id=?, category_id=?, type=?, amount=?, note=?, date=?, source_account_id=?, destination_account_id=? WHERE id=? AND user_id=? AND book_id=?`,
                        [accountId, categoryId, type, amount, note || '', date, src, dst, txId, req.userId, req.bookId]
                    );
                    const affected = new Set([parseInt(old.account_id), accountId]);
                    const newBalances = {};
                    for (const aid of affected) newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
                    for (const aid of affected) await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
                    for (const aid of affected) {
                        await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalances[aid], aid]);
                        await syncCreditCardDebt(conn, req.userId, aid);
                    }
                });
                return { ok: true, transaction_id: txId, action: 'updated', type, amount };
            }
            if (name === 'delete_transaction') {
                const txId = parseInt(args.transaction_id);
                if (!txId) return { ok: false, error: '缺少交易 id' };
                const old = await db.queryOne('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [txId, req.userId, req.bookId]);
                if (!old) return { ok: false, error: '交易不存在' };
                let deletedType = old.type;
                await db.transaction(async (conn) => {
                    const affectedAccounts = new Set([parseInt(old.account_id)]);
                    if (old.transfer_id) {
                        const paired = await conn.query(
                            'SELECT id, account_id FROM transactions WHERE transfer_id = ? AND id != ? AND user_id = ? AND book_id = ?',
                            [old.transfer_id, txId, req.userId, req.bookId]
                        );
                        paired.forEach(p => { affectedAccounts.add(parseInt(p.account_id)); });
                        await conn.query('DELETE FROM transactions WHERE transfer_id = ? AND user_id = ? AND book_id = ?', [old.transfer_id, req.userId, req.bookId]);
                        await conn.query('DELETE FROM transfers WHERE id = ? AND user_id = ? AND book_id = ?', [old.transfer_id, req.userId, req.bookId]);
                    } else {
                        await conn.query('DELETE FROM transactions WHERE id = ? AND user_id = ? AND book_id = ?', [txId, req.userId, req.bookId]);
                    }
                    const newBalances = {};
                    for (const aid of affectedAccounts) newBalances[aid] = await computeAccountBalance(conn, req.userId, aid);
                    for (const aid of affectedAccounts) await enforceBalanceLimit(conn, req.userId, aid, newBalances[aid]);
                    for (const aid of affectedAccounts) {
                        await conn.query('UPDATE accounts SET balance = ? WHERE id = ?', [newBalances[aid], aid]);
                        await syncCreditCardDebt(conn, req.userId, aid);
                    }
                });
                return { ok: true, transaction_id: txId, action: 'deleted', type: deletedType, amount: parseFloat(old.amount) };
            }
            return { ok: false, error: '未知工具 ' + name };
        }

        const conv = [{ role: 'system', content: system }, ...norm];
        let reply = '';
        const mutations = [];
        const toolErrors = [];
        let unfinished = false;
        let writeSucceeded = false;
        const MAX_LOOPS = 5;
        for (let i = 0; i < MAX_LOOPS; i++) {
            const msg = await chatWithTools(provider, conv, tools);
            conv.push(msg);
            if (!msg.toolCalls || msg.toolCalls.length === 0) { reply = stripThinkingTokens(msg.content || ''); break; }
            for (const tc of msg.toolCalls) {
                const result = await executeTool(tc.name, tc.arguments || {});
                conv.push({ role: 'tool', toolCallId: tc.id, content: JSON.stringify(result) });
                if (!result.ok) toolErrors.push(result.error || '操作失败');
                if (result.ok && result.transaction_id) {
                    writeSucceeded = true;
                    const action = result.action || 'created';
                    if (action === 'deleted') {
                        mutations.push({
                            id: result.transaction_id, action,
                            type: result.type || 'expense',
                            amount: parseFloat(result.amount || 0),
                            categoryName: '', accountName: '', date: ''
                        });
                    } else {
                        const t = await db.queryOne(
                            `SELECT t.amount, t.type, t.note, t.date, c.name as cat, a.name as acc
                             FROM transactions t LEFT JOIN categories c ON t.category_id=c.id LEFT JOIN accounts a ON t.account_id=a.id
                             WHERE t.id=? AND t.user_id=? AND t.book_id = ?`,
                            [result.transaction_id, req.userId, req.bookId]
                        );
                        if (t) mutations.push({ id: result.transaction_id, action, type: t.type, amount: parseFloat(t.amount), categoryName: t.cat, accountName: t.acc, date: fmtDateTime(t.date) });
                    }
                }
            }
            // 最后一轮仍要求调工具：说明步骤太多/循环用尽，本次未完整执行
            if (i === MAX_LOOPS - 1) unfinished = true;
        }
        // reply 兜底前先按真实执行状态修正，避免"没记却回复已记"
        if (!reply || reply === '已完成处理。') {
            if (unfinished) reply = '本次处理步骤较多未能全部完成，请再说一次或补充信息后重试。';
            else if (toolErrors.length > 0) reply = '记录失败：' + toolErrors[0] + '，请补充或更正后重试。';
            else reply = '已完成处理。';
        } else {
            // 关键安全网：AI 文案声称"已记/已创建交易/记好了/已入账"等成功口吻，
            // 但本次没有任何写工具真正返回 {"ok": true, "transaction_id"}（writeSucceeded=false）。
            // 典型场景：思考模型只调了 list_* 只读工具就"脑补"已记账，或写工具报错失败。
            // 此时账本上其实什么都没有，必须如实纠正，杜绝"假成功"误导用户。
            const claimsRecorded = /已记(一笔|账|好|录)?|已创建(了)?交易|记好了|已保存(到账本)?|已入账|已成功记账|已为您记[账录]|记录成功|记账成功|成功记[账入]/.test(reply);
            if (claimsRecorded && !writeSucceeded) {
                const reason = toolErrors.length > 0
                    ? ('：' + toolErrors[0])
                    : '：系统检测到本次并未真正调用记账工具写入账本';
                reply = '很抱歉，这笔其实没有记录成功' + reason + '。请确认金额与收支方向，或到「添加」手动记一笔。';
            } else if (toolErrors.length > 0 && mutations.length === 0) {
                // 兜底：文案未明确声称成功但确有工具报错且无落库
                reply = '很抱歉，这笔没有记录成功：' + toolErrors[0] + '。' + reply;
            }
        }
        // 最终再剥离一次思考标记（覆盖任何遗漏路径），并兜底空回复
        reply = stripThinkingTokens(reply || '');
        if (!reply) reply = '已完成处理。';
        // AI 记账回复修饰：去除「机械化前缀」、隐藏工具名/调试字样，并按真实落账结果追加自然口语。
        // 注意：此处**不会**修改 mutations（transactions 卡片）——前端 ChatBubble 渲染完全不变。
        reply = polishChatReply(reply, writeSucceeded);
        res.json(success({ reply, transactions: mutations }));
    } catch (err) {
        if (err && err.isAiProviderError) return res.status(err.statusCode || 502).json(fail(err.message));
        handleServerError(res, err, 'AI 对话');
    }
});

module.exports = router;
