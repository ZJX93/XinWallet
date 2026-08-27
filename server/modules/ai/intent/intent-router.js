/* ============================================
   Intent Router
   ------------------------------------------------
   将用户输入分类为以下意图之一：

     transaction_parse  — 添加/解析交易（记账意图）
     chat               — 自由对话（闲聊、解释、建议）
     budget             — 预算相关查询/操作
     statistics         — 收支统计/报表查询
     debt               — 债务相关查询
     investment         — 投资组合/理财查询
     savings            — 储蓄分析/建议
     insight            — 主动洞察查询
     forecast           — 财务预测/模拟
     unknown            — 无法分类

   策略：
     - 规则引擎：关键词 + 模式匹配，零模型调用
     - 模型分类：可选增强，失败回退到规则引擎
     - 并发/可切换，互不影响
   ============================================ */

/**
 * 意图类型枚举
 */
const INTENTS = {
  TRANSACTION_PARSE: 'transaction_parse',
  CHAT: 'chat',
  BUDGET: 'budget',
  STATISTICS: 'statistics',
  DEBT: 'debt',
  INVESTMENT: 'investment',
  SAVINGS: 'savings',
  INSIGHT: 'insight',
  FORECAST: 'forecast',
  UNKNOWN: 'unknown',
};

// ============================================
// 规则引擎（默认兜底）
// ============================================

/**
 * 意图分类关键词配置（可扩展）
 * 匹配顺序：按 priority 从高到低，取第一个命中的
 */
const INTENT_PATTERNS = [
  // Transaction parse（记账意图，最优先）
  {
    intent: INTENTS.TRANSACTION_PARSE,
    priority: 100,
    patterns: [
      // 金额 + 日期 + 商家组合 = 高置信度记账句
      /(?:花了?|买了?|支付|转账|收入|支出|充值|还款|消费)\s*[0-9零一二三四五六七八九十百千万]+[元块]?(?:的?|给)?[\S]{0,20}/i,
      /[0-9零一二三四五六七八九十百千万]+[元块]\s/i,
      /(?:今天|昨天|明天|[0-9]+号|[0-9]{1,2}月[0-9]{0,2}日)\s*(?:花了?|买了?|支付)/i,
      // 明确记账动词
      /(?:记账|记一笔|新增交易|添加交易|录入交易)/i,
    ],
  },

  // Budget
  {
    intent: INTENTS.BUDGET,
    priority: 80,
    patterns: [
      /(?:预算|还剩多少|用了多少|超支|预算状态)/i,
      /(?:本月|本月).{0,10}(?:支出|消费)/i,
      /(?:还剩|剩余)[0-9]/i,
    ],
  },

  // Statistics
  {
    intent: INTENTS.STATISTICS,
    priority: 75,
    patterns: [
      /(?:统计|收支|收入支出|月度|季度|年度).{0,15}(?:报告|汇总|分析|总结)/i,
      /(?:本月|本季|今年|去年).{0,10}(?:收入|支出|结余)/i,
      /(?:花了多少钱|收入多少|赚了多少)/i,
      /(?:花了|花了多少|花了多少钱)/i,
    ],
  },

  // Debt
  {
    intent: INTENTS.DEBT,
    priority: 70,
    patterns: [
      /(?:债务|欠款|贷款|信用卡|还款|逾期|利息)/i,
      /(?:还债|还信用卡|还贷款|还呗|花呗)/i,
    ],
  },

  // Investment
  {
    intent: INTENTS.INVESTMENT,
    priority: 70,
    patterns: [
      /(?:投资|理财|基金|股票|债券|持仓|收益率|年化|盈亏|浮盈|浮亏)/i,
      /(?:我的投资|理财收益|投资回报)/i,
    ],
  },

  // Savings
  {
    intent: INTENTS.SAVINGS,
    priority: 65,
    patterns: [
      /(?:储蓄|存款|存钱|省钱|节省|能存多少|存了多少钱)/i,
      /(?:储蓄率|存钱计划|省钱建议)/i,
    ],
  },

  // Insight
  {
    intent: INTENTS.INSIGHT,
    priority: 60,
    patterns: [
      /(?:洞察|发现|建议|提醒|异常|突增|骤降|趋势变化)/i,
      /(?:有什么|最近有).{0,10}(?:异常|提醒|洞察|发现)/i,
      /(?:消费习惯|支出变化)/i,
    ],
  },

  // Forecast
  {
    intent: INTENTS.FORECAST,
    priority: 55,
    patterns: [
      /(?:预测|模拟|将来|未来|下个月|预计)/i,
      /(?:如果|假设|模拟.{0,10}(?:消费|支出|收入))/i,
    ],
  },

  // Chat（最低优先级兜底）
  {
    intent: INTENTS.CHAT,
    priority: 10,
    patterns: [
      /(?:怎么|为什么|如何|能不能|可以吗|帮我|问一下|请问)/i,
      /(?:你觉得|你觉得.{0,20}(?:吗|吧)?)/i,
    ],
  },
];

