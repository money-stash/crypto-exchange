const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DealController = require('../controllers/DealController');
const { authenticateToken, requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Создаем папку для чеков если её нет (абсолютный путь от корня проекта)
const receiptsDir = path.join(__dirname, '../../uploads/receipts/');
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Используем абсолютный путь
    cb(null, path.join(__dirname, '../../uploads/receipts/'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const prefix = file.mimetype === 'application/pdf' ? 'receipt-pdf-' : 'receipt-';
    cb(null, prefix + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
    const allowedMimeTypes = /image\/(jpeg|jpg|png|gif|webp)|application\/pdf/;
    
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения (JPEG, JPG, PNG, GIF, WEBP) и PDF файлы'));
    }
  }
});

router.post('/:id/assign',
  authenticateToken,
  requireAuth,
  validate(schemas.assignDeal),
  asyncHandler(DealController.assignDeal.bind(DealController))  
);


router.post('/:id/mark-payment',
  authenticateToken,
  requireAuth,
  asyncHandler(DealController.markPayment.bind(DealController))
);

router.post('/:id/confirm-payment',
  authenticateToken,
  requireAuth,
  asyncHandler(DealController.confirmPayment.bind(DealController))
);

router.post('/:id/transaction-hash',
  authenticateToken,
  requireAuth,
  asyncHandler(DealController.setTransactionHash.bind(DealController))
);

router.post('/:id/complete',
  authenticateToken,
  requireAuth,
  upload.single('receipt'),
  asyncHandler(DealController.completeDeal.bind(DealController))
);


router.post('/:id/message',
  authenticateToken,
  requireAuth,
  asyncHandler(DealController.sendMessage.bind(DealController))
);

module.exports = router;