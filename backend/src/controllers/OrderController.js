const OrderService = require('../services/OrderService');
const User = require('../models/User');
const { getBotManager } = require('../utils/botManager');
const { logUserAction, logSupportAction } = require('../utils/logger');
const SocketService = require('../services/SocketService');

function isInternalRequisitesNote(messageText) {
  const text = String(messageText || '').trim();
  if (!text) return false;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 4) return false;

  const firstLine = lines[0].replace(/["«»]/g, '').trim().toLowerCase();
  const hasDebtTitle = firstLine === 'долг' || firstLine.includes('долг');
  const hasCardLikeLine = lines.some((line) => /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/.test(line));
  const hasBankLikeLine = lines.some((line) => /банк/i.test(line));
  const hasPersonLikeLine = lines.some((line) => /[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+/.test(line));

  return hasDebtTitle && hasCardLikeLine && hasBankLikeLine && hasPersonLikeLine;
}

class OrderController {
  // установка реквизитов для заявки
  async setOrderRequisites(req, res) {
    const { id } = req.params;
    const {
      card_number,
      card_holder,
      bank_name,
      crypto_address,
      label = null,
      sbp_phone = null,
      req_id = null
    } = req.body;
    
    try {
      const result = await OrderService.setOrderRequisites(id, {
        card_number,
        card_holder,
        bank_name,
        crypto_address,
        label,
        sbp_phone,
        req_id
      }, req.user.id, req.user.role, {
        can_edit_requisites: req.user?.can_edit_requisites
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ error: result.message });
      }

      // логируем действие оператора
      await logSupportAction(req.user.id, 'SET_REQUISITES', { orderId: id });


      const updatedOrder = await OrderService.getOrderDetails(id);
      SocketService.emitOrderUpdated(updatedOrder);

      res.json({ success: true, message: 'Requisites updated successfully' });
    } catch (error) {
      console.error('Error setting order requisites:', error);
      res.status(500).json({ error: 'Failed to update requisites' });
    }
  }

  // получение списка заявок с фильтрами
  async getOrders(req, res) {
    const filters = req.query;
    
    filters.user_role = req.user.role;
    filters.user_id = req.user.id;

    const result = await OrderService.getOrders(filters);
    
    if (Array.isArray(result)) {
      res.json({ data: result });
    } else {

      res.json(result);
    }
  }

  // получение списка доступных заявок для взятия оператором
  async getAvailableOrders(req, res) {
    if (req.user.role !== 'OPERATOR' && req.user.role !== 'SUPERADMIN' && 
        req.user.role !== 'MANAGER' && req.user.role !== 'EX_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // для EX_ADMIN получаем только заявки его ботов
    if (req.user.role === 'EX_ADMIN') {
      const { Bot } = require('../models/Bot');
      const botIds = await Bot.getBotIdsByOwner(req.user.id);
      const orders = await OrderService.getAvailableOrdersForSupport(botIds, null, req.user.role, req.user.id);
      return res.json(orders);
    }

    // для операторов передаем их ID для проверки депозита
    const supportId = req.user.role === 'OPERATOR' ? req.user.id : null;
    const orders = await OrderService.getAvailableOrdersForSupport(null, supportId, req.user.role, req.user.id);
    res.json(orders);
  }

  // взять заявку оператором
  async takeOrder(req, res) {
    const { id } = req.params;

    if (req.user.role !== 'OPERATOR' && req.user.role !== 'SUPERADMIN' && 
        req.user.role !== 'MANAGER' && req.user.role !== 'EX_ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const order = await OrderService.getOrderDetails(id);

    // для EX_ADMIN проверяем, принадлежит ли заявка его боту
    if (req.user.role === 'EX_ADMIN') {
      const { Bot } = require('../models/Bot');
      const botIds = await Bot.getBotIdsByOwner(req.user.id);
      
      if (!order.bot_id || !botIds.includes(order.bot_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const assigned = await OrderService.assignOrderToSupport(id, req.user.id);
    
    if (!assigned?.success) {
        const isValidationError = ['Insufficient deposit', 'Active limit exceeded', 'Invalid order status', 'No unread messages'].includes(assigned?.message);
        return res.status(isValidationError ? 400 : 409).json({
          error: assigned?.message || 'Order is already assigned or not available',
          details: assigned?.details || null
        });
    }

    const updatedOrder = await OrderService.getOrderDetails(id);

    SocketService.emitOrderTaken({
      orderId: id,
      unique_id: updatedOrder?.unique_id,
      operatorId: req.user.id,
      operatorName: req.user.username || req.user.login
    });
    SocketService.emitOrderUpdated(updatedOrder);

    res.json({ success: true, message: 'Order assigned successfully' });
  }

  // получение деталей заявки
  async getOrderDetails(req, res) {
    const { id } = req.params;

    const order = await OrderService.getOrderDetails(id, req.user.role, req.user.id);

    if (req.user.role === 'OPERATOR' && order.support_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'EX_ADMIN') {

      const { Bot } = require('../models/Bot');
      const botIds = await Bot.getBotIdsByOwner(req.user.id);
      if (!order.bot_id || !botIds.includes(order.bot_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(order);
  }

  // создание заявки
  async createOrder(req, res) {
    const { tg_id, ...rawOrderData } = req.body;
    const orderData = {
      ...rawOrderData,
      amountCoin: rawOrderData.amountCoin ?? rawOrderData.amount_coin,
      sumRub: rawOrderData.sumRub ?? rawOrderData.sum_rub,
      reqId: rawOrderData.reqId ?? rawOrderData.req_id,
      exchReqId: rawOrderData.exchReqId ?? rawOrderData.exch_req_id,
      userBotId: rawOrderData.userBotId ?? rawOrderData.user_bot_id,
      cryptoAddress: rawOrderData.cryptoAddress ?? rawOrderData.crypto_address,
      cardInfo: rawOrderData.cardInfo ?? rawOrderData.card_info,
      transaction_type: rawOrderData.transaction_type ?? rawOrderData.transactionType,
      inputMode: rawOrderData.inputMode ?? rawOrderData.input_mode
    };

    console.log('📦 [OrderController] Creating order for tg_id:', tg_id);

    let user = await User.findByTgId(tg_id);
    if (!user) {
      user = await User.create({ tg_id });
      console.log('📦 [OrderController] Created new user:', user.id);
    } else {
      console.log('📦 [OrderController] Found existing user:', user.id);
    }

    const order = await OrderService.createOrder({
      userId: user.id,
      ...orderData
    });

    console.log('📦 [OrderController] Order created:', order.id);

    console.log('📦 [OrderController] Emitting socket event for order:', order.id);
    SocketService.emitOrderCreated(order);
    console.log('📦 [OrderController] Socket event emitted');

    res.status(201).json(order);
  }

  // получение котировки
  async getQuote(req, res) {
    const { tg_id, ...rawQuoteData } = req.body;
    const quoteData = {
      ...rawQuoteData,
      amountCoin: rawQuoteData.amountCoin ?? rawQuoteData.amount_coin,
      sumRub: rawQuoteData.sumRub ?? rawQuoteData.sum_rub,
      inputMode: rawQuoteData.inputMode ?? rawQuoteData.input_mode
    };

    const user = await User.findByTgId(tg_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const quote = await OrderService.createQuote({
      userId: user.id,
      ...quoteData
    });

    res.json(quote);
  }

  // подтверждение заявки пользователем
  async confirmOrder(req, res) {
    const { id } = req.params;
    const { tg_id } = req.body;

    const user = await User.findByTgId(tg_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await OrderService.confirmOrder(id, user.id);
    
    await OrderService.autoAssignOrder(id);

    const order = await OrderService.getOrderDetails(id);
    SocketService.emitOrderUpdated(order);

    res.json({ success: true, message: 'Order confirmed and queued' });
  }

  // отмена заявки
  async cancelOrder(req, res) {
    const { id } = req.params;
    const { tg_id, reason } = req.body;

    if (tg_id) {
      const user = await User.findByTgId(tg_id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      await OrderService.cancelOrder(id, user.id, reason);
    } else {
      const order = await OrderService.getOrderDetails(id);
      const canOperatorCancel = Number(req.user?.can_cancel_order ?? 1) === 1;

      if (req.user.role === 'OPERATOR' && !canOperatorCancel) {
        return res.status(403).json({ error: 'Оператору запрещено отменять сделки' });
      }

      if (req.user.role === 'OPERATOR' && order.support_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // После подтверждения оплаты оператором (AWAITING_HASH)
      // оператор больше не может отменять заявку.
      if (req.user.role === 'OPERATOR' && order.status === 'AWAITING_HASH') {
        return res.status(403).json({
          error: 'После подтверждения оплаты оператором отмена заявки недоступна'
        });
      }

      if (req.user.role === 'OPERATOR') {
        const operatorCancelBlockReason = await OrderService.getOperatorCancelBlockReason(order, req.user.id);
        if (operatorCancelBlockReason) {
          return res.status(403).json({ error: operatorCancelBlockReason });
        }
      } else if (req.user.role === 'EX_ADMIN') {
        const { Bot } = require('../models/Bot');
        const botIds = await Bot.getBotIdsByOwner(req.user.id);
        if (!order.bot_id || !botIds.includes(order.bot_id)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
      
      await OrderService.cancelOrder(id, order.user_id, 'support_cancelled', {
        actorRole: req.user.role,
        actorId: req.user.id
      });
      await logSupportAction(req.user.id, 'order_cancelled', { order_id: id, reason });
    }
    const orderDetails = await OrderService.getOrderById(id, req.user?.role, req.user?.id);
    
    SocketService.emitOrderUpdated(orderDetails);
    
    res.json({ success: true, message: 'Order cancelled', orderDetails });
  }

  // получение сообщений чата по заявке
  async getMessages(req, res) {
    try {
      const { id } = req.params;
      const messages = await OrderService.getOrderMessages(id);
      
      if (req.user && (req.user.role === 'OPERATOR' || req.user.role === 'SUPERADMIN')) {
        // SUPERADMIN может читать любой чат заявки, даже если не назначен на нее
        const readerId = req.user.role === 'SUPERADMIN' ? null : req.user.id;
        await OrderService.markMessagesAsRead(id, 'OPERATOR', readerId);
      }
      
      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Ошибка при загрузке сообщений' });
    }
  }

  // отправка сообщения в чат по заявке
  async sendMessage(req, res) {
    try {
      const { id } = req.params;
      const textMessage = String(req.body?.message || '').trim();
      const attachmentPath = req.file ? `/uploads/chats/${req.file.filename}` : null;

      if (!textMessage && !attachmentPath) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
      }

      const canOperatorWriteChat = Number(req.user?.can_write_chat ?? 1) === 1;
      if (req.user.role === 'OPERATOR' && !canOperatorWriteChat) {
        return res.status(403).json({ error: 'Оператору запрещено писать в чат' });
      }

      const order = await OrderService.getOrderById(id);

      const plainMessage = textMessage;
      let fallbackAttachmentLabel = '';
      if (attachmentPath && !plainMessage) {
        const mime = String(req.file?.mimetype || '').toLowerCase();
        fallbackAttachmentLabel = mime.startsWith('image/') ? 'Изображение' : 'Файл';
      }
      const messageData = await OrderService.sendOrderMessage(id, {
        senderId: req.user.id,
        senderType: 'OPERATOR',
        message: plainMessage || fallbackAttachmentLabel,
        attachments_path: attachmentPath,
        chatLanguage: req.user.chat_language
      });

      const botManager = getBotManager();
      const isInternalNote = !attachmentPath && isInternalRequisitesNote(plainMessage);
      const shouldSendToClient = !isInternalNote;

      if (botManager && shouldSendToClient) {
        let sent = false;
        if (attachmentPath && typeof botManager.sendOrderAttachmentToUser === 'function') {
          sent = await botManager.sendOrderAttachmentToUser(id, attachmentPath, plainMessage);
        } else {
          sent = await botManager.sendMessageToUser(id, messageData.message);
        }
        if (!sent) {
          console.warn(`Failed to send Telegram message for order ${id}`);
        }
      } else if (!shouldSendToClient) {
        console.log(`Skipping Telegram delivery for internal order note ${id}`);
      } else {
        console.warn('Bot manager not available');
      }

      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: parseInt(id),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        attachments_path: messageData.attachments_path,
        created_at: messageData.created_at,
        internal_only: !shouldSendToClient,
        bot_id: order.bot_id,
        support_id: order.support_id
      });

      res.json({
        ...messageData,
        internal_only: !shouldSendToClient
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Ошибка при отправке сообщения' });
    }
  }

  // пометка сообщений как прочитанных
  async markMessagesRead(req, res) {
    try {
      const { id } = req.params;
      
      const readerType = (req.user.role === 'OPERATOR' || req.user.role === 'SUPERADMIN') ? 'OPERATOR' : 'USER';
      const readerId = req.user.role === 'SUPERADMIN' ? null : req.user.id;
      const marked = await OrderService.markMessagesAsRead(id, readerType, readerId);
      
      res.json({ success: true, marked });
    } catch (error) {
      console.error('Mark messages read error:', error);
      res.status(500).json({ error: 'Ошибка при пометке сообщений' });
    }
  }

  // получение статистики оператора
  async getOperatorStats(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const stats = await OrderService.getOperatorStats(req.user.id);
      res.json(stats);
    } catch (error) {
      console.error('Get operator stats error:', error);
      res.status(500).json({ error: 'Ошибка при получении статистики' });
    }
  }

  // получение данных для графика оператора
  async getOperatorChartData(req, res) {
    try {
      if (req.user.role !== 'OPERATOR') {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const days = parseInt(req.query.days) || 7; 
      if (days < 1 || days > 365) {
        return res.status(400).json({ error: 'Days must be between 1 and 365' });
      }

      const chartData = await OrderService.getOperatorChartData(req.user.id, days);
      res.json(chartData);
    } catch (error) {
      console.error('Get operator chart data error:', error);
      res.status(500).json({ error: 'Ошибка при получении данных графика' });
    }
  }
}

module.exports = new OrderController();
