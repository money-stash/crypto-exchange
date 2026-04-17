const { getConnection } = require('../config/database');
const bcrypt = require('bcryptjs');

class Support {
  constructor(data) {
    Object.assign(this, data);
  }


  static async findByLogin(login) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM supports WHERE login = ?',
      [login]
    );
    return rows.length ? new Support(rows[0]) : null;
  }


  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM supports WHERE id = ?',
      [id]
    );
    return rows.length ? new Support(rows[0]) : null;
  }

  async verifyPassword(password) {
    return bcrypt.compare(password, this.pass_hash);
  }


  static async getActive() {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM supports WHERE is_active = 1 ORDER BY rating DESC'
    );
    return rows.map(row => {
      const support = new Support(row);
      delete support.pass_hash; // удаление хэша пароля перед возвратом
      return support;
    });
  }


  static async updateRating(supportId, rating) {
    const db = getConnection();
    const boundedRating = Math.max(50, Math.min(150, rating));
    
    const [result] = await db.execute(
      'UPDATE supports SET rating = ? WHERE id = ?',
      [boundedRating, supportId]
    );
    return result.affectedRows > 0;
  }

  static async updateActiveLimit(supportId, limit) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE supports SET active_limit = ? WHERE id = ?',
      [limit, supportId]
    );
    return result.affectedRows > 0;
  }


  static async findLeastLoaded() {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT s.*, COUNT(o.id) as current_load
       FROM supports s
       LEFT JOIN orders o ON s.id = o.support_id AND o.status = 'PAYMENT_PENDING'
       WHERE s.is_active = 1
       GROUP BY s.id
       HAVING current_load < s.active_limit
       ORDER BY current_load ASC, s.rating DESC
       LIMIT 1`
    );
    
    if (rows.length === 0) return null;
    
    const support = new Support(rows[0]);
    delete support.pass_hash;
    return support;
  }

  static async create(supportData) {
    const db = getConnection();
    const hashedPassword = await bcrypt.hash(supportData.password, 10);
    const normalizedLanguage = String(supportData.chat_language || 'RU').trim().toUpperCase();
    const chatLanguage = ['RU', 'EN'].includes(normalizedLanguage) ? normalizedLanguage : 'RU';
    const canWriteChat = Number(supportData.can_write_chat ?? 1) ? 1 : 0;
    const canCancelOrder = Number(supportData.can_cancel_order ?? 1) ? 1 : 0;
    const canEditRequisites = Number(supportData.can_edit_requisites ?? 1) ? 1 : 0;
    
    const [result] = await db.execute(
      'INSERT INTO supports (login, pass_hash, role, chat_language, can_write_chat, can_cancel_order, can_edit_requisites, active_limit, rate_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        supportData.login,
        hashedPassword,
        supportData.role || 'OPERATOR',
        chatLanguage,
        canWriteChat,
        canCancelOrder,
        canEditRequisites,
        supportData.active_limit || 3,
        Number(supportData.rate_percent || 0)
      ]
    );
    
    return await Support.findById(result.insertId);
  }

  static async findByUserId(userId) {
    return await Support.findById(userId);
  }

  static async findByRole(role) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM supports WHERE role = ? AND is_active = 1',
      [role]
    );
    return rows.map(row => new Support(row));
  }

  static async updateActivity(supportId, isActive) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE supports SET is_active = ? WHERE id = ?',
      [isActive ? 1 : 0, supportId]
    );
    return result.affectedRows > 0;
  }


  static async calculateRating(supportId) {
    const db = getConnection();

    // получаем последние 100 завершенных заказов оператора с рейтингами и данными по времени
    const [orders] = await db.execute(
      `SELECT 
        o.id,
        o.sla_started_at,
        o.sla_requisites_setup_at,
        o.sla_user_paid_at,
        o.completed_at,
        r.user_raiting
       FROM orders o
       LEFT JOIN reviews r ON o.id = r.order_id
       WHERE o.support_id = ? 
         AND o.status = 'COMPLETED'
         AND o.sla_started_at IS NOT NULL
       ORDER BY o.completed_at DESC
       LIMIT 100`,
      [supportId]
    );

    if (orders.length === 0) {
      return {
        overall_rating: 5.0,
        user_rating: 5.0,
        speed_rating: 5.0,
        orders_count: 0,
        details: {
          avg_user_rating: 0,
          avg_setup_time: 0,
          avg_completion_time: 0,
          orders_with_ratings: 0
        }
      };
    }

    // считаем рейтинг
    const ordersWithRatings = orders.filter(order => order.user_raiting);
    let userRatingScore = 5.0; // дефолт рейтинг
    
    if (ordersWithRatings.length > 0) {
      const avgUserRating = ordersWithRatings.reduce((sum, order) => {
        return sum + parseInt(order.user_raiting);
      }, 0) / ordersWithRatings.length;
      
      userRatingScore = avgUserRating; // 
    }

    let speedRatingScore = 5.0;
    let avgSetupTime = 0;
    let avgCompletionTime = 0;
    let validOrders = 0;

    for (const order of orders) {
      if (!order.sla_started_at) continue;
      
      let setupTime = 0;
      if (order.sla_requisites_setup_at) {
        setupTime = (new Date(order.sla_requisites_setup_at) - new Date(order.sla_started_at)) / (1000 * 60); // минуты
      }

      let completionTime = 0;
      if (order.sla_user_paid_at && order.completed_at) {
        completionTime = (new Date(order.completed_at) - new Date(order.sla_user_paid_at)) / (1000 * 60); // минуты
      }

      if (setupTime > 0 || completionTime > 0) {
        avgSetupTime += setupTime;
        avgCompletionTime += completionTime;
        validOrders++;
      }
    }

    if (validOrders > 0) {
      avgSetupTime = avgSetupTime / validOrders;
      avgCompletionTime = avgCompletionTime / validOrders;

      let setupScore = 5.0;
      if (avgSetupTime > 30) setupScore = 1.0;
      else if (avgSetupTime > 20) setupScore = 2.0;
      else if (avgSetupTime > 15) setupScore = 3.0;
      else if (avgSetupTime > 10) setupScore = 4.0;
      else if (avgSetupTime > 5) setupScore = 4.5;

      let completionScore = 5.0;
      if (avgCompletionTime > 15) completionScore = 1.0;
      else if (avgCompletionTime > 10) completionScore = 2.0;
      else if (avgCompletionTime > 7) completionScore = 3.0;
      else if (avgCompletionTime > 5) completionScore = 4.0;
      else if (avgCompletionTime > 2) completionScore = 4.5;

      speedRatingScore = (setupScore + completionScore) / 2;
    }

    const overallRating = (userRatingScore * 0.4) + (speedRatingScore * 0.6);

    return {
      overall_rating: Math.round(overallRating * 100) / 100, 
      user_rating: Math.round(userRatingScore * 100) / 100,
      speed_rating: Math.round(speedRatingScore * 100) / 100,
      orders_count: orders.length,
      details: {
        avg_user_rating: ordersWithRatings.length > 0 ? 
          Math.round((ordersWithRatings.reduce((sum, order) => sum + parseInt(order.user_raiting), 0) / ordersWithRatings.length) * 100) / 100 : 0,
        avg_setup_time: Math.round(avgSetupTime * 100) / 100,
        avg_completion_time: Math.round(avgCompletionTime * 100) / 100,
        orders_with_ratings: ordersWithRatings.length
      }
    };
  }

  
  static async calculateAllOperatorsRatings() {
    const db = getConnection();

    const [operators] = await db.execute(`
      SELECT 
        s.id,
        s.login,
        s.is_active
      FROM supports s
      WHERE s.role = 'OPERATOR' AND s.is_active = 1
    `);

    if (operators.length === 0) {
      return [];
    }

    const operatorIds = operators.map(op => op.id);

    const [ordersData] = await db.execute(
      `SELECT 
        o.support_id,
        o.id as order_id,
        o.sla_started_at,
        o.sla_requisites_setup_at,
        o.sla_user_paid_at,
        o.completed_at,
        r.user_raiting
       FROM orders o
       LEFT JOIN reviews r ON o.id = r.order_id
       WHERE o.support_id IN (${operatorIds.join(',')})
         AND o.status = 'COMPLETED'
         AND o.sla_started_at IS NOT NULL
       ORDER BY o.support_id, o.completed_at DESC`
    );

    const ordersByOperator = {};
    ordersData.forEach(order => {
      if (!ordersByOperator[order.support_id]) {
        ordersByOperator[order.support_id] = [];
      }
      if (ordersByOperator[order.support_id].length < 100) {
        ordersByOperator[order.support_id].push(order);
      }
    });

    const operatorsWithRatings = operators.map(operator => {
      const orders = ordersByOperator[operator.id] || [];
      
      if (orders.length === 0) {
        return {
          id: operator.id,
          login: operator.login,
          rating: {
            overall_rating: 5.0,
            user_rating: 5.0,
            speed_rating: 5.0,
            orders_count: 0,
            details: {
              avg_user_rating: 0,
              avg_setup_time: 0,
              avg_completion_time: 0,
              orders_with_ratings: 0
            }
          }
        };
      }

      const ordersWithRatings = orders.filter(order => order.user_raiting);
      let userRatingScore = 5.0; 
      
      if (ordersWithRatings.length > 0) {
        const avgUserRating = ordersWithRatings.reduce((sum, order) => {
          return sum + parseInt(order.user_raiting);
        }, 0) / ordersWithRatings.length;
        
        userRatingScore = avgUserRating;
      }

      let speedRatingScore = 5.0;
      let avgSetupTime = 0;
      let avgCompletionTime = 0;
      let validOrders = 0;

      for (const order of orders) {
        if (!order.sla_started_at) continue;
        
        let setupTime = 0;
        if (order.sla_requisites_setup_at) {
          setupTime = (new Date(order.sla_requisites_setup_at) - new Date(order.sla_started_at)) / (1000 * 60); // 
        }

        let completionTime = 0;
        if (order.sla_user_paid_at && order.completed_at) {
          completionTime = (new Date(order.completed_at) - new Date(order.sla_user_paid_at)) / (1000 * 60); // 
        }

        if (setupTime > 0 || completionTime > 0) {
          avgSetupTime += setupTime;
          avgCompletionTime += completionTime;
          validOrders++;
        }
      }

      if (validOrders > 0) {
        avgSetupTime = avgSetupTime / validOrders;
        avgCompletionTime = avgCompletionTime / validOrders;

        let setupScore = 5.0;
        if (avgSetupTime > 30) setupScore = 1.0;
        else if (avgSetupTime > 20) setupScore = 2.0;
        else if (avgSetupTime > 15) setupScore = 3.0;
        else if (avgSetupTime > 10) setupScore = 4.0;
        else if (avgSetupTime > 5) setupScore = 4.5;

        let completionScore = 5.0;
        if (avgCompletionTime > 15) completionScore = 1.0;
        else if (avgCompletionTime > 10) completionScore = 2.0;
        else if (avgCompletionTime > 7) completionScore = 3.0;
        else if (avgCompletionTime > 5) completionScore = 4.0;
        else if (avgCompletionTime > 2) completionScore = 4.5;

        speedRatingScore = (setupScore + completionScore) / 2;
      }

      const overallRating = (userRatingScore * 0.4) + (speedRatingScore * 0.6);

      return {
        id: operator.id,
        login: operator.login,
        rating: {
          overall_rating: Math.round(overallRating * 100) / 100,
          user_rating: Math.round(userRatingScore * 100) / 100,
          speed_rating: Math.round(speedRatingScore * 100) / 100,
          orders_count: orders.length,
          details: {
            avg_user_rating: ordersWithRatings.length > 0 ? 
              Math.round((ordersWithRatings.reduce((sum, order) => sum + parseInt(order.user_raiting), 0) / ordersWithRatings.length) * 100) / 100 : 0,
            avg_setup_time: Math.round(avgSetupTime * 100) / 100,
            avg_completion_time: Math.round(avgCompletionTime * 100) / 100,
            orders_with_ratings: ordersWithRatings.length
          }
        }
      };
    });

    return operatorsWithRatings
      .filter(op => op.rating.orders_count > 0)
      .sort((a, b) => {
        if (b.rating.overall_rating !== a.rating.overall_rating) {
          return b.rating.overall_rating - a.rating.overall_rating;
        }
        return b.rating.orders_count - a.rating.orders_count;
      });
  }
}

module.exports = Support;
