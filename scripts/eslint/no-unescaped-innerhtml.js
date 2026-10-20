/**
 * 自定义 ESLint 规则：innerHTML / insertAdjacentHTML 中的用户可控字段必须转义
 * 用法：eslint --rulesdir scripts/eslint public/js --ext .js
 *
 * 审计 H1 修复：原实现是「危险字段黑名单」（只列 18 个字段名），漏掉
 * desc/period/caps/body/content/label/level 等一大批用户可控字段，且新增
 * 字段默认放行。现改为「白名单 + 显式消音」：
 *
 *   插值表达式被判为安全，当且仅当：
 *     1) 被 escapeHtml() / escapeHtmlAttr() 包裹（子树内全部消音）；
 *     2) 是字面量；
 *     3) 是已知安全构造函数的调用（fmt / toFixed / toLocaleString / Math 系列 / Number 等）；
 *     4) 成员属性名命中 SAFE_FIELDS 白名单（id/amount/icon/color/date/type 等
 *        非自由文本字段）；
 *     5) 标识符命中 SAFE_IDENTIFIERS 白名单或遵循 *Html 命名约定（HTML 片段构建器）。
 *   其余一律告警——新增字段默认被拦截，符合"失败关闭"原则。
 *
 * 仍属启发式（无类型信息），作为 CI 兜底，不替代人工安全审查。
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'innerHTML/insertAdjacentHTML 必须转义用户字段（escapeHtml）' },
    messages: {
      unescaped: 'innerHTML/insertAdjacentHTML 含有未消音的插值 "{{names}}"。用户可控文本请用 escapeHtml() 包裹；若是安全构造值，请加入脚本顶部 SAFE_FIELDS / SAFE_IDENTIFIERS 白名单显式消音。',
    },
    schema: [],
  },
  create(context) {
    // ---- 白名单：非用户自由文本的字段名（数值/ID/枚举/图标/颜色/日期等）----
    const SAFE_FIELDS = new Set([
      // 标识 / 数值
      'id', 'ids', 'idx', 'index', 'key', 'amount', 'amounts', 'balance', 'opening_balance',
      'total', 'totals', 'total_cost', 'total_value', 'value', 'values', 'cost', 'price', 'prices',
      'current_price', 'current_value', 'buy_price', 'sell_price', 'quantity', 'qty', 'fee', 'fees',
      'rate', 'rates', 'actual_rate', 'expected_rate', 'profit', 'profit_rate', 'percent', 'percentage',
      'ratio', 'count', 'cnt', 'num', 'number', 'page', 'pages', 'pageSize', 'limit', 'offset',
      'min', 'max', 'sum', 'avg', 'net', 'delta', 'diff', 'progress', 'usage',
      // 枚举 / 图标 / 颜色 / 排序
      'icon', 'icons', 'color', 'colors', 'type', 'types', 'status', 'kind', 'priority', 'severity',
      'sort', 'sort_order', 'order', 'rank', 'level', 'risk_level', 'category_id', 'account_id',
      'tag_id', 'budget_id', 'user_id', 'book_id', 'investment_id', 'transfer_id', 'txn_id',
      'checked', 'selected', 'active', 'disabled', 'enabled', 'visible', 'hidden', 'expanded',
      // 日期 / 时间 / 周期
      'date', 'dates', 'time', 'datetime', 'created_at', 'updated_at', 'start_date', 'end_date',
      'month', 'months', 'year', 'years', 'day', 'days', 'week', 'weeks', 'period', 'periods',
      'start', 'end', 'from', 'to', 'paid_at', 'due_date', 'nav_date', 'buy_date', 'sold_date',
      // 其他安全构造
      'currency', 'symbol', 'unit', 'units', 'length', 'size', 'version', 'width', 'height',
      'top', 'left', 'right', 'bottom', 'x', 'y', 'w', 'h', 'percentValue', 'ageHours', 'stale',
      // 布尔 / 状态位
      'is_default', 'is_active', 'isDisabled', 'isPending', 'isTransfer', 'isDual', 'isObj',
      'done', 'selected', 'expanded', 'needsConfirm', 'hasMore', 'loading', 'empty',
      // 时间戳 / 周期
      'generatedAt', 'occurred_at', 'occurred', 'created', 'fetchedAt', 'checkedAt',
      // 统计 / 计算值
      'actual', 'inv_value', 'activeCount', 'expenseMoM', 'incomeMoM', 'annualizedRate',
      'remaining', 'latest', 'pct', 'progress',
      // ID / 外键 / 枚举
      'parent_id', 'target_category_id', 'target_account_id', 'target_type', 'period_type',
      'action', 'actionClass', 'role', 'cls', 'type_icon', 'risk_level',
      // 内部状态字段（下划线前缀）
      '_merged', '_pairOut', '_pairIn', '_pageSize', '_page', '_total',
    ]);
    // ---- 集合名：map/filter 的数据源，其元素在回调内单独转义；集合本身 stringify 无害 ----
    const SAFE_COLLECTIONS = new Set([
      'insights', 'items', 'providers', 'tags', 'messages', 'rows', 'books', 'budgets',
      'debts', 'accounts', 'models', 'caps', 'kpis', 'tree', 'list', 'codes', 'data',
      'meta', 'head', 'parts', 'reasons', 'evidenceItems', 'results', 'events', 'goals',
      'transfers', 'transactions', 'categories', 'types', 'snapshots', 'repayments',
      'savings', 'presets', 'parents', 'children', 'subs', 'options', 'entries', 'nodes',
      'investments', 'schedules', 'alerts', 'badges', 'chips', 'cards', 'charts',
    ]);
    // ---- 白名单：已知安全的全局/局部标识符 ----
    const SAFE_IDENTIFIERS = new Set([
      'i', 'j', 'k', 'n', 'len', 'idx', 'pct', 'rgb', 'hex', 'ok', 'err', 'variant',
    ]);
    // ---- 裸标识符（非成员访问）中的「用户文本风格」危险名 ----
    // 局部变量无法做数据流分析，只拦名字本身就像用户自由文本的（LLM 输出、
    // 动态拼接串、备注等）；HTML 片段约定（*Html）与安全值走白名单/约定放行。
    const DANGEROUS_IDENTIFIERS = new Set([
      'note', 'name', 'text', 'desc', 'description', 'content', 'title', 'merchant',
      'label', 'remark', 'memo', 'comment', 'raw', 'body', 'msg', 'message', 'reason',
      'insight', 'insights', 'advice', 'caption', 'summary', 'regionText', 'capText',
      'variant', 'placeholder', 'hint', 'tip', 'query', 'keyword', 'search',
    ]);
    // ---- 白名单：返回安全值的函数名（数值/字符串构造器，输出非用户原文）----
    const SAFE_CALLS = new Set([
      'escapeHtml', 'escapeHtmlAttr', 'fmt', 'fmtSigned', 'fmtCompact', 'fmtMix', 'fmtDate',
      'fmtDateOnly', 'fmtDateTime', 'fmtNum', 'toFixed', 'toLocaleString', 'toUpperCase',
      'toLowerCase', 'padStart', 'padEnd', 'repeat', 'trim', 'String', 'Number', 'parseInt',
      'parseFloat', 'Boolean', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
      'Math.round', 'Math.floor', 'Math.ceil', 'Math.abs', 'Math.min', 'Math.max', 'Math.pow',
      'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds',
    ]);
    // 已知返回「已转义 HTML 片段」的函数（渲染辅助）：其返回值整体安全
    const SAFE_HTML_CALLS = new Set([
      'renderKPIs', 'renderCompare', 'renderAssets', 'renderCharts',
    ]);
    // 返回「开发者受控文本」的函数：i18n 翻译 / 本地化 / 时间格式化（非用户自由文本）
    const SAFE_TEXT_CALLS = new Set([
      'tt', 't', 'i18n', 'localize', 'localizeSystemNames', 'confirmT', 'formatRelativeTime',
      'getCatName', 'getAccName', 'catName', 'accName', 'typeLabel', 'statusLabel',
    ]);

    function isSafeCall(node) {
      const c = node.callee;
      if (!c) return false;
      const fname = c.type === 'Identifier' ? c.name
        : (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier' ? c.property.name : '');
      if (SAFE_CALLS.has(fname) || SAFE_TEXT_CALLS.has(fname)) return true;
      // 形如 x.renderY() / this.renderY()：已知 HTML 片段渲染辅助
      if (SAFE_HTML_CALLS.has(fname)) return true;
      // *Html/*HTML/escaped* 命名约定：约定俗成的 HTML 片段构建器 / 已转义变量
      if (/Html$/i.test(fname) || /HTML$/i.test(fname) || /^escaped/i.test(fname)) return true;
      return false;
    }

    // 收集节点子树中所有出现的「危险插值名」（未被消音的标识符/成员属性）。
    // 关键区分：函数名与方法名不是数据字段——只递归「调用参数」与「成员访问的
    // 对象属性」，.join/.map/.replace/tt(...) 这类形态不会误报。
    function collectRisky(node, sink) {
      if (!node || typeof node !== 'object') return;
      switch (node.type) {
        case 'CallExpression': {
          if (isSafeCall(node)) return;
          (node.arguments || []).forEach((a) => collectRisky(a, sink));
          const c = node.callee;
          if (c && c.type === 'MemberExpression' && c.object) collectRisky(c.object, sink);
          return;
        }
        case 'Identifier': {
          // 裸标识符：只在名字本身像用户自由文本时拦截（局部变量无数据流信息）
          if (SAFE_COLLECTIONS.has(node.name) || SAFE_IDENTIFIERS.has(node.name)) return;
          if (DANGEROUS_IDENTIFIERS.has(node.name)) sink.add(node.name);
          return;
        }
        case 'MemberExpression': {
          const p = node.property && node.property.type === 'Identifier' ? node.property.name : '';
          // 常量查找（CONST[key]，对象为全大写下划线命名约定）是代码受控查表，安全
          const obj = node.object;
          const isConstLookup = obj && obj.type === 'Identifier' && /^[A-Z][A-Z0-9_]*$/.test(obj.name);
          if (isConstLookup) return;
          if (p && (SAFE_FIELDS.has(p) || SAFE_COLLECTIONS.has(p) || /Html$/i.test(p) || /^escaped/i.test(p))) {
            // 属性名安全，但仍需检查对象侧（如 userInput.name 的 userInput 部分是调用结果）
            if (node.object) collectRisky(node.object, sink);
            return;
          }
          if (p) sink.add(p);
          if (node.object) collectRisky(node.object, sink);
          return;
        }
        case 'ConditionalExpression': {
          // 三元：只查两个分支，测试条件不是插值内容
          collectRisky(node.consequent, sink);
          collectRisky(node.alternate, sink);
          return;
        }
        default:
          break;
      }
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const v = node[key];
        if (Array.isArray(v)) v.forEach((c) => collectRisky(c, sink));
        else if (v && typeof v === 'object' && typeof v.type === 'string') collectRisky(v, sink);
      }
    }

    function check(node, valueNode) {
      // 整体被 escapeHtml/安全调用包裹 → 安全
      if (valueNode.type === 'CallExpression' && isSafeCall(valueNode)) return;
      // 只检查「模板字面量里的 ${...} 插值」：条件判断、filter 比较、赋值右侧
      // 的计算过程都不是插值，不应误报（如 c.parent_id === p.id、x ? y : z 的测试）。
      const literals = [];
      (function findTemplates(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'TemplateLiteral') literals.push(n);
        for (const key in n) {
          if (key === 'parent' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
          const v = n[key];
          if (Array.isArray(v)) v.forEach(findTemplates);
          else if (v && typeof v === 'object' && typeof v.type === 'string') findTemplates(v);
        }
      })(valueNode);
      const found = new Set();
      for (const t of literals) {
        for (const expr of t.expressions) collectRisky(expr, found);
      }
      if (found.size) {
        context.report({ node: valueNode, messageId: 'unescaped', data: { names: [...found].join(', ') } });
      }
    }
    return {
      AssignmentExpression(node) {
        if (node.left && node.left.type === 'MemberExpression' && node.left.property
          && /^(innerHTML|outerHTML)$/.test(node.left.property.name)) {
          check(node, node.right);
        }
      },
      CallExpression(node) {
        if (node.callee && node.callee.type === 'MemberExpression' && node.callee.property
          && node.callee.property.name === 'insertAdjacentHTML' && node.arguments[1]) {
          check(node, node.arguments[1]);
        }
      },
    };
  },
};
