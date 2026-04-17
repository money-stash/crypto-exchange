import { io } from 'socket.io-client';
import { triggerAuthLogout } from '../utils/authSession';

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.isAuthenticated = false;
  }

  connect() {
    if (this.socket?.connected) {
      console.log('🔌 Socket already connected');
      return;
    }

    const SOCKET_URL = process.env.NODE_ENV === 'production' 
      ? window.location.origin  
      : 'http://localhost:8080'; 

    console.log('🔌 Connecting to socket server:', SOCKET_URL);

    this.socket = io(SOCKET_URL, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
      timeout: 30000,
      autoConnect: true,
      withCredentials: false,
      forceNew: false,
      closeOnBeforeunload: false,
    });

    this.setupEventHandlers();
  }

  /**
   * авторизуемся на сервере используя JWT токен
   */
  authenticate() {
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('🔌 No token found, skipping authentication');
      return;
    }

    console.log('🔌 Sending authentication token');
    this.socket.emit('authenticate', { token });
  }

  /**
   * настраиваем обработчики событий по дефолту
   */
  setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('🔌 Socket connected:', this.socket.id);
      this.reconnectAttempts = 0;
      this.authenticate();
    });

    this.socket.on('authenticated', (data) => {
      if (data.success) {
        console.log('🔌 Authenticated successfully');
        this.isAuthenticated = true;
      } else {
        console.error('🔌 Authentication failed:', data.error);
        this.isAuthenticated = false;
        triggerAuthLogout();
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.isAuthenticated = false;
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      console.error('🔌 Socket connection error:', error.message);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('🔌 Max reconnection attempts reached');
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔌 Socket reconnected after', attemptNumber, 'attempts');
      this.reconnectAttempts = 0;
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('🔌 Reconnection attempt:', attemptNumber);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('🔌 Socket reconnection failed');
    });

    // настраиваем слушатели событий заказов
    this.setupOrderEvents();
  }

  /**
   * настраиваем слушатели для событий заказов
   */
  setupOrderEvents() {
    console.log('🔌 Setting up order event listeners');
    
    this.socket.on('order:created', (order) => {
      console.log('📦 [Socket] Order created event received:', order);
      const listenersCount = this.listeners.get('order:created')?.size || 0;
      console.log('📦 [Socket] Notifying', listenersCount, 'listeners for order:created');
      this.notifyListeners('order:created', order);
    });

    this.socket.on('order:updated', (order) => {
      console.log('📦 [Socket] Order updated event received:', order);
      const listenersCount = this.listeners.get('order:updated')?.size || 0;
      console.log('📦 [Socket] Notifying', listenersCount, 'listeners for order:updated');
      this.notifyListeners('order:updated', order);
    });

    this.socket.on('order:status-changed', (data) => {
      console.log('📦 [Socket] Order status changed event received:', data);
      this.notifyListeners('order:status-changed', data);
    });

    this.socket.on('order:taken', (data) => {
      console.log('📦 [Socket] Order taken event received:', data);
      const listenersCount = this.listeners.get('order:taken')?.size || 0;
      console.log('📦 [Socket] Notifying', listenersCount, 'listeners for order:taken');
      this.notifyListeners('order:taken', data);
    });

    this.socket.on('order:deleted', (data) => {
      console.log('📦 [Socket] Order deleted event received:', data);
      this.notifyListeners('order:deleted', data);
    });

    this.socket.on('order:message', (data) => {
      console.log('💬 [Socket] Order message event received:', data);
      console.log('💬 [Socket] sender_type:', data.sender_type, 'order_id:', data.order_id, 'type:', typeof data.order_id);
      this.notifyListeners('order:message', data);
      
      // определяем отправлено или получено по sender_type
      // сообщения OPERATOR - отправлены мной (оператором), USER - получены от юзера
      if (data.sender_type === 'OPERATOR') {
        console.log('💬 [Socket] Emitting message:sent for order:', data.order_id);
        this.notifyListeners('message:sent', {
          orderId: data.order_id,
          message: data
        });
      } else {
        // сообщение от USER - получено от юзера
        console.log('💬 [Socket] Emitting message:received for order:', data.order_id);
        this.notifyListeners('message:received', {
          orderId: data.order_id,
          message: data
        });
      }
    });

    this.socket.on('user:payment-confirmation', (data) => {
      console.log('💳 [Socket] User payment confirmation event received:', data);
      const listenersCount = this.listeners.get('user:payment-confirmation')?.size || 0;
      console.log('💳 [Socket] Notifying', listenersCount, 'listeners for user:payment-confirmation');
      this.notifyListeners('user:payment-confirmation', data);
    });

    // Поддержка событий чата поддержки
    this.socket.on('support-chat:message', (data) => {
      console.log('💬 [Socket] Support chat message event received:', data);
      const listenersCount = this.listeners.get('support-chat:message')?.size || 0;
      console.log('💬 [Socket] Notifying', listenersCount, 'listeners for support-chat:message');
      this.notifyListeners('support-chat:message', data);

      // Эмитим локальные message:sent/message:received для совместимости с UI
      if (data?.message?.sender_type === 'OPERATOR') {
        this.notifyListeners('message:sent', { chatId: data.chatId, message: data.message });
      } else {
        this.notifyListeners('message:received', { chatId: data.chatId, message: data.message });
      }
    });

    this.socket.on('support-chat:read', (data) => {
      console.log('📖 [Socket] Support chat read event received:', data);
      this.notifyListeners('support-chat:read', data);
    });

    this.socket.on('support-chat:typing', (data) => {
      console.log('⌨️ [Socket] Support chat typing event received:', data);
      this.notifyListeners('support-chat:typing', data);
    });

    this.socket.on('support-chat:deleted', (data) => {
      console.log('🗑️ [Socket] Support chat deleted event received:', data);
      this.notifyListeners('support-chat:deleted', data);
    });

    this.socket.on('operator-manager-chat:message', (data) => {
      console.log('[Socket] Operator-manager chat message event received:', data);
      this.notifyListeners('operator-manager-chat:message', data);
    });

    this.socket.on('operator-manager-chat:read', (data) => {
      console.log('[Socket] Operator-manager chat read event received:', data);
      this.notifyListeners('operator-manager-chat:read', data);
    });

    this.socket.on('operator-manager-chat:assignment-updated', (data) => {
      console.log('[Socket] Operator-manager chat assignment event received:', data);
      this.notifyListeners('operator-manager-chat:assignment-updated', data);
    });
  }

  /**
   * получаем текущий ID юзера из localStorage
   * @returns {number|null}
   */
  getCurrentUserId() {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.id;
      }
    } catch (error) {
      console.error('Error getting current user ID:', error);
    }
    return null;
  }

  /**
   * подписываемся на событие
   * @param {string} event - название события
   * @param {Function} callback - функция колбека
   * @returns {Function} функция отписки
   */
  on(event, callback) {
    console.log('🔌 Subscribing to event:', event);
    
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    this.listeners.get(event).add(callback);
    console.log('🔌 Total listeners for', event, ':', this.listeners.get(event).size);

    // возвращаем функцию отписки
    return () => {
      console.log('🔌 Unsubscribing from event:', event);
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
        if (eventListeners.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  /**
   * отписываемся от события
   * @param {string} event - название события
   * @param {Function} callback - функция колбека
   */
  off(event, callback) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * уведомляем всех слушателей события
   * @param {string} event - название события
   * @param {*} data - данные события
   */
  notifyListeners(event, data) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in socket listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * отключаемся от WebSocket сервера
   */
  disconnect() {
    if (this.socket) {
      console.log('🔌 Disconnecting socket');
      this.socket.disconnect();
      this.socket = null;
      this.listeners.clear();
    }
  }

  /**
   * проверяем подключен ли сокет
   * @returns {boolean}
   */
  isConnected() {
    return this.socket?.connected || false;
  }

  /**
   * получаем ID сокета
   * @returns {string|null}
   */
  getSocketId() {
    return this.socket?.id || null;
  }
}

// экспортируем синглтон
const socketService = new SocketService();
export default socketService;



