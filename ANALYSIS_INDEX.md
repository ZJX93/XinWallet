# 鑫钱包（XinWallet）全量引用深度走读 — 索引

> 本目录 5 个 markdown 为逐文件、带真实行号引用的深度分析。由 CodeBuddy 通过并行子代理探查 + 主代理写入生成。
> 生成日期：2026-08-27

## 文档清单
| 文件 | 子系统 | 规模 | 核心内容 |
|------|--------|------|----------|
| `analysis_01_backend.md` | 后端 Node.js | db.js / books.js / ai.js / 15 路由 | 连接池、占位符归一化、启动自愈、多账本隔离中间件、AI 闭环路由 |
| `analysis_02_ai.md` | AI 子系统 (46 文件) | parser/extraction/intent/providers/runtime/memory/learning/rules/vision/... | 自然语言→交易全链路、决策引擎优先级、证据引擎学习、调用链图 |
| `analysis_03_web.md` | Web 前端 | 22 manager + index.html + css | 原生 JS 状态管理、DataManager 拆分来源、数据流 |
| `analysis_04_android.md` | Android 端 (90 kt) | MVVM + DI + 18 repository + 30+ 屏 | ApiService 端点映射、X-Book-Id 注入、AI 对接链路 |
| `analysis_05_harmony.md` | HarmonyOS 端 (33 ets) | 29 页 + 4 组件 + service | ArkUI 架构、与 Android 功能对齐表 |

## 关键技术发现（来自实际代码注释）
1. **多账本隔离**：`server/routes/books.js:48` 的 `resolveBookContext` 是总开关，所有路由按 `req.bookId` 过滤，实现 `user_id + book_id` 双隔离。
2. **AI 本地优先 + 学习闭环**：`modules/ai/index.js` 分层防火墙；`parser/transaction-parser.js` 编排「两遍抽取→记忆→决策→模型复核→校验→草稿」；`learning/evidence-engine.js` 2026-08-25 修复「证据只进不出」缺陷，commit 后异步 `learnFromCommit` 接通「feedback→规则/记忆→下次命中」。
3. **强自愈数据库**：`server/db.js` 启动自愈（分类种子修复、多账本回填、补列补索引），健康库为 no-op。
4. **三端同源**：Web/Android/Harmony 共享同一后端 API 契约（`X-Book-Id` + JWT），玻璃拟态+莫兰迪视觉贯穿。
5. **Android X-Book-Id 策略**：`ApiService.kt:67` `@Header("X-Book-Id") bookId: Int? = null` —— null 由 `AuthInterceptor` 注入当前账本，非 null 搜索页临时覆盖。

## 未覆盖说明
- 本轮对**核心文件**给出了真实行号代码引用；全量 400+ 文件中非核心文件（如部分 Android/Web 页面、test、scripts）以清单 + 职责覆盖，未逐行引用（受单次回复容量限制）。
- 如需对某一具体文件（如 `reports.js` 55KB 报表算法、`investments.js` 44KB 计费、`AddTransactionScreen.kt` 79KB 录入逻辑）做**逐行级**引用走读，请指明文件名，我将单独深挖。
