const SupportChat = require('../models/SupportChat');
const { asyncHandler } = require('../middleware/errorHandler');

class SupportChatController {
  /**
   * Получить список всех чатов с пользователями
   */
  async getChats(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50,
        botId = null,
        hasUnread = null 
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      const options = {
        limit: parseInt(limit),
        offset: offset,
        botId: botId ? parseInt(botId) : null,
        hasUnread: hasUnread === 'true' ? true : null
      };

      const chats = await SupportChat.getAllWithDetails(options);
      const total = await SupportChat.getCount(options);

      res.json({
        chats,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      });
    } catch (error) {
      console.error('Get chats error:', error);
      res.status(500).json({ error: 'Ошибка при получении чатов' });
    }
  }

  /**
   * Получить чат по ID с сообщениями
   */
  async getChatById(req, res) {
    try {
      const { chatId } = req.params;
      const chat = await SupportChat.findById(chatId);

      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      const messages = await SupportChat.getMessages(chatId);

      res.json({
        chat,
        messages
      });
    } catch (error) {
      console.error('Get chat by ID error:', error);
      res.status(500).json({ error: 'Ошибка при получении чата' });
    }
  }

  /**
   * Получить сообщения чата
   */
  async getMessages(req, res) {
    try {
      const { chatId } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      const messages = await SupportChat.getMessages(chatId, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Ошибка при получении сообщений' });
    }
  }

  /**
   * Отправить сообщение в чат
   */
  async sendMessage(req, res) {
    try {
      const { chatId } = req.params;
      const { message } = req.body;
      const user = req.user; // из middleware auth

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
      }

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      const messageData = {
        senderType: 'OPERATOR',
        senderId: user.id,
        message: message.trim(),
        attachmentsPath: null
      };

      const newMessage = await SupportChat.addMessage(chatId, messageData);

      // Отправляем событие через Socket.IO
      const io = req.app.get('io');
      if (io) {
        console.log('📤 [Socket] Emitting support-chat:message:', {
          chatId: parseInt(chatId),
          messageId: newMessage.id,
          senderType: newMessage.sender_type
        });
        io.emit('support-chat:message', {
          chatId: parseInt(chatId),
          message: newMessage
        });
      } else {
        console.error('❌ [Socket] IO not available!');
      }

      // Отправляем сообщение пользователю через Telegram
      const { getBotManager } = require('../utils/botManager');
      const botManager = getBotManager();
      if (botManager) {
        await botManager.sendSupportMessageToUser(
          chatId, 
          message.trim(),
          user.login
        );
      }

      res.json(newMessage);
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Ошибка при отправке сообщения' });
    }
  }

  /**
   * Пометить сообщения как прочитанные
   */
  async markAsRead(req, res) {
    try {
      const { chatId } = req.params;

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      await SupportChat.markMessagesAsRead(chatId, 'OPERATOR');

      // Отправляем событие через Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.emit('support-chat:read', {
          chatId: parseInt(chatId)
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({ error: 'Ошибка при обновлении статуса' });
    }
  }

  /**
   * Получить количество непрочитанных чатов
   */
  async getUnreadCount(req, res) {
    try {
      const count = await SupportChat.getUnreadChatsCount();
      res.json({ count });
    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({ error: 'Ошибка при получении количества непрочитанных' });
    }
  }

  /**
   * Загрузить изображение в чат
   */
  async uploadImage(req, res) {
    try {
      const { chatId } = req.params;
      const user = req.user;

      if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
      }

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      // Путь к файлу относительно корня проекта
      const filePath = `/uploads/support-chats/${req.file.filename}`;

      const messageData = {
        senderType: 'OPERATOR',
        senderId: user.id,
        message: '[Изображение]',
        attachmentsPath: JSON.stringify([filePath])
      };

      const newMessage = await SupportChat.addMessage(chatId, messageData);

      // Отправляем событие через Socket.IO
      const io = req.app.get('io');
      if (io) {
        console.log('📤 [Socket] Emitting support-chat:message with image:', {
          chatId: parseInt(chatId),
          messageId: newMessage.id,
          hasAttachment: true
        });
        io.emit('support-chat:message', {
          chatId: parseInt(chatId),
          message: newMessage
        });
      }

      // Отправляем изображение пользователю через Telegram
      const { getBotManager } = require('../utils/botManager');
      const botManager = getBotManager();
      if (botManager) {
        const fullPath = require('path').join(__dirname, '../..', filePath);
        await botManager.sendSupportImageToUser(chatId, fullPath, user.login);
      }

      res.json(newMessage);
    } catch (error) {
      console.error('Upload image error:', error);
      res.status(500).json({ error: 'Ошибка при загрузке изображения' });
    }
  }

  /**
   * Отправить событие "печатает"
   */
  async sendTypingEvent(req, res) {
    try {
      const { chatId } = req.params;
      const { isTyping } = req.body;
      const user = req.user; // из middleware auth

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      // Отправляем событие через Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.emit('support-chat:typing', {
          chatId: parseInt(chatId),
          operatorId: user.id,
          operatorLogin: user.login,
          isTyping: !!isTyping
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Send typing event error:', error);
      res.status(500).json({ error: 'Ошибка при отправке события' });
    }
  }

  /**
   * Удалить чат
   */
  async deleteChat(req, res) {
    try {
      const { chatId } = req.params;

      const chat = await SupportChat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: 'Чат не найден' });
      }

      await SupportChat.delete(chatId);

      // Отправляем событие через Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.emit('support-chat:deleted', {
          chatId: parseInt(chatId)
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Delete chat error:', error);
      res.status(500).json({ error: 'Ошибка при удалении чата' });
    }
  }
}

module.exports = new SupportChatController();
