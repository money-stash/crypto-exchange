const Support = require('../models/Support');
const Order = require('../models/Order');
const { getConnection } = require('../config/database');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const OperatorDebtService = require('../services/OperatorDebtService');

const normalizeChatLanguage = (value, fallback = 'RU') => {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (normalized === 'RU' || normalized === 'EN') {
    return normalized;
  }
  return null;
};

const normalizePermissionFlag = (value, fallback = 1) => {
  if (value === undefined || value === null) {
    if (fallback === null) return null;
    return Number(fallback) ? 1 : 0;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (value === 1) return 1;
    if (value === 0) return 0;
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return 1;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return 0;
  return null;
};

class SupportController {
  parseSupportId(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  async getMyDebt(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const debt = await OperatorDebtService.getAggregateDebt(req.user.id);
      res.json(debt);
    } catch (error) {
      console.error('Get my debt error:', error);
      res.status(500).json({ error: 'Failed to load debt summary' });
    }
  }

  async createMyDebtIntent(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { requested_usdt } = req.body;
      const intent = await OperatorDebtService.createPaymentIntent(req.user.id, requested_usdt);
      res.status(201).json(intent);
    } catch (error) {
      console.error('Create debt intent error:', error);
      res.status(400).json({ error: error.message || 'Failed to create payment intent' });
    }
  }

  async createMyDebtPayment(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { intent_id, declared_amount_usdt, tx_hash } = req.body;
      const payment = await OperatorDebtService.validateAndCreatePayment(
        req.user.id,
        intent_id,
        tx_hash,
        declared_amount_usdt
      );

      const statusMessage = payment.status === 'CONFIRMED'
        ? 'Payment confirmed and allocated'
        : payment.status === 'PENDING'
          ? 'Payment is pending confirmations'
          : 'Payment rejected';

      res.status(201).json({
        message: statusMessage,
        payment
      });
    } catch (error) {
      console.error('Create debt payment error:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Transaction hash already used' });
      }
      res.status(400).json({ error: error.message || 'Failed to register payment' });
    }
  }

  async getMyDebtIntentStatus(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const intentId = this.parseSupportId(req.params.intentId);
      if (!intentId) {
        return res.status(400).json({ error: 'Invalid intent id' });
      }

      const result = await OperatorDebtService.getIntentStatus(req.user.id, intentId);
      res.json(result);
    } catch (error) {
      console.error('Get my debt intent status error:', error);
      res.status(400).json({ error: error.message || 'Failed to load intent status' });
    }
  }

  async getMyDebtPayments(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const limit = Number(req.query.limit || 50);
      const payments = await OperatorDebtService.getPaymentsHistory(req.user.id, limit);
      res.json(payments);
    } catch (error) {
      console.error('Get debt payments error:', error);
      res.status(500).json({ error: 'Failed to load debt payments' });
    }
  }

  async getSupportDebt(req, res) {
    try {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const supportId = this.parseSupportId(req.params.id);
      if (!supportId) {
        return res.status(400).json({ error: 'Invalid support id' });
      }

      const debt = await OperatorDebtService.getAggregateDebt(supportId);
      res.json(debt);
    } catch (error) {
      console.error('Get support debt error:', error);
      res.status(500).json({ error: 'Failed to load debt summary' });
    }
  }

  async createSupportDebtIntent(req, res) {
    try {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const supportId = this.parseSupportId(req.params.id);
      if (!supportId) {
        return res.status(400).json({ error: 'Invalid support id' });
      }

      const { requested_usdt } = req.body;
      const intent = await OperatorDebtService.createPaymentIntent(supportId, requested_usdt);
      res.status(201).json(intent);
    } catch (error) {
      console.error('Create support debt intent error:', error);
      res.status(400).json({ error: error.message || 'Failed to create payment intent' });
    }
  }

  async getSupportDebtIntentStatus(req, res) {
    try {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const supportId = this.parseSupportId(req.params.id);
      const intentId = this.parseSupportId(req.params.intentId);
      if (!supportId || !intentId) {
        return res.status(400).json({ error: 'Invalid id' });
      }

      const result = await OperatorDebtService.getIntentStatus(supportId, intentId);
      res.json(result);
    } catch (error) {
      console.error('Get support debt intent status error:', error);
      res.status(400).json({ error: error.message || 'Failed to load intent status' });
    }
  }

  async getSupportDebtPayments(req, res) {
    try {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const supportId = this.parseSupportId(req.params.id);
      if (!supportId) {
        return res.status(400).json({ error: 'Invalid support id' });
      }

      const limit = Number(req.query.limit || 50);
      const payments = await OperatorDebtService.getPaymentsHistory(supportId, limit);
      res.json(payments);
    } catch (error) {
      console.error('Get support debt payments error:', error);
      res.status(500).json({ error: 'Failed to load debt payments' });
    }
  }

  async getDebtPaymentsHistory(req, res) {
    try {
      if (!['SUPERADMIN', 'MANAGER'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const limit = Number(req.query.limit || 200);
      const supportId = this.parseSupportId(req.query.support_id);
      const history = await OperatorDebtService.getPaymentsHistory(supportId, limit);
      res.json(history);
    } catch (error) {
      console.error('Get debt payments history error:', error);
      res.status(500).json({ error: 'Failed to load debt payments history' });
    }
  }
  // получение списка операторов
  async writeOffSupportDebt(req, res) {
    try {
      if (req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const supportId = this.parseSupportId(req.params.id);
      if (!supportId) {
        return res.status(400).json({ error: 'Invalid support id' });
      }

      const { requested_usdt } = req.body || {};
      const result = await OperatorDebtService.writeOffDebtBySuperadmin(
        supportId,
        requested_usdt,
        req.user.id
      );

      res.json(result);
    } catch (error) {
      console.error('Write off support debt error:', error);
      res.status(400).json({ error: error.message || 'Failed to write off debt' });
    }
  }
  async getSupports(req, res) {
    try {
      const db = getConnection();
      const {
        search = '',
        status = 'all',
        role = 'all',
        sortBy = 'created_at',
        sortOrder = 'desc',
        page = 1,
        limit = 20
      } = req.query;

      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      const sortFields = {
        'created_at': 's.created_at',
        'name': 's.name',
        'rating': 's.rating',
        'orders_count': 'orders_count',
        'rate_percent': 's.rate_percent'
      };
      const sortField = sortFields[sortBy] || 's.created_at';
      const validSortOrder = ['asc', 'desc'].includes(sortOrder.toLowerCase()) ? sortOrder.toLowerCase() : 'desc';

      let params = [];
      let whereClause = '1=1';

      // фильтр по поиску
      if (search) {
        whereClause += ' AND (s.name LIKE ? OR s.login LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      // фильтр по статусу
      if (status && status !== 'all') {
        if (status === 'active') {
          whereClause += ' AND s.is_active = 1';
        } else if (status === 'offline') {
          whereClause += ' AND s.is_active = 0';
        }
      }

      // фильтр по роли
      if (role && role !== 'all') {
        whereClause += ' AND s.role = ?';
        params.push(role);
      }

      const query = `
        SELECT 
          s.*,
          COALESCE(order_stats.orders_count, 0) as orders_count,
          COALESCE(order_stats.completed_orders, 0) as completed_orders,
          COALESCE(order_stats.cancelled_orders, 0) as cancelled_orders
        FROM supports s
        LEFT JOIN (
          SELECT 
            o.support_id,
            COUNT(o.id) as orders_count,
            COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) as completed_orders,
            COUNT(CASE WHEN o.status = 'CANCELLED' THEN 1 END) as cancelled_orders
          FROM orders o
          WHERE o.support_id IS NOT NULL
          GROUP BY o.support_id
        ) order_stats ON s.id = order_stats.support_id
        WHERE ${whereClause}
        ORDER BY ${sortField} ${validSortOrder.toUpperCase()}
        LIMIT ${limitNum} OFFSET ${offset}
      `;

      const [supports] = await db.execute(query, params);

      const countQuery = `
        SELECT COUNT(DISTINCT s.id) as total
        FROM supports s
        WHERE ${whereClause}
      `;

      const [countResult] = await db.execute(countQuery, params);

      const total = countResult[0].total;


      const sanitizedSupports = [];
      for (const support of supports) {
        const { pass_hash, ...supportData } = support;

        const calculatedRating = await Support.calculateRating(support.id);

        sanitizedSupports.push({
          ...supportData,
          calculated_rating: calculatedRating,
          rating: calculatedRating // для обратной совместимости
        });
      }

      res.json({
        supports: sanitizedSupports,
        total,
        pages: Math.ceil(total / limit),
        currentPage: parseInt(page)
      });
    } catch (error) {
      console.error('Get supports error:', error);
      res.json({
        supports: [],
        total: 0,
        pages: 0,
        currentPage: 1,
        error: 'Ошибка при получении операторов поддержки'
      });
    }
  }

  async getSupportById(req, res) {
    try {
      const { id } = req.params;
      const db = getConnection();

      const query = `
        SELECT 
          s.*,
          COALESCE(order_stats.current_orders, 0) as current_orders,
          COALESCE(order_stats.orders_count, 0) as orders_count,
          COALESCE(order_stats.completed_orders, 0) as completed_orders,
          COALESCE(order_stats.cancelled_orders, 0) as cancelled_orders,
          CASE 
            WHEN s.is_active = 0 THEN 'offline'
            WHEN COALESCE(order_stats.current_orders, 0) >= s.active_limit THEN 'busy'
            ELSE 'active'
          END as status
        FROM supports s
        LEFT JOIN (
          SELECT 
            o.support_id,
            COUNT(CASE WHEN o.status IN ('QUEUED', 'PAYMENT_PENDING', 'AWAITING_CONFIRM', 'AWAITING_HASH') THEN 1 END) as current_orders,
            COUNT(o.id) as orders_count,
            COUNT(CASE WHEN o.status = 'COMPLETED' THEN 1 END) as completed_orders,
            COUNT(CASE WHEN o.status = 'CANCELLED' THEN 1 END) as cancelled_orders
          FROM orders o
          WHERE o.support_id IS NOT NULL
          GROUP BY o.support_id
        ) order_stats ON s.id = order_stats.support_id
        WHERE s.id = ?
      `;

      const [supports] = await db.execute(query, [id]);

      if (supports.length === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      const support = supports[0];
      const { pass_hash, ...supportData } = support;

      const calculatedRating = await Support.calculateRating(support.id);
      supportData.rating = calculatedRating;

      res.json(supportData);
    } catch (error) {
      console.error('Get support by ID error:', error);
      res.status(500).json({ error: 'Ошибка при получении оператора' });
    }
  }

  // создание оператора
  async createSupport(req, res) {
    try {
      const { login, password, role } = req.body;
      const depositPaid = Number(req.body.deposit_paid ?? 0);
      const depositWork = Number(req.body.deposit_work ?? req.body.deposit ?? 0);
      const ratePercent = Number(req.body.rate_percent ?? 0);
      const chatLanguage = normalizeChatLanguage(req.body.chat_language, 'RU');
      const canWriteChat = normalizePermissionFlag(req.body.can_write_chat, 1);
      const canCancelOrder = normalizePermissionFlag(req.body.can_cancel_order, 1);
      const canEditRequisites = normalizePermissionFlag(req.body.can_edit_requisites, 1);
      const db = getConnection();

      if (!login || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
      }

      const [existing] = await db.execute(
        'SELECT id FROM supports WHERE login = ?',
        [login]
      );

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Оператор с таким login уже существует' });
      }

      if (!Number.isFinite(depositPaid) || !Number.isFinite(depositWork) || depositPaid < 0 || depositWork < 0) {
        return res.status(400).json({ error: 'Deposits must be non-negative numbers' });
      }

      if (!Number.isFinite(ratePercent) || ratePercent < -100 || ratePercent > 100) {
        return res.status(400).json({ error: 'Rate percent must be between -100 and 100' });
      }

      if (!chatLanguage) {
        return res.status(400).json({ error: 'chat_language must be RU or EN' });
      }

      if (canWriteChat === null || canCancelOrder === null || canEditRequisites === null) {
        return res.status(400).json({ error: 'Permission flags must be boolean values' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const [result] = await db.execute(
        `INSERT INTO supports (
           login,
           pass_hash,
           role,
            chat_language,
            can_write_chat,
            can_cancel_order,
            can_edit_requisites,
            rating,
            deposit,
            deposit_paid,
           deposit_work,
           rate_percent,
            created_at
         ) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?, NOW())`,
        [
          login,
          hashedPassword,
          role.toUpperCase(),
          chatLanguage,
          canWriteChat,
          canCancelOrder,
          canEditRequisites,
          depositWork,
          depositPaid,
          depositWork,
          ratePercent
        ]
      );

      res.json({
        message: 'Оператор создан',
        id: result.insertId
      });
    } catch (error) {
      console.error('Create support error:', error);
      res.status(500).json({ error: 'Ошибка при создании оператора' });
    }
  }

  // обновление данных оператора
  async updateSupport(req, res) {
    try {
      const { id } = req.params;
      const { login, role, password } = req.body;
      const depositPaid = Number(req.body.deposit_paid ?? 0);
      const depositWork = Number(req.body.deposit_work ?? req.body.deposit ?? 0);
      const hasRatePercent = req.body.rate_percent !== undefined;
      const ratePercent = hasRatePercent ? Number(req.body.rate_percent) : null;
      const hasChatLanguage = req.body.chat_language !== undefined;
      const chatLanguage = hasChatLanguage
        ? normalizeChatLanguage(req.body.chat_language, null)
        : null;
      const hasCanWriteChat = req.body.can_write_chat !== undefined;
      const canWriteChat = hasCanWriteChat
        ? normalizePermissionFlag(req.body.can_write_chat, null)
        : null;
      const hasCanCancelOrder = req.body.can_cancel_order !== undefined;
      const canCancelOrder = hasCanCancelOrder
        ? normalizePermissionFlag(req.body.can_cancel_order, null)
        : null;
      const hasCanEditRequisites = req.body.can_edit_requisites !== undefined;
      const canEditRequisites = hasCanEditRequisites
        ? normalizePermissionFlag(req.body.can_edit_requisites, null)
        : null;
      const db = getConnection();

      if (!login) {
        return res.status(400).json({ error: 'Логин обязателен' });
      }

      const [existing] = await db.execute(
        'SELECT id FROM supports WHERE login = ? AND id != ?',
        [login, id]
      );

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Оператор с таким логином уже существует' });
      }

      if (!Number.isFinite(depositPaid) || !Number.isFinite(depositWork) || depositPaid < 0 || depositWork < 0) {
        return res.status(400).json({ error: 'Deposits must be non-negative numbers' });
      }

      if (hasRatePercent && (!Number.isFinite(ratePercent) || ratePercent < -100 || ratePercent > 100)) {
        return res.status(400).json({ error: 'Rate percent must be between -100 and 100' });
      }

      if (hasChatLanguage && !chatLanguage) {
        return res.status(400).json({ error: 'chat_language must be RU or EN' });
      }

      if (hasCanWriteChat && canWriteChat === null) {
        return res.status(400).json({ error: 'can_write_chat must be boolean' });
      }

      if (hasCanCancelOrder && canCancelOrder === null) {
        return res.status(400).json({ error: 'can_cancel_order must be boolean' });
      }

      if (hasCanEditRequisites && canEditRequisites === null) {
        return res.status(400).json({ error: 'can_edit_requisites must be boolean' });
      }

      let updateQuery = `UPDATE supports SET login = ?, role = ?, deposit = ?, deposit_paid = ?, deposit_work = ?`;
      let updateParams = [login, role.toUpperCase(), depositWork, depositPaid, depositWork];

      if (hasRatePercent) {
        updateQuery += `, rate_percent = ?`;
        updateParams.push(ratePercent);
      }

      if (hasChatLanguage) {
        updateQuery += `, chat_language = ?`;
        updateParams.push(chatLanguage);
      }

      if (hasCanWriteChat) {
        updateQuery += `, can_write_chat = ?`;
        updateParams.push(canWriteChat);
      }

      if (hasCanCancelOrder) {
        updateQuery += `, can_cancel_order = ?`;
        updateParams.push(canCancelOrder);
      }

      if (hasCanEditRequisites) {
        updateQuery += `, can_edit_requisites = ?`;
        updateParams.push(canEditRequisites);
      }

      if (password && password.trim()) {
        if (password.length < 6) {
          return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        updateQuery += `, pass_hash = ?`;
        updateParams.push(hashedPassword);
      }

      updateQuery += ` WHERE id = ?`;
      updateParams.push(id);

      const [result] = await db.execute(updateQuery, updateParams);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      const message = password && password.trim()
        ? 'Данные оператора и пароль обновлены'
        : 'Данные оператора обновлены';

      res.json({ message });
    } catch (error) {
      console.error('Update support error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении данных оператора' });
    }
  }

  // обновление статуса оператора
  async updateSupportStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const db = getConnection();

      let isActive;
      if (status === 'offline') {
        isActive = 0;
      } else {
        isActive = 1;
      }

      const [result] = await db.execute(
        'UPDATE supports SET is_active = ? WHERE id = ?',
        [isActive, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      res.json({ message: 'Статус обновлен' });
    } catch (error) {
      console.error('Update support status error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении статуса' });
    }
  }

  // обновление максимального количества заказов
  async updateMaxOrders(req, res) {
    try {
      const { id } = req.params;
      const { maxOrders } = req.body;
      const db = getConnection();

      if (maxOrders < 1 || maxOrders > 50) {
        return res.status(400).json({ error: 'Максимум заказов должен быть от 1 до 50' });
      }

      const [result] = await db.execute(
        'UPDATE supports SET active_limit = ? WHERE id = ?',
        [maxOrders, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      res.json({ message: 'Лимит заказов обновлен' });
    } catch (error) {
      console.error('Update support max orders error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении лимита заказов' });
    }
  }

  // обновление депозита оператора
  async updateDeposit(req, res) {
    try {
      const { id } = req.params;
      const { deposit_paid, deposit_work, deposit } = req.body;
      const db = getConnection();

      const hasDepositPaid = deposit_paid !== undefined;
      const hasDepositWork = deposit_work !== undefined || deposit !== undefined;

      if (!hasDepositPaid && !hasDepositWork) {
        return res.status(400).json({ error: 'Provide deposit_paid or deposit_work' });
      }

      const updateFields = [];
      const updateParams = [];

      if (hasDepositPaid) {
        const depositPaid = Number(deposit_paid);
        if (!Number.isFinite(depositPaid) || depositPaid < 0) {
          return res.status(400).json({ error: 'Deposit paid must be a non-negative number' });
        }
        updateFields.push('deposit_paid = ?');
        updateParams.push(depositPaid);
      }

      if (hasDepositWork) {
        const depositWork = Number(deposit_work ?? deposit);
        if (!Number.isFinite(depositWork) || depositWork < 0) {
          return res.status(400).json({ error: 'Deposit work must be a non-negative number' });
        }
        updateFields.push('deposit_work = ?');
        updateParams.push(depositWork);
        updateFields.push('deposit = ?');
        updateParams.push(depositWork);
      }

      const [result] = await db.execute(
        `UPDATE supports SET ${updateFields.join(', ')} WHERE id = ?`,
        [...updateParams, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      res.json({ message: 'Deposits updated' });
    } catch (error) {
      console.error('Update support deposit error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении депозита' });
    }
  }

  // расчет статистики операторов
  async calculateSupportStats() {
    try {
      const db = getConnection();

      const [statsResult] = await db.execute(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_count,
          COUNT(CASE WHEN is_active = 0 THEN 1 END) as offline_count,
          AVG(rating) as avg_rating
        FROM supports
      `);

      const [busyResult] = await db.execute(`
        SELECT COUNT(DISTINCT s.id) as busy_count
        FROM supports s
        LEFT JOIN (
          SELECT 
            o.support_id,
            COUNT(CASE WHEN o.status IN ('QUEUED', 'PAYMENT_PENDING', 'AWAITING_CONFIRM', 'AWAITING_HASH') THEN 1 END) as current_orders
          FROM orders o
          WHERE o.support_id IS NOT NULL
          GROUP BY o.support_id
        ) order_stats ON s.id = order_stats.support_id
        WHERE s.is_active = 1 AND COALESCE(order_stats.current_orders, 0) >= s.active_limit
      `);

      const [ordersResult] = await db.execute(`
        SELECT COUNT(*) as total_orders
        FROM orders o
        WHERE o.support_id IS NOT NULL
      `);

      const stats = statsResult[0];
      const busy = busyResult[0];
      const orders = ordersResult[0];

      return {
        total: stats.total,
        active: stats.active_count - busy.busy_count,
        busy: busy.busy_count,
        offline: stats.offline_count,
        avgRating: stats.avg_rating || 0,
        totalOrders: orders.total_orders
      };
    } catch (error) {
      console.error('Calculate support stats error:', error);
      return {
        total: 0,
        active: 0,
        busy: 0,
        offline: 0,
        avgRating: 0,
        totalOrders: 0
      };
    }
  }

  // получение учетных данных оператора
  async getCredentials(req, res) {
    try {
      const { id } = req.params;
      const db = getConnection();

      const [supports] = await db.execute(
        'SELECT login, role FROM supports WHERE id = ?',
        [id]
      );

      if (supports.length === 0) {
        return res.status(404).json({ error: 'Оператор не найден' });
      }

      const support = supports[0];

      res.json({
        login: support.login,
        password: '**скрыт**',
        role: support.role
      });
    } catch (error) {
      console.error('Get support credentials error:', error);
      res.status(500).json({ error: 'Ошибка при получении данных оператора' });
    }
  }

  getSortField(sortBy) {
    const sortFields = {
      'created_at': 's.created_at',
      'name': 's.name',
      'rating': 's.rating',
      'orders_count': 'orders_count',
      'rate_percent': 's.rate_percent'
    };
    return sortFields[sortBy] || 's.created_at';
  }

  async getOperatorsRating(req, res) {
    try {
      const db = getConnection();
      const userId = req.user.id;
      const userRole = req.user.role;

      const operatorsWithRating = await Support.calculateAllOperatorsRatings();

      const topOperators = operatorsWithRating.slice(0, 10).map(op => ({
        id: op.id,
        username: op.login,
        login: op.login,
        rating: op.rating
      }));

      let currentOperatorData = null;

      if (userRole === 'OPERATOR') {
        const operatorIndex = operatorsWithRating.findIndex(op => op.id === userId);

        if (operatorIndex !== -1) {
          const currentOperator = operatorsWithRating[operatorIndex];
          currentOperatorData = {
            id: currentOperator.id,
            username: currentOperator.login,
            rating: currentOperator.rating,
            position: operatorIndex + 1 
          };
        } else {
          const rating = await Support.calculateRating(userId);
          const [operatorInfo] = await db.query(
            'SELECT id, login FROM supports WHERE id = ?',
            [userId]
          );

          if (operatorInfo.length > 0) {
            currentOperatorData = {
              id: operatorInfo[0].id,
              username: operatorInfo[0].login,
              rating: rating,
              position: null
            };
          }
        }
      }

      res.json({
        top: topOperators,
        current: currentOperatorData
      });

    } catch (error) {
      console.error('Error getting operators rating:', error);
      res.status(500).json({ error: 'Ошибка при получении рейтинга операторов' });
    }
  }
}

module.exports = new SupportController();
