const jwt = require('jsonwebtoken');
const config = require('../config');
const Support = require('../models/Support');
const { Bot } = require('../models/Bot');

// проверка jwt токена
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
      code: 'AUTH_TOKEN_REQUIRED'
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // получаем свежие данные пользователя
    const support = await Support.findById(decoded.id);
    if (!support || !support.is_active) {
      return res.status(401).json({
        error: 'Invalid or inactive account',
        code: 'AUTH_ACCOUNT_INACTIVE'
      });
    }

    req.user = {
      id: support.id,
      login: support.login,
      role: support.role,
      manager_id: support.manager_id ? Number(support.manager_id) : null,
      chat_language: support.chat_language || 'RU',
      can_write_chat: Number(support.can_write_chat ?? 1),
      can_cancel_order: Number(support.can_cancel_order ?? 1),
      can_edit_requisites: Number(support.can_edit_requisites ?? 1)
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'AUTH_TOKEN_INVALID'
    });
  }
};

// проверка ролей
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // суперадмин может везде
    if (req.user.role === 'SUPERADMIN') {
      return next();
    }

    // для операторов делаем дополнительную проверку при работе с заявками
    if (req.user.role === 'OPERATOR' && req.baseUrl === '/api/orders' && req.params.id) {
      if (req.route.path === '/:id/take') {
        return next();
      }
      const Order = require('../models/Order');
      // проверяем назначена ли заявка на этого оператора
      Order.findById(req.params.id).then(order => {
        if (order && order.support_id === req.user.id) {
          return next();
        }
        res.status(403).json({ error: 'Insufficient permissions' });
      }).catch(err => {
        res.status(500).json({ error: 'Error checking permissions' });
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// только админ
const requireAdmin = requireRole(['SUPERADMIN']);

// менеджер или админ
const requireManager = requireRole(['MANAGER', 'EX_ADMIN', 'SUPERADMIN']);

// любой авторизованный
const requireAuth = requireRole(['OPERATOR', 'MANAGER', 'EX_ADMIN', 'SUPERADMIN']);

// проверка владельца бота
const checkBotOwnership = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    // суперадмин может менять статус любого бота
    if (role === 'SUPERADMIN') {
      return next();
    }

    // проверяем владельца бота
    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // ex_admin может менять только свои боты
    if (role === 'EX_ADMIN' && bot.owner_id === userId) {
      return next();
    }

    // Менеджер может работать с реквизитами ботов (для отправки реквизитов по заявкам).
    if (role === 'MANAGER' && req.path.includes('/requisites')) {
      return next();
    }

    // оператор может добавлять реквизиты для ботов с активными заявками
    if (role === 'OPERATOR' && req.method === 'POST' && req.path.endsWith('/requisites')) {
      // проверяем есть ли у оператора активные заявки этого бота
      const Order = require('../models/Order');
      const hasActiveOrders = await Order.exists({
        bot_id: id,
        support_id: userId,
        status: 'PAYMENT_PENDING'
      });

      if (hasActiveOrders) {
        return next();
      }
    }

    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch (error) {
    console.error('Error checking bot ownership:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// проверка доступа к данным бота
const checkBotAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    // суперадмин имеет доступ ко всем ботам
    if (role === 'SUPERADMIN') {
      return next();
    }

    const bot = await Bot.findById(id);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // ex_admin имеет доступ только к своим ботам
    if (role === 'EX_ADMIN' && bot.owner_id === userId) {
      return next();
    }

    // менеджер имеет доступ ко всем ботам (только для чтения)
    if (role === 'MANAGER') {
      return next();
    }

    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch (error) {
    console.error('Error checking bot access:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireManager,
  requireAuth,
  checkBotOwnership,
  checkBotAccess
};
