const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(config.crypto.aesKeyHex, 'hex');

/**
 * шифрование текста используя AES-256-GCM
 * @param {string} text - текст для шифрования
 * @returns {Buffer} - зашифрованные данные с IV и auth tag
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(ALGORITHM, KEY);
  cipher.setAAD(Buffer.from('exchange-requisites'));
  
  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  // объединяем IV + AuthTag + Encrypted
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * расшифровка данных AES-256-GCM
 * @param {Buffer} encryptedData - буфер содержащий IV + AuthTag + зашифрованные данные
 * @returns {string} - расшифрованный текст
 */
function decrypt(encryptedData) {
  const iv = encryptedData.slice(0, 16);
  const authTag = encryptedData.slice(16, 32);
  const encrypted = encryptedData.slice(32);
  
  const decipher = crypto.createDecipher(ALGORITHM, KEY);
  decipher.setAAD(Buffer.from('exchange-requisites'));
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, null, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * маскировка чувствительных данных для логирования (показывает последние 4 символа)
 * @param {string} text - текст для маскировки
 * @returns {string} - замаскированный текст
 */
function maskSensitive(text) {
  if (!text || text.length <= 4) return '****';
  return '*'.repeat(text.length - 4) + text.slice(-4);
}

module.exports = {
  encrypt,
  decrypt,
  maskSensitive
};