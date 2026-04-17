const path = require('path');
const Order = require('../models/Order');
const User = require('../models/User');
const Requisite = require('../models/Requisite');
const Fee = require('../models/Fee');
const Rate = require('../models/Rate');
const Support = require('../models/Support');
const Review = require('../models/Review');
const SystemSetting = require('../models/SystemSetting');
const { BotRequisite } = require('../models/Bot');
const { getConnection } = require('../config/database');
const { logUserAction, logSupportAction } = require('../utils/logger');
const OperatorDebtService = require('./OperatorDebtService');
const ManagerAlertTelegramService = require('./ManagerAlertTelegramService');
const ChatTranslationService = require('./ChatTranslationService');
const {
  OPERATOR_TAKE_MESSAGE_KEYS,
  OPERATOR_TAKE_MESSAGE_DELAY_MS,
  buildOperatorTakeSettings,
  buildOperatorTakeMessageSequence,
  sanitizeOperatorTakeMessageForOperator
} = require('../constants/operatorAutoMessages');

class OrderService {
  buildInternalDebtChatNoteByFields(accountLine, bankLine, holderLine, commentLine = null) {
    const normalizedAccount = String(accountLine || '').trim();
    const normalizedBank = String(bankLine || '').trim();
    const normalizedHolder = String(holderLine || '').trim();
    const normalizedComment = String(commentLine || '').trim();

    if (!normalizedAccount || !normalizedBank || !normalizedHolder) {
      return null;
    }

    const lines = normalizedComment
      ? [`"${normalizedComment}"`, normalizedAccount, normalizedBank, normalizedHolder]
      : [normalizedAccount, normalizedBank, normalizedHolder];

    return lines.join('\n');
  }

  buildInternalDebtChatNote(requisites = {}) {
    return this.buildInternalDebtChatNoteByFields(
      requisites.card_number || requisites.sbp_phone,
      requisites.bank_name,
      requisites.card_holder,
      requisites.label
    );
  }

  buildInternalDebtChatNoteFromOrder(order = {}) {
    return this.buildInternalDebtChatNoteByFields(
      order.exch_card_number || order.exch_sbp_phone,
      order.exch_bank_name,
      order.exch_card_holder,
      order.exch_label
    );
  }

  buildInternalDebtSyntheticMessage(order = {}) {
    const text = this.buildInternalDebtChatNoteFromOrder(order);
    if (!text) return null;

    const createdAt = order.sla_requisites_setup_at || order.updated_at || order.created_at || new Date();
    return {
      id: `internal_requisites_${order.id}`,
      sender_type: 'SERVICE',
      sender_id: null,
      message: text,
      original_message: text,
      translated_message: null,
      source_lang: null,
      translated_at: null,
      attachments_path: null,
      created_at: createdAt,
      is_read: 1,
      internal_only: true
    };
  }

  buildInternalDebtSyntheticMessageFromHistoryRow(historyRow = {}) {
    const text = String(historyRow.message || '').trim();
    if (!text) return null;

    return {
      id: `internal_requisites_history_${historyRow.id}`,
      sender_type: 'SERVICE',
      sender_id: null,
      message: text,
      original_message: text,
      translated_message: null,
      source_lang: null,
      translated_at: null,
      attachments_path: null,
      created_at: historyRow.created_at || new Date(),
      is_read: 1,
      internal_only: true
    };
  }

  buildInternalDebtSyntheticMessageFromLegacyDealMessage(dealMessageRow = {}) {
    const text = String(dealMessageRow.original_message || dealMessageRow.message || '').trim();
    if (!text) return null;

    return {
      id: `internal_requisites_legacy_${dealMessageRow.id}`,
      sender_type: 'SERVICE',
      sender_id: null,
      message: text,
      original_message: text,
      translated_message: null,
      source_lang: null,
      translated_at: null,
      attachments_path: null,
      created_at: dealMessageRow.created_at || new Date(),
      is_read: 1,
      internal_only: true
    };
  }

  isInternalDebtServiceText(messageText) {
    const text = String(messageText || '').trim();
    if (!text) return false;

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 3 || lines.length > 5) return false;

    const workLines = [...lines];
    const maybeHeader = workLines[0] || '';
    if (/^["«»]?\s*долг\s*["«»]?$/i.test(maybeHeader)) {
      workLines.shift();
    }

    if (workLines.length < 3 || workLines.length > 4) return false;

    let accountLine = '';
    let thirdLine = '';
    let personLine = '';
    let commentLine = '';

    if (workLines.length === 3) {
      [accountLine, thirdLine, personLine] = workLines;
    } else {
      const firstIsBracketComment = /^\((?:"[^"]{1,200}"|[^()]{1,200})\)$/.test(workLines[0] || '');
      if (firstIsBracketComment) {
        [commentLine, accountLine, thirdLine, personLine] = workLines;
      } else {
        [accountLine, thirdLine, personLine, commentLine] = workLines;
      }
    }

    const hasCardLikeLine = /\d{4}(?:[\s-]?\d{4}){3}/.test(accountLine);
    const hasPhoneLikeLine = /\+?\d[\d\s()-]{9,}/.test(accountLine);
    const hasAccountLine = hasCardLikeLine || hasPhoneLikeLine;
    const hasThirdLine = thirdLine.length > 0 && !/[<>]/.test(thirdLine);
    const hasPersonLikeLine = /[A-Za-zА-ЯЁа-яё]{2,}\s+[A-Za-zА-ЯЁа-яё]{2,}/.test(personLine);
    const hasValidComment = !commentLine || (!/[<>]/.test(commentLine) && commentLine.length <= 250);

    return hasAccountLine && hasThirdLine && hasPersonLikeLine && hasValidComment;
  }

  getDefaultOperatorTakeMessages() {
    return buildOperatorTakeSettings({});
  }

  async getOperatorTakeMessageSettings() {
    try {
      const rawValues = await SystemSetting.getValues(OPERATOR_TAKE_MESSAGE_KEYS);
      return buildOperatorTakeSettings(rawValues);
    } catch (error) {
      console.warn('Failed to load operator take message settings:', error.message);
      return this.getDefaultOperatorTakeMessages();
    }
  }

  async getOperatorTakeMessageSequence() {
    try {
      const rawValues = await SystemSetting.getValues(OPERATOR_TAKE_MESSAGE_KEYS);
      const sequence = buildOperatorTakeMessageSequence(rawValues);
      if (sequence.length > 0) return sequence;
    } catch (error) {
      console.warn('Failed to build operator take message sequence:', error.message);
    }

    const defaults = this.getDefaultOperatorTakeMessages();
    return buildOperatorTakeMessageSequence({
      operator_take_start_message_1: defaults.operator_take_start_message_1,
      operator_take_start_message_2: defaults.operator_take_start_message_2
    });
  }

  sleep(ms) {
    const timeout = Number(ms);
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }

  async resolveOperatorAutoMessageForOperator(clientText, operatorLanguage, messageIndex = 0) {
    const baseOperatorText = sanitizeOperatorTakeMessageForOperator(clientText) || String(clientText || '').trim();
    const normalizedLanguage = this.normalizeChatLanguage(operatorLanguage);
    if (normalizedLanguage !== 'EN') {
      return baseOperatorText;
    }

    try {
      const translationResult = await ChatTranslationService.translateText({
        text: baseOperatorText,
        targetLanguage: 'EN'
      });
      const translated = String(translationResult?.translatedText || '').trim();
      if (translationResult?.success && translated) {
        return translated;
      }
    } catch (translationError) {
      // fallback below
    }

    if (/какой\s+банк/i.test(baseOperatorText) || /which\s+bank/i.test(baseOperatorText)) {
      return 'Which bank?';
    }

    if (
      Number(messageIndex) === 0 ||
      /добро\s+пожаловать/i.test(baseOperatorText) ||
      /welcome/i.test(baseOperatorText)
    ) {
      return 'Welcome. I am your personal operator and will help complete your deal quickly.';
    }

    return baseOperatorText;
  }

