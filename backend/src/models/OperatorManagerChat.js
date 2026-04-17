const { getConnection } = require('../config/database');

class OperatorManagerChat {
  static orderContextColumnsAvailable = null;
  static attachmentsColumnAvailable = null;

  static normalizeRole(role) {
    return String(role || '').trim().toUpperCase();
  }

  static parsePositiveInt(value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return null;
    return num;
  }

  static async findSupportById(id) {
    const supportId = this.parsePositiveInt(id);
    if (!supportId) return null;

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT id, login, role, is_active, manager_id
       FROM supports
       WHERE id = ?
       LIMIT 1`,
      [supportId]
    );
    return rows[0] || null;
  }

  static async findOperatorById(id) {
    const supportId = this.parsePositiveInt(id);
    if (!supportId) return null;

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT id, login, role, is_active, manager_id
       FROM supports
       WHERE id = ? AND role = 'OPERATOR'
       LIMIT 1`,
      [supportId]
    );
    return rows[0] || null;
  }

  static async findManagerById(id) {
    const supportId = this.parsePositiveInt(id);
    if (!supportId) return null;

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT id, login, role, is_active
       FROM supports
       WHERE id = ? AND role IN ('MANAGER', 'SUPERADMIN')
       LIMIT 1`,
      [supportId]
    );
    return rows[0] || null;
  }

  static async findDefaultManager() {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT id, login, role, is_active
       FROM supports
       WHERE role IN ('MANAGER', 'SUPERADMIN')
       ORDER BY
         CASE WHEN role = 'SUPERADMIN' THEN 0 ELSE 1 END,
         is_active DESC,
         id ASC
       LIMIT 1`
    );
    return rows[0] || null;
  }

  static async hasOrderContextColumns() {
    if (this.orderContextColumnsAvailable === true) {
      return true;
    }

    const db = getConnection();

    try {
      const [rows] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'operator_manager_messages'
           AND column_name IN ('order_id', 'order_unique_id', 'order_sum_rub')`
      );
      const hasColumnsByInfoSchema = Number(rows?.[0]?.count || 0) >= 3;
      this.orderContextColumnsAvailable = hasColumnsByInfoSchema;
      if (hasColumnsByInfoSchema) return true;
    } catch (error) {
      // fall through to SHOW COLUMNS fallback
    }

    // Some MySQL users may not have access to information_schema.
    // Fallback to SHOW COLUMNS which usually works with table-level access.
    try {
      const [orderIdRows] = await db.query("SHOW COLUMNS FROM operator_manager_messages LIKE 'order_id'");
      const [orderUniqueRows] = await db.query("SHOW COLUMNS FROM operator_manager_messages LIKE 'order_unique_id'");
      const [orderSumRows] = await db.query("SHOW COLUMNS FROM operator_manager_messages LIKE 'order_sum_rub'");
      const hasColumnsByShow = orderIdRows.length > 0 && orderUniqueRows.length > 0 && orderSumRows.length > 0;
      this.orderContextColumnsAvailable = hasColumnsByShow;
      return hasColumnsByShow;
    } catch (error) {
      this.orderContextColumnsAvailable = false;
      return false;
    }
  }

  static async hasAttachmentsColumn() {
    if (this.attachmentsColumnAvailable === true) {
      return true;
    }

    const db = getConnection();

    try {
      const [rows] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'operator_manager_messages'
           AND column_name = 'attachments_path'`
      );
      const hasColumnByInfoSchema = Number(rows?.[0]?.count || 0) >= 1;
      this.attachmentsColumnAvailable = hasColumnByInfoSchema;
      if (hasColumnByInfoSchema) return true;
    } catch (error) {
      // fallback to SHOW COLUMNS
    }

    try {
      const [columnRows] = await db.query("SHOW COLUMNS FROM operator_manager_messages LIKE 'attachments_path'");
      const hasColumnByShow = columnRows.length > 0;
      this.attachmentsColumnAvailable = hasColumnByShow;
      return hasColumnByShow;
    } catch (error) {
      this.attachmentsColumnAvailable = false;
      return false;
    }
  }

  static mapMessage(row) {
    return {
      id: row.id,
      operator_id: row.operator_id,
      manager_id: row.manager_id,
      sender_type: row.sender_type,
      sender_id: row.sender_id,
      sender_login: row.sender_login || null,
      message: row.message,
      attachments_path: row.attachments_path || null,
      order_id: row.order_id ? Number(row.order_id) : null,
      order_unique_id: row.order_unique_id ? Number(row.order_unique_id) : null,
      order_sum_rub: row.order_sum_rub === null || row.order_sum_rub === undefined
        ? null
        : Number(row.order_sum_rub),
      created_at: row.created_at,
      is_read_by_operator: Number(row.is_read_by_operator || 0),
      is_read_by_manager: Number(row.is_read_by_manager || 0)
    };
  }

  static resolveSenderType(role) {
    const normalizedRole = this.normalizeRole(role);
    if (normalizedRole === 'OPERATOR') return 'OPERATOR';
    if (normalizedRole === 'SUPERADMIN') return 'SUPERADMIN';
    return 'MANAGER';
  }

  static async resolveThreadManagerId({ operator, viewerRole, viewerId }) {
    const normalizedViewerRole = this.normalizeRole(viewerRole);
    const normalizedViewerId = this.parsePositiveInt(viewerId);

    if (normalizedViewerRole === 'MANAGER' || normalizedViewerRole === 'SUPERADMIN') {
      const viewerManager = await this.findManagerById(normalizedViewerId);
      if (viewerManager) {
        return Number(viewerManager.id);
      }
    }

    const assignedManagerId = this.parsePositiveInt(operator?.manager_id);
    if (assignedManagerId) {
      const assignedManager = await this.findManagerById(assignedManagerId);
      if (assignedManager) {
        return Number(assignedManager.id);
      }
    }

    const fallbackManager = await this.findDefaultManager();
    if (fallbackManager?.id) {
      return Number(fallbackManager.id);
    }

    const error = new Error('No manager accounts available');
    error.statusCode = 409;
    throw error;
  }

  static async resolveConversationForViewer({ viewerId, viewerRole, operatorId }) {
    const normalizedViewerRole = this.normalizeRole(viewerRole);
    const normalizedViewerId = this.parsePositiveInt(viewerId);
    const normalizedOperatorId = this.parsePositiveInt(operatorId);

    if (!normalizedOperatorId) {
      const error = new Error('Invalid operator id');
      error.statusCode = 400;
      throw error;
    }

    const operator = await this.findOperatorById(normalizedOperatorId);
    if (!operator) {
      const error = new Error('Operator not found');
      error.statusCode = 404;
      throw error;
    }

    if (normalizedViewerRole === 'OPERATOR') {
      if (!normalizedViewerId || normalizedViewerId !== normalizedOperatorId) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }
    } else if (normalizedViewerRole !== 'MANAGER' && normalizedViewerRole !== 'SUPERADMIN') {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const threadManagerId = await this.resolveThreadManagerId({
      operator,
      viewerRole: normalizedViewerRole,
      viewerId: normalizedViewerId
    });

    let manager = await this.findManagerById(normalizedViewerId);
    if (!manager) {
      manager = await this.findManagerById(this.parsePositiveInt(operator.manager_id));
    }
    if (!manager) {
      manager = await this.findManagerById(threadManagerId);
    }

    return {
      operator,
      manager: manager || null,
      thread_manager_id: threadManagerId
    };
  }

  static async getMessages({ operatorId, managerId, limit = 200, offset = 0 }) {
    const normalizedOperatorId = this.parsePositiveInt(operatorId);
    const limitNum = Math.max(1, Math.min(500, Number(limit) || 200));
    const offsetNum = Math.max(0, Number(offset) || 0);

    if (!normalizedOperatorId) {
      return [];
    }

    const hasOrderContextColumns = await this.hasOrderContextColumns();
    const hasAttachmentsColumn = await this.hasAttachmentsColumn();
    const orderFieldsSelect = hasOrderContextColumns
      ? `omm.order_id,
         omm.order_unique_id,
         omm.order_sum_rub,`
      : `NULL AS order_id,
         NULL AS order_unique_id,
         NULL AS order_sum_rub,`;
    const attachmentFieldSelect = hasAttachmentsColumn
      ? 'omm.attachments_path,'
      : 'NULL AS attachments_path,';

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT
         omm.id,
         omm.operator_id,
         omm.manager_id,
         omm.sender_type,
         omm.sender_id,
         omm.message,
         ${attachmentFieldSelect}
         ${orderFieldsSelect}
         omm.created_at,
         omm.is_read_by_operator,
         omm.is_read_by_manager,
         s.login AS sender_login
       FROM operator_manager_messages omm
       LEFT JOIN supports s ON s.id = omm.sender_id
       WHERE omm.operator_id = ?
       ORDER BY omm.created_at ASC, omm.id ASC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      [normalizedOperatorId]
    );

    return rows.map((row) => this.mapMessage(row));
  }

  static async resolveOrderContextForMessage({ orderId, operatorId }) {
    const normalizedOrderId = this.parsePositiveInt(orderId);
    if (!normalizedOrderId) return null;

    const normalizedOperatorId = this.parsePositiveInt(operatorId);
    if (!normalizedOperatorId) {
      const error = new Error('Invalid operator for order link');
      error.statusCode = 400;
      throw error;
    }

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT id, unique_id, sum_rub, support_id
       FROM orders
       WHERE id = ?
       LIMIT 1`,
      [normalizedOrderId]
    );

    const order = rows[0];
    if (!order) {
      const error = new Error('Order not found for message link');
      error.statusCode = 400;
      throw error;
    }

    if (Number(order.support_id || 0) !== normalizedOperatorId) {
      const error = new Error('Order link is not available for this operator');
      error.statusCode = 403;
      throw error;
    }

    return {
      id: Number(order.id),
      unique_id: order.unique_id ? Number(order.unique_id) : null,
      sum_rub: order.sum_rub === null || order.sum_rub === undefined
        ? null
        : Number(order.sum_rub)
    };
  }

  static async createMessage({
    operatorId,
    managerId,
    senderId,
    senderRole,
    message,
    attachmentsPath = null,
    orderId = null
  }) {
    const normalizedOperatorId = this.parsePositiveInt(operatorId);
    const normalizedManagerId = this.parsePositiveInt(managerId);
    const normalizedSenderId = this.parsePositiveInt(senderId);
    const senderType = this.resolveSenderType(senderRole);
    const messageText = String(message || '').trim();
    const normalizedAttachmentsPath = String(attachmentsPath || '').trim() || null;

    if (!normalizedOperatorId || !normalizedManagerId || !normalizedSenderId || (!messageText && !normalizedAttachmentsPath)) {
      const error = new Error('Invalid message payload');
      error.statusCode = 400;
      throw error;
    }

    const isSenderOperator = senderType === 'OPERATOR';
    const readByOperator = isSenderOperator ? 1 : 0;
    const readByManager = isSenderOperator ? 0 : 1;
    const hasOrderContextColumns = await this.hasOrderContextColumns();
    const hasAttachmentsColumn = await this.hasAttachmentsColumn();
    const linkedOrder = hasOrderContextColumns
      ? await this.resolveOrderContextForMessage({
        orderId,
        operatorId: normalizedOperatorId
      })
      : null;

    if (normalizedAttachmentsPath && !hasAttachmentsColumn) {
      const error = new Error('Chat attachments are unavailable until migration is applied');
      error.statusCode = 500;
      throw error;
    }

    const db = getConnection();
    const insertColumns = [
      'operator_id',
      'manager_id',
      'sender_type',
      'sender_id',
      'message'
    ];
    const insertValues = [
      normalizedOperatorId,
      normalizedManagerId,
      senderType,
      normalizedSenderId,
      messageText || ''
    ];

    if (hasAttachmentsColumn) {
      insertColumns.push('attachments_path');
      insertValues.push(normalizedAttachmentsPath);
    }

    if (hasOrderContextColumns) {
      insertColumns.push('order_id', 'order_unique_id', 'order_sum_rub');
      insertValues.push(
        linkedOrder?.id || null,
        linkedOrder?.unique_id || null,
        linkedOrder?.sum_rub || null
      );
    }

    insertColumns.push('is_read_by_operator', 'is_read_by_manager');
    insertValues.push(readByOperator, readByManager);

    const placeholders = insertColumns.map(() => '?').join(', ');
    const [result] = await db.execute(
      `INSERT INTO operator_manager_messages (
         ${insertColumns.join(', ')}
       )
       VALUES (${placeholders})`,
      insertValues
    );

    const orderFieldsSelect = hasOrderContextColumns
      ? `omm.order_id,
         omm.order_unique_id,
         omm.order_sum_rub,`
      : `NULL AS order_id,
         NULL AS order_unique_id,
         NULL AS order_sum_rub,`;
    const attachmentFieldSelect = hasAttachmentsColumn
      ? 'omm.attachments_path,'
      : 'NULL AS attachments_path,';

    const [rows] = await db.execute(
      `SELECT
         omm.id,
         omm.operator_id,
         omm.manager_id,
         omm.sender_type,
         omm.sender_id,
         omm.message,
         ${attachmentFieldSelect}
         ${orderFieldsSelect}
         omm.created_at,
         omm.is_read_by_operator,
         omm.is_read_by_manager,
         s.login AS sender_login
       FROM operator_manager_messages omm
       LEFT JOIN supports s ON s.id = omm.sender_id
       WHERE omm.id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return this.mapMessage(rows[0]);
  }

  static async markMessagesAsRead({ operatorId, managerId, readerRole }) {
    const normalizedOperatorId = this.parsePositiveInt(operatorId);
    const normalizedRole = this.normalizeRole(readerRole);

    if (!normalizedOperatorId) return 0;

    const db = getConnection();
    let result;
    if (normalizedRole === 'OPERATOR') {
      [result] = await db.execute(
        `UPDATE operator_manager_messages
         SET is_read_by_operator = 1
         WHERE operator_id = ?
           AND is_read_by_operator = 0
           AND sender_type IN ('MANAGER', 'SUPERADMIN')`,
        [normalizedOperatorId]
      );
    } else {
      [result] = await db.execute(
        `UPDATE operator_manager_messages
         SET is_read_by_manager = 1
         WHERE operator_id = ?
           AND is_read_by_manager = 0
           AND sender_type = 'OPERATOR'`,
        [normalizedOperatorId]
      );
    }

    return Number(result?.affectedRows || 0);
  }

  static async getUnreadCount({ viewerRole, viewerId }) {
    const normalizedRole = this.normalizeRole(viewerRole);
    const normalizedViewerId = this.parsePositiveInt(viewerId);
    const db = getConnection();

    if (normalizedRole === 'OPERATOR') {
      const [rows] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM operator_manager_messages
         WHERE operator_id = ?
           AND is_read_by_operator = 0
           AND sender_type IN ('MANAGER', 'SUPERADMIN')`,
        [normalizedViewerId]
      );
      return Number(rows[0]?.count || 0);
    }

    if (normalizedRole === 'MANAGER') {
      const [rows] = await db.execute(
        `SELECT COUNT(*) AS count
         FROM operator_manager_messages
         WHERE is_read_by_manager = 0
           AND sender_type = 'OPERATOR'`,
        []
      );
      return Number(rows[0]?.count || 0);
    }

    const [rows] = await db.execute(
      `SELECT COUNT(*) AS count
       FROM operator_manager_messages
       WHERE is_read_by_manager = 0
         AND sender_type = 'OPERATOR'`
    );
    return Number(rows[0]?.count || 0);
  }

  static async getChatsForViewer({ viewerRole, viewerId, search = '' }) {
    const normalizedRole = this.normalizeRole(viewerRole);
    const normalizedSearch = String(search || '').trim();
    const db = getConnection();

    let whereClause = `o.role = 'OPERATOR'`;
    const params = [];

    if (normalizedRole !== 'MANAGER' && normalizedRole !== 'SUPERADMIN') {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    if (normalizedSearch) {
      whereClause += ' AND (o.login LIKE ? OR COALESCE(m.login, \'\') LIKE ?)';
      const wildcard = `%${normalizedSearch}%`;
      params.push(wildcard, wildcard);
    }

    const [rows] = await db.execute(
      `SELECT
         o.id AS operator_id,
         o.login AS operator_login,
         o.is_active AS operator_is_active,
         o.manager_id AS manager_id,
         m.login AS manager_login,
         lm.id AS last_message_id,
         lm.message AS last_message,
         lm.sender_type AS last_sender_type,
         lm.created_at AS last_message_at,
         lo.id AS last_order_id,
         lo.unique_id AS last_order_unique_id,
         lo.sum_rub AS last_order_sum_rub,
         COALESCE(agg.unread_for_manager, 0) AS unread_for_manager,
         COALESCE(agg.unread_for_operator, 0) AS unread_for_operator
       FROM supports o
       LEFT JOIN supports m ON m.id = o.manager_id
        LEFT JOIN (
          SELECT
            mm.operator_id,
            MAX(mm.id) AS last_message_id,
            SUM(CASE WHEN mm.is_read_by_manager = 0 AND mm.sender_type = 'OPERATOR' THEN 1 ELSE 0 END) AS unread_for_manager,
            SUM(CASE WHEN mm.is_read_by_operator = 0 AND mm.sender_type IN ('MANAGER', 'SUPERADMIN') THEN 1 ELSE 0 END) AS unread_for_operator
           FROM operator_manager_messages mm
          GROUP BY mm.operator_id
        ) agg ON agg.operator_id = o.id
        LEFT JOIN operator_manager_messages lm ON lm.id = agg.last_message_id
        LEFT JOIN (
          SELECT ord.id, ord.support_id, ord.unique_id, ord.sum_rub
          FROM orders ord
          INNER JOIN (
            SELECT support_id, MAX(id) AS max_id
            FROM orders
            WHERE support_id IS NOT NULL
            GROUP BY support_id
          ) latest_order ON latest_order.max_id = ord.id
        ) lo ON lo.support_id = o.id
        WHERE ${whereClause}
        ORDER BY
          COALESCE(agg.unread_for_manager, 0) DESC,
          lm.created_at DESC,
          o.login ASC`,
      params
    );

    return rows.map((row) => ({
      operator_id: row.operator_id,
      operator_login: row.operator_login,
      operator_is_active: Number(row.operator_is_active || 0) === 1,
      manager_id: row.manager_id ? Number(row.manager_id) : null,
      manager_login: row.manager_login || null,
      last_message_id: row.last_message_id || null,
      last_message: row.last_message || '',
      last_sender_type: row.last_sender_type || null,
      last_message_at: row.last_message_at || null,
      last_order_id: row.last_order_id ? Number(row.last_order_id) : null,
      last_order_unique_id: row.last_order_unique_id ? Number(row.last_order_unique_id) : null,
      last_order_sum_rub: row.last_order_sum_rub === null || row.last_order_sum_rub === undefined
        ? null
        : Number(row.last_order_sum_rub),
      unread_for_manager: Number(row.unread_for_manager || 0),
      unread_for_operator: Number(row.unread_for_operator || 0)
    }));
  }

  static async getAssignmentOptions({ viewerRole, viewerId }) {
    const normalizedRole = this.normalizeRole(viewerRole);
    const normalizedViewerId = this.parsePositiveInt(viewerId);
    const db = getConnection();

    let managers = [];
    if (normalizedRole === 'SUPERADMIN') {
      const [managerRows] = await db.execute(
        `SELECT id, login, role, is_active
         FROM supports
         WHERE role IN ('MANAGER', 'SUPERADMIN')
         ORDER BY
           CASE WHEN role = 'SUPERADMIN' THEN 0 ELSE 1 END,
           login ASC`
      );
      managers = managerRows;
    } else if (normalizedRole === 'MANAGER') {
      const currentManager = await this.findSupportById(normalizedViewerId);
      if (currentManager) {
        managers = [currentManager];
      }
    } else {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const [operatorRows] = await db.execute(
      `SELECT id, login, is_active, manager_id
       FROM supports
       WHERE role = 'OPERATOR'
       ORDER BY login ASC`
    );

    return {
      managers: managers.map((row) => ({
        id: Number(row.id),
        login: row.login,
        role: row.role,
        is_active: Number(row.is_active || 0) === 1
      })),
      operators: operatorRows.map((row) => ({
        id: Number(row.id),
        login: row.login,
        is_active: Number(row.is_active || 0) === 1,
        manager_id: row.manager_id ? Number(row.manager_id) : null
      }))
    };
  }

  static async assignManager({ operatorId, managerId, actorRole, actorId }) {
    const normalizedOperatorId = this.parsePositiveInt(operatorId);
    const normalizedManagerId = managerId === null ? null : this.parsePositiveInt(managerId);
    const normalizedActorRole = this.normalizeRole(actorRole);
    const normalizedActorId = this.parsePositiveInt(actorId);

    if (!normalizedOperatorId) {
      const error = new Error('Invalid operator id');
      error.statusCode = 400;
      throw error;
    }

    if (normalizedActorRole !== 'SUPERADMIN' && normalizedActorRole !== 'MANAGER') {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const operator = await this.findOperatorById(normalizedOperatorId);
    if (!operator) {
      const error = new Error('Operator not found');
      error.statusCode = 404;
      throw error;
    }

    if (normalizedActorRole === 'MANAGER') {
      if (!normalizedActorId) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }

      if (normalizedManagerId !== normalizedActorId) {
        const error = new Error('Manager can only assign operators to themselves');
        error.statusCode = 403;
        throw error;
      }
    }

    if (normalizedManagerId !== null) {
      const manager = await this.findManagerById(normalizedManagerId);
      if (!manager) {
        const error = new Error('Manager not found');
        error.statusCode = 404;
        throw error;
      }
    } else if (normalizedActorRole !== 'SUPERADMIN') {
      const error = new Error('Only superadmin can unassign operator manager');
      error.statusCode = 403;
      throw error;
    }

    const db = getConnection();
    await db.execute(
      `UPDATE supports
       SET manager_id = ?
       WHERE id = ? AND role = 'OPERATOR'`,
      [normalizedManagerId, normalizedOperatorId]
    );

    const updatedOperator = await this.findOperatorById(normalizedOperatorId);
    return {
      operator_id: Number(updatedOperator.id),
      operator_login: updatedOperator.login,
      manager_id: updatedOperator.manager_id ? Number(updatedOperator.manager_id) : null
    };
  }
}

module.exports = OperatorManagerChat;
