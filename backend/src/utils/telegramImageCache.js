const fs = require('fs').promises;

/**
 * Сервис для кеширования file_id изображений в Telegram
 * Telegram возвращает file_id после первой загрузки, который можно переиспользовать
 */
class TelegramImageCache {
  constructor() {
    // В памяти храним кеш: bot_id -> template_name -> file_id
    this.cache = new Map();
  }

  /**
   * Получить file_id из кеша
   * @param {number} botId - ID бота
   * @param {string} templateName - Имя шаблона (например, 'buy_crypto')
   * @returns {string|null} - file_id или null если не найдено
   */
  get(botId, templateName) {
    const botCache = this.cache.get(botId);
    if (!botCache) return null;
    
    const fileId = botCache.get(templateName);
    if (fileId) {
      console.log(`✅ Using cached file_id for bot ${botId}, template: ${templateName}`);
    }
    return fileId || null;
  }

  /**
   * Сохранить file_id в кеш
   * @param {number} botId - ID бота
   * @param {string} templateName - Имя шаблона
   * @param {string} fileId - file_id от Telegram
   */
  set(botId, templateName, fileId) {
    if (!this.cache.has(botId)) {
      this.cache.set(botId, new Map());
    }
    
    const botCache = this.cache.get(botId);
    botCache.set(templateName, fileId);
    
    console.log(`✅ Cached file_id for bot ${botId}, template: ${templateName}`);
  }

  /**
   * Очистить кеш для конкретного бота
   * @param {number} botId - ID бота
   */
  clearBot(botId) {
    this.cache.delete(botId);
    console.log(`✅ Cleared cache for bot ${botId}`);
  }

  /**
   * Очистить весь кеш
   */
  clearAll() {
    this.cache.clear();
    console.log('✅ Cleared all image cache');
  }

  /**
   * Получить статистику кеша
   */
  getStats() {
    const stats = {
      totalBots: this.cache.size,
      bots: []
    };

    for (const [botId, botCache] of this.cache.entries()) {
      stats.bots.push({
        botId,
        cachedImages: botCache.size,
        templates: Array.from(botCache.keys())
      });
    }

    return stats;
  }
}

module.exports = new TelegramImageCache();
