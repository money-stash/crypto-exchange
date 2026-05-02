import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { MessageCircle, Send, Wifi, WifiOff, ExternalLink, Plus, Paperclip, X, Ticket } from 'lucide-react';
import { couponsApi } from '../services/api';
import { useNavigate } from 'react-router-dom';
import api, { operatorManagerChatsApi } from '../services/api';
import socketService from '../services/socketService';

const RUBLE_SIGN = '\u20BD';
const managerChatFileCache = new Map();

const isImageAttachment = (pathValue) => {
  const normalized = String(pathValue || '').toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some((ext) => normalized.endsWith(ext));
};
const isPdfAttachment = (pathValue) => String(pathValue || '').toLowerCase().endsWith('.pdf');
const normalizeAttachmentFallbackMessage = (value) => {
  const text = String(value || '').trim();
  if (/^image$/i.test(text)) return 'Изображение';
  if (/^file$/i.test(text) || /^attachment$/i.test(text)) return 'Файл';
  return text;
};

const AuthenticatedImage = React.memo(({ attachmentsPath, alt, className, style, onClick }) => {
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!attachmentsPath) {
      setLoading(false);
      return;
    }

    const filename = attachmentsPath.split('/').pop();
    const cachedUrl = managerChatFileCache.get(filename);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setLoading(false);
      setError(false);
      return;
    }

    let mounted = true;
    const loadImage = async () => {
      try {
        setLoading(true);
        setError(false);
        const response = await api.get(`/uploads/chats/${filename}`, { responseType: 'blob' });
        const blob = new Blob([response.data]);
        const blobUrl = URL.createObjectURL(blob);
        managerChatFileCache.set(filename, blobUrl);
        if (mounted) {
          setImageUrl(blobUrl);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      mounted = false;
    };
  }, [attachmentsPath]);

  if (loading) {
    return (
      <div className={`${className} bg-gray-200 dark:bg-gray-700 animate-pulse flex items-center justify-center`} style={style}>
        <span className="text-xs text-gray-500 dark:text-gray-400">Загрузка...</span>
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className={`${className} bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 flex items-center justify-center`} style={style}>
        <span className="text-xs text-red-600 dark:text-red-400">Ошибка загрузки</span>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
    />
  );
});

const mapMessage = (msg) => ({
  id: msg.id,
  operator_id: Number(msg.operator_id || 0),
  manager_id: Number(msg.manager_id || 0),
  sender_type: String(msg.sender_type || '').toUpperCase(),
  sender_id: Number(msg.sender_id || 0),
  sender_login: msg.sender_login || '',
  message: normalizeAttachmentFallbackMessage(msg.message || ''),
  attachments_path: msg.attachments_path || null,
  order_id: msg.order_id ? Number(msg.order_id) : null,
  order_unique_id: msg.order_unique_id ? Number(msg.order_unique_id) : null,
  order_sum_rub: msg.order_sum_rub === null || msg.order_sum_rub === undefined
    ? null
    : Number(msg.order_sum_rub),
  timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
});

