const { getConnection } = require('../config/database');

class ReferralWithdraw {
  constructor(data) {
    Object.assign(this, data);
  }

  // создание запроса на вывод
  static async create(data) {
    const db = getConnection();
    const [result] = await db.execute(`
      INSERT INTO referrals_withdraw (userbot_id, amount_rub, amount_crypto, currency, wallet_address, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      data.userbot_id,
      data.amount_rub,
      data.amount_crypto,
      data.currency,
      data.wallet_address,
      data.status || 'CREATED'
    ]);

    return new ReferralWithdraw({
      id: result.insertId,
      ...data
    });
  }

  // поиск вывода по id
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT rw.*, 
             ub.tg_id, 
             u.username,
             b.name as bot_name
      FROM referrals_withdraw rw
      JOIN user_bots ub ON rw.userbot_id = ub.id
      JOIN users u ON ub.user_id = u.id
      JOIN bots b ON ub.bot_id = b.id
      WHERE rw.id = ?
    `, [id]);

    return rows.length > 0 ? new ReferralWithdraw(rows[0]) : null;
  }

      // считаем общий баланс из реферальных бонусов
  static async getWithdrawals(options = {}) {
    const {
      page = 1,
      limit = 20,
      status = null,
      botId = null,
      search = null
    } = options;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const offset = (pageNum - 1) * limitNum;
    const db = getConnection();

    console.log('GetWithdrawals params:', { page, limit, pageNum, limitNum, offset, status, botId, search });

    // валидация параметров
    if (isNaN(pageNum) || isNaN(limitNum) || isNaN(offset)) {
      throw new Error(`Invalid pagination parameters: page=${pageNum}, limit=${limitNum}, offset=${offset}`);
    }

    let whereConditions = [];
    let queryParams = [];

    if (status && status !== 'all' && ['CREATED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      whereConditions.push('rw.status = ?');
      queryParams.push(status);
    }

    if (botId) {
      whereConditions.push('ub.bot_id = ?');
      queryParams.push(botId);
    }

    if (search) {
      whereConditions.push('(u.username LIKE ? OR ub.tg_id LIKE ? OR rw.wallet_address LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    console.log('SQL whereClause:', whereClause);
    console.log('SQL queryParams:', queryParams);

    // считаем общее количество
    const [countRows] = await db.execute(`
      SELECT COUNT(*) as total
      FROM referrals_withdraw rw
      JOIN user_bots ub ON rw.userbot_id = ub.id
      JOIN users u ON ub.user_id = u.id
      JOIN bots b ON ub.bot_id = b.id
      ${whereClause}
    `, queryParams);

    const total = countRows[0].total;
    const pages = Math.ceil(total / limitNum);

    // получаем выводы
    const [rows] = await db.execute(`
      SELECT rw.*, 
             ub.tg_id, 
             u.username,
             b.name as bot_name
      FROM referrals_withdraw rw
      JOIN user_bots ub ON rw.userbot_id = ub.id
      JOIN users u ON ub.user_id = u.id
      JOIN bots b ON ub.bot_id = b.id
      ${whereClause}
      ORDER BY rw.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `, queryParams);

    return {
      withdrawals: rows.map(row => new ReferralWithdraw(row)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages
      }
    };
  }

  // обновление статуса вывода
  static async updateStatus(id, status) {
    const db = getConnection();
    const completedAt = status === 'COMPLETED' ? new Date() : null;
    
    const [result] = await db.execute(`
      UPDATE referrals_withdraw 
      SET status = ?, completed_at = ?
      WHERE id = ?
    `, [status, completedAt, id]);

    return result.affectedRows > 0;
  }

      // считаем уже выводенную сумму
  static async getTotalWithdrawn(userBotId) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT COALESCE(SUM(amount_rub), 0) as total_withdrawn
      FROM referrals_withdraw
      WHERE userbot_id = ? AND status IN ('CREATED', 'COMPLETED')
    `, [userBotId]);

    return parseFloat(rows[0].total_withdrawn) || 0;
  }

      // считаем доступный баланс
  static async getAvailableBalance(userBotId) {
    const db = getConnection();
    
    // Получить общую сумму бонусов
    const [bonusRows] = await db.execute(`
      SELECT COALESCE(SUM(bonus_amount), 0) as total_bonuses
      FROM referral_bonuses 
      WHERE referrer_userbot_id = ?
    `, [userBotId]);

    const totalBonuses = parseFloat(bonusRows[0].total_bonuses) || 0;
    
    // Получить сумму выводов
    const totalWithdrawn = await this.getTotalWithdrawn(userBotId);
    
    return Math.max(0, totalBonuses - totalWithdrawn);
  }
}

module.exports = ReferralWithdraw;