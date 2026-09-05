/* ============================================
   用户偏好管理（多币种 P2-2a + i18n 后端持久化）
   - 复用 ai_user_profiles.preferences JSONB（已有 API：GET/PATCH /api/ai/profile）
   - 缓存 preferences：{ language, baseCurrency, ... }
   - 切换语言/币种时 PATCH preferences.<key>；profile-service 按 JSON 整体写入字段，
     所以前端必须合并已有 cache 后再 PATCH，避免丢失其他字段（如 baseCurrency）。
   - load 失败时使用安全默认（baseCurrency='CNY'），保证首次 PATCH 不清空后端其他字段。
   ============================================ */

const PreferencesManager = {
    _cache: null,
    _loadPromise: null,

    async load() {
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = (async () => {
            try {
                const profile = await api('/ai/profile');
                const prefs = (profile && profile.preferences) || {};
                // 安全默认：baseCurrency 必有（PATCH 整体覆盖需保留所有字段）
                this._cache = { language: null, baseCurrency: 'CNY', ...prefs };
            } catch (e) {
                console.warn('PreferencesManager.load 失败，使用默认:', e.message);
                this._cache = { language: null, baseCurrency: 'CNY' };
            }
            return this._cache;
        })();
        return this._loadPromise;
    },

    get(key) { return this._cache ? this._cache[key] : null; },
    get lang() { return this.get('language'); },
    get baseCurrency() { return this.get('baseCurrency') || 'CNY'; },

    async _patch(partial) {
        if (!this._cache) await this.load();
        const merged = Object.assign({}, this._cache, partial);
        try {
            await api('/ai/profile', 'PATCH', { preferences: merged });
        } catch (e) {
            console.warn('PreferencesManager PATCH 后端失败（本地仍生效）:', e.message);
        }
        this._cache = merged;
        window.dispatchEvent(new CustomEvent('preferences:changed', { detail: { preferences: this._cache } }));
    },

    async setLanguage(lang) {
        await this._patch({ language: lang });
    },
    async setBaseCurrency(cur) {
        const code = String(cur || 'CNY').toUpperCase();
        await this._patch({ baseCurrency: code });
        window.dispatchEvent(new CustomEvent('currency:changed', { detail: { baseCurrency: code } }));
    },
};

if (typeof window !== 'undefined') window.PreferencesManager = PreferencesManager;
if (typeof module !== 'undefined' && module.exports) module.exports = PreferencesManager;
