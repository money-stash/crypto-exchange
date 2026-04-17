const { Telegraf, Markup, session } = require('telegraf');
const { Bot, BotRequisite } = require('../models/Bot');
const User = require('../models/User');
const UserBot = require('../models/UserBot');
const Requisite = require('../models/Requisite');
const OrderService = require('../services/OrderService');
const RateService = require('../services/RateService');
const ActivationAlertTelegramService = require('../services/ActivationAlertTelegramService');
const Fee = require('../models/Fee');
const { calcQuote } = require('../utils/calculator');
const { validateWalletAddress, getValidationErrorMessage } = require('../utils/walletValidator');
const imageGenerator = require('../utils/imageGenerator');
const telegramImageCache = require('../utils/telegramImageCache');
const { logTelegramAction } = require('../utils/logger');
const { InputFile } = require('telegraf/types');

const RECEIPT_ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'gif', 'pdf'];
const RECEIPT_ALLOWED_FORMATS_TEXT = RECEIPT_ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(', ');
const RECEIPT_MIME_TO_EXTENSION = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/heic-sequence': 'heic',
  'image/heif-sequence': 'heif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/gif': 'gif'
};
const CAPTCHA_FRUIT_EMOJIS = ['🍎', '🍌', '🍇', '🍉', '🍓', '🍒', '🥝', '🍍', '🥥', '🍑'];
const CAPTCHA_OPTIONS_COUNT = 6;
const CAPTCHA_CALLBACK_PREFIX = 'captcha_pick_';

class MultiTelegramBotManager {
  constructor() {
    this.bots = new Map();
    this.orderService = OrderService;
    this.rateService = RateService;
    this.botUsernames = new Map();
    this.orderFlowMessageState = new Map();
  }

  truncateAuditText(value, maxLength = 500) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  extractCommand(text) {
    const normalized = String(text || '').trim();
    if (!normalized.startsWith('/')) return null;
    const command = normalized.split(/\s+/)[0] || '';
    return command || null;
  }

  resolveAuditActionByContext(ctx, updateType) {
    if (updateType === 'callback_query') return 'bot_callback_click';
    if (updateType === 'message') {
      if (ctx.message?.text) {
        return this.extractCommand(ctx.message.text) ? 'bot_command' : 'bot_text_input';
      }
      if (ctx.message?.photo) return 'bot_photo_input';
      if (ctx.message?.document) return 'bot_document_input';
      if (ctx.message?.video) return 'bot_video_input';
      if (ctx.message?.voice) return 'bot_voice_input';
      if (ctx.message?.audio) return 'bot_audio_input';
      if (ctx.message?.animation) return 'bot_animation_input';
      if (ctx.message?.sticker) return 'bot_sticker_input';
    }
    return `bot_${updateType || 'update'}`;
  }

  buildBotAuditMeta(ctx, updateType) {
    const message = ctx.message || null;
    const callback = ctx.callbackQuery || null;
    const callbackMessage = callback?.message || null;

    const messageText = this.truncateAuditText(message?.text, 1000);
    const captionText = this.truncateAuditText(message?.caption, 600);
    const callbackData = this.truncateAuditText(callback?.data, 300);
    const command = messageText ? this.extractCommand(messageText) : null;

    return {
      source: 'telegram_bot',
      bot_id: ctx.botConfig?.id || null,
      bot_identifier: ctx.botConfig?.identifier || null,
      update_type: updateType,
      message_type: ctx.message?.text
        ? 'text'
        : ctx.message?.photo
          ? 'photo'
          : ctx.message?.document
            ? 'document'
            : ctx.message?.video
              ? 'video'
              : ctx.message?.voice
                ? 'voice'
                : ctx.message?.audio
                  ? 'audio'
                  : ctx.message?.animation
                    ? 'animation'
                    : callback
                      ? 'callback'
                      : null,
      tg_id: ctx.from?.id || null,
      username: ctx.from?.username || null,
      first_name: ctx.from?.first_name || null,
      last_name: ctx.from?.last_name || null,
      chat_id: ctx.chat?.id || callbackMessage?.chat?.id || null,
      message_id: message?.message_id || callbackMessage?.message_id || null,
      command,
      callback_data: callbackData,
      text: messageText,
      caption: captionText,
      has_photo: Boolean(message?.photo?.length),
      has_document: Boolean(message?.document),
      has_video: Boolean(message?.video),
      has_voice: Boolean(message?.voice),
      has_audio: Boolean(message?.audio),
      has_animation: Boolean(message?.animation),
      has_sticker: Boolean(message?.sticker)
    };
  }

  async logBotUpdate(ctx) {
    try {
      const tgId = Number(ctx?.from?.id || 0);
      if (!tgId) return;

      const updateType = String(ctx?.updateType || '').trim() || 'update';
      const action = this.resolveAuditActionByContext(ctx, updateType);
      const meta = this.buildBotAuditMeta(ctx, updateType);

      await logTelegramAction(tgId, action, meta);
    } catch (error) {
      console.error('Failed to write bot audit log:', error?.message || error);
    }
  }

  getDaysWord(days) {
    const lastDigit = days % 10;
    const lastTwoDigits = days % 100;
    
    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
      return 'дней';
    }
    
