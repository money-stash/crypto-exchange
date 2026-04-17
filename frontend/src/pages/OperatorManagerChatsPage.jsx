import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { MessageCircle, Search, User, Link2 } from 'lucide-react';
import { operatorManagerChatsApi } from '../services/api';
import socketService from '../services/socketService';
import { useAuth } from '../hooks/useAuth';
import OperatorManagerChat from '../components/OperatorManagerChat';
import PageTransition from '../components/PageTransition';

const formatRelativeTime = (timestamp) => {
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

const OperatorManagerChatsPage = () => {
  const { user } = useAuth();
  const roleUpper = String(user?.role || '').toUpperCase();
  const isSuperAdmin = roleUpper === 'SUPERADMIN';
  const isManager = roleUpper === 'MANAGER';
  const isOperator = roleUpper === 'OPERATOR';
  const canLoadManagerChatsList = isManager || isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [chats, setChats] = useState([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState(null);

  const selectedChat = useMemo(
    () => chats.find((chat) => Number(chat.operator_id) === Number(selectedOperatorId || 0)) || null,
    [chats, selectedOperatorId]
  );

  const loadChats = useCallback(async () => {
    if (!canLoadManagerChatsList) {
      setChats([]);
      if (isOperator) {
        setSelectedOperatorId(Number(user?.id || 0) || null);
      } else {
        setSelectedOperatorId(null);
      }
      setLoading(false);
      return;
    }

    try {
      const response = await operatorManagerChatsApi.getChats({ search });
      const list = Array.isArray(response?.data?.chats) ? response.data.chats : [];
      setChats(list);
      setSelectedOperatorId((prev) => {
        if (prev && list.some((item) => Number(item.operator_id) === Number(prev))) return prev;
        return list[0]?.operator_id || null;
      });
    } catch (error) {
      console.error('Load operator-manager chats error:', error);
      toast.error(error?.response?.data?.error || 'Ошибка загрузки чатов');
    } finally {
      setLoading(false);
    }
  }, [canLoadManagerChatsList, isOperator, search, user?.id]);

  useEffect(() => {
    socketService.connect();
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!canLoadManagerChatsList) return undefined;

    const unsubscribeMessage = socketService.on('operator-manager-chat:message', (data) => {
      const chatOperatorId = Number(data?.operator_id || 0);
      if (!chatOperatorId) return;
      loadChats();
    });

    const unsubscribeRead = socketService.on('operator-manager-chat:read', () => {
      loadChats();
    });

    const unsubscribeAssign = socketService.on('operator-manager-chat:assignment-updated', () => {
      loadChats();
    });

    return () => {
      unsubscribeMessage();
      unsubscribeRead();
      unsubscribeAssign();
    };
  }, [canLoadManagerChatsList, loadChats]);

  if (isOperator) {
    return (
      <PageTransition>
        <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 100px)' }}>
          <div className="bg-white dark:bg-gray-900 shadow-lg rounded-2xl p-5 mb-5 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Чат с менеджером</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">Личный внутренний чат оператора</p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <OperatorManagerChat
              operatorId={Number(user?.id || 0)}
              currentUser={user}
              title="Чат с менеджером"
              fullHeight={false}
            />
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 100px)' }}>
        <div className="bg-white dark:bg-gray-900 shadow-lg rounded-2xl p-5 mb-5 flex-shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <MessageCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Чаты с операторами</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Общение менеджера и оператора</p>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск оператора..."
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
              />
            </div>
        </div>

        <div className="flex gap-5 flex-1 min-h-0">
          <div className="w-full lg:w-[360px] bg-white dark:bg-gray-900 shadow-lg rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Операторы ({chats.length})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
              ) : chats.length === 0 ? (
                <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Чатов пока нет</div>
              ) : (
                chats.map((chat) => {
                  const selected = Number(chat.operator_id) === Number(selectedOperatorId || 0);
                  const unread = Number(chat?.unread_for_manager || 0);
                  return (
                    <button
                      key={chat.operator_id}
                      type="button"
                      onClick={() => setSelectedOperatorId(chat.operator_id)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                        selected
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
                          <User className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {chat.operator_login}
                            </p>
                            {unread > 0 && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-semibold">
                                {unread}
                              </span>
                            )}
                          </div>
                          {chat.last_message && (
                            <p className="text-xs text-gray-600 dark:text-gray-300 truncate mt-1">
                              {chat.last_message}
                            </p>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {formatRelativeTime(chat.last_message_at)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {selectedChat ? (
              <>
                <div className="bg-white dark:bg-gray-900 shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <Link2 className="w-4 h-4 text-blue-500" />
                      <span>
                        Оператор: <b>{selectedChat.operator_login}</b>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  <OperatorManagerChat
                    operatorId={selectedChat.operator_id}
                    currentUser={user}
                    title={`Чат с оператором ${selectedChat.operator_login}`}
                    fullHeight={false}
                    linkedOrder={{
                      id: Number(selectedChat?.last_order_id || 0) || null,
                      uniqueId: Number(selectedChat?.last_order_unique_id || 0) || null,
                      sumRub: selectedChat?.last_order_sum_rub === null || selectedChat?.last_order_sum_rub === undefined
                        ? null
                        : Number(selectedChat.last_order_sum_rub)
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="h-full bg-white dark:bg-gray-900 shadow-lg rounded-2xl flex items-center justify-center text-gray-500 dark:text-gray-400">
                Выберите оператора для начала общения
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default OperatorManagerChatsPage;
