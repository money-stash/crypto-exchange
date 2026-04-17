const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OperatorManagerChatController = require('../controllers/OperatorManagerChatController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/chats');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `operator-manager-${uniqueSuffix}${path.extname(file.originalname || '')}`);
  }
});

const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

router.use(authenticateToken);
router.use(requireRole(['OPERATOR', 'MANAGER', 'SUPERADMIN']));

router.get('/unread-count', asyncHandler(OperatorManagerChatController.getUnreadCount.bind(OperatorManagerChatController)));

router.get(
  '/assignment-options',
  requireRole(['MANAGER', 'SUPERADMIN']),
  asyncHandler(OperatorManagerChatController.getAssignmentOptions.bind(OperatorManagerChatController))
);

router.patch(
  '/operators/:operatorId/manager',
  requireRole(['MANAGER', 'SUPERADMIN']),
  asyncHandler(OperatorManagerChatController.assignManager.bind(OperatorManagerChatController))
);

router.get(
  '/',
  requireRole(['MANAGER', 'SUPERADMIN']),
  asyncHandler(OperatorManagerChatController.getChats.bind(OperatorManagerChatController))
);

router.get(
  '/operators/:operatorId/messages',
  asyncHandler(OperatorManagerChatController.getMessages.bind(OperatorManagerChatController))
);

router.post(
  '/operators/:operatorId/messages',
  attachmentUpload.single('attachment'),
  asyncHandler(OperatorManagerChatController.sendMessage.bind(OperatorManagerChatController))
);

router.post(
  '/operators/:operatorId/read',
  asyncHandler(OperatorManagerChatController.markAsRead.bind(OperatorManagerChatController))
);

module.exports = router;
