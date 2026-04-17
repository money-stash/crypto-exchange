const { getConnection } = require('../config/database');

class ReferralBonus {
  constructor(data) {
    Object.assign(this, data);
  }

  // создание нового реферального бонуса
  static async create(data) {
    const db = getConnection();
    const [result] = await db.execute(
      `INSERT INTO referral_bonuses 
       (referrer_userbot_id, referred_userbot_id, order_id, bot_id, bonus_amount, bonus_percentage, referrer_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.referrerUserBotId,
        data.referredUserBotId, 
        data.orderId,
        data.botId,
        data.bonusAmount,
        data.bonusPercentage,
        data.referrerLevel
      ]
    );
    
    return await ReferralBonus.findById(result.insertId);
  }

  // поиск бонуса по id
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM referral_bonuses WHERE id = ?',
      [id]
    );
    return rows.length ? new ReferralBonus(rows[0]) : null;
  }

  // статистика рефералов для пользователя
  static async getReferralStats(userBotId, botId = null) {
    const db = getConnection();
    
    let query = `
      SELECT 
        COUNT(*) as total_bonuses,
        COALESCE(SUM(bonus_amount), 0) as total_bonus_amount,
        COALESCE(AVG(bonus_percentage), 0) as avg_percentage
      FROM referral_bonuses 
      WHERE referrer_userbot_id = ?
    `;
    
    const params = [userBotId];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    const [rows] = await db.execute(query, params);
    
    return {
      total_bonuses: parseInt(rows[0].total_bonuses) || 0,
      total_bonus_amount: parseFloat(rows[0].total_bonus_amount) || 0,
      avg_percentage: parseFloat(rows[0].avg_percentage) || 0
    };
  }

  // топ рефереров
  static async getTopReferrers(botId = null, limit = 10) {
    const db = getConnection();
    
    let query = `
      SELECT 
        ub.id,
        ub.username,
        ub.referral_level,
        COUNT(rb.id) as total_bonuses,
        COALESCE(SUM(rb.bonus_amount), 0) as total_earned
      FROM user_bots ub
      JOIN referral_bonuses rb ON ub.id = rb.referrer_userbot_id
    `;
    
    const params = [];
    
    if (botId) {
      query += ' WHERE rb.bot_id = ?';
      params.push(botId);
    }
    
    query += `
      GROUP BY ub.id, ub.username, ub.referral_level
      ORDER BY total_earned DESC
      LIMIT ?
    `;
    
    params.push(limit);
    
    const [rows] = await db.execute(query, params);
    return rows;
  }

  // бонусы конкретного реферера
  static async getByReferrer(referrerUserBotId, botId = null, limit = 20, offset = 0) {
    const db = getConnection();
    
    let query = `
      SELECT 
        rb.*,
        ub.username as referred_username,
        o.sum_rub as order_sum,
        o.coin as order_coin,
        o.dir as order_direction
      FROM referral_bonuses rb
      JOIN user_bots ub ON rb.referred_userbot_id = ub.id
      JOIN orders o ON rb.order_id = o.id
      WHERE rb.referrer_userbot_id = ?
    `;
    
    const params = [referrerUserBotId];
    
    if (botId) {
      query += ' AND rb.bot_id = ?';
      params.push(botId);
    }
    
    query += ' ORDER BY rb.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const [rows] = await db.execute(query, params);
    return rows;
  }

  // количество бонусов реферера
  static async getCountByReferrer(referrerUserBotId, botId = null) {
    const db = getConnection();
    
    let query = 'SELECT COUNT(*) as count FROM referral_bonuses WHERE referrer_userbot_id = ?';
    const params = [referrerUserBotId];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    const [rows] = await db.execute(query, params);
    return parseInt(rows[0].count) || 0;
  }
}

module.exports = ReferralBonus;