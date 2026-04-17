const { Bot, BotRequisite } = require('../models/Bot');
const Fee = require('../models/Fee');
const OrderService = require('../services/OrderService');
const SocketService = require('../services/SocketService');
const { logUserAction } = require('../utils/logger');


let botManager = null;

class BotController {
  // установка менеджера ботов
  setBotManager(manager) {
    botManager = manager;
  }
  // получить всех ботов
  async getBots(req, res) {
    const filters = req.query;
    let result;

    if (req.user.role === 'EX_ADMIN') {
      filters.owner_id = req.user.id;
    }

    result = await Bot.getAll(filters);

    if (Array.isArray(result)) {
      res.json({ data: result });
    } else {
      res.json({ data: result });
    }
  }

  // получить одного бота с реквизитами
  async getBot(req, res) {
    const { id } = req.params;
    const bot = await Bot.getBotWithRequisites(parseInt(id));

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json(bot);
  }

  // создать бота
  async createBot(req, res) {
    try {
      console.log('Creating bot with data:', req.body);
      const { name, identifier, token, description, exchange_chat_link, reviews_chat_link, reviews_chat_id, is_active } = req.body;
      const owner_id = req.user.id;

      if (!name || !identifier || !token) {
        console.log('Missing required fields:', { name: !!name, identifier: !!identifier, token: !!token });
        return res.status(400).json({ error: 'Name, identifier and token are required' });
      }

      console.log('Checking if identifier exists:', identifier);

      const existingBot = await Bot.findByIdentifier(identifier);
      if (existingBot) {
        console.log('Bot identifier already exists:', identifier);
        return res.status(400).json({ error: 'Bot identifier already exists' });
      }

      console.log('Checking if token exists:', token.substring(0, 10) + '...');

      const existingToken = await Bot.findByToken(token);
      if (existingToken) {
        console.log('Bot token already exists');
        return res.status(400).json({ error: 'Bot token already exists' });
      }

      const bot = await Bot.create({
        name,
        identifier,
        token,
        description,
        exchange_chat_link,
        reviews_chat_link,
        reviews_chat_id,
        is_active,
        owner_id
      });

      // стартуем бота
      if (is_active && botManager) {
        try {
          await botManager.startBot(bot.id);
          console.log(`Auto-started bot ${bot.name} (ID: ${bot.id})`);
        } catch (error) {
          console.error(`Failed to auto-start bot ${bot.id}:`, error);
        }
      }

      // создаем дефолтные комиссии
      try {
        await Fee.createDefaultForBot(bot.id);
        console.log(`Created default fees for bot ${bot.id}`);
      } catch (error) {
        console.error(`Failed to create default fees for bot ${bot.id}:`, error);
      }

      await logUserAction(req.user.id, 'bot_created', {
        bot_id: bot.id,
        identifier: bot.identifier
      });

      res.status(201).json(bot);
    } catch (error) {
      console.error('Error creating bot:', error);
      res.status(500).json({ error: 'Failed to create bot' });
    }
  }

