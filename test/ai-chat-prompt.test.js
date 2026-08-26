/* 服务端 ai.js chat prompt + 工具定义关键规则文本快照测试（防回归）。
 *
 * 历史教训：
 *   - 62d5315 引入"场景-对象"备注 + 第10条末尾措辞让 LLM 误以为系统不再下发账户/类目列表
 *   - 2015ea7 修正第10条措辞，加"补充"段
 *   - 446b12c 引入 5.5「软匹配+历史复用」规则——结果用户实际场景证明靠 prompt 投喂 ID 列表
 *     不够，AI 还是会在用户提到的账户名跟预投喂不完全一致时拒绝记账。
 *   - v0.0.44 起（重构版）：新增 list_accounts / list_categories 两个**真实工具**，prompt
 *     明确告诉 AI「不知道就调工具」而不是靠预投喂/软匹配。
 *   - 2026-08-25 统一到 AI v0.2：**移除 create_transaction / create_transfer 两个直写账本工具**。
 *     新建交易一律走 /ai/transactions/parse → /ai/predictions/:id/commit（快照 + 用户确认 + 幂等落账）。
 *     原因：直写工具让模型绕过用户确认，且它内部的转账备注方向 bug 与 transfers.js 的修复没同步。
 *     ⇒ 本测试现在**反向断言**这两个工具定义不得回归。
 *
 * 凡是这几条核心规则被改回去，本测试即失败，提醒维护者重新评估。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'ai.js'), 'utf8');

test('chat prompt：可用工具共 6 个（含 list_accounts / list_categories），均不新建交易', () => {
    assert.match(src, /可用工具（共\s*6\s*个，均不新建交易）/);
    assert.match(src, /list_accounts（查账户）/);
    assert.match(src, /list_categories（查类目）/);
});

test('⛔ 回归防线：create_transaction / create_transfer 工具定义不得回归', () => {
    // tools 数组里不得再出现这两个工具的定义
    assert.doesNotMatch(src, /name:\s*'create_transaction'/);
    assert.doesNotMatch(src, /name:\s*'create_transfer'/);
    // 也不得再有直写账本的 SQL —— 只匹配真实语句（模板字符串/引号起始），
    // 避免误伤说明性注释里出现的同名文字
    assert.doesNotMatch(src, /[`'"]\s*INSERT INTO transactions/);
    assert.doesNotMatch(src, /[`'"]\s*INSERT INTO transfers/);
});

test('⛔ prompt 必须明确告知模型「没有新建交易的能力」', () => {
    assert.match(src, /你没有「新建交易」的能力/);
    assert.match(src, /绝不可\*?\*?说「已记一笔/);
    // 引导到正确入口
    assert.match(src, /智能记账/);
});

test('chat prompt：修改/删除前先 list_transactions 定位', () => {
    assert.match(src, /先调 list_transactions 拿到 transaction_id/);
});

test('chat prompt：不知道账户/类目 id 时先调工具，不得瞎猜或软匹配', () => {
    assert.match(src, /不知道账户\/类目 id 时不要瞎猜、不要做软匹配/);
    assert.match(src, /先调 list_accounts \/ list_categories 拿到全量再选/);
    assert.match(src, /不要自作主张用名字相近的项顶替/);
});

test('chat prompt：query 参数是模糊匹配', () => {
    assert.match(src, /query 参数是\*?\*?模糊匹配\*?\*?/);
});

test('chat prompt 补充段：明确"工具"才是查账户/类目的可靠方式', () => {
    assert.match(src, /下方「可用类目」「可用账户」两节是\*?\*?预投喂\*?\*?的快速参考/);
    assert.match(src, /\*\*必须\*\*调 list_accounts \/ list_categories 实时确认/);
});

test('「场景-对象」备注格式已迁到服务端确定性生成（不再靠 prompt 求模型听话）', () => {
    /*  2026-08-25 架构变更：
        旧做法 —— 在 OCR prompt 里写一整段规则，请 LLM 自己把 note 写成「场景-对象」。
        新做法 —— `modules/ai/extraction/note-composer.js` 在抽取阶段确定性生成。
        原因：备注格式是确定性规则，不该依赖模型听话；且图片通道与文字通道
        必须得到完全一致的备注，靠 prompt 做不到（不同服务商/温度都可能不一样）。

        ⛔ 断言方向也随之反转：chat prompt 里【不得】再出现教模型写 note 的条款。 */
    assert.doesNotMatch(src, /11\. 记账时，\*\*你自己\*\*在 note 字段写入完整「场景-对象」格式/);
    assert.doesNotMatch(src, /note 由你\*\*自己生成完整\*\*「场景-对象」格式/,
        'note 格式规则不得回到 prompt —— 已由 note-composer.js 确定性生成');

    // 新实现必须存在，且是唯一真相
    const composerPath = path.join(__dirname, '..', 'server', 'modules', 'ai', 'extraction', 'note-composer.js');
    assert.ok(fs.existsSync(composerPath), 'note-composer.js 必须存在（「场景-对象」的唯一真相）');
    const composerSrc = fs.readFileSync(composerPath, 'utf8');
    assert.match(composerSrc, /function composeNote/);
    // 抽取器必须真的用上它 —— 否则模块存在但没接线，备注会静默退回原始片段
    const extractorSrc = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'modules', 'ai', 'extraction', 'deterministic-extractor.js'), 'utf8');
    assert.match(extractorSrc, /composeNote\(/, '抽取器必须调用 composeNote，否则 note 会退回原始片段');
    assert.doesNotMatch(extractorSrc, /note:\s*seg,/,
        '⛔ note 不得再直接用原始片段 —— 那会落成「2026年8月20日老乡鸡 18元」这种冗余备注');
});

