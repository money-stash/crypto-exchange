const axios = require('axios');

class ManagerAlertTelegramService {
  constructor() {
    // Runtime map: orderId -> Telegram message_id in manager alert chat.
    // No DB migration required; when absent, we gracefully fallback to sendMessage.
    this.orderMessageIds = new Map();
  }

  isEnabled() {
    return Boolean(process.env.MANAGER_ALERT_BOT_TOKEN && process.env.MANAGER_ALERT_CHAT_ID);
  }

  getApiBase() {
    return `https://api.telegram.org/bot${process.env.MANAGER_ALERT_BOT_TOKEN}`;
  }

  buildBuyStatusMessage(order, statusLabel) {
    const username = String(order.username || '').trim();
    const userLabel = username
      ? `@${username}`
      : (order.tg_id ? `id:${order.tg_id}` : `user_id:${order.user_id}`);

    return [
      `Операция #${order.unique_id}`,
      `Клиент: ${userLabel}`,
      `Выплатить: ${Number(order.amount_coin).toFixed(8).replace(/\.?0+$/, '')} ${order.coin}`,
      `Адрес: ${order.user_crypto_address || 'не указан'}`,
      `Статус: ${statusLabel}`
    ].join('\n');
  }

  buildBuyPaymentReadyMessage(order) {
    return this.buildBuyStatusMessage(order, 'Оплатил');
  }

  buildBuyCompletedMessage(order) {
    return this.buildBuyStatusMessage(order, 'Успешно закрыта');
  }

  async sendRawMessage(text) {
    const { data } = await axios.post(
      `${this.getApiBase()}/sendMessage`,
      {
        chat_id: process.env.MANAGER_ALERT_CHAT_ID,
        text,
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram send failed: ${JSON.stringify(data)}`);
    }

    return data?.result?.message_id || null;
  }

  async editRawMessage(messageId, text) {
    const { data } = await axios.post(
      `${this.getApiBase()}/editMessageText`,
      {
        chat_id: process.env.MANAGER_ALERT_CHAT_ID,
        message_id: messageId,
        text,
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram edit failed: ${JSON.stringify(data)}`);
    }

    return true;
  }

  async sendBuyPaymentReady(order) {
    if (!this.isEnabled()) return false;

    const text = this.buildBuyPaymentReadyMessage(order);
    const messageId = await this.sendRawMessage(text);
    if (messageId) {
      this.orderMessageIds.set(Number(order.id), Number(messageId));
    }
    return true;
  }

  async markBuyCompleted(order) {
    if (!this.isEnabled()) return false;

    const text = this.buildBuyCompletedMessage(order);
    const orderId = Number(order.id);
    const messageId = this.orderMessageIds.get(orderId);

    // Try editing original manager alert first.
    if (messageId) {
      try {
        await this.editRawMessage(messageId, text);
        return true;
      } catch (error) {
        // Fallback to a new message if message cannot be edited anymore.
        console.warn(`Manager alert edit failed for order ${orderId}, fallback to new message:`, error.message);
      }
    }

    // Fallback path (e.g. after restart when message id map is empty).
    const newMessageId = await this.sendRawMessage(text);
    if (newMessageId) {
      this.orderMessageIds.set(orderId, Number(newMessageId));
    }
    return true;
  }
}

module.exports = new ManagerAlertTelegramService();
