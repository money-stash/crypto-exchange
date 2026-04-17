const { getConnection } = require('../config/database');

class Mailing {
  constructor(data) {
    this.id = data.id;
    this.status = data.status;
    this.bot_id = data.bot_id;
    this.text = data.text;
    this.total_count = data.total_count;
    this.send_count = data.send_count;
    this.error_send_count = data.error_send_count || 0;
    
    // безопасный парсинг json вложений
    try {
      this.attachments = data.attachments ? JSON.parse(data.attachments) : null;
    } catch (e) {
      console.error('Failed to parse attachments JSON:', e);
      this.attachments = null;
    }
    
    this.created_at = data.created_at;
    this.end_at = data.end_at;
    
    // копируем дополнительные поля для joined запросов
    if (data.bot_name) this.bot_name = data.bot_name;
    if (data.bot_identifier) this.bot_identifier = data.bot_identifier;
  }

  // создание новой рассылки
  static async create(mailingData) {
    const db = getConnection();
    const { 
      bot_id, 
      text, 
      total_count, 
      attachments = null, 
      status = 'active' 
    } = mailingData;

    const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

    const [result] = await db.execute(
      'INSERT INTO mailings (bot_id, text, total_count, send_count, error_send_count, attachments, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [bot_id, text, total_count, 0, 0, attachmentsJson, status]
    );

    return await Mailing.findById(result.insertId);
  }

