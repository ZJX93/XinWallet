const logger = require('../../../../../../logger');
/* ============================================
   鑫钱包 · AI 服务调用模块
   封装 OpenAI 兼容 / Anthropic 接口调用
   ============================================ */

const https = require('https');
const http = require('http');
const db = require('../db');
const { decrypt } = require('../crypto');
const { assertPublicUrl } = require('./url-guard');

// AI 服务商调用错误：携带真实 HTTP 状态码与上游错误信息，便于路由层透传给客户端。
class AiProviderError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'AiProviderError';
        this.isAiProviderError = true;
        this.statusCode = statusCode;
    }
}

// 从服务商的错误响应体中提取可读错误文案（兼容 {error:{message,code}} / {error:"..."} / 纯文本）。
function describeProviderError(body, statusCode) {
    let detail = '';
    if (typeof body === 'string') detail = body;
    else if (body && body.error) {
        if (typeof body.error === 'string') detail = body.error;
        else if (body.error.message) detail = body.error.message + (body.error.code ? ` (${body.error.code})` : '');
        else detail = JSON.stringify(body.error);
    } else detail = JSON.stringify(body);
    detail = String(detail || '未知错误').replace(/\s+/g, ' ').trim().slice(0, 300);
    return `AI 服务商返回 ${statusCode}：${detail}`;
}

// HTTP POST JSON 请求（通用）。
// ⚠️ 调用前必须经 assertPublicUrl() 校验（SSRF 防护）。Node http.request 默认不跟随重定向。
// AI Provider 的 base_url 由用户配置，本地 Ollama（127.0.0.1）及局域网自定义服务商是合法场景，
// 故放行回环与私有内网地址；链路本地 169.254.0.0/16（含云 metadata）仍始终拦截。
// 关键修正：非 2xx 视为调用失败，抛 AiProviderError 携带真实错误，避免被当成成功响应解析。
async function httpsPostJson(url, headers, body) {
    await assertPublicUrl(url, { allowLoopback: true, allowPrivate: true });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const data = JSON.stringify(body);
        const opts = {
            hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
            timeout: 60000
        };
        const req = mod.request(opts, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(buf); } catch { parsed = buf; }
                if (res.statusCode >= 200 && res.statusCode < 300) { resolve(parsed); return; }
                reject(new AiProviderError(res.statusCode, describeProviderError(parsed, res.statusCode)));
            });
        });
        // 网络层失败（DNS 解析失败 / 连接被拒 / TLS 握手失败 / 连接重置）与超时
        // 不是 HTTP 响应，须包装成 AiProviderError（带 502/504 + 可读原因），
        // 否则路由层会误判为「服务器内部错误」500，用户无法定位问题。
        req.on('error', (e) => reject(new AiProviderError(502, `无法连接到 AI 服务商：${(e && e.message) || e}`)));
        req.on('timeout', () => { req.destroy(); reject(new AiProviderError(504, 'AI 请求超时（60s），请检查服务商地址或网络')); });
        req.write(data);
        req.end();
    });
}

// 获取当前激活的 AI 服务商（含解密 api_key）。
// api_key 解密失败（密钥变更/数据损坏）→ 返回 null，让路由层提示用户重新配置。
async function getActiveProvider(userId) {
    const provider = await db.queryOne('SELECT * FROM ai_providers WHERE user_id = ? AND is_active = TRUE LIMIT 1', [userId]);
    if (!provider) return null;
    if (provider.api_key) {
        provider.api_key = decrypt(provider.api_key);
        if (!provider.api_key) {
            // 配置存在但密钥不匹配（极可能是重部署后 ENCRYPTION_KEY 变更），
            // 标记后由路由层提示用户前往「AI 配置」页重新保存，而非静默当作「未配置」。
            logger.error(`[AI] 用户 ${userId} 的活跃服务商 API Key 解密失败（密钥不匹配或数据损坏）`);
            provider._decryptFailed = true;
        }
    }
    return provider;
}

// 启动自检：扫描所有用户的 AI/OCR 凭证。若记录存在但用当前 ENCRYPTION_KEY 解密失败，
// 说明重部署后加密密钥变更，旧凭证已不可恢复，打印告警引导重新保存。
// 根因：AI 配置本身持久化在 ai_providers 表，真正「重部署丢失」的是加密密钥
// （未固定 ENCRYPTION_KEY 或未保留 /app/data 卷），导致旧密文无法解密、表现为配置丢失。
async function auditProviderKeys() {
    try {
        const providers = await db.query('SELECT id, user_id, api_key, is_active FROM ai_providers');
        const ocr = await db.query('SELECT user_id, secret_id, secret_key FROM ai_ocr_config');
        let warnCount = 0;
        for (const p of providers) {
            if (p.api_key && !decrypt(p.api_key)) {
                warnCount++;
                logger.warn(`⚠️ [AI 凭证自检] ai_providers id=${p.id} user=${p.user_id} 解密失败（密钥可能已变更），该服务商配置已不可用，请前往「AI 配置」页重新保存 API Key。`);
            }
        }
        for (const c of ocr) {
            if ((c.secret_id || c.secret_key) && (!decrypt(c.secret_id) || !decrypt(c.secret_key))) {
                warnCount++;
                logger.warn(`⚠️ [AI 凭证自检] ai_ocr_config user=${c.user_id} 解密失败（密钥可能已变更），请前往「AI 配置」页重新保存腾讯云 OCR 密钥。`);
            }
        }
        if (warnCount > 0) {
            logger.warn(`⚠️ 共 ${warnCount} 条 AI/OCR 凭证因加密密钥变更无法解密。根因：重部署后 ENCRYPTION_KEY 与历史不一致，或未保留 /app/data 卷。请固定 ENCRYPTION_KEY（见 .env.example）或保留 /app/data 卷后重启，否则需在「AI 配置」页重新保存凭证。`);
        } else {
            logger.info('✅ AI/OCR 凭证自检通过（所有已存凭证均可正常解密）');
        }
    } catch (err) {
        logger.warn('⚠️ AI 凭证自检异常（不影响启动）:', err.message);
    }
}

