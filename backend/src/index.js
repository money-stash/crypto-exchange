const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { initDatabase } = require('./config/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const config = require('./config');

// routes
const authRoutes = require('./routes/auth');
const rateRoutes = require('./routes/rates');
const feeRoutes = require('./routes/fees');
const orderRoutes = require('./routes/orders');
const dealRoutes = require('./routes/deals');
const botRoutes = require('./routes/bots');
const userRoutes = require('./routes/users');
const supportRoutes = require('./routes/supports');
const supportChatRoutes = require('./routes/support-chats');
const operatorManagerChatRoutes = require('./routes/operator-manager-chats');
const mailingRoutes = require('./routes/mailings');
const uploadRoutes = require('./routes/uploads');
const settingsRoutes = require('./routes/settings');
const auditLogRoutes = require('./routes/audit-logs');

// services
const CronJobs = require('./services/CronJobs');
const MultiTelegramBotManager = require('./bot/MultiTelegramBotManager');
const MailingService = require('./services/MailingService');
const { setBotManager } = require('./utils/botManager');

// модели для инициализации
const Fee = require('./models/Fee');
const Rate = require('./models/Rate');

class Application {
  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = null;
    this.bot = null;
    this.setupSocketIO();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupSocketIO() {
    this.io = new Server(this.httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? [process.env.FRONTEND_URL] 
          : [
              'http://localhost:3000', 
              'http://127.0.0.1:3000',
              'http://localhost:5173', 
              'http://127.0.0.1:5173', 
              'http://localhost:5174',
              'http://192.168.0.235:5174'
            ],
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling']
    });

    const jwt = require('jsonwebtoken');
    const config = require('./config');

    // Сохраняем io в app для доступа из контроллеров
    this.app.set('io', this.io);

    this.io.on('connection', (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      socket.on('authenticate', async (data) => {
        try {
          const token = typeof data === 'string' ? data : data.token;
          const decoded = jwt.verify(token, config.jwt.secret);
          socket.userId = decoded.id;
          socket.userRole = decoded.role;
          
          console.log(`🔌 User authenticated: ${socket.userId}, role: ${socket.userRole}`);

          socket.join(`role:${socket.userRole}`);
          

          socket.join(`user:${socket.userId}`);

          if (socket.userRole === 'EX_ADMIN') {
            const { Bot } = require('./models/Bot');
            const botIds = await Bot.getBotIdsByOwner(socket.userId);
            botIds.forEach(botId => {
              socket.join(`bot:${botId}`);
              console.log(`🔌 User ${socket.userId} joined bot room: bot:${botId}`);
            });
          }

          if (socket.userRole === 'OPERATOR') {
            socket.join('operators');
          }

          socket.emit('authenticated', { success: true });
        } catch (error) {
          console.error('🔌 Authentication error:', error.message);
          socket.emit('authenticated', {
            success: false,
            error: 'Invalid token',
            code: 'AUTH_TOKEN_INVALID'
          });
        }
      });

      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
      });
    });


    global.io = this.io;
  }

  setupMiddleware() {
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? [process.env.FRONTEND_URL] 
        : [
            'http://localhost:3000', 
            'http://127.0.0.1:3000',
            'http://localhost:5173', 
            'http://127.0.0.1:5173', 
            'http://localhost:5174',
            'http://192.168.0.235:5174'
          ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv
      });
    });

    this.app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/rates', rateRoutes);
    this.app.use('/api/fees', feeRoutes);
    this.app.use('/api/orders', orderRoutes);
    this.app.use('/api/deals', dealRoutes);
    this.app.use('/api/bots', botRoutes);
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/supports', supportRoutes);
    this.app.use('/api/support-chats', supportChatRoutes);
    this.app.use('/api/operator-manager-chats', operatorManagerChatRoutes);
    this.app.use('/api/mailings', mailingRoutes);
    this.app.use('/api/uploads', uploadRoutes);
    this.app.use('/api/settings', settingsRoutes);
    this.app.use('/api/audit-logs', auditLogRoutes);
    
    const referralWithdrawRoutes = require('./routes/referralWithdrawals');
    this.app.use('/api/referral-withdrawals', referralWithdrawRoutes);

    this.app.get('/', (req, res) => {
      res.json({
        name: 'Exchange MVP API',
        version: '1.0.0',
        status: 'Running',
        docs: '/api-docs'
      });
    });
  }

  setupErrorHandling() {
    this.app.use(notFoundHandler);
    
    this.app.use(errorHandler);
  }

  async initialize() {
    try {
      console.log('🚀 Initializing Exchange MVP...');

      // создаем необходимые папки
      const fs = require('fs');
      const uploadsDir = path.join(__dirname, '../uploads');
      const chatsDir = path.join(uploadsDir, 'chats');
      
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      if (!fs.existsSync(chatsDir)) {
        fs.mkdirSync(chatsDir, { recursive: true });
        console.log('📁 Created uploads/chats directory');
      }

      await initDatabase();

      await Rate.initializeDefaults();

      this.botManager = new MultiTelegramBotManager();
      setBotManager(this.botManager);
      await this.botManager.initialize();

      const botController = require('./controllers/BotController');
      botController.setBotManager(this.botManager);

      CronJobs.start();

      console.log('📧 Starting active mailings...');
      await MailingService.startAllActiveMailings();

      console.log('✅ Application initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      throw error;
    }
  }

  async start() {
    await this.initialize();

    this.httpServer.listen(config.port, () => {
      console.log(`🌐 Server running on port ${config.port}`);
      console.log(`📋 Environment: ${config.nodeEnv}`);
      console.log(`🔗 API URL: http://localhost:${config.port}`);
      console.log(`🔌 WebSocket server initialized`);
    });

    const gracefulShutdown = (signal) => {
      console.log(`\n📡 Received ${signal}. Shutting down gracefully...`);
      
      this.httpServer.close(async () => {
        console.log('🌐 HTTP server closed');
        
        if (this.io) {
          this.io.close();
          console.log('🔌 WebSocket server closed');
        }
        
        CronJobs.stop();
        
        if (this.botManager) {
          await this.botManager.stopAll();
        }
        
        console.log('👋 Application shutdown complete');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return this.httpServer;
  }
}

if (require.main === module) {
  const app = new Application();
  app.start().catch(error => {
    console.error('💥 Failed to start application:', error);
    process.exit(1);
  });
}

module.exports = Application;
