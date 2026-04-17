import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import { dealsApi, ordersApi, settingsApi } from '../services/api';
import socketService from '../services/socketService';
import api from '../services/api';
import { Send, MessageCircle, Wifi, WifiOff, Plus, Paperclip, X } from 'lucide-react';

// Глобальный кэш для файлов - ОДИН на все компоненты
const globalFileCache = new Map();
const FALLBACK_CHAT_QUICK_REPLIES = [
  'Жду оплату',
  'Какой банк?',
  'Проверьте, пожалуйста, перевод',
  'Отправьте, пожалуйста, чек',
  'Ожидайте, пожалуйста, 1-2 минуты'
];

const autoResizeTextarea = (target) => {
  if (!target) return;
  target.style.height = 'auto';
  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
};

// Компонент для отображения изображения с авторизацией - ВЫНЕСЕН НАРУЖУ
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
    
    // проверяем глобальный кэш
    const cachedUrl = globalFileCache.get(filename);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setLoading(false);
      setError(false);
      return;
    }
    
    // загружаем ТОЛЬКО если нет в кэше
    let mounted = true;
    
    const loadImage = async () => {
      try {
        setLoading(true);
        setError(false);
        
        const response = await api.get(`/uploads/chats/${filename}`, {
          responseType: 'blob'
        });
        
        const blob = new Blob([response.data]);
        const blobUrl = URL.createObjectURL(blob);
        
        // сохраняем в глобальный кэш
        globalFileCache.set(filename, blobUrl);
        
        if (mounted) {
          setImageUrl(blobUrl);
          setLoading(false);
        }
      } catch (err) {
        console.error('Ошибка загрузки изображения:', err);
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

  const handleClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onClick && !loading && !error && imageUrl) {
      onClick();
    }
  }, [onClick, loading, error, imageUrl]);

  if (loading) {
    return (
      <div className={`${className} bg-gray-200 dark:bg-gray-700 animate-pulse flex items-center justify-center`} style={style}>
        <div className="text-gray-500 dark:text-gray-400 text-sm">Загрузка...</div>
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className={`${className} bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 flex items-center justify-center`} style={style}>
        <div className="text-red-600 dark:text-red-400 text-sm">Ошибка загрузки</div>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      style={style}
      onClick={handleClick}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.attachmentsPath === nextProps.attachmentsPath &&
         prevProps.className === nextProps.className &&
         prevProps.alt === nextProps.alt;
});

