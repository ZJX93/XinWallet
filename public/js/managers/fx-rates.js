/* ============================================
   鑫钱包 · 汇率查询页（多币种 P2-3d）
   - 顶栏「本位币」入口移除后，货币相关设置与汇率查询统一收在本页
   - 数据来自 FxManager（/fx/rates，服务端缓存 24h）
   - 懒加载片段：由 app.js#showPage 在本页激活时调用 render()
   ============================================ */

const FxRates = {
    _baseCur: 'CNY',   // 本位币（折算目标）
    _quote: 'CNY',     // 表格的基准报价币种
    _kw: '',
    _bound: false,

    /** 币种清单：与 utils.js#supportedCurrencies 对齐；汇率表里没有的币种不展示 */
    _codes() {
        const supported = (typeof supportedCurrencies !== 'undefined' && Array.isArray(supportedCurrencies))
            ? supportedCurrencies
            : ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP', 'AUD', 'CAD', 'TWD', 'MOP', 'KRW', 'SGD',
                'THB', 'MYR', 'PHP', 'INR', 'NZD', 'CHF', 'SEK', 'RUB', 'AED', 'BRL', 'MXN',
                'DKK', 'NOK', 'PLN', 'CZK', 'TRY', 'ZAR', 'SAR', 'ILS'];
        const rates = (window.FxManager && FxManager.rates && FxManager.rates.rates) || {};
        // 汇率表可能含清单外的币种（数据源约 30 种），以「清单 ∩ 汇率表」为准，
        // 缺失的用清单补齐（rates 缺 key 时折算会退化为原值，不会崩）。
        const merged = supported.filter(c => rates[c] !== undefined);
        const extra = Object.keys(rates).filter(c => !merged.includes(c));
        return merged.concat(extra.sort());
    },

    /** 1 单位 from 值多少 to（基于汇率表，rates 以 USD 为 1） */
    _rateOf(code) {
        const r = (window.FxManager && FxManager.rates && FxManager.rates.rates) || {};
        return Number(r[code]) || 0;
    },

    /** 渲染币种「名称」单元格：命中 i18n 时直接显示本地化名；
     *  未命中（fallback === code）时套用 .fx-name-fb 灰色样式 + 「暂无本地化名」标签，
     *  让「代码 · 代码」的中英文混乱变成清晰的「未翻译」提示，
     *  也避免对没补 currency.name.* 的小币种呈现为视觉重复。 */
    _nameHtml(code) {
        const name = tt('currency.name.' + code, code);
        if (name !== code) return escapeHtml(name);
        const label = tt('fx.untranslated', '暂无本地化名');
        const tip = tt('fx.untranslatedTip', '该币种暂无本地化名称');
        return `<span class="fx-name-fb" title="${escapeHtml(tip)}（${escapeHtml(code)}）">${escapeHtml(label)}</span>`;
    },

    /** baseAmount 的 from 币种 → to 币种 */
    _convert(amount, from, to) {
        if (from === to) return Number(amount) || 0;
        const rf = this._rateOf(from), rt = this._rateOf(to);
        if (!rf || !rt) return Number(amount) || 0;
        return (Number(amount) || 0) / rf * rt;
    },

    init() {
        if (this._bound) return;
        this._bound = true;
        this._baseCur = (window.PreferencesManager && PreferencesManager.baseCurrency) || 'CNY';
        this._quote = this._baseCur;
        // 汇率异步到达后自动刷新（init 时可能还没拉到）
        if (window.FxManager && FxManager.subscribe) {
            FxManager.subscribe(() => { if (document.getElementById('fxTableBody')) this.render(); });
        }
    },

    async render() {
        this.init();
        const body = document.getElementById('fxTableBody');
        if (!body) return;

        const data = (window.FxManager && FxManager.rates) || null;
        const rates = (data && data.rates) || {};

        // —— 概览 ——
        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setTxt('fxSource', (data && data.source) || '—');
        setTxt('fxDate', (data && data.date) || '—');
        const age = data && data.ageHours;
        setTxt('fxUpdated', age === undefined ? '—' :
            `${Math.round(age)} ${tt('fx.hoursAgo', '小时前')}${data && data.stale ? ' · ' + tt('fx.stale', '已过期') : ''}`);
        const updEl = document.getElementById('fxUpdated');
        if (updEl) updEl.className = (data && data.stale) ? 'fx-stale' : '';

        // —— 下拉：本位币 / 报价币种 ——
        const codes = this._codes();
        const fill = (id, cur, keep) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = codes.map(c =>
                `<option value="${escapeHtml(c)}">${escapeHtml(c)} · ${escapeHtml(tt('currency.name.' + c, c))}</option>`).join('');
            const target = (keep && codes.includes(cur)) ? cur : (codes.includes(cur) ? cur : (codes[0] || 'CNY'));
            sel.value = target;
            return target;
        };
        this._baseCur = fill('fxBaseSelect', this._baseCur, true) || this._baseCur;
        this._quote = fill('fxQuoteSelect', this._quote, true) || this._quote;

        // —— 表格 ——
        const amount = Number(document.getElementById('fxAmount')?.value) || 0;
        const title = document.getElementById('fxTableTitle');
        if (title) {
            title.textContent = `${amount} ${this._quote} =`;
        }
        const kw = this._kw.trim().toUpperCase();
        const rows = codes.filter(c => {
            if (!kw) return true;
            return c.includes(kw) || tt('currency.name.' + c, c).indexOf(kw) >= 0;
        });
        const quote = this._quote;
        body.innerHTML = rows.map(c => {
            const amt = this._convert(amount, quote, c);
            return `<tr>
                <td class="fx-code">${escapeHtml(c)}</td>
                <td>${this._nameHtml(c)}</td>
                <td class="fx-amt">${escapeHtml(fmt(amt, c))}</td>
                <td><button type="button" class="fx-setbase" data-fx-base="${escapeHtml(c)}">${escapeHtml(tt('fx.setBase', '设为基准'))}</button></td>
            </tr>`;
        }).join('');

        const empty = document.getElementById('fxEmpty');
        if (empty) empty.style.display = rows.length ? 'none' : '';

        this._bindOnce();
    },

    _bindOnce() {
        const baseSel = document.getElementById('fxBaseSelect');
        if (baseSel && !baseSel.dataset.bound) {
            baseSel.dataset.bound = '1';
            baseSel.addEventListener('change', async () => {
                this._baseCur = baseSel.value;
                try {
                    await PreferencesManager.setBaseCurrency(baseSel.value);
                    if (typeof showToast === 'function') showToast(tt('fx.toast.baseSaved', '本位币已更新'), 'success');
                    window.dispatchEvent(new CustomEvent('currency:changed', { detail: { baseCurrency: baseSel.value } }));
                    this.render();
                } catch (e) {
                    if (typeof showToast === 'function') showToast(tt('fx.toast.baseFailed', '本位币保存失败'), 'error');
                }
            });
        }
        const quoteSel = document.getElementById('fxQuoteSelect');
        if (quoteSel && !quoteSel.dataset.bound) {
            quoteSel.dataset.bound = '1';
            quoteSel.addEventListener('change', () => { this._quote = quoteSel.value; this.render(); });
        }
        const amt = document.getElementById('fxAmount');
        if (amt && !amt.dataset.bound) {
            amt.dataset.bound = '1';
            amt.addEventListener('input', () => this.render());
        }
        const search = document.getElementById('fxSearch');
        if (search && !search.dataset.bound) {
            search.dataset.bound = '1';
            search.addEventListener('input', () => { this._kw = search.value || ''; this.render(); });
        }
        const body = document.getElementById('fxTableBody');
        if (body && !body.dataset.bound) {
            body.dataset.bound = '1';
            // 事件委托：表格每次 render 重建，逐行绑定会重复挂载
            body.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.fx-setbase');
                if (!btn) return;
                this._quote = btn.dataset.fxBase;
                this.render();
            });
        }
        const refresh = document.getElementById('fxRefreshBtn');
        if (refresh && !refresh.dataset.bound) {
            refresh.dataset.bound = '1';
            refresh.addEventListener('click', async () => {
                if (!window.FxManager) return;
                refresh.disabled = true;
                const old = refresh.textContent;
                refresh.textContent = tt('common.loading', '加载中…');
                try {
                    await FxManager.refresh();
                    if (typeof showToast === 'function') showToast(tt('fx.toast.updated', '汇率已更新'), 'success');
                } catch (err) {
                    if (typeof showToast === 'function') {
                        showToast(tt('fx.toast.failed', '汇率刷新失败：{msg}').replace('{msg}', err.message || ''), 'error');
                    }
                } finally {
                    refresh.disabled = false;
                    refresh.textContent = old;
                    this.render();
                }
            });
        }
    },
};

export default FxRates;
