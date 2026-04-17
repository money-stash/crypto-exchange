const ReferralWithdraw = require('../models/ReferralWithdraw');
const { getConnection } = require('../config/database');
const { getBotManager } = require('../utils/botManager');

class ReferralWithdrawController {
  
  // получить выводы с фильтрацией и пагинацией
  async getWithdrawals(req, res) {
    try {
      const { page = 1, limit = 20, status = null, search = null } = req.query;

      if (req.user.role !== 'EX_ADMIN' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Недостаточно прав доступа' });
      }

      let botId = null;
      
      // для EX_ADMIN показываем только выводы из его ботов
      if (req.user.role === 'EX_ADMIN') {
        const db = getConnection();
        const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
        if (botResult.length === 0) {
          // если у EX_ADMIN нет ботов, возвращаем пустой результат
          return res.json({
            success: true,
            data: {
              withdrawals: [],
              pagination: { page: 1, limit, total: 0, pages: 0 },
              stats: {
                total_requests: 0,
                pending_requests: 0,
                completed_requests: 0,
                cancelled_requests: 0,
                total_paid_amount: 0,
                pending_amount: 0
              }
            }
          });
        }
        botId = botResult[0].id;
      }

      const filteredStatus = status === 'all' ? null : status;

      const result = await ReferralWithdraw.getWithdrawals({
        page: parseInt(page),
        limit: parseInt(limit),
        status: filteredStatus,
        botId,
        search
      });

      // получить статистику
      const db = getConnection();
      let statsQuery = `
        SELECT 
          COUNT(*) as total_requests,
          COUNT(CASE WHEN rw.status = 'CREATED' THEN 1 END) as pending_requests,
          COUNT(CASE WHEN rw.status = 'COMPLETED' THEN 1 END) as completed_requests,
          COUNT(CASE WHEN rw.status = 'CANCELLED' THEN 1 END) as cancelled_requests,
          COALESCE(SUM(CASE WHEN rw.status = 'COMPLETED' THEN rw.amount_rub ELSE 0 END), 0) as total_paid_amount,
          COALESCE(SUM(CASE WHEN rw.status = 'CREATED' THEN rw.amount_rub ELSE 0 END), 0) as pending_amount
        FROM referrals_withdraw rw
        JOIN user_bots ub ON rw.userbot_id = ub.id
      `;
      
      let statsParams = [];
      if (botId) {
        statsQuery += ' WHERE ub.bot_id = ?';
        statsParams.push(botId);
      }

      const [statsRows] = await db.execute(statsQuery, statsParams);
      const stats = statsRows[0];

      res.json({
        success: true,
        data: {
          withdrawals: result.withdrawals,
          pagination: result.pagination,
          stats: {
            total_requests: parseInt(stats.total_requests),
            pending_requests: parseInt(stats.pending_requests),
            completed_requests: parseInt(stats.completed_requests),
            cancelled_requests: parseInt(stats.cancelled_requests),
            total_paid_amount: parseFloat(stats.total_paid_amount),
            pending_amount: parseFloat(stats.pending_amount)
          }
        }
      });

    } catch (error) {
      console.error('Error getting referral withdrawals:', error);
      res.status(500).json({ error: 'Сбой во время получении операций на вывод' });
    }
  }

