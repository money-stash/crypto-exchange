import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ordersApi, supportsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import ResponsiveTable from '../components/ResponsiveTable';
import { toast } from 'react-toastify';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import PageTransition from '../components/PageTransition';
import CustomSelect from '../components/CustomSelect';
import AnimatedTimer from '../components/AnimatedTimer';
import socketService from '../services/socketService';
import {
  FileText,
  Clock,
  RotateCw,
  Zap,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  Wallet,
  Briefcase,
  RefreshCw
} from 'lucide-react';

const OrdersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [socketConnected, setSocketConnected] = useState(false);
  const [operatorStats, setOperatorStats] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    coin: '',
    dir: '',
    q: '',
    operator_login: '', // пустой по умолчанию - оператор видит все заявки
  });
  const [operatorView, setOperatorView] = useState('all');
  const [myOrdersFilter, setMyOrdersFilter] = useState('in_progress');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });
  const [takingOrderId, setTakingOrderId] = useState(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showDepositTopup, setShowDepositTopup] = useState(false);
  const [depositInfo, setDepositInfo] = useState(null);
  const [topupTxHash, setTopupTxHash] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const processedPaymentConfirmationsRef = useRef(new Set());
  const processedOrderTakenToastsRef = useRef(new Set());
  const fetchOrdersRequestIdRef = useRef(0);
  const fetchOrdersRef = useRef(null);
  const managerDefaultViewAppliedRef = useRef(false);
  const roleUpper = (user?.role || '').toUpperCase();
  const isOperatorLike = ['OPERATOR', 'SUPERADMIN', 'MANAGER'].includes(roleUpper);
  const isOperatorRole = roleUpper === 'OPERATOR';
  const canSeeAllTab = ['SUPERADMIN', 'MANAGER'].includes(roleUpper);
  const canSeeAwaitingHashTab = ['SUPERADMIN', 'MANAGER'].includes(roleUpper);
  const hideCustomerIdentity = roleUpper === 'OPERATOR';

  const maskOrderForCurrentUser = useCallback((order) => {
    if (!order) return order;
    if ((user?.role || '').toUpperCase() !== 'OPERATOR') return order;
    if (String(order.dir || '').toUpperCase() !== 'BUY') return order;

    return {
      ...order,
      coin: null,
      amount_coin: null,
      user_crypto_address: null,
      redacted_for_operator: true
    };
  }, [user?.role]);

  const formatUsdtCompact = useCallback((value) => {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return '0';
    const rounded = Number(numericValue.toFixed(2));
    const isIntegerAfterRounding = Number.isInteger(rounded);
    return rounded.toLocaleString('ru-RU', {
      minimumFractionDigits: isIntegerAfterRounding ? 0 : 2,
      maximumFractionDigits: 2
    });
  }, []);



useEffect(() => {
  const role = String(user?.role || '').toUpperCase();

  // Оператору не даем работать в режиме "all".
  if (role === 'OPERATOR' && operatorView === 'all') {
    return;
  }

  // Для менеджера блокируем только самый первый запрос в "all",
  // пока не применится дефолтный режим "Ожидают оплаты".
  if (role === 'MANAGER' && operatorView === 'all' && !managerDefaultViewAppliedRef.current) {
    return;
  }

  fetchOrders();
}, [filters, pagination.page, operatorView, myOrdersFilter, user?.role]);


  useEffect(() => {
    if (user?.role === 'OPERATOR') {
      fetchOperatorStats();
    }
  }, [user]);

