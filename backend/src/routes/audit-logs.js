const express = require('express');
const router = express.Router();
const AuditLogController = require('../controllers/AuditLogController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get(
  '/',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(AuditLogController.list.bind(AuditLogController))
);

router.get(
  '/download',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(AuditLogController.download.bind(AuditLogController))
);

module.exports = router;
