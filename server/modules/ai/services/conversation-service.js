/* ============================================
   Conversation Service
   ------------------------------------------------
   管理 ai_conversations 会话生命周期。
   ============================================ */

const db = require('../../../db');

/**
 * 创建新对话
 */
async function createConversation(userId, { bookId = null, title = '新对话', modelUsed = null } = {}) {
  const result = await db.query(
    `INSERT INTO ai_conversations (user_id, book_id, title, model_used, status)
       VALUES (?, ?, ?, ?, 'active')`,
    [userId, bookId, title, modelUsed]
  );
  return { id: result.insertId, userId, bookId, title, modelUsed, status: 'active' };
}

/**
 * 获取用户对话列表（分页）
 */
async function getConversations(userId, { status = 'active', limit = 20, offset = 0 } = {}) {
  return db.query(
    `SELECT * FROM ai_conversations
       WHERE user_id = ? AND status = ?
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC
       LIMIT ? OFFSET ?`,
    [userId, status, limit, offset]
  );
}

/**
 * 获取单个对话详情
 */
async function getConversation(userId, conversationId) {
  return db.queryOne(
    `SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );
}

/**
 * 更新对话标题（用户主动改名 or 首条消息后自动摘要）
 */
async function updateTitle(userId, conversationId, title) {
  return db.query(
    `UPDATE ai_conversations SET title = ?, updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [title, conversationId, userId]
  );
}

/**
 * 归档对话（软删除）
 */
async function archiveConversation(userId, conversationId) {
  return db.query(
    `UPDATE ai_conversations SET status = 'archived', updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );
}

/**
 * 删除对话（连同消息一起删）
 */
async function deleteConversation(userId, conversationId) {
  const { transaction } = db;
  return transaction(async client => {
    await client.query(`DELETE FROM ai_messages WHERE conversation_id = ? AND user_id = ?`, [conversationId, userId]);
    await client.query(`DELETE FROM ai_conversations WHERE id = ? AND user_id = ?`, [conversationId, userId]);
  });
}

/**
 * 增量更新 message_count 和 last_message_at（每次发消息后调用）
 */
async function touchConversation(conversationId, userId) {
  return db.query(
    `UPDATE ai_conversations
       SET message_count = message_count + 1,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );
}

module.exports = {
  createConversation,
  getConversations,
  getConversation,
  updateTitle,
  archiveConversation,
  deleteConversation,
  touchConversation,
};