// 查找支持语音转写的服务商：优先激活的 OpenAI 兼容服务商，其次查所有服务商
async function getTranscriptionProvider(userId) {
    // 1. 先在激活的服务商中找 OpenAI 兼容的
    let providers = await db.query('SELECT * FROM ai_providers WHERE user_id = ? AND is_active = TRUE ORDER BY id', [userId]);
    for (const p of providers) {
        if (p.api_type === 'openai' && !isMiniMaxHost(p.base_url)) {
            if (p.api_key) { p.api_key = decrypt(p.api_key); if (!p.api_key) continue; }
            return p;
        }
    }
    // 2. 再在所有服务商中找（即使未激活，只要有 Key 就行）
    providers = await db.query('SELECT * FROM ai_providers WHERE user_id = ? ORDER BY is_active DESC, id', [userId]);
    for (const p of providers) {
        if (p.api_type === 'openai' && !isMiniMaxHost(p.base_url)) {
            if (p.api_key) { p.api_key = decrypt(p.api_key); if (!p.api_key) continue; }
            return p;
        }
    }
    return null;
}

// 调用 OpenAI 兼容接口
async function callOpenAICompatible(baseUrl, apiKey, model, messages) {
    const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
    const data = await httpsPostJson(url, {
        'Authorization': `Bearer ${apiKey}`
    }, {
        model: model || 'gpt-4o-mini',
        messages,
        temperature: 0.7
    });
    return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
}

// 调用 Anthropic Messages
async function callAnthropic(baseUrl, apiKey, model, messages) {
    let system = '';
    const userMessages = messages.filter(m => {
        if (m.role === 'system') { system = m.content; return false; }
        return true;
    }).map(m => ({ role: m.role, content: m.content }));
    const url = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '') + '/messages';

    // MiniMax 国内（minimaxi.com）与海外（minimax.chat）Anthropic 兼容接口均使用 Bearer 认证
    const isMiniMax = url.includes('minimaxi.com') || url.includes('minimax.chat');
    const headers = isMiniMax
        ? { 'Authorization': `Bearer ${apiKey}` }
        : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };

    const body = { model: model || 'claude-3-haiku-20240307', max_tokens: 8192, system, messages: userMessages };
    const data = await httpsPostJson(url, headers, body);
    return data && data.content && data.content[0] && data.content[0].text;
}

// 通用调用：根据服务商 api_type 分发
async function callProvider(provider, messages) {
    if (!provider) throw new Error('未配置 AI 服务商');
    if (!provider.api_key) throw new Error('服务商未设置 API Key');
    if (provider.api_type === 'anthropic') {
        return await callAnthropic(provider.base_url, provider.api_key, provider.model, messages);
    }
    return await callOpenAICompatible(provider.base_url, provider.api_key, provider.model, messages);
}

// ==========================================
// 多模态 + 函数调用（tools）支持
// 归一化消息格式：{ role, content }
//   content: string | parts[]，parts = {type:'text',text} | {type:'image',mime,data(base64)}
// 归一化工具调用结果：{ role:'tool', toolCallId, content }
// 归一化助手消息（含工具调用）：{ role:'assistant', content, toolCalls:[{id,name,arguments(object)}] }
// ==========================================

function safeParseJson(str) {
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return {}; }
}

function mimeToAnthropic(mime) {
    if (!mime) return 'image/jpeg';
    if (mime.includes('png')) return 'image/png';
    if (mime.includes('webp')) return 'image/webp';
    if (mime.includes('gif')) return 'image/gif';
    return 'image/jpeg';
}

function toOpenAIContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(p => p.type === 'image'
            ? { type: 'image_url', image_url: { url: `data:${p.mime || 'image/jpeg'};base64,${p.data}` } }
            : { type: 'text', text: p.text || '' });
    }
    return content;
}

function toAnthropicContent(content) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (Array.isArray(content)) {
        return content.map(p => p.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: mimeToAnthropic(p.mime), data: p.data } }
            : { type: 'text', text: p.text || '' });
    }
    return content;
}

function toOpenAITools(tools) {
    return (tools || []).map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }
    }));
}

function toAnthropicTools(tools) {
    return (tools || []).map(t => ({
        name: t.name, description: t.description || '', input_schema: t.parameters || { type: 'object', properties: {} }
    }));
}

// OpenAI 兼容：带 tools 的对话，返回归一化助手消息
async function chatOpenAITools(provider, messages, tools) {
    const baseUrl = (provider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';
    const translated = messages.map(m => {
        if (m.role === 'system') return { role: 'system', content: m.content };
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
            return {
                role: 'assistant',
                content: m.content || '',
                tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } }))
            };
        }
        return { role: m.role, content: toOpenAIContent(m.content) };
    });
    const body = { model: provider.model || 'gpt-4o-mini', messages: translated, temperature: 0.3 };
    if (tools && tools.length) { body.tools = toOpenAITools(tools); body.tool_choice = 'auto'; }
    const data = await httpsPostJson(url, { 'Authorization': `Bearer ${provider.api_key}` }, body);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error('AI 返回为空');
    const toolCalls = (msg.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, arguments: safeParseJson(tc.function.arguments) }));
    return { role: 'assistant', content: msg.content || '', toolCalls };
}

// Anthropic：带 tools 的对话
async function chatAnthropicTools(provider, messages, tools) {
    const baseUrl = (provider.base_url || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const url = baseUrl + '/messages';
    let system = '';
    const translated = [];
    for (const m of messages) {
        if (m.role === 'system') { system += (system ? '\n' : '') + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)); continue; }
        if (m.role === 'tool') {
            translated.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
            continue;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
            const blocks = m.content ? toAnthropicContent(m.content) : [];
            m.toolCalls.forEach(tc => blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} }));
            translated.push({ role: 'assistant', content: blocks });
            continue;
        }
        translated.push({ role: m.role, content: toAnthropicContent(m.content) });
    }
    const body = { model: provider.model || 'claude-3-haiku-20240307', max_tokens: 8192, system, messages: translated };
    if (tools && tools.length) body.tools = toAnthropicTools(tools);
    // MiniMax Anthropic 兼容接口使用 Bearer 认证，标准 Anthropic 使用 x-api-key
    const headers = isMiniMaxHost(url)
        ? { 'Authorization': `Bearer ${provider.api_key}` }
        : { 'x-api-key': provider.api_key, 'anthropic-version': '2023-06-01' };
    const data = await httpsPostJson(url, headers, body);
    const content = data && data.content;
    let text = '';
    const toolCalls = [];
    if (Array.isArray(content)) {
        for (const block of content) {
            if (block.type === 'text') text += block.text;
            else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
        }
    }
    return { role: 'assistant', content: text, toolCalls };
}

// 通用：根据服务商分发
async function chatWithTools(provider, messages, tools) {
    if (!provider) throw new Error('未配置 AI 服务商');
    if (!provider.api_key) throw new Error('服务商未设置 API Key');
    if (provider.api_type === 'anthropic') return await chatAnthropicTools(provider, messages, tools);
    return await chatOpenAITools(provider, messages, tools);
}

/** 判断是否为 MiniMax 域名（国内 minimaxi.com / 海外 minimax.chat） */
function isMiniMaxHost(url) {
    return /minimaxi\.com|minimax\.chat/i.test(String(url || ''));
}

// 发送原始字节 body（multipart 等），用于语音转写
async function httpsPostRaw(url, headers, bufferBody) {
    await assertPublicUrl(url, { allowLoopback: true, allowPrivate: true });
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const opts = {
            hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search, method: 'POST',
            headers: { 'Content-Length': Buffer.byteLength(bufferBody), ...headers },
            timeout: 60000
        };
        const req = mod.request(opts, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(buf); } catch { parsed = buf; }
                if (res.statusCode >= 200 && res.statusCode < 300) { resolve(parsed); return; }
                reject(new AiProviderError(res.statusCode, describeProviderError(parsed, res.statusCode)));
            });
        });
        // 网络层失败 / 超时：包装成 AiProviderError，避免被误报为 500「服务器内部错误」
        req.on('error', (e) => reject(new AiProviderError(502, `无法连接到 AI 服务商：${(e && e.message) || e}`)));
        req.on('timeout', () => { req.destroy(); reject(new AiProviderError(504, 'AI 请求超时（60s），请检查服务商地址或网络')); });
        req.write(bufferBody);
        req.end();
    });
}

module.exports = { httpsPostJson, httpsPostRaw, getActiveProvider, getTranscriptionProvider, callOpenAICompatible, callAnthropic, callProvider, chatWithTools, auditProviderKeys,
    // 多模态 content 归一化：图片转录层（modules/ai/vision）也要用。
    // ⛔ 必须导出复用，不许各处抄一份 —— 两份实现漂移后，同一张图在
    //    「对话通道」和「图片记账通道」会发出不同格式的请求，且只在某一端报错。
    toOpenAIContent, toAnthropicContent, mimeToAnthropic };
