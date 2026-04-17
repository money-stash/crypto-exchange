const { getConnection } = require('../config/database');

/**
 * логирование события в аудит
 * @param {string} actor - актор (user:123, support:456, system)
 * @param {string} action - выполненное действие
 * @param {Object} meta - дополнительные метаданные
 */
async function logAudit(actor, action, meta = {}) {
  try {
    const db = getConnection();
    const [result] = await db.execute(
      'INSERT INTO audit_logs (actor, action, meta) VALUES (?, ?, ?)',
      [actor, action, JSON.stringify(meta)]
    );
    return result.insertId;
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

/**
 * логирование действия пользователя
 * @param {number} userId 
 * @param {string} action 
 * @param {Object} meta 
 */
async function logUserAction(userId, action, meta = {}) {
  return logAudit(`user:${userId}`, action, meta);
}

/**
 * логирование действия оператора
 * @param {number} supportId 
 * @param {string} action 
 * @param {Object} meta 
 */
async function logSupportAction(supportId, action, meta = {}) {
  return logAudit(`support:${supportId}`, action, meta);
}

/**
 * логирование системного действия
 * @param {string} action 
 * @param {Object} meta 
 */
async function logSystemAction(action, meta = {}) {
  return logAudit('system', action, meta);
}

/**
 * логирование действия telegram пользователя
 * @param {number|string} tgId
 * @param {string} action
 * @param {Object} meta
 */
async function logTelegramAction(tgId, action, meta = {}) {
  return logAudit(`tg:${tgId}`, action, meta);
}

module.exports = {
  logAudit,
  logUserAction,
  logSupportAction,
  logSystemAction,
  logTelegramAction
};
