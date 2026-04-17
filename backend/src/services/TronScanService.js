const axios = require('axios');

class TronScanService {
  constructor() {
    this.defaultBase = process.env.TRONSCAN_API_BASE || 'https://apilist.tronscanapi.com';
    this.usdtContractRaw = String(
      process.env.TRC20_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    ).trim();
    // Keep lower-case value only for internal comparisons.
    this.usdtContract = this.usdtContractRaw.toLowerCase();
  }

  normalizeAddress(address) {
    return String(address || '').trim().toLowerCase();
  }

  parseAmount(value, decimalsHint = 6) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    if (raw.includes('.')) {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const intVal = Number(raw);
    if (!Number.isFinite(intVal)) return null;

    const decimals = Number(decimalsHint);
    if (!Number.isFinite(decimals) || decimals < 0) return null;

    return intVal / Math.pow(10, decimals);
  }

  extractTransfer(payload) {
    const transfers =
      payload?.trc20TransferInfo ||
      payload?.trc20Transfer ||
      payload?.token_transfer_info ||
      payload?.data?.trc20TransferInfo ||
      [];

    if (!Array.isArray(transfers) || !transfers.length) return null;

    const transfer = transfers.find((item) => {
      const contract = this.normalizeAddress(
        item?.tokenId || item?.token_id || item?.contract_address || item?.tokenAddress
      );
      return contract === this.usdtContract;
    });

    if (!transfer) return null;

    const decimals = transfer?.tokenDecimal ?? transfer?.decimals ?? transfer?.tokenInfo?.tokenDecimal ?? 6;
    const amountRaw = transfer?.amount_str ?? transfer?.amount ?? transfer?.quant ?? transfer?.value;
    const amount = this.parseAmount(amountRaw, decimals);

    return {
      tokenContract: this.normalizeAddress(
        transfer?.tokenId || transfer?.token_id || transfer?.contract_address || transfer?.tokenAddress
      ),
      toAddress: transfer?.to_address || transfer?.toAddress || transfer?.to || null,
      fromAddress: transfer?.from_address || transfer?.fromAddress || transfer?.from || null,
      amountUsdt: amount
    };
  }

  extractConfirmations(payload) {
    const candidates = [
      payload?.confirmations,
      payload?.confirmedNum,
      payload?.block_confirmations,
      payload?.data?.confirmations
    ];

    for (const value of candidates) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    return 0;
  }

  isSuccess(payload) {
    const contractRet = String(payload?.contractRet || payload?.receipt?.result || '').toUpperCase();
    if (contractRet === 'SUCCESS') return true;
    if (payload?.confirmed === true) return true;
    return false;
  }

  buildTransactionInfoEndpoint() {
    const base = this.defaultBase.replace(/\/+$/, '');
    if (base.endsWith('/api')) {
      return `${base}/transaction-info`;
    }
    return `${base}/api/transaction-info`;
  }

  buildTokenTransfersEndpoint() {
    const base = this.defaultBase.replace(/\/+$/, '');
    if (base.endsWith('/api')) {
      return `${base}/token_trc20/transfers`;
    }
    return `${base}/api/token_trc20/transfers`;
  }

  normalizeTimestampMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    if (parsed < 1000000000000) return parsed * 1000;
    return parsed;
  }

  parseTransfersList(payload) {
    const rows =
      payload?.token_transfers ||
      payload?.trc20_transfers ||
      payload?.data ||
      payload?.list ||
      [];

    if (!Array.isArray(rows)) return [];

    const parsed = rows.map((item) => {
      const tokenContract = this.normalizeAddress(
        item?.tokenInfo?.tokenId ||
        item?.tokenId ||
        item?.token_id ||
        item?.contract_address ||
        item?.tokenAddress
      );

      const decimals =
        item?.tokenInfo?.tokenDecimal ??
        item?.tokenDecimal ??
        item?.decimals ??
        item?.token_decimal ??
        6;

      const amountUsdt = this.parseAmount(
        item?.amount_str ??
        item?.amount ??
        item?.quant ??
        item?.value,
        decimals
      );

      return {
        txHash:
          item?.transaction_id ||
          item?.hash ||
          item?.transactionHash ||
          item?.txHash ||
          null,
        tokenContract,
        toAddress: item?.to_address || item?.toAddress || item?.to || null,
        fromAddress: item?.from_address || item?.fromAddress || item?.from || null,
        amountUsdt,
        timestampMs: this.normalizeTimestampMs(
          item?.block_ts ||
          item?.timestamp ||
          item?.block_timestamp ||
          item?.transferTime ||
          item?.time
        )
      };
    });

    return parsed.filter((item) =>
      item.txHash &&
      item.tokenContract === this.usdtContract &&
      Number.isFinite(item.amountUsdt) &&
      item.amountUsdt > 0
    );
  }

  async listRecentUsdtTransfersByAddress(address, options = {}) {
    const targetAddress = String(address || '').trim();
    if (!targetAddress) return [];

    const endpoint = this.buildTokenTransfersEndpoint();
    const sinceMs = Number(options.sinceMs || 0);
    const limit = Math.max(10, Math.min(Number(options.limit || 200), 500));

    const attempts = [
      {
        limit,
        start: 0,
        sort: '-timestamp',
        relatedAddress: targetAddress,
        contract_address: this.usdtContractRaw
      },
      {
        limit,
        start: 0,
        sort: '-timestamp',
        toAddress: targetAddress,
        contract_address: this.usdtContractRaw
      },
      {
        limit,
        start: 0,
        sort: '-timestamp',
        address: targetAddress,
        contract_address: this.usdtContractRaw
      }
    ];

    let lastError = null;
    for (const params of attempts) {
      try {
        const response = await axios.get(endpoint, {
          params,
          timeout: 10000
        });
        const parsed = this.parseTransfersList(response?.data || {});
        if (!parsed.length) continue;

        const filtered = parsed.filter((row) => {
          if (!row.timestampMs || !sinceMs) return true;
          return row.timestampMs >= sinceMs;
        });

        if (!filtered.length) continue;

        const deduped = [];
        const seen = new Set();
        for (const row of filtered) {
          if (seen.has(row.txHash)) continue;
          seen.add(row.txHash);
          deduped.push(row);
        }

        return deduped;
      } catch (error) {
        // TronScan may return 400 for some query param combinations.
        // This polling path should not throw in that case; just try other variants.
        if (Number(error?.response?.status) === 400) {
          continue;
        }
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  async inspectUsdtTransfer(txHash) {
    const endpoint = this.buildTransactionInfoEndpoint();
    const response = await axios.get(endpoint, {
      params: { hash: txHash },
      timeout: 10000
    });

    const payload = response?.data || {};
    const transfer = this.extractTransfer(payload);
    if (!transfer) {
      throw new Error('USDT transfer not found in transaction');
    }

    if (!this.isSuccess(payload)) {
      throw new Error('Transaction is not successful');
    }

    if (!Number.isFinite(transfer.amountUsdt) || transfer.amountUsdt <= 0) {
      throw new Error('Unable to determine USDT transfer amount');
    }

    return {
      txHash,
      network: 'TRC20',
      tokenContract: transfer.tokenContract,
      confirmations: this.extractConfirmations(payload),
      toAddress: transfer.toAddress,
      fromAddress: transfer.fromAddress,
      amountUsdt: transfer.amountUsdt
    };
  }
}

module.exports = new TronScanService();
