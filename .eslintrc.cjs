/**
 * ESLint 配置（前端 public/js）
 * 聚焦 XSS 防护：检测 innerHTML 未转义用户字段。
 * 运行：npm run lint（需先 npm i -D eslint）
 * 前端大量使用浏览器全局/全局函数，故关闭 no-undef / no-unused-vars 避免噪音。
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script',
  },
  rules: {
    // 自定义规则（由 --rulesdir scripts/eslint 加载）
    'no-unescaped-innerhtml': 'error',
    // 关闭与前端运行环境无关、易误报的规则
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-console': 'off',
  },
};
