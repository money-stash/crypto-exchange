const cron = require('node-cron');
const config = require('../config');
const RateService = require('../services/RateService');
const SupportService = require('../services/SupportService');
const Order = require('../models/Order');
const OperatorDebtService = require('../services/OperatorDebtService');
const { sendOrderCancelNotification } = require('../utils/botManager');

// глобальный реестр для отслеживания всех cron задач при перезагрузке модулей
if (!global.__cronJobsRegistry) {
  global.__cronJobsRegistry = [];
}

class CronJobs {
  constructor() {
    this.jobs = [];
    this.isStarted = false;
  }

  /**
   * запуск всех cron задач
   */
  start() {
    // останавливаем ВСЕ существующие задачи из глобального реестра (включая потерянные)
    if (global.__cronJobsRegistry.length > 0) {
      console.log('⚠️ Stopping all existing cron jobs from previous runs...');
      global.__cronJobsRegistry.forEach((job) => {
        try {
          job.stop();
        } catch (error) {
          // игнорируем ошибки при остановке старых задач
        }
      });
      global.__cronJobsRegistry = [];
    }
    
    // предотвращаем множественный запуск
    if (this.isStarted) {
      console.log('⚠️ Cron jobs already started, skipping...');
      return;
    }

    // обновление курсов каждые 5 минут
    const ratesCron = config?.cron?.rates || '*/5 * * * *';
    const ratesJob = cron.schedule(ratesCron, async () => {
      try {
        console.log('🔄 Updating exchange rates...');
        const result = await RateService.updateRates();
        console.log(`✅ Updated ${result.updated_count} rates`);
      } catch (error) {
        console.error('❌ Failed to update rates:', error.message);
      }
    }, {
      scheduled: false
    });

    // обновление рейтинга операторов каждый час
    const ratingsJob = cron.schedule('0 * * * *', async () => {
      try {
        console.log('📊 Updating support ratings...');
        const result = await SupportService.updateAllRatings();
        console.log(`✅ Updated ${result.updated_count} support ratings`);
      } catch (error) {
        console.error('❌ Failed to update support ratings:', error.message);
      }
    }, {
      scheduled: false
    });

    // автоотмена непринятых заявок (каждую минуту)
    const autoCancelTimeoutMinutes = 30;
    const autoCancelUnacceptedOrdersJob = cron.schedule('* * * * *', async () => {
      try {
        const cancelledOrders = await Order.autoCancelUnacceptedOrders(autoCancelTimeoutMinutes);

        if (!cancelledOrders.length) {
          return;
        }

        console.log(`⏱️ Auto-cancelled ${cancelledOrders.length} unaccepted orders (timeout: ${autoCancelTimeoutMinutes} min)`);

        for (const order of cancelledOrders) {
          try {
            await sendOrderCancelNotification(order.id, 'timeout');
          } catch (notifyError) {
            console.error(`❌ Failed to send auto-cancel notification for order ${order.id}:`, notifyError.message);
          }
        }
      } catch (error) {
        console.error('❌ Failed to auto-cancel unaccepted orders:', error.message);
      }
    }, {
      scheduled: false
    });

    const pendingUsdtPaymentsJob = cron.schedule('* * * * *', async () => {
      try {
        await OperatorDebtService.processOpenIntentsAutoMatch();
        await OperatorDebtService.processPendingPayments();
      } catch (error) {
        console.error('❌ Failed to process pending USDT payments:', error.message);
      }
    }, {
      scheduled: false
    });

    this.jobs.push(ratesJob, ratingsJob, autoCancelUnacceptedOrdersJob, pendingUsdtPaymentsJob);
    
    // добавляем в глобальный реестр чтобы предотвратить потерянные задачи
    global.__cronJobsRegistry.push(ratesJob, ratingsJob, autoCancelUnacceptedOrdersJob, pendingUsdtPaymentsJob);

    // запускаем все задачи
    this.jobs.forEach(job => job.start());
    
    this.isStarted = true;
    
    console.log('⏰ Cron jobs started:');
    console.log(`  - Exchange rates: ${ratesCron}`);
    console.log('  - Support ratings: every hour');
    console.log(`  - Auto-cancel unaccepted orders: every minute (${autoCancelTimeoutMinutes} min timeout)`);
    console.log('  - Pending USDT debt payments: every minute');
  }

  /**
   * остановка всех cron задач
   */
  stop() {
    this.jobs.forEach((job) => {
      try {
        job.stop();
      } catch (error) {
        console.error('Error stopping job:', error.message);
      }
    });
    this.jobs = [];
    this.isStarted = false;
    console.log('⏰ All cron jobs stopped');
  }
}

const instance = new CronJobs();
module.exports = instance;