  // получить заявку на вывод по ID
  async getWithdrawalById(req, res) {
    try {
      const { id } = req.params;

      if (req.user.role !== 'EX_ADMIN' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Недостаточно прав доступа' });
      }

      const withdrawal = await ReferralWithdraw.findById(id);
      if (!withdrawal) {
        return res.status(404).json({ error: 'Операция не найдена' });
      }

      // Для EX_ADMIN проверяем, что операция относится к его боту
      if (req.user.role === 'EX_ADMIN') {
        const db = getConnection();
        const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
        if (botResult.length === 0) {
          return res.status(404).json({ error: 'Бот не найден' });
        }
        
        const [checkResult] = await db.execute(`
          SELECT 1 FROM referrals_withdraw rw
          JOIN user_bots ub ON rw.userbot_id = ub.id
          WHERE rw.id = ? AND ub.bot_id = ?
        `, [id, botResult[0].id]);
        
        if (checkResult.length === 0) {
          return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
      }

      res.json({
        success: true,
        data: withdrawal
      });

    } catch (error) {
      console.error('Error getting withdrawal by ID:', error);
      res.status(500).json({ error: 'Сбой во время получении операции' });
    }
  }

  // подтверждение вывода
  async completeWithdrawal(req, res) {
    try {
      const { id } = req.params;

      if (req.user.role !== 'EX_ADMIN' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Недостаточно прав доступа' });
      }

      const withdrawal = await ReferralWithdraw.findById(id);
      if (!withdrawal) {
        return res.status(404).json({ error: 'Операция не найдена' });
      }

      if (withdrawal.status !== 'CREATED') {
        return res.status(400).json({ error: 'Операция уже обработана' });
      }

      if (req.user.role === 'EX_ADMIN') {
        const db = getConnection();
        const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
        if (botResult.length === 0) {
          return res.status(404).json({ error: 'Бот не найден' });
        }
        
        const [checkResult] = await db.execute(`
          SELECT 1 FROM referrals_withdraw rw
          JOIN user_bots ub ON rw.userbot_id = ub.id
          WHERE rw.id = ? AND ub.bot_id = ?
        `, [id, botResult[0].id]);
        
        if (checkResult.length === 0) {
          return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
      }

      const success = await ReferralWithdraw.updateStatus(id, 'COMPLETED');
      if (!success) {
        return res.status(500).json({ error: 'Сбой во время обновлении статуса' });
      }

      try {
        const botManager = getBotManager();
        if (botManager && withdrawal.tg_id) {
          const db = getConnection();
          const [botResult] = await db.execute(`
            SELECT b.id as bot_id FROM user_bots ub 
            JOIN bots b ON ub.bot_id = b.id 
            WHERE ub.id = ?
          `, [withdrawal.userbot_id]);
          
          const botId = botResult.length > 0 ? botResult[0].bot_id : null;
          
          if (botId) {
            const botData = botManager.bots.get(botId);
            if (botData && botData.bot) {
              const message = `✅ <b>Запрос на вывод реферальных бонусов завершена</b>\n\n` +
                `💰 <b>Сумма:</b> ${withdrawal.amount_rub.toLocaleString('ru-RU')} ₽\n` +
                `🪙 <b>Криптовалюта:</b> ${withdrawal.amount_crypto} ${withdrawal.currency}\n\n` +
                `Средства должны поступить на ваш кошелек в течение нескольких минут.`;

              await botData.bot.telegram.sendMessage(withdrawal.tg_id, message, {
                parse_mode: 'HTML'
              });
            }
          }
        }
      } catch (telegramError) {
        console.error('Error sending Telegram notification:', telegramError);
      }

      res.json({
        success: true,
        message: 'Операция успешно завершена'
      });

    } catch (error) {
      console.error('Error completing withdrawal:', error);
      res.status(500).json({ error: 'Сбой во время завершении операции' });
    }
  }

  // отмена вывода
  async cancelWithdrawal(req, res) {
    try {
      const { id } = req.params;

      // Проверяем роль
      if (req.user.role !== 'EX_ADMIN' && req.user.role !== 'SUPERADMIN') {
        return res.status(403).json({ error: 'Недостаточно прав доступа' });
      }

      const withdrawal = await ReferralWithdraw.findById(id);
      if (!withdrawal) {
        return res.status(404).json({ error: 'Операция не найдена' });
      }

      if (withdrawal.status !== 'CREATED') {
        return res.status(400).json({ error: 'Операция уже обработана' });
      }

      if (req.user.role === 'EX_ADMIN') {
        const db = getConnection();
        const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
        if (botResult.length === 0) {
          return res.status(404).json({ error: 'Бот не найден' });
        }
        
        const [checkResult] = await db.execute(`
          SELECT 1 FROM referrals_withdraw rw
          JOIN user_bots ub ON rw.userbot_id = ub.id
          WHERE rw.id = ? AND ub.bot_id = ?
        `, [id, botResult[0].id]);
        
        if (checkResult.length === 0) {
          return res.status(403).json({ error: 'Нет доступа к этой заявке' });
        }
      }

      const success = await ReferralWithdraw.updateStatus(id, 'CANCELLED');
      if (!success) {
        return res.status(500).json({ error: 'Сбой во время обновлении статуса' });
      }

      // отправляем уведомление в Telegram
      try {
        const botManager = getBotManager();
        if (botManager && withdrawal.tg_id) {
          const db = getConnection();
          const [botResult] = await db.execute(`
            SELECT b.id as bot_id FROM user_bots ub 
            JOIN bots b ON ub.bot_id = b.id 
            WHERE ub.id = ?
          `, [withdrawal.userbot_id]);
          
          const botId = botResult.length > 0 ? botResult[0].bot_id : null;
          
          if (botId) {
            const botData = botManager.bots.get(botId);
            if (botData && botData.bot) {
              const message = `❌ <b>Запрос на вывод реферальных бонусов отменена</b>\n\n` +
                `💰 <b>Сумма:</b> ${withdrawal.amount_rub.toLocaleString('ru-RU')} ₽\n` +
                `🪙 <b>Криптовалюта:</b> ${withdrawal.amount_crypto} ${withdrawal.currency}\n\n` +
                `Средства возвращены на ваш реферальный баланс.`;

              await botData.bot.telegram.sendMessage(withdrawal.tg_id, message, {
                parse_mode: 'HTML'
              });
            }
          }
        }
      } catch (telegramError) {
        console.error('Error sending Telegram notification:', telegramError);
      }

      res.json({
        success: true,
        message: 'Операция отменена'
      });

    } catch (error) {
      console.error('Error cancelling withdrawal:', error);
      res.status(500).json({ error: 'Сбой во время отмене операции' });
    }
  }
}

module.exports = new ReferralWithdrawController();