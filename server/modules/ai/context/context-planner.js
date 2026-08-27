/* ============================================
   Context Planner
   ------------------------------------------------
   为每次 LLM 调用构建完整上下文。

   设计原则：
     - 不注入实时数据（Tool 调用由 LLM 自主决定）
     - 仅注入元信息（用户 Profile / 系统能力描述）
     - 每次对话包含：system prompt（能力描述）+ 对话历史 + 用户 Profile
     - 对话历史截断策略：保留最近 10 条，超过时压缩

   上下文组成（分层注入）：
     1. System Prompt — AI 身份 + 工具能力描述
     2. User Profile Context — 用户偏好（语言风格/货币/时区）
     3. Conversation History — 最近 N 轮对话
   ============================================ */

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `你是鑫钱包（XinWallet）的 AI 财务助手。

【你的能力】
- 帮用户记账：识别自然语言中的交易信息（金额、日期、商家、类型、类目）
- 回答财务问题：收支统计、预算状态、债务汇总、投资收益、储蓄建议
- 生成主动洞察：发现消费异常、趋势变化、储蓄机会
- 财务模拟与预测：预算模拟、储蓄目标规划

【你的原则】
- 账本数据是唯一真相，你只能建议和分析，不能代替用户修改账本
- 所有财务结论必须基于用户账本数据，附带推理依据
- 遇到不确定的交易信息（金额不明确/日期模糊/商家不清），必须询问用户确认
- 优先使用工具（Tool）获取实时账本数据，不凭记忆回答

【你的工具】（需要时可调用）
- accounts_get_balance: 查询指定账户余额
- accounts_list: 列出所有账户
- transactions_search: 搜索交易记录
- transactions_stats: 获取收支统计
- budgets_status: 查询预算使用状态
- debt_summary: 债务汇总
- portfolio_metrics: 投资组合指标
- savings_analysis: 储蓄分析
- insights_recent: 最近洞察

【用户偏好】
语言风格：{{INTERACTION_STYLE}}（concise=简洁/detailed=详细/expert=专家）
货币单位：{{CURRENCY}}元（默认人民币）
回复语言：{{LANGUAGE}}`;

// ============================================
// 动态上下文构建
// ============================================

/**
 * 替换 system prompt 中的占位符
 */
function renderSystemPrompt(userProfile) {
  const styleMap = { concise: '简洁', detailed: '详细', expert: '专家' };
  const style = userProfile?.interaction_style || 'detailed';
  const currency = userProfile?.preferences?.currency || '人民币';
  const language = userProfile?.preferences?.language || '中文';

  return SYSTEM_PROMPT
    .replace('{{INTERACTION_STYLE}}', styleMap[style] || '详细')
    .replace('{{CURRENCY}}', currency === 'CNY' ? '人民币' : currency)
    .replace('{{LANGUAGE}}', language === 'zh' ? '中文' : language);
}

/**
 * 构建 LLM 消息历史（从 ai_messages 注入）
 * @param {Array} messages 数据库消息数组
 * @param {number} maxHistory 默认保留最近 10 条
 */
function buildMessageHistory(messages, { maxHistory = 10 } = {}) {
  if (!messages || messages.length === 0) return [];

  // 按时间正序：最早的在前，最新的在后
  const sorted = [...messages].sort((a, b) =>
    new Date(a.created_at) - new Date(b.created_at)
  );
  const recent = sorted.slice(-maxHistory);

  return recent.map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : (msg.role === 'tool' ? 'tool' : 'user'),
    content: msg.content,
    ...(msg.role === 'tool' ? { tool_call_id: msg.id } : {}),
  }));
}

/**
 * 构建完整 LLM 消息数组（system + history + current）
 * @param {object} params
 * @param {object} params.userProfile
 * @param {Array}  params.messages 对话历史
 * @param {string} params.currentMessage 当前用户消息
 * @param {number} [params.maxHistory]
 */
function buildLLMessages({ userProfile, messages = [], currentMessage, maxHistory = 10 }) {
  const systemContent = renderSystemPrompt(userProfile);

  return [
    { role: 'system', content: systemContent },
    ...buildMessageHistory(messages, { maxHistory }),
    ...(currentMessage ? [{ role: 'user', content: currentMessage }] : []),
  ];
}

/**
 * 从 Profile preferences 中提取常用上下文参数
 * 供 Tool 调用时自动注入默认参数
 */
function buildDefaultContext(userProfile) {
  return {
    currency: userProfile?.preferences?.currency || 'CNY',
    language: userProfile?.preferences?.language || 'zh',
    timezone: userProfile?.preferences?.timezone || 'Asia/Shanghai',
    interactionStyle: userProfile?.interaction_style || 'detailed',
    userId: userProfile?.user_id || null,
  };
}

// ============================================
// 上下文压缩（超过阈值时简化历史）
// ============================================

/**
 * 估算消息数组的 token 数（粗略估算：中文 ~2 字符/token，英文 ~0.75 词/token）
 */
function estimateTokens(messages) {
  let count = 0;
  for (const msg of messages) {
    const text = JSON.stringify(msg);
    count += text.length / 2; // 粗估
  }
  return Math.ceil(count);
}

/**
 * 压缩过长的对话历史（超过 maxTokens 时触发）
 * 策略：仅保留最近 5 条，丢失中间细节但保留最近上下文
 */
function compressHistory(messages, { maxTokens = 3000 } = {}) {
  const estimated = estimateTokens(messages);
  if (estimated <= maxTokens) return messages;

  // 保留系统消息 + 最近 5 条
  const system = messages.find(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');
  const recent = rest.slice(-5);

  return system ? [system, ...recent] : recent;
}

module.exports = {
  buildLLMessages,
  buildMessageHistory,
  buildDefaultContext,
  renderSystemPrompt,
  compressHistory,
  estimateTokens,
};
