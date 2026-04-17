const { getConnection } = require('../config/database');

class Rate {
  constructor(data) {
    Object.assign(this, data);
  }

  static normalizeRow(row) {
    if (!row) return row;
    if (row.coin === '' && ['rapira', 'manual', 'default'].includes(String(row.src || '').toLowerCase())) {
      return { ...row, coin: 'USDT' };
    }
    return row;
  }

  static async getSupportedCoins() {
    const db = getConnection();
    const [rows] = await db.execute("SHOW COLUMNS FROM rates LIKE 'coin'");
    const type = rows[0]?.Type || rows[0]?.type || '';
    const values = [...String(type).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return values.length ? values : ['BTC', 'LTC', 'XMR', 'USDT'];
  }

  static async getAll() {
    const db = getConnection();
    const [rows] = await db.execute('SELECT * FROM rates ORDER BY coin');
    return rows
      .map((row) => this.normalizeRow(row))
      .filter((row) => row?.coin)
      .map((row) => new Rate(row));
  }

  static async getByCoin(coin) {
    const db = getConnection();
    const normalizedCoin = String(coin || '').toUpperCase();

    const [rows] = normalizedCoin === 'USDT'
      ? await db.execute(
        `SELECT * FROM rates
         WHERE coin = 'USDT'
            OR (coin = '' AND src IN ('rapira', 'manual', 'default'))
         ORDER BY CASE WHEN coin = 'USDT' THEN 0 ELSE 1 END
         LIMIT 1`
      )
      : await db.execute('SELECT * FROM rates WHERE coin = ? LIMIT 1', [normalizedCoin]);

    return rows.length ? new Rate(this.normalizeRow(rows[0])) : null;
  }

  static async updateRate(coin, rateRub, src = 'binance') {
    const db = getConnection();
    const normalizedCoin = String(coin || '').toUpperCase();
    const normalizedRate = Number(rateRub);

    if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
      throw new Error(`Invalid rate value for ${normalizedCoin}`);
    }

    const supportedCoins = await this.getSupportedCoins();
    if (!supportedCoins.includes(normalizedCoin)) {
      throw new Error(`Coin ${normalizedCoin} is not supported by DB schema. Run migrations.`);
    }

    const [existing] = await db.execute(
      'SELECT id, is_manual FROM rates WHERE coin = ?',
      [normalizedCoin]
    );

    if (existing.length > 0 && Number(existing[0].is_manual) === 1 && src !== 'manual') {
      return false;
    }

    if (src === 'manual') {
      const [result] = await db.execute(
        `INSERT INTO rates (coin, rate_rub, manual_rate_rub, is_manual, src) VALUES (?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           rate_rub = VALUES(rate_rub),
           manual_rate_rub = VALUES(manual_rate_rub),
           is_manual = 1,
           src = VALUES(src),
           updated_at = NOW()`,
        [normalizedCoin, normalizedRate, normalizedRate, src]
      );
      return result.affectedRows > 0;
    }

    const [result] = await db.execute(
      `INSERT INTO rates (coin, rate_rub, src, is_manual, manual_rate_rub) VALUES (?, ?, ?, 0, NULL)
       ON DUPLICATE KEY UPDATE
         rate_rub = VALUES(rate_rub),
         src = VALUES(src),
         updated_at = NOW()`,
      [normalizedCoin, normalizedRate, src]
    );
    return result.affectedRows > 0;
  }

  static async setManualRate(coin, rateRub) {
    await this.updateRate(coin, rateRub, 'manual');
    return this.getByCoin(coin);
  }

  static async disableManualRate(coin) {
    const db = getConnection();
    const normalizedCoin = String(coin || '').toUpperCase();
    const [result] = await db.execute(
      `UPDATE rates
       SET is_manual = 0,
           manual_rate_rub = NULL,
           src = CASE
             WHEN src = 'manual' AND coin = 'USDT' THEN 'rapira'
             WHEN src = 'manual' THEN 'binance'
             ELSE src
           END,
           updated_at = NOW()
       WHERE coin = ?`,
      [normalizedCoin]
    );
    return result.affectedRows > 0;
  }

  static async updateMultiple(rates) {
    let updated = 0;
    for (const rate of rates) {
      const changed = await this.updateRate(rate.coin, rate.rate_rub, rate.src || 'binance');
      if (changed) updated++;
    }
    return updated;
  }

  static async getRatesMap() {
    const rates = await Rate.getAll();
    const map = {};
    rates.forEach((rate) => {
      map[rate.coin] = rate.rate_rub;
    });
    return map;
  }

  static async initializeDefaults() {
    const db = getConnection();
    const supportedCoins = await this.getSupportedCoins();
    const defaultRates = [
      { coin: 'BTC', rate_rub: 3000000.00 },
      { coin: 'LTC', rate_rub: 8000.00 },
      { coin: 'XMR', rate_rub: 15000.00 },
      { coin: 'USDT', rate_rub: 100.00 }
    ].filter((rate) => supportedCoins.includes(rate.coin));

    for (const rate of defaultRates) {
      const [existing] = await db.execute('SELECT id FROM rates WHERE coin = ?', [rate.coin]);
      if (!existing.length) {
        await db.execute(
          'INSERT INTO rates (coin, rate_rub, src) VALUES (?, ?, ?)',
          [rate.coin, rate.rate_rub, 'default']
        );
      }
    }
  }
}

module.exports = Rate;
