const RateService = require('../services/RateService');
const Fee = require('../models/Fee');
const Rate = require('../models/Rate');
const { logSupportAction } = require('../utils/logger');

class RateController {
  async isSupportedCoin(coin) {
    const supportedCoins = await Rate.getSupportedCoins();
    return supportedCoins.includes(String(coin || '').toUpperCase());
  }

  // получить текущие курсы
  async getRates(req, res) {
    const rates = await RateService.getCurrentRates();
    res.json(rates);
  }

  // получить котировки с учетом комиссий
  async getQuotes(req, res) {
    const fees = await Fee.getAll();
    const feesMap = {};
    fees.forEach(fee => {
      feesMap[fee.coin] = fee;
    });

    const quotes = await RateService.getQuotes(feesMap);
    res.json(quotes);
  }

  // обновить курсы (админ)
  async refreshRates(req, res) {
    try {
      const result = await RateService.updateRates();
      
      await logSupportAction(req.user.id, 'rates_refresh', { 
        updated_count: result.updated_count 
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to update rates', 
        details: error.message 
      });
    }
  }

  // получить комиссии
  async getFees(req, res) {
    const fees = await Fee.getAll();
    res.json(fees);
  }

  async getSettings(req, res) {
    const rates = await RateService.getCurrentRates();
    res.json(rates);
  }

  async updateManualRate(req, res) {
    const { coin } = req.params;
    const rateRub = Number(req.body?.rate_rub);
    const normalizedCoin = String(coin || '').toUpperCase();

    if (!(await this.isSupportedCoin(normalizedCoin))) {
      return res.status(400).json({ error: 'Unsupported coin' });
    }
    if (!Number.isFinite(rateRub) || rateRub <= 0) {
      return res.status(400).json({ error: 'rate_rub must be a positive number' });
    }

    const updated = await Rate.setManualRate(normalizedCoin, rateRub);

    await logSupportAction(req.user.id, 'manual_rate_updated', {
      coin: normalizedCoin,
      rate_rub: rateRub
    });

    res.json(updated);
  }

  async disableManualRate(req, res) {
    const { coin } = req.params;
    const normalizedCoin = String(coin || '').toUpperCase();

    if (!(await this.isSupportedCoin(normalizedCoin))) {
      return res.status(400).json({ error: 'Unsupported coin' });
    }

    await Rate.disableManualRate(normalizedCoin);
    const updated = await Rate.getByCoin(normalizedCoin);

    await logSupportAction(req.user.id, 'manual_rate_disabled', { coin: normalizedCoin });

    res.json(updated);
  }

  // обновить комиссии (админ)
  async updateFees(req, res) {
    const fees = req.body;

    await Fee.updateAll(fees);
    
    await logSupportAction(req.user.id, 'fees_updated', { fees });

    res.json({ success: true, message: 'Fees updated successfully' });
  }
}

module.exports = new RateController();
