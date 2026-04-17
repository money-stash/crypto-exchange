const { getConnection } = require('../config/database');

class Review {

  static async create(orderId) {
    const db = getConnection();

    const [result] = await db.execute(
      `INSERT INTO reviews (order_id, created_at) VALUES (?,  NOW())`,
      [orderId]
    );

    return result.insertId;
  }

  /**
   * Поиск отзыва по ID заказа
   * @param {number} orderId
   * @returns {Promise<Object|null>}
   */
  static async findByOrderId(orderId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT * FROM reviews WHERE order_id = ?`,
      [orderId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Обвноление рейтинга отзыва по ID заказа
   * @param {number} orderId
   * @param {number} rating
   * @returns {Promise<boolean>}
   */
  static async updateRating(orderId, rating) {
    const db = getConnection();
    
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const [result] = await db.execute(
      `UPDATE reviews SET user_raiting = ? WHERE order_id = ?`,
      [rating.toString(), orderId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Обновление комментария отзыва по ID заказа
   * @param {number} orderId
   * @param {string} comment
   * @returns {Promise<boolean>}
   */
  static async updateComment(orderId, comment) {
    const db = getConnection();

    const [result] = await db.execute(
      `UPDATE reviews SET comment = ? WHERE order_id = ?`,
      [comment, orderId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Обновление telegram_message_id отзыва по ID заказа
   * @param {number} orderId
   * @param {number} telegramMessageId
   * @returns {Promise<boolean>}
   */
  static async updateTelegramMessageId(orderId, telegramMessageId) {
    const db = getConnection();

    const [result] = await db.execute(
      `UPDATE reviews SET telegram_message_id = ? WHERE order_id = ?`,
      [telegramMessageId, orderId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Получение статистики по отзывам для конкретного оператора
   * @param {number} supportId
   * @returns {Promise<Object>}
   */
  static async getSupportStats(supportId) {
    const db = getConnection();
    
    const [rows] = await db.execute(
      `SELECT 
        COUNT(r.id) as total_reviews,
        AVG(CAST(r.user_raiting AS UNSIGNED)) as average_rating,
        COUNT(CASE WHEN r.user_raiting = '5' THEN 1 END) as rating_5,
        COUNT(CASE WHEN r.user_raiting = '4' THEN 1 END) as rating_4,
        COUNT(CASE WHEN r.user_raiting = '3' THEN 1 END) as rating_3,
        COUNT(CASE WHEN r.user_raiting = '2' THEN 1 END) as rating_2,
        COUNT(CASE WHEN r.user_raiting = '1' THEN 1 END) as rating_1
       FROM reviews r
       JOIN orders o ON r.order_id = o.id
       WHERE o.support_id = ?`,
      [supportId]
    );

    const stats = rows[0];
    return {
      total_reviews: stats.total_reviews || 0,
      average_rating: parseFloat(stats.average_rating) || 0,
      rating_distribution: {
        5: stats.rating_5 || 0,
        4: stats.rating_4 || 0,
        3: stats.rating_3 || 0,
        2: stats.rating_2 || 0,
        1: stats.rating_1 || 0
      }
    };
  }

  /**
   * Получение всех отзывов для конкретного оператора с пагинацией
   * @param {number} supportId
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  static async getSupportReviews(supportId, options = {}) {
    const db = getConnection();
    const { limit = 10, offset = 0 } = options;

    const [rows] = await db.execute(
      `SELECT 
        r.*,
        o.id as order_id,
        o.sum_rub,
        o.coin,
        o.dir,
        o.completed_at,
        u.username
       FROM reviews r
       JOIN orders o ON r.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.support_id = ?
       ORDER BY r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [supportId]
    );

    return rows;
  }

  /**
   * Получение всех отзывов с возможностью фильтрации и пагинации
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  static async getAll(options = {}) {
    const db = getConnection();
    const { 
      limit = 20, 
      offset = 0, 
      rating = null, 
      support_id = null,
      order_by = 'created_at',
      order_direction = 'DESC'
    } = options;

    let whereClause = '1=1';
    let params = [];

    if (rating) {
      whereClause += ' AND r.user_raiting = ?';
      params.push(rating.toString());
    }

    if (support_id) {
      whereClause += ' AND o.support_id = ?';
      params.push(support_id);
    }

    const [rows] = await db.execute(
      `SELECT 
        r.*,
        o.id as order_id,
        o.sum_rub,
        o.coin,
        o.dir,
        o.completed_at,
        o.support_id,
        u.username,
        s.login as support_login
       FROM reviews r
       JOIN orders o ON r.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN supports s ON o.support_id = s.id
       WHERE ${whereClause}
       ORDER BY r.${order_by} ${order_direction}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total
       FROM reviews r
       JOIN orders o ON r.order_id = o.id
       WHERE ${whereClause}`,
      params
    );

    return {
      reviews: rows,
      total: countRows[0].total,
      limit,
      offset
    };
  }

 
  static async getPlatformStats() {
    const db = getConnection();
    
    const [rows] = await db.execute(
      `SELECT 
        COUNT(r.id) as total_reviews,
        AVG(CAST(r.user_raiting AS UNSIGNED)) as average_rating,
        COUNT(CASE WHEN r.user_raiting = '5' THEN 1 END) as rating_5,
        COUNT(CASE WHEN r.user_raiting = '4' THEN 1 END) as rating_4,
        COUNT(CASE WHEN r.user_raiting = '3' THEN 1 END) as rating_3,
        COUNT(CASE WHEN r.user_raiting = '2' THEN 1 END) as rating_2,
        COUNT(CASE WHEN r.user_raiting = '1' THEN 1 END) as rating_1
       FROM reviews r`
    );

    const stats = rows[0];
    return {
      total_reviews: stats.total_reviews || 0,
      average_rating: parseFloat(stats.average_rating) || 0,
      rating_distribution: {
        5: stats.rating_5 || 0,
        4: stats.rating_4 || 0,
        3: stats.rating_3 || 0,
        2: stats.rating_2 || 0,
        1: stats.rating_1 || 0
      }
    };
  }


  static async deleteByOrderId(orderId) {
    const db = getConnection();
    const [result] = await db.execute(
      `DELETE FROM reviews WHERE order_id = ?`,
      [orderId]
    );

    return result.affectedRows > 0;
  }

  static async existsForOrder(orderId) {
    const review = await this.findByOrderId(orderId);
    return review !== null;
  }
}

module.exports = Review;