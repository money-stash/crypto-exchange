import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmDialog } from '../contexts/ConfirmContext';
import { useAuth } from '../hooks/useAuth';
import { mailingsApi, botsApi } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ResponsiveTable from '../components/ResponsiveTable';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import TelegramTextEditor from '../components/TelegramTextEditor';
import { MessageCircle, Plus, AlertCircle } from 'lucide-react';
import { toast } from 'react-toastify';

const Mailings = () => {
  const { confirm } = useConfirmDialog();
  const { user } = useAuth();
  const [mailings, setMailings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRaffleModal, setShowRaffleModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedMailing, setSelectedMailing] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [loadingDetailsId, setLoadingDetailsId] = useState(null);
  const [availableBots, setAvailableBots] = useState([]);
  const [loadingBots, setLoadingBots] = useState(false);
  
  const [formData, setFormData] = useState({
    bot_id: '',
    text: '',
    attachments: []
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRaffleSubmitting, setIsRaffleSubmitting] = useState(false);
  const [raffleError, setRaffleError] = useState('');
  const [raffleResult, setRaffleResult] = useState(null);
  const [raffleForm, setRaffleForm] = useState({
    bot_id: '',
    raffle_name: 'Машрум',
    recipients_text: ''
  });

  // проверяем есть ли у юзера доступ к рассылкам
  const hasMailingAccess = user?.role === 'SUPERADMIN' || user?.role === 'EX_ADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const extractBots = (responseData) => {
    const payload = responseData?.data || responseData;
    if (Array.isArray(payload?.bots)) return payload.bots;
    if (Array.isArray(payload)) return payload;
    return [];
  };

  useEffect(() => {
    if (hasMailingAccess) {
      fetchMailings();
    }
  }, [pagination.page, hasMailingAccess]);

  useEffect(() => {
    if (hasMailingAccess) {
      fetchAvailableBots();
    }
  }, [hasMailingAccess, isSuperAdmin]);

  const fetchAvailableBots = async () => {
    try {
      setLoadingBots(true);
      const response = await botsApi.getBots({ page: 1, limit: 100 });
      const bots = extractBots(response.data);
      setAvailableBots(bots);

      const firstBotId = bots[0]?.id ?? '';
      const resolvedDefault = isSuperAdmin ? 0 : firstBotId;

      setFormData((prev) => ({
        ...prev,
        bot_id: prev.bot_id === '' ? resolvedDefault : prev.bot_id
      }));
      setRaffleForm((prev) => ({
        ...prev,
        bot_id: prev.bot_id === '' ? resolvedDefault : prev.bot_id
      }));
    } catch (fetchBotsError) {
      console.error('Failed to fetch bots for mailing:', fetchBotsError);
      const backendMessage = fetchBotsError?.response?.data?.error || fetchBotsError?.message;
      setError((prev) => prev || (backendMessage ? `Ошибка загрузки списка ботов: ${backendMessage}` : 'Ошибка загрузки списка ботов'));
    } finally {
      setLoadingBots(false);
    }
  };

  const fetchMailings = async () => {
    try {
      setLoading(true);
      const response = await mailingsApi.getMailings({
        page: pagination.page,
        limit: pagination.limit
      });
      
      const responseData = response.data?.data || response.data;
      const mailingsArray = responseData?.mailings || responseData || [];
      
      setMailings(mailingsArray);
      setPagination(prev => ({
        ...prev,
        total: responseData?.total || mailingsArray.length || 0,
        pages: responseData?.pages || Math.ceil((responseData?.total || mailingsArray.length || 0) / prev.limit)
      }));
    } catch (error) {
      console.error('Failed to fetch mailings:', error);
      setError('Ошибка загрузки рассылок');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.text.trim()) {
      setError('Текст рассылки обязателен');
      return;
    }

    if (formData.bot_id === '' || formData.bot_id === null || formData.bot_id === undefined) {
      setError('Выберите бота');
      return;
    }

    setIsSubmitting(true);

    try {
      // Подготавливаем данные для отправки
      const mailingData = {
        bot_id: Number(formData.bot_id),
        text: formData.text,
        attachments: formData.attachments && formData.attachments.length > 0 ? 
          formData.attachments.map(att => ({
            type: att.type,
            name: att.name,
            // В реальном приложении здесь будет загрузка файла на сервер
            // и получение URL. Пока сохраняем как base64 для демонстрации
            data: att.preview
          })) : null
      };

      console.log('Mailings: Sending mailing data =>', mailingData);
      console.log('Mailings: Text being sent =>', formData.text);

      await mailingsApi.createMailing(mailingData);
      
      // Показываем уведомление об успехе
      toast.success('Рассылка успешно создана и запущена!', {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
      
      setShowCreateModal(false);
      setFormData({ bot_id: isSuperAdmin ? 0 : (availableBots[0]?.id ?? ''), text: '', attachments: [] });
      fetchMailings();
    } catch (error) {
      console.error('Failed to create mailing:', error);
      setError(error.response?.data?.error || 'Ошибка создания рассылки');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTextEditorChange = (text, attachments) => {
    console.log('Mailings: Received text from editor =>', text);
    console.log('Mailings: Received attachments from editor =>', attachments);
    setFormData(prev => ({
      ...prev,
      text: text,
      attachments: attachments || []
    }));
  };

  const resetRaffleForm = () => {
    setRaffleForm({
      bot_id: isSuperAdmin ? 0 : (availableBots[0]?.id ?? ''),
      raffle_name: 'Машрум',
      recipients_text: ''
    });
    setRaffleError('');
    setRaffleResult(null);
    setIsRaffleSubmitting(false);
  };

  const handleRaffleSubmit = async (e) => {
    e.preventDefault();
    setRaffleError('');
    setRaffleResult(null);

    if (!String(raffleForm.recipients_text || '').trim()) {
      setRaffleError('Добавьте список получателей');
      return;
    }

    if (raffleForm.bot_id === '' || raffleForm.bot_id === null || raffleForm.bot_id === undefined) {
      setRaffleError('Выберите бота');
      return;
    }

    setIsRaffleSubmitting(true);
    try {
      const payload = {
        bot_id: Number(raffleForm.bot_id),
        raffle_name: String(raffleForm.raffle_name || '').trim() || 'Машрум',
        recipients_text: String(raffleForm.recipients_text || '')
      };

      const response = await mailingsApi.createRaffleMailing(payload);
      const result = response?.data?.data || null;
      setRaffleResult(result);

      const sent = Number(result?.sent_count || 0);
      const failed = Number(result?.failed_count || 0);
      toast.success(`Розыгрыш отправлен: ${sent} успешно, ${failed} с ошибкой`);
    } catch (requestError) {
      console.error('Failed to send raffle mailing:', requestError);
      setRaffleError(
        requestError?.response?.data?.error ||
        'Ошибка отправки розыгрышной рассылки'
      );
    } finally {
      setIsRaffleSubmitting(false);
    }
  };

  const handleCancel = async (mailing) => {
    const isConfirmed = await confirm({
      title: 'Отменить рассылку',
      message: `Вы уверены, что хотите отменить рассылку? Уже отправлено: ${mailing.send_count}/${mailing.total_count}`,
      confirmText: 'Отменить рассылку',
      cancelText: 'Нет'
    });

    if (!isConfirmed) return;

    try {
      await mailingsApi.cancelMailing(mailing.id);
      fetchMailings();
    } catch (error) {
      console.error('Failed to cancel mailing:', error);
      setError(error.response?.data?.error || 'Ошибка отмены рассылки');
    }
  };

  const handleDelete = async (mailing) => {
    const isConfirmed = await confirm({
      title: 'Удалить рассылку',
      message: 'Вы уверены, что хотите удалить эту рассылку? Это действие нельзя отменить.',
      confirmText: 'Удалить',
      cancelText: 'Отмена'
    });

    if (!isConfirmed) return;

    try {
      await mailingsApi.deleteMailing(mailing.id);
      fetchMailings();
    } catch (error) {
      console.error('Failed to delete mailing:', error);
      setError(error.response?.data?.error || 'Ошибка удаления рассылки');
    }
  };

  const showDetails = async (mailing) => {
    setLoadingDetailsId(mailing.id);
    try {
      const response = await mailingsApi.getMailing(mailing.id);
      setSelectedMailing(response.data);
      setShowDetailsModal(true);
    } catch (error) {
      console.error('Failed to fetch mailing details:', error);
      setError('Ошибка загрузки деталей рассылки');
    } finally {
      setLoadingDetailsId(null);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      active: 'bg-gradient-to-r from-green-100 via-green-200 to-green-100 dark:from-green-900/40 dark:via-green-800/40 dark:to-green-900/40 text-green-800 dark:text-green-300 shadow-sm shadow-green-500/20 border border-green-300/30 dark:border-green-600/30',
      end: 'bg-gradient-to-r from-blue-100 via-blue-200 to-blue-100 dark:from-blue-900/40 dark:via-blue-800/40 dark:to-blue-900/40 text-blue-800 dark:text-blue-300 shadow-sm shadow-blue-500/20 border border-blue-300/30 dark:border-blue-600/30',
      cancel: 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 shadow-sm shadow-red-500/20 border border-red-300/30 dark:border-red-600/30'
    };

    const labels = {
      active: 'Активна',
      end: 'Завершена',
      cancel: 'Отменена'
    };


    const badge = badges[status] || 'bg-gray-100 text-gray-800';
    const label = labels[status] || status;

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide ${badge} transition-all duration-200 hover:scale-105`}>
        <span>{label}</span>
      </span>
    );
  };

  const formatText = (text, maxLength = 50) => {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ru-RU');
  };

  const getProgressPercentage = (sent, total) => {
    if (total === 0) return 0;
    return Math.round((sent / total) * 100);
  };

  const getBotDisplayName = (mailing) => {
    if (mailing.bot_id === 0) return 'Все боты';
    return mailing.bot_name || `Бот #${mailing.bot_id}`;
  };

  if (!hasMailingAccess) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/20">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Доступ запрещен</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            У вас нет прав для просмотра рассылок
          </p>
        </div>
      </div>
    );
  }

  const columns = [
    {
      header: 'ID',
      key: 'id',
      width: '80px',
      render: (mailing) => (
        <button
          onClick={() => showDetails(mailing)}
          className="inline-flex items-center px-2.5 py-1 rounded-lg font-semibold text-blue-600 dark:text-blue-400 hover:text-white hover:bg-gradient-to-r hover:from-blue-500 hover:to-indigo-600 transition-all duration-200 hover:shadow-md"
        >
          #{mailing.id}
        </button>
      )
    },
    {
      header: 'Бот',
      key: 'bot',
      width: '140px',
      render: (mailing) => (
        <div className="flex flex-col space-y-1">
          <span className="font-semibold text-gray-900 dark:text-gray-200">
            {getBotDisplayName(mailing)}
          </span>
          {mailing.bot_id !== 0 && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-500">
              ID: {mailing.bot_id}
            </span>
          )}
        </div>
      )
    },
    {
      header: 'Текст',
      key: 'text',
      render: (mailing) => (
        <div className="max-w-xs">
          <div 
            className="font-medium text-gray-900 dark:text-white"
            dangerouslySetInnerHTML={{
              __html: formatText(mailing.text, 40)
                .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
                .replace(/_([^_]+)_/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs">$1</code>')
                .replace(/~([^~]+)~/g, '<del>$1</del>')
                .replace(/__([^_]+)__/g, '<u>$1</u>')
            }}
          />
          {mailing.attachments && mailing.attachments.length > 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
              <span>📎</span>
              <span>{mailing.attachments.length} вложений</span>
            </div>
          )}
        </div>
      )
    },
    {
      header: 'Статус',
      key: 'status',
      width: '140px',
      render: (mailing) => getStatusBadge(mailing.status)
    },
    {
      header: 'Прогресс',
      key: 'progress',
      width: '160px',
      render: (mailing) => (
        <div className="w-32">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span className="font-semibold">{mailing.send_count}</span>
            <span className="font-semibold">{mailing.total_count}</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 shadow-inner">
            <div 
              className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-300 shadow-sm"
              style={{ width: `${getProgressPercentage(mailing.send_count, mailing.total_count)}%` }}
            ></div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center font-medium">
            {getProgressPercentage(mailing.send_count, mailing.total_count)}%
          </div>
          {mailing.error_send_count > 0 && (
            <div className="text-xs text-red-500 dark:text-red-400 mt-1 text-center font-medium">
              Ошибки: {mailing.error_send_count}
            </div>
          )}
        </div>
      )
    },
    {
      header: 'Создана',
      key: 'created_at',
      width: '140px',
      render: (mailing) => (
        <span className="font-medium text-gray-600 dark:text-gray-400">
          {formatDate(mailing.created_at)}
        </span>
      )
    },
    {
      header: 'Действия',
      key: 'actions',
      width: '120px',
      render: (mailing) => (
        <div className="flex gap-1 justify-end lg:justify-start">
          <ActionButton
            onClick={() => showDetails(mailing)}
            variant="info"
            size="sm"
            title="Подробнее"
            loading={loadingDetailsId === mailing.id}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </ActionButton>
          
          {mailing.status === 'active' && (
            <ActionButton
              onClick={() => handleCancel(mailing)}
              variant="warning"
              size="sm"
              title="Отменить"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </ActionButton>
          )}

          {mailing.status !== 'active' && (
            <ActionButton
              onClick={() => handleDelete(mailing)}
              variant="danger"
              size="sm"
              title="Удалить"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </ActionButton>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* премиум */}
      <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
        
        <div className="relative px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                  Рассылки
                </h1>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                  Управление Telegram рассылками
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  resetRaffleForm();
                  setShowRaffleModal(true);
                }}
                className="group relative px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl flex items-center gap-2.5 hover:scale-105 active:scale-95 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <span className="relative z-10">Розыгрыш</span>
              </button>

              <button
                onClick={() => setShowCreateModal(true)}
                className="group relative px-6 py-3 bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl flex items-center gap-2.5 hover:scale-105 active:scale-95 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <Plus className="w-5 h-5 relative z-10" />
                <span className="relative z-10">Создать рассылку</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ошибка */}
      {error && (
        <div className="relative bg-red-50/90 dark:bg-red-900/20 backdrop-blur-xl border-2 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 px-5 py-4 rounded-xl shadow-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      <ResponsiveTable
        columns={columns}
        data={mailings}
        keyField="id"
        loading={loading}
        emptyMessage="Рассылки не найдены"
        mobileCardRender={(mailing) => (
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">#{mailing.id}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{getBotDisplayName(mailing)}</p>
              </div>
              <div className="flex gap-2">
                {getStatusBadge(mailing.status)}
              </div>
            </div>
            
            <div className="text-sm">
              <div 
                className="font-medium text-gray-900 dark:text-gray-100 mb-1"
                dangerouslySetInnerHTML={{
                  __html: formatText(mailing.text, 60)
                    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
                    .replace(/_([^_]+)_/g, '<em>$1</em>')
                    .replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs">$1</code>')
                    .replace(/~([^~]+)~/g, '<del>$1</del>')
                    .replace(/__([^_]+)__/g, '<u>$1</u>')
                }}
              />
              {mailing.attachments && mailing.attachments.length > 0 && (
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <span>📎</span>
                  <span>{mailing.attachments.length} вложений</span>
                </div>
              )}
            </div>
            
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                <span className="font-semibold">Прогресс:</span>
                <span className="font-semibold">{mailing.send_count}/{mailing.total_count}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 shadow-inner">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${getProgressPercentage(mailing.send_count, mailing.total_count)}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                {getProgressPercentage(mailing.send_count, mailing.total_count)}%
              </div>
              {mailing.error_send_count > 0 && (
                <div className="text-xs text-red-500 dark:text-red-400 mt-1 text-center">
                  Ошибки: {mailing.error_send_count}
                </div>
              )}
            </div>
            
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Создана: {formatDate(mailing.created_at)}
            </div>
            
            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <ActionButton
                onClick={() => showDetails(mailing)}
                variant="info"
                size="sm"
                title="Подробнее"
                loading={loadingDetailsId === mailing.id}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </ActionButton>
              
              {mailing.status === 'active' && (
                <ActionButton
                  onClick={() => handleCancel(mailing)}
                  variant="warning"
                  size="sm"
                  title="Отменить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </ActionButton>
              )}

              {mailing.status !== 'active' && (
                <ActionButton
                  onClick={() => handleDelete(mailing)}
                  variant="danger"
                  size="sm"
                  title="Удалить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </ActionButton>
              )}
            </div>
          </div>
        )}
      />

      {/* пагинация */}
      {pagination.pages > 1 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.pages}
          totalItems={pagination.total}
          itemsPerPage={pagination.limit}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
        />
      )}

      {/* создание рассылки модальное окно */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          if (!isSubmitting) {
            setShowCreateModal(false);
            setFormData({ bot_id: isSuperAdmin ? 0 : (availableBots[0]?.id ?? ''), text: '', attachments: [] });
            setError('');
            setIsSubmitting(false);
          }
        }}
        title="Создать рассылку"
        size="lg"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
              <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Бот *
            </label>
            <select
              value={String(formData.bot_id)}
              onChange={(e) => {
                const value = e.target.value;
                setFormData((prev) => ({ ...prev, bot_id: value === '' ? '' : Number(value) }));
              }}
              disabled={isSubmitting || loadingBots}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {!isSuperAdmin && <option value="">Выберите бота</option>}
              {isSuperAdmin && <option value="0">Все боты</option>}
              {availableBots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} ({bot.identifier})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Текст рассылки *
            </label>
            <TelegramTextEditor
              value={formData.text}
              onChange={handleTextEditorChange}
              placeholder="Введите текст рассылки"
              maxLength={4096}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(false);
                setFormData({ bot_id: isSuperAdmin ? 0 : (availableBots[0]?.id ?? ''), text: '', attachments: [] });
                setError('');
                setIsSubmitting(false);
              }}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!formData.text.trim() || isSubmitting}
              className={`relative px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium min-w-[160px] flex items-center justify-center gap-2 ${isSubmitting ? 'animate-pulse' : ''}`}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Создание...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  <span>Создать рассылку</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showRaffleModal}
        onClose={() => {
          if (!isRaffleSubmitting) {
            setShowRaffleModal(false);
            resetRaffleForm();
          }
        }}
        title="Розыгрышная рассылка"
        size="lg"
      >
        <form onSubmit={handleRaffleSubmit} className="space-y-5">
          {raffleError && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
              <p className="text-red-700 dark:text-red-400 text-sm">{raffleError}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Бот *
            </label>
            <select
              value={String(raffleForm.bot_id)}
              onChange={(e) => {
                const value = e.target.value;
                setRaffleForm((prev) => ({ ...prev, bot_id: value === '' ? '' : Number(value) }));
              }}
              disabled={isRaffleSubmitting || loadingBots}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {!isSuperAdmin && <option value="">Выберите бота</option>}
              {isSuperAdmin && <option value="0">Все боты</option>}
              {availableBots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} ({bot.identifier})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Название розыгрыша
            </label>
            <input
              type="text"
              value={raffleForm.raffle_name}
              onChange={(e) => setRaffleForm((prev) => ({ ...prev, raffle_name: e.target.value }))}
              placeholder="Машрум"
              maxLength={80}
              disabled={isRaffleSubmitting}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Пользователь получит: «Ваш номер в розыгрыше {raffleForm.raffle_name || 'Машрум'}: N»
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Получатели (каждая строка - новый человек)
            </label>
            <textarea
              rows={10}
              value={raffleForm.recipients_text}
              onChange={(e) => setRaffleForm((prev) => ({ ...prev, recipients_text: e.target.value }))}
              placeholder={'1 @xxxosgg\n2 @theasteriskkk8\n3 @DrunkSnail\n4 8505788939'}
              disabled={isRaffleSubmitting}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Можно указывать `@username`, `tg_id`, а также нумерацию в начале строки.
            </p>
          </div>

          {raffleResult && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/90 dark:bg-gray-800/70 p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-white dark:bg-gray-900 p-2 text-center">
                  <div className="text-gray-500 dark:text-gray-400 text-xs">Валидных</div>
                  <div className="font-semibold text-gray-900 dark:text-gray-100">{raffleResult.valid_targets || 0}</div>
                </div>
                <div className="rounded-lg bg-white dark:bg-gray-900 p-2 text-center">
                  <div className="text-gray-500 dark:text-gray-400 text-xs">Успешно</div>
                  <div className="font-semibold text-green-600">{raffleResult.sent_count || 0}</div>
                </div>
                <div className="rounded-lg bg-white dark:bg-gray-900 p-2 text-center">
                  <div className="text-gray-500 dark:text-gray-400 text-xs">Ошибки</div>
                  <div className="font-semibold text-red-600">{raffleResult.failed_count || 0}</div>
                </div>
              </div>

              {Array.isArray(raffleResult.results) && raffleResult.results.length > 0 && (
                <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {raffleResult.results.map((row, index) => (
                      <div key={`${row.line || index}_${row.input || ''}_${index}`} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-300 truncate">
                          {row.line}. {row.input}
                        </span>
                        <span className={row.status === 'sent' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {row.status === 'sent' ? `#${row.raffle_number}` : (row.reason || 'Ошибка')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowRaffleModal(false);
                resetRaffleForm();
              }}
              disabled={isRaffleSubmitting}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 font-medium disabled:opacity-50"
            >
              Закрыть
            </button>
            <button
              type="submit"
              disabled={isRaffleSubmitting || !String(raffleForm.recipients_text || '').trim()}
              className="px-4 py-2 rounded-lg text-white font-medium bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50"
            >
              {isRaffleSubmitting ? 'Отправка...' : 'Отправить'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showDetailsModal}
        onClose={() => {
          setShowDetailsModal(false);
          setSelectedMailing(null);
        }}
        title="Детали рассылки"
        size="xl"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      >
        {selectedMailing && (
          <div className="space-y-8">
            <div className="relative bg-gradient-to-br from-blue-50/60 via-indigo-50/40 to-purple-50/60 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-purple-950/30 rounded-2xl p-6 border border-gray-200/50 dark:border-gray-600/50">
              <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-6">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                      <MessageCircle className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Рассылка #{selectedMailing.id}
                      </h2>
                      <p className="text-gray-600 dark:text-gray-400 font-medium">
                        {getBotDisplayName(selectedMailing)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {getStatusBadge(selectedMailing.status)}
                    <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                      Создана: {formatDate(selectedMailing.created_at)}
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/30 dark:border-gray-600/30 shadow-md min-w-[200px]">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                      {getProgressPercentage(selectedMailing.send_count, selectedMailing.total_count)}%
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {selectedMailing.send_count} из {selectedMailing.total_count}
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 shadow-inner">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                        style={{ width: `${getProgressPercentage(selectedMailing.send_count, selectedMailing.total_count)}%` }}
                      ></div>
                    </div>
                    {selectedMailing.error_send_count > 0 && (
                      <div className="text-xs text-red-500 dark:text-red-400 mt-2 font-medium">
                        Ошибки: {selectedMailing.error_send_count}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedMailing.end_at && (
                <div className="mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-600/50">
                  <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                    Завершена: {formatDate(selectedMailing.end_at)}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-6 border border-gray-200/50 dark:border-gray-600/50">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Текст сообщения
              </h3>
              
              <div className="bg-gradient-to-br from-gray-50/80 to-blue-50/40 dark:from-gray-900/60 dark:to-blue-950/30 rounded-xl p-5 border border-gray-200/30 dark:border-gray-600/30">
                <div 
                  className="text-gray-900 dark:text-gray-100 leading-relaxed"
                  style={{ 
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                  dangerouslySetInnerHTML={{
                    __html: selectedMailing.text
                      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
                      .replace(/_([^_]+)_/g, '<em>$1</em>')
                      .replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded text-sm">$1</code>')
                      .replace(/~([^~]+)~/g, '<del>$1</del>')
                      .replace(/__([^_]+)__/g, '<u>$1</u>')
                      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline">$1</a>')
                  }}
                />
              </div>
            </div>

            {/* Attachments */}
            {selectedMailing.attachments && selectedMailing.attachments.length > 0 && (
              <div className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-6 border border-gray-200/50 dark:border-gray-600/50">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Вложения ({selectedMailing.attachments.length})
                </h3>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {selectedMailing.attachments.map((attachment, index) => {
                    const getImageUrl = (attachment) => {
                      if (attachment.data || attachment.url || attachment.preview || attachment.file_url) {
                        return attachment.data || attachment.url || attachment.preview || attachment.file_url;
                      }
                      
                      if (attachment.path) {
                        const baseUrl = window.location.origin.includes('localhost') 
                          ? 'http://localhost:8080' 
                          : window.location.origin.replace(':5174', ':8080').replace(':3000', ':8080');
                        
                        return `${baseUrl}/uploads/${attachment.path}`;
                      }
                      
                      if (attachment.name) {
                        const baseUrl = window.location.origin.includes('localhost') 
                          ? 'http://localhost:8080' 
                          : window.location.origin.replace(':5174', ':8080').replace(':3000', ':8080');
                        
                        return `${baseUrl}/uploads/mailings/${attachment.name}`;
                      }
                      
                      return null;
                    };

                    const imageUrl = getImageUrl(attachment);
                    
                    // определяем тип файла для правильной обработки
                    const isVideo = attachment.type === 'video' || 
                                   attachment.mimeType?.startsWith('video/') ||
                                   (imageUrl && (imageUrl.endsWith('.mp4') || imageUrl.endsWith('.webm') || imageUrl.endsWith('.mov')));
                    const isGif = attachment.type === 'animation' || attachment.mimeType === 'image/gif';

                    const openFullscreen = () => {
                      // Улучшенная логика определения типа медиа
                      const isVideo = attachment.type === 'video' || 
                                     attachment.mimeType?.startsWith('video/') ||
                                     (imageUrl && (imageUrl.endsWith('.mp4') || imageUrl.endsWith('.webm') || imageUrl.endsWith('.mov')));
                      const isGif = attachment.type === 'animation' || 
                                   attachment.mimeType === 'image/gif' ||
                                   (imageUrl && imageUrl.endsWith('.gif'));
                      
                      setSelectedImage({
                        url: imageUrl,
                        name: attachment.name,
                        type: attachment.type,
                        mimeType: attachment.mimeType,
                        isVideo: isVideo,
                        isGif: isGif
                      });
                      setShowImageModal(true);
                    };

                    return (
                      <div key={index} className="group relative">
                        <button
                          onClick={openFullscreen}
                          className="aspect-square rounded-xl overflow-hidden border-2 border-gray-200/50 dark:border-gray-600/50 shadow-lg hover:shadow-xl transition-all duration-300 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm w-full hover:scale-105 cursor-pointer"
                        >
                          {imageUrl ? (
                            // Если это видео или GIF
                            (isVideo || isGif) ? (
                              <video
                                src={imageUrl}
                                className="w-full h-full object-cover"
                                muted
                                loop
                                playsInline
                                autoPlay={isGif}
                                onMouseEnter={(e) => e.target.play()}
                                onMouseLeave={(e) => {
                                  if (!isGif) e.target.pause();
                                }}
                                onError={(e) => {
                                  console.error('Failed to load video:', imageUrl);
                                }}
                              />
                            ) : (
                              // Обычное изображение (фото)
                              <img
                                src={imageUrl}
                                alt={attachment.name || 'Вложение'}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  console.error('Failed to load image:', imageUrl);
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
                              />
                            )
                          ) : (
                            // Placeholder для случая, когда нет изображения
                            <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-700">
                              <div className="text-center p-4">
                                <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                                  {attachment.name || 'Файл'}
                                </div>
                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                  {attachment.type || attachment.mimeType || 'Нет данных'}
                                </div>
                              </div>
                            </div>
                          )}
                          
                          <div className="w-full h-full items-center justify-center bg-gray-100 dark:bg-gray-700 hidden" style={{display: 'none'}}>
                            <div className="text-center p-4">
                              <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L4.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                              </svg>
                              <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                Ошибка загрузки
                              </div>
                            </div>
                          </div>
                          
                          <div className="absolute top-2 left-2 pointer-events-none">
                            {(attachment.type === 'animation' || attachment.mimeType === 'image/gif') && (
                              <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white text-xs px-2 py-1 rounded-lg font-semibold shadow-md">
                                GIF
                              </div>
                            )}
                            {(attachment.type === 'video' || attachment.mimeType?.startsWith('video/')) && attachment.type !== 'animation' && attachment.mimeType !== 'image/gif' && (
                              <div className="bg-gradient-to-r from-red-500 to-red-600 text-white text-xs px-2 py-1 rounded-lg font-semibold shadow-md">
                                VIDEO
                              </div>
                            )}
                            {(attachment.type === 'image' || (attachment.mimeType?.startsWith('image/') && attachment.mimeType !== 'image/gif')) && attachment.type !== 'animation' && (
                              <div className="bg-gradient-to-r from-green-500 to-green-600 text-white text-xs px-2 py-1 rounded-lg font-semibold shadow-md">
                                PHOTO
                              </div>
                            )}
                            {!attachment.type && !attachment.mimeType && (
                              <div className="bg-gradient-to-r from-gray-500 to-gray-600 text-white text-xs px-2 py-1 rounded-lg font-semibold shadow-md">
                                FILE
                              </div>
                            )}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}        
            
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200/50 dark:border-gray-600/50">
              {selectedMailing.status === 'active' && (
                <ActionButton
                  onClick={() => {
                    setShowDetailsModal(false);
                    handleCancel(selectedMailing);
                  }}
                  variant="warning"
                  className="shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Отменить рассылку
                </ActionButton>
              )}
              <ActionButton
                onClick={() => {
                  setShowDetailsModal(false);
                  setSelectedMailing(null);
                }}
                variant="secondary"
                className="shadow-lg hover:shadow-xl transition-all duration-200"
              >
                Закрыть
              </ActionButton>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showImageModal}
        onClose={() => {
          setShowImageModal(false);
          setSelectedImage(null);
        }}
        title="Просмотр вложения"
        size="2xl"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        }
      >
        {selectedImage && (
          <div className="space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {selectedImage.name || 'Вложение'}
              </h3>
              
              <div className="relative bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden shadow-lg max-h-[70vh] flex items-center justify-center">
                {selectedImage.isVideo || selectedImage.type === 'animation' || selectedImage.mimeType === 'image/gif' ? (
                  <video
                    src={selectedImage.url}
                    controls={selectedImage.isVideo && selectedImage.type !== 'animation' && selectedImage.mimeType !== 'image/gif'}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="max-w-full max-h-full object-contain"
                    style={{ maxHeight: '70vh' }}
                  />
                ) : (
                  <img
                    src={selectedImage.url}
                    alt={selectedImage.name || 'Вложение'}
                    className="max-w-full max-h-full object-contain"
                    style={{ maxHeight: '70vh' }}
                  />
                )}
              </div>
              
              {/* <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                {selectedImage.type && (
                  <span className="mr-4">Тип: {selectedImage.type}</span>
                )}
                {selectedImage.mimeType && (
                  <span>MIME: {selectedImage.mimeType}</span>
                )}
              </div> */}
            </div>
            
            <div className="flex justify-center pt-4">
              <ActionButton
                onClick={() => {
                  setShowImageModal(false);
                  setSelectedImage(null);
                }}
                variant="secondary"
              >
                Закрыть
              </ActionButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Mailings;
