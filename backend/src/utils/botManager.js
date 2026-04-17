// глобальный экземпляр менеджера ботов
let globalBotManager = null;

/**
 * установка глобального экземпляра менеджера ботов
 * @param {Object} botManager 
 */
function setBotManager(botManager) {
  globalBotManager = botManager;
}

/**
 * получение глобального экземпляра менеджера ботов
 * @returns {Object|null}
 */
function getBotManager() {
  return globalBotManager;
}

/**
 * получение экземпляра бота по ID или возврат первого доступного для рассылок суперадмина
 * @param {number|null} botId - ID бота (null для первого доступного)
 * @returns {Promise<Object|null>}
 */
async function getBotInstance(botId = null) {
  if (!globalBotManager) {
    console.error('Bot manager not initialized');
    return null;
  }

  try {
    if (botId && typeof globalBotManager.getBotById === 'function') {
      return await globalBotManager.getBotById(botId);
    } else if (typeof globalBotManager.getFirstAvailableBot === 'function') {
      return await globalBotManager.getFirstAvailableBot();
    } else {
      // запасной вариант - возвращаем сам глобальный менеджер если у него есть свойство bot
      return globalBotManager.bot ? globalBotManager : null;
    }
  } catch (error) {
    console.error('Error getting bot instance:', error);
    return null;
  }
}

/**
 * отправка уведомления о завершении заявки через менеджер ботов
 * @param {number} orderId 
 * @returns {Promise<boolean>}
 */
async function sendOrderCompletionNotification(orderId) {
  if (!globalBotManager) {
    console.error('Bot manager not initialized');
    return false;
  }
  
  return await globalBotManager.sendOrderCompletionNotification(orderId);
}

async function sendOrderCancelNotification(orderId, reason = null) {
  if (!globalBotManager) {
    console.error('Bot manager not initialized');
    return false;
  }
  
  return await globalBotManager.sendOrderCancelNotification(orderId, reason);
}

/**
 * отправка сообщения пользователю через менеджер ботов
 * @param {number} orderId 
 * @param {string} message 
 * @returns {Promise<boolean>}
 */
async function sendMessageToUser(orderId, message) {
  if (!globalBotManager) {
    console.error('Bot manager not initialized');
    return false;
  }
  
  return await globalBotManager.sendMessageToUser(orderId, message);
}

module.exports = {
  setBotManager,
  getBotManager,
  getBotInstance,
  sendOrderCompletionNotification,
  sendOrderCancelNotification,
  sendMessageToUser
};
