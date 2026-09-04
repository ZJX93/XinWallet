// ============================================================
// DataManager —— 基础数据维护模块（分类 / 理财类型 / 通用编辑弹窗）
// ------------------------------------------------------------
// 拆分来源：public/js/app.js
// 原始位置：第 4089 行 ~ 第 4326 行（共 238 行）
// 拆分日期：2026-07-22
// 拆分原因：将单体 app.js 按职责拆分为 ES Module，便于按需加载与维护
// 依赖（运行时全局）：api、escapeHtml、showToast、confirm，
//                    TagManager（跨模块调用 refresh），
//                    initColorSwatches（全局函数），
//                    以及 DOM 元素（dcEditModal、dcEditForm、dcEditKind、
//                    dcEditId、dcEditTitle、dcEditParentId、dcEditName、
//                    dcEditIcon、dcEditCatType、dcEditSort、dcEditColor、
//                    dcEditRisk、dcEditInvSort、dcEditDesc、dcRowCatExtra、
//                    dcRowInvExtra、dcRowDesc、dcRowColor、catTableBody、
//                    catFilterType、addCatBtn、invTypeTableBody、
//                    addInvTypeBtn、dcColorSwatches、dcEditClose、
//                    dcEditCancel 等）
// ============================================================

const DataManager = {
    _collapsedCats: new Set(),

    init() {
        // Tab 切换
        document.querySelectorAll('.dc-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.dc-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.dc-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('dcPanel-' + tab.dataset.dctab).classList.add('active');
                if (tab.dataset.dctab === 'tags') TagManager.refresh();
                if (tab.dataset.dctab === 'books') this.refreshBooks();
            });
        });

        // 分类
        document.getElementById('addCatBtn').addEventListener('click', () => this.openCatModal());
        document.getElementById('catFilterType').addEventListener('change', () => this.refreshCats());
        document.getElementById('dcEditClose').addEventListener('click', () => this.closeEditModal());
        document.getElementById('dcEditCancel').addEventListener('click', () => this.closeEditModal());
        document.getElementById('dcEditForm').addEventListener('submit', e => { e.preventDefault(); this.saveEdit(); });
        initColorSwatches('dcColorSwatches', 'dcEditColor');

        // 理财类型
        document.getElementById('addInvTypeBtn').addEventListener('click', () => this.openInvTypeModal());

        // 弹窗遮罩关闭
        document.getElementById('dcEditModal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeEditModal();
        });

        // 分类表格操作委托
        document.getElementById('catTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'edit-cat') this.openCatModal(parseInt(btn.dataset.id));
            else if (action === 'add-subcat') this.openCatModal(null, parseInt(btn.dataset.pid));
            else if (action === 'del-cat') this.deleteCat(parseInt(btn.dataset.id), btn.dataset.name);
            else if (action === 'toggle-cat') this.toggleCat(parseInt(btn.dataset.id));
        });

        // 理财类型表格操作委托
        document.getElementById('invTypeTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'edit-invtype') this.openInvTypeModal(parseInt(btn.dataset.id));
            else if (action === 'del-invtype') this.deleteInvType(parseInt(btn.dataset.id), btn.dataset.name);
        });
        // 可见性 ON/OFF 开关：监听 checkbox 变化（而非 click，以便响应键盘空格 + 失败时易回滚）
        document.getElementById('invTypeTableBody').addEventListener('change', (e) => {
            const cb = e.target;
            if (cb && cb.dataset && cb.dataset.action === 'toggle-invtype') {
                this.toggleInvType(parseInt(cb.dataset.id), cb.checked);
            }
        });

        // 账本管理
        document.getElementById('addBookBtn').addEventListener('click', () => this.openBookModal());
        document.getElementById('bookTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'edit-book') this.openBookModal(parseInt(btn.dataset.id));
            else if (action === 'switch-book') this.switchBook(parseInt(btn.dataset.id));
            else if (action === 'del-book') this.deleteBook(parseInt(btn.dataset.id), btn.dataset.name);
        });
    },

    async refresh() {
        await this.refreshCats();
        await this.refreshInvTypes();
    },

    // ---- 分类 ----
    async refreshCats() {
        const filter = document.getElementById('catFilterType').value;
        const qs = filter ? `?type=${filter}` : '';
        const data = await api('/categories' + qs);
        const tbody = document.getElementById('catTableBody');
        if (!data || !data.tree || data.tree.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-text">暂无分类数据</div></div></td></tr>';
            return;
        }
        const typeLabel = { expense: '支出', income: '收入', transfer: '转账' };

        const renderRow = (c, depth, hidden) => {
            const hasChildren = c.children && c.children.length > 0;
            const collapsed = hasChildren && this._collapsedCats.has(c.id);
            const childHidden = hidden || collapsed;
            return `
            <tr class="${depth > 0 ? 'dc-sub-row' : 'dc-parent-row'}" style="${hidden ? 'display:none;' : ''}">
                <td>
                    ${hasChildren
                        ? `<button class="cat-toggle ${collapsed ? 'collapsed' : ''}" data-action="toggle-cat" data-id="${c.id}" aria-label="${collapsed ? '展开' : '折叠'}" aria-expanded="${!collapsed}">${collapsed ? '▶' : '▼'}</button>`
                        : (depth === 0 ? '<span class="cat-toggle-spacer"></span>' : '')}
                    <span style="font-size:${depth > 0 ? '16' : '20'}px;padding-left:${depth > 0 ? depth * 20 : 0}px;display:inline-block">${depth > 0 ? '└ ' : ''}${escapeHtml(c.icon || "📌")}</span>
                </td>
                <td>${escapeHtml(c.name)}${hasChildren ? ` <span class="dc-child-count">(${c.children.length}个子类)</span>` : ''}</td>
                <td><span class="badge ${c.type === 'income' ? 'badge-income' : c.type === 'transfer' ? 'badge-transfer' : 'badge-expense'}">${typeLabel[c.type] || c.type}</span></td>
                <td><span class="color-dot" style="background:${c.color}"></span></td>
                <td>${c.sort_order}</td>
                <td class="dc-actions">
                    <button class="btn-ghost-sm" data-action="edit-cat" data-id="${c.id}">✏️</button>
                    <button class="btn-ghost-sm" data-action="add-subcat" data-pid="${c.id}">➕</button>
                    <button class="btn-ghost-sm btn-danger-sm" data-action="del-cat" data-id="${c.id}" data-name="${escapeHtml(c.name)}">🗑️</button>
                </td>
            </tr>
            ${hasChildren ? c.children.map(ch => renderRow(ch, depth + 1, childHidden)).join('') : ''}
        `;};

        tbody.innerHTML = data.tree.map(c => renderRow(c, 0, false)).join('');
    },

    openCatModal(id, parentId) {
        document.getElementById('dcEditKind').value = 'category';
        document.getElementById('dcRowCatExtra').style.display = '';
        document.getElementById('dcRowInvExtra').style.display = 'none';
        document.getElementById('dcRowDesc').style.display = 'none';
        document.getElementById('dcRowColor').style.display = '';
        if (id) {
            this._loadCat(id);
        } else {
            document.getElementById('dcEditTitle').textContent = parentId ? '新增子分类' : '新增分类';
            document.getElementById('dcEditId').value = '';
            document.getElementById('dcEditParentId').value = parentId || '';
            document.getElementById('dcEditName').value = '';
            document.getElementById('dcEditIcon').value = '📌';
            document.getElementById('dcEditCatType').value = 'expense';
            document.getElementById('dcEditSort').value = '0';
            document.getElementById('dcEditColor').value = '#6366f1';
            document.getElementById('dcEditModal').classList.add('show');
        }
    },

    async _loadCat(id) {
        const data = await api('/categories?flat=1');
        const cat = data.find(c => c.id === id);
        if (!cat) return;
        document.getElementById('dcEditTitle').textContent = cat.parent_id ? '编辑子分类' : '编辑分类';
        document.getElementById('dcEditId').value = cat.id;
        document.getElementById('dcEditParentId').value = cat.parent_id || '';
        document.getElementById('dcEditName').value = cat.name;
        document.getElementById('dcEditIcon').value = cat.icon;
        document.getElementById('dcEditCatType').value = cat.type;
        document.getElementById('dcEditSort').value = cat.sort_order;
        document.getElementById('dcEditColor').value = cat.color || '#6366f1';
        document.getElementById('dcEditModal').classList.add('show');
    },

    async deleteCat(id, name) {
        if (!confirm(`确定删除分类「${name}」？有交易记录或子分类的分类无法删除。`)) return;
        try {
            await api('/categories/' + id, 'DELETE');
            showToast('分类已删除', 'success');
            this.refreshCats();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },

    toggleCat(id) {
        if (this._collapsedCats.has(id)) this._collapsedCats.delete(id);
        else this._collapsedCats.add(id);
        this.refreshCats();
    },

    // ---- 理财类型 ----
    async refreshInvTypes() {
        const data = await api('/investment-types');
        const tbody = document.getElementById('invTypeTableBody');
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-text">暂无理财类型</div></div></td></tr>';
            return;
        }
        const riskLabel = { low: '低风险', medium: '中风险', high: '高风险', very_high: '极高风险' };
        tbody.innerHTML = data.map(t => `
            <tr>
                <td><span style="font-size:20px">${escapeHtml(t.icon || "💹")}</span></td>
                <td>${escapeHtml(t.name)}</td>
                <td><span class="badge badge-risk ${t.risk_level}">${riskLabel[t.risk_level] || t.risk_level}</span></td>
                <td>${escapeHtml(t.description || '-')}</td>
                <td>${t.sort_order}</td>
                <td class="dc-actions">
                    <button class="btn-ghost-sm" data-action="edit-invtype" data-id="${t.id}">✏️</button>
                    <button class="btn-ghost-sm btn-danger-sm" data-action="del-invtype" data-id="${t.id}" data-name="${escapeHtml(t.name)}">🗑️</button>
                    <label class="ios-toggle" title="${(t.is_active != false) ? '点击关闭该类型（从新增理财下拉隐藏）' : '点击启用该类型（重新出现在新增理财下拉）'}"><input type="checkbox" data-action="toggle-invtype" data-id="${t.id}"${(t.is_active != false) ? ' checked' : ''}><span class="ios-toggle-track"><span class="ios-toggle-text-on">ON</span><span class="ios-toggle-knob"></span><span class="ios-toggle-text-off">OFF</span></span></label>
                </td>
            </tr>
        `).join('');
    },

    openInvTypeModal(id) {
        document.getElementById('dcEditKind').value = 'invtype';
        document.getElementById('dcRowCatExtra').style.display = 'none';
        document.getElementById('dcRowInvExtra').style.display = '';
        document.getElementById('dcRowDesc').style.display = '';
        document.getElementById('dcRowColor').style.display = 'none';
        if (id) {
            this._loadInvType(id);
        } else {
            document.getElementById('dcEditTitle').textContent = '新增理财类型';
            document.getElementById('dcEditId').value = '';
            document.getElementById('dcEditName').value = '';
            document.getElementById('dcEditIcon').value = '💰';
            document.getElementById('dcEditRisk').value = 'medium';
            document.getElementById('dcEditInvSort').value = '0';
            document.getElementById('dcEditDesc').value = '';
            document.getElementById('dcEditModal').classList.add('show');
        }
    },

    async _loadInvType(id) {
        const data = await api('/investment-types');
        const t = data.find(x => x.id === id);
        if (!t) return;
        document.getElementById('dcEditTitle').textContent = '编辑理财类型';
        document.getElementById('dcEditId').value = t.id;
        document.getElementById('dcEditName').value = t.name;
        document.getElementById('dcEditIcon').value = t.icon;
        document.getElementById('dcEditRisk').value = t.risk_level;
        document.getElementById('dcEditInvSort').value = t.sort_order;
        document.getElementById('dcEditDesc').value = t.description || '';
        document.getElementById('dcEditModal').classList.add('show');
    },

    async deleteInvType(id, name) {
        if (!confirm(`确定删除理财类型「${name}」？有持仓记录的类型无法删除。`)) return;
        try {
            await api('/investment-types/' + id, 'DELETE');
            showToast('理财类型已删除', 'success');
            this.refreshInvTypes();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },

    async toggleInvType(id, makeActive) {
        try {
            await api('/investment-types/' + id, 'PATCH', { active: makeActive });
            showToast(makeActive ? '已启用该理财类型（重新出现在新增理财下拉）' : '已关闭该理财类型（从新增理财下拉隐藏）', 'success');
            // 同步更新全局缓存，使「新增理财」下拉立即反映可见性变化（无需刷新整页）
            if (typeof cache !== 'undefined' && Array.isArray(cache.investmentTypes)) {
                const c = cache.investmentTypes.find(t => t.id === id);
                if (c) c.is_active = makeActive;
            }
            // 不调 refreshInvTypes()：checkbox 的 checked 状态已经反映了新可见性，
            // 重新拉列表只为了让开关闪一下。
        } catch (err) {
            // api() 已显示错误 toast —— 把 checkbox 回滚到原始状态
            const cb = document.querySelector(`#invTypeTableBody input[data-action="toggle-invtype"][data-id="${id}"]`);
            if (cb) cb.checked = !makeActive;
        }
    },

    // ---- 账本管理 ----
    async refreshBooks() {
        const data = await api('/books');
        const tbody = document.getElementById('bookTableBody');
        const books = (data && data.books) || [];
        this._books = books;
        if (books.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-text">暂无账本</div></div></td></tr>';
            return;
        }
        tbody.innerHTML = books.map(b => `
            <tr>
                <td><span style="font-size:20px">${escapeHtml(b.icon || '📒')}</span></td>
                <td>${escapeHtml(b.name)}</td>
                <td><span class="color-dot" style="background:${escapeHtml(b.color || '#6366f1')}"></span></td>
                <td>${b.is_default ? '<span class="badge">默认</span>' : ''}</td>
                <td class="dc-actions">
                    <button class="btn-ghost-sm" data-action="edit-book" data-id="${b.id}" title="编辑">✏️</button>
                    ${b.is_default ? '' : `<button class="btn-ghost-sm" data-action="switch-book" data-id="${b.id}" title="设为默认">⭐</button>`}
                    <button class="btn-ghost-sm btn-danger-sm" data-action="del-book" data-id="${b.id}" data-name="${escapeHtml(b.name)}" title="删除">🗑️</button>
                </td>
            </tr>
        `).join('');
    },

    openBookModal(id) {
        document.getElementById('dcEditKind').value = 'book';
        document.getElementById('dcRowCatExtra').style.display = 'none';
        document.getElementById('dcRowInvExtra').style.display = 'none';
        document.getElementById('dcRowDesc').style.display = 'none';
        document.getElementById('dcRowColor').style.display = '';
        if (id) {
            const b = (this._books || []).find(x => x.id === id);
            if (!b) return;
            document.getElementById('dcEditTitle').textContent = '编辑账本';
            document.getElementById('dcEditId').value = b.id;
            document.getElementById('dcEditName').value = b.name;
            document.getElementById('dcEditIcon').value = b.icon || '📒';
            document.getElementById('dcEditColor').value = b.color || '#6366f1';
        } else {
            document.getElementById('dcEditTitle').textContent = '新增账本';
            document.getElementById('dcEditId').value = '';
            document.getElementById('dcEditName').value = '';
            document.getElementById('dcEditIcon').value = '📒';
            document.getElementById('dcEditColor').value = '#6366f1';
        }
        document.getElementById('dcEditModal').classList.add('show');
    },

    async switchBook(id) {
        try {
            await api(`/books/${id}/switch`, 'POST');
            showToast('已切换默认账本', 'success');
            await this.refreshBooks();
            if (typeof window.loadBooks === 'function') await window.loadBooks();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },

    async deleteBook(id, name) {
        if (!confirm(`确定删除账本「${name}」？其下数据将并入默认账本。`)) return;
        try {
            await api('/books/' + id, 'DELETE');
            showToast('账本已删除', 'success');
            await this.refreshBooks();
            if (typeof window.loadBooks === 'function') await window.loadBooks();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },

    // ---- 通用保存 ----
    async saveEdit() {
        const kind = document.getElementById('dcEditKind').value;
        const id = document.getElementById('dcEditId').value;
        if (kind === 'category') {
            const nameVal = document.getElementById('dcEditName').value.trim();
            if (!nameVal) {
                if (typeof showToast === 'function') showToast('请填写分类名称', 'error');
                return;
            }
            const parentVal = document.getElementById('dcEditParentId').value;
            const body = {
                parent_id: parentVal ? parseInt(parentVal) : null,
                name: nameVal,
                icon: document.getElementById('dcEditIcon').value,
                type: document.getElementById('dcEditCatType').value,
                color: document.getElementById('dcEditColor').value,
                sort_order: parseInt(document.getElementById('dcEditSort').value) || 0
            };
            if (id) await api('/categories/' + id, 'PUT', body);
            else await api('/categories', 'POST', body);
            this.closeEditModal();
            this.refreshCats();
        } else if (kind === 'invtype') {
            const body = {
                name: document.getElementById('dcEditName').value,
                icon: document.getElementById('dcEditIcon').value,
                risk_level: document.getElementById('dcEditRisk').value,
                description: document.getElementById('dcEditDesc').value,
                sort_order: parseInt(document.getElementById('dcEditInvSort').value) || 0
            };
            if (id) await api('/investment-types/' + id, 'PUT', body);
            else await api('/investment-types', 'POST', body);
            this.closeEditModal();
            this.refreshInvTypes();
        } else if (kind === 'book') {
            const body = {
                name: document.getElementById('dcEditName').value,
                icon: document.getElementById('dcEditIcon').value,
                color: document.getElementById('dcEditColor').value
            };
            if (id) await api('/books/' + id, 'PUT', body);
            else await api('/books', 'POST', body);
            this.closeEditModal();
            await this.refreshBooks();
            if (typeof window.loadBooks === 'function') await window.loadBooks();
        }
    },

    closeEditModal() {
        document.getElementById('dcEditModal').classList.remove('show');
    }
};

export default DataManager;