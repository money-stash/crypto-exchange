const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken, requireRole } = require('../middleware/auth');

// получение всех пользователей
router.get('/', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER', 'SUPPORT']), 
  UserController.getUsers
);

// получение пользователя по ID
router.get('/:id', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN', 'MANAGER', 'SUPPORT']), 
  UserController.getUserById
);

// получение рефералов пользователя по ID
router.get('/:id/referrals', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  UserController.getUserReferrals
);

// обновление скидки пользователя (только SUPERADMIN и exchange admin for their users)
router.patch('/:id/discount', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  UserController.updateUserDiscount
);

// блокировка пользователя (только SUPERADMIN и exchange admin for their users)
router.patch('/:id/block', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  UserController.blockUser
);

// разблокировка пользователя (только SUPERADMIN и exchange admin for their users)
router.patch('/:id/unblock', 
  authenticateToken,
  requireRole(['SUPERADMIN', 'EX_ADMIN']), 
  UserController.unblockUser
);

module.exports = router;