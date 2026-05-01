import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { MessageCircle, Search, User, Link2, Send } from 'lucide-react';
import { operatorManagerChatsApi, cashiersApi } from '../services/api';
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

function CashierChatsSection() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadChats = useCallback(async () => {
    try {
      const res = await cashiersApi.listCashierChats();
      setChats(res.data.chats || []);
    } catch {
      toast.error('Ошибка загрузки чатов кассиров');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);

  const openChat = async (chat) => {
    setSelected({ cashierId: chat.cashier_id, cashierLogin: chat.cashier_login });
    setMessages([]);
    setMsgLoading(true);
    try {
      const res = await cashiersApi.getCashierChat(chat.cashier_id);
      setMessages(res.data.messages || []);
      await cashiersApi.markCashierChatRead(chat.cashier_id);
      setChats(prev => prev.map(c =>
        c.cashier_id === chat.cashier_id ? { ...c, unread_for_manager: 0 } : c
      ));
    } catch {
      toast.error('Ошибка загрузки сообщений');
    } finally {
      setMsgLoading(false);
    }
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      const res = await cashiersApi.sendToCashier(selected.cashierId, text);
      setMessages(prev => [...prev, res.data]);
      setInput('');
      loadChats();
    } catch {
      toast.error('Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (dt) => {
    if (!dt) return '';
    return new Date(dt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex gap-5 flex-1 min-h-0">
      <div className="w-full lg:w-[360px] bg-white dark:bg-gray-900 shadow-lg rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Кассиры ({chats.length})
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-500">Загрузка...</div>
          ) : chats.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">Чатов пока нет</div>
          ) : chats.map(chat => {
            const isSelected = selected?.cashierId === chat.cashier_id;
            const unread = Number(chat.unread_for_manager || 0);
            return (
              <button
                key={chat.cashier_id}
                onClick={() => openChat(chat)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 transition-colors ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {chat.cashier_login}
                      </p>
                      {unread > 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-semibold">{unread}</span>
                      )}
                    </div>
                    {chat.last_message && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{chat.last_message}</p>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 whitespace-nowrap">{formatRelativeTime(chat.last_message_at)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-w-0 bg-white dark:bg-gray-900 shadow-lg rounded-2xl overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex items-center justify-center flex-1 text-gray-400 dark:text-gray-500">
            Выберите кассира для переписки
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{selected.cashierLogin}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {msgLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Нет сообщений</p>
              ) : messages.map(msg => {
                const isAdmin = msg.sender_type !== 'CASHIER';
                return (
                  <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 ${isAdmin ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'}`}>
                      <p className="text-sm break-words">{msg.message}</p>
                      <p className={`text-xs mt-0.5 ${isAdmin ? 'text-blue-200' : 'text-gray-400'}`}>
                        {msg.sender_login || msg.sender_type} · {fmtTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 flex gap-2">
              <input
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Написать кассиру..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <button onClick={handleSend} disabled={sending || !input.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
  const [chatSection, setChatSection] = useState('operators'); // 'operators' | 'cashiers'

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
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Чаты</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Операторы и кассиры</p>
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit mb-4">
            {[{ key: 'operators', label: 'Операторы' }, { key: 'cashiers', label: 'Кассиры' }].map(({ key, label }) => (
              <button key={key} onClick={() => setChatSection(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  chatSection === key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {chatSection === 'operators' && (
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
          )}
        </div>

        {chatSection === 'cashiers' ? (
          <CashierChatsSection />
        ) : (
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
        )}
      </div>
    </PageTransition>
  );
};

export default OperatorManagerChatsPage;
