const { getConnection } = require('../config/database');

class Fee {
  constructor(data) {
    Object.assign(this, data);
  }

  static async getSupportedCoins() {
    const db = getConnection();
    const [rows] = await db.execute("SHOW COLUMNS FROM fees LIKE 'coin'");
    const type = rows[0]?.Type || rows[0]?.type || '';
    const values = [...String(type).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return values.length ? values : ['BTC', 'LTC', 'XMR', 'USDT'];
  }

  // получение всех комиссий
  static async getAll() {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM fees ORDER BY bot_id, coin');
    return rows.map(row => new Fee(row));
  }

  // получение комиссий по ID бота
  static async getByBotId(botId) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM fees WHERE bot_id = ? ORDER BY coin', [botId]);
    return rows.map(row => new Fee(row));
  }

  // получение комиссии по монете и ID бота
  static async getByCoinAndBot(coin, botId) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM fees WHERE coin = ? AND bot_id = ?', [coin, botId]);
    return rows.length ? new Fee(rows[0]) : null;
  }

  // получение комиссии по монете
  static async getByCoin(coin) {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM fees WHERE coin = ? ORDER BY bot_id LIMIT 1', [coin]);
    return rows.length ? new Fee(rows[0]) : null;
  }

  // обновление комиссий по ID бота
  static async updateByBotId(botId, fees) {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');
      
      for (const fee of fees) {
        await db.execute(
          'INSERT INTO fees (coin, bot_id, buy_fee, sell_fee) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE buy_fee = VALUES(buy_fee), sell_fee = VALUES(sell_fee)',
          [fee.coin, botId, fee.buy_fee, fee.sell_fee]
        );
      }
      
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  // создание стандартных комиссий для бота
  static async createDefaultForBot(botId) {
    const db = getConnection();
    const supportedCoins = await this.getSupportedCoins();
    
    const defaultCoins = [
      { coin: 'BTC', buy_fee: 0.02, sell_fee: -0.02 },    
      { coin: 'LTC', buy_fee: 0.02, sell_fee: -0.02 },  
      { coin: 'XMR', buy_fee: 0.02, sell_fee: -0.02 },
      { coin: 'USDT', buy_fee: 0.02, sell_fee: -0.02 }
    ].filter((fee) => supportedCoins.includes(fee.coin));
    
    try {
      await db.query('START TRANSACTION');
      
      for (const feeData of defaultCoins) {
        await db.execute(
          'INSERT IGNORE INTO fees (coin, bot_id, buy_fee, sell_fee) VALUES (?, ?, ?, ?)',
          [feeData.coin, botId, feeData.buy_fee, feeData.sell_fee]
        );
      }
      
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  // обеспечение наличия стандартных комиссий для бота
  static async ensureBotFees(botId) {
    const db = getConnection();
    const supportedCoins = await this.getSupportedCoins();
    
    const existingFees = await this.getByBotId(botId);
    const existingCoins = existingFees.map(fee => fee.coin);
    
    const requiredCoins = ['BTC', 'LTC', 'XMR', 'USDT'].filter((coin) => supportedCoins.includes(coin));
    const missingCoins = requiredCoins.filter(coin => !existingCoins.includes(coin));
    
    if (missingCoins.length > 0) {
      const defaultFees = {
        'BTC': { buy_fee: 0.02, sell_fee: -0.02 },
        'LTC': { buy_fee: 0.02, sell_fee: -0.02 },
        'XMR': { buy_fee: 0.02, sell_fee: -0.02 },
        'USDT': { buy_fee: 0.02, sell_fee: -0.02 }
      };
      
      try {
        await db.query('START TRANSACTION');
        
        for (const coin of missingCoins) {
          const feeData = defaultFees[coin];
          await db.execute(
            'INSERT INTO fees (coin, bot_id, buy_fee, sell_fee) VALUES (?, ?, ?, ?)',
            [coin, botId, feeData.buy_fee, feeData.sell_fee]
          );
        }
        
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  }

  // обновление всех комиссий
  static async updateAll(fees) {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');
      
      for (const fee of fees) {
        const botId = fee.bot_id || null;
        await db.execute(
          'INSERT INTO fees (coin, bot_id, buy_fee, sell_fee) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE buy_fee = VALUES(buy_fee), sell_fee = VALUES(sell_fee)',
          [fee.coin, botId, fee.buy_fee, fee.sell_fee]
        );
      }
      
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  // поиск комиссии по паре монета/бот
  static async findByPair(coin, botId = null) {
    const db = getConnection();
    
    let query = 'SELECT * FROM fees WHERE coin = ?';
    const params = [coin];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    query += ' ORDER BY bot_id LIMIT 1';
    
    const [rows] = await db.execute(query, params);
    return rows.length ? new Fee(rows[0]) : null;
  }

  // получение всех уровней комиссий для бота и монеты
  static async getFeeTiers(botId, coin) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM bot_fee_tiers WHERE bot_id = ? AND coin = ? ORDER BY min_amount ASC',
      [botId, coin]
    );
    return rows;
  }

  // получение всех уровней комиссий для бота
  static async getAllFeeTiers(botId) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM bot_fee_tiers WHERE bot_id = ? ORDER BY coin, min_amount ASC',
      [botId]
    );
    return rows;
  }

  // создание или обновление уровня комиссии
  static async createOrUpdateFeeTier(tierData) {
    const db = getConnection();
    const { id, bot_id, coin, min_amount, max_amount, buy_fee, sell_fee } = tierData;
    
    if (id) {
      await db.execute(
        'UPDATE bot_fee_tiers SET min_amount = ?, max_amount = ?, buy_fee = ?, sell_fee = ? WHERE id = ?',
        [min_amount, max_amount, buy_fee, sell_fee, id]
      );
      return id;
    } else {
      const [result] = await db.execute(
        'INSERT INTO bot_fee_tiers (bot_id, coin, min_amount, max_amount, buy_fee, sell_fee) VALUES (?, ?, ?, ?, ?, ?)',
        [bot_id, coin, min_amount, max_amount, buy_fee, sell_fee]
      );
      return result.insertId;
    }
  }

  // удаление уровня комиссии
  static async deleteFeeTier(tierId) {
    const db = getConnection();
    const [result] = await db.execute('DELETE FROM bot_fee_tiers WHERE id = ?', [tierId]);
    return result.affectedRows > 0;
  }

  // расчет комиссии для суммы с учетом уровней
  static async calculateFeeForAmount(botId, coin, amount, type = 'buy') {
    const db = getConnection();
    const numericAmount = Number(amount);
    
    const [rows] = await db.execute(
      'SELECT * FROM bot_fee_tiers WHERE bot_id = ? AND coin = ? AND min_amount <= ? AND (max_amount IS NULL OR max_amount >= ?) ORDER BY min_amount DESC LIMIT 1',
      [botId, coin, numericAmount, numericAmount]
    );
    
    if (rows.length > 0) {
      const tier = rows[0];
      return type === 'buy' ? tier.buy_fee : tier.sell_fee;
    }

    const existingTiers = await this.getFeeTiers(botId, coin);
    if (existingTiers.length > 0) {
      const sortedTiers = [...existingTiers].sort((a, b) => Number(a.min_amount) - Number(b.min_amount));
      const minAmount = Number(sortedTiers[0].min_amount);
      const lastTier = sortedTiers[sortedTiers.length - 1];
      const maxAmount = lastTier.max_amount === null || lastTier.max_amount === undefined
        ? null
        : Number(lastTier.max_amount);

      const rangeError = new Error('Amount is outside configured fee tiers');
      rangeError.code = 'AMOUNT_OUT_OF_RANGE';
      rangeError.minAmountRub = minAmount;
      rangeError.maxAmountRub = maxAmount;
      rangeError.amountRub = numericAmount;
      throw rangeError;
    }
    
    const regularFee = await this.getByCoinAndBot(coin, botId);
    if (regularFee) {
      return type === 'buy' ? regularFee.buy_fee : regularFee.sell_fee;
    }
    
    return 0;
  }

  // валидация уровней комиссий
  static async validateFeeTiers(botId, coin, tiers) {
    const errors = [];
    
    if (tiers.length === 0) {
      return { valid: true, errors: [] };
    }
    
    const sortedTiers = [...tiers].sort((a, b) => a.min_amount - b.min_amount);
    
    for (let i = 0; i < sortedTiers.length; i++) {
      const tier = sortedTiers[i];
      const nextTier = sortedTiers[i + 1];
      
      if (tier.min_amount < 0) {
        errors.push(`Tier ${i + 1}: Minimum amount cannot be negative`);
      }
      
      if (tier.max_amount !== null && tier.max_amount <= tier.min_amount) {
        errors.push(`Tier ${i + 1}: Maximum amount must be greater than minimum amount`);
      }
      
      if (nextTier) {
        if (tier.max_amount === null) {
          errors.push(`Tier ${i + 1}: Cannot have unlimited tier when there are higher tiers`);
        } else if (tier.max_amount !== nextTier.min_amount) {
          if (tier.max_amount < nextTier.min_amount) {
            errors.push(`Gap between tier ${i + 1} and tier ${i + 2}: ${tier.max_amount} to ${nextTier.min_amount}`);
          } else {
            errors.push(`Overlap between tier ${i + 1} and tier ${i + 2}`);
          }
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }


  


  // замена всех уровней комиссий для монеты у бота
  static async replaceFeeTiersForCoin(botId, coin, tiers) {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');
      
      await db.execute(
        'DELETE FROM bot_fee_tiers WHERE bot_id = ? AND coin = ?',
        [botId, coin]
      );
      
      const createdTiers = [];
      
      for (const tier of tiers) {
        const { min_amount, max_amount, buy_fee, sell_fee } = tier;
        const [result] = await db.execute(
          'INSERT INTO bot_fee_tiers (bot_id, coin, min_amount, max_amount, buy_fee, sell_fee) VALUES (?, ?, ?, ?, ?, ?)',
          [botId, coin, min_amount, max_amount, buy_fee, sell_fee]
        );
        
        createdTiers.push({
          id: result.insertId,
          bot_id: botId,
          coin,
          min_amount,
          max_amount,
          buy_fee,
          sell_fee
        });
      }
      
      await db.query('COMMIT');
      return createdTiers;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

}

module.exports = Fee;
