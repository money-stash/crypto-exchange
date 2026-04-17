const Mailing = require('../models/Mailing');
const { getConnection } = require('../config/database');
const { logUserAction } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

class MailingService {
  constructor() {
    this.activeMailings = new Map(); // карта для отслеживания активных рассылок
    this.batchSize = 30; // сообщений в батче
    this.batchDelay = 2000; // задержка между батчами в миллисекундах (2 секунды)
    this.messageDelay = 100; // задержка между отдельными сообщениями в миллисекундах
  }

  /**
   * конвертация текста в HTML для Telegram (с поддержкой старого Markdown формата)
   * @param {string} text - текст с HTML или markdown форматированием
   * @returns {string} - текст в HTML формате
   */
  convertMarkdownToHTML(text) {
    if (!text) return text;
    
    // Если текст уже содержит HTML теги, возвращаем как есть
    if (/<[a-z][\s\S]*>/i.test(text)) {
      return text;
    }
    
    // Иначе конвертируем старый Markdown в HTML (для обратной совместимости)
    return text
      .replace(/\*([^*]+?)\*/g, '<b>$1</b>')
      .replace(/__([^_]+?)__/g, '<u>$1</u>')
      .replace(/_([^_]+?)_/g, '<i>$1</i>')
      .replace(/~([^~]+?)~/g, '<s>$1</s>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');
  }

  /**
   * запуск процесса рассылки для конкретной рассылки
   * @param {number} mailingId - ID рассылки для запуска
   */
  async startMailing(mailingId) {
    try {
      console.log(`Starting mailing process for ID: ${mailingId}`);
      
      const mailing = await Mailing.findById(mailingId);
      if (!mailing) {
        throw new Error(`Mailing with ID ${mailingId} not found`);
      }

      if (mailing.status !== 'active') {
        throw new Error(`Mailing with ID ${mailingId} is not active`);
      }

      // проверяем запущена ли уже рассылка
      if (this.activeMailings.has(mailingId)) {
        console.log(`Mailing ${mailingId} is already running`);
        return;
      }

      // помечаем рассылку как запущенную
      this.activeMailings.set(mailingId, { status: 'running', startTime: Date.now() });

      // запускаем процесс рассылки в фоне
      this.processMailing(mailingId).catch(error => {
        console.error(`Error in mailing process ${mailingId}:`, error);
        this.activeMailings.delete(mailingId);
      });

    } catch (error) {
      console.error(`Error starting mailing ${mailingId}:`, error);
      throw error;
    }
  }

  /**
   * обработка рассылки - отправка сообщений батчами
   * @param {number} mailingId 
   */
  async processMailing(mailingId) {
    try {
      const mailing = await Mailing.findById(mailingId);
      if (!mailing) {
        console.error(`Mailing ${mailingId} not found during processing`);
        return;
      }

      console.log(`Processing mailing ${mailingId}: bot_id=${mailing.bot_id}, total_count=${mailing.total_count}`);

      // получаем пользователей для рассылки
      const users = await this.getUsersForMailing(mailing.bot_id);
      console.log(`Found ${users.length} users for mailing ${mailingId}`);

      if (users.length === 0) {
        console.log(`No users found for mailing ${mailingId}, completing`);
        await Mailing.complete(mailingId);
        this.activeMailings.delete(mailingId);
        return;
      }

      // обрабатываем пользователей батчами
      const totalUsers = users.length;
      let processedUsers = 0;

      for (let i = 0; i < totalUsers; i += this.batchSize) {
        // проверяем активна ли еще рассылка перед обработкой батча
        const currentMailing = await Mailing.findById(mailingId);
        if (!currentMailing || currentMailing.status !== 'active') {
          console.log(`Mailing ${mailingId} was cancelled or completed, stopping`);
          break;
        }

        const batch = users.slice(i, i + this.batchSize);
        console.log(`Processing batch ${Math.floor(i / this.batchSize) + 1} (${batch.length} users) for mailing ${mailingId}`);

        // обрабатываем каждого пользователя в батче
        for (const user of batch) {
          try {
            // проверяем активна ли рассылка перед каждым сообщением
            const mailingCheck = await Mailing.findById(mailingId);
            if (!mailingCheck || mailingCheck.status !== 'active') {
              console.log(`Mailing ${mailingId} was cancelled, stopping batch processing`);
              break;
            }

            // получаем менеджер бота для конкретного пользователя (важно для рассылок с bot_id = 0)
            const userBotId = user.bot_id || mailing.bot_id;
            const botManager = await this.getBotManager(userBotId);
            
            if (!botManager) {
              console.error(`Bot manager not found for bot_id ${userBotId}, user ${user.tg_id}`);
              await Mailing.updateErrorSendCount(mailingId, 1);
              continue;
            }

            // отправляем сообщение пользователю
            const success = await this.sendMessageToUser(botManager, user.tg_id, mailing.text, mailing.attachments);
            
            if (success) {
              await Mailing.updateSendCount(mailingId, 1);
              console.log(`Message sent successfully to user ${user.tg_id} (bot ${userBotId}) for mailing ${mailingId}`);
            } else {
              await Mailing.updateErrorSendCount(mailingId, 1);
              console.log(`Failed to send message to user ${user.tg_id} (bot ${userBotId}) for mailing ${mailingId}`);
            }

            processedUsers++;

            // задержка между отдельными сообщениями
            if (this.messageDelay > 0) {
              await new Promise(resolve => setTimeout(resolve, this.messageDelay));
            }

          } catch (error) {
            console.error(`Error sending message to user ${user.tg_id} for mailing ${mailingId}:`, error);
            await Mailing.updateErrorSendCount(mailingId, 1);
          }
        }

        // задержка между батчами (кроме последнего)
        if (i + this.batchSize < totalUsers) {
          console.log(`Waiting ${this.batchDelay}ms before next batch for mailing ${mailingId}`);
          await new Promise(resolve => setTimeout(resolve, this.batchDelay));
        }
      }

      // проверяем финальный статус и завершаем если нужно
      const finalMailing = await Mailing.findById(mailingId);
      if (finalMailing && finalMailing.status === 'active') {
        const totalSent = finalMailing.send_count + finalMailing.error_send_count;
        if (totalSent >= totalUsers) {
          await Mailing.complete(mailingId);
          console.log(`Mailing ${mailingId} completed. Sent: ${finalMailing.send_count}, Errors: ${finalMailing.error_send_count}`);
        }
      }

      this.activeMailings.delete(mailingId);
      console.log(`Mailing process ${mailingId} finished`);

    } catch (error) {
      console.error(`Error processing mailing ${mailingId}:`, error);
      this.activeMailings.delete(mailingId);
    }
  }

