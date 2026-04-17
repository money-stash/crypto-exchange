const express = require('express');
const router = express.Router();
const BotController = require('../controllers/BotController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken, requireRole, checkBotOwnership, checkBotAccess } = require('../middleware/auth');


// все боты
router.get('/', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER']), 
  validate(schemas.pagination, 'query'),
  BotController.getBots
);

router.get('/simple', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER']), 
  BotController.getSimpleBots
);
// конкретный бот по ID
router.get('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER']), 
  BotController.getBot
);

// создание бота
router.post('/', 
  authenticateToken,
  requireRole(['SUPERADMIN','EX_ADMIN']), 
  validate(schemas.createBot),
  BotController.createBot
);

// обновление бота
router.put('/:id', 
  authenticateToken,
  checkBotOwnership, 
  validate(schemas.updateBot),
  BotController.updateBot
);

// статус бота (вкл/выкл)
router.patch('/:id/toggle', 
  authenticateToken,
  checkBotOwnership, 
  BotController.toggleBotStatus
);

// удаление бота
router.delete('/:id', 
  authenticateToken,
  checkBotOwnership, 
  BotController.deleteBot
);

// стата бота
router.get('/:id/stats', 
  authenticateToken,
  checkBotOwnership, 
  BotController.getBotStatistics
);

// Bot requisites management
router.post('/:id/requisites', 
  authenticateToken,
  checkBotOwnership, 
  validate(schemas.createBotRequisite),
  BotController.createBotRequisite
);

router.put('/:id/requisites/:requisiteId', 
  authenticateToken,
  checkBotOwnership, 
  validate(schemas.updateBotRequisite),
  BotController.updateBotRequisite
);

router.delete('/:id/requisites/:requisiteId', 
  authenticateToken,
  checkBotOwnership, 
  BotController.deleteBotRequisite
);

router.post('/:id/start', 
  authenticateToken,
  checkBotOwnership, 
  BotController.startBot
);

router.post('/:id/stop', 
  authenticateToken,
  checkBotOwnership, 
  BotController.stopBot
);

router.post('/:id/restart', 
  authenticateToken,
  checkBotOwnership, 
  BotController.restartBot
);

router.get('/:id/status', 
  authenticateToken,
  checkBotOwnership, 
  BotController.getBotStatus
);


router.get('/:id/fees', 
  authenticateToken,
  checkBotOwnership, 
  BotController.getBotFees
);

router.put('/:id/fees', 
  authenticateToken,
  checkBotOwnership, 
  BotController.updateBotFees
);

router.get('/:id/fee-tiers', 
  authenticateToken,
  checkBotOwnership, 
  BotController.getBotFeeTiers
);

router.post('/:id/fee-tiers', 
  authenticateToken,
  checkBotOwnership, 
  BotController.createOrUpdateFeeTier
);

router.put('/:id/fee-tiers/bulk', 
  authenticateToken,
  checkBotOwnership, 
  BotController.bulkUpdateFeeTiers
);

router.put('/:id/fee-tiers/:tierId', 
  authenticateToken,
  checkBotOwnership, 
  BotController.createOrUpdateFeeTier
);

router.delete('/:id/fee-tiers/:tierId', 
  authenticateToken,
  checkBotOwnership, 
  BotController.deleteFeeTier
);

router.get('/stats/manager', 
  authenticateToken,
  requireRole(['MANAGER']), 
  BotController.getManagerStats
);

module.exports = router;