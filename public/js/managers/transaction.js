// ============================================================
// TransactionManager —— 交易模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 1371 行 ~ 第 1740 行（共 370 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、fmtDate、fmtSigned、
//                    fmtTransTime、fmtDateGroupHeader、showToast、
//                    showEmpty、cache、initCache、getExpCats、
//                    getIncCats、mergeTransferPairs、parseDateParts、
//                    DOM 元素（transSearch / transCatFilter /
//                    transTypeFilter / transMonthFilter / transAccFilter /
//                    transAmountBtn / transAmountPanel / transAmountLabel /
//                    transAmountInputs / transAmountActions / transAmountVal /
//                    transAmountVal2 / transAmountSep / transAmountApply /
//                    transAmountClear / transTagFilter / transNoteFilter /
//                    addTransBtn / transModal / transModalClose /
//                    transCancelBtn / transModalTitle / transEditId /
//                    transAmount / transDate / transNote / transAccount /
//                    transCategory / transBudget / transForm /
//                    transTagPicker / transTbody）
// ============================================================

const TransactionManager = {
    _saving: false,
    _filterTimer: null,
    // ===== 翻页状态 =====
    // ⛔ 为什么用「前端切片」而不是服务端 LIMIT/OFFSET：
    //   ① 备注筛选（transNoteFilter）是**前端**做的（见 refresh 里的 noteFilter），
    //      服务端不认这个条件。若走 SQL 分页，服务端以为返回了 20 条，
    //      前端过滤掉 6 条后只剩 14 条，且「共几页」完全算错。
    //      这正是 server/routes/transactions.js:143 那段注释警告的坑。
    //   ② 服务端 GET /transactions 返回**裸数组**、不带 total，
    //      要做服务端分页得先改接口契约（加 COUNT 查询 + 包一层 {items,total}），
    //      会波及 dashboard / report / ai-advice 等所有调用方。
    //   ③ 现有 limit=200 一次拉全，翻页时**不再打接口**，纯内存切片 → 翻页零延迟。
    // ⇒ 超过 200 条的账本需要服务端分页时，必须连同 ①② 一起改，别只改这里。
    _page: 1,
    // 默认 20 条（用户 2026-08-24 指定）。翻页条右侧可切 20/50/100。
    // ⛔ 别改回 50：44 条数据在每页 50 时只有一页 = 等于没分页，
    //    页面会重新变成 4000px 高的长白板，正是要治的病。
    _pageSize: 20,
    _pageRows: [],
    init() {
        this.populateFilters();
        // 筛选条件变化 → 必须回到第 1 页，否则会停在一个已不存在的页码上（显示空白）
        const refreshNow = () => { this._page = 1; this.refresh({ syncUrl: true }); };
        const refreshDebounced = () => { this._page = 1; this.debouncedRefresh(); };

        document.getElementById('transSearch').addEventListener('input', refreshDebounced);
        document.getElementById('transCatFilter').addEventListener('change', refreshNow);
        document.getElementById('transTypeFilter').addEventListener('change', refreshNow);
        document.getElementById('transMonthFilter').addEventListener('change', refreshNow);
        document.getElementById('transAccFilter').addEventListener('change', refreshNow);
        // ===== 金额筛选下拉面板 =====
        const amtBtn = document.getElementById('transAmountBtn');
        const amtPanel = document.getElementById('transAmountPanel');
        const amtLabel = document.getElementById('transAmountLabel');
        const amtInputs = document.getElementById('transAmountInputs');
        const amtActions = document.getElementById('transAmountActions');
        this._amtVal = document.getElementById('transAmountVal');
        this._amtVal2 = document.getElementById('transAmountVal2');
        const amtSep = document.getElementById('transAmountSep');
        const amtApply = document.getElementById('transAmountApply');
        const amtClear = document.getElementById('transAmountClear');
        const amtOpBtns = amtPanel?.querySelectorAll('.amt-op-btn');

        this._currentAmtOp = 'all';

        const updateAmtPanel = (op) => {
            this._currentAmtOp = op;
            amtOpBtns.forEach(b => b.classList.toggle('active', b.dataset.op === op));
            const showInputs = op !== 'all';
            const isBetween = op === 'bt' || op === 'nb';
            amtInputs.style.display = showInputs ? '' : 'none';
            amtActions.style.display = showInputs ? '' : 'none';
            amtInputs.classList.toggle('between-input', isBetween);
            this._amtVal.placeholder = isBetween ? '最低' : '金额';
            this._amtVal2.style.display = isBetween ? '' : 'none';
            amtSep.style.display = isBetween ? '' : 'none';
            if (op === 'all') {
                this._amtVal.value = ''; this._amtVal2.value = '';
                amtLabel.textContent = '金额';
                closeAmtPanel();
                this.refresh({ syncUrl: true });
            }
        };

        const closeAmtPanel = () => {
            amtPanel.style.display = 'none';
            amtBtn.classList.remove('active');
        };

        const applyAmountFilter = () => {
            const op = this._currentAmtOp;
            if (op === 'all') { clearAmountFilter(); return; }
            const v1 = this._amtVal?.value?.trim();
            if (!v1) { showToast('请输入金额', 'warning'); this._amtVal?.focus(); return; }
            let label;
            if (op === 'bt' || op === 'nb') {
                const v2 = this._amtVal2?.value?.trim();
                if (!v2) { showToast('请输入上限金额', 'warning'); this._amtVal2?.focus(); return; }
                label = (op === 'bt' ? '介于 ' : '不介于 ') + v1 + '~' + v2;
            } else {
                const opLabels = { gt: '大于 ', lt: '小于 ', eq: '等于 ', ne: '不等于 ' };
                label = (opLabels[op] || '') + v1;
            }
            amtLabel.textContent = label;
            closeAmtPanel();
            this.refresh({ syncUrl: true });
        };

        const clearAmountFilter = () => {
            this._amtVal.value = ''; this._amtVal2.value = '';
            updateAmtPanel('all');
        };

        if (amtBtn) {
            amtBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = amtPanel.style.display !== 'none';
                if (isOpen) { closeAmtPanel(); }
                else {
                    // 用 JS 强制设内联 !important 定位，绕过任何缓存/未加载的旧 CSS，
                    // 无论 CSS 是 fixed/absolute 都没用，这里是最终的权威设置
                    if (amtPanel.parentElement) {
                        amtPanel.parentElement.style.position = 'relative'; // 确保定位包含块
                    }
                    amtPanel.style.setProperty('position', 'absolute', 'important');
                    amtPanel.style.setProperty('top', '100%', 'important');
                    amtPanel.style.setProperty('left', '0', 'important');
                    amtPanel.style.removeProperty('right');
                    amtPanel.style.removeProperty('bottom');
                    amtPanel.style.removeProperty('min-width');
                    amtPanel.style.display = '';
                    amtBtn.classList.add('active');
                }
            });
        }
        if (amtOpBtns) {
            amtOpBtns.forEach(b => b.addEventListener('click', (e) => {
                e.stopPropagation();
                updateAmtPanel(b.dataset.op);
            }));
        }
        if (this._amtVal) this._amtVal.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyAmountFilter(); });
        if (this._amtVal2) this._amtVal2.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyAmountFilter(); });
        if (amtApply) amtApply.addEventListener('click', (e) => { e.stopPropagation(); applyAmountFilter(); });
        if (amtClear) amtClear.addEventListener('click', (e) => { e.stopPropagation(); clearAmountFilter(); });
        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (amtPanel && amtPanel.style.display !== 'none' && !amtPanel.contains(e.target) && e.target !== amtBtn && !amtBtn.contains(e.target)) {
                closeAmtPanel();
            }
        });
        // ===== 金额筛选下拉面板结束 =====
        const tagF = document.getElementById('transTagFilter');
        if (tagF) tagF.addEventListener('change', refreshNow);
        const noteF = document.getElementById('transNoteFilter');
        if (noteF) noteF.addEventListener('input', refreshDebounced);
        document.getElementById('addTransBtn').addEventListener('click', () => this.openModal());
        document.getElementById('transModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('transCancelBtn').addEventListener('click', () => this.closeModal());
        document.querySelectorAll('#transForm .type-btn').forEach(b => b.addEventListener('click', () => {
            document.querySelectorAll('#transForm .type-btn').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
            b.classList.add('active');
            b.setAttribute('aria-pressed', 'true');
            this.setFormMode(b.dataset.type);
        }));
        document.getElementById('transForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    },
    debounce(fn, delay = 300) {
        clearTimeout(this._filterTimer);
        this._filterTimer = setTimeout(fn, delay);
    },
    debouncedRefresh() {
        this.debounce(() => this.refresh({ syncUrl: true }));
    },
    restoreFiltersFromUrl() {
        if (window.location.pathname.replace(/\/+$/, '').split('/').pop() !== 'transactions') return;
        const q = new URLSearchParams(window.location.search);
        const setVal = (id, key) => {
            const el = document.getElementById(id);
            const val = q.get(key);
            if (el && val !== null) el.value = val;
        };
        setVal('transSearch', 'search');
        setVal('transCatFilter', 'category_id');
        setVal('transTypeFilter', 'type');
        setVal('transMonthFilter', 'month');
        setVal('transAccFilter', 'account_id');
        setVal('transTagFilter', 'tag_id');
        setVal('transNoteFilter', 'note');
        const amtOp = q.get('amount_op');
        if (amtOp && amtOp !== 'all') {
            this._currentAmtOp = amtOp;
            if (this._amtVal) this._amtVal.value = q.get('amount_val') || '';
            if (this._amtVal2) this._amtVal2.value = q.get('amount_val2') || '';
            const label = document.getElementById('transAmountLabel');
            if (label) label.textContent = '金额筛选';
        }
    },
    syncFiltersToUrl() {
        if (window.location.pathname.replace(/\/+$/, '').split('/').pop() !== 'transactions') return;
        const q = new URLSearchParams();
        const add = (key, val, skip = 'all') => {
            if (val && val !== skip) q.set(key, val);
        };
        add('search', document.getElementById('transSearch')?.value?.trim(), '');
        add('category_id', document.getElementById('transCatFilter')?.value);
        add('type', document.getElementById('transTypeFilter')?.value);
        add('month', document.getElementById('transMonthFilter')?.value);
        add('account_id', document.getElementById('transAccFilter')?.value);
        add('tag_id', document.getElementById('transTagFilter')?.value);
        add('note', document.getElementById('transNoteFilter')?.value?.trim(), '');
        if (this._currentAmtOp && this._currentAmtOp !== 'all') {
            q.set('amount_op', this._currentAmtOp);
            add('amount_val', this._amtVal?.value?.trim(), '');
            add('amount_val2', this._amtVal2?.value?.trim(), '');
        }
        const base = window.location.pathname;
        const next = q.toString() ? `${base}?${q.toString()}` : base;
        window.history.replaceState(window.history.state, '', next);
    },
    populateFilters() {
        const catSel = document.getElementById('transCatFilter');
        const parents = cache.categories.filter(c => !c.parent_id);
        const children = cache.categories.filter(c => c.parent_id);
        parents.forEach(p => {
            const subs = children.filter(c => c.parent_id === p.id);
            if (subs.length > 0) {
                catSel.innerHTML += `<optgroup label="${escapeHtml(p.icon || "📌")} ${escapeHtml(p.name)}">${subs.map(s => `<option value="${s.id}">${escapeHtml(s.icon || "📌")} ${escapeHtml(s.name)}</option>`).join('')}</optgroup>`;
            } else {
                catSel.innerHTML += `<option value="${p.id}">${escapeHtml(p.icon || "📌")} ${escapeHtml(p.name)}</option>`;
            }
        });
        const accSel = document.getElementById('transAccFilter');
        cache.accounts.forEach(a => { accSel.innerHTML += `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`; });
        this.updateCatSelect('expense');
        this.updateAccSelect();
    },
    setFormMode(type) {
        const isTransfer = type === 'transfer';
        // 类型按钮样式已在 click 处理中切换
        document.querySelectorAll('#transForm .non-transfer').forEach(el => el.style.display = isTransfer ? 'none' : '');
        document.querySelectorAll('#transForm .transfer-only').forEach(el => el.style.display = isTransfer ? '' : 'none');
        document.getElementById('transAccountLabel').textContent = isTransfer ? '转出账户' : '账户';
        document.getElementById('transToAccount').required = isTransfer;
        // 转账也要选类别（一般转账 / 还信用卡 / 取现 …），与支出收入保持一致
        document.getElementById('transCategory').required = true;
        // 转账时预算那列被隐藏，类别拉通整行，别留半行空白
        document.getElementById('transCategory')?.closest('.form-group')?.classList.toggle('full-width', isTransfer);
        const submitBtn = document.querySelector('#transForm button[type="submit"]');
        const hint = document.getElementById('transSingleAccountHint');
        const toRow = document.getElementById('transToAccount')?.closest('.form-row');
        if (isTransfer) {
            this.updateCatSelect('transfer');
            this.updateTransferAccSelect();
            const accounts = cache.accounts || [];
            if (accounts.length < 2) {
                if (hint) hint.style.display = '';
                if (toRow) toRow.style.display = 'none';
                if (submitBtn) submitBtn.disabled = true;
            } else {
                if (hint) hint.style.display = 'none';
                if (toRow) toRow.style.display = '';
                if (submitBtn) submitBtn.disabled = false;
            }
        } else {
            this.updateCatSelect(type);
            this.updateAccSelect();
            if (hint) hint.style.display = 'none';
            if (toRow) toRow.style.display = '';
            if (submitBtn) submitBtn.disabled = false;
        }
    },
    updateTransferAccSelect() {
        const populate = (sel) => {
            sel.innerHTML = cache.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)} (${fmt(a.balance)})</option>`).join('');
        };
        populate(document.getElementById('transAccount'));
        populate(document.getElementById('transToAccount'));
    },
    updateCatSelect(type) {
        const sel = document.getElementById('transCategory');
        // 转账有自己的分类体系（一般转账 / 还信用卡 / 取现 …），别拿支出分类顶上
        const cats = type === 'transfer'
            ? getTransferCats()
            : (type === 'expense' ? getExpCats() : getIncCats());
        // 构建树形选项：一级分类作为 optgroup，二级分类作为 option
        const parents = cats.filter(c => !c.parent_id);
        const children = cats.filter(c => c.parent_id);
        sel.innerHTML = parents.map(p => {
            const subs = children.filter(c => c.parent_id === p.id);
            if (subs.length > 0) {
                return `<optgroup label="${escapeHtml(p.icon || "📌")} ${escapeHtml(p.name)}">${subs.map(s => `<option value="${s.id}">${escapeHtml(s.icon || "📌")} ${escapeHtml(s.name)}</option>`).join('')}</optgroup>`;
            }
            return `<option value="${p.id}">${p.icon} ${escapeHtml(p.name)}</option>`;
        }).join('');
        // 极端情况：一类分类都没有（新账本 / 分类被清空）时给出可提交占位并摘掉
        // required —— 空 select 带 required 会让表单永远 invalid，保存按钮直接点不动。
        // 此时不传 category_id，由服务端兜底归类。
        const hasCats = sel.options.length > 0;
        sel.required = hasCats;
        if (!hasCats) sel.innerHTML = '<option value="">（暂无类别，将由系统自动归类）</option>';
    },
    updateAccSelect() {
        const sel = document.getElementById('transAccount');
        sel.innerHTML = cache.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`).join('');
    },
    renderTagPicker(selectedIds = []) {
        const picker = document.getElementById('transTagPicker');
        if (!picker) return;
        const sel = new Set(selectedIds);
        const tags = cache.tags || [];
        if (tags.length === 0) { picker.innerHTML = '<span class="empty-hint">暂无标签，去「标签管理」创建</span>'; return; }
        picker.innerHTML = tags.map(tg => `<span class="tag-chip ${sel.has(tg.id) ? 'selected' : ''}" data-id="${tg.id}" style="--tag-color:${escapeHtml(tg.color)}">${escapeHtml(tg.icon)} ${escapeHtml(tg.name)}</span>`).join('');
        picker.querySelectorAll('.tag-chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('selected')));
    },
    async openModal(editId = null) {
        document.getElementById('transModal').classList.add('show');
        // 加载预算下拉选项
        this.updateBudgetSelect();
        if (editId) {
            document.getElementById('transModalTitle').textContent = '编辑交易';
            // 按 id 精确获取单条交易，避免拉取全量列表（性能）
            let t = null;
            try {
                t = await api(`/transactions/${editId}`, 'GET', null, { silent: true });
            } catch (e) { t = null; }
            if (t) {
                const isTransfer = t.type === 'transfer_out' || t.type === 'transfer_in';
                document.getElementById('transEditId').value = t.id;
                document.getElementById('transAmount').value = t.amount;
                // transDate 是 datetime-local step="1"，回填必须到秒，
                // 否则秒位空着，用户没碰过也可能被滚成 00:02:00 提交上去
                document.getElementById('transDate').value = fmtDateTimeLocal(t.date);
                document.getElementById('transNote').value = t.note || '';
                document.querySelectorAll('#transForm .type-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); if (b.dataset.type === (isTransfer ? 'transfer' : t.type)) { b.classList.add('active'); b.setAttribute('aria-pressed','true'); } });
                this.setFormMode(isTransfer ? 'transfer' : t.type);
                if (isTransfer) {
                    /**
                     * 双端账户的取值优先级：
                     *   1. 单条接口的 transfer 字段（服务端已 JOIN transfers）—— 最准
                     *   2. 列表缓存里那条折叠记录的 transfer.to / 配对结果 —— 旧服务端兜底
                     *   3. 查 /transfers/:transfer_id
                     *
                     * 转出账户不能直接用 t.account.id：那是**这条腿自己**挂的账户。
                     * 点到 out 腿时它恰好是转出方，但点到残留的 in 腿时它是转入方，
                     * 直接填进「转出账户」就把方向弄反了，一保存钱倒着走。
                     */
                    const fromList = window._lastMergedTransfers &&
                        window._lastMergedTransfers.find(x => x._transferOut?.id === t.id || x.id === t.id);

                    // 记下 transfer 主记录 id，保存时零请求直接用（见 resolveTransferId）
                    this._editingTxId = t.id;
                    this._editingTransferId = t.transfer?.id || t.transfer_id
                        || fromList?.transfer?.id || fromList?.transfer_id || null;

                    const fromId = t.transfer?.from?.id
                        || fromList?.transfer?.from?.id
                        || fromList?._transferOut?.account?.id
                        || t.account?.id || cache.accounts[0]?.id;
                    document.getElementById('transAccount').value = fromId;

                    const toId = t.transfer?.to?.id
                        || fromList?.transfer?.to?.id
                        || fromList?._transferIn?.account?.id
                        || t._transferIn?.account?.id;
                    if (toId) {
                        document.getElementById('transToAccount').value = toId;
                    } else if (this._editingTransferId) {
                        try {
                            const full = await api(`/transfers/${this._editingTransferId}`, 'GET', null, { silent: true });
                            if (full) document.getElementById('transToAccount').value = full.to_account_id;
                        } catch (e) { /* ignore */ }
                    }
                    // 回填转账类别：下拉此刻已被 setFormMode('transfer') 换成转账分类
                    document.getElementById('transCategory').value = t.category?.id || '';
                } else {
                    // 清掉转账缓存：否则先编转账再编普通交易时，
                    // resolveTransferId 的 ① 会命中上一笔的 transfer_id
                    this._editingTxId = null;
                    this._editingTransferId = null;
                    document.getElementById('transAccount').value = t.account?.id || cache.accounts[0]?.id;
                    document.getElementById('transCategory').value = t.category?.id;
                    document.getElementById('transBudget').value = t.budget_id || '';
                    this.renderTagPicker(t.tags ? t.tags.map(x => x.id) : []);
                }
            }
        } else {
            document.getElementById('transModalTitle').textContent = '新增交易';
            this._editingTxId = null;
            this._editingTransferId = null;
            document.getElementById('transEditId').value = '';
            document.getElementById('transAmount').value = '';
            document.getElementById('transDate').value = fmtDateTimeLocal();
            document.getElementById('transNote').value = '';
            document.getElementById('transBudget').value = '';
            document.querySelectorAll('#transForm .type-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); if (b.dataset.type === 'expense') { b.classList.add('active'); b.setAttribute('aria-pressed','true'); } });
            this.setFormMode('expense');
            this.renderTagPicker([]);
        }
    },
    updateBudgetSelect() {
        const sel = document.getElementById('transBudget');
        /**
         * 只取日期部分再比。
         *
         * transDate 的 value 是 datetime-local（带 T 和时分秒），而
         * b.start_date / b.end_date 是纯 'YYYY-MM-DD'。直接字符串比较时
         * '2026-08-31T10:00:00' <= '2026-08-31' 为 **false** ——
         * 预算区间最后一天记的账会筛不出任何预算（除了 00:00:00 那一瞬）。
         */
        const raw = document.getElementById('transDate')?.value || fmtDateTimeLocal();
        const transDate = String(raw).slice(0, 10);
        // 从缓存获取预算列表，按交易日期匹配时间范围
        const budgets = cache.budgets || [];
        sel.innerHTML = '<option value="">不关联</option>' +
            budgets.filter(b => transDate >= String(b.start_date).slice(0, 10)
                             && transDate <= String(b.end_date).slice(0, 10)).map(b =>
                `<option value="${b.id}">${escapeHtml(b.name)} (${fmt(b.amount)})</option>`
            ).join('');
    },
    closeModal() { document.getElementById('transModal').classList.remove('show'); },

    /**
     * 由「某条转账腿的 transaction id」反查它所属的 transfers 主记录 id。
     *
     * 为什么需要三级回退：原先只有一条路 ——
     *   `const old = await api('/transactions/'+id); if (!old.transfer_id) 报错`
     * 而 GET /transactions/:id 当时**根本不返回 transfer_id**（它不 JOIN transfers），
     * 于是编辑转账点保存必定弹「无法定位转账记录」，一次都存不进去。
     *
     * 服务端已补齐该字段，但这里仍保留回退：
     *   ① 打开弹窗时缓存的 _editingTransferId —— 零请求，且这是**唯一**
     *      在旧版服务端也能work的路径（弹窗回填本来就已经拿到了 transfer 信息）
     *   ② 单条接口的 transfer_id / transfer.id —— 新服务端
     *   ③ 列表缓存 _lastMergedTransfers —— 旧服务端返回两条腿时的配对结果
     *
     * 返回 null 才提示用户，且提示要给出下一步动作（刷新重试），
     * 而不是一句死路式的「无法定位」。
     */
    async resolveTransferId(editId) {
        const idNum = parseInt(editId);

        // ① 打开编辑弹窗时就记下来的（见 openModal 的转账分支）
        if (this._editingTransferId && this._editingTxId === idNum) {
            return this._editingTransferId;
        }

        // ② 单条接口（服务端已 JOIN transfers）
        try {
            const old = await api(`/transactions/${editId}`, 'GET', null, { silent: true });
            const tid = old?.transfer_id || old?.transfer?.id;
            if (tid) return tid;
        } catch (e) { /* 落到 ③ */ }

        // ③ 列表缓存：新服务端给 transfer.id，旧服务端靠客户端配对给 transfer_id
        const list = window._lastMergedTransfers || [];
        const hit = list.find(x => x.id === idNum || x._transferOut?.id === idNum || x._transferIn?.id === idNum);
        return hit?.transfer?.id || hit?.transfer_id || hit?._transferOut?.transfer_id || null;
    },

    async save() {
        if (this._saving) return;
        const form = document.getElementById('transForm');
        const submitBtn = form?.querySelector('button[type="submit"], .btn-primary');
        this._saving = true;
        if (submitBtn) submitBtn.disabled = true;
        try {
        const editId = document.getElementById('transEditId').value;
        const type = document.querySelector('#transForm .type-btn.active').dataset.type;
        const amount = parseFloat(document.getElementById('transAmount').value);
        const date = document.getElementById('transDate').value;
        const note = document.getElementById('transNote').value;
        if (!amount || amount <= 0) { showToast('请输入有效金额', 'error'); return; }

        if (type === 'transfer') {
            const fromId = parseInt(document.getElementById('transAccount').value);
            const toId = parseInt(document.getElementById('transToAccount').value);
            if (!fromId || !toId) { showToast('请选择转出和转入账户', 'error'); return; }
            if (fromId === toId) { showToast('转出和转入账户不能相同', 'error'); return; }
            // 为空时服务端兜底「一般转账」，不阻塞提交
            const catVal = parseInt(document.getElementById('transCategory').value) || null;
            const tBody = { from_account_id: fromId, to_account_id: toId, amount, date, note, category_id: catVal };
            if (editId) {
                const tid = await this.resolveTransferId(editId);
                if (!tid) {
                    showToast('无法定位转账记录，请刷新页面后重试', 'error');
                    return;
                }
                await api(`/transfers/${tid}`, 'PUT', tBody);
                showToast('转账已更新', 'success');
            } else {
                await api('/transfers', 'POST', tBody);
                showToast('转账成功', 'success');
            }
        } else {
            const budgetVal = document.getElementById('transBudget').value;
            const body = {
                account_id: parseInt(document.getElementById('transAccount').value),
                category_id: parseInt(document.getElementById('transCategory').value),
                budget_id: budgetVal ? parseInt(budgetVal) : null,
                type, amount,
                date,
                note,
                tags: Array.from(document.querySelectorAll('#transTagPicker .tag-chip.selected')).map(c => parseInt(c.dataset.id))
            };
            if (editId) {
                await api(`/transactions/${editId}`, 'PUT', body);
                showToast('交易已更新', 'success');
            } else {
                await api('/transactions', 'POST', body);
                showToast('交易已添加', 'success');
            }
        }
        this.closeModal();
        await initCache();
        await this.refresh({ syncUrl: true });
        // 记账/转账会改变本月收支与账户余额，Dashboard KPI 需同步，否则要切页才更新
        if (window.DashboardManager) await window.DashboardManager.refresh();
        } finally {
            this._saving = false;
            if (submitBtn) submitBtn.disabled = false;
        }
    },
    async delete(id) {
        try {
            await api(`/transactions/${id}`, 'DELETE');
            showToast('交易已删除', 'warning');
            await initCache();
            await this.refresh();
            if (window.DashboardManager) await window.DashboardManager.refresh();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    async refresh(options = {}) {
        if (!options.syncUrl) this.restoreFiltersFromUrl();
        if (options.syncUrl) this.syncFiltersToUrl();
        const search = document.getElementById('transSearch').value;
        const cat = document.getElementById('transCatFilter').value;
        const type = document.getElementById('transTypeFilter').value;
        const month = document.getElementById('transMonthFilter').value;
        const acc = document.getElementById('transAccFilter').value;
        const tag = document.getElementById('transTagFilter')?.value;
        let params = `limit=200`;
        if (month && month !== 'all') params += `&month=${month}`;
        if (type && type !== 'all') params += `&type=${type}`;
        if (cat && cat !== 'all') params += `&category_id=${cat}`;
        if (acc && acc !== 'all') params += `&account_id=${acc}`;
        if (tag && tag !== 'all') params += `&tag_id=${tag}`;
        if (this._currentAmtOp && this._currentAmtOp !== 'all') {
            params += `&amount_op=${this._currentAmtOp}`;
            params += `&amount_val=${encodeURIComponent(this._amtVal?.value || '')}`;
            if (this._currentAmtOp === 'bt' || this._currentAmtOp === 'nb') {
                params += `&amount_val2=${encodeURIComponent(this._amtVal2?.value || '')}`;
            }
        }
        if (search) params += `&search=${encodeURIComponent(search)}`;
        const list = await api(`/transactions?${params}`);
        const tbodyEl = document.getElementById('transTbody');
        if (!list || list.length === 0) { showEmpty(tbodyEl, '暂无交易记录', '📭'); return; }

        // 合并配对转账
        const merged = mergeTransferPairs(list);
        window._lastMergedTransfers = merged;

        // 按日期降序 + id降序排序
        merged.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

        // 前端备注筛选
        const noteFilter = (document.getElementById('transNoteFilter')?.value || '').trim().toLowerCase();
        let filtered = noteFilter
            ? merged.filter(t => {
                const note = (t.note || '').toLowerCase();
                const outNote = t._transferOut ? (t._transferOut.note || '').toLowerCase() : '';
                const inNote = t._transferIn ? (t._transferIn.note || '').toLowerCase() : '';
                return note.includes(noteFilter) || outNote.includes(noteFilter) || inNote.includes(noteFilter);
              })
            : merged;

        if (filtered.length === 0) {
            const emptyMsg = noteFilter ? '没有匹配备注的交易' : '暂无交易记录';
            showEmpty(tbodyEl, emptyMsg, '📭');
            this.renderPager(0, 1);
            return;
        }

        // 取数与渲染分离：refresh() 负责拉数据，renderPage() 负责切片+渲染。
        // 翻页只调 renderPage()，不再打接口。
        this._pageRows = filtered;
        this.renderPage();
    },

    /**
     * 渲染当前页（切片 + 分组 + 生成 DOM + 绑事件 + 渲染翻页条）。
     * 数据源是 this._pageRows（由 refresh() 填充），本方法**不发网络请求**。
     */
    renderPage() {
        const tbodyEl = document.getElementById('transTbody');
        if (!tbodyEl) return;
        const filtered = this._pageRows || [];

        // ===== 翻页：按「行」切片，不按「日期组」切片 =====
        // 按组切片会让每页条数忽多忽少（某天 1 笔、某天 30 笔），页高剧烈跳动。
        // 按行切片则每页恒定 _pageSize 条，一个日期组跨页时两页各显示自己那部分，
        // 两边都带完整的日期头 —— 用户不会看到「无头的孤立行」。
        const totalPages = Math.max(1, Math.ceil(filtered.length / this._pageSize));
        if (this._page > totalPages) this._page = totalPages;
        if (this._page < 1) this._page = 1;
        const start = (this._page - 1) * this._pageSize;
        const pageItems = filtered.slice(start, start + this._pageSize);

        // 按日期分组（使用日期字符串避免时区偏移）
        // ⚠️ 必须在切片**之后**分组，否则跨页组会被算进不属于本页的行
        const groups = {};
        pageItems.forEach(t => {
            const { y, m, d } = parseDateParts(t.date);
            const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (!groups[key]) groups[key] = { date: t.date, items: [] };
            groups[key].items.push(t);
        });
        const groupKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

        const renderRow = (t) => {
            const isTransfer = t.type === 'transfer_in' || t.type === 'transfer_out';
            const time = fmtTransTime(t.date);
            const typeLabel = isTransfer ? '转账' : (t.type === 'income' ? '收入' : '支出');
            const typeClass = isTransfer ? 'transfer' : t.type;
            const catObj = (t.category && (t.category.icon || t.category.name))
                ? t.category
                : (typeof getCat === 'function' ? getCat(t.categoryId || t.category_id) : { name: '未分类', icon: '📌' });
            const categoryHtml = `<span class="trans-cat-icon">${escapeHtml(catObj.icon || "📌")}</span><span>${escapeHtml(catObj.name || '未分类')}</span>`;
            const tagsHtml = (t.tags && t.tags.length)
                ? t.tags.map(tg => `<span class="tag-badge" style="--tag-color:${tg.color}">${escapeHtml(tg.icon)} ${escapeHtml(tg.name)}</span>`).join('')
                : '';

                        // 只有配成对的转账（有 transfer 主记录）才渲染成「A → B」。
                // 债务还款生成的跨账户流水没有 transfer 主记录，拿不到双端账户名，
                // 硬走这个分支会显示成「? → ?」，退化成普通行按自身账户展示。
                if (isTransfer && (t._transferOut || t._transferIn)) {
                const outAcc = t._transferOut ? t._transferOut.account : null;
                const inAcc = t._transferIn ? t._transferIn.account : null;
                const fromName = outAcc ? `${escapeHtml(outAcc.name || '')}` : '?';
                const toName = inAcc ? `${escapeHtml(inAcc.name || '')}` : '?';
                const fromNote = t._transferOut ? t._transferOut.note : '';
                const noteText = fromNote || t.note || '';
                const id = t._transferOut ? t._transferOut.id : t.id;
                return `
                    <div class="trans-row transfer" data-id="${id}">
                        <div class="trans-td trans-time">${time}</div>
                        <div class="trans-td trans-type">${typeLabel}</div>
                        <div class="trans-td trans-category">${categoryHtml}</div>
                        <div class="trans-td trans-amount transfer">${fmtSigned(t.amount, 'transfer_in')}</div>
                        <div class="trans-td trans-account">${fromName} → ${toName}</div>
                        <div class="trans-td trans-tags">${tagsHtml}</div>
                        <div class="trans-td trans-desc">${escapeHtml(noteText)}</div>
                        <div class="trans-td trans-actions">
                            <button data-action="edit-trans" data-id="${id}"${t.link_type === 'account_interest' ? ' data-link="account_interest"' : (t.investment_txn_id != null ? ' data-link="investment"' : (t.link_type === 'debt_repayment' ? ' data-link="debt_repayment"' : ''))} title="编辑">✏️</button>
                            <button data-action="copy-trans" data-id="${id}"${t.link_type === 'account_interest' ? ' data-link="account_interest"' : (t.investment_txn_id != null ? ' data-link="investment"' : (t.link_type === 'debt_repayment' ? ' data-link="debt_repayment"' : ''))} title="复制">📄</button>
                            <button data-action="delete-trans" data-id="${id}"${t.link_type === 'account_interest' ? ' data-link="account_interest"' : (t.investment_txn_id != null ? ' data-link="investment"' : (t.link_type === 'debt_repayment' ? ' data-link="debt_repayment"' : ''))} title="删除">🗑️</button>
                        </div>
                    </div>`;
            }

            const accountName = `${escapeHtml(t.account?.name || '-')}`;
            // 由债务还款/理财操作生成的流水：改/删都必须回到对应管理页，
            // 直接动这类关联流水会让账户余额与债务剩余本金/持仓脱节
            const linked = t.link_type === 'debt_repayment'
                ? ` data-link="${escapeHtml(t.link_type)}"`
                : (t.link_type === 'account_interest'
                    ? ' data-link="account_interest"'
                    : (t.investment_txn_id != null ? ' data-link="investment"' : ''));
            return `
                <div class="trans-row ${typeClass}" data-id="${t.id}">
                    <div class="trans-td trans-time">${time}</div>
                    <div class="trans-td trans-type">${typeLabel}</div>
                    <div class="trans-td trans-category">${categoryHtml}</div>
                    <div class="trans-td trans-amount ${typeClass}">${fmtSigned(t.amount, t.type)}</div>
                    <div class="trans-td trans-account">${accountName}</div>
                    <div class="trans-td trans-tags">${tagsHtml}</div>
                    <div class="trans-td trans-desc">${escapeHtml(t.note || '')}</div>
                    <div class="trans-td trans-actions">
                        <button data-action="edit-trans" data-id="${t.id}"${linked} title="编辑">✏️</button>
                        <button data-action="copy-trans" data-id="${t.id}"${linked} title="复制">📄</button>
                        <button data-action="delete-trans" data-id="${t.id}"${linked} title="删除">🗑️</button>
                    </div>
                </div>`;
        };

        const tbody = groupKeys.map(key => {
            const g = groups[key];
            return `
                <div class="trans-date-group">
                    <div class="trans-date-header">${fmtDateGroupHeader(g.date)}</div>
                    ${g.items.map(t => renderRow(t)).join('')}
                </div>
            `;
        }).join('');

        tbodyEl.innerHTML = tbody;
        this.renderPager(filtered.length, totalPages);

        // 事件委托：编辑和删除按钮
        // 债务还款生成的流水必须从债务管理入口改，否则余额与债务剩余本金会脱节
        tbodyEl.querySelectorAll('[data-action="edit-trans"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.link === 'debt_repayment') {
                    showToast('该流水由债务还款生成，请在「债务管理 · 明细」中修改', 'info');
                    return;
                }
                if (btn.dataset.link === 'investment') {
                    showToast('该流水由理财操作生成，请在「理财管理 · 持仓详情」中修改', 'info');
                    return;
                }
                if (btn.dataset.link === 'account_interest') {
                    showToast('该流水由账户计息生成，请在「账户管理 · 账户详情」中修改', 'info');
                    return;
                }
                this.openModal(parseInt(btn.dataset.id));
            });
        });
        tbodyEl.querySelectorAll('[data-action="delete-trans"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.link === 'debt_repayment') {
                    showToast('该流水由债务还款生成，请在「债务管理 · 明细」中删除', 'info');
                    return;
                }
                if (btn.dataset.link === 'investment') {
                    showToast('该流水由理财操作生成，请在「理财管理 · 持仓详情」中删除', 'info');
                    return;
                }
                if (btn.dataset.link === 'account_interest') {
                    showToast('该流水由账户计息生成，请在「账户管理 · 账户详情」中删除', 'info');
                    return;
                }
                this.delete(parseInt(btn.dataset.id));
            });
        });
        // 复制按钮：克隆一笔完全相同的交易记录
        // 关联流水（债务还款/理财/计息）同样必须回对应管理页处理，否则会脱离管理页成为游离交易
        tbodyEl.querySelectorAll('[data-action="copy-trans"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (btn.dataset.link === 'debt_repayment') {
                    showToast('该流水由债务还款生成，请在「债务管理 · 明细」中处理', 'info');
                    return;
                }
                if (btn.dataset.link === 'investment') {
                    showToast('该流水由理财操作生成，请在「理财管理 · 持仓详情」中处理', 'info');
                    return;
                }
                if (btn.dataset.link === 'account_interest') {
                    showToast('该流水由账户计息生成，请在「账户管理 · 账户详情」中处理', 'info');
                    return;
                }
                await this.duplicate(parseInt(btn.dataset.id));
            });
        });
    },

    /**
     * 克隆一笔交易：取原记录全部字段，新增一条一模一样的记录。
     * 转账走 /transfers（双腿），普通交易走 /transactions。
     */
    async duplicate(id) {
        const numId = parseInt(id);
        if (!numId) return;
        let t;
        try {
            t = await api(`/transactions/${numId}`, 'GET', null, { silent: true });
        } catch (e) {
            showToast('找不到该交易，请刷新页面后重试', 'warning');
            return;
        }
        if (!t) { showToast('找不到该交易，请刷新页面后重试', 'warning'); return; }
        try {
            if (t.transfer) {
                const body = {
                    from_account_id: t.transfer.from_account_id,
                    to_account_id: t.transfer.to_account_id,
                    amount: t.amount,
                    date: t.date,
                    note: t.note || '',
                    category_id: t.category_id || null
                };
                await api('/transfers', 'POST', body);
            } else {
                const body = {
                    account_id: t.account_id ?? (t.account && t.account.id) ?? null,
                    category_id: t.category_id ?? (t.category && t.category.id) ?? null,
                    budget_id: t.budget_id ?? null,
                    type: t.type,
                    amount: t.amount,
                    date: t.date,
                    note: t.note || '',
                    tags: Array.isArray(t.tags) ? t.tags.map(x => x.id ?? x) : []
                };
                await api('/transactions', 'POST', body);
            }
            showToast('已复制并新增一笔相同交易', 'success');
            await initCache();
            await this.refresh();
        } catch (e) {
            // api() 已显示错误 toast
        }
    },

    /**
     * 渲染翻页条。
     * ⛔ 只渲染 UI 与绑定事件，**不重新请求接口** —— 数据已在 this._pageRows 内存里，
     *    翻页只是换个切片重渲染，因此 goToPage 走的是 renderPage() 而非 refresh()。
     * 页码策略：首页 / 末页恒显，当前页两侧各留 1 页，其余折叠为 …
     * （27 组 200 条时是 4 页，但账本长起来后不能让页码把整行撑爆）
     */
    renderPager(totalRows, totalPages) {
        const pagerEl = document.getElementById('transPager');
        if (!pagerEl) return;
        // 只有一页时整条隐藏，避免底部多出一块无意义的空卡片
        if (totalPages <= 1) {
            pagerEl.innerHTML = '';
            pagerEl.style.display = 'none';
            return;
        }
        pagerEl.style.display = '';

        const cur = this._page;
        const nums = [];
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || Math.abs(i - cur) <= 1) nums.push(i);
            else if (nums[nums.length - 1] !== '...') nums.push('...');
        }

        const from = (cur - 1) * this._pageSize + 1;
        const to = Math.min(cur * this._pageSize, totalRows);

        pagerEl.innerHTML = `
            <div class="pager-info">第 ${from}-${to} 条 / 共 ${totalRows} 条</div>
            <div class="pager-ctrl">
                <button class="pager-btn" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="上一页">‹</button>
                ${nums.map(n => n === '...'
                    ? `<span class="pager-gap" aria-hidden="true">···</span>`
                    : `<button class="pager-btn ${n === cur ? 'active' : ''}" data-page="${n}" ${n === cur ? 'aria-current="page"' : ''}>${n}</button>`
                ).join('')}
                <button class="pager-btn" data-page="${cur + 1}" ${cur === totalPages ? 'disabled' : ''} aria-label="下一页">›</button>
            </div>
            <div class="pager-size">
                <label for="transPageSize">每页</label>
                <select id="transPageSize" class="filter-select">
                    ${[20, 50, 100].map(n => `<option value="${n}" ${n === this._pageSize ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
            </div>
        `;

        pagerEl.querySelectorAll('.pager-btn[data-page]').forEach(btn => {
            if (btn.disabled) return;
            btn.addEventListener('click', () => this.goToPage(parseInt(btn.dataset.page)));
        });
        const sizeSel = document.getElementById('transPageSize');
        if (sizeSel) sizeSel.addEventListener('change', () => {
            this._pageSize = parseInt(sizeSel.value);
            this._page = 1;
            this.renderPage();
        });
    },

    /** 跳到指定页并把视口回到列表顶部 */
    goToPage(page) {
        const totalPages = Math.max(1, Math.ceil(this._pageRows.length / this._pageSize));
        if (page < 1 || page > totalPages || page === this._page) return;
        this._page = page;
        this.renderPage();
        // 翻页后必须回到列表顶部：否则停在上一页的滚动位置，
        // 新一页的前几条被吸顶的筛选行挡住，看起来像「翻页没反应」。
        // 真实滚动容器是 .main-content（不是 document.scrollingElement）。
        const scroller = document.querySelector('.main-content');
        if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

export default TransactionManager;

