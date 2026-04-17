const { getConnection } = require('../config/database');
const SystemSetting = require('../models/SystemSetting');
const TronScanService = require('./TronScanService');

const USDT_COMPARE_TOLERANCE = 0.0001;
const REQUIRED_CONFIRMATIONS = 10;

class OperatorDebtService {
  roundUsdt(value) {
    return Number(Number(value).toFixed(4));
  }

  roundRub(value) {
    return Number(Number(value).toFixed(2));
  }

  normalizeRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Number(num.toFixed(6));
  }

  normalizePercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Number(num.toFixed(4));
  }

  applyOperatorPercent(rateWithMarkupRub, operatorRatePercent = 0) {
    const baseRate = this.normalizeRate(rateWithMarkupRub);
    if (!baseRate) return null;
    const percent = this.normalizePercent(operatorRatePercent);
    return this.normalizeRate(baseRate * (1 + (percent / 100)));
  }

  normalizeAddress(address) {
    return String(address || '').trim().toLowerCase();
  }

  async getCompanyWallet() {
    const wallet = await SystemSetting.getValue('company_usdt_wallet_trc20', '');
    return String(wallet || '').trim();
  }

  buildQrPayload(wallet, exactUsdt) {
    const safeWallet = String(wallet || '').trim();
    const amount = this.roundUsdt(exactUsdt);
    return `tron:${safeWallet}?amount=${amount}&token=USDT`;
  }

  buildQrUrl(payload) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(payload)}`;
  }

  buildIntentResponse(intentRow) {
    if (!intentRow) return null;
    const exactUsdt = Number(intentRow.exact_usdt || 0);
    const wallet = String(intentRow.company_wallet || '').trim();
    const qrPayload = this.buildQrPayload(wallet, exactUsdt);

    return {
      ...intentRow,
      requested_usdt: Number(intentRow.requested_usdt || 0),
      exact_usdt: exactUsdt,
      qr_payload: qrPayload,
      qr_url: this.buildQrUrl(qrPayload)
    };
  }

  async createDebtSnapshotForOrder(order, baseRateRub, markupRub = 0, operatorRatePercent = null) {
    if (!order || order.dir !== 'BUY') return null;
    if (!order.support_id) throw new Error('Order must be assigned to operator');

    const db = getConnection();
    const sumRub = Number(order.sum_rub);
    const rate = Number(baseRateRub);
    const markup = Number(markupRub);

    if (!Number.isFinite(sumRub) || sumRub <= 0) {
      throw new Error('Invalid order sum for debt snapshot');
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Invalid market rate');
    }
    if (!Number.isFinite(markup) || markup < 0) {
      throw new Error('Invalid markup');
    }

    let resolvedOperatorRatePercent = operatorRatePercent;
    if (resolvedOperatorRatePercent === null || resolvedOperatorRatePercent === undefined) {
      const [supportRows] = await db.execute(
        `SELECT rate_percent FROM supports WHERE id = ? LIMIT 1`,
        [order.support_id]
      );
      resolvedOperatorRatePercent = Number(supportRows[0]?.rate_percent || 0);
    }

    const denominator = this.applyOperatorPercent(
      rate + markup,
      resolvedOperatorRatePercent
    );
    if (denominator <= 0) {
      throw new Error('Invalid denominator for USDT due');
    }

    const usdtDue = this.roundUsdt(sumRub / denominator);
    if (usdtDue <= 0) {
      throw new Error('Calculated USDT debt must be positive');
    }

    await db.execute(
      `INSERT INTO operator_usdt_debts
         (support_id, order_id, sum_rub_locked, rapira_rate_rub, markup_rub, usdt_due, usdt_paid, rub_released, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'OPEN', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         support_id = support_id,
         order_id = order_id`,
      [order.support_id, order.id, sumRub, rate, markup, usdtDue]
    );

    const [rows] = await db.execute(
      `SELECT * FROM operator_usdt_debts WHERE order_id = ? LIMIT 1`,
      [order.id]
    );
    return rows[0] || null;
  }

  async expireIntentsForSupport(supportId) {
    const db = getConnection();
    await db.execute(
      `UPDATE operator_usdt_payment_intents
          SET status = 'EXPIRED'
        WHERE support_id = ?
          AND status = 'OPEN'
          AND expires_at < NOW()`,
      [supportId]
    );
  }

  async expireAllOpenIntents() {
    const db = getConnection();
    await db.execute(
      `UPDATE operator_usdt_payment_intents
          SET status = 'EXPIRED'
        WHERE status = 'OPEN'
          AND expires_at < NOW()`
    );
  }

  async getAggregateDebt(supportId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT
          COALESCE(SUM(d.usdt_due), 0) AS usdt_due_total,
          COALESCE(SUM(d.usdt_paid), 0) AS usdt_paid_total,
          COALESCE(SUM(d.usdt_due - d.usdt_paid), 0) AS usdt_open_total,
          COALESCE(SUM(d.sum_rub_locked), 0) AS rub_locked_total,
          COALESCE(SUM(d.rub_released), 0) AS rub_released_total,
          COALESCE(SUM(d.sum_rub_locked - d.rub_released), 0) AS rub_open_total
       FROM operator_usdt_debts d
       LEFT JOIN orders o ON o.id = d.order_id
       WHERE d.support_id = ?
         AND d.status IN ('OPEN', 'PARTIALLY_PAID')
         AND (o.id IS NULL OR o.status <> 'CANCELLED')`,
      [supportId]
    );

    const wallet = await this.getCompanyWallet();
    const totals = rows[0] || {};

    return {
      support_id: supportId,
      company_wallet: wallet,
      usdt_due_total: Number(totals.usdt_due_total || 0),
      usdt_paid_total: Number(totals.usdt_paid_total || 0),
      usdt_open_total: Number(totals.usdt_open_total || 0),
      rub_locked_total: Number(totals.rub_locked_total || 0),
      rub_released_total: Number(totals.rub_released_total || 0),
      rub_open_total: Number(totals.rub_open_total || 0)
    };
  }

  async createPaymentIntent(supportId, requestedUsdt) {
    await this.expireIntentsForSupport(supportId);

    const db = getConnection();
    const aggregate = await this.getAggregateDebt(supportId);
    const maxPayable = Number(aggregate.usdt_open_total || 0);

    if (maxPayable <= 0) {
      throw new Error('No open USDT debt');
    }

    const requested = Number(requestedUsdt);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error('requested_usdt must be positive');
    }

    let base = Math.min(requested, maxPayable);
    base = Number(base.toFixed(4));
    if (base <= 0) {
      throw new Error('Requested amount is too small');
    }

    const wallet = aggregate.company_wallet;
    if (!wallet) {
      throw new Error('Company USDT wallet is not configured');
    }

    const expiresMinutes = Number(process.env.USDT_INTENT_TTL_MINUTES || 20);
    const [result] = await db.execute(
      `INSERT INTO operator_usdt_payment_intents
         (support_id, requested_usdt, exact_usdt, company_wallet, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, 'OPEN', DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())`,
      [supportId, requested, requested, wallet, expiresMinutes]
    );

    const intentId = result.insertId;
    const uniqueTail = ((intentId % 900) + 100) / 10000; // 0.0100..0.0999
    let exact = this.roundUsdt(base - uniqueTail);

    if (exact <= 0 || exact > maxPayable) {
      const micro = ((intentId % 9) + 1) / 10000; // fallback tiny offset (4 decimals)
      exact = this.roundUsdt(Math.min(maxPayable, base + micro));
    }

    if (exact <= 0) {
      throw new Error('Unable to generate exact USDT amount for intent');
    }

    await db.execute(
      `UPDATE operator_usdt_payment_intents
          SET exact_usdt = ?
        WHERE id = ?`,
      [exact, intentId]
    );

    const [rows] = await db.execute(
      `SELECT id, support_id, requested_usdt, exact_usdt, company_wallet, status, expires_at, created_at
         FROM operator_usdt_payment_intents
        WHERE id = ? LIMIT 1`,
      [intentId]
    );

    return this.buildIntentResponse(rows[0]);
  }

  async getIntentWithPayment(supportId, intentId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT i.*,
              p.id AS payment_id,
              p.tx_hash AS payment_tx_hash,
              p.status AS payment_status,
              p.confirmations AS payment_confirmations,
              p.actual_amount_usdt AS payment_actual_amount_usdt,
              p.reject_reason AS payment_reject_reason,
              p.created_at AS payment_created_at,
              p.confirmed_at AS payment_confirmed_at
         FROM operator_usdt_payment_intents i
         LEFT JOIN operator_usdt_payments p ON p.intent_id = i.id
         WHERE i.id = ?
           AND i.support_id = ?
         ORDER BY p.created_at DESC
         LIMIT 1`,
      [intentId, supportId]
    );

    if (!rows.length) {
      return { intent: null, payment: null };
    }

    const row = rows[0];
    const intent = this.buildIntentResponse({
      id: row.id,
      support_id: row.support_id,
      requested_usdt: row.requested_usdt,
      exact_usdt: row.exact_usdt,
      company_wallet: row.company_wallet,
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      consumed_at: row.consumed_at
    });

    const payment = row.payment_id ? {
      id: row.payment_id,
      tx_hash: row.payment_tx_hash,
      status: row.payment_status,
      confirmations: Number(row.payment_confirmations || 0),
      actual_amount_usdt: row.payment_actual_amount_usdt !== null ? Number(row.payment_actual_amount_usdt) : null,
      reject_reason: row.payment_reject_reason,
      created_at: row.payment_created_at,
      confirmed_at: row.payment_confirmed_at
    } : null;

    return { intent, payment };
  }

  async findMatchingTransferForIntent(intent) {
    if (!intent) return null;

    const expectedAmount = Number(intent.exact_usdt);
    const wallet = String(intent.company_wallet || '').trim();
    if (!expectedAmount || !wallet) return null;

    const createdAtMs = new Date(intent.created_at).getTime();
    const expiresAtMs = new Date(intent.expires_at).getTime();
    const sinceMs = Number.isFinite(createdAtMs) ? Math.max(0, createdAtMs - (5 * 60 * 1000)) : 0;

    const transfers = await TronScanService.listRecentUsdtTransfersByAddress(wallet, {
      sinceMs,
      limit: 300
    });

    const db = getConnection();
    const normalizedWallet = this.normalizeAddress(wallet);
    const candidates = transfers
      .filter((tx) => {
        if (Math.abs(Number(tx.amountUsdt) - expectedAmount) > USDT_COMPARE_TOLERANCE) {
          return false;
        }

        if (normalizedWallet && this.normalizeAddress(tx.toAddress) !== normalizedWallet) {
          return false;
        }

        if (Number.isFinite(createdAtMs) && tx.timestampMs && tx.timestampMs < createdAtMs) {
          return false;
        }

        if (Number.isFinite(expiresAtMs) && tx.timestampMs && tx.timestampMs > expiresAtMs) {
          return false;
        }

        return true;
      })
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

    for (const tx of candidates) {
      const [existsRows] = await db.execute(
        `SELECT id FROM operator_usdt_payments WHERE tx_hash = ? LIMIT 1`,
        [tx.txHash]
      );
      if (existsRows.length) continue;
      return tx;
    }

    return null;
  }

  async tryAutoMatchIntent(supportId, intentId) {
    const { intent, payment } = await this.getIntentWithPayment(supportId, intentId);
    if (!intent) {
      throw new Error('Payment intent not found');
    }

    if (payment) {
      return { intent, payment };
    }

    if (intent.status !== 'OPEN') {
      return { intent, payment: null };
    }

    if (new Date(intent.expires_at).getTime() < Date.now()) {
      const db = getConnection();
      await db.execute(
        `UPDATE operator_usdt_payment_intents
            SET status = 'EXPIRED'
          WHERE id = ?
            AND status = 'OPEN'`,
        [intent.id]
      );
      const refreshed = await this.getIntentWithPayment(supportId, intentId);
      return refreshed;
    }

    let tx = null;
    try {
      tx = await this.findMatchingTransferForIntent(intent);
    } catch (error) {
      console.error(`Intent ${intent.id} transfer scan failed:`, error.message);
      return { intent, payment: null };
    }
    if (!tx?.txHash) {
      return { intent, payment: null };
    }

    try {
      await this.validateAndCreatePayment(
        supportId,
        intent.id,
        tx.txHash,
        Number(intent.requested_usdt || 0)
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') {
        throw error;
      }
    }

    return await this.getIntentWithPayment(supportId, intentId);
  }

  async getIntentStatus(supportId, intentId) {
    await this.expireIntentsForSupport(supportId);
    const matched = await this.tryAutoMatchIntent(supportId, intentId);
    return matched;
  }

  async validateAndCreatePayment(supportId, intentId, txHash, declaredAmountUsdt = null) {
    const db = getConnection();

    await this.expireIntentsForSupport(supportId);

    const [intentRows] = await db.execute(
      `SELECT *
         FROM operator_usdt_payment_intents
        WHERE id = ? AND support_id = ?
        LIMIT 1`,
      [intentId, supportId]
    );

    if (!intentRows.length) {
      throw new Error('Payment intent not found');
    }

    const intent = intentRows[0];
    if (intent.status !== 'OPEN') {
      throw new Error('Payment intent is not active');
    }

    if (new Date(intent.expires_at).getTime() < Date.now()) {
      await db.execute(
        `UPDATE operator_usdt_payment_intents SET status = 'EXPIRED' WHERE id = ?`,
        [intent.id]
      );
      throw new Error('Payment intent has expired');
    }

    const cleanHash = String(txHash || '').trim();
    if (!cleanHash) {
      throw new Error('tx_hash is required');
    }

    let tx = null;
    let rejectReason = null;

    try {
      tx = await TronScanService.inspectUsdtTransfer(cleanHash);
    } catch (error) {
      rejectReason = `inspect_failed:${error.message}`;
    }

    if (tx && !rejectReason) {
      const expectedAddress = this.normalizeAddress(intent.company_wallet);
      const txAddress = this.normalizeAddress(tx.toAddress);
      if (!expectedAddress || txAddress !== expectedAddress) {
        rejectReason = 'recipient_mismatch';
      }
    }

    if (tx && !rejectReason) {
      const expectedAmount = Number(intent.exact_usdt);
      if (Math.abs(Number(tx.amountUsdt) - expectedAmount) > USDT_COMPARE_TOLERANCE) {
        rejectReason = 'amount_mismatch';
      }
    }

    const status = rejectReason
      ? 'REJECTED'
      : (tx.confirmations >= REQUIRED_CONFIRMATIONS ? 'CONFIRMED' : 'PENDING');

    await db.beginTransaction();
    try {
      const [insertResult] = await db.execute(
        `INSERT INTO operator_usdt_payments
           (support_id, intent_id, tx_hash, declared_amount_usdt, actual_amount_usdt, confirmations, to_address, from_address, status, reject_reason, network, created_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRC20', NOW(), ?)` ,
        [
          supportId,
          intent.id,
          cleanHash,
          declaredAmountUsdt !== null && declaredAmountUsdt !== undefined ? Number(declaredAmountUsdt) : null,
          tx ? this.roundUsdt(tx.amountUsdt) : null,
          tx ? Number(tx.confirmations || 0) : 0,
          tx?.toAddress || null,
          tx?.fromAddress || null,
          status,
          rejectReason,
          status === 'CONFIRMED' ? new Date() : null
        ]
      );

      if (status !== 'REJECTED') {
        await db.execute(
          `UPDATE operator_usdt_payment_intents
              SET status = 'CONSUMED',
                  consumed_at = NOW()
            WHERE id = ?`,
          [intent.id]
        );
      }

      if (status === 'CONFIRMED') {
        await this.allocateConfirmedPaymentTransactional(db, insertResult.insertId);
      }

      await db.commit();

      const [rows] = await db.execute(
        `SELECT * FROM operator_usdt_payments WHERE id = ? LIMIT 1`,
        [insertResult.insertId]
      );
      return rows[0];
    } catch (error) {
      await db.rollback();
      throw error;
    }
  }

  async allocateConfirmedPaymentTransactional(db, paymentId) {
    const [paymentRows] = await db.execute(
      `SELECT * FROM operator_usdt_payments WHERE id = ? LIMIT 1`,
      [paymentId]
    );
    if (!paymentRows.length) return false;
    const payment = paymentRows[0];

    let remainingUsdt = Number(payment.actual_amount_usdt || 0);
    if (remainingUsdt <= 0) return false;

    const [debtRows] = await db.execute(
      `SELECT d.*
         FROM operator_usdt_debts d
         LEFT JOIN orders o ON o.id = d.order_id
        WHERE d.support_id = ?
          AND d.status IN ('OPEN', 'PARTIALLY_PAID')
          AND (o.id IS NULL OR o.status <> 'CANCELLED')
        ORDER BY d.created_at ASC, d.id ASC`,
      [payment.support_id]
    );

    for (const debt of debtRows) {
      if (remainingUsdt <= 0) break;

      const usdtDue = Number(debt.usdt_due);
      const usdtPaid = Number(debt.usdt_paid || 0);
      const debtUsdtRemaining = usdtDue - usdtPaid;
      if (debtUsdtRemaining <= 0) continue;

      const appliedUsdt = Math.min(remainingUsdt, debtUsdtRemaining);
      const sumRubLocked = Number(debt.sum_rub_locked);
      const rubReleased = Number(debt.rub_released || 0);
      const rubRemaining = Math.max(0, sumRubLocked - rubReleased);

      let deltaRub = this.roundRub((sumRubLocked * appliedUsdt) / usdtDue);
      if (appliedUsdt + USDT_COMPARE_TOLERANCE >= debtUsdtRemaining) {
        deltaRub = this.roundRub(rubRemaining);
      } else {
        deltaRub = Math.min(this.roundRub(rubRemaining), deltaRub);
      }

      const newUsdtPaid = this.roundUsdt(usdtPaid + appliedUsdt);
      const newRubReleased = this.roundRub(rubReleased + deltaRub);

      let newStatus = 'PARTIALLY_PAID';
      if (newUsdtPaid + USDT_COMPARE_TOLERANCE >= usdtDue) {
        newStatus = 'PAID';
      } else if (newUsdtPaid <= 0) {
        newStatus = 'OPEN';
      }

      await db.execute(
        `UPDATE operator_usdt_debts
            SET usdt_paid = ?,
                rub_released = ?,
                status = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [newUsdtPaid, newRubReleased, newStatus, debt.id]
      );

      await db.execute(
        `INSERT INTO operator_usdt_payment_allocations
           (payment_id, debt_id, usdt_applied, rub_released, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [payment.id, debt.id, this.roundUsdt(appliedUsdt), this.roundRub(deltaRub)]
      );

      remainingUsdt = this.roundUsdt(remainingUsdt - appliedUsdt);
    }

    return true;
  }

  async writeOffDebtBySuperadmin(supportId, requestedUsdt = null, actorId = null) {
    const db = getConnection();
    await this.expireIntentsForSupport(supportId);

    const aggregateBefore = await this.getAggregateDebt(supportId);
    const openUsdt = Number(aggregateBefore.usdt_open_total || 0);
    if (openUsdt <= 0) {
      throw new Error('No open USDT debt to write off');
    }

    let targetUsdt = openUsdt;
    if (requestedUsdt !== null && requestedUsdt !== undefined && requestedUsdt !== '') {
      const parsed = Number(requestedUsdt);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('requested_usdt must be positive');
      }
      targetUsdt = Math.min(parsed, openUsdt);
    }

    targetUsdt = this.roundUsdt(targetUsdt);
    if (targetUsdt <= 0) {
      throw new Error('requested_usdt is too small');
    }

    let remainingUsdt = targetUsdt;
    let writtenOffRub = 0;
    let debtsAffected = 0;

    await db.beginTransaction();
    try {
      const [debtRows] = await db.execute(
        `SELECT d.*
           FROM operator_usdt_debts d
           LEFT JOIN orders o ON o.id = d.order_id
          WHERE d.support_id = ?
            AND d.status IN ('OPEN', 'PARTIALLY_PAID')
            AND (o.id IS NULL OR o.status <> 'CANCELLED')
          ORDER BY d.created_at ASC, d.id ASC`,
        [supportId]
      );

      for (const debt of debtRows) {
        if (remainingUsdt <= 0) break;

        const usdtDue = Number(debt.usdt_due || 0);
        const usdtPaid = Number(debt.usdt_paid || 0);
        const debtUsdtRemaining = usdtDue - usdtPaid;
        if (debtUsdtRemaining <= 0) continue;

        const appliedUsdt = Math.min(remainingUsdt, debtUsdtRemaining);
        if (appliedUsdt <= 0) continue;

        const sumRubLocked = Number(debt.sum_rub_locked || 0);
        const rubReleased = Number(debt.rub_released || 0);
        const rubRemaining = Math.max(0, sumRubLocked - rubReleased);

        let deltaRub = this.roundRub((sumRubLocked * appliedUsdt) / usdtDue);
        if (appliedUsdt + USDT_COMPARE_TOLERANCE >= debtUsdtRemaining) {
          deltaRub = this.roundRub(rubRemaining);
        } else {
          deltaRub = Math.min(this.roundRub(rubRemaining), deltaRub);
        }

        const newUsdtPaid = this.roundUsdt(usdtPaid + appliedUsdt);
        const newRubReleased = this.roundRub(rubReleased + deltaRub);

        let newStatus = 'PARTIALLY_PAID';
        if (newUsdtPaid + USDT_COMPARE_TOLERANCE >= usdtDue) {
          newStatus = 'PAID';
        } else if (newUsdtPaid <= 0) {
          newStatus = 'OPEN';
        }

        await db.execute(
          `UPDATE operator_usdt_debts
              SET usdt_paid = ?,
                  rub_released = ?,
                  status = ?,
                  updated_at = NOW()
            WHERE id = ?`,
          [newUsdtPaid, newRubReleased, newStatus, debt.id]
        );

        remainingUsdt = this.roundUsdt(remainingUsdt - appliedUsdt);
        writtenOffRub = this.roundRub(writtenOffRub + deltaRub);
        debtsAffected += 1;
      }

      // Сбрасываем открытые intents, чтобы после ручного списания не появлялись лишние авто-матчи.
      await db.execute(
        `UPDATE operator_usdt_payment_intents
            SET status = 'CANCELLED',
                consumed_at = NOW()
          WHERE support_id = ?
            AND status = 'OPEN'`,
        [supportId]
      );

      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }

    const aggregateAfter = await this.getAggregateDebt(supportId);
    const writtenOffUsdt = this.roundUsdt(targetUsdt - remainingUsdt);

    return {
      support_id: supportId,
      actor_id: actorId,
      requested_usdt: targetUsdt,
      written_off_usdt: writtenOffUsdt,
      written_off_rub: writtenOffRub,
      debts_affected: debtsAffected,
      debt_before: aggregateBefore,
      debt_after: aggregateAfter
    };
  }

  async processOpenIntentsAutoMatch(limit = 100) {
    await this.expireAllOpenIntents();

    const db = getConnection();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const [rows] = await db.execute(
      `SELECT id, support_id
         FROM operator_usdt_payment_intents
        WHERE status = 'OPEN'
          AND expires_at >= NOW()
        ORDER BY created_at ASC
        LIMIT ${safeLimit}`
    );

    for (const row of rows) {
      try {
        await this.tryAutoMatchIntent(row.support_id, row.id);
      } catch (error) {
        console.error(`Auto-match failed for intent ${row.id}:`, error.message);
      }
    }
  }

  async processPendingPayments() {
    const db = getConnection();
    const [pendingRows] = await db.execute(
      `SELECT * FROM operator_usdt_payments WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 100`
    );

    for (const payment of pendingRows) {
      try {
        const tx = await TronScanService.inspectUsdtTransfer(payment.tx_hash);
        const confirmations = Number(tx.confirmations || 0);

        const expectedAddress = this.normalizeAddress(payment.to_address);
        if (this.normalizeAddress(tx.toAddress) !== expectedAddress) {
          await db.execute(
            `UPDATE operator_usdt_payments
                SET status = 'REJECTED',
                    reject_reason = 'recipient_mismatch',
                    confirmations = ?
              WHERE id = ?`,
            [confirmations, payment.id]
          );
          continue;
        }

        if (confirmations < REQUIRED_CONFIRMATIONS) {
          await db.execute(
            `UPDATE operator_usdt_payments
                SET confirmations = ?
              WHERE id = ?`,
            [confirmations, payment.id]
          );
          continue;
        }

        await db.beginTransaction();
        try {
          await db.execute(
            `UPDATE operator_usdt_payments
                SET status = 'CONFIRMED',
                    confirmations = ?,
                    actual_amount_usdt = ?,
                    confirmed_at = NOW()
              WHERE id = ?`,
            [confirmations, this.roundUsdt(tx.amountUsdt), payment.id]
          );

          await this.allocateConfirmedPaymentTransactional(db, payment.id);
          await db.commit();
        } catch (error) {
          await db.rollback();
          throw error;
        }
      } catch (error) {
        console.error(`Pending payment ${payment.id} processing failed:`, error.message);
      }
    }
  }

  async getPaymentsHistory(supportId = null, limit = 50) {
    await this.expireAllOpenIntents();

    const db = getConnection();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));

    const hasSupportFilter = Number.isInteger(Number(supportId)) && Number(supportId) > 0;
    const whereSupportPayments = hasSupportFilter ? 'WHERE p.support_id = ?' : '';
    const whereSupportIntents = hasSupportFilter ? 'AND i.support_id = ?' : '';
    const supportParams = hasSupportFilter ? [Number(supportId)] : [];

    const [paymentRows] = await db.execute(
      `SELECT
          'PAYMENT' AS history_type,
          p.id AS history_id,
          p.support_id,
          s.login AS support_login,
          NULL AS support_name,
          p.intent_id,
          i.requested_usdt,
          i.exact_usdt,
          i.company_wallet,
          i.expires_at,
          i.status AS intent_status,
          p.tx_hash,
          p.declared_amount_usdt,
          p.actual_amount_usdt,
          p.confirmations,
          p.to_address,
          p.from_address,
          p.status AS payment_status,
          p.reject_reason,
          p.created_at,
          p.confirmed_at
       FROM operator_usdt_payments p
       LEFT JOIN operator_usdt_payment_intents i ON i.id = p.intent_id
       LEFT JOIN supports s ON s.id = p.support_id
       ${whereSupportPayments}
       ORDER BY p.created_at DESC
       LIMIT ${safeLimit}`,
      supportParams
    );

    const [intentRows] = await db.execute(
      `SELECT
          'INTENT' AS history_type,
          i.id AS history_id,
          i.support_id,
          s.login AS support_login,
          NULL AS support_name,
          i.id AS intent_id,
          i.requested_usdt,
          i.exact_usdt,
          i.company_wallet,
          i.expires_at,
          i.status AS intent_status,
          NULL AS tx_hash,
          NULL AS declared_amount_usdt,
          NULL AS actual_amount_usdt,
          NULL AS confirmations,
          NULL AS to_address,
          NULL AS from_address,
          NULL AS payment_status,
          NULL AS reject_reason,
          i.created_at,
          NULL AS confirmed_at
       FROM operator_usdt_payment_intents i
       LEFT JOIN operator_usdt_payments p ON p.intent_id = i.id
       LEFT JOIN supports s ON s.id = i.support_id
       WHERE p.id IS NULL
         AND i.status IN ('OPEN', 'EXPIRED', 'CANCELLED')
         ${whereSupportIntents}
       ORDER BY i.created_at DESC
       LIMIT ${safeLimit}`,
      supportParams
    );

    const normalized = [...paymentRows, ...intentRows]
      .map((row) => {
        const paymentStatus = row.payment_status ? String(row.payment_status).toUpperCase() : null;
        const intentStatus = row.intent_status ? String(row.intent_status).toUpperCase() : null;

        let historyStatus;
        if (row.history_type === 'PAYMENT') {
          historyStatus = paymentStatus || 'UNKNOWN';
        } else if (intentStatus === 'OPEN') {
          const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
          const isExpiredByTime = Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();
          historyStatus = isExpiredByTime ? 'EXPIRED' : 'WAITING_PAYMENT';
        } else {
          historyStatus = intentStatus || 'UNKNOWN';
        }

        return {
          ...row,
          requested_usdt: row.requested_usdt !== null ? Number(row.requested_usdt) : null,
          exact_usdt: row.exact_usdt !== null ? Number(row.exact_usdt) : null,
          declared_amount_usdt: row.declared_amount_usdt !== null ? Number(row.declared_amount_usdt) : null,
          actual_amount_usdt: row.actual_amount_usdt !== null ? Number(row.actual_amount_usdt) : null,
          confirmations: row.confirmations !== null ? Number(row.confirmations) : null,
          history_status: historyStatus
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, safeLimit);

    return normalized;
  }

  async getOpenDebtRubBySupport(supportId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT COALESCE(SUM(sum_rub_locked - rub_released), 0) AS open_debt_rub
         FROM operator_usdt_debts
        WHERE support_id = ?
          AND status IN ('OPEN', 'PARTIALLY_PAID')`,
      [supportId]
    );
    return Number(rows[0]?.open_debt_rub || 0);
  }

  async getOpenDebtUsdtBySupport(supportId) {
    const db = getConnection();
    const [rows] = await db.execute(
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
    return Number(rows[0]?.open_debt_usdt || 0);
  }

  async getDebtByOrder(orderId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT *
         FROM operator_usdt_debts
        WHERE order_id = ?
        LIMIT 1`,
      [orderId]
    );
    return rows[0] || null;
  }
}

module.exports = new OperatorDebtService();
