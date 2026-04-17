const Joi = require('joi');

// request validation
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      return res.status(400).json({ 
        error: 'Validation error', 
        details: errorMessage 
      });
    }
    
    next();
  };
};

// validation schemas
const schemas = {
  // create order
  createOrder: Joi.object({
    tg_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().trim().min(1)).required(),
    dir: Joi.string().valid('BUY', 'SELL').required(),
    coin: Joi.string().valid('BTC', 'LTC', 'XMR', 'USDT').required(),
    amount_coin: Joi.number().positive().optional(),
    amountCoin: Joi.number().positive().optional(),
    req_id: Joi.number().integer().positive().optional(),
    reqId: Joi.number().integer().positive().optional(),
    exch_req_id: Joi.number().integer().positive().optional(),
    exchReqId: Joi.number().integer().positive().optional(),
    user_bot_id: Joi.number().integer().positive().optional(),
    userBotId: Joi.number().integer().positive().optional(),
    crypto_address: Joi.string().trim().min(3).optional(),
    cryptoAddress: Joi.string().trim().min(3).optional(),
    card_info: Joi.string().trim().min(3).optional(),
    cardInfo: Joi.string().trim().min(3).optional(),
    sum_rub: Joi.number().positive().optional(),
    sumRub: Joi.number().positive().optional(),
    input_mode: Joi.string().valid('RUB', 'CRYPTO', 'COIN').optional(),
    inputMode: Joi.string().valid('RUB', 'CRYPTO', 'COIN').optional()
  }).or('amount_coin', 'amountCoin', 'sum_rub', 'sumRub'),

  // quote
  getQuote: Joi.object({
    tg_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().trim().min(1)).required(),
    dir: Joi.string().valid('BUY', 'SELL').required(),
    coin: Joi.string().valid('BTC', 'LTC', 'XMR', 'USDT').required(),
    amount_coin: Joi.number().positive().optional(),
    amountCoin: Joi.number().positive().optional(),
    sum_rub: Joi.number().positive().optional(),
    sumRub: Joi.number().positive().optional(),
    input_mode: Joi.string().valid('RUB', 'CRYPTO', 'COIN').optional(),
    inputMode: Joi.string().valid('RUB', 'CRYPTO', 'COIN').optional()
  }).or('amount_coin', 'amountCoin', 'sum_rub', 'sumRub'),

  // login
  login: Joi.object({
    login: Joi.string().required(),
    password: Joi.string().min(6).required()
  }),

  // update fees
  updateFees: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().positive().optional(),
      coin: Joi.string().valid('BTC', 'LTC', 'XMR', 'USDT').required(),
      buy_fee: Joi.number().min(-1).max(1).required(),
      sell_fee: Joi.number().min(-1).max(1).required(),
      created_at: Joi.date().optional(),
      updated_at: Joi.date().optional()
    })
  ),

  // update user discount
  updateDiscount: Joi.object({
    discount_v: Joi.number().min(0).max(0.1).required()
  }),

  // assign deal
  assignDeal: Joi.object({
    support_id: Joi.number().integer().positive().optional()
  }),

  // support limits
  updateSupportLimit: Joi.object({
    active_limit: Joi.number().integer().min(1).max(8).required()
  }),

  // broadcast
  broadcast: Joi.object({
    text: Joi.string().required(),
    photo: Joi.string().optional(),
    gif: Joi.string().optional(),
    segments: Joi.array().items(Joi.string()).optional()
  }),

  // complaint
  createComplaint: Joi.object({
    deal_id: Joi.number().integer().positive().required(),
    reason: Joi.string().max(255).required()
  }),

  // pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().allow('').optional(),
    coin: Joi.string().valid('BTC', 'LTC', 'XMR', 'USDT').allow('').optional(),
    dir: Joi.string().valid('BUY', 'SELL').allow('').optional(),
    q: Joi.string().max(100).allow('').optional(),
    operator_login: Joi.string().max(100).allow('').optional(),
    bot_id: Joi.number().integer().min(0).optional()
  }),

  updateFinanceSettings: Joi.object({
    company_usdt_wallet_trc20: Joi.string().trim().max(128).required(),
    operator_take_start_message_1: Joi.string().trim().max(1000).allow('', null).optional(),
    operator_take_start_message_2: Joi.string().trim().max(1000).allow('', null).optional()
  }),

  updateChatQuickReplies: Joi.object({
    operator_chat_quick_replies: Joi.array()
      .items(Joi.string().trim().max(160).allow(''))
      .max(20)
      .required()
  }),

  createDebtIntent: Joi.object({
    requested_usdt: Joi.number().positive().required()
  }),

  writeOffDebt: Joi.object({
    requested_usdt: Joi.number().positive().optional()
  }),

  createDebtPayment: Joi.object({
    intent_id: Joi.number().integer().positive().required(),
    declared_amount_usdt: Joi.number().positive().optional(),
    tx_hash: Joi.string().trim().min(8).max(128).required()
  }),

  // bot management
  createBot: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    identifier: Joi.string().min(3).max(50).pattern(/^[a-z0-9_\-]+$/).required(),
    token: Joi.string().min(10).required(),
    description: Joi.string().max(500).optional().allow(''),
    exchange_chat_link: Joi.string().uri().optional().allow(''),
    reviews_chat_link: Joi.string().uri().optional().allow(''),
    reviews_chat_id: Joi.string().optional().allow(''),
    is_active: Joi.boolean().default(true)
  }),

  updateBot: Joi.object({
    name: Joi.string().min(3).max(100).optional(),
    identifier: Joi.string().min(3).max(50).pattern(/^[a-z0-9_\-]+$/).optional(),
    token: Joi.string().min(10).optional(),
    description: Joi.string().max(500).optional().allow(''),
    exchange_chat_link: Joi.string().uri().optional().allow(''),
    reviews_chat_link: Joi.string().uri().optional().allow(''),
    reviews_chat_id: Joi.string().optional().allow(''),
    start_message: Joi.string().max(4096).optional().allow('', null),
    contacts_message: Joi.string().max(4096).optional().allow('', null),
    is_active: Joi.boolean().optional()
  }),

  // bot requisites
  createBotRequisite: Joi.object({
    type: Joi.string().valid('CARD', 'SBP', 'BTC', 'LTC', 'XMR', 'USDT').required(),
    label: Joi.string().max(100).optional().allow(''),
    address: Joi.alternatives().conditional('type', {
      switch: [
        { is: 'CARD', then: Joi.string().min(16).max(19).required() }, // card number (16-19 chars)
        { is: 'SBP', then: Joi.string().pattern(/^[+]?[0-9\s\-()]{10,20}$/).required() }, // phone number for SBP
        { is: Joi.valid('BTC', 'LTC', 'XMR', 'USDT'), then: Joi.string().min(26).max(500).required() } // crypto address
      ],
      otherwise: Joi.optional().allow('')
    }),
    bank_name: Joi.string().max(100).when('type', { 
      is: Joi.valid('CARD', 'SBP'), 
      then: Joi.required(), 
      otherwise: Joi.optional().allow('') 
    }),
    holder_name: Joi.string().max(100).when('type', { 
      is: Joi.valid('CARD', 'SBP'), 
      then: Joi.required(), 
      otherwise: Joi.optional().allow('') 
    }),
    is_active: Joi.boolean().default(true),
    is_default: Joi.boolean().default(false),
    support_id: Joi.number().integer().positive().optional(),
    order_id: Joi.number().integer().positive().optional()
  }),

  updateBotRequisite: Joi.object({
    label: Joi.string().max(100).optional().allow(''),
    address: Joi.string().min(10).max(500).optional(),
    // phone: Joi.string().pattern(/^[+]?[0-9\s\-()]{10,20}$/).optional().allow(''),
    bank_name: Joi.string().max(100).optional().allow(''),
    holder_name: Joi.string().max(100).optional().allow(''),
    // is_active: Joi.boolean().optional(),
    is_default: Joi.boolean().optional()
  }).min(1), // require at least one field for update

  // mailings
  createMailing: Joi.object({
    bot_id: Joi.number().integer().min(0).optional(),
    text: Joi.string().min(1).max(4096).required(),
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('photo', 'gif').required(),
        // accept both url and data for frontend compatibility
        url: Joi.string().uri().optional(),
        data: Joi.string().optional(), // base64 payload for temporary flow
        name: Joi.string().optional(), // file name
        caption: Joi.string().max(1024).optional().allow('')
      }).or('url', 'data') // require at least one of these fields
    ).max(10).optional().allow(null)
  }),
  createRaffleMailing: Joi.object({
    bot_id: Joi.number().integer().min(0).optional(),
    raffle_name: Joi.string().trim().min(1).max(80).default('Машрум'),
    recipients_text: Joi.string().trim().min(1).max(12000).required()
  }),
  updateSendCount: Joi.object({
    increment: Joi.number().integer().min(1).default(1)
  })
};

module.exports = {
  validate,
  schemas
};

