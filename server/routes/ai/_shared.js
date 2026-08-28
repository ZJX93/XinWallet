/* ============================================
   AI 路由公共依赖
   ------------------------------------------------
     原 server/routes/ai.js 有 1567 行、53 个路由、17 组互不相关的职责。
     拆分后各子模块只保留自己的路由，公共依赖统一从这里取。

   ⛔ 本文件【不注册任何路由】，只导出依赖与少量共用工具函数。
      路由的组装见 ./index.js。

   ⛔ 相对路径比原来深一层：本文件位于 server/routes/ai/ 下，
      故 ../db → ../../db、./_helpers → ../_helpers。
   ============================================ */

const express = require('express');
const multer = require('multer');
const db = require('../../db');
const { encrypt, decrypt } = require('../../crypto');
const {
    success, fail, handleServerError, maskKey, extractJson, tryDecrypt,
    computeAccountBalance, enforceBalanceLimit, fmtDateTime,
    stripThinkingTokens, polishChatReply,
} = require('../_helpers');
const { toAmount, toNumber } = require('../../validate');
const { syncCreditCardDebt } = require('../utils');
// AI 模块桶：图片通道（/ocr）与预测闭环（/transactions/parse）都要用。
// ⛔ 路由层【只能】依赖这个桶文件，不得直接 require modules/ai 的子目录。
const aiModule = require('../../modules/ai');
const {
    getActiveProvider, getTranscriptionProvider, callProvider, chatWithTools, httpsPostRaw,
} = require('../../services/ai');
// 事件总线统计：桶文件 modules/ai 未导出 getStats，只能从子模块取。
// ⚠️ 收归到本文件是为了让「子路由不直接 require modules/ai 子目录」这条
//    架构约束能被执行（有测试守着），避免每个子路由各自绕桶。
const { getStats: getEventBusStats } = require('../../modules/ai/events/event-bus');

/**
 * 统一校验 AI 服务商可用性：区分「未配置」与「配置存在但密钥解密失败（重部署导致）」，
 * 让前端能给出明确引导（前往「AI 配置」页重新保存），避免用户误以为配置丢失。
 */
function checkProvider(res, provider) {
    if (!provider) {
        res.status(400).json(fail('请先在 Web 端「AI 配置」页面配置 AI 服务商'));
        return false;
    }
    if (provider._decryptFailed) {
        res.status(400).json(fail('检测到 AI 服务商配置，但密钥解密失败（很可能是重部署后加密密钥 ENCRYPTION_KEY 变更）。请前往「AI 配置」页重新保存该服务商的 API Key。'));
        return false;
    }
    return true;
}

// 仅 OCR 路由需要图片上传：memoryStorage 不落盘、5MB 上限、仅接受图片类型。
// 局部定义并只挂到 /ocr 路由，不在全局 /api 上套用上传中间件，
// 缩小「任意 /api 端点被 multipart 大 body 试探」的 DoS / 内存放大面。
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('仅支持图片格式'), false);
        cb(null, true);
    }
});

/**
 * PG 的 JSONB 列驱动已自动反序列化，MySQL 的 JSON 列回来是字符串 —— 这里统一兜底。
 * （原位于 ai.js 文件末尾，被 /evaluation/runs 使用。）
 */
function safeJson(v, dflt) {
    if (v === null || v === undefined) return dflt;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (_) { return dflt; }
}

module.exports = {
    // 基础
    express, db, encrypt, decrypt,
    // 响应与错误
    success, fail, handleServerError,
    // 文本/格式工具
    maskKey, extractJson, tryDecrypt, fmtDateTime, stripThinkingTokens, polishChatReply, safeJson,
    // 数值与账务
    toAmount, toNumber, computeAccountBalance, enforceBalanceLimit, syncCreditCardDebt,
    // AI 能力
    aiModule, getActiveProvider, getTranscriptionProvider, callProvider, chatWithTools, httpsPostRaw,
    getEventBusStats,
    // 本文件定义的共用件
    checkProvider, upload,
};
