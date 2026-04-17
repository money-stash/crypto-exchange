const axios = require('axios');
const config = require('../config');

class OrderLogTelegramService {
  isEnabled() {
    return Boolean(config.orderLog.botToken && config.orderLog.chatId);
  }

  apiBase() {
    return `https://api.telegram.org/bot${config.orderLog.botToken}`;
  }

format(order, isTaken) {
  const formatCoin = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n)) return String(v || 0);
    return n.toFixed(8).replace(/\.?0+$/, '');
  };

  const dir = String(order.dir || order.transaction_type || '').toUpperCase();

  const coinPart = `${formatCoin(order.amount_coin)} ${order.coin}`;
  const rubPart = `${Math.round(Number(order.sum_rub || 0)).toLocaleString('ru-RU')}р`;

  // SELL: coin > rub
  // BUY:  rub > coin
  const [fromPart, toPart] =
    dir === 'SELL'
      ? [coinPart, rubPart]
      : [rubPart, coinPart];

  const username = String(order.username || '').trim().replace(/^@/, '');
  const accountNameFromFields = [order.first_name, order.last_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const accountName = String(order.account_name || accountNameFromFields).trim();
  const clientLabel = username
    ? `@${username}`
    : (accountName || (order.tg_id ? `id:${order.tg_id}` : 'без имени'));

  return `Операция #${order.unique_id} | ${fromPart} > ${toPart} | ${config.orderLog.methodLabel} ${isTaken ? '✅' : '❌'} | ${clientLabel}`;
}

  async sendCreated(order) {
    if (!this.isEnabled()) return null;

    const { data } = await axios.post(
      `${this.apiBase()}/sendMessage`,
      {
        chat_id: config.orderLog.chatId,
        text: this.format(order, false),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
    return data.result.message_id;
  }

  async markTaken(order, messageId) {
    if (!this.isEnabled() || !messageId) return;

    const { data } = await axios.post(
      `${this.apiBase()}/editMessageText`,
      {
        chat_id: config.orderLog.chatId,
        message_id: Number(messageId),
        text: this.format(order, true),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) throw new Error(`Telegram editMessageText failed: ${JSON.stringify(data)}`);
  }
}

module.exports = new OrderLogTelegramService();
