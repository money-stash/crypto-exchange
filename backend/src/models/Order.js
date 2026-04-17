const { getConnection } = require('../config/database');
const Rate = require('./Rate');

class Order {
  constructor(data) {
    Object.assign(this, data);
  }

  static roundUsdt(value) {
    return Number(Number(value || 0).toFixed(4));
  }

  static normalizeRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Number(num.toFixed(6));
  }

  static applyOperatorPercent(rateWithMarkupRub, operatorRatePercent = 0) {
    const baseRate = this.normalizeRate(rateWithMarkupRub);
    if (!baseRate) return null;
    const percent = Number(operatorRatePercent);
    const normalizedPercent = Number.isFinite(percent) ? Number(percent.toFixed(4)) : 0;
    return this.normalizeRate(baseRate * (1 + (normalizedPercent / 100)));
  }

  static convertRubToUsdt(sumRub, rateWithMarkupRub) {
    const rub = Number(sumRub || 0);
    const rate = Number(rateWithMarkupRub || 0);
    if (!Number.isFinite(rub) || rub <= 0 || !Number.isFinite(rate) || rate <= 0) {
      return 0;
    }
    return this.roundUsdt(rub / rate);
  }

  // поиск заявки по ид
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT o.*, u.username, u.tg_id, sup.login as support_username, sup.can_write_chat as support_can_write_chat, br.label as exch_label,
             b.identifier as bot_identifier, b.id as bot_id, b.owner_id as bot_owner_id,
             (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') as unread_messages,
             (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.sender_type = 'OPERATOR' AND dm.sender_id = o.support_id) as support_sent_messages
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       LEFT JOIN supports sup ON o.support_id = sup.id
       LEFT JOIN bot_requisites br ON o.exch_req_id = br.id
       LEFT JOIN bots b ON o.bot_id = b.id
       WHERE o.id = ?`,
      [id]
    );

    if (rows.length > 0) {
      const order = new Order(rows[0]);
      return order;
    }
    
    return null;
  }

  // проверка существования заявки по условиям
  static async exists(conditions) {
    const db = getConnection();
    const whereClause = Object.entries(conditions)
      .map(([key, value]) => `${key} = ?`)
      .join(' AND ');
    
    const [rows] = await db.execute(
      `SELECT EXISTS(SELECT 1 FROM orders WHERE ${whereClause}) as exists_flag`,
      Object.values(conditions)
    );
    
    return rows[0].exists_flag === 1;
  }  
  

static async findActiveByUserCoinDir(userId, botId, coin, dir) {
  const db = getConnection();
  const [rows] = await db.execute(
    `SELECT id, unique_id, status
     FROM orders
     WHERE user_id = ?
       AND bot_id = ?
       AND coin = ?
       AND dir = ?
       AND status NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, botId, coin, dir]
  );
  return rows[0] || null;
}

