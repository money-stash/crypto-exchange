const { getConnection } = require('../config/database');
const crypto = require('crypto');
const config = require('../config');

class Bot {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.identifier = data.identifier;
    this.token = data.token;
    this.description = data.description;
    this.is_active = data.is_active;
    this.owner_id = data.owner_id;
    this.reviews_chat_link = data.reviews_chat_link;
    this.reviews_chat_id = data.reviews_chat_id;
    this.exchange_chat_link = data.exchange_chat_link;
    this.start_message = data.start_message;
    this.contacts_message = data.contacts_message;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  /**
   * создание бота
   * @param {Object} botData
   * @returns {Promise<Bot>}
   */
  static async create(botData) {
    const db = getConnection();
    const { name, identifier, token, description, owner_id, is_active = true, reviews_chat_link, reviews_chat_id, exchange_chat_link } = botData;
    if (!owner_id) {
      throw new Error('owner_id is required!!');
    }

    const [result] = await db.execute(
      'INSERT INTO bots (name, identifier, token, description, owner_id, is_active, reviews_chat_link, reviews_chat_id, exchange_chat_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, identifier, token, description, owner_id, is_active, reviews_chat_link || null, reviews_chat_id || null, exchange_chat_link || null]
    );

    return await Bot.findById(result.insertId);
  }

