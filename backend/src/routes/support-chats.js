const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const SupportChatController = require('../controllers/SupportChatController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Настройка multer для загрузки изображений
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/support-chats');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'support-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Поддерживаются только изображения (JPEG, PNG, GIF, WebP)'));
    }
  }
});



router.get('/',
  authenticateToken,
  asyncHandler(SupportChatController.getChats)
);


router.get('/unread-count',
  authenticateToken,
  asyncHandler(SupportChatController.getUnreadCount)
);


router.get('/:chatId',
  authenticateToken,
  asyncHandler(SupportChatController.getChatById)
);


router.get('/:chatId/messages',
  authenticateToken,
  asyncHandler(SupportChatController.getMessages)
);

router.post('/:chatId/messages',
  authenticateToken,
  asyncHandler(SupportChatController.sendMessage)
);


router.post('/:chatId/upload',
  authenticateToken,
  upload.single('image'),
  asyncHandler(SupportChatController.uploadImage)
);


router.post('/:chatId/read',
  authenticateToken,
  asyncHandler(SupportChatController.markAsRead)
);


router.post('/:chatId/typing',
  authenticateToken,
  asyncHandler(SupportChatController.sendTypingEvent)
);


router.delete('/:chatId',
  authenticateToken,
  requireRole(['SUPERADMIN']),
  asyncHandler(SupportChatController.deleteChat)
);

module.exports = router;
