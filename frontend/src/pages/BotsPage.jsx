import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmDialog } from '../contexts/ConfirmContext';
import { useAuth } from '../hooks/useAuth';
import { botsApi } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ResponsiveTable from '../components/ResponsiveTable';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import { Bot, Plus, MessageCircle, BookOpen, Activity, AlertCircle, Type, Hash, Key, Link2, FileText, Save, X as CloseIcon } from 'lucide-react';

const BotsPage = () => {
  const { confirm } = useConfirmDialog();
  const { isExAdmin } = useAuth();
  const [bots, setBots] = useState([]);
  const [botStatuses, setBotStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBot, setEditingBot] = useState(null);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });

  const [formData, setFormData] = useState({
    name: '',
    token: '',
    description: '',
    exchange_chat_link: '',
    reviews_chat_link: '',
    reviews_chat_id: '',
    is_active: true
  });

  useEffect(() => {
    fetchBots();
  }, [pagination.page]);

  useEffect(() => {
    if (bots.length > 0) {
      fetchBotsStatuses();
    }
  }, [bots]);

  const fetchBots = async () => {
    try {
      setLoading(true);
      const response = await botsApi.getBots({
        page: pagination.page,
        limit: pagination.limit
      });

      // обработка новой структуры ответа: { data: { bots: [...], total: ..., pages: ... } }
      const responseData = response.data?.data || response.data;
      const botsArray = responseData?.bots || responseData || [];
      
      setBots(botsArray);
      setPagination(prev => ({
        ...prev,
        total: responseData?.total || botsArray.length || 0,
        pages: responseData?.pages || Math.ceil((responseData?.total || botsArray.length || 0) / prev.limit)
      }));
    } catch (error) {
      console.error('Failed to fetch bots:', error);
      setError('Ошибка загрузки ботов');
    } finally {
      setLoading(false);
    }
  };

  const fetchBotsStatuses = async () => {
    try {
      const statusPromises = bots.map(async (bot) => {
        try {
          const response = await botsApi.getBotStatus(bot.id);
          return { id: bot.id, status: response.data };
        } catch (error) {
          console.error(`Failed to fetch status for bot ${bot.id}:`, error);
          return { id: bot.id, status: { running: false, error: error.message } };
        }
      });

      const statuses = await Promise.all(statusPromises);
      const statusMap = {};
      statuses.forEach(({ id, status }) => {
        statusMap[id] = status;
      });
      setBotStatuses(statusMap);
    } catch (error) {
      console.error('Failed to fetch bot statuses:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');


    const submissionData = {
      ...formData,
      is_active: Boolean(formData.is_active)
    };

    console.log('Submitting bot form:', submissionData);

    try {
      if (editingBot) {
        await botsApi.updateBot(editingBot.id, submissionData);
      } else {
        await botsApi.createBot(submissionData);
      }
      
      setShowCreateModal(false);
      setEditingBot(null);
      resetForm();
      await fetchBots();
      // Обновляем статусы после создания/обновления бота
      setTimeout(() => fetchBotsStatuses(), 1000);
    } catch (error) {
      console.error('Failed to save bot:', error);
      setError(error.response?.data?.error || 'Ошибка сохранения бота');
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await botsApi.toggleBotStatus(id);
      await fetchBots();
      // fetchBots updates bots state → useEffect triggers fetchBotsStatuses,
      // but we also force a status refresh after a short delay so the
      // BotManager has time to start/stop polling.
      setTimeout(() => fetchBotsStatuses(), 1500);
    } catch (error) {
      console.error('Failed to toggle bot status:', error);
      setError('Ошибка изменения статуса');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm({
      title: 'Удаление бота',
      message: 'Вы уверены, что хотите удалить этого бота?',
      confirmText: 'Да, удалить',
      cancelText: 'Отмена',
      type: 'danger'
    });

    if (!confirmed) return;

    const confirmedTwice = await confirm({
      title: 'Подтвердите удаление',
      message: 'Бот будет остановлен и удалён без возможности восстановления. Точно продолжить?',
      confirmText: 'Удалить окончательно',
      cancelText: 'Отмена',
      type: 'danger'
    });

    if (!confirmedTwice) return;

    try {
      await botsApi.deleteBot(id);
      fetchBots();
    } catch (error) {
      console.error('Failed to delete bot:', error);
      setError('Ошибка удаления бота');
    }
  };

  const handleEdit = (bot) => {
    setEditingBot(bot);
    setFormData({
      name: bot.name,
      token: bot.token,
      description: bot.description || '',
      exchange_chat_link: bot.exchange_chat_link || '',
      reviews_chat_link: bot.reviews_chat_link || '',
      reviews_chat_id: bot.reviews_chat_id || '',
      is_active: bot.is_active
    });
    setShowCreateModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      token: '',
      description: '',
      exchange_chat_link: '',
      reviews_chat_link: '',
      reviews_chat_id: '',
      is_active: true
    });
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingBot(null);
    resetForm();
    setError('');
  };

  // Проверяем, нужно ли скрывать кнопку добавления бота для ex_admin
  const shouldHideAddButton = isExAdmin && bots.length >= 1;

  return (
    <div className="space-y-6">
      {/* Premium Header */}
      <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
        
        <div className="relative px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                  Управление ботами
                </h1>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                  Настройка и мониторинг Telegram ботов
                </p>
              </div>
            </div>
            
            {!shouldHideAddButton && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="group relative px-6 py-3 bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl flex items-center gap-2.5 hover:scale-105 active:scale-95 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <Plus className="w-5 h-5 relative z-10" />
                <span className="relative z-10">Добавить бота</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="relative bg-red-50/90 dark:bg-red-900/20 backdrop-blur-xl border-2 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 px-5 py-4 rounded-xl shadow-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      <ResponsiveTable
        columns={[
          {
            header: 'Название',
            key: 'name',
            render: (bot) => (
              <div>
                <div className="font-medium">
                  {bot.name}
                </div>
                {bot.description && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {bot.description}
                  </div>
                )}
              </div>
            )
          },
          {
            header: 'Идентификатор',
            key: 'identifier',
            render: (bot) => (
              <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm">
                {bot.identifier}
              </code>
            )
          },
          {
            header: 'Статус',
            key: 'is_active',
            render: (bot) => (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm ${
                bot.is_active 
                  ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/30' 
                  : 'bg-gradient-to-r from-red-500/10 to-rose-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${bot.is_active ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {bot.is_active ? 'Активен' : 'Отключен'}
              </span>
            )
          },
          {
            header: 'Работает',
            key: 'running',
            render: (bot) => {
              const status = botStatuses[bot.id];
              if (!status) {
                return (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-400 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>
                    Загрузка...
                  </span>
                );
              }
              return (
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm ${
                  status.running
                    ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700/30'
                    : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-400 border border-gray-200 dark:border-gray-600/30'
                }`}>
                  <Activity className={`w-3 h-3 ${status.running ? 'animate-pulse' : ''}`} />
                  {status.running ? 'Запущен' : 'Остановлен'}
                </span>
              );
            }
          },
          {
            header: 'Создан',
            key: 'created_at',
            render: (bot) => new Date(bot.created_at).toLocaleDateString('ru-RU')
          },
          {
            header: 'Ссылки',
            key: 'links',
            render: (bot) => (
              <div className="flex flex-col gap-2">
                {bot.exchange_chat_link && (
                  <a 
                    href={bot.exchange_chat_link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs font-medium transition-colors"
                    title="Чат обменника"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Чат
                  </a>
                )}
                {bot.reviews_chat_link && (
                  <a 
                    href={bot.reviews_chat_link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 text-xs font-medium transition-colors"
                    title="Отзывы"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Отзывы
                  </a>
                )}
                {!bot.exchange_chat_link && !bot.reviews_chat_link && (
                  <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>
                )}
              </div>
            )
          },
          {
            header: 'Действия',
            key: 'actions',
            render: (bot) => (
              <div className="flex gap-1">
                <Link to={`/bots/${bot.id}`}>
                  <ActionButton
                    type="view"
                    variant="primary"
                    title="Подробнее"
                  />
                </Link>
                <ActionButton
                  type="edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(bot);
                  }}
                  variant="default"
                  title="Редактировать"
                />
                <ActionButton
                  type="power"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleStatus(bot.id);
                  }}
                  variant={bot.is_active ? "danger" : "success"}
                  title={bot.is_active ? 'Отключить' : 'Включить'}
                />
                <ActionButton
                  type="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(bot.id);
                  }}
                  variant="danger"
                  title="Удалить"
                />
              </div>
            )
          }
        ]}
        data={bots}
        keyField="id"
        mobileCardRender={(bot) => (
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{bot.name}</h3>
                {bot.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{bot.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                  bot.is_active 
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' 
                    : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                }`}>
                  {bot.is_active ? 'Активен' : 'Отключен'}
                </span>
                {botStatuses[bot.id] && (
                  <span className={`inline-flex items-center px-2 py-1 text-xs rounded-full ${
                    botStatuses[bot.id].running
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                  }`}>
                    <span className={`w-2 h-2 rounded-full mr-1 ${
                      botStatuses[bot.id].running ? 'bg-blue-400' : 'bg-gray-400'
                    }`}></span>
                    {botStatuses[bot.id].running ? 'Запущен' : 'Остановлен'}
                  </span>
                )}
              </div>
            </div>
            
            <div className="text-sm">
              <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                {bot.identifier}
              </code>
            </div>
            
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Создан: {new Date(bot.created_at).toLocaleDateString('ru-RU')}
            </div>

            {(bot.exchange_chat_link || bot.reviews_chat_link) && (
              <div className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">Ссылки:</span>
                <div className="flex gap-3 mt-1">
                  {bot.exchange_chat_link && (
                    <a 
                      href={bot.exchange_chat_link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      title="Чат обменника"
                    >
                      💬 Чат
                    </a>
                  )}
                  {bot.reviews_chat_link && (
                    <a 
                      href={bot.reviews_chat_link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                      title="Отзывы"
                    >
                      📖 Отзывы
                    </a>
                  )}
                </div>
              </div>
            )}
            
            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <Link to={`/bots/${bot.id}`}>
                <ActionButton
                  type="view"
                  variant="primary"
                  title="Подробнее"
                />
              </Link>
              <ActionButton
                type="edit"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit(bot);
                }}
                variant="default"
                title="Редактировать"
              />
              <ActionButton
                type="power"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleStatus(bot.id);
                }}
                variant={bot.is_active ? "danger" : "success"}
                title={bot.is_active ? 'Отключить' : 'Включить'}
              />
              <ActionButton
                type="delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(bot.id);
                }}
                variant="danger"
                title="Удалить"
              />
            </div>
          </div>
        )}
        loading={loading}
        emptyMessage="Боты не найдены"
      />

      {/* Пагинация */}
      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.pages}
        totalItems={pagination.total}
        itemsPerPage={pagination.limit}
        onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
      />

      {/* модалка */}
      <Modal
        isOpen={showCreateModal}
        onClose={handleCloseModal}
        title={editingBot ? 'Редактировать бота' : 'Добавить бота'}
        size="md"
        icon={<Bot className="w-6 h-6" />}
        iconColor="indigo"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* имя бота */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <Type className="w-4 h-4 text-blue-500" />
              Название
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
              placeholder="Название бота"
              required
            />
          </div>

          {/* токен бота */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <Key className="w-4 h-4 text-blue-500" />
              Токен бота
            </label>
            <input
              type="text"
              value={formData.token}
              onChange={(e) => setFormData({...formData, token: e.target.value})}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
              placeholder="1234567890:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              minLength="10"
              required
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Минимум 10 символов. Получить токен можно у @BotFather в Telegram
            </p>
          </div>

          {/* ссылка на чат */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <Link2 className="w-4 h-4 text-blue-500" />
              Ссылка на чат <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">(опционально)</span>
            </label>
            <input
              type="url"
              value={formData.exchange_chat_link}
              onChange={(e) => setFormData({...formData, exchange_chat_link: e.target.value})}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
              placeholder="https://t.me/your_chat"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Ссылка на чат обменника
            </p>
          </div>

          {/* ссылка на чат с отзывами */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <MessageCircle className="w-4 h-4 text-blue-500" />
              Ссылка на отзывы <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">(опционально)</span>
            </label>
            <input
              type="url"
              value={formData.reviews_chat_link}
              onChange={(e) => setFormData({...formData, reviews_chat_link: e.target.value})}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
              placeholder="https://t.me/your_reviews"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Ссылка на канал с отзывами
            </p>
          </div>

          {/* chat_id для отзывов */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <Hash className="w-4 h-4 text-blue-500" />
              Chat ID отзывов <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">(опционально)</span>
            </label>
            <input
              type="text"
              value={formData.reviews_chat_id}
              onChange={(e) => setFormData({...formData, reviews_chat_id: e.target.value})}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
              placeholder="-1001234567890"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Числовой ID канала/группы для публикации отзывов (формат: -1001234567890)
            </p>
          </div>

          {/* описание */}
          <div className="relative">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              <FileText className="w-4 h-4 text-blue-500" />
              Описание
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              rows={3}
              className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium resize-none"
              placeholder="Описание бота (необязательно)"
            />
          </div>

          {/* статус */}
          <div className="relative flex items-center gap-3 p-4 bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-purple-50/50 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20 rounded-xl border-2 border-gray-200 dark:border-gray-700">
            <input
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
              className="h-5 w-5 text-indigo-600 focus:ring-2 focus:ring-indigo-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 cursor-pointer transition-all"
            />
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none">
              <Activity className="w-4 h-4 text-green-500" />
              Активен
            </label>
          </div>

{/* Сообщение об ошибке */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
            </div>
          )}

          {/* кнопки действия */}
          <div className="flex justify-end gap-3 pt-6 border-t-2 border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleCloseModal}
              className="group flex items-center gap-2 px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-semibold transition-all duration-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:scale-105 active:scale-95"
            >
              <CloseIcon className="w-4 h-4" />
              Отмена
            </button>
            <button
              type="submit"
              className="group relative overflow-hidden flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative flex items-center gap-2">
                {editingBot ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editingBot ? 'Сохранить' : 'Создать'}
              </span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default BotsPage;