/* ============================================
   记账解析器 Prompt —— 外置 + 版本化
   ------------------------------------------------
     为什么外置：
       prompt 曾硬编码在 provider-gateway.js 里，改一个字都要动调用方代码，
       无法 A/B、无法按用户灰度、无法回滚。外置后：
         - 版本号落进 ai_predictions.model_request，可追溯"哪次错判用了哪版 prompt"
         - 环境变量 AI_PARSER_PROMPT_VERSION 切换，出问题时一键回退 v1
         - 阶段 2 的 Few-shot 直接作为新版本接入，不动主链路

   ⛔ v1 是【字节级冻结】的基线：
      它的输出必须与外置前一模一样（含换行与顺序），
      由 test/ai-parser-prompt.test.js 守着。任何编辑都要先想清楚
      是否该开 v3，而不是动 v1。

   ⛔ v2 的设计前提（来自真实痛点）：
      本地规则只擅长精确数字，语义理解必须交给模型。v2 让模型承担：
        1) 剔除 OCR 噪音（K/s 网速、订单号、余额 —— 不是交易）
        2) 输出 account_id（v1 完全没这能力，账户只能本地猜）
        3) 日期精确到秒
        4) 语义化备注
   ============================================ */

/**
 * 选择当前生效的 prompt 版本。
 * 未配置时返回 v1 —— 保持与外置前完全一致的行为，升级需显式开启。
 */
function getParserPromptVersion() {
    const raw = String(process.env.AI_PARSER_PROMPT_VERSION || '').trim().toLowerCase();
    return VERSIONS[raw] ? raw : 'v1';
}

/**
 * 构建发给大模型的 messages。
 *
 * @param {object} params
 * @param {string} params.text          用户原文（可能来自 OCR，含噪声）
 * @param {Array}  params.candidates    本地抽取的候选交易
 * @param {Array}  params.categories    类目表
 * @param {Array}  params.accounts      账户表
 * @param {string} [params.memoryHints] 已格式化的用户习惯（由 prompt-builder 产出）
 * @param {Array}  [params.fewShot]     用户历史相似样例（由 few-shot-selector 产出）
 * @param {string} [params.version]     指定版本（默认取环境变量）
 * @returns {{messages:Array, version:string}}
 */
function buildParserMessages({
    text, candidates, categories = [], accounts = [],
    memoryHints = '', fewShot = null, version = null,
}) {
    const v = version && VERSIONS[version] ? version : getParserPromptVersion();
    return {
        messages: VERSIONS[v].build({
            text, candidates, categories, accounts, memoryHints, fewShot,
        }),
        version: v,
    };
}

/* ════════════════════════════════════════════════════════════
   v1 —— 字节级冻结的基线（外置前的原始 prompt）
   ════════════════════════════════════════════════════════════ */
function buildV1({ text, candidates, categories, memoryHints }) {
    const catList = categories
        .filter(c => c.type === 'income' || c.type === 'expense')
        .map(c => `${c.id}:${c.name}(${c.type})`)
        .join(', ');

    const systemParts = [
        '你是记账助手的 AI 解析器。任务：基于用户原文，对本地规则引擎给出的候选交易做【语义理解与补全】。',
        '你可以且应当：',
        '1. 修正本地抽错的类型/金额/类目/日期/商家；',
        '2. 补全本地没抽出来的字段（例如把"中午吃了碗面"归到餐饮类目、给出商家名、写入语义备注 note）；',
        '3. 对口语化、模糊表述做合理推断（如"发了工资"→income、"还了信用卡"→transfer/expense）。',
        '严格约束：',
        '1. category_id 必须从下面给出的类目清单里选，不得臆造 id；拿不准时填 null。',
        '2. 每个字段都要给 conf（0~1 置信度）：有把握≥0.9，推测 0.7~0.89，不确定填 0 或省略。',
        '3. 金额/类型这种错了会污染账本的字段，没把握就保留本地值（不要乱改）。',
        '4. 只输出 JSON，禁止额外文本。格式：',
        '{"transactions":[{"seq":1,"type":"expense","amount":12.5,"category_id":33,',
        '"date":"2026-08-25","merchant":"星巴克","note":"午餐","conf":{"type":0.95,"amount":0.98,"category_id":0.9,"date":0.95,"merchant":0.7}}]}',
        '备注 note 用于记录消费目的/场景，便于后续洞察。',
        `可用类目：${catList}`,
    ];
    // 刻意用条件 push 而非 memoryHints || ''：后者会在无习惯时多拼一个 '\n'
    if (memoryHints) systemParts.push(memoryHints);

    return [
        { role: 'system', content: systemParts.join('\n') },
        {
            role: 'user',
            content: `原文：${text}\n本地候选：${JSON.stringify(candidates.map(c => ({
                seq: c.seq, type: c.type, amount: c.amount, category_id: c.category_id,
                category_name: c.category_name, date: c.date, merchant: c.merchant,
                note: c.note || '',
            })))}`,
        },
    ];
}

/* ════════════════════════════════════════════════════════════
   v2 —— 让第三方模型承担语义理解（本地算力/能力不足时的主力）
   ════════════════════════════════════════════════════════════ */
