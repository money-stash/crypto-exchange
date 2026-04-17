const UserBot = require('../models/UserBot');
const ReferralBonus = require('../models/ReferralBonus');
const { getConnection } = require('../config/database');

class ReferralService {
  static REFERRAL_LEVELS = {
    BASIC: { name: 'Базовый', percentage: 0, minOrders: 0, minSum: 0 },
    ADVANCED: { name: 'Продвинутый', percentage: 0.015, minOrders: 100, minSum: 250000 },
    ADVANCED_PLUS: { name: 'Продвинутый+', percentage: 0.02, minOrders: 250, minSum: 650000 },
    VIP: { name: 'VIP', percentage: 0.025, minOrders: 350, minSum: 1000000 },
    VIP_PLUS: { name: 'VIP+', percentage: 0.03, minOrders: 500, minSum: 1500000 }
  };

  /**
   * обновление реферального уровня на основе статистики рефералов
   * @param {number} userBotId 
   * @param {number} botId 
   * @returns {Promise<string>}
   */
  static async updateReferralLevel(userBotId, botId) {
    try {
      // получаем статистику рефералов
      const stats = await UserBot.getReferralStats(userBotId, botId);
      
      const referralsCount = parseInt(stats.referralsOrders) || 0; // количество реферальных ЗАЯВОК
      const referralsSum = parseFloat(stats.referralsSum) || 0;
      
      let newLevel = 'BASIC';
      
      // определяем уровень на основе статистики
      for (const [level, config] of Object.entries(this.REFERRAL_LEVELS).reverse()) {
        if (referralsCount >= config.minOrders && referralsSum >= config.minSum) {
          newLevel = level;
          break;
        }
      }
      
      // обновляем уровень в базе
      const db = getConnection();
      await db.execute(
        'UPDATE user_bots SET referral_level = ? WHERE id = ? AND bot_id = ?',
        [newLevel, userBotId, botId]
      );
      
      console.log(`UserBot ${userBotId} referral level updated to ${newLevel}`);
      return newLevel;
      
    } catch (error) {
      console.error('Error updating referral level:', error);
      return 'BASIC';
    }
  }

  /**
   * обработка реферального бонуса при завершении заявки
   * @param {number} orderId 
   * @param {number} orderSum 
   * @param {number} referredUserBotId 
   * @param {number} botId 
   * @returns {Promise<Object|null>}
   */
  static async processReferralBonus(orderId, orderSum, referredUserBotId, botId) {
    try {
      // находим реферера
      const referredUserBot = await UserBot.findById(referredUserBotId);
      if (!referredUserBot || !referredUserBot.invited_by) {
        console.log(`UserBot ${referredUserBotId} has no referrer`);
        return null; // нет реферера
      }

      const referrerUserBotId = referredUserBot.invited_by;
      const referrerUserBot = await UserBot.findById(referrerUserBotId);
      
      if (!referrerUserBot) {
        console.log(`Referrer UserBot ${referrerUserBotId} not found`);
        return null;
      }

      // обновляем уровень реферера
      const currentLevel = await this.updateReferralLevel(referrerUserBotId, botId);
      
      // получаем процент для текущего уровня
      const levelConfig = this.REFERRAL_LEVELS[currentLevel];
      const bonusPercentage = levelConfig ? levelConfig.percentage : 0;
      
      // рассчитываем сумму бонуса
      const bonusAmount = orderSum * bonusPercentage;
      
      // создаем запись о бонусе
      const bonus = await ReferralBonus.create({
        referrerUserBotId: referrerUserBotId,
        referredUserBotId: referredUserBotId,
        orderId: orderId,
        botId: botId,
        bonusAmount: bonusAmount,
        bonusPercentage: bonusPercentage,
        referrerLevel: currentLevel
      });

      // обновляем баланс бонусов реферера
      const db = getConnection();
      await db.execute(
        'UPDATE user_bots SET referral_bonus_balance = referral_bonus_balance + ? WHERE id = ? AND bot_id = ?',
        [bonusAmount, referrerUserBotId, botId]
      );

      console.log(`Referral bonus processed: UserBot ${referrerUserBotId} earned ${bonusAmount} RUB (${bonusPercentage * 100}%) from order ${orderId}`);
      
      return bonus;
      
    } catch (error) {
      console.error('Error processing referral bonus:', error);
      return null;
    }
  }

