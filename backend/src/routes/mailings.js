const express = require('express');
const router = express.Router();
const MailingController = require('../controllers/MailingController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken, requireRole } = require('../middleware/auth');

// рассылки
router.get('/', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  validate(schemas.pagination, 'query'),
  MailingController.getMailings
);

// получить статистику рассылок
router.get('/stats', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  MailingController.getStatistics
);

// получить активные рассылки
router.get('/active', 
  authenticateToken,
  requireRole(['SUPERADMIN']), // Only system can access this
  MailingController.getActiveMailings
);

// создание розыгрышной рассылки по списку @username/tg_id
router.post('/raffle',
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']),
  validate(schemas.createRaffleMailing),
  MailingController.createRaffleMailing
);

// получить рассылку по ID
router.get('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  MailingController.getMailing
);

// создание рассылки
router.post('/', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  validate(schemas.createMailing),
  MailingController.createMailing
);

// отмена рассылки
router.patch('/:id/cancel', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  MailingController.cancelMailing
);

// обновление количества отправленных писем
router.patch('/:id/send-count', 
  authenticateToken,
  requireRole(['SUPERADMIN']), // Only system can access this
  MailingController.updateSendCount
);

// удаление рассылки
router.delete('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  MailingController.deleteMailing
);

module.exports = router;
