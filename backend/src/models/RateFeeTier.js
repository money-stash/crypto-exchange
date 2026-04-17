const { getConnection } = require('../config/database');

const ALLOWED_COINS = ['BTC', 'LTC', 'XMR', 'USDT'];
const ALLOWED_DIRECTIONS = ['BUY', 'SELL'];

class RateFeeTier {
  static validateCoin(coin) {
    if (!ALLOWED_COINS.includes(coin)) {
      throw new Error(`Unsupported coin: ${coin}`);
    }
  }

  static validateDirection(direction) {
    if (!ALLOWED_DIRECTIONS.includes(direction)) {
      throw new Error(`Unsupported direction: ${direction}`);
    }
  }

  static normalizeTiers(tiers = []) {
    if (!Array.isArray(tiers)) {
      throw new Error('Tiers must be an array');
    }

    const normalized = tiers.map((tier, index) => {
      const min = Number(tier.min_amount);
      const maxRaw = tier.max_amount;
      const max = maxRaw === null || maxRaw === '' || typeof maxRaw === 'undefined'
        ? null
        : Number(maxRaw);
      const fee = Number(tier.fee_percent);

      if (!Number.isFinite(min) || min < 0) {
        throw new Error(`Tier #${index + 1}: invalid min_amount`);
      }
      if (max !== null && (!Number.isFinite(max) || max <= min)) {
        throw new Error(`Tier #${index + 1}: max_amount must be greater than min_amount`);
      }
      if (!Number.isFinite(fee) || fee < 0 || fee > 1) {
        throw new Error(`Tier #${index + 1}: fee_percent must be between 0 and 1`);
      }

      return {
        min_amount: min,
        max_amount: max,
        fee_percent: fee
      };
    });

    const sorted = [...normalized].sort((a, b) => a.min_amount - b.min_amount);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.max_amount === null) {
        throw new Error(`Tier #${i + 1}: unlimited max_amount must be last`);
      }
      if (current.max_amount > next.min_amount) {
        throw new Error(`Tiers overlap near amount ${next.min_amount}`);
      }
    }

    return sorted;
  }

  static async getAll() {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM rate_fee_tiers ORDER BY coin, dir, min_amount ASC'
    );
    return rows;
  }

  static async getByCoinAndDirection(coin, direction) {
    this.validateCoin(coin);
    this.validateDirection(direction);

    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM rate_fee_tiers WHERE coin = ? AND dir = ? ORDER BY min_amount ASC',
      [coin, direction]
    );
    return rows;
  }

  static async findApplicableFee(coin, direction, amountRub) {
    this.validateCoin(coin);
    this.validateDirection(direction);

    const amount = Number(amountRub);
    if (!Number.isFinite(amount) || amount < 0) {
      return null;
    }

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT fee_percent
       FROM rate_fee_tiers
       WHERE coin = ?
         AND dir = ?
         AND min_amount <= ?
         AND (max_amount IS NULL OR max_amount >= ?)
       ORDER BY min_amount DESC
       LIMIT 1`,
      [coin, direction, amount, amount]
    );

    if (!rows.length) return null;
    return Number(rows[0].fee_percent);
  }

  static async replaceForCoin(coin, { buyTiers = [], sellTiers = [] }) {
    this.validateCoin(coin);
    const normalizedBuy = this.normalizeTiers(buyTiers);
    const normalizedSell = this.normalizeTiers(sellTiers);

    const db = getConnection();
    try {
      await db.query('START TRANSACTION');

      await db.execute('DELETE FROM rate_fee_tiers WHERE coin = ?', [coin]);

      for (const tier of normalizedBuy) {
        await db.execute(
          `INSERT INTO rate_fee_tiers (coin, dir, min_amount, max_amount, fee_percent)
           VALUES (?, 'BUY', ?, ?, ?)`,
          [coin, tier.min_amount, tier.max_amount, tier.fee_percent]
        );
      }

      for (const tier of normalizedSell) {
        await db.execute(
          `INSERT INTO rate_fee_tiers (coin, dir, min_amount, max_amount, fee_percent)
           VALUES (?, 'SELL', ?, ?, ?)`,
          [coin, tier.min_amount, tier.max_amount, tier.fee_percent]
        );
      }

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}

module.exports = RateFeeTier;
