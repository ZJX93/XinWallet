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

// 实时折算：GET /api/fx/rate?from=USD&to=CNY&date=2026-09-07
// 用于记账表单在用户输入外币金额时实时预览折算后账户金额。
// date 可选；缺省取最新汇率。汇率取不到时返回 502 + 明确 message，前端据此提示手动填汇率。
router.get('/rate', async (req, res) => {
  try {
    const { from, to, date } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: '缺少 from / to 币种参数' });
    }
    const r = await fxService.getRate(from, to, date || null);
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(502).json({ success: false, message: e && e.message ? e.message : '汇率获取失败' });
  }
});

module.exports = router;
