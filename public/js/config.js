// 鑫钱包 · 全局配置（必须在所有其他脚本之前加载）

// 自动推导 API 基址：兼容「反向代理 / 子路径」部署，避免 /api 请求打到错误 origin
window.XIN_API_BASE = (new URL('.', location.href).pathname.replace(/\/+$/, '')) + '/api';

// 登录检查：未登录则跳转登录页（同步执行，避免页面闪动）
if (!localStorage.getItem('xin_token') && location.pathname.indexOf('/login') === -1) {
    location.href = '/login';
}
