const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OrderController = require('../controllers/OrderController');
const { authenticateToken, requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const chatAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/chats');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `order-chat-${uniqueSuffix}${path.extname(file.originalname || '')}`);
  }
});

const chatAttachmentUpload = multer({
  storage: chatAttachmentStorage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  }
});

// получение списка заказов
router.get('/',
  authenticateToken,
  requireAuth,
  validate(schemas.pagination, 'query'),
  asyncHandler(OrderController.getOrders.bind(OrderController))
);

// получение доступных заказов для поддержки
router.get('/available/support',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.getAvailableOrders.bind(OrderController))
);

// получение статистики по заказам операторов
router.get('/stats/operator',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.getOperatorStats.bind(OrderController))
);

// получение данных для графика по заказам операторов
router.get('/stats/operator/chart',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.getOperatorChartData.bind(OrderController))
);

// получение деталей заказа по ID
router.get('/:id',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.getOrderDetails.bind(OrderController))
);

// создание заказа
router.post('/',
  (req, res, next) => {
    console.log('📥 [Route] POST /api/orders called');
    console.log('📥 [Route] Request body:', JSON.stringify(req.body, null, 2));
    next();
  },
  validate(schemas.createOrder),
  asyncHandler(OrderController.createOrder.bind(OrderController))
);

// получение котировки для заказа
router.post('/quote',
  validate(schemas.getQuote),
  asyncHandler(OrderController.getQuote.bind(OrderController))
);

// подтверждение заказа
router.post('/:id/confirm',
  asyncHandler(OrderController.confirmOrder.bind(OrderController))
);

// обновление реквизитов заказа
router.post('/:id/requisites',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.setOrderRequisites.bind(OrderController))
);

// отмена заказа
router.post('/:id/cancel',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.cancelOrder.bind(OrderController))
);

// получение сообщений по заказу
router.get('/:id/messages',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.getMessages.bind(OrderController))
);

// Отправка сообщения по заказу
router.post('/:id/messages',
  authenticateToken,
  requireAuth,
  chatAttachmentUpload.single('attachment'),
  asyncHandler(OrderController.sendMessage.bind(OrderController))
);

// отметка сообщений как прочитанных
router.post('/:id/messages/read',
  authenticateToken,
  requireAuth,
  asyncHandler(OrderController.markMessagesRead.bind(OrderController))
);


router.post('/:id/take',
  (req, res, next) => {
    console.log('Route /take hit:', {
      orderId: req.params.id,
      userId: req.user?.id,
      userRole: req.user?.role,
      method: req.method,
      url: req.url
    });
    next();
  },
  authenticateToken,
  (req, res, next) => {
    console.log('After authenticateToken:', {
      user: req.user,
      isAuthenticated: !!req.user
    });
    next();
  },
  requireAuth,
  (req, res, next) => {
    console.log('After requireAuth, calling controller');
    next();
  },
  asyncHandler(OrderController.takeOrder.bind(OrderController))
);


module.exports = router;