  /**
   * получение пользователей для рассылки на основе bot_id
   * @param {number} botId - ID бота (0 для всех ботов)
   * @returns {Promise<Array>}
   */
  async getUsersForMailing(botId) {
    const db = getConnection();
    let query;
    let params = [];

    if (botId === 0) {
      // для суперадмина - получаем всех пользователей со всех ботов с информацией о bot_id
      query = `
        SELECT DISTINCT u.tg_id, u.id as user_id, ub.bot_id
        FROM user_bots ub 
        JOIN users u ON ub.user_id = u.id 
        WHERE u.is_blocked = 0 AND u.tg_id IS NOT NULL
        GROUP BY u.id, ub.bot_id
        ORDER BY u.id, ub.bot_id
      `;
    } else {
      // для конкретного бота - получаем только пользователей этого бота
      query = `
        SELECT u.tg_id, u.id as user_id, ub.bot_id
        FROM user_bots ub 
        JOIN users u ON ub.user_id = u.id 
        WHERE ub.bot_id = ? AND u.is_blocked = 0 AND u.tg_id IS NOT NULL
      `;
      params = [botId];
    }

    try {
      const [rows] = await db.execute(query, params);
      return rows;
    } catch (error) {
      console.error('Error getting users for mailing:', error);
      return [];
    }
  }

  /**
   * получение менеджера бота для отправки сообщений
   * @param {number} botId 
   * @returns {Promise<Object|null>}
   */
  async getBotManager(botId) {
    try {
      // импортируем утилиту botManager
      const { getBotInstance } = require('../utils/botManager');
      
      if (botId === 0) {
        // для рассылок суперадмина нужно получить любой экземпляр бота
        // или реализовать специальный broadcast бот
        return await getBotInstance(); // получает первый доступный бот
      } else {
        return await getBotInstance(botId);
      }
    } catch (error) {
      console.error(`Error getting bot manager for bot_id ${botId}:`, error);
      return null;
    }
  }

