const OperatorManagerChat = require('../models/OperatorManagerChat');
const SocketService = require('../services/SocketService');

class OperatorManagerChatController {
  parseOperatorId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return null;
    return id;
  }

  async getChats(req, res) {
    try {
      const chats = await OperatorManagerChat.getChatsForViewer({
        viewerRole: req.user.role,
        viewerId: req.user.id,
        search: req.query.search || ''
      });

      res.json({ chats });
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to load chats' });
    }
  }

  async getUnreadCount(req, res) {
    try {
      const count = await OperatorManagerChat.getUnreadCount({
        viewerRole: req.user.role,
        viewerId: req.user.id
      });
      res.json({ count });
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to load unread count' });
    }
  }

  async getAssignmentOptions(req, res) {
    try {
      const data = await OperatorManagerChat.getAssignmentOptions({
        viewerRole: req.user.role,
        viewerId: req.user.id
      });
      res.json(data);
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to load assignment options' });
    }
  }

  async assignManager(req, res) {
    try {
      const operatorId = this.parseOperatorId(req.params.operatorId);
      if (!operatorId) {
        return res.status(400).json({ error: 'Invalid operator id' });
      }

      const rawManagerId = req.body?.manager_id;
      const managerId = rawManagerId === null || rawManagerId === '' || rawManagerId === undefined
        ? null
        : Number(rawManagerId);

      if (managerId !== null && (!Number.isInteger(managerId) || managerId <= 0)) {
        return res.status(400).json({ error: 'Invalid manager id' });
      }

      const assignment = await OperatorManagerChat.assignManager({
        operatorId,
        managerId,
        actorRole: req.user.role,
        actorId: req.user.id
      });

      SocketService.emitOperatorManagerAssignmentUpdated({
        operator_id: assignment.operator_id,
        manager_id: assignment.manager_id
      });

      res.json({
        message: 'Operator manager updated',
        assignment
      });
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to assign manager' });
    }
  }

  async getMessages(req, res) {
    try {
      const operatorId = this.parseOperatorId(req.params.operatorId);
      if (!operatorId) {
        return res.status(400).json({ error: 'Invalid operator id' });
      }

      const limit = Number(req.query.limit || 200);
      const offset = Number(req.query.offset || 0);
      const conversation = await OperatorManagerChat.resolveConversationForViewer({
        viewerRole: req.user.role,
        viewerId: req.user.id,
        operatorId
      });

      const messages = await OperatorManagerChat.getMessages({
        operatorId: conversation.operator.id,
        managerId: conversation.thread_manager_id,
        limit,
        offset
      });

      res.json({
        conversation: {
          operator_id: Number(conversation.operator.id),
          operator_login: conversation.operator.login,
          manager_id: Number(conversation.thread_manager_id || 0) || null,
          manager_login: conversation.manager?.login || null
        },
        messages
      });
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to load messages' });
    }
  }

  async sendMessage(req, res) {
    try {
      const operatorId = this.parseOperatorId(req.params.operatorId);
      if (!operatorId) {
        return res.status(400).json({ error: 'Invalid operator id' });
      }

      const textMessage = String(req.body?.message || '').trim();
      const attachmentPath = req.file ? `/uploads/chats/${req.file.filename}` : null;
      if (!textMessage && !attachmentPath) {
        return res.status(400).json({ error: 'Message cannot be empty' });
      }

      const senderRoleUpper = String(req.user.role || '').toUpperCase();
      let orderId = null;
      const canAttachOrderLink = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes(senderRoleUpper);
      if (canAttachOrderLink) {
        const rawOrderId = req.body?.order_id;
        orderId =
          rawOrderId === undefined || rawOrderId === null || rawOrderId === ''
            ? null
            : Number(rawOrderId);
        if (orderId !== null && (!Number.isInteger(orderId) || orderId <= 0)) {
          return res.status(400).json({ error: 'Invalid order id' });
        }
      }

      const conversation = await OperatorManagerChat.resolveConversationForViewer({
        viewerRole: req.user.role,
        viewerId: req.user.id,
        operatorId
      });

      let message = textMessage;
      if (!message && attachmentPath) {
        const mime = String(req.file?.mimetype || '').toLowerCase();
        message = mime.startsWith('image/') ? 'Изображение' : 'Файл';
      }

      const createdMessage = await OperatorManagerChat.createMessage({
        operatorId: conversation.operator.id,
        managerId: conversation.thread_manager_id,
        senderId: req.user.id,
        senderRole: req.user.role,
        message,
        attachmentsPath: attachmentPath,
        orderId
      });

      SocketService.emitOperatorManagerMessage({
        operator_id: Number(conversation.operator.id),
        manager_id: Number(conversation.thread_manager_id || 0),
        message: createdMessage
      });

      res.json(createdMessage);
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to send message' });
    }
  }

  async markAsRead(req, res) {
    try {
      const operatorId = this.parseOperatorId(req.params.operatorId);
      if (!operatorId) {
        return res.status(400).json({ error: 'Invalid operator id' });
      }

      const conversation = await OperatorManagerChat.resolveConversationForViewer({
        viewerRole: req.user.role,
        viewerId: req.user.id,
        operatorId
      });

      const marked = await OperatorManagerChat.markMessagesAsRead({
        operatorId: conversation.operator.id,
        managerId: conversation.thread_manager_id,
        readerRole: req.user.role
      });

      SocketService.emitOperatorManagerRead({
        operator_id: Number(conversation.operator.id),
        manager_id: Number(conversation.thread_manager_id || 0),
        reader_role: String(req.user.role || '').toUpperCase(),
        reader_id: Number(req.user.id),
        marked
      });

      res.json({ success: true, marked });
    } catch (error) {
      const status = Number(error.statusCode || 500);
      res.status(status).json({ error: error.message || 'Failed to mark messages as read' });
    }
  }
}

module.exports = new OperatorManagerChatController();