    if (lastDigit === 1) {
      return 'день';
    } else if (lastDigit >= 2 && lastDigit <= 4) {
      return 'дня';
    } else {
      return 'дней';
    }
  }

  // форматирование и валидация файлов квитанции
  getReceiptAllowedFormatsText() {
    return RECEIPT_ALLOWED_FORMATS_TEXT;
  }

  getReceiptInvalidFormatMessage() {
    return `❌ Формат не подходит файла.

Пожалуйста, отправьте чек в одном из форматов: <b>${this.getReceiptAllowedFormatsText()}</b>.`;
  }

  getReceiptFilePayload(ctx) {
    const path = require('path');

    if (ctx.message?.photo?.length) {
      const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
      return {
        fileId: largestPhoto.file_id,
        extension: 'jpg'
      };
    }

    const media = ctx.message?.document || ctx.message?.animation;
    if (!media) {
      return null;
    }

    const mimeType = (media.mime_type || '').toLowerCase();
    const fileName = media.file_name || '';
    const extensionFromName = path.extname(fileName).replace('.', '').toLowerCase();
    const extensionFromMime = RECEIPT_MIME_TO_EXTENSION[mimeType];

    const isAllowedByExtension = RECEIPT_ALLOWED_EXTENSIONS.includes(extensionFromName);
    const isAllowedByMime = Boolean(extensionFromMime);
    if (!isAllowedByExtension && !isAllowedByMime) {
      return null;
    }

    const extension = isAllowedByExtension ? extensionFromName : extensionFromMime;
    if (!extension || !RECEIPT_ALLOWED_EXTENSIONS.includes(extension)) {
      return null;
    }

    return {
      fileId: media.file_id,
      extension
    };
  }

  getMainMenuInlineKeyboard(botConfig) {
    const keyboard = [
      [
        Markup.button.callback('💸 Обмен RUB → CRYPTO', 'menu_buy'),
        Markup.button.url('💵 Обмен CRYPTO → RUB', 'https://t.me/prodat_kripty')
      ],
      [Markup.button.callback('👤 Личный раздел', 'menu_cabinet')]
    ];

    if (botConfig?.reviews_chat_link) {
      keyboard.push([Markup.button.url('⭐ Рейтинг', botConfig.reviews_chat_link)]);
    } else {
      keyboard.push([Markup.button.callback('⭐ Рейтинг', 'menu_reviews')]);
    }

    keyboard.push([Markup.button.callback('📲 Контакты', 'menu_contacts')]);

    return Markup.inlineKeyboard(keyboard);
  }

  async configureTelegramMenuCommands(bot, botConfig) {
    const commands = [{ command: 'start', description: '🏠 Главное меню' }];
    const targets = [
      {},
      { scope: { type: 'all_private_chats' } },
      { language_code: 'ru' },
      { scope: { type: 'all_private_chats' }, language_code: 'ru' }
    ];

    for (const target of targets) {
      await bot.telegram.setMyCommands(commands, target);
    }

    // Фиксируем кнопку меню как "commands", чтобы она не пропадала в клиенте.
    await bot.telegram.callApi('setChatMenuButton', {
      menu_button: { type: 'commands' }
    });

    console.log(`✅ Telegram command menu configured for bot ${botConfig.name}`);
  }

  // инициализация всех активных ботов из базы
  async initialize() {
    try {
      console.log('🤖 Initializing Telegram bots from database...');

      // получаем всех активных ботов
      const result = await Bot.getAll({ is_active: true });
      const activeBots = result.bots || result || [];

      for (const botConfig of activeBots) {
        await this.initializeBot(botConfig);
      }

      // Настраиваем Socket.IO слушателей для чатов поддержки
      this.setupSocketListeners();

      console.log(`✅ Successfully initialized ${this.bots.size} bots`);
    } catch (error) {
      console.error('❌ Error initializing bots:', error);
    }
  }

  // запуск одного бота при старте
  async initializeBot(botConfig) {
    try {
      console.log(`Starting bot: ${botConfig.name} (${botConfig.identifier})`);

      const bot = new Telegraf(botConfig.token);

      // глобальный обработчик ошибок
      bot.catch((err, ctx) => {
        console.error(`Bot ${botConfig.identifier} error:`, err);
        if (ctx) {
          try {
            ctx.reply('Не удалось выполнить действие, попробуйте позже');
          } catch (replyError) {
            console.error(`Bot ${botConfig.identifier} reply error:`, replyError);
          }
        }
      });

      // сессии с уникальным ключом для каждого бота
      bot.use(session({
        getSessionKey: (ctx) => {
          return `${botConfig.id}:${ctx.from?.id}:${ctx.chat?.id}`;
        }
      }));

      // сохраняем конфиг бота в контексте и инициализируем сессию
      bot.use((ctx, next) => {
        ctx.botConfig = botConfig;
        // проверяем что сессия инициализирована
        if (!ctx.session) {
          ctx.session = {};
        }
        return next();
      });

      bot.use((ctx, next) => {
        this.logBotUpdate(ctx);
        return next();
      });

      this.setupBotCommands(bot, botConfig);

      try {
        await this.configureTelegramMenuCommands(bot, botConfig);
      } catch (menuError) {
        console.warn(`Failed to configure Telegram command menu for bot ${botConfig.name}:`, menuError.message);
      }

      // запускаем бота асинхронно чтобы не блокировать основной поток
      bot.launch().then(async () => {
        console.log(`✅ Bot ${botConfig.name} started successfully`);

        // кешируем юзернейм после запуска
        try {
          const botInfo = await bot.telegram.getMe();
          if (botInfo.username) {
            this.botUsernames.set(botConfig.id, botInfo.username);
            console.log(`✅ Cached username for bot ${botConfig.name}: @${botInfo.username}`);
          }
        } catch (error) {
          console.warn(`Failed to cache username for bot ${botConfig.name}:`, error);
        }
      }).catch((error) => {
        console.error(`❌ Error launching bot ${botConfig.name}:`, error);
      });

      // сохраняем в мапе сразу
      this.bots.set(botConfig.id, {
        bot: bot,
        config: botConfig
      });
    } catch (error) {
      console.error(`❌ Error starting bot ${botConfig.name}:`, error.message);
    }
  }

  // остановка бота
  async stopBot(botId) {
    const botInstance = this.bots.get(botId);
    if (botInstance) {
      try {
        await botInstance.bot.stop();
        this.bots.delete(botId);
        // очищаем кеш юзернейма
        this.botUsernames.delete(botId);
        console.log(`🛑 Bot ${botInstance.config.name} stopped`);
      } catch (error) {
        console.error(`❌ Error stopping bot ${botInstance.config.name}:`, error);
      }
    }
  }

  // перезапуск бота при изменении конфига
  async restartBot(botConfig) {
    await this.stopBot(botConfig.id);
    await this.startBot(botConfig);
  }

  // редактирование сообщения или подписи в зависимости от типа
  async editMessageOrCaption(ctx, newText, extra = {}) {
    // проверяем есть ли фото или это текст
    const message = ctx.callbackQuery?.message;
    const hasPhoto = message?.photo && message.photo.length > 0;
    const hasCaption = message?.caption !== undefined;

    try {
      if (hasPhoto || hasCaption) {
        await ctx.editMessageCaption(newText, extra);
      } else {
        // если текст - редактируем текст
        await ctx.editMessageText(newText, extra);
      }
      if (this.isSingleNavigationMode(ctx) && message?.message_id) {
        this.rememberNavigationMessage(ctx, message);
      }
    } catch (error) {
      // если не получилось, пробуем наоборот
      console.warn('First edit attempt failed, trying alternative method:', error.message);
      try {
        if (hasPhoto || hasCaption) {
          await ctx.editMessageText(newText, extra);
        } else {
          await ctx.editMessageCaption(newText, extra);
        }
      } catch (secondError) {

        console.error('Failed to edit message with both methods, sending new message:', secondError.message);
        if (this.isSingleNavigationMode(ctx)) {
          await this.replaceNavigationText(ctx, newText, extra);
          return;
        }
        try {
          await ctx.deleteMessage();
          await ctx.reply(newText, extra);
        } catch (thirdError) {
          console.error('Failed to delete and send new message:', thirdError.message);

          await ctx.reply(newText, extra);
        }
      }
    }
  }

  // настройка команд для бота
  setupBotCommands(bot, botConfig) {

    bot.start(async (ctx) => {
      // проверяем не заблокирован ли пользователь
      if (await this.checkUserBlocked(ctx, { skipCaptcha: true })) return;
      const lockOnStart = await this.enforceActiveOrderLock(ctx);
      if (lockOnStart.blocked) return;

      // проверяем реферальный код в параметре старта
      const startPayload = ctx.startPayload;
      let referralCode = null;

      if (startPayload && startPayload.length > 0) {
        referralCode = startPayload;
        console.log(`User ${ctx.from.id} started bot with referral code: ${referralCode}`);
      }

      const previousNavigationMessage = this.getNavigationMessageState(ctx);
      const userBot = await this.getOrCreateUser(ctx, referralCode);
      ctx.session = {};
      if (previousNavigationMessage?.messageId) {
        await this.safeDeleteMessage(
          ctx,
          previousNavigationMessage.messageId,
          previousNavigationMessage.chatId
        );
      }

      if (!this.hasUserBotPassedCaptcha(userBot)) {
        await this.showEmojiCaptcha(ctx);
        return;
      }

      await this.showWelcomeMenu(ctx);
    });


    bot.command('course', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showCourses(ctx);
    });

    bot.hears('📊 Тарифы', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showCourses(ctx);
    });


    bot.command('buy', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.startBuyFlow(ctx);
    });

    bot.hears('💸 Обмен RUB → CRYPTO', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.startBuyFlow(ctx);
    });


    bot.command('sell', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.startSellFlow(ctx);
    });

    bot.hears('💵 Обмен CRYPTO → RUB', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.startSellFlow(ctx);
    });


    bot.command('cabinet', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showCabinet(ctx);
    });

    bot.hears('👤 Личный раздел', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showCabinet(ctx);
    });


    bot.command('help', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showHelp(ctx);
    });

    bot.hears('❓ Помощь', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showHelp(ctx);
    });

    bot.command('contacts', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showContacts(ctx);
    });

    bot.hears('📲 Контакты', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.showContacts(ctx);
    });

    bot.hears('🆘 Помощь', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx);
      if (lock.blocked) return;
      this.closeChatMode(ctx);
      await this.startSupportChat(ctx);
    });

    // обработка колбеков от инлайн кнопок
    bot.on('callback_query', async (ctx) => {
      const data = String(ctx.callbackQuery?.data || '');
      if (data.startsWith(CAPTCHA_CALLBACK_PREFIX)) {
        if (await this.checkUserBlocked(ctx, { skipCaptcha: true })) return;
        await this.handleEmojiCaptchaSelection(ctx, data);
        return;
      }

      if (await this.checkUserBlocked(ctx)) return;
      const lock = await this.enforceActiveOrderLock(ctx, { callbackData: data });
      if (lock.blocked) return;

      try {
        switch (true) {
          case data === 'menu_buy':
            this.closeChatMode(ctx);
            await this.startBuyFlow(ctx);
            break;

          case data === 'menu_sell':
            this.closeChatMode(ctx);
            await this.startSellFlow(ctx);
            break;

          case data === 'menu_cabinet':
            this.closeChatMode(ctx);
            await this.showCabinet(ctx);
            break;

          case data === 'menu_contacts':
            this.closeChatMode(ctx);
            await this.showContacts(ctx);
            break;

          case data === 'menu_reviews':
            await this.replaceNavigationText(ctx, 'Репутация пока не настроены', {
              ...Markup.inlineKeyboard([
                [Markup.button.callback('↩️ Назад', 'main_menu')]
              ])
            });
            break;

          case data.startsWith('buy_') || data.startsWith('sell_'): {
            const [action, coin] = data.split('_');
            ctx.session = ctx.session || {};
            
            // Выходим из режима чата поддержки при начале операции
            ctx.session.supportChatMode = null;
            ctx.session.chatMode = null;
            
            ctx.session.operation = {
              type: action.toUpperCase(),
              coin,
              amountInputMode: 'CRYPTO'
            };

            await this.showAmountInputStep(ctx, false);
            break;
          }

          case data === 'amount_mode_rub':
            if (!this.isCallbackFromCurrentNavigationMessage(ctx)) {
              await ctx.answerCbQuery('Это устаревшее сообщение. Используйте последнюю карточку.');
              break;
            }
            if (ctx.session?.operation) {
              ctx.session.operation.amountInputMode = 'RUB';
              const isEditAmountFlow = ctx.session.waitingFor === 'edit_amount';
              await this.showAmountInputStep(
                ctx,
                true,
                isEditAmountFlow
                  ? { waitingFor: 'edit_amount', backCallback: 'back_to_order_summary' }
                  : {}
              );
            }
            await ctx.answerCbQuery();
            break;

          case data === 'amount_mode_crypto':
            if (!this.isCallbackFromCurrentNavigationMessage(ctx)) {
              await ctx.answerCbQuery('Это устаревшее сообщение. Используйте последнюю карточку.');
              break;
            }
            if (ctx.session?.operation) {
              ctx.session.operation.amountInputMode = 'CRYPTO';
              const isEditAmountFlow = ctx.session.waitingFor === 'edit_amount';
              await this.showAmountInputStep(
                ctx,
                true,
                isEditAmountFlow
                  ? { waitingFor: 'edit_amount', backCallback: 'back_to_order_summary' }
                  : {}
              );
            }
            await ctx.answerCbQuery();
            break;

          case data === 'confirm_order':
            await this.createOrder(ctx);
            break;

          case data.startsWith('payment_'):
            await this.requestPaymentReceipt(ctx, data);
            break;

          case data.startsWith('support_'):
            await this.handleSupportRequest(ctx, data);
            break;

          case data.startsWith('order_details_'):
            await this.showOrderDetails(ctx, data);
            break;

          case data.startsWith('order_'):
            await this.showOrderStatus(ctx, data);
            break;

          case data.startsWith('reply_support_'):
            // ВАЖНО: эта проверка должна быть РАНЬШЕ reply_ чтобы не перехватывалась
            const supportChatId = data.split('_')[2];
            await this.replyToSupportChat(ctx, supportChatId);
            break;

          case data.startsWith('reply_'):
            await this.startChatReply(ctx, data);
            break;

          case data === 'history':
            this.closeChatMode(ctx);
            await this.showOrderHistory(ctx);
            break;

          case data === 'user_requisites':
            this.closeChatMode(ctx);
            await this.showUserRequisites(ctx);
            break;

          case data.startsWith('requisites_page_'):
            this.closeChatMode(ctx);
            await this.showUserRequisites(ctx, data);
            break;

          case data.startsWith('requisite_details_'):
            this.closeChatMode(ctx);
            await this.showRequisiteDetails(ctx, data);
            break;

          case data.startsWith('delete_requisite_'):
            this.closeChatMode(ctx);
            await this.deleteRequisite(ctx, data);
            break;

          case data === 'back_to_requisites':
            this.closeChatMode(ctx);
            await this.showUserRequisites(ctx);
            break;

          case data.startsWith('history_page_'):
            this.closeChatMode(ctx);
            await this.showOrderHistory(ctx, data);
            break;

          case data === 'back_to_history':
            this.closeChatMode(ctx);
            await this.showOrderHistory(ctx);
            break;

          case data === 'back_to_cabinet':
            this.closeChatMode(ctx);
            await this.showCabinetInline(ctx);
            break;

          case data.startsWith('select_requisite_'):
            await this.handleRequisiteSelection(ctx, data);
            break;

          case data === 'continue_with_selected':
            ctx.session.waitingFor = null;
            // удаляем предыдущее сообщение с выбором реквизитов чтобы показать новую сводку
            try {
              await ctx.deleteMessage();
            } catch (error) {
              console.log('Could not delete message:', error.message);
            }
            // показываем сводку заказа как новое сообщение
            await this.showOrderSummary(ctx, false);
            break;

          case data === 'cancel_chat':
            await this.cancelChatMode(ctx);
            break;

          case data === 'cancel_receipt_upload':
            await this.cancelReceiptUpload(ctx);
            break;

          case data === 'create_requisite':
            this.closeChatMode(ctx);
            await this.showCreateRequisiteTypeSelection(ctx);
            break;

          case data.startsWith('create_requisite_'):
            this.closeChatMode(ctx);
            await this.handleCreateRequisite(ctx, data);
            break;

          case data === 'referral_program':
            this.closeChatMode(ctx);
            await this.showCabinetInline(ctx);
            break;

          case data === 'withdraw_bonuses':
            this.closeChatMode(ctx);
            await this.showWithdrawalCurrencySelection(ctx);
            break;

          case data.startsWith('withdraw_currency_'):
            this.closeChatMode(ctx);
            await this.handleWithdrawalCurrencySelection(ctx, data);
            break;

          case data === 'withdraw_confirm':
            this.closeChatMode(ctx);
            await this.confirmWithdrawal(ctx);
            break;

          case data === 'withdraw_cancel':
            this.closeChatMode(ctx);
            await this.cancelWithdrawal(ctx);
            break;

          case data.startsWith('rate_'):
            this.closeChatMode(ctx);
            await this.handleRatingSubmission(ctx, data);
            break;

          case data.startsWith('leave_comment_'):
            this.closeChatMode(ctx);
            await this.handleLeaveComment(ctx, data);
            break;

          case data === 'cancel_review_comment':
            ctx.session.waitingForReviewComment = null;
            await ctx.reply('❌ Действие прервано');
            await ctx.answerCbQuery('Действие прервано');
            break;

          case data === 'edit_order':
            await this.showEditOrderOptions(ctx);
            break;

          case data === 'edit_address':
            await this.startEditAddress(ctx);
            break;

          case data === 'edit_requisites':
            await this.startEditRequisites(ctx);
            break;

          case data === 'edit_amount':
            await this.startEditAmount(ctx);
            break;

          case data === 'edit_coin':
            await this.startEditCoin(ctx);
            break;

          case data === 'back_to_order_summary':
            await this.showOrderSummary(ctx, true);
            break;

          case data === 'cancel_order':
            await this.handleOrderCancellation(ctx);
            break;

          case data === 'cancel':
            this.resetSessionPreserveNavigation(ctx);
            await this.showWelcomeMenu(ctx);
            await ctx.answerCbQuery('Операция отменена');
            break;

          case data === 'main_menu': {
            this.resetSessionPreserveNavigation(ctx);
            await this.showWelcomeMenu(ctx);
            break;
          }

          case data === 'main_menu_new_message': {
            const previousNavigationMessage = this.getNavigationMessageState(ctx);
            const callbackMessageId = Number(ctx.callbackQuery?.message?.message_id || 0);
            ctx.session = {};
            if (
              previousNavigationMessage?.messageId &&
              Number(previousNavigationMessage.messageId) !== callbackMessageId
            ) {
              await this.safeDeleteMessage(
                ctx,
                previousNavigationMessage.messageId,
                previousNavigationMessage.chatId
              );
            }
            await this.showWelcomeMenuAsNewMessage(ctx);
            break;
          }

          case data === 'back_to_buy_menu':
            this.resetSessionPreserveNavigation(ctx);
            await this.startBuyFlow(ctx);
            break;

          case data === 'back_to_sell_menu':
            this.resetSessionPreserveNavigation(ctx);
            await this.startSellFlow(ctx);
            break;

          case data === 'back_to_amount_input':
            if (ctx.session && ctx.session.operation) {
              await this.showAmountInputStep(ctx, false);
            }
            break;

          case data === 'back_to_card_input':
            if (ctx.session && ctx.session.operation) {
              await this.showSellCardInputStep(ctx);
            }
            break;

          case data === 'back_to_bank_input':
            if (ctx.session && ctx.session.operation) {
              await this.showSellBankInputStep(ctx);
            }
            break;

          case data === 'cancel_support_chat':
            await this.cancelSupportChatMode(ctx);
            break;

          case data === 'cancel_support_reply':
            await this.cancelSupportReply(ctx);
            break;

          // reply_support_ уже обрабатывается выше (строка ~405)

          default:
            console.log(`Неизвестный callback: ${data}`);
        }
      } catch (error) {
        console.error(`Error handling callback ${data}:`, error);
        await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
      }

      // отвечаем на колбек с обработкой таймаута
      try {
        await ctx.answerCbQuery();
      } catch (error) {
        if (error.response && error.response.error_code === 400 &&
          error.response.description.includes('query is too old')) {
          console.log(`Bot ${botId} callback query timeout - ignoring`);
        } else {
          console.error(`Bot ${botId} answerCbQuery error:`, error);
        }
      }
    });

    // обработка текстовых сообщений в зависимости от состояния
    bot.on('text', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      // проверяем что сессия инициализирована
      ctx.session = ctx.session || {};

      const text = ctx.message.text;

      // проверяем ожидает ли бот коммента к отзыву
      if (ctx.session.waitingForReviewComment && ctx.session.waitingForReviewComment.active) {
        await this.handleReviewCommentInput(ctx, text);
        return;
      }
      
      // проверяем ожидает ли бот чек для подтверждения платежа
      if (ctx.session.waitingForReceipt && ctx.session.waitingForReceipt.active) {
        await ctx.reply(this.getReceiptInvalidFormatMessage(), {
          parse_mode: 'HTML'
        });
        return;
      }

      // проверяем ожидает ли бот хеш транзакции для подтверждения отправки
      if (ctx.session.waitingForTxHash && ctx.session.waitingForTxHash.active) {
        await this.handleTxHashInput(ctx, text);
        return;
      }

      // проверяем создает ли новый реквизит
      if (ctx.session.createRequisite && ctx.session.createRequisite.active) {
        await this.processNewRequisiteInput(ctx, text);
        return;
      }

      // проверяем в режиме вывода ли
      if (ctx.session.withdrawal && ctx.session.withdrawal.active) {
        await this.processWithdrawalAddressInput(ctx, text);
        return;
      }

      // reply в Telegram должен гарантированно доходить в чат операции:
      // если пользователь ответил на сообщение и у него есть активная операция,
      // маршрутизируем это как сообщение оператору.
      if (ctx.message?.reply_to_message && !text.startsWith('/')) {
        const activeOrder = await this.getActiveOrderForCtx(ctx);
        if (activeOrder) {
          this.activateOrderChatMode(ctx, activeOrder.id);
          await this.handleChatMessage(ctx, text);
          return;
        }
      }

      // ПРИОРИТЕТ 2: операции (покупка/продажа) - waitingFor
      // Если есть waitingFor, обрабатываем его РАНЬШЕ режимов чата
      if (ctx.session.waitingFor) {
        switch (ctx.session.waitingFor) {
          case 'buy_amount':
          case 'sell_amount':
            await this.handleAmountInput(ctx, text);
            return;
          case 'buy_address':
            await this.handleAddressInput(ctx, text);
            return;
          case 'sell_card_number':
            await this.handleCardNumberInput(ctx, text);
            return;
          case 'sell_bank':
            await this.handleBankInput(ctx, text);
            return;
          case 'sell_fio':
            await this.handleFIOInput(ctx, text);
            return;
          case 'edit_address':
            await this.handleEditAddressInput(ctx, text);
            return;
          case 'edit_amount':
            await this.handleEditAmountInput(ctx, text);
            return;
        }
      }

      // ПРИОРИТЕТ 3: режимы чата (ассистент и операции)
      
      // проверяем в режиме чата с поддержкой ли пользователь (БЕЗ операции)
      if (ctx.session.supportChatMode && ctx.session.supportChatMode.active) {
        console.log('✅ [DEBUG] Routing to handleSupportChatMessage');
        await this.handleSupportChatMessage(ctx, text);
        return;
      }

      // проверяем в режиме чата ли пользователь (чат по заявке)
      if (ctx.session.chatMode && ctx.session.chatMode.active) {
        console.log('⚠️ [DEBUG] Routing to handleChatMessage (order chat)');
        await this.handleChatMessage(ctx, text);
        return;
      }

      if (!text.startsWith('/')) {
        const activeOrder = await this.getActiveOrderForCtx(ctx);
        if (activeOrder) {
          this.activateOrderChatMode(ctx, activeOrder.id);
          await this.handleChatMessage(ctx, text);
          return;
        }
      }
    });

    // обработка фото в чате
    bot.on('photo', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      ctx.session = ctx.session || {};

      // проверяем ожидает ли бот чек для подтверждения платежа
      if (ctx.session.waitingForReceipt && ctx.session.waitingForReceipt.active) {
        await this.handleReceiptUpload(ctx);
        return;
      }

      // проверяем в режиме чата поддержки ли пользователь
      if (ctx.session.supportChatMode && ctx.session.supportChatMode.active) {
        await this.handleSupportChatPhoto(ctx);
        return;
      }

      // проверяем в режиме чата ли пользователь
      if (ctx.session.chatMode && ctx.session.chatMode.active) {
        await this.handleChatAttachment(ctx, 'photo');
        return;
      }
    });

    // обработка документов в чате
    bot.on('document', async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      ctx.session = ctx.session || {};

      // проверяем ожидает ли бот чек для подтверждения платежа
      if (ctx.session.waitingForReceipt && ctx.session.waitingForReceipt.active) {
        await this.handleReceiptUpload(ctx);
        return;
      }

      // проверяем в режиме чата ли пользователь
      if (ctx.session.chatMode && ctx.session.chatMode.active) {
        // проверяем тип файла (разрешаем только PDF)
        const document = ctx.message.document;
        if (document.mime_type === 'application/pdf' || document.file_name.toLowerCase().endsWith('.pdf')) {
          await this.handleChatAttachment(ctx, 'document');
        } else {
          await ctx.reply('📎 Поддерживаются только PDF файлы для отправки документов.');
        }
        return;
      }
    });

    bot.on(['audio', 'video', 'voice', 'video_note', 'sticker', 'animation'], async (ctx) => {
      if (await this.checkUserBlocked(ctx)) return;
      ctx.session = ctx.session || {};

      if (ctx.session.waitingForReceipt && ctx.session.waitingForReceipt.active) {
        if (ctx.message.animation) {
          await this.handleReceiptUpload(ctx);
          return;
        }

        await ctx.reply(this.getReceiptInvalidFormatMessage(), {
          parse_mode: 'HTML'
        });
        return;
      }
    });

    // обработка ошибок
    bot.catch((err, ctx) => {
      console.error(`Bot ${botConfig.name} error:`, err);
      ctx.reply('Не удалось выполнить действие. Повторите чуть позже.');
    });
  }

  // закрытие активного чата если он есть
  closeChatMode(ctx) {
    ctx.session = ctx.session || {};
    if (ctx.session.chatMode && ctx.session.chatMode.active) {
      ctx.session.chatMode = null;
    }
    // Также закрываем режим чата поддержки
    if (ctx.session.supportChatMode) {
      ctx.session.supportChatMode = null;
    }
  }

  hasUserBotPassedCaptcha(userBot) {
    if (!userBot) return false;
    if (!Object.prototype.hasOwnProperty.call(userBot, 'captcha_passed')) {
      return true;
    }
    return Number(userBot.captcha_passed || 0) === 1;
  }

  generateEmojiCaptchaChallenge() {
    const target = CAPTCHA_FRUIT_EMOJIS[Math.floor(Math.random() * CAPTCHA_FRUIT_EMOJIS.length)];
    const shuffled = [...CAPTCHA_FRUIT_EMOJIS].sort(() => Math.random() - 0.5);
    const options = shuffled.slice(0, CAPTCHA_OPTIONS_COUNT);

    if (!options.includes(target)) {
      const replaceIndex = Math.floor(Math.random() * options.length);
      options[replaceIndex] = target;
    }

    options.sort(() => Math.random() - 0.5);
    return { target, options };
  }

  buildEmojiCaptchaKeyboard(options = []) {
    const rows = [];
    for (let i = 0; i < options.length; i += 3) {
      const row = options.slice(i, i + 3).map((emoji, offset) =>
        Markup.button.callback(emoji, `${CAPTCHA_CALLBACK_PREFIX}${i + offset}`)
      );
      rows.push(row);
    }
    return Markup.inlineKeyboard(rows);
  }

  async showEmojiCaptcha(ctx, { refresh = false, reuseExisting = false } = {}) {
    ctx.session = ctx.session || {};

    let challenge = ctx.session.emojiCaptcha || null;
    if (!challenge || !reuseExisting || !Array.isArray(challenge.options) || !challenge.target) {
      challenge = this.generateEmojiCaptchaChallenge();
      ctx.session.emojiCaptcha = {
        target: challenge.target,
        options: challenge.options,
        createdAt: Date.now()
      };
    }

    const text = `Проверка безопасности: нажмите на ${challenge.target}`;
    const markup = this.buildEmojiCaptchaKeyboard(challenge.options);

    if (refresh && ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, {
          ...markup
        });
        return;
      } catch (editError) {
        console.log('Failed to refresh captcha message, sending new one:', editError.message);
      }
    }

    await ctx.reply(text, {
      ...markup
    });
  }

  async handleEmojiCaptchaSelection(ctx, callbackData) {
    ctx.session = ctx.session || {};
    const challenge = ctx.session.emojiCaptcha || null;
    if (!challenge || !Array.isArray(challenge.options) || !challenge.target) {
      await ctx.answerCbQuery('Капча устарела');
      await this.showEmojiCaptcha(ctx, { refresh: true });
      return;
    }

    const selectedIndex = Number(callbackData.replace(CAPTCHA_CALLBACK_PREFIX, ''));
    const selectedEmoji = Number.isInteger(selectedIndex)
      ? challenge.options[selectedIndex]
      : null;

    if (!selectedEmoji) {
      await ctx.answerCbQuery('Капча устарела');
      await this.showEmojiCaptcha(ctx, { refresh: true });
      return;
    }

    if (selectedEmoji !== challenge.target) {
      await ctx.answerCbQuery('❌ Неверно');
      await this.showEmojiCaptcha(ctx, { refresh: true });
      return;
    }

    await ctx.answerCbQuery('✅ Верно');

    const userBot = await UserBot.findByTgIdAndBotId(ctx.from.id, ctx.botConfig.id);
    if (userBot) {
      await UserBot.markCaptchaPassed(userBot.id);
    }

    delete ctx.session.emojiCaptcha;

    try {
      await ctx.editMessageText('✅ Капча пройдена');
    } catch (editError) {
      console.log('Failed to edit captcha passed message:', editError.message);
    }

    await this.showWelcomeMenu(ctx);
  }

  // получение или создание пользователя для конкретного бота
  async getOrCreateUser(ctx, referralCode = null) {
    const telegramId = ctx.from.id;
    const botId = ctx.botConfig.id;
    let isNewActivation = false;

    // сначала ищем связь пользователь-бот
    let userBot = await UserBot.findByTgIdAndBotId(telegramId, botId);

    if (!userBot) {
      isNewActivation = true;
      if (referralCode) {
        // создаем нового пользователя с рефералом
        console.log(`Creating new user-bot with referral code: ${referralCode}`);
        userBot = await UserBot.createWithReferral({
          tg_id: telegramId,
          username: ctx.from.username
        }, referralCode, botId);
      } else {
        // создаем без реферала
        userBot = await UserBot.create({
          tg_id: telegramId,
          bot_id: botId,
          username: ctx.from.username,
          phone: null,
          ref_code: null,
          has_ref: false,
          discount_v: 0
        });

        // генерируем реферальный код
        await UserBot.generateReferralCode(userBot.id, botId);
      }

      try {
        await UserBot.markCaptchaPending(userBot.id);
        userBot.captcha_passed = 0;
      } catch (captchaInitError) {
        console.error(
          `Failed to initialize captcha state for tg:${telegramId}, bot:${botId}:`,
          captchaInitError?.message || captchaInitError
        );
      }

      try {
        let activationNumber = null;
        let referrerUser = null;

        if (Number(userBot?.invited_by || 0) > 0) {
          try {
            referrerUser = await UserBot.findById(userBot.invited_by);
          } catch (referrerError) {
            console.error(
              `Failed to resolve referrer for activation tg:${telegramId}, bot:${botId}:`,
              referrerError?.message || referrerError
            );
          }
        }

        try {
          activationNumber = await UserBot.countByBotId(botId);
        } catch (countError) {
          console.error(`Failed to count activations for bot:${botId}:`, countError?.message || countError);
        }
        await ActivationAlertTelegramService.sendActivation(ctx.from, activationNumber, referrerUser);
      } catch (notificationError) {
        console.error(`Failed to send activation alert for tg:${telegramId}, bot:${botId}:`, notificationError?.message || notificationError);
      }
    } else {
      // проверяем что у существующего пользователя есть реферальный код
      if (!userBot.referral_code) {
        await UserBot.generateReferralCode(userBot.id, botId);
      }

      // синхронизируем username с актуальным username Telegram на текущий момент
      const currentUsername = String(ctx.from?.username || '').trim() || null;
      const storedUsername = String(userBot.username || '').trim() || null;
      if (currentUsername !== storedUsername) {
        try {
          await UserBot.update(userBot.id, { username: currentUsername });
          const baseUserId = userBot.base_user_id || userBot.user_id || null;
          if (baseUserId) {
            await User.updateUsernameById(baseUserId, currentUsername);
          }
          userBot.username = currentUsername;
        } catch (syncError) {
          console.error(
            `Failed to sync username for tg:${telegramId}, bot:${botId}:`,
            syncError?.message || syncError
          );
        }
      }
    }

    if (isNewActivation) {
      console.log(`New activation recorded for tg:${telegramId}, bot:${botId}`);
    }

    return userBot;
  }

  // получение юзернейма бота через API телеграм
  async getBotUsername(botId) {
    try {
      // сначала проверяем кеш
      if (this.botUsernames.has(botId)) {
        return this.botUsernames.get(botId);
      }

      const botData = this.bots.get(botId);
      if (!botData || !botData.bot) {
        console.warn(`Bot ${botId} not found or not running`);
        return null;
      }

      // получаем инфо о боте от API телеграм
      const botInfo = await botData.bot.telegram.getMe();
      const username = botInfo.username;

      if (username) {
        // кешируем юзернейм
        this.botUsernames.set(botId, username);
        console.log(`Cached username for bot ${botId}: @${username}`);
        return username;
      }

      return null;
    } catch (error) {
      console.error(`Error getting username for bot ${botId}:`, error);
      return null;
    }
  }

  // обновление кеша юзернейма бота
  async refreshBotUsername(botId) {
    try {
      // сначала очищаем кеш
      this.botUsernames.delete(botId);

      // получаем свежий юзернейм
      return await this.getBotUsername(botId);
    } catch (error) {
      console.error(`Error refreshing username for bot ${botId}:`, error);
      return null;
    }
  }

  getBaseUserId(user) {
    if (!user) return null;
    return user.base_user_id || user.user_id || user.id || null;
  }

  getOrderFlowState(orderId) {
    const key = Number(orderId);
    if (!Number.isFinite(key)) return {};
    return this.orderFlowMessageState.get(key) || {};
  }

  setOrderFlowState(orderId, patch = {}) {
    const key = Number(orderId);
    if (!Number.isFinite(key)) return {};
    const currentState = this.orderFlowMessageState.get(key) || {};
    const nextState = { ...currentState, ...patch };
    this.orderFlowMessageState.set(key, nextState);
    return nextState;
  }

  buildOrderCreatedMessage(order, { paymentReceived = false } = {}) {
    if (!order) return null;

    const operationLabel = order.dir === 'BUY' ? 'Покупка' : 'Продажа';
    const amount = order.amount_coin;
    const sumRub = Number(order.sum_rub || 0).toLocaleString();
    const sumLabel = order.dir === 'BUY' ? 'К оплате' : 'К получению';

    let message = `✅ <b>Заявка #${order.unique_id} создана!</b>\n\n`;
    message += `🔄 Тип сделки: ${operationLabel}\n`;
    message += `🪙 Актив: ${order.coin}\n`;
    message += `📦 Объём: ${amount} ${order.coin}\n`;
    message += `💳 ${sumLabel}: ${sumRub} ₽\n\n`;

    if (order.dir === 'BUY') {
      if (paymentReceived) {
        message += `✅ Оплата успешно зафиксирована\n\n`;
      } else {
        message += `⌛️ Ожидайте: менеджер отправит реквизиты для оплаты\n\n`;
        message += `После перевода нажмите кнопку "Подтвердить оплату"`;
      }
    } else {
      message += `⌛️ Ожидайте: менеджер отправит адрес для перевода ${order.coin}\n\n`;
      message += `После перевода нажмите кнопку "Подтвердить перевод"`;
    }

    message += `\n\n✍️ Если нужно уточнить детали по заявке, отправьте сообщение в этот чат.`;
    return message;
  }

  async safeEditUserMessage(telegram, chatId, messageId, text) {
    if (!telegram || !chatId || !messageId || !text) return false;

    try {
      await telegram.editMessageCaption(chatId, messageId, undefined, text, {
        parse_mode: 'HTML'
      });
      return true;
    } catch (captionError) {
      try {
        await telegram.editMessageText(chatId, messageId, undefined, text, {
          parse_mode: 'HTML'
        });
        return true;
      } catch (textError) {
        console.log('Could not edit user message:', textError.message);
        return false;
      }
    }
  }

  async applyPaymentReceivedUiUpdate(telegram, orderId, order) {
    if (!telegram || !orderId || !order) return;

    const currentState = this.getOrderFlowState(orderId);

    if (currentState.paymentPendingMessageId && currentState.paymentPendingChatId) {
      try {
        await telegram.deleteMessage(currentState.paymentPendingChatId, currentState.paymentPendingMessageId);
      } catch (error) {
        console.log('Could not delete payment pending message:', error.message);
      }
    }

    if (currentState.requisitesMessageId && currentState.requisitesMessageChatId) {
      try {
        await telegram.deleteMessage(currentState.requisitesMessageChatId, currentState.requisitesMessageId);
      } catch (error) {
        console.log('Could not delete requisites message:', error.message);
      }
    }

    if (currentState.createdMessageId && currentState.createdMessageChatId) {
      const updatedCreatedMessage = this.buildOrderCreatedMessage(order, { paymentReceived: true });
      if (updatedCreatedMessage) {
        await this.safeEditUserMessage(
          telegram,
          currentState.createdMessageChatId,
          currentState.createdMessageId,
          updatedCreatedMessage
        );
      }
    }

    this.setOrderFlowState(orderId, {
      paymentPendingMessageId: null,
      paymentPendingChatId: null,
      requisitesMessageId: null,
      requisitesMessageChatId: null
    });
  }

  activateOrderChatMode(ctx, orderId) {
    if (!orderId) return;
    ctx.session = ctx.session || {};
    ctx.session.supportChatMode = null;
    delete ctx.session.navigationMessage;
    ctx.session.chatMode = {
      orderId: Number(orderId),
      active: true
    };
  }

  async getActiveOrderForCtx(ctx) {
    const telegramId = ctx?.from?.id;
    const botId = ctx?.botConfig?.id;
    if (!telegramId || !botId) return null;

    const userBot = await UserBot.findByTgIdAndBotId(telegramId, botId);
    const user = userBot || await User.findByTgId(telegramId);
    const userId = this.getBaseUserId(user);
    if (!userId) return null;

    return await this.orderService.getActiveOrderForUser(userId, botId);
  }

  getTransactionExplorerLink(coin, hash) {
    if (!coin || !hash) return null;
    switch (String(coin).toUpperCase()) {
      case 'BTC':
        return `https://mempool.space/tx/${hash}`;
      case 'LTC':
        return `https://blockchair.com/litecoin/transaction/${hash}`;
      case 'XMR':
        return `https://xmrchain.net/tx/${hash}`;
      case 'USDT':
        return `https://tronscan.org/#/transaction/${hash}`;
      default:
        return null;
    }
  }

  isSingleNavigationMode(ctx) {
    const sessionData = ctx?.session || {};
    if (sessionData.chatMode?.active) return false;
    if (sessionData.supportChatMode?.active) return false;
    if (sessionData.waitingForReceipt?.active) return false;
    if (sessionData.waitingForTxHash?.active) return false;
    return true;
  }

  getNavigationMessageState(ctx) {
    return ctx?.session?.navigationMessage || null;
  }

  rememberNavigationMessage(ctx, message) {
    if (!ctx || !message) return;
    ctx.session = ctx.session || {};
    const messageId = message.message_id || null;
    const chatId = message.chat?.id || ctx.chat?.id || null;
    if (!messageId || !chatId) return;
    ctx.session.navigationMessage = {
      messageId,
      chatId
    };
  }

  resetSessionPreserveNavigation(ctx) {
    const navigationMessage = this.getNavigationMessageState(ctx);
    ctx.session = {};
    if (navigationMessage?.messageId && navigationMessage?.chatId) {
      ctx.session.navigationMessage = navigationMessage;
    }
  }

  isCallbackFromCurrentNavigationMessage(ctx) {
    const callbackMessageId = Number(ctx?.callbackQuery?.message?.message_id || 0);
    if (!callbackMessageId) return true;
    const navigationMessageId = Number(this.getNavigationMessageState(ctx)?.messageId || 0);
    if (!navigationMessageId) return true;
    return callbackMessageId === navigationMessageId;
  }

  async replaceNavigationText(ctx, text, extra = {}) {
    if (!this.isSingleNavigationMode(ctx)) {
      return await ctx.reply(text, extra);
    }

    const callbackMessage = ctx.callbackQuery?.message;
    if (callbackMessage?.message_id) {
      const hasPhoto = callbackMessage?.photo?.length > 0;
      const hasCaption = callbackMessage?.caption !== undefined;
      try {
        if (hasPhoto || hasCaption) {
          await ctx.editMessageCaption(text, extra);
        } else {
          await ctx.editMessageText(text, extra);
        }
        this.rememberNavigationMessage(ctx, callbackMessage);
        return callbackMessage;
      } catch (editError) {
        if (String(editError?.message || '').includes('message is not modified')) {
          this.rememberNavigationMessage(ctx, callbackMessage);
          return callbackMessage;
        }
        console.log('Navigation text edit failed, sending new message:', editError.message);
      }
    }

    const previousNavigationMessage = this.getNavigationMessageState(ctx);
    if (previousNavigationMessage?.messageId) {
      try {
        await ctx.telegram.editMessageCaption(
          previousNavigationMessage.chatId,
          previousNavigationMessage.messageId,
          undefined,
          text,
          extra
        );
        this.rememberNavigationMessage(ctx, {
          message_id: previousNavigationMessage.messageId,
          chat: { id: previousNavigationMessage.chatId }
        });
        return {
          message_id: previousNavigationMessage.messageId,
          chat: { id: previousNavigationMessage.chatId }
        };
      } catch (captionError) {
        const captionErrText = String(captionError?.message || '');
        if (captionErrText.includes('message is not modified')) {
          this.rememberNavigationMessage(ctx, {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          });
          return {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          };
        }
        try {
          await ctx.telegram.editMessageText(
            previousNavigationMessage.chatId,
            previousNavigationMessage.messageId,
            undefined,
            text,
            extra
          );
          this.rememberNavigationMessage(ctx, {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          });
          return {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          };
        } catch (textError) {
          const errText = String(textError?.message || '');
          if (errText.includes('message is not modified')) {
            this.rememberNavigationMessage(ctx, {
              message_id: previousNavigationMessage.messageId,
              chat: { id: previousNavigationMessage.chatId }
            });
            return {
              message_id: previousNavigationMessage.messageId,
              chat: { id: previousNavigationMessage.chatId }
            };
          }
          await this.safeDeleteMessage(
            ctx,
            previousNavigationMessage.messageId,
            previousNavigationMessage.chatId
          );
        }
      }
    }

    const sentMessage = await ctx.reply(text, extra);
    this.rememberNavigationMessage(ctx, sentMessage);
    return sentMessage;
  }

  async replaceNavigationPhoto(ctx, photo, extra = {}) {
    if (!this.isSingleNavigationMode(ctx)) {
      return await ctx.replyWithPhoto(photo, extra);
    }

    const media = {
      type: 'photo',
      media: photo,
      caption: extra?.caption,
      parse_mode: extra?.parse_mode
    };
    const editExtra = {};
    if (extra?.reply_markup) {
      editExtra.reply_markup = extra.reply_markup;
    }

    const callbackMessage = ctx.callbackQuery?.message;
    const callbackMessageId = callbackMessage?.message_id || null;
    const callbackChatId = callbackMessage?.chat?.id || ctx.chat?.id || null;

    if (callbackMessageId) {
      try {
        await ctx.telegram.editMessageMedia(
          callbackChatId,
          callbackMessageId,
          undefined,
          media,
          editExtra
        );
        this.rememberNavigationMessage(ctx, callbackMessage);
        return callbackMessage;
      } catch (editError) {
        const errText = String(editError?.message || '');
        if (errText.includes('message is not modified')) {
          this.rememberNavigationMessage(ctx, callbackMessage);
          return callbackMessage;
        }
        console.log('Navigation photo edit from callback failed:', editError.message);
      }
    }

    const previousNavigationMessage = this.getNavigationMessageState(ctx);
    if (previousNavigationMessage?.messageId) {
      try {
        await ctx.telegram.editMessageMedia(
          previousNavigationMessage.chatId,
          previousNavigationMessage.messageId,
          undefined,
          media,
          editExtra
        );
        this.rememberNavigationMessage(ctx, {
          message_id: previousNavigationMessage.messageId,
          chat: { id: previousNavigationMessage.chatId }
        });
        return {
          message_id: previousNavigationMessage.messageId,
          chat: { id: previousNavigationMessage.chatId }
        };
      } catch (editError) {
        const errText = String(editError?.message || '');
        if (errText.includes('message is not modified')) {
          this.rememberNavigationMessage(ctx, {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          });
          return {
            message_id: previousNavigationMessage.messageId,
            chat: { id: previousNavigationMessage.chatId }
          };
        }
        await this.safeDeleteMessage(
          ctx,
          previousNavigationMessage.messageId,
          previousNavigationMessage.chatId
        );
      }
    }

    const sentMessage = await ctx.replyWithPhoto(photo, extra);
    this.rememberNavigationMessage(ctx, sentMessage);
    return sentMessage;
  }

  async sendNavigationTemplatePhoto(ctx, { templateName, caption, keyboard, generator }) {
    const botId = ctx.botConfig.id;
    const cachedFileId = telegramImageCache.get(botId, templateName);
    const replyMarkup = keyboard?.reply_markup;

    try {
      if (cachedFileId) {
        return await this.replaceNavigationPhoto(ctx, cachedFileId, {
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      }

      const imagePath = await generator();
      const sentMessage = await this.replaceNavigationPhoto(
        ctx,
        { source: imagePath },
        {
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        }
      );

      if (sentMessage?.photo?.length > 0) {
        const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
        telegramImageCache.set(botId, templateName, fileId);
      }

      return sentMessage;
    } catch (error) {
      console.error(`Error sending ${templateName} image:`, error);
      return await this.replaceNavigationText(ctx, caption, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  }

  getWelcomeCaption(botConfig) {
    const customMessage = botConfig?.start_message;
    if (customMessage && String(customMessage).trim()) {
      return customMessage;
    }

    return `Приветствуем вас в сервисе быстрых обменов!`;
  }

  async showWelcomeMenu(ctx) {
    const keyboard = this.getMainMenuInlineKeyboard(ctx.botConfig);
    const caption = this.getWelcomeCaption(ctx.botConfig);
    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'welcome',
      caption,
      keyboard,
      generator: () => imageGenerator.generateWelcomeImage()
    });
  }

  async showWelcomeMenuAsNewMessage(ctx) {
    const keyboard = this.getMainMenuInlineKeyboard(ctx.botConfig);
    const caption = this.getWelcomeCaption(ctx.botConfig);
    const botId = ctx.botConfig.id;
    const templateName = 'welcome';
    const cachedFileId = telegramImageCache.get(botId, templateName);

    try {
      let sentMessage = null;

      if (cachedFileId) {
        sentMessage = await ctx.replyWithPhoto(cachedFileId, {
          caption,
          parse_mode: 'HTML',
          ...keyboard
        });
      } else {
        const imagePath = await imageGenerator.generateWelcomeImage();
        sentMessage = await ctx.replyWithPhoto(
          { source: imagePath },
          {
            caption,
            parse_mode: 'HTML',
            ...keyboard
          }
        );

        if (sentMessage?.photo?.length > 0) {
          const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
          telegramImageCache.set(botId, templateName, fileId);
        }
      }

      this.rememberNavigationMessage(ctx, sentMessage);
      return sentMessage;
    } catch (error) {
      console.error('Error sending new welcome menu message:', error);
      const sentMessage = await ctx.reply(caption, {
        parse_mode: 'HTML',
        ...keyboard
      });
      this.rememberNavigationMessage(ctx, sentMessage);
      return sentMessage;
    }
  }

  async showBuyAddressInputStep(ctx, userPastRequisites = null) {
    ctx.session = ctx.session || {};
    const coin = ctx.session.operation?.coin;
    if (!coin) return;

    let requisites = userPastRequisites;
    if (!Array.isArray(requisites)) {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      requisites = await Requisite.getUserRequisitesByType(userId, coin, ctx.session.operation.type);
    }

    let message = `Укажите ваш ${coin} адрес для получения:`;
    const keyboard = [];

    if (requisites.length > 0) {
      message += '\n\n📋 Или отметьте из последних ниже:';
      requisites.forEach((requisite) => {
        const address = requisite.getDecryptedValue();
        const shortAddress = address.length > 20
          ? `${address.substring(0, 10)}...${address.substring(address.length - 10)}`
          : address;

        keyboard.push([
          Markup.button.callback(`${shortAddress}`, `select_requisite_${requisite.id}`)
        ]);
      });
    }

    keyboard.push([Markup.button.callback('↩️ Назад', 'back_to_amount_input')]);
    ctx.session.waitingFor = 'buy_address';

    await this.replaceNavigationText(ctx, message, Markup.inlineKeyboard(keyboard));
  }

  async showSellCardInputStep(ctx, userPastRequisites = null) {
    ctx.session = ctx.session || {};
    if (!ctx.session.operation) return;

    let requisites = userPastRequisites;
    if (!Array.isArray(requisites)) {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      requisites = await Requisite.getUserRequisitesByType(userId, 'CARD', ctx.session.operation.type);
    }

    let caption = 'Укажите номер карты или номер телефона для СБП:';
    caption += '\n\nПримеры:';
    caption += '\n1234567812345678';
    caption += '\n+79123456789';
    caption += '\n89123456789';

    const keyboard = [];
    if (requisites.length > 0) {
      caption += '\n\n📋 Или отметьте из последних ниже:';
      requisites.forEach((requisite) => {
        const cardInfo = requisite.getDecryptedValue();
        const shortCard = cardInfo.length > 30
          ? `${cardInfo.substring(0, 30)}...`
          : cardInfo;
        keyboard.push([
          Markup.button.callback(`${shortCard}`, `select_requisite_${requisite.id}`)
        ]);
      });
    }

    keyboard.push([Markup.button.callback('↩️ Назад', 'back_to_amount_input')]);
    ctx.session.waitingFor = 'sell_card_number';

    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'enter_card',
      caption,
      keyboard: Markup.inlineKeyboard(keyboard),
      generator: () => imageGenerator.generateEnterCardImage()
    });
  }

  async showSellBankInputStep(ctx) {
    ctx.session = ctx.session || {};
    if (!ctx.session.operation) return;
    ctx.session.waitingFor = 'sell_bank';

    const caption = 'Укажите название банка:\n\nПример: Сбербанк, Тинькофф, ВТБ и т.д.';
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('↩️ Назад', 'back_to_card_input')]
    ]);

    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'enter_bank',
      caption,
      keyboard,
      generator: () => imageGenerator.generateEnterBankImage()
    });
  }

  async showSellFioInputStep(ctx) {
    ctx.session = ctx.session || {};
    if (!ctx.session.operation) return;
    ctx.session.waitingFor = 'sell_fio';

    const caption = 'Укажите ФИО получателя:\n\nПример: Иван Иванов';
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('↩️ Назад', 'back_to_bank_input')]
    ]);

    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'enter_fio',
      caption,
      keyboard,
      generator: () => imageGenerator.generateEnterFIOImage()
    });
  }

  async safeDeleteMessage(ctx, messageId, chatId = null) {
    if (!messageId) return;
    try {
      const targetChatId = chatId || ctx?.chat?.id;
      if (!targetChatId) return;
      await ctx.telegram.deleteMessage(targetChatId, messageId);
    } catch (error) {
      console.log('Could not delete message:', error.message);
    }
  }

  canAcceptPaymentProof(order) {
    return Boolean(order && (order.status === 'CREATED' || order.status === 'PAYMENT_PENDING'));
  }

  getPaymentButtonText(order) {
    if (!order) return '✅ Подтвердить оплату';
    return order.dir === 'BUY' ? '✅ Подтвердить оплату' : '✅ Подтвердить перевод';
  }

  getPaymentButtonMarkup(order) {
    if (!order) return null;
    return {
      inline_keyboard: [[{
        text: this.getPaymentButtonText(order),
        callback_data: `payment_${order.id}`
      }]]
    };
  }

  async safeEditMessageReplyMarkup(ctx, messageId, chatId = null, replyMarkup = null) {
    if (!messageId) return;
    try {
      const targetChatId = chatId || ctx?.chat?.id;
      if (!targetChatId) return;
      await ctx.telegram.editMessageReplyMarkup(targetChatId, messageId, undefined, replyMarkup);
    } catch (error) {
      console.log('Could not edit message reply markup:', error.message);
    }
  }

  getActiveOrderLockMessage(activeOrder) {
    const orderNumber = activeOrder?.unique_id ? `#${activeOrder.unique_id}` : '';
    return `У вас уже есть активная операция ${orderNumber}. До её отмены или завершения доступны только действия внутри этой операции: переписка с оператором, отправка квитанции и проверка статуса.`;
  }

  isAllowedLockedCallback(data, activeOrderId, ctx = null) {
    if (!data || !activeOrderId) return false;
    if (data === 'cancel_receipt_upload') {
      const waitingOrderId = Number(
        ctx?.session?.waitingForReceipt?.orderId ||
        ctx?.session?.waitingForTxHash?.orderId
      );
      return Number.isFinite(waitingOrderId) && waitingOrderId === Number(activeOrderId);
    }
    const match = data.match(/^(order|support|payment|reply)_(\d+)$/);
    if (!match) return false;
    return Number(match[2]) === Number(activeOrderId);
  }

  async enforceActiveOrderLock(ctx, { callbackData = null } = {}) {
    try {
      const activeOrder = await this.getActiveOrderForCtx(ctx);
      if (!activeOrder) {
        return { blocked: false };
      }

      if (callbackData && this.isAllowedLockedCallback(callbackData, activeOrder.id, ctx)) {
        return { blocked: false, activeOrder };
      }

      if (callbackData) {
        try {
          await ctx.answerCbQuery('Доступно только внутри активной операции');
        } catch (cbError) {
          console.log('Failed to answer lock callback query:', cbError.message);
        }
      }

      await ctx.reply(this.getActiveOrderLockMessage(activeOrder));
      return { blocked: true, activeOrder };
    } catch (error) {
      console.error('Error while enforcing active order lock:', error);
      return { blocked: false };
    }
  }

  // проверка блокировки пользователя
  async checkUserBlocked(ctx, options = {}) {
    const skipCaptcha = Boolean(options?.skipCaptcha);
    const user = await User.findByTgId(ctx.from.id);
    if (user && user.is_blocked) {
      await ctx.reply('❌ Ваш аккаунт заблокирован. Обратитесь к администратору.');
      return true;
    }

    if (skipCaptcha) {
      return false;
    }

    const botId = ctx?.botConfig?.id;
    if (!botId) {
      return false;
    }

    const userBot = await UserBot.findByTgIdAndBotId(ctx.from.id, botId);
    if (userBot && !this.hasUserBotPassedCaptcha(userBot)) {
      await this.showEmojiCaptcha(ctx, { reuseExisting: true });
      return true;
    }

    return false;
  }

  // получение платежных реквизитов для бота
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

  // получение крипто адреса для конкретной монеты и бота
  async getCryptoAddress(botId, coin) {
    try {
      const cryptoRequisites = await BotRequisite.getByBotId(botId, {
        type: coin.toUpperCase(),
        is_active: true
      });

      const defaultRequisite = cryptoRequisites.find(r => r.is_default) || cryptoRequisites[0];
      return defaultRequisite ? defaultRequisite.address : null;
    } catch (error) {
      console.error(`Error getting ${coin} address:`, error);
      return null;
    }
  }

  // показ курсов (только binance тарифы без комиссий)
  async showCourses(ctx) {
    try {
      const rates = await this.rateService.getCurrentRates();

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Назад', 'main_menu')]
      ]);

      let caption = '';

      for (const rate of rates) {
        caption += `💰 <b>${rate.coin}</b>\n`;
        caption += `Курс: ${parseFloat(rate.rate_rub).toLocaleString()} ₽\n\n`;
      }

      caption += `<i>Обновлено: ${new Date().toLocaleString('ru-RU')}</i>`;
      await this.sendNavigationTemplatePhoto(ctx, {
        templateName: 'rates',
        caption,
        keyboard,
        generator: () => imageGenerator.generateRatesImage()
      });
    } catch (error) {
      console.error('Error showing courses:', error);
      await this.replaceNavigationText(ctx, '❌ Ошибка получения курсов');
    }
  }

  // начало процесса покупки
  async startBuyFlow(ctx) {
    // сбрасываем режим чата и создания реквизитов если активен
    ctx.session = ctx.session || {};
    ctx.session.chatMode = null;
    ctx.session.createRequisite = null;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('◼ BTC', 'buy_BTC'),
        Markup.button.callback('◻ LTC', 'buy_LTC')
      ],
      [
        Markup.button.callback('◆ XMR', 'buy_XMR'),
        Markup.button.callback('● USDT', 'buy_USDT')
      ],
      [
        Markup.button.callback('🏠 Главное меню', 'main_menu')
      ]
    ]);

    const caption = '▸ <b>A1 / Укажите актив для покупки</b>';
    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'buy_crypto',
      caption,
      keyboard,
      generator: () => imageGenerator.generateBuyImage()
    });
  }

  // начало процесса продажи
  async startSellFlow(ctx) {
    // сбрасываем режим чата и создания реквизитов если активен
    ctx.session = ctx.session || {};
    ctx.session.chatMode = null;
    ctx.session.createRequisite = null;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('◼ BTC', 'sell_BTC'),
        Markup.button.callback('◻ LTC', 'sell_LTC')
      ],
      [
        Markup.button.callback('◆ XMR', 'sell_XMR'),
        Markup.button.callback('🏠 Главное меню', 'main_menu')
      ]
    ]);

    const caption = '<b>▸ A1 / Укажите актив для продажи:</b>\n\n'
    await this.sendNavigationTemplatePhoto(ctx, {
      templateName: 'sell_crypto',
      caption,
      keyboard,
      generator: () => imageGenerator.generateSellImage()
    });
  }


