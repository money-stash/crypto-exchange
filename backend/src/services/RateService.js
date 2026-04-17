const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const Rate = require('../models/Rate');
const { logSystemAction } = require('../utils/logger');

class RateService {
  constructor() {
    this.timeoutMs = Number(process.env.RATE_FETCH_TIMEOUT_MS || 20000);
    this.bybitApiBase = String(process.env.BYBIT_API_BASE || 'https://api.bybit.com').replace(/\/+$/, '');
    this.bybitP2pApiUrl = String(
      process.env.BYBIT_P2P_API_URL || 'https://api2.bybit.com/fiat/otc/item/online'
    );
    this.krakenApiUrl = String(process.env.KRAKEN_API_URL || 'https://api.kraken.com/0/public/Ticker');
    this.bybitP2pPosition = 3;
    this.cachedProxyUrl = null;
    this.cachedProxyAgent = null;
  }

  toNumber(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  }

  getNormalizedProxyUrl() {
    const rawProxyUrl = String(process.env.RATE_PROXY_URL || process.env.RAPIRA_PROXY_URL || '').trim();
    if (!rawProxyUrl) return '';

    const normalized = rawProxyUrl.includes('://') ? rawProxyUrl : `http://${rawProxyUrl}`;
    try {
      // Validate URL format upfront.
      // eslint-disable-next-line no-new
      new URL(normalized);
    } catch (_error) {
      throw new Error('Invalid proxy URL. Use format http://login:password@host:port');
    }

    return normalized;
  }

  getProxyAgent() {
    const proxyUrl = this.getNormalizedProxyUrl();
    if (!proxyUrl) {
      this.cachedProxyUrl = null;
      this.cachedProxyAgent = null;
      return null;
    }

    if (this.cachedProxyUrl === proxyUrl && this.cachedProxyAgent) {
      return this.cachedProxyAgent;
    }

    this.cachedProxyUrl = proxyUrl;
    this.cachedProxyAgent = new HttpsProxyAgent(proxyUrl);
    return this.cachedProxyAgent;
  }

  getRequestConfig(extra = {}) {
    const proxyAgent = this.getProxyAgent();
    return {
      timeout: this.timeoutMs,
      ...(proxyAgent
        ? {
          proxy: false,
          httpAgent: proxyAgent,
          httpsAgent: proxyAgent
        }
        : {}),
      ...extra
    };
  }

  getBybitHeaders() {
    // Keep headers 1:1 with the proven Python requests.Session setup.
    return {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      lang: 'en',
      origin: 'https://www.bybit.com'
    };
  }

  getBybitP2pHeaders() {
    return {
      ...this.getBybitHeaders()
    };
  }

  getP2pPayload() {
    return {
      userId: '',
      tokenId: 'USDT',
      currencyId: 'RUB',
      payment: [],
      paymentPeriod: [],
      side: '1',
      size: '10',
      page: '1',
      amount: '',
      canTrade: false,
      itemRegion: 1,
      sortType: 'OVERALL_RANKING',
      bulkMaker: true,
      vaMaker: false,
      verificationFilter: 0
    };
  }

  async getP2pUsdtrubPrice(position = 3) {
    let response;
    try {
      response = await axios.post(
        this.bybitP2pApiUrl,
        this.getP2pPayload(),
        this.getRequestConfig({
          headers: {
            ...this.getBybitP2pHeaders(),
            'Content-Type': 'application/json'
          }
        })
      );
    } catch (error) {
      const status = error?.response?.status;
      const rawData = error?.response?.data;
      const details = typeof rawData === 'string'
        ? rawData.slice(0, 500)
        : (rawData ? JSON.stringify(rawData) : (error?.code || error?.message || 'unknown_error'));
      throw new Error(`Bybit P2P failed${status ? ` [${status}]` : ''}: ${details}`);
    }

    const items = response?.data?.result?.items || [];
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Bybit P2P items is empty');
    }

    const index = Number(position) - 1;
    if (items.length <= index) {
      throw new Error(`Not enough Bybit P2P ads: need position ${position}, got ${items.length}`);
    }

    const price = this.toNumber(items[index]?.price);
    if (!price || price <= 0) {
      throw new Error('Invalid Bybit P2P USDT/RUB price');
    }

