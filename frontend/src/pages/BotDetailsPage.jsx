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
        <div className="space-y-6">
            {/* шапка */}
            <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
                
                <div className="relative px-6 py-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <Link
                                to="/bots"
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                            </Link>
                            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                                <Bot className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{bot.name}</h1>
                                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                                    Детальная информация о боте
                                </p>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm ${
                                bot.is_active
                                    ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/30'
                                    : 'bg-gradient-to-r from-red-500/10 to-rose-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700/30'
                            }`}>
                                <span className={`w-2 h-2 rounded-full ${bot.is_active ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                {bot.is_active ? 'Активен' : 'Отключен'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="relative bg-red-50/90 dark:bg-red-900/20 backdrop-blur-xl border-2 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 px-5 py-4 rounded-xl shadow-lg flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <p className="font-medium">{error}</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* инфо о боте */}
                <div className="lg:col-span-2 space-y-6">
                    {/* карточка информации */}
                    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
                        
                        <div className="relative px-6 py-5">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-2 mb-4">
                                <Bot className="w-5 h-5 text-blue-500" />
                                Информация о боте
                            </h2>
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                                <div>
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Идентификатор</dt>
                                    <dd className="mt-1.5 text-sm text-gray-900 dark:text-gray-200">
                                        <code className="bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-800/50 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-xs shadow-sm">
                                            {bot.identifier}
                                        </code>
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Создан</dt>
                                    <dd className="mt-1.5 text-sm font-medium text-gray-900 dark:text-gray-200">
                                        {new Date(bot.created_at).toLocaleString('ru-RU')}
                                    </dd>
                                </div>
                                {bot.description && (
                                    <div className="sm:col-span-2">
                                        <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Описание</dt>
                                        <dd className="mt-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">{bot.description}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                                        <MessageCircle className="w-4 h-4" />
                                        Ссылка на чат
                                    </dt>
                                    <dd className="mt-1.5 text-sm text-gray-900 dark:text-gray-200">
                                        {bot.exchange_chat_link ? (
                                            <a 
                                                href={bot.exchange_chat_link} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 break-all font-medium transition-colors"
                                            >
                                                {bot.exchange_chat_link}
                                            </a>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-500 font-medium">
                                                <AlertTriangle className="w-4 h-4" />
                                                Не указана
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                                        <BookOpen className="w-4 h-4" />
                                        Ссылка на отзывы
                                    </dt>
                                    <dd className="mt-1.5 text-sm text-gray-900 dark:text-gray-200">
                                        {bot.reviews_chat_link ? (
                                            <a 
                                                href={bot.reviews_chat_link} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 break-all font-medium transition-colors"
                                            >
                                                {bot.reviews_chat_link}
                                            </a>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-500 font-medium">
                                                <AlertTriangle className="w-4 h-4" />
                                                Не указана
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                                        <MessageCircle className="w-4 h-4" />
                                        Chat ID отзывов
                                    </dt>
                                    <dd className="mt-1.5 text-sm text-gray-900 dark:text-gray-200">
                                        {bot.reviews_chat_id ? (
                                            <code className="bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-800/50 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-xs shadow-sm">
                                                {bot.reviews_chat_id}
                                            </code>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-500 font-medium">
                                                <AlertTriangle className="w-4 h-4" />
                                                Не указан
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div className="sm:col-span-2">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Токен</dt>
                                    <dd className="mt-1.5 text-sm text-gray-900 dark:text-gray-200 font-mono bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800/50 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 break-all shadow-sm">
                                        {bot.token}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </div>

                    

                    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
                        
                        <div className="relative px-6 py-5">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-2 mb-4">
                                <Activity className="w-5 h-5 text-blue-500" />
                                Статус бота
                            </h2>
                            <div className="bg-blue-50/50 dark:bg-blue-900/20 backdrop-blur-sm border border-blue-200/50 dark:border-blue-700/30 rounded-xl p-4 mb-4">
                                <div className="flex gap-3">
                                    <div className="flex-shrink-0">
                                        <div className="p-2 bg-blue-500/10 rounded-lg">
                                            <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                                            <strong className="font-semibold">Автоматическое управление:</strong> Боты запускаются и останавливаются автоматически при изменении статуса "Активен/Отключен" в настройках.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between flex-wrap gap-4">
                                <div className="flex items-center gap-4 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Текущий статус:</span>
                                        {botStatus ? (
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm ${
                                                botStatus.running
                                                    ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/30'
                                                    : 'bg-gradient-to-r from-red-500/10 to-rose-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700/30'
                                            }`}>
                                                {botStatus.running ? (
                                                    <>
                                                        <Check className="h-4 w-4" />
                                                        <span>Запущен</span>
                                                    </>
                                                ) : (
                                                    <span>Остановлен</span>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-400 shadow-sm">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Загрузка...
                                            </span>
                                        )}
                                    </div>
                                    {botStatus?.running && botStatus.uptime && (
                                        <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                            Работает: {Math.floor(botStatus.uptime / 1000 / 60)} мин
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    <button
                                        onClick={handleRestartBot}
                                        disabled={botActionLoading || !botStatus?.running}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 shadow-md text-sm font-semibold rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 active:scale-95"
                                        title="Перезапустить бота (доступно только когда бот запущен)"
                                    >
                                        {botActionLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Перезапуск...
                                            </>
                                        ) : (
                                            <>
                                                <RotateCcw className="h-4 w-4" />
                                                Перезапустить
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={handleRefreshStatus}
                                        disabled={refreshingStatus}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl text-sm font-semibold rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                    >
                                        <RotateCcw className={`h-4 w-4 ${refreshingStatus ? 'animate-spin' : ''}`} />
                                        {refreshingStatus ? 'Обновление...' : 'Обновить статус'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
                        
                        <div className="relative px-6 py-5">
                             <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-2 mb-4">
                                <MessageSquare className="w-5 h-5 text-blue-500" />
                                Стартовое сообщение
                            </h2>
                            
                            <div className="bg-gradient-to-br from-gray-50/60 via-blue-50/30 to-indigo-50/60 dark:from-gray-800/60 dark:via-blue-950/30 dark:to-indigo-950/60 rounded-xl p-4 border border-gray-200/50 dark:border-gray-700/50 mb-4">
                                {bot?.start_message ? (
                                    <div 
                                        className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
                                        dangerouslySetInnerHTML={{ __html: convertMarkdownToHtml(bot.start_message) }}
                                    />
                                ) : (
                                    <div>
                                        <div className="flex items-start gap-2 mb-3">
                                            <AlertTriangle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                                Используется сообщение по умолчанию
                                            </p>
                                        </div>
                                        <div 
                                            className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
                                            dangerouslySetInnerHTML={{ __html: convertMarkdownToHtml(getDefaultStartMessage()) }}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={handleEditStartMessage}
                                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                                >
                                    <Edit className="w-4 h-4" />
                                    Изменить стартовое сообщение
                                </button>
                            </div>
                        </div>
                    </div>


<div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>

  <div className="relative px-6 py-5">
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-2 mb-4">
      <MessageCircle className="w-5 h-5 text-blue-500" />
      Раздел "Контакты"
    </h2>

    <div className="bg-gradient-to-br from-gray-50/60 via-blue-50/30 to-indigo-50/60 dark:from-gray-800/60 dark:via-blue-950/30 dark:to-indigo-950/60 rounded-xl p-4 border border-gray-200/50 dark:border-gray-700/50 mb-4">
      {bot?.contacts_message ? (
        <div
          className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: convertMarkdownToHtml(bot.contacts_message) }}
        />
      ) : (
        <div>
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Используется стандартный блок контактов (оператор 24/7, отзывы, чат)
            </p>
          </div>
        </div>
      )}
    </div>

    <div className="flex justify-end">
      <button
        onClick={handleEditContactsMessage}
        className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
      >
        <Edit className="w-4 h-4" />
        Изменить контакты
      </button>
    </div>
  </div>
</div>


                    
                </div>

                {/* комиссии бота */}
                <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>

                    {/* статистика */}

                    {stats && (
                        <div className="relative px-6 py-5 border-b border-gray-200/50 dark:border-gray-700/50">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-2 mb-4">
                                <TrendingUp className="w-5 h-5 text-blue-500" />
                                Статистика
                            </h2>
                            <dl className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Всего заявок</dt>
                                    <dd className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                                        {stats.orders.total_orders}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Завершено заявок</dt>
                                    <dd className="text-2xl font-semibold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                                        {stats.orders.completed_orders}
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Общий объем</dt>
                                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        {Math.round(stats.orders.total_volume).toLocaleString()} ₽
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400">Средний чек</dt>
                                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        {Math.round(stats.orders.avg_order_value || 0).toLocaleString()} ₽
                                    </dd>
                                </div>
                                <div className="flex items-center justify-between">
                                    <dt className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                                        <Users className="w-4 h-4" />
                                        Уникальных пользователей
                                    </dt>
                                    <dd className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        {stats.users.unique_users}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    )}


                
                    <div className="relative px-4 sm:px-6 py-5">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="p-2.5 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
                                <Percent className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200">Комиссии бота</h2>
                                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                                    Настройка комиссий для каждой валюты
                                </p>
                            </div>
                        </div>
                        
                            <div className="space-y-4">
                            {rates.map((rate, index) => {
                                const tiersForCoin = [...(feeTiers[rate.coin] || [])].sort((a, b) => Number(a.min_amount) - Number(b.min_amount));
                                const minAmountRub = tiersForCoin.length > 0 ? Number(tiersForCoin[0].min_amount) : null;
                                const lastTier = tiersForCoin.length > 0 ? tiersForCoin[tiersForCoin.length - 1] : null;
                                const hasFiniteMax = Boolean(lastTier && lastTier.max_amount !== null && lastTier.max_amount !== undefined && lastTier.max_amount !== '');
                                const maxAmountRub = hasFiniteMax ? Number(lastTier.max_amount) : null;
                                const rateRub = Number(rate.rate_rub || 0);
                                const minOrderCoin = minAmountRub !== null && rateRub > 0 ? minAmountRub / rateRub : null;
                                const maxOrderCoin = maxAmountRub !== null && rateRub > 0 ? maxAmountRub / rateRub : null;
                                return (
                                    <div 
                                        key={rate.coin} 
                                        className="group relative bg-gradient-to-br from-white via-gray-50/50 to-white dark:from-gray-800/80 dark:via-gray-800/50 dark:to-gray-800/80 rounded-2xl p-4 sm:p-5 border-2 border-gray-200/50 dark:border-gray-700/50 shadow-md hover:shadow-xl transition-all duration-300 hover:border-blue-300 dark:hover:border-blue-600/50 overflow-hidden"
                                    >
                                        {/* градиентный оверлей */}
                                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-purple-500/5 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                                        
                                        <div className="relative">
                                            {/* шапка валюты */}
                                            <div className="mb-4">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg">
                                                        <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                                    </div>
                                                    <h3 className="text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
                                                        {rate.coin}
                                                    </h3>
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => handleShowFeeTiers(rate.coin)}
                                                        className="group relative px-3 py-2 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-700 dark:to-gray-600 hover:from-gray-200 hover:to-gray-100 dark:hover:from-gray-600 dark:hover:to-gray-500 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600 transition-all duration-200 hover:scale-105 active:scale-95 text-xs font-medium min-w-0 flex-shrink-0"
                                                        title="Настроить диапазоны комиссий"
                                                    >
                                                        <div className="flex items-center gap-1.5">
                                                            <Settings className="w-3.5 h-3.5" />
                                                            <span>Диапазоны</span>
                                                            {tiersForCoin.length > 0 && (
                                                                <span className="ml-1 px-1.5 py-0.5 bg-blue-500 text-white rounded-full text-xs">
                                                                    {tiersForCoin.length}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>

                                            {tiersForCoin.length > 0 ? (
                                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-800/50 px-3 py-2">
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Минимальная сумма заказа ({rate.coin})</p>
                                                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                            {minOrderCoin !== null ? `${formatCoinAmount(minOrderCoin)} ${rate.coin}` : '-'}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-800/50 px-3 py-2">
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Максимальная сумма заказа ({rate.coin})</p>
                                                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                            {hasFiniteMax ? `${formatCoinAmount(maxOrderCoin)} ${rate.coin}` : 'Без ограничений'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                                                    Диапазоны не настроены
                                                </p>
                                            )}
                                            
                                            {/* поля комиссий */}
                                            {false && (
                                            <div className="grid grid-cols-1 lg:grid-cols-1 xl:grid-cols-2 gap-4">
                                                {/* комиссия на покупку */}
                                                <div className="relative group/input">
                                                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                        <div className="p-1 bg-green-100 dark:bg-green-900/30 rounded">
                                                            <ShoppingCart className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                                        </div>
                                                        <span>Комиссия за покупку</span>
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            placeholder="2.5"
                                                            className="block w-full border-2 border-gray-300 dark:border-gray-600 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 text-sm bg-white dark:bg-gray-800/50 text-gray-900 dark:text-gray-200 px-4 py-3 font-semibold transition-all duration-200 hover:border-blue-400 dark:hover:border-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
                                                            value={getFieldValue(rate.coin, 'buy_fee')}
                                                            onChange={(e) => handleFeeChange(rate.coin, 'buy_fee', e.target.value)}
                                                            onBlur={() => handleFieldBlur(rate.coin, 'buy_fee')}
                                                        />
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-md">
                                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* комиссия на продажу */}
                                                <div className="relative group/input">
                                                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                        <div className="p-1 bg-orange-100 dark:bg-orange-900/30 rounded">
                                                            <TrendingUp className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                                                        </div>
                                                        <span>Комиссия за продажу</span>
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            placeholder="1.8"
                                                            className="block w-full border-2 border-gray-300 dark:border-gray-600 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 text-sm bg-white dark:bg-gray-800/50 text-gray-900 dark:text-gray-200 px-4 py-3 font-semibold transition-all duration-200 hover:border-blue-400 dark:hover:border-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
                                                            value={getFieldValue(rate.coin, 'sell_fee')}
                                                            onChange={(e) => handleFeeChange(rate.coin, 'sell_fee', e.target.value)}
                                                            onBlur={() => handleFieldBlur(rate.coin, 'sell_fee')}
                                                        />
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-md">
                                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            
                            {rates.length === 0 && (
                                <div className="text-center py-12">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full mb-4">
                                        <DollarSign className="w-8 h-8 text-gray-400 dark:text-gray-600" />
                                    </div>
                                    <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Валюты не найдены</p>
                                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Добавьте валюты для настройки комиссий</p>
                                </div>
                            )}
                        </div>

                        {/* кнопка сохранить внизу */}
                        <div className="hidden mt-6 pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
                            <button
                                onClick={handleUpdateFees}
                                disabled={savingFees}
                                className="group relative w-full px-6 py-3 overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl flex items-center justify-center gap-3 text-sm hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                                {savingFees ? (
                                    <>
                                        <Loader2 className="w-5 h-5 relative z-10 animate-spin" />
                                        <span className="relative z-10">Сохранение...</span>
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-5 h-5 relative z-10" />
                                        <span className="relative z-10">Сохранить комиссии</span>
                                    </>
                                )}
                            </button>
                        </div>
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

