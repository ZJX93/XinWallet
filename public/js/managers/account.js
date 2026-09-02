// ============================================================
// AccountManager —— 账户管理模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 1104 行 ~ 第 1253 行（共 150 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、showToast、showSkeleton、
//                    getAcc、initCache、cache，以及 DOM 元素
//                    （addAccountBtn、accModalClose、accCancelBtn、
//                    accForm、reconcileBtn、accountDetailModalClose、
//                    accountDetailModal、accountList、accTotalAssets、
//                    accountModal、accEditId、accName、accType、
//                    accIcon、accBalance、accModalTitle、
//                    accountDetailBody 等）
// ============================================================

const AccountManager = {
    init() {
        document.getElementById('addAccountBtn').addEventListener('click', () => this.openModal());
        const showClosed = document.getElementById('showClosedAcc');
        if (showClosed) showClosed.addEventListener('change', () => this.refresh());
        document.getElementById('accModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('accCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('accForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        document.getElementById('accType').addEventListener('change', () => this.toggleCreditLimit());
        document.getElementById('reconcileBtn').addEventListener('click', () => this.reconcile());
        // 账户资金明细模态框
        document.getElementById('accountDetailModalClose').addEventListener('click', () => this.closeDetail());
        document.getElementById('accountDetailModal').addEventListener('click', (e) => { if (e.target === document.getElementById('accountDetailModal')) this.closeDetail(); });
        // 记利息模态框
        document.getElementById('interestModalClose').addEventListener('click', () => this.closeInterestModal());
        document.getElementById('interestCancelBtn').addEventListener('click', () => this.closeInterestModal());
        document.getElementById('interestModal').addEventListener('click', (e) => { if (e.target === document.getElementById('interestModal')) this.closeInterestModal(); });
        document.getElementById('interestForm').addEventListener('submit', (e) => { e.preventDefault(); this.saveInterest(); });
        // 账户删除确认模态框
        document.getElementById('accDelModalClose').addEventListener('click', () => this.closeDeleteModal());
        document.getElementById('accDelCancelBtn').addEventListener('click', () => this.closeDeleteModal());
        document.getElementById('accountDeleteModal').addEventListener('click', (e) => { if (e.target === document.getElementById('accountDeleteModal')) this.closeDeleteModal(); });
        document.getElementById('accDelCloseBtn').addEventListener('click', () => this.closeAccount());
        document.getElementById('accDelHardBtn').addEventListener('click', () => this.hardDeleteAccount());
        // 账户全屏网格
        const accGridClose = document.getElementById('accGridClose');
        if (accGridClose) accGridClose.addEventListener('click', () => this.closeAccGrid());
        const accGridOverlay = document.getElementById('accGridOverlay');
        if (accGridOverlay) accGridOverlay.addEventListener('click', (e) => { if (e.target === accGridOverlay) this.closeAccGrid(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.closeAccGrid(); this.closeDetail(); this.closeDeleteModal(); this.closeModal(); this.closeInterestModal(); } });
    },
    // 复式记账对账：以账本为唯一真相，重算并修正账户余额
    async reconcile() {
        showToast('正在以账本重算余额…', 'info');
        const r = await api('/accounts/reconcile', 'POST');
        if (r) {
            if (r.reconciled > 0) showToast(`已对账：修正 ${r.reconciled} 个账户，差额合计 ${fmt(r.totalAdjusted)}`, 'success');
            else showToast('账户余额与账本一致，无需修正', 'success');
            await initCache();
            await this.refresh();
        }
    },
    async refresh() {
        const container = document.getElementById('accountList');
        showSkeleton(container, 4, 'list');
        // 始终请求全部账户（含已销户），由 showClosedAcc 复选框控制是否显示
        const data = await api('/accounts?all=1');
        if (!data) return;
        cache.accounts = data.accounts;
        document.getElementById('accTotalAssets').textContent = fmt(data.totalAssets);
        const typeLabels = { cash: '现金', bank_card: '储蓄卡', credit_card: '信用卡', electronic_payment: '电子支付', financial_account: '金融账户', digital: '数字货币', other: '其他' };
        this.typeLabels = typeLabels;

        const showClosed = !!(document.getElementById('showClosedAcc') && document.getElementById('showClosedAcc').checked);
        const activeAccounts = (data.accounts || []).filter(a => !a.closed);
        if (activeAccounts.length === 0) { showEmpty(container, '还没有账户，点击「新增账户」开始记录你的资产', '🏦'); return; }

        // 按类型分组（按语义顺序排），每组一张大封面卡 + 下方牌堆叠放子卡。
        // 视觉：5 个组（现金/储蓄卡/信用卡/电子支付/金融账户）横排，封面卡突出展示组信息，
        // 子卡向下叠放仅露顶部一条边（这就是用户喜欢的「牌堆叠卡」精致感）。
        // 操作按钮修复：每张子卡自带 4 个按钮，hover 任一张自动浮到最上层可见。
        const typeOrder = ['cash', 'bank_card', 'credit_card', 'electronic_payment', 'financial_account', 'digital', 'other'];
        const groups = {};
        activeAccounts.forEach(a => {
            const key = a.type || 'other';
            (groups[key] = groups[key] || []).push(a);
        });
        const groupList = Object.entries(groups)
            .sort((a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0]));

        /**
         * 子账户牌：结构与理财持仓卡（investment.js buildCard）完全同构 —— 同样是
         * .goal-card.acc-stack-card + goal-head / goal-amounts / goal-actions 三段，
         * 复用同一套已验证的叠牌 CSS，不另造样式体系。
         *
         * meta 显示规则：若 name 已包含 type 标签文字（「现金/储蓄卡/信用卡」常出现于账户名），
         * 省略重复类型段，否则显示类型 + 年利率，便于一眼分辨账户性质。
         */
        const buildRow = (a, idx, n) => {
            const tlabel = typeLabels[a.type] || a.type || '';
            const nameHasType = tlabel && a.name && a.name.includes(tlabel);
            const limit = Number(a.credit_limit) || 0;
            // 授信账户（信用卡 / 带额度的电子支付）：余额为负即占用授信，
            // 可用额度 = 额度 - 已用。只显示「总额度」的话，还款后数字纹丝不动，
            // 用户会以为额度没恢复。
            const bal = Number(a.balance) || 0;
            const owes = bal <= 0 ? Math.max(0, -bal) : Math.max(0, limit - bal);
            const avail = limit > 0 ? Math.max(0, limit - owes) : 0;
            const limitText = limit > 0
                ? `可用 <strong>${fmt(avail)}</strong> / 额度 ${fmt(limit)}`
                : '';
            return `
            <div class="goal-card acc-stack-card" data-id="${a.id}" style="--i:${idx}; --n:${n}">
                <div class="acc-card-top">
                    <div class="goal-head">
                        <div class="goal-icon">${escapeHtml(a.icon || '🏦')}</div>
                        <div class="goal-title" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
                        ${nameHasType ? '' : `<span class="goal-status type">${escapeHtml(tlabel)}</span>`}
                    </div>
                    <div class="goal-amounts inv-cover-meta">
                        <span>${limitText}</span>
                    </div>
                </div>
                <div class="acc-card-mid">
                    <div class="inv-cover-profit-label">当前余额</div>
                    <div class="acc-card-amount">${fmt(a.balance)}</div>
                </div>
                <div class="goal-actions">
                    <button class="btn btn-ghost" data-action="acc-detail" data-id="${a.id}" title="明细">明细</button>
                    <button class="btn btn-ghost" data-action="interest-acc" data-id="${a.id}" title="计息">计息</button>
                    <button class="btn btn-ghost" data-action="edit-acc" data-id="${a.id}" title="编辑">编辑</button>
                    <button class="btn btn-ghost" data-action="delete-acc" data-id="${a.id}" title="销户/删除">删除</button>
                </div>
            </div>`;
        };

        const groupsHtml = groupList.map(([type, accounts]) => {
            const label = typeLabels[type] || type;
            const total = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
            const icon = accounts[0].icon || '🏦';
            const n = accounts.length;
            const posCount = accounts.filter(a => (Number(a.balance) || 0) >= 0).length;
            const negCount = n - posCount;
            // 封面卡 = 牌堆第一张（--i:0，在文档流内撑高度），与理财封面卡同构
            const coverCard = `
                <div class="goal-card acc-stack-card acc-deck-card" data-type="${escapeHtml(type)}" style="--i:0; --n:${n + 1}">
                    <div class="acc-card-top">
                        <div class="goal-head">
                            <div class="goal-icon">${escapeHtml(icon)}</div>
                            <div class="goal-title">${escapeHtml(label)}</div>
                            <span class="inv-cover-count">${n} 个账户</span>
                        </div>
                        <div class="goal-amounts inv-cover-meta"><span>账户数 <strong>${n}</strong></span><span>类型 <strong>${escapeHtml(label)}</strong></span></div>
                    </div>
                    <div class="acc-card-mid">
                        <div class="inv-cover-profit-label">账户总资产</div>
                        <div class="inv-cover-profit-amount">${fmt(total)}</div>
                    </div>
                    <div class="inv-cover-bottom">
                        <div class="inv-cover-stats"><span>正余额 <strong class="goal-pct profit-positive">${posCount}</strong> 个</span>${negCount > 0 ? `<span>负余额 <strong class="goal-pct profit-negative">${negCount}</strong> 个</span>` : ''}</div>
                        <div class="inv-cover-foot"><span class="inv-cover-viewall">查看全部 →</span></div>
                    </div>
                </div>`;
            const cards = accounts.map((a, idx) => buildRow(a, idx + 1, n + 1)).join('');
            return `
            <div class="acc-stack">
                <div class="acc-stack-cards" style="--n:${n + 1}">${coverCard}${cards}</div>
            </div>`;
        }).join('');

        // 已销户账户：默认隐藏，开启「显示已销户」才展示为一个独立牌堆
        const closedAccounts = (data.accounts || []).filter(a => a.closed);
        const closedHtml = (showClosed && closedAccounts.length > 0) ? (() => {
            const cn = closedAccounts.length;
            const cover = `
                <div class="goal-card acc-stack-card acc-deck-card" data-type="__closed__" style="--i:0; --n:${cn + 1}; opacity:.75">
                    <div class="acc-card-top">
                        <div class="goal-head">
                            <div class="goal-icon">🗄️</div>
                            <div class="goal-title">已销户</div>
                            <span class="inv-cover-count">${cn} 个账户</span>
                        </div>
                    </div>
                    <div class="acc-card-mid">
                        <div class="inv-cover-profit-label">历史余额合计</div>
                        <div class="inv-cover-profit-amount">${fmt(closedAccounts.reduce((s, a) => s + (Number(a.balance) || 0), 0))}</div>
                    </div>
                    <div class="inv-cover-bottom"><div class="inv-cover-stats"></div></div>
                </div>`;
            const cards = closedAccounts.map((a, idx) => `
                <div class="goal-card acc-stack-card" data-id="${a.id}" style="--i:${idx + 1}; --n:${cn + 1}; opacity:.75">
                    <div class="acc-card-top">
                        <div class="goal-head">
                            <div class="goal-icon">${escapeHtml(a.icon || '🏦')}</div>
                            <div class="goal-title" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
                            <span class="goal-status type">已销户</span>
                        </div>
                    </div>
                    <div class="acc-card-mid">
                        <div class="inv-cover-profit-label">历史余额</div>
                        <div class="acc-card-amount is-closed">${fmt(a.balance)}</div>
                    </div>
                    <div class="goal-actions">
                        <button class="btn btn-ghost" data-action="acc-detail" data-id="${a.id}" title="明细">明细</button>
                        <button class="btn btn-ghost" data-action="edit-acc" data-id="${a.id}" title="编辑">编辑</button>
                        <button class="btn btn-ghost" data-action="delete-acc" data-id="${a.id}" title="彻底删除">删除</button>
                    </div>
                </div>`).join('');
            return `<div class="acc-stack"><div class="acc-stack-cards" style="--n:${cn + 1}">${cover}${cards}</div></div>`;
        })() : '';

        container.innerHTML = groupsHtml + closedHtml;

        // 事件委托：明细、编辑、销户、计息（按钮一律 stopPropagation，不触发卡片弹出）
        container.querySelectorAll('[data-action="acc-detail"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.openDetail(parseInt(btn.dataset.id)); });
        });
        container.querySelectorAll('[data-action="edit-acc"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.openModal(parseInt(btn.dataset.id)); });
        });
        container.querySelectorAll('[data-action="delete-acc"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.openDeleteModal(parseInt(btn.dataset.id)); });
        });
        container.querySelectorAll('[data-action="interest-acc"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.openInterestModal(parseInt(btn.dataset.id)); });
        });
        // 封面卡（牌堆第一张）：点击打开该类型全屏网格，不参与子卡弹出逻辑
        container.querySelectorAll('.acc-deck-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                const t = card.dataset.type;
                if (t && t !== '__closed__') this.openAccGrid(t);
            });
        });
        // 子卡：点击弹出（置顶 + 上浮，露出操作按钮）；再点收起 —— 与理财持仓一致
        container.querySelectorAll('.acc-stack-card:not(.acc-deck-card)').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                const wasPopped = card.classList.contains('popped');
                container.querySelectorAll('.acc-stack-card.popped').forEach(c => c.classList.remove('popped'));
                if (!wasPopped) card.classList.add('popped');
            });
        });
    },
    toggleCreditLimit() {
        const type = document.getElementById('accType').value;
        const row = document.getElementById('accCreditLimitRow');
        const input = document.getElementById('accCreditLimit');
        const label = document.getElementById('accCreditLimitLabel');
        if (type === 'credit_card' || type === 'electronic_payment') {
            row.style.display = '';
            input.min = '0';
            if (type === 'credit_card') {
                label.childNodes[0].textContent = '信用额度 (¥) * ';
                input.required = true;
            } else {
                label.childNodes[0].textContent = '信用额度 (¥) ';
                input.required = false;
            }
        } else {
            row.style.display = 'none';
            input.required = false;
            input.value = '0';
        }
    },
    async openModal(id = null) {
        document.getElementById('accountModal').classList.add('show');
        if (id) {
            const a = getAcc(id);
            document.getElementById('accEditId').value = a.id;
            document.getElementById('accName').value = a.name;
            document.getElementById('accType').value = a.type;
            document.getElementById('accIcon').value = a.icon;
            // 初始余额可改，实时余额只读展示
            document.getElementById('accBalance').value = a.opening_balance ?? a.balance ?? 0;
            document.getElementById('accRealBalance').value = a.balance ?? 0;
            document.getElementById('accCreditLimit').value = a.credit_limit ?? 0;
            document.getElementById('accAnnualRate').value = a.annual_rate ?? 0;
            document.getElementById('accInterestCycle').value = a.interest_cycle || 'monthly';
            document.getElementById('accModalTitle').textContent = '编辑账户';
        } else {
            document.getElementById('accEditId').value = '';
            document.getElementById('accName').value = '';
            document.getElementById('accType').value = 'bank_card';
            document.getElementById('accIcon').value = '💰';
            document.getElementById('accBalance').value = 0;
            document.getElementById('accRealBalance').value = 0;
            document.getElementById('accCreditLimit').value = 0;
            document.getElementById('accAnnualRate').value = 0;
            document.getElementById('accInterestCycle').value = 'monthly';
            document.getElementById('accModalTitle').textContent = '新增账户';
        }
        this.toggleCreditLimit();
    },
    closeModal() { document.getElementById('accountModal').classList.remove('show'); },
    async save() {
        const id = document.getElementById('accEditId').value;
        const type = document.getElementById('accType').value;
        const limitVal = document.getElementById('accCreditLimit').value;
        const limit = limitVal === '' ? 0 : parseFloat(limitVal);
        if (type === 'credit_card' && (isNaN(limit) || limit <= 0)) {
            showToast('信用卡必须设置大于 0 的信用额度', 'warning');
            return;
        }
        const body = {
            name: document.getElementById('accName').value,
            type: type,
            icon: document.getElementById('accIcon').value,
            // 用户编辑的是「初始余额」，实时余额由服务端按流水重算
            opening_balance: parseFloat(document.getElementById('accBalance').value),
            credit_limit: limit,
            annual_rate: parseFloat(document.getElementById('accAnnualRate').value) || 0,
            interest_cycle: document.getElementById('accInterestCycle').value || 'monthly'
        };
        if (id) {
            await api(`/accounts/${id}`, 'PUT', body);
            showToast('账户已更新', 'success');
        } else {
            await api('/accounts', 'POST', body);
            showToast('账户已创建', 'success');
        }
        this.closeModal();
        await initCache();
        await this.refresh();
    },
    // 删除确认弹窗：先查关联数据，决定「彻底删除」是否可用
    async openDeleteModal(id) {
        const acc = getAcc(id);
        if (!acc) return;
        this._delId = id;
        document.getElementById('accDelName').textContent = `${acc.icon || ''} ${acc.name}（余额 ${fmt(acc.balance)}）`;
        const usageEl = document.getElementById('accDelUsage');
        const hardBtn = document.getElementById('accDelHardBtn');
        usageEl.textContent = '正在检查关联数据…';
        hardBtn.disabled = true;
        document.getElementById('accountDeleteModal').classList.add('show');
        const res = await api(`/accounts/${id}/usage`);
        if (!res) { this.closeDeleteModal(); return; }
        const u = res.usage || {};
        const parts = [
            ['交易', u.transactions], ['转账', u.transfers], ['还款', u.repayments],
            ['储蓄目标', u.goals], ['储蓄流水', u.savings_txns], ['债务', u.debts], ['理财持仓', u.investments]
        ].filter(([, n]) => parseInt(n) > 0);
        if (parts.length === 0) {
            usageEl.innerHTML = '<span class="acc-del-ok">无关联数据，可彻底删除。</span>';
            hardBtn.disabled = false;
            hardBtn.title = '';
        } else {
            const detail = parts.map(([label, n]) => `${label} ${n} 笔`).join('、');
            usageEl.innerHTML = `<span class="acc-del-warn">存在关联数据（${detail}），不可彻底删除。</span>`;
            hardBtn.disabled = true;
            hardBtn.title = '该账户有关联数据，请先清理或使用「关闭账户」';
        }
    },
    closeDeleteModal() {
        document.getElementById('accountDeleteModal').classList.remove('show');
        this._delId = null;
    },
    async hardDeleteAccount() {
        const id = this._delId;
        if (!id) return;
        await api(`/accounts/${id}`, 'DELETE'); // 失败会抛错，api() 已显示错误 toast（含 409 关联数据提示）
        showToast('账户已彻底删除', 'success');
        // 旧 AI 洞察/建议缓存可能仍引用该账户余额，立即失效
        try { localStorage.removeItem('xin_ai_insights'); localStorage.removeItem('xin_ai_advice'); } catch (e) {}
        this.closeDeleteModal();
        await initCache();
        await this.refresh();
    },
    async closeAccount() {
        const id = this._delId;
        if (!id) return;
        await api(`/accounts/${id}/close`, 'POST'); // 失败会抛错
        showToast('账户已关闭（历史保留）', 'warning');
        try { localStorage.removeItem('xin_ai_insights'); localStorage.removeItem('xin_ai_advice'); } catch (e) {}
        this.closeDeleteModal();
        await initCache();
        await this.refresh();
    },
    async openDetail(id) {
        const modal = document.getElementById('accountDetailModal');
        const body = document.getElementById('accountDetailBody');
        const acc0 = getAcc(id);
        const isClosed = !!(acc0 && acc0.closed);
        modal.classList.add('show');
        body.innerHTML = '<div class="empty-state">⏳ 加载中…</div>';
        const res = await api(`/accounts/${id}/transactions`);
        if (!res) { body.innerHTML = '<div class="empty-state">⚠️ 加载失败，请检查网络</div>'; return; }
        const acc = res.account || {};
        const list = res.transactions || [];
        const subBits = [`共 ${list.length} 笔资金变动`];
        if (acc.last_interest_date) subBits.push(`上次计息 <strong>${escapeHtml(acc.last_interest_date)}</strong>`);
        if (Number(acc.annual_rate) > 0) subBits.push(`年利率 <strong>${(Number(acc.annual_rate) || 0).toFixed(4)}%</strong>`);
        // 操作按钮组（始终可见）：记利息、编辑、销户/删除 ——
        // 不再依赖列表页的"⋯"按钮（用户反馈过「功能重复」/「点不动」）。
        // 已销户账户隐藏所有破坏性操作，只留关闭。
        const actions = isClosed ? `
            <button class="btn btn-ghost btn-sm" data-detail-action="close" data-id="${id}">关闭</button>
        ` : `
            <button class="btn btn-ghost btn-sm" data-detail-action="interest" data-id="${id}">记利息</button>
            <button class="btn btn-ghost btn-sm" data-detail-action="edit" data-id="${id}">编辑</button>
            <button class="btn btn-ghost btn-sm" data-detail-action="close-acct" data-id="${id}">销户</button>
        `;
        const head = `<div class="rh-head">
            <div class="rh-debt">${escapeHtml(acc.icon || '')} ${escapeHtml(acc.name || '账户')} · 资金明细</div>
            <div class="rh-sub">${subBits.join(' · ')}</div>
            <div class="rh-actions">${actions}</div>
        </div>`;
        if (!list.length) {
            body.innerHTML = head + '<div class="empty-state">📭 该账户暂无资金变动记录</div>';
        } else {
            const typeMeta = {
                expense: { dir: '−', cls: 'negative', label: '支出' },
                income: { dir: '+', cls: 'positive', label: '收入' },
                transfer_out: { dir: '−', cls: 'negative', label: '转出' },
                transfer_in: { dir: '+', cls: 'positive', label: '转入' },
                repayment: { dir: '−', cls: 'negative', label: '还款' }
            };
            const rows = list.map(t => {
                const m = typeMeta[t.type] || { dir: '', cls: '', label: t.type };
                // 利息（账户记利息 / 利息·收益·分红类收入）、投资关联（investment_txn_id）、
                // 债务还款（kind='repayment'）均有各自来源模块/交易页管理，账户明细不提供行内
                // 修改/删除；仅普通手动记账流水（餐饮、购物、工资等）保留行内修改/删除。
                const isInterest = t.link_type === 'account_interest'
                    || (t.type === 'income' && t.category && /(利息|收益|分红)/.test(t.category.name || ''));
                const sub = t.kind === 'repayment'
                    ? (t.debt ? `还 ${escapeHtml(t.debt.name || '债务')}` : '还款')
                    : (t.category ? `${escapeHtml(t.category.icon || '')} ${escapeHtml(t.category.name || '')}` : '')
                        + (t.counterparty ? ` ${t.counterparty.dir} ${escapeHtml(t.counterparty.name || '')}` : '');
                return `
                <div class="rh-item">
                    <div class="rh-row1">
                        <span class="rh-amount ${m.cls}">${m.dir}${fmt(t.amount)}</span>
                        <span class="rh-date">${t.date || ''}</span>
                        ${(!t.investment_txn_id && !isInterest) ? `<span class="rh-actions"><button class="rh-edit-btn" data-detail-action="edit-txn" data-id="${t.id}" title="修改">修改</button><button class="rh-del-btn" data-detail-action="delete-txn" data-id="${t.id}" title="删除">删除</button></span>` : ''}
                    </div>
                    <div class="rh-row2">
                        <span class="rh-tag">${m.label}${sub ? ' · ' + sub : ''}</span>
                    </div>
                    ${t.note ? `<div class="rh-note">📝 ${escapeHtml(t.note)}</div>` : ''}
                </div>`;
            }).join('');
            body.innerHTML = head + `<div class="rh-list">${rows}</div>`;
        }
        // 操作按钮事件委托：编辑、销户、关闭、计息
        body.querySelectorAll('[data-detail-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const aid = parseInt(btn.dataset.id);
                if (isNaN(aid)) return;
                switch (btn.dataset.detailAction) {
                    case 'interest': this.openInterestModal(aid); break;
                    case 'edit':
                        this.closeDetail();
                        this.openModal(aid);
                        break;
                    case 'close-acct':
                        this.closeDetail();
                        this.openDeleteModal(aid);
                        break;
                    case 'close': this.closeDetail(); break;
                    case 'delete-txn': await this.deleteAccTxn(parseInt(btn.dataset.id), id); break;
                    case 'edit-txn': {
                        const targetId = parseInt(btn.dataset.id, 10);
                        const txn = list.find(t => Number(t.id) === targetId);
                        if (!txn) {
                            console.warn('[account.edit-txn] 未找到流水 data-id=' + btn.dataset.id);
                            break;
                        }
                        if (txn.link_type === 'account_interest') {
                            // 仅账户记利息流水用专用弹窗（利息入口隐藏后通常不会走到这里）
                            this.openInterestModal(id, txn);
                        } else {
                            // 普通流水：账户页无通用流水编辑器，转「交易」页修改，
                            // 避免 openInterestModal 把普通流水误标为账户利息。
                            showToast('该流水请在「交易」页修改', 'info');
                        }
                        break;
                    }
                }
            });
        });
    },
    closeDetail() { document.getElementById('accountDetailModal').classList.remove('show'); },

    /* ---- 记一笔利息（与安卓端 AccountDetailScreen.AddInterestDialog 对齐） ---- */
    openInterestModal(id, txn = null) {
        const a = getAcc(id);
        if (!a) return;
        this._interestAccId = id;
        this._editingInterestTxnId = txn ? txn.id : null;
        this._editingInterestCatId = txn ? txn.category_id : null;
        // 默认计息时间精确到秒（datetime-local 格式），使「未填日期」时记录真实时刻而非仅当天
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        document.getElementById('interestModalTitle').textContent = txn ? `编辑利息 · ${a.icon || ''} ${a.name}` : `记利息 · ${a.icon || ''} ${a.name}`;
        document.getElementById('interestAmount').value = txn ? txn.amount : '';
        // 编辑既有利息时回填到秒（transactions.date 可能为 YYYY-MM-DD HH:MM:SS，转 datetime-local 的 T 分隔）
        document.getElementById('interestDate').value = txn ? String(txn.date || '').replace(' ', 'T').slice(0, 19) : today;
        document.getElementById('interestNote').value = txn ? (txn.note ? String(txn.note).replace(/^利息-[^-]*-?/, '') : '') : '';
        document.getElementById('interestError').style.display = 'none';
        document.getElementById('interestSubmitBtn').disabled = false;
        document.getElementById('interestSubmitBtn').textContent = '确认';
        document.getElementById('interestModal').classList.add('show');
        setTimeout(() => document.getElementById('interestAmount').focus(), 50);
    },
    closeInterestModal() {
        document.getElementById('interestModal').classList.remove('show');
        this._interestAccId = null;
    },
    // 删除账户详情里某笔利息流水（与记利息同源：删交易 + 余额回退）。
    // 走通用 DELETE /transactions/:id，余额由账本重算，删除后刷新详情。
    async deleteAccTxn(txnId, accId) {
        if (!window.confirm('确定删除这笔利息流水？账户余额将回退。')) return;
        // 注意：api() 返回的是响应体的 data.data 字段，而 DELETE /transactions/:id
        // 后端返回 success(null, ...)，data.data 为 null —— 不能用 `if (r)` 判断成功，
        // 否则刷新逻辑永远被跳过（流水已删却仍留在界面、余额不回退）。
        // api() 失败一定会 throw（统一 API 层已弹错误 toast），成功（即便返回 null）即代表删除成功，
        // 因此用 try/catch 包裹、不依赖 r 的真值。
        try {
            await api(`/transactions/${txnId}`, 'DELETE');
            showToast('已删除利息流水', 'success');
            await this.openDetail(accId);
            // 余额由账本重算，需刷新账户缓存 + 外层账户列表 + Dashboard KPI，
            // 否则账户卡片/Dashboard 仍显示旧余额，需手动切页才更新。
            await initCache();
            await this.refresh();
            if (window.DashboardManager) await window.DashboardManager.refresh();
        } catch (e) {
            // api() 已在失败时弹错误 toast，这里无需重复提示
        }
    },
    async saveInterest() {
        const id = this._interestAccId;
        if (!id) return;
        const amt = parseFloat(document.getElementById('interestAmount').value);
        const date = document.getElementById('interestDate').value;
        const note = (document.getElementById('interestNote').value || '').trim();
        const errEl = document.getElementById('interestError');
        const btn = document.getElementById('interestSubmitBtn');
        if (isNaN(amt) || amt <= 0) { errEl.textContent = '请输入大于 0 的利息金额'; errEl.style.display = ''; return; }
        if (!date) { errEl.textContent = '请选择计息日期'; errEl.style.display = ''; return; }
        errEl.style.display = 'none';
        btn.disabled = true; btn.textContent = '提交中…';
        try {
            if (this._editingInterestTxnId) {
                // PUT /transactions/:id 后端返回 success(null, …)，api() 返回 data.data 即 null，
                // 用 `if (res)` 判断会让刷新全被跳过。api() 失败必 throw，成功（含 null）即代表已更新。
                const acc = getAcc(id);
                const finalNote = note ? `利息-${acc.name}-${note}` : `利息-${acc.name}`;
                await api(`/transactions/${this._editingInterestTxnId}`, 'PUT', {
                    account_id: id, category_id: this._editingInterestCatId, type: 'income',
                    amount: amt, date, note: finalNote, link_type: 'account_interest', link_id: id
                });
                showToast('利息已更新', 'success');
                this.closeInterestModal();
                await this.syncAfterInterestChange(id);
                return;
            }
            await api(`/accounts/${id}/interest`, 'POST', { amount: amt, date, note: note || undefined });
            showToast('利息已记录', 'success');
            this.closeInterestModal();
            await this.syncAfterInterestChange(id);
        } catch (e) {
            btn.disabled = false; btn.textContent = '确认';
            errEl.textContent = (e && e.message) || '提交失败，请重试';
            errEl.style.display = '';
        }
    },

    /**
     * 利息新增/编辑后的统一刷新。
     *
     * 记利息会生成（或改动）一笔 income 流水并重算账户余额。只刷外层账户列表是不够的：
     * 用户是从「账户详情弹窗」点开记息弹窗的，提交后关掉的只是记息弹窗、详情弹窗仍叠在下面，
     * 若不同步 openDetail，详情里的流水列表和余额就还是提交前的旧数据（表现为"记了息却没变化"）。
     *
     * 所以三处都要刷：详情弹窗 → 账户缓存 → 外层账户卡片 → Dashboard KPI。
     */
    async syncAfterInterestChange(accId) {
        await this.openDetail(accId);
        await initCache();
        await this.refresh();
        if (window.DashboardManager) await window.DashboardManager.refresh();
    },

    /* ---- 账户：全屏网格铺开 ---- */
    buildAccGridCard(a) {
        const typeLabels = { cash: '现金', bank_card: '储蓄卡', credit_card: '信用卡', electronic_payment: '电子支付', financial_account: '金融账户', digital: '数字货币', other: '其他' };
        return `
        <div class="acc-grid-card" data-acc-id="${a.id}" tabindex="0" role="button" aria-label="${escapeHtml(a.name)} 资金明细">
            <div class="goal-head">
                <div class="goal-icon">${escapeHtml(a.icon || '🏦')}</div>
                <div class="goal-title">${escapeHtml(a.name)}</div>
            </div>
            <div class="goal-amounts"><span>${typeLabels[a.type] || a.type}</span><span><strong>${fmt(a.balance)}</strong></span></div>
        </div>`;
    },
    openAccGrid(type) {
        const all = (cache.accounts || []).filter(a => !a.closed);
        const items = type ? all.filter(a => a.type === type) : all;
        if (!items.length) { showToast(type ? '该类型暂无账户' : '暂无账户', 'warning'); return; }
        const grid = document.getElementById('accGridBody');
        grid.innerHTML = items.map(a => this.buildAccGridCard(a)).join('');
        const label = type ? (this.typeLabels[type] || type) : '全部账户';
        document.getElementById('accGridTitle').textContent = label;
        document.getElementById('accGridCount').textContent = items.length;
        grid.querySelectorAll('[data-acc-id]').forEach(card => {
            const handler = () => { const id = parseInt(card.dataset.accId); if (!isNaN(id)) this.openDetail(id); };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
        });
        document.getElementById('accGridOverlay').classList.add('show');
    },
    closeAccGrid() {
        const ov = document.getElementById('accGridOverlay');
        if (ov) ov.classList.remove('show');
    }
};

export default AccountManager;
