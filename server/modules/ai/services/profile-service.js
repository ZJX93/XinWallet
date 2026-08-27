/* ============================================
   Profile Service
   ------------------------------------------------
   管理 ai_user_profiles 用户偏好 Profile。
   ============================================ */

const db = require('../../../db');

const DEFAULT_PROFILE = {
  interaction_style: 'detailed',
  notification_enabled: true,
  insight_frequency: 'daily',
  insight_rank_threshold: 3,
  preferences: {},
  stats_summary: {},
};

/**
 * 获取或创建用户 Profile（首次访问时自动创建）
 */
async function getOrCreateProfile(userId, bookId = null) {
  let profile = await db.queryOne(
    `SELECT * FROM ai_user_profiles WHERE user_id = ?`,
    [userId]
  );

  if (!profile) {
    const result = await db.query(
      `INSERT INTO ai_user_profiles (user_id, book_id, preferences, interaction_style,
                                     notification_enabled, insight_frequency, insight_rank_threshold)
       VALUES (?, ?, '{}', 'detailed', TRUE, 'daily', 3)`,
      [userId, bookId]
    );
    profile = await db.queryOne(`SELECT * FROM ai_user_profiles WHERE id = ?`, [result.insertId]);
  }

  return profile;
}

/**
 * 更新用户 Profile（部分字段）
 */
async function updateProfile(userId, updates) {
  const allowed = ['preferences', 'interaction_style', 'notification_enabled',
                  'insight_frequency', 'insight_rank_threshold'];
  const fields = [];
  const values = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === 'preferences' ? JSON.stringify(updates[key]) : updates[key]);
    }
  }

  if (fields.length === 0) return null;

  values.push(userId);
  const sql = `UPDATE ai_user_profiles SET ${fields.join(', ')} WHERE user_id = ?`;
  return db.query(sql, values);
}

/**
 * 更新 stats_summary（由定时任务调用，每日刷新）
 */
async function updateStatsSummary(userId, statsSummary) {
  return db.query(
    `UPDATE ai_user_profiles SET stats_summary = ? WHERE user_id = ?`,
    [JSON.stringify(statsSummary), userId]
  );
}

/**
 * 获取用户通知设置（用于判断是否推送洞察）
 */
async function getNotificationSettings(userId) {
  const profile = await db.queryOne(
    `SELECT notification_enabled, insight_frequency, insight_rank_threshold FROM ai_user_profiles WHERE user_id = ?`,
    [userId]
  );
  return profile || {
    notification_enabled: true,
    insight_frequency: 'daily',
    insight_rank_threshold: 3,
  };
}

/**
 * 记录最后推送洞察时间（用于 cooldown）
 */
async function touchLastInsight(userId) {
  return db.query(
    `UPDATE ai_user_profiles SET last_insight_at = NOW() WHERE user_id = ?`,
    [userId]
  );
}

/**
 * 删除用户 Profile（用户注销时可选清理）
 */
async function deleteProfile(userId) {
  return db.query(`DELETE FROM ai_user_profiles WHERE user_id = ?`, [userId]);
}

module.exports = {
  getOrCreateProfile,
  updateProfile,
  updateStatsSummary,
  getNotificationSettings,
  touchLastInsight,
  deleteProfile,
};