  // поиск рассылки по id
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM mailings WHERE id = ?', [id]);
    return rows.length > 0 ? new Mailing(rows[0]) : null;
  }

  // получение всех рассылок с пагинацией
  static async getAll(filters = {}) {
    const db = getConnection();
    let query = `
      SELECT m.*, b.name as bot_name, b.identifier as bot_identifier 
      FROM mailings m 
      LEFT JOIN bots b ON m.bot_id = b.id 
      WHERE 1=1
    `;
    const params = [];


    // фильтр по bot_id / bot_ids
    if (Array.isArray(filters.bot_ids) && filters.bot_ids.length > 0) {
      const normalizedBotIds = filters.bot_ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0);

      if (normalizedBotIds.length > 0) {
        query += ` AND m.bot_id IN (${normalizedBotIds.map(() => '?').join(', ')})`;
        params.push(...normalizedBotIds);
      }
    } else if (filters.bot_id !== undefined && filters.bot_id !== null && filters.bot_id !== '') {
      query += ' AND m.bot_id = ?';
      params.push(Number(filters.bot_id));
    }

    // фильтр по статусу
    if (filters.status) {
      query += ' AND m.status = ?';
      params.push(filters.status);
    }

    // поиск
    if (filters.search) {
      query += ' AND (m.text LIKE ? OR b.name LIKE ? OR b.identifier LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // console.log('Count query:', query.replace(
    //   'SELECT m.*, b.name as bot_name, b.identifier as bot_identifier FROM mailings m LEFT JOIN bots b ON m.bot_id = b.id',
    //   'SELECT COUNT(*) AS total FROM mailings m LEFT JOIN bots b ON m.bot_id = b.id'
    // ));
    // console.log('Count params:', params);

    // считаем общее количество для пагинации
    let countQuery = query.replace(
      'SELECT m.*, b.name as bot_name, b.identifier as bot_identifier FROM mailings m LEFT JOIN bots b ON m.bot_id = b.id',
      'SELECT COUNT(*) AS total FROM mailings m LEFT JOIN bots b ON m.bot_id = b.id'
    );
    
    try {
      const [countRows] = await db.execute(countQuery, params);
      const total = (countRows && countRows[0]) ? countRows[0].total : 0;

      query += ' ORDER BY m.created_at DESC';

      // пагинация
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 10;
      const offset = (page - 1) * limit;
      
      query += ` LIMIT ${limit} OFFSET ${offset}`;

      const [rows] = await db.execute(query, params);
      const mailings = (rows || []).map(row => new Mailing(row));

      return {
        mailings,
        total,
        pages: Math.ceil(total / limit),
        page,
        limit
      };
    } catch (error) {
      console.error('Error in Mailing.getAll:', error);
      throw error;
    }
  }

  // обновление счетчика ошибок отправки
  static async updateErrorSendCount(id, increment = 1) {
    const db = getConnection();
    await db.execute(
      'UPDATE mailings SET error_send_count = error_send_count + ? WHERE id = ?',
      [increment, id]
    );

    return await Mailing.findById(id);
  }

  // обновление рассылки
  static async update(id, updateData) {
    const db = getConnection();
    const allowedFields = ['status', 'send_count', 'error_send_count', 'end_at'];
    
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);
    await db.execute(
      `UPDATE mailings SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return await Mailing.findById(id);
  }

  // отмена рассылки
  static async cancel(id) {
    const db = getConnection();
    await db.execute(
      'UPDATE mailings SET status = ?, end_at = NOW() WHERE id = ? AND status = ?',
      ['cancel', id, 'active']
    );

    return await Mailing.findById(id);
  }

  // завершение рассылки
  static async complete(id) {
    const db = getConnection();
    await db.execute(
      'UPDATE mailings SET status = ?, end_at = NOW() WHERE id = ?',
      ['end', id]
    );

    return await Mailing.findById(id);
  }

  // обновление счетчика отправки
  static async updateSendCount(id, increment = 1) {
    const db = getConnection();
    await db.execute(
      'UPDATE mailings SET send_count = send_count + ? WHERE id = ?',
      [increment, id]
    );

    // проверяем завершена ли рассылка
    const mailing = await Mailing.findById(id);
    if (mailing && mailing.send_count >= mailing.total_count && mailing.status === 'active') {
      await Mailing.complete(id);
      return await Mailing.findById(id);
    }

    return mailing;
  }

  // получение активных рассылок
  static async getActive() {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM mailings WHERE status = ? ORDER BY created_at ASC', ['active']);
    return rows.map(row => new Mailing(row));
  }

  // статистика рассылок
  static async getStatistics() {
    const db = getConnection();
    
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_mailings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_mailings,
        SUM(CASE WHEN status = 'end' THEN 1 ELSE 0 END) as completed_mailings,
        SUM(CASE WHEN status = 'cancel' THEN 1 ELSE 0 END) as cancelled_mailings,
        SUM(total_count) as total_planned_sends,
        SUM(send_count) as total_actual_sends,
        SUM(error_send_count) as total_error_sends
      FROM mailings
    `);

    const [recentActivity] = await db.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as mailings_created,
        SUM(total_count) as total_planned,
        SUM(send_count) as total_sent,
        SUM(error_send_count) as total_errors
      FROM mailings 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    return {
      overview: stats[0] || { 
        total_mailings: 0, 
        active_mailings: 0, 
        completed_mailings: 0, 
        cancelled_mailings: 0,
        total_planned_sends: 0,
        total_actual_sends: 0,
        total_error_sends: 0
      },
      recentActivity: recentActivity.map(activity => ({
        date: activity.date,
        mailings_created: activity.mailings_created,
        total_planned: activity.total_planned,
        total_sent: activity.total_sent,
        total_errors: activity.total_errors || 0
      }))
    };
  }

  // удаление рассылки
  static async delete(id) {
    const db = getConnection();
    const [result] = await db.execute('DELETE FROM mailings WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // проверка доступа пользователя к рассылке
  static async canUserAccess(mailingId, userId, userRole) {
    if (userRole === 'SUPERADMIN') {
      return true;
    }

    if (userRole === 'EX_ADMIN') {
      const db = getConnection();
      const [rows] = await db.execute(`
        SELECT m.id 
        FROM mailings m
        JOIN bots b ON m.bot_id = b.id
        WHERE m.id = ? AND b.owner_id = ?
      `, [mailingId, userId]);
      
      return rows.length > 0;
    }

    return false;
  }
}

module.exports = Mailing;
