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
  // 第三方库 / 压缩产物不参与 lint（体积大、非本项目源码，且常含非常规写法导致解析失败）
  ignorePatterns: ['public/js/vendor/**'],
  rules: {
    // 自定义规则（由 --rulesdir scripts/eslint 加载）
    'no-unescaped-innerhtml': 'error',
    // 关闭与前端运行环境无关、易误报的规则
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-console': 'off',
  },
  overrides: [
    {
      // managers/*.js 与 auth.js、bootstrap.js 是 ES module（export default / import ... from）。
      // 默认 sourceType: 'script' 会在 import/export 处直接解析失败，这里单独放开为 module；
      // utils.js 等经典脚本仍按 script 解析，避免严格模式语义影响既有代码。
      files: ['public/js/managers/**/*.js', 'public/js/auth.js', 'public/js/bootstrap.js'],
      parserOptions: { sourceType: 'module' },
    },
  ],
};