  /**
   * поиск бота по ID
   * @param {number} id
   * @returns {Promise<Bot|null>}
   */
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM bots WHERE id = ?', [id]);
    return rows.length > 0 ? new Bot(rows[0]) : null;
  }

  // поиск по идентификатору
  static async findByIdentifier(identifier) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM bots WHERE identifier = ?', [identifier]);
    return rows.length > 0 ? new Bot(rows[0]) : null;
  }

  // получение id ботов по владельцу
  static async getBotIdsByOwner(ownerId) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT id FROM bots WHERE owner_id = ? AND is_active = 1', [ownerId]);
    return rows.map(row => row.id);
  }

  // поиск по токену
  static async findByToken(token) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM bots WHERE token = ?', [token]);
    return rows.length > 0 ? new Bot(rows[0]) : null;
  }

  // получение всех ботов
  static async getAll(filters = {}) {
    const db = getConnection();
    let query = 'SELECT * FROM bots WHERE 1=1';
    const params = [];

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active);
    }

    if (filters.search) {
      query += ' AND (name LIKE ? OR identifier LIKE ? OR description LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // фильтр по владельцу
    if (filters.owner_id !== undefined) {
      query += ' AND owner_id = ?';
      params.push(filters.owner_id);
    }

    let countQuery = query.replace('SELECT * FROM bots', 'SELECT COUNT(*) AS total FROM bots');
    const [countRows] = await db.execute(countQuery, params);
    const total = countRows[0].total;

    query += ' ORDER BY created_at DESC';

    // пагинация
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const offset = (page - 1) * limit;
    
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    const [rows] = await db.execute(query, params);
    const bots = rows.map(row => new Bot(row)); 

    return {
      bots,
      total,
      pages: Math.ceil(total / limit),
      page,
      limit
    };
  }

  // обновление бота
  static async update(id, updateData) {
    const db = getConnection();
    const allowedFields = ['name', 'identifier', 'token', 'description', 'is_active', 'reviews_chat_link', 'reviews_chat_id', 'exchange_chat_link', 'start_message', 'contacts_message'];
    
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
      `UPDATE bots SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return await Bot.findById(id);
  }

  // статистика для менеджера
  static async getManagerStats() {
    const db = getConnection();

    // статистика за сегодня
    const [botStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_bots,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_bots
      FROM bots
    `);

    // получение общей статистики по заказам
    const [overallStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE 0 END), 0) as total_volume
      FROM orders
    `);

    const [todayStats] = await db.execute(`
      SELECT 
        COUNT(*) as today_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as today_completed,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE 0 END), 0) as today_volume
      FROM orders 
      WHERE DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')) = CURDATE()
        AND status = 'COMPLETED'
    `);

    const [monthlyStats] = await db.execute(`
      SELECT 
        COUNT(*) as monthly_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as monthly_completed,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE 0 END), 0) as monthly_volume
      FROM orders 
      WHERE YEAR(CONVERT_TZ(created_at, '+00:00', '+03:00')) = YEAR(NOW()) 
        AND MONTH(CONVERT_TZ(created_at, '+00:00', '+03:00')) = MONTH(NOW())
    `);

    const [topBots] = await db.execute(`
      SELECT 
        b.id,
        b.name,
        b.identifier,
        COUNT(o.id) as total_orders,
        SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub ELSE 0 END), 0) as total_volume,
        ROUND(AVG(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub ELSE NULL END), 2) as avg_order_value,
        CASE 
          WHEN COUNT(o.id) > 0 THEN ROUND((SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) * 100.0 / COUNT(o.id)), 2)
          ELSE 0 
        END as completion_rate
      FROM bots b
      LEFT JOIN orders o ON b.id = o.bot_id
      GROUP BY b.id, b.name, b.identifier
      HAVING total_orders > 0
      ORDER BY completed_orders DESC, total_volume DESC
      LIMIT 10
    `);

    const [dailyPerformance] = await db.execute(`
      WITH RECURSIVE date_range AS (
        SELECT DATE_SUB(CURDATE(), INTERVAL 29 DAY) as date
        UNION ALL
        SELECT DATE_ADD(date, INTERVAL 1 DAY)
        FROM date_range
        WHERE date < CURDATE()
      )
      SELECT 
        DATE_FORMAT(dr.date, '%Y-%m-%d') as date,
        COALESCE(COUNT(o.id), 0) as total_orders,
        COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed_orders,
        COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub ELSE 0 END), 0) as total_volume
      FROM date_range dr
      LEFT JOIN orders o ON DATE(CONVERT_TZ(o.created_at, '+00:00', '+03:00')) = dr.date
      GROUP BY dr.date
      ORDER BY dr.date ASC
    `);

    const [statusDistribution] = await db.execute(`
      SELECT 
        status,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM orders)), 2) as percentage
      FROM orders 
      GROUP BY status
      ORDER BY count DESC
    `);

    const [topCurrencies] = await db.execute(`
      SELECT 
        coin,
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE 0 END), 0) as total_volume,
        CASE 
          WHEN COUNT(*) > 0 THEN ROUND((SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 2)
          ELSE 0 
        END as completion_rate
      FROM orders 
      GROUP BY coin
      HAVING total_orders > 0
      ORDER BY total_volume DESC
      LIMIT 10
    `);

    // график производительности ботов
    const [botPerformance] = await db.execute(`
      SELECT 
        b.name,
        b.identifier,
        COUNT(o.id) as total_orders,
        SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.sum_rub ELSE 0 END), 0) as total_volume
      FROM bots b
      LEFT JOIN orders o ON b.id = o.bot_id
      WHERE b.is_active = 1
      GROUP BY b.id, b.name, b.identifier
      HAVING total_orders > 0
      ORDER BY completed_orders DESC
      LIMIT 8
    `);

    return {
      bots: {
        total: botStats[0].total_bots,
        active: botStats[0].active_bots
      },
      overall: {
        total_orders: overallStats[0].total_orders,
        completed_orders: overallStats[0].completed_orders,
        total_volume: parseFloat(overallStats[0].total_volume)
      },
      today: {
        orders: todayStats[0].today_orders,
        completed: todayStats[0].today_completed,
        volume: parseFloat(todayStats[0].today_volume)
      },
      monthly: {
        orders: monthlyStats[0].monthly_orders,
        completed: monthlyStats[0].monthly_completed,
        volume: parseFloat(monthlyStats[0].monthly_volume)
      },
      topBots: topBots.map(bot => ({
        id: bot.id,
        name: bot.name,
        identifier: bot.identifier,
        total_orders: bot.total_orders,
        completed_orders: bot.completed_orders,
        total_volume: parseFloat(bot.total_volume),
        avg_order_value: parseFloat(bot.avg_order_value) || 0,
        completion_rate: parseFloat(bot.completion_rate) || 0
      })),
      dailyPerformance: dailyPerformance.map(day => ({
        date: day.date,
        total_orders: day.total_orders,
        completed_orders: day.completed_orders,
        total_volume: parseFloat(day.total_volume)
      })),
      statusDistribution: statusDistribution.map(status => ({
        status: status.status,
        count: status.count,
        percentage: parseFloat(status.percentage)
      })),
      topCurrencies: topCurrencies.map(currency => ({
        coin: currency.coin,
        total_orders: currency.total_orders,
        completed_orders: currency.completed_orders,
        total_volume: parseFloat(currency.total_volume),
        completion_rate: parseFloat(currency.completion_rate) || 0
      })),
      botPerformance: botPerformance.map(bot => ({
        name: bot.name,
        identifier: bot.identifier,
        total_orders: bot.total_orders,
        completed_orders: bot.completed_orders,
        total_volume: parseFloat(bot.total_volume)
      }))
    };
  }

    // удаление бота
  static async delete(id) {
    const db = getConnection();
    const [result] = await db.execute('DELETE FROM bots WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  // переключение статуса активности
  static async toggleActive(id) {
    const db = getConnection();
    await db.execute('UPDATE bots SET is_active = NOT is_active WHERE id = ?', [id]);
    return await Bot.findById(id);
  }

  // получение бота с реквизитами
  static async getBotWithRequisites(botId) {
    const bot = await Bot.findById(botId);
    if (!bot) return null;

    const requisites = await BotRequisite.getByBotId(botId);
    return {
      ...bot,
      requisites
    };
  }

  // статистика бота
  static async getStatistics(botId) {
    const db = getConnection();
    
    const [orderStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE 0 END) as total_volume,
        AVG(CASE WHEN status = 'COMPLETED' THEN sum_rub ELSE NULL END) as avg_order_value
      FROM orders 
      WHERE bot_id = ?
    `, [botId]);

    const [userStats] = await db.execute(`
      SELECT COUNT(DISTINCT user_id) as unique_users
      FROM orders 
      WHERE bot_id = ?
    `, [botId]);

    return {
      orders: orderStats[0] || { total_orders: 0, completed_orders: 0, total_volume: 0, avg_order_value: 0 },
      users: userStats[0] || { unique_users: 0 }
    };
  }
}

class BotRequisite {
  constructor(data) {
    this.id = data.id;
    this.bot_id = data.bot_id;
    this.type = data.type;
    this.label = data.label;
    this.address = data.address;
    this.bank_name = data.bank_name;
    this.holder_name = data.holder_name;
    this.is_active = data.is_active;
    this.is_default = data.is_default;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  /**
   * Шифрование адреса
   * @param {string} data
   * @returns {string}
   */
  static encrypt(data) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(config.encryption.key, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  // расшифровка адреса
  static decrypt(encryptedData) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(config.encryption.key, 'salt', 32);
    
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }



  // создание реквизита
  static async create(data) {
    const db = getConnection();
    const { bot_id, type, address, bank_name, holder_name, label = null, is_active = true, is_default = false } = data;


    const [result] = await db.execute(
      'INSERT INTO bot_requisites (bot_id, type, address, bank_name, holder_name, label) VALUES (?, ?, ?, ?, ?, ?)',
      [bot_id, type, address, bank_name || null, holder_name || null, label]
    );

    return await BotRequisite.findById(result.insertId);
  }

  // поиск по id
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM bot_requisites WHERE id = ?', [id]);
    return rows.length > 0 ? new BotRequisite(rows[0]) : null;
  }

  /**
   * Получение по ID бота
   * @param {number} botId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  static async getByBotId(botId, filters = {}) {
    const db = getConnection();
    let query = 'SELECT * FROM bot_requisites WHERE bot_id = ?';
    const params = [botId];

    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters.is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.is_active);
    }

    // if (filters.is_default !== undefined) {
    //   query += ' AND is_default = ?';
    //   params.push(filters.is_default);
    // }

    query += ` ORDER BY
      CASE
        WHEN type = 'SBP' THEN 0
        WHEN type = 'CARD' THEN 1
        ELSE 2
      END,
      created_at DESC`;

    const [rows] = await db.execute(query, params);
    return rows.map(row => new BotRequisite(row));
  }

  // дефолтный реквизит для бота
  static async getDefault(botId, type) {
    const requisites = await BotRequisite.getByBotId(botId, { 
      type, 
      is_active: true, 
      is_default: true 
    });
    return requisites.length > 0 ? requisites[0] : null;
  }

  // случайный активный реквизит (если нет дефолтного)
  static async getRandomActive(botId, type) {
    const requisites = await BotRequisite.getByBotId(botId, { 
      type, 
      is_active: true 
    });
    
    if (requisites.length === 0) return null;

    // возвращаем дефолтный если есть, иначе случайный
    const defaultRequisite = requisites.find(r => r.is_default);
    if (defaultRequisite) return defaultRequisite;
    
    const randomIndex = Math.floor(Math.random() * requisites.length);
    return requisites[randomIndex];
  }

  // обновление реквизита
  static async update(id, updateData) {
    const db = getConnection();
    const allowedFields = ['label', 'address', 'bank_name', 'holder_name', 'is_active'];
    const fields = [];
    const values = [];

    const currentRequisite = await BotRequisite.findById(id);
    if (!currentRequisite) {
      throw new Error('Requisite not found');
    }

    // если устанавливается как дефолтный, убираем дефолт у других для этого бота/типа
    // if (updateData.is_default === true) {
    //   await db.execute(
    //     'UPDATE bot_requisites SET is_default = false WHERE bot_id = ? AND type = ? AND id != ?',
    //     [currentRequisite.bot_id, currentRequisite.type, id]
    //   );
    // }

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
      `UPDATE bot_requisites SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return await BotRequisite.findById(id);
  }

  // удаление реквизита
  static async delete(id) {
    const db = getConnection();
    const [result] = await db.execute('DELETE FROM bot_requisites WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = { Bot, BotRequisite };