    return price;
  }

  async getSpotBestAsk(symbol) {
    const response = await axios.get(
      `${this.bybitApiBase}/v5/market/tickers`,
      this.getRequestConfig({
        params: { category: 'spot', symbol },
        headers: this.getBybitHeaders()
      })
    );

    if (Number(response?.data?.retCode) !== 0) {
      throw new Error(`Bybit spot error for ${symbol}`);
    }

    const items = response?.data?.result?.list || [];
    if (!Array.isArray(items) || !items.length) {
      throw new Error(`Bybit spot list is empty for ${symbol}`);
    }

    const ask = this.toNumber(items[0]?.ask1Price);
    if (!ask || ask <= 0) {
      throw new Error(`Bybit spot ask missing for ${symbol}`);
    }

    return ask;
  }

  async getXmrUsdtKraken() {
    const response = await axios.get(
      this.krakenApiUrl,
      this.getRequestConfig({
        params: { pair: 'XMRUSDT' },
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json'
        }
      })
    );

    const errors = response?.data?.error || [];
    if (Array.isArray(errors) && errors.length) {
      throw new Error(`Kraken error: ${errors.join(', ')}`);
    }

    const result = response?.data?.result || {};
    const pairData = Object.values(result)[0];
    const ask = this.toNumber(pairData?.a?.[0]);
    if (!ask || ask <= 0) {
      throw new Error('Invalid Kraken XMRUSDT ask');
    }

    return ask;
  }

  async fetchMarketRates() {
    const usdtRub = await this.getP2pUsdtrubPrice(this.bybitP2pPosition);
    const [btcUsdt, ltcUsdt, xmrUsdt] = await Promise.all([
      this.getSpotBestAsk('BTCUSDT'),
      this.getSpotBestAsk('LTCUSDT'),
      this.getXmrUsdtKraken()
    ]);

    return {
      USDT_RUB: usdtRub,
      BTC: {
        usdt_price: btcUsdt,
        rub_price: this.toNumber(btcUsdt * usdtRub)
      },
      LTC: {
        usdt_price: ltcUsdt,
        rub_price: this.toNumber(ltcUsdt * usdtRub)
      },
      XMR: {
        usdt_price: xmrUsdt,
        rub_price: this.toNumber(xmrUsdt * usdtRub)
      }
    };
  }

  async updateRates() {
    try {
      const rates = await this.fetchMarketRates();

      const updatedRates = [];
      const skippedManual = [];
      const coins = ['BTC', 'LTC', 'XMR'];

      for (const coin of coins) {
        const rateRub = Number(rates?.[coin]?.rub_price || 0);
        if (!Number.isFinite(rateRub) || rateRub <= 0) continue;

        const changed = await Rate.updateRate(coin, rateRub, 'bybit_kraken');
        if (changed) {
          updatedRates.push({
            coin,
            rate_rub: rateRub,
            usdt_rate: Number(rates?.[coin]?.usdt_price || 0),
            source: 'bybit_kraken'
          });
        } else {
          skippedManual.push(coin);
        }
      }

      const usdtToRub = Number(rates?.USDT_RUB || 0);
      if (Number.isFinite(usdtToRub) && usdtToRub > 0) {
        const changed = await Rate.updateRate('USDT', usdtToRub, 'bybit_p2p');
        if (changed) {
          updatedRates.push({
            coin: 'USDT',
            rate_rub: usdtToRub,
            source: 'bybit_p2p'
          });
        } else {
          skippedManual.push('USDT');
        }
      }

      await logSystemAction('rates_updated', {
        count: updatedRates.length,
        skipped_manual: skippedManual,
        usdt_to_rub: usdtToRub,
        source: 'bybit_p2p + bybit_spot + kraken',
        rates: updatedRates
      });

      return {
        success: true,
        updated_count: updatedRates.length,
        skipped_manual: skippedManual,
        rates: updatedRates,
        usdt_to_rub: usdtToRub,
        rate_source: 'bybit_p2p + bybit_spot + kraken'
      };
    } catch (error) {
      await logSystemAction('rates_update_failed', { error: error.message });
      throw error;
    }
  }

  async getCurrentRates() {
    return Rate.getAll();
  }

  async getRatesMap() {
    return Rate.getRatesMap();
  }

  async getQuotes(fees = {}) {
    const rates = await this.getRatesMap();
    const quotes = {};

    for (const coin of ['BTC', 'LTC', 'XMR', 'USDT']) {
      const rate = rates[coin];
      const coinFees = fees[coin] || { buy_fee: 0.02, sell_fee: 0.02 };

      if (rate) {
        quotes[coin] = {
          rate_rub: rate,
          buy_rate: rate * (1 + coinFees.buy_fee),
          sell_rate: rate * (1 - coinFees.sell_fee)
        };
      }
    }

    return quotes;
  }
}

module.exports = new RateService();
