const express = require('express');
const router = express.Router();
const SupportController = require('../controllers/SupportController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/me/debt',
  authenticateToken,
  requireRole(['OPERATOR']),
  asyncHandler(SupportController.getMyDebt.bind(SupportController))
);

router.post('/me/debt/intents',
  authenticateToken,
  requireRole(['OPERATOR']),
  validate(schemas.createDebtIntent),
  asyncHandler(SupportController.createMyDebtIntent.bind(SupportController))
);

router.get('/me/debt/intents/:intentId',
  authenticateToken,
  requireRole(['OPERATOR']),
  asyncHandler(SupportController.getMyDebtIntentStatus.bind(SupportController))
);

router.post('/me/debt/payments',
  authenticateToken,
  requireRole(['OPERATOR']),
  validate(schemas.createDebtPayment),
  asyncHandler(SupportController.createMyDebtPayment.bind(SupportController))
);

router.get('/me/debt/payments',
  authenticateToken,
  requireRole(['OPERATOR']),
  asyncHandler(SupportController.getMyDebtPayments.bind(SupportController))
);

router.get('/debt/payments/history',
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']),
  asyncHandler(SupportController.getDebtPaymentsHistory.bind(SupportController))
);

router.get('/:id/debt',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SupportController.getSupportDebt.bind(SupportController))
);

router.post('/:id/debt/write-off',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  validate(schemas.writeOffDebt),
  asyncHandler(SupportController.writeOffSupportDebt.bind(SupportController))
);

router.post('/:id/debt/intents',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  validate(schemas.createDebtIntent),
  asyncHandler(SupportController.createSupportDebtIntent.bind(SupportController))
);

router.get('/:id/debt/intents/:intentId',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SupportController.getSupportDebtIntentStatus.bind(SupportController))
);

router.get('/:id/debt/payments',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SupportController.getSupportDebtPayments.bind(SupportController))
);

// получение топа операторов по рейтингу
router.get('/rating/top',
  authenticateToken,
  asyncHandler(SupportController.getOperatorsRating)
);

// получение учетных данных оператора по ID (только для SUPERADMIN)
router.get('/:id/credentials',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SupportController.getCredentials)
);

// получение всех операторов
router.get('/', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']), 
  SupportController.getSupports
);

// получение оператора по ID
router.get('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']), 
  SupportController.getSupportById
);

// создание оператора
router.post('/', 
  authenticateToken,
  requireRole(['SUPERADMIN']), 
  SupportController.createSupport
);

// обновление оператора
router.put('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN']), 
  SupportController.updateSupport
);

// обновление статуса оператора
router.patch('/:id/status', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']), 
  SupportController.updateSupportStatus
);

// обновление максимального количества заказов оператора
router.patch('/:id/max-orders', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']), 
  SupportController.updateMaxOrders
);

// обновление депозита оператора
router.patch('/:id/deposit', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'MANAGER']), 
  SupportController.updateDeposit
);

module.exports = router;
