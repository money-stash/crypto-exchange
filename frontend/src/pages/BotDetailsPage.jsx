import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useConfirmDialog } from '../contexts/ConfirmContext';
import { botsApi, ratesApi } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { ActionButton } from '../components/ActionButton';
import FeeTiersModal from '../components/FeeTiersModal';
import TelegramTextEditor from '../components/TelegramTextEditor';
import Modal from '../components/Modal';
import { Check, RotateCcw, Loader2, ArrowLeft, Bot, MessageCircle, BookOpen, AlertTriangle, Activity, Save, TrendingUp, Users, Percent, ShoppingCart, DollarSign, Settings, MessageSquare, Edit } from 'lucide-react';
import { toast } from 'react-toastify';

const BotDetailsPage = () => {
    const { id } = useParams();
    const { confirm } = useConfirmDialog();
    const [bot, setBot] = useState(null);
    const [stats, setStats] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showRequisiteModal, setShowRequisiteModal] = useState(false);
    const [editingRequisite, setEditingRequisite] = useState(null);
    const [botActionLoading, setBotActionLoading] = useState(false);
    const [fees, setFees] = useState([]);
    const [rates, setRates] = useState([]);
    const [editingValues, setEditingValues] = useState({});
    const [savingFees, setSavingFees] = useState(false);
    const [refreshingStatus, setRefreshingStatus] = useState(false);
    
    // стейт для уровней комиссий
    const [feeTiers, setFeeTiers] = useState({});
    const [showFeeTiersModal, setShowFeeTiersModal] = useState(false);
    const [selectedCoinForTiers, setSelectedCoinForTiers] = useState('');

    // стейт для редактирования стартового сообщения
    const [showStartMessageModal, setShowStartMessageModal] = useState(false);
    const [startMessage, setStartMessage] = useState('');
    const [startMessageAttachments, setStartMessageAttachments] = useState([]);
    const [savingStartMessage, setSavingStartMessage] = useState(false);

    const [showContactsMessageModal, setShowContactsMessageModal] = useState(false);
    const [contactsMessage, setContactsMessage] = useState('');
    const [contactsMessageAttachments, setContactsMessageAttachments] = useState([]);
    const [savingContactsMessage, setSavingContactsMessage] = useState(false);

    const [requisiteForm, setRequisiteForm] = useState({
        type: 'CARD',
        label: '',
        address: '',
        bank_name: '',
        holder_name: '',
        is_active: true,
        is_default: false
    });

    useEffect(() => {
        fetchBotDetails();
        fetchBotStats();
        fetchBotStatus();
        fetchBotFees();
        fetchRates();
        fetchAllFeeTiers();
    }, [id]);

    const fetchBotDetails = async () => {
        try {
            const response = await botsApi.getBot(id);
            setBot(response.data);
        } catch (error) {
            console.error('Failed to fetch bot details:', error);
            setError('Ошибка загрузки данных бота');
        } finally {
            setLoading(false);
        }
    };

    const fetchBotStats = async () => {
        try {
            const response = await botsApi.getBotStats(id);
            setStats(response.data);
        } catch (error) {
            console.error('Failed to fetch bot stats:', error);
        }
    };

    const fetchBotStatus = async () => {
        try {
            const response = await botsApi.getBotStatus(id);
            setBotStatus(response.data);
        } catch (error) {
            console.error('Failed to fetch bot status:', error);
        }
    };

    const handleRefreshStatus = async () => {
        setRefreshingStatus(true);
        try {
            const response = await botsApi.getBotStatus(id);
            setBotStatus(response.data);
            toast.success('Статус бота успешно обновлен');
        } catch (error) {
            console.error('Failed to fetch bot status:', error);
            toast.error('Ошибка при обновлении статуса бота');
        } finally {
            setRefreshingStatus(false);
        }
    };

    const fetchBotFees = async () => {
        try {
            const response = await botsApi.getBotFees(id);
            setFees(response.data);
        } catch (error) {
            console.error('Failed to fetch bot fees:', error);
        }
    };

    const fetchRates = async () => {
        try {
            const response = await ratesApi.getRates();
            setRates(response.data);
        } catch (error) {
            console.error('Failed to fetch rates:', error);
        }
    };

    const fetchAllFeeTiers = async () => {
        try {
            const response = await botsApi.getBotFeeTiers(id);
            // группируем уровни по монетам
            const tiersByCoin = response.data.reduce((acc, tier) => {
                if (!acc[tier.coin]) {
                    acc[tier.coin] = [];
                }
                acc[tier.coin].push(tier);
                return acc;
            }, {});
            setFeeTiers(tiersByCoin);
        } catch (error) {
            console.error('Failed to fetch fee tiers:', error);
        }
    };

    const handleShowFeeTiers = (coin) => {
        setSelectedCoinForTiers(coin);
        setShowFeeTiersModal(true);
    };

    // Получение дефолтного стартового сообщения
    const getDefaultStartMessage = () => {
        const reviewsLink = bot?.reviews_chat_link ? bot.reviews_chat_link.replace('https://t.me/', '@') : 'не указан';
        const exchangeLink = bot?.exchange_chat_link ? bot.exchange_chat_link.replace('https://t.me/', '@') : 'не указан';
        
        return `▫️Magnit24 — это надежный сервис для конвертации RUB ⇄ BTC/LTC/XMR/USDT 

🔻Прозрачные курсы, которые вы можете увидеть в нашем боте, нажав кнопку "Курсы"
🔻Поддержка 24/7
🔻Канал с отзывами: ${reviewsLink}
🔻Чат нашего обменника: ${exchangeLink}`;
    };

    // Открытие модального окна редактирования стартового сообщения
    const handleEditStartMessage = () => {
        setStartMessage(bot?.start_message || getDefaultStartMessage());
        setStartMessageAttachments([]);
        setShowStartMessageModal(true);
    };

    // Сохранение стартового сообщения
    const handleSaveStartMessage = async () => {
        setSavingStartMessage(true);
        try {
            await botsApi.updateBot(id, {
                start_message: startMessage || null
            });
            
            // Перезапускаем бота только если он активен и запущен
            if (bot?.is_active && botStatus?.running) {
                try {
                    await botsApi.restartBot(id);
                    toast.success('Стартовое сообщение обновлено и бот перезапущен!');
                } catch (restartError) {
                    console.error('Error restarting bot:', restartError);
                    toast.warning('Стартовое сообщение обновлено, но бот не смог перезапуститься. Перезапустите вручную.');
                }
            } else {
                toast.success('Стартовое сообщение обновлено!');
            }
            
            setShowStartMessageModal(false);
            fetchBotDetails();
            fetchBotStatus();
        } catch (error) {
            console.error('Error updating start message:', error);
            toast.error('Ошибка при обновлении стартового сообщения');
        } finally {
            setSavingStartMessage(false);
        }
    };

