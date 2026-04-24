import axios from 'axios';
import { isAuthFailureResponse, triggerAuthLogout } from '../utils/authSession';

const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:8080/api');

// создаем axios инстанс
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// добавляем токен авторизации к запросам
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// обрабатываем ошибки авторизации
api.interceptors.response.use(
  (response) => {
    // Проверяем данные в интерцепторе
    return response;
  },
  (error) => {
    const requestUrl = error?.config?.url || '';
    const status = error?.response?.status;
    const responseData = error?.response?.data;

    if (!requestUrl.includes('/auth/login') && isAuthFailureResponse(status, responseData)) {
      triggerAuthLogout();
    }
    return Promise.reject(error);
  }
);

// апи авторизации
export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
};

// апи операторов
export const supportsApi = {
  getSupports: (params) => api.get('/supports', { params }),
  getSupportById: (id) => api.get(`/supports/${id}`),
  getSupportCredentials: (id) => api.get(`/supports/${id}/credentials`),
  createSupport: (data) => api.post('/supports', data),
  updateSupport: (id, data) => api.put(`/supports/${id}`, data),
  deleteSupport: (id) => api.delete(`/supports/${id}`),
  updateSupportStatus: (id, status) => api.patch(`/supports/${id}/status`, { status }),
  updateMaxOrders: (id, maxOrders) => api.patch(`/supports/${id}/max-orders`, { maxOrders }),
  updateDeposit: (id, data) => api.patch(`/supports/${id}/deposit`, data),
  getOperatorsRating: () => api.get('/supports/rating/top'),
  getMyDebt: () => api.get('/supports/me/debt'),
  createMyDebtIntent: (requestedUsdt) => api.post('/supports/me/debt/intents', { requested_usdt: requestedUsdt }),
  getMyDebtIntentStatus: (intentId) => api.get(`/supports/me/debt/intents/${intentId}`),
  createMyDebtPayment: (data) => api.post('/supports/me/debt/payments', data),
  getMyDebtPayments: (params) => api.get('/supports/me/debt/payments', { params }),
  getDebtPaymentsHistory: (params) => api.get('/supports/debt/payments/history', { params }),
  getSupportDebt: (id) => api.get(`/supports/${id}/debt`),
  writeOffSupportDebt: (id, requestedUsdt) => api.post(`/supports/${id}/debt/write-off`, requestedUsdt ? { requested_usdt: requestedUsdt } : {}),
  createSupportDebtIntent: (id, requestedUsdt) => api.post(`/supports/${id}/debt/intents`, { requested_usdt: requestedUsdt }),
  getSupportDebtIntentStatus: (id, intentId) => api.get(`/supports/${id}/debt/intents/${intentId}`),
  getSupportDebtPayments: (id, params) => api.get(`/supports/${id}/debt/payments`, { params }),
};

export const settingsApi = {
  getFinanceSettings: () => api.get('/settings/finance'),
  updateFinanceSettings: (data) => api.put('/settings/finance', data),
  getChatQuickReplies: () => api.get('/settings/chat-quick-replies'),
  updateChatQuickReplies: (data) => api.put('/settings/chat-quick-replies', data),
  // Crypto wallets (auto-payout)
  getCryptoWallets: () => api.get('/settings/crypto-wallets'),
  getCryptoWalletBalance: (coin) => api.get(`/settings/crypto-wallets/${coin}/balance`),
  setCryptoWallet: (coin, mnemonic) => api.put(`/settings/crypto-wallets/${coin}`, { mnemonic }),
  toggleCryptoWallet: (coin, is_active) => api.patch(`/settings/crypto-wallets/${coin}/toggle`, { is_active }),
  deleteCryptoWallet: (coin) => api.delete(`/settings/crypto-wallets/${coin}`),
};

// апи заказов
export const ordersApi = {
  getOrders: (params) => {
    return api.get('/orders', { params })
      .then(response => {
        // Проверяем данные до трансформации
        console.log('API response before transform:', response);
        return response;
      });
  },
  getOrderDetails: (id) => api.get(`/orders/${id}`),
  createOrder: (data) => api.post('/orders', data),
  getQuote: (data) => api.post('/orders/quote', data),
  confirmOrder: (id, data) => api.post(`/orders/${id}/confirm`, data),
  cancelOrder: (id, data) => api.post(`/orders/${id}/cancel`, data),
  takeOrder: (id) => {
    console.log('Taking order:', id);
    return api.post(`/orders/${id}/take`);
  },
  setOrderRequisites: (id, data) => api.post(`/orders/${id}/requisites`, data),
  getAvailableOrders: () => api.get('/orders/available/support'),
  markMessagesRead: (id) => api.post(`/orders/${id}/messages/read`),
  updateOrderAmount: (id, data) => api.patch(`/orders/${id}/amount`, data),
  getOperatorStats: () => api.get('/orders/stats/operator'),
  getOperatorChartData: (days = 7) => api.get(`/orders/stats/operator/chart?days=${days}`),
};

