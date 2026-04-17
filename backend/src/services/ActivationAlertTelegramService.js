const axios = require('axios');
const config = require('../config');

class ActivationAlertTelegramService {
  isEnabled() {
    return Boolean(config.activationAlert.botToken && config.activationAlert.chatId);
  }

  apiBase() {
    return `https://api.telegram.org/bot${config.activationAlert.botToken}`;
  }

  buildUserLabel(telegramUser = {}) {
    const username = String(telegramUser.username || '').trim().replace(/^@/, '');
    if (username) return `@${username}`;

    const nickname = [telegramUser.first_name, telegramUser.last_name]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');

    const telegramId = telegramUser.id || telegramUser.tg_id || null;

    if (nickname && telegramId) return `${nickname} (id:${telegramId})`;
    if (nickname) return nickname;
    if (telegramId) return `id:${telegramId}`;

    return '\u0431\u0435\u0437 \u043d\u0438\u043a\u0430';
  }

  buildMessage(telegramUser = {}, activationNumber = null, referrerUser = null) {
    const numberText = Number.isFinite(Number(activationNumber)) && Number(activationNumber) > 0
      ? ` ${Number(activationNumber)}`
      : '';
    const referrerText = referrerUser ? ` \u043e\u0442 ${this.buildUserLabel(referrerUser)}` : '';
    return `+1 \u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u044f${numberText} ${this.buildUserLabel(telegramUser)}${referrerText}`;
  }

  async sendActivation(telegramUser = {}, activationNumber = null, referrerUser = null) {
    if (!this.isEnabled()) return false;

    const { data } = await axios.post(
      `${this.apiBase()}/sendMessage`,
      {
        chat_id: config.activationAlert.chatId,
        text: this.buildMessage(telegramUser, activationNumber, referrerUser),
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    if (!data?.ok) {
      throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
    }

    return true;
  }
}

module.exports = new ActivationAlertTelegramService();
