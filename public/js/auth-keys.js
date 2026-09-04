/* 鑫钱包 · 认证相关 localStorage key 单一来源
 * auth.js（模块）与 login.js（经典脚本）共享，避免两端字面量分叉后「改一处漏一处」。
 * 以经典脚本（非模块）尽早执行，确保后续模块/脚本读取 window.XIN_AUTH_KEYS 时已就绪。
 */
(function () {
    window.XIN_AUTH_KEYS = {
        TOKEN_KEY: 'xin_token',
        REFRESH_TOKEN_KEY: 'zhicai_refresh_token',
        USER_KEY: 'zhicai_user',
        BOOK_ID_KEY: 'xin_book_id'
    };
})();
