import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { supportChatsApi } from '../services/api';
import socketService from '../services/socketService';
import { MessageCircle, Search, Bell, BellOff, User, Clock, ArrowLeft } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import SupportChatComponent from '../components/SupportChatComponent';
import PageTransition from '../components/PageTransition';
import { useAuth } from '../hooks/useAuth';

const SupportChatsPage = () => {
  const { user } = useAuth();
  const hideCustomerIdentity = ['OPERATOR', 'MANAGER'].includes((user?.role || '').toUpperCase());
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all'); // 'all', 'unread'
  const [unreadCount, setUnreadCount] = useState(0);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);

  // Воспроизведение звука уведомления
  const playNotificationSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Настройка звука
      oscillator.frequency.value = 800; // Частота в герцах
      oscillator.type = 'sine'; // Тип волны
      
      // Плавное затухание
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }, []);

  // Загрузка чатов
  const loadChats = useCallback(async () => {
    try {
      const params = {
        hasUnread: filter === 'unread' ? 'true' : null,
      };
      const response = await supportChatsApi.getChats(params);
      setChats(response.data.chats || []);
    } catch (error) {
      console.error('Load chats error:', error);
      toast.error('Ошибка при загрузке чатов');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Загрузка количества непрочитанных
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await supportChatsApi.getUnreadCount();
      setUnreadCount(response.data.count || 0);
    } catch (error) {
      console.error('Load unread count error:', error);
    }
  }, []);

  useEffect(() => {
    // Ensure WebSocket is connected so real-time updates arrive
    try {
      socketService.connect();
    } catch (err) {
      console.error('Socket connect error on SupportChatsPage mount:', err);
    }

    loadChats();
    loadUnreadCount();
  }, [loadChats, loadUnreadCount]);

  // Socket.IO события
  useEffect(() => {
    // Обработка нового сообщения
    const handleNewMessage = (data) => {
      console.log('📨 New support chat message:', data);
      
      // Обновляем список чатов
      loadChats();
      loadUnreadCount();

      // Если это текущий открытый чат и сообщение от пользователя
      if (selectedChat && selectedChat.id === data.chatId) {
        // Сообщение будет обработано в компоненте SupportChatComponent
        return;
      }

      // Показываем уведомление если сообщение от пользователя
      if (data.message.sender_type === 'USER') {
        // Воспроизводим звук уведомления
        playNotificationSound();
        toast.info('Новое сообщение в чате поддержки');
      }
    };

    // Обработка прочтения сообщений
    const handleMessagesRead = (data) => {
      console.log('📖 Messages marked as read:', data);
      loadChats();
      loadUnreadCount();
    };

    const unsubscribeMessage = socketService.on('support-chat:message', handleNewMessage);
    const unsubscribeRead = socketService.on('support-chat:read', handleMessagesRead);

    return () => {
      unsubscribeMessage();
      unsubscribeRead();
    };
  }, [selectedChat, loadChats, loadUnreadCount, playNotificationSound]);

  // Обработка выбора чата
  const handleChatSelect = async (chat) => {
    setSelectedChat(chat);
    setShowChatOnMobile(true); // Показываем чат на мобильных
    
    // Помечаем сообщения как прочитанные
    if (chat.unread_count > 0) {
      try {
        await supportChatsApi.markAsRead(chat.id);
        loadChats();
        loadUnreadCount();
      } catch (error) {
        console.error('Mark as read error:', error);
      }
    }
  };

  // Закрытие чата на мобильных
  const handleBackToList = () => {
    setShowChatOnMobile(false);
  };

  // Фильтрация чатов по поиску
  const filteredChats = chats.filter(chat => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const byMessage = chat.last_message?.toLowerCase().includes(query);
    const byBot = chat.bot_name?.toLowerCase().includes(query);
    if (hideCustomerIdentity) {
      return byMessage || byBot;
    }
    return (
      chat.username?.toLowerCase().includes(query) ||
      chat.tg_id?.toString().includes(query) ||
      byMessage ||
      byBot
    );
  });

  // Форматирование времени
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return `${diffDays} дн назад`;
    
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <PageTransition>
      <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 100px)' }}>

        <div className={`bg-white dark:bg-gray-900 shadow-lg rounded-2xl p-3 md:p-6 mb-3 md:mb-6 flex-shrink-0 ${showChatOnMobile && selectedChat ? 'hidden md:block' : 'block'}`}>
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <MessageCircle className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">
                  Чаты поддержки
                </h1>
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
                  Общение с пользователями
                </p>
              </div>
            </div>


            {unreadCount > 0 && (
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <Bell className="w-4 h-4 md:w-5 md:h-5 text-red-600 dark:text-red-400" />
                <span className="text-xs md:text-sm font-medium text-red-700 dark:text-red-400">
                  <span className="hidden sm:inline">{unreadCount} непрочитанных</span>
                  <span className="sm:hidden">{unreadCount}</span>
                </span>
              </div>
            )}
          </div>


          <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 md:left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 md:pl-10 pr-3 md:pr-4 py-1.5 md:py-2 text-sm md:text-base bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`flex-1 sm:flex-initial px-3 md:px-4 py-1.5 md:py-2 text-sm md:text-base rounded-lg font-medium transition-all ${
                  filter === 'all'
                    ? 'bg-blue-500 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Все
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`flex-1 sm:flex-initial px-3 md:px-4 py-1.5 md:py-2 text-sm md:text-base rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 md:gap-2 ${
                  filter === 'unread'
                    ? 'bg-blue-500 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <BellOff className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Непрочитанные</span>
                <span className="sm:hidden">Новые</span>
              </button>
            </div>
          </div>
        </div>


        <div className="flex flex-col md:flex-row gap-3 md:gap-6 flex-1" style={{ height: showChatOnMobile && selectedChat ? 'calc(100vh - 120px)' : 'calc(100vh - 200px)', minHeight: '400px', maxHeight: '800px' }}>

          <div className={`w-full md:w-1/3 bg-white dark:bg-gray-900 shadow-lg rounded-2xl overflow-hidden flex flex-col ${showChatOnMobile && selectedChat ? 'hidden md:flex' : 'flex'}`} style={{ height: '100%' }}>
            <div className="p-3 md:p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white">
                Чаты ({filteredChats.length})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-4 md:p-8 text-gray-500 dark:text-gray-400">
                  <MessageCircle className="w-12 h-12 md:w-16 md:h-16 mb-4 opacity-50" />
                  <p className="text-center text-sm md:text-base">
                    {searchQuery ? 'Чаты не найдены' : 'Нет активных чатов'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredChats.map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => handleChatSelect(chat)}
                      className={`p-3 md:p-4 cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 ${
                        selectedChat?.id === chat.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500'
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-2 md:gap-3">
                        {/* Аватар */}
                        <div className="flex-shrink-0 relative">
                          <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 md:w-6 md:h-6 text-white" />
                          </div>
                          {chat.unread_count > 0 && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-red-500 rounded-full flex items-center justify-center">
                              <span className="text-[10px] md:text-xs text-white font-bold">
                                {chat.unread_count}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Информация */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="text-sm md:text-base font-medium text-gray-900 dark:text-white truncate">
                              {hideCustomerIdentity ? 'Пользователь' : (chat.username || `User ${chat.tg_id}`)}
                            </h3>
                            <span className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 flex items-center gap-0.5 md:gap-1 ml-2">
                              <Clock className="w-2.5 h-2.5 md:w-3 md:h-3" />
                              {formatTime(chat.last_message_at)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 md:gap-2 mb-1">
                            {!hideCustomerIdentity && (
                              <span className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">
                                ID: {chat.tg_id}
                              </span>
                            )}
                            <span className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                              {chat.bot_name}
                            </span>
                          </div>

                          {chat.last_message && (
                            <p className={`text-xs md:text-sm truncate ${
                              chat.unread_count > 0
                                ? 'text-gray-900 dark:text-white font-medium'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}>
                              {chat.last_message_sender_type === 'OPERATOR' && chat.last_operator_login && (
                                <span className="text-blue-600 dark:text-blue-400 font-medium">
                                  {chat.last_operator_login}:{' '}
                                </span>
                              )}
                              {chat.last_message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`w-full md:flex-1 ${!showChatOnMobile && selectedChat ? 'hidden md:block' : 'block'}`} style={{ height: '100%' }}>
            {selectedChat ? (
              <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden">
                <div className="md:hidden px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <button
                    onClick={handleBackToList}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors w-full"
                  >
                    <ArrowLeft className="w-5 h-5" />
                    <span className="font-medium">Назад к списку</span>
                  </button>
                </div>
                
                <div className="flex-1 overflow-hidden">
                  <SupportChatComponent 
                    chatId={selectedChat.id} 
                    chat={selectedChat}
                    hideCustomerIdentity={hideCustomerIdentity}
                    onMessagesUpdate={() => {
                      loadChats();
                      loadUnreadCount();
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="hidden md:flex bg-white dark:bg-gray-900 shadow-lg rounded-2xl items-center justify-center p-8" style={{ height: '100%' }}>
                <div className="text-center text-gray-500 dark:text-gray-400">
                  <MessageCircle className="w-16 h-16 md:w-20 md:h-20 mx-auto mb-4 opacity-50" />
                  <p className="text-base md:text-lg">Выберите чат для начала общения</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default SupportChatsPage;
