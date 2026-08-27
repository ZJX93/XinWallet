/**
 * AIProviderManager - AI 服务商与 OCR 配置管理
 *
 * 拆分来源：public/js/app.js
 * 原始位置：app.js 第 4728 ~ 4979 行（const AIProviderManager = { ... };）
 * 拆分说明：从单体 app.js 按对象真实边界提取，完整保留原代码；
 *          依赖项（api / showToast / cache / AIRecognition / escapeHtml 等）
 *          仍由 app.js 提供，本模块在 app.js 之后加载即可直接使用。
 */

const AIProviderManager = {
    providers: [],
    editingId: null,

    // 每个服务商分别内置两种接口类型（anthropic + openai 兼容）的完整配置
    // 用户切换接口类型时地址/模型自动跟着变，不再出现「OpenAI 兼容 + Anthropic 路径」这种矛盾
    PRESETS: {
        minimax: {
            name: 'MiniMax',
            desc: '国内直连·国内版和海外版域名不同，请按你的账号注册地选择',
            caps: ['chat', 'tools'],
            keyHint: '访问 platform.minimaxi.com → API Keys 创建密钥（国内版）',
            models: ['MiniMax-M3', 'MiniMax-Text-01'],
            // 国内版
            'anthropic_cn': { base_url: 'https://api.minimaxi.com/anthropic/v1', model: 'MiniMax-M3' },
            'openai_cn':    { base_url: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
            // 海外版
            'anthropic_en': { base_url: 'https://api.MiniMax.chat/anthropic/v1', model: 'MiniMax-M3' },
            'openai_en':    { base_url: 'https://api.MiniMax.chat/v1', model: 'MiniMax-M3' }
        },
        deepseek: {
            name: 'DeepSeek',
            desc: '国内直连·高性价比，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.deepseek.com → API Keys 创建密钥',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            'anthropic_cn': { base_url: 'https://api.deepseek.com/anthropic/v1', model: 'deepseek-chat' },
            'openai_cn':    { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
        },
        groq: {
            name: 'Groq',
            desc: '免费·极速，支持对话和语音转写（Whisper），推荐用于语音记账',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 console.groq.com → API Keys 免费创建密钥',
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'whisper-large-v3'],
            'openai_en':    { base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' }
        },
        kimi: {
            name: 'Kimi',
            desc: '国内直连·长上下文，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.moonshot.cn → API Keys 创建密钥',
            models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
            'openai_cn':    { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' }
        },
        zhipu: {
            name: '智谱 AI',
            desc: '国内直连·有免费额度，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 open.bigmodel.cn → API Keys 创建密钥',
            models: ['glm-4-flash', 'glm-4', 'glm-4-air'],
            'openai_cn':    { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' }
        },
        openai: {
            name: 'OpenAI',
            desc: '官方·全功能支持（对话+语音转写），需海外网络',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.openai.com → API Keys 创建密钥',
            models: ['gpt-4o-mini', 'gpt-4o', 'whisper-1'],
            'openai_en':    { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
        },
        anthropic: {
            name: 'Anthropic',
            desc: 'Claude·支持对话和函数调用，不支持语音转写',
            caps: ['chat', 'tools'],
            keyHint: '访问 console.anthropic.com → API Keys 创建密钥',
            models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
            'anthropic_en': { base_url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' }
        },
        ollama: {
            name: 'Ollama 本地',
            desc: '本地部署·无需 API Key，不支持语音转写',
            caps: ['chat'],
            keyHint: '无需 Key（本地运行 Ollama 即可）',
            models: ['llama3.1', 'qwen2.5', 'phi3'],
            'openai_en':    { base_url: 'http://127.0.0.1:11434/v1', model: 'llama3.1' }
        }
    },

    // 检测服务商所属地区（基于服务商名匹配预设）
    detectPresetByName(name) {
        const trimmed = (name || '').trim().toLowerCase();
        for (const [key, preset] of Object.entries(this.PRESETS)) {
            if (preset.name.toLowerCase() === trimmed) return key;
        }
        return null;
    },

    // 根据当前选中的服务商名 + 接口类型，找出对应的 variant key
    // 默认国内版（除非 base_url 明确包含海外域名）；若目标地区无对应 variant，回退到另一地区
    resolveVariantKey(presetKey, apiType, currentBaseUrl) {
        const preset = this.PRESETS[presetKey];
        if (!preset) return null;
        const url = (currentBaseUrl || '').toLowerCase();
        const isEN = url.includes('minimax.chat') || url.includes('anthropic.com')
                  || url.includes('api.openai.com') || url.includes('api.groq.com')
                  || url.includes('127.0.0.1:11434') || url.includes('localhost:11434');
        const isCN = url && (url.includes('minimaxi.com') || url.includes('moonshot.cn')
                          || url.includes('bigmodel.cn') || url.includes('deepseek.com'));
        // 1. 按当前 base_url 判断
        const preferred = isEN && !isCN ? 'en' : 'cn';
        if (preset[`${apiType}_${preferred}`]) return `${apiType}_${preferred}`;
        // 2. 回退：找任何一个匹配的 variant
        const alt = preferred === 'cn' ? 'en' : 'cn';
        if (preset[`${apiType}_${alt}`]) return `${apiType}_${alt}`;
        return null;
    },

    init() {
        document.getElementById('aiAddProviderBtn').addEventListener('click', () => this.openModal());
        document.getElementById('aiProviderModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('aiProviderCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('aiProviderForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        document.getElementById('aiProviderTestBtn').addEventListener('click', () => this.test());
        document.querySelectorAll('#aiProviderPresets .btn').forEach(btn => {
            btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
        });
        // 接口类型切换时提示 base_url 是否匹配
        document.getElementById('aiProviderType').addEventListener('change', (e) => this.onApiTypeChange(e.target.value));
        // 服务商名称变化时，如果匹配预设则更新 base_url（用户可能从下拉改成手输）
        document.getElementById('aiProviderName').addEventListener('change', (e) => {
            const presetKey = this.detectPresetByName(e.target.value);
            if (presetKey) {
                this.applyPreset(presetKey);
            }
        });
        document.getElementById('aiProviderList').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const id = parseInt(btn.dataset.id);
            if (btn.classList.contains('ai-provider-edit')) this.openModal(id);
            if (btn.classList.contains('ai-provider-delete')) this.delete(id);
            if (btn.classList.contains('ai-provider-activate')) this.activate(id);
        });
        this.initOcrConfig();
    },

    async refresh() {
        const res = await api('/ai/providers');
        if (!res) return;
        this.providers = res.providers || [];
        this.render();
        // 重置 AI 服务商检测缓存，让分析页面等组件能重新检测
        AIRecognition.hasProvider = null;
    },

    render() {
        const list = document.getElementById('aiProviderList');
        const empty = document.getElementById('aiProviderEmpty');
        if (!this.providers.length) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        list.innerHTML = this.providers.map(p => {
            const caps = this.getProviderCaps(p);
            const capBadges = caps.map(c => `<span class="provider-cap-badge ${c.cls}">${c.label}</span>`).join('');
            return `
            <div class="provider-card ${p.is_active ? 'active' : ''}">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        ${escapeHtml(p.name)}
                        <span class="provider-card-badge ${p.is_active ? 'active' : ''}">${p.is_active ? '当前启用' : p.api_type}</span>
                    </div>
                </div>
                <div class="provider-card-meta">
                    <div>模型：${escapeHtml(p.model)}</div>
                    <div>地址：${escapeHtml(p.base_url)}</div>
                    <div>Key：${p.api_key ? '已保存' : '未设置'}</div>
                </div>
                <div class="provider-card-caps">${capBadges}</div>
                <div class="provider-card-actions">
                    ${p.is_active ? '<span class="btn btn-ghost btn-sm" disabled>已启用</span>' : `<button class="btn btn-primary btn-sm ai-provider-activate" data-id="${p.id}">启用</button>`}
                    <button class="btn btn-ghost btn-sm ai-provider-edit" data-id="${p.id}">编辑</button>
                    <button class="btn btn-ghost btn-sm ai-provider-delete" data-id="${p.id}">删除</button>
                </div>
            </div>
            `;
        }).join('');
    },

    // 根据服务商配置推断能力标签
    getProviderCaps(p) {
        const caps = [];
        const url = (p.base_url || '').toLowerCase();
        const isAnthropic = p.api_type === 'anthropic';
        const isMiniMax = url.includes('minimaxi.com') || url.includes('minimax.chat');
        const isOllama = url.includes('127.0.0.1:11434') || url.includes('localhost:11434');
        caps.push({ label: '对话', cls: 'cap-chat' });
        // 函数调用：所有现代大模型都支持；Ollama 取决于具体模型（标注为可用但不绝对）
        if (!isOllama) caps.push({ label: '函数调用', cls: 'cap-tools' });
        // 语音转写：需要 /audio/transcriptions 接口；Anthropic 类型服务商不支持（除非有专门的 OpenAI 兼容）
        // 这里采用宽松判断：只要不是 anthropic 类型且域名不在 anthropic.com / minimaxi.com / minimax.chat，就认为支持
        if (!isAnthropic && !isMiniMax) caps.push({ label: '语音转写', cls: 'cap-voice' });
        return caps;
    },

    // 接口类型切换时检查 base_url 是否匹配
    onApiTypeChange(type) {
        const baseUrl = document.getElementById('aiProviderBaseUrl').value.trim();
        const hint = document.getElementById('aiBaseUrlHint');
        if (!baseUrl) return;
        const isAnthropicUrl = baseUrl.includes('/anthropic/') || baseUrl.includes('anthropic.com');
        if (type === 'anthropic' && !isAnthropicUrl) {
            hint.textContent = '⚠️ 当前接口地址看起来不是 Anthropic 格式，请确认地址是否正确';
            hint.style.color = 'var(--color-warning)';
        } else if (type === 'openai' && isAnthropicUrl) {
            hint.textContent = '⚠️ 当前接口地址包含 anthropic 路径，OpenAI 兼容类型通常不需要 /anthropic/ 前缀';
            hint.style.color = 'var(--color-warning)';
        } else {
            hint.textContent = '通常以 /v1 结尾，无需尾部斜杠';
            hint.style.color = '';
        }
    },

    openModal(id) {
        this.editingId = id || null;
        document.getElementById('aiProviderModalTitle').textContent = id ? '编辑服务商' : '添加服务商';
        document.getElementById('aiProviderMsg').textContent = '';
        document.getElementById('aiProviderMsg').className = 'form-msg';
        if (id) {
            const p = this.providers.find(x => x.id === id);
            if (!p) return;
            document.getElementById('aiProviderId').value = p.id;
            document.getElementById('aiProviderName').value = p.name;
            document.getElementById('aiProviderType').value = p.api_type;
            document.getElementById('aiProviderBaseUrl').value = p.base_url;
            document.getElementById('aiProviderModel').value = p.model;
            document.getElementById('aiProviderKey').value = '';
            document.getElementById('aiProviderKey').placeholder = p.api_key ? '已保存（修改请重新输入）' : 'sk-...';
            // 编辑时尝试匹配预设
            const presetKey = this.detectPresetByName(p.name);
            if (presetKey) {
                const preset = this.PRESETS[presetKey];
                const variantKey = this.resolveVariantKey(presetKey, p.api_type, p.base_url);
                this.updateModelList(preset.models);
                this.showPresetDesc(preset, variantKey);
                document.getElementById('aiKeyHint').textContent = preset.keyHint || '';
                this.clearPresetActive();
                const btn = document.querySelector(`#aiProviderPresets [data-preset="${presetKey}"]`);
                if (btn) btn.classList.add('preset-active');
            } else {
                this.updateModelList(null);
                this.showPresetDesc(null);
            }
        } else {
            document.getElementById('aiProviderForm').reset();
            document.getElementById('aiProviderId').value = '';
            document.getElementById('aiProviderKey').placeholder = 'sk-...';
            // 默认选择 Anthropic 接口类型 + MiniMax 国内版预设
            document.getElementById('aiProviderType').value = 'anthropic';
            this.applyPreset('minimax');
        }
        document.getElementById('aiProviderModal').classList.add('show');
    },

    closeModal() {
        document.getElementById('aiProviderModal').classList.remove('show');
        this.editingId = null;
    },

    applyPreset(key) {
        const p = this.PRESETS[key];
        if (!p) return;
        // 根据当前选中的接口类型选择对应的 variant
        const apiType = document.getElementById('aiProviderType').value || 'anthropic';
        const currentBaseUrl = document.getElementById('aiProviderBaseUrl').value.trim();
        const variantKey = this.resolveVariantKey(key, apiType, currentBaseUrl);
        const variant = variantKey ? p[variantKey] : null;

        document.getElementById('aiProviderName').value = p.name;
        if (variant) {
            document.getElementById('aiProviderBaseUrl').value = variant.base_url;
            document.getElementById('aiProviderModel').value = variant.model;
        }
        // 更新模型建议列表
        this.updateModelList(p.models);
        // 显示预设描述
        this.showPresetDesc(p, variantKey);
        // 更新 Key 提示
        document.getElementById('aiKeyHint').textContent = p.keyHint || '编辑时留空表示保留已保存的 Key';
        // 高亮选中的预设按钮
        this.clearPresetActive();
        const btn = document.querySelector(`#aiProviderPresets [data-preset="${key}"]`);
        if (btn) btn.classList.add('preset-active');
        // 重置 base_url 提示
        const hint = document.getElementById('aiBaseUrlHint');
        if (variant) {
            const regionLabel = variantKey.includes('_cn') ? '国内版' : '海外版';
            hint.textContent = `✅ 已自动填入${regionLabel}地址（${apiType === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}）`;
            hint.style.color = 'var(--color-success)';
        } else {
            hint.textContent = `⚠️ ${p.name} 不支持当前接口类型，请切换接口类型`;
            hint.style.color = 'var(--color-warning)';
        }
    },

    // 接口类型切换时自动调整 base_url（如果当前服务商名匹配某个预设）
    onApiTypeChange(type) {
        const nameEl = document.getElementById('aiProviderName');
        const baseUrlEl = document.getElementById('aiProviderBaseUrl');
        const modelEl = document.getElementById('aiProviderModel');
        const hint = document.getElementById('aiBaseUrlHint');
        const currentBaseUrl = baseUrlEl.value.trim();
        const presetKey = this.detectPresetByName(nameEl.value);
        if (!presetKey) {
            // 不是已知预设，只做格式校验提示
            const isAnthropicUrl = currentBaseUrl.includes('/anthropic/') || currentBaseUrl.includes('anthropic.com');
            if (type === 'anthropic' && !isAnthropicUrl && currentBaseUrl) {
                hint.textContent = '⚠️ 当前接口地址看起来不是 Anthropic 格式，请确认地址是否正确';
                hint.style.color = 'var(--color-warning)';
            } else if (type === 'openai' && isAnthropicUrl) {
                hint.textContent = '⚠️ 当前接口地址包含 anthropic 路径，OpenAI 兼容类型通常不需要 /anthropic/ 前缀';
                hint.style.color = 'var(--color-warning)';
            } else {
                hint.textContent = '通常以 /v1 结尾，无需尾部斜杠';
                hint.style.color = '';
            }
            return;
        }
        // 是已知预设：自动切换到对应 variant
        const preset = this.PRESETS[presetKey];
        const variantKey = this.resolveVariantKey(presetKey, type, currentBaseUrl);
        const variant = variantKey ? preset[variantKey] : null;
        if (!variant) {
            hint.textContent = `⚠️ ${preset.name} 不支持 ${type === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} 接口，请选择其他接口类型`;
            hint.style.color = 'var(--color-warning)';
            return;
        }
        // 自动更新 base_url 和 model
        baseUrlEl.value = variant.base_url;
        modelEl.value = variant.model;
        const regionLabel = variantKey.includes('_cn') ? '国内版' : '海外版';
        hint.textContent = `✅ 已自动切换到 ${preset.name} ${type === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} 接口（${regionLabel}）`;
        hint.style.color = 'var(--color-success)';
    },

    clearPresetActive() {
        document.querySelectorAll('#aiProviderPresets .btn').forEach(b => b.classList.remove('preset-active'));
    },

    updateModelList(models) {
        const datalist = document.getElementById('aiModelList');
        if (!models || !models.length) {
            datalist.innerHTML = '';
            return;
        }
        datalist.innerHTML = models.map(m => `<option value="${m}">`).join('');
    },

    showPresetDesc(preset, variantKey) {
        const el = document.getElementById('aiPresetDesc');
        if (!preset) { el.textContent = ''; return; }
        const caps = preset.caps || [];
        const capLabels = {
            chat: '对话', tools: '函数调用', voice: '语音转写'
        };
        const capText = caps.map(c => capLabels[c] || c).join(' · ');
        const region = variantKey?.includes('_cn') ? '国内版' : (variantKey?.includes('_en') ? '海外版' : '');
        const regionHtml = region ? ` <span class="preset-region-tag">${region}</span>` : '';
        el.innerHTML = `${regionHtml}${escapeHtml(preset.desc)} <span style="color:var(--text-tertiary)">| 支持：${capText}</span>`;
    },

    collect() {
        const isEdit = !!this.editingId;
        const existing = isEdit ? this.providers.find(x => x.id === this.editingId) : null;
        return {
            id: document.getElementById('aiProviderId').value || null,
            name: document.getElementById('aiProviderName').value.trim(),
            api_type: document.getElementById('aiProviderType').value,
            base_url: document.getElementById('aiProviderBaseUrl').value.trim(),
            model: document.getElementById('aiProviderModel').value.trim(),
            api_key: document.getElementById('aiProviderKey').value.trim(),
            // 编辑时保留原状态；新建时仅在没有其他服务商时自动激活
            is_active: isEdit ? (existing?.is_active ?? true) : (this.providers.length === 0),
            sort_order: 0
        };
    },

    async save() {
        const payload = this.collect();
        if (!payload.name) return this.setMsg('请输入服务商名称', 'error');
        if (!payload.base_url) return this.setMsg('请输入接口地址', 'error');
        if (!payload.model) return this.setMsg('请输入模型名', 'error');
        const isEdit = !!this.editingId;
        const res = isEdit
            ? await api(`/ai/providers/${this.editingId}`, 'PUT', payload)
            : await api('/ai/providers', 'POST', payload);
        if (res) {
            showToast(isEdit ? '服务商已更新' : '服务商已创建', 'success');
            this.closeModal();
            await this.refresh();
        } else {
            this.setMsg('保存失败，请检查输入或网络', 'error');
        }
    },

    async activate(id) {
        const res = await api(`/ai/providers/${id}/activate`, 'POST');
        if (res) {
            showToast('已启用该服务商', 'success');
            await this.refresh();
        } else {
            showToast('启用失败', 'error');
        }
    },

    async delete(id) {
        const p = this.providers.find(x => x.id === id);
        if (!p) return;
        if (!confirm(`确定删除服务商「${p.name}」吗？`)) return;
        const res = await api(`/ai/providers/${id}`, 'DELETE');
        if (res) {
            showToast('服务商已删除', 'success');
            await this.refresh();
        } else {
            showToast('删除失败', 'error');
        }
    },

    async test() {
        const payload = this.collect();
        if (!payload.base_url || !payload.model) {
            return this.setMsg('请填写接口地址和模型名后再测试', 'error');
        }
        // 新建时必须填 key；编辑时 key 可留空，后端会保留已保存的 key
        if (!this.editingId && !payload.api_key) {
            return this.setMsg('新建服务商时必须填写 API Key', 'error');
        }
        this.setMsg('正在测试连接...', 'info');
        // 临时保存到后端再调用 insight（确保后端有 key）
        const isEdit = !!this.editingId;
        const saveRes = isEdit
            ? await api(`/ai/providers/${this.editingId}`, 'PUT', { ...payload, is_active: true })
            : await api('/ai/providers', 'POST', { ...payload, is_active: true });
        if (!saveRes) {
            this.setMsg('保存失败，无法测试', 'error');
            return;
        }
        const res = await api('/ai/insight', 'POST', { month: cache.currentMonth });
        if (res) {
            showToast('连接成功，AI 接口可用', 'success');
            this.setMsg('连接成功！点击「保存」保留或「取消」关闭。如需切换对话服务商，请在列表中点击「启用」。', 'success');
            await this.refresh();
        } else {
            this.setMsg('连接测试失败，请检查 Key、模型名和接口地址', 'error');
        }
    },

    setMsg(text, type = '') {
        const el = document.getElementById('aiProviderMsg');
        el.textContent = text;
        el.className = 'form-msg' + (type ? ' ' + type : '');
    },

    // OCR 配置
    ocrCurrent: {},

    initOcrConfig() {
        const form = document.getElementById('ocrConfigForm');
        form.addEventListener('submit', (e) => { e.preventDefault(); this.saveOcrConfig(); });
        document.getElementById('ocrTestBtn').addEventListener('click', () => this.testOcr());
    },

    async refreshOcrConfig() {
        const res = await api('/ai/ocr-config');
        if (!res) return;
        this.ocrCurrent = res;
        document.getElementById('ocrSecretId').value = res.secret_id || '';
        document.getElementById('ocrSecretKey').value = '';
        document.getElementById('ocrSecretKey').placeholder = res.secret_id ? '已保存（修改请重新输入）' : 'SecretKey';
        document.getElementById('ocrRegion').value = res.region || 'ap-guangzhou';
        document.getElementById('ocrConfigMsg').textContent = '';
        document.getElementById('ocrConfigMsg').className = 'form-msg';

        // 关键：若后端报告 credentialsValid=false（密钥不匹配），明确提示用户
        if (res.secret_id && res.credentialsValid === false) {
            showToast('⚠️ 已加密的凭证无法解密，请重新填写 SecretId 和 SecretKey', 'warning', 6000);
            this.ocrSetMsg('⚠️ 已加密的凭证无法解密（' + (res.credentialsError || '密钥不匹配') + '），请重新填写凭证', 'error');
            // 强制清空占位符，让用户知道必须重新输入
            document.getElementById('ocrSecretId').value = '';
            document.getElementById('ocrSecretId').placeholder = '请重新输入（已加密数据无法解密）';
        }
    },

    async saveOcrConfig() {
        const payload = {
            secret_id: document.getElementById('ocrSecretId').value.trim(),
            secret_key: document.getElementById('ocrSecretKey').value.trim(),
            region: document.getElementById('ocrRegion').value.trim()
        };
        if (!payload.secret_id) return this.ocrSetMsg('SecretId 必填', 'error');
        if (!payload.secret_key && !this.ocrCurrent.secret_id) return this.ocrSetMsg('SecretKey 必填', 'error');
        const res = await api('/ai/ocr-config', 'POST', payload);
        if (res) {
            showToast('OCR 配置已保存', 'success');
            await this.refreshOcrConfig();
            this.ocrSetMsg('OCR 配置保存成功', 'success');
        } else {
            this.ocrSetMsg('保存失败', 'error');
        }
    },

    async testOcr() {
        this.ocrSetMsg('请先保存配置，然后使用 AI 识别页的截图上传功能测试', 'info');
    },

    ocrSetMsg(text, type = '') {
        const el = document.getElementById('ocrConfigMsg');
        el.textContent = text;
        el.className = 'form-msg' + (type ? ' ' + type : '');
    }
};

export default AIProviderManager;