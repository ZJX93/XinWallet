// ============================================================
// InvestmentManager —— 理财管理模块
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 1910 行 ~ 第 2271 行（共 362 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、fmt、fmtDate、showToast、
//                    showSkeleton、showEmpty、cache、ChartManager，
//                    以及 DOM 元素
//                    （addInvestBtn、investModalClose、investCancelBtn、
//                    investForm、investQuoteBtn、refreshAllBtn、investType、
//                    investAccount、reduceForm、reduceModalClose、
//                    reduceCancelBtn、investBuyDate、investBuyPrice、
//                    investCurrentPrice、investQuantity、investFee、
//                    investTotalCost、investCurrentValue、investModal、
//                    investModalTitle、investName、investCode、
//                    investExpectedRate、investNote、quoteResult、
//                    investList、invTotalCost、invTotalValue、
//                    invTotalProfit、invTotalRate、invAnnualized、
//                    invConcentration、invExpectedRate、reduceInvestId、
//                    reduceModalTitle、reduceMeta、reducePriceLabel、
//                    reduceQtyLabel、reduceSubmitBtn、reduceSellPrice、
//                    reduceQuantity、reduceFee、reduceDate、reduceNote、
//                    reduceModal 等）
// ============================================================

const INV_RISK_LABELS = { low: '低风险', medium: '中风险', high: '高风险', very_high: '极高风险' };
const INV_RISK_DOT = { low: '#22c55e', medium: '#eab308', high: '#f97316', very_high: '#ef4444' };

