const express = require('express');
const RateController = require('../controllers/RateController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// получение курсов (публично)
router.get('/', 
  asyncHandler(RateController.getRates.bind(RateController))
);

// получение котировок (публично)
router.get('/quotes',
  asyncHandler(RateController.getQuotes.bind(RateController))
);

// обновление курсов (только для администраторов)
router.post('/refresh',
  authenticateToken,
  requireAdmin,
  asyncHandler(RateController.refreshRates.bind(RateController))
);

router.get('/settings',
  authenticateToken,
  requireAdmin,
  asyncHandler(RateController.getSettings.bind(RateController))
);

router.put('/:coin/manual',
  authenticateToken,
  requireAdmin,
  asyncHandler(RateController.updateManualRate.bind(RateController))
);

router.delete('/:coin/manual',
  authenticateToken,
  requireAdmin,
  asyncHandler(RateController.disableManualRate.bind(RateController))
);

module.exports = router;
