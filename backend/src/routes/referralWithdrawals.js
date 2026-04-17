const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const ReferralWithdrawController = require('../controllers/ReferralWithdrawController');

router.get('/', authenticateToken, requireRole(['EX_ADMIN', 'SUPERADMIN']), ReferralWithdrawController.getWithdrawals);

router.get('/:id', authenticateToken, requireRole(['EX_ADMIN', 'SUPERADMIN']), ReferralWithdrawController.getWithdrawalById);

router.post('/:id/complete', authenticateToken, requireRole(['EX_ADMIN', 'SUPERADMIN']), ReferralWithdrawController.completeWithdrawal);

router.post('/:id/cancel', authenticateToken, requireRole(['EX_ADMIN', 'SUPERADMIN']), ReferralWithdrawController.cancelWithdrawal);

module.exports = router; 