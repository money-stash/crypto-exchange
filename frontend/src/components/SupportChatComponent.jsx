import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import { supportChatsApi } from '../services/api';
import socketService from '../services/socketService';
import { Send, MessageCircle, Wifi, WifiOff, User, Image as ImageIcon, Paperclip } from 'lucide-react';

const MessageItem = React.memo(({ message, isNewMessage, isOperator, senderName }) => {
  const hasAttachments = message.attachments && message.attachments.length > 0;
  
  const getAttachmentUrl = (attachmentPath) => {
    if (!attachmentPath) return '';
    
    if (process.env.NODE_ENV === 'production') {
      const baseUrl = window.location.origin.includes('localhost')
        ? 'http://localhost:8080'
        : window.location.origin.replace(':5174', ':8080').replace(':3000', ':8080');
      

      return `${baseUrl}${attachmentPath.startsWith('/') ? attachmentPath : '/' + attachmentPath}`;
    }
    

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
    return `${baseUrl}${attachmentPath.startsWith('/') ? attachmentPath : '/' + attachmentPath}`;
  };
  
  return (
    <div
      className={`flex ${isOperator ? 'justify-end' : 'justify-start'} ${isNewMessage ? 'animate-message-slide-in' : ''}`}
    >
      <div className="relative max-w-xs lg:max-w-md">
        <div className="relative">
          <div
            className={`px-5 py-3.5 rounded-2xl transition-all duration-200 ${
              isOperator
                ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30'
                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200 border border-gray-200/50 dark:border-gray-700/50 shadow-lg'
            } ${isOperator ? 'rounded-br-md' : 'rounded-bl-md'}`}
          >

            {isOperator && senderName && (
              <p className="text-xs text-blue-100/80 mb-1 font-semibold">
                {senderName}
              </p>
            )}
            

            {hasAttachments && (
              <div className="mb-2 space-y-2">
                {message.attachments.map((attachment, index) => (
                  <a
                    key={index}
                    href={getAttachmentUrl(attachment)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
                  >
                    <img
                      src={getAttachmentUrl(attachment)}
                      alt="Attachment"
                      className="max-w-full h-auto rounded-lg"
                      style={{ maxHeight: '300px' }}
                    />
                  </a>
                ))}
              </div>
            )}
            
            {message.message !== '[Изображение]' && (
              <p className="text-sm leading-relaxed break-words font-medium">{message.message}</p>
            )}
            
            <p className={`text-xs mt-2 font-semibold ${
              isOperator ? 'text-blue-100/90' : 'text-gray-500 dark:text-gray-400'
            }`}>
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
         prevProps.senderName === nextProps.senderName &&
         prevProps.message.timestamp?.getTime() === nextProps.message.timestamp?.getTime() &&
         JSON.stringify(prevProps.message.attachments) === JSON.stringify(nextProps.message.attachments);
});

const SupportChatComponent = ({ chatId, chat, onMessagesUpdate, hideCustomerIdentity = false }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [newMessageIds, setNewMessageIds] = useState(new Set());
  const [typingOperators, setTypingOperators] = useState(new Map()); 
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const playNotificationSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      console.log('📥 Loading messages for chat:', chatId);
      const response = await supportChatsApi.getMessages(chatId);
      console.log('📥 Raw response:', response);
      console.log('📥 Response data:', response.data);
      
      const messagesData = Array.isArray(response.data) ? response.data : [];
      console.log('📥 Messages array:', messagesData);
      
      const formattedMessages = messagesData.map(msg => {
        let attachments = [];
        if (msg.attachments_path) {
          try {
            attachments = JSON.parse(msg.attachments_path);
          } catch (e) {
            console.error('Error parsing attachments:', e);
          }
        }
        
        return {
          id: msg.id,
          sender: msg.sender_type.toLowerCase(),
          senderName: msg.sender_name,
          message: msg.message,
          timestamp: new Date(msg.created_at),
          attachments: attachments
        };
      });
      
      console.log('📥 Formatted messages:', formattedMessages);
      setMessages(formattedMessages);
    } catch (error) {
      console.error('Load messages error:', error);
      setMessages([]);
    }
  }, [chatId]);

  const handleMessageReceived = useCallback((data) => {
    console.log('📨 [SupportChat] Message received:', data);
    console.log('📨 [SupportChat] Current chatId:', chatId, 'Message chatId:', data.chatId);
    
    if (parseInt(data.chatId) === parseInt(chatId)) {
      console.log('📨 [SupportChat] Chat IDs match, processing message');
      
      setMessages(prev => {
        const exists = prev.some(m => m.id === data.message.id);
        if (exists) {
          console.log('📨 [SupportChat] Message already exists, skipping');
          return prev;
        }
        
        let attachments = [];
        if (data.message.attachments_path) {
          try {
            attachments = JSON.parse(data.message.attachments_path);
          } catch (e) {
            console.error('Error parsing attachments:', e);
          }
        }
        
        const newMsg = {
          id: data.message.id,
          sender: data.message.sender_type.toLowerCase(),
          senderName: data.message.sender_name,
          message: data.message.message,
          timestamp: new Date(data.message.created_at),
          attachments: attachments
        };
        
        console.log('📨 [SupportChat] Adding new message:', newMsg);
        
        setNewMessageIds(prev => new Set([...prev, newMsg.id]));
        setTimeout(() => {
          setNewMessageIds(prev => {
            const updated = new Set(prev);
            updated.delete(newMsg.id);
            return updated;
          });
        }, 500);
        
        // Уведомление если сообщение от пользователя
        if (data.message.sender_type === 'USER') {
          playNotificationSound();
          toast.info('Новое сообщение от пользователя');
        }
        
        return [...prev, newMsg];
      });
      
      if (onMessagesUpdate) {
        onMessagesUpdate();
      }
    } else {
      console.log('📨 [SupportChat] Chat IDs do not match, ignoring message');
    }
  }, [chatId, onMessagesUpdate, playNotificationSound]);

  useEffect(() => {
    if (chatId) {
      console.log('🔄 Chat ID changed, loading messages:', chatId);
      setMessagesLoaded(false);
      setMessages([]);
      loadMessages();
    }
  }, [chatId, loadMessages]);


  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);


  useEffect(() => {
    const checkConnection = () => {
      const connected = socketService.isConnected();
      setSocketConnected(connected);
      
      if (connected && !messagesLoaded && chatId) {
        console.log('🔌 [SupportChat] Socket connected, loading messages');
        loadMessages();
        setMessagesLoaded(true);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);

    return () => clearInterval(interval);
  }, [chatId, messagesLoaded, loadMessages]);

  const getCurrentUserId = useCallback(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      return user?.id;
    } catch (error) {
      console.error('Error getting current user ID:', error);
      return null;
    }
  }, []);


  const handleTypingEvent = useCallback((data) => {
    console.log('⌨️ [SupportChat] Typing event received:', data);
    
    if (parseInt(data.chatId) === parseInt(chatId)) {
      const { operatorId, operatorLogin, isTyping } = data;
      const currentUserId = getCurrentUserId();
      
      if (operatorId === currentUserId) {
        return;
      }
      
      setTypingOperators(prev => {
        const updated = new Map(prev);
        
        if (isTyping) {
          const timeout = setTimeout(() => {
            setTypingOperators(curr => {
              const newMap = new Map(curr);
              newMap.delete(operatorId);
              return newMap;
            });
          }, 3000);
          
          if (updated.has(operatorId)) {
            clearTimeout(updated.get(operatorId).timeout);
          }
          
          updated.set(operatorId, { operatorLogin, timeout });
        } else {

          if (updated.has(operatorId)) {
            clearTimeout(updated.get(operatorId).timeout);
            updated.delete(operatorId);
          }
        }
        
        return updated;
      });
    }
  }, [chatId, getCurrentUserId]);

  // Подписка на события сокета
  useEffect(() => {
    if (chatId && socketConnected) {
      console.log('🔔 [SupportChat] Subscribing to socket events for chatId:', chatId);
      const unsubscribeMessage = socketService.on('support-chat:message', handleMessageReceived);
      const unsubscribeTyping = socketService.on('support-chat:typing', handleTypingEvent);
      
      return () => {
        console.log('🔕 [SupportChat] Unsubscribing from socket events for chatId:', chatId);
        unsubscribeMessage();
        unsubscribeTyping();
      };
    } else {
      console.log('⚠️ [SupportChat] Not subscribing:', { chatId, socketConnected });
    }
  }, [chatId, socketConnected, handleMessageReceived, handleTypingEvent]);

  // Отправка события "печатает"
  const sendTypingEvent = useCallback((isTyping) => {
    try {
      supportChatsApi.sendTyping(chatId, isTyping);
    } catch (error) {
      console.error('Send typing event error:', error);
    }
  }, [chatId]);


  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    setNewMessage(value);
    

    if (value.trim()) {
      sendTypingEvent(true);
      

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingEvent(false);
      }, 2000);
    } else {
      sendTypingEvent(false);
    }
  }, [sendTypingEvent]);


  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      sendTypingEvent(false);
    };
  }, [sendTypingEvent]);


  const handleImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;


    if (!file.type.startsWith('image/')) {
      toast.error('Можно загружать только изображения');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Размер файла не должен превышать 10МБ');
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      await supportChatsApi.uploadImage(chatId, formData);
      
      if (onMessagesUpdate) {
        onMessagesUpdate();
      }

      toast.success('Изображение отправлено');
    } catch (error) {
      console.error('Upload image error:', error);
      toast.error('Ошибка при загрузке изображения');
    } finally {
      setSending(false);

      e.target.value = '';
    }
  }, [chatId, onMessagesUpdate]);


  const sendMessage = useCallback(async () => {
    if (!newMessage.trim()) return;

    setSending(true);
    const messageText = newMessage.trim();
    setNewMessage('');
    
    sendTypingEvent(false);
    

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    
    try {
      await supportChatsApi.sendMessage(chatId, { message: messageText });
      

      if (onMessagesUpdate) {
        onMessagesUpdate();
      }
    } catch (error) {
      console.error('Send message error:', error);
      toast.error('Ошибка при отправке сообщения');
      setNewMessage(messageText);
    } finally {
      setSending(false);
    }
  }, [newMessage, chatId, onMessagesUpdate, sendTypingEvent]);


  const memoizedMessages = useMemo(() => {
    return [...messages].reverse();
  }, [messages]);

  return (
    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-xl md:rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden flex flex-col w-full" style={{ height: 'calc(100vh - 250px)', minHeight: '500px', maxHeight: '800px' }}>
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>


      <div className="relative px-3 md:px-6 py-3 md:py-5 border-b border-gray-200/50 dark:border-gray-700/50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-lg">
              <User className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100">
                {hideCustomerIdentity ? 'Пользователь' : (chat.username || `User ${chat.tg_id}`)}
              </h3>
              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">
                {hideCustomerIdentity ? (
                  chat.bot_name
                ) : (
                  <>
                    <span className="hidden sm:inline">ID: {chat.tg_id} • </span>{chat.bot_name}
                  </>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {socketConnected ? (
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Wifi className="w-3.5 h-3.5 md:w-4 md:h-4 text-green-600 dark:text-green-400" />
                <span className="hidden sm:inline text-xs font-medium text-green-700 dark:text-green-400">
                  Подключено
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <WifiOff className="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                <span className="hidden sm:inline text-xs font-medium text-yellow-700 dark:text-yellow-400">
                  Подключение...
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto py-3 px-3 md:py-6 md:px-6 gap-3 md:gap-4 messages-container flex flex-col-reverse">
        <div ref={messagesEndRef} />
        
        {typingOperators.size > 0 && (
          <div className="flex justify-end mb-2">
            <div className="px-4 py-2 bg-gradient-to-br from-blue-500/20 via-blue-600/20 to-indigo-600/20 dark:from-blue-500/30 dark:via-blue-600/30 dark:to-indigo-600/30 border border-blue-300/50 dark:border-blue-500/50 rounded-2xl rounded-br-md">
              <div className="flex items-center gap-2">
                <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                  {Array.from(typingOperators.values()).map(op => op.operatorLogin).join(', ')} печатает
                </span>
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {memoizedMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Сообщений пока нет</p>
            </div>
          </div>
        ) : (
          memoizedMessages.map((message) => {
            const isNewMessage = newMessageIds.has(message.id);
            const isOperator = message.sender === 'operator';
            
            return (
              <MessageItem
                key={message.id}
                message={message}
                isNewMessage={isNewMessage}
                isOperator={isOperator}
                senderName={message.senderName}
              />
            );
          })
        )}
      </div>

      <div className="relative flex-shrink-0 px-3 py-3 md:px-6 md:py-5 border-t border-gray-200/50 dark:border-gray-700/50">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
        
        <div className="relative flex gap-2 md:gap-3 items-center">
          <div className="relative flex-shrink-0">
            <input
              type="file"
              id="image-upload"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={sending}
              className="hidden"
            />
            <label
              htmlFor="image-upload"
              className={`group relative h-[44px] md:h-[56px] w-[44px] md:w-[56px] flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl md:rounded-2xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl cursor-pointer ${
                sending ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'
              }`}
            >
              <ImageIcon className="w-5 h-5 md:w-6 md:h-6" />
            </label>
          </div>

          <div className="flex-1 relative group">
            <textarea
              value={newMessage}
              onChange={handleInputChange}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Введите сообщение..."
              className="relative w-full h-[44px] md:h-[56px] px-3 md:px-5 text-sm md:text-base bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border-2 border-gray-200 dark:border-gray-700 rounded-xl md:rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-lg transition-all duration-300 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 font-medium flex items-center"
              style={{ lineHeight: '20px', paddingTop: '12px', paddingBottom: '12px' }}
              rows="1"
              disabled={sending}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !newMessage.trim()}
            className="group relative h-[44px] md:h-[56px] px-4 md:px-8 flex-shrink-0 overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:via-gray-400 disabled:to-gray-400 text-white rounded-xl md:rounded-2xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl disabled:shadow-sm disabled:cursor-not-allowed flex items-center justify-center gap-1.5 md:gap-2.5 hover:scale-105 active:scale-95"
          >
            {sending ? (
              <>
                <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span className="hidden sm:inline text-sm md:text-base">Отправка...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 md:w-5 md:h-5 group-hover:rotate-12 transition-transform duration-300" />
                <span className="hidden sm:inline text-sm md:text-base">Отправить</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupportChatComponent;
