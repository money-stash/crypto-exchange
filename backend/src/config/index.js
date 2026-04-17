require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  mysql: {
    uri: process.env.MYSQL_URI || 'mysql://root:root@localhost:3306/exchange_db'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change_me_in_production'
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN
  },
  crypto: {
    aesKeyHex: process.env.AES_KEY_HEX || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'secret_encryption_key_change_in_production'
  },
  binance: {
    apiBase: process.env.BINANCE_API_BASE || 'https://api.binance.com'
  },
  cron: {
    rates: process.env.CRON_RATES || '*/5 * * * *'
  },
  sla: {
    minutes: parseInt(process.env.SLA_MINUTES) || 30
  },
  orderLog: {
    botToken: process.env.ORDER_LOG_BOT_TOKEN || '',
    chatId: process.env.ORDER_LOG_CHAT_ID || '',
    methodLabel: process.env.ORDER_LOG_METHOD_LABEL || '\u0421\u0411\u041f'
  },
  operatorAlert: {
    botToken: process.env.OPERATOR_ALERT_BOT_TOKEN || process.env.ORDER_LOG_BOT_TOKEN || '',
    chatId: process.env.OPERATOR_ALERT_CHAT_ID || '',
    methodLabel: process.env.OPERATOR_ALERT_METHOD_LABEL || process.env.ORDER_LOG_METHOD_LABEL || '\u0421\u0411\u041f / \u041a\u0430\u0440\u0442\u0430'
  },
  activationAlert: {
    botToken: process.env.ACTIVATION_ALERT_BOT_TOKEN || process.env.MANAGER_ALERT_BOT_TOKEN || process.env.ORDER_LOG_BOT_TOKEN || '',
    chatId: process.env.ACTIVATION_ALERT_CHAT_ID || process.env.MANAGER_ALERT_CHAT_ID || ''
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    translationModel: process.env.OPENAI_TRANSLATION_MODEL || 'gpt-5.4-mini',
    translationTimeoutMs: parseInt(process.env.OPENAI_TRANSLATION_TIMEOUT_MS || '8000', 10)
  }
};