  //обновить бота
  async updateBot(req, res) {
    try {
      console.log('Updating bot with ID:', req.params.id, 'Data:', req.body);
      const { id } = req.params;
      const updateData = req.body;

      const bot = await Bot.findById(parseInt(id));
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }

      if (updateData.identifier && updateData.identifier !== bot.identifier) {
        const existingBot = await Bot.findByIdentifier(updateData.identifier);
        if (existingBot) {
          return res.status(400).json({ error: 'Bot identifier already exists' });
        }
      }

      if (updateData.token && updateData.token !== bot.token) {
        const existingToken = await Bot.findByToken(updateData.token);
        if (existingToken) {
          return res.status(400).json({ error: 'Bot token already exists' });
        }
      }

      const updatedBot = await Bot.update(parseInt(id), updateData);

      if (botManager) {
        try {
          const hasIsActiveInPayload = Object.prototype.hasOwnProperty.call(updateData, 'is_active');
          const wasActive = Boolean(bot.is_active);
          const willBeActive = hasIsActiveInPayload ? Boolean(updateData.is_active) : wasActive;

          if (!wasActive && willBeActive) {
            await botManager.startBot(updatedBot.id);
            console.log(`Auto-started bot ${updatedBot.name} (ID: ${updatedBot.id}) after activation`);
          } else if (wasActive && !willBeActive) {
            await botManager.stopBot(updatedBot.id);
            console.log(`Auto-stopped bot ${updatedBot.name} (ID: ${updatedBot.id}) after deactivation`);
          } else if (wasActive && willBeActive) {
            await botManager.restartBot(updatedBot.id);
            console.log(`Auto-restarted bot ${updatedBot.name} (ID: ${updatedBot.id}) after config update`);
          }
        } catch (error) {
          console.error(`Failed to apply runtime bot update for ${updatedBot.id}:`, error);
        }
      }

      await logUserAction(req.user.id, 'bot_updated', {
        bot_id: updatedBot.id,
        changes: Object.keys(updateData)
      });

      res.json(updatedBot);
    } catch (error) {
      console.error('Error updating bot:', error);
      res.status(500).json({ error: 'Failed to update bot' });
    }
  }

  // переключить статус бота
  async toggleBotStatus(req, res) {
    const { id } = req.params;

    const bot = await Bot.findById(parseInt(id));
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const updatedBot = await Bot.toggleActive(parseInt(id));

    await logUserAction(req.user.id, 'bot_status_toggled', {
      bot_id: updatedBot.id,
      new_status: updatedBot.is_active
    });

    res.json(updatedBot);
  }

  // удалить бота
  async deleteBot(req, res) {
    const { id } = req.params;

    const bot = await Bot.findById(parseInt(id));
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const deleted = await Bot.delete(parseInt(id));
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete bot' });
    }

    await logUserAction(req.user.id, 'bot_deleted', {
      bot_id: parseInt(id),
      identifier: bot.identifier
    });

    res.json({ message: 'Bot deleted successfully' });
  }

  // получить статистику бота
  async getBotStatistics(req, res) {
    const { id } = req.params;

    const bot = await Bot.findById(parseInt(id));
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const stats = await Bot.getStatistics(parseInt(id));
    res.json(stats);
  }

  // создать реквизит бота
  async createBotRequisite(req, res) {
    try {
      console.log('Creating bot requisite for bot ID:', req.params.id, 'Data:', req.body);
      const { id } = req.params;
      const { type, label, address, bank_name, holder_name, is_active, is_default, support_id, order_id } = req.body;

      const bot = await Bot.findById(parseInt(id));
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }

      const requisite = await BotRequisite.create({
        bot_id: parseInt(id),
        type,
        label,
        address,
        bank_name,
        holder_name,
        is_active,
        is_default,
        support_id
      });

      // если передан order_id, назначаем реквизит заявке
      if (order_id) {
        const requisiteData = {
          card_number: type === 'CARD' ? address : null,
          card_holder: (type === 'CARD' || type === 'SBP') ? holder_name : null,
          bank_name: (type === 'CARD' || type === 'SBP') ? bank_name : null,
          crypto_address: !['CARD', 'SBP'].includes(type) ? address : null,
          sbp_phone: type === 'SBP' ? address : null,
          req_id: requisite.id,
          label: label || null
        };

        const actorSupportId = Number(req.user?.id || support_id || 0) || null;
        const setResult = await OrderService.setOrderRequisites(
          order_id,
          requisiteData,
          actorSupportId,
          req.user?.role,
          {
            can_edit_requisites: req.user?.can_edit_requisites
          }
        );

        if (!setResult?.success) {
          // If we couldn't assign/send requisites to order, rollback created bot requisite to avoid orphan records.
          try {
            await BotRequisite.delete(requisite.id);
          } catch (rollbackError) {
            console.warn(`Failed to rollback created requisite #${requisite.id}: ${rollbackError.message}`);
          }
          return res.status(setResult?.statusCode || 400).json({ error: setResult?.message || 'Failed to set order requisites' });
        }

        try {
          const updatedOrder = await OrderService.getOrderDetails(order_id);
          if (updatedOrder) {
            SocketService.emitOrderUpdated(updatedOrder);
          }
        } catch (socketError) {
          console.warn(`Failed to emit order update for order #${order_id}: ${socketError.message}`);
        }
      }

      await logUserAction(req.user.id, 'bot_requisite_created', {
        bot_id: parseInt(id),
        requisite_type: type,
        order_id: order_id || null,
        data: req.body
      });

      res.status(201).json(requisite);
    } catch (error) {
      console.error('Error creating bot requisite:', error);
      res.status(500).json({ error: 'Failed to create bot requisite' });
    }
  }

  // обновить реквизит бота
  async updateBotRequisite(req, res) {
    try {
      console.log('Updating bot requisite:', req.params, 'Data:', req.body);
      const { id, requisiteId } = req.params;
      const updateData = req.body;

      const requisite = await BotRequisite.findById(parseInt(requisiteId));
      if (!requisite || requisite.bot_id !== parseInt(id)) {
        return res.status(404).json({ error: 'Requisite not found' });
      }

      const updatedRequisite = await BotRequisite.update(parseInt(requisiteId), updateData);

      await logUserAction(req.user.id, 'bot_requisite_updated', {
        bot_id: parseInt(id),
        requisite_id: parseInt(requisiteId)
      });

      res.json(updatedRequisite);
    } catch (error) {
      console.error('Error updating bot requisite:', error);
      res.status(500).json({ error: 'Failed to update bot requisite' });
    }
  }

  // удалить реквизит бота
  async deleteBotRequisite(req, res) {
    const { id, requisiteId } = req.params;

    const requisite = await BotRequisite.findById(parseInt(requisiteId));
    if (!requisite || requisite.bot_id !== parseInt(id)) {
      return res.status(404).json({ error: 'Requisite not found' });
    }

    const deleted = await BotRequisite.delete(parseInt(requisiteId));
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete requisite' });
    }

    await logUserAction(req.user.id, 'bot_requisite_deleted', {
      bot_id: parseInt(id),
      requisite_id: parseInt(requisiteId)
    });

    res.json({ message: 'Requisite deleted successfully' });
  }

  // старт бота
  async startBot(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const userId = req.user.id;

      if (!botManager) {
        return res.status(500).json({ error: 'Менеджер ботов не инициализирован' });
      }

      const result = await botManager.startBot(botId);
      if (result.success) {
        await logUserAction(userId, 'bot_start', `Запущен бот ID: ${botId}`);
        res.json({ message: 'Бот успешно запущен' });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error starting bot:', error);
      res.status(500).json({ error: 'Ошибка при запуске бота' });
    }
  }

  // стоп бота
  async stopBot(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const userId = req.user.id;

      if (!botManager) {
        return res.status(500).json({ error: 'Менеджер ботов не инициализирован' });
      }

      const result = await botManager.stopBot(botId);
      if (result.success) {
        await logUserAction(userId, 'bot_stop', `Остановлен бот ID: ${botId}`);
        res.json({ message: 'Бот успешно остановлен' });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error stopping bot:', error);
      res.status(500).json({ error: 'Ошибка при остановке бота' });
    }
  }

  async restartBot(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const userId = req.user.id;

      if (!botManager) {
        return res.status(500).json({ error: 'Менеджер ботов не инициализирован' });
      }

      const result = await botManager.restartBot(botId);
      if (result.success) {
        await logUserAction(userId, 'bot_restart', `Перезапущен бот ID: ${botId}`);
        res.json({ message: 'Бот успешно перезапущен' });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error('Error restarting bot:', error);
      res.status(500).json({ error: 'Ошибка при перезапуске бота' });
    }
  }

  // получить статус бота
  async getBotStatus(req, res) {
    try {
      const botId = parseInt(req.params.id);

      if (!botManager) {
        return res.status(500).json({ error: 'Менеджер ботов не инициализирован' });
      }

      const status = await botManager.getBotStatus(botId);
      res.json(status);
    } catch (error) {
      console.error('Error getting bot status:', error);
      res.status(500).json({ error: 'Ошибка при получении статуса бота' });
    }
  }

