const Fee = require('../models/Fee');

/**
 * расчет котировки для операций покупки/продажи
 * @param {Object} params
 * @param {'BUY'|'SELL'} params.dir - направление операции
 * @param {number} params.X - курс обмена (монета к RUB)
 * @param {number} params.Kb - комиссия на покупку (0-1)
 * @param {number} params.Ks - комиссия на продажу (0-1)
 * @param {number} params.R - реферальный бонус (0-1)
 * @param {number} params.V - скидка пользователя (0-1)
 * @param {number} params.amountCoin - количество монет
 * @returns {Object} котировка с ценой за единицу и суммой в RUB
 */
function calcQuote({dir, X, Kb, Ks, R, V, amountCoin}) {
  // преобразуем все параметры в числа
  const numKb = parseFloat(Kb) || 0;
  const numKs = parseFloat(Ks) || 0;
  const numR = parseFloat(R) || 0;
  const numV = parseFloat(V) || 0;
  
  console.log('calcQuote DEBUG:', {dir, X, Kb: `${Kb} -> ${numKb}`, Ks: numKs, R: numR, V: numV, amountCoin});
  
  const unit = dir === 'BUY'
    ? X * (1 + numKb + numR - numV)  // При покупке: курс + комиссия + реф.комиссия - скидка
    : X * (1 + numKs - numR + numV);  // При продаже: курс + комиссия - реф.комиссия + скидка (комиссия уже с нужным знаком в базе)
  const sum = unit * amountCoin;
  
  console.log('calcQuote unit calculation:', {
    unit,
    sum,
    formula: dir === 'BUY' ? `${X} * (1 + ${numKb} + ${numR} - ${numV}) = ${X} * ${1 + numKb + numR - numV}` : `${X} * (1 + ${numKs} - ${numR} + ${numV}) = ${X} * ${1 + numKs - numR + numV}`
  });
  
  return {
    unitRub: Math.round(unit * 100) / 100,
    sumRub: Math.round(sum * 100) / 100
  };
}

/**
 * расчет котировки с прогрессивной системой комиссий
 * @param {Object} params
 * @param {'BUY'|'SELL'} params.dir - направление операции  
 * @param {number} params.X - курс обмена (монета к RUB)
 * @param {string} params.coin - символ монеты (BTC, LTC, XMR)
 * @param {number} params.botId - ID бота для поиска уровней комиссий
 * @param {number} params.amountRub - сумма в рублях для расчета комиссии
 * @param {number} params.amountCoin - количество монет
 * @param {number} params.R - реферальный бонус (0-1)
 * @param {number} params.V - скидка пользователя (0-1)
 * @returns {Promise<Object>} котировка с ценой за единицу и суммой в RUB
 */
async function calcQuoteWithTiers({dir, X, coin, botId, amountRub, amountCoin, R = 0, V = 0}) {
  try {
    // получаем прогрессивную комиссию для суммы
    const feeType = dir === 'BUY' ? 'buy' : 'sell';
    const feePercentage = await Fee.calculateFeeForAmount(botId, coin, amountRub, feeType);
    
    console.log('calcQuoteWithTiers DEBUG:', {
      dir, X, coin, botId, amountRub, amountCoin, R, V,
      feePercentage,
      feeType
    });
    
    // используем прогрессивную комиссию в расчете
    const Kb = dir === 'BUY' ? feePercentage : 0;
    const Ks = dir === 'SELL' ? feePercentage : 0;
    
    const result = calcQuote({dir, X, Kb, Ks, R, V, amountCoin});
    console.log('calcQuote result:', result);
    
    return result;
  } catch (error) {
    console.error('Error calculating quote with tiers:', error);
    // запасной вариант с дефолтными комиссиями
    const Kb = dir === 'BUY' ? 0.02 : 0; // дефолт 2%
    const Ks = dir === 'SELL' ? 0.02 : 0; // дефолт 2%
    return calcQuote({dir, X, Kb, Ks, R, V, amountCoin});
  }
}

/**
 * получение применимой комиссии для суммы используя систему уровней
 * @param {number} botId 
 * @param {string} coin 
 * @param {number} amountRub 
 * @param {'buy'|'sell'} type 
 * @returns {Promise<number>} процент комиссии в виде десятичной дроби
 */
async function getFeeForAmount(botId, coin, amountRub, type = 'buy') {
  try {
    return await Fee.calculateFeeForAmount(botId, coin, amountRub, type);
  } catch (error) {
    console.error('Error getting fee for amount:', error);
    return 0.02; // дефолтная комиссия 2%
  }
}

/**
 * расчет эффективного курса для отображения (курс + комиссия)
 * @param {Object} params
 * @param {number} params.rate - базовый курс обмена
 * @param {number} params.fee - процент комиссии (0-1)
 * @param {'BUY'|'SELL'} params.direction - направление операции
 * @returns {number} эффективный курс
 */
function calculateEffectiveRate({rate, fee, direction}) {
  if (direction === 'BUY') {
    return rate * (1 + fee);
  } else {
    return rate * (1 + fee); // комиссия должна уже иметь правильный знак для продажи
  }
}

/**
 * форматирование числа до определенного количества знаков после запятой
 * @param {number} num 
 * @param {number} decimals 
 * @returns {number}
 */
function roundToDecimals(num, decimals = 2) {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * валидация символа монеты
 * @param {string} coin 
 * @returns {boolean}
 */
function isValidCoin(coin) {
  return ['BTC', 'LTC', 'XMR', 'USDT'].includes(coin);
}

/**
 * валидация направления операции
 * @param {string} dir 
 * @returns {boolean}
 */
function isValidDirection(dir) {
  return ['BUY', 'SELL'].includes(dir);
}

/**
 * валидация статуса заявки
 * @param {string} status 
 * @returns {boolean}
 */
function isValidOrderStatus(status) {
  const validStatuses = [
    'CREATED', 'AWAITING_CONFIRM', 'QUEUED', 
    'PAYMENT_PENDING', 'COMPLETED', 'CANCELLED'
  ];
  return validStatuses.includes(status);
}

module.exports = {
  calcQuote,
  calcQuoteWithTiers,
  getFeeForAmount,
  calculateEffectiveRate,
  roundToDecimals,
  isValidCoin,
  isValidDirection,
  isValidOrderStatus
};
