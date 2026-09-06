// 从 js/app.js 中按 TagManager 对象真实边界拆分而来。
const TagManager = {
    init() {
        this.renderColorSwatches();
        document.getElementById('addTagBtn').addEventListener('click', () => this.openModal());
        document.getElementById('tagModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('tagCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('tagForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        document.getElementById('tagGrid').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del]');
            if (del) { this.remove(parseInt(del.dataset.del)); return; }
            const card = e.target.closest('.tag-card');
            if (card) this.filterByTag(parseInt(card.dataset.id));
        });
        this.populateTagFilter();
    },
    renderColorSwatches() {
        const wrap = document.getElementById('tagColorSwatches');
        wrap.innerHTML = TAG_PALETTE.map((c, i) => `<span class="color-swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}"></span>`).join('');
        document.getElementById('tagColor').value = TAG_PALETTE[0];
        wrap.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', () => {
            wrap.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
            sw.classList.add('active');
            document.getElementById('tagColor').value = sw.dataset.color;
        }));
    },
    openModal() {
        document.getElementById('tagEditId').value = '';
        document.getElementById('tagName').value = '';
        document.getElementById('tagIcon').value = '🏷️';
        document.getElementById('tagColor').value = TAG_PALETTE[0];
        document.querySelectorAll('#tagColorSwatches .color-swatch').forEach((x, i) => x.classList.toggle('active', i === 0));
        document.getElementById('tagModal').classList.add('show');
    },
    closeModal() { document.getElementById('tagModal').classList.remove('show'); },
    async save() {
        const body = {
            name: document.getElementById('tagName').value.trim(),
            color: document.getElementById('tagColor').value,
            icon: document.getElementById('tagIcon').value || '🏷️'
        };
        if (!body.name) { showToast(tt('tag.toast.nameRequired', '请输入标签名称'), 'error'); return; }
        await api('/tags', 'POST', body);
        showToast(tt('tag.toast.created', '标签已创建'), 'success');
        this.closeModal();
        await this.refresh();
    },
    async remove(id) {
        if (!confirmT('confirm.deleteTag', '确定删除该标签？关联的交易所属标记会一并移除。')) return;
        try {
            await api(`/tags/${id}`, 'DELETE');
            showToast(tt('tag.toast.deleted', '标签已删除'), 'warning');
            await this.refresh();
        } catch (err) {
            // api() 已显示错误 toast
        }
    },
    filterByTag(id) {
        const sel = document.getElementById('transTagFilter');
        if (sel) sel.value = String(id);
        window.switchPage && window.switchPage('transactions');
    },
    populateTagFilter() {
        const sel = document.getElementById('transTagFilter');
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = `<option value="all">${escapeHtml(tt('tag.filter.all', '所有标签'))}</option>` + (cache.tags || []).map(t => `<option value="${t.id}">${escapeHtml(t.icon || '')} ${escapeHtml(t.name)}</option>`).join('');
        if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    },
    async refresh() {
        const grid = document.getElementById('tagGrid');
        showSkeleton(grid, 6, 'grid');
        const tags = await api('/tags');
        cache.tags = tags || [];
        this.populateTagFilter();
        if (!cache.tags.length) { showEmpty(grid, tt('tag.empty', '还没有标签，点击右上角「新建标签」创建第一个吧')); return; }
        grid.innerHTML = cache.tags.map(t => `
            <div class="tag-card" style="--tag-color:${t.color}" data-id="${t.id}">
                <div class="tag-card-icon">${escapeHtml(t.icon || "🏷️")}</div>
                <div class="tag-card-body">
                    <div class="tag-card-name">${escapeHtml(t.name)}</div>
                    <div class="tag-card-meta">${escapeHtml(tt('tag.card.clickHint', '点击按此标签筛选交易'))}</div>
                </div>
                <button class="tag-card-del" data-del="${t.id}">${escapeHtml(tt('tag.card.delete', '删除'))}</button>
            </div>
        `).join('');
    }
};

export default TagManager;
