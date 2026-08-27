/* ============================================
   Message Service
   ------------------------------------------------
   管理 ai_messages 消息生命周期。
   ============================================ */

const db = require('../../../db');

/**
 * 写入一条消息
 */
async function addMessage({
  conversationId, userId, role, content,
  modelUsed = null, promptTokens = 0, completionTokens = 0,
  latencyMs = 0, attachments = [], toolCalls = null, toolResults = null,
  error = null,
}) {
  const result = await db.query(
    `INSERT INTO ai_messages
       (conversation_id, user_id, role, content, model_used,
        prompt_tokens, completion_tokens, latency_ms, attachments,
        tool_calls, tool_results, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [conversationId, userId, role, content, modelUsed,
     promptTokens, completionTokens, latencyMs,
     JSON.stringify(attachments), toolCalls ? JSON.stringify(toolCalls) : null,
     toolResults ? JSON.stringify(toolResults) : null, error]
  );
  return { id: result.insertId, conversationId, userId, role, content };
}

/**
 * 获取对话消息历史（分页，按时间正序）
 */
async function getMessages(userId, conversationId, { limit = 50, beforeId = null } = {}) {
  let sql = `SELECT * FROM ai_messages WHERE conversation_id = ? AND user_id = ?`;
  const params = [conversationId, userId];

  if (beforeId) {
    sql += ` AND id < ?`;
    params.push(beforeId);
  }

  sql += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(limit);

  return db.query(sql, params);
}

/**
 * 获取对话的最近 N 条消息（用于上下文注入）
 */
async function getRecentMessages(userId, conversationId, { limit = 10 } = {}) {
  return db.query(
    `SELECT * FROM ai_messages
       WHERE conversation_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    [conversationId, userId, limit]
  );
}

/**
 * 统计某对话的 token 总消耗（用于成本追踪）
 */
async function getTokenStats(userId, conversationId) {
  const row = await db.queryOne(
    `SELECT
       SUM(prompt_tokens) AS total_prompt,
       SUM(completion_tokens) AS total_completion,
       SUM(latency_ms) AS total_latency,
       COUNT(*) AS message_count
     FROM ai_messages
     WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  return row || { total_prompt: 0, total_completion: 0, total_latency: 0, message_count: 0 };
}

/**
 * 删除对话的所有消息（归档对话时可选清理）
 */
async function deleteMessages(userId, conversationId) {
  return db.query(
    `DELETE FROM ai_messages WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId]
  );
}

module.exports = {
  addMessage,
  getMessages,
  getRecentMessages,
  getTokenStats,
  deleteMessages,
};
