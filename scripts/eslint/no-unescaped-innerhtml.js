/**
 * 自定义 ESLint 规则：禁止未转义的 innerHTML / insertAdjacentHTML 赋值
 * 用法：eslint --rulesdir scripts/eslint public/js --ext .js
 *
 * 启发式：扫描赋值/调用右侧表达式中出现的“用户可控字段”（note/name/merchant/...），
 * 若这些字段未经过 escapeHtml() / escapeHtmlAttr() 包裹，则告警。
 * 这是粗粒度防护，可能有少量误报/漏报，作为 CI 兜底，不替代人工安全审查。
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'innerHTML/insertAdjacentHTML 必须转义用户字段（escapeHtml）' },
    messages: {
      unescaped: '检测到 innerHTML/insertAdjacentHTML 含有未转义的用户字段 "{{names}}"，请使用 escapeHtml() 包裹后再拼接。',
    },
    schema: [],
  },
  create(context) {
    const DANGEROUS = new Set([
      'note', 'name', 'merchant', 'description', 'memo', 'remark', 'title', 'comment',
      'icon', 'raw', 'text', 'category_name', 'account_name', 'category', 'account',
      'amount', 'date', 'type', 'code', 'tag',
    ]);
    const seen = new WeakSet();
    function walk(node, found, escaped) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (node.type === 'Identifier' && DANGEROUS.has(node.name)) found.add(node.name);
      if (node.type === 'MemberExpression' && node.property && node.property.type === 'Identifier' && DANGEROUS.has(node.property.name)) {
        found.add(node.property.name);
      }
      if (node.type === 'CallExpression' && node.callee) {
        const c = node.callee;
        const fname = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && c.property.type === 'Identifier' ? c.property.name : '');
        if (fname === 'escapeHtml' || fname === 'escapeHtmlAttr') {
          node.arguments.forEach((a) => {
            if (a.type === 'Identifier') escaped.add(a.name);
            if (a.type === 'MemberExpression' && a.property && a.property.type === 'Identifier') escaped.add(a.property.name);
          });
        }
      }
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const v = node[key];
        if (Array.isArray(v)) v.forEach((child) => walk(child, found, escaped));
        else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, found, escaped);
      }
    }
    function check(node, valueNode) {
      const found = new Set();
      const escaped = new Set();
      walk(valueNode, found, escaped);
      const unescaped = [...found].filter((f) => !escaped.has(f));
      if (unescaped.length) {
        context.report({ node: valueNode, messageId: 'unescaped', data: { names: unescaped.join(', ') } });
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
