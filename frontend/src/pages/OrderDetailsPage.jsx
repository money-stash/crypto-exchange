import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ordersApi, dealsApi } from '../services/api';
import { toast } from 'react-toastify';
import { useConfirmDialog } from '../contexts/ConfirmContext';
import LoadingSpinner from '../components/LoadingSpinner';
import BotRequisiteForm from '../components/BotRequisiteForm';
import OrderChat from '../components/OrderChat';
import OperatorManagerChat from '../components/OperatorManagerChat';
import OrderProgressBar from '../components/OrderProgressBar';
import { useAuth } from '../hooks/useAuth';
import AnimatedTimer from '../components/AnimatedTimer';
import socketService from '../services/socketService';
import {
  ChevronLeft, 
  XCircle, 
  FileText, 
  Clock, 
  RotateCw, 
  Zap, 
  Check,
  MessageCircle
} from 'lucide-react';
import PageTransition from '../components/PageTransition';

const normalizeServiceText = (value) => String(value || '').trim();

const ACCOUNT_CARD_RE = /\d{4}(?:[\s-]?\d{4}){3}/;
const ACCOUNT_PHONE_RE = /\+?\d[\d\s()-]{9,}/;
const RUBLE_SIGN = '\u20BD';

const isAccountLikeLine = (value) => {
  const text = normalizeServiceText(value);
  return ACCOUNT_CARD_RE.test(text) || ACCOUNT_PHONE_RE.test(text);
};

const stripOuterQuotes = (value) => {
  const text = normalizeServiceText(value);
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('«') && text.endsWith('»'))) {
    return text.slice(1, -1).trim();
  }
  return text;
};

const parseRequisitesServiceMessage = (rawText) => {
  const text = normalizeServiceText(rawText);
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return null;
  }

  let comment = '';
  let account = '';
  let bank = '';
  let holder = '';

  // 1) [comment/header, account, bank, holder]
  if (lines.length >= 4 && !isAccountLikeLine(lines[0]) && isAccountLikeLine(lines[1])) {
    comment = stripOuterQuotes(lines[0].replace(/^\(|\)$/g, ''));
    account = lines[1];
    bank = lines[2];
    holder = lines[3];
  // 2) [account, bank, holder, ...optional]
  } else if (isAccountLikeLine(lines[0])) {
    account = lines[0];
    bank = lines[1] || '';
    holder = lines[2] || '';
    if (lines.length > 3) {
      comment = stripOuterQuotes(lines.slice(3).join(' '));
    }
  // 3) Fallback: take last 3 lines as реквизиты, leading lines as comment
  } else if (lines.length >= 3 && isAccountLikeLine(lines[lines.length - 3])) {
    account = lines[lines.length - 3];
    bank = lines[lines.length - 2];
    holder = lines[lines.length - 1];
    if (lines.length > 3) {
      comment = stripOuterQuotes(lines.slice(0, lines.length - 3).join(' '));
    }
  } else {
    return {
      comment: '',
      account: '',
      bank: '',
      holder: '',
      rawText: text
    };
  }

  const hasAccountLine = isAccountLikeLine(account);
  const hasBankLine = bank.length > 0 && !/[<>]/.test(bank);
  const hasHolderLine = holder.length > 0 && !/[<>]/.test(holder);

  if (!hasAccountLine || !hasBankLine || !hasHolderLine) {
    return {
      comment,
      account: account || '',
      bank: bank || '',
      holder: holder || '',
      rawText: text
    };
  }

  return {
    comment,
    account,
    bank,
    holder,
    rawText: text
  };
};

const OrderDetailsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirmDialog();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());
  const currentOrderIdRef = useRef(null);
  const processedPaymentConfirmationsRef = useRef(new Set());
  const [transactionHash, setTransactionHash] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showRequisitesModal, setShowRequisitesModal] = useState(false);
  const [activeChatTab, setActiveChatTab] = useState('client');
  const [showRequisitesEditForm, setShowRequisitesEditForm] = useState(false);
  const [requisitesHistory, setRequisitesHistory] = useState([]);
  const [requisitesHistoryLoading, setRequisitesHistoryLoading] = useState(false);
  const [completingOrder, setCompletingOrder] = useState(false);
  const roleUpper = (user?.role || '').toUpperCase();
  const hideCustomerIdentity = roleUpper === 'OPERATOR';
  const isOperatorRole = roleUpper === 'OPERATOR';
  const isSuperAdminRole = roleUpper === 'SUPERADMIN';
  const isManagerRole = roleUpper === 'MANAGER';
  const canOperatorWriteClientChat = Number(user?.can_write_chat ?? 1) === 1;
  const assignedOperatorCanWriteClientChat = Number(order?.support_can_write_chat ?? 1) === 1;
  const hasAssignedOperator = Number(order?.support_id || 0) > 0;
  const hideClientChatForOperator = isOperatorRole && !canOperatorWriteClientChat;
  const showManagerChatTab = isOperatorRole
    ? !canOperatorWriteClientChat
    : ((isManagerRole || isSuperAdminRole) && hasAssignedOperator && !assignedOperatorCanWriteClientChat);
  const managerChatOperatorId = isOperatorRole
    ? Number(user?.id || 0)
    : Number(order?.support_id || 0);
  const canOpenManagerChat = showManagerChatTab && managerChatOperatorId > 0;
  const canOpenClientChat = !hideClientChatForOperator;
  const canShowChatTabs = canOpenManagerChat && canOpenClientChat;
  const showSplitManagerChats = (isManagerRole || isSuperAdminRole) && canOpenClientChat && canOpenManagerChat;
  const hasOperatorCancelPermission = Number(user?.can_cancel_order ?? 0) === 1;
  const hasOperatorEditRequisitesPermission = Number(user?.can_edit_requisites ?? 0) === 1;
  const isOperatorBuyHidden = isOperatorRole && order?.dir === 'BUY' && order?.redacted_for_operator;
  const canCompleteBuyOrder = ['MANAGER', 'SUPERADMIN'].includes(roleUpper);
  const hasExchangerRequisites = Boolean(
    order?.exch_req_id ||
    order?.exch_card_number ||
    order?.exch_card_holder ||
    order?.exch_bank_name ||
    order?.exch_crypto_address ||
    order?.exch_sbp_phone
  );
  const canPrivilegedEditRequisites = isSuperAdminRole || isManagerRole;
  const canOperatorSetRequisitesForOrder =
    isOperatorRole &&
    Number(order?.support_id || 0) === Number(user?.id || 0) &&
    String(order?.status || '').toUpperCase() === 'PAYMENT_PENDING';
  const canOperatorSendFirstRequisites =
    canOperatorSetRequisitesForOrder &&
    !hasExchangerRequisites;
  const canOperatorEditExistingRequisites =
    canOperatorSetRequisitesForOrder &&
    hasOperatorEditRequisitesPermission;
  const canShowRequisitesForm =
    canPrivilegedEditRequisites ||
    canOperatorEditExistingRequisites ||
    canOperatorSendFirstRequisites;
  const showOperatorRequisitesQuickAction =
    isOperatorRole &&
    hideClientChatForOperator;
  const operatorSentMessagesCount = Number(order?.support_sent_messages || 0);
  const operatorCancelBlockReason = isOperatorRole
    ? (
      !hasOperatorCancelPermission
        ? 'У вас отключена возможность отмены сделок'
        : order?.status === 'AWAITING_HASH'
        ? 'После подтверждения оплаты оператором отмена заявки недоступна'
        : hasExchangerRequisites
          ? 'Оператор не может отменить заявку после отправки реквизитов'
          : operatorSentMessagesCount > 0
            ? 'Оператор не может отменить заявку после отправки сообщения клиенту'
            : null
    )
    : null;
  const canOperatorCancelCurrentOrder = !operatorCancelBlockReason;

  // сокет
  useEffect(() => {
    console.log('🔌 [OrderDetailsPage] Connecting to WebSocket');
    socketService.connect();
    
    return () => {
      console.log('🔌 [OrderDetailsPage] Component unmounting');
    };
  }, []);

  useEffect(() => {
    if (!canOpenClientChat && canOpenManagerChat && activeChatTab !== 'manager') {
      setActiveChatTab('manager');
      return;
    }

    if (!canOpenManagerChat && activeChatTab === 'manager') {
      setActiveChatTab('client');
      return;
    }

    if (!canOpenClientChat && !canOpenManagerChat && activeChatTab !== 'client') {
      setActiveChatTab('client');
    }
  }, [canOpenClientChat, canOpenManagerChat, activeChatTab]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setOrder(null);

      try {
        const response = await ordersApi.getOrderDetails(id);
        console.log(response);
        setOrder(response.data);
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Неизвестная ошибка';
        toast.error(`Ошибка при загрузке деталей заявки`);
        console.error('Load order details error:', error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [id]);

  // Вспомогательная функция для построения URL к загруженным файлам
  const getUploadUrl = (attachmentsPath, folder = 'chats') => {
    if (!attachmentsPath) return '';

    // В production строим базовый URL на основе origin (устраняем порты дев-сервера)
    if (process.env.NODE_ENV === 'production') {
      const baseUrl = window.location.origin.includes('localhost')
        ? 'http://localhost:8080'
        : window.location.origin.replace(':5174', ':8080').replace(':3000', ':8080');

      const filename = attachmentsPath.split('/').pop();
      return `${baseUrl}/uploads/${folder}/${filename}`;
    }

    // Для разработки используем переменную окружения или localhost
    return `${import.meta.env.VITE_API_URL || 'http://localhost:8080'}${attachmentsPath.startsWith('/') ? '' : '/'}${attachmentsPath}`;
  };

  const loadRequisitesHistory = async () => {
    setRequisitesHistoryLoading(true);
    try {
      const response = await dealsApi.getMessages(id);
      const historyItems = (response?.data || [])
        .map((message) => {
          const sourceText =
            normalizeServiceText(message?.original_message) ||
            normalizeServiceText(message?.message) ||
            normalizeServiceText(message?.translated_message);

          const parsed = parseRequisitesServiceMessage(sourceText);
          if (!parsed) return null;

          const senderType = String(message?.sender_type || '').toUpperCase();
          const isServiceLike = Boolean(message?.internal_only) || senderType === 'SERVICE';
          if (!isServiceLike) return null;

          return {
            id: String(message?.id || `${message?.created_at || ''}_${sourceText}`),
            createdAt: message?.created_at ? new Date(message.created_at) : new Date(),
            ...parsed
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      setRequisitesHistory(historyItems);
    } catch (error) {
      console.error('Load requisites history error:', error);
      setRequisitesHistory([]);
    } finally {
      setRequisitesHistoryLoading(false);
    }
  };

  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timeInterval);
    };
  }, []);

  useEffect(() => {
    if (!showRequisitesModal) return;
    loadRequisitesHistory();
  }, [showRequisitesModal, id]);

  useEffect(() => {
    if (!showRequisitesModal) {
      setShowRequisitesEditForm(false);
      return;
    }

    if (!hasExchangerRequisites && canShowRequisitesForm) {
      setShowRequisitesEditForm(true);
    }
  }, [showRequisitesModal, hasExchangerRequisites, canShowRequisitesForm]);

  useEffect(() => {
    const handleOrderUpdated = (updatedOrder) => {
      console.log('📡 [OrderDetailsPage] Received order:updated event', updatedOrder);
      
      if (updatedOrder.id === parseInt(id)) {
        console.log('✅ [OrderDetailsPage] Updating order state with new data');
        setOrder(updatedOrder);
      }
    };

    const handleOrderMessage = (messageEvent) => {
      const eventOrderId = Number(messageEvent?.order_id || messageEvent?.orderId || 0);
      if (eventOrderId !== Number(id)) {
        return;
      }

      if (messageEvent?.sender_type !== 'OPERATOR') {
        return;
      }

      if (Number(messageEvent?.sender_id || 0) !== Number(user?.id || 0)) {
        return;
      }

      setOrder((prevOrder) => {
        if (!prevOrder || Number(prevOrder.support_sent_messages || 0) > 0) {
          return prevOrder;
        }
        return { ...prevOrder, support_sent_messages: 1 };
      });
    };

    const handleUserPaymentConfirmation = (data) => {
      console.log('[OrderDetailsPage] User payment confirmation received:', data);
      
      const orderIdFromData = data.orderId || data.order?.id;
      if (orderIdFromData != id) {
        console.log('[OrderDetailsPage] Payment confirmation not for current order, skipping');
        return;
      }
      
      if (!data.order || data.order.support_id !== user?.id) {
        console.log('[OrderDetailsPage] Payment confirmation not for current user, skipping');
        return;
      }
      
      const confirmationKey = `${orderIdFromData}-${data.userId}`;
      
      if (processedPaymentConfirmationsRef.current.has(confirmationKey)) {
        console.log('[OrderDetailsPage] Payment confirmation already processed, skipping');
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
        console.log(`[OrderDetailsPage] Showing anonymized toast for order #${orderNumber}`);
      } else {
        const userName = data.username || `ID ${data.userId}` || 'Пользователь';
      
      toast.info(`Пользователь ${userName} подтвердил оплату по заявке #${orderNumber}`);
      console.log(`[OrderDetailsPage] Showing toast for payment confirmation from ${userName} for order #${orderNumber}`);
      }
      
      setOrder(prevOrder => ({ ...prevOrder, ...data.order }));
    };

    socketService.on('order:updated', handleOrderUpdated);
    socketService.on('order:message', handleOrderMessage);
    socketService.on('user:payment-confirmation', handleUserPaymentConfirmation);

    return () => {
      socketService.off('order:updated', handleOrderUpdated);
      socketService.off('order:message', handleOrderMessage);
      socketService.off('user:payment-confirmation', handleUserPaymentConfirmation);
    };
  }, [id, user, hideCustomerIdentity]);

  const handleCompleteOrder = async () => {
    // Показываем модальное окно для ввода данных
    setShowCompletionModal(true);
  };

  const handleConfirmCompletion = async () => {
    try {
      setCompletingOrder(true);
      const formData = new FormData();
      
      if (order.dir === 'BUY') {
        const cleanHash = transactionHash.trim();
        if (!cleanHash) {
          toast.error('Введите хеш транзакции');
          setCompletingOrder(false);
          return;
        }
        
        // Валидация хеша
        if (cleanHash.length < 40 || cleanHash.length > 120) {
          toast.error('Хеш транзакции должен содержать от 40 до 120 символов');
          setCompletingOrder(false);
          return;
        }
        
        if (!/^[a-fA-F0-9]+$/.test(cleanHash)) {
          toast.error('Хеш транзакции должен содержать только цифры и буквы a-f');
          setCompletingOrder(false);
          return;
        }
        
        formData.append('transactionHash', cleanHash);
      } else if (order.dir === 'SELL') {
        if (!receiptFile) {
          toast.error('Прикрепите фото чека');
          setCompletingOrder(false);
          return;
        }
        formData.append('receipt', receiptFile);
      }

      const response = await dealsApi.completeDeal(id, formData);
      toast.success('Заявка завершена');
      console.log(response);

      setOrder(response.data.orderDetails);
      setShowCompletionModal(false);
      setTransactionHash('');
      setReceiptFile(null);
    } catch (error) {
      console.error('Complete order error:', error);
      console.error('Error response:', error.response);

      let errorMessage = 'Неизвестная ошибка';

      if (error.response) {
        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          } else if (error.response.data.message) {
            errorMessage = error.response.data.message;
          } else if (error.response.data.error) {
            errorMessage = error.response.data.error;
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(`Ошибка при завершении заявки: ${errorMessage}`);
    } finally {
      setCompletingOrder(false);
    }
  };

  const handleConfirmPayment = async () => {
    const confirmed = await confirm({
      title: 'Подтверждение оплаты',
      message: 'Вы уверены, что хотите подтвердить оплату?',
      confirmText: 'Подтвердить',
      cancelText: 'Отмена',
      type: 'success'
    });

    if (!confirmed) return;

    try {
      const response = await dealsApi.confirmPayment(id);
      toast.success('Оплата подтверждена');
      setOrder(response.data.orderDetails);
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Неизвестная ошибка';
      toast.error(`Ошибка при подтверждении оплаты: ${errorMessage}`);
      console.error('Confirm payment error:', error);
    }
  };

  const handleCancelOrder = async () => {
    if (operatorCancelBlockReason) {
      toast.error(operatorCancelBlockReason);
      return;
    }

    const confirmed = await confirm({
      title: 'Отмена заявки',
      message: 'Вы уверены, что хотите отменить заявку?',
      confirmText: 'Отменить',
      cancelText: 'Назад',
      type: 'danger'
    });

    if (!confirmed) return;

    try {
      const response = await ordersApi.cancelOrder(id, { reason: 'Отменено оператором' });
      toast.success('Заявка отменена');
      setOrder(response.data.orderDetails);
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Неизвестная ошибка';
      toast.error(`Ошибка при отмене заявки: ${errorMessage}`);
      console.error('Cancel order error:', error);
    }
  };

  const handleTakeOrder = async () => {
    const confirmed = await confirm({
      title: 'Взять заявку',
      message: 'Вы уверены, что хотите взять эту заявку в работу?',
      confirmText: 'Взять',
      cancelText: 'Отмена',
      type: 'info'
    });

    if (!confirmed) return;

    try {
      const response = await ordersApi.takeOrder(id);
      toast.success('Заявка назначена на вас');

      const orderResponse = await ordersApi.getOrderDetails(id);
      setOrder(orderResponse.data);
    } catch (error) {
      let errorMessage = 'Неизвестная ошибка';

      if (error.response) {
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.message) {
          errorMessage = error.response.data.message;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(`Ошибка при назначении заявки: ${errorMessage}`);
      console.error('Take order error:', error);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'CREATED': 'bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 dark:from-gray-700/50 dark:via-gray-600/50 dark:to-gray-700/50 text-gray-700 dark:text-gray-300 shadow-sm border border-gray-300/30 dark:border-gray-500/30',
      'AWAITING_CONFIRM': 'bg-gradient-to-r from-yellow-100 via-yellow-200 to-yellow-100 dark:from-yellow-900/40 dark:via-yellow-800/40 dark:to-yellow-900/40 text-yellow-800 dark:text-yellow-300 shadow-sm shadow-yellow-500/20 border border-yellow-300/30 dark:border-yellow-600/30',
      'QUEUED': 'bg-gradient-to-r from-blue-100 via-blue-200 to-blue-100 dark:from-blue-900/40 dark:via-blue-800/40 dark:to-blue-900/40 text-blue-800 dark:text-blue-300 shadow-sm shadow-blue-500/20 border border-blue-300/30 dark:border-blue-600/30',
      'PAYMENT_PENDING': 'bg-gradient-to-r from-orange-100 via-orange-200 to-orange-100 dark:from-orange-900/40 dark:via-orange-800/40 dark:to-orange-900/40 text-orange-800 dark:text-orange-300 shadow-sm shadow-orange-500/20 border border-orange-300/30 dark:border-orange-600/30',
      'COMPLETED': 'bg-gradient-to-r from-green-100 via-green-200 to-green-100 dark:from-green-900/40 dark:via-green-800/40 dark:to-green-900/40 text-green-800 dark:text-green-300 shadow-sm shadow-green-500/20 border border-green-300/30 dark:border-green-600/30',
      'CANCELLED': 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 shadow-sm shadow-red-500/20 border border-red-300/30 dark:border-red-600/30'
    };
    return colors[status] || 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-800';
  };

  const getStatusIcon = (status) => {
    const icons = {
      'CREATED': FileText,
      'AWAITING_CONFIRM': Clock,
      'QUEUED': RotateCw,
      'PAYMENT_PENDING': Zap,
      'COMPLETED': Check,
      'CANCELLED': XCircle
    };
    return icons[status] || FileText;
  };

  const getStatusText = (status) => {
    const texts = {
      'CREATED': 'Создана',
      'AWAITING_CONFIRM': 'Ожидает подтверждения',
      'QUEUED': 'В очереди',
      'PAYMENT_PENDING': 'Ожидание оплаты',
      'AWAITING_HASH': 'Ожидание хеша/чека',
      'COMPLETED': 'Завершена',
      'CANCELLED': 'Отменена'
    };
    return texts[status] || status;
  };

  const getHashExplorerUrl = () => {
    if (!order?.hash || !order?.coin) return null;

    if (order.coin === 'BTC') return `https://mempool.space/tx/${order.hash}`;
    if (order.coin === 'LTC') return `https://blockchair.com/litecoin/transaction/${order.hash}`;
    if (order.coin === 'XMR') return `https://xmrchain.net/tx/${order.hash}`;

    return null;
  };

  const getWorkingTime = () => {
    if (!order || !order.sla_started_at) {
      return null;
    }

    const startTime = new Date(order.sla_started_at);
    const endTime = order.completed_at ? new Date(order.completed_at) : currentTime;
    const diffMs = endTime - startTime;

    if (diffMs < 0) return null;

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


const isOperatorOnly = roleUpper === 'OPERATOR';
const isCompactOperatorBuyView = isOperatorBuyHidden;
const isManagerOrSuperAdmin = ['MANAGER', 'SUPERADMIN'].includes(roleUpper);
const showManagementBuySettlement = isManagerOrSuperAdmin && String(order?.dir || '').toUpperCase() === 'BUY';
const compactOperatorStatusText = (isCompactOperatorBuyView && order?.status === 'AWAITING_HASH')
  ? 'Ожидание оплаты'
  : getStatusText(order?.status);
const compactOperatorUsdtRate = (() => {
  if (!isCompactOperatorBuyView) return null;
  const rub = Number(order?.rub_to_receive ?? order?.sum_rub ?? 0);
  const usdt = Number(order?.usdt_due ?? 0);
  if (!Number.isFinite(rub) || !Number.isFinite(usdt) || rub <= 0 || usdt <= 0) return null;
  return Number((rub / usdt).toFixed(2));
})();
const managementUsdtRate = (() => {
  if (!showManagementBuySettlement) return null;
  const rub = Number(order?.rub_to_receive ?? order?.sum_rub ?? 0);
  const usdt = Number(order?.usdt_due ?? 0);
  if (!Number.isFinite(rub) || !Number.isFinite(usdt) || rub <= 0 || usdt <= 0) return null;
  return Number((rub / usdt).toFixed(2));
})();


  if (loading) {
    return (
      <PageTransition>
        <div className="space-y-6">
          <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
            <div className="relative px-6 py-5">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-48 animate-pulse"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mt-2 w-64 animate-pulse"></div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">Заявка </h1>
                  <div className="w-32 h-10 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  Детали заявки
                </h3>
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="flex justify-between">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 animate-pulse"></div>
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 animate-pulse"></div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                  Реквизиты
                </h3>
                <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden h-full flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-blue-500" />
                    Чат с пользователем
                  </h3>
                </div>
                <div className="flex-1 p-6 space-y-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                      <div className="w-2/3">
                        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24 mt-2 animate-pulse"></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (!order) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Заявка не найдена или у вас нет прав для её просмотра</h1>
        <button
          onClick={() => navigate('/orders')}
          className="btn-primary"
        >
          Вернуться к заявкам
        </button>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen flex flex-col space-y-6 pb-6">
        <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex-shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
          
          <div className="relative px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                    Заявка #{order.unique_id}
                  </h1>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                    Создана {new Date(order.created_at).toLocaleString('ru-RU')}
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate('/orders')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-all duration-300 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Назад</span>
                </button>

                {!order.support_id && (order.status === 'CREATED' || order.status === 'PAYMENT_PENDING') && (
                  <button
                    onClick={handleTakeOrder}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 hover:scale-105 active:scale-95"
                  >
                    Взять заявку
                  </button>
                )}

                {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                  <>
                    {(order.status === 'AWAITING_CONFIRM' || (order.dir === 'BUY' && order.status === 'PAYMENT_PENDING')) ? (
                      <button
                        onClick={handleConfirmPayment}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 hover:scale-105 active:scale-95"
                      >
                        <Check className="w-4 h-4" />
                        <span className="hidden sm:inline">Подтвердить оплату</span>
                      </button>
                    ) : (
                      !((order.dir === 'BUY') && !canCompleteBuyOrder) && (<button
                        onClick={handleCompleteOrder}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-md shadow-green-500/30 hover:shadow-lg hover:shadow-green-500/40 hover:scale-105 active:scale-95"
                      >
                        <Check className="w-4 h-4" />
                        <span className="hidden sm:inline">Завершить</span>
                      </button>)
                    )}
                    {canOperatorCancelCurrentOrder && (
                      <button
                        onClick={handleCancelOrder}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold rounded-xl transition-all duration-300 shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 hover:scale-105 active:scale-95"
                      >
                        <XCircle className="w-4 h-4" />
                        <span className="hidden sm:inline">Отменить</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      <OrderProgressBar currentStatus={order.status} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        <div className="lg:col-span-1 space-y-6 flex flex-col [&>div:nth-child(2)]:hidden">
          <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
            <div className="relative">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                Детали заявки
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Статус:</span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${getStatusColor(order.status)}`}>
                    {React.createElement(getStatusIcon(order.status), { className: 'w-3.5 h-3.5' })}
                    {compactOperatorStatusText}
                  </span>
                </div>
                {order.support_id && !isCompactOperatorBuyView && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Оператор:</span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
                      {order.support_username || order.support_login || order.support_name || `ID ${order.support_id}`}
                    </span>
                  </div>
                )}
                {order.sla_started_at && !isCompactOperatorBuyView && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Взята в работу:</span>
                    <span className="text-sm text-gray-700 dark:text-gray-400">{new Date(order.sla_started_at).toLocaleString('ru-RU')}</span>
                  </div>
                )}
                {order.completed_at && !isCompactOperatorBuyView && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Завершена:</span>
                    <span className="text-sm text-gray-700 dark:text-gray-400">{new Date(order.completed_at).toLocaleString('ru-RU')}</span>
                  </div>
                )}

                {getWorkingTime() && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Время в работе:</span>
                    <div className="flex flex-col items-end gap-1">
                      <AnimatedTimer 
                        time={getWorkingTime()} 
                        isCompleted={order.status === 'COMPLETED'}
                      />
                      {order.status === 'COMPLETED' && (
                        <div className="text-xs font-medium text-green-600 dark:text-green-500">выполнено</div>
                      )}
                      {order.status === 'PAYMENT_PENDING' && (
                        <div className="text-xs font-medium text-orange-600 dark:text-orange-500">в работе</div>
                      )}
                    </div>
                  </div>
                )}

                {!isCompactOperatorBuyView && (
                  <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent my-3"></div>
                )}

            {!isOperatorOnly && (
              <>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Пользователь:</span>
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.username || `ID ${order.user_id}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Telegram ID:</span>
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-400">{order.tg_id}</span>
                </div>
              </>
            )}
                {!isCompactOperatorBuyView && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Тип операции:</span>
                    <span className={`text-sm font-semibold ${order.dir === 'BUY' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {order.dir === 'BUY' ? 'Покупка' : 'Продажа'}
                    </span>
                  </div>
                )}
                {isOperatorBuyHidden ? (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Получить RUB:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
                        {Number(order.rub_to_receive ?? order.sum_rub ?? 0).toLocaleString('ru-RU')} {RUBLE_SIGN}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">USDT к выплате:</span>
                      <span className="text-sm font-mono font-semibold text-blue-700 dark:text-blue-300">
                        {order.usdt_due ? `${Number(order.usdt_due).toFixed(4)} USDT` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Курс USDT:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
                        {compactOperatorUsdtRate ? `${compactOperatorUsdtRate}` : '—'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Монета:</span>
                      <span className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400">{order.coin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Количество:</span>
                      <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-300">{parseFloat(order.amount_coin || 0).toFixed(8)} {order.coin}</span>
                    </div>
                    {order.user_crypto_address && (
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Адрес {order.dir === 'BUY' ? 'получения' : 'отправки'}:</span>
                        <span className="text-xs font-mono break-all text-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50 px-2 py-1 rounded">
                          {order.user_crypto_address}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {showManagementBuySettlement && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2 mt-3">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Оператор отдаёт USDT:</span>
                      <span className="text-sm font-mono font-semibold text-blue-700 dark:text-blue-300">
                        {order.usdt_due ? `${Number(order.usdt_due).toFixed(4)} USDT` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Курс USDT для оператора:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
                        {managementUsdtRate ? `${managementUsdtRate}` : '—'}
                      </span>
                    </div>
                  </div>
                )}

                {!isCompactOperatorBuyView && (
                  <>
                    <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent my-3"></div>

                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Курс:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{parseFloat(order.rate_rub).toLocaleString('ru-RU')} {RUBLE_SIGN}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Комиссия:</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-400">{(parseFloat(order.fee) * 100).toFixed(2)}%</span>
                    </div>
                    {order.ref_percent > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Реферальная:</span>
                        <span className="text-sm font-medium text-purple-600 dark:text-purple-400">{(parseFloat(order.ref_percent) * 100).toFixed(2)}%</span>
                      </div>
                    )}
                    {order.user_discount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-500">Скидка:</span>
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">-{(parseFloat(order.user_discount) * 100).toFixed(2)}%</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-3 border-t-2 border-gray-200 dark:border-gray-700">
                      <span className="text-base font-semibold text-gray-800 dark:text-gray-300">Итого:</span>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-200">{parseFloat(order.sum_rub).toLocaleString('ru-RU')} {RUBLE_SIGN}</span>
                    </div>
                  </>
                )}
                {/* Хеш транзакции для завершенных покупок */}
                {!isOperatorRole && order.status === 'COMPLETED' && order.dir === 'BUY' && order.hash && (
                  <>
                    <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent my-3"></div>
                    <div className="flex flex-col gap-2 bg-green-50 dark:bg-green-900/20 p-3 rounded-xl border border-green-200 dark:border-green-700/50">
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Хеш транзакции
                      </span>
                      <span className="text-xs font-mono break-all text-gray-800 dark:text-gray-300 bg-white dark:bg-gray-800/50 px-3 py-2 rounded-lg border border-green-200 dark:border-green-700/30">
                        {order.hash}
                      </span>
                      {getHashExplorerUrl() && (
                        <a
                          href={getHashExplorerUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                        >
                          Посмотреть в блокчейн-эксплорере →
                        </a>
                      )}
                    </div>
                  </>
                )}

                {/* Фото чека или PDF для завершенных продаж */}
                {order.status === 'COMPLETED' && order.dir === 'SELL' && order.receipt_path && (
                  <>
                    <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent my-3"></div>
                    <div className="flex flex-col gap-3 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-200 dark:border-blue-700/50">
                      <span className="text-sm font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Чек об оплате
                      </span>
                      {order.receipt_path.toLowerCase().endsWith('.pdf') ? (
                        <div 
                          className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800/50 rounded-lg border border-blue-200 dark:border-blue-700/30 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors"
                          onClick={() => window.open(getUploadUrl(order.receipt_path, 'receipts'), '_blank')}
                        >
                          <div className="flex-shrink-0 w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-red-600 dark:text-red-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-300">PDF документ</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Нажмите для открытия</p>
                          </div>
                          <div className="flex-shrink-0">
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div 
                          className="relative group cursor-pointer"
                          onClick={() => window.open(getUploadUrl(order.receipt_path, 'receipts'), '_blank')}
                        >
                          <img
                            src={getUploadUrl(order.receipt_path, 'receipts')}
                            alt="Чек об оплате"
                            className="w-full h-auto rounded-lg border border-blue-200 dark:border-blue-700/30 hover:opacity-90 transition-opacity"
                          />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg pointer-events-none">
                            <span className="text-white text-sm font-medium bg-black/50 px-3 py-1 rounded">
                              Открыть в полном размере
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>


          <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-6 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-50/20 via-transparent to-pink-50/20 dark:from-purple-950/10 dark:via-transparent dark:to-pink-950/10 pointer-events-none"></div>
            <div className="relative">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Реквизиты</h3>

              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-3 uppercase tracking-wide">Реквизиты клиента</h4>
                <div className="space-y-2.5">
                  {isOperatorBuyHidden ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      *****
                    </div>
                  ) : (
                    order.dir === 'BUY' && order.user_crypto_address && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Crypto-адрес ({order.coin}):</span>
                        <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-300 break-all bg-gray-100 dark:bg-gray-800/50 px-2 py-1 rounded">
                          {order.user_crypto_address}
                        </span>
                      </div>
                    )
                  )}
                  {order.dir === 'SELL' && (
                    <>
                      {order.user_card_number && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер карты:</span>
                          <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.user_card_number}</span>
                        </div>
                      )}
                      {order.user_card_holder && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Держатель карты:</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.user_card_holder}</span>
                        </div>
                      )}
                      {order.user_bank_name && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Банк:</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.user_bank_name}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent my-4"></div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-3 uppercase tracking-wide">Реквизиты обменника</h4>
                {canShowRequisitesForm ? (
                  <div className="mt-4">
                    <BotRequisiteForm
                      orderId={order.id}
                      botId={order.bot_id}
                      supportId={user?.id}
                      operationType={order.dir}
                      coin={order.coin}
                      onSuccess={async () => {
                        try {
                          const response = await ordersApi.getOrderDetails(id);
                          setOrder(response.data);
                          if (showRequisitesModal) {
                            await loadRequisitesHistory();
                          }
                        } catch (error) {
                          console.error('Error refreshing order:', error);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {order.exch_card_number && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер карты:</span>
                        <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.exch_card_number}</span>
                      </div>
                    )}
                    {order.exch_sbp_phone && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер СБП:</span>
                        <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.exch_sbp_phone}</span>
                      </div>
                    )}
                    {order.exch_card_holder && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Держатель карты:</span>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.exch_card_holder}</span>
                      </div>
                    )}
                    {order.exch_bank_name && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Банк:</span>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.exch_bank_name}</span>
                      </div>
                    )}
                    {order.exch_crypto_address && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Crypto-адрес ({order.coin}):</span>
                        <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-300 break-all bg-gray-100 dark:bg-gray-800/50 px-2 py-1 rounded">
                          {order.exch_crypto_address}
                        </span>
                      </div>
                    )}
                    {order.exch_label && order.dir === 'BUY' && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Комментарий:</span>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-300">{order.exch_label}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Chat and Progress Section */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {showSplitManagerChats ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <OrderChat
                orderId={id}
                order={order}
                currentUser={user}
                onOpenRequisites={() => setShowRequisitesModal(true)}
                showChatTabs={false}
              />
              <OperatorManagerChat
                operatorId={managerChatOperatorId}
                currentUser={user}
                title="Чат с оператором"
                showChatTabs={false}
                orderContextEnabled={true}
                linkedOrder={{
                  id: Number(order?.id || id),
                  uniqueId: Number(order?.unique_id || 0) || null,
                  sumRub: Number(order?.sum_rub || 0)
                }}
                onOpenRequisites={() => setShowRequisitesModal(true)}
                showRequisitesButton={showOperatorRequisitesQuickAction}
                hasExchangerRequisites={hasExchangerRequisites}
              />
            </div>
          ) : (
            <div className="flex">
              {(canOpenManagerChat && (activeChatTab === 'manager' || !canOpenClientChat)) ? (
                <OperatorManagerChat
                  operatorId={managerChatOperatorId}
                  currentUser={user}
                  title={isOperatorRole ? 'Чат с менеджером' : 'Чат с оператором'}
                  showChatTabs={canShowChatTabs}
                  activeTab={activeChatTab}
                  onSwitchTab={setActiveChatTab}
                  orderContextEnabled={true}
                  linkedOrder={{
                    id: Number(order?.id || id),
                    uniqueId: Number(order?.unique_id || 0) || null,
                    sumRub: Number(order?.sum_rub || 0)
                  }}
                  onOpenRequisites={() => setShowRequisitesModal(true)}
                  showRequisitesButton={showOperatorRequisitesQuickAction}
                  hasExchangerRequisites={hasExchangerRequisites}
                />
              ) : (
                <OrderChat 
                  orderId={id} 
                  order={order}
                  currentUser={user}
                  onOpenRequisites={() => setShowRequisitesModal(true)}
                  showChatTabs={canShowChatTabs}
                  activeTab={activeChatTab}
                  onSwitchTab={setActiveChatTab}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {showRequisitesModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] p-4 overflow-hidden"
          onClick={() => setShowRequisitesModal(false)}
        >
          <div
            className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Реквизиты</h3>
              <button
                type="button"
                onClick={() => setShowRequisitesModal(false)}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300"
              >
                Закрыть
              </button>
            </div>

            <div className="p-6 flex-1 min-h-0 overflow-y-auto space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-3 uppercase tracking-wide">Реквизиты клиента</h4>
                <div className="space-y-2.5">
                  {isOperatorBuyHidden ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">*****</div>
                  ) : (
                    order.dir === 'BUY' && order.user_crypto_address && (
                      <div>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Crypto-адрес ({order.coin}):</span>
                        <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-300 break-all bg-gray-100 dark:bg-gray-800/50 px-2 py-1 rounded">
                          {order.user_crypto_address}
                        </span>
                      </div>
                    )
                  )}

                  {order.dir === 'SELL' && (
                    <>
                      {order.user_card_number && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер карты:</span>
                          <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.user_card_number}</span>
                        </div>
                      )}
                      {order.user_card_holder && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Держатель карты:</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.user_card_holder}</span>
                        </div>
                      )}
                      {order.user_bank_name && (
                        <div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Банк:</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.user_bank_name}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent" />

              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-3 uppercase tracking-wide">Реквизиты обменника</h4>
                <div className="flex items-center justify-between gap-3 mb-3">
                  
                  {canShowRequisitesForm && (
                    <button
                      type="button"
                      onClick={() => setShowRequisitesEditForm((prev) => !prev)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-indigo-300 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/30 transition-colors"
                    >
                      {showRequisitesEditForm ? 'Скрыть форму' : 'Изменить реквизиты'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {order.exch_card_number && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер карты:</span>
                      <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.exch_card_number}</span>
                    </div>
                  )}
                  {order.exch_sbp_phone && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Номер СБП:</span>
                      <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-300">{order.exch_sbp_phone}</span>
                    </div>
                  )}
                  {order.exch_card_holder && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Держатель карты:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.exch_card_holder}</span>
                    </div>
                  )}
                  {order.exch_bank_name && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Банк:</span>
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">{order.exch_bank_name}</span>
                    </div>
                  )}
                  {order.exch_crypto_address && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Crypto-адрес ({order.coin}):</span>
                      <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-300 break-all bg-gray-100 dark:bg-gray-800/50 px-2 py-1 rounded">
                        {order.exch_crypto_address}
                      </span>
                    </div>
                  )}
                  {order.exch_label && order.dir === 'BUY' && (
                    <div>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-500 block mb-1">Комментарий:</span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-300">{order.exch_label}</span>
                    </div>
                  )}
                </div>

                {canShowRequisitesForm && showRequisitesEditForm && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <BotRequisiteForm
                      orderId={order.id}
                      botId={order.bot_id}
                      supportId={user?.id}
                      operationType={order.dir}
                      coin={order.coin}
                      onSuccess={async () => {
                        try {
                          const response = await ordersApi.getOrderDetails(id);
                          setOrder(response.data);
                          await loadRequisitesHistory();
                          setShowRequisitesEditForm(false);
                        } catch (error) {
                          console.error('Error refreshing order:', error);
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-600 to-transparent" />

              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-400 mb-3 uppercase tracking-wide">
                  История отправки реквизитов
                </h4>

                {requisitesHistoryLoading ? (
                  <div className="space-y-2">
                    <div className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                  </div>
                ) : requisitesHistory.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    История пока пустая
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requisitesHistory.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-900/10 px-3 py-2.5"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-2">
                          {item.createdAt.toLocaleString('ru-RU')}
                        </div>
                        {item.comment ? (
                          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1.5">
                            "{item.comment}"
                          </div>
                        ) : null}
                        {item.account && item.bank && item.holder ? (
                          <>
                            <div className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
                              {item.account}
                            </div>
                            <div className="text-sm text-gray-800 dark:text-gray-200 mt-1">
                              {item.bank}
                            </div>
                            <div className="text-sm text-gray-800 dark:text-gray-200 mt-1">
                              {item.holder}
                            </div>
                          </>
                        ) : (
                          <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans">
                            {item.rawText}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Completion Modal */}
      {showCompletionModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-purple-50/30 dark:from-blue-950/20 dark:via-transparent dark:to-purple-950/20 rounded-2xl pointer-events-none"></div>
            
            <div className="relative">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                <Check className="w-6 h-6 text-green-500" />
                Завершение заявки
              </h3>

              {order.dir === 'BUY' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Хеш транзакции
                    </label>
                    <input
                      type="text"
                      value={transactionHash}
                      onChange={(e) => setTransactionHash(e.target.value)}
                      placeholder="Введите хеш транзакции..."
                      className={`w-full px-4 py-3 bg-white dark:bg-gray-800 border rounded-xl focus:ring-2 focus:border-transparent transition-all duration-200 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 ${
                        transactionHash && (transactionHash.length < 40 || transactionHash.length > 120 || !/^[a-fA-F0-9]+$/.test(transactionHash.trim()))
                          ? 'border-red-300 dark:border-red-600 focus:ring-red-500'
                          : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
                      }`}
                      autoFocus
                    />
                    {transactionHash && (transactionHash.length < 40 || transactionHash.length > 120) && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        Хеш должен содержать от 40 до 120 символов (текущая длина: {transactionHash.length})
                      </p>
                    )}
                    {transactionHash && transactionHash.length >= 40 && transactionHash.length <= 120 && !/^[a-fA-F0-9]+$/.test(transactionHash.trim()) && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                        Хеш должен содержать только цифры и буквы a-f
                      </p>
                    )}
                    {(!transactionHash || (transactionHash.length >= 40 && transactionHash.length <= 120 && /^[a-fA-F0-9]+$/.test(transactionHash.trim()))) && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Хеш транзакции будет отправлен пользователю в Telegram
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Фото чека или PDF файл
                    </label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => setReceiptFile(e.target.files[0])}
                        className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-gray-900 dark:text-gray-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-400"
                      />
                    </div>
                    {receiptFile && (
                      <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                        ✓ Выбран файл: {receiptFile.name}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Фото чека или PDF файл будут отправлены пользователю в Telegram
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCompletionModal(false);
                    setTransactionHash('');
                    setReceiptFile(null);
                  }}
                  disabled={completingOrder}
                  className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Отмена
                </button>
                <button
                  onClick={handleConfirmCompletion}
                  disabled={completingOrder || (order.dir === 'BUY' ? 
                    (!transactionHash.trim() || 
                     transactionHash.trim().length < 40 || 
                     transactionHash.trim().length > 120 || 
                     !/^[a-fA-F0-9]+$/.test(transactionHash.trim())) 
                    : !receiptFile)}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-green-500/30 flex items-center justify-center gap-2"
                >
                  {completingOrder ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Отправка...</span>
                    </>
                  ) : (
                    'Завершить'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageTransition>
  );
};

export default OrderDetailsPage;