useEffect(() => {
  const role = String(user?.role || '').toUpperCase();

  if (role !== 'MANAGER') {
    managerDefaultViewAppliedRef.current = false;
  }

  if (role === 'MANAGER' && !managerDefaultViewAppliedRef.current) {
    managerDefaultViewAppliedRef.current = true;
    setOperatorView('my');
    setMyOrdersFilter('awaiting_hash');
    return;
  }

  if (role === 'OPERATOR' && operatorView === 'all') {
    setOperatorView('free');
  }
}, [user?.role, operatorView]);

  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timeInterval);
    };
  }, []);

  const sortOrders = useCallback((ordersArray) => {
    return ordersArray;
    //сортировку по статусом убираем
    const statusPriority = {
      'QUEUED': 1,
      'PAYMENT_PENDING': 2,
      'CREATED': 3,
      'AWAITING_CONFIRM': 3,
      'COMPLETED': 3,
      'CANCELLED': 3
    };

    return [...ordersArray].sort((a, b) => {
      const priorityA = statusPriority[a.status] || 3;
      const priorityB = statusPriority[b.status] || 3;

      if (priorityA === priorityB) {
        return new Date(b.created_at) - new Date(a.created_at);
      }

      return priorityA - priorityB;
    });
  }, []);

  const isFreeOrder = useCallback((order) => {
    if (!order || order.support_id) {
      return false;
    }

    if (order.status === 'CREATED') {
      return Number(order.unread_messages || 0) > 0;
    }

    return ['QUEUED', 'PAYMENT_PENDING'].includes(order.status);
  }, []);

  const isOrderVisibleInMyView = useCallback((order) => {
    if (!isOperatorLike || operatorView !== 'my') return true;
    if (!order) return false;

    // Only OPERATOR is restricted to own orders.
    if (isOperatorRole && order.support_id !== user?.id) {
      return false;
    }

    if (myOrdersFilter === 'completed') {
      return order.status === 'COMPLETED';
    }

    if (myOrdersFilter === 'awaiting_hash') {
      return order.status === 'AWAITING_HASH';
    }

    if (myOrdersFilter === 'in_progress') {
      return ['AWAITING_CONFIRM', 'PAYMENT_PENDING', 'AWAITING_HASH'].includes(order.status);
    }

    return true;
  }, [isOperatorLike, operatorView, isOperatorRole, user?.id, myOrdersFilter]);

  // Функция для воспроизведения звука уведомления
  const playNotificationSound = useCallback(() => {
    try {
      // Создаем простой звук уведомления
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }, []);

  const handleOrderCreated = useCallback((order) => {
    const preparedOrder = maskOrderForCurrentUser(order);
    console.log('📦 [OrdersPage] handleOrderCreated called:', order);
    
    if (isOperatorLike && operatorView === 'my' && !isOrderVisibleInMyView(preparedOrder)) {
      console.log('📦 [OrdersPage] Order does not match current "my" tab filter, skipping');
      return;
    }

    if (isOperatorLike && operatorView === 'free' && !isFreeOrder(preparedOrder)) {
      return;
    }
    
    toast.info(`Новая заявка #${preparedOrder.unique_id}`);
    
    // Воспроизводим звук уведомления
    playNotificationSound();

    // Для "Свободных заявок" пересчитываем список с бэка,
    // чтобы сразу получить персональные поля (например USDT для оператора),
    // а не показывать сырой объект из сокета с прочерком.
    if (isOperatorLike && operatorView === 'free') {
      if (fetchOrdersRef.current) {
        fetchOrdersRef.current(false);
      }
      return;
    }
    
    setOrders(prevOrders => {
      console.log('📦 [OrdersPage] Current orders count:', prevOrders.length);

      const exists = prevOrders.some(o => o.id === preparedOrder.id);
      if (exists) {
        console.log('📦 [OrdersPage] Order already exists, skipping');
        return prevOrders;
      }
      

      const newOrders = [preparedOrder, ...prevOrders];
      console.log('📦 [OrdersPage] New orders count:', newOrders.length);
      return sortOrders(newOrders);
    });
    
    setPagination(prev => ({ ...prev, total: prev.total + 1 }));
    setLastUpdate(new Date());
    

    if (user?.role === 'OPERATOR') {
      fetchOperatorStats();
    }
  }, [sortOrders, user, operatorView, isOperatorLike, isFreeOrder, isOrderVisibleInMyView, maskOrderForCurrentUser]);

  const handleOrderUpdated = useCallback((order) => {
    console.log('📦 [OrdersPage] handleOrderUpdated called:', order);
    const preparedOrder = maskOrderForCurrentUser(order);
    
    setOrders(prevOrders => {
      const existingOrderIndex = prevOrders.findIndex(o => o.id === preparedOrder.id);
      
      if (existingOrderIndex === -1) {

        if (isOperatorLike && operatorView === 'my') {
          if (!isOrderVisibleInMyView(preparedOrder)) {
            console.log('📦 [OrdersPage] Updated order does not match current "my" tab filter, skipping');
            return prevOrders;
          }

          const newOrders = [preparedOrder, ...prevOrders];
          return sortOrders(newOrders);
        }

        if (isOperatorLike && operatorView === 'free') {
          if (!isFreeOrder(preparedOrder)) {
            return prevOrders;
          }
          const newOrders = [preparedOrder, ...prevOrders];
          return sortOrders(newOrders);
        }
        
        return prevOrders;
      }
      
      if (isOperatorLike && operatorView === 'my' && !isOrderVisibleInMyView(preparedOrder)) {
        console.log('📦 [OrdersPage] Updated order no longer matches "my" tab filter, removing');
        return prevOrders.filter(o => o.id !== preparedOrder.id);
      }

      if (isOperatorLike && operatorView === 'free' && !isFreeOrder(preparedOrder)) {
        return prevOrders.filter(o => o.id !== preparedOrder.id);
      }
      
      const updatedOrders = prevOrders.map(o => 
        o.id === preparedOrder.id ? { ...o, ...preparedOrder } : o
      );
      return sortOrders(updatedOrders);
    });
    
    setLastUpdate(new Date());
    
    if (user?.role === 'OPERATOR') {
      fetchOperatorStats();
    }
  }, [sortOrders, user?.role, operatorView, isOperatorLike, isFreeOrder, isOrderVisibleInMyView, maskOrderForCurrentUser]);

  const handleOrderTaken = useCallback((data) => {
    console.log('📦 [OrdersPage] handleOrderTaken called:', data);
    const displayId = data?.unique_id || data?.order_id || data?.orderId;
    const takenOrderId = data?.orderId || data?.order_id || data?.id || null;
    const toastKey = `${takenOrderId || displayId}-${data?.operatorId || data?.operator_id || ''}`;

    if (processedOrderTakenToastsRef.current.has(toastKey)) {
      return;
    }
    processedOrderTakenToastsRef.current.add(toastKey);
    if (processedOrderTakenToastsRef.current.size > 100) {
      const entries = Array.from(processedOrderTakenToastsRef.current);
      processedOrderTakenToastsRef.current.clear();
      entries.slice(-100).forEach((key) => processedOrderTakenToastsRef.current.add(key));
    }

    toast.info(`Заявка #${displayId} взята оператором`);
    
    if (takenOrderId) {
      setOrders(prevOrders => prevOrders.filter(o => o.id !== takenOrderId));
    }
  }, []);

  const handleOrderDeleted = useCallback((data) => {
    console.log('📦 [OrdersPage] handleOrderDeleted called:', data);
    
    setOrders(prevOrders => prevOrders.filter(o => o.id !== data.orderId));
    setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    setLastUpdate(new Date());
  }, []);

  const handleUserPaymentConfirmation = useCallback((data) => {
    console.log('[OrdersPage] User payment confirmation received:', data);
    

    if (!data.order || data.order.support_id !== user?.id) {
      console.log('[OrdersPage] Payment confirmation not for current user, skipping');
      return;
    }
    

    const confirmationKey = `${data.orderId || data.order?.id}-${data.userId}`;
    

    if (processedPaymentConfirmationsRef.current.has(confirmationKey)) {
      console.log('[OrdersPage] Payment confirmation already processed, skipping');
      return;
    }
    

    processedPaymentConfirmationsRef.current.add(confirmationKey);
    

    if (processedPaymentConfirmationsRef.current.size > 50) {
      const entries = Array.from(processedPaymentConfirmationsRef.current);
      processedPaymentConfirmationsRef.current.clear();
      entries.slice(-50).forEach(key => processedPaymentConfirmationsRef.current.add(key));
    }
    

    const orderNumber = data.order.unique_id || data.orderId;
    if (hideCustomerIdentity) {
      toast.info(`Пользователь подтвердил оплату по заявке #${orderNumber}`);
      console.log(`[OrdersPage] Showing anonymized toast for order #${orderNumber}`);
    } else {
      const userName = data.username || `ID ${data.userId}` || 'Пользователь';
    
    toast.info(`Пользователь ${userName} подтвердил оплату по заявке #${orderNumber}`);
    console.log(`[OrdersPage] Showing toast for payment confirmation from ${userName} for order #${orderNumber}`);
    }
    

    const preparedOrder = maskOrderForCurrentUser(data.order);

    setOrders(prevOrders => {
      const updatedOrders = prevOrders.map(order => 
        order.id === preparedOrder.id ? { ...order, ...preparedOrder } : order
      );
      console.log('[OrdersPage] Updated orders after payment confirmation');
      return updatedOrders;
    });
    
    setLastUpdate(new Date());
  }, [user, hideCustomerIdentity, maskOrderForCurrentUser]);


  useEffect(() => {
    console.log('🔌 [OrdersPage] Setting up WebSocket connection');
    
    socketService.connect();
    
    const updateConnectionStatus = () => {
      const connected = socketService.isConnected();
      setSocketConnected(connected);
      if (connected) {
        console.log('🔌 [OrdersPage] WebSocket connected');
      }
    };
    
    updateConnectionStatus();
    
    const checkConnectionInterval = setInterval(updateConnectionStatus, 1000);

    console.log('🔌 [OrdersPage] Registering event listeners');
    const unsubscribeCreated = socketService.on('order:created', handleOrderCreated);
    const unsubscribeUpdated = socketService.on('order:updated', handleOrderUpdated);
    const unsubscribeTaken = socketService.on('order:taken', handleOrderTaken);
    const unsubscribeDeleted = socketService.on('order:deleted', handleOrderDeleted);
    const unsubscribePaymentConfirmation = socketService.on('user:payment-confirmation', handleUserPaymentConfirmation);
    console.log('🔌 [OrdersPage] Event listeners registered, including payment confirmation handler');
    console.log('🔌 [OrdersPage] Payment confirmation handler:', handleUserPaymentConfirmation);

    return () => {
      console.log('🔌 [OrdersPage] Cleaning up WebSocket connection');
      clearInterval(checkConnectionInterval);
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeTaken();
      unsubscribeDeleted();
      unsubscribePaymentConfirmation();
    };
  }, [handleOrderCreated, handleOrderUpdated, handleOrderTaken, handleOrderDeleted, handleUserPaymentConfirmation]);

  const fetchOrders = async (showLoading = true) => {
    const requestId = ++fetchOrdersRequestIdRef.current;

    try {
      if (showLoading) setLoading(true);
      setRefreshing(true);
      

      let requestFilters = { ...filters };
      if (isOperatorRole) {
        requestFilters.coin = '';
      }

      if (isOperatorLike && operatorView === 'free') {
        const response = await ordersApi.getAvailableOrders();
        let availableOrders = Array.isArray(response.data)
          ? response.data
          : (response.data?.orders || []);
        availableOrders = availableOrders.filter(isFreeOrder);

        if (filters.status) {
          availableOrders = availableOrders.filter(order => order.status === filters.status);
        }
        if (!isOperatorRole && filters.coin) {
          availableOrders = availableOrders.filter(order => order.coin === filters.coin);
        }
        if (filters.dir) {
          availableOrders = availableOrders.filter(order => order.dir === filters.dir);
        }
        if (filters.q?.trim()) {
          const searchTerm = filters.q.trim().toLowerCase();
          availableOrders = availableOrders.filter(order => {
            const orderId = String(order.id || '').toLowerCase();
            if (isOperatorRole) {
              return orderId.includes(searchTerm);
            }
            const username = String(order.username || '').toLowerCase();
            const tgId = String(order.tg_id || '').toLowerCase();
            const uniqueId = String(order.unique_id || '').toLowerCase();
            return username.includes(searchTerm)
              || tgId.includes(searchTerm)
              || orderId.includes(searchTerm)
              || uniqueId.includes(searchTerm);
          });
        }

        const total = availableOrders.length;
        const offset = (pagination.page - 1) * pagination.limit;
        const pagedOrders = availableOrders.slice(offset, offset + pagination.limit).map(maskOrderForCurrentUser);
        const sortedOrders = sortOrders(pagedOrders);

        if (requestId !== fetchOrdersRequestIdRef.current) return;

        setOrders(sortedOrders);
        setPagination(prev => ({
          ...prev,
          total,
          pages: Math.ceil(total / prev.limit)
        }));
        setLastUpdate(new Date());
        return;
      }
      

      if (isOperatorLike && operatorView === 'my') {
        if (isOperatorRole) {
          requestFilters.operator_login = user.login;
        }
        if (myOrdersFilter === 'completed') {
          requestFilters.status = 'COMPLETED';
        } else if (myOrdersFilter === 'awaiting_hash') {
          requestFilters.status = 'AWAITING_HASH';
        }
      }
      
      const response = await ordersApi.getOrders({
        ...requestFilters,
        page: pagination.page,
        limit: pagination.limit
      });

      let responseData, ordersArray;

      if (Array.isArray(response.data)) {
        responseData = { orders: response.data };
        ordersArray = response.data;
      } else if (response.data?.data?.orders) {
        responseData = response.data.data;
        ordersArray = response.data.data.orders;
      } else if (response.data?.orders) {
        responseData = response.data;
        ordersArray = response.data.orders;
      } else {
        responseData = response.data || {};
        ordersArray = [];
      }

      if (isOperatorLike && 
          operatorView === 'my' && 
          myOrdersFilter === 'in_progress') {
        ordersArray = ordersArray.filter(order => 
          ['AWAITING_CONFIRM', 'PAYMENT_PENDING', 'AWAITING_HASH'].includes(order.status)
        );
      }

      if (isOperatorRole && isOperatorLike && operatorView === 'my') {
        ordersArray = ordersArray.filter(order => order.support_id === user.id);
      }

      ordersArray = ordersArray.map(maskOrderForCurrentUser);
      const sortedOrders = sortOrders(ordersArray);

      if (requestId !== fetchOrdersRequestIdRef.current) return;

      setOrders(sortedOrders);
      setPagination(prev => ({
        ...prev,
        total: responseData?.total || ordersArray.length || 0,
        pages: responseData?.pages || Math.ceil((responseData?.total || ordersArray.length || 0) / prev.limit)
      }));
      setLastUpdate(new Date());
    } catch (error) {
      if (requestId !== fetchOrdersRequestIdRef.current) return;

      console.error('Failed to fetch orders:', error);
      if (showLoading) {
        toast.error('Ошибка при загрузке заявок');
      }
    } finally {
      if (requestId !== fetchOrdersRequestIdRef.current) return;

      if (showLoading) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrdersRef.current = fetchOrders;
  }, [fetchOrders]);

  const fetchOperatorStats = async () => {
    try {
      const response = await ordersApi.getOperatorStats();
      console.log('📊 Operator stats loaded:', response.data);
      setOperatorStats(response.data);
    } catch (error) {
      console.error('Failed to fetch operator stats:', error);
    }
  };

  const openDepositTopup = async () => {
    try {
      const res = await supportsApi.getMyDeposit();
      setDepositInfo(res.data);
    } catch {
      toast.error('Не удалось загрузить данные депозита');
      return;
    }
    setTopupTxHash('');
    setShowDepositTopup(true);
  };

  const handleDepositTopup = async () => {
    const hash = topupTxHash.trim();
    if (!hash || hash.length !== 64) return toast.error('Введите корректный хеш транзакции (64 символа)');
    setTopupLoading(true);
    try {
      const res = await supportsApi.topupMyDeposit({ tx_hash: hash, coin: 'USDT' });
      toast.success(res.data.message);
      setShowDepositTopup(false);
      setTopupTxHash('');
      fetchOperatorStats();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка пополнения депозита');
    } finally {
      setTopupLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
    }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleOperatorViewChange = (view) => {
    const normalizedView = (view === 'all' && !canSeeAllTab) ? 'free' : view;
    setOperatorView(normalizedView);
    setOrders([]);
    setPagination(prev => ({ ...prev, page: 1, total: 0, pages: 0 }));
    
    setFilters(prev => ({
      ...prev,
      status: '',
      operator_login: ''
    }));
  };

const handleWorkTabChange = (tab) => {
  setOrders([]);
  setPagination(prev => ({ ...prev, page: 1, total: 0, pages: 0 }));
  setFilters(prev => ({ ...prev, status: '', operator_login: '' }));

  if (tab === 'free') {
    setOperatorView('free');
    return;
  }

  setOperatorView('my');
  if (tab === 'completed') {
    setMyOrdersFilter('completed');
    return;
  }
  if (tab === 'awaiting_hash') {
    setMyOrdersFilter('awaiting_hash');
    return;
  }
  setMyOrdersFilter('in_progress');
};


  const handleMyOrdersFilterChange = (filter) => {
    setMyOrdersFilter(filter);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleTakeOrder = async (orderId) => {
    setTakingOrderId(orderId);
    try {
      await ordersApi.takeOrder(orderId);
      toast.success('Заявка назначена на вас');
      navigate(`/orders/${orderId}`);
      if (user?.role === 'OPERATOR') {
        fetchOperatorStats(); 
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Ошибка при назначении заявки';
      toast.error(errorMessage);
    } finally {
      setTakingOrderId(null);
    }
  };

  const getStatusBadge = (status, order) => {
    const badges = {
      CREATED: 'bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 dark:from-gray-700/50 dark:via-gray-600/50 dark:to-gray-700/50 text-gray-700 dark:text-gray-300 shadow-sm border border-gray-300/30 dark:border-gray-500/30',
      AWAITING_CONFIRM: 'bg-gradient-to-r from-yellow-100 via-yellow-200 to-yellow-100 dark:from-yellow-900/40 dark:via-yellow-800/40 dark:to-yellow-900/40 text-yellow-800 dark:text-yellow-300 shadow-sm shadow-yellow-500/20 border border-yellow-300/30 dark:border-yellow-600/30',
      QUEUED: 'bg-gradient-to-r from-blue-100 via-blue-200 to-blue-100 dark:from-blue-900/40 dark:via-blue-800/40 dark:to-blue-900/40 text-blue-800 dark:text-blue-300 shadow-sm shadow-blue-500/20 border border-blue-300/30 dark:border-blue-600/30',
      PAYMENT_PENDING: 'bg-gradient-to-r from-orange-100 via-orange-200 to-orange-100 dark:from-orange-900/40 dark:via-orange-800/40 dark:to-orange-900/40 text-orange-800 dark:text-orange-300 shadow-sm shadow-orange-500/20 border border-orange-300/30 dark:border-orange-600/30',
      AWAITING_HASH: 'bg-gradient-to-r from-purple-100 via-purple-200 to-purple-100 dark:from-purple-900/40 dark:via-purple-800/40 dark:to-purple-900/40 text-purple-800 dark:text-purple-300 shadow-sm shadow-purple-500/20 border border-purple-300/30 dark:border-purple-600/30',
      COMPLETED: 'bg-gradient-to-r from-green-100 via-green-200 to-green-100 dark:from-green-900/40 dark:via-green-800/40 dark:to-green-900/40 text-green-800 dark:text-green-300 shadow-sm shadow-green-500/20 border border-green-300/30 dark:border-green-600/30',
      CANCELLED: 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 shadow-sm shadow-red-500/20 border border-red-300/30 dark:border-red-600/30',
    };

    const labels = {
      CREATED: 'Создана',
      AWAITING_CONFIRM: 'Ожидает подтверждения',
      QUEUED: 'В очереди',
      PAYMENT_PENDING: 'В работе',
      AWAITING_HASH: 'Ожидает выплату',
      COMPLETED: 'Выполнена за',
      CANCELLED: 'Отменена за'
    };

    const icons = {
      CREATED: FileText,
      AWAITING_CONFIRM: Clock,
      QUEUED: RotateCw,
      PAYMENT_PENDING: Zap,
      AWAITING_HASH: Wallet,
      COMPLETED: CheckCircle2,
      CANCELLED: XCircle,
    };

    const Icon = icons[status];
    const workingTime = getWorkingTime(order);
    const showTimer = workingTime !== '-' && (status === 'PAYMENT_PENDING' || status === 'AWAITING_HASH' || status === 'COMPLETED' || status === 'CANCELLED');

    return (
      <div className={`inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium tracking-wide ${badges[status]} transition-all duration-200 hover:scale-105`}>
        <Icon className="w-3.5 h-3.5" />
        <span>{labels[status]}</span>
        {showTimer && (
          <AnimatedTimer 
            time={workingTime} 
            isCompleted={status === 'COMPLETED' || status === 'CANCELLED'} 
          />
        )}
      </div>
    );
  };

  const getWorkingTime = (order) => {
    if (!order.sla_started_at) {
      return '-';
    }
    if (order.status === 'CANCELLED' && !order.completed_at) {
      return '-';
    }

    const startTime = new Date(order.sla_started_at);
    const endTime = order.completed_at ? new Date(order.completed_at) : currentTime;
    const diffMs = endTime - startTime;

    if (diffMs < 0) return '-';

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);

    const remainingMinutes = diffMinutes % 60;
    const remainingSeconds = diffSeconds % 60;

    if (diffHours > 0) {
      return `${diffHours}ч ${remainingMinutes}м ${remainingSeconds}с`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes}м ${remainingSeconds}с`;
    } else {
      return `${remainingSeconds}с`;
    }
  };

  const columns = [
    user?.role === 'SUPERADMIN' && {
      header: '№',
      key: 'id',
      width: '48px',
      render: (row) => (
        <span className="font-mono text-gray-400 dark:text-gray-500">{row.id}</span>
      )
    },
    {
      header: 'ID',
      key: 'unique_id',
      width: '64px',
      render: (row) => (
        <Link
          to={`/orders/${row.id}`}
          className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
        >
          #{row.unique_id}
        </Link>
      )
    },
    {
      header: 'Дата',
      key: 'created_at',
      width: '80px',
      render: (row) => (
        <span className="text-gray-500 dark:text-gray-500 tabular-nums">
          {new Date(row.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
        </span>
      )
    },
    roleUpper !== 'OPERATOR' && {
      header: 'Пользователь',
      key: 'username',
      width: '130px',
      render: (row) => (
        hideCustomerIdentity
          ? <span className="text-gray-400">—</span>
          : <span className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px] block" title={row.username || `ID ${row.user_id}`}>
              {row.username || `ID ${row.user_id}`}
            </span>
      )
    },
    {
      header: 'Тип',
      key: 'dir',
      width: '76px',
      render: (row) => (
        <span className={`inline-flex items-center gap-1 font-medium text-[11px] ${
          row.dir === 'BUY' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
        }`}>
          {row.dir === 'BUY' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {row.dir === 'BUY' ? 'Покупка' : 'Продажа'}
        </span>
      )
    },
    roleUpper !== 'OPERATOR' && {
      header: 'Монета',
      key: 'coin',
      width: '56px',
      render: (row) => (
        <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
          {(user?.role === 'OPERATOR' && row.dir === 'BUY') ? '—' : (row.coin || '—')}
        </span>
      )
    },
    user?.role === 'SUPERADMIN' && {
      header: 'Бот',
      key: 'bot_id',
      width: '100px',
      render: (row) => (
        row.bot_identifier
          ? <Link to={`/bots/${row.bot_id}`} className="text-blue-600 dark:text-blue-400 hover:underline truncate block max-w-[90px]">{row.bot_identifier}</Link>
          : <span className="text-gray-400">—</span>
      )
    },
    {
      header: 'Сумма',
      key: 'amount_sum',
      width: '170px',
      render: (row) => {
        const isOperatorBuy = user?.role === 'OPERATOR' && row.dir === 'BUY';
        return (
          <span className="font-mono text-gray-700 dark:text-gray-300 tabular-nums">
            {isOperatorBuy
              ? <span className="text-blue-600 dark:text-blue-400 font-semibold">{row.usdt_due ? `${Number(row.usdt_due).toFixed(4)} USDT` : '—'}</span>
              : <>
                  <span className="text-gray-500 dark:text-gray-500">{parseFloat(row.amount_coin || 0).toFixed(6)} {row.coin}</span>
                  <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
                  <span className="font-semibold">{parseFloat(row.sum_rub || 0).toLocaleString('ru-RU')} ₽</span>
                </>
            }
          </span>
        );
      }
    },
    {
      header: 'Статус',
      key: 'status',
      width: '160px',
      render: (row) => getStatusBadge(row.status, row)
    },
    {
      header: 'Оператор',
      key: 'support_id',
      width: '120px',
      mobileHide: true,
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {row.support_id
            ? <span className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[90px]">{row.support_username || `ID ${row.support_id}`}</span>
            : <span className="text-gray-400 dark:text-gray-500">—</span>
          }
          {row.unread_messages > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 bg-blue-500 text-white text-[10px] font-bold rounded-full">
              {row.unread_messages > 9 ? '9+' : row.unread_messages}
            </span>
          )}
        </div>
      )
    },
    {
      header: '',
      key: 'actions',
      width: '80px',
      render: (row) => (
        <div className="flex items-center gap-1 justify-end">
          {((row.status === 'CREATED' && row.unread_messages > 0) || row.status === 'QUEUED') && (
            <ActionButton
              type="assign"
              onClick={() => handleTakeOrder(row.id)}
              variant="primary"
              title="Взять заявку"
              loading={takingOrderId === row.id}
            />
          )}
          {(user?.role !== 'OPERATOR' || user?.id === row.support_id) && (
            <Link to={`/orders/${row.id}`}>
              <ActionButton type="view" variant="default" title="Подробнее" />
            </Link>
          )}
        </div>
      )
    }
  ].filter(Boolean);

  return (
    <PageTransition>
      <div className="space-y-2">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Заявки</span>
            <span className="text-xs text-gray-400 hidden sm:inline">· {lastUpdate.toLocaleTimeString('ru-RU')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${socketConnected ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${socketConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className="hidden sm:inline">{socketConnected ? 'Live' : 'Offline'}</span>
            </div>
            <button
              onClick={() => { fetchOrders(); if (user?.role === 'OPERATOR') fetchOperatorStats(); }}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>

        {/* Operator stats strip */}
        {user?.role === 'OPERATOR' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span className="text-gray-500">Депозит:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {loading || !operatorStats ? '—' : `${formatUsdtCompact(operatorStats.deposit || 0)} USDT`}
              </span>
            </div>
            <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />
              <span className="text-gray-500">Рабочий:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {loading || !operatorStats ? '—' : `${formatUsdtCompact(operatorStats.deposit_work ?? operatorStats.deposit ?? 0)} USDT`}
              </span>
            </div>
            <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-gray-500">Доступно:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {loading || !operatorStats ? '—' : `${formatUsdtCompact(Math.max(0, (operatorStats.deposit || 0) - (operatorStats.deposit_work || 0)))} USDT`}
              </span>
            </div>
            <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
              <span className="text-gray-500">В работе:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {loading || !operatorStats ? '—' : operatorStats.current_orders || 0}
              </span>
            </div>
            <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700" />
            <button
              onClick={openDepositTopup}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              + Пополнить депозит
            </button>
          </div>
        )}

        {/* Tabs + Filters block */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">

          {/* Tabs row */}
          {isOperatorLike && (
            <div className="flex items-center gap-0 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
              {canSeeAwaitingHashTab && (
                <button
                  onClick={() => handleWorkTabChange('awaiting_hash')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    operatorView === 'my' && myOrdersFilter === 'awaiting_hash'
                      ? 'border-purple-500 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >Ожидают оплаты</button>
              )}
              {canSeeAllTab && (
                <button
                  onClick={() => handleOperatorViewChange('all')}
                  className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    operatorView === 'all'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >Все заявки</button>
              )}
              <button
                onClick={() => handleWorkTabChange('free')}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  operatorView === 'free'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >Свободные</button>
              <button
                onClick={() => handleWorkTabChange('in_progress')}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  operatorView === 'my' && myOrdersFilter === 'in_progress'
                    ? 'border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >В работе</button>
              <button
                onClick={() => handleWorkTabChange('completed')}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  operatorView === 'my' && myOrdersFilter === 'completed'
                    ? 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >Выполненные</button>
            </div>
          )}

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            {((user?.role !== 'OPERATOR' && user?.role !== 'SUPERADMIN' && user?.role !== 'MANAGER') || operatorView === 'all') && (
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="h-7 px-2 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Все статусы</option>
                <option value="QUEUED">В очереди</option>
                <option value="PAYMENT_PENDING">В работе</option>
                <option value="AWAITING_CONFIRM">Ожидает подтв.</option>
                <option value="AWAITING_HASH">Ожидает хеш</option>
                <option value="COMPLETED">Выполнено</option>
                <option value="CANCELLED">Отменено</option>
              </select>
            )}

            {!isOperatorRole && (
              <select
                value={filters.coin}
                onChange={(e) => handleFilterChange('coin', e.target.value)}
                className="h-7 px-2 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Все валюты</option>
                <option value="BTC">BTC</option>
                <option value="LTC">LTC</option>
                <option value="XMR">XMR</option>
                <option value="USDT">USDT</option>
              </select>
            )}

            <select
              value={filters.dir}
              onChange={(e) => handleFilterChange('dir', e.target.value)}
              className="h-7 px-2 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Все типы</option>
              <option value="BUY">Покупка</option>
              <option value="SELL">Продажа</option>
            </select>

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder={isOperatorRole ? 'ID заявки...' : 'ID, пользователь...'}
                value={filters.q}
                onChange={(e) => handleFilterChange('q', e.target.value)}
                className="h-7 pl-6 pr-2 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36"
              />
            </div>

            {((user?.role !== 'OPERATOR' && user?.role !== 'SUPERADMIN' && user?.role !== 'MANAGER') || operatorView === 'all') && (
              <div className="relative">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <input
                  type="text"
                  placeholder="Оператор..."
                  value={filters.operator_login}
                  onChange={(e) => handleFilterChange('operator_login', e.target.value)}
                  className="h-7 pl-6 pr-2 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-32"
                />
              </div>
            )}

            <span className="ml-auto text-xs text-gray-400">{pagination.total} заявок</span>
          </div>
        </div>

        <ResponsiveTable
          compact
          columns={columns}
          data={orders}
          loading={loading}
          emptyMessage="Заявок не найдено"
          rowClassName={(row) =>
            row.unread_messages > 0
              ? 'bg-blue-50/60 dark:bg-blue-900/20 border-l-2 border-blue-500'
              : ''
          }
        />

        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.pages}
          totalItems={pagination.total}
          itemsPerPage={pagination.limit}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
        />
      </div>
    </PageTransition>

    {/* Deposit topup modal */}
    {showDepositTopup && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Пополнить депозит (USDT TRC20)</h2>

          {depositInfo?.wallets?.USDT ? (
            <div className="space-y-1">
              <p className="text-xs text-gray-500">Адрес для пополнения:</p>
              <p className="font-mono text-xs break-all bg-gray-100 dark:bg-gray-800 rounded p-2 select-all">
                {depositInfo.wallets.USDT}
              </p>
              {depositInfo.rates?.USDT > 0 && (
                <p className="text-xs text-gray-500">Курс: 1 USDT = {Number(depositInfo.rates.USDT).toLocaleString('ru-RU')} ₽</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-red-500">Адрес депозита не настроен. Обратитесь к администратору.</p>
          )}

          <div className="space-y-1">
            <label className="text-xs text-gray-600 dark:text-gray-400">Хеш транзакции (64 символа)</label>
            <input
              type="text"
              value={topupTxHash}
              onChange={e => setTopupTxHash(e.target.value)}
              placeholder="Вставьте TxID транзакции..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">{topupTxHash.trim().length} / 64 символов</p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowDepositTopup(false); setTopupTxHash(''); }}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleDepositTopup}
              disabled={topupLoading || topupTxHash.trim().length !== 64 || !depositInfo?.wallets?.USDT}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {topupLoading ? 'Проверяем...' : 'Подтвердить пополнение'}
            </button>
          </div>
        </div>
      </div>
    )}
  );
};

export default OrdersPage;
