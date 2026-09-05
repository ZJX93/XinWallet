/* ============================================
   鑫钱包 · 汇率管理器（前端 P2-2b）
   - 启动时拉取一次（silent；失败用后端 DB 缓存或默认空）
   - 暴露 convert(amount, from, to) 单笔折算
   - 暴露 aggregateToBase(items, baseCurrency, ...) 合计折算（前端聚合基础工具）
   - 暴露 refresh() 手动刷新（顶栏 currencyMenu 触发）
   - 暴露 rates / 订阅机制给 UI 展示
   ============================================ */

const FxManager = {
    _rates: null,       // { base, date, rates: {CNY:7.18,...}, source, fetchedAt, ageHours, stale }
    _initialized: false,
    _initPromise: null,
    _listeners: new Set(),

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
            try {
                await this._loadSilent();
            } catch (e) {
                console.warn('FxManager.init 失败:', e.message);
            }
            this._initialized = true;
        })();
        return this._initPromise;
    },

    async _loadSilent() {
        // silent: true 避免 401 / 网络错误弹 toast
        const data = await api('/fx/rates', 'GET', null, { silent: true });
        this._rates = data;
        this._notify();
    },

    async refresh() {
        const data = await api('/fx/refresh', 'POST');
        this._rates = data;
        this._notify();
        return data;
    },

    get rates() { return this._rates; },
    get initialized() { return this._initialized; },

    /**
     * 订阅汇率更新（UI 监听后刷新「汇率更新于」展示等）
     */
    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    },
    _notify() {
        for (const fn of this._listeners) {
            try { fn(this._rates); } catch (_) { /* 监听器错误不影响主流程 */ }
        }
    },

    /**
     * 单笔折算：amount 从 from 币种到 to 币种。
     * - 同币种直接返回 amount
     * - 任意一端为 USD 时直接用单步汇率
     * - 跨币种通过 USD 三角折算
     * - 无汇率数据或汇率表中缺对应 key 时退化为返回原值（不抛错，避免影响渲染）
     */
    convert(amount, from, to) {
        const v = Number(amount);
        if (!Number.isFinite(v)) return 0;
        const f = String(from || 'CNY').toUpperCase();
        const t = String(to || 'CNY').toUpperCase();
        if (f === t) return v;
        const r = this._rates && this._rates.rates;
        if (!r || !r[f] || !r[t]) return v;
        if (f === 'USD') return v * r[t];
        if (t === 'USD') return v / r[f];
        // 三角：from → USD → to
        return v / r[f] * r[t];
    },

    /**
     * 把多笔金额按 currency 折算到目标币种，返回合计。
     * 用于仪表盘 KPI / 报表合计 / 储蓄汇总 等前端聚合场景。
     * @param {Array<{amount: number, currency?: string}>} items
     * @param {string} baseCurrency 目标币种（ISO 4217）
     * @param {string} [currencyField='currency']
     * @param {string} [amountField='amount']
     * @returns {number} 保留两位小数（与 DECIMAL(15,2) 对齐）
     */
    aggregateToBase(items, baseCurrency, currencyField = 'currency', amountField = 'amount') {
        if (!Array.isArray(items) || items.length === 0) return 0;
        const base = String(baseCurrency || 'CNY').toUpperCase();
        let total = 0;
        for (const it of items) {
            const amt = Number(it[amountField]);
            if (!Number.isFinite(amt)) continue;
            const cur = String(it[currencyField] || 'CNY').toUpperCase();
            total += this.convert(amt, cur, base);
        }
        return Math.round(total * 100) / 100;
    },
};

if (typeof window !== 'undefined') window.FxManager = FxManager;
if (typeof module !== 'undefined' && module.exports) module.exports = FxManager;