  emitOrderChatMessageToSockets(order, messageData) {
    if (!order || !messageData) return;

    try {
      const SocketService = require('./SocketService');
      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: Number(order.id),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        attachments_path: messageData.attachments_path,
        created_at: messageData.created_at,
        internal_only: false,
        bot_id: order.bot_id,
        support_id: order.support_id
      });
    } catch (socketError) {
      console.warn(`Failed to emit auto greeting socket message for order ${order.id}:`, socketError.message);
    }
  }

  async sendOperatorTakeAutoMessages(orderId, supportId) {
    const normalizedOrderId = Number(orderId || 0);
    const normalizedSupportId = Number(supportId || 0);
    if (!normalizedOrderId || !normalizedSupportId) return false;

    const [order, support] = await Promise.all([
      Order.findById(normalizedOrderId),
      Support.findById(normalizedSupportId)
    ]);

    if (!order || !support) return false;
    if (Number(order.support_id || 0) !== normalizedSupportId) return false;
    const normalizedSupportRole = String(support.role || '').toUpperCase();
    if (!['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes(normalizedSupportRole)) return false;

    const clientSequence = await this.getOperatorTakeMessageSequence();
    if (!clientSequence.length) return false;

    const { getBotManager } = require('../utils/botManager');
    const botManager = getBotManager();
    if (!botManager) {
      console.warn(`Bot manager not initialized, cannot send auto messages for order ${normalizedOrderId}`);
      return false;
    }

    for (let index = 0; index < clientSequence.length; index += 1) {
      let clientText = String(clientSequence[index] || '').trim();
      if (!clientText) continue;
      if (
        index === 0 &&
        !/obmennik/i.test(clientText) &&
        /^добро\s+пожаловать[.!]?/i.test(clientText)
      ) {
        clientText = clientText.replace(/^добро\s+пожаловать[.!]?/i, 'Приветствуем вас в сервисе.');
      }
      const operatorText = await this.resolveOperatorAutoMessageForOperator(
        clientText,
        support.chat_language || 'RU',
        index
      );

      try {
        const messageData = await this.sendOrderMessage(normalizedOrderId, {
          senderId: normalizedSupportId,
          senderType: 'OPERATOR',
          message: operatorText,
          chatLanguage: support.chat_language || null
        });

        const sent = await botManager.sendMessageToUser(normalizedOrderId, clientText);
        if (!sent) {
          console.warn(`Failed to deliver auto greeting to user for order ${normalizedOrderId}`);
        }

        this.emitOrderChatMessageToSockets(order, messageData);
      } catch (messageError) {
        console.error(`Auto greeting failed for order ${normalizedOrderId}:`, messageError.message);
      }

      if (index < clientSequence.length - 1) {
        await this.sleep(OPERATOR_TAKE_MESSAGE_DELAY_MS);
      }
    }

    return true;
  }

  /**
   * Установка реквизитов для операции
   * @param {number} orderId - Order ID
   * @param {Object} requisites - Данные реквизитов
   * @param {number} supportId - ИД саппорта
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async setOrderRequisites(orderId, requisites, supportId, actorRole = 'OPERATOR', actorOptions = {}) {
    
    const db = getConnection();
    try {
      // Начинаем транзакцию
      await db.beginTransaction();

      // Получаем заявку
      const order = await Order.findById(orderId);
      if (!order) {
        await db.rollback();
        return { success: false, message: 'Order not found' };
      }

      const normalizedRole = String(actorRole || '').toUpperCase();
      const isSuperAdmin = normalizedRole === 'SUPERADMIN';
      const isManager = normalizedRole === 'MANAGER';
      const isPrivilegedEditor = isSuperAdmin || isManager;
      const canOperatorEditRequisites = Number(
        actorOptions?.can_edit_requisites ?? actorOptions?.canEditRequisites ?? 1
      ) === 1;
      const hadExistingExchangerRequisites = Boolean(
        order.exch_req_id ||
        order.exch_card_number ||
        order.exch_card_holder ||
        order.exch_bank_name ||
        order.exch_crypto_address ||
        order.exch_sbp_phone
      );

      // Оператор без can_edit_requisites может отправить платежные данные только один раз (первичная отправка).
      if (
        normalizedRole === 'OPERATOR' &&
        !canOperatorEditRequisites &&
        hadExistingExchangerRequisites
      ) {
        await db.rollback();
        return {
          success: false,
          message: 'Operator is not allowed to change requisites after first send',
          statusCode: 403
        };
      }

      // SUPERADMIN/MANAGER могут отправлять новые платежные данные без привязки к назначению.
      if (!isPrivilegedEditor && Number(order.support_id || 0) !== Number(supportId || 0)) {
        await db.rollback();
        return {
          success: false,
          message: 'Order not assigned to this operator',
          statusCode: 403
        };
      }

      // Оператор работает только в PAYMENT_PENDING.
      // SUPERADMIN/MANAGER могут отправлять новые платежные данные в любом статусе.
      if (!isPrivilegedEditor && order.status !== 'PAYMENT_PENDING') {
        await db.rollback();
        return { success: false, message: 'Invalid order status for setting requisites', statusCode: 400 };
      }

      // Обновляем платежные данные операции
      const baseParams = [
        requisites.card_number || null,
        requisites.card_holder || null,
        requisites.bank_name || null,
        requisites.crypto_address || null,
        requisites.sbp_phone || null,
        requisites.req_id || null
      ];

      const [result] = isPrivilegedEditor
        ? await db.execute(
          `UPDATE orders SET 
            exch_card_number = ?,
            exch_card_holder = ?,
            exch_bank_name = ?,
            exch_crypto_address = ?,
            exch_sbp_phone = ?,
            exch_req_id = ?,
            updated_at = NOW(),
            sla_requisites_setup_at = NOW()
          WHERE id = ?`,
          [...baseParams, orderId]
        )
        : await db.execute(
          `UPDATE orders SET 
            exch_card_number = ?,
            exch_card_holder = ?,
            exch_bank_name = ?,
            exch_crypto_address = ?,
            exch_sbp_phone = ?,
            exch_req_id = ?,
            updated_at = NOW(),
            sla_requisites_setup_at = NOW()
          WHERE id = ? AND support_id = ?`,
          [...baseParams, orderId, supportId]
        );

      if (result.affectedRows === 0) {
        await db.rollback();
        return { success: false, message: 'Failed to update requisites' };
      }

      // Отправляем сообщение пользователю через бота
      const { getBotManager } = require('../utils/botManager');
      const botManager = getBotManager();

      if (!botManager) {
        await db.rollback();
        return { success: false, message: 'Bot manager not initialized' };
      }
      
      let replyMessage = '';
      if (order.dir === 'BUY') {
        // Для покупки криптовалюты отправляем платежные данные карты/банка или СБП
        if (requisites.sbp_phone) {
          // СБП платежные данные
          replyMessage = `💳 <b>Платежные данные для оплаты (СБП):</b>\n\n`;
          replyMessage += `📞 Номер телефона: <code>${requisites.sbp_phone}</code>\n\n`;
          replyMessage += `🏦 Банк: ${requisites.bank_name}\n`;
          replyMessage += `👤 Получатель: ${requisites.card_holder}\n\n`;
          if (requisites.label) {
            replyMessage += `🏷️ Комментарий: ${requisites.label}\n\n`;
          }
          replyMessage += `Пожалуйста, совершите перевод точной суммы: ${order.sum_rub} RUB через СБП`;
        } else {
          // Банковская карта
          replyMessage = `💳 <b>Платежные данные для оплаты:</b>\n\n`;
          replyMessage += `🏦 Банк: ${requisites.bank_name}\n`;
          replyMessage += `👤 Получатель: ${requisites.card_holder}\n`;
          replyMessage += `💳 Номер карты: <code>${requisites.card_number}</code>\n\n`;
          if (requisites.label) {
            replyMessage += `🏷️ Комментарий: ${requisites.label}\n\n`;
          }
          replyMessage += `Пожалуйста, совершите перевод точной суммы: ${order.sum_rub} RUB`;
        }
      } else {
        // Для продажи криптовалюты отправляем крипто адрес
        replyMessage = `💱 <b>Операция:</b> Продажа\n`;
        replyMessage += `💰 <b>Количество ${order.coin}:</b> ${order.amount_coin}\n`;
        replyMessage += `💵 <b>Сумма к получению:</b> ${order.sum_rub.toLocaleString()} ₽\n\n`;
        replyMessage += `💸 Переведите указанное в заявке количество монет по адресу: \n`;
        replyMessage += `<code>${requisites.crypto_address}</code> \n(Можно скопировать нажатием)`;
        if (requisites.label) {
          replyMessage += `\n\n🏷️ Комментарий: ${requisites.label}`;
        }
      }

      if (hadExistingExchangerRequisites) {
        replyMessage =
          `⚠️ <b>ВНИМАНИЕ: РЕКВИЗИТЫ БЫЛИ ИЗМЕНЕНЫ</b>\n` +
          `Старые платежные данные не актуальны. Будьте внимательны.\n\n` +
          replyMessage;
      }

      const { sendMessageToUser } = require('../utils/botManager');
      const sent = await sendMessageToUser(order.id, replyMessage);
      if (!sent) {
        await db.rollback();
        return { success: false, message: 'Failed to send requisites to user' };
      }

      const internalServiceText = this.buildInternalDebtChatNote(requisites);
      let persistedInternalMessage = null;

      if (internalServiceText) {
        try {
          const [insertServiceMessageResult] = await db.execute(
            `INSERT INTO order_service_messages (
               order_id,
               message
             ) VALUES (?, ?)`,
            [order.id, internalServiceText]
          );

          const insertedServiceMessageId = Number(insertServiceMessageResult?.insertId || 0);
          if (insertedServiceMessageId > 0) {
            const [serviceMessageRows] = await db.execute(
              `SELECT
                 id,
                 order_id,
                 message,
                 created_at
               FROM order_service_messages
               WHERE id = ?
               LIMIT 1`,
              [insertedServiceMessageId]
            );

            persistedInternalMessage = this.buildInternalDebtSyntheticMessageFromHistoryRow(
              serviceMessageRows[0] || {
                id: insertedServiceMessageId,
                order_id: order.id,
                message: internalServiceText,
                created_at: new Date()
              }
            );
          }
        } catch (persistServiceMessageError) {
          // Если миграция еще не применена, не ломаем отправку реквизитов.
          console.warn(
            `Failed to persist internal requisites history for order ${order.id}:`,
            persistServiceMessageError.message
          );
        }
      }

      // Фиксируем транзакцию
      await db.commit();

      // Служебное событие чата без сохранения в deal_messages:
      // рендерится отдельно и всегда остается служебным после перезагрузки.
      try {
        const supportSenderId = supportId || order.support_id || null;
        const syntheticInternalMessage =
          persistedInternalMessage ||
          this.buildInternalDebtSyntheticMessage({
            id: order.id,
            exch_card_number: requisites.card_number || null,
            exch_sbp_phone: requisites.sbp_phone || null,
            exch_bank_name: requisites.bank_name || null,
            exch_card_holder: requisites.card_holder || null,
            exch_label: requisites.label || null,
            sla_requisites_setup_at: new Date(),
            updated_at: new Date(),
            created_at: order.created_at
          });

        if (syntheticInternalMessage) {
          const SocketService = require('./SocketService');
          SocketService.emitOrderMessage({
            ...syntheticInternalMessage,
            order_id: Number(order.id),
            bot_id: order.bot_id,
            support_id: order.support_id || supportSenderId
          });
        }
      } catch (internalSocketError) {
        console.warn(`Failed to emit internal requisites synthetic message for order ${order.id}:`, internalSocketError.message);
      }

      return { success: true, message: 'Requisites updated successfully' };
    } catch (error) {
      await db.rollback();
      console.error('Error in setOrderRequisites:', error);
      throw error;
    }
  }

  /**
   * Создание котировки
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async createQuote(params) {
    const { userId, dir, coin, botId } = params;
    const amountCoinRaw = params?.amountCoin ?? params?.amount_coin;
    const sumRubRaw = params?.sumRub ?? params?.sum_rub;
    const amountCoinInput = Number(amountCoinRaw);
    const requestedSumRub = Number(sumRubRaw);
    const hasRequestedSumRub = Number.isFinite(requestedSumRub) && requestedSumRub > 0;
    const normalizedInputMode = String(
      params?.inputMode ??
      params?.amountInputMode ??
      ''
    ).trim().toUpperCase();
    const isRubInputMode = normalizedInputMode === 'RUB';
    const hasAmountCoinInput = Number.isFinite(amountCoinInput) && amountCoinInput > 0;
    const shouldUseRubFlow = hasRequestedSumRub && (isRubInputMode || !hasAmountCoinInput);
    const rubTolerance = 1e-8;
    const coinTolerance = 1e-12;

    const buildAmountError = () => {
      const amountError = new Error('Invalid amountCoin');
      amountError.code = 'INVALID_AMOUNT_COIN';
      amountError.statusCode = 400;
      return amountError;
    };

    const buildCoefficientError = () => {
      const coefficientError = new Error('Invalid pricing multiplier');
      coefficientError.code = 'INVALID_COEFFICIENT';
      coefficientError.statusCode = 400;
      return coefficientError;
    };

    const buildSumError = () => {
      const sumError = new Error('Invalid sumRub');
      sumError.code = 'INVALID_SUM_RUB';
      sumError.statusCode = 400;
      return sumError;
    };

    if (!hasAmountCoinInput && !hasRequestedSumRub) {
      throw buildAmountError();
    }

    if (!botId) {
      throw new Error('No botId provided for progressive fees');
    }

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const rate = await Rate.getByCoin(coin);
    if (!rate) throw new Error(`Rate not found for ${coin}`);

    const X = Number(rate.rate_rub);
    if (!Number.isFinite(X) || X <= 0) {
      throw new Error(`Invalid rate for ${coin}`);
    }

    let R = 0;
    if (user.has_ref) {
      try {
        const UserBot = require('../models/UserBot');
        const db = getConnection();
        const [userBotRows] = await db.execute(
          'SELECT * FROM user_bots WHERE user_id = ? AND bot_id = ? AND has_ref = 1',
          [userId, botId]
        );

        if (userBotRows.length > 0 && userBotRows[0].invited_by) {
          const referrerUserBot = await UserBot.findById(userBotRows[0].invited_by);
          if (referrerUserBot && referrerUserBot.referral_level) {
            const ReferralService = require('./ReferralService');
            const levelInfo = ReferralService.getReferralLevelInfo(referrerUserBot.referral_level);
            R = levelInfo.percentage || 0;
          } else {
            R = 0;
          }
        }
      } catch (error) {
        console.error('Error calculating referral commission:', error);
        R = 0;
      }
    }

    const V = parseFloat(user.discount_v) || 0;
    const feeType = dir === 'BUY' ? 'buy' : 'sell';
    const feeField = dir === 'BUY' ? 'buy_fee' : 'sell_fee';
    const pricingDelta = dir === 'BUY'
      ? (Number(R || 0) - Number(V || 0))
      : (-Number(R || 0) + Number(V || 0));

    const toFeeSnapshot = (baseFeeValue) => {
      const baseFee = Number(baseFeeValue || 0);
      if (!Number.isFinite(baseFee)) return null;
      const totalFee = baseFee + pricingDelta;
      if (!Number.isFinite(totalFee)) return null;
      const payRatio = 1 + totalFee;
      if (!Number.isFinite(payRatio) || payRatio <= 0) return null;
      return { baseFee, totalFee, payRatio };
    };

    const toRoundedQuote = (sumRubValue, amountCoinValue) => {
      const numericRub = Number(sumRubValue);
      const numericCoin = Number(amountCoinValue);
      if (!Number.isFinite(numericRub) || numericRub <= 0 || !Number.isFinite(numericCoin) || numericCoin <= 0) {
        throw new Error('Invalid quote result');
      }
      const unitRub = numericRub / numericCoin;
      return {
        unitRub: Math.round(unitRub * 100) / 100,
        sumRub: Math.round(numericRub * 100) / 100
      };
    };

    const rawTiers = await Fee.getFeeTiers(botId, coin);
    const sortedTiers = Array.isArray(rawTiers)
      ? [...rawTiers].sort((a, b) => Number(a.min_amount) - Number(b.min_amount))
      : [];
    const hasCoinTiers = sortedTiers.length > 0;

    if (!hasCoinTiers) {
      const amountForFee = shouldUseRubFlow
        ? requestedSumRub
        : (hasAmountCoinInput ? amountCoinInput * X : requestedSumRub);
      const baseFee = Number(await Fee.calculateFeeForAmount(botId, coin, amountForFee, feeType));
      const feeSnapshot = toFeeSnapshot(baseFee);
      if (!feeSnapshot) throw buildCoefficientError();

      const resolvedAmountCoin = shouldUseRubFlow
        ? requestedSumRub / (X * feeSnapshot.payRatio)
        : amountCoinInput;
      if (!Number.isFinite(resolvedAmountCoin) || resolvedAmountCoin <= 0) {
        throw buildAmountError();
      }

      const resolvedSumRub = shouldUseRubFlow
        ? requestedSumRub
        : (resolvedAmountCoin * X * feeSnapshot.payRatio);
      if (!Number.isFinite(resolvedSumRub) || resolvedSumRub <= 0) {
        throw buildSumError();
      }

      const quote = toRoundedQuote(resolvedSumRub, resolvedAmountCoin);
      const roundedRequestedRub = hasRequestedSumRub ? Math.round(requestedSumRub * 100) / 100 : null;
      const actualSumRub = Number(quote?.sumRub);

      return {
        quote,
        rate: X,
        fee: feeSnapshot.baseFee,
        referral_bonus: R,
        user_discount: V,
        coin,
        dir,
        amount_coin: resolvedAmountCoin,
        requested_sum_rub: roundedRequestedRub,
        actual_sum_rub: Number.isFinite(actualSumRub) ? actualSumRub : null,
        is_adjusted: hasRequestedSumRub && Number.isFinite(actualSumRub)
          ? Math.abs(actualSumRub - roundedRequestedRub) > 0.009
          : false
      };
    }

    const configError = (message, details = {}) => {
      const error = new Error(message);
      error.code = 'INVALID_TIER_CONFIGURATION';
      error.statusCode = 400;
      Object.assign(error, details);
      return error;
    };

    const ranges = sortedTiers.map((tier, index) => {
      const nextTier = sortedTiers[index + 1] || null;
      const minRub = Number(tier.min_amount);
      const maxRub = tier.max_amount === null || tier.max_amount === undefined
        ? null
        : Number(tier.max_amount);
      const feeFrom = Number(tier[feeField] || 0);

      const explicitFeeToRaw = tier?.[`${feeField}_to`];
      const explicitFeeTo = Number(explicitFeeToRaw);
      let feeTo;
      if (explicitFeeToRaw !== undefined && explicitFeeToRaw !== null && explicitFeeToRaw !== '') {
        feeTo = explicitFeeTo;
      } else if (nextTier) {
        feeTo = Number(nextTier[feeField] || 0);
      } else {
        feeTo = feeFrom;
      }

      return {
        index,
        minRub,
        maxRub,
        feeFrom,
        feeTo,
        hasExplicitFeeTo: explicitFeeToRaw !== undefined && explicitFeeToRaw !== null && explicitFeeToRaw !== ''
      };
    });

    ranges.forEach((range, index) => {
      if (!Number.isFinite(range.minRub) || range.minRub < 0) {
        throw configError('Invalid tier min amount', { tierIndex: index });
      }
      if (range.maxRub !== null && (!Number.isFinite(range.maxRub) || range.maxRub <= range.minRub)) {
        throw configError('Invalid tier max amount', { tierIndex: index });
      }
      if (!Number.isFinite(range.feeFrom) || !Number.isFinite(range.feeTo)) {
        throw configError('Invalid tier fee', { tierIndex: index });
      }

      const nextRange = ranges[index + 1];
      if (!nextRange) return;

      if (range.maxRub === null) {
        throw configError('Unlimited tier must be last', { tierIndex: index });
      }
      if (Math.abs(range.maxRub - nextRange.minRub) > 1e-6) {
        throw configError('Fee tier ranges must be contiguous without gaps/overlaps', {
          tierIndex: index,
          currentMax: range.maxRub,
          nextMin: nextRange.minRub
        });
      }
      if (range.hasExplicitFeeTo && Math.abs(range.feeTo - nextRange.feeFrom) > 1e-8) {
        throw configError('Fee continuity violation between adjacent tiers', {
          tierIndex: index,
          feeTo: range.feeTo,
          nextFeeFrom: nextRange.feeFrom
        });
      }
    });

    const evaluateRangeAtRub = (range, rubValue) => {
      const numericRub = Number(rubValue);
      if (!Number.isFinite(numericRub) || numericRub <= 0) return null;
      if (numericRub < (range.minRub - rubTolerance)) return null;
      if (range.maxRub !== null && numericRub > (range.maxRub + rubTolerance)) return null;

      const width = range.maxRub === null ? null : (range.maxRub - range.minRub);
      let progress = 0;
      if (width !== null && width > rubTolerance) {
        progress = (numericRub - range.minRub) / width;
        if (!Number.isFinite(progress)) progress = 0;
      }
      const t = Math.min(1, Math.max(0, progress));
      const baseFee = range.feeFrom + ((range.feeTo - range.feeFrom) * t);
      const feeSnapshot = toFeeSnapshot(baseFee);
      if (!feeSnapshot) {
        throw configError('Invalid pricing coefficient for configured tier', {
          tierIndex: range.index,
          baseFee
        });
      }

      const amountCoin = numericRub / (X * feeSnapshot.payRatio);
      if (!Number.isFinite(amountCoin) || amountCoin <= 0) return null;

      const slope = (width !== null && width > rubTolerance)
        ? ((range.feeTo - range.feeFrom) / width)
        : 0;
      const derivative = (feeSnapshot.payRatio - (numericRub * slope))
        / (X * feeSnapshot.payRatio * feeSnapshot.payRatio);
      if (!Number.isFinite(derivative) || derivative <= 0) {
        throw configError('Configured fee curve is not monotonic', {
          tierIndex: range.index,
          rub: numericRub,
          derivative
        });
      }

      return {
        range,
        rub: numericRub,
        amountCoin,
        baseFee: feeSnapshot.baseFee
      };
    };

    const findRangeByRub = (rubValue) => {
      const numericRub = Number(rubValue);
      if (!Number.isFinite(numericRub) || numericRub <= 0) return null;

      for (let i = ranges.length - 1; i >= 0; i -= 1) {
        const range = ranges[i];
        if (numericRub < (range.minRub - rubTolerance)) continue;
        if (range.maxRub !== null && numericRub > (range.maxRub + rubTolerance)) continue;
        return range;
      }

      return null;
    };

    ranges.forEach((range) => {
      const startEval = evaluateRangeAtRub(range, range.minRub);
      if (!startEval) {
        throw configError('Invalid tier start boundary', { tierIndex: range.index });
      }

      if (range.maxRub !== null) {
        const endEval = evaluateRangeAtRub(range, range.maxRub);
        if (!endEval) {
          throw configError('Invalid tier end boundary', { tierIndex: range.index });
        }
        if (endEval.amountCoin <= (startEval.amountCoin + coinTolerance)) {
          throw configError('Tier curve must increase with RUB', { tierIndex: range.index });
        }
      }
    });

    for (let i = 0; i < ranges.length - 1; i += 1) {
      const current = ranges[i];
      const next = ranges[i + 1];
      const currentEndEval = evaluateRangeAtRub(current, current.maxRub);
      const nextStartEval = evaluateRangeAtRub(next, next.minRub);
      if (!currentEndEval || !nextStartEval) {
        throw configError('Invalid tier transition boundary', { tierIndex: i });
      }
      if (Math.abs(currentEndEval.amountCoin - nextStartEval.amountCoin) > 1e-8) {
        throw configError('Tier transition creates discontinuity in quote curve', { tierIndex: i });
      }
      if (nextStartEval.amountCoin + coinTolerance < currentEndEval.amountCoin) {
        throw configError('Tier transition must not decrease quote amount', { tierIndex: i });
      }
    }

    const firstRange = ranges[0];
    const lastRange = ranges[ranges.length - 1];
    const minEval = evaluateRangeAtRub(firstRange, firstRange.minRub);
    const maxEval = lastRange.maxRub === null
      ? null
      : evaluateRangeAtRub(lastRange, lastRange.maxRub);

    if (!minEval) {
      throw configError('Invalid minimum tier boundary');
    }
    if (lastRange.maxRub !== null && !maxEval) {
      throw configError('Invalid maximum tier boundary');
    }

    const makeRangeError = (amountRubValue = null) => {
      const rangeError = new Error('Amount is outside configured fee tiers');
      rangeError.code = 'AMOUNT_OUT_OF_RANGE';
      rangeError.statusCode = 400;
      rangeError.minAmountRub = firstRange.minRub;
      rangeError.maxAmountRub = lastRange.maxRub;
      rangeError.minAmountCoin = minEval.amountCoin;
      rangeError.maxAmountCoin = maxEval ? maxEval.amountCoin : null;
      rangeError.amountRub = Number.isFinite(amountRubValue) ? amountRubValue : null;
      rangeError.coin = coin;
      return rangeError;
    };

    let resolvedAmountCoin;
    let resolvedSumRub;
    let resolvedBaseFee;

    if (shouldUseRubFlow) {
      const selectedRange = findRangeByRub(requestedSumRub);
      if (!selectedRange) {
        throw makeRangeError(requestedSumRub);
      }
      const rubEval = evaluateRangeAtRub(selectedRange, requestedSumRub);
      if (!rubEval) {
        throw makeRangeError(requestedSumRub);
      }

      resolvedAmountCoin = rubEval.amountCoin;
      resolvedSumRub = requestedSumRub;
      resolvedBaseFee = rubEval.baseFee;
    } else {
      const targetCoin = amountCoinInput;
      if (!Number.isFinite(targetCoin) || targetCoin <= 0) {
        throw buildAmountError();
      }

      let solved = null;

      for (let index = ranges.length - 1; index >= 0; index -= 1) {
        const range = ranges[index];
        const lowEval = evaluateRangeAtRub(range, range.minRub);
        if (!lowEval) continue;

        let highRub = range.maxRub;
        let highEval = range.maxRub === null
          ? null
          : evaluateRangeAtRub(range, range.maxRub);

        if (range.maxRub === null) {
          if (targetCoin < (lowEval.amountCoin - coinTolerance)) continue;

          highRub = Math.max(range.minRub + 1, range.minRub * 2);
          highEval = evaluateRangeAtRub(range, highRub);

          let expandIterations = 0;
          while (highEval && highEval.amountCoin < (targetCoin - coinTolerance) && expandIterations < 80) {
            highRub *= 2;
            highEval = evaluateRangeAtRub(range, highRub);
            expandIterations += 1;
          }

          if (!highEval || highEval.amountCoin < (targetCoin - coinTolerance)) {
            continue;
          }
        }

        if (!highEval) continue;
        if (targetCoin < (lowEval.amountCoin - coinTolerance)) continue;
        if (targetCoin > (highEval.amountCoin + coinTolerance)) continue;

        if (Math.abs(targetCoin - lowEval.amountCoin) <= coinTolerance) {
          solved = lowEval;
          break;
        }
        if (Math.abs(targetCoin - highEval.amountCoin) <= coinTolerance) {
          solved = highEval;
          break;
        }

        let lowRub = range.minRub;
        let rightRub = highRub;

        for (let i = 0; i < 80; i += 1) {
          const midRub = (lowRub + rightRub) / 2;
          const midEval = evaluateRangeAtRub(range, midRub);
          if (!midEval) break;

          if (midEval.amountCoin < targetCoin) {
            lowRub = midRub;
          } else {
            rightRub = midRub;
          }
        }

        const finalEval = evaluateRangeAtRub(range, rightRub);
        if (!finalEval) continue;

        solved = finalEval;
        break;
      }

      if (!solved) {
        throw makeRangeError();
      }

      resolvedAmountCoin = targetCoin;
      resolvedSumRub = solved.rub;
      resolvedBaseFee = solved.baseFee;
    }

    if (!Number.isFinite(resolvedAmountCoin) || resolvedAmountCoin <= 0) {
      throw buildAmountError();
    }
    if (!Number.isFinite(resolvedSumRub) || resolvedSumRub <= 0) {
      throw buildSumError();
    }

    const quote = toRoundedQuote(resolvedSumRub, resolvedAmountCoin);
    const roundedRequestedRub = hasRequestedSumRub ? Math.round(requestedSumRub * 100) / 100 : null;
    const actualSumRub = Number(quote?.sumRub);

    return {
      quote,
      rate: X,
      fee: Number.isFinite(resolvedBaseFee) ? resolvedBaseFee : null,
      referral_bonus: R,
      user_discount: V,
      coin,
      dir,
      amount_coin: resolvedAmountCoin,
      requested_sum_rub: roundedRequestedRub,
      actual_sum_rub: Number.isFinite(actualSumRub) ? actualSumRub : null,
      is_adjusted: hasRequestedSumRub && Number.isFinite(actualSumRub)
        ? Math.abs(actualSumRub - roundedRequestedRub) > 0.009
        : false
    };
  }

  /**
   * Создание операции
   * @param {Object} params
   * @returns {Promise<Order>}
   */
  async createOrder(params) {
    const {
      userId,
      userBotId: rawUserBotId,
      user_bot_id: rawUserBotIdSnake,
      dir,
      coin,
      amountCoin: rawAmountCoin,
      amount_coin: rawAmountCoinSnake,
      reqId: rawReqId,
      req_id: rawReqIdSnake,
      exchReqId: rawExchReqId,
      exch_req_id: rawExchReqIdSnake,
      botId,
      cryptoAddress: rawCryptoAddress,
      crypto_address: rawCryptoAddressSnake,
      cardInfo: rawCardInfo,
      card_info: rawCardInfoSnake,
      sumRub: rawSumRub,
      sum_rub: rawSumRubSnake,
      inputMode: rawInputMode,
      amountInputMode: rawAmountInputMode
    } = params;

    const amountCoinParsed = Number(rawAmountCoin ?? rawAmountCoinSnake);
    const sumRub = rawSumRub ?? rawSumRubSnake;
    const requestedSumRub = Number(sumRub);
    const normalizedInputMode = String(rawInputMode ?? rawAmountInputMode ?? '').trim().toUpperCase();
    const canResolveFromRubInputOnly =
      normalizedInputMode === 'RUB' &&
      Number.isFinite(requestedSumRub) &&
      requestedSumRub > 0;

    const hasAmountCoinInput = Number.isFinite(amountCoinParsed) && amountCoinParsed > 0;
    if (!hasAmountCoinInput && !canResolveFromRubInputOnly) {
      const amountError = new Error('Invalid amountCoin');
      amountError.code = 'INVALID_AMOUNT_COIN';
      amountError.statusCode = 400;
      throw amountError;
    }
    const amountCoin = hasAmountCoinInput ? amountCoinParsed : null;

    const userBotId = rawUserBotId ?? rawUserBotIdSnake ?? null;
    const reqId = rawReqId ?? rawReqIdSnake ?? null;
    const exchReqId = rawExchReqId ?? rawExchReqIdSnake ?? null;
    const cryptoAddress = rawCryptoAddress ?? rawCryptoAddressSnake ?? null;
    const cardInfo = rawCardInfo ?? rawCardInfoSnake ?? null;

    // Создание котировки
    const quoteData = await this.createQuote({
      userId,
      dir,
      coin,
      amountCoin,
      botId,
      sumRub,
      inputMode: normalizedInputMode || undefined
    });

    const quoteAmountCoin = Number(quoteData?.amount_coin);
    const orderAmountCoin = Number.isFinite(quoteAmountCoin) && quoteAmountCoin > 0
      ? quoteAmountCoin
      : amountCoin;
    if (!Number.isFinite(orderAmountCoin) || orderAmountCoin <= 0) {
      const amountError = new Error('Invalid amountCoin');
      amountError.code = 'INVALID_AMOUNT_COIN';
      amountError.statusCode = 400;
      throw amountError;
    }

    let userRequisiteId = null;
    let userCardNumber = null;
    let userCardHolder = null;
    let userBankName = null;
    let userCryptoAddress = null;
    
    if (reqId) {
      const existingRequisite = await Requisite.findById(reqId);
      if (existingRequisite) {
        userRequisiteId = reqId;
        if (existingRequisite.kind === 'CARD') {
          const cardData = JSON.parse(Buffer.from(existingRequisite.value_cipher).toString('utf8'));
          userCardNumber = cardData.cardNumber;
          userCardHolder = cardData.cardHolder;
          userBankName = cardData.bankName;
        } else {
          // крипто адрес
          userCryptoAddress = Buffer.from(existingRequisite.value_cipher).toString('utf8');
        }
      }
    } else if (dir === 'BUY' && cryptoAddress) {
      // Для операций покупки, сохраняем крипто адрес напрямую
      userCryptoAddress = cryptoAddress;
      userRequisiteId = await this.findOrCreateUserRequisite(userId, userBotId, coin, cryptoAddress, 'BUY');
    } else if (dir === 'SELL' && cardInfo) {
      // Для операций продажи, сохраняем информацию о карте напрямую
      const cardData = cardInfo.split(' ');
      userCardNumber = cardData[0];
      userBankName = cardData[1];
      userCardHolder = cardData.slice(2).join(' '); 
      userRequisiteId = await this.findOrCreateUserRequisite(userId, userBotId, 'CARD', cardInfo, 'SELL');
    }

    // Получение реквизитов обмена в зависимости от типа операции
    let exchCardNumber = null;
    let exchCardHolder = null;
    let exchBankName = null;
    let exchCryptoAddress = null;
    let selectedExchReqId = null;

    if (exchReqId) {
      // Использовать конкретный реквизит обмена
      const exchRequisite = await BotRequisite.findById(exchReqId);
      if (exchRequisite) {
        selectedExchReqId = exchReqId;
        if (exchRequisite.kind === 'CARD' || exchRequisite.kind === 'SBP') {
          exchCardNumber = exchRequisite.address;
          exchCardHolder = exchRequisite.holder_name;
          exchBankName = exchRequisite.bank_name;
        } else {
          exchCryptoAddress = exchRequisite.address;
        }
      }
    }

    const quotedSumRub = Number(quoteData?.quote?.sumRub);
    const normalizedQuotedSumRub = Number.isFinite(quotedSumRub)
      ? Math.round(quotedSumRub * 100) / 100
      : null;
    const normalizedRequestedSumRub = Number.isFinite(requestedSumRub) && requestedSumRub > 0
      ? Math.round(requestedSumRub * 100) / 100
      : null;
    const finalSumRub = normalizedQuotedSumRub ?? normalizedRequestedSumRub;
    if (!Number.isFinite(finalSumRub) || finalSumRub <= 0) {
      const sumError = new Error('Invalid sumRub');
      sumError.code = 'INVALID_SUM_RUB';
      sumError.statusCode = 400;
      throw sumError;
    }

    // Создание операции
    const orderData = {
      user_id: userId,
      user_bot_id: userBotId || null,
      dir,
      coin,
      amount_coin: orderAmountCoin,
      rate_rub: quoteData.rate,
      fee: quoteData.fee,
      ref_percent: quoteData.referral_bonus || 0,
      user_discount: quoteData.user_discount || 0,
      sum_rub: finalSumRub,
      status: 'QUEUED',
      req_id: reqId || null,
      user_requisite_id: userRequisiteId || null,
      user_card_number: userCardNumber,
      user_card_holder: userCardHolder,
      user_bank_name: userBankName,
      user_crypto_address: userCryptoAddress,
      exch_card_number: exchCardNumber,
      exch_card_holder: exchCardHolder,
      exch_bank_name: exchBankName,
      exch_crypto_address: exchCryptoAddress,
      exch_req_id: selectedExchReqId || exchReqId || null,
      bot_id: botId || null
    };

    const existingOrder = await Order.findActiveByUserBot(userId, botId);
    if (existingOrder) {
      const err = new Error('ACTIVE_ORDER_EXISTS');
      err.userMessage = `У вас уже есть активная операция #${existingOrder.unique_id}. Дождитесь её завершения или отмените её перед созданием новой.`;
      err.existingOrderId = existingOrder.id;
      err.existingOrderUniqueId = existingOrder.unique_id;
      throw err;
    }


    const order = await Order.create(orderData);
try {
  const OrderLogTelegramService = require('./OrderLogTelegramService');
  const messageId = await OrderLogTelegramService.sendCreated(order);
  if (messageId) {
    await Order.setOrderLogMessageId(order.id, messageId);
  }
} catch (e) {
  console.error(`Order log send failed for order ${order.id}:`, e.message);
}

try {
  const OperatorAlertTelegramService = require('./OperatorAlertTelegramService');
  await OperatorAlertTelegramService.sendCreated(order);
} catch (e) {
  console.error(`Operator alert send failed for order ${order.id}:`, e.message);
}


    await logUserAction(userId, 'order_created', { order_id: order.id, dir, coin, amount: orderAmountCoin });

    // отправка сокет-события
    const SocketService = require('./SocketService');
    SocketService.emitOrderCreated(order);

    return order;
  }

  async getActiveOrderForUser(userId, botId) {
    if (!userId || !botId) return null;
    return await Order.findActiveByUserBot(userId, botId);
  }

  /**
   * Получение платежных реквизитов для бота
   * @param {number} botId 
   * @returns {Promise<Object>}
   */
  async getPaymentRequisites(botId) {
    try {
      const cardRequisites = await BotRequisite.getByBotId(botId, {
        type: 'CARD',
        is_active: true
      });

      const sbpRequisites = await BotRequisite.getByBotId(botId, {
        type: 'SBP',
        is_active: true
      });

      return {
        card: cardRequisites.find(r => r.is_default) || cardRequisites[0] || null,
        sbp: sbpRequisites.find(r => r.is_default) || sbpRequisites[0] || null
      };
    } catch (error) {
      console.error('Error getting payment requisites:', error);
      return { card: null, sbp: null };
    }
  }

  /** Получение крипто-адреса для конкретной монеты и бота
   * @param {number} botId 
   * @param {string} coin 
   * @returns {Promise<Object|null>}
   */
  async getCryptoAddress(botId, coin) {
    try {
      const cryptoRequisites = await BotRequisite.getByBotId(botId, {
        type: coin.toUpperCase(),
        is_active: true
      });

      return cryptoRequisites.find(r => r.is_default) || cryptoRequisites[0] || null;
    } catch (error) {
      console.error(`Error getting ${coin} address:`, error);
      return null;
    }
  }

  /**
   * Получение или создание реквизита пользователя
   * @param {number} userId 
   * @param {string} kind 
   * @param {string} value 
   * @param {string} transaction_type 
   * @returns {Promise<number>} 
   */
  async findOrCreateUserRequisite(userId, bot_id, kind, value, transaction_type) {
    const valueCipher = Buffer.from(value, 'utf8'); // 
    

    const existing = await Requisite.findByUserAndValue(userId, kind, valueCipher);
    if (existing) {
      return existing.id;
    }
    
    let label;
    if (kind === 'CARD') {
      label = 'Банковская карта';
    } else {
      label = `${kind} кошелек`;
    }
    
    const requisite = await Requisite.create({
      user_id: userId,
      bot_id: bot_id,
      kind: kind,
      label: label,
      value_cipher: valueCipher,
      is_default: false,
      transaction_type: transaction_type
    });
    
    return requisite.id;
  }

  async confirmOrder(orderId, userId) {
    const order = await Order.findById(orderId);
    
    if (!order) throw new Error('Order not found');
    if (order.user_id !== userId) throw new Error('Access denied');
    if (order.status !== 'AWAITING_CONFIRM') throw new Error('Invalid order status');

    await Order.updateStatus(orderId, 'QUEUED');

    await logUserAction(userId, 'order_confirmed', { order_id: orderId });
    return true;
  }

  async getOperatorCancelBlockReason(order, operatorId) {
    if (!order) {
      return 'Order not found';
    }

    const normalizedOperatorId = Number(operatorId || 0);
    if (!normalizedOperatorId) {
      return 'Access denied';
    }

    if (Number(order.support_id || 0) !== normalizedOperatorId) {
      return 'Access denied';
    }

    const hasExchangerRequisites = Boolean(
      order.exch_req_id ||
      order.exch_card_number ||
      order.exch_card_holder ||
      order.exch_bank_name ||
      order.exch_crypto_address ||
      order.exch_sbp_phone
    );

    if (hasExchangerRequisites) {
      return 'Оператор не может отменить заявку после отправки реквизитов';
    }

    return null;
  }

  /** Прервать аявки
   * @param {number} orderId
   * @param {number} userId
   * @param {string} reason
   * @returns {Promise<boolean>}
   */
  async cancelOrder(orderId, userId, reason = 'user_cancelled', options = {}) {
    const order = await Order.findById(orderId);
    const actorRole = String(options?.actorRole || '').toUpperCase();
    const actorId = options?.actorId ? Number(options.actorId) : null;
    
    if (!order) throw new Error('Order not found');
    if (order.user_id !== userId) throw new Error('Access denied');
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new Error('Cannot cancel completed or already cancelled order');
    }

    if (actorRole === 'OPERATOR') {
      const blockReason = await this.getOperatorCancelBlockReason(order, actorId);
      if (blockReason) {
        throw new Error(blockReason);
      }
    }

    await Order.updateStatus(orderId, 'CANCELLED');
    await logUserAction(userId, 'order_cancelled', { order_id: orderId, reason });

    try {
      const { sendOrderCancelNotification } = require('../utils/botManager');
      const notificationSent = await sendOrderCancelNotification(orderId, reason);
      if (notificationSent) {
        console.log(`Уведомление об отмене отправлено для операции ${orderId}`);
      } else {
        console.warn(`Не удалось отправить уведомление об отмене операции ${orderId}`);
      }
    } catch (error) {
      console.error(`Сбой во время отправке уведомления об отмене операции ${orderId}:`, error);
    }

    return true;
  } 

  async assignToSupport(orderId, supportId) {
    console.log('Assigning order', orderId, 'to support', supportId);
    const order = await Order.findById(orderId);
    
    if (!order) throw new Error('Order not found');
    if (order.status !== 'QUEUED' && order.status !== 'PAYMENT_PENDING') throw new Error('Order must be in QUEUED/PAYMENT_PENDING status');

    const support = await Support.findById(supportId);
    if (!support || !support.is_active) throw new Error('Support not available');

    const activeOrders = await Order.getBySupportId(supportId);
    if (activeOrders.length >= support.active_limit) {
      throw new Error('Support has reached active orders limit');
    }

    let buyQuote = null;
    if (order.dir === 'BUY') {
      buyQuote = await this.getBuyUsdtQuoteOrThrow();
    }

    await Order.assignSupport(orderId, supportId);
    await Order.updateStatus(orderId, 'PAYMENT_PENDING');

    if (order.dir === 'BUY' && buyQuote) {
      await OperatorDebtService.createDebtSnapshotForOrder(
        { ...order, support_id: supportId },
        buyQuote.baseRateRub,
        buyQuote.markupRub,
        this.getOperatorRatePercent(support)
      );
    }

    await logSupportAction(supportId, 'order_assigned', { order_id: orderId });
    return true;
  }

  async autoAssignOrder(orderId) {
    const support = await Support.findLeastLoaded();
    if (!support) return false;

    return await this.assignToSupport(orderId, support.id);
  }

  
  async markPayment(orderId, supportId, actorRole = 'OPERATOR') {
    const order = await Order.findById(orderId);
    const normalizedRole = String(actorRole || '').toUpperCase();
    const isSuperAdmin = normalizedRole === 'SUPERADMIN';
    
    if (!order) throw new Error('Order not found');
    // разрешаем отметку платежа если: нет назначенного оператора ИЛИ текущий пользователь - назначенный оператор ИЛИ админский доступ
    if (!isSuperAdmin && order.support_id && order.support_id !== supportId) {
      console.log(`Admin ${supportId} marking payment for order ${orderId} (originally assigned to ${order.support_id})`);
    }
    if (order.status !== 'PAYMENT_PENDING') throw new Error('Invalid order status');

    await logSupportAction(supportId, 'payment_marked', { order_id: orderId });
    return true;
  }

  /**
   * Подтверждение получения оплаты
   * BUY: PAYMENT_PENDING/AWAITING_CONFIRM -> AWAITING_HASH
   * SELL: AWAITING_CONFIRM -> AWAITING_HASH
   * @param {number} orderId 
   * @param {number} supportId 
   * @returns {Promise<boolean>}
   */
  async confirmPayment(orderId, supportId, actorRole = 'OPERATOR') {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');
      
      const order = await Order.findById(orderId);
      
      if (!order) throw new Error('Order not found');

      const normalizedRole = String(actorRole || '').toUpperCase();
      const canConfirmAnyOrder = ['MANAGER', 'SUPERADMIN'].includes(normalizedRole);

      if (!canConfirmAnyOrder && order.support_id && order.support_id !== supportId) {
        throw new Error('Order not assigned to this operator');
      }

      const canConfirmWithoutReceipt = order.dir === 'BUY' && order.status === 'PAYMENT_PENDING';
      const canConfirmRegularFlow = order.status === 'AWAITING_CONFIRM';

      if (!canConfirmWithoutReceipt && !canConfirmRegularFlow) {
        throw new Error(
          `Неверный статус операции. Ожидается AWAITING_CONFIRM${order.dir === 'BUY' ? ' или PAYMENT_PENDING' : ''}, текущий: ${order.status}`
        );
      }

      // Обновляем статус на AWAITING_HASH
      if (order.dir === 'BUY') {
        const existingDebt = await OperatorDebtService.getDebtByOrder(order.id);
        if (!existingDebt) {
          const buyQuote = await this.getBuyUsdtQuoteOrThrow();
          await OperatorDebtService.createDebtSnapshotForOrder(
            order,
            buyQuote.baseRateRub,
            buyQuote.markupRub
          );
        }
      }

      await Order.updateStatus(orderId, 'AWAITING_HASH');

      await logSupportAction(supportId, 'payment_confirmed', { order_id: orderId });

      await db.query('COMMIT');

      // Отправляем уведомление пользователю
      try {
        const { sendMessageToUser } = require('../utils/botManager');
        const message = `✅ <b>Оплата успешно получена</b>\n\n`;
        const confirmTime = order.dir === 'BUY' ? 15 : 30; // 15 минут для покупки, 30 для продажи
        const confirmMessage = order.dir === 'BUY' 
          ? `📎 Ссылка на транзакцию придет вам в течение ${confirmTime} минут`
          : `📎 ${order.dir === 'SELL' ? 'Деньги' : 'Токены'} будут отправлены на ваши платежные данные. Ссылка на транзакцию придет вам в течение нескольких минут`;
        
        await sendMessageToUser(orderId, message + confirmMessage + `\n\n❤️ Всего вам хорошего, будем рады видеть снова`);
      } catch (error) {
        console.error(`Сбой во время отправке уведомления о подтверждении оплаты ${orderId}:`, error);
      }


      if (order.dir === 'BUY') {
        try {
          await ManagerAlertTelegramService.sendBuyPaymentReady(order);
        } catch (error) {
          console.error(`Manager alert failed for order ${orderId}:`, error.message);
        }
      }

      return true;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Установка хеша транзакции
   * @param {number} orderId 
   * @param {string} transactionHash 
   * @param {number} supportId 
   * @returns {Promise<boolean>}
   */
  async setTransactionHash(orderId, transactionHash, supportId, actorRole = 'OPERATOR') {
    const db = getConnection();
    
    try {
      const order = await Order.findById(orderId);
      
      if (!order) throw new Error('Order not found');

      const normalizedRole = String(actorRole || '').toUpperCase();
      const isSuperAdmin = normalizedRole === 'SUPERADMIN';

      if (!isSuperAdmin && order.support_id && order.support_id !== supportId) {
        throw new Error('Order not assigned to this operator');
      }

      if (order.status !== 'AWAITING_HASH') {
        throw new Error(`Неверный статус операции. Ожидается AWAITING_HASH, текущий: ${order.status}`);
      }

      // Сохраняем хеш в поле hash
      await db.execute(
        'UPDATE orders SET hash = ? WHERE id = ?',
        [transactionHash, orderId]
      );

      await logSupportAction(supportId, 'transaction_hash_set', { 
        order_id: orderId, 
        hash: transactionHash 
      });

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Завершение операции
   * @param {number} orderId 
   * @param {number} supportId 
   * @param {string} transactionHash - опциональный хеш транзакции
   * @param {object} receiptFile - опциональный файл чека
   * @returns {Promise<boolean>}
   */
  async completeOrder(orderId, supportId, transactionHash = null, receiptFile = null, actorRole = 'OPERATOR') {
    const db = getConnection();
    
    try {
      await db.query('START TRANSACTION');
      
      const order = await Order.findById(orderId);
      
      if (!order) throw new Error('Order not found');

      const normalizedRole = String(actorRole || '').toUpperCase();
      const canCompleteBuy = ['MANAGER', 'SUPERADMIN'].includes(normalizedRole);

      if (order.dir === 'BUY' && !canCompleteBuy) {
        throw new Error('Only manager or superadmin can complete BUY orders');
      }

      if (order.support_id && order.support_id !== supportId && !canCompleteBuy) {
        console.log(`Admin ${supportId} completing order ${orderId} (originally assigned to ${order.support_id})`);
      }

      if (order.dir === 'BUY' && order.status !== 'AWAITING_HASH') {
        throw new Error(`BUY order must be in AWAITING_HASH status. Current status: ${order.status}`);
      }

      if (order.dir === 'BUY' && order.status === 'AWAITING_HASH') {
        if (!transactionHash && !order.hash) {
          throw new Error('Требуется указать хеш транзакции для завершения покупки');
        }
        
        if (transactionHash) {
          await db.execute(
            'UPDATE orders SET hash = ? WHERE id = ?',
            [transactionHash, orderId]
          );
        }
      }

      if (order.dir === 'SELL' && receiptFile) {
        // Извлекаем только имя файла и строим относительный путь
        const filename = path.basename(receiptFile.path);
        const receiptPath = `/uploads/receipts/${filename}`;
        await db.execute(
          'UPDATE orders SET receipt_path = ? WHERE id = ?',
          [receiptPath, orderId]
        );
      }

      if (!['AWAITING_CONFIRM', 'AWAITING_HASH'].includes(order.status)) {
        throw new Error(`Операция должна быть в статусе "Ожидание подтверждения" или "Ожидание хеша". Текущий статус: ${order.status}`);
      }

      await Order.updateStatus(orderId, 'COMPLETED');
      await Order.complete(orderId);

      await Review.create(orderId);

      if (order.user_bot_id) {
        try {
          const ReferralService = require('./ReferralService');
          await ReferralService.processReferralBonus(
            orderId,
            parseFloat(order.sum_rub),
            order.user_bot_id, 
            order.bot_id
          );
        } catch (referralError) {
          console.error('Error processing referral bonus:', referralError);
        }
      }

      await logSupportAction(supportId, 'order_completed', { order_id: orderId });

      await db.query('COMMIT');

      try {
        const { sendOrderCompletionNotification } = require('../utils/botManager');
        const notificationSent = await sendOrderCompletionNotification(orderId);
        if (notificationSent) {
          console.log(`Уведомление о завершении отправлено для операции ${orderId}`);
        } else {
          console.warn(`Не удалось отправить уведомление о завершении операции ${orderId}`);
        }
      } catch (error) {
        console.error(`Сбой во время отправке уведомления о завершении операции ${orderId}:`, error);
      }


      if (order.dir === 'BUY') {
        try {
          await ManagerAlertTelegramService.markBuyCompleted(order);
        } catch (error) {
          console.error(`Manager alert completion update failed for order ${orderId}:`, error.message);
        }
      }

      return true;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }

  roundUsdt(value) {
    return Number(Number(value).toFixed(4));
  }

  getOperatorRatePercent(support) {
    return Number(support?.rate_percent || 0);
  }

  normalizeRateRub(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Number(num.toFixed(6));
  }

  applyOperatorPercentToRate(rateWithMarkupRub, operatorRatePercent = 0) {
    const baseRate = this.normalizeRateRub(rateWithMarkupRub);
    if (!baseRate) return null;
    const percent = Number(operatorRatePercent);
    const normalizedPercent = Number.isFinite(percent) ? Number(percent.toFixed(4)) : 0;
    return this.normalizeRateRub(baseRate * (1 + (normalizedPercent / 100)));
  }

  buildBuyUsdtQuote(rateRow) {
    const baseRateRub = this.normalizeRateRub(rateRow?.rate_rub);
    if (!baseRateRub) return null;
    return {
      source: rateRow?.src || 'rates_table',
      baseRateRub,
      markupRub: 0,
      rateWithMarkupRub: baseRateRub,
      rate: baseRateRub
    };
  }

  async getBuyUsdtQuoteOrThrow() {
    const usdtRate = await Rate.getByCoin('USDT');
    const quote = this.buildBuyUsdtQuote(usdtRate);
    if (!quote) {
      throw new Error('USDT rate unavailable');
    }
    return quote;
  }

  async getPreviewBuyUsdtRate() {
    try {
      return await this.getBuyUsdtQuoteOrThrow();
    } catch (error) {
      return null;
    }
  }

  async decorateOrderForViewer(order, viewerRole, viewerId = null, context = {}) {
    if (!order) return order;

    const normalizedRole = String(viewerRole || '').toUpperCase();
    const canDecorateBuySettlement = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes(normalizedRole);
    if (!canDecorateBuySettlement) {
      return order;
    }

    if (String(order.dir || '').toUpperCase() !== 'BUY') {
      return order;
    }

    const sumRub = Number(order.sum_rub || 0);
    const wallet = context.companyWallet || '';

    const debt = await OperatorDebtService.getDebtByOrder(order.id);
    let usdtDue = debt ? Number(debt.usdt_due || 0) : null;

    if (!usdtDue && context.previewQuote) {
      const denominator = Number(
        this.applyOperatorPercentToRate(
          context.previewQuote.rateWithMarkupRub,
          context.operatorRatePercent || 0
        ) || 0
      );
      if (denominator > 0) {
        usdtDue = this.roundUsdt(sumRub / denominator);
      }
    }

    order.rub_to_receive = sumRub;
    order.usdt_due = usdtDue;
    order.usdt_paid = debt ? Number(debt.usdt_paid || 0) : 0;
    order.usdt_open = debt
      ? this.roundUsdt(Number(debt.usdt_due || 0) - Number(debt.usdt_paid || 0))
      : this.roundUsdt(usdtDue || 0);
    order.company_usdt_wallet = wallet || null;
    order.operator_rate_percent = Number(context.operatorRatePercent || 0);
    order.redacted_for_operator = normalizedRole === 'OPERATOR';

    if (normalizedRole === 'OPERATOR') {
      order.coin = null;
      order.amount_coin = null;
      order.user_crypto_address = null;
    }

    return order;
  }

  async decorateOrdersForViewer(orders, viewerRole, viewerId = null) {
    if (!Array.isArray(orders) || orders.length === 0) return orders;

    const normalizedRole = String(viewerRole || '').toUpperCase();
    if (normalizedRole !== 'OPERATOR') {
      return orders;
    }

    const hasBuy = orders.some((order) => String(order?.dir || '').toUpperCase() === 'BUY');
    if (!hasBuy) return orders;

    const companyWallet = await OperatorDebtService.getCompanyWallet();
    const previewQuote = await this.getPreviewBuyUsdtRate();
    let operatorRatePercent = 0;
    if (viewerId) {
      const support = await Support.findById(viewerId);
      operatorRatePercent = this.getOperatorRatePercent(support);
    }
    const context = { companyWallet, previewQuote, operatorRatePercent };

    return await Promise.all(
      orders.map((order) => this.decorateOrderForViewer(order, viewerRole, viewerId, context))
    );
  }

  async getOrders(filters = {}) {
    // если EX_ADMIN, получить список его ботов и фильтровать по ним
    if (filters.user_role === 'EX_ADMIN') {
      const { Bot } = require('../models/Bot');
      const botIds = await Bot.getBotIdsByOwner(filters.user_id);
      console.log('EX_ADMIN botIds:', botIds);
      
      // If EX_ADMIN has no bots, return empty result
      if (!botIds || botIds.length === 0) {
        console.log('EX_ADMIN has no bots, returning empty result');
        return {
          orders: [],
          total: 0,
          pages: 0,
          page: parseInt(filters.page) || 1,
          limit: parseInt(filters.limit) || 20
        };
      }
      
      filters.bot_ids = botIds;
    }
    
    const result = await Order.search(filters);
    
    // если старый формат (массив), фильтруем по депозиту для операторов
    if (Array.isArray(result)) {
      // Filter by deposit for operators
      if (filters.user_role === 'OPERATOR') {
        const filteredOrders = await this.filterOrdersByOperatorDeposit(result, filters.user_id);
        return await this.decorateOrdersForViewer(filteredOrders, filters.user_role, filters.user_id);
      }
      return await this.decorateOrdersForViewer(result, filters.user_role, filters.user_id);
    }
    
    // если новый формат с пагинацией, фильтруем по депозиту для операторов
    if (filters.user_role === 'OPERATOR') {
      const filteredOrders = await this.filterOrdersByOperatorDeposit(result.orders, filters.user_id);
      const decoratedOrders = await this.decorateOrdersForViewer(
        filteredOrders,
        filters.user_role,
        filters.user_id
      );
      return {
        ...result,
        orders: decoratedOrders,
        total: decoratedOrders.length
      };
    }

    result.orders = await this.decorateOrdersForViewer(result.orders, filters.user_role, filters.user_id);
    return result;
  }

  async filterOrdersByOperatorDeposit(orders, operatorId) {
    return orders;
  }

  async getAvailableOrdersForSupport(botIds = null, supportId = null, viewerRole = null, viewerId = null) {
    const orders = await Order.getAvailableForSupport(botIds, supportId);
    return await this.decorateOrdersForViewer(orders, viewerRole, viewerId);
  }


  async assignOrderToSupport(orderId, supportId) {
  const order = await Order.findById(orderId);
  const support = await Support.findById(supportId);
  let buyQuote = null;

  if (order?.dir === 'BUY') {
    buyQuote = await this.getBuyUsdtQuoteOrThrow();
  }

  const assigned = await Order.assignToSupport(orderId, supportId);

  if (assigned?.success) {
    if (order?.dir === 'BUY' && buyQuote) {
      await OperatorDebtService.createDebtSnapshotForOrder(
        { ...order, support_id: supportId },
        buyQuote.baseRateRub,
        buyQuote.markupRub,
        this.getOperatorRatePercent(support)
      );
    }

    await logSupportAction(supportId, 'order_assigned', { order_id: orderId });

    try {
      const OrderLogTelegramService = require('./OrderLogTelegramService');
      await OrderLogTelegramService.markTaken(order, order?.order_log_message_id);
    } catch (e) {
      console.error(`Order log edit failed for order ${orderId}:`, e.message);
    }

    try {
      const OperatorAlertTelegramService = require('./OperatorAlertTelegramService');
      await OperatorAlertTelegramService.markTaken(order);
    } catch (e) {
      console.error(`Operator alert edit failed for order ${orderId}:`, e.message);
    }

    this.sendOperatorTakeAutoMessages(orderId, supportId).catch((autoMessageError) => {
      console.error(`Failed to send operator auto greetings for order ${orderId}:`, autoMessageError.message);
    });
  }

  return assigned;
}

  
  async getOrdersForSupport(supportId) {
    return await Order.getBySupportId(supportId);
  }

  async getOrderDetails(orderId, viewerRole = null, viewerId = null) {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    const normalizedRole = String(viewerRole || '').toUpperCase();
    const canDecorateBuySettlement = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes(normalizedRole);
    if (!canDecorateBuySettlement || String(order.dir || '').toUpperCase() !== 'BUY') {
      return order;
    }

    const supportForRateId = Number(order.support_id || (normalizedRole === 'OPERATOR' ? viewerId : 0)) || null;
    let operatorRatePercent = 0;
    if (supportForRateId) {
      const supportForRate = await Support.findById(supportForRateId);
      operatorRatePercent = this.getOperatorRatePercent(supportForRate);
    }

    return await this.decorateOrderForViewer(order, viewerRole, viewerId, {
      companyWallet: await OperatorDebtService.getCompanyWallet(),
      previewQuote: await this.getPreviewBuyUsdtRate(),
      operatorRatePercent
    });
  }

  async getOrderById(orderId, viewerRole = null, viewerId = null) {
    return await this.getOrderDetails(orderId, viewerRole, viewerId);
  }

  async updateOrderStatus(orderId, status) {
    try {
      await Order.updateStatus(orderId, status);
      
      const SocketService = require('./SocketService');
      const order = await this.getOrderDetails(orderId);
      SocketService.emitOrderUpdated(order);
      
      return true;
    } catch (error) {
      console.error('Error updating order status:', error);
      return false;
    }
  }

  async updateOrderSLAUserPaid(orderId) {
    const db = getConnection();
    const [result] = await db.execute(
      `UPDATE orders SET sla_user_paid_at = NOW() WHERE id = ?`,
      [orderId]
    );
    return result.affectedRows > 0;
  }

  async getOrderMessages(orderId) {
    const db = getConnection();
    const [messagesRaw] = await db.execute(
      `SELECT 
        id, 
        sender_type, 
        sender_id, 
        message,
        original_message,
        translated_message,
        source_lang,
        translated_at,
        attachments_path,
        created_at,
        is_read 
       FROM deal_messages 
       WHERE order_id = ? 
       ORDER BY created_at ASC`,
      [orderId]
    );
    const messages = [];
    let hasLegacyInternalMessages = false;

    messagesRaw.forEach((row) => {
      if (this.isInternalDebtServiceText(row.original_message || row.message)) {
        const legacyInternalMessage = this.buildInternalDebtSyntheticMessageFromLegacyDealMessage(row);
        if (legacyInternalMessage) {
          messages.push(legacyInternalMessage);
          hasLegacyInternalMessages = true;
        }
        return;
      }

      messages.push(row);
    });

    let hasPersistedInternalMessages = false;

    try {
      const [serviceMessageRows] = await db.execute(
        `SELECT
           id,
           order_id,
           message,
           created_at
         FROM order_service_messages
         WHERE order_id = ?
         ORDER BY created_at ASC, id ASC`,
        [orderId]
      );

      serviceMessageRows.forEach((serviceMessageRow) => {
        const syntheticInternalMessage = this.buildInternalDebtSyntheticMessageFromHistoryRow(serviceMessageRow);
        if (syntheticInternalMessage) {
          messages.push(syntheticInternalMessage);
          hasPersistedInternalMessages = true;
        }
      });
    } catch (serviceHistoryError) {
      // Миграция может быть не применена в старом окружении.
      console.warn(`Failed to load internal requisites history for order ${orderId}:`, serviceHistoryError.message);
    }

    // Для старых операций без истории в order_service_messages оставляем fallback из orders.
    if (!hasPersistedInternalMessages && !hasLegacyInternalMessages) {
      try {
        const [orderRows] = await db.execute(
          `SELECT
             o.id,
             o.exch_card_number,
             o.exch_sbp_phone,
             o.exch_bank_name,
             o.exch_card_holder,
             o.sla_requisites_setup_at,
             o.updated_at,
             o.created_at,
             br.label AS exch_label
           FROM orders o
           LEFT JOIN bot_requisites br ON br.id = o.exch_req_id
           WHERE o.id = ?
           LIMIT 1`,
          [orderId]
        );

        const syntheticInternalMessage = this.buildInternalDebtSyntheticMessage(orderRows[0] || {});
        if (syntheticInternalMessage) {
          messages.push(syntheticInternalMessage);
        }
      } catch (serviceMessageError) {
        console.warn(`Failed to append synthetic internal message for order ${orderId}:`, serviceMessageError.message);
      }
    }

    messages.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return String(a.id).localeCompare(String(b.id));
    });

    return messages;
  }

  normalizeChatLanguage(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return ['RU', 'EN'].includes(normalized) ? normalized : 'RU';
  }

  detectTextLanguageByAlphabet(value) {
    const text = String(value || '');
    const hasCyrillic = /[А-ЯЁа-яё]/.test(text);
    const hasLatin = /[A-Za-z]/.test(text);

    if (hasCyrillic && !hasLatin) return 'RU';
    if (hasLatin && !hasCyrillic) return 'EN';
    if (!hasCyrillic && !hasLatin) return 'OTHER';
    return 'MIXED';
  }

  async getSupportChatLanguage(supportId) {
    if (!supportId) return 'RU';

    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT chat_language
       FROM supports
       WHERE id = ?
       LIMIT 1`,
      [supportId]
    );

    return this.normalizeChatLanguage(rows[0]?.chat_language);
  }

  async getAssignedSupportChatLanguage(orderId) {
    const db = getConnection();
    const [rows] = await db.execute(
      `SELECT s.chat_language
       FROM orders o
       LEFT JOIN supports s ON s.id = o.support_id
       WHERE o.id = ?
       LIMIT 1`,
      [orderId]
    );

    return this.normalizeChatLanguage(rows[0]?.chat_language);
  }

  async resolveTranslatedOrderMessage({
    orderId,
    senderId,
    senderType,
    message,
    attachmentsPath = null,
    chatLanguage = null
  }) {
    const text = message == null ? '' : String(message);
    const normalizedText = text.trim();
    const shouldSkipTranslation = !normalizedText || Boolean(attachmentsPath);

    const baseResult = {
      visibleMessage: text,
      originalMessage: text,
      translatedMessage: null,
      sourceLang: null,
      translatedAt: null,
      translationFallback: false
    };

    if (shouldSkipTranslation) {
      return baseResult;
    }

    let effectiveLanguage = this.normalizeChatLanguage(chatLanguage);
    if (senderType === 'USER') {
      effectiveLanguage = await this.getAssignedSupportChatLanguage(orderId);
    } else if (!chatLanguage) {
      effectiveLanguage = await this.getSupportChatLanguage(senderId);
    }

    if (effectiveLanguage !== 'EN') {
      return baseResult;
    }

    const targetLanguage = senderType === 'OPERATOR' ? 'RU' : 'EN';
    const detectedLanguage = this.detectTextLanguageByAlphabet(text);
    if (detectedLanguage === targetLanguage || detectedLanguage === 'OTHER') {
      return {
        ...baseResult,
        sourceLang: detectedLanguage === 'OTHER' ? null : detectedLanguage
      };
    }

    const translationResult = await ChatTranslationService.translateText({
      text,
      targetLanguage
    });

    if (!translationResult.success || !translationResult.translatedText) {
      return {
        ...baseResult,
        translationFallback: true
      };
    }

    return {
      visibleMessage: translationResult.translatedText,
      originalMessage: text,
      translatedMessage: translationResult.translatedText,
      sourceLang: translationResult.sourceLang || null,
      translatedAt: new Date(),
      translationFallback: false
    };
  }


  async markMessagesAsRead(orderId, readerType, readerId = null) {
    const db = getConnection();
  

    if (readerType === 'OPERATOR' && readerId) {

      const [orderRows] = await db.execute(
        `SELECT support_id FROM orders WHERE id = ?`,
        [orderId]
      );
      
      if (orderRows.length === 0) {
        return false; 
      }
      
      const { support_id } = orderRows[0];
      
      if (!support_id || support_id !== readerId) {
        return false;
      }
    }

    const senderType = readerType === 'OPERATOR' ? 'USER' : 'OPERATOR';
    
    const [result] = await db.execute(
      `UPDATE deal_messages 
       SET is_read = 1 
       WHERE order_id = ? AND sender_type = ? AND is_read = 0`,
      [orderId, senderType]
    );
    
    return result.affectedRows > 0;
  }

  async sendOrderMessage(orderId, {
    senderId,
    senderType,
    message,
    attachments_path = null,
    chatLanguage = null
  }) {
    const db = getConnection();
    
    // Сообщения от операторов помечаются как прочитанные сразу (они не должны считаться непрочитанными для самого оператора)
    // Сообщения от пользователей создаются как непрочитанные
    const isRead = senderType === 'OPERATOR' ? 1 : 0;

    const preparedMessage = await this.resolveTranslatedOrderMessage({
      orderId,
      senderId,
      senderType,
      message,
      attachmentsPath: attachments_path,
      chatLanguage
    });
    
    const [result] = await db.execute(
      `INSERT INTO deal_messages (
         order_id,
         sender_type,
         sender_id,
         message,
         original_message,
         translated_message,
         source_lang,
         translated_at,
         attachments_path,
         is_read
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        senderType,
        senderId,
        preparedMessage.visibleMessage,
        preparedMessage.originalMessage,
        preparedMessage.translatedMessage,
        preparedMessage.sourceLang,
        preparedMessage.translatedAt,
        attachments_path,
        isRead
      ]
    );

    const [messageRow] = await db.execute(
      `SELECT
         id,
         sender_type,
         sender_id,
         message,
         original_message,
         translated_message,
         source_lang,
         translated_at,
         attachments_path,
         created_at
       FROM deal_messages WHERE id = ?`,
      [result.insertId]
    );

    return {
      ...messageRow[0],
      translation_fallback: preparedMessage.translationFallback
    };
  }

  async getUserOrders(userId, options = {}) {
    const db = getConnection();
    const { limit = 10, offset = 0, botId = null } = options;
    
    let query = `SELECT * FROM orders 
       WHERE user_id = ? AND status = 'COMPLETED'`;
    const params = [userId];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    query += ` ORDER BY created_at DESC 
       LIMIT ${limit} OFFSET ${offset}`;
    
    const [rows] = await db.execute(query, params);
    
    return rows;
  }

  async getUserOrdersCount(userId, botId = null) {
    const db = getConnection();
    
    let query = `SELECT COUNT(*) as total FROM orders WHERE user_id = ? AND status = 'COMPLETED'`;
    const params = [userId];
    
    if (botId) {
      query += ' AND bot_id = ?';
      params.push(botId);
    }
    
    const [rows] = await db.execute(query, params);
    
    return rows[0].total;
  }

  async getOperatorStats(supportId) {
    const db = getConnection();
    
    console.log('📊 Getting stats for support ID:', supportId);
    
    const [supportInfo] = await db.execute(
      `SELECT deposit, deposit_paid, deposit_work FROM supports WHERE id = ?`,
      [supportId]
    );
    
    console.log('📊 Support info:', supportInfo[0]);
    
    const capacity = await Order.getSupportCapacityMetrics(supportId);
    const debtAggregate = await OperatorDebtService.getAggregateDebt(supportId);

    const depositPaid = this.roundUsdt(parseFloat(supportInfo[0]?.deposit_paid) || 0);
    const depositWork = this.roundUsdt(parseFloat(supportInfo[0]?.deposit_work ?? supportInfo[0]?.deposit) || 0);
    const activeOrdersUsdt = this.roundUsdt(Number(capacity?.active_orders_usdt || 0));
    const openDebtUsdt = this.roundUsdt(Number((capacity?.open_debt_usdt ?? debtAggregate.usdt_open_total) || 0));
    const occupiedUsdt = this.roundUsdt(Number(capacity?.occupied_usdt || (activeOrdersUsdt + openDebtUsdt)));
    const availableDeposit = this.roundUsdt(Number(capacity?.available_deposit_usdt || (depositWork - occupiedUsdt)));
    const currentOrdersCount = Number(capacity?.current_orders || 0);
    
    console.log('📊 Calculations:', {
      depositPaid,
      depositWork,
      activeOrdersUsdt,
      openDebtUsdt,
      occupiedUsdt,
      availableDeposit,
      currentOrdersCount
    });
    
    const [completedStats] = await db.execute(
      `SELECT 
         COUNT(*) as total_completed,
         COALESCE(SUM(sum_rub), 0) as total_volume
       FROM orders 
       WHERE support_id = ? AND status = 'COMPLETED'`,
      [supportId]
    );

    const [monthlyStats] = await db.execute(
      `SELECT 
         COUNT(*) as monthly_completed,
         COALESCE(SUM(sum_rub), 0) as monthly_volume
       FROM orders 
       WHERE support_id = ? 
         AND status = 'COMPLETED'
         AND YEAR(CONVERT_TZ(completed_at, '+00:00', '+03:00')) = YEAR(NOW()) 
         AND MONTH(CONVERT_TZ(completed_at, '+00:00', '+03:00')) = MONTH(NOW())`,
      [supportId]
    );

    const [yearlyStats] = await db.execute(
      `SELECT 
         COUNT(*) as yearly_completed,
         COALESCE(SUM(sum_rub), 0) as yearly_volume
       FROM orders 
       WHERE support_id = ? 
         AND status = 'COMPLETED'
         AND YEAR(CONVERT_TZ(completed_at, '+00:00', '+03:00')) = YEAR(NOW())`,
      [supportId]
    );

    const [todayStats] = await db.execute(
      `SELECT 
         COUNT(*) as today_completed,
         COALESCE(SUM(sum_rub), 0) as today_volume
       FROM orders 
       WHERE support_id = ? 
         AND status = 'COMPLETED'
         AND DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')) = CURDATE()`,
      [supportId]
    );

    const [assignedStats] = await db.execute(
      `SELECT 
         COUNT(*) as assigned_orders
       FROM orders 
       WHERE support_id = ? 
         AND status IN ('QUEUED', 'PAYMENT_PENDING', 'AWAITING_CONFIRM', 'AWAITING_HASH')`,
      [supportId]
    );

    const [todayCancelledStats] = await db.execute(
      `SELECT 
         COUNT(*) as today_cancelled
       FROM orders 
       WHERE support_id = ? 
         AND status = 'CANCELLED'
         AND DATE(updated_at) = CURDATE()`,
      [supportId]
    );

    const rating = await Support.calculateRating(supportId);

    const result = {
      deposit: depositWork,
      deposit_paid: depositPaid,
      deposit_work: depositWork,
      deposit_used: occupiedUsdt,
      deposit_used_usdt: occupiedUsdt,
      active_orders_usdt: activeOrdersUsdt,
      open_debt_usdt: openDebtUsdt,
      debt: debtAggregate,
      available_deposit: availableDeposit,
      available_deposit_usdt: availableDeposit,
      current_orders: currentOrdersCount,
      rating: rating,
      total: {
        completed: completedStats[0].total_completed || 0,
        volume: parseFloat(completedStats[0].total_volume) || 0
      },
      monthly: {
        completed: monthlyStats[0].monthly_completed || 0,
        volume: parseFloat(monthlyStats[0].monthly_volume) || 0
      },
      yearly: {
        completed: yearlyStats[0].yearly_completed || 0,
        volume: parseFloat(yearlyStats[0].yearly_volume) || 0
      },
      today: {
        completed: todayStats[0].today_completed || 0,
        volume: parseFloat(todayStats[0].today_volume) || 0,
        cancelled: todayCancelledStats[0].today_cancelled || 0
      },
      assigned: assignedStats[0].assigned_orders || 0
    };
    
    console.log('📊 Final result:', result);
    
    return result;
  }

  async getOperatorChartData(supportId, days = 7) {
    const db = getConnection();
    
    console.log(`Getting chart data for support ${supportId}, last ${days} days`);
    
    const [dailyStats] = await db.execute(
      `SELECT 
         DATE_FORMAT(DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')), '%Y-%m-%d') as date,
         COUNT(*) as completed_orders,
         COALESCE(SUM(sum_rub), 0) as total_volume
       FROM orders 
       WHERE support_id = ? 
         AND status = 'COMPLETED'
         AND DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')) <= CURDATE()
       GROUP BY DATE_FORMAT(DATE(CONVERT_TZ(completed_at, '+00:00', '+03:00')), '%Y-%m-%d')
       ORDER BY date ASC`,
      [supportId, days]
    );

    const result = [];
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() - i);
      const dateStr = currentDate.toISOString().split('T')[0];
      
      const dayData = dailyStats.find(stat => stat.date === dateStr);
      
      result.push({
        date: dateStr,
        completed_orders: dayData ? dayData.completed_orders : 0,
        total_volume: dayData ? parseFloat(dayData.total_volume) : 0
      });
    }

    return result;
  }


}

module.exports = new OrderService();