// 收益率/年化格式化：异常值（极小本金导致公式放大）不展示科学计数法
function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    if (Math.abs(v) > 100000) return '--';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const InvestmentManager = {
    refreshTimer: null,
    _initialized: false,
    init() {
        if (this._initialized) return;
        const investForm = document.getElementById('investForm');
        if (!investForm) return;  // DOM 尚未通过 PageLoader 加载
        this._initialized = true;
        document.getElementById('investModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('investCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('investForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        // 查行情按钮
        document.getElementById('investQuoteBtn').addEventListener('click', () => this.fetchQuote());
        // 一键刷新按钮
        document.getElementById('refreshAllBtn').addEventListener('click', () => this.refreshAllQuotes());
        // 显示已清仓开关
        const includeSoldEl = document.getElementById('invIncludeSold');
        if (includeSoldEl) includeSoldEl.addEventListener('change', () => this.refresh());
        // 类型下拉
        const typeSel = document.getElementById('investType');
        cache.investmentTypes.filter(t => t.is_active != false).forEach(t => { typeSel.innerHTML += `<option value="${t.id}">${escapeHtml(t.icon)} ${escapeHtml(t.name)}</option>`; });
        // 账户下拉
        const accSel = document.getElementById('investAccount');
        cache.accounts.forEach(a => { accSel.innerHTML += `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`; });
        // 自动联动计算
        this.bindAutoCalc();
        // 加仓/减仓弹窗事件
        document.getElementById('reduceForm').addEventListener('submit', (e) => { e.preventDefault(); this.reduce(); });
        document.getElementById('reduceModalClose').addEventListener('click', () => this.closeReduceModal());
        document.getElementById('reduceCancelBtn').addEventListener('click', () => this.closeReduceModal());
        // 操作类型切换
        document.querySelectorAll('input[name="reduceAction"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.updateReduceUI(e.target.value));
        });
        // 记一笔利息弹窗事件
        document.getElementById('interestForm').addEventListener('submit', (e) => { e.preventDefault(); this.recordInterest(); });
        document.getElementById('interestModalClose').addEventListener('click', () => this.closeInterestModal());
        document.getElementById('interestCancelBtn').addEventListener('click', () => this.closeInterestModal());
        document.getElementById('invEditTxnForm').addEventListener('submit', (e) => { e.preventDefault(); this.saveInvEditTxn(); });
        document.getElementById('invEditTxnClose').addEventListener('click', () => this.closeInvEditTxn());
        document.getElementById('invEditCancelBtn').addEventListener('click', () => this.closeInvEditTxn());
        document.querySelectorAll('input[name="interestMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.updateInterestUI(e.target.value));
        });
        document.getElementById('investBuyDate').value = fmtDateTimeLocal();
        // 新增持仓按钮
        const addBtn = document.getElementById('addInvestBtn');
        if (addBtn) addBtn.addEventListener('click', () => this.openModal());
        // 详情弹窗 & 全屏网格：关闭与动作绑定
        const detailClose = document.getElementById('invDetailClose');
        if (detailClose) detailClose.addEventListener('click', () => this.closeDetailModal());
        const detailModal = document.getElementById('invDetailModal');
        if (detailModal) detailModal.addEventListener('click', (e) => { if (e.target === detailModal) this.closeDetailModal(); });
        const gridClose = document.getElementById('invGridClose');
        if (gridClose) gridClose.addEventListener('click', () => this.closeInvGrid());
        const gridOverlay = document.getElementById('invGridOverlay');
        if (gridOverlay) gridOverlay.addEventListener('click', (e) => { if (e.target === gridOverlay) this.closeInvGrid(); });
        document.querySelectorAll('#invDetailActions [data-detail-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = this.detailId;
                if (id == null) return;
                const act = btn.dataset.detailAction;
                this.closeDetailModal();
                if (act === 'refresh') this.refreshQuote(id, null);
                else {
                    // 从全屏网格详情进入编辑/加仓减仓/记息/删除时，先关闭网格避免编辑弹窗被压住
                    this.closeInvGrid();
                    if (act === 'edit') this.edit(id);
                    else if (act === 'reduce') this.openReduceModal(id);
                    else if (act === 'interest') this.openInterestModal(id);
                    else if (act === 'delete') this.delete(id);
                    else if (act === 'txns') this.openInvTxns(id);
                }
            });
        });
        const txnsModal = document.getElementById('invTxnsModal');
        if (txnsModal) txnsModal.addEventListener('click', (e) => { if (e.target === txnsModal) this.closeInvTxns(); });
        const invEditTxnModal = document.getElementById('invEditTxnModal');
        if (invEditTxnModal) invEditTxnModal.addEventListener('click', (e) => { if (e.target === invEditTxnModal) this.closeInvEditTxn(); });
        const txnsClose = document.getElementById('invTxnsClose');
        if (txnsClose) txnsClose.addEventListener('click', () => this.closeInvTxns());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { this.closeInvGrid(); this.closeDetailModal(); }
        });
    },
    bindAutoCalc() {
        const buyPriceEl = document.getElementById('investBuyPrice');
        const currentPriceEl = document.getElementById('investCurrentPrice');
        const qtyEl = document.getElementById('investQuantity');
        const feeEl = document.getElementById('investFee');
        const totalCostEl = document.getElementById('investTotalCost');
        const currentValueEl = document.getElementById('investCurrentValue');

        const toNum = (el) => parseFloat(el.value) || 0;
        const set = (el, v) => { if (document.activeElement !== el) el.value = v; };

        // 买入单价 × 数量 + 手续费 = 总投入成本
        const calcCost = () => {
            const bp = toNum(buyPriceEl), qty = toNum(qtyEl), fee = toNum(feeEl);
            if (bp > 0 && qty > 0) set(totalCostEl, (bp * qty + fee).toFixed(2));
        };
        // 当前单价 × 数量 = 当前市值
        const calcValue = () => {
            const cp = toNum(currentPriceEl), qty = toNum(qtyEl);
            if (cp > 0 && qty > 0) set(currentValueEl, (cp * qty).toFixed(2));
        };
        // 总投入成本反推买入单价
        const calcBuyPrice = () => {
            const cost = toNum(totalCostEl), qty = toNum(qtyEl), fee = toNum(feeEl);
            if (cost > 0 && qty > 0) set(buyPriceEl, ((cost - fee) / qty).toFixed(4));
        };

        buyPriceEl.addEventListener('input', () => { calcCost(); calcValue(); });
        currentPriceEl.addEventListener('input', () => { calcValue(); });
        qtyEl.addEventListener('input', () => { calcCost(); calcValue(); });
        feeEl.addEventListener('input', () => { calcCost(); });
        totalCostEl.addEventListener('input', calcBuyPrice);
    },
    openModal() {
        document.getElementById('investModal').classList.add('show');
        document.getElementById('investModalTitle').textContent = '新增理财持仓';
        document.getElementById('investName').value = '';
        document.getElementById('investCode').value = '';
        document.getElementById('investBuyPrice').value = '';
        document.getElementById('investCurrentPrice').value = '';
        document.getElementById('investQuantity').value = '';
        document.getElementById('investFee').value = '';
        document.getElementById('investTotalCost').value = '';
        document.getElementById('investCurrentValue').value = '';
        document.getElementById('investBuyDate').value = fmtDateTimeLocal();
        document.getElementById('investExpectedRate').value = '';
        document.getElementById('investRisk').value = '';
        document.getElementById('investNote').value = '';
        document.getElementById('quoteResult').innerHTML = '';
    },
    closeModal() {
        document.getElementById('investModal').classList.remove('show');
        this.editId = null;
    },
    async edit(id) {
        const data = await api('/investments/investments');
        if (!data) return;   // data = { investments: [...], summary: {...}, byType: [...] }
        const inv = data.investments.find(i => i.id === id);
        if (!inv) { showToast('持仓不存在', 'error'); return; }
        this.editId = id;
        document.getElementById('investModal').classList.add('show');
        document.getElementById('investModalTitle').textContent = '编辑理财持仓';
        document.getElementById('investType').value = inv.investment_type_id;
        // 若该类型已被关闭（下拉里已过滤掉），补一个选项保证旧持仓仍可编辑
        if (document.getElementById('investType').value != inv.investment_type_id) {
            const it = cache.investmentTypes.find(t => t.id === inv.investment_type_id);
            if (it) {
                const opt = document.createElement('option');
                opt.value = it.id;
                opt.textContent = `${it.icon || '💹'} ${it.name}（已关闭）`;
                document.getElementById('investType').appendChild(opt);
                document.getElementById('investType').value = it.id;
            }
        }
        document.getElementById('investName').value = inv.name || '';
        document.getElementById('investCode').value = inv.code || '';
        document.getElementById('investAccount').value = inv.account_id || '';
        document.getElementById('investBuyPrice').value = inv.buy_price || '';
        document.getElementById('investCurrentPrice').value = inv.current_price || '';
        document.getElementById('investQuantity').value = inv.quantity || '';
        document.getElementById('investFee').value = inv.fee || '';
        document.getElementById('investTotalCost').value = inv.total_cost || '';
        document.getElementById('investCurrentValue').value = inv.current_value || '';
        document.getElementById('investBuyDate').value = inv.buy_date ? fmtDateTimeLocal(inv.buy_date) : fmtDateTimeLocal();
        document.getElementById('investExpectedRate').value = inv.expected_rate || '';
        document.getElementById('investRisk').value = inv.risk_level || '';
        document.getElementById('investNote').value = inv.note || '';
        document.getElementById('quoteResult').innerHTML = '';
    },
    // 查行情：输入代码 → 自动填充名称和价格
    async fetchQuote() {
        const code = document.getElementById('investCode').value.trim();
        if (!code) { showToast('请输入产品代码', 'warning'); return; }
        const typeId = parseInt(document.getElementById('investType').value);
        const invType = cache.investmentTypes.find(t => t.id === typeId);
        const category = invType?.category || 'fund';
        const resultEl = document.getElementById('quoteResult');
        resultEl.innerHTML = '<span class="quote-loading">⏳ 查询中...</span>';
        const data = await api(`/investments/quote?code=${encodeURIComponent(code)}&category=${category}`);
        if (!data) { resultEl.innerHTML = '<span class="quote-error">❌ 查询失败，请检查代码</span>'; return; }
        let price, quoteClass, quotePrefix;
        if (data.type === 'fund') {
            price = data.estimatedNav || data.nav;
            const change = parseFloat(data.estimatedChange) || 0;
            quoteClass = change > 0 ? 'quote-up' : (change < 0 ? 'quote-down' : 'quote-ok');
            quotePrefix = change > 0 ? '+' : '';
            resultEl.innerHTML = `<span class="${quoteClass}">✅ ${escapeHtml(data.name)} | 净值 ${data.nav} | 估算 ${price} (${quotePrefix}${change}%) | ${data.navDate}</span>`;
        } else {
            price = data.price;
            const change = parseFloat(data.changePercent) || 0;
            quoteClass = change > 0 ? 'quote-up' : (change < 0 ? 'quote-down' : 'quote-ok');
            quotePrefix = change > 0 ? '+' : '';
            resultEl.innerHTML = `<span class="${quoteClass}">✅ ${escapeHtml(data.name)} | 现价 ${price} | ${quotePrefix}${change.toFixed(2)}%</span>`;
        }
        if (!document.getElementById('investName').value) {
            document.getElementById('investName').value = data.name || '';
        }
        if (price > 0) {
            // 行情价作为当前单价；若买入单价为空，也用它填充
            document.getElementById('investCurrentPrice').value = price;
            if (!document.getElementById('investBuyPrice').value) {
                document.getElementById('investBuyPrice').value = price;
            }
            const qty = parseFloat(document.getElementById('investQuantity').value) || 0;
            if (qty > 0) {
                const fee = parseFloat(document.getElementById('investFee').value) || 0;
                document.getElementById('investCurrentValue').value = (price * qty).toFixed(2);
                if (!document.getElementById('investTotalCost').value) {
                    document.getElementById('investTotalCost').value = (price * qty + fee).toFixed(2);
                }
            }
        }
    },
    async save() {
        const body = {
            investment_type_id: parseInt(document.getElementById('investType').value),
            name: document.getElementById('investName').value,
            code: document.getElementById('investCode').value,
            account_id: parseInt(document.getElementById('investAccount').value),
            buy_price: parseFloat(document.getElementById('investBuyPrice').value),
            current_price: parseFloat(document.getElementById('investCurrentPrice').value),
            quantity: parseFloat(document.getElementById('investQuantity').value),
            total_cost: parseFloat(document.getElementById('investTotalCost').value),
            current_value: parseFloat(document.getElementById('investCurrentValue').value),
            fee: parseFloat(document.getElementById('investFee').value) || 0,
            buy_date: document.getElementById('investBuyDate').value,
            expected_rate: parseFloat(document.getElementById('investExpectedRate').value) || 0,
            risk_level: document.getElementById('investRisk').value || null,
            note: document.getElementById('investNote').value
        };
        if (!body.name) { showToast('请输入产品名称', 'error'); return; }
        const editId = this.editId;
        if (editId) {
            await api(`/investments/investments/${editId}`, 'PUT', body);
            showToast('持仓已更新', 'success');
        } else {
            await api('/investments/investments', 'POST', body);
            showToast('持仓已添加', 'success');
        }
        this.closeModal();
        await this.refresh();
        // 新建买入会从账户扣款并落一笔流水，账户余额与 Dashboard KPI 需同步
        await this.refreshAccountsAfterInvChange();
    },
    async delete(id) {
        try {
            await api(`/investments/investments/${id}`, 'DELETE');
            showToast('持仓已删除', 'warning');
            await this.refresh();
            await this.refreshAccountsAfterInvChange();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    // 加仓/减仓弹窗
    openReduceModal(id) {
        this.reduceId = id;
        const data = cache.investments;
        const inv = data && data.find(i => i.id === id);
        if (!inv) { showToast('持仓不存在', 'error'); return; }
        document.getElementById('reduceInvestId').value = id;
        document.getElementById('reduceModalTitle').textContent = `加仓/减仓 · ${inv.name}`;
        document.getElementById('reduceMeta').innerHTML = `当前持有 <b>${inv.quantity}</b>，市值 ${fmt(inv.current_value)}`;
        // 默认选中减仓
        const sellRadio = document.querySelector('input[name="reduceAction"][value="sell"]');
        if (sellRadio) sellRadio.checked = true;
        this.updateReduceUI('sell');
        document.getElementById('reduceSellPrice').value = inv.current_price || inv.buy_price || '';
        document.getElementById('reduceQuantity').value = inv.quantity || '';
        document.getElementById('reduceFee').value = '0';
        document.getElementById('reduceDate').value = fmtDateTimeLocal();
        document.getElementById('reduceNote').value = '';
        document.getElementById('reduceModal').classList.add('show');
    },
    // 更新加仓/减仓 UI
    updateReduceUI(action) {
        const priceLabel = document.getElementById('reducePriceLabel');
        const qtyLabel = document.getElementById('reduceQtyLabel');
        const submitBtn = document.getElementById('reduceSubmitBtn');
        if (action === 'buy') {
            if (priceLabel) priceLabel.textContent = '买入单价 (¥)';
            if (qtyLabel) qtyLabel.textContent = '买入数量';
            if (submitBtn) submitBtn.textContent = '确认加仓';
        } else {
            if (priceLabel) priceLabel.textContent = '卖出单价 (¥)';
            if (qtyLabel) qtyLabel.textContent = '卖出数量';
            if (submitBtn) submitBtn.textContent = '确认卖出';
        }
        // 更新 radio 样式
        document.querySelectorAll('.radio-label').forEach(el => {
            const isActive = el.dataset.action === action;
            el.style.background = isActive ? 'var(--accent-500)' : 'var(--surface-card)';
            el.style.color = isActive ? '#fff' : 'var(--text-primary)';
            el.style.borderColor = isActive ? 'var(--accent-500)' : 'var(--border)';
        });
    },
    closeReduceModal() {
        document.getElementById('reduceModal').classList.remove('show');
        this.reduceId = null;
    },
    // 记一笔利息弹窗
    openInterestModal(id) {
        this.interestId = id;
        const inv = (cache.investments || []).find(i => i.id === id);
        if (!inv) { showToast('持仓不存在', 'error'); return; }
        document.getElementById('interestInvestId').value = id;
        document.getElementById('interestModalTitle').textContent = `记一笔利息 · ${inv.name}`;
        document.getElementById('interestMeta').innerHTML = `当前持有 <b>${inv.quantity}</b> 份，市值 ${fmt(inv.current_value)}`;
        const reinvestRadio = document.querySelector('input[name="interestMode"][value="reinvest"]');
        if (reinvestRadio) reinvestRadio.checked = true;
        this.updateInterestUI('reinvest');
        document.getElementById('interestAmount').value = '';
        document.getElementById('interestNav').value = inv.current_price || inv.buy_price || '';
        document.getElementById('interestDate').value = fmtDateTimeLocal();
        document.getElementById('interestNote').value = '';
        document.getElementById('interestModal').classList.add('show');
    },
    // 切换计息方式（红利再投需要填净值，现金入账不需要）
    updateInterestUI(mode) {
        const navGroup = document.getElementById('interestNavGroup');
        if (navGroup) navGroup.style.display = mode === 'reinvest' ? '' : 'none';
        document.querySelectorAll('#interestModal .radio-label').forEach(el => {
            const isActive = el.dataset.mode === mode;
            el.style.background = isActive ? 'var(--accent-500)' : 'var(--surface-card)';
            el.style.color = isActive ? '#fff' : 'var(--text-primary)';
            el.style.borderColor = isActive ? 'var(--accent-500)' : 'var(--border)';
        });
    },
    closeInterestModal() {
        document.getElementById('interestModal').classList.remove('show');
        this.interestId = null;
    },
    closeInvEditTxn() {
        const m = document.getElementById('invEditTxnModal');
        if (m) m.classList.remove('show');
        this._editTxnInvId = null;
        this._editTxnId = null;
        this._editTxnType = null;
    },
    openInvEditTxn(invId, txn) {
        this._editTxnInvId = invId;
        this._editTxnId = txn.id;
        this._editTxnType = txn.type;
        const TYPE_LABEL = { buy: '买入', sell: '卖出', dividend: '分红', interest: '利息', reinvest: '红利再投' };
        document.getElementById('invEditTxnId').value = txn.id;
        document.getElementById('invEditInvId').value = invId;
        document.getElementById('invEditTxnType').textContent = `交易类型：${TYPE_LABEL[txn.type] || txn.type}`;
        document.getElementById('invEditAmount').value = txn.amount;
        document.getElementById('invEditPrice').value = txn.price || '';
        document.getElementById('invEditQty').value = txn.quantity || '';
        document.getElementById('invEditFee').value = txn.fee || 0;
        document.getElementById('invEditDate').value = (txn.date || '').replace(' ', 'T').slice(0, 16);
        document.getElementById('invEditNote').value = txn.note || '';
        const showPQ = ['buy', 'sell', 'reinvest'].includes(txn.type);
        const pg = document.getElementById('invEditPriceGroup');
        const qg = document.getElementById('invEditQtyGroup');
        if (pg) pg.style.display = showPQ ? '' : 'none';
        if (qg) qg.style.display = showPQ ? '' : 'none';
        document.getElementById('invEditTxnModal').classList.add('show');
    },
    async saveInvEditTxn() {
        const invId = this._editTxnInvId;
        const txnId = this._editTxnId;
        const type = this._editTxnType;
        if (!invId || !txnId || !type) return;
        const amount = parseFloat(document.getElementById('invEditAmount').value);
        if (!(amount > 0)) { showToast('请填写大于 0 的金额', 'error'); return; }
        const price = parseFloat(document.getElementById('invEditPrice').value) || 0;
        const quantity = parseFloat(document.getElementById('invEditQty').value) || 0;
        const fee = parseFloat(document.getElementById('invEditFee').value) || 0;
        const date = document.getElementById('invEditDate').value;
        const note = document.getElementById('invEditNote').value || '';
        const submitBtn = document.getElementById('invEditSubmitBtn');
        submitBtn.disabled = true; submitBtn.textContent = '保存中…';
        try {
            // PUT 后端返回 success(null, …)，api() 返回 data.data 即 null ——
            // 不能用 `if (res)` 判断成功：那样 Toast 不弹、弹窗不关、刷新不执行，
            // 而后端其实已改完（删旧流水 → 插新流水 → 重算持仓 → UPDATE 账户余额）。
            // api() 失败必 throw，成功（即便返回 null）即代表已保存。
            await api(`/investments/investments/${invId}/transactions/${txnId}`, 'PUT', { type, amount, price, quantity, fee, date, note });
            showToast('已保存修改', 'success');
            this.closeInvEditTxn();
            // 改流水会重算持仓（数量/成本/市值）并改动账户余额，持仓卡片与账户/Dashboard 都要刷
            await this.syncAfterInvTxnChange(invId);
        } catch (e) {
            submitBtn.disabled = false; submitBtn.textContent = '保存修改';
        }
    },
    async recordInterest() {
        const id = this.interestId;
        if (!id) return;
        const mode = document.querySelector('input[name="interestMode"]:checked')?.value || 'reinvest';
        const amount = parseFloat(document.getElementById('interestAmount').value);
        if (!(amount > 0)) { showToast('请填写大于 0 的利息金额', 'error'); return; }
        const date = document.getElementById('interestDate').value;
        const note = document.getElementById('interestNote').value;
        let body;
        if (mode === 'reinvest') {
            const nav = parseFloat(document.getElementById('interestNav').value);
            if (!(nav > 0)) { showToast('红利再投需填写有效的当前净值', 'error'); return; }
            body = { type: 'reinvest', amount, price: nav, date, note };
        } else {
            body = { type: 'interest', amount, date, note };
        }
        try {
            const result = await api(`/investments/investments/${id}/transactions`, 'POST', body);
            showToast(result?.message || (mode === 'reinvest' ? '红利再投已记录' : '利息已记录'), 'success');
            this.closeInterestModal();
            await this.refresh();
            // 分红/利息会入账到账户并重算余额，账户卡片与 Dashboard KPI 需同步
            await this.refreshAccountsAfterInvChange();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    async reduce() {
        const id = this.reduceId;
        if (!id) return;
        const action = document.querySelector('input[name="reduceAction"]:checked')?.value || 'sell';
        const body = {
            action,
            price: parseFloat(document.getElementById('reduceSellPrice').value),
            quantity: parseFloat(document.getElementById('reduceQuantity').value),
            fee: parseFloat(document.getElementById('reduceFee').value) || 0,
            date: document.getElementById('reduceDate').value,
            note: document.getElementById('reduceNote').value
        };
        if (!body.price || !body.quantity) { showToast('请填写成交单价和数量', 'error'); return; }
        try {
            const result = await api(`/investments/investments/${id}/reduce`, 'POST', body);
            showToast(result?.message || (action === 'buy' ? '加仓成功' : '卖出成功'), 'success');
            this.closeReduceModal();
            await this.refresh();
            // 加仓扣款 / 卖出回款都会改账户余额并落一笔流水，账户卡片与 Dashboard KPI 需同步
            await this.refreshAccountsAfterInvChange();
        } catch (err) {
            // api() 已在 catch 中显示错误 toast，这里无需重复
        }
    },
    /**
     * 理财操作后的账户侧统一刷新。
     *
     * 新建/编辑持仓、加仓、减仓、分红利息、删除流水这些操作，后端都会
     * recomputeInvestmentPosition 重算持仓，并 computeAccountBalance + UPDATE accounts.balance
     * 改动账户余额。只刷理财列表是不够的 —— 账户页卡片余额与 Dashboard KPI 会停在旧值
     * （要切到别的页再切回来才自愈，用户当下看到的就是错的）。
     */
    async refreshAccountsAfterInvChange() {
        await initCache();
        if (window.AccountManager) await window.AccountManager.refresh();
        if (window.DashboardManager) await window.DashboardManager.refresh();
    },

    /** 流水弹窗内改动（编辑/删除某笔流水）后的统一刷新：先重拉流水弹窗，再刷持仓列表与账户/Dashboard */
    async syncAfterInvTxnChange(invId) {
        await this.openInvTxns(invId);
        await this.refresh();
        await this.refreshAccountsAfterInvChange();
    },

    // 单条刷新行情
    async refreshQuote(id, btn) {
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        try {
            await api(`/investments/${id}/refresh`, 'POST');
            showToast('行情已更新', 'success');
            await this.refresh();
        } catch (err) {
            // api() 已显示错误 toast
        }
        if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
    },
    // 一键刷新全部
    async refreshAllQuotes() {
        const btn = document.getElementById('refreshAllBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class=\"spin\">⏳</span> 刷新中...'; }
        try {
            const result = await api('/investments/refresh-all', 'POST', null, { silent: true });
            showToast(result?.message || `已更新 ${result?.updated || 0} 个持仓`, 'success');
            await this.refresh();
        } catch (err) {
            // 行情刷新后端暂未实现，静默跳过
            console.warn('[invest] 行情刷新暂不可用:', err.message);
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '一键刷新'; }
    },
    // 进入页面自动刷新行情
    async autoRefreshQuotes() {
        const lastRefresh = localStorage.getItem('inv_last_refresh');
        const now = Date.now();
        // 5分钟内不重复刷新
        if (lastRefresh && now - parseInt(lastRefresh) < 300000) return;
        localStorage.setItem('inv_last_refresh', String(now));
        await this.refreshAllQuotes();
    },
    async refresh() {
        this.init();  // 如果 init 之前被 null-guard 跳过，在 refresh 时补上
        const container = document.getElementById('investList');
        showSkeleton(container, 4, 'grid');
        const includeSold = document.getElementById('invIncludeSold') && document.getElementById('invIncludeSold').checked ? '?includeSold=true' : '';
        const data = await api('/investments/investments' + includeSold);
        if (!data) return;   // data = { investments: [...], summary: {...}, byType: [...] }
        cache.investments = data.investments || [];
        const s = data.summary;
        document.getElementById('invTotalCost').textContent = fmt(s.totalCost);
        document.getElementById('invTotalValue').textContent = fmt(s.totalValue);
        document.getElementById('invTotalProfit').textContent = fmt(s.totalProfit);
        document.getElementById('invTotalProfit').className = `inv-value ${s.totalProfit >= 0 ? 'profit-positive' : 'profit-negative'}`;
        document.getElementById('invTotalRate').textContent = s.totalProfitRate.toFixed(2) + '%';
        // 进阶指标：组合年化 / 持仓集中度 / 预期年化
        const annEl = document.getElementById('invAnnualized');
        if (annEl) { annEl.textContent = fmtPct(s.annualizedRate); annEl.className = `inv-value ${(s.annualizedRate ?? 0) >= 0 ? 'profit-positive' : 'profit-negative'}`; }
        const conEl = document.getElementById('invConcentration');
        if (conEl) conEl.textContent = (s.concentration ?? 0).toFixed(1) + '%';
        const expEl = document.getElementById('invExpectedRate');
        if (expEl) expEl.textContent = (s.expectedRateAvg ?? 0).toFixed(2) + '%';

        // 持仓列表：按类型分组，同类型叠成一叠牌，点击封面展开/收起
        if (!data.investments || data.investments.length === 0) { showEmpty(container, '还没有理财持仓，点击「新增持仓」记录你的投资'); return; }
        // 复用模块级 INV_RISK_LABELS / INV_RISK_DOT

        const buildCard = (i, idx, n) => {
            const progress = i.total_cost > 0 ? Math.min(100, (i.current_value / i.total_cost) * 100) : 0;
            const profitCls = i.profit_rate >= 0 ? 'profit-positive' : 'profit-negative';
            const profitSign = i.profit_rate >= 0 ? '+' : '';
            const annualSign = i.annualizedRate >= 0 ? '+' : '';
            const rl = i.risk_level || 'medium';
            return `
            <div class="goal-card inv-stack-card" data-id="${i.id}" style="--i:${idx}; --n:${n}">
                <div class="goal-head">
                    <div class="goal-icon">${escapeHtml(i.type_icon || "📈")}</div>
                    <div class="goal-title">${escapeHtml(i.name)}${i.code ? ' <span class="goal-sub">(' + escapeHtml(i.code) + ')</span>' : ''}</div>
                    ${i.status === 'sold' ? '<span class="inv-sold-badge">已清仓</span>' : ''}
                    <span class="inv-risk-badge" style="--dot:${INV_RISK_DOT[rl]}; background:${INV_RISK_DOT[rl]}22; color:${INV_RISK_DOT[rl]}">${INV_RISK_LABELS[rl] || rl}</span>
                </div>
                <div class="goal-amounts"><span>投入 <strong>${fmt(i.total_cost)}</strong></span><span>市值 <strong>${fmt(i.current_value)}</strong></span></div>
                <div class="goal-progress"><div class="goal-progress-fill ${i.profit >= 0 ? 'profit-positive' : 'profit-negative'}" style="width:${progress}%"></div></div>
                <div class="goal-amounts"><span class="goal-pct ${profitCls}">${fmtPct(i.profit_rate)}</span><span>年化 ${fmtPct(i.annualizedRate)}</span></div>
                <div class="goal-actions">
                    <button class="btn btn-ghost" data-action="inv-detail" data-id="${i.id}">详情</button>
                    <button class="btn btn-ghost" data-action="edit-inv" data-id="${i.id}">编辑</button>
                    <button class="btn btn-ghost" data-action="delete-inv" data-id="${i.id}">删除</button>
                </div>
            </div>`;
        };

        // 按类型分组（保持后端返回的顺序）
        const groups = {};
        data.investments.forEach(i => {
            const key = i.type_name || '其他';
            (groups[key] = groups[key] || []).push(i);
        });
        const groupList = Object.entries(groups);

        container.innerHTML = groupList.map(([typeName, items]) => {
            const icon = items[0].type_icon || '📈';
            const total = items.reduce((s, i) => s + (Number(i.current_value) || 0), 0);
            const cost = items.reduce((s, i) => s + (Number(i.total_cost) || 0), 0);
            const profit = total - cost;
            const profitRate = cost > 0 ? (profit / cost) * 100 : 0;
            const profitCls = profit >= 0 ? 'profit-positive' : 'profit-negative';
            const profitCount = items.filter(i => (Number(i.profit) || 0) >= 0).length;
            const lossCount = items.length - profitCount;
            // 封面卡也作为牌堆第一张（--i:0，:first-child 在文档流内撑高度），与产品卡一起堆叠偏移
            const coverCard = `
                <div class="goal-card inv-stack-card inv-deck-card" data-type="${escapeHtml(typeName)}" style="--i:0; --n:${items.length + 1}">
                    <div class="inv-cover-top">
                        <div class="goal-head">
                            <div class="goal-icon">${escapeHtml(icon)}</div>
                            <div class="goal-title">${escapeHtml(typeName)}</div>
                            <span class="inv-cover-count">${items.length} 个产品</span>
                        </div>
                        <div class="goal-amounts inv-cover-meta"><span>投入 ${fmt(cost)}</span><span>市值 ${fmt(total)}</span></div>
                    </div>
                    <div class="inv-cover-mid">
                        <div class="inv-cover-profit">
                            <div class="inv-cover-profit-label">浮动盈亏</div>
                            <div class="inv-cover-profit-amount ${profitCls}">${fmt(profit)}</div>
                            <div class="inv-cover-profit-rate ${profitCls}">${fmtPct(profitRate)}</div>
                        </div>
                    </div>
                    <div class="inv-cover-bottom">
                        <div class="inv-cover-stats"><span>盈利 <strong class="goal-pct profit-positive">${profitCount}</strong> 个</span><span>亏损 <strong class="goal-pct profit-negative">${lossCount}</strong> 个</span></div>
                        <div class="inv-cover-foot"><span class="inv-cover-viewall">查看全部 →</span></div>
                    </div>
                </div>`;
            const cards = items.map((i, idx) => buildCard(i, idx + 1, items.length + 1)).join('');
            return `
            <div class="inv-stack">
                <div class="inv-stack-cards" style="--n:${items.length + 1}">${coverCard}${cards}</div>
            </div>`;
        }).join('');

        // 事件委托：封面「查看全部」→ 全屏网格铺开（仅当前类别）
        container.querySelectorAll('[data-action="view-all"]').forEach(btn => {
            btn.addEventListener('click', () => this.openInvGrid(btn.dataset.type));
        });

        // 事件委托：🔍 详情按钮 → 弹单卡详情
        container.querySelectorAll('[data-action="inv-detail"]').forEach(btn => {
            btn.addEventListener('click', () => this.openInvDetail(parseInt(btn.dataset.id)));
        });

        // 封面卡（牌堆第一张）：点击打开该分类全屏网格，不参与产品卡的弹出逻辑
        container.querySelectorAll('.inv-deck-card').forEach(card => {
            card.addEventListener('click', () => this.openInvGrid(card.dataset.type));
        });

        // 事件委托：点击产品牌 → 弹出（置顶+上浮，露出操作按钮）；再点收起。点在操作按钮上交给按钮处理
        container.querySelectorAll('.inv-stack-card:not(.inv-deck-card)').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                const wasPopped = card.classList.contains('popped');
                container.querySelectorAll('.inv-stack-card.popped').forEach(c => c.classList.remove('popped'));
                if (!wasPopped) card.classList.add('popped');
            });
        });

        // 事件委托：编辑、详情、删除按钮（其他操作统一在详情页操作）
        container.querySelectorAll('[data-action="edit-inv"]').forEach(btn => {
            btn.addEventListener('click', () => this.edit(parseInt(btn.dataset.id)));
        });
        container.querySelectorAll('[data-action="delete-inv"]').forEach(btn => {
            btn.addEventListener('click', () => this.delete(parseInt(btn.dataset.id)));
        });

        // 资产配置饼图
        await ChartManager.renderInvestPie(data.byType);

        // 市值趋势折线图（仅总市值）+ 类型对比柱状图
        const trendData = await api('/stats/investments');
        if (trendData) {
            await ChartManager.renderInvTrend(trendData.totalTrend);
            await ChartManager.renderInvTypeBar(trendData.byType);
        }
    },

    /* ---- 理财：单卡详情弹窗 ---- */
    openInvDetail(id) {
        const inv = (cache.investments || []).find(i => i.id === id);
        if (!inv) { showToast('持仓不存在', 'error'); return; }
        this.detailId = id;
        const rl = inv.risk_level || 'medium';
        const profitCls = inv.profit_rate >= 0 ? 'profit-positive' : 'profit-negative';
        document.getElementById('invDetailTitle').textContent = `${escapeHtml(inv.name)} 详情`;
        document.getElementById('invDetailBody').innerHTML = `
            <div class="inv-detail-head">
                <div class="inv-detail-icon">${escapeHtml(inv.type_icon || '📈')}</div>
                <div>
                    <div class="inv-detail-name">${escapeHtml(inv.name)}${inv.code ? ' <span class="goal-sub">(' + escapeHtml(inv.code) + ')</span>' : ''}</div>
                    <span class="inv-risk-badge" style="--dot:${INV_RISK_DOT[rl]}; background:${INV_RISK_DOT[rl]}22; color:${INV_RISK_DOT[rl]}">${INV_RISK_LABELS[rl] || rl}</span>
                </div>
            </div>
            <div class="inv-detail-grid">
                <div><span class="stat-label">投入本金</span><span class="inv-detail-val">${fmt(inv.total_cost)}</span></div>
                <div><span class="stat-label">当前市值</span><span class="inv-detail-val">${fmt(inv.current_value)}</span></div>
                <div><span class="stat-label">浮动盈亏</span><span class="inv-detail-val ${profitCls}">${fmt(inv.profit)}</span></div>
                <div><span class="stat-label">收益率</span><span class="inv-detail-val ${profitCls}">${fmtPct(inv.profit_rate)}</span></div>
                <div><span class="stat-label">年化</span><span class="inv-detail-val ${profitCls}">${fmtPct(inv.annualizedRate)}</span></div>
                <div><span class="stat-label">持有数量</span><span class="inv-detail-val">${inv.quantity}</span></div>
            </div>
            ${inv.note ? `<div class="inv-detail-note">📝 ${escapeHtml(inv.note)}</div>` : ''}
        `;
        document.getElementById('invDetailModal').classList.add('show');
    },
    closeDetailModal() {
        document.getElementById('invDetailModal').classList.remove('show');
        this.detailId = null;
    },

    /* ---- 理财：全屏网格铺开 ---- */
    buildGridCard(i) {
        const rl = i.risk_level || 'medium';
        const profitCls = i.profit_rate >= 0 ? 'profit-positive' : 'profit-negative';
        const progress = i.total_cost > 0 ? Math.min(100, (i.current_value / i.total_cost) * 100) : 0;
        return `
        <div class="inv-grid-card" data-inv-id="${i.id}" tabindex="0" role="button" aria-label="${escapeHtml(i.name)} 持仓详情">
            <div class="goal-head">
                <div class="goal-icon">${escapeHtml(i.type_icon || '📈')}</div>
                <div class="goal-title">${escapeHtml(i.name)}${i.code ? ' <span class="goal-sub">(' + escapeHtml(i.code) + ')</span>' : ''}</div>
                <span class="inv-risk-badge" style="--dot:${INV_RISK_DOT[rl]}; background:${INV_RISK_DOT[rl]}22; color:${INV_RISK_DOT[rl]}">${INV_RISK_LABELS[rl] || rl}</span>
            </div>
            <div class="goal-amounts"><span>投入 <strong>${fmt(i.total_cost)}</strong></span><span>市值 <strong>${fmt(i.current_value)}</strong></span></div>
            <div class="goal-progress"><div class="goal-progress-fill ${i.profit >= 0 ? 'profit-positive' : 'profit-negative'}" style="width:${progress}%"></div></div>
            <div class="goal-amounts"><span class="goal-pct ${profitCls}">${fmtPct(i.profit_rate)}</span><span>年化 ${fmtPct(i.annualizedRate)}</span></div>
        </div>`;
    },
    openInvGrid(typeName) {
        const all = cache.investments || [];
        const items = typeName ? all.filter(i => i.type_name === typeName) : all;
        if (!items.length) { showToast(typeName ? `${escapeHtml(typeName)} 暂无持仓` : '暂无持仓', 'warning'); return; }
        const grid = document.getElementById('invGridBody');
        grid.innerHTML = items.map(i => this.buildGridCard(i)).join('');
        document.getElementById('invGridTitle').textContent = typeName ? escapeHtml(typeName) : '全部持仓';
        document.getElementById('invGridCount').textContent = items.length;
        grid.querySelectorAll('[data-inv-id]').forEach(card => {
            const handler = () => { const id = parseInt(card.dataset.invId); if (!isNaN(id)) this.openInvDetail(id); };
            card.addEventListener('click', handler);
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
        });
        document.getElementById('invGridOverlay').classList.add('show');
    },
    closeInvGrid() {
        const ov = document.getElementById('invGridOverlay');
        if (ov) ov.classList.remove('show');
    },

    /* ---- 理财：交易记录弹窗 ---- */
    async openInvTxns(id) {
        const inv = (cache.investments || []).find(i => i.id === id);
        const title = inv ? `${escapeHtml(inv.name)} · 交易记录` : '交易记录';
        document.getElementById('invTxnsTitle').textContent = title;
        document.getElementById('invTxnsBody').innerHTML = `<div class="sh-body"><div class="skeleton-wrap" data-skeleton="list"><div class="skeleton-line shimmer"></div><div class="skeleton-line shimmer"></div><div class="skeleton-line shimmer"></div></div></div>`;
        document.getElementById('invTxnsModal').classList.add('show');
        const data = await api(`/investments/investments/${id}/transactions`);
        const list = (data && Array.isArray(data)) ? data : (data && data.data ? data.data : []);
        const body = document.getElementById('invTxnsBody');
        if (!list.length) {
            body.innerHTML = `<div class="bs-empty">暂无交易记录</div>`;
            return;
        }
        const TYPE_CLS = { buy: 'expense', sell: 'income', dividend: 'income', interest: 'income', reinvest: 'expense' };
        const rows = list.map(t => {
            const cls = TYPE_CLS[t.type] || 'expense';
            const sign = t.type === 'sell' || t.type === 'dividend' || t.type === 'interest' ? '+' : '-';
            const amt = Number(t.amount || 0);
            // 系统自动生成的备注文案（与手续费展示二选一，不再显示这些无意义文字）
            const SYS_NOTES = new Set(['初始买入', '加仓', '部分卖出', '清仓卖出', '建仓']);
            const parts = [];
            if (t.price != null && t.price !== '') parts.push(`单价 ${fmt(t.price)}`);
            if (t.quantity != null && t.quantity !== '') parts.push(`数量 ${t.quantity}`);
            parts.push(`手续费 ${fmt(Number(t.fee) || 0)}`);
            if (t.note && !SYS_NOTES.has(t.note)) parts.push('📝 ' + escapeHtml(t.note));
            return `
            <div class="inv-txn-row" data-txn-id="${t.id}">
                <div class="inv-txn-main">
                    <span class="inv-txn-type inv-txn-${cls}">${escapeHtml(t.type_label || t.type)}</span>
                    <span class="inv-txn-date">${escapeHtml((t.date || '').slice(0, 10))}</span>
                    <span class="inv-txn-actions">
                        <button class="inv-txn-edit">修改</button>
                        <button class="inv-txn-del">删除</button>
                    </span>
                </div>
                <div class="inv-txn-amount ${cls}">${sign}${fmt(Math.abs(amt))}</div>
                <div class="inv-txn-meta">${parts.join(' · ')}</div>
            </div>`;
        }).join('');
        body.innerHTML = `<div class="inv-txn-list" id="invTxnList">${rows}</div>`;
        document.getElementById('invTxnList').addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.inv-txn-edit');
            if (editBtn) {
                const row = editBtn.closest('.inv-txn-row');
                const tid = row && row.dataset.txnId;
                const txn = list.find(t => String(t.id) === String(tid));
                if (txn) this.openInvEditTxn(id, txn);
                return;
            }
            const btn = e.target.closest('.inv-txn-del');
            if (!btn) return;
            const row = btn.closest('.inv-txn-row');
            const txnId = row && row.dataset.txnId;
            if (!txnId || !confirm('确认删除该笔交易记录？')) return;
            try {
                await api(`/investments/investments/${id}/transactions/${txnId}`, 'DELETE');
                showToast('已删除');
                // 只重拉流水弹窗不够：后端已 recomputeInvestmentPosition 重算持仓（数量/成本/市值）
                // 并改了账户余额，持仓卡片/账户余额/Dashboard 都要刷，否则关掉弹窗后看到的是旧值
                await this.syncAfterInvTxnChange(id);
            } catch (err) {
                // api 已处理错误提示
            }
        });
    },
    closeInvTxns() {
        const ov = document.getElementById('invTxnsModal');
        if (ov) ov.classList.remove('show');
    }
};

export default InvestmentManager;
