const Review = require('../models/Review');
const OrderService = require('../services/OrderService');

class ReviewController {
  // получить список отзывов
  async getReviews(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        rating = null,
        support_id = null,
        order_by = 'created_at',
        order_direction = 'DESC'
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const result = await Review.getAll({
        limit: parseInt(limit),
        offset,
        rating,
        support_id,
        order_by,
        order_direction
      });

      res.json({
        reviews: result.reviews,
        pagination: {
          total: result.total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(result.total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Get reviews error:', error);
      res.status(500).json({ error: 'Ошибка при получении отзывов' });
    }
  }

  // получить отзыв по ID заказа
  async getOrderReview(req, res) {
    try {
      const { orderId } = req.params;
      const review = await OrderService.getOrderReview(orderId);

      if (!review) {
        return res.status(404).json({ error: 'Отзыв не найден' });
      }

      res.json(review);
    } catch (error) {
      console.error('Get order review error:', error);
      res.status(500).json({ error: 'Ошибка при получении отзыва' });
    }
  }

  // обновить отзыв по ID заказа
  async updateOrderReview(req, res) {
    try {
      const { orderId } = req.params;
      const { rating } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Рейтинг должен быть от 1 до 5' });
      }

      const updated = await OrderService.updateOrderReview(orderId, parseInt(rating));

      if (!updated) {
        return res.status(404).json({ error: 'Отзыв не найден' });
      }

      res.json({ message: 'Рейтинг отзыва обновлен' });
    } catch (error) {
      console.error('Update order review error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении отзыва' });
    }
  }

  // получить отзывы для оператора поддержки
  async getSupportReviews(req, res) {
    try {
      const { supportId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const result = await OrderService.getSupportReviews(supportId, {
        limit: parseInt(limit),
        offset
      });

      res.json({
        stats: result.stats,
        reviews: result.reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      console.error('Get support reviews error:', error);
      res.status(500).json({ error: 'Ошибка при получении отзывов оператора' });
    }
  }

  // получить общую статистику по отзывам
  async getPlatformStats(req, res) {
    try {
      const stats = await OrderService.getPlatformReviewStats();
      res.json(stats);
    } catch (error) {
      console.error('Get platform review stats error:', error);
      res.status(500).json({ error: 'Ошибка при получении статистики отзывов' });
    }
  }

  // получить статистику по отзывам оператора
  async getSupportStats(req, res) {
    try {
      const { supportId } = req.params;
      const stats = await Review.getSupportStats(supportId);
      res.json(stats);
    } catch (error) {
      console.error('Get support stats error:', error);
      res.status(500).json({ error: 'Ошибка при получении статистики оператора' });
    }
  }

  // удалить отзыв по ID заказа
  async deleteOrderReview(req, res) {
    try {
      const { orderId } = req.params;
      const deleted = await Review.deleteByOrderId(orderId);

      if (!deleted) {
        return res.status(404).json({ error: 'Отзыв не найден' });
      }

      res.json({ message: 'Отзыв удален' });
    } catch (error) {
      console.error('Delete order review error:', error);
      res.status(500).json({ error: 'Ошибка при удалении отзыва' });
    }
  }
}

module.exports = new ReviewController();