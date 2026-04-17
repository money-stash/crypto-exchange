const express = require('express');
const SettingsController = require('../controllers/SettingsController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get(
  '/finance',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SettingsController.getFinanceSettings.bind(SettingsController))
);

router.put(
  '/finance',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  validate(schemas.updateFinanceSettings),
  asyncHandler(SettingsController.updateFinanceSettings.bind(SettingsController))
);

router.get(
  '/chat-quick-replies',
  authenticateToken,
  requireRole(['OPERATOR', 'MANAGER', 'SUPERADMIN']),
  asyncHandler(SettingsController.getChatQuickReplies.bind(SettingsController))
);

router.put(
  '/chat-quick-replies',
  authenticateToken,
  requireRole(['MANAGER', 'SUPERADMIN']),
  validate(schemas.updateChatQuickReplies),
  asyncHandler(SettingsController.updateChatQuickReplies.bind(SettingsController))
);

module.exports = router;

