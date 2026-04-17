const axios = require('axios');
const SystemSetting = require('../models/SystemSetting');
const Rate = require('../models/Rate');

let HttpProxyAgent = null;
let HttpsProxyAgent = null;
try {
  ({ HttpProxyAgent } = require('http-proxy-agent'));
  ({ HttpsProxyAgent } = require('https-proxy-agent'));
} catch (_error) {
  // Optional: fallback to axios native proxy config.
}

class RapiraRateService {
  constructor() {
    this.cacheKey = 'rapira_usdtrub_cache';
    this.cacheTimeKey = 'rapira_usdtrub_cached_at';
    this.defaultEndpoint = 'https://api.rapira.net/open/market/rates';
    this.symbol = 'USDT/RUB';
    this.priceField = 'askPrice';
    this.markupRub = 4;
    this.requestTimeoutMs = this.readEnvNumber(process.env.RAPIRA_REQUEST_TIMEOUT_MS, 2500, { min: 300, max: 10000 });
    this.failureCooldownMs = this.readEnvNumber(process.env.RAPIRA_FAILURE_COOLDOWN_MS, 30000, { min: 1000, max: 300000 });
    this.lastLiveFailureAt = 0;
    this.liveFetchPromise = null;
  }

  readEnvNumber(rawValue, fallbackValue, { min = null, max = null } = {}) {
    const normalizedRaw = String(rawValue ?? '').trim().replace(',', '.');
    const parsed = Number(normalizedRaw);
    let value = Number.isFinite(parsed) ? parsed : fallbackValue;
    if (min !== null && value < min) value = min;
    if (max !== null && value > max) value = max;
    return value;
  }

  normalizeRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Number(num.toFixed(6));
  }

  normalizePercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Number(num.toFixed(4));
  }

  applyOperatorPercent(rateWithMarkupRub, operatorRatePercent = 0) {
    const baseRate = this.normalizeRate(rateWithMarkupRub);
    if (!baseRate || baseRate <= 0) return null;
    const percent = this.normalizePercent(operatorRatePercent);
    const adjustedRate = baseRate * (1 + (percent / 100));
    return this.normalizeRate(adjustedRate);
  }

  extractAskPrice(payload) {
    const rows = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload) ? payload : []);

    if (!rows.length) return null;

    const pair = rows.find((item) => String(item?.symbol || '').toUpperCase() === this.symbol);
    if (!pair) return null;

    const parsed = this.normalizeRate(pair?.[this.priceField]);
    if (!parsed || parsed <= 0) return null;

    return parsed;
  }

  resolveProxyConfig() {
    const proxyUrlRaw = String(process.env.RAPIRA_PROXY_URL || '').trim();
    if (!proxyUrlRaw) {
      return null;
    }

    try {
      const normalizedUrl = proxyUrlRaw.includes('://') ? proxyUrlRaw : `http://${proxyUrlRaw}`;
      const parsed = new URL(normalizedUrl);
      const protocol = String(parsed.protocol || 'http:').replace(':', '').toLowerCase();
      const port = Number(parsed.port || (protocol === 'https' ? 443 : 80));

      if (!parsed.hostname || !Number.isFinite(port) || port <= 0) {
        throw new Error('Invalid proxy host/port');
      }

      const proxy = {
        protocol,
        host: parsed.hostname,
        port
      };

      const username = decodeURIComponent(parsed.username || '');
      const password = decodeURIComponent(parsed.password || '');
      if (username || password) {
        proxy.auth = { username, password };
      }

      return proxy;
    } catch (error) {
      throw new Error(`Invalid RAPIRA_PROXY_URL: ${error.message}`);
    }
  }

  resolveProxyAgents() {
    const proxyUrlRaw = String(process.env.RAPIRA_PROXY_URL || '').trim();
    if (!proxyUrlRaw || !HttpProxyAgent || !HttpsProxyAgent) {
      return null;
    }

    try {
      const normalizedUrl = proxyUrlRaw.includes('://') ? proxyUrlRaw : `http://${proxyUrlRaw}`;
      // eslint-disable-next-line no-new
      new URL(normalizedUrl);
      return {
        httpAgent: new HttpProxyAgent(normalizedUrl),
        httpsAgent: new HttpsProxyAgent(normalizedUrl)
      };
    } catch (error) {
      throw new Error(`Invalid RAPIRA_PROXY_URL: ${error.message}`);
    }
  }

  buildAxiosConfig() {
    const axiosConfig = {
      timeout: this.requestTimeoutMs,
      headers: {
        Accept: 'application/json'
      }
    };

    const proxyConfig = this.resolveProxyConfig();
    if (proxyConfig) {
      axiosConfig.proxy = proxyConfig;
    }

    const proxyAgents = this.resolveProxyAgents();
    if (proxyAgents) {
      axiosConfig.proxy = false;
      axiosConfig.httpAgent = proxyAgents.httpAgent;
      axiosConfig.httpsAgent = proxyAgents.httpsAgent;
    }

    return axiosConfig;
  }

  async fetchLiveUsdtrub() {
    const url = process.env.RAPIRA_API_URL || this.defaultEndpoint;
    const response = await axios.get(url, this.buildAxiosConfig());

    const rate = this.extractAskPrice(response?.data);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid Rapira response for ${this.symbol}.${this.priceField}`);
    }

    return rate;
  }

  async saveCache(rate) {
    const nowIso = new Date().toISOString();
    await SystemSetting.setValue(this.cacheKey, String(rate));
    await SystemSetting.setValue(this.cacheTimeKey, nowIso);
  }

  async getCachedRate() {
    const [cachedValue, cachedAt] = await Promise.all([
      SystemSetting.getValue(this.cacheKey, null),
      SystemSetting.getValue(this.cacheTimeKey, null)
    ]);

    const rate = Number(cachedValue);
    if (!Number.isFinite(rate) || rate <= 0 || !cachedAt) {
      return null;
    }

    return {
      rate,
      cachedAt: new Date(cachedAt)
    };
  }

  async getRateFromDbFallback() {
    const usdtRate = await Rate.getByCoin('USDT');
    const rawRate = Number(usdtRate?.rate_rub || 0);
    if (!Number.isFinite(rawRate) || rawRate <= 0) {
      return null;
    }

    const rateWithMarkupRub = this.normalizeRate(rawRate);
    const baseRateRub = this.normalizeRate(Math.max(0.000001, rateWithMarkupRub - this.markupRub));

    return {
      source: 'db_fallback',
      baseRateRub,
      markupRub: this.markupRub,
      rateWithMarkupRub,
      rate: baseRateRub
    };
  }

  getStaticFallbackQuote() {
    const staticRateWithMarkup = this.readEnvNumber(process.env.USDT_FALLBACK_RATE_RUB, 100, { min: 1 });
    const baseRateRub = this.normalizeRate(Math.max(0.000001, staticRateWithMarkup - this.markupRub));
    return {
      source: 'static_fallback',
      baseRateRub,
      markupRub: this.markupRub,
      rateWithMarkupRub: this.normalizeRate(staticRateWithMarkup),
      rate: baseRateRub
    };
  }

  buildQuote(baseRateRub, source) {
    const normalizedBaseRate = this.normalizeRate(baseRateRub);
    const markupRub = this.markupRub;
    const rateWithMarkupRub = this.normalizeRate(normalizedBaseRate + markupRub);

    return {
      source,
      baseRateRub: normalizedBaseRate,
      markupRub,
      rateWithMarkupRub,
      rate: normalizedBaseRate
    };
  }

  canAttemptLiveFetch() {
    if (!this.lastLiveFailureAt) return true;
    return (Date.now() - this.lastLiveFailureAt) >= this.failureCooldownMs;
  }

  async fetchAndCacheLiveQuote() {
    if (this.liveFetchPromise) {
      return this.liveFetchPromise;
    }

    this.liveFetchPromise = (async () => {
      const liveBaseRate = await this.fetchLiveUsdtrub();
      await this.saveCache(liveBaseRate);
      this.lastLiveFailureAt = 0;
      return this.buildQuote(liveBaseRate, 'live');
    })();

    try {
      return await this.liveFetchPromise;
    } catch (error) {
      this.lastLiveFailureAt = Date.now();
      throw error;
    } finally {
      this.liveFetchPromise = null;
    }
  }

  refreshLiveQuoteInBackground() {
    if (!this.canAttemptLiveFetch() || this.liveFetchPromise) {
      return;
    }

    this.fetchAndCacheLiveQuote().catch(() => {
      // Silent refresh.
    });
  }

  async getUsdtrubQuote() {
    const ttlMinutes = this.readEnvNumber(process.env.RAPIRA_CACHE_TTL_MINUTES, 15, { min: 1, max: 1440 });
    const ttlMs = ttlMinutes * 60 * 1000;
    const allowStaleCache = String(process.env.RAPIRA_ALLOW_STALE_CACHE || 'true').toLowerCase() !== 'false';

    const cached = await this.getCachedRate();
    if (cached) {
      const ageMs = Date.now() - cached.cachedAt.getTime();
      if (ageMs <= ttlMs) {
        return this.buildQuote(cached.rate, 'cache');
      }
      if (allowStaleCache) {
        this.refreshLiveQuoteInBackground();
        return this.buildQuote(cached.rate, 'stale_cache');
      }
    }

    const dbFallback = await this.getRateFromDbFallback();
    if (dbFallback) {
      this.refreshLiveQuoteInBackground();
      return dbFallback;
    }

    const staticFallback = this.getStaticFallbackQuote();
    this.refreshLiveQuoteInBackground();
    return staticFallback;
  }

  async getUsdtrubRate() {
    return this.getUsdtrubQuote();
  }
}

module.exports = new RapiraRateService();
