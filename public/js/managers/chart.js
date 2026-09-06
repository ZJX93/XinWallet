// 从 app.js 拆分而来，保留原始 ChartManager 对象实现。

const ChartManager = {
    charts: {},
    destroy(id) { if (this.charts[id]) { this.charts[id].destroy(); this.charts[id] = null; } },

    // 全局 Chart.js 默认配置 — 让所有折线图/条形图/环图自带灵动动画 + 更好的交互
    _defaultsApplied: false,
    applyDefaults() {
        if (this._defaultsApplied) return;
        if (typeof Chart === 'undefined') return;
        this._defaultsApplied = true;
        const reduceMotion = this.reduceMotion();
        Chart.defaults.font.family = this.fontFamily();
        Chart.defaults.font.size = 11;
        Chart.defaults.color = this._cssVar('--text-secondary', '#6a6058');
        Chart.defaults.animation = {
            duration: reduceMotion ? 0 : 1200,
            easing: 'easeOutQuart'
        };
        Chart.defaults.animations.colors = false;
        Chart.defaults.animations.x = { type: 'number', easing: 'easeOutQuart', duration: reduceMotion ? 0 : 1000 };
        Chart.defaults.animations.y = { type: 'number', easing: 'easeOutQuart', duration: reduceMotion ? 0 : 1000 };
        Chart.defaults.elements.line.tension = 0.4;
        Chart.defaults.elements.line.borderWidth = 2.5;
        Chart.defaults.elements.point.radius = 0;
        Chart.defaults.elements.point.hoverRadius = 6;
        Chart.defaults.elements.point.hoverBorderWidth = 3;
        Chart.defaults.elements.point.hoverBorderColor = '#fff';
        Chart.defaults.elements.bar.borderRadius = 8;
        Chart.defaults.elements.bar.borderSkipped = false;
        Chart.defaults.plugins.tooltip.cornerRadius = 10;
        Chart.defaults.plugins.tooltip.padding = 12;
        Chart.defaults.plugins.tooltip.titleFont = { weight: '600' };
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.padding = 12;
    },

    // 读取 CSS 变量或回退硬编码值
    _cssVar(name, fallback) {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
            return v || fallback;
        } catch (e) { return fallback; }
    },

    fontFamily() {
        return this._cssVar('--font-sans', 'system-ui, -apple-system, "Segoe UI", sans-serif');
    },

    reduceMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    // Y 轴刻度缩写：中文用「万 / 亿」，英文用 K / M / B（万对英文读者无意义）
    axisTick(v) {
        const n = Number(v);
        if (!isFinite(n)) return v;
        const abs = Math.abs(n);
        const sign = n < 0 ? '-' : '';
        const isZh = !(window.I18N && window.I18N.isZh && !window.I18N.isZh());
        if (isZh) {
            // 这个分支本身只在中文界面走，万/亿 直接内联（放进字典反而会出现「英文键存中文值」的死键）
            if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + '亿';
            if (abs >= 1e4) return sign + (abs / 1e4).toFixed(1) + '万';
            return v;
        }
        if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
        return v;
    },

    colors() {
        const dk = document.documentElement.getAttribute('data-theme') === 'dark';
        // Chart.js 无法解析 oklch() 格式，需要转为 rgb 或 hex
        // 读取 CSS 变量后检查是否为 oklch 开头，如果是则用 fallback
        const resolve = (cssVar, fallback) => {
            const v = this._cssVar(cssVar, fallback);
            return (v && !v.startsWith('oklch')) ? v : fallback;
        };
        /**
         * 分类占比配色：莫兰迪低饱和色系。
         *
         * 三端同源（安卓 Charts.kt:SLICE_PALETTE / 鸿蒙 Charts.ets:SLICE_PALETTE），
         * 由 scripts/gen-morandi-palette.js 按 HSV 换算并校验后固化 —— 改色请改脚本重跑，
         * 不要手改 hex，三处不一致时同一笔支出在三端会是三种颜色。
         *
         * 约束（脚本强制校验，全部通过）：
         *   S=16~32%  低饱和莫兰迪区间，不许混进高饱和色
         *   相邻色相距离 ≥90°  环图按金额降序上色，数组相邻项必然在环上并排
         *   卡片底对比 ≥1.6:1  低于此值色块会和卡片底融掉
         *
         * 首色贴品牌棕（26°，品牌色 #995F2C 为 27°）：占比最大的分类用品牌调。
         * 旧板前 5 色是 S=35~50% 的中饱和暖色（#b87a3e/#c47a72…），在暖棕卡片上抢戏，
         * 且与安卓/鸿蒙的莫兰迪板完全不同色系 —— 同一笔支出在 web 和手机上是两种颜色。
         */
        const lightCats = [
            '#B89881','#84B3AC','#B38581','#88A4B8','#BDAF84',
            '#AA8FB8','#9AB388','#B88C9A','#9797B8','#A7C7AC'
        ];
        // 暗色：同色相同饱和，仅提亮一档（V+8）—— 暗底上要提亮而非加饱和，
        // 加饱和会让低饱和体系变味，提亮才能保住莫兰迪的灰调。
        const darkCats = [
            '#CCAC93','#97C7C1','#C79793','#9BB8CC','#D1C297',
            '#BEA3CC','#ADC79B','#CC9FAE','#ABABCC','#BDDBC2'
        ];
        return {
            text:   resolve('--text-primary',   dk ? '#e8e4df' : '#3a3028'),
            textSec:resolve('--text-secondary',  dk ? '#a8a29a' : '#6a6058'),
            grid:   resolve('--border-subtle',    dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
            inc:    resolve('--income',           dk ? '#d98a82' : '#c0392b'),
            exp:    resolve('--expense',           dk ? '#7fbf94' : '#27ae60'),
            pri:    resolve('--accent-500',        '#8B6B4A'),
            war:    resolve('--warning-500',       '#f59e0b'),
            info:   resolve('--info-500',          '#6a9bc7'),
            bg:     dk ? '#2a2622' : '#ffffff',
            cats:   dk ? darkCats : lightCats
        };
    },

    /**
     * 环图单击 / 双击派发器。
     *
     * Chart.js 只有 onClick，没有 onDblClick —— 双击时它会连发两次 onClick。
     * 所以「单击看金额、双击下钻」必须自己判定：首次点击不立刻执行，挂一个
     * DBL_MS 的定时器；若窗口内来了第二次点击同一扇区，撤销定时器直接走下钻。
     *
     * 为什么按扇区索引判定而不是纯时间：在 A 上点一下、紧接着点 B，
     * 时间上够快但语义是「两次单击」，不是双击。带上索引才能区分。
     *
     * @param key      每个环图独立的状态键（同页多个环图不能共用计时器）
     * @param index    命中的扇区下标
     * @param onSingle 单击回调（显示金额）
     * @param onDouble 双击回调（下钻）；不传则退化为纯单击
     */
    _DBL_MS: 260,
    _dispatchPieClick(key, index, onSingle, onDouble) {
        if (!this._pieClickState) this._pieClickState = {};
        const st = this._pieClickState;
        const prev = st[key];
        // 第二次点击命中同一扇区 → 双击
        if (prev && prev.index === index) {
            clearTimeout(prev.timer);
            st[key] = null;
            if (onDouble) onDouble();
            return;
        }
        // 切换了扇区：前一次的单击立即兑现（不能吞掉），再开始新的等待
        if (prev) {
            clearTimeout(prev.timer);
            if (prev.onSingle) prev.onSingle();
        }
        const timer = setTimeout(() => {
            st[key] = null;
            if (onSingle) onSingle();
        }, onDouble ? this._DBL_MS : 0);
        st[key] = { index, timer, onSingle };
    },

    /** 切换数据/重绘前清掉待决的单击，避免定时器回调打到已销毁的 chart 上 */
    _cancelPieClick(key) {
        const st = this._pieClickState;
        if (st && st[key]) { clearTimeout(st[key].timer); st[key] = null; }
    },

    /**
     * 环图中心读数：未选中显示合计，选中显示「分类名 · 占比」+ 该块金额。
     * 三处环图（仪表盘 / 报表支出 / 报表收入）共用，避免各写一遍插件。
     *
     * @param id        插件 id（Chart.js 要求唯一）
     * @param c         颜色表
     * @param getState  返回 { title, amount } 的函数 —— 用函数而非快照值，
     *                  因为选中态变化时只重绘不重建 chart，插件必须读到最新值。
     */
    _pieCenterPlugin(id, c, getState) {
        const self = this;
        return {
            id,
            afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                const st = getState() || {};
                const cx = (chartArea.left + chartArea.right) / 2;
                const cy = (chartArea.top + chartArea.bottom) / 2;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // 标题行可能是「餐饮 · 32.5%」，比「总支出」长得多。
                // 环心可用宽 ≈ 内径 = 直径 × cutout(72%)，超了就压到色带上，
                // 所以按可用宽等比缩字号（12px 起，最低 9px）。
                const inner = Math.min(chartArea.right - chartArea.left, chartArea.bottom - chartArea.top) * 0.72;
                const maxW = inner - 12;
                const title = st.title || '';
                let fs = 12;
                ctx.font = fs + 'px ' + self.fontFamily();
                while (fs > 9 && ctx.measureText(title).width > maxW) {
                    fs -= 0.5;
                    ctx.font = fs + 'px ' + self.fontFamily();
                }
                ctx.fillStyle = c.textTertiary || c.textSec || c.text;
                ctx.fillText(title, cx, cy - 12);
                // 金额行同理，18px 起，最低 12px
                let as = 18;
                const amount = st.amount || '';
                ctx.font = '700 ' + as + 'px ' + self.fontFamily();
                while (as > 12 && ctx.measureText(amount).width > maxW) {
                    as -= 0.5;
                    ctx.font = '700 ' + as + 'px ' + self.fontFamily();
                }
                ctx.fillStyle = c.text;
                ctx.fillText(amount, cx, cy + 10);
                ctx.restore();
            }
        };
    },

    async refreshAll() {
        if (typeof window !== 'undefined' && typeof window.refreshCurrentPage === 'function') {
            await window.refreshCurrentPage();
            return;
        }
        await this.renderDash();
    },

    // 仪表盘趋势折线图（收入/支出/储蓄率）
    async renderDash() {
        this.applyDefaults();
        const data = await api('/stats/dashboard');
        if (!data) return;
        const c = this.colors();
        // 趋势图
        this.destroy('dashTrend');
        const trendCanvas = document.getElementById('dashTrendChart');
        if (!trendCanvas) { console.warn('[chart] dashTrendChart canvas not found, skipping'); return; }
        const ctx1 = trendCanvas.getContext('2d');
        const months = [...data.months].reverse();

        // 渐变填充
        const incGrad = ctx1.createLinearGradient(0, 0, 0, 220);
        incGrad.addColorStop(0, c.inc + '30');
        incGrad.addColorStop(1, c.inc + '04');
        const expGrad = ctx1.createLinearGradient(0, 0, 0, 220);
        expGrad.addColorStop(0, c.exp + '30');
        expGrad.addColorStop(1, c.exp + '04');

        this.charts['dashTrend'] = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: months.map(m => tt('chart.monthLabel', '{m}月').replace('{m}', m.month.substring(5))),
                datasets: [
                    { label: tt('chart.income', '收入'), data: months.map(m => m.income), borderColor: c.inc, backgroundColor: incGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.inc, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 },
                    { label: tt('chart.expense', '支出'), data: months.map(m => m.expense), borderColor: c.exp, backgroundColor: expGrad, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: c.exp, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 3, borderWidth: 2.5 },
                    { label: tt('chart.savingsRate', '储蓄率'), data: months.map(m => m.savingsRate), borderColor: c.info, backgroundColor: c.info + '20', yAxisID: 'y1', tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, borderDash: [5, 4] }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: this.reduceMotion() ? false : { duration: 1200, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: c.bg, titleColor: c.text, bodyColor: c.text,
                        borderColor: c.grid, borderWidth: 1, cornerRadius: 10, padding: 12
                    }
                },
                scales: {
                    x: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } },
                    y: { ticks: { color: c.text, font: { size: 10 } }, grid: { color: c.grid, drawBorder: false } },
                    y1: { position: 'right', ticks: { color: c.text, font: { size: 10 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } }
                }
            }
        });

        // 最新月环比（months 已升序，最新在末尾）
        const latest = months[months.length - 1];
        const momEl = document.getElementById('dashTrendMoM');
        if (momEl && latest) {
            const f = v => v == null ? '—' : (v >= 0 ? '▲' : '▼') + Math.abs(v).toFixed(1) + '%';
            momEl.innerHTML = tt('chart.mom', '环比 收{in} 支{out}')
                .replace('{in}', f(latest.incomeMoM)).replace('{out}', f(latest.expenseMoM));
        }

        // 饼图（支出构成）：仅显示一级分类，点击扇区下钻到二级（数据库已做子级向父级汇总）
        this.destroy('dashPie');
        const pieCanvas = document.getElementById('dashPieChart');
        if (!pieCanvas) { console.warn('[chart] dashPieChart canvas not found'); return; }
        this._pieCtx = pieCanvas.getContext('2d');
        this._pieColors = c;
        this._pieStack = [];
        const summary = await api(`/transactions/summary?month=${cache.currentMonth}`);
        if (summary && summary.expenseByCategory && summary.expenseByCategory.length > 0) {
            this._clearPieEmpty('dashPieChart');
            const hintEl = document.getElementById('dashPieHint');
            if (hintEl) hintEl.style.display = '';
            this._pieFull = summary.expenseByCategory;
            this._drawDashPie();
            if (!this._pieBackBound) {
                const backEl = document.getElementById('dashPieBack');
                if (backEl) {
                    backEl.addEventListener('click', () => {
                        if (this._pieStack && this._pieStack.length) {
                            this._cancelPieClick('dashPie');
                            this._pieSelIdx = -1;
                            this._pieStack.pop();
                            this._drawDashPie();
                        }
                    });
                    this._pieBackBound = true;
                }
            }
        } else {
            // 当月无支出记录：环图整段被跳过、画布留白像“坏了”，改用空状态占位。
            // 清空旧 chart 并复位下钻栈，保证后续月份有数据时能从一级重新绘制。
            this.destroy('dashPie');
            this._pieStack = [];
            this._pieFull = null;
            this._showPieEmpty('dashPieChart', tt('chart.pieEmpty', '本月暂无支出记录\n记一笔后这里会显示支出构成'));
            const hintEl = document.getElementById('dashPieHint');
            if (hintEl) hintEl.style.display = 'none';
        }
    },

    // 当月无支出时给环图卡片一个占位，避免画布空白像渲染失败
    _showPieEmpty(canvasId, msg) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.style.display = 'none';
        const wrap = canvas.parentElement;
        if (!wrap) return;
        let empty = wrap.querySelector('.pie-empty');
        if (!empty) {
            empty = document.createElement('div');
            empty.className = 'pie-empty';
            wrap.appendChild(empty);
        }
        // 允许用 \n 换行
        empty.innerHTML = `<div class="empty-text">${
            String(msg).split('\n').map(l => `<div>${l}</div>`).join('')
        }</div>`;
    },

    // 有数据时清掉占位、恢复画布（_drawDashPie 绘制前调用）
    _clearPieEmpty(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.style.display = '';
        const wrap = canvas.parentElement;
        const empty = wrap && wrap.querySelector('.pie-empty');
        if (empty) empty.remove();
    },

    // 仪表盘支出饼图绘制（支持按一级 + 下钻子级）
    _drawDashPie() {
        const ctx = this._pieCtx;
        const c = this._pieColors;
        if (!ctx || !this._pieFull) return;
        this.destroy('dashPie');

        const stack = this._pieStack || [];
        const cats = this._pieFull;
        // 当前层级切片：栈空=一级（parent_id 为 null）；否则取栈顶父级的直接子级
        const slices = stack.length === 0
            ? cats.filter(e => e.parent_id == null)
            : cats.filter(e => e.parent_id === stack[stack.length - 1]);
        this._pieSlices = slices;

        // 面包屑标题 + 返回按钮
        const titleEl = document.getElementById('dashPieTitle');
        const backEl = document.getElementById('dashPieBack');
        const hintEl = document.getElementById('dashPieHint');
        if (titleEl) {
            const rootTitle = tt('dash.card.expenseComposition', '支出构成');
            if (stack.length === 0) {
                titleEl.textContent = rootTitle;
            } else {
                const names = stack.map(id => (cats.find(x => x.id === id) || {}).name || '');
                titleEl.textContent = rootTitle + ' › ' + names.join(' › ');
            }
        }
        if (backEl) backEl.style.display = stack.length ? '' : 'none';
        if (hintEl) hintEl.style.display = stack.length ? 'none' : '';

        const total = slices.reduce((s, e) => s + parseFloat(e.total || 0), 0);
        // 重绘时清掉待决的单击 —— 否则定时器回调会打到已 destroy 的 chart 上
        this._cancelPieClick('dashPie');
        // 层级变了，旧的选中下标指向的已是另一个分类
        if (this._pieSelIdx == null || stack.length !== (this._pieSelStackLen || 0)) {
            this._pieSelIdx = -1;
            this._pieSelStackLen = stack.length;
        }

        // 中心读数：未选中「总支出 ¥合计」，单击某块后「分类名 · 占比 ¥该块金额」
        const centerTextPlugin = this._pieCenterPlugin('dashPieCenter', c, () => {
            const i = this._pieSelIdx;
            if (i != null && i >= 0 && i < slices.length) {
                const e = slices[i];
                const v = parseFloat(e.total || 0);
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return {
                    title: `${e.name} · ${pct}%`,
                    amount: fmt(v)
                };
            }
            return { title: tt('dash.detail.totalExpense', '总支出'), amount: fmt(total) };
        });
        this.charts['dashPie'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: slices.map(e => e.icon + ' ' + e.name),
                datasets: [{
                    data: slices.map(e => parseFloat(e.total || 0)),
                    backgroundColor: slices.map((_, i) => c.cats[i % c.cats.length]),
                    borderColor: 'rgba(255, 252, 245, 0.95)',  /* 暖白间隙色，与卡片背景融合 */
                    borderWidth: 3,                            /* 扇区之间留出 3px 暖白细缝 */
                    borderRadius: 6,                          /* 扇区两端圆角，不呆板 */
                    spacing: 2,                                /* 扇区间距 */
                    hoverOffset: 8,                            /* hover 时扇区向外滑出 */
                    // 选中块外扩，让单击有明确的视觉落点（等价于 hover，但触屏没有 hover）
                    offset: slices.map((_, i) => (i === this._pieSelIdx ? 8 : 0))
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '72%',
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const idx = els[0].index;
                    const cat = slices[idx];
                    if (!cat) return;
                    const hasChildren = this._pieFull.some(x => x.parent_id === cat.id);
                    this._dispatchPieClick(
                        'dashPie',
                        idx,
                        // 单击：选中该块 → 环心显示它的金额与占比
                        () => { this._pieSelIdx = idx; this._drawDashPie(); },
                        // 双击：下钻到二级（无子类则退化为单击，不做无意义的层级切换）
                        hasChildren
                            ? () => { this._pieSelIdx = -1; this._pieStack.push(cat.id); this._drawDashPie(); }
                            : null
                    );
                },
                plugins: {
                    legend: { display: false },  // 参考文件：环图无图例（中心数字代替）
                    // 环图一律不显示悬浮标注：中心读数已经承担「分类名 · 占比 + 金额」的展示，
                    // 再叠一个 tooltip 是重复信息，而且会遮住环体下半部分（用户 2026-08-24 反馈）。
                    tooltip: { enabled: false }
                }
            },
            plugins: [centerTextPlugin]
        });
    },

    async renderInvestPie(byType) {
        this.applyDefaults();
        this.destroy('invAllocation');
        const canvas = document.getElementById('invAllocationPie');
        if (!canvas) { console.warn('[chart] invAllocationPie canvas not found, skipping'); return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const c = this.colors();
        const entries = Object.entries(byType);
        if (entries.length === 0) return;

        const labels = entries.map(([, v]) => v.icon + ' ' + v.type_name);
        const data = entries.map(([, v]) => v.total_value);
        const total = data.reduce((s, v) => s + v, 0);
        const colors = entries.map((_, i) => c.cats[i % c.cats.length]);
        // 缓存渲染参数，供单击选中后重绘（理财配置无层级，不需要下钻栈）
        this._invPieArgs = byType;
        this._cancelPieClick('invAllocation');
        if (this._invSelIdx == null) this._invSelIdx = -1;

        // 中心读数：未选中「总市值 ¥合计」，单击某块后「类型名 · 占比 ¥该块市值」
        const centerTextPlugin = this._pieCenterPlugin('invPieCenter', c, () => {
            const i = this._invSelIdx;
            if (i != null && i >= 0 && i < entries.length) {
                const v = data[i];
                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
                return {
                    title: `${entries[i][1].type_name} · ${pct}%`,
                    amount: fmt(v)
                };
            }
            return { title: tt('chart.totalValue', '总市值'), amount: fmt(total) };
        });

        this.charts['invAllocation'] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: 'rgba(255, 252, 245, 0.95)',  // 暖白间隙色，与卡片背景融合
                    borderWidth: 3,                             // 扇区之间留出 3px 暖白细缝
                    borderRadius: 6,                           // 扇区两端圆角，不呆板
                    spacing: 2,                                 // 扇区间距
                    hoverOffset: 8,                            // hover 时扇区向外滑出
                    offset: entries.map((_, i) => (i === this._invSelIdx ? 8 : 0))
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: true, cutout: '72%',
                animation: this.reduceMotion() ? false : { animateScale: true, animateRotate: true, duration: 800, easing: 'easeOutQuart' },
                // 理财配置按类型聚合，本身没有二级层级 —— 只做单击看金额，不传双击回调。
                // 不传时 _dispatchPieClick 用 0ms 定时器，等价于立即执行，无延迟感。
                onClick: (evt, els) => {
                    if (!els.length) return;
                    const idx = els[0].index;
                    this._dispatchPieClick('invAllocation', idx, () => {
                        // 再次点同一块 → 取消选中，回到总市值
                        this._invSelIdx = (this._invSelIdx === idx) ? -1 : idx;
                        this.renderInvestPie(this._invPieArgs);
                    }, null);
                },
                plugins: {
                    legend: { display: false },  // 首页风格：无图例，中心数字代替
                    // 同 dashPie：中心读数已含类型名 · 占比 + 金额，tooltip 属重复信息且遮挡环体。
                    tooltip: { enabled: false }
                }
            },
            plugins: [centerTextPlugin]
        });
    },

    // 理财市值趋势折线图 — 渐变填充 + 平滑曲线 + 灵动动画
    async renderInvTrend(totalTrend) {
        this.applyDefaults();
        this.destroy('invTrend');
        const canvas = document.getElementById('invTrendChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const c = this.colors();
        if (!totalTrend || totalTrend.length === 0) return;

        const allDates = [...new Set(totalTrend.map(p => p.date))].sort();
        if (allDates.length === 0) return;

        // 数据点不足时显示提示
        if (allDates.length < 2) {
            canvas.style.display = 'none';
            const wrap = canvas.parentElement;
            let hint = wrap.querySelector('.chart-hint');
            if (!hint) {
                hint = document.createElement('div');
                hint.className = 'chart-hint';
                hint.style.cssText = 'display:flex;align-items:center;justify-content:center;height:220px;color:var(--text-muted);font-size:14px;';
                wrap.appendChild(hint);
            }
            hint.textContent = tt('chart.trendNotEnough', '暂无足够的历史数据，买入后次日将显示趋势');
            hint.style.display = 'flex';
            return;
        }
        // 恢复 canvas 显示，隐藏提示
        canvas.style.display = '';
        const wrap = canvas.parentElement;
        const hint = wrap.querySelector('.chart-hint');
        if (hint) hint.style.display = 'none';

        // 只画一条「总市值」线（按日期汇总所有持仓市值）
        const baseColor = c.pri;
        const grad = ctx.createLinearGradient(0, 0, 0, 220);
        grad.addColorStop(0, baseColor + '40');
        grad.addColorStop(1, baseColor + '02');
        const datasets = [{
            label: tt('chart.totalValue', '总市值'),
            data: allDates.map(d => { const pt = totalTrend.find(p => p.date === d); return pt ? pt.value : null; }),
            borderColor: baseColor,
            backgroundColor: grad,
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: baseColor,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 3,
            borderWidth: 3,
            spanGaps: true
        }];

        this.charts['invTrend'] = new Chart(ctx, {
            type: 'line',
            data: { labels: allDates.map(d => d.slice(5)), datasets },
            options: {
                responsive: true, maintainAspectRatio: true,
                animation: this.reduceMotion() ? false : { duration: 1200, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: c.bg,
                        titleColor: c.text, bodyColor: c.text,
                        borderColor: c.grid, borderWidth: 1,
                        cornerRadius: 10, padding: 12,
                        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: c.textSec, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: c.grid, drawBorder: false } },
                    y: { ticks: { color: c.textSec, font: { size: 9 }, callback: v => ChartManager.axisTick(v), padding: 4 }, grid: { color: c.grid, drawBorder: false }, beginAtZero: false }
                }
            }
        });
    },

    // 理财类型对比柱状图 — 圆角 + 标签 + 渐变 + 灵动动画
    async renderInvTypeBar(byType) {
        this.applyDefaults();
        this.destroy('invTypeBar');
        const canvas = document.getElementById('invTypeBarChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const c = this.colors();
        if (!byType || byType.length === 0) return;

        const labels = byType.map(t => t.icon + ' ' + t.type_name);
        const costData = byType.map(t => t.total_cost);
        const valueData = byType.map(t => t.total_value);

        // 渐变色
        const costGrad = ctx.createLinearGradient(0, 0, 0, 220);
        costGrad.addColorStop(0, c.cats[0] + 'cc');
        costGrad.addColorStop(1, c.cats[0] + '66');
        const valGrad = ctx.createLinearGradient(0, 0, 0, 220);
        valGrad.addColorStop(0, c.cats[2] + 'cc');
        valGrad.addColorStop(1, c.cats[2] + '66');

        this.charts['invTypeBar'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: tt('chart.invested', '投入本金'), data: costData, backgroundColor: costGrad, borderColor: c.cats[0], borderWidth: 1, borderRadius: 8, borderSkipped: false, hoverBackgroundColor: c.cats[0] },
                    { label: tt('chart.currentValue', '当前市值'), data: valueData, backgroundColor: valGrad, borderColor: c.cats[2], borderWidth: 1, borderRadius: 8, borderSkipped: false, hoverBackgroundColor: c.cats[2] }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                animation: this.reduceMotion() ? false : { duration: 1000, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: c.text, font: { family: ChartManager.fontFamily(), size: 10 }, padding: 10, boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyleWidth: 12 }
                    },
                    tooltip: {
                        backgroundColor: c.bg,
                        titleColor: c.text, bodyColor: c.text,
                        borderColor: c.grid, borderWidth: 1,
                        cornerRadius: 10, padding: 12,
                        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: c.textSec, font: { size: 9 } }, grid: { display: false }, border: { display: false } },
                    y: { ticks: { color: c.textSec, font: { size: 9 }, callback: v => ChartManager.axisTick(v), padding: 4 }, grid: { color: c.grid, drawBorder: false }, beginAtZero: true }
                }
            }
        });
    }
};

export default ChartManager;