static async findActiveByUserBot(userId, botId) {
  const db = getConnection();
  const [rows] = await db.execute(
    `SELECT id, unique_id, status
     FROM orders
     WHERE user_id = ?
       AND bot_id = ?
       AND status NOT IN ('COMPLETED', 'CANCELLED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, botId]
  );
  return rows[0] || null;
}

  static async getSupportCapacityMetrics(supportId) {
    const db = getConnection();
    const [supportRows] = await db.execute(
      `SELECT id, role, active_limit, deposit_work, rate_percent
          FROM supports
         WHERE id = ?
         LIMIT 1`,
      [supportId]
    );

    if (!supportRows.length) return null;
    const support = supportRows[0];

    const [activeOrderCountRows] = await db.execute(
      `SELECT COALESCE(COUNT(*), 0) AS current_orders
         FROM orders
        WHERE support_id = ?
          AND status IN ('QUEUED', 'PAYMENT_PENDING', 'AWAITING_CONFIRM', 'AWAITING_HASH')`,
      [supportId]
    );

    const [nonBuyActiveRows] = await db.execute(
      `SELECT COALESCE(SUM(sum_rub), 0) AS active_orders_rub
         FROM orders
        WHERE support_id = ?
          AND dir <> 'BUY'
          AND status IN ('QUEUED', 'PAYMENT_PENDING', 'AWAITING_CONFIRM', 'AWAITING_HASH')`,
      [supportId]
    );

    const [openDebtRows] = await db.execute(
      `SELECT COALESCE(SUM(
          CASE
            WHEN o.status = 'CANCELLED' THEN 0
            ELSE (d.usdt_due - d.usdt_paid)
          END
        ), 0) AS open_debt_usdt
         FROM operator_usdt_debts d
         LEFT JOIN orders o ON o.id = d.order_id
        WHERE d.support_id = ?
          AND d.status IN ('OPEN', 'PARTIALLY_PAID')`,
      [supportId]
    );

    let quote;
    try {
      const usdtRate = await Rate.getByCoin('USDT');
      const baseRateRub = this.normalizeRate(usdtRate?.rate_rub);
      if (!baseRateRub) {
        throw new Error('USDT rate is missing');
      }
      quote = {
        source: usdtRate?.src || 'rates_table',
        baseRateRub,
        markupRub: 0,
        rateWithMarkupRub: baseRateRub,
        rate: baseRateRub
      };
    } catch (error) {
      const fallbackRateWithMarkup = Number(process.env.USDT_FALLBACK_RATE_RUB || 100);
      const fallbackBase = Math.max(0.000001, fallbackRateWithMarkup);
      quote = {
        source: 'operator_static_fallback',
        baseRateRub: fallbackBase,
        markupRub: 0,
        rateWithMarkupRub: fallbackRateWithMarkup,
        rate: fallbackBase
      };
      console.warn(`[Order.getSupportCapacityMetrics] Fallback USDT rate used: ${fallbackRateWithMarkup}. Reason: ${error.message}`);
    }
    const operatorRatePercent = Number(support.rate_percent || 0);
    const adjustedRateWithMarkupRub = this.applyOperatorPercent(
      quote.rateWithMarkupRub,
      operatorRatePercent
    );
    const rateWithMarkupRub = Number(adjustedRateWithMarkupRub || 0);

    const nonBuyActiveRub = Number(nonBuyActiveRows[0]?.active_orders_rub || 0);
    const activeOrdersUsdt = this.convertRubToUsdt(nonBuyActiveRub, rateWithMarkupRub);
    const openDebtUsdt = this.roundUsdt(Number(openDebtRows[0]?.open_debt_usdt || 0));
    const depositWorkUsdt = this.roundUsdt(Number(support.deposit_work || 0));
    const occupiedUsdt = this.roundUsdt(activeOrdersUsdt + openDebtUsdt);
    const availableDepositUsdt = this.roundUsdt(depositWorkUsdt - occupiedUsdt);

    return {
      id: Number(support.id),
      role: support.role,
      active_limit: Number(support.active_limit || 0),
      operator_rate_percent: Number(operatorRatePercent || 0),
      rate_with_markup_rub: rateWithMarkupRub,
      deposit_work: depositWorkUsdt,
      deposit_work_usdt: depositWorkUsdt,
      current_amount: activeOrdersUsdt,
      active_orders_usdt: activeOrdersUsdt,
      current_orders: Number(activeOrderCountRows[0]?.current_orders || 0),
      open_debt_usdt: openDebtUsdt,
      occupied_usdt: occupiedUsdt,
      available_deposit: availableDepositUsdt,
      available_deposit_usdt: availableDepositUsdt
    };
  }

  /**
   * Автоотмена заявок, которые не были приняты оператором в течение timeoutMinutes.
   * "Не принята" = support_id IS NULL и статус CREATED/QUEUED.
   * @param {number} timeoutMinutes
   * @returns {Promise<Array<{id:number, unique_id:number, user_id:number, bot_id:number, status:string}>>}
   */
  static async autoCancelUnacceptedOrders(timeoutMinutes = 30) {
    const db = getConnection();

    const [rows] = await db.execute(
      `SELECT id, unique_id, user_id, bot_id, status
       FROM orders
       WHERE support_id IS NULL
         AND status IN ('CREATED', 'QUEUED')
         AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= ?
       ORDER BY created_at ASC`,
      [timeoutMinutes]
    );

    if (!rows.length) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');

    await db.execute(
      `UPDATE orders
       SET status = 'CANCELLED',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id IN (${placeholders})`,
      ids
    );

    return rows;
  }




  // создание заявки
  static async create(orderData) {
    const db = getConnection();
    
    let uniqueId;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!isUnique && attempts < maxAttempts) {
      uniqueId = Math.floor(10000 + Math.random() * 90000);
      
      const [existing] = await db.execute(
        'SELECT id FROM orders WHERE unique_id = ?',
        [uniqueId]
      );
      
      if (existing.length === 0) {
        isUnique = true;
      }
      attempts++;
    }
    
    if (!isUnique) {
      throw new Error('Failed to generate unique order ID after ' + maxAttempts + ' attempts');
    }
    
    const [result] = await db.execute(
      `INSERT INTO orders (unique_id, user_id, user_bot_id, dir, coin, amount_coin, rate_rub, fee, ref_percent, user_discount, sum_rub, status, req_id, user_requisite_id, user_card_number, user_card_holder, user_bank_name, user_crypto_address, exch_card_number, exch_card_holder, exch_bank_name, exch_crypto_address, exch_req_id, bot_id, support_id, support_note, sla_started_at, completed_at, complaint_count) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uniqueId,
        orderData.user_id,
        orderData.user_bot_id || null,
        orderData.dir,
        orderData.coin,
        orderData.amount_coin,
        orderData.rate_rub,
        orderData.fee,
        orderData.ref_percent || 0,
        orderData.user_discount || 0,
        orderData.sum_rub,
        orderData.status || 'CREATED',
        orderData.req_id || null,
        orderData.user_requisite_id || null,
        orderData.user_card_number || null,
        orderData.user_card_holder || null,
        orderData.user_bank_name || null,
        orderData.user_crypto_address || null,
        orderData.exch_card_number || null,
        orderData.exch_card_holder || null,
        orderData.exch_bank_name || null,
        orderData.exch_crypto_address || null,
        orderData.exch_req_id || null,
        orderData.bot_id || null,
        orderData.support_id || null,
        orderData.support_note || null,
        orderData.sla_started_at || null,
        orderData.completed_at || null,
        orderData.complaint_count || 0
      ]
    );
    
    return await Order.findById(result.insertId);
  }

  // обновление статуса заявки
  static async updateStatus(orderId, status) {
    const db = getConnection();
    
    if (status === 'CANCELLED') {
      const [result] = await db.execute(
        'UPDATE orders SET status = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?',
        [status, orderId]
      );
      return result.affectedRows > 0;
    } else {
      const [result] = await db.execute(
        'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, orderId]
      );
      return result.affectedRows > 0;
    }
  }

  static async updateSLAUserPaid(orderId) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE orders SET sla_user_paid_at = NOW() WHERE id = ?',
      [ orderId]
    );
    return result.affectedRows > 0;
  }

  // поиск заявок с фильтрами
  static async search(filters = {}) {
    const db = getConnection();
    let query = `
      SELECT o.*, u.username, u.tg_id, sup.login as support_username,
             b.identifier as bot_identifier, b.id as bot_id, b.owner_id as bot_owner_id,
             (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') as unread_messages
      FROM orders o 
      JOIN users u ON o.user_id = u.id 
      LEFT JOIN supports sup ON o.support_id = sup.id
      LEFT JOIN bots b ON o.bot_id = b.id
      WHERE 1=1`;
    const params = [];

const role = String(filters.user_role || '').toUpperCase();
const currentUserId = Number(filters.user_id);

if (role === 'OPERATOR' && Number.isFinite(currentUserId)) {
  // Жестко: оператор/менеджер через /api/orders видят только свои назначенные заявки
  query += ' AND o.support_id = ?';
  params.push(currentUserId);
}

    if (filters.user_role === 'OPERATOR') {
      query += ` AND (
        o.status != 'CREATED' OR 
        o.status = 'QUEUED' OR 
        EXISTS (
          SELECT 1 FROM deal_messages dm 
          WHERE dm.order_id = o.id 
          AND dm.is_read = 0 
          AND dm.sender_type = 'USER'
        )
      )`;
    } else {
      query += ` AND (o.status != 'CREATED' OR o.status = 'QUEUED' OR EXISTS (
        SELECT 1 FROM deal_messages dm 
        WHERE dm.order_id = o.id 
        AND dm.is_read = 0 
        AND dm.sender_type = 'USER'
      ))`;
    }

    if (filters.status && filters.status.trim() !== '') {
      query += ' AND o.status = ?';
      params.push(filters.status);
    }

    if (filters.coin && filters.coin.trim() !== '') {
      query += ' AND o.coin = ?';
      params.push(filters.coin);
    }

    if (filters.dir && filters.dir.trim() !== '') {
      query += ' AND o.dir = ?';
      params.push(filters.dir);
    }

    if (filters.user_id && filters.user_role === 'USER') {
      query += ' AND o.user_id = ?';
      params.push(parseInt(filters.user_id, 10));
    }

    if (filters.bot_ids && Array.isArray(filters.bot_ids) && filters.bot_ids.length > 0) {
      const placeholders = filters.bot_ids.map(() => '?').join(',');
      query += ` AND o.bot_id IN (${placeholders})`;
      params.push(...filters.bot_ids);
    }

    if (filters.q && filters.q.trim() !== '') {
      const searchTerm = `%${filters.q.trim()}%`;
      if (role === 'OPERATOR') {
        query += ' AND CAST(o.id AS CHAR) LIKE ?';
        params.push(searchTerm);
      } else {
        query += ' AND (u.username LIKE ? OR CAST(u.tg_id AS CHAR) LIKE ? OR CAST(o.id AS CHAR) LIKE ? OR CAST(o.unique_id AS CHAR) LIKE ?)';
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
    }

    if (filters.operator_login && filters.operator_login.trim() !== '') {
      query += ' AND sup.login LIKE ?';
      params.push(`%${filters.operator_login.trim()}%`);
    }

    let countQuery = query.replace(
      /SELECT\s+o\.\*,.*?FROM\s+orders\s+o/s,
      'SELECT COUNT(*) AS total FROM orders o'
    );
    countQuery = countQuery.replace(/ ORDER BY.*$/, '');

    
    const [countRows] = await db.execute(countQuery, params);
    const total = countRows[0].total;

    query += ' ORDER BY o.created_at DESC';

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;
    
    query += ` LIMIT ${limit} OFFSET ${offset}`;

    const [rows] = await db.execute(query, params);

    let supportData = null;
    if (filters.user_role === 'OPERATOR') {
      supportData = await this.getSupportCapacityMetrics(parseInt(filters.user_id, 10));
    }

    const ordersWithChecks = rows.map((row) => {
      const order = new Order(row);
      
      if (filters.user_role === 'OPERATOR') {
        const statusAllowed = ['PAYMENT_PENDING', 'QUEUED', 'CREATED'].includes(row.status);
        const hasUnreadForCreated = row.status !== 'CREATED' || Number(row.unread_messages || 0) > 0;

        if (!supportData || row.support_id || !statusAllowed || !hasUnreadForCreated) {
          order.can_take = false;
          return order;
        }

        if (supportData.role === 'SUPERADMIN') {
          order.can_take = true;
          return order;
        }

        if (supportData.current_orders >= supportData.active_limit) {
          order.can_take = false;
          return order;
        }

        const requiredUsdt = this.convertRubToUsdt(row.sum_rub, supportData.rate_with_markup_rub);
        const availableDeposit = Number(supportData.available_deposit_usdt || supportData.available_deposit || 0);
        order.required_usdt = requiredUsdt;
        order.can_take = requiredUsdt <= availableDeposit;
      } else {
        order.can_take = false;
      }
      
      return order;
    });
  
    return {
      orders: ordersWithChecks,
      total,
      pages: Math.ceil(total / limit),
      page,
      limit
    };
  }

  // получение заявок требующих внимания
  static async getRequiringAttention() {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT o.*, u.username, u.tg_id
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       WHERE o.status IN ('QUEUED', 'PAYMENT_PENDING') 
       ORDER BY o.created_at ASC`
    );
    return rows.map(row => {
      return new Order(row);
    });
  }

  // получение доступных заявок для поддержки
  static async getAvailableForSupport(botIds = null, supportId = null) {
    const db = getConnection();
    let query = `
      SELECT o.*, u.username, u.tg_id,
              (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') as unread_messages
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       WHERE o.support_id IS NULL 
         AND (
           (o.status = 'CREATED' AND (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') > 0)
           OR o.status = 'PAYMENT_PENDING'
           OR o.status = 'QUEUED'
         )`;

    const params = [];
    
    if (botIds && Array.isArray(botIds) && botIds.length > 0) {
      const placeholders = botIds.map(() => '?').join(',');
      query += ` AND o.bot_id IN (${placeholders})`;
      params.push(...botIds);
    }

    query += ' ORDER BY o.created_at ASC';

    const [rows] = await db.execute(query, params);
    
    let operatorInfo = null;
    if (supportId) {
      operatorInfo = await this.getSupportCapacityMetrics(supportId);
    }
    
    return rows.filter(row => {
      if (supportId && operatorInfo) {
        const availableDeposit = Number(operatorInfo.available_deposit_usdt || operatorInfo.available_deposit || 0);
        const requiredUsdt = this.convertRubToUsdt(row.sum_rub, operatorInfo.rate_with_markup_rub);
        row.required_usdt = requiredUsdt;
        return requiredUsdt <= availableDeposit;
      }
      return true;
    }).map(row => {
      const order = new Order(row);
      order.can_take = true;
      return order;
    });
  }

  // проверка возможности взятия заявки оператором
  static async canTakeOrder(orderId, supportId) {
    const db = getConnection();
    
    const [orderRows] = await db.execute(
      'SELECT * FROM orders WHERE id = ?',
      [orderId]
    );
    
    if (orderRows.length === 0) {
      return { canTake: false, reason: 'Order not found' };
    }
    
    const order = orderRows[0];
    
    if (order.support_id) {
      return { canTake: false, reason: 'Order already assigned' };
    }
    
    if (!['PAYMENT_PENDING', 'QUEUED', 'CREATED'].includes(order.status)) {
      return { canTake: false, reason: 'Invalid order status' };
    }
    
    if (order.status === 'CREATED') {
      const [messageRows] = await db.execute(
        'SELECT COUNT(*) as count FROM deal_messages WHERE order_id = ? AND is_read = 0 AND sender_type = "USER"',
        [orderId]
      );
      if (messageRows[0].count === 0) {
        return { canTake: false, reason: 'No unread messages' };
      }
    }
    
    const supportData = await this.getSupportCapacityMetrics(supportId);

    if (!supportData) {
      return { canTake: false, reason: 'Support not found' };
    }

    if (supportData.role === 'SUPERADMIN') {
      return { canTake: true };
    }

    if (supportData.current_orders >= supportData.active_limit) {
      return {
        canTake: false,
        reason: 'Active limit exceeded',
        details: {
          currentOrders: supportData.current_orders,
          activeLimit: supportData.active_limit
        }
      };
    }

    const availableDeposit = Number(supportData.available_deposit_usdt || supportData.available_deposit || 0);
    const requiredUsdt = this.convertRubToUsdt(order.sum_rub, supportData.rate_with_markup_rub);

    if (requiredUsdt > availableDeposit) {

      return { 
        canTake: false, 
        reason: 'Insufficient deposit',
        details: {
          orderAmountRub: Number(order.sum_rub || 0),
          required_usdt: requiredUsdt,
          available_deposit_usdt: availableDeposit,
          deposit_work_usdt: supportData.deposit_work_usdt,
          active_orders_usdt: supportData.active_orders_usdt,
          open_debt_usdt: supportData.open_debt_usdt,
          rate_with_markup_rub: supportData.rate_with_markup_rub
        }
      };
    }
    
    return { canTake: true, details: { required_usdt: requiredUsdt } };
  }

  // назначение заявки оператору
  static async assignToSupport(orderId, supportId) {
    console.log('Assigning order', orderId, 'to support', supportId);
    const db = getConnection();

    const checkResult = await this.canTakeOrder(orderId, supportId);
    console.log(checkResult)
    if (!checkResult.canTake) {
      return { 
        success: false, 
        message: checkResult.reason,
        details: checkResult.details
      };
    }

    const [result] = await db.execute(
      'UPDATE orders SET status = "PAYMENT_PENDING", support_id = ?, updated_at = NOW(), sla_started_at = NOW() WHERE id = ? AND support_id IS NULL',
      [supportId, orderId]
    );
    
    return { 
      success: result.affectedRows > 0,
      message: result.affectedRows > 0 ? 'Order assigned successfully' : 'Failed to assign order'
    };
  }

  // получение заявок оператора
  static async getBySupportId(supportId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT o.*, u.username, u.tg_id,
              (SELECT COUNT(*) FROM deal_messages dm WHERE dm.order_id = o.id AND dm.is_read = 0 AND dm.sender_type = 'USER') as unread_messages
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       WHERE o.support_id = ?
       ORDER BY o.created_at DESC`,
      [supportId]
    );
    return rows.map(row => {
      return new Order(row);
    });
  }

  // назначение заявки оператору с установкой сла
  static async assignSupport(orderId, supportId) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE orders SET support_id = ?, sla_started_at = NOW(), updated_at = NOW() WHERE id = ?',
      [supportId, orderId]
    );
    return result.affectedRows > 0;
  }

  // завершение заявки
  static async complete(orderId) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE orders SET completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [orderId]
    );
    return result.affectedRows > 0;
  }

  // добавление заметки поддержки
  static async addSupportNote(orderId, note) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE orders SET support_note = ?, updated_at = NOW() WHERE id = ?',
      [note, orderId]
    );
    return result.affectedRows > 0;
  }

  // получение заявок с нарушением сла
  static async getSLAViolations() {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT o.*, u.username, u.tg_id,
              TIMESTAMPDIFF(MINUTE, o.sla_started_at, NOW()) as minutes_overdue
       FROM orders o 
       JOIN users u ON o.user_id = u.id 
       WHERE o.sla_started_at IS NOT NULL 
       AND o.completed_at IS NULL 
       AND TIMESTAMPDIFF(MINUTE, o.sla_started_at, NOW()) > 30
       ORDER BY minutes_overdue DESC`
    );
    return rows.map(row => new Order(row));
  }

  // получение метрик оператора
  static async getSupportMetrics(supportId) {
    const db = getConnection();
    
    const [activeRows] = await db.execute(
      `SELECT COUNT(*) as count
       FROM orders o 
       WHERE o.support_id = ? AND o.status IN ('PAYMENT_PENDING')`,
      [supportId]
    );

    const [completedRows] = await db.execute(
      `SELECT COUNT(*) as count
       FROM orders o 
       WHERE o.support_id = ? AND o.status = 'COMPLETED'`,
      [supportId]
    );

    const [slaRows] = await db.execute(
      `SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, o.sla_started_at, COALESCE(o.completed_at, NOW()))), 0) as total_minutes
       FROM orders o 
       WHERE o.support_id = ? AND o.sla_started_at IS NOT NULL`,
      [supportId]
    );

    const totalMinutes = slaRows[0].total_minutes || 0;
    const completedCount = completedRows[0].count || 0;
    const expectedMinutes = completedCount * 30;
    const overdueMinutes = Math.max(0, totalMinutes - expectedMinutes);

    return {
      active_count: activeRows[0].count,
      completed_count: completedCount,
      total_overdue_minutes: overdueMinutes
    };
  }

static async setOrderLogMessageId(orderId, messageId) {
  const db = getConnection();
  const [result] = await db.execute(
    'UPDATE orders SET order_log_message_id = ?, updated_at = NOW() WHERE id = ?',
    [messageId, orderId]
  );
  return result.affectedRows > 0;
}

}


module.exports = Order;