  /**
   * отправка сообщения конкретному пользователю
   * @param {Object} botManager - экземпляр бота
   * @param {number} tgUserId - ID пользователя в Telegram
   * @param {string} text - текст сообщения
   * @param {Array|null} attachments - вложения
   * @returns {Promise<boolean>}
   */
  async sendMessageToUser(botManager, tgUserId, text, attachments) {
    try {
      if (!botManager || !botManager.bot) {
        console.error('Bot manager or bot instance not available');
        return false;
      }

      // Конвертируем Markdown в HTML
      const htmlText = this.convertMarkdownToHTML(text);

      const messageOptions = {
        parse_mode: 'HTML'
      };

      // если есть вложения отправляем их вместе как медиагруппу или по отдельности
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        console.log(`Processing ${attachments.length} attachments:`, attachments.map(a => ({ name: a.name, type: a.type })));
        
        // разделяем вложения по типам:
        // - медиагруппа: фото и видео (можно вместе, до 10 штук)
        // - анимация (GIF): отправляется отдельно, только одна
        // - остальные типы: аудио, документы - отправляются отдельно
        const mediaGroupAttachments = attachments.filter(att => 
          att.type === 'image' || att.type === 'video'
        );
        const animationAttachments = attachments.filter(att => 
          att.type === 'animation'
        );
        const otherAttachments = attachments.filter(att => 
          att.type !== 'image' && att.type !== 'video' && att.type !== 'animation'
        );

        console.log(`Media group (photo/video): ${mediaGroupAttachments.length}`, mediaGroupAttachments.map(a => ({ name: a.name, type: a.type })));
        console.log(`Animations (GIF): ${animationAttachments.length}`, animationAttachments.map(a => ({ name: a.name, type: a.type })));
        console.log(`Other attachments: ${otherAttachments.length}`, otherAttachments.map(a => ({ name: a.name, type: a.type })));

        // 1. отправляем медиагруппу (фото + видео вместе) если их больше 1
        if (mediaGroupAttachments.length > 1) {
          try {
            const media = await this.prepareMediaGroup(mediaGroupAttachments, htmlText);
            await botManager.bot.telegram.sendMediaGroup(tgUserId, media);
            console.log(`Sent ${media.length} attachments as media group to user ${tgUserId}`);
          } catch (error) {
            console.error(`Error sending media group to user ${tgUserId}:`, error);
            // запасной вариант: отправляем вложения по одному
            for (let i = 0; i < mediaGroupAttachments.length; i++) {
              const attachment = mediaGroupAttachments[i];
              try {
                await this.sendAttachmentWithCaption(botManager.bot, tgUserId, attachment, i === 0 ? htmlText : '');
                await new Promise(resolve => setTimeout(resolve, 300));
              } catch (err) {
                console.error(`Error sending attachment ${attachment.name}:`, err);
              }
            }
          }
        } else if (mediaGroupAttachments.length === 1) {
          // одно изображение/видео - отправляем с текстом как подпись
          await this.sendAttachmentWithCaption(botManager.bot, tgUserId, mediaGroupAttachments[0], htmlText);
          console.log(`Sent single attachment ${mediaGroupAttachments[0].name} with text to user ${tgUserId}`);
        } else if (htmlText && htmlText.trim() && animationAttachments.length === 0 && otherAttachments.length === 0) {
          // вообще нет вложений но есть текст
          await botManager.bot.telegram.sendMessage(tgUserId, htmlText, messageOptions);
        }

        // 2. отправляем анимации (GIF) - всегда отдельно с текстом если не была отправлена медиагруппа
        for (let i = 0; i < animationAttachments.length; i++) {
          const attachment = animationAttachments[i];
          try {
            // отправляем GIF с текстом только если это первое вложение и не было медиагруппы
            const captionText = (i === 0 && mediaGroupAttachments.length === 0) ? htmlText : '';
            await this.sendAttachmentWithCaption(botManager.bot, tgUserId, attachment, captionText);
            console.log(`Sent animation ${attachment.name} to user ${tgUserId}`);
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.error(`Error sending animation ${attachment.name}:`, error);
          }
        }

        // 3. отправляем остальные типы (аудио, документы) отдельно
        for (const attachment of otherAttachments) {
          try {
            await this.sendAttachmentWithCaption(botManager.bot, tgUserId, attachment, '');
            console.log(`Sent ${attachment.type} attachment ${attachment.name} to user ${tgUserId}`);
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.error(`Error sending ${attachment.type} attachment ${attachment.name}:`, error);
          }
        }

        // 4. если не было медиагруппы и анимаций с подписью отправляем текст отдельно
        if (mediaGroupAttachments.length === 0 && animationAttachments.length === 0 && htmlText && htmlText.trim() && otherAttachments.length > 0) {
          await botManager.bot.telegram.sendMessage(tgUserId, htmlText, messageOptions);
        }
      } else {
        // нет вложений, просто отправляем текстовое сообщение
        if (htmlText && htmlText.trim()) {
          await botManager.bot.telegram.sendMessage(tgUserId, htmlText, messageOptions);
        }
      }

      return true;

    } catch (error) {
      // проверяем связана ли ошибка с блокировкой бота пользователем или другими ожидаемыми ошибками
      if (error.code === 403 || error.description?.includes('blocked') || error.description?.includes('user is deactivated')) {
        console.log(`User ${tgUserId} has blocked the bot or deactivated account`);
        return false;
      }
      
      console.error(`Error sending message to user ${tgUserId}:`, error);
      return false;
    }
  }

  /**
   * подготовка медиагруппы для отправки
   * @param {Array} attachments - массив вложений
   * @param {string} caption - подпись для первого медиа
   * @returns {Promise<Array>}
   */
  async prepareMediaGroup(attachments, caption) {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const media = [];

    console.log(`Preparing media group with ${attachments.length} attachments`);

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const filePath = path.join(uploadsDir, attachment.path);

      const mediaItem = {
        type: attachment.type === 'video' ? 'video' : 'photo',
        media: { source: filePath }
      };

      console.log(`Media item ${i}: type=${attachment.type} -> telegram_type=${mediaItem.type}, file=${attachment.name}`);

      // добавляем подпись только к первому элементу
      if (i === 0 && caption && caption.trim()) {
        mediaItem.caption = caption;
        mediaItem.parse_mode = 'HTML';
      }

      media.push(mediaItem);
    }

    console.log(`Media group prepared with ${media.length} items`);
    return media;
  }

  /**
   * отправка вложения с подписью пользователю
   * @param {Object} bot - экземпляр бота
   * @param {number} tgUserId - ID пользователя в Telegram
   * @param {Object} attachment - объект вложения
   * @param {string} caption - подпись к сообщению
   * @returns {Promise<void>}
   */
  async sendAttachmentWithCaption(bot, tgUserId, attachment, caption) {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const filePath = path.join(uploadsDir, attachment.path);

    try {
      // проверяем существует ли файл и получаем его статистику
      const stats = await fs.stat(filePath);
      console.log(`Sending file: ${filePath}, size: ${stats.size} bytes, type: ${attachment.type}`);

      // проверяем что файл не пустой
      if (stats.size === 0) {
        throw new Error(`File is empty: ${attachment.name}`);
      }

      // читаем файл чтобы убедиться что он валидный
      const fileBuffer = await fs.readFile(filePath);
      console.log(`File read successfully, buffer size: ${fileBuffer.length}`);

      const options = {
        parse_mode: 'HTML'
      };

      if (caption && caption.trim()) {
        options.caption = caption; // текст уже конвертирован в HTML в sendMessageToUser
      }

      // определяем тип сообщения на основе нашей классификации типов файлов
      switch (attachment.type) {
        case 'image':
          console.log(`Sending image: ${attachment.name}`);
          await bot.telegram.sendPhoto(tgUserId, { source: filePath }, options);
          break;
        case 'animation':
          console.log(`Sending animation: ${attachment.name}`);
          await bot.telegram.sendAnimation(tgUserId, { source: filePath }, options);
          break;
        case 'video':
          console.log(`Sending video: ${attachment.name}`);
          await bot.telegram.sendVideo(tgUserId, { source: filePath }, options);
          break;
        case 'audio':
          console.log(`Sending audio: ${attachment.name}`);
          await bot.telegram.sendAudio(tgUserId, { source: filePath }, options);
          break;
        default:
          console.log(`Sending document: ${attachment.name}`);
          // отправляем как документ для остальных типов файлов
          await bot.telegram.sendDocument(tgUserId, { source: filePath }, options);
          break;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`Attachment file not found: ${filePath}`);
        throw new Error(`File not found: ${attachment.name}`);
      }
      console.error(`Error sending attachment ${attachment.name}:`, error);
      throw error;
    }
  }

  /**
   * остановка конкретной рассылки
   * @param {number} mailingId 
   */
  async stopMailing(mailingId) {
    try {
      await Mailing.cancel(mailingId);
      this.activeMailings.delete(mailingId);
      console.log(`Mailing ${mailingId} stopped`);
    } catch (error) {
      console.error(`Error stopping mailing ${mailingId}:`, error);
    }
  }

  /**
   * получение статуса активных рассылок
   * @returns {Object}
   */
  getActiveMailingsStatus() {
    const status = {};
    for (const [mailingId, info] of this.activeMailings) {
      status[mailingId] = {
        status: info.status,
        startTime: info.startTime,
        duration: Date.now() - info.startTime
      };
    }
    return status;
  }

  /**
   * запуск обработки всех активных рассылок (при перезапуске сервиса)
   */
  async startAllActiveMailings() {
    try {
      const activeMailings = await Mailing.getActive();
      console.log(`Found ${activeMailings.length} active mailings to restart`);

      for (const mailing of activeMailings) {
        if (!this.activeMailings.has(mailing.id)) {
          console.log(`Restarting mailing ${mailing.id}`);
          await this.startMailing(mailing.id);
        }
      }
    } catch (error) {
      console.error('Error starting active mailings:', error);
    }
  }
}

module.exports = new MailingService();