function buildV2({ text, candidates, categories = [], accounts = [], memoryHints = '' }) {
    const catList = categories
        .filter(c => c.type === 'income' || c.type === 'expense')
        .map(c => `${c.id}:${c.name}(${c.type})`)
        .join(', ');

    const acctList = accounts.length
        ? accounts.slice(0, 20).map(a => `${a.id}:${a.name}`).join(', ')
        : '（该用户暂无账户，account_id 一律填 null）';

    const systemParts = [
        '你是资深记账助手的语义解析器。',
        '背景：本地规则引擎只会正则匹配，擅长精确数字但完全不懂语义；所有语义判断必须由你完成。',
        '',
        '【输入说明】',
        '1. 原文：用户输入，若来自截图 OCR 则【必定含界面噪声】（网速 K/s、电量、信号、订单号、余额、按钮文字等）。',
        '2. 本地候选：正则抽取结果，仅供参考 —— 它可能抽错、抽漏，也可能把界面噪声误当成交易。',
        '',
        '【你的任务】',
        '1. 先判断原文里究竟有【几笔真实交易】。以下都不是交易，必须剔除：',
        '   - 网速/流量（K/s、KB/s、MB/s、剩余流量）',
        '   - 订单号、流水号、快递单号（长串数字不是金额）',
        '   - 余额、额度、积分、优惠券面额',
        '   - App 界面元素（时间、电量、状态栏、按钮）',
        '2. 对每笔真实交易，修正或补全这些字段：',
        '   type / amount / category_id / account_id / date / merchant / note',
        '3. note 要写成"消费目的-对象"的语义备注（如"午餐-公司楼下""物业维修-永升物业樾溪臺"），便于日后检索与洞察。',
        '',
        '【字段规则】',
        `- account_id：从【可用账户】里选最贴切的一个。判定依据优先级：`,
        '   ① 原文明确提到的支付渠道（支付宝/花呗/微信/银行卡/信用卡/现金）；',
        '   ② 【用户记账习惯】中该商家的历史账户；',
        '   ③ 都判断不出 → 填 null，不要猜。',
        '- category_id：必须从【可用类目】中选，严禁臆造 id；拿不准填 null。',
        '- date：必须输出 YYYY-MM-DD HH:MM:SS。若原文只有日期，请自动补上合理的时分秒（中午 12:00:00 即可）；不要只输出日期。',
        '- amount：一律正数。若原文出现负数金额（如微信的 -8.00），那是退款或收入，请据此判断 type。',
        '- 每个字段都要给 conf（0~1）：有把握≥0.9，推测 0.7~0.89，不确定填 0（填 0 等于保留本地值）。',
        '',
        '【安全铁律】',
        '1. 金额与方向一旦错了会直接污染账本：没把握就保留本地值，不要强行改写。',
        '2. 宁可少认一笔，也不要把界面噪声认成交易。',
        '3. 只输出 JSON，禁止任何额外解释文字。',
        '',
        '【输出格式】',
        '{"transactions":[{"seq":1,"type":"expense","amount":638.4,"category_id":35,"account_id":7,',
        '"date":"2026-08-25 10:30:00","merchant":"永升物业","note":"物业维修-永升物业樾溪臺",',
        '"conf":{"type":0.95,"amount":0.98,"category_id":0.9,"account_id":0.75,"date":0.8,"merchant":0.85}}]}',
        '',
        `可用类目：${catList}`,
        `可用账户：${acctList}`,
    ];
    if (memoryHints) systemParts.push(memoryHints);

    return [
        { role: 'system', content: systemParts.join('\n') },
        {
            role: 'user',
            content: `原文：${text}\n本地候选：${JSON.stringify(candidates.map(c => ({
                seq: c.seq, type: c.type, amount: c.amount, category_id: c.category_id,
                category_name: c.category_name, date: c.date, merchant: c.merchant,
                note: c.note || '',
            })))}`,
        },
    ];
}

/* ════════════════════════════════════════════════════════════
   v3 —— v2 + Few-shot 动态先例
   ════════════════════════════════════════════════════════════ */
/**
 * v3 = v2 + 「该用户过往的真实记账先例」。
 *
 * 为什么单独开版本而不是直接改 v2：
 *   few-shot 会把用户历史消费明细发给第三方模型（隐私权衡），
 *   必须能独立开关与独立回滚，不能和常规增强绑在一起。
 */
function buildV3(params) {
    const messages = buildV2(params);
    const block = formatFewShot(params.fewShot);
    if (block) {
        // 追加在末尾：紧挨输出格式要求之后，模型最不容易忽略
        messages[0].content = `${messages[0].content}\n\n${block}`;
    }
    return messages;
}

/**
 * 把历史样例格式化成 prompt 片段。
 * ⛔ 只输出备注/金额/类目名/账户名 —— 不泄漏交易 id 等标识符。
 */
function formatFewShot(examples) {
    if (!Array.isArray(examples) || examples.length === 0) return '';

    const lines = examples.map((e, i) => {
        const amount = (e.amount != null) ? `${e.amount}元` : '';
        const parts = [];
        if (e.category_name) parts.push(`类目「${e.category_name}」`);
        if (e.account_name) parts.push(`账户「${e.account_name}」`);
        const target = parts.length ? parts.join('、') : '未记类目';
        return `${i + 1}. 备注「${e.note}」${amount} → ${target}`;
    });

    return [
        '【该用户过往的真实记账先例】以下他此前对相似消费的实际归类，优先级高于你的常识：',
        ...lines,
    ].join('\n');
}

const VERSIONS = {
    v1: { build: buildV1, description: '基线版：字节级冻结，与 prompt 外置前完全一致' },
    v2: {
        build: buildV2,
        description: '增强版：OCR 噪音剔除 + 输出 account_id + 秒级日期 + 语义备注',
    },
    v3: {
        build: buildV3,
        description: 'v2 + Few-shot 先例：注入该用户历史中相似消费的实际归类（需 AI_FEWSHOT_ENABLED=true）',
    },
};

module.exports = {
    buildParserMessages,
    getParserPromptVersion,
    formatFewShot,
    VERSIONS,
};