  /**
   * получение информации о реферальном уровне
   * @param {string} level 
   * @returns {Object}
   */
  static getReferralLevelInfo(level) {
    return this.REFERRAL_LEVELS[level] || this.REFERRAL_LEVELS.BASIC;
  }

  /**
   * получение требований для следующего уровня
   * @param {string} currentLevel 
   * @param {number} referralsCount 
   * @param {number} referralsSum 
   * @returns {Object|null}
   */
  static getNextLevelRequirements(currentLevel, referralsCount, referralsSum) {
    const levels = Object.keys(this.REFERRAL_LEVELS);
    const currentIndex = levels.indexOf(currentLevel);
    
    if (currentIndex === -1 || currentIndex === levels.length - 1) {
      return null; // максимальный уровень или неизвестный уровень
    }
    
    const nextLevel = levels[currentIndex + 1];
    const nextConfig = this.REFERRAL_LEVELS[nextLevel];
    
    return {
      level: nextLevel,
      name: nextConfig.name,
      percentage: nextConfig.percentage,
      ordersNeeded: Math.max(0, nextConfig.minOrders - referralsCount),
      sumNeeded: Math.max(0, nextConfig.minSum - referralsSum)
    };
  }

  /**
   * генерация реферальной статистики для админпанели
   * @param {number|null} botId 
   * @returns {Promise<Object>}
   */
  static async getGlobalStats(botId = null) {
    try {
      const db = getConnection();
      
      // общее количество рефереров и рефералов для конкретного бота
      let usersQuery = `
        SELECT 
          COUNT(CASE WHEN invited_by IS NOT NULL THEN 1 END) as total_referrals,
          COUNT(CASE WHEN invited_by IS NULL THEN 1 END) as total_referrers
        FROM user_bots
      `;
      
      const params = [];
      if (botId) {
        usersQuery += ' WHERE bot_id = ?';
        params.push(botId);
      }
      
      const [usersRows] = await db.execute(usersQuery, params);
      
      // статистика бонусов
      let bonusQuery = `
        SELECT 
          COUNT(*) as total_bonuses,
          COALESCE(SUM(bonus_amount), 0) as total_bonus_amount,
          COUNT(DISTINCT referrer_userbot_id) as active_referrers
        FROM referral_bonuses
      `;
      
      const bonusParams = [];
      if (botId) {
        bonusQuery += ' WHERE bot_id = ?';
        bonusParams.push(botId);
      }
      
      const [bonusRows] = await db.execute(bonusQuery, bonusParams);
      
      // распределение по уровням
      let levelQuery = `
        SELECT referral_level, COUNT(*) as count
        FROM user_bots 
        WHERE referral_level IS NOT NULL
      `;
      
      if (botId) {
        levelQuery += ' AND bot_id = ?';
      }
      
      levelQuery += ' GROUP BY referral_level';
      
      const [levelRows] = await db.execute(levelQuery, botId ? [botId] : []);
      
      return {
        total_referrals: parseInt(usersRows[0].total_referrals) || 0,
        total_referrers: parseInt(usersRows[0].total_referrers) || 0,
        total_bonuses: parseInt(bonusRows[0].total_bonuses) || 0,
        total_bonus_amount: parseFloat(bonusRows[0].total_bonus_amount) || 0,
        active_referrers: parseInt(bonusRows[0].active_referrers) || 0,
        level_distribution: levelRows
      };
    } catch (error) {
      console.error('Error getting global referral stats:', error);
      return {
        total_referrals: 0,
        total_referrers: 0,
        total_bonuses: 0,
        total_bonus_amount: 0,
        active_referrers: 0,
        level_distribution: []
      };
    }
  }
}

module.exports = ReferralService;