buildAmountInputPrompt(operation) {
  const coin = operation.coin;
  const mode = (operation.amountInputMode || 'CRYPTO').toUpperCase();

  const coinEmojis = { BTC: '◼', LTC: '◻', XMR: '◆', USDT: '●' };
  const emoji = coinEmojis[coin] || '•';

  if (mode === 'RUB') {
    return `${emoji} A2 / Укажите объем в RUB\n\n${emoji} Формат: 5000`;
  }

  return `${emoji} A2 / Укажите объем в ${coin}\n\n${emoji} Формат: 0.01 или 0,01`;
}

formatRangeRub(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}₽`;
}

formatRangeCoin(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number(value).toFixed(8).replace(/\.?0+$/, '');
}

buildAmountOutOfRangeMessage(rangeError, operation, options = {}) {
  const opts = options || {};
  const includePrompt = Boolean(opts.includePrompt);
  const coin = rangeError?.coin || operation?.coin || '';
  const mode = String(operation?.amountInputMode || 'CRYPTO').toUpperCase();

  const minRub = Number(rangeError?.minAmountRub);
  const maxRub = rangeError?.maxAmountRub === null || rangeError?.maxAmountRub === undefined
    ? null
    : Number(rangeError?.maxAmountRub);
  const minCoin = Number(rangeError?.minAmountCoin);
  const maxCoin = rangeError?.maxAmountCoin === null || rangeError?.maxAmountCoin === undefined
    ? null
    : Number(rangeError?.maxAmountCoin);

  const minRubText = this.formatRangeRub(minRub);
  const maxRubText = this.formatRangeRub(maxRub);
  const minCoinText = this.formatRangeCoin(minCoin);
  const maxCoinText = this.formatRangeCoin(maxCoin);
  const enteredValue = Number(
    opts.enteredValue ??
    (mode === 'RUB' ? operation?.inputRub : operation?.amount)
  );
  const enteredText = Number.isFinite(enteredValue) && enteredValue > 0
    ? (mode === 'RUB'
      ? `${Number(enteredValue).toLocaleString('ru-RU', { maximumFractionDigits: 8 })} ₽`
      : `${this.formatRangeCoin(enteredValue)} ${coin}`)
    : null;

  let message = '❌ Сумма вне допустимого диапазона.\n\n';
  if (enteredText) {
    message += `Вы ввели:\n${enteredText}\n\n`;
  }
  message += minRubText && minCoinText
    ? `Минимальная сумма:\n${minRubText} (${minCoinText} ${coin})\n\n`
    : 'Минимальная сумма:\n—\n\n';
  message += maxRubText && maxCoinText
    ? `Максимальная сумма:\n${maxRubText} (${maxCoinText} ${coin})`
    : 'Максимальная сумма:\nБез ограничений';

  if (includePrompt && operation) {
    message += `\n\n${this.buildAmountInputPrompt(operation)}`;
  }

  return message;
}

buildTierConfigurationMessage(configError, operation, options = {}) {
  const opts = options || {};
  const includePrompt = Boolean(opts.includePrompt);

  let message = '❌ Тарифы настроены некорректно.\n\n';
  if (configError?.message) {
    message += `Причина:\n${configError.message}\n\n`;
  }
  message += 'Проверьте диапазоны комиссий в админке и сохраните их заново.';

  if (includePrompt && operation) {
    message += `\n\n${this.buildAmountInputPrompt(operation)}`;
  }

  return message;
}

buildAmountInputKeyboard(operation, options = {}) {
  const mode = (operation.amountInputMode || 'CRYPTO').toUpperCase();
  const backCb = options.backCallback || (operation.type === 'BUY' ? 'back_to_buy_menu' : 'back_to_sell_menu');

  return Markup.inlineKeyboard([
    [Markup.button.callback(
      mode === 'RUB' ? '↻ Режим: CRYPTO' : '↻ Режим: RUB',
      mode === 'RUB' ? 'amount_mode_crypto' : 'amount_mode_rub'
    )],
    [Markup.button.callback('↩️ Назад', backCb)]
  ]);
}

async showAmountInputStep(ctx, useEdit = false, options = {}) {
  ctx.session = ctx.session || {};
  if (!ctx.session.operation) return;

  const text = this.buildAmountInputPrompt(ctx.session.operation);
  const keyboard = this.buildAmountInputKeyboard(ctx.session.operation, options);

  ctx.session.waitingFor = options.waitingFor || `${ctx.session.operation.type.toLowerCase()}_amount`;

  await this.replaceNavigationText(ctx, text, keyboard);
}

async convertRubToCoin(ctx, targetRub) {
  const op = ctx.session.operation;
  const user = await this.getOrCreateUser(ctx);
  const userId = user.base_user_id || user.user_id || user.id;
  const quote = await this.orderService.createQuote({
    userId,
    botId: ctx.botConfig.id,
    dir: op.type,
    coin: op.coin,
    sumRub: targetRub,
    inputMode: 'RUB'
  });

  const amountCoin = Number(quote?.amount_coin);
  if (!Number.isFinite(amountCoin) || amountCoin <= 0) {
    throw new Error('Не удалось подобрать сумму в крипте');
  }

  return Number(amountCoin.toFixed(8));
}


  // обработка ввода суммы
  async handleAmountInput(ctx, text) {
    
    ctx.session = ctx.session || {};
    await this.safeDeleteMessage(ctx, ctx.message?.message_id, ctx.chat?.id || null);

    if (!ctx.session.operation) {
      await this.replaceNavigationText(ctx, '❌ Сессия операции не найдена, начните заново.');
      return;
    }

    const normalizedText = String(text).replace(',', '.');
    const inputValue = parseFloat(normalizedText);

    if (isNaN(inputValue) || inputValue <= 0) {
      await this.replaceNavigationText(ctx, '❌ Укажите корректное значение');
      return;
    }

    const mode = (ctx.session.operation.amountInputMode || 'CRYPTO').toUpperCase();

    let amountCoin = inputValue;
    if (mode === 'RUB') {
      if (inputValue < 1) {
        const keyboard = this.buildAmountInputKeyboard(ctx.session.operation);
        await this.replaceNavigationText(
          ctx,
          'ℹ️ Сейчас включен ввод в RUB.\n\nЗначение 0.001 трактуется как 0.001 ₽ и выходит за лимиты.\nПереключите на "↻ Режим: CRYPTO" и укажите 0.001 BTC.',
          keyboard
        );
        return;
      }

      try {
        amountCoin = await this.convertRubToCoin(ctx, inputValue);
        ctx.session.operation.inputRub = inputValue; // необязательно, но удобно
      } catch (e) {
        if (e?.code === 'AMOUNT_OUT_OF_RANGE') {
          console.warn('[RANGE_REJECT] amount input rejected', {
            tg_id: ctx?.from?.id || null,
            mode,
            entered_value: inputValue,
            operation: ctx.session.operation,
            min_rub: e?.minAmountRub ?? null,
            max_rub: e?.maxAmountRub ?? null,
            min_coin: e?.minAmountCoin ?? null,
            max_coin: e?.maxAmountCoin ?? null,
            coin: e?.coin || ctx.session?.operation?.coin || null
          });

          const rangeMessage = this.buildAmountOutOfRangeMessage(e, ctx.session.operation, {
            includePrompt: true,
            enteredValue: inputValue
          });
          const keyboard = this.buildAmountInputKeyboard(ctx.session.operation);
          await this.replaceNavigationText(ctx, rangeMessage, keyboard);
          return;
        }
        if (e?.code === 'INVALID_TIER_CONFIGURATION') {
          const keyboard = this.buildAmountInputKeyboard(ctx.session.operation);
          const configMessage = this.buildTierConfigurationMessage(e, ctx.session.operation, {
            includePrompt: true
          });
          await this.replaceNavigationText(ctx, configMessage, keyboard);
          return;
        }
        await this.replaceNavigationText(ctx, '❌ Не удалось рассчитать сумму в крипте, попробуйте другое значение.');
        return;
      }
    } else {
      delete ctx.session.operation.inputRub;
    }

    ctx.session.operation.amount = amountCoin;
    console.log(ctx.session.operation);


    const user = await this.getOrCreateUser(ctx);
    const userId = user.base_user_id || user.user_id || user.id;
    console.log("userid ", userId);

    const kind = ctx.session.operation.type === 'BUY' ? ctx.session.operation.coin : 'CARD';

    let userPastRequisites = [];
    try {
      userPastRequisites = await Requisite.getUserRequisitesByType(userId, kind, ctx.session.operation.type);
    } catch (error) {
      console.log("Ошибка получения реквизитов, попробуем :", error.message);

    }

    if (ctx.session.operation.type === 'BUY') {
      await this.showBuyAddressInputStep(ctx, userPastRequisites);
    } else {
      await this.showSellCardInputStep(ctx, userPastRequisites);
    }
  }

  // обработка ввода адреса
  async handleAddressInput(ctx, address) {
    // проверяем что сессия инициализирована
    ctx.session = ctx.session || {};
    await this.safeDeleteMessage(ctx, ctx.message?.message_id, ctx.chat?.id || null);

    const coin = ctx.session.operation?.coin;

    if (!coin) {
      await this.replaceNavigationText(ctx, '❌ Ошибка: не выбрана валюта');
      ctx.session = {};
      return;
    }

    // валидируем адрес кошелька
    if (!validateWalletAddress(address, coin)) {
      const errorMessage = getValidationErrorMessage(coin);

      await this.replaceNavigationText(
        ctx,
        `${errorMessage}\n\nПроверьте правильность введенного адреса и попробуйте ещё раз:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('↩️ Назад', 'back_to_amount_input')]
        ])
      );
      return;
    }

    ctx.session.operation.address = address;
    ctx.session.waitingFor = null;
    await this.showOrderSummary(ctx);
  }

  // обработка ввода номера карты (первый шаг)
  async handleCardNumberInput(ctx, cardNumber) {
    // проверяем что сессия инициализирована
    ctx.session = ctx.session || {};

    const input = cardNumber.replace(/\s+/g, ''); // убираем пробелы

    // валидируем номер карты (16 цифр) или номер телефона для СБП
    const cardPattern = /^\d{16}$/;
    const phonePatternWithPlus = /^\+7\d{10}$/;
    const phonePatternWithoutPlus = /^[78]\d{10}$/;

    if (!cardPattern.test(input) && !phonePatternWithPlus.test(input) && !phonePatternWithoutPlus.test(input)) {
      await this.replaceNavigationText(
        ctx,
        '❌ Формат не подходит. Укажите:\n• Номер карты (16 цифр)\n• Номер телефона (+79123456789 или 89123456789)\n\nПовторите ввод:',
        Markup.inlineKeyboard([
          [Markup.button.callback('↩️ Назад', 'back_to_amount_input')]
        ])
      );
      return;
    }

    // сохраняем номер карты в сессию
    ctx.session.operation.cardNumber = input;
    ctx.session.waitingFor = 'sell_bank';

    await this.showSellBankInputStep(ctx);
  }

  // обработка ввода банка (второй шаг)
  async handleBankInput(ctx, bank) {
    ctx.session = ctx.session || {};

    const bankName = bank.trim();

    if (bankName.length < 2) {
      await this.replaceNavigationText(
        ctx,
        '❌ Укажите корректное название банка.\n\nПовторите ввод:',
        Markup.inlineKeyboard([
          [Markup.button.callback('↩️ Назад', 'back_to_card_input')]
        ])
      );
      return;
    }

    ctx.session.operation.bank = bankName;
    await this.showSellFioInputStep(ctx);
  }

  // обработка ввода ФИО (третий шаг)
  async handleFIOInput(ctx, fio) {
    ctx.session = ctx.session || {};

    const fullName = fio.trim();

    // базовая валидация ФИО (минимум 2 слова)
    const fioPattern = /^[\p{L}\s-]{2,}$/u;
    const words = fullName.split(' ').filter(word => word.length > 0);

    if (!fioPattern.test(fullName) || words.length < 2) {
      await this.replaceNavigationText(
        ctx,
        '❌ Укажите корректное ФИО (минимум имя и фамилия).\n\nПример: Иван Иванов\n\nПовторите ввод:',
        Markup.inlineKeyboard([
          [Markup.button.callback('↩️ Назад', 'back_to_bank_input')]
        ])
      );
      return;
    }

    // собираем всю инфу по карте
    const { cardNumber, bank } = ctx.session.operation;
    const cardInfo = `${cardNumber} ${bank} ${fullName}`;

    ctx.session.operation.cardInfo = cardInfo;
    ctx.session.waitingFor = null;

    // очищаем временные поля
    delete ctx.session.operation.cardNumber;
    delete ctx.session.operation.bank;

    await this.showOrderSummary(ctx);
  }

  // показ сводки заказа
  async showOrderSummary(ctx, editMode = false) {
    try {
      ctx.session = ctx.session || {};

      const user = await this.getOrCreateUser(ctx);
      const { type, coin, amount, address, cardInfo } = ctx.session.operation;
      const inputMode = (ctx.session.operation.amountInputMode || 'CRYPTO').toUpperCase();
      const requestedRub = Number(ctx.session.operation.inputRub);

      // получаем котировку, используем base_user_id для расчета
      const userId = user.base_user_id || user.user_id || user.id;
      const quote = await this.orderService.createQuote({
        userId: userId,
        botId: ctx.botConfig.id,
        dir: type,
        coin,
        amountCoin: amount,
        inputMode,
        sumRub: inputMode === 'RUB' && Number.isFinite(requestedRub) && requestedRub > 0
          ? requestedRub
          : undefined
      });

      // проверяем что котировка валидна
      if (!quote || !quote.quote || isNaN(quote.quote.sumRub)) {
        await this.replaceNavigationText(ctx, '❌ Ошибка расчёта курса. Повторите чуть позже.');
        ctx.session = {};
        return;
      }

      const resolvedAmountCoin = Number(quote?.amount_coin);
      const displayAmountCoin =
        inputMode === 'RUB' && Number.isFinite(resolvedAmountCoin) && resolvedAmountCoin > 0
          ? Number(resolvedAmountCoin.toFixed(8))
          : amount;
      if (inputMode === 'RUB' && Number.isFinite(displayAmountCoin) && displayAmountCoin > 0) {
        ctx.session.operation.amount = displayAmountCoin;
      }

      const summarySumRub = Number(quote.quote.sumRub);
      const summaryRateRub = Number(quote?.quote?.unitRub);
      const displayRateRub = Number.isFinite(summaryRateRub) && summaryRateRub > 0
        ? summaryRateRub
        : Number(quote.rate);

      let message = `📋 <b>A4 / CONTROL</b>\n\n`;
      message += `🔄 Тип сделки: ${type === 'BUY' ? 'Покупка' : 'Продажа'}\n`;
      message += `🪙 Актив: ${coin}\n`;
      message += `📦 Объём: ${displayAmountCoin} ${coin}\n`;
      message += `📈 Курс: ${displayRateRub.toLocaleString('ru-RU')} ₽\n`;
      message += `💳 Итого к ${type === 'BUY' ? 'оплате' : 'получению'}: ${summarySumRub.toLocaleString()} ₽\n\n`;

      if (inputMode === 'RUB' && Number.isFinite(requestedRub) && requestedRub > 0) {
        const normalizedRequestedRub = Math.round(requestedRub * 100) / 100;
        if (Math.abs(summarySumRub - normalizedRequestedRub) > 0.009) {
          message += `ℹ️ Введено: ${normalizedRequestedRub.toLocaleString()} ₽\n`;
          message += `ℹ️ Доступно по тарифам: ${summarySumRub.toLocaleString()} ₽\n\n`;
        }
      }

      if (type === 'BUY') {
        message += `📬 Адрес зачисления: \n<code>${address}</code>\n\n`;
      } else {
        message += `🏦 Реквизиты для выплаты: ${cardInfo}\n\n`;
      }

      //message += `<i>Комиссия: ${Math.abs(quote.fee * 100).toFixed(2)}%</i>`;

      // проверяем настроены ли платежные данные для этого бота
      let hasRequisites = false;
      let errorMessage = '';

      if (type === 'BUY') {
        // для покупки проверяем платежные платежные данные
        // const paymentRequisites = await this.getPaymentRequisites(ctx.botConfig.id);
        // hasRequisites = !!(paymentRequisites.card || paymentRequisites.sbp);
        // if (!hasRequisites) {
        //   errorMessage = '\n⌛️ <b>Статус:</b> Ожидание добавления реквизитов\n';
        // }

        errorMessage = '\n⌛️ <b>Статус:</b> Ожидаем подключение реквизитов\n';
      } else {
        // для продажи проверяем криптоадрес
        // const cryptoAddress = await this.getCryptoAddress(ctx.botConfig.id, coin);
        // hasRequisites = !!cryptoAddress;
        // if (!hasRequisites) {
        //   errorMessage = `\n⌛️ <b>Статус:</b> Ожидание добавления реквизитов ${coin}\n`;
        // }
        errorMessage = `\n⌛️ <b>Статус:</b> Ожидаем подключение реквизитов ${coin}\n`;
      }

      // добавляем сообщение об ошибке если платежные данные отсутствуют
      if (errorMessage) {
        message += errorMessage;
      }

      // показываем разные кнопки в зависимости от наличия реквизитов
      const keyboard = [
        [
          Markup.button.callback('✅ Подтвердить', 'confirm_order')
        ],
        [
          Markup.button.callback('🛠 Изменить', 'edit_order')
        ],
        [
          Markup.button.callback('❌ Отменить', 'cancel_order')
        ]
      ];

      if (editMode) {
        await this.editMessageOrCaption(ctx, message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } else {
        const inlineKeyboard = Markup.inlineKeyboard(keyboard);
        await this.sendNavigationTemplatePhoto(ctx, {
          templateName: 'order_summary',
          caption: message,
          keyboard: inlineKeyboard,
          generator: () => imageGenerator.generateOrderSummaryImage()
        });
      }

    } catch (error) {
      console.error('Ошибка создания операции:', error);
      if (error?.code === 'AMOUNT_OUT_OF_RANGE') {
        console.warn('[RANGE_REJECT] order summary rejected', {
          tg_id: ctx?.from?.id || null,
          editMode,
          operation: ctx?.session?.operation || null,
          min_rub: error?.minAmountRub ?? null,
          max_rub: error?.maxAmountRub ?? null,
          min_coin: error?.minAmountCoin ?? null,
          max_coin: error?.maxAmountCoin ?? null,
          coin: error?.coin || ctx?.session?.operation?.coin || null
        });

        const rangeMessage = this.buildAmountOutOfRangeMessage(error, ctx.session.operation, {
          includePrompt: true
        });
        const keyboard = editMode
          ? this.buildAmountInputKeyboard(ctx.session.operation, { backCallback: 'back_to_order_summary' })
          : this.buildAmountInputKeyboard(ctx.session.operation);
        ctx.session.waitingFor = editMode
          ? 'edit_amount'
          : `${ctx.session.operation.type.toLowerCase()}_amount`;

        if (editMode) {
          await this.editMessageOrCaption(ctx, rangeMessage, {
            ...keyboard
          });
        } else {
          await this.replaceNavigationText(ctx, rangeMessage, keyboard);
        }
        return;
      }
      if (error?.code === 'INVALID_TIER_CONFIGURATION') {
        const configMessage = this.buildTierConfigurationMessage(error, ctx.session.operation, {
          includePrompt: true
        });
        const keyboard = editMode
          ? this.buildAmountInputKeyboard(ctx.session.operation, { backCallback: 'back_to_order_summary' })
          : this.buildAmountInputKeyboard(ctx.session.operation);
        ctx.session.waitingFor = editMode
          ? 'edit_amount'
          : `${ctx.session.operation.type.toLowerCase()}_amount`;

        if (editMode) {
          await this.editMessageOrCaption(ctx, configMessage, {
            ...keyboard
          });
        } else {
          await this.replaceNavigationText(ctx, configMessage, keyboard);
        }
        return;
      }
      if (editMode) {
        await this.editMessageOrCaption(ctx, '❌ Ошибка создания операции. Повторите чуть позже.', {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'cancel')]
          ])
        });
      } else {
        await this.replaceNavigationText(ctx, '❌ Ошибка создания операции. Повторите чуть позже.');
      }
      ctx.session = {};
    }
  }

  // создание заказа
  async createOrder(ctx) {
    try {
      ctx.session = ctx.session || {};

      const user = await this.getOrCreateUser(ctx);
      const { type, coin, amount, address, cardInfo } = ctx.session.operation;
      const inputMode = (ctx.session.operation.amountInputMode || 'CRYPTO').toUpperCase();
      const requestedRub = Number(ctx.session.operation.inputRub);
      console.log("Создание ордера сессия:", ctx.session.operation);

      // подготавливаем данные заказа в зависимости от типа операции
      const orderData = {
        userId: user.base_user_id || user.user_id, // базовый ID юзера для заказов
        userBotId: user.id, // ID конкретной связи пользователь-бот
        dir: type,
        coin,
        amountCoin: amount,
        inputMode,
        botId: ctx.botConfig.id,
        transaction_type: type
      };

      if (inputMode === 'RUB' && Number.isFinite(requestedRub) && requestedRub > 0) {
        orderData.sumRub = requestedRub;
      }

      // добавляем специфичные данные в зависимости от типа операции
      if (type === 'BUY') {
        orderData.cryptoAddress = address;
      } else if (type === 'SELL') {
        orderData.cardInfo = cardInfo;
      }

      const order = await this.orderService.createOrder(orderData);
      const message = this.buildOrderCreatedMessage(order, { paymentReceived: false });

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML'
      });

      const createdMessageId = ctx.callbackQuery?.message?.message_id || null;
      const createdMessageChatId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id || order.tg_id || null;
      if (createdMessageId && createdMessageChatId) {
        this.setOrderFlowState(order.id, {
          createdMessageId,
          createdMessageChatId
        });
      }

      this.activateOrderChatMode(ctx, order.id);

} catch (error) {
  console.error('Error creating order:', error);

  const userText = error?.userMessage || 'Ошибка создания операции. Повторите чуть позже.';

  let keyboard;
  if (error?.existingOrderId && error?.existingOrderUniqueId) {
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(
        `Перейти к заявке #${error.existingOrderUniqueId}`,
        `order_${error.existingOrderId}`
      )]
    ]);
  } else {
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✖️ Отмена', 'cancel')]
    ]);
  }

  await this.editMessageOrCaption(ctx, `❌ ${userText}`, keyboard);
  ctx.session = {};
}

  }

  // показ профильа
  async showCabinet(ctx) {
    const botId = ctx.botConfig.id;
    const templateName = 'cabinet';

    const user = await this.getOrCreateUser(ctx);
    const userId = user.base_user_id || user.user_id || user.id;
    const userBotId = user.id;

    const orderStats = await User.getOrdersStats(userId, botId);

    // Рассчитываем количество дней с регистрации
    const registrationDate = new Date(user.created_at);
    const currentDate = new Date();
    const daysDiff = Math.floor((currentDate - registrationDate) / (1000 * 60 * 60 * 24));
    const daysWithUs = daysDiff === 0 ? 1 : daysDiff; // Минимум 1 день

    // Получаем статистику рефералов
    const UserBot = require('../models/UserBot');
    const ReferralService = require('../services/ReferralService');
    const ReferralWithdraw = require('../models/ReferralWithdraw');

    const referralStats = await UserBot.getReferralStats(userBotId, botId);
    const currentLevel = user.referral_level || 'BASIC';
    const bonusBalance = await ReferralWithdraw.getAvailableBalance(userBotId);
    const levelInfo = ReferralService.getReferralLevelInfo(currentLevel);

    // Проверяем и создаем реферальный код если нужно
    let referralCode = referralStats.referralCode;
    if (!referralCode) {
      referralCode = await UserBot.generateReferralCode(userBotId, botId);
    }

    // Создаем реферальную ссылку
    const botUsername = await this.getBotUsername(ctx.botConfig.id);
    let referralLink;
    if (botUsername) {
      referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
    } else {
      referralLink = `https://t.me/${ctx.botConfig.identifier}?start=${referralCode}`;
    }

    let caption = `🆔 ID: ${user.id}\n`;
    caption += `👤 Username: @${ctx.from.username || 'не указан'}\n`;
    caption += `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}\n`;
    caption += `🗓 Вы с нами: ${daysWithUs} ${this.getDaysWord(daysWithUs)}\n\n`;

    caption += `📊 <b>Статистика сделок:</b>\n`;
    caption += `✔️ Завершённых: ${orderStats.completed_orders}\n`;
    caption += `💰 Общая сумма: ${orderStats.total_sum.toLocaleString()} ₽\n\n`;

    // Добавляем статистику рефералов
    caption += `👥 <b>Реферальная программа:</b>\n`;
    caption += `📎 Ваша реферальная ссылка:\n<code>${referralLink}</code>\n`;
    caption += `👬 Количество ваших рефералов: ${referralStats.referralsCount}\n`;
    caption += `💰 Сумма обменявших рефералов: ${referralStats.referralsSum.toLocaleString()} ₽\n`;
    caption += `💯 Ваш процент: ${(levelInfo.percentage * 100).toFixed(1)}%\n`;
    if (bonusBalance > 0) {
      caption += `🤑 Всего заработано: ${bonusBalance.toLocaleString()} рублей\n`;
    } else {
      caption += `🤑 Всего заработано: 0 рублей\n`;
    }
    caption += `\n`;

    // создаем инлайн клавиатуру
    const keyboard = [
      [Markup.button.callback('📜 Лента сделок', 'history')],
      [Markup.button.callback('💳 Шаблоны оплаты', 'user_requisites')]
    ];

    if (bonusBalance > 0) {
      keyboard.push([Markup.button.callback('💸 Вывод реф. бонусов', 'withdraw_bonuses')]);
    }

      keyboard.push([Markup.button.callback('↩️ Назад', 'main_menu')]);

    // const chatLinks = [];
    // if (ctx.botConfig.exchange_chat_link) {
    //   chatLinks.push(Markup.button.url('💬 Чат', ctx.botConfig.exchange_chat_link));
    // }
    // if (ctx.botConfig.reviews_chat_link) {
    //   chatLinks.push(Markup.button.url('📖 Канал рейтинга', ctx.botConfig.reviews_chat_link));
    // }

    // if (chatLinks.length > 0) {
    //   keyboard.push(chatLinks);
    // }

    const inlineKeyboard = Markup.inlineKeyboard(keyboard);
    await this.sendNavigationTemplatePhoto(ctx, {
      templateName,
      caption,
      keyboard: inlineKeyboard,
      generator: () => imageGenerator.generateCabinetImage()
    });
  }

  // показ профильа inline (для редактирования сообщений)
  async showCabinetInline(ctx) {
    const user = await this.getOrCreateUser(ctx);
    const userId = user.base_user_id || user.user_id || user.id;
    const userBotId = user.id;
    const botId = ctx.botConfig.id;

    const orderStats = await User.getOrdersStats(userId, botId);

    // Рассчитываем количество дней с регистрации
    const registrationDate = new Date(user.created_at);
    const currentDate = new Date();
    const daysDiff = Math.floor((currentDate - registrationDate) / (1000 * 60 * 60 * 24));
    const daysWithUs = daysDiff === 0 ? 1 : daysDiff; // Минимум 1 день

    // Получаем статистику рефералов
    const UserBot = require('../models/UserBot');
    const ReferralService = require('../services/ReferralService');
    const ReferralWithdraw = require('../models/ReferralWithdraw');

    const referralStats = await UserBot.getReferralStats(userBotId, botId);
    const currentLevel = user.referral_level || 'BASIC';
    const bonusBalance = await ReferralWithdraw.getAvailableBalance(userBotId);
    const levelInfo = ReferralService.getReferralLevelInfo(currentLevel);

    // Проверяем и создаем реферальный код если нужно
    let referralCode = referralStats.referralCode;
    if (!referralCode) {
      referralCode = await UserBot.generateReferralCode(userBotId, botId);
    }

    // Создаем реферальную ссылку
    const botUsername = await this.getBotUsername(ctx.botConfig.id);
    let referralLink;
    if (botUsername) {
      referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
    } else {
      referralLink = `https://t.me/${ctx.botConfig.identifier}?start=${referralCode}`;
    }

    let message = `🆔 ID: ${user.id}\n`;
    message += `👤 Username: @${ctx.from.username || 'не указан'}\n`;
    message += `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}\n`;
    message += `🗓 Вы с нами: ${daysWithUs} ${this.getDaysWord(daysWithUs)}\n\n`;

    message += `📊 <b>Статистика сделок:</b>\n`;
    message += `✔️ Завершённых: ${orderStats.completed_orders}\n`;
    message += `💰 Общая сумма: ${orderStats.total_sum.toLocaleString()} ₽\n\n`;

    // Добавляем статистику рефералов
    message += `👥 <b>Реферальная программа:</b>\n`;
    message += `📎 Ваша реферальная ссылка:\n<code>${referralLink}</code>\n`;
    message += `👬 Количество ваших рефералов: ${referralStats.referralsCount}\n`;
    message += `💰 Сумма обменявших рефералов: ${referralStats.referralsSum.toLocaleString()} ₽\n`;
    message += `💯 Ваш процент: ${(levelInfo.percentage * 100).toFixed(1)}%\n`;
    if (bonusBalance > 0) {
      message += `🤑 Всего заработано: ${bonusBalance.toLocaleString()} рублей\n`;
    } else {
      message += `🤑 Всего заработано: 0 рублей\n`;
    }
    message += `\n`;

    // создаем инлайн клавиатуру
    const keyboard = [
      [Markup.button.callback('📜 Лента сделок', 'history')],
      [Markup.button.callback('💳 Шаблоны оплаты', 'user_requisites')]
    ];

    // добавляем кнопку вывода бонусов если есть баланс
    if (bonusBalance > 0) {
      keyboard.push([Markup.button.callback('💸 Вывод реф. бонусов', 'withdraw_bonuses')]);
    }

      keyboard.push([Markup.button.callback('↩️ Назад', 'main_menu')]);


    // добавляем ссылки на чаты из конфига бота если есть
    // const chatLinks = [];
    // if (ctx.botConfig.exchange_chat_link) {
    //   chatLinks.push(Markup.button.url('💬 Чат', ctx.botConfig.exchange_chat_link));
    // }
    // if (ctx.botConfig.reviews_chat_link) {
    //   chatLinks.push(Markup.button.url('📖 Канал рейтинга', ctx.botConfig.reviews_chat_link));
    // }

    // if (chatLinks.length > 0) {
    //   keyboard.push(chatLinks);
    // }

    await this.editMessageOrCaption(ctx, message, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(keyboard)
    });
  }

  // показ справки
  async showHelp(ctx) {
    const message = `
❓ <b>Помощь по использованию</b>

<b>Процесс покупки:</b>
1. Отметьте валюту и количество
2. Укажите адрес для получения
3. Переведите рубли по указанным реквизитам
4. Нажмите "Подтвердить оплату"
5. Дождитесь поступления криптовалюты

<b>Процесс продажи:</b>
1. Отметьте валюту и количество
2. Укажите платежные данные карты
3. Переведите криптовалюту по указанному адресу
4. Нажмите "Подтвердить перевод"
5. Дождитесь поступления рублей

По всем вопросам обращайтесь к поддержке: @support
    `;

    await this.replaceNavigationText(ctx, message, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Назад', 'main_menu')]
      ])
    });
  }

  // показ контактов
  async showContacts(ctx) {
    const botConfig = ctx.botConfig;
    if (botConfig.contacts_message && String(botConfig.contacts_message).trim()) {
      await this.replaceNavigationText(ctx, botConfig.contacts_message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('↩️ Назад', 'main_menu')]
        ])
      });
      return;
    }
    let message = `📞 <b>Связь</b>\n\n`;

    try {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const db = require('../config/database').getConnection();
      
      const [activeOrders] = await db.execute(
        `SELECT o.id, sup.login as support_username
         FROM orders o
         LEFT JOIN supports sup ON o.support_id = sup.id
         WHERE o.user_id = ? 
           AND o.bot_id = ?
           AND o.status NOT IN ('COMPLETED', 'CANCELLED')
         ORDER BY o.created_at DESC
         LIMIT 1`,
        [userId, botConfig.id]
      );

      if (activeOrders.length > 0 && activeOrders[0].support_username) {
        message += `🔻 <b>Ассистент 24/7:</b> ${activeOrders[0].support_username}\n`;
      } else {
        message += `🔻 <b>Ассистент 24/7:</b> -\n`;
      }
    } catch (error) {
      console.error('Error getting operator info:', error);
      message += `🔻 <b>Ассистент 24/7:</b> -\n`;
    }

    if (botConfig.reviews_chat_link) {
      const reviewsMatch = botConfig.reviews_chat_link.match(/t\.me\/(.+)/);
      const reviewsUsername = reviewsMatch ? `@${reviewsMatch[1]}` : botConfig.reviews_chat_link;
      message += `🔻 <b>Канал с отзывами:</b> ${reviewsUsername}\n`;
    } else {
      message += `🔻 <b>Канал с отзывами:</b> не указан\n`;
    }

    if (botConfig.exchange_chat_link) {
      const chatMatch = botConfig.exchange_chat_link.match(/t\.me\/(.+)/);
      const chatUsername = chatMatch ? `@${chatMatch[1]}` : botConfig.exchange_chat_link;
      message += `🔻 <b>Открытый чат платформы:</b> ${chatUsername}`;
    } else {
      message += `🔻 <b>Открытый чат платформы:</b> не указан`;
    }

    await this.replaceNavigationText(ctx, message, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Назад', 'main_menu')]
      ])
    });

  }

  // запрос чека для подтверждения платежа
  async requestPaymentReceipt(ctx, data) {
    try {
      const orderId = data.split('_')[1];

      if (!orderId) {
        console.error('Order ID is undefined from data:', data);
        await ctx.answerCbQuery('Ошибка: неверный ID операции');
        return;
      }

      // получаем заявку
      const order = await this.orderService.getOrderById(orderId);
      if (!order) {
        await ctx.answerCbQuery('Операция не найдена');
        return;
      }

      ctx.session = ctx.session || {};
      const sourceMessageId = ctx.callbackQuery?.message?.message_id || null;
      const sourceChatId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id || null;

      const pendingOrderId = Number(
        ctx.session.waitingForReceipt?.active
          ? ctx.session.waitingForReceipt?.orderId
          : ctx.session.waitingForTxHash?.active
            ? ctx.session.waitingForTxHash?.orderId
            : null
      );

      if (Number.isFinite(pendingOrderId) && pendingOrderId === Number(order.id)) {
        await this.safeEditMessageReplyMarkup(ctx, sourceMessageId, sourceChatId, { inline_keyboard: [] });
        await ctx.answerCbQuery('Ожидаю чек/хеш по этой заявке');
        return;
      }

      if (!this.canAcceptPaymentProof(order)) {
        await this.safeEditMessageReplyMarkup(ctx, sourceMessageId, sourceChatId, { inline_keyboard: [] });
        await ctx.answerCbQuery('Платеж уже отправлен на проверку');
        return;
      }

      // Пока пользователь вводит чек/хеш, скрываем кнопку оплаты на исходном сообщении
      await this.safeEditMessageReplyMarkup(ctx, sourceMessageId, sourceChatId, { inline_keyboard: [] });
      ctx.session.waitingForReceipt = null;
      ctx.session.waitingForTxHash = null;

      if (order.dir === 'SELL') {
        // Для продажи запрашиваем хеш транзакции
        ctx.session.waitingForTxHash = {
          orderId: Number(order.id),
          active: true
        };

        const message = `
🔗 <b>Подтверждение отправки</b>

🆔 Операция #${order.unique_id}

Пожалуйста, отправьте <b>хеш транзакции</b> отправки ${order.coin}.

⚠️ Отправьте хеш одним сообщением!
        `;

        const promptMessage = await ctx.reply(message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'cancel_receipt_upload')]
          ])
        });
        ctx.session.waitingForTxHash.promptMessageId = promptMessage?.message_id || null;
        ctx.session.waitingForTxHash.promptChatId = ctx.chat?.id || null;
        ctx.session.waitingForTxHash.sourceMessageId = sourceMessageId;
        ctx.session.waitingForTxHash.sourceChatId = sourceChatId;

        await ctx.answerCbQuery('Отправьте хеш транзакции');
      } else {
        // Для покупки запрашиваем чек (изображение или PDF)
        ctx.session.waitingForReceipt = {
          orderId: Number(order.id),
          active: true
        };

        const message = `
📎 <b>Подтверждение платежа</b>

🆔 Операция #${order.unique_id}

Пожалуйста, отправьте чек об оплате (изображение или PDF).

⚠️ Поддерживаемые форматы: <b>${this.getReceiptAllowedFormatsText()}</b>
        `;

        const promptMessage = await ctx.reply(message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'cancel_receipt_upload')]
          ])
        });
        ctx.session.waitingForReceipt.promptMessageId = promptMessage?.message_id || null;
        ctx.session.waitingForReceipt.promptChatId = ctx.chat?.id || null;
        ctx.session.waitingForReceipt.sourceMessageId = sourceMessageId;
        ctx.session.waitingForReceipt.sourceChatId = sourceChatId;

        await ctx.answerCbQuery('Отправьте чек (изображение или PDF)');
      }

    } catch (error) {
      console.error('Error requesting payment receipt:', error);
      await ctx.answerCbQuery('Сбой во время запросе чека');
    }
  }

  async cancelReceiptUpload(ctx) {
    try {
      ctx.session = ctx.session || {};

      const waitingForReceipt = ctx.session.waitingForReceipt?.active ? ctx.session.waitingForReceipt : null;
      const waitingForTxHash = ctx.session.waitingForTxHash?.active ? ctx.session.waitingForTxHash : null;
      const waitingState = waitingForReceipt || waitingForTxHash;
      const promptMessageId = waitingState?.promptMessageId || ctx.callbackQuery?.message?.message_id || null;
      const promptChatId = waitingState?.promptChatId || ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id || null;

      ctx.session.waitingForReceipt = null;
      ctx.session.waitingForTxHash = null;

      if (waitingState?.orderId && waitingState?.sourceMessageId) {
        const order = await this.orderService.getOrderById(waitingState.orderId);
        if (this.canAcceptPaymentProof(order)) {
          const paymentButtonMarkup = this.getPaymentButtonMarkup(order);
          await this.safeEditMessageReplyMarkup(
            ctx,
            waitingState.sourceMessageId,
            waitingState.sourceChatId || ctx.chat?.id || null,
            paymentButtonMarkup
          );
        }
      }

      await this.safeDeleteMessage(ctx, promptMessageId, promptChatId);

      await ctx.answerCbQuery('Действие прервано');
    } catch (error) {
      console.error('Error cancelling receipt upload:', error);
      await ctx.answerCbQuery('Не удалось отменить');
    }
  }

  // обработка загрузки чека
  async handleReceiptUpload(ctx) {
    try {
      const waitingState = ctx.session?.waitingForReceipt;
      if (!waitingState?.active || !waitingState.orderId) {
        return;
      }

      const receiptFile = this.getReceiptFilePayload(ctx);
      if (!receiptFile) {
        await ctx.reply(this.getReceiptInvalidFormatMessage(), {
          parse_mode: 'HTML'
        });
        return;
      }

      const orderId = waitingState.orderId;
      const fs = require('fs');
      const path = require('path');

      // создаем папку uploads/chats если не существует
      const uploadsDir = path.join(__dirname, '../../uploads/chats');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // скачиваем файл
      const fileId = receiptFile.fileId;
      const fileName = `receipt_${orderId}_${Date.now()}.${receiptFile.extension}`;

      const botData = this.bots.get(ctx.botConfig.id);
      if (!botData || !botData.bot) {
        throw new Error('Bot not found');
      }

      const fileLink = await botData.bot.telegram.getFileLink(fileId);
      const https = require('https');
      const filePath = path.join(uploadsDir, fileName);

      // скачиваем файл
      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(filePath);
        https.get(fileLink.href, (response) => {
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      });

      // получаем детали заказа для отправки через сокет
      const order = await this.orderService.getOrderById(orderId);

      // сохраняем сообщение в базу данных как документ
      const messageData = await this.orderService.sendOrderMessage(orderId, {
        senderId: ctx.from.id,
        senderType: 'USER',
        message: `Отправлен чек: ${fileName}`,
        attachments_path: `/uploads/chats/${fileName}`
      });

      // отправляем событие сокета для нового сообщения
      const SocketService = require('../services/SocketService');
      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: parseInt(orderId),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        attachments_path: messageData.attachments_path,
        created_at: messageData.created_at,
        bot_id: order.bot_id,
        support_id: order.support_id
      });

      // сбрасываем режим ожидания чека
      ctx.session.waitingForReceipt = null;
      await this.safeDeleteMessage(
        ctx,
        waitingState.promptMessageId,
        waitingState.promptChatId || ctx.chat?.id || null
      );

      // вызываем handlePaymentConfirmation для обновления статуса (передаем флаг что вызов из загрузки файла)
      await this.handlePaymentConfirmation(ctx, `payment_${orderId}`, true);

    } catch (error) {
      console.error('Error handling receipt upload:', error);
      await ctx.reply('❌ Сбой во время загрузке чека. Повторите ввод.');
    }
  }

  // обработка подтверждения платежа
  async handlePaymentConfirmation(ctx, data, isFromFileUpload = false) {
    try {
      const orderId = data.split('_')[1];

      if (!orderId) {
        console.error('Order ID is undefined from data:', data);
        if (!isFromFileUpload) {
          await ctx.answerCbQuery('Ошибка: неверный ID операции');
        }
        return;
      }

      // обновляем статус операции на AWAITING_CONFIRM
      await this.orderService.updateOrderStatus(orderId, 'AWAITING_CONFIRM');
      await this.orderService.updateOrderSLAUserPaid(orderId);
      console.log(`Order ${orderId} status updated to AWAITING_CONFIRM`);

      // получаем обновленную заявку и отправляем событие сокета
      const updatedOrder = await this.orderService.getOrderById(orderId);
      if (updatedOrder) {
        const SocketService = require('../services/SocketService');
        SocketService.emitOrderUpdated(updatedOrder);

        // отправляем уведомление саппорту о том, что пользователь подтвердил платеж
        SocketService.emitUserPaymentConfirmation({
          orderId: orderId,
          userId: ctx.from.id,
          username: ctx.from.username || 'Unknown',
          order: updatedOrder
        });
      }

      const message = `
✅ <b>Платёж отправлен!</b>

🆔 Операция #${updatedOrder.unique_id}
⏳ Статус: Проверяем перевод

Ваш платёж отправлен на проверку. Обычно проверка занимает 5-15 минут.

Мы уведомим вас, как только платёж будет подтверждён и операция будет выполнена.
      `;
      const chatHint = `\n\n✍️ По активной заявке можно писать прямо в этот чат, сообщение уйдет оператору.`;
      const messageWithHint = `${message}${chatHint}`;
      let paymentPendingMessageId = null;
      let paymentPendingChatId = null;

      // если вызов из загрузки файла, просто отправляем новое сообщение
      if (isFromFileUpload) {
        const botId = ctx.botConfig.id;
        const templateName = 'payment_pending';
        const cachedFileId = telegramImageCache.get(botId, templateName);

        try {
          if (cachedFileId) {
            const sentMessage = await ctx.replyWithPhoto(cachedFileId, {
              caption: messageWithHint,
              parse_mode: 'HTML'
            });
            paymentPendingMessageId = sentMessage?.message_id || null;
            paymentPendingChatId = sentMessage?.chat?.id || ctx.chat?.id || null;
          } else {
            const imagePath = await imageGenerator.generatePaymentPendingImage();
            const sentMessage = await ctx.replyWithPhoto(
              { source: imagePath },
              {
                caption: messageWithHint,
                parse_mode: 'HTML'
              }
            );

            if (sentMessage.photo && sentMessage.photo.length > 0) {
              const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
              telegramImageCache.set(botId, templateName, fileId);
            }
            paymentPendingMessageId = sentMessage?.message_id || null;
            paymentPendingChatId = sentMessage?.chat?.id || ctx.chat?.id || null;
          }
        } catch (error) {
          console.error('Error sending payment pending image:', error);
          const sentMessage = await ctx.reply(messageWithHint, {
            parse_mode: 'HTML'
          });
          paymentPendingMessageId = sentMessage?.message_id || null;
          paymentPendingChatId = sentMessage?.chat?.id || ctx.chat?.id || null;
        }
      } else {
        // если вызов из callback query, пробуем удалить старое сообщение
        try {
          await ctx.deleteMessage();

          const botId = ctx.botConfig.id;
          const templateName = 'payment_pending';
          const cachedFileId = telegramImageCache.get(botId, templateName);

          if (cachedFileId) {
            const sentMessage = await ctx.replyWithPhoto(cachedFileId, {
              caption: messageWithHint,
              parse_mode: 'HTML'
            });
            paymentPendingMessageId = sentMessage?.message_id || null;
            paymentPendingChatId = sentMessage?.chat?.id || ctx.chat?.id || null;
          } else {
            const imagePath = await imageGenerator.generatePaymentPendingImage();
            const sentMessage = await ctx.replyWithPhoto(
              { source: imagePath },
              {
                caption: messageWithHint,
                parse_mode: 'HTML'
              }
            );

            if (sentMessage.photo && sentMessage.photo.length > 0) {
              const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
              telegramImageCache.set(botId, templateName, fileId);
            }
            paymentPendingMessageId = sentMessage?.message_id || null;
            paymentPendingChatId = sentMessage?.chat?.id || ctx.chat?.id || null;
          }
        } catch (error) {
          console.error('Error sending payment pending image:', error);
          // фолбек на редактирование сообщения
          await this.editMessageOrCaption(ctx, messageWithHint, {
            parse_mode: 'HTML'
          });
          paymentPendingMessageId = ctx.callbackQuery?.message?.message_id || null;
          paymentPendingChatId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id || null;
        }

        await ctx.answerCbQuery('Платёж отправлен на проверку!');
      }

      if (paymentPendingMessageId && paymentPendingChatId) {
        this.setOrderFlowState(orderId, {
          paymentPendingMessageId,
          paymentPendingChatId
        });
      }

    } catch (error) {
      console.error('Error handling payment confirmation:', error);
      if (!isFromFileUpload) {
        await ctx.answerCbQuery('Сбой во время обработке платежа');
      }
      await ctx.reply('❌ Не удалось выполнить действие при обработке платежа. Повторите чуть позже.');
    }
  }

  // обработка ввода хеша транзакции
  async handleTxHashInput(ctx, txHash) {
    try {
      const waitingState = ctx.session?.waitingForTxHash;
      if (!waitingState?.active || !waitingState.orderId) {
        return;
      }

      const orderId = waitingState.orderId;
      
      // валидация хеша транзакции (базовая проверка)
      const cleanHash = txHash.trim();
      if (cleanHash.length < 40 || cleanHash.length > 120) {
        await ctx.reply(`❌ Формат не подходит хеша транзакции.

Хеш должен содержать от 40 до 120 символов. Повторите ввод.`, {
          parse_mode: 'HTML'
        });
        return;
      }

      // проверяем что хеш содержит только допустимые символы
      if (!/^[a-fA-F0-9]+$/.test(cleanHash)) {
        await ctx.reply(`❌ Формат не подходит хеша транзакции.

Хеш должен содержать только цифры и буквы a-f. Повторите ввод.`, {
          parse_mode: 'HTML'
        });
        return;
      }

      // получаем детали заказа для отправки через сокет
      const order = await this.orderService.getOrderById(orderId);

      // сохраняем сообщение в базу данных
      const messageData = await this.orderService.sendOrderMessage(orderId, {
        senderId: ctx.from.id,
        senderType: 'USER',
        message: `Хеш транзакции: ${cleanHash}`
      });

      // отправляем событие сокета для нового сообщения
      const SocketService = require('../services/SocketService');
      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: parseInt(orderId),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        created_at: messageData.created_at,
        bot_id: order.bot_id,
        support_id: order.support_id
      });

      await this.safeDeleteMessage(
        ctx,
        waitingState.promptMessageId,
        waitingState.promptChatId || ctx.chat?.id || null
      );
      await this.safeDeleteMessage(ctx, ctx.message?.message_id, ctx.chat?.id || null);

      // сбрасываем режим ожидания хеша
      ctx.session.waitingForTxHash = null;

      // обновляем статус операции на AWAITING_CONFIRM
      await this.orderService.updateOrderStatus(orderId, 'AWAITING_CONFIRM');
      await this.orderService.updateOrderSLAUserPaid(orderId);
      console.log(`Order ${orderId} status updated to AWAITING_CONFIRM`);

      // получаем обновленную заявку и отправляем событие сокета
      const updatedOrder = await this.orderService.getOrderById(orderId);
      if (updatedOrder) {
        SocketService.emitOrderUpdated(updatedOrder);

        // отправляем уведомление саппорту о том, что пользователь подтвердил отправку
        SocketService.emitUserPaymentConfirmation({
          orderId: orderId,
          userId: ctx.from.id,
          username: ctx.from.username || 'Unknown',
          order: updatedOrder
        });
      }

      const message = `
✅ <b>Хеш транзакции получен!</b>

🆔 Операция #${updatedOrder.unique_id}
⏳ Статус: Проверка транзакции

Ваш хеш транзакции отправлен на проверку. Обычно проверка занимает 5-15 минут.

Мы уведмим вас, как только транзкция будет подтверден и операция будет выполнена.
      `;
      const messageWithHint = `${message}\n\n✍️ По активной заявке можно писать прямо в этот чат, сообщение уйдет оператору.`;
      const hashExplorerUrl = this.getTransactionExplorerLink(updatedOrder?.coin || order?.coin, cleanHash);
      const shortHash = cleanHash.length > 28
        ? `${cleanHash.slice(0, 14)}...${cleanHash.slice(-10)}`
        : cleanHash;
      const hashLine = hashExplorerUrl
        ? `\n\n🔗 Хеш: <a href="${hashExplorerUrl}">${shortHash}</a>`
        : `\n\n🔗 Хеш: <code>${cleanHash}</code>`;
      const messageWithHash = `${messageWithHint}${hashLine}`;

      const botId = ctx.botConfig.id;
      const templateName = 'payment_pending';
      const cachedFileId = telegramImageCache.get(botId, templateName);

      try {
        if (cachedFileId) {
          await ctx.replyWithPhoto(cachedFileId, {
            caption: messageWithHash,
            parse_mode: 'HTML'
          });
        } else {
          const imagePath = await imageGenerator.generatePaymentPendingImage();
          const sentMessage = await ctx.replyWithPhoto(
            { source: imagePath },
            {
              caption: messageWithHash,
              parse_mode: 'HTML'
            }
          );

          if (sentMessage.photo && sentMessage.photo.length > 0) {
            const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
            telegramImageCache.set(botId, templateName, fileId);
          }
        }
      } catch (error) {
        console.error('Error sending tx hash confirmation image:', error);
        await ctx.reply(messageWithHash, {
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      console.error('Error handling tx hash input:', error);
      await ctx.reply('❌ Сбой во время обработке хеша транзакции. Повторите ввод.');
    }
  }

  // обработка запроса поддержки
  async handleSupportRequest(ctx, data) {
    try {
      const orderId = data.split('_')[1];

      // ставим пользователя в режим чата для этой операции
      ctx.session = ctx.session || {};
      ctx.session.chatMode = {
        orderId: orderId,
        active: true
      };

      // получаем заявку чтобы показать unique_id
      const order = await this.orderService.getOrderById(orderId);
      if (!order) {
        await ctx.answerCbQuery('Операция не найдена');
        return;
      }

      const message = `
 <b>Чат с оператором</b>

🆔 Операция #${order.unique_id}

✍️ Напишите ваше сообщение оператору.

⚡ Среднее время ответа: 5-10 минут
      `;

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML'
      });

    } catch (error) {
      console.error('Error handling support request:', error);
      await ctx.answerCbQuery('Сбой во время получении контактов поддержки');
    }
  }

  // показ статуса операции
  async showOrderStatus(ctx, data) {
    try {
      const orderId = data.split('_')[1];

      ctx.session = ctx.session || {};

      // получаем заявку из базы
      const order = await this.orderService.getOrderById(orderId);

      if (!order) {
        await ctx.answerCbQuery('Операция не найдена');
        return;
      }

      const statusText = {
        'CREATED': '🆕 Создана',
        'AWAITING_CONFIRM': '⏳ Ожидает подтверждения',
        'QUEUED': '📋 В очереди',
        'PAYMENT_PENDING': '🔍 Ожидание платежа',
        'AWAITING_HASH': '⏳ Ожидание выплаты',
        'COMPLETED': '✔️ Выполнена',
        'CANCELLED': '❌ Отменена'
      };

      const message = `
📋 <b>Операция #${order.unique_id}</b>

💱 Операция: ${order.dir === 'BUY' ? 'Покупка' : 'Продажа'}
💰 Валюта: ${order.coin}
📊 Количество: ${order.amount_coin} ${order.coin}
💵 Сумма: ${order.sum_rub.toLocaleString()} ₽
📊 Статус: ${statusText[order.status] || order.status}

📅 Создана: ${new Date(order.created_at).toLocaleString('ru-RU')}
      `;

      const isActiveOrder = order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
      const statusMessage = isActiveOrder
        ? `${message}\n✍️ По активной заявке можно писать прямо в этот чат, сообщение уйдет оператору.`
        : message;
      const keyboard = [];

      if (this.canAcceptPaymentProof(order)) {
        keyboard.push([
          Markup.button.callback(
            this.getPaymentButtonText(order),
            `payment_${order.id}`
          )
        ]);
      }

      if (isActiveOrder) {
        this.activateOrderChatMode(ctx, order.id);
      } else if (ctx.session.chatMode?.orderId === Number(order.id)) {
        ctx.session.chatMode = null;
      }

      await this.editMessageOrCaption(ctx, statusMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

      await ctx.answerCbQuery('Информация о заявке');

    } catch (error) {
      console.error('Error showing order status:', error);
      await ctx.answerCbQuery('Сбой во время получении информации о заявке');
    }
  }

  // получение экземпляра бота по id
  getBotById(botId) {
    const botData = this.bots.get(parseInt(botId));
    return botData || null;
  }

  // получение первого доступного бота
  getFirstAvailableBot() {
    for (const [botId, botData] of this.bots) {
      if (botData && botData.bot) {
        return botData;
      }
    }
    return null;
  }

  // остановка всех ботов
  async stopAll() {
    console.log('🛑 Stopping all bots...');
    for (const [botId, botInstance] of this.bots) {
      await this.stopBot(botId);
    }
    console.log('✅ All bots stopped');
  }

  // запуск конкретного бота (для api)
  async startBot(botId) {
    try {
      if (this.bots.has(botId)) {
        return { success: false, error: 'Бот уже запущен' };
      }

      const bot = await Bot.findById(botId);
      if (!bot || !bot.is_active) {
        return { success: false, error: 'Бот не найден или неактивен' };
      }

      await this.initializeBot(bot);
      console.log(`✅ Bot ${bot.name} (ID: ${botId}) started via API`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to start bot ${botId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // остановка конкретного бота
  async stopBot(botId) {
    try {
      const botData = this.bots.get(botId);
      if (!botData) {
        return { success: false, error: 'Бот не запущен' };
      }

      await botData.bot.stop();
      this.bots.delete(botId);

      console.log(`⏹️ Bot ID ${botId} stopped`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Failed to stop bot ${botId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // перезапуск конкретного бота
  async restartBot(botId) {
    try {
      const stopResult = await this.stopBot(botId);
      if (!stopResult.success) {
        // если бот не работал, все равно пробуем его запустить
        console.log(`Bot ${botId} wasn't running, starting fresh...`);
      }

      // немного подождем перед запуском
      await new Promise(resolve => setTimeout(resolve, 1000));

      const startResult = await this.startBot(botId);
      return startResult;
    } catch (error) {
      console.error(`❌ Failed to restart bot ${botId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // получение статуса бота
  async getBotStatus(botId) {
    try {
      const botData = this.bots.get(botId);
      const bot = await Bot.findById(botId);

      if (!bot) {
        return {
          exists: false,
          running: false,
          error: 'Бот не найден в базе данных'
        };
      }

      const status = {
        exists: true,
        running: !!botData,
        botId: parseInt(botId),
        name: bot.name,
        identifier: bot.identifier,
        isActive: bot.is_active
      };

      if (botData) {
        status.startTime = botData.startTime;
        status.uptime = Date.now() - botData.startTime;
      }

      return status;
    } catch (error) {
      console.error(`❌ Failed to get bot status ${botId}:`, error);
      return {
        exists: false,
        running: false,
        error: error.message
      };
    }
  }

  // получение статуса всех ботов
  async getAllBotsStatus() {
    try {
      const allBots = await Bot.getAll();
      const statusList = [];

      for (const bot of allBots) {
        const status = await this.getBotStatus(bot.id);
        statusList.push(status);
      }

      return statusList;
    } catch (error) {
      console.error('❌ Failed to get all bots status:', error);
      return [];
    }
  }

  // отправка сообщения пользователю от оператора
  async sendMessageToUser(orderId, message) {
    let order = null;
    let botData = null;
    let isRequisitesMessage = false;
    let sentMessageId = null;
    try {
      // получаем детали заказа чтобы найти бота и пользователя
      order = await OrderService.getOrderDetails(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // пробуем получить экземпляр бота для этого заказа
      if (order.bot_id) {
        botData = this.bots.get(order.bot_id);
      }

      // если бот заказа не найден или не указан, пробуем найти альтернативный бот
      if (!botData || !botData.bot) {
        console.warn(`Bot not found for bot_id: ${order.bot_id}, trying to find alternative bot`);

        // пробуем найти бота через user_bot_id если доступно
        if (order.user_bot_id) {
          try {
            const UserBot = require('../models/UserBot');
            const userBot = await UserBot.findById(order.user_bot_id);
            if (userBot && userBot.bot_id) {
              botData = this.bots.get(userBot.bot_id);
              if (botData && botData.bot) {
                console.log(`Found bot ${userBot.bot_id} through user_bot_id`);
              }
            }
          } catch (error) {
            console.warn('Error finding bot through user_bot_id:', error);
          }
        }

        // если все еще нет бота, используем любого активного бота
        if (!botData || !botData.bot) {
          for (const [botId, bot] of this.bots.entries()) {
            if (bot && bot.bot) {
              botData = bot;
              console.log(`Using fallback bot ${botId} to send message`);
              break;
            }
          }
        }

        if (!botData || !botData.bot) {
          throw new Error('No active bots available to send message');
        }
      }

      // проверяем есть ли у пользователя tg_id
      if (!order.tg_id) {
        throw new Error('User telegram ID not found in order');
      }

      // отправляем сообщение через бота
      const buttons = [];

      // Если сообщение содержит платежные данные для оплаты, добавляем кнопку подтверждения
      //сделать дополнительно проверку на статус PAYMENT_PENDING
      if (order.status === 'PAYMENT_PENDING') {
        if (message.includes('Платежные данные для оплаты') || message.includes('Номер карты') || message.includes('Номер телефона') || message.includes('Адрес для отправки') || message.includes('Переведите указанное')) {
          buttons.push([{ text: this.getPaymentButtonText(order), callback_data: `payment_${orderId}` }]);
        }
      }

      const messageOptions = { parse_mode: 'HTML' };
      if (buttons.length > 0) {
        messageOptions.reply_markup = {
          inline_keyboard: buttons
        };
      }

      isRequisitesMessage =
        message.includes('Платежные данные для оплаты') ||
        message.includes('Номер карты') ||
        message.includes('Номер телефона');
      const isPaymentReceivedMessage = message.includes('Оплата успешно получена');

      if (isPaymentReceivedMessage && order.dir === 'BUY') {
        await this.applyPaymentReceivedUiUpdate(botData.bot.telegram, orderId, order);
      }

      const sentMessage = await botData.bot.telegram.sendMessage(order.tg_id, `
💬 <b>Сообщение от оператора</b>
📋 Операция #${order.unique_id}

${message}

<i>Для ответа, напишите cюда в чат</i>
      `, messageOptions);
      sentMessageId = Number(sentMessage?.message_id || 0);

      if (isRequisitesMessage && order.status === 'PAYMENT_PENDING' && sentMessage?.message_id) {
        this.setOrderFlowState(orderId, {
          requisitesMessageId: sentMessage.message_id,
          requisitesMessageChatId: sentMessage.chat?.id || order.tg_id || null
        });
      }

      if (isRequisitesMessage) {
        console.log('✅ Requisites message sent to user:', {
          order_id: Number(order.id || orderId),
          unique_id: Number(order.unique_id || 0),
          user_tg_id: Number(order.tg_id || 0),
          bot_id: Number(order.bot_id || 0),
          message_id: sentMessageId || null,
          type: 'requisites'
        });
      }

      return true;
    } catch (error) {
      console.error('Error sending message to user:', {
        message: error.message,
        order_id: Number(order?.id || orderId || 0),
        unique_id: Number(order?.unique_id || 0),
        user_tg_id: Number(order?.tg_id || 0),
        bot_id: Number(order?.bot_id || botData?.botId || 0),
        message_id: sentMessageId || null,
        type: isRequisitesMessage ? 'requisites' : 'generic'
      });
      return false;
    }
  }

  async sendOrderAttachmentToUser(orderId, attachmentPath, captionText = '') {
    let order = null;
    let botData = null;
    try {
      order = await OrderService.getOrderDetails(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      if (order.bot_id) {
        botData = this.bots.get(order.bot_id);
      }

      if (!botData || !botData.bot) {
        for (const [botId, bot] of this.bots.entries()) {
          if (bot && bot.bot) {
            botData = bot;
            console.log(`Using fallback bot ${botId} to send order attachment`);
            break;
          }
        }
      }

      if (!botData || !botData.bot) {
        throw new Error('No active bots available to send attachment');
      }

      if (!order.tg_id) {
        throw new Error('User telegram ID not found in order');
      }

      const fs = require('fs');
      const path = require('path');
      const normalizedAttachmentPath = String(attachmentPath || '').replace(/^\/+/, '');
      const fullPath = path.join(__dirname, '../..', normalizedAttachmentPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Attachment file not found: ${fullPath}`);
      }

      const fileExt = path.extname(fullPath).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(fileExt);

      const normalizedCaptionText = String(captionText || '').trim();
      const captionBody = normalizedCaptionText
        ? `${normalizedCaptionText}\n\n<i>Для ответа, напишите cюда в чат</i>`
        : `<i>Для ответа, напишите cюда в чат</i>`;
      const rawCaption = `💬 <b>Сообщение от оператора</b>\n📋 Операция #${order.unique_id}\n\n${captionBody}`;
      const safeCaption = rawCaption.length > 1000 ? `${rawCaption.slice(0, 997)}...` : rawCaption;

      if (isImage) {
        await botData.bot.telegram.sendPhoto(
          order.tg_id,
          { source: fullPath },
          {
            caption: safeCaption,
            parse_mode: 'HTML'
          }
        );
      } else {
        await botData.bot.telegram.sendDocument(
          order.tg_id,
          { source: fullPath },
          {
            caption: safeCaption,
            parse_mode: 'HTML'
          }
        );
      }

      return true;
    } catch (error) {
      console.error('Error sending attachment to user:', {
        message: error.message,
        order_id: Number(order?.id || orderId || 0),
        unique_id: Number(order?.unique_id || 0),
        user_tg_id: Number(order?.tg_id || 0),
        bot_id: Number(order?.bot_id || botData?.botId || 0),
        attachment_path: attachmentPath || null
      });
      return false;
    }
  }

  async sendOrderCompletionNotification(orderId) {
    try {
      const order = await this.orderService.getOrderDetails(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      let botData = null;

      if (order.bot_id) {
        botData = this.bots.get(order.bot_id);
      }

      if (!botData || !botData.bot) {
        console.warn(`Бот не найден bot_id: ${order.bot_id}`);
        return false;
      }

      // проверяем есть ли у пользователя tg_id
      if (!order.tg_id) {
        throw new Error('тг_id пользователя не найден в заявке');
      }

      // получаем хеш транзакции из поля hash
      const transactionHash = order.hash;
      const receiptPath = order.receipt_path;
      
      // создаем ссылку на транзакцию в зависимости от монеты
      let transactionLink = '';
      if (transactionHash && order.dir === 'BUY') {
        switch(order.coin) {
          case 'BTC':
            transactionLink = `https://mempool.space/tx/${transactionHash}`;
            break;
          case 'LTC':
            transactionLink = `https://blockchair.com/litecoin/transaction/${transactionHash}`;
            break;
          case 'XMR':
            transactionLink = `https://xmrchain.net/tx/${transactionHash}`;
            break;
          case 'USDT':
            transactionLink = `https://tronscan.org/#/transaction/${transactionHash}`;
            break;
        }
      }

      // получаем username бота для ссылки
      const botUsername = await this.getBotUsername(order.bot_id);
      const botLink = botUsername ? `@${botUsername}` : 'наш сервис';

      // создаем сообщение о завершении
      let message = `✅ <b>Операция закрыта!</b>\n\n`;
      message += `🆔 Операция #${order.unique_id}\n`;
      message += `💱 Операция: ${order.dir === 'BUY' ? 'Покупка' : 'Продажа'}\n`;
      message += `💰 ${order.coin}: ${order.amount_coin}\n`;
      message += `💵 Сумма: ${order.sum_rub.toLocaleString()} ₽\n\n`;

      if (order.dir === 'BUY' && transactionLink) {
        message += `📎 Ссылка на транзакцию: ${transactionLink}\n\n`;
        message += `⌛️ Среднее время для первого подтверждения 5-20 минут\n`;
      } else if (order.dir === 'BUY') {
        message += `💰 ${order.coin} отправен на ваш адрес.\n`;
      } else {
        message += `💳 Деньги отправлены на указанную карту.\n`;
      }

      message += `\n❤️ Спасибо что выбрали ${botLink}`;

      // Кнопка быстрого перехода в новое сообщение с главным меню
      const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Главное меню', 'main_menu_new_message')]
      ]);

      try {
        const templateName = 'order_completed';
        const cachedFileId = telegramImageCache.get(order.bot_id, templateName);

        if (cachedFileId) {
          // Используем закешированный file_id
          await botData.bot.telegram.sendPhoto(
            order.tg_id,
            cachedFileId,
            {
              caption: message,
              parse_mode: 'HTML',
              ...mainMenuKeyboard
            }
          );
        } else {
          // енерируем и отправляе новое изображени
          const imageBuffer = await imageGenerator.generateOrderCompletedImage(order);
          const sentMessage = await botData.bot.telegram.sendPhoto(
            order.tg_id,
            { source: imageBuffer },
            {
              caption: message,
              parse_mode: 'HTML',
              ...mainMenuKeyboard
            }
          );

          // Кешируем file_id
          if (sentMessage.photo && sentMessage.photo.length > 0) {
            const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
            telegramImageCache.set(order.bot_id, templateName, fileId);
          }
        }

        // Если это продажа и есть чек - отправляем фото чека вторым сообщением как документ (не сжато)
        if (order.dir === 'SELL' && receiptPath) {
          const fs = require('fs');
          const path = require('path');
          
          // Строим абсолютный путь от корня проекта backend
          const fullPath = path.join(__dirname, '../..', receiptPath);
          console.log('📎 [Receipt] Trying to send receipt:', fullPath);
          
          if (fs.existsSync(fullPath)) {
            console.log('📎 [Receipt] File exists, sending...');
            await botData.bot.telegram.sendDocument(
              order.tg_id,
              { source: fullPath },
              {
                caption: '📎 Чек об оплате',
                parse_mode: 'HTML'
              }
            );

          } else {
            console.error('📎 [Receipt] File not found:', fullPath);
          }
        }

        console.log(`✅ Notification sent to user ${order.tg_id} for order #${orderId}`);
        
        // отправляем второе сообщение с просьбой оценить
        const ratingMessage = `<b>Пожалуйста, оцените качество обслуживания по заявке #${order.unique_id}:</b>\n\nБудем рады вашему отзыву!`;

        const ratingKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('⭐ 1', `rate_${orderId}_1`),
            Markup.button.callback('⭐ 2', `rate_${orderId}_2`),
            Markup.button.callback('⭐ 3', `rate_${orderId}_3`),
            Markup.button.callback('⭐ 4', `rate_${orderId}_4`),
            Markup.button.callback('⭐ 5', `rate_${orderId}_5`)
          ]
        ]);

        await botData.bot.telegram.sendMessage(order.tg_id, ratingMessage, {
          parse_mode: 'HTML',
          ...ratingKeyboard
        });

        console.log(`Completion notification and rating request sent for order ${orderId} to user ${order.tg_id}`);
        return true;
      } catch (error) {
        console.error('Error sending notification:', error);
        // Если отправка с картинкой не удалась, пробуем отправить просто текст
        try {
          await botData.bot.telegram.sendMessage(
            order.tg_id,
            message,
            {
              parse_mode: 'HTML',
              ...mainMenuKeyboard
            }
          );

          // Если это продажа и есть чек - отправляем его даже если основное сообщение без картинки (как документ)
          if (order.dir === 'SELL' && receiptPath) {
            const fs = require('fs');
            const path = require('path');
            
            // Строим абсолютный путь от корня проекта backend
            const fullPath = path.join(__dirname, '../..', receiptPath);
            console.log('📎 [Receipt Fallback] Trying to send receipt:', fullPath);
            
            if (fs.existsSync(fullPath)) {
              console.log('📎 [Receipt Fallback] File exists, sending...');
              await botData.bot.telegram.sendDocument(
                order.tg_id,
                { source: fullPath },
                {
                  caption: '📎 Чек об оплате',
                  parse_mode: 'HTML'
                }
              );
              console.log('📎 [Receipt Fallback] Receipt sent successfully');
            } else {
              console.error('📎 [Receipt Fallback] File not found:', fullPath);
            }
          }

          // отправляем второе сообщение с просьбой оценить (для fallback сценария)
          const ratingMessage = `<b>Пожалуйста, оцените качество обслуживания по заявке #${orderId}:</b>\n\nБудем рады вашему отзыву!`;

          const ratingKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('⭐ 1', `rate_${orderId}_1`),
              Markup.button.callback('⭐ 2', `rate_${orderId}_2`),
              Markup.button.callback('⭐ 3', `rate_${orderId}_3`),
              Markup.button.callback('⭐ 4', `rate_${orderId}_4`),
              Markup.button.callback('⭐ 5', `rate_${orderId}_5`)
            ]
          ]);

          await botData.bot.telegram.sendMessage(order.tg_id, ratingMessage, {
            parse_mode: 'HTML',
            ...ratingKeyboard
          });

          return true;
        } catch (innerError) {
          console.error('Error sending fallback message:', innerError);
          return false;
        }
      }
    } catch (error) {
      console.error('Error sending order completion notification:', error);
      return false;
    }
  }

  async sendOrderCancelNotification(orderId, reason = null) {
    try {
      const order = await this.orderService.getOrderDetails(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      let botData = null;

      if (order.bot_id) {
        botData = this.bots.get(order.bot_id);
      }

      if (!botData || !botData.bot) {
        console.warn(`Бот не найден bot_id: ${order.bot_id}`);
        return false;
      }

      // проверяем есть ли у пользователя tg_id
      if (!order.tg_id) {
        throw new Error('тг_id пользователя не найден в заявке');
      }

      const normalizedReason = String(reason || '').toLowerCase();
      const isTimeoutCancellation =
        normalizedReason === 'timeout' ||
        normalizedReason === 'auto_timeout' ||
        normalizedReason === 'auto_cancel_timeout';

      const cancelTitle = isTimeoutCancellation
        ? 'Операция отменена за неактивность'
        : 'Операция отменена';
      const mainMenuKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Главное меню', 'main_menu_new_message')]
      ]);

      // создаем сообщение об отмене
      let message = `
❌ <b>${cancelTitle}</b>

🆔 Операция #${order.unique_id}
💱 Операция: ${order.dir === 'BUY' ? 'Покупка' : 'Продажа'}
💰 ${order.coin}: ${order.amount_coin}
💵 Сумма: ${order.sum_rub.toLocaleString()} ₽`;

      try {
        const templateName = 'order_cancelled';
        const cachedFileId = telegramImageCache.get(order.bot_id, templateName);

        if (cachedFileId) {
          // Используем закешированный file_id
          await botData.bot.telegram.sendPhoto(order.tg_id, cachedFileId, {
            caption: message,
            parse_mode: 'HTML',
            ...mainMenuKeyboard
          });
        } else {
          // Генерируем новое изображение
          const imagePath = await imageGenerator.generateOrderCancelledImage();

          // Отправляем изображение
          const sentMessage = await botData.bot.telegram.sendPhoto(
            order.tg_id,
            { source: imagePath },
            {
              caption: message,
              parse_mode: 'HTML',
              ...mainMenuKeyboard
            }
          );

          // Кешируем file_id для будущего использования
          if (sentMessage.photo && sentMessage.photo.length > 0) {
            const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;
            telegramImageCache.set(order.bot_id, templateName, fileId);
          }
        }
      } catch (error) {
        console.error('Error sending cancellation image:', error);
        // если не получилось отправить картинку
        await botData.bot.telegram.sendMessage(order.tg_id, message, {
          parse_mode: 'HTML',
          ...mainMenuKeyboard
        });
      }

      return true;
    } catch (error) {
      console.error('Error sending order cancel notification:', error);
      return false;
    }
  }

  // начало режима ответа в чате
  async startChatReply(ctx, data) {
    try {
      const orderId = data.split('_')[1];

      // включаем пользователя в режим чата для этого заказа
      ctx.session = ctx.session || {};
      ctx.session.chatMode = {
        orderId: orderId,
        active: true
      };

      // получаем заявку чтобы показать unique_id
      const order = await this.orderService.getOrderById(orderId);
      if (!order) {
        await ctx.reply('Операция не найдена');
        return;
      }

      const message = `
💬 <b>Ответ оператору</b>

🆔 Операция #${order.unique_id}

✍️ Напишите ваше сообщение оператору.
      `;

      await ctx.reply(message, {
        parse_mode: 'HTML'
      });

    } catch (error) {
      console.error('Error starting chat reply:', error);
      await ctx.reply('❌ Сбой во время запуске чата');
    }
  }

  // отмена режима чата
  async cancelChatMode(ctx) {
    try {
      ctx.session = ctx.session || {};
      ctx.session.chatMode = null;

      await ctx.reply('Чат завершен', this.getMainMenuInlineKeyboard(ctx.botConfig));

    } catch (error) {
      console.error('Error canceling chat mode:', error);
      await ctx.reply('❌ Сбой во время отмене чата');
    }
  }

  // начало чата с поддержкой (без привязки к заказу)
  async startSupportChat(ctx) {
    try {
      const SupportChat = require('../models/SupportChat');
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const botConfig = ctx.botConfig;

      // Получаем или создаем чат с поддержкой
      const chat = await SupportChat.getOrCreate(userId, botConfig.id);

      // Включаем режим чата поддержки и отключаем режим чата по заявке
      ctx.session = ctx.session || {};
      ctx.session.chatMode = null; // очищаем режим чата по заявке
      ctx.session.supportChatMode = {
        chatId: chat.id,
        active: true
      };

      const message = `
💬 <b>Чат с поддержкой</b>

✍️ Напишите ваше сообщение или отправьте изображение. Оператор ответит вам в ближайшее время.
      `;

      await ctx.reply(message, {
        parse_mode: 'HTML'
      });

      // answerCbQuery только если это callback query
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
      }

    } catch (error) {
      console.error('Error starting support chat:', error);
      await ctx.reply('❌ Сбой во время запуске чата с поддержкой');
      
      // answerCbQuery только если это callback query
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Ошибка');
      }
    }
  }

  // отмена чата с поддержкой
  async cancelSupportChatMode(ctx) {
    try {
      ctx.session = ctx.session || {};
      ctx.session.supportChatMode = null;
      ctx.session.chatMode = null; // очищаем и chatMode на всякий случай

      console.log('📨 [Support Chat] Support chat mode cancelled');

      await ctx.reply('Чат с поддержкой завершен', this.getMainMenuInlineKeyboard(ctx.botConfig));

    } catch (error) {
      console.error('Error canceling support chat mode:', error);
      await ctx.reply('❌ Сбой во время завершении чата');
    }
  }

  // отмена ответа на сообщение оператора
  async cancelSupportReply(ctx) {
    try {
      ctx.session = ctx.session || {};
      ctx.session.supportChatMode = null;
      ctx.session.chatMode = null;

      console.log('📨 [Support Chat] Support reply cancelled');

      await ctx.reply('❌ Действие прервано', this.getMainMenuInlineKeyboard(ctx.botConfig));

      await ctx.answerCbQuery('Действие прервано');

    } catch (error) {
      console.error('Error canceling support reply:', error);
      await ctx.reply('❌ Сбой во время отмене');
    }
  }

  // ответ на сообщение оператора в чате поддержки
  async replyToSupportChat(ctx, chatId) {
    try {
      const SupportChat = require('../models/SupportChat');
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const botConfig = ctx.botConfig;

      // Проверяем, что чат существует и принадлежит этому пользователю
      const chat = await SupportChat.findById(chatId);
      
      if (!chat || chat.user_id !== userId || chat.bot_id !== botConfig.id) {
        await ctx.answerCbQuery('❌ Чат не найден');
        return;
      }

      // Включаем режим чата поддержки и отключаем режим чата по заявке
      ctx.session = ctx.session || {};
      
      console.log('📨 [Support Chat] Before setting modes:', {
        chatMode: ctx.session.chatMode,
        supportChatMode: ctx.session.supportChatMode
      });
      
      ctx.session.chatMode = null; // очищаем режим чата по заявке
      ctx.session.supportChatMode = {
        chatId: chatId,
        active: true
      };
      
      console.log('📨 [Support Chat] After setting modes:', {
        chatMode: ctx.session.chatMode,
        supportChatMode: ctx.session.supportChatMode
      });

      const message = `
✍️ <b>Напишите ваш ответ оператору</b>

Ваше сообщение будет отправлено оператору.
      `;

      await ctx.reply(message, {
        parse_mode: 'HTML'
      });

      await ctx.answerCbQuery('✍️ Напишите ваш ответ');

    } catch (error) {
      console.error('Error replying to support chat:', error);
      await ctx.reply('❌ Сбой во время ответе на сообщение');
      await ctx.answerCbQuery('Ошибка');
    }
  }

  // обработка сообщения в чате поддержки
  async handleSupportChatMessage(ctx, message) {
    try {
      console.log('📨 [Support Chat] Handling support chat message:', message);
      const SupportChat = require('../models/SupportChat');
      const chatId = ctx.session.supportChatMode.chatId;
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;

      console.log('📨 [Support Chat] Chat ID:', chatId, 'User ID:', userId);

      // Сохраняем сообщение в базе данных
      const messageData = {
        senderType: 'USER',
        senderId: userId,
        message: message,
        attachmentsPath: null
      };

      const savedMessage = await SupportChat.addMessage(chatId, messageData);

      // Отправляем Socket.IO событие для админки
      if (global.io) {
        global.io.emit('support-chat:message', {
          chatId: chatId,
          message: savedMessage
        });
      }

      // Подтверждение пользователю и закрытие режима чата
      await ctx.reply('✅ Сообщение отправлено. Ожидайте ответа оператора.', {
        parse_mode: 'HTML'
      });

      // ВАЖНО: Сбрасываем supportChatMode - пользователь выходит из режима чата
      ctx.session.supportChatMode = null;
      console.log('📨 [Support Chat] Message saved, exiting support chat mode');

    } catch (error) {
      console.error('Error handling support chat message:', error);
      await ctx.reply('❌ Сбой во время отправке сообщения');
    }
  }

  async handleSupportChatPhoto(ctx) {
    try {
      console.log('📷 [Support Chat] Handling support chat photo');
      const SupportChat = require('../models/SupportChat');
      const fs = require('fs');
      const path = require('path');
      const chatId = ctx.session.supportChatMode.chatId;
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;

      // Получаем наибольшее фото (лучшее качество)
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;

      // Получаем ссылку на файл
      const file = await ctx.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.botConfig.token}/${file.file_path}`;

      // Скачиваем файл
      const axios = require('axios');
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      
      // Сохраняем файл
      const uploadDir = path.join(__dirname, '../../uploads/support-chats');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileName = `telegram-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.file_path)}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, response.data);

      const relativePath = `/uploads/support-chats/${fileName}`;

      // Сохраняем сообщение в базе данных
      const messageData = {
        senderType: 'USER',
        senderId: userId,
        message: '[Изображение]',
        attachmentsPath: JSON.stringify([relativePath])
      };

      const savedMessage = await SupportChat.addMessage(chatId, messageData);

      // Отправляем Socket.IO событие для админки
      if (global.io) {
        global.io.emit('support-chat:message', {
          chatId: chatId,
          message: savedMessage
        });
      }

      // Подтверждение пользователю и ЗАКЕМ режим чата
      await ctx.reply('✅ Изображение отправлено. Ожидайте ответа оператора.', {
        parse_mode: 'HTML'
      });

      // ВАЖНО: Сбрасываем supportChatMode - пользователь выходит из режима чата
      ctx.session.supportChatMode = null;
      console.log('📷 [Support Chat] Photo saved, exiting support chat mode');

    } catch (error) {
      console.error('Error handling support chat photo:', error);
      await ctx.reply('❌ Сбой во время отправке изображения');
    }
  }

  // обработка выбора реквизита из истории
  async handleRequisiteSelection(ctx, data) {
    try {
      const requisiteId = data.split('_')[2];
      const requisite = await Requisite.findById(requisiteId);

      if (!requisite) {
        await ctx.answerCbQuery('❌ Реквизит не найден');
        return;
      }

      const value = requisite.getDecryptedValue();

      // сохраняем выбранный реквизит в сессию
      ctx.session.operation.selectedRequisiteId = requisiteId;

      if (ctx.session.operation.type === 'BUY') {
        ctx.session.operation.address = value;
      } else {
        ctx.session.operation.cardInfo = value;
      }

      // пересоздаем сообщение с обновленной клавиатурой показывающей выбор
      await this.updateRequisiteSelectionMessage(ctx, requisiteId);

      await ctx.answerCbQuery('✔️ Реквизит выбран');

    } catch (error) {
      console.error('Error handling requisite selection:', error);
      await ctx.answerCbQuery('❌ Сбой во время выборе реквизита');
    }
  }

  // обновление сообщения выбора реквизита с галочкой и кнопкой продолжить
  async updateRequisiteSelectionMessage(ctx, selectedRequisiteId) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const kind = ctx.session.operation.type === 'BUY' ? ctx.session.operation.coin : 'CARD';

      // получаем платежные данные снова
      let userPastRequisites = [];
      try {
        userPastRequisites = await Requisite.getUserRequisitesByType(userId, kind, ctx.session.operation.type);

      } catch (error) {
        console.log("Ошибка получения реквизитов в updateRequisiteSelectionMessage:", error.message);
        // Fallback: если есть ошибка, попробуем получить все платежные данные пользователя
        try {
          const allRequisites = await Requisite.getUserRequisites(userId);
          userPastRequisites = allRequisites.filter(req => req.kind === kind).slice(0, 5);
          console.log("Fallback userPastRequisites:", userPastRequisites);
        } catch (fallbackError) {
          console.log("Fallback тоже не работает:", fallbackError.message);
          userPastRequisites = [];
        }
      }

      const keyboard = [];

      if (ctx.session.operation.type === 'BUY') {
        const coin = ctx.session.operation.coin;
        // Оставляем оригинальный текст сообщения
        let message = `Укажите ваш ${coin} адрес для получения:`;

        if (userPastRequisites.length > 0) {
          message += '\n\n📋 Или отметьте из последних ниже:';

          userPastRequisites.forEach((requisite) => {
            const address = requisite.getDecryptedValue();
            const shortAddress = address.length > 20
              ? `${address.substring(0, 10)}...${address.substring(address.length - 10)}`
              : address;

            const isSelected = requisite.id == selectedRequisiteId;
            const buttonText = isSelected ? `✔️ ${shortAddress}` : `${shortAddress}`;

            keyboard.push([
              Markup.button.callback(buttonText, `select_requisite_${requisite.id}`)
            ]);
          });
        }

        keyboard.push([
          Markup.button.callback('✅ Далее', 'continue_with_selected'),
          Markup.button.callback('↩️ Назад', 'back_to_amount_input')
        ]);

        await this.editMessageOrCaption(ctx, message, {
          ...Markup.inlineKeyboard(keyboard)
        });

      } else {
        // Оставляем оригинальный текст сообщения
        let message = 'Укажите номер карты или номер телефона для СБП:';

        message += '\n\nПримеры:';
        message += `\n1234567812345678`
        message += `\n+79123456789`
        message += `\n89123456789`

        if (userPastRequisites.length > 0) {
          message += '\n\n📋 Или отметьте из последних ниже:';

          userPastRequisites.forEach((requisite) => {
            const cardInfo = requisite.getDecryptedValue();
            const shortCard = cardInfo.length > 30
              ? `${cardInfo.substring(0, 30)}...`
              : cardInfo;

            const isSelected = requisite.id == selectedRequisiteId;
            const buttonText = isSelected ? `✔️ ${shortCard}` : `${shortCard}`;

            keyboard.push([
              Markup.button.callback(buttonText, `select_requisite_${requisite.id}`)
            ]);
          });
        }

        // добавляем кнопки продолжить и отмена
        keyboard.push([
          Markup.button.callback('✅ Далее', 'continue_with_selected'),
          Markup.button.callback('↩️ Назад', 'back_to_amount_input')
        ]);

        await this.editMessageOrCaption(ctx, message, {
          ...Markup.inlineKeyboard(keyboard)
        });

      }

    } catch (error) {
      console.error('Error updating requisite selection message:', error);
    }
  }

  // обработка сообщения в чате от пользователя к оператору
  async handleChatMessage(ctx, message) {
    try {
      const orderId = ctx.session.chatMode.orderId;

      // получаем детали заказа для отправки через сокет
      const order = await OrderService.getOrderById(orderId);

      // сохраняем сообщение в базу данных
      const messageData = await OrderService.sendOrderMessage(orderId, {
        senderId: ctx.from.id,
        senderType: 'USER',
        message: message
      });

      // отправляем событие сокета для нового сообщения
      const SocketService = require('../services/SocketService');
      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: parseInt(orderId),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        created_at: messageData.created_at,
        bot_id: order.bot_id,
        support_id: order.support_id
      });

      // НЕ закрываем чат - оставляем активным для продолжения переписки
      // ctx.session.chatMode = null; // убрали эту строку

    } catch (error) {
      console.error('Error handling chat message:', error);
      await ctx.reply('❌ Сбой во время отправке сообщения оператору');
    }
  }

  // обработка вложений в чате (фото/документы)
  async handleChatAttachment(ctx, attachmentType) {
    try {
      const orderId = ctx.session.chatMode.orderId;
      const fs = require('fs');
      const path = require('path');

      // создаем папку uploads/chats если не существует
      const uploadsDir = path.join(__dirname, '../../uploads/chats');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      let fileId, fileName, fileExtension;

      if (attachmentType === 'photo') {
        // для фото берем самое большое разрешение
        const photos = ctx.message.photo;
        const largestPhoto = photos[photos.length - 1];
        fileId = largestPhoto.file_id;
        fileName = `photo_${Date.now()}.jpg`;
        fileExtension = 'jpg';
      } else if (attachmentType === 'document') {
        const document = ctx.message.document;
        fileId = document.file_id;
        fileName = document.file_name || `document_${Date.now()}.pdf`;
        fileExtension = path.extname(fileName).substring(1) || 'pdf';
      }

      // получаем ссылку на файл от телеграм
      const fileInfo = await ctx.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.botConfig.token}/${fileInfo.file_path}`;

      // скачиваем файл
      const https = require('https');
      const http = require('http');
      const protocol = fileUrl.startsWith('https:') ? https : http;

      const uniqueFileName = `${orderId}_${Date.now()}_${fileName}`;
      const filePath = path.join(uploadsDir, uniqueFileName);

      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        const request = protocol.get(fileUrl, (response) => {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        });

        request.on('error', (err) => {
          fs.unlink(filePath, () => {}); // удаляем частично загруженный файл
          reject(err);
        });

        file.on('error', (err) => {
          fs.unlink(filePath, () => {}); // удаляем частично загруженный файл
          reject(err);
        });
      });

      // относительный путь для сохранения в БД
      const relativePath = `uploads/chats/${uniqueFileName}`;

      // получаем детали заказа для отправки через сокет
      const order = await OrderService.getOrderById(orderId);

      // отправляем сообщение с вложением в БД
      const messageText = attachmentType === 'photo' ? '📷 Фото' : '📎 Документ';
      const messageData = await OrderService.sendOrderMessage(orderId, {
        senderId: ctx.from.id,
        senderType: 'USER',
        message: messageText,
        attachments_path: relativePath
      });

      // отправляем событие сокета для нового сообщения с вложением
      const SocketService = require('../services/SocketService');
      SocketService.emitOrderMessage({
        id: messageData.id,
        order_id: parseInt(orderId),
        sender_type: messageData.sender_type,
        sender_id: messageData.sender_id,
        message: messageData.message,
        original_message: messageData.original_message,
        translated_message: messageData.translated_message,
        source_lang: messageData.source_lang,
        translated_at: messageData.translated_at,
        attachments_path: messageData.attachments_path,
        created_at: messageData.created_at,
        bot_id: order.bot_id,
        support_id: order.support_id
      });

      // Подтверждение не отправляем: пользователь остается в чате операции

    } catch (error) {
      console.error('Error handling chat attachment:', error);
      await ctx.reply('❌ Сбой во время отправке файла');
    }
  }

  // показ истории заказов с пагинацией
  async showOrderHistory(ctx, callbackData = null) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const botId = ctx.botConfig.id;

      // берем номер страницы из callback данных или по умолчанию 1
      let page = 1;
      if (callbackData && callbackData.startsWith('history_page_')) {
        page = parseInt(callbackData.split('_')[2]) || 1;
      }

      const limit = 10;
      const offset = (page - 1) * limit;

      // получаем заказы и данные для этого конкретного бота
      const orders = await this.orderService.getUserOrders(userId, { limit, offset, botId });
      const totalOrders = await this.orderService.getUserOrdersCount(userId, botId);
      const totalPages = Math.ceil(totalOrders / limit);

      if (!orders || orders.length === 0) {
        const message = `📜 <b>История операций</b>\n\nУ вас пока нет завершённых операций в этом боте.`;

        await ctx.editMessageCaption(message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('‹ В личный раздел', 'back_to_cabinet')]
          ])
        });
        return;
      }

      // создаем сообщение
      let message = `📜 <b>История завершённых операций</b>\n\n`;
      message += `Страница ${page} из ${totalPages} (всего ${totalOrders})\n\n`;

      // создаем клавиатуру с кнопками заказов
      const keyboard = [];

      for (const order of orders) {
        // форматируем дату как dd.mm.yy
        const date = new Date(order.created_at);
        const formattedDate = date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        });

        const operation = order.dir === 'BUY' ? 'Покупка' : 'Продажа';
        const orderText = `#${order.unique_id} | ${formattedDate} | ${operation} | ${order.coin} | ${order.sum_rub.toLocaleString()} ₽`;

        keyboard.push([
          Markup.button.callback(orderText, `order_details_${order.id}`)
        ]);
      }

      // добавляем кнопки навигации
      const navButtons = [];
      if (page > 1) {
        navButtons.push(Markup.button.callback('←', `history_page_${page - 1}`));
      }
      if (page < totalPages) {
        navButtons.push(Markup.button.callback('➞', `history_page_${page + 1}`));
      }

      if (navButtons.length > 0) {
        keyboard.push(navButtons);
      }

      keyboard.push([Markup.button.callback('‹ В личный раздел', 'back_to_cabinet')]);

      await ctx.editMessageCaption(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      console.error('Error showing order history:', error);
      await ctx.reply('❌ Сбой во время загрузке истории операций');
    }
  }

  // показ детальной информации о заказе
  async showOrderDetails(ctx, callbackData) {

    try {
      const orderId = parseInt(callbackData.split('_')[2]);

      const order = await this.orderService.getOrderById(orderId);

      if (!order) {
        await ctx.answerCbQuery('❌ Операция не найдена');
        return;
      }

      const statusText = {
        'CREATED': '🆕 Создана',
        'AWAITING_CONFIRM': '⏳ Ожидает подтверждения',
        'QUEUED': '📋 В очереди',
        'PAYMENT_PENDING': '🔍 Ожидание платежа',
        'COMPLETED': '✅ Выполнена',
        'CANCELLED': '❌ Отменена'
      };

      let message = `📋 <b>Операция #${order.unique_id}</b>\n\n`;
      message += `💱 Операция: ${order.dir === 'BUY' ? 'Покупка' : 'Продажа'}\n`;
      message += `💰 Валюта: ${order.coin}\n`;
      message += `📊 Количество: ${order.amount_coin} ${order.coin}\n`;
      message += `💵 Сумма: ${order.sum_rub.toLocaleString()} ₽\n`;
      // message += `📊 Статус: ${statusText[order.status] || order.status}\n`;
      message += `📅 Создана: ${new Date(order.created_at).toLocaleString('ru-RU')}\n`;

      if (order.completed_at) {
        message += `✔️ Завершена: ${new Date(order.completed_at).toLocaleString('ru-RU')}\n`;
      }

      // добавляем кнопки действий на основе статуса заказа
      const keyboard = [];

      // поскольку мы показываем только завершенные заказы, никакие кнопки действий не нужны
      // просто показываем кнопку назад
      keyboard.push([
        Markup.button.callback('‹ К списку сделок', 'back_to_history')
      ]);

      await ctx.editMessageCaption(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      console.error('Error showing order details:', error);
      await ctx.answerCbQuery('❌ Сбой во время загрузке информации о заявке');
    }
  }

  // показ реквизитов пользователя с пагинацией
  async showUserRequisites(ctx, callbackData = null) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;

      // Parse page from callback data or default to 1
      let page = 1;
      if (callbackData && callbackData.startsWith('requisites_page_')) {
        page = parseInt(callbackData.split('_')[2]) || 1;
      }

      const limit = 5;
      const offset = (page - 1) * limit;

      // получаем платежные данные пользователя из базы данных
      const allRequisites = await Requisite.getUserRequisites(userId);
      const totalRequisites = allRequisites.length;
      const requisites = allRequisites.slice(offset, offset + limit);
      const totalPages = Math.ceil(totalRequisites / limit);

      if (!requisites || requisites.length === 0) {
        const message = `💳 <b>Мои платежные данные</b>\n\nУ вас пока нет сохранённых реквизитов.`;

        await ctx.editMessageCaption(message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('‹ В личный раздел', 'back_to_cabinet')]
          ])
        });
        return;
      }

      // Create message
      let message = `💳 <b>Мои платежные данные</b>\n\n`;
      message += `Страница ${page} из ${totalPages} (всего ${totalRequisites})\n\n`;

      // Create keyboard with requisite buttons
      const keyboard = [];

      for (const requisite of requisites) {
        const value = requisite.getDecryptedValue();
        let displayText = '';

        if (requisite.kind === 'CARD') {
          displayText = `💳 ${value.length > 30 ? value.substring(0, 30) + '...' : value}`;
        } else {
          // для криптоадресов
          displayText = `${requisite.kind} • ${value.length > 20 ? value.substring(0, 10) + '...' + value.substring(value.length - 6) : value}`;
        }

        keyboard.push([
          Markup.button.callback(displayText, `requisite_details_${requisite.id}`)
        ]);
      }

      // Add navigation buttons
      const navButtons = [];
      if (page > 1) {
        navButtons.push(Markup.button.callback('⬅️ Назад', `requisites_page_${page - 1}`));
      }
      if (page < totalPages) {
        navButtons.push(Markup.button.callback('Вперед', `requisites_page_${page + 1}`));
      }

      if (navButtons.length > 0) {
        keyboard.push(navButtons);
      }

      // добавляем кнопку создания
      keyboard.push([Markup.button.callback('➕ Добавить шаблон', 'create_requisite')]);
      keyboard.push([Markup.button.callback('‹ В личный раздел', 'back_to_cabinet')]);

      await ctx.editMessageCaption(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      console.error('Error showing user requisites:', error);
      await ctx.reply('❌ Сбой во время загрузке реквизитов');
    }
  }

  // показ детальной информации о реквизите
  async showRequisiteDetails(ctx, callbackData) {
    try {
      const requisiteId = parseInt(callbackData.split('_')[2]);
      const requisite = await Requisite.findById(requisiteId);

      if (!requisite) {
        await ctx.answerCbQuery('❌ Реквизит не найден');
        return;
      }

      // Verify that requisite belongs to current user
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;

      if (requisite.user_id !== userId) {
        await ctx.answerCbQuery('❌ Нет доступа к этому реквизиту');
        return;
      }

      const value = requisite.getDecryptedValue();
      const typeText = requisite.kind === 'CARD' ? 'Банковская карта' : `Криптовалюта ${requisite.kind}`;

      const operationType = requisite.transaction_type === 'BUY' ? 'Покупка' : 'Продажа';

      let message = `💳 <b>Детали реквизита</b>\n\n`;
      message += `📋 Тип: ${typeText}\n`;
      message += `📅 Добавлен: ${new Date(requisite.created_at).toLocaleDateString('ru-RU')}\n\n`;

      if (requisite.kind === 'CARD') {
        message += `💳 <b>Платежные данные:</b>\n<code>${value}</code>\n`;
      } else {
        message += `📮 <b>Адрес:</b>\n<code>${value}</code>\n`;
      }

      await ctx.editMessageCaption(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🗑 Удалить шаблон', `delete_requisite_${requisite.id}`),
            Markup.button.callback('‹ К списку шаблонов', 'back_to_requisites')
          ]
        ])
      });

    } catch (error) {
      console.error('Error showing requisite details:', error);
      await ctx.answerCbQuery('❌ Сбой во время загрузке информации о реквизите');
    }
  }

  // удаление реквизита пользователя
  async deleteRequisite(ctx, callbackData) {
    try {
      const requisiteId = parseInt(callbackData.split('_')[2]);
      const requisite = await Requisite.findById(requisiteId);

      if (!requisite) {
        await ctx.answerCbQuery('❌ Реквизит не найден');
        return;
      }

      // Verify that requisite belongs to current user
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;

      if (requisite.user_id !== userId) {
        await ctx.answerCbQuery('❌ Нет доступа к этому реквизиту');
        return;
      }

      await Requisite.softDelete(requisiteId);

      await ctx.answerCbQuery('✅ Реквизит удален');

      // возвращаемся к списку реквизитов
      await this.showUserRequisites(ctx);

    } catch (error) {
      console.error('Error deleting requisite:', error);
      await ctx.answerCbQuery('❌ Сбой во время удалении реквизита');
    }
  }

  // показ выбора типа реквизита для создания нового
  async showCreateRequisiteTypeSelection(ctx) {
    try {
      const message = `💳 <b>Создание нового реквизита</b>\n\nОтметьте тип реквизита:`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('₿ BTC', 'create_requisite_BTC'),
          Markup.button.callback('Ł LTC', 'create_requisite_LTC')
        ],
        [
          Markup.button.callback('🔒 XMR', 'create_requisite_XMR'),
          Markup.button.callback('💵 USDT', 'create_requisite_USDT')
        ],
        [
          Markup.button.callback('💳 Карта / СБП', 'create_requisite_CARD')
        ],
        [
          Markup.button.callback('‹ К шаблонам оплаты', 'back_to_requisites')
        ]
      ]);

      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          ...keyboard
        });
      } catch (editError) {
        // если редактирование не удается (например, у сообщения нет текста), отправляем новое сообщение
        console.log('Could not edit message, sending new one:', editError.message);
        await ctx.reply(message, {
          parse_mode: 'HTML',
          ...keyboard
        });
      }

    } catch (error) {
      console.error('Error showing create requisite type selection:', error);
      await ctx.reply('❌ Сбой во время отображении выбора типа реквизита');
    }
  }

  // обработка создания нового реквизита для конкретного типа
  async handleCreateRequisite(ctx, data) {
    try {
      const requisiteType = data.split('_')[2]; // BTC, LTC, XMR, USDT или CARD

      // устанавливаем данные сессии для создания реквизита
      ctx.session = ctx.session || {};
      ctx.session.createRequisite = {
        type: requisiteType,
        active: true
      };

      let message = '';
      let shouldSendPhoto = false;

      if (requisiteType === 'CARD') {
        message = `💳 <b>Создание карточного реквизита</b>\n\nУкажите номер карты или номер телефона для СБП:\n\nПримеры:\n<code>1234567890123456</code>\n<code>+79123456789</code>\n<code>89123456789</code>`;
        shouldSendPhoto = true;
      } else {
        const requisiteIcons = { BTC: '₿', LTC: 'Ł', XMR: '🔒', USDT: '💵' };
        const requisiteIcon = requisiteIcons[requisiteType] || '💰';
        message = `${requisiteIcon} <b>Создание ${requisiteType} адреса</b>\n\nУкажите ваш ${requisiteType} адрес:`;
      }

      // пробуем отправить с картинкой для карточного реквизита
      if (shouldSendPhoto) {
        try {
          const botId = ctx.botConfig.id;
          const templateName = 'enter_card';
          const cachedFileId = telegramImageCache.get(botId, templateName);

          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
          ]);

          if (cachedFileId) {
            await ctx.replyWithPhoto(cachedFileId, {
              caption: message,
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } else {
            const imagePath = await imageGenerator.generateEnterCardImage();
            const photoMessage = await ctx.replyWithPhoto(
              { source: imagePath },
              {
                caption: message,
                parse_mode: 'HTML',
                reply_markup: keyboard.reply_markup
              }
            );

            if (photoMessage.photo && photoMessage.photo.length > 0) {
              const fileId = photoMessage.photo[photoMessage.photo.length - 1].file_id;
              telegramImageCache.set(botId, templateName, fileId);
            }
          }
        } catch (error) {
          console.error('Error sending create requisite image:', error);
          await this.editMessageOrCaption(ctx, message, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
            ])
          });
        }
      } else {
        await this.editMessageOrCaption(ctx, message, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
          ])
        });
      }      // устанавливаем состояние ожидания для пошагового ввода
      if (requisiteType === 'CARD') {
        ctx.session.createRequisite.step = 'card_number';
      }
    } catch (error) {
      console.error('Error handling create requisite:', error);
      await ctx.reply('❌ Сбой во время созднии реквизита');
    }
  }

  // обработка ввода нового реквизита от пользователя
  async processNewRequisiteInput(ctx, inputText) {
    try {
      if (!ctx.session.createRequisite || !ctx.session.createRequisite.active) {
        return false; // не в режиме сздания реквизита
      }

      const user = await this.getOrCreateUser(ctx);
      const userId = user.id; // ID из таблицы user_bots
      const requisiteType = ctx.session.createRequisite.type;

      // обрабатываем пошаговый ввод карты
      if (requisiteType === 'CARD') {
        return await this.processCardRequisiteStep(ctx, inputText, userId);
      } else {
        // обрабатываем ввод криптоадреса
        return await this.processCryptoRequisiteInput(ctx, inputText, userId, requisiteType);
      }

    } catch (error) {
      console.error('Error processing new requisite input:', error);
      await ctx.reply('❌ Сбой во время сохранении реквизита');
      ctx.session.createRequisite = null;
      return true;
    }
  }

  // обработка пошагового ввода карточного реквизита
  async processCardRequisiteStep(ctx, inputText, userId) {
    const step = ctx.session.createRequisite.step || 'card_number';
    const input = inputText.trim();

    switch (step) {
      case 'card_number': {
        // валидация номера карты или телефона
        const cardPattern = /^\d{16}$/;
        const phonePatternWithPlus = /^\+7\d{10}$/;
        const phonePatternWithoutPlus = /^[78]\d{10}$/;

        if (!cardPattern.test(input) && !phonePatternWithPlus.test(input) && !phonePatternWithoutPlus.test(input)) {
          await ctx.reply('❌ Формат не подходит. Укажите:\n• Номер карты (16 цифр)\n• Номер телефона (+79123456789 или 89123456789)', {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
            ])
          });
          return true;
        }

        ctx.session.createRequisite.cardNumber = input;
        ctx.session.createRequisite.step = 'bank';

        const botId = ctx.botConfig.id;
        const templateName = 'enter_bank';
        const cachedFileId = telegramImageCache.get(botId, templateName);

        const caption = 'Укажите название банка:\n\nПример: Сбербанк, Тинькофф, ВТБ';
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
        ]);

        try {
          if (cachedFileId) {
            await ctx.replyWithPhoto(cachedFileId, {
              caption: caption,
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } else {
            const imagePath = await imageGenerator.generateEnterBankImage();
            const message = await ctx.replyWithPhoto(
              { source: imagePath },
              {
                caption: caption,
                parse_mode: 'HTML',
                reply_markup: keyboard.reply_markup
              }
            );

            if (message.photo && message.photo.length > 0) {
              const fileId = message.photo[message.photo.length - 1].file_id;
              telegramImageCache.set(botId, templateName, fileId);
            }
          }
        } catch (error) {
          console.error('Error sending enter bank image:', error);
          await ctx.reply(caption, keyboard);
        }
        return true;
      }

      case 'bank': {
        if (input.length < 2) {
          await ctx.reply('❌ Укажите корректное название банка.', {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
            ])
          });
          return true;
        }

        ctx.session.createRequisite.bank = input;
        ctx.session.createRequisite.step = 'fio';

        const botId = ctx.botConfig.id;
        const templateName = 'enter_fio';
        const cachedFileId = telegramImageCache.get(botId, templateName);

        const caption = 'Укажите ФИО получателя:\n\nПример: Иван Иванов';
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
        ]);

        try {
          if (cachedFileId) {
            await ctx.replyWithPhoto(cachedFileId, {
              caption: caption,
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } else {
            const imagePath = await imageGenerator.generateEnterFIOImage();
            const message = await ctx.replyWithPhoto(
              { source: imagePath },
              {
                caption: caption,
                parse_mode: 'HTML',
                reply_markup: keyboard.reply_markup
              }
            );

            if (message.photo && message.photo.length > 0) {
              const fileId = message.photo[message.photo.length - 1].file_id;
              telegramImageCache.set(botId, templateName, fileId);
            }
          }
        } catch (error) {
          console.error('Error sending enter FIO image:', error);
          await ctx.reply(caption, keyboard);
        }
        return true;
      }

      case 'fio': {
        const fioPattern = /^[\p{L}\s-]{2,}$/u;
        const words = input.split(' ').filter(word => word.length > 0);

        if (!fioPattern.test(input) || words.length < 2) {
          await ctx.reply('❌ Укажите корректное ФИО (минимум имя и фамилия).\n\nПример: Иван Иванов', {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
            ])
          });
          return true;
        }

        // объединяем все данные карты
        const cardInfo = `${ctx.session.createRequisite.cardNumber} ${ctx.session.createRequisite.bank} ${input}`;

        // проверяем не существует ли уже такой реквизит
        const existingRequisite = await Requisite.findByUserAndValue(userId, 'CARD', cardInfo);
        if (existingRequisite) {
          await ctx.reply('⚠️ Такой платежный шаблон уже есть в вашем списке!', {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('‹ К шаблонам оплаты', 'back_to_requisites')]
            ])
          });
          ctx.session.createRequisite = null;
          return true;
        }

        // создаем новый реквизит
        await Requisite.create({
          user_id: userId,
          bot_id: ctx.botConfig.id,
          kind: 'CARD',
          label: 'Банковская карта',
          value_cipher: cardInfo,
          transaction_type: 'SELL'
        });

        await ctx.reply(`✅ Платежный шаблон добавлен!\n\n💳 ${cardInfo}`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('‹ К шаблонам оплаты', 'back_to_requisites')]
          ])
        });

        ctx.session.createRequisite = null;
        return true;
      }
    }
  }

  // обработка ввода криптореквизита
  async processCryptoRequisiteInput(ctx, inputText, userId, requisiteType) {
    // валидация криптоадреса
    if (!validateWalletAddress(inputText.trim(), requisiteType)) {
      const errorMessage = getValidationErrorMessage(requisiteType);
      await ctx.reply(`${errorMessage}\n\nПовторите ввод:`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Отмена', 'back_to_requisites')]
        ])
      });
      return true;
    }

    // проверяем не существует ли уже такой реквизит у пользователя
    const existingRequisite = await Requisite.findByUserAndValue(userId, requisiteType, inputText.trim());
    if (existingRequisite) {
      await ctx.reply('⚠️ Такой платежный шаблон уже есть в вашем списке!', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('‹ К шаблонам оплаты', 'back_to_requisites')]
        ])
      });
      ctx.session.createRequisite = null;
      return true;
    }

    // создаем новый реквизит
    await Requisite.create({
      user_id: userId,
      bot_id: ctx.botConfig.id,
      kind: requisiteType,
      label: `${requisiteType} кошелёк`,
      value_cipher: inputText.trim(),
      transaction_type: 'BUY'
    });

    await ctx.reply(`✅ Платежный шаблон добавлен!\n\n₿ ${requisiteType}: ${inputText.trim()}`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('‹ К шаблонам оплаты', 'back_to_requisites')]
      ])
    });

    // очищаем сессию
    ctx.session.createRequisite = null;
    return true;
  }

  // показ информации о реферальной программе
  async showReferralProgram(ctx) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const userBotId = user.id;
      const botId = ctx.botConfig.id;

      // получаем статистику рефералов
      const UserBot = require('../models/UserBot');
      const ReferralService = require('../services/ReferralService');

      const referralStats = await UserBot.getReferralStats(userBotId, botId);

      // получаем информацию о текущем user-bot
      const currentLevel = user.referral_level || 'BASIC';

      // Получить реальный доступный баланс
      const ReferralWithdraw = require('../models/ReferralWithdraw');
      const bonusBalance = await ReferralWithdraw.getAvailableBalance(userBotId);

      // получаем информацию об уровне
      const levelInfo = ReferralService.getReferralLevelInfo(currentLevel);
      const nextLevel = ReferralService.getNextLevelRequirements(
        currentLevel,
        referralStats.referralsOrders, // Используем количество операций, а не пользователей
        referralStats.referralsSum
      );

      // проверяем что у пользователя есть реферальный код
      let referralCode = referralStats.referralCode;
      if (!referralCode) {
        referralCode = await UserBot.generateReferralCode(userBotId, botId);
      }

      // создаем реферальную ссылку
      const botUsername = await this.getBotUsername(ctx.botConfig.id);
      let referralLink;

      if (botUsername) {
        referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
      } else {
        // фоллбэк на идентификатор если API вызов не удался
        console.warn(`Failed to get username for bot ${ctx.botConfig.id}, using identifier fallback`);
        referralLink = `https://t.me/${ctx.botConfig.identifier}?start=${referralCode}`;
      }

      let message = `👥 <b>Реферальная программа</b>\n\n`;

      // Текущий уровень
      message += `📌 <b>Ваш уровень:</b> ${levelInfo.name}\n`;
      message += `💰 <b>Ваш процент:</b> ${(levelInfo.percentage * 100).toFixed(1)}%\n`;
      if (bonusBalance > 0) {
        message += `◼ <b>Накоплено бонусов:</b> ${bonusBalance.toLocaleString()} ₽\n`;
      }
      message += `\n`;

      message += `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${referralLink}</code>\n\n`;

      message += `📊 <b>Статистика:</b>\n`;
      message += `👥 Приглашено людей: ${referralStats.referralsCount}\n`;
      message += `📈 Операций рефералов: ${referralStats.referralsOrders}\n`;
      message += `💰 Оборот рефералов: ${referralStats.referralsSum.toLocaleString()} ₽\n\n`;

      // Уровни программы
      message += `📋 <b>Уровни программы:</b>\n`;
      for (const [key, config] of Object.entries(ReferralService.REFERRAL_LEVELS)) {
        const emoji = key === currentLevel ? '🔸' : '🔘';
        message += `${emoji} ${config.name}: ${(config.percentage * 100).toFixed(1)}%`;
        if (config.minOrders > 0 || config.minSum > 0) {
          message += ` (от ${config.minOrders} сделок, ${config.minSum.toLocaleString()} ₽)`;
        }
        message += `\n`;
      }

      if (referralStats.referralsCount > 0) {
        message += `\n<b>Ваши рефералы:</b>\n`;
        referralStats.referrals.slice(0, 5).forEach((referral, index) => {
          const joinDate = new Date(referral.created_at).toLocaleDateString('ru-RU');
          message += `${index + 1}. @${referral.username || 'Аноним'} - ${referral.orders_count} операций (${referral.total_sum.toLocaleString()} ₽) - ${joinDate}\n`;
        });

        if (referralStats.referralsCount > 5) {
          message += `... и ещё ${referralStats.referralsCount - 5} рефералов\n`;
        }
      }

      message += `\n<i>Приглашайте друзей и получайте бонусы с каждой их сделки!</i>`;

      const keyboard = [];

      // добавляем кнопку вывода только если есть бонусы
      if (bonusBalance > 0) {
        keyboard.push([Markup.button.callback('💰 Оформить вывод', 'withdraw_bonuses')]);
      }

      keyboard.push([Markup.button.callback('‹ В личный раздел', 'back_to_cabinet')]);

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      console.error('Error showing referral program:', error);
      await ctx.reply('❌ Сбой во время загрузке реферальной программы');
    }
  }

  // показ выбора валюты для вывода
  async showWithdrawalCurrencySelection(ctx) {
    try {
      const user = await this.getOrCreateUser(ctx);
      const bonusBalance = parseFloat(user.referral_bonus_balance) || 0;

      if (bonusBalance <= 0) {
        await ctx.answerCbQuery('❌ Недостаточно бонусов для вывода');
        return;
      }

      const message = `● <b>Вывод накопленных бонусов</b>\n\n◼ Доступно к выводу: ${bonusBalance.toLocaleString()} ₽\n\n▸ A3 / Укажите валюту вывода:`;

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('₿ BTC', 'withdraw_currency_BTC'),
            Markup.button.callback('Ł LTC', 'withdraw_currency_LTC')
          ],
          [
            Markup.button.callback('🔒 XMR', 'withdraw_currency_XMR')
          ],
          [
            Markup.button.callback('‹ Назад', 'referral_program')
          ]
        ])
      });

    } catch (error) {
      console.error('Error showing withdrawal currency selection:', error);
      await ctx.reply('❌ Сбой во время отображении выбора валюты');
    }
  }

  // обработка выбора валюты для вывода
  async handleWithdrawalCurrencySelection(ctx, data) {
    try {
      const currency = data.split('_')[2]; // BTC, LTC, XMR

      // устанавливаем данные сессии для вывода
      ctx.session = ctx.session || {};
      ctx.session.withdrawal = {
        currency: currency,
        active: true
      };

      const message = `<b>Вывод в ${currency}</b>\n\nУкажите ваш ${currency} адрес для получения средств:`;

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Отмена', 'withdraw_cancel')]
        ])
      });

    } catch (error) {
      console.error('Error handling withdrawal currency selection:', error);
      await ctx.reply('❌ Сбой во время выборе валюты');
    }
  }

  /**
   * Process withdrawal address input
   */
  async processWithdrawalAddressInput(ctx, address) {
    try {
      if (!ctx.session.withdrawal || !ctx.session.withdrawal.active) {
        return false; // не в режиме вывода
      }

      const currency = ctx.session.withdrawal.currency;
      const user = await this.getOrCreateUser(ctx);
      const bonusBalance = parseFloat(user.referral_bonus_balance) || 0;

      // валидация адреса кошелька
      const { validateWalletAddress } = require('../utils/walletValidator');
      if (!validateWalletAddress(address.trim(), currency)) {
        await ctx.reply(`❌ Формат не подходит ${currency} адреса. Проверьте адрес и попробуйте сна:`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✖️ Отмена', 'withdraw_cancel')]
          ])
        });
        return true;
      }

      // сораняем адрес в сессию
      ctx.session.withdrawal.address = address.trim();

      // показываем подтверждение
      const message = `✅ <b>Подтверждение вывода</b>\n\n💰 Сумма: ${bonusBalance.toLocaleString()} ₽\n💱 Валюта: ${currency}\n📮 Адрес: <code>${address}</code>\n\nПодтвердите операцию вывода:`;

      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Подтвердить вывод', 'withdraw_confirm'),
            Markup.button.callback('✖️ Отмена', 'withdraw_cancel')
          ]
        ])
      });

      return true;

    } catch (error) {
      console.error('Error processing withdrawal address input:', error);
      await ctx.reply('❌ Сбой во время обработке адреса');
      ctx.session.withdrawal = null;
      return true;
    }
  }

  // подтверждение вывода
  async confirmWithdrawal(ctx) {
    try {
      if (!ctx.session.withdrawal || !ctx.session.withdrawal.active) {
        await ctx.answerCbQuery('❌ Сессия истекла');
        return;
      }

      const user = await this.getOrCreateUser(ctx);
      const { currency, address } = ctx.session.withdrawal;

      // Получить доступный баланс
      const ReferralWithdraw = require('../models/ReferralWithdraw');
      const availableBalance = await ReferralWithdraw.getAvailableBalance(user.id);

      if (availableBalance <= 0) {
        await ctx.answerCbQuery('❌ Недостаточно бонусов для вывода');
        return;
      }

      // Получить текущий курс для расчета суммы в криптовалюте
      const Rate = require('../models/Rate');
      const rateData = await Rate.getByCoin(currency);
      if (!rateData) {
        await ctx.answerCbQuery('❌ Курс для данной валюты не найден');
        return;
      }
      const amountCrypto = availableBalance / rateData.rate_rub;

      // создать заявку на вывод
      const withdrawal = await ReferralWithdraw.create({
        userbot_id: user.id,
        amount_rub: availableBalance,
        amount_crypto: amountCrypto,
        currency: currency,
        wallet_address: address,
        status: 'CREATED'
      });

      const message = `✅ <b>Запрос на вывод создан!</b>\n\n💰 Сумма: ${availableBalance.toLocaleString()} ₽\n💱 Валюта: ${amountCrypto.toFixed(8)} ${currency}\n📮 Адрес: <code>${address}</code>\n🆔 Операция: #${withdrawal.id}\n\n⏳ Операция поступила в обработку. Обычно вывод занимает от 30 минут до 24 часов.`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 В личный раздел', 'back_to_cabinet')]
      ]);

      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          ...keyboard
        });
      } catch (editError) {
        console.log('Could not edit message, sending new one:', editError.message);
        await ctx.reply(message, {
          parse_mode: 'HTML',
          ...keyboard
        });
      }

      // очищаем сессию
      ctx.session.withdrawal = null;

      await ctx.answerCbQuery('✅ Запрос оформлен!');

    } catch (error) {
      console.error('Error confirming withdrawal:', error);
      await ctx.answerCbQuery('❌ Сбой во время создания запроса');
    }
  }

  // отмена вывода
  async cancelWithdrawal(ctx) {
    try {
      ctx.session.withdrawal = null;

      // возвращаемся в профиль
      await this.showCabinetInline(ctx);

      await ctx.answerCbQuery('❌ Вывод отменен');

    } catch (error) {
      console.error('Error canceling withdrawal:', error);
      await ctx.answerCbQuery('❌ Сбой во время отмене');
    }
  }

  // обработка кнопки "Оставить отзыв"
  async handleLeaveComment(ctx, data) {
    try {
      // парсим callback данные: leave_comment_orderId
      const orderId = parseInt(data.split('_')[2]);

      if (isNaN(orderId)) {
        await ctx.answerCbQuery('❌ Формат не подходит операции');
        return;
      }

      // Устанавливаем режим ожидания комментария
      ctx.session = ctx.session || {};
      ctx.session.waitingForReviewComment = {
        orderId: orderId,
        active: true
      };

      const message = `✍️ <b>Оставьте ваш отзыв</b>\n\nНапишите текст вашего отзыва о работе с нами:`;

      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✖️ Отмена', 'cancel_review_comment')]
        ])
      });

      await ctx.answerCbQuery();

    } catch (error) {
      console.error('Error handling leave comment:', error);
      await ctx.answerCbQuery('❌ Ошибка');
    }
  }

  // обработка текста комментария к отзыву
  async handleReviewCommentInput(ctx, comment) {
    try {
      if (!ctx.session.waitingForReviewComment || !ctx.session.waitingForReviewComment.active) {
        return;
      }

      const orderId = ctx.session.waitingForReviewComment.orderId;
      const Review = require('../models/Review');
      const Order = require('../models/Order');

      // Сохраняем комментарий в базу данных
      await Review.updateComment(orderId, comment);

      // Получаем информацию о заказе и отзыве
      const order = await Order.findById(orderId);
      const review = await Review.findByOrderId(orderId);

      // Обновляем сообщение в группе/канале отзывов
      if (ctx.botConfig && (ctx.botConfig.reviews_chat_id || ctx.botConfig.reviews_chat_link) && review.telegram_message_id) {
        try {
          // Используем reviews_chat_id если указан, иначе пробуем извлечь из ссылки
          let reviewsChatId = ctx.botConfig.reviews_chat_id;

          // Если chat_id не указан, пробуем получить из ссылки
          if (!reviewsChatId && ctx.botConfig.reviews_chat_link) {
            const chatLink = ctx.botConfig.reviews_chat_link;
            if (chatLink.includes('t.me/')) {
              const chatUsername = chatLink.split('t.me/')[1];
              if (chatUsername && !chatUsername.startsWith('joinchat/')) {
                reviewsChatId = `@${chatUsername}`;
              }
            }
          }

          if (reviewsChatId) {
            // Формируем звезды
            const rating = parseInt(review.user_raiting) || 0;
            const stars = '⭐️'.repeat(rating);
            
            // Формируем обновленное сообщение с комментарием
            const reviewMessage = `Операция: #${order.unique_id}\n\nОценка: ${stars}\nКомментарий: ${comment}`;

            // Редактируем сообщение в группе/канале
            await ctx.telegram.editMessageText(
              reviewsChatId,
              review.telegram_message_id,
              null,
              reviewMessage,
              { parse_mode: 'HTML' }
            );

            console.log(`✅ Review comment added to channel/group for order #${orderId}, chat_id: ${reviewsChatId}`);
          }
        } catch (error) {
          console.error('Error updating review in group:', error);
          // Не блокируем процесс если не удалось обновить в группе
        }
      }

      // Подтверждение пользователю
      await ctx.reply('✅ Спасибо за ваш отзыв! Он был опубликован в группе отзывов.');

      // Очищаем сессию
      ctx.session.waitingForReviewComment = null;

    } catch (error) {
      console.error('Error handling review comment input:', error);
      await ctx.reply('❌ Сбой во время сохранении отзыва');
      ctx.session.waitingForReviewComment = null;
    }
  }

  // обработка отправки оценки от пользователя
  async handleRatingSubmission(ctx, data) {
    try {
      // парсим callback данные: rate_orderId_rating
      const parts = data.split('_');
      const orderId = parseInt(parts[1]);
      const rating = parseInt(parts[2]);

      if (isNaN(orderId) || isNaN(rating) || rating < 1 || rating > 5) {
        await ctx.answerCbQuery('❌ Формат не подходит оценки');
        return;
      }

      // импортируем модель Review
      const Review = require('../models/Review');
      const Order = require('../models/Order');

      // обновляем существующий отзыв
      await Review.updateRating(orderId, rating);

      // Получаем информацию о заказе
      const order = await Order.findById(orderId);
      
      // Отправляем отзыв в группу/канал с отзывами
      if (ctx.botConfig && (ctx.botConfig.reviews_chat_id || ctx.botConfig.reviews_chat_link)) {
        try {
          // Используем reviews_chat_id если указан, иначе пробуем извлечь из ссылки
          let reviewsChatId = ctx.botConfig.reviews_chat_id;

          // Если chat_id не указан, пробуем получить из ссылки
          if (!reviewsChatId && ctx.botConfig.reviews_chat_link) {
            const chatLink = ctx.botConfig.reviews_chat_link;
            if (chatLink.includes('t.me/')) {
              const chatUsername = chatLink.split('t.me/')[1];
              if (chatUsername && !chatUsername.startsWith('joinchat/')) {
                reviewsChatId = `@${chatUsername}`;
              }
            }
          }

          if (reviewsChatId) {
            // Формируем звезды
            const stars = '⭐️'.repeat(rating);
            
            // Формируем сообщение
            const reviewMessage = `Операция: #${order.unique_id}\n\nОценка: ${stars}`;

            // Отправляем сообщение в группу/канал
            const sentMessage = await ctx.telegram.sendMessage(reviewsChatId, reviewMessage, {
              parse_mode: 'HTML'
            });

            // Сохраняем telegram_message_id для последующего редактирования
            await Review.updateTelegramMessageId(orderId, sentMessage.message_id);

            console.log(`✅ Review posted to channel/group for order #${orderId}, chat_id: ${reviewsChatId}, message_id: ${sentMessage.message_id}`);
          }
        } catch (error) {
          console.error('Error posting review to group:', error);
          console.error('Bot must be added as administrator to the channel/group');
          // Не блокируем процесс если не удалось отправить в группу
        }
      }

      // Создаем клавиатуру с кнопками
      const keyboard = [];
      
      // Добавляем кнопку "Оставить отзыв"
      keyboard.push([Markup.button.callback('✍️ Добавить отзыв', `leave_comment_${orderId}`)]);
      
      // Добавляем кнопку ссылки на группу если есть
      if (ctx.botConfig && ctx.botConfig.reviews_chat_link) {
        keyboard.push([Markup.button.url('📖 Канал рейтинга', ctx.botConfig.reviews_chat_link)]);
      }

      const thankYouKeyboard = Markup.inlineKeyboard(keyboard);

      try {
        await ctx.editMessageText(
          `✅ <b>Спасибо за оценку!</b>\n\nБудем рады вашему отзыву! Это поможет нам стать лучше!`,
          { 
            parse_mode: 'HTML',
            ...thankYouKeyboard
          }
        );
      } catch (editError) {
        console.log('Could not edit message, sending new one:', editError.message);
        await ctx.reply(
          `✅ <b>Спасибо за оценку!</b>\n\nБудем рады вашему отзыву! Это поможет нам стать лучше!`,
          { 
            parse_mode: 'HTML',
            ...thankYouKeyboard
          }
        );
      }

      await ctx.answerCbQuery('✅ Оценка сохранена!');

      console.log(`Rating ${rating} submitted for order ${orderId}`);

    } catch (error) {
      console.error('Error handling rating submission:', error);
      await ctx.answerCbQuery('❌ Сбой во время сохранении оценки');
      await ctx.reply('❌ Не удалось выполнить действие при сохранении оценки. Повторите чуть позже.');
    }
  }

  // показ опций редактирования заказа
  async showEditOrderOptions(ctx) {
    try {
      const message = `🔧 <b>Отметьте, что хотите изменить:</b>`;

      const keyboard = [];
      
      // Проверяем тип операции для показа соответствующих опций
      if (ctx.session && ctx.session.operation) {
        if (ctx.session.operation.type === 'BUY') {
          keyboard.push([Markup.button.callback('🗒 Адрес кошелька', 'edit_address')]);
        } else if (ctx.session.operation.type === 'SELL') {
          keyboard.push([Markup.button.callback('💳 Шаблоны оплаты', 'edit_requisites')]);
        }
      }
      
      keyboard.push([Markup.button.callback('💱 Сумма', 'edit_amount')]);
      keyboard.push([Markup.button.callback('◻ Валюта', 'edit_coin')]);
      keyboard.push([Markup.button.callback('↩️ Назад', 'back_to_order_summary')]);

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      console.error('Error showing edit order options:', error);
      await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
    }
  }

  // начало редактирования адреса
  async startEditAddress(ctx) {
    try {
      ctx.session = ctx.session || {};
      
      if (!ctx.session.operation || ctx.session.operation.type !== 'BUY') {
        await ctx.answerCbQuery('Ошибка: неверный тип операции');
        return;
      }

      const coin = ctx.session.operation.coin;
      const message = `🗒 Введие правильный ${coin} адрес:`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Назад', 'back_to_order_summary')]
      ]);

      await this.editMessageOrCaption(ctx, message, {
        parse_mode: 'HTML',
        ...keyboard
      });

      ctx.session.waitingFor = 'edit_address';

    } catch (error) {
      console.error('Error starting edit address:', error);
      await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
    }
  }

  // начало редактирования реквизитов для продажи
  async startEditRequisites(ctx) {
    try {
      ctx.session = ctx.session || {};
      
      if (!ctx.session.operation || ctx.session.operation.type !== 'SELL') {
        await ctx.answerCbQuery('Ошика: неверный тип операции');
        return;
      }

      // Переходим к вводу карты/телефона как в основном потоке продажи
      const user = await this.getOrCreateUser(ctx);
      const userId = user.base_user_id || user.user_id || user.id;
      const kind = 'CARD';
      
      let userPastRequisites = [];
      try {
        userPastRequisites = await Requisite.getUserRequisitesByType(userId, kind, ctx.session.operation.type);
      } catch (error) {
        console.log("Ошибка получения реквизитов:", error.message);
      }

      const keyboard = [];
      const botId = ctx.botConfig.id;
      const templateName = 'enter_card';
      const cachedFileId = telegramImageCache.get(botId, templateName);

      let caption = 'Укажите номер карты или номер телефона для СБП:';
      caption += '\n\nПримеры:';
      caption += `\n1234567812345678`
      caption += `\n+79123456789`
      caption += `\n89123456789`

      // добавляем кнопки старых реквизитов если есть
      if (userPastRequisites.length > 0) {
        caption += '\n\n📋 Или отметьте из последних ниже:';

        userPastRequisites.forEach((requisite, index) => {
          const cardInfo = requisite.getDecryptedValue();
          const shortCard = cardInfo.length > 30
            ? `${cardInfo.substring(0, 30)}...`
            : cardInfo;

          keyboard.push([
            Markup.button.callback(`${shortCard}`, `select_requisite_${requisite.id}`)
          ]);
        });
      }

      keyboard.push([Markup.button.callback('↩️ Назад', 'back_to_order_summary')]);

      const inlineKeyboard = Markup.inlineKeyboard(keyboard);
      ctx.session.waitingFor = 'sell_card_number';

      try {
        if (cachedFileId) {
          await ctx.replyWithPhoto(cachedFileId, {
            caption: caption,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard.reply_markup
          });
        } else {
          const imagePath = await imageGenerator.generateEnterCardImage();
          const message = await ctx.replyWithPhoto(
            { source: imagePath },
            {
              caption: caption,
              parse_mode: 'HTML',
              reply_markup: inlineKeyboard.reply_markup
            }
          );

          if (message.photo && message.photo.length > 0) {
            const fileId = message.photo[message.photo.length - 1].file_id;
            telegramImageCache.set(botId, templateName, fileId);
          }
        }
      } catch (error) {
        console.error('Error sending enter card image:', error);
        await ctx.reply(caption, inlineKeyboard);
      }

    } catch (error) {
      console.error('Error starting edit requisites:', error);
      await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
    }
  }

  // начало редактирования суммы
  async startEditAmount(ctx) {
    try {
      ctx.session = ctx.session || {};
      
      if (!ctx.session.operation) {
        await ctx.answerCbQuery('Ошибка: данные операции не найдены');
        return;
      }

      if (!ctx.session.operation.amountInputMode) {
        ctx.session.operation.amountInputMode = 'CRYPTO';
      }

      await this.showAmountInputStep(ctx, true, {
        waitingFor: 'edit_amount',
        backCallback: 'back_to_order_summary'
      });

    } catch (error) {
      console.error('Error starting edit amount:', error);
      await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
    }
  }

  // начало редактирования монеты (возврат к выбору монеты)
  async startEditCoin(ctx) {
    try {
      ctx.session = ctx.session || {};
      
      if (!ctx.session.operation) {
        await ctx.answerCbQuery('Ошибка: данные операции не найдены');
        return;
      }

      const operationType = ctx.session.operation.type;
      
      // очищаем данные операции кроме типа
      ctx.session.operation = {
        type: operationType
      };
      ctx.session.waitingFor = null;

      // возвращаем к выбору монеты в зависимости от типа операции
      if (operationType === 'BUY') {
        await this.startBuyFlow(ctx);
      } else {
        await this.startSellFlow(ctx);
      }

    } catch (error) {
      console.error('Error starting edit coin:', error);
      await ctx.answerCbQuery('Не удалось выполнить действие, попробуйте позже');
    }
  }

  // обработка ввода нового адреса
  async handleEditAddressInput(ctx, address) {
    try {
      ctx.session = ctx.session || {};
      await this.safeDeleteMessage(ctx, ctx.message?.message_id, ctx.chat?.id || null);

      const coin = ctx.session.operation?.coin;

      if (!coin) {
        await ctx.reply('❌ Ошибка: не выбрана валюта');
        ctx.session = {};
        return;
      }

      // валидируем адрес кошелька
      if (!validateWalletAddress(address, coin)) {
        const errorMessage = getValidationErrorMessage(coin);

        await ctx.reply(`${errorMessage}\n\nПовторите ввод:`,
          Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Назад', 'back_to_order_summary')]
          ])
        );
        return;
      }

      // обновляем адрес в сессии
      ctx.session.operation.address = address;
      ctx.session.waitingFor = null;

      // показываем обновленную сводку
      await this.showOrderSummary(ctx, true);

    } catch (error) {
      console.error('Error handling edit address input:', error);
      await ctx.reply('❌ Не удалось выполнить действие. Повторите чуть позже.');
    }
  }

  // обработка ввода новой суммы
  async handleEditAmountInput(ctx, text) {
    try {
      ctx.session = ctx.session || {};
      await this.safeDeleteMessage(ctx, ctx.message?.message_id, ctx.chat?.id || null);

      const normalizedText = String(text).replace(',', '.');
      const inputValue = parseFloat(normalizedText);

      if (isNaN(inputValue) || inputValue <= 0) {
        await this.replaceNavigationText(ctx, '❌ Укажите корректное количество', {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('↩️ Назад', 'back_to_order_summary')]
          ])
        });
        return;
      }

      const mode = (ctx.session.operation?.amountInputMode || 'CRYPTO').toUpperCase();

      let amountCoin = inputValue;
      if (mode === 'RUB') {
        if (inputValue < 1) {
          const keyboard = this.buildAmountInputKeyboard(ctx.session.operation, {
            backCallback: 'back_to_order_summary'
          });
          await this.replaceNavigationText(
            ctx,
            'ℹ️ Сейчас включен ввод в RUB.\n\nЗначение 0.001 трактуется как 0.001 ₽ и выходит за лимиты.\nПереключите на "↻ Режим: CRYPTO" и укажите 0.001 BTC.',
            keyboard
          );
          return;
        }

        try {
          amountCoin = await this.convertRubToCoin(ctx, inputValue);
          ctx.session.operation.inputRub = inputValue;
        } catch (convertError) {
          if (convertError?.code === 'AMOUNT_OUT_OF_RANGE') {
            console.warn('[RANGE_REJECT] edit amount rejected', {
              tg_id: ctx?.from?.id || null,
              mode,
              entered_value: inputValue,
              operation: ctx.session.operation,
              min_rub: convertError?.minAmountRub ?? null,
              max_rub: convertError?.maxAmountRub ?? null,
              min_coin: convertError?.minAmountCoin ?? null,
              max_coin: convertError?.maxAmountCoin ?? null,
              coin: convertError?.coin || ctx.session?.operation?.coin || null
            });

            const rangeMessage = this.buildAmountOutOfRangeMessage(
              convertError,
              ctx.session.operation,
              {
                includePrompt: true,
                enteredValue: inputValue
              }
            );
            const keyboard = this.buildAmountInputKeyboard(ctx.session.operation, {
              backCallback: 'back_to_order_summary'
            });
            await this.replaceNavigationText(ctx, rangeMessage, keyboard);
            return;
          }
          if (convertError?.code === 'INVALID_TIER_CONFIGURATION') {
            const configMessage = this.buildTierConfigurationMessage(convertError, ctx.session.operation, {
              includePrompt: true
            });
            const keyboard = this.buildAmountInputKeyboard(ctx.session.operation, {
              backCallback: 'back_to_order_summary'
            });
            await this.replaceNavigationText(ctx, configMessage, keyboard);
            return;
          }
          await this.replaceNavigationText(
            ctx,
            '❌ Не удалось рассчитать сумму в крипте, попробуйте другое значение.',
            {
              ...Markup.inlineKeyboard([
                [Markup.button.callback('↩️ Назад', 'back_to_order_summary')]
              ])
            }
          );
          return;
        }
      }

      // обновляем сумму в сессии
      ctx.session.operation.amount = amountCoin;
      ctx.session.waitingFor = null;

      // показываем обновленную сводку
      await this.showOrderSummary(ctx, true);

    } catch (error) {
      console.error('Error handling edit amount input:', error);
      await ctx.reply('❌ Не удалось выполнить действие. Повторите чуть позже.');
    }
  }

  async handleOrderCancellation(ctx) {
    try {
      ctx.session = ctx.session || {};

      const orderId = ctx.session.operation?.orderId || null;
      if (orderId) {
        try {
          await this.orderService.updateOrderStatus(orderId, 'CANCELLED');
          console.log(`Order ${orderId} cancelled by user`);
        } catch (dbError) {
          console.error('Error cancelling order in database:', dbError);
        }
      }

      this.resetSessionPreserveNavigation(ctx);
      await this.replaceNavigationText(
        ctx,
        '❌ Операция отменена',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🏠 Главное меню', 'main_menu_new_message')]
          ])
        }
      );
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Операция отменена');
      }

    } catch (error) {
      console.error('Error handling order cancellation:', error);
      await ctx.reply('❌ Не удалось выполнить действие при отмене операции. Повторите чуть позже.');
    }
  }

  // настройка Socket.IO слушателей для чатов поддержки
  setupSocketListeners() {
    if (!global.io) {
      console.warn('⚠️ Socket.IO not available, support chat notifications disabled');
      return;
    }

    console.log('✅ Socket.IO listeners for support chats configured');
  }

  // отправка сообщения пользователю от оператора в чате поддержки
  async sendSupportMessageToUser(chatId, message, senderName) {
    try {
      const db = require('../config/database').getConnection();
      
      const [chatInfo] = await db.execute(
        `SELECT sc.user_id, sc.bot_id, u.tg_id
         FROM support_chats sc
         LEFT JOIN users u ON sc.user_id = u.id
         WHERE sc.id = ?`,
        [chatId]
      );

      if (chatInfo.length === 0) {
        console.error('Support chat not found:', chatId);
        return false;
      }

      const { bot_id, tg_id } = chatInfo[0];
      
      // Находим бота
      const botInstance = this.bots.get(bot_id);
      if (!botInstance) {
        console.error('Bot not found for chat:', bot_id);
        return false;
      }

      // Отправляем сообщение пользователю без кнопок
      const operatorLabel = senderName ? `<b>${senderName}</b>` : '<b>Оператор</b>';
      await botInstance.bot.telegram.sendMessage(
        tg_id,
        `💬 ${operatorLabel}:\n\n${message}\n\n✍️ Просто ответьте сообщением в этот чат.`,
        {
          parse_mode: 'HTML'
        }
      );

      console.log(`✅ Sent operator message to user ${tg_id} in chat ${chatId}`);
      return true;
    } catch (error) {
      console.error('Error sending operator message to user:', error);
      return false;
    }
  }

  async sendSupportImageToUser(chatId, imagePath, senderName) {
    try {
      const db = require('../config/database').getConnection();
      const fs = require('fs');
      
      const [chatInfo] = await db.execute(
        `SELECT sc.user_id, sc.bot_id, u.tg_id
         FROM support_chats sc
         LEFT JOIN users u ON sc.user_id = u.id
         WHERE sc.id = ?`,
        [chatId]
      );

      if (chatInfo.length === 0) {
        console.error('Support chat not found:', chatId);
        return false;
      }

      const { bot_id, tg_id } = chatInfo[0];
      
      // Находим бота
      const botInstance = this.bots.get(bot_id);
      if (!botInstance) {
        console.error('Bot not found for chat:', bot_id);
        return false;
      }

      // Проверяем существование файла
      if (!fs.existsSync(imagePath)) {
        console.error('Image file not found:', imagePath);
        return false;
      }

      // Отправляем изображение пользователю без кнопок
      const operatorLabel = senderName ? `<b>${senderName}</b>` : '<b>Оператор</b>';
      await botInstance.bot.telegram.sendPhoto(
        tg_id,
        { source: imagePath },
        {
          caption: `💬 ${operatorLabel}\n\n✍️ Просто ответьте сообщением в этот чат.`,
          parse_mode: 'HTML'
        }
      );

      console.log(`✅ Sent operator image to user ${tg_id} in chat ${chatId}`);
      return true;
    } catch (error) {
      console.error('Error sending operator image to user:', error);
      return false;
    }
  }

  // перезагрузка ботов из базы данных
  async reloadBots() {
    console.log('🔄 Reloading bots from database...');
    await this.stopAll();
    await this.initialize();
  }
}

module.exports = MultiTelegramBotManager;