// апи сделок
export const dealsApi = {
  assignDeal: (id, data) => api.post(`/deals/${id}/assign`, data),
  markPayment: (id) => api.post(`/deals/${id}/mark-payment`),
  getUsdtRate: (id) => api.get(`/deals/${id}/usdt-rate`),
  confirmPayment: (id, data) => api.post(`/deals/${id}/confirm-payment`, data || {}),
  setTransactionHash: (id, data) => api.post(`/deals/${id}/transaction-hash`, data),
  completeDeal: (id, data) => {
    // Если data это FormData, отправляем как multipart/form-data
    if (data instanceof FormData) {
      return api.post(`/deals/${id}/complete`, data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    }
    // Иначе отправляем как обычный JSON
    return api.post(`/deals/${id}/complete`, data);
  },
  sendMessage: (orderId, data) => {
    if (data instanceof FormData) {
      return api.post(`/orders/${orderId}/messages`, data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    }
    return api.post(`/orders/${orderId}/messages`, data);
  },
  getMessages: (orderId) => api.get(`/orders/${orderId}/messages`),
};

// апи курсов
export const ratesApi = {
  getRates: () => api.get('/rates'),
  getQuotes: () => api.get('/rates/quotes'),
  refreshRates: () => api.post('/rates/refresh'),
  getSettings: () => api.get('/rates/settings'),
  updateManualRate: (coin, data) => api.put(`/rates/${coin}/manual`, data),
  disableManualRate: (coin) => api.delete(`/rates/${coin}/manual`),
};

// апи комиссий
export const feesApi = {
  getFees: () => api.get('/fees'),
  updateFees: (data) => api.put('/fees', data),
};

// апи ботов
export const botsApi = {
  getBots: (params) => api.get('/bots', { params }),
  getBot: (id) => api.get(`/bots/${id}`),
  createBot: (data) => api.post('/bots', data),
  updateBot: (id, data) => api.put(`/bots/${id}`, data),
  toggleBotStatus: (id) => api.patch(`/bots/${id}/toggle`),
  deleteBot: (id) => api.delete(`/bots/${id}`),
  getBotStats: (id) => api.get(`/bots/${id}/stats`),
  createBotRequisite: (id, data) => api.post(`/bots/${id}/requisites`, data),
  updateBotRequisite: (id, requisiteId, data) => api.put(`/bots/${id}/requisites/${requisiteId}`, data),
  deleteBotRequisite: (id, requisiteId) => api.delete(`/bots/${id}/requisites/${requisiteId}`),
  startBot: (id) => api.post(`/bots/${id}/start`),
  stopBot: (id) => api.post(`/bots/${id}/stop`),
  restartBot: (id) => api.post(`/bots/${id}/restart`),
  getBotStatus: (id) => api.get(`/bots/${id}/status`),
  getBotFees: (id) => api.get(`/bots/${id}/fees`),
  updateBotFees: (id, data) => api.put(`/bots/${id}/fees`, data),
  // апи уровней комиссий
  getBotFeeTiers: (id) => api.get(`/bots/${id}/fee-tiers`),
  createFeeTier: (id, data) => api.post(`/bots/${id}/fee-tiers`, data),
  updateFeeTier: (id, tierId, data) => api.put(`/bots/${id}/fee-tiers/${tierId}`, data),
  deleteFeeTier: (id, tierId) => api.delete(`/bots/${id}/fee-tiers/${tierId}`),
  bulkUpdateFeeTiers: (id, data) => api.put(`/bots/${id}/fee-tiers/bulk`, data),
  getManagerStats: () => api.get('/bots/stats/manager'),
};

// апи юзеров
export const usersApi = {
  getUsers: (params) => api.get('/users', { params }),
  getUserById: (id) => api.get(`/users/${id}`),
  getUserReferrals: (id, params) => api.get(`/users/${id}/referrals`, { params }),
  updateUserDiscount: (id, discount) => api.patch(`/users/${id}/discount`, { discount }),
  blockUser: (id) => api.patch(`/users/${id}/block`),
  unblockUser: (id) => api.patch(`/users/${id}/unblock`),
};

// апи рассылок
export const mailingsApi = { 
  getMailings: (params) => api.get('/mailings', { params }),
  getMailing: (id) => api.get(`/mailings/${id}`),
  createMailing: (data) => api.post('/mailings', data),
  createRaffleMailing: (data) => api.post('/mailings/raffle', data),
  cancelMailing: (id) => api.patch(`/mailings/${id}/cancel`),
  deleteMailing: (id) => api.delete(`/mailings/${id}`),
  getStatistics: () => api.get('/mailings/stats'),
  getActiveMailings: () => api.get('/mailings/active'),
  updateSendCount: (id, increment) => api.patch(`/mailings/${id}/send-count`, { increment }),
};

// апи выплат по рефералке
export const referralWithdrawalsApi = {
  getWithdrawals: (params) => api.get('/referral-withdrawals', { params }),
  getWithdrawal: (id) => api.get(`/referral-withdrawals/${id}`),
  completeWithdrawal: (id) => api.post(`/referral-withdrawals/${id}/complete`),
  cancelWithdrawal: (id) => api.post(`/referral-withdrawals/${id}/cancel`),
};

// апи чатов поддержки
export const supportChatsApi = {
  getChats: (params) => api.get('/support-chats', { params }),
  getChatById: (chatId) => api.get(`/support-chats/${chatId}`),
  getMessages: (chatId, params) => api.get(`/support-chats/${chatId}/messages`, { params }),
  sendMessage: (chatId, data) => api.post(`/support-chats/${chatId}/messages`, data),
  uploadImage: (chatId, formData) => {
    return api.post(`/support-chats/${chatId}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  markAsRead: (chatId) => api.post(`/support-chats/${chatId}/read`),
  sendTyping: (chatId, isTyping) => api.post(`/support-chats/${chatId}/typing`, { isTyping }),
  getUnreadCount: () => api.get('/support-chats/unread-count'),
  deleteChat: (chatId) => api.delete(`/support-chats/${chatId}`),
};

export const operatorManagerChatsApi = {
  getChats: (params) => api.get('/operator-manager-chats', { params }),
  getUnreadCount: () => api.get('/operator-manager-chats/unread-count'),
  getAssignmentOptions: () => api.get('/operator-manager-chats/assignment-options'),
  assignManager: (operatorId, managerId) => api.patch(`/operator-manager-chats/operators/${operatorId}/manager`, { manager_id: managerId }),
  getMessages: (operatorId, params) => api.get(`/operator-manager-chats/operators/${operatorId}/messages`, { params }),
  sendMessage: (operatorId, data) => {
    if (data instanceof FormData) {
      return api.post(`/operator-manager-chats/operators/${operatorId}/messages`, data, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    }
    return api.post(`/operator-manager-chats/operators/${operatorId}/messages`, data);
  },
  markAsRead: (operatorId) => api.post(`/operator-manager-chats/operators/${operatorId}/read`),
};

export const shiftsApi = {
  startShift: (data) => api.post('/shifts/start', data || {}),
  endShift: (data) => api.post('/shifts/end', data || {}),
  getCurrentShift: () => api.get('/shifts/current'),
  getShifts: (params) => api.get('/shifts', { params }),
  updatePenalty: (shiftId, penalty) => api.patch(`/shifts/${shiftId}/penalty`, { penalty }),
};

export const financeApi = {
  getStats: (params) => api.get('/finance/stats', { params }),
  getOperatorStats: (supportId, params) => api.get(`/finance/operator/${supportId}`, { params }),
  getMonthlySummaries: (months) => api.get('/finance/monthly-summary', { params: { months } }),
  export: (params) => api.get('/finance/export', {
    params,
    responseType: 'blob',
  }),
};

export const auditLogsApi = {
  getLogs: (params) => api.get('/audit-logs', { params }),
  downloadLogs: (params) => api.get('/audit-logs/download', {
    params,
    responseType: 'blob'
  })
};

// Cashier (Автовыдача) API
export const cashiersApi = {
  // Superadmin — account management
  listCashiers: (params) => api.get('/cashiers', { params }),
  createCashier: (data) => api.post('/cashiers', data),
  getCashier: (id) => api.get(`/cashiers/${id}`),
  updateCashier: (id, data) => api.put(`/cashiers/${id}`, data),
  deleteCashier: (id) => api.delete(`/cashiers/${id}`),
  getVolumeSummary: () => api.get('/cashiers/volume-summary'),
  getCashierCards: (id) => api.get(`/cashiers/${id}/cards`),
  adminExtendCardLimit: (cashierId, cardId, extra_volume) =>
    api.patch(`/cashiers/${cashierId}/cards/${cardId}/extend-limit`, { extra_volume }),

  // Routing setting
  getRoutingSetting: () => api.get('/cashiers/routing-setting'),
  updateRoutingSetting: (interval) => api.put('/cashiers/routing-setting', { interval }),

  // Cashier self
  getMyStats: () => api.get('/cashiers/me/stats'),
  getMyCards: () => api.get('/cashiers/me/cards'),
  addMyCard: (data) => api.post('/cashiers/me/cards', data),
  updateMyCard: (cardId, data) => api.put(`/cashiers/me/cards/${cardId}`, data),
  deleteMyCard: (cardId) => api.delete(`/cashiers/me/cards/${cardId}`),
  extendMyCardLimit: (cardId, extra_volume) =>
    api.patch(`/cashiers/me/cards/${cardId}/extend-limit`, { extra_volume }),

  // Cashier deposit (self)
  getMyDeposit: () => api.get('/cashiers/me/deposit'),
  getMyDepositHistory: (params) => api.get('/cashiers/me/deposit/history', { params }),
  topupMyDeposit: (data) => api.post('/cashiers/me/deposit/topup', data),

  // Cashier deposit (admin)
  getCashierDeposit: (id) => api.get(`/cashiers/${id}/deposit`),
  adjustCashierDeposit: (id, data) => api.post(`/cashiers/${id}/deposit/adjust`, data),
};

export default api;
