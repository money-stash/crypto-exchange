const Support = require('../models/Support');
const Order = require('../models/Order');
const { logSystemAction } = require('../utils/logger');
const config = require('../config');

class SupportService {
  /**
   * расчет рейтинга оператора на основе производительности
   * @param {number} supportId
   * @returns {Promise<number>}
   */
  async calculateRating(supportId) {
    const metrics = await Order.getSupportMetrics(supportId);
    const currentSupport = await Support.findById(supportId);
    
    if (!currentSupport) throw new Error('Support not found');

    let rating = 100; // базовый рейтинг

    // штраф за SLA: -2 балла за каждые 5 минут просрочки
    const slaMinutes = config.sla.minutes;
    if (metrics.total_overdue_minutes > 0) {
      const penaltyBlocks = Math.floor(metrics.total_overdue_minutes / 5);
      rating -= penaltyBlocks * 2;
    }

    // бонус за объем: +3 балла за каждые 20 завершенных сделок (макс +30)
    const volumeBonus = Math.min(30, Math.floor(metrics.completed_count / 20) * 3);
    rating += volumeBonus;

    // штраф за жалобы (будет добавлен когда реализуется система жалоб)
    // rating -= metrics.justified_complaints * 10;

    // ограничиваем рейтинг между 50 и 150
    rating = Math.max(50, Math.min(150, rating));

    return rating;
  }

  /**
   * обновление рейтингов всех операторов
   * @returns {Promise<Object>}
   */
  async updateAllRatings() {
    const supports = await Support.getActive();
    const results = [];

    for (const support of supports) {
      try {
        const newRating = await this.calculateRating(support.id);
        await Support.updateRating(support.id, newRating);

        results.push({
          support_id: support.id,
          old_rating: support.rating,
          new_rating: newRating,
        });
      } catch (error) {
        console.error(`Failed to update rating for support ${support.id}:`, error.message);
      }
    }

    await logSystemAction('support_ratings_updated', { 
      updated_count: results.length,
      results 
    });

    return {
      success: true,
      updated_count: results.length,
      results
    };
  }

  /**
   * получение метрик оператора
   * @param {number} supportId
   * @returns {Promise<Object>}
   */
  async getSupportMetrics(supportId) {
    const support = await Support.findById(supportId);
    if (!support) throw new Error('Support not found');

    const metrics = await Order.getSupportMetrics(supportId);
    const currentRating = await this.calculateRating(supportId);

    return {
      support_id: supportId,
      login: support.login,
      current_rating: support.rating,
      calculated_rating: currentRating,
      active_limit: support.active_limit,
      is_active: support.is_active,
      ...metrics
    };
  }

  /**
   * получение всех операторов с их метриками
   * @returns {Promise<Array>}
   */
  async getAllSupportsWithMetrics() {
    const supports = await Support.getActive();
    const results = [];

    for (const support of supports) {
      try {
        const metrics = await this.getSupportMetrics(support.id);
        results.push(metrics);
      } catch (error) {
        console.error(`Failed to get metrics for support ${support.id}:`, error.message);
        results.push({
          support_id: support.id,
          login: support.login,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * обновление лимита активных заявок оператора
   * @param {number} supportId
   * @param {number} limit
   * @returns {Promise<boolean>}
   */
  async updateActiveLimit(supportId, limit) {
    const boundedLimit = Math.max(1, Math.min(8, limit));
    return await Support.updateActiveLimit(supportId, boundedLimit);
  }

  /**
   * переключение активности оператора
   * @param {number} supportId
   * @param {boolean} isActive
   * @returns {Promise<boolean>}
   */
  async toggleActivity(supportId, isActive) {
    return await Support.updateActivity(supportId, isActive);
  }

  /**
   * создание нового аккаунта оператора
   * @param {Object} supportData
   * @returns {Promise<Support>}
   */
  async createSupport(supportData) {
    const existing = await Support.findByLogin(supportData.login);
    if (existing) throw new Error('Support with this login already exists');

    return await Support.create(supportData);
  }
}

module.exports = new SupportService();