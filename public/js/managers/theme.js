// 从 public/js/app.js 拆分而来（原文件第 199-215 行）
// ThemeManager: 主题切换管理（light / dark / system）
const ThemeManager = {
    _systemMql: null,
    _systemHandler: null,
    init() {
        this._systemMql = window.matchMedia('(prefers-color-scheme: dark)');
        this._systemHandler = () => {
            if ((localStorage.getItem('zhicai_theme') || 'light') === 'system') this.apply('system');
        };
        if (this._systemMql.addEventListener) this._systemMql.addEventListener('change', this._systemHandler);
        else if (this._systemMql.addListener) this._systemMql.addListener(this._systemHandler);
        const saved = localStorage.getItem('zhicai_theme') || 'light';
        this.apply(saved);
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.apply(btn.dataset.theme));
        });
    },
    apply(theme) {
        let eff = theme;
        const mql = this._systemMql || window.matchMedia('(prefers-color-scheme: dark)');
        if (theme === 'system') eff = mql.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', eff);
        localStorage.setItem('zhicai_theme', theme);
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
        setTimeout(() => { window.ChartManager && window.ChartManager.refreshAll(); }, 200);
    }
};

export default ThemeManager;