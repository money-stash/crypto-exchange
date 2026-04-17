const { getConnection } = require('../config/database');
const { encrypt, decrypt } = require('../utils/crypto');

class User {
  constructor(data) {
    Object.assign(this, data);
  }

  static async findByTgId(tgId) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE tg_id = ?',
      [tgId]
    );
    return rows.length ? new User(rows[0]) : null;
  }

  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    return rows.length ? new User(rows[0]) : null;
  }

  static async getByBotId(botId, filters = {}) {
    const db = getConnection();
    let query = `
      SELECT DISTINCT u.* 
      FROM users u 
      JOIN user_bots ub ON u.id = ub.user_id 
      WHERE ub.bot_id = ?
    `;
    const params = [botId];

    if (filters.search) {
      query += ' AND (u.username LIKE ? OR u.phone LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }

    // пагинация
    if (filters.page && filters.limit) {
      const offset = (filters.page - 1) * filters.limit;
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(filters.limit), offset);
    }

    const [rows] = await db.execute(query, params);
    return rows.map(row => new User(row));
  }

  static async create(userData) {
    const db = getConnection();
    const [result] = await db.execute(
      `INSERT INTO users (tg_id, username, phone, ref_code, has_ref, discount_v) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userData.tg_id,
        userData.username || null,
        userData.phone || null,
        userData.ref_code || null,
        userData.has_ref || 0,
        userData.discount_v || 0
      ]
    );
    
    return await User.findById(result.insertId);
  }

  static async updateDiscount(userId, discount) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE users SET discount_v = ? WHERE id = ?',
      [discount, userId]
    );
    return result.affectedRows > 0;
  }

  static async updateUsernameById(userId, username) {
    const db = getConnection();
    const normalizedUsername = String(username || '').trim() || null;
    const [result] = await db.execute(
      'UPDATE users SET username = ? WHERE id = ?',
      [normalizedUsername, userId]
    );
    return result.affectedRows > 0;
  }

  static async search(filters = {}) {
    const db = getConnection();
    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];

    if (filters.username) {
      query += ' AND username LIKE ?';
      params.push(`%${filters.username}%`);
    }

    if (filters.tg_id) {
      query += ' AND tg_id = ?';
      params.push(filters.tg_id);
    }

    if (filters.search && filters.search.trim() !== '') {
      query += ' AND (username LIKE ? OR CAST(tg_id AS CHAR) LIKE ?)';
      const searchTerm = `%${filters.search.trim()}%`;
      params.push(searchTerm, searchTerm);
    }


    let countQuery = query.replace('SELECT * FROM users', 'SELECT COUNT(*) AS total FROM users');
    const [countRows] = await db.execute(countQuery, params);
    const total = countRows[0].total;

    query += ' ORDER BY created_at DESC';

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;
    
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    const [rows] = await db.execute(query, params);
    const users = rows.map(row => new User(row));

    return {
      users,
      total,
      pages: Math.ceil(total / limit),
      page,
      limit
    };
  }


  static async getOrders(userId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT o.* 
       FROM orders o 
       WHERE o.user_id = ? 
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async getOrdersStats(userId, botId = null) {
    const db = getConnection();
    
    let query = `SELECT 
         COUNT(*) as completed_orders,
         COALESCE(SUM(sum_rub), 0) as total_sum
       FROM orders 
       WHERE user_id = ? AND status = 'COMPLETED'`;
    
    const params = [userId];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    const [rows] = await db.execute(query, params);
    
    return {
      completed_orders: rows[0].completed_orders || 0,
      total_sum: parseFloat(rows[0].total_sum) || 0
    };
  }
}

module.exports = User;