const handleEditContactsMessage = () => {
  setContactsMessage(bot?.contacts_message || '');
  setContactsMessageAttachments([]);
  setShowContactsMessageModal(true);
};

const handleSaveContactsMessage = async () => {
  setSavingContactsMessage(true);
  try {
    await botsApi.updateBot(id, {
      contacts_message: contactsMessage || null
    });

    if (bot?.is_active && botStatus?.running) {
      try {
        await botsApi.restartBot(id);
        toast.success('Раздел "Контакты" обновлен и бот перезапущен!');
      } catch (restartError) {
        console.error('Error restarting bot:', restartError);
        toast.warning('Контакты обновлены, но бот не смог перезапуститься. Перезапустите вручную.');
      }
    } else {
      toast.success('Раздел "Контакты" обновлен!');
    }

    setShowContactsMessageModal(false);
    fetchBotDetails();
    fetchBotStatus();
  } catch (error) {
    console.error('Error updating contacts message:', error);
    toast.error('Ошибка при обновлении раздела "Контакты"');
  } finally {
    setSavingContactsMessage(false);
  }
};
    // Конвертация markdown в HTML для отображения
    const convertMarkdownToHtml = (text) => {
        if (!text) return '';
        
        let html = text
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline" target="_blank">$1</a>')
            .replace(/__([^_]+?)__/g, '<u>$1</u>')
            .replace(/`([^`]+?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-sm">$1</code>')
            .replace(/~([^~]+?)~/g, '<del>$1</del>')
            .replace(/\*([^*]+?)\*/g, '<strong>$1</strong>')
            .replace(/_([^_]+?)_/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        
        return html;
    };

    const formatCoinAmount = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return '0';
        return num.toFixed(8).replace(/\.?0+$/, '');
    };



    const handleStartBot = async () => {
        setBotActionLoading(true);
        try {
            await botsApi.startBot(id);
            await fetchBotStatus();
            setError('');
        } catch (error) {
            setError('Ошибка при запуске бота: ' + (error.response?.data?.error || error.message));
        } finally {
            setBotActionLoading(false);
        }
    };

    const handleStopBot = async () => {
        setBotActionLoading(true);
        try {
            await botsApi.stopBot(id);
            await fetchBotStatus();
            setError('');
        } catch (error) {
            setError('Ошибка при остановке бота: ' + (error.response?.data?.error || error.message));
        } finally {
            setBotActionLoading(false);
        }
    };

    const handleRestartBot = async () => {
        setBotActionLoading(true);
        try {
            await botsApi.restartBot(id);
            await fetchBotStatus();
            setError('');
        } catch (error) {
            setError('Ошибка при перезапуске бота: ' + (error.response?.data?.error || error.message));
        } finally {
            setBotActionLoading(false);
        }
    };

    const handleUpdateFees = async () => {
        setSavingFees(true);
        try {
            // Создаем комиссии для всех валют из rates, если их еще нет
            const allCoins = rates.map(rate => rate.coin);
            const feesToUpdate = allCoins.map(coin => {
                const existingFee = fees.find(f => f.coin === coin);
                return existingFee || {
                    coin,
                    buy_fee: 0,
                    sell_fee: 0
                };
            });

            await botsApi.updateBotFees(id, { fees: feesToUpdate });
            await fetchBotFees();
            toast.success('Комиссии бота успешно обновлены');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Ошибка обновления комиссий');
        } finally {
            setSavingFees(false);
        }
    };

    const handleFeeChange = (coin, field, value) => {
        const key = `${coin}_${field}`;
        
        // Сохраняем текущее редактируемое значение
        setEditingValues(prev => ({
            ...prev,
            [key]: value
        }));
        
        // Заменяем запятую на точку для правильного парсинга
        let normalizedValue = String(value).replace(',', '.');
        
        // Разрешаем пустое значение и отрицательные числа
        if (normalizedValue === '' || normalizedValue === '-') {
            setFees(prev => {
                const existingIndex = prev.findIndex(fee => fee.coin === coin);
                const newFee = { coin, [field]: 0, buy_fee: 0, sell_fee: 0 };
                
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = { ...updated[existingIndex], [field]: 0 };
                    return updated;
                } else {
                    return [...prev, newFee];
                }
            });
            return;
        }
        
        // Парсим число, поддерживая отрицательные значения
        const numValue = parseFloat(normalizedValue);
        if (!isNaN(numValue)) {
            // Преобразуем проценты в десятичную дробь (2.5% -> 0.025)
            const decimalValue = numValue / 100;
            
            setFees(prev => {
                const existingIndex = prev.findIndex(fee => fee.coin === coin);
                const newFee = { coin, [field]: decimalValue, buy_fee: 0, sell_fee: 0 };
                
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = { ...updated[existingIndex], [field]: decimalValue };
                    return updated;
                } else {
                    return [...prev, newFee];
                }
            });
        }
    };

    const getFieldValue = (coin, field) => {
        const key = `${coin}_${field}`;
        if (editingValues[key] !== undefined) {
            return editingValues[key];
        }
        
        const fee = fees.find(f => f.coin === coin);
        return fee ? (fee[field] * 100).toFixed(2) : '0.00';
    };

    const handleFieldBlur = (coin, field) => {
        const key = `${coin}_${field}`;
        // Очищаем редактируемое значение при потере фокуса
        setEditingValues(prev => {
            const newValues = { ...prev };
            delete newValues[key];
            return newValues;
        });
    };

    

    const handleEditRequisite = (requisite) => {
        setEditingRequisite(requisite);
        setRequisiteForm({
            type: requisite.type || 'CARD',
            label: requisite.label || '',
            address: '', // не показываем зашифрованный адрес
            bank_name: requisite.bank_name || '',
            holder_name: requisite.holder_name || '',
            is_active: requisite.is_active !== undefined ? requisite.is_active : true,
            is_default: requisite.is_default !== undefined ? requisite.is_default : false
        });
        setShowRequisiteModal(true);
    };

    const handleDeleteRequisite = async (requisiteId) => {
        const confirmed = await confirm({
            title: 'Удаление реквизита',
            message: 'Вы уверены, что хотите удалить этот реквизит?',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'danger'
        });
        
        if (!confirmed) {
            return;
        }

        try {
            await botsApi.deleteBotRequisite(id, requisiteId);
            fetchBotDetails();
        } catch (error) {
            console.error('Failed to delete requisite:', error);
            setError('Ошибка удаления реквизита');
        }
    };

    const resetRequisiteForm = () => {
        setRequisiteForm({
            type: 'CARD',
            label: '',
            address: '',
            bank_name: '',
            holder_name: '',
            is_active: true,
            is_default: false
        });
    };

    const handleCloseRequisiteModal = () => {
        setShowRequisiteModal(false);
        setEditingRequisite(null);
        resetRequisiteForm();
        setError('');
    };

    const getRequisiteTypeLabel = (type) => {
        const labels = {
            CARD: 'Банковская карта',
            BTC: 'Bitcoin кошелек',
            LTC: 'Litecoin кошелек',
            XMR: 'Monero кошелек',
            USDT: 'USDT TRC20 кошелек'
        };
        return labels[type] || type;
    };

    if (loading) {
        return (
            <div className="space-y-6">
                {/* скелетон шапки */}
                <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
                    <div className="relative px-6 py-5">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                                <Bot className="w-6 h-6 text-white" />
                            </div>
                            <div className="flex-1">
                                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-48 animate-pulse"></div>
                                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mt-2 w-64 animate-pulse"></div>
                            </div>
                            <div className="w-24 h-8 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* скелетон левой колонки */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* скелетон инфо карточки */}
                        <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                            <div className="relative px-6 py-5">
                                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse mb-4"></div>
                                <div className="space-y-4">
                                    {[1, 2, 3, 4].map(i => (
                                        <div key={i} className="flex justify-between">
                                            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 animate-pulse"></div>
                                            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse"></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* скелетон панели управления */}
                        <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                            <div className="relative px-6 py-5">
                                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse mb-4"></div>
                                <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                            </div>
                        </div>
                    </div>

                    {/* скелетон правой колонки */}
                    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                        <div className="relative px-6 py-5">
                            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32 animate-pulse mb-4"></div>
                            <div className="space-y-4">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="flex justify-between">
                                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 animate-pulse"></div>
                                        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16 animate-pulse"></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!bot) {
        return (
            <div className="text-center py-12">
                <p className="text-gray-500">Бот не найден</p>
                <Link to="/bots" className="text-blue-600 hover:text-blue-800">
                    Вернуться к списку ботов
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* компактная шапка */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <Link to="/bots" className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0">
                        <ArrowLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </Link>
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow flex-shrink-0">
                        <Bot className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-base">{bot.name}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md ${
                        bot.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${bot.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                        {bot.is_active ? 'Активен' : 'Отключен'}
                    </span>
                    {botStatus && (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md ${
                            botStatus.running
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/30'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}>
                            {botStatus.running ? <><Check className="w-3 h-3" /> Запущен {botStatus.uptime ? `· ${Math.floor(botStatus.uptime / 60000)}м` : ''}</> : 'Остановлен'}
                        </span>
                    )}
                    <div className="ml-auto flex gap-2">
                        <button onClick={handleRestartBot} disabled={botActionLoading || !botStatus?.running}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
                            {botActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            Перезапустить
                        </button>
                        <button onClick={handleRefreshStatus} disabled={refreshingStatus}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition-colors">
                            <RotateCcw className={`w-3.5 h-3.5 ${refreshingStatus ? 'animate-spin' : ''}`} />
                            Статус
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-50/90 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl flex items-start gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {error}
                </div>
            )}

            {/* статистика — горизонтальная полоска */}
            {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: 'Всего заявок', value: stats.orders.total_orders, icon: TrendingUp, color: 'text-blue-500' },
                        { label: 'Завершено', value: stats.orders.completed_orders, icon: Check, color: 'text-green-500' },
                        { label: 'Объём', value: `${Math.round(stats.orders.total_volume).toLocaleString()} ₽`, icon: DollarSign, color: 'text-purple-500' },
                        { label: 'Пользователей', value: stats.users.unique_users, icon: Users, color: 'text-orange-500' },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow px-4 py-3 flex items-center gap-3">
                            <Icon className={`w-5 h-5 flex-shrink-0 ${color}`} />
                            <div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                                <p className="text-base font-bold text-gray-900 dark:text-gray-100">{value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* основная сетка */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* левая колонка: инфо + сообщения */}
                <div className="lg:col-span-2 space-y-3">
                    {/* компактная инфо-таблица */}
                    <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow px-4 py-3">
                        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
                            <Bot className="w-4 h-4 text-blue-500" /> Информация
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Идентификатор</span>
                                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{bot.identifier}</code>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Создан</span>
                                <span className="text-gray-900 dark:text-gray-100 text-xs">{new Date(bot.created_at).toLocaleString('ru-RU')}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Чат обменника</span>
                                {bot.exchange_chat_link
                                    ? <a href={bot.exchange_chat_link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 text-xs truncate max-w-[180px]">{bot.exchange_chat_link}</a>
                                    : <span className="text-xs text-yellow-600 dark:text-yellow-500">Не указана</span>}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap flex items-center gap-1"><BookOpen className="w-3 h-3" /> Канал отзывов</span>
                                {bot.reviews_chat_link
                                    ? <a href={bot.reviews_chat_link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 text-xs truncate max-w-[180px]">{bot.reviews_chat_link}</a>
                                    : <span className="text-xs text-yellow-600 dark:text-yellow-500">Не указана</span>}
                            </div>
                            {bot.description && (
                                <div className="sm:col-span-2 flex items-start justify-between gap-2">
                                    <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Описание</span>
                                    <span className="text-gray-900 dark:text-gray-100 text-xs text-right">{bot.description}</span>
                                </div>
                            )}
                            <div className="sm:col-span-2 flex items-center justify-between gap-2">
                                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Токен</span>
                                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono text-gray-700 dark:text-gray-300 truncate max-w-[300px]">{bot.token}</code>
                            </div>
                        </div>
                    </div>

                    {/* сообщения — две кнопки в ряд */}
                    <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow px-4 py-3">
                        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
                            <MessageSquare className="w-4 h-4 text-blue-500" /> Сообщения бота
                        </h2>
                        <div className="flex gap-3">
                            <button onClick={handleEditStartMessage}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                                <Edit className="w-3.5 h-3.5" />
                                {bot?.start_message ? 'Стартовое сообщение' : 'Стартовое сообщение (по умолчанию)'}
                            </button>
                            <button onClick={handleEditContactsMessage}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors">
                                <Edit className="w-3.5 h-3.5" />
                                {bot?.contacts_message ? 'Контакты' : 'Контакты (по умолчанию)'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* правая колонка: диапазоны комиссий */}
                <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow px-4 py-3">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
                        <Settings className="w-4 h-4 text-blue-500" /> Диапазоны сумм
                    </h2>
                    <div className="space-y-2">
                        {rates.map((rate) => {
                            const tiersForCoin = [...(feeTiers[rate.coin] || [])].sort((a, b) => Number(a.min_amount) - Number(b.min_amount));
                            const minTier = tiersForCoin[0];
                            const lastTier = tiersForCoin[tiersForCoin.length - 1];
                            const hasMax = Boolean(lastTier?.max_amount != null && lastTier.max_amount !== '');
                            const rateRub = Number(rate.rate_rub || 0);
                            const minCoin = minTier && rateRub > 0 ? Number(minTier.min_amount) / rateRub : null;
                            const maxCoin = hasMax && rateRub > 0 ? Number(lastTier.max_amount) / rateRub : null;
                            return (
                                <div key={rate.coin} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 w-12">{rate.coin}</span>
                                        {tiersForCoin.length > 0 ? (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                                {minCoin !== null ? `${formatCoinAmount(minCoin)}` : '?'} — {maxCoin !== null ? formatCoinAmount(maxCoin) : '∞'}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400 dark:text-gray-500">не настроено</span>
                                        )}
                                    </div>
                                    <button onClick={() => handleShowFeeTiers(rate.coin)}
                                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                                        <Settings className="w-3 h-3" />
                                        {tiersForCoin.length > 0 ? `${tiersForCoin.length} диап.` : 'Настроить'}
                                    </button>
                                </div>
                            );
                        })}
                        {rates.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Валюты не найдены</p>}
                    </div>
                </div>
            </div>

        {/* Модальное окно для редактирования стартового сообщения */}
        <Modal
            isOpen={showStartMessageModal}
            onClose={() => setShowStartMessageModal(false)}
            title="Редактирование стартового сообщения"
        >
            <div className="space-y-4">
                <div className="bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-700/50 rounded-xl p-4">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <div className="text-sm text-blue-700 dark:text-blue-300">
                            <p className="font-semibold mb-1">Это сообщение увидят пользователи при команде /start</p>
                            <p className="text-xs">
                                Вы можете использовать форматирование Telegram и эмодзи. 
                                Оставьте поле пустым для использования сообщения по умолчанию.
                            </p>
                        </div>
                    </div>
                </div>

                <TelegramTextEditor
                    value={startMessage}
                    onChange={(text, attachments) => {
                        setStartMessage(text);
                        setStartMessageAttachments(attachments);
                    }}
                    placeholder="Введите стартовое сообщение..."
                    maxLength={4096}
                    disabled={savingStartMessage}
                    hideAttachments={true}
                    disabledText="Сохранение..."
                />

                <div className="flex gap-3 pt-4">
                    <button
                        onClick={handleSaveStartMessage}
                        disabled={savingStartMessage}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                        {savingStartMessage ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Сохранение...
                            </>
                        ) : (
                            <>
                                <Save className="w-5 h-5" />
                                Сохранить
                            </>
                        )}
                    </button>
                    <button
                        onClick={() => setShowStartMessageModal(false)}
                        disabled={savingStartMessage}
                        className="px-6 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </Modal>


<Modal
  isOpen={showContactsMessageModal}
  onClose={() => setShowContactsMessageModal(false)}
  title='Редактирование раздела "Контакты"'
>
  <div className="space-y-4">
    <div className="bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-700/50 rounded-xl p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-700 dark:text-blue-300">
          <p className="font-semibold mb-1">Этот текст увидят пользователи в разделе "Контакты"</p>
          <p className="text-xs">
            Можно оставить пустым, тогда будет использоваться текущий стандартный блок контактов.
          </p>
        </div>
      </div>
    </div>

    <TelegramTextEditor
      value={contactsMessage}
      onChange={(text, attachments) => {
        setContactsMessage(text);
        setContactsMessageAttachments(attachments);
      }}
      placeholder='Введите текст для раздела "Контакты"...'
      maxLength={4096}
      disabled={savingContactsMessage}
      hideAttachments={true}
      disabledText="Сохранение..."
    />

    <div className="flex gap-3 pt-4">
      <button
        onClick={handleSaveContactsMessage}
        disabled={savingContactsMessage}
        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
      >
        {savingContactsMessage ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Сохранение...
          </>
        ) : (
          <>
            <Save className="w-5 h-5" />
            Сохранить
          </>
        )}
      </button>
      <button
        onClick={() => setShowContactsMessageModal(false)}
        disabled={savingContactsMessage}
        className="px-6 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Отмена
      </button>
    </div>
  </div>
</Modal>


        {/* Модальное окно уровней комиссий */}
        <FeeTiersModal
            isOpen={showFeeTiersModal}
            onClose={() => setShowFeeTiersModal(false)}
            botId={id}
            selectedCoin={selectedCoinForTiers}
            initialTiers={feeTiers[selectedCoinForTiers] || []}
            onSave={fetchAllFeeTiers}
        />
        </div>
    );
};

export default BotDetailsPage;

