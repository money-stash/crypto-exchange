const { getConnection } = require('../config/database');

class UserBot {
  constructor(data) {
    Object.assign(this, data);
  }

  /**
   * поиск связи пользователь-бот по telegram ID и ID бота
   */
  static async findByTgIdAndBotId(tgId, botId) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT ub.*, u.id as base_user_id 
      FROM user_bots ub
      JOIN users u ON u.id = ub.user_id
      WHERE ub.tg_id = ? AND ub.bot_id = ?
    `, [tgId, botId]);
    
    return rows.length ? new UserBot(rows[0]) : null;
  }

  /**
   * создание новой связи пользователь-бот
   */
  static async create(userData) {
    const db = getConnection();
    
    // сначала убеждаемся что базовый пользователь существует
    let baseUser;
    const [existingUsers] = await db.execute('SELECT * FROM users WHERE tg_id = ?', [userData.tg_id]);
    
    if (existingUsers.length > 0) {
      baseUser = existingUsers[0];
    } else {
      // создаем запись базового пользователя - это будет обработано через User.createWithReferral если есть реферальный код
      const [result] = await db.execute(`
        INSERT INTO users (tg_id, username, phone, ref_code, has_ref, discount_v) 
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        userData.tg_id,
        userData.username || null,
        userData.phone || null,
        userData.ref_code || null,
        userData.has_ref || false,
        userData.discount_v || 0
      ]);
      
      baseUser = { id: result.insertId, tg_id: userData.tg_id };
    }

    // создаем связь пользователь-бот
    const [result] = await db.execute(`
      INSERT INTO user_bots (user_id, bot_id, tg_id, username, phone, ref_code, has_ref, discount_v) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      baseUser.id,
      userData.bot_id,
      userData.tg_id,
      userData.username || null,
      userData.phone || null,
      userData.ref_code || null,
      baseUser.has_ref || false, // используем baseUser.has_ref вместо userData.has_ref
      userData.discount_v || 0
    ]);

    return await UserBot.findById(result.insertId);
  }

  /**
   * поиск пользователь-бот по ID
   */
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT ub.*, u.id as base_user_id 
      FROM user_bots ub
      JOIN users u ON u.id = ub.user_id
      WHERE ub.id = ?
    `, [id]);
    
    return rows.length ? new UserBot(rows[0]) : null;
  }

  /**
   * обновление связи пользователь-бот
   */
  static async update(id, updateData) {
    const db = getConnection();
    
    const fields = [];
    const values = [];
    
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    });
    
    values.push(id);
    
    await db.execute(
      `UPDATE user_bots SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    
    return await UserBot.findById(id);
  }

  static isCaptchaColumnMissingError(error) {
    return error?.code === 'ER_BAD_FIELD_ERROR'
      || String(error?.message || '').toLowerCase().includes('unknown column');
  }

  static async markCaptchaPending(id) {
    const db = getConnection();
    try {
      await db.execute(
        'UPDATE user_bots SET captcha_passed = 0, captcha_passed_at = NULL WHERE id = ?',
        [id]
      );
    } catch (error) {
      if (this.isCaptchaColumnMissingError(error)) {
        return;
      }
      throw error;
    }
  }

  static async markCaptchaPassed(id) {
    const db = getConnection();
    try {
      await db.execute(
        'UPDATE user_bots SET captcha_passed = 1, captcha_passed_at = NOW() WHERE id = ?',
        [id]
      );
    } catch (error) {
      if (this.isCaptchaColumnMissingError(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * получение всех связей пользователь-бот для пользователя
   */
  static async findByUserId(userId) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT ub.*, b.name as bot_name, b.identifier as bot_identifier
      FROM user_bots ub
      JOIN bots b ON b.id = ub.bot_id
      WHERE ub.user_id = ?
    `, [userId]);
    
    return rows.map(row => new UserBot(row));
  }

  /**
   * получение всех пользователей конкретного бота
   */
  static async findByBotId(botId) {
    const db = getConnection();
    const [rows] = await db.execute(`
      SELECT ub.*
      FROM user_bots ub
      WHERE ub.bot_id = ?
      ORDER BY ub.created_at DESC
    `, [botId]);
    
    return rows.map(row => new UserBot(row));
  }

  /**
   * Количество активаций для конкретного бота
   */
  static async countByBotId(botId) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT COUNT(*) AS total FROM user_bots WHERE bot_id = ?',
      [botId]
    );
    return Number(rows?.[0]?.total || 0);
  }


  /**
   * генерация уникального реферального кода для пользователь-бот
   * @param {number} userBotId 
   * @param {number} botId 
   * @returns {Promise<string>}
   */
  static async generateReferralCode(userBotId, botId) {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // генерируем код вида REF000123B1 (userBotId + botId)
      const code = `REF${String(userBotId).padStart(6, '0')}B${botId}`;
      
      try {
        const db = getConnection();
        await db.execute(
          'UPDATE user_bots SET referral_code = ? WHERE id = ? AND bot_id = ?',
          [code, userBotId, botId]
        );
        return code;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') { // дубликат записи MySQL
          attempts++;
          continue;
        }
        throw error;
      }
    }

    throw new Error('Failed to generate unique referral code');
  }

  /**
   * поиск пользователь-бот по реферальному коду и боту
   * @param {string} referralCode 
   * @param {number} botId 
   * @returns {Promise<UserBot|null>}
   */
  static async findByReferralCodeAndBot(referralCode, botId) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT ub.*, u.id as base_user_id FROM user_bots ub JOIN users u ON u.id = ub.user_id WHERE ub.referral_code = ? AND ub.bot_id = ?',
      [referralCode, botId]
    );
    return rows.length ? new UserBot(rows[0]) : null;
  }

  /**
   * создание пользователь-бот с реферальной связью
   * @param {Object} userData 
   * @param {string|null} referralCode 
   * @param {number} botId 
   * @returns {Promise<UserBot>}
   */
  static async createWithReferral(userData, referralCode = null, botId) {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');

      let invitedBy = null;
      if (referralCode) {
        const referrer = await this.findByReferralCodeAndBot(referralCode, botId);
        if (referrer) {
          invitedBy = referrer.id; // ID из таблицы user_bots
        }
      }

      // сначала убеждаемся что базовый пользователь существует
      let baseUser;
      const [existingUsers] = await db.execute('SELECT * FROM users WHERE tg_id = ?', [userData.tg_id]);
      
      if (existingUsers.length > 0) {
        baseUser = existingUsers[0];
      } else {
        // создаем запись базового пользователя
        const [result] = await db.execute(`
          INSERT INTO users (tg_id, username, phone, ref_code, has_ref, discount_v) 
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          userData.tg_id,
          userData.username || null,
          userData.phone || null,
          userData.ref_code || null,
          !!invitedBy, // has_ref = true если приглашен кем-то
          userData.discount_v || 0
        ]);
        
        baseUser = { id: result.insertId, tg_id: userData.tg_id };
      }

      // создаем связь пользователь-бот
      const [result] = await db.execute(`
        INSERT INTO user_bots (user_id, bot_id, tg_id, username, phone, ref_code, has_ref, discount_v, invited_by, referral_level) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        baseUser.id,
        botId,
        userData.tg_id,
        userData.username || null,
        userData.phone || null,
        userData.ref_code || null,
        !!invitedBy, // has_ref = true если приглашен кем-то
        userData.discount_v || 0,
        invitedBy,
        'BASIC'
      ]);

      const newUserBot = await this.findById(result.insertId);

      // генерируем реферальный код для нового пользователь-бот
      const newReferralCode = `REF${String(newUserBot.id).padStart(6, '0')}B${botId}`;
      await db.execute(
        'UPDATE user_bots SET referral_code = ? WHERE id = ?',
        [newReferralCode, newUserBot.id]
      );

      await db.query('COMMIT');

      console.log(`UserBot ${newUserBot.id} created for bot ${botId}${invitedBy ? ` with referrer ${invitedBy}` : ''}`);
      
      return { ...newUserBot, referral_code: newReferralCode };
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * получение реферальной статистики для пользователь-бот
   * @param {number} userBotId 
   * @param {number} botId 
   * @returns {Promise<Object>}
   */
  static async getReferralStats(userBotId, botId) {
    try {
      const db = getConnection();
      
      // получаем реферальный код пользователь-бот
      const [userBotRows] = await db.execute(
        'SELECT referral_code FROM user_bots WHERE id = ? AND bot_id = ?',
        [userBotId, botId]
      );
      const referralCode = userBotRows[0]?.referral_code;

      // считаем всех приглашенных пользователь-бот для этого бота
      const [referralsCountRows] = await db.execute(
        'SELECT COUNT(*) as count FROM user_bots WHERE invited_by = ? AND bot_id = ?',
        [userBotId, botId]
      );
      const referralsCount = parseInt(referralsCountRows[0].count) || 0;

      // считаем заявки и сумму от рефералов (только для этого бота)
      const [ordersRows] = await db.execute(`
        SELECT 
          COUNT(o.id) as orders_count,
          COALESCE(SUM(o.sum_rub), 0) as total_sum
        FROM orders o
        JOIN user_bots ub ON o.user_bot_id = ub.id
        WHERE ub.invited_by = ? 
          AND ub.bot_id = ?
          AND o.status = 'COMPLETED'
      `, [userBotId, botId]);

      const referralsOrders = parseInt(ordersRows[0].orders_count) || 0;
      const referralsSum = parseFloat(ordersRows[0].total_sum) || 0;

      // получаем список рефералов с их статистикой
      const [referralsListRows] = await db.execute(`
        SELECT 
          ub.id,
          ub.username,
          ub.created_at,
          COUNT(o.id) as orders_count,
          COALESCE(SUM(o.sum_rub), 0) as total_sum
        FROM user_bots ub
        LEFT JOIN orders o ON ub.id = o.user_bot_id AND o.status = 'COMPLETED'
        WHERE ub.invited_by = ? AND ub.bot_id = ?
        GROUP BY ub.id, ub.username, ub.created_at
        ORDER BY ub.created_at DESC
        LIMIT 10
      `, [userBotId, botId]);

      return {
        referralCode,
        referralsCount,
        referralsOrders,
        referralsSum,
        referrals: referralsListRows
      };
    } catch (error) {
      console.error('Error getting referral stats:', error);
      return {
        referralCode: null,
        referralsCount: 0,
        referralsOrders: 0,
        referralsSum: 0,
        referrals: []
      };
    }
  }
}

module.exports = UserBot;
