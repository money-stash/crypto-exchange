const OrderService = require('../services/OrderService');
const { logSupportAction } = require('../utils/logger');

class DealController {
  // взять в работу заявку
  async assignDeal(req, res) {
    const { id } = req.params;
    const { support_id } = req.body;
    
    const supportId = support_id || req.user.id;
    
    if (req.user.role === 'OPERATOR' && supportId !== req.user.id) {
      return res.status(403).json({ error: 'Can only assign orders to yourself' });
    }

    await OrderService.assignToSupport(id, supportId);
    
    await logSupportAction(req.user.id, 'order_assigned', { 
      order_id: id, 
      assigned_to: supportId 
    });

    res.json({ success: true, message: 'Order assigned successfully' });
  }

  // отметить оплату
  async markPayment(req, res) {
    const { id } = req.params;
    
    await OrderService.markPayment(id, req.user.id, req.user.role);
    
    res.json({ success: true, message: 'Payment marked' });
  }

  // подтвердить получение оплаты (AWAITING_CONFIRM -> AWAITING_HASH)
  async confirmPayment(req, res) {
    try {
      const { id } = req.params;
      
      await OrderService.confirmPayment(id, req.user.id, req.user.role);
      const orderDetails = await OrderService.getOrderById(id, req.user.role, req.user.id);
      
      res.json({ success: true, message: 'Payment confirmed successfully', orderDetails });
    } catch (error) {
      console.error('Confirm payment error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message || 'Ошибка при подтверждении оплаты' 
      });
    }
  }

  // установить хеш транзакции
  async setTransactionHash(req, res) {
    try {
      const { id } = req.params;
      const { transactionHash } = req.body;
      
      if (!transactionHash || !transactionHash.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: 'Transaction hash is required' 
        });
      }
      
      await OrderService.setTransactionHash(id, transactionHash.trim(), req.user.id, req.user.role);
      const orderDetails = await OrderService.getOrderById(id, req.user.role, req.user.id);
      
      res.json({ success: true, message: 'Transaction hash set successfully', orderDetails });
    } catch (error) {
      console.error('Set transaction hash error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message || 'Ошибка при сохранении хеша транзакции' 
      });
    }
  }

  // завершить заявку
  async completeDeal(req, res) {
    try {
      const { id } = req.params;
      const { transactionHash } = req.body;
      const receiptFile = req.file; // файл загружен через multer
      
      await OrderService.completeOrder(id, req.user.id, transactionHash, receiptFile, req.user.role);
      const orderDetails = await OrderService.getOrderById(id, req.user.role, req.user.id);
      
      res.json({ success: true, message: 'Order completed successfully', orderDetails });
    } catch (error) {
      console.error('Complete deal error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message || 'Ошибка при завершении заявки' 
      });
    }
  }

  // отправить сообщение пользователю через бота
  async sendMessage(req, res) {
    try {
      const { id } = req.params;
      const { message } = req.body;
      
      await logSupportAction(req.user.id, 'message_sent', { 
        order_id: id, 
        message: message.substring(0, 100)
      });

      const { sendMessageToUser } = require('../utils/botManager');
      const messageSent = await sendMessageToUser(id, message);
      
      if (messageSent) {
        res.json({ success: true, message: 'Message sent to user' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to send message to user' });
      }
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Ошибка при отправке сообщения' 
      });
    }
  }
}

module.exports = new DealController();