const MessageItem = React.memo(({
  message,
  isOwn,
  onOpenOrder,
  openImageAttachment,
  downloadAttachment
}) => {
  const bubbleClass = isOwn
    ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 rounded-br-md'
    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-200/50 dark:border-gray-700/50 shadow-lg rounded-bl-md';

  const resolvedOrderId = Number(message.order_id || 0);
  const resolvedOrderUniqueId = Number(message.order_unique_id || 0);
  const resolvedOrderSumRub =
    message.order_sum_rub === null || message.order_sum_rub === undefined
      ? null
      : Number(message.order_sum_rub);
  const hasOrderLinkByData = Number.isInteger(resolvedOrderId) && resolvedOrderId > 0;
  const hasOrderLink = hasOrderLinkByData;
  const orderCode = resolvedOrderUniqueId > 0 ? resolvedOrderUniqueId : resolvedOrderId;
  const hasOrderSum = Number.isFinite(resolvedOrderSumRub);
  const orderLabel = hasOrderSum
    ? `#${orderCode} | ${resolvedOrderSumRub.toLocaleString('ru-RU')} ${RUBLE_SIGN}`
    : `#${orderCode}`;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-xs lg:max-w-md">
        <div className={`px-4 py-3 rounded-2xl ${bubbleClass}`}>
          {hasOrderLink ? (
            <div className="flex items-center justify-between gap-2 mb-1.5">
              {!isOwn && message.sender_login ? (
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {message.sender_login}
                </p>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => onOpenOrder?.(resolvedOrderId)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                  isOwn
                    ? 'bg-white/15 hover:bg-white/25 text-white border-white/30'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-200 dark:border-indigo-700/60'
                }`}
                title="Открыть заявку"
              >
                <ExternalLink className="w-3 h-3" />
                {orderLabel}
              </button>
            </div>
          ) : (
            !isOwn && message.sender_login && (
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                {message.sender_login}
              </p>
            )
          )}
          <p data-no-ui-translate="true" className="text-sm leading-relaxed whitespace-pre-line break-words">{message.message}</p>
          {message.attachments_path && (
            <div className="mt-3 pt-3 border-t border-gray-200/30 dark:border-gray-600/30">
              {isImageAttachment(message.attachments_path) ? (
                <div className="relative group">
                  <AuthenticatedImage
                    attachmentsPath={message.attachments_path}
                    alt="Изображение"
                    className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-shadow duration-200"
                    style={{ maxHeight: '220px' }}
                    onClick={() => openImageAttachment?.(message.attachments_path)}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors duration-200 flex items-center justify-center pointer-events-none">
                    <span data-no-ui-translate="true" className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      Открыть
                    </span>
                  </div>
                </div>
              ) : isPdfAttachment(message.attachments_path) ? (
                <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800/50">
                  <div className="w-10 h-10 bg-red-100 dark:bg-red-800 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 18h12V6h-4V2H4v16zm-2 1V1a1 1 0 011-1h8.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-1 1H3a1 1 0 01-1-1z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p data-no-ui-translate="true" className="text-sm font-medium text-gray-900 dark:text-gray-200">
                      📎 PDF документ
                    </p>
                    <button
                      onClick={() => downloadAttachment?.(message.attachments_path)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline cursor-pointer bg-transparent border-none p-0"
                      data-no-ui-translate="true"
                    >
                      Скачать документ
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50">
                  <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 18h12V6h-4V2H4v16zm-2 1V1a1 1 0 011-1h8.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-1 1H3a1 1 0 01-1-1z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p data-no-ui-translate="true" className="text-sm font-medium text-gray-900 dark:text-gray-200">
                      📎 Файл
                    </p>
                    <button
                      onClick={() => downloadAttachment?.(message.attachments_path)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline cursor-pointer bg-transparent border-none p-0"
                      data-no-ui-translate="true"
                    >
                      Скачать файл
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className={`text-xs mt-2 font-semibold ${isOwn ? 'text-blue-100/90' : 'text-gray-500 dark:text-gray-400'}`}>
            {message.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
});

const OperatorManagerChat = ({
  operatorId,
  currentUser,
  title = 'Чат с менеджером',
  fullHeight = true,
  showChatTabs = false,
  activeTab = 'manager',
  onSwitchTab = null,
  linkedOrder = null,
  onOpenRequisites = null,
  showRequisitesButton = false,
  hasExchangerRequisites = false,
  orderContextEnabled = false
}) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [noManagerAssigned, setNoManagerAssigned] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const [showCouponForm, setShowCouponForm] = useState(false);
  const [couponForm, setCouponForm] = useState({ brand: 'promo', discount_rub: '', max_uses: 1 });
  const [creatingCoupon, setCreatingCoupon] = useState(false);
  const messagesContainerRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const roleUpper = String(currentUser?.role || '').toUpperCase();
  const isManagerOrSuperAdminRole = roleUpper === 'MANAGER' || roleUpper === 'SUPERADMIN';
  // can_write_chat permission is only for client chat, not manager chat.
  const hideComposerForOperator = false;
  const canShowTabSwitcher = Boolean(showChatTabs && typeof onSwitchTab === 'function');
  const canShowRequisitesAction = Boolean(showRequisitesButton && typeof onOpenRequisites === 'function');
  const canShowCouponButton = Boolean(currentUser?.can_use_coupons) || roleUpper === 'SUPERADMIN';
  const navigate = useNavigate();

  const handleCreateCoupon = async () => {
    if (!couponForm.discount_rub || Number(couponForm.discount_rub) <= 0) {
      toast.error('Укажите скидку');
      return;
    }
    setCreatingCoupon(true);
    try {
      const res = await couponsApi.create({
        brand: couponForm.brand || 'promo',
        discount_rub: Number(couponForm.discount_rub),
        max_uses: Number(couponForm.max_uses) || 1,
      });
      const code = res.data.code;
      setNewMessage(prev => (prev ? prev + ' ' : '') + code);
      setShowCouponForm(false);
      setCouponForm({ brand: 'promo', discount_rub: '', max_uses: 1 });
      toast.success(`Промокод создан: ${code}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка создания промокода');
    } finally {
      setCreatingCoupon(false);
    }
  };

  const openOrder = useCallback((orderId) => {
    const normalizedOrderId = Number(orderId || 0);
    if (!normalizedOrderId) return;
    navigate(`/orders/${normalizedOrderId}`);
  }, [navigate]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Important: scroll only inside the chat container.
    // Using scrollIntoView can scroll the entire page in some layouts.
    container.scrollTop = container.scrollHeight;
  }, []);

  const getAuthenticatedFileUrl = useCallback(async (attachmentsPath) => {
    if (!attachmentsPath) return null;
    const filename = attachmentsPath.split('/').pop();
    if (managerChatFileCache.has(filename)) {
      return managerChatFileCache.get(filename);
    }

    try {
      const response = await api.get(`/uploads/chats/${filename}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const blobUrl = URL.createObjectURL(blob);
      managerChatFileCache.set(filename, blobUrl);
      return blobUrl;
    } catch (error) {
      console.error('Attachment load error:', error);
      return null;
    }
  }, []);

  const openImageAttachment = useCallback(async (attachmentsPath) => {
    const url = await getAuthenticatedFileUrl(attachmentsPath);
    if (!url) {
      toast.error('Ошибка открытия вложения');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [getAuthenticatedFileUrl]);

  const downloadAttachment = useCallback(async (attachmentsPath) => {
    try {
      const filename = attachmentsPath.split('/').pop();
      const response = await api.get(`/uploads/chats/${filename}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Attachment download error:', error);
      toast.error('Ошибка скачивания файла');
    }
  }, []);

  const validateAttachment = useCallback((file) => {
    if (!file) return 'Файл не выбран';
    if (file.size > 20 * 1024 * 1024) {
      return 'Размер файла не должен превышать 20MB';
    }
    return null;
  }, []);

  const onAttachmentPicked = useCallback((file) => {
    const validationError = validateAttachment(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSelectedAttachment(file);
  }, [validateAttachment]);

  const clearSelectedAttachment = useCallback(() => {
    setSelectedAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, []);

  const handleAttachmentInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAttachmentPicked(file);
    e.target.value = '';
  }, [onAttachmentPicked]);

  const handleTextareaPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    onAttachmentPicked(file);
    toast.info('Картинка добавлена из буфера обмена');
  }, [onAttachmentPicked]);

  const [selectedAttachmentPreviewUrl, setSelectedAttachmentPreviewUrl] = useState(null);

  useEffect(() => {
    if (!selectedAttachment || !String(selectedAttachment.type || '').startsWith('image/')) {
      setSelectedAttachmentPreviewUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedAttachment);
    setSelectedAttachmentPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedAttachment]);

  const markRead = useCallback(async () => {
    if (!operatorId || noManagerAssigned) return;
    try {
      await operatorManagerChatsApi.markAsRead(operatorId);
    } catch (error) {
      console.error('Mark operator-manager messages as read error:', error);
    }
  }, [operatorId, noManagerAssigned]);

  const loadMessages = useCallback(async () => {
    if (!operatorId) return;
    setLoading(true);
    try {
      const response = await operatorManagerChatsApi.getMessages(operatorId);
      const list = Array.isArray(response?.data?.messages)
        ? response.data.messages.map(mapMessage)
        : [];
      setMessages(list);
      setNoManagerAssigned(false);
      if (list.length > 0) {
        await markRead();
      }
    } catch (error) {
      if (error?.response?.status === 409) {
        setNoManagerAssigned(true);
        setMessages([]);
      } else {
        console.error('Load operator-manager messages error:', error);
        toast.error(error?.response?.data?.error || 'Ошибка загрузки чата с менеджером');
      }
    } finally {
      setLoading(false);
    }
  }, [operatorId, markRead]);

  useEffect(() => {
    socketService.connect();
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const checkConnection = () => setSocketConnected(socketService.isConnected());
    checkConnection();
    const interval = setInterval(checkConnection, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribeMessage = socketService.on('operator-manager-chat:message', (data) => {
      const incomingOperatorId = Number(data?.operator_id || 0);
      if (incomingOperatorId !== Number(operatorId || 0)) return;

      const incomingMessage = data?.message;
      if (!incomingMessage) return;

      setNoManagerAssigned(false);
      setMessages((prev) => {
        const exists = prev.some((msg) => Number(msg.id) === Number(incomingMessage.id));
        if (exists) return prev;
        return [...prev, mapMessage(incomingMessage)];
      });

      if (Number(incomingMessage.sender_id || 0) !== Number(currentUser?.id || 0)) {
        markRead();
      }
    });

    const unsubscribeAssignment = socketService.on('operator-manager-chat:assignment-updated', (data) => {
      const affectedOperatorId = Number(data?.operator_id || 0);
      if (affectedOperatorId !== Number(operatorId || 0)) return;
      loadMessages();
    });

    return () => {
      unsubscribeMessage();
      unsubscribeAssignment();
    };
  }, [operatorId, currentUser?.id, loadMessages, markRead]);

  useEffect(() => {
    if (loading || noManagerAssigned) return;
    const timerId = setTimeout(() => scrollToBottom(), 0);
    return () => clearTimeout(timerId);
  }, [loading, noManagerAssigned, operatorId, scrollToBottom]);

  useEffect(() => {
    if (loading || noManagerAssigned || messages.length === 0) return;
    const timerId = setTimeout(() => scrollToBottom(), 0);
    return () => clearTimeout(timerId);
  }, [messages.length, loading, noManagerAssigned, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = String(newMessage || '').trim();
    if (!text && !selectedAttachment) return;
    if (noManagerAssigned) {
      toast.error('В системе нет доступных менеджеров для чата');
      return;
    }

      const attachmentToSend = selectedAttachment;
      setSending(true);
      setNewMessage('');
      try {
      const payload = new FormData();
      payload.append('message', text);
      if (attachmentToSend) {
        payload.append('attachment', attachmentToSend);
      }
      const linkedOrderId = Number(linkedOrder?.id || 0);
      if (orderContextEnabled && linkedOrderId > 0) {
        payload.append('order_id', String(linkedOrderId));
      }

      const response = await operatorManagerChatsApi.sendMessage(operatorId, payload);
      const created = response?.data ? mapMessage(response.data) : null;
      if (created) {
        setMessages((prev) => {
          const exists = prev.some((item) => Number(item.id) === Number(created.id));
          return exists ? prev : [...prev, created];
        });
      }
      clearSelectedAttachment();
    } catch (error) {
      console.error('Send operator-manager message error:', error);
      toast.error(error?.response?.data?.error || 'Ошибка отправки сообщения');
      setNewMessage(text);
    } finally {
      setSending(false);
    }
  }, [
    newMessage,
    selectedAttachment,
    noManagerAssigned,
    operatorId,
    linkedOrder?.id,
    orderContextEnabled,
    clearSelectedAttachment
  ]);

  const sortedMessages = useMemo(() => [...messages], [messages]);
  const compactDialogClass = 'h-[40rem] max-h-[calc(100vh-12rem)]';
  const shouldUseCompactDialog = isManagerOrSuperAdminRole || !fullHeight;
  const chatHeightClass = shouldUseCompactDialog
    ? compactDialogClass
    : 'h-[calc(100vh-12rem)] max-h-[calc(100vh-12rem)]';
  const chatWidthClass = shouldUseCompactDialog ? 'max-w-5xl mx-auto' : '';

  return (
    <div className={`relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex flex-col w-full ${chatHeightClass} ${chatWidthClass}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>

      <div className="relative px-6 py-5 border-b border-gray-200/50 dark:border-gray-700/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
              {canShowTabSwitcher && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onSwitchTab('client')}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTab === 'client'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Чат с клиентом
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchTab('manager')}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTab === 'manager'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Чат с менеджером
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {socketConnected ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Wifi className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">Подключено</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <WifiOff className="w-4 h-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Подключение...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        className="relative flex-1 overflow-y-auto py-5 px-6 flex flex-col gap-3"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            Загрузка чата...
          </div>
        ) : noManagerAssigned ? (
          <div className="flex items-center justify-center h-full">
            <div className="max-w-md text-center px-6 py-5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-amber-800 dark:text-amber-300 text-sm">
              В системе нет доступных менеджеров для внутреннего чата.
            </div>
          </div>
        ) : sortedMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            Сообщений пока нет
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-3">
            {sortedMessages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                isOwn={Number(message.sender_id || 0) === Number(currentUser?.id || 0)}
                onOpenOrder={openOrder}
                openImageAttachment={openImageAttachment}
                downloadAttachment={downloadAttachment}
              />
            ))}
          </div>
        )}
      </div>

      {!hideComposerForOperator && (
        <div className="relative flex-shrink-0 px-6 py-5 border-t border-gray-200/50 dark:border-gray-700/50">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>

          <div className="relative flex gap-3 items-end">
            <div className="flex-1 min-w-0">
              {selectedAttachment && (
                <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-700/60 bg-blue-50/80 dark:bg-blue-900/20">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedAttachmentPreviewUrl ? (
                      <img
                        src={selectedAttachmentPreviewUrl}
                        alt="preview"
                        className="w-9 h-9 rounded-lg object-cover border border-blue-200 dark:border-blue-700/60 flex-shrink-0"
                      />
                    ) : (
                      <Paperclip className="w-4 h-4 text-blue-600 dark:text-blue-300 flex-shrink-0" />
                    )}
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-200 truncate">
                      {selectedAttachment.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearSelectedAttachment}
                    className="p-1 rounded-md text-blue-700 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                    title="Убрать вложение"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={sending || noManagerAssigned}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-lg text-gray-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Прикрепить файл"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onPaste={handleTextareaPaste}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Введите сообщение менеджеру..."
                  className="relative w-full pl-12 pr-4 py-[13px] leading-6 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border-2 border-gray-200 dark:border-gray-700 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
                  rows="1"
                  style={{ minHeight: '52px', maxHeight: '120px', height: '52px' }}
                  disabled={sending || noManagerAssigned}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                />
              </div>
              <input
                ref={attachmentInputRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                onChange={handleAttachmentInputChange}
              />
            </div>

            {canShowCouponButton && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCouponForm(v => !v)}
                  className="group relative h-[56px] w-[56px] overflow-hidden bg-purple-500 hover:bg-purple-600 text-white rounded-2xl font-semibold transition-all duration-300 shadow-lg flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95"
                  title="Создать промокод"
                >
                  <Ticket className="w-5 h-5 relative z-10" />
                </button>
                {showCouponForm && (
                  <div className="absolute bottom-14 right-0 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4 z-50 space-y-3">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🎟 Создать промокод</p>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400">Бренд</label>
                      <input className="form-input w-full mt-0.5 text-sm py-1.5" value={couponForm.brand}
                        onChange={e => setCouponForm(f => ({ ...f, brand: e.target.value }))} placeholder="promo" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400">Скидка ₽</label>
                      <input className="form-input w-full mt-0.5 text-sm py-1.5" type="number" min="1" value={couponForm.discount_rub}
                        onChange={e => setCouponForm(f => ({ ...f, discount_rub: e.target.value }))} placeholder="500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400">Использований (0 = ∞)</label>
                      <input className="form-input w-full mt-0.5 text-sm py-1.5" type="number" min="0" value={couponForm.max_uses}
                        onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setShowCouponForm(false)}
                        className="flex-1 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        Отмена
                      </button>
                      <button onClick={handleCreateCoupon} disabled={creatingCoupon}
                        className="flex-1 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors">
                        {creatingCoupon ? '...' : 'Создать'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {canShowRequisitesAction && (
              <button
                type="button"
                onClick={onOpenRequisites}
                className={`group relative h-[56px] w-[56px] overflow-hidden text-white rounded-2xl font-semibold transition-all duration-300 shadow-lg disabled:shadow-sm disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95 ${
                  hasExchangerRequisites
                    ? 'bg-[#0e9d58] hover:bg-[#0b874c] hover:shadow-2xl hover:shadow-green-500/40'
                    : 'bg-[#ee760c] hover:bg-[#d86a0b] hover:shadow-2xl hover:shadow-orange-500/40'
                }`}
                title={hasExchangerRequisites ? 'Реквизиты отправлены' : 'Реквизиты не отправлены'}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <Plus className="w-5 h-5 relative z-10" />
              </button>
            )}
            <button
              onClick={sendMessage}
              disabled={sending || (!String(newMessage || '').trim() && !selectedAttachment) || noManagerAssigned}
              className="group relative h-[52px] w-[52px] overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:via-gray-400 disabled:to-gray-400 text-white rounded-2xl transition-all duration-300 shadow-lg disabled:shadow-sm disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
              title={sending ? 'Отправка...' : 'Отправить'}
            >
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Send className="w-5 h-5 relative z-10 group-hover:rotate-12 transition-transform duration-300" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperatorManagerChat;

