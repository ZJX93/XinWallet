/* ============================================
   鑫钱包 · 汇率路由（多币种 P2-2b）
   - GET  /api/fx/rates    取最新汇率（内存/DB/远端 三级 fallback）
   - POST /api/fx/refresh  强制刷新（拉远端并落库；设置页「刷新汇率」按钮调用）
   ============================================ */
const express = require('express');
const fxService = require('../services/fx-rates');

const router = express.Router();

router.get('/rates', async (req, res, next) => {
  try {
    const data = await fxService.getLatest();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const data = await fxService.getLatest({ forceRefresh: true });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
