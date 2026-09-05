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
    // 每个服务商分别内置国内/国际两种地区的配置（variants[地区][接口类型]）。
    // 用户通过「国内版/国际版」按钮选择地区，接口类型切换时地址/模型自动跟着变，
    // 避免再出现「OpenAI 兼容 + Anthropic 路径」这类矛盾配置（典型如 DeepSeek 不支持 Anthropic 接口）。
    PRESETS: {
        minimax: {
            name: 'MiniMax',
            desc: '国内直连·国内版和国际版域名不同，请按你的账号注册地选择',
            caps: ['chat', 'tools'],
            keyHint: '访问 platform.minimaxi.com → API Keys 创建密钥（国内版）',
            models: ['MiniMax-M3', 'MiniMax-Text-01'],
            regions: ['cn', 'en'], defaultRegion: 'cn',
            variants: {
                cn: { anthropic: { base_url: 'https://api.minimaxi.com/anthropic/v1', model: 'MiniMax-M3' },
                      openai:    { base_url: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' } },
                en: { anthropic: { base_url: 'https://api.MiniMax.chat/anthropic/v1', model: 'MiniMax-M3' },
                      openai:    { base_url: 'https://api.MiniMax.chat/v1', model: 'MiniMax-M3' } }
            }
        },
        deepseek: {
            name: 'DeepSeek',
            desc: '国内直连·高性价比，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.deepseek.com → API Keys 创建密钥',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            regions: ['cn'], defaultRegion: 'cn',
            variants: {
                cn: { openai: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } }
            }
        },
        groq: {
            name: 'Groq',
            desc: '免费·极速，支持对话和语音转写（Whisper），推荐用于语音记账',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 console.groq.com → API Keys 免费创建密钥',
            models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'whisper-large-v3'],
            regions: ['en'], defaultRegion: 'en',
            variants: {
                en: { openai: { base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' } }
            }
        },
        kimi: {
            name: 'Kimi',
            desc: '国内直连·长上下文，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.moonshot.cn → API Keys 创建密钥',
            models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
            regions: ['cn'], defaultRegion: 'cn',
            variants: {
                cn: { openai: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' } }
            }
        },
        zhipu: {
            name: '智谱 AI',
            desc: '国内直连·有免费额度，仅 OpenAI 兼容接口',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 open.bigmodel.cn → API Keys 创建密钥',
            models: ['glm-4-flash', 'glm-4', 'glm-4-air'],
            regions: ['cn'], defaultRegion: 'cn',
            variants: {
                cn: { openai: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' } }
            }
        },
        openai: {
            name: 'OpenAI',
            desc: '官方·全功能支持（对话+语音转写），需国际网络',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '访问 platform.openai.com → API Keys 创建密钥',
            models: ['gpt-4o-mini', 'gpt-4o', 'whisper-1'],
            regions: ['en'], defaultRegion: 'en',
            variants: {
                en: { openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } }
            }
        },
        anthropic: {
            name: 'Anthropic',
            desc: 'Claude·支持对话和函数调用，不支持语音转写',
            caps: ['chat', 'tools'],
            keyHint: '访问 console.anthropic.com → API Keys 创建密钥',
            models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
            regions: ['en'], defaultRegion: 'en',
            variants: {
                en: { anthropic: { base_url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' } }
            }
        },
        ollama: {
            name: 'Ollama 本地',
            desc: '本地部署·无需 API Key，不支持语音转写',
            caps: ['chat'],
            keyHint: '无需 Key（本地运行 Ollama 即可）',
            models: ['llama3.1', 'qwen2.5', 'phi3'],
            regions: ['en'], defaultRegion: 'en',
            variants: {
                en: { openai: { base_url: 'http://127.0.0.1:11434/v1', model: 'llama3.1' } }
            }
        },
        // 自定义：不绑定任何预设地址，用户手动填写；隐藏国内/国际切换
        custom: {
            name: '自定义',
            desc: '手动填写任意兼容 OpenAI / Anthropic 协议的服务商地址与模型',
            caps: ['chat', 'tools', 'voice'],
            keyHint: '参考服务商官方文档填写接口地址（通常以 /v1 结尾）与模型名',
            models: [], custom: true, regions: [], defaultRegion: null
        }
    },

    // 当前选中的地区（'cn' | 'en' | null），由地区切换按钮驱动
    currentRegion: null,

    // 检测服务商所属预设（基于服务商名匹配预设）
    detectPresetByName(name) {
        const trimmed = (name || '').trim().toLowerCase();
        for (const [key, preset] of Object.entries(this.PRESETS)) {
            if (preset.custom) continue;          // 自定义不通过名称反查，避免与预设名"自定义"冲突
            if (preset.name.toLowerCase() === trimmed) return key;
        }
        return null;
    },

    // 根据服务商预设 + 接口类型 + 地区，解析出可用的 variant。
    // 返回 { region, apiType, variant } 或 null：
    //  - 先按 (region, apiType) 精确匹配；
    //  - 再在该地区内回退到其它接口类型（如 DeepSeek 选了 anthropic 会自动落到 openai）；
    //  - 最后跨地区回退（仅对多地区预设有意义）。
    resolveVariant(presetKey, apiType, region) {
        const preset = this.PRESETS[presetKey];
        if (!preset || preset.custom) return null;
        const regions = (preset.regions && preset.regions.length) ? preset.regions : [(region || preset.defaultRegion)].filter(Boolean);
        const tryRegion = (r) => {
            if (!r || !preset.variants[r]) return null;
            if (preset.variants[r][apiType]) return { region: r, apiType, variant: preset.variants[r][apiType] };
            const alt = apiType === 'anthropic' ? 'openai' : 'anthropic'; // 同地区回退其它接口类型
            if (preset.variants[r][alt]) return { region: r, apiType: alt, variant: preset.variants[r][alt] };
            return null;
        };
        const byRegion = tryRegion(region || preset.defaultRegion);
        if (byRegion) return byRegion;
        for (const r of regions) {                       // 跨地区回退
            const v = tryRegion(r);
            if (v) return v;
        }
        return null;
    },

    // 编辑已有服务商时，根据已保存的 base_url 推断所属地区（高亮对应按钮）
    inferRegionFromUrl(presetKey, baseUrl) {
        const preset = this.PRESETS[presetKey];
        if (!preset || preset.custom || !preset.regions || preset.regions.length < 2) return preset?.defaultRegion || null;
        const url = (baseUrl || '').toLowerCase();
        const isEN = url.includes('minimax.chat') || url.includes('anthropic.com')
                  || url.includes('api.openai.com') || url.includes('api.groq.com')
                  || url.includes('127.0.0.1:11434') || url.includes('localhost:11434');
        const isCN = url.includes('minimaxi.com') || url.includes('moonshot.cn')
                  || url.includes('bigmodel.cn') || url.includes('deepseek.com');
        if (isEN && !isCN) return 'en';
        if (isCN && !isEN) return 'cn';
        for (const r of preset.regions) {               // 无法二分时按预设匹配地址
            const v = preset.variants[r];
            if (v && Object.values(v).some(vr => url.includes(vr.base_url.toLowerCase()))) return r;
        }
        return null;
    },

    init() {
        document.getElementById('aiAddProviderBtn').addEventListener('click', () => this.openModal());
        document.getElementById('aiProviderModalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('aiProviderCancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('aiProviderForm').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
        document.getElementById('aiProviderTestBtn').addEventListener('click', () => this.test());
        document.getElementById('aiFetchModelsBtn').addEventListener('click', () => this.fetchModels());
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
        // 国内/国际地区切换按钮
        document.querySelectorAll('#aiProviderRegionSwitch .region-btn').forEach(btn => {
            btn.addEventListener('click', () => this.onRegionChange(btn.dataset.region));
        });
        document.getElementById('aiProviderList').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const id = parseInt(btn.dataset.id);
            if (btn.classList.contains('ai-provider-edit')) this.openModal(id);
            if (btn.classList.contains('ai-provider-delete')) this.delete(id);
            if (btn.classList.contains('ai-provider-activate')) this.activate(id);
            if (btn.classList.contains('ai-provider-check')) this.checkHealth(id);
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
                <div class="provider-health" data-health-for="${p.id}">${this.renderHealth(p.id)}</div>
                <div class="provider-card-actions">
                    ${p.is_active ? '<span class="btn btn-ghost btn-sm" disabled>已启用</span>' : `<button class="btn btn-ghost btn-sm ai-provider-activate" data-id="${p.id}">启用</button>`}
                    <button class="btn btn-ghost btn-sm ai-provider-check" data-id="${p.id}">检测</button>
                    <button class="btn btn-ghost btn-sm ai-provider-edit" data-id="${p.id}">编辑</button>
                    <button class="btn btn-ghost btn-sm ai-provider-delete" data-id="${p.id}">删除</button>
                </div>
            </div>
            `;
        }).join('');
    },

    // 各服务商最近一次检测结果：{ [id]: { state, text, at } }
    // state: checking | healthy | error；仅存内存，刷新页面即重置（不污染后端数据）
    health: {},

    renderHealth(id) {
        const h = this.health[id];
        if (!h) return '<span class="provider-health-dot unknown"></span><span class="provider-health-text">状态未知，点「检测」</span>';
        const title = h.text ? ` title="${escapeHtml(h.text)}"` : '';
        return `<span class="provider-health-dot ${h.state}"></span><span class="provider-health-text ${h.state}"${title}>${escapeHtml(h.label)}</span>`;
    },

    // 局部更新单张卡片的健康区域，避免整列表重绘打断用户操作
    paintHealth(id) {
        const el = document.querySelector(`[data-health-for="${id}"]`);
        if (el) el.innerHTML = this.renderHealth(id);
    },

    /**
     * 检测单个服务商连通性。
     * 复用后端 /providers/:id/test（只发一句「回复 OK」，轻量且不产生业务副作用）。
     */
    async checkHealth(id) {
        this.health[id] = { state: 'checking', label: '检测中…' };
        this.paintHealth(id);
        const started = Date.now();
        try {
            const res = await api(`/ai/providers/${id}/test`, 'POST', {}, { silent: true });
            const ms = Date.now() - started;
            if (res && res.ok) {
                this.health[id] = { state: 'healthy', label: `健康 · ${ms}ms`, text: res.reply || '' };
            } else {
                this.health[id] = { state: 'error', label: '异常', text: (res && res.error) || '未知错误' };
            }
        } catch (err) {
            this.health[id] = { state: 'error', label: '异常', text: err.message || '网络错误' };
        }
        this.paintHealth(id);
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
            this.clearPresetActive();
            if (presetKey) {
                const preset = this.PRESETS[presetKey];
                this.currentRegion = this.inferRegionFromUrl(presetKey, p.base_url);
                const resolved = this.resolveVariant(presetKey, p.api_type, this.currentRegion);
                this.updateModelList(preset.models);
                this.showPresetDesc(preset, resolved ? resolved.region : null);
                document.getElementById('aiKeyHint').textContent = preset.keyHint || '';
                const btn = document.querySelector(`#aiProviderPresets [data-preset="${presetKey}"]`);
                if (btn) btn.classList.add('preset-active');
                this.applyRegionUI(preset);
            } else {
                this.currentRegion = null;
                this.updateModelList(null);
                this.showPresetDesc(null);
                this.applyRegionUI(null);   // 自定义 → 隐藏地区切换
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
        document.getElementById('aiProviderName').value = p.name;
        // 高亮选中的预设按钮
        this.clearPresetActive();
        const btn = document.querySelector(`#aiProviderPresets [data-preset="${key}"]`);
        if (btn) btn.classList.add('preset-active');
        // 更新模型建议列表
        this.updateModelList(p.models);
        // 更新 Key 提示
        document.getElementById('aiKeyHint').textContent = p.keyHint || '编辑时留空表示保留已保存的 Key';
        // 自定义：隐藏地区切换，清空地址让用户手填自己的服务商名
        if (p.custom) {
            this.currentRegion = null;
            this.applyRegionUI(p);
            const nameEl = document.getElementById('aiProviderName');
            if (!nameEl.value || nameEl.value === p.name) nameEl.value = '';
            document.getElementById('aiProviderBaseUrl').value = '';
            document.getElementById('aiProviderModel').value = '';
            this.showPresetDesc(p, null);
            const hint = document.getElementById('aiBaseUrlHint');
            hint.textContent = '请填写服务商的完整接口地址（含 /v1 或 /messages 等路径）与模型名';
            hint.style.color = '';
            return;
        }
        // 非自定义：确保有地区，默认预设 defaultRegion
        this.currentRegion = (this.currentRegion && (p.regions || []).includes(this.currentRegion))
            ? this.currentRegion : p.defaultRegion;
        this.applyRegionUI(p);
        this.fillByRegionAndType(p);
    },

    // 根据当前地区 + 接口类型，从预设 variants 取出 base_url / model 并回填表单与提示
    fillByRegionAndType(preset) {
        const apiType = document.getElementById('aiProviderType').value || 'openai';
        const resolved = this.resolveVariant(this.detectPresetByName(document.getElementById('aiProviderName').value) || '', apiType, this.currentRegion);
        const hint = document.getElementById('aiBaseUrlHint');
        if (resolved) {
            // 若接口类型被回退（如 DeepSeek 选了 anthropic → 落到 openai），同步修正下拉
            if (resolved.apiType !== apiType) {
                document.getElementById('aiProviderType').value = resolved.apiType;
            }
            document.getElementById('aiProviderBaseUrl').value = resolved.variant.base_url;
            document.getElementById('aiProviderModel').value = resolved.variant.model;
            const regionLabel = resolved.region === 'cn' ? '国内版' : '国际版';
            const typeLabel = resolved.apiType === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容';
            const fallbackNote = resolved.apiType !== apiType ? '（已自动改为支持的接口类型）' : '';
            hint.textContent = `✅ 已自动填入${regionLabel}地址（${typeLabel}）${fallbackNote}`;
            hint.style.color = 'var(--color-success)';
        } else {
            hint.textContent = `⚠️ ${preset.name} 不支持当前接口类型，请切换接口类型或地区`;
            hint.style.color = 'var(--color-warning)';
        }
        this.showPresetDesc(preset, this.currentRegion);
    },

    // 显示/隐藏地区切换，并按 currentRegion 高亮按钮
    applyRegionUI(preset) {
        const group = document.getElementById('aiProviderRegionGroup');
        const sw = document.getElementById('aiProviderRegionSwitch');
        if (!preset || preset.custom || !(preset.regions && preset.regions.length)) {
            group.classList.add('hidden');
            return;
        }
        group.classList.remove('hidden');
        // 单地区预设也展示按钮（便于理解），但禁用不可选项
        sw.querySelectorAll('.region-btn').forEach(b => {
            const r = b.dataset.region;
            const supported = preset.regions.includes(r);
            b.classList.toggle('active', r === this.currentRegion);
            b.disabled = !supported;
            b.style.display = supported ? '' : 'none';
        });
    },

    // 点击国内/国际按钮
    onRegionChange(region) {
        this.currentRegion = region;
        const presetKey = this.detectPresetByName(document.getElementById('aiProviderName').value);
        const preset = this.PRESETS[presetKey];
        if (!preset || preset.custom) return;
        this.applyRegionUI(preset);
        this.fillByRegionAndType(preset);
    },

    // 接口类型切换时自动调整 base_url（如果当前服务商名匹配某个预设）
    onApiTypeChange(type) {
        const nameEl = document.getElementById('aiProviderName');
        const baseUrlEl = document.getElementById('aiProviderBaseUrl');
        const currentBaseUrl = baseUrlEl.value.trim();
        const hint = document.getElementById('aiBaseUrlHint');
        const presetKey = this.detectPresetByName(nameEl.value);
        if (!presetKey) {
            // 不是已知预设（如自定义），只做格式校验提示
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
        // 是已知预设：按当前地区切换到对应 variant
        const preset = this.PRESETS[presetKey];
        this.fillByRegionAndType(preset);
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

    // 拉取服务商可用模型：已保存走 GET /providers/:id/models（用已存 Key），
    // 新建未保存走 POST /providers/preview-models（用临时 Key，不落库）。Key 始终不出服务端。
    async fetchModels() {
        const btn = document.getElementById('aiFetchModelsBtn');
        const baseUrl = document.getElementById('aiProviderBaseUrl').value.trim();
        const apiType = document.getElementById('aiProviderType').value;
        if (!baseUrl) return this.setMsg('请先填写接口地址再拉取模型', 'error');
        const isEdit = !!this.editingId;
        let endpoint, method, payload = null;
        if (isEdit) {
            endpoint = `/ai/providers/${this.editingId}/models`;
            method = 'GET';
        } else {
            const key = document.getElementById('aiProviderKey').value.trim();
            if (!key) return this.setMsg('新建服务商请先填写 API Key 再拉取模型', 'error');
            endpoint = '/ai/providers/preview-models';
            method = 'POST';
            payload = { base_url: baseUrl, api_key: key, api_type: apiType };
        }
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '拉取中…';
        try {
            const res = await api(endpoint, method, payload, { silent: true });
            if (!res) { this.setMsg('拉取失败：无响应', 'error'); return; }
            if (res.ok === false) { this.setMsg('拉取失败：' + (res.error || res.message || '未知错误'), 'error'); return; }
            if (res.supported === false) {
                this.setMsg(res.message || '该服务商不支持自动列出模型，请手动输入', 'info');
                return;
            }
            const models = res.models || [];
            if (!models.length) {
                this.setMsg(res.error ? `拉取失败：${res.error}` : '未获取到可用模型，请确认地址/Key 或手动输入', 'error');
                return;
            }
            // HTML <datalist> 只会显示与输入框当前文字前缀匹配的 option；
            // 为让用户看到刚拉取的全部模型（而非仅以旧值为前缀的那一项），
            // 拉取成功后先清空输入框。用户点「拉取模型」的意图就是「换/选模型」，
            // 不点保存则不会影响 db（下次打开 modal 会从 db 回填）。
            document.getElementById('aiProviderModel').value = '';
            this.updateModelList(models);
            this.setMsg(`已拉取 ${models.length} 个模型，请从模型名下拉中选择`, 'success');
        } catch (err) {
            this.setMsg(`拉取失败：${err.message || '网络错误'}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    },

    showPresetDesc(preset, region) {
        const el = document.getElementById('aiPresetDesc');
        if (!preset) { el.textContent = ''; return; }
        const caps = preset.caps || [];
        const capLabels = {
            chat: '对话', tools: '函数调用', voice: '语音转写'
        };
        const capText = caps.map(c => capLabels[c] || c).join(' · ');
        const regionText = region === 'cn' ? '国内版' : region === 'en' ? '国际版' : '';
        const regionHtml = regionText ? ` <span class="preset-region-tag">${regionText}</span>` : '';
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

        // 先落库拿到 id（后端测试接口按 id 取解密后的 key）。
        // 注意：这里不再顺带把服务商置为启用 —— 测试只应验证连通性，
        // 不该在用户没点「启用」时就悄悄切换全局对话服务商。
        const isEdit = !!this.editingId;
        let pid = this.editingId;
        try {
            const saveRes = isEdit
                ? await api(`/ai/providers/${this.editingId}`, 'PUT', payload, { silent: true })
                : await api('/ai/providers', 'POST', payload, { silent: true });
            if (!isEdit) {
                pid = saveRes && saveRes.id;
                if (!pid) { this.setMsg('保存成功但未取到服务商 ID，无法测试', 'error'); return; }
                this.editingId = pid;
            }
        } catch (err) {
            this.setMsg(`保存失败，无法测试：${err.message || '未知错误'}`, 'error');
            return;
        }

        // 用专用轻量测试接口（只发一句「回复 OK」），而不是走 /ai/advice。
        // /ai/advice 会拉全量账务数据并生成完整建议，耗时长，且任何业务侧异常
        // （数据为空、超时、tool 调用失败）都会被笼统报成「内部错误」，
        // 让用户误以为是 Key/地址配错。
        // 另注意 api() 失败时是 throw 而非返回 null，必须 try/catch，
        // 否则错误分支永远走不到（旧代码 `if (res)` 即因此失效）。
        try {
            const res = await api(`/ai/providers/${pid}/test`, 'POST', {}, { silent: true });
            await this.refresh();
            if (res && res.ok) {
                showToast('连接成功，AI 接口可用', 'success');
                this.setMsg('连接成功！点击「保存」保留配置。如需切换对话服务商，请在列表中点击「启用」。', 'success');
            } else {
                // 后端把上游真实报错放在 error 字段回传，原样展示便于定位
                this.setMsg(`连接失败：${(res && res.error) || '未知错误'}`, 'error');
            }
        } catch (err) {
            await this.refresh();
            this.setMsg(`连接失败：${err.message || '网络错误'}`, 'error');
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