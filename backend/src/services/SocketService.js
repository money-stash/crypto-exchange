/**
 * SocketService - сервис для управления WebSocket событиями
 * обрабатывает обновления в реальном времени для заявок
 */

class SocketService {
  /**
   * отправка события создания новой заявки (только пользователям которые могут ее видеть)
   * @param {Object} order - данные созданной заявки
   */
  static async emitOrderCreated(order) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:created - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:created', order.id);

    // отправляем SUPERADMIN и MANAGER (они видят все заявки)
    global.io.to('role:SUPERADMIN').emit('order:created', order);
    global.io.to('role:MANAGER').emit('order:created', order);

    // отправляем владельцу бота (EX_ADMIN) если у заявки есть bot_id
    if (order.bot_id) {
      global.io.to(`bot:${order.bot_id}`).emit('order:created', order);
    }

    // отправляем всем операторам (они теперь видят все заявки, депозит проверяется при взятии)
    global.io.to('operators').emit('order:created', order);
  }

  /**
   * отправка события обновления заявки (тем у кого уже есть доступ)
   * @param {Object} order - обновленные данные заявки
   */
  static emitOrderUpdated(order) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:updated - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:updated', order.id);

    // отправляем SUPERADMIN и MANAGER
    global.io.to('role:SUPERADMIN').emit('order:updated', order);
    global.io.to('role:MANAGER').emit('order:updated', order);

    // отправляем владельцу бота если у заявки есть bot_id
    if (order.bot_id) {
      global.io.to(`bot:${order.bot_id}`).emit('order:updated', order);
    }

    // отправляем назначенному оператору
    if (order.support_id) {
      global.io.to(`user:${order.support_id}`).emit('order:updated', order);
    }
  }

  /**
   * отправка события изменения статуса заявки
   * @param {Object} data - содержит orderId, oldStatus, newStatus, order (полный объект заявки)
   */
  static emitOrderStatusChanged(data) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:status-changed - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:status-changed', data.orderId);

    // отправляем SUPERADMIN и MANAGER
    global.io.to('role:SUPERADMIN').emit('order:status-changed', data);
    global.io.to('role:MANAGER').emit('order:status-changed', data);

    // отправляем владельцу бота если у заявки есть bot_id
    if (data.order?.bot_id) {
      global.io.to(`bot:${data.order.bot_id}`).emit('order:status-changed', data);
    }

    // отправляем назначенному оператору
    if (data.order?.support_id) {
      global.io.to(`user:${data.order.support_id}`).emit('order:status-changed', data);
    }
  }

    /**
   * отправка события взятия заявки (всем кто может видеть заявки)
   * @param {Object} order - данные взятой заявки
   */
  static async emitOrderTaken(order) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:taken - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:taken', order.id);

    // отправляем SUPERADMIN и MANAGER
    global.io.to('role:SUPERADMIN').emit('order:taken', order);
    global.io.to('role:MANAGER').emit('order:taken', order);

    // отправляем владельцу бота
    if (order.bot_id) {
      global.io.to(`bot:${order.bot_id}`).emit('order:taken', order);
    }

    // отправляем всем операторам (они видят все заявки)
    global.io.to('operators').emit('order:taken', order);
  }

  /**
   * отправка события удаления заявки
   * @param {number} orderId - ID удаленной заявки
   */
  static emitOrderDeleted(orderId) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:deleted - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:deleted', orderId);

    // отправляем всем авторизованным пользователям (они отфильтруют на фронтенде)
    global.io.to('role:SUPERADMIN').emit('order:deleted', orderId);
    global.io.to('role:MANAGER').emit('order:deleted', orderId);
    global.io.to('role:EX_ADMIN').emit('order:deleted', orderId);
    global.io.to('operators').emit('order:deleted', orderId);
  }

  /**
   * отправка события сообщения по заявке
   * @param {Object} message - данные сообщения
   */
  static emitOrderMessage(message) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit order:message - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting order:message for order', message.order_id);

    // отправляем SUPERADMIN и MANAGER
    global.io.to('role:SUPERADMIN').emit('order:message', message);
    global.io.to('role:MANAGER').emit('order:message', message);

    // отправляем владельцу бота если у заявки есть bot_id
    if (message.bot_id) {
      global.io.to(`bot:${message.bot_id}`).emit('order:message', message);
    }

    // отправляем назначенному оператору
    if (message.support_id) {
      global.io.to(`user:${message.support_id}`).emit('order:message', message);
    }
  }

  /**
   * отправка события подтверждения оплаты пользователем
   * @param {Object} data - содержит order (полный объект заявки), telegramUser (данные пользователя)
   */
  static emitUserPaymentConfirmation(data) {
    if (!global.io) {
      console.warn('📡 [Socket] Cannot emit user:payment-confirmation - io not initialized');
      return;
    }

    console.log('📡 [Socket] Emitting user:payment-confirmation for order', data.order.id);

    global.io.to('role:SUPERADMIN').emit('user:payment-confirmation', data);
    global.io.to('role:MANAGER').emit('user:payment-confirmation', data);

    if (data.order.bot_id) {
      global.io.to(`bot:${data.order.bot_id}`).emit('user:payment-confirmation', data);
    }

    if (data.order.support_id) {
      global.io.to(`user:${data.order.support_id}`).emit('user:payment-confirmation', data);
    }

    global.io.to('operators').emit('user:payment-confirmation', data);
  }

  /**
   * Отправка сообщения в чате оператор <-> менеджер
   * @param {{operator_id:number, manager_id:number, message:Object}} payload
   */
  static emitOperatorManagerMessage(payload) {
    if (!global.io) {
      console.warn('[Socket] Cannot emit operator-manager-chat:message - io not initialized');
      return;
    }

    const operatorId = Number(payload?.operator_id || 0);
    const managerId = Number(payload?.manager_id || 0);
    const message = payload?.message || null;

    const eventPayload = {
      operator_id: operatorId,
      manager_id: managerId,
      message
    };

    if (operatorId > 0) {
      global.io.to(`user:${operatorId}`).emit('operator-manager-chat:message', eventPayload);
    }
    if (managerId > 0) {
      global.io.to(`user:${managerId}`).emit('operator-manager-chat:message', eventPayload);
    }
    global.io.to('role:MANAGER').emit('operator-manager-chat:message', eventPayload);
    global.io.to('role:SUPERADMIN').emit('operator-manager-chat:message', eventPayload);
  }

  /**
   * Отметка сообщений прочитанными в чате оператор <-> менеджер
   * @param {{operator_id:number, manager_id:number, reader_role:string, reader_id:number, marked:number}} payload
   */
  static emitOperatorManagerRead(payload) {
    if (!global.io) {
      console.warn('[Socket] Cannot emit operator-manager-chat:read - io not initialized');
      return;
    }

    const operatorId = Number(payload?.operator_id || 0);
    const managerId = Number(payload?.manager_id || 0);
    const eventPayload = {
      operator_id: operatorId,
      manager_id: managerId,
      reader_role: payload?.reader_role || null,
      reader_id: Number(payload?.reader_id || 0),
      marked: Number(payload?.marked || 0)
    };

    if (operatorId > 0) {
      global.io.to(`user:${operatorId}`).emit('operator-manager-chat:read', eventPayload);
    }
    if (managerId > 0) {
      global.io.to(`user:${managerId}`).emit('operator-manager-chat:read', eventPayload);
    }
    global.io.to('role:MANAGER').emit('operator-manager-chat:read', eventPayload);
    global.io.to('role:SUPERADMIN').emit('operator-manager-chat:read', eventPayload);
  }

  /**
   * Обновление назначения менеджера оператору
   * @param {{operator_id:number, manager_id:number|null}} payload
   */
  static emitOperatorManagerAssignmentUpdated(payload) {
    if (!global.io) {
      console.warn('[Socket] Cannot emit operator-manager-chat:assignment-updated - io not initialized');
      return;
    }

    const eventPayload = {
      operator_id: Number(payload?.operator_id || 0),
      manager_id: payload?.manager_id === null || payload?.manager_id === undefined
        ? null
        : Number(payload.manager_id)
    };

    if (eventPayload.operator_id > 0) {
      global.io.to(`user:${eventPayload.operator_id}`).emit('operator-manager-chat:assignment-updated', eventPayload);
    }
    if (eventPayload.manager_id) {
      global.io.to(`user:${eventPayload.manager_id}`).emit('operator-manager-chat:assignment-updated', eventPayload);
    }
    global.io.to('role:SUPERADMIN').emit('operator-manager-chat:assignment-updated', eventPayload);
    global.io.to('role:MANAGER').emit('operator-manager-chat:assignment-updated', eventPayload);
  }

  /**
   * получение количества подключенных клиентов
   * @returns {Number} количество подключенных клиентов
   */
  static getConnectedClientsCount() {
    if (global.io) {
      return global.io.engine.clientsCount || 0;
    }
    return 0;
  }
}

module.exports = SocketService;
