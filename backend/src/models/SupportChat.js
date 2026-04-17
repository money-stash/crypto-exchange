const { getConnection } = require('../config/database');

class SupportChat {
  constructor(data) {
    Object.assign(this, data);
  }

  /**
   * Получить или создать чат с пользователем
   * @param {number} userId - ID пользователя
   * @param {number} botId - ID бота
   * @returns {Promise<SupportChat>}
   */
  static async getOrCreate(userId, botId) {
    const db = getConnection();
    
    // Проверяем существует ли чат
    const [existing] = await db.execute(
      'SELECT * FROM support_chats WHERE user_id = ? AND bot_id = ?',
      [userId, botId]
    );

    if (existing.length > 0) {
      return new SupportChat(existing[0]);
    }

    // Создаем новый чат
    const [result] = await db.execute(
      'INSERT INTO support_chats (user_id, bot_id) VALUES (?, ?)',
      [userId, botId]
    );

    return await SupportChat.findById(result.insertId);
  }

  /**
   * Найти чат по ID
   * @param {number} id
   * @returns {Promise<SupportChat|null>}
   */
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM support_chats WHERE id = ?',
      [id]
    );
    return rows.length ? new SupportChat(rows[0]) : null;
  }

  /**
   * Получить все чаты с пользователями (с информацией о последнем сообщении и пользователе)
   * @param {Object} options - опции фильтрации
   * @returns {Promise<Array>}
   */
  static async getAllWithDetails(options = {}) {
    const db = getConnection();
    const { 
      limit = 50, 
      offset = 0,
      botId = null,
      hasUnread = null 
    } = options;

    // Приводим к числам и валидируем
    const limitNum = parseInt(limit) || 50;
    const offsetNum = parseInt(offset) || 0;

    let whereClause = '1=1';
    const params = [];

    if (botId) {
      whereClause += ' AND sc.bot_id = ?';
      params.push(parseInt(botId));
    }

    if (hasUnread === true) {
      whereClause += ' AND sc.unread_count > 0';
    }

    const query = `
      SELECT 
        sc.*,
        u.username,
        u.tg_id,
        b.name as bot_name,
        (
          SELECT scm.message 
          FROM support_chat_messages scm 
          WHERE scm.chat_id = sc.id 
          ORDER BY scm.created_at DESC 
          LIMIT 1
        ) as last_message,
        (
          SELECT scm.sender_type 
          FROM support_chat_messages scm 
          WHERE scm.chat_id = sc.id 
          ORDER BY scm.created_at DESC 
          LIMIT 1
        ) as last_message_sender_type,
        (
          SELECT s.login
          FROM support_chat_messages scm
          LEFT JOIN supports s ON scm.sender_id = s.id
          WHERE scm.chat_id = sc.id AND scm.sender_type = 'OPERATOR'
          ORDER BY scm.created_at DESC 
          LIMIT 1
        ) as last_operator_login
      FROM support_chats sc
      LEFT JOIN users u ON sc.user_id = u.id
      LEFT JOIN bots b ON sc.bot_id = b.id
      WHERE ${whereClause}
      ORDER BY 
        sc.unread_count DESC,
        sc.last_message_at DESC,
        sc.created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const [rows] = await db.execute(query, params);
    
    return rows.map(row => new SupportChat(row));
  }

  /**
   * Получить количество чатов
   * @param {Object} options - опции фильтрации
   * @returns {Promise<number>}
   */
  static async getCount(options = {}) {
    const db = getConnection();
    const { botId = null, hasUnread = null } = options;

    let whereClause = '1=1';
    const params = [];

    if (botId) {
      whereClause += ' AND bot_id = ?';
      params.push(botId);
    }

    if (hasUnread === true) {
      whereClause += ' AND unread_count > 0';
    }

    const [rows] = await db.execute(
      `SELECT COUNT(*) as count FROM support_chats WHERE ${whereClause}`,
      params
    );

    return rows[0].count;
  }

  /**
   * Получить сообщения чата
   * @param {number} chatId
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  static async getMessages(chatId, options = {}) {
    const db = getConnection();
    const { limit = 100, offset = 0 } = options;

    // Приводим к числам и валидируем
    const limitNum = parseInt(limit) || 100;
    const offsetNum = parseInt(offset) || 0;

    const query = `
      SELECT 
        scm.*,
        CASE 
          WHEN scm.sender_type = 'OPERATOR' THEN s.login
          ELSE u.username
        END as sender_name
      FROM support_chat_messages scm
      LEFT JOIN supports s ON scm.sender_type = 'OPERATOR' AND scm.sender_id = s.id
      LEFT JOIN users u ON scm.sender_type = 'USER' AND scm.sender_id = u.id
      WHERE scm.chat_id = ?
      ORDER BY scm.created_at ASC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const [rows] = await db.execute(query, [chatId]);
    return rows;
  }

  /**
   * Добавить сообщение в чат
   * @param {number} chatId
   * @param {Object} messageData
   * @returns {Promise<Object>}
   */
  static async addMessage(chatId, messageData) {
    const db = getConnection();
    const { senderType, senderId, message, attachmentsPath = null } = messageData;

    const [result] = await db.execute(
      `INSERT INTO support_chat_messages 
       (chat_id, sender_type, sender_id, message, attachments_path) 
       VALUES (?, ?, ?, ?, ?)`,
      [chatId, senderType, senderId, message, attachmentsPath]
    );

    // Обновляем время последнего сообщения в чате
    await db.execute(
      `UPDATE support_chats 
       SET last_message_at = NOW(),
           unread_count = CASE 
             WHEN ? = 'USER' THEN unread_count + 1 
             ELSE unread_count 
           END
       WHERE id = ?`,
      [senderType, chatId]
    );

    // Получаем добавленное сообщение с данными отправителя
    const [rows] = await db.execute(
      `SELECT 
        scm.*,
        CASE 
          WHEN scm.sender_type = 'OPERATOR' THEN s.login
          ELSE u.username
        END as sender_name
      FROM support_chat_messages scm
      LEFT JOIN supports s ON scm.sender_type = 'OPERATOR' AND scm.sender_id = s.id
      LEFT JOIN users u ON scm.sender_type = 'USER' AND scm.sender_id = u.id
      WHERE scm.id = ?`,
      [result.insertId]
    );

    return rows[0];
  }

  /**
   * Пометить сообщения как прочитанные
   * @param {number} chatId
   * @param {string} readerType - 'USER' или 'OPERATOR'
   * @returns {Promise<boolean>}
   */
  static async markMessagesAsRead(chatId, readerType = 'OPERATOR') {
    const db = getConnection();
    
    // Определяем какие сообщения нужно пометить как прочитанные
    const senderTypeToMark = readerType === 'OPERATOR' ? 'USER' : 'OPERATOR';

    await db.execute(
      `UPDATE support_chat_messages 
       SET is_read = 1 
       WHERE chat_id = ? AND sender_type = ? AND is_read = 0`,
      [chatId, senderTypeToMark]
    );

    // Обнуляем счетчик непрочитанных для оператора
    if (readerType === 'OPERATOR') {
      await db.execute(
        'UPDATE support_chats SET unread_count = 0 WHERE id = ?',
        [chatId]
      );
    }

    return true;
  }

  /**
   * Получить количество непрочитанных чатов для оператора
   * @returns {Promise<number>}
   */
  static async getUnreadChatsCount() {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM support_chats WHERE unread_count > 0'
    );
    return rows[0].count;
  }

  /**
   * Удалить чат
   * @param {number} chatId
   * @returns {Promise<boolean>}
   */
  static async delete(chatId) {
    const db = getConnection();
    const [result] = await db.execute(
      'DELETE FROM support_chats WHERE id = ?',
      [chatId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = SupportChat;
