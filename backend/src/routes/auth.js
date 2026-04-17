const express = require('express');
const AuthController = require('../controllers/AuthController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// логин
router.post('/login', 
  validate(schemas.login),
  asyncHandler(AuthController.login.bind(AuthController))
);

// получение информации о текущем пользователе
router.get('/me',
  authenticateToken,
  asyncHandler(AuthController.me.bind(AuthController))
);

// обновление токена
router.post('/refresh',
  authenticateToken, 
  asyncHandler(AuthController.refresh.bind(AuthController))
);

module.exports = router;