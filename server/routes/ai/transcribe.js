/* ============================================
   语音转写（/transcribe）：转发到具备音频能力的 provider
   ------------------------------------------------
     由 server/routes/ai.js 机械拆分而来（原文件 1863 行的上帝文件）。
     本文件只负责一组内聚的路由，公共依赖统一从 ./_shared.js 取。
   ============================================ */

const { express, success, fail, handleServerError, getTranscriptionProvider, httpsPostRaw, aiModule } = require('./_shared');
const router = express.Router();
router.post('/transcribe', async (req, res) => {
    try {
        const { audio, mime } = req.body;
        if (!audio) return res.status(400).json(fail('缺少音频'));
        const provider = await getTranscriptionProvider(req.userId);
        if (!provider) return res.status(400).json(fail('语音转写需要一个支持 /audio/transcriptions 的 OpenAI 兼容服务商。请在设置中额外配置一个（如 Groq 免费 Whisper、OpenAI 等），语音转写将自动使用该服务商'));

        // 确定转写模型：Groq 用 whisper-large-v3，OpenAI 用 whisper-1，服务商 model 含 whisper 则直接用
        let whisperModel = 'whisper-1';
        const baseUrl = (provider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
        if (baseUrl.includes('groq.com')) whisperModel = 'whisper-large-v3';
        if (provider.model && provider.model.toLowerCase().includes('whisper')) whisperModel = provider.model;

        const url = baseUrl + '/audio/transcriptions';
        const boundary = '----xinwallet' + Date.now();
        const fileData = Buffer.from(audio, 'base64');
        const extMap = {
            'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
            'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
            'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/oga': 'ogg'
        };
        const ext = extMap[mime] || 'bin';
        const ctype = mime || 'application/octet-stream';
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.${ext}"\r\nContent-Type: ${ctype}\r\n\r\n`),
            fileData,
            Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${whisperModel}\r\n--${boundary}--\r\n`)
        ]);
        const data = await httpsPostRaw(url, { 'Authorization': `Bearer ${provider.api_key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body);
        const text = (typeof data === 'string') ? data : (data && data.text);
        if (!text) return res.status(502).json(fail('语音转写失败：服务商未返回文字'));
        res.json(success({ text }));
    } catch (err) {
        if (err && err.isAiProviderError) return res.status(err.statusCode || 502).json(fail(err.message));
        handleServerError(res, err, '语音转写');
    }
});

/* ============================================
   预测闭环
   ------------------------------------------------
   核心原则：AI 输出【永不直接写账本】。
   链路：parse（产出不可变预测快照）→ 用户确认/修正 → commit（事务内原子落账）
        或 discard（弃置，不形成负面学习）。

   与上方 legacy 直写路径（/chat 的 create_transaction 工具调用，约 L1044）的关系：
   本次【不改动】legacy 行为，二者并存；待 web/android/harmony 三端切到本链路后再移除 legacy。
   ============================================ */

module.exports = router;