// получить упрощенный список ботов
  async getSimpleBots(req, res) {
    try {
      const bots = await Bot.getAll();

      const simpleBots = bots.map(bot => ({
        id: bot.id,
        name: bot.name,
        is_active: bot.is_active
      }));

      res.json(simpleBots);
    } catch (error) {
      console.error('Error getting simple bots:', error);
      res.status(500).json({ error: 'Ошибка при получении списка ботов' });
    }
  }

  // получить комиссии бота
  async getBotFees(req, res) {
    try {
      const botId = parseInt(req.params.id);

      await Fee.ensureBotFees(botId);

      const fees = await Fee.getByBotId(botId);
      res.json(fees);
    } catch (error) {
      console.error('Error getting bot fees:', error);
      res.status(500).json({ error: 'Ошибка при получении комиссий бота' });
    }
  }

  // обновить комиссии бота
  async updateBotFees(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const { fees } = req.body;

      if (!Array.isArray(fees)) {
        return res.status(400).json({ error: 'Fees должен быть массивом' });
      }

      await Fee.updateByBotId(botId, fees);

      await logUserAction(req.user.id, 'update_bot_fees', {
        bot_id: botId,
        fees_count: fees.length
      });

      res.json({ success: true, message: 'Комиссии бота обновлены' });
    } catch (error) {
      console.error('Error updating bot fees:', error);
      res.status(500).json({ error: 'Ошибка при обновлении комиссий бота' });
    }
  }

  // получить диапазоны комиссий бота
  async getBotFeeTiers(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const { coin } = req.query;

      let tiers;
      if (coin) {
        tiers = await Fee.getFeeTiers(botId, coin);
      } else {
        tiers = await Fee.getAllFeeTiers(botId);
      }

      res.json(tiers);
    } catch (error) {
      console.error('Error getting bot fee tiers:', error);
      res.status(500).json({ error: 'Ошибка при получении диапазонов комиссий' });
    }
  }

  async createOrUpdateFeeTier(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const tierData = { ...req.body, bot_id: botId };

      if (typeof tierData.min_amount === 'string') {
        tierData.min_amount = parseFloat(tierData.min_amount);
      }
      if (typeof tierData.max_amount === 'string') {
        tierData.max_amount = parseFloat(tierData.max_amount);
      }


      const { min_amount, max_amount, buy_fee, sell_fee, coin } = tierData;



      if (!coin || typeof min_amount !== 'number' || min_amount < 0) {
        return res.status(400).json({
          error: 'Некорректные данные: coin и min_amount обязательны'
        });
      }

      if (max_amount !== null && max_amount <= min_amount) {
        return res.status(400).json({
          error: 'Максимальная сумма должна быть больше минимальной'
        });
      }

      const existingTiers = await Fee.getFeeTiers(botId, coin);
      const allTiers = [...existingTiers];

      if (tierData.id) {
        const index = allTiers.findIndex(t => t.id === tierData.id);
        if (index !== -1) {
          allTiers[index] = tierData;
        }
      } else {
        allTiers.push(tierData);
      }

      const validation = await Fee.validateFeeTiers(botId, coin, allTiers);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Ошибка валидации диапазонов: ' + validation.errors.join('; ')
        });
      }

      const tierId = await Fee.createOrUpdateFeeTier(tierData);

      await logUserAction(req.user.id, 'fee_tier_updated', {
        bot_id: botId,
        tier_id: tierId,
        coin: coin
      });

      res.json({ id: tierId, success: true, message: 'Диапазон комиссий сохранен' });
    } catch (error) {
      console.error('Error creating/updating fee tier:', error);
      res.status(500).json({ error: 'Ошибка при сохранении диапазона комиссий' });
    }
  }

  // удалить диапазон комиссий
  async deleteFeeTier(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const tierId = parseInt(req.params.tierId);

      const success = await Fee.deleteFeeTier(tierId);

      if (!success) {
        return res.status(404).json({ error: 'Диапазон комиссий не найден' });
      }

      await logUserAction(req.user.id, 'fee_tier_deleted', {
        bot_id: botId,
        tier_id: tierId
      });

      res.json({ success: true, message: 'Диапазон комиссий удален' });
    } catch (error) {
      console.error('Error deleting fee tier:', error);
      res.status(500).json({ error: 'Ошибка при удалении диапазона комиссий' });
    }
  }

  // массовое обновление диапазонов комиссий
  async bulkUpdateFeeTiers(req, res) {
    try {
      const botId = parseInt(req.params.id);
      const { coin, tiers } = req.body;

      if (!coin || !Array.isArray(tiers)) {
        return res.status(400).json({
          error: 'Некорректные данные: coin и tiers (массив) обязательны'
        });
      }

      const normalizedTiers = tiers.map(tier => ({
        ...tier,
        bot_id: botId,
        coin: coin,
        min_amount: typeof tier.min_amount === 'string' ? parseFloat(tier.min_amount) : tier.min_amount,
        max_amount: tier.max_amount === null || tier.max_amount === '' ? null : 
                   (typeof tier.max_amount === 'string' ? parseFloat(tier.max_amount) : tier.max_amount),
        buy_fee: typeof tier.buy_fee === 'string' ? parseFloat(tier.buy_fee) : tier.buy_fee,
        sell_fee: typeof tier.sell_fee === 'string' ? parseFloat(tier.sell_fee) : tier.sell_fee
      }));

      for (const tier of normalizedTiers) {
        const { min_amount, max_amount, buy_fee, sell_fee } = tier;
        
        if (typeof min_amount !== 'number' || min_amount < 0) {
          return res.status(400).json({
            error: 'Некорректные данные: min_amount должен быть неотрицательным числом'
          });
        }

        if (max_amount !== null && max_amount <= min_amount) {
          return res.status(400).json({
            error: 'Максимальная сумма должна быть больше минимальной'
          });
        }

      }

      const validation = await Fee.validateFeeTiers(botId, coin, normalizedTiers);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Ошибка валидации диапазонов: ' + validation.errors.join('; ')
        });
      }

      const result = await Fee.replaceFeeTiersForCoin(botId, coin, normalizedTiers);

      await logUserAction(req.user.id, 'bulk_update_fee_tiers', {
        bot_id: botId,
        coin: coin,
        tiers_count: normalizedTiers.length
      });

      res.json({ 
        success: true, 
        message: `Сохранено ${normalizedTiers.length} диапазонов для ${coin}`,
        tiers: result 
      });
    } catch (error) {
      console.error('Error bulk updating fee tiers:', error);
      res.status(500).json({ error: 'Ошибка при сохранении диапазонов комиссий' });
    }
  }

  // получить статистику менеджера
  async getManagerStats(req, res) {
    try {
      if (req.user.role !== 'MANAGER' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }

      const stats = await Bot.getManagerStats();
      res.json(stats);
    } catch (error) {
      console.error('Get manager stats error:', error);
      res.status(500).json({ error: 'Ошибка при получении статистики менеджера' });
    }
  }
}

module.exports = new BotController();