// Компонент для отображения вложений - ВЫНЕСЕН НАРУЖУ
const AttachmentDisplay = React.memo(({ attachmentsPath, openImageModal, downloadFile }) => {
  if (!attachmentsPath) return null;

  if (attachmentsPath.includes('.jpg') || 
      attachmentsPath.includes('.jpeg') || 
      attachmentsPath.includes('.png')) {
    // Отображение изображения
    return (
      <div className="relative group">
        <AuthenticatedImage
          attachmentsPath={attachmentsPath}
          alt="Изображение"
          className="max-w-full h-auto rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-shadow duration-200"
          style={{ maxHeight: '200px' }}
          onClick={() => openImageModal(attachmentsPath)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors duration-200 flex items-center justify-center pointer-events-none">
          <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Открыть
          </span>
        </div>
      </div>
    );
  } 
  
  if (attachmentsPath.includes('.pdf')) {
    // Отображение PDF
    return (
      <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800/50">
        <div className="w-10 h-10 bg-red-100 dark:bg-red-800 rounded-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 18h12V6h-4V2H4v16zm-2 1V1a1 1 0 011-1h8.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-200">
            📎 PDF документ
          </p>
          <button
            onClick={() => downloadFile(attachmentsPath)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline cursor-pointer bg-transparent border-none p-0"
          >
            Скачать документ
          </button>
        </div>
      </div>
    );
  }
  
  // Отображение других файлов
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700/50">
      <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 18h12V6h-4V2H4v16zm-2 1V1a1 1 0 011-1h8.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a1 1 0 01-1-1H3a1 1 0 01-1-1z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-200">
          📎 Файл
        </p>
        <button
          onClick={() => downloadFile(attachmentsPath)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium underline cursor-pointer bg-transparent border-none p-0"
        >
          Скачать файл
        </button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.attachmentsPath === nextProps.attachmentsPath;
});

// Компонент для отображения сообщения - ВЫНЕСЕН НАРУЖУ
const normalizeMessageText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};
const isInternalDebtServiceMessage = (message) => {
  if (Boolean(message?.internal_only)) {
    return true;
  }

  const text =
    normalizeMessageText(message?.original_message) ||
    normalizeMessageText(message?.message) ||
    normalizeMessageText(message?.translated_message);

  if (!text) return false;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Для стабильной детекции после reload:
  // служебка всегда хранится как ровно 4 непустые строки:
  // 1) заголовок, 2) счет/карта/телефон, 3) банк/описание, 4) ФИО
  if (lines.length !== 4) return false;

  const firstRaw = lines[0].trim();
  const secondRaw = lines[1]?.trim() || '';
  const thirdRaw = lines[2]?.trim() || '';
  const fourthRaw = lines[3]?.trim() || '';

  const hasQuotedHeader = /^["«»].+["«»]$/.test(firstRaw);
  const hasCardLikeLine = /\d{4}(?:[\s-]?\d{4}){3}/.test(secondRaw);
  const hasPhoneLikeLine = /\+?\d[\d\s()-]{9,}/.test(secondRaw);
  const hasAccountLine = hasCardLikeLine || hasPhoneLikeLine;
  const hasThirdLine = thirdRaw.length > 0 && !/[<>]/.test(thirdRaw);
  const hasPersonLikeLine = /[A-Za-zА-ЯЁа-яё]{2,}\s+[A-Za-zА-ЯЁа-яё]{2,}/.test(fourthRaw);

  // Шапка либо в кавычках, либо просто короткая строка без цифр (устойчиво к артефактам кодировки).
  const hasHeaderShape = hasQuotedHeader || (firstRaw.length >= 2 && firstRaw.length <= 40 && !/\d/.test(firstRaw));

  return hasHeaderShape && hasAccountLine && hasThirdLine && hasPersonLikeLine;
};
const getOperatorVisibleMessageText = (message, viewerLanguage) => {
  const preferredLanguage = String(viewerLanguage || 'RU').toUpperCase();
  if (preferredLanguage === 'EN') {
    if (String(message.sender_type || '').toUpperCase() === 'OPERATOR') {
      return normalizeMessageText(message.original_message) || normalizeMessageText(message.message);
    }
    return (
      normalizeMessageText(message.translated_message) ||
      normalizeMessageText(message.message) ||
      normalizeMessageText(message.original_message)
    );
  }
  return (
    normalizeMessageText(message.message) ||
    normalizeMessageText(message.original_message) ||
    normalizeMessageText(message.translated_message)
  );
};
const getMessageViewData = (message, viewerRole, viewerLanguage) => {
  const role = String(viewerRole || '').toUpperCase();
  const originalText = normalizeMessageText(message.original_message);
  const translatedText = normalizeMessageText(message.translated_message);
  if (role === 'OPERATOR') {
    return {
      mode: 'single',
      text: getOperatorVisibleMessageText(message, viewerLanguage),
      originalText: '',
      translatedText: ''
    };
  }
  const canSeeBoth = role === 'SUPERADMIN' || role === 'MANAGER';
  if (canSeeBoth && originalText && translatedText && originalText !== translatedText) {
    return {
      mode: 'dual',
      text: '',
      originalText,
      translatedText
    };
  }
  return {
    mode: 'single',
    text: normalizeMessageText(message.message) || originalText || translatedText,
    originalText: '',
    translatedText: ''
  };
};
// ????????? ??? ??????????? ?????????
const MessageItem = React.memo(({
  message,
  isNewMessage,
  isOperator,
  openImageModal,
  downloadFile,
  viewerRole,
  viewerLanguage
}) => {
  const isOperatorViewer = String(viewerRole || '').toUpperCase() === 'OPERATOR';
  const viewData = getMessageViewData(message, viewerRole, viewerLanguage);
  const isServiceMessage = isInternalDebtServiceMessage(message);
  const bubbleFromOperator = isOperator && !isServiceMessage;
  const bubbleClass = isServiceMessage
    ? 'bg-[#ffeeda] dark:bg-amber-950/55 text-gray-900 dark:text-amber-100 border border-[#f3cfae] dark:border-amber-700/70 shadow-lg shadow-amber-200/40 dark:shadow-amber-950/50 hover:shadow-xl'
    : bubbleFromOperator
      ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40'
      : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-200/50 dark:border-gray-700/50 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50 hover:shadow-xl';
  const timestampClass = isServiceMessage
    ? 'text-amber-700/90 dark:text-amber-300/90'
    : bubbleFromOperator
      ? 'text-blue-100/90'
      : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      className={`flex ${bubbleFromOperator ? 'justify-end' : 'justify-start'} ${isNewMessage ? 'animate-message-slide-in' : ''}`}
    >
      <div className="relative max-w-xs lg:max-w-md">
        <div className="relative">
          <div
            className={`px-5 py-3.5 rounded-2xl transition-all duration-200 ${bubbleClass} ${bubbleFromOperator ? 'rounded-br-md' : 'rounded-bl-md'}`}
          >
            {isServiceMessage && (
              <p
                className="text-[11px] uppercase tracking-wide font-semibold mb-2 text-amber-700 dark:text-amber-300"
              >
                Служебное сообщение
              </p>
            )}

            {viewData.mode === 'dual' ? (
              <div className="space-y-2">
                <div>
                  
                  <p data-no-ui-translate="true" className="text-sm leading-relaxed break-words whitespace-pre-line font-medium">{viewData.originalText}</p>
                </div>
                <div>
                  <p className={`text-[11px] uppercase tracking-wide font-semibold ${bubbleFromOperator ? 'text-blue-100/90' : 'text-gray-500 dark:text-gray-400'}`}>
                    Перевод
                  </p>
                  <p data-no-ui-translate="true" className="text-sm leading-relaxed break-words whitespace-pre-line font-medium">{viewData.translatedText}</p>
                </div>
              </div>
            ) : (
              <p
                {...(!isOperatorViewer ? { 'data-no-ui-translate': 'true' } : {})}
                className="text-sm leading-relaxed break-words whitespace-pre-line font-medium"
              >
                {viewData.text}
              </p>
            )}

            {message.attachments_path && (
              <div className="mt-3 pt-3 border-t border-gray-200/30 dark:border-gray-600/30">
                <AttachmentDisplay
                  attachmentsPath={message.attachments_path}
                  openImageModal={openImageModal}
                  downloadFile={downloadFile}
                />
              </div>
            )}

            <p className={`text-xs mt-2 font-semibold ${timestampClass}`}>
              {message.timestamp.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.message.id === nextProps.message.id &&
         prevProps.isNewMessage === nextProps.isNewMessage &&
         prevProps.isOperator === nextProps.isOperator &&
         prevProps.message.message === nextProps.message.message &&
         prevProps.message.original_message === nextProps.message.original_message &&
         prevProps.message.translated_message === nextProps.message.translated_message &&
         prevProps.message.internal_only === nextProps.message.internal_only &&
         prevProps.message.sender_type === nextProps.message.sender_type &&
         prevProps.message.attachments_path === nextProps.message.attachments_path &&
         prevProps.message.timestamp?.getTime() === nextProps.message.timestamp?.getTime() &&
         prevProps.viewerRole === nextProps.viewerRole &&
         prevProps.viewerLanguage === nextProps.viewerLanguage;
});
const OrderChat = ({
  orderId,
  order,
  currentUser,
  onOpenRequisites,
  showChatTabs = false,
  activeTab = 'client',
  onSwitchTab = null
}) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [newMessageIds, setNewMessageIds] = useState(new Set());
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedAttachment, setSelectedAttachment] = useState(null);
  const messagesEndRef = useRef(null);
  const audioRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const quickRepliesWrapperRef = useRef(null);
  const quickRepliesHideTimeoutRef = useRef(null);
  const textareaRef = useRef(null);
  const [quickRepliesMenuOpen, setQuickRepliesMenuOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState(FALLBACK_CHAT_QUICK_REPLIES);

  // Объявляем функции сначала
  const markMessagesAsRead = useCallback(async () => {
    try {
      await ordersApi.markMessagesRead(orderId);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }, [orderId]);

  const loadMessages = useCallback(async () => {
    try {
      const response = await dealsApi.getMessages(orderId);
      const formattedMessages = response.data.map(msg => ({
        id: msg.id,
        sender: msg.sender_type.toLowerCase(),
        sender_type: msg.sender_type,
        message: msg.message,
        internal_only: Boolean(msg.internal_only) || isInternalDebtServiceMessage(msg),
        original_message: msg.original_message,
        translated_message: msg.translated_message,
        source_lang: msg.source_lang,
        translated_at: msg.translated_at ? new Date(msg.translated_at) : null,
        attachments_path: msg.attachments_path,
        timestamp: new Date(msg.created_at)
      }));
      
      setMessages(formattedMessages);
      
      // помечаем сообщения как прочитанные
      if (formattedMessages.length > 0) {
        await markMessagesAsRead();
      }
    } catch (error) {
      console.error('Load messages error:', error);
      setMessages([]);
    }
  }, [orderId, markMessagesAsRead]);

  const handleMessageReceived = useCallback((data) => {
    console.log('📨 [OrderChat] Message received:', data);
    console.log('📨 [OrderChat] Comparing orderId:', data.orderId, 'with current:', orderId);
    
    // приводим оба к числам для сравнения
    if (parseInt(data.orderId) === parseInt(orderId)) {
      // проверяем что сообщения еще нет, чтобы избежать дублей
      setMessages(prev => {
        const exists = prev.some(m => m.id === data.message.id);
        if (exists) {
          console.log('📨 [OrderChat] Message already exists, skipping');
          return prev;
        }
        
        const newMsg = {
          id: data.message.id,
          sender: data.message.sender_type.toLowerCase(),
          sender_type: data.message.sender_type,
          message: data.message.message,
          internal_only: Boolean(data.message.internal_only),
          original_message: data.message.original_message,
          translated_message: data.message.translated_message,
          source_lang: data.message.source_lang,
          translated_at: data.message.translated_at ? new Date(data.message.translated_at) : null,
          attachments_path: data.message.attachments_path,
          timestamp: new Date(data.message.created_at)
        };
        
        console.log('📨 [OrderChat] Adding received message to chat:', newMsg);
        
        // помечаем сообщение как новое для анимации
        setNewMessageIds(prev => new Set([...prev, newMsg.id]));
        
        // убираем класс анимации когда она закончится
        setTimeout(() => {
          setNewMessageIds(prev => {
            const updated = new Set(prev);
            updated.delete(newMsg.id);
            return updated;
          });
        }, 500);
        
        // если сообщение от юзера (не от текущего оператора), показываем уведомление
        if (data.message.sender_type !== 'OPERATOR') {
          setHasNewMessages(true);
          setUnreadCount(c => c + 1);
          toast.info('Новое сообщение от пользователя');
          
          // проигрываем звук уведомления
          if (audioRef.current) {
            try {
              audioRef.current();
            } catch (error) {
              console.log('Could not play notification sound:', error);
            }
          }
        }
        
        return [...prev, newMsg];
      });
    } else {
      console.log('📨 [OrderChat] Message is for different order, ignoring');
    }
  }, [orderId]);

  const handleMessageSent = useCallback((data) => {
    console.log('📤 [OrderChat] Message sent event received:', data);
    
    // приводим оба к числам для сравнения
    if (parseInt(data.orderId) === parseInt(orderId)) {
      // всегда проверяем что сообщения еще нет, чтобы не было дублей
      setMessages(prev => {
        const exists = prev.some(m => m.id === data.message.id);
        if (exists) {
          console.log('📤 [OrderChat] Message already exists, skipping');
          return prev;
        }
        
        const newMsg = {
          id: data.message.id,
          sender: data.message.sender_type.toLowerCase(),
          sender_type: data.message.sender_type,
          message: data.message.message,
          internal_only: Boolean(data.message.internal_only),
          original_message: data.message.original_message,
          translated_message: data.message.translated_message,
          source_lang: data.message.source_lang,
          translated_at: data.message.translated_at ? new Date(data.message.translated_at) : null,
          attachments_path: data.message.attachments_path,
          timestamp: new Date(data.message.created_at)
        };
        
        console.log('📤 [OrderChat] Adding sent message to chat');
        
        // помечаем сообщение как новое для анимации
        setNewMessageIds(prev => new Set([...prev, newMsg.id]));
        
        // убираем класс анимации когда она закончится
        setTimeout(() => {
          setNewMessageIds(prev => {
            const updated = new Set(prev);
            updated.delete(newMsg.id);
            return updated;
          });
        }, 500);
        
        return [...prev, newMsg];
      });
    }
  }, [orderId]);

  // проверяем статус подключения к сокету
  // Load messages immediately on mount — not gated on socket connection
  useEffect(() => {
    if (orderId && !messagesLoaded) {
      loadMessages();
      setMessagesLoaded(true);
    }
  }, [orderId, messagesLoaded, loadMessages]);

  // Track socket connection status for the real-time indicator only
  useEffect(() => {
    const checkConnection = () => {
      const connected = socketService.isConnected();
      setSocketConnected(prev => {
        if (prev !== connected) return connected;
        return prev;
      });
    };

    checkConnection();
    const interval = setInterval(checkConnection, 3000);
    return () => clearInterval(interval);
  }, []);

  // инициализируем аудио для уведомлений
  useEffect(() => {
    // создаем простой звук уведомления через Web Audio API
    const createNotificationSound = () => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      return () => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      };
    };

    audioRef.current = createNotificationSound();
  }, []);

  // Subscribe to real-time message events regardless of socketConnected indicator state
  useEffect(() => {
    if (!orderId) return;
    const unsubscribeMessageReceived = socketService.on('message:received', handleMessageReceived);
    const unsubscribeMessageSent = socketService.on('message:sent', handleMessageSent);
    return () => {
      unsubscribeMessageReceived();
      unsubscribeMessageSent();
    };
  }, [orderId, handleMessageReceived, handleMessageSent]);

  // с flex-col-reverse новые сообщения автоматом появляются внизу
  // автоскролл уже не нужен

  const scrollToBottom = () => {
    // с flex-col-reverse scrollTop должен быть 0 чтобы показать последние сообщения
    if (messagesEndRef.current?.parentElement) {
      messagesEndRef.current.parentElement.scrollTop = 0;
    }
  };

  const clearNewMessagesNotification = useCallback(() => {
    setHasNewMessages(false);
    setUnreadCount(0);
  }, []);

  const getFileUrl = (attachmentsPath) => {
    if (!attachmentsPath) return null;
    
    const baseUrl = window.location.origin.includes('localhost') 
      ? 'http://localhost:8080' 
      : window.location.origin.replace(':5174', ':8080').replace(':3000', ':8080');
    
    const filename = attachmentsPath.split('/').pop();
    return `${baseUrl}/api/uploads/chats/${filename}`;
  };

  // функция для загрузки файла с авторизацией и создания blob URL
  const getAuthenticatedFileUrl = useCallback(async (attachmentsPath) => {
    if (!attachmentsPath) return null;
    
    const filename = attachmentsPath.split('/').pop();
    
    // проверяем глобальный кэш
    if (globalFileCache.has(filename)) {
      return globalFileCache.get(filename);
    }
    
    try {
      const response = await api.get(`/uploads/chats/${filename}`, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data]);
      const blobUrl = URL.createObjectURL(blob);
      
      // сохраняем в глобальный кэш
      globalFileCache.set(filename, blobUrl);
      
      return blobUrl;
    } catch (error) {
      console.error('Ошибка загрузки файла:', error);
      return null;
    }
  }, []);

  // функция для открытия файла в новом окне с авторизацией
  const openFileInNewWindow = async (attachmentsPath) => {
    const url = await getAuthenticatedFileUrl(attachmentsPath);
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error('Ошибка загрузки файла');
    }
  };

  // функция для открытия изображения в модальном окне
  const openImageModal = useCallback(async (attachmentsPath) => {
    const url = await getAuthenticatedFileUrl(attachmentsPath);
    if (url) {
      setSelectedImage({
        url: url,
        name: attachmentsPath.split('/').pop()
      });
      setShowImageModal(true);
    } else {
      toast.error('Ошибка загрузки изображения');
    }
  }, [getAuthenticatedFileUrl]);

  // функция для скачивания файла
  const downloadFile = useCallback(async (attachmentsPath) => {
    try {
      const filename = attachmentsPath.split('/').pop();
      const response = await api.get(`/uploads/chats/${filename}`, {
        responseType: 'blob'
      });
      
      // создаем ссылку для скачивания
      const blob = new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Файл скачан');
    } catch (error) {
      console.error('Ошибка скачивания файла:', error);
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

  const handleAttachmentInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAttachmentPicked(file);
    e.target.value = '';
  }, [onAttachmentPicked]);

  const clearSelectedAttachment = useCallback(() => {
    setSelectedAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  }, []);

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

  // очистка blob URLs при размонтировании компонента
  useEffect(() => {
    return () => {
      // Не очищаем глобальный кэш при размонтировании одного компонента
      // globalFileCache остается живым для всех экземпляров
    };
  }, []);

  const sendMessage = useCallback(async () => {
    const textToSend = String(newMessage || '').trim();
    if (!textToSend && !selectedAttachment) return;
    const isOperatorRole = String(currentUser?.role || '').toUpperCase() === 'OPERATOR';
    const canOperatorWriteChat = Number(currentUser?.can_write_chat ?? 1) === 1;
    if (isOperatorRole && !canOperatorWriteChat) {
      toast.error('Вам запрещено писать в чат');
      return;
    }

    setSending(true);
    const messageText = textToSend;
    const attachmentToSend = selectedAttachment;
    setNewMessage(''); // очищаем поле сразу для лучшего UX
    
    try {
      const payload = attachmentToSend
        ? (() => {
          const formData = new FormData();
          formData.append('message', messageText);
          formData.append('attachment', attachmentToSend);
          return formData;
        })()
        : { message: messageText };

      const response = await dealsApi.sendMessage(orderId, payload);
      console.log('📤 [OrderChat] Message sent via API:', response.data);

      // Сразу отображаем сообщение локально, не дожидаясь сокета.
      // Это важно для служебных сообщений, которые не уходят клиенту в Telegram.
      if (response?.data?.id) {
        const apiMessage = {
          id: response.data.id,
          sender: String(response.data.sender_type || 'OPERATOR').toLowerCase(),
          sender_type: response.data.sender_type || 'OPERATOR',
          message: response.data.message,
          internal_only: Boolean(response.data.internal_only),
          original_message: response.data.original_message,
          translated_message: response.data.translated_message,
          source_lang: response.data.source_lang,
          translated_at: response.data.translated_at ? new Date(response.data.translated_at) : null,
          attachments_path: response.data.attachments_path,
          timestamp: new Date(response.data.created_at)
        };

        setMessages((prev) => {
          const exists = prev.some((m) => m.id === apiMessage.id);
          return exists ? prev : [...prev, apiMessage];
        });
      }

      if (response?.data?.translation_fallback) {
        toast.warn('Сервис перевода недоступен. Сообщение отправлено без перевода.');
      }
      clearSelectedAttachment();

    } catch (error) {
      console.error('Send message error:', error);
      toast.error(error?.response?.data?.error || 'Ошибка при отправке сообщения');
      // восстанавливаем текст при ошибке
      setNewMessage(messageText);
    } finally {
      setSending(false);
    }
  }, [newMessage, orderId, currentUser, selectedAttachment, clearSelectedAttachment]);

  useEffect(() => {
    let mounted = true;

    const loadQuickReplies = async () => {
      try {
        const response = await settingsApi.getChatQuickReplies();
        const loadedQuickReplies = Array.isArray(response?.data?.operator_chat_quick_replies)
          ? response.data.operator_chat_quick_replies.map((item) => String(item || '').trim()).filter(Boolean)
          : [];

        if (!mounted) return;
        if (loadedQuickReplies.length > 0) {
          setQuickReplies(loadedQuickReplies.slice(0, 20));
          return;
        }

        setQuickReplies(FALLBACK_CHAT_QUICK_REPLIES);
      } catch (error) {
        if (mounted) {
          setQuickReplies(FALLBACK_CHAT_QUICK_REPLIES);
        }
      }
    };

    loadQuickReplies();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!quickRepliesMenuOpen) return undefined;

    const handleOutsideClick = (event) => {
      if (!quickRepliesWrapperRef.current?.contains(event.target)) {
        setQuickRepliesMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [quickRepliesMenuOpen]);

  useEffect(() => () => {
    if (quickRepliesHideTimeoutRef.current) {
      clearTimeout(quickRepliesHideTimeoutRef.current);
      quickRepliesHideTimeoutRef.current = null;
    }
  }, []);

  const handleQuickReplySelect = useCallback((phrase) => {
    const nextMessage = String(phrase || '').trim();
    if (!nextMessage) return;

    setNewMessage(nextMessage);
    setQuickRepliesMenuOpen(false);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const cursorPosition = nextMessage.length;
      textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      autoResizeTextarea(textareaRef.current);
    });
  }, []);

  const handleQuickRepliesMouseEnter = useCallback(() => {
    if (quickRepliesHideTimeoutRef.current) {
      clearTimeout(quickRepliesHideTimeoutRef.current);
      quickRepliesHideTimeoutRef.current = null;
    }
    setQuickRepliesMenuOpen(true);
  }, []);

  const handleQuickRepliesMouseLeave = useCallback(() => {
    if (quickRepliesHideTimeoutRef.current) {
      clearTimeout(quickRepliesHideTimeoutRef.current);
    }
    quickRepliesHideTimeoutRef.current = setTimeout(() => {
      setQuickRepliesMenuOpen(false);
      quickRepliesHideTimeoutRef.current = null;
    }, 500);
  }, []);

  const roleUpper = String(currentUser?.role || '').toUpperCase();
  const isOperatorRole = roleUpper === 'OPERATOR';
  const isManagerOrSuperAdminRole = roleUpper === 'MANAGER' || roleUpper === 'SUPERADMIN';
  const canOperatorWriteChat = Number(currentUser?.can_write_chat ?? 1) === 1;
  const viewerLanguage = String(currentUser?.chat_language || 'RU').toUpperCase();
  const isSuperAdmin = roleUpper === 'SUPERADMIN';
  const hideTextComposerForOperator = isOperatorRole && !canOperatorWriteChat;
  const isChatDisabled = (!isSuperAdmin && (order?.status === 'COMPLETED' || order?.status === 'CANCELLED')) || (isOperatorRole && !canOperatorWriteChat);
  const canShowTabSwitcher = Boolean(showChatTabs && typeof onSwitchTab === 'function');
  const hasExchangerRequisites = Boolean(
    order?.exch_req_id ||
    order?.exch_card_number ||
    order?.exch_card_holder ||
    order?.exch_bank_name ||
    order?.exch_crypto_address ||
    order?.exch_sbp_phone
  );

  // Мемоизируем список сообщений для предотвращения ненужных перерендеров
  const memoizedMessages = useMemo(() => {
    return [...messages].reverse();
  }, [messages]);

  const chatHeightClass = isManagerOrSuperAdminRole
    ? 'h-[40rem] max-h-[calc(100vh-12rem)]'
    : 'h-[calc(100vh-12rem)] max-h-[calc(100vh-12rem)]';
  const chatWidthClass = isManagerOrSuperAdminRole ? 'max-w-5xl mx-auto' : '';

  return (
    <div className={`relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex flex-col w-full ${chatHeightClass} ${chatWidthClass}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>

      {/* Chat Header */}
      <div className="relative px-6 py-5 border-b border-gray-200/50 dark:border-gray-700/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Чат с пользователем
              </h3>
              {hasNewMessages && unreadCount > 0 && (
                <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                  {unreadCount} новых {unreadCount === 1 ? 'сообщение' : 'сообщений'}
                </span>
              )}
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
          
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-2">
            {socketConnected ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Wifi className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-xs font-medium text-green-700 dark:text-green-400">
                  Подключено
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <WifiOff className="w-4 h-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                  Подключение...
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div
        className="relative flex-1 overflow-y-auto py-6 px-6 gap-4 messages-container flex flex-col-reverse"
        onClick={clearNewMessagesNotification}
      >
        <div ref={messagesEndRef} />
        {memoizedMessages.map((message) => {
          const isNewMessage = newMessageIds.has(message.id);
          const isOperator = message.sender === 'operator';
          
          return (
            <MessageItem
              key={message.id}
              message={message}
              isNewMessage={isNewMessage}
              isOperator={isOperator}
              openImageModal={openImageModal}
              downloadFile={downloadFile}
              viewerRole={roleUpper}
              viewerLanguage={viewerLanguage}
            />
          );
        })}
      </div>

      {/* Message Input */}
      <div className="relative flex-shrink-0 px-6 py-5 border-t border-gray-200/50 dark:border-gray-700/50">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
        
        <div className="relative flex gap-3 items-end">
          {!hideTextComposerForOperator && (
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
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={sending || isChatDisabled}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-lg text-gray-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Прикрепить файл"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <div
                  ref={quickRepliesWrapperRef}
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-20"
                  onMouseEnter={handleQuickRepliesMouseEnter}
                  onMouseLeave={handleQuickRepliesMouseLeave}
                >
                  <button
                    type="button"
                    onClick={() => setQuickRepliesMenuOpen((prev) => !prev)}
                    disabled={sending || isChatDisabled}
                    className="p-1.5 rounded-full text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Быстрые фразы"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="opacity-70"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      <path d="M8 9h8" />
                      <path d="M8 13h5" />
                    </svg>
                  </button>

                  {quickRepliesMenuOpen && quickReplies.length > 0 && (
                    <div className="absolute right-0 bottom-[calc(100%+10px)] w-80 max-w-[80vw] p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-xl">
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {quickReplies.map((phrase, index) => (
                          <button
                            key={`${phrase}_${index}`}
                            type="button"
                            onClick={() => handleQuickReplySelect(phrase)}
                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-800 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors break-words"
                          >
                            {phrase}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    autoResizeTextarea(e.target);
                  }}
                  onPaste={handleTextareaPaste}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Введите сообщение..."
                  className="relative w-full pl-12 pr-14 py-4 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border-2 border-gray-200 dark:border-gray-700 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 shadow-lg hover:shadow-xl transition-all duration-300 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                  rows="1"
                  style={{ minHeight: '56px', maxHeight: '120px', height: '56px' }}
                  disabled={sending || isChatDisabled}
                  onInput={(e) => {
                    autoResizeTextarea(e.target);
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
          )}
          {typeof onOpenRequisites === 'function' && (
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
          {!hideTextComposerForOperator && (
            <button
              onClick={sendMessage}
              disabled={sending || (!newMessage.trim() && !selectedAttachment) || isChatDisabled}
              className="group relative h-[56px] w-[56px] overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:via-gray-400 disabled:to-gray-400 text-white rounded-2xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl disabled:shadow-sm disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 hover:scale-105 active:scale-95"
              title={sending ? 'Отправка...' : 'Отправить'}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <Send className="w-5 h-5 relative z-10 group-hover:rotate-12 transition-transform duration-300" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Модальное окно для просмотра изображений */}
      {showImageModal && selectedImage && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowImageModal(false)}
        >
          <div 
            className="relative max-w-[90vw] max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Кнопки управления */}
            <div className="absolute top-4 right-4 z-10">
              <div className="flex items-center gap-2">
                {/* Кнопка скачивания */}
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = selectedImage.url;
                    a.download = selectedImage.name;
                    a.click();
                  }}
                  className="p-2 bg-black/20 hover:bg-black/30 rounded-lg transition-colors duration-200 backdrop-blur-sm"
                  title="Скачать изображение"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
                {/* Кнопка закрытия */}
                <button
                  onClick={() => setShowImageModal(false)}
                  className="p-2 bg-black/20 hover:bg-black/30 rounded-lg transition-colors duration-200 backdrop-blur-sm"
                  title="Закрыть"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Изображение */}
            <img
              src={selectedImage.url}
              alt="Изображение"
              className="max-w-full max-h-[90vh] object-contain"
              style={{ minHeight: '200px', minWidth: '300px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderChat;

