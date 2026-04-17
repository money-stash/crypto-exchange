const jwt = require('jsonwebtoken');
const Support = require('../models/Support');
const config = require('../config');
const { logSupportAction } = require('../utils/logger');

class AuthController {
  // логин пользователя
  async login(req, res) {
    const { login, password } = req.body;

    const support = await Support.findByLogin(login);
    if (!support || !support.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await support.verifyPassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: support.id,
        login: support.login,
        role: support.role
      },
      config.jwt.secret
    );

    await logSupportAction(support.id, 'login', { login });

    res.json({
      token,
      user: {
        id: support.id,
        login: support.login,
        role: support.role,
        manager_id: support.manager_id ? Number(support.manager_id) : null,
        chat_language: support.chat_language || 'RU',
        can_write_chat: Number(support.can_write_chat ?? 1),
        can_cancel_order: Number(support.can_cancel_order ?? 1),
        can_edit_requisites: Number(support.can_edit_requisites ?? 1),
        rating: support.rating,
        active_limit: support.active_limit
      }
    });
  }

  // получить информацию о текущем пользователе
  async me(req, res) {
    const support = await Support.findById(req.user.id);
    if (!support) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: support.id,
      login: support.login,
      role: support.role,
      manager_id: support.manager_id ? Number(support.manager_id) : null,
      chat_language: support.chat_language || 'RU',
      can_write_chat: Number(support.can_write_chat ?? 1),
      can_cancel_order: Number(support.can_cancel_order ?? 1),
      can_edit_requisites: Number(support.can_edit_requisites ?? 1),
      rating: support.rating,
      active_limit: support.active_limit,
      is_active: support.is_active
    });
  }

  //обновить токен
  async refresh(req, res) {
    const support = await Support.findById(req.user.id);
    if (!support || !support.is_active) {
      return res.status(401).json({ error: 'Account not active' });
    }

    const token = jwt.sign(
      {
        id: support.id,
        login: support.login,
        role: support.role
      },
      config.jwt.secret
    );

    res.json({ token });
  }
}

module.exports = new AuthController();