test('list_accounts 工具定义存在且说明文字准确', () => {
    assert.match(src, /name: 'list_accounts'/);
    assert.match(src, /查当前账本下所有可用账户/);
    assert.match(src, /必须先调本工具\*?\*?/);
    assert.match(src, /绝不要凭「预投喂列表」硬猜/);
    // 参数 query 是字符串，可省略
    assert.match(src, /query:\s*\{\s*type:\s*'string',\s*description:[^}]*可省略/);
});

test('list_categories 工具定义存在且说明文字准确', () => {
    assert.match(src, /name: 'list_categories'/);
    assert.match(src, /查当前账本下所有可用分类/);
    assert.match(src, /必须先调本工具\*?\*?/);
    assert.match(src, /type_filter/);
});

test('list_accounts 工具实现：SQL 包含 user_id / book_id / status active 三重过滤', () => {
    // 紧跟在 if (name === 'list_accounts') 后
    const m = src.match(/if \(name === 'list_accounts'\)\s*\{([\s\S]*?)\n\s\s\s\s\}/);
    assert.ok(m, 'list_accounts 实现分支必须存在');
    const body = m[1];
    assert.match(body, /user_id\s*=\s*\$1/);
    assert.match(body, /book_id\s*=\s*\$2/);
    assert.match(body, /status\s*=\s*'active'/);
    assert.match(body, /ORDER BY/);
    assert.match(body, /LIMIT/);
});

test('list_categories 工具实现：支持模糊匹配 + 类型过滤 + 全局账本通用', () => {
    const m = src.match(/if \(name === 'list_categories'\)\s*\{([\s\S]*?)\n\s\s\s\s\}/);
    assert.ok(m, 'list_categories 实现分支必须存在');
    const body = m[1];
    assert.match(body, /user_id\s+IS\s+NULL/);
    assert.match(body, /book_id\s+IS\s+NULL\s+OR\s+book_id\s+=\s*\$2/);
    assert.match(body, /name LIKE \$3/);
    assert.match(body, /type_filter/);
});

test('⛔ legacy OCR prompt 与正则解析器已彻底移除，不得回归', () => {
    /*  2026-08-25：删除 `fallbackExtractItems`（253 行 legacy OCR 正则解析器）
        与整段 OCR prompt。图片通道改为：
          转录（大模型 vision 主路 / 腾讯 OCR 兜底）→ 票据版式预处理 → v0.2 主链路
        腾讯 OCR【只识别、不学习】，产出纯文字后与手打文字完全同权。

        ⛔ 为什么必须反向断言：legacy 的根本问题是让图片通道和文字通道
           【各有一个大脑】—— 规则学到的习惯在图片通道完全不生效。
           一旦有人图省事把 prompt 抽取写回来，这个缺陷就复发，且不报错。 */
    assert.doesNotMatch(src, /function fallbackExtractItems/, 'legacy 正则解析器不得回归');
    assert.doesNotMatch(src, /可选分类：\$\{catChoices\}/, 'legacy OCR prompt 不得回归');
    assert.doesNotMatch(src, /category 必须从下面列表中选择最合适的/, 'legacy OCR prompt 不得回归');
    // 独立词表更不得回归（词表唯一真相是 extraction/category-matcher.js）
    assert.doesNotMatch(src, /const level1 = \[/);
    assert.doesNotMatch(src, /const level2 = \[/);
    // 过时的硬编码类目名（真表叫「早午晚餐/打车拼车」）
    assert.doesNotMatch(src, /可选分类：早餐\|午餐\|晚餐/);
    assert.doesNotMatch(src, /餐别按时间推断/);
});

test('⛔ 图片通道的类目推断必须复用 v0.2 链路（路由层不得自建词表/抽取）', () => {
    /*  路由层【只能】依赖模块桶 `modules/ai`（见 modules/ai/index.js 头部约定）。
        原先直接 require 的 extraction/category-matcher 已随 legacy 解析器一并移除
        —— 它是那 253 行的唯一使用者。 */
    assert.match(src, /require\('\.\.\/modules\/ai'\)/, '路由层必须走模块桶');
    assert.doesNotMatch(src, /require\('\.\.\/modules\/ai\/extraction\//,
        '⛔ 路由层不得直接 require extraction 子模块（绕过桶文件 = 分层白做）');

    // 类目词表的唯一真相仍在 category-matcher，且被 v0.2 抽取器使用
    const extractorSrc = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'modules', 'ai', 'extraction', 'deterministic-extractor.js'), 'utf8');
    assert.match(extractorSrc, /require\('\.\/category-matcher'\)/,
        'v0.2 抽取器必须复用同一份类目词表');
});

test('AI 记账 prompt 第 12 条：自然对话风格，禁止暴露工具名 / JSON 块', () => {
    assert.match(src, /12\. 对话风格/);
    assert.match(src, /禁止\*?\*?在回复中暴露后端工具名/);
    assert.match(src, /不写"我已经为您调用了 xxx 工具"之类机械化开场白/);
});

test('安全网：writeSucceeded 标志追踪 + 落兜底"未真的调用记账工具"改写', () => {
    // writeSucceeded 在 result.ok && result.transaction_id 处被置真
    assert.match(src, /writeSucceeded\s*=\s*true/);
    // 安全网改写分支存在
    assert.match(src, /很抱歉，这笔其实没有记录成功/);
});
