/**
 * AISettings - AI 识别行为设置（Web「AI 配置」页读写）
 *
 * 读写 /api/ai/settings：DB 保存值优先，未保存的项自动沿用
 * 服务器环境变量（AI_*）默认值。保存后立即生效，无需重启服务。
 *
 * 覆盖项：
 *   model_route        模型复核总开关       ← AI_ALLOW_MODEL_ROUTE（默认 true）
 *   model_route_simple 简单输入也过模型     ← AI_MODEL_ROUTE_SIMPLE（默认 false）
 *   llm_first          模型主抽取           ← AI_LLM_FIRST（默认 false）
 *   few_shot           历史先例注入         ← AI_FEWSHOT_ENABLED（默认 true）
 *   prompt_version     prompt 版本 v3/v2/v1 ← AI_PARSER_PROMPT_VERSION（默认 v3）
 *
 * 与 AIProviderManager 相同：直接使用 app.js 提供的全局 api / showToast。
 */

const AISettings = {
    current: null,

    async init() {
        const form = document.getElementById('aiSettingsForm');
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';
        form.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    },

    async refresh() {
        const res = await api('/ai/settings');
        if (!res || !res.settings) return;
        this.current = res.settings;
        this.fill();
        this.setMsg('', '');
    },

    fill() {
        const s = this.current || {};
        this.setChecked('aiSettingModelRoute', s.model_route);
        this.setChecked('aiSettingModelRouteSimple', s.model_route_simple);
        this.setChecked('aiSettingLlmFirst', s.llm_first);
        this.setChecked('aiSettingFewShot', s.few_shot);
        const v = document.getElementById('aiSettingPromptVersion');
        if (v && s.prompt_version) v.value = s.prompt_version;
        const n = document.getElementById('aiSettingAiName');
        if (n) n.value = s.ai_name || '';
    },

    setChecked(id, val) {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    },

    collect() {
        const nameEl = document.getElementById('aiSettingAiName');
        return {
            model_route: !!document.getElementById('aiSettingModelRoute').checked,
            model_route_simple: !!document.getElementById('aiSettingModelRouteSimple').checked,
            llm_first: !!document.getElementById('aiSettingLlmFirst').checked,
            few_shot: !!document.getElementById('aiSettingFewShot').checked,
            prompt_version: document.getElementById('aiSettingPromptVersion').value,
            ai_name: (nameEl && nameEl.value) ? nameEl.value.trim() : '',
        };
    },

    async save() {
        const payload = this.collect();
        const res = await api('/ai/settings', 'PUT', { settings: payload });
        if (!res) return;
        showToast('AI 识别设置已保存', 'success');
        this.current = res.settings;
        this.fill();
        this.setMsg('设置已保存，新的识别请求将立即生效。', 'success');
    },

    setMsg(text, type = '') {
        const el = document.getElementById('aiSettingsMsg');
        if (!el) return;
        el.textContent = text;
        el.className = 'form-msg' + (type ? ' ' + type : '');
    },
};

export default AISettings;
