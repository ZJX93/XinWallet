// Swagger UI 初始化（外置为 self 资源，满足 helmet CSP 的 scriptSrc 'self'，
// 避免此前内联 <script> 被 CSP 拦截导致 /docs 页面空白）
window.addEventListener('DOMContentLoaded', function () {
  window.SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [window.SwaggerUIBundle.presets.apis],
    layout: 'BaseLayout',
  });
});
