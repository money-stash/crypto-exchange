const express = require('express');
const RateController = require('../controllers/RateController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/',
  asyncHandler(RateController.getFees.bind(RateController))
);

router.put('/',
  authenticateToken,
  requireAdmin,
  validate(schemas.updateFees),
  asyncHandler(RateController.updateFees.bind(RateController))
);

module.exports = router;