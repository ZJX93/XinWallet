/* ============================================
   AI 路由聚合入口
   ------------------------------------------------
     原 server/routes/ai.js 单文件 1567 行 / 53 个路由 / 17 组职责，
     已按职责拆分为下列子模块。对外契约不变：
       server/routes.js 仍是 `router.use('/ai', aiLimiter, require('./routes/ai'))`
     Node 会优先解析 ai.js，找不到则解析 ai/index.js —— 本目录即新入口。

   ⚠️ 注册顺序即匹配顺序，务必与原文件保持一致：
      具体路径必须先于动态参数（如 /insights/ranked 先于 /insights/:id），
      否则动态段会把具体路径吃掉。各子模块【内部】已保持原有顺序，
      此处的顺序对应它们在原文件中的先后。
   ============================================ */

const { express } = require('./_shared');

const router = express.Router();

router.use(require('./providers'));       // /providers CRUD + 激活 + 连通性测试
router.use(require('./advice'));          // /advice（含已废弃的 /insight）
router.use(require('./ocr-config'));      // 腾讯云 OCR 密钥配置
router.use(require('./ocr'));             // 图片记账 /ocr + /ocr/retranscribe
router.use(require('./chat'));            // AI 对话（工具调用循环）
router.use(require('./transcribe'));      // 语音转写
router.use(require('./parse'));           // /transactions/parse
router.use(require('./predictions'));     // 预测快照 查询/提交/丢弃
router.use(require('./rules'));           // 记账规则 CRUD + 证据链
router.use(require('./learning'));        // 学习统计 + 离线评测
router.use(require('./insights'));        // AI 洞察
router.use(require('./conversations'));   // 会话管理
router.use(require('./profile'));         // AI 画像与偏好
router.use(require('./events'));          // 事件总线
router.use(require('./simulate'));        // 现金流/预算/储蓄/债务模拟
router.use(require('./v2-ops'));          // V2 运维端点

module.exports = router;
