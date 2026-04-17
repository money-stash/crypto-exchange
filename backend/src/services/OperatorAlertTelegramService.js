const axios = require('axios');
const config = require('../config');

class OperatorAlertTelegramService {
  constructor() {
    this.orderMessageIds = new Map();
  }

  isEnabled() {
    return Boolean(config.operatorAlert.botToken && config.operatorAlert.chatId);
  }

  apiBase() {
    return `https://api.telegram.org/bot${config.operatorAlert.botToken}`;
  }

  buildMessage(order, isTaken = false) {
    const sumRub = Math.round(Number(order?.sum_rub || 0)).toLocaleString('ru-RU');
    const method = String(config.operatorAlert.methodLabel || 'СБП / Карта');
    const emoji = isTaken ? '✅' : '❌';
    return `Операция #${order.unique_id} | ${sumRub}р | ${method} ${emoji}`;
  }

  async sendCreated(order) {
    if (!this.isEnabled()) return false;

    const { data } = await axios.post(
      `${this.apiBase()}/sendMessage`,
      {
        chat_id: config.operatorAlert.chatId,
        text: this.buildMessage(order, false),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
    }

    const messageId = Number(data?.result?.message_id || 0);
    if (messageId > 0 && order?.id) {
      this.orderMessageIds.set(Number(order.id), messageId);
    }

    return true;
  }

  async markTaken(order) {
    if (!this.isEnabled() || !order?.id) return;

    const orderId = Number(order.id);
    const messageId = this.orderMessageIds.get(orderId);

    if (!messageId) {
      // If backend restarted and in-memory mapping is lost, send an accepted-status log as fallback.
      await this.sendAcceptedFallback(order);
      return;
    }

    const { data } = await axios.post(
      `${this.apiBase()}/editMessageText`,
      {
        chat_id: config.operatorAlert.chatId,
        message_id: messageId,
        text: this.buildMessage(order, true),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram editMessageText failed: ${JSON.stringify(data)}`);
    }
  }

  async sendAcceptedFallback(order) {
    const { data } = await axios.post(
      `${this.apiBase()}/sendMessage`,
      {
        chat_id: config.operatorAlert.chatId,
        text: this.buildMessage(order, true),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
    }
  }
}

module.exports = new OperatorAlertTelegramService();