/**
 * 规则引擎意图分类（默认兜底）
 * @param {string} text 用户输入
 * @returns {{ intent: string, confidence: number, matchedPattern?: string }}
 */
function classifyByRules(text) {
  if (!text || typeof text !== 'string') {
    return { intent: INTENTS.UNKNOWN, confidence: 0, method: 'rules' };
  }

  const trimmed = text.trim();

  for (const group of INTENT_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(trimmed)) {
        // confidence 基于 pattern 匹配位置和 priority 估算
        const confidence = Math.min(0.6 + (group.priority / 100) * 0.4, 0.98);
        return { intent: group.intent, confidence, method: 'rules', matchedPattern: pattern.source };
      }
    }
  }

  // 没有任何 pattern 匹配 → chat（通用对话兜底）
  return { intent: INTENTS.CHAT, confidence: 0.3, method: 'rules' };
}

// ============================================
// 模型分类（可选增强）
// ============================================

/**
 * 用模型分类意图（可选增强）。
 * 当 `AI_INTENT_MODEL` 环境变量配置后启用。
 * 失败时回退到规则引擎。
 *
 * @param {string} text
 * @param {object} providerProvider.resolveProvider 引用
 * @returns {Promise<{ intent, confidence, method }>}
 */
async function classifyByModel(text, { resolveProvider }) {
  const modelIntentProvider = process.env.AI_INTENT_MODEL_PROVIDER;
  if (!modelIntentProvider || !resolveProvider) {
    return classifyByRules(text); // 回退
  }

  try {
    const provider = await resolveProvider({ userId: null, forceProvider: modelIntentProvider });
    if (!provider) return classifyByRules(text);

    const response = await provider.chat([
      { role: 'system', content: `你是一个意图分类器。将用户输入分类为以下之一：${Object.values(INTENTS).join(', ')}。只输出分类名称，不要解释。` },
      { role: 'user', content: text },
    ], { temperature: 0 });

    const label = response?.content?.trim?.() || '';
    const matched = Object.values(INTENTS).find(i => label.toLowerCase().includes(i.toLowerCase()));
    return {
      intent: matched || INTENTS.UNKNOWN,
      confidence: 0.85,
      method: 'model',
    };
  } catch (err) {
    console.warn('⚠️ Intent 模型分类失败，回退到规则引擎:', err.message);
    return classifyByRules(text);
  }
}

// ============================================
// 主入口
// ============================================

/**
 * 意图分类主入口
 *
 * @param {string} text 用户输入
 * @param {object} [options]
 * @param {function} [options.resolveProvider] 模型分类器（可选）
 * @param {boolean} [options.forceRules] 强制使用规则引擎（测试/降级用）
 * @returns {Promise<{ intent, confidence, method }>}
 */
async function routeIntent(text, { resolveProvider = null, forceRules = false } = {}) {
  if (forceRules || !resolveProvider) {
    return classifyByRules(text);
  }
  // 默认优先规则，规则置信度低时才用模型
  const rulesResult = classifyByRules(text);
  if (rulesResult.confidence >= 0.7) {
    return rulesResult;
  }
  // 规则不自信 → 尝试模型
  return classifyByModel(text, { resolveProvider });
}

/**
 * 根据意图决定路由目标（内部方法，供 orchestrator 使用）
 * @param {string} intent
 * @returns {{ route: 'transaction_parser'|'chat'|'tool_call'|'insight'|'forecast', tools?: string[] }}
 */
function intentToRoute(intent) {
  switch (intent) {
    case INTENTS.TRANSACTION_PARSE:
      return { route: 'transaction_parser' };
    case INTENTS.CHAT:
      return { route: 'chat' };
    case INTENTS.BUDGET:
      return { route: 'tool_call', tools: ['budgets_status'] };
    case INTENTS.STATISTICS:
      return { route: 'tool_call', tools: ['transactions_stats'] };
    case INTENTS.DEBT:
      return { route: 'tool_call', tools: ['debt_summary'] };
    case INTENTS.INVESTMENT:
      return { route: 'tool_call', tools: ['portfolio_metrics'] };
    case INTENTS.SAVINGS:
      return { route: 'tool_call', tools: ['savings_analysis'] };
    case INTENTS.INSIGHT:
      return { route: 'tool_call', tools: ['insights_recent'] };
    case INTENTS.FORECAST:
      return { route: 'forecast' };
    default:
      return { route: 'chat' };
  }
}

module.exports = {
  INTENTS,
  routeIntent,
  classifyByRules,
  intentToRoute,
};
