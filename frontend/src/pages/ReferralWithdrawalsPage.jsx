import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingSpinner from '../components/LoadingSpinner';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import CustomSelect from '../components/CustomSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import { referralWithdrawalsApi } from '../services/api';
import { 
    DollarSign, 
    User, 
    Calendar, 
    Filter,
    Search,
    Eye,
    Check,
    X,
    Clock,
    CheckCircle,
    XCircle,
    TrendingUp,
    Wallet,
    Download
} from 'lucide-react';

const ReferralWithdrawalsPage = () => {
    const [withdrawals, setWithdrawals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedWithdrawal, setSelectedWithdrawal] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [modalLoading, setModalLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState({
        isOpen: false,
        type: 'default',
        title: '',
        message: '',
        onConfirm: null
    });
    
    const [filters, setFilters] = useState({
        search: '',
        status: 'all'
    });
    
    const [stats, setStats] = useState({
        total_requests: 0,
        pending_requests: 0,
        completed_requests: 0,
        cancelled_requests: 0,
        total_paid_amount: 0,
        pending_amount: 0
    });
    
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 15,
        total: 0,
        pages: 0
    });

    useEffect(() => {
        loadData();
    }, [filters, pagination.page]);

    const loadData = async () => {
        try {
            setLoading(true);
            const params = {
                page: pagination.page,
                limit: pagination.limit,
                ...filters
            };

            const response = await referralWithdrawalsApi.getWithdrawals(params);
            
            setWithdrawals(response.data.data?.withdrawals || []);
            setStats(response.data.data?.stats || {});
            setPagination(prev => ({
                ...prev,
                total: response.data.data?.pagination?.total || 0,
                pages: response.data.data?.pagination?.pages || 0
            }));

        } catch (error) {
            toast.error('Ошибка при загрузке заявок на вывод');
            console.error('Load withdrawals error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const handleViewWithdrawal = async (withdrawal) => {
        setSelectedWithdrawal(withdrawal);
        setShowModal(true);
        setModalLoading(true);
        
        try {
            const response = await referralWithdrawalsApi.getWithdrawal(withdrawal.id);
            setSelectedWithdrawal(response.data.data);
        } catch (error) {
            toast.error('Ошибка при загрузке данных заявки');
            console.error('Load withdrawal details error:', error);
        } finally {
            setModalLoading(false);
        }
    };

    const handleCompleteWithdrawal = async (id) => {
        setConfirmDialog({
            isOpen: true,
            type: 'success',
            title: 'Завершить заявку',
            message: 'Вы уверены, что хотите завершить эту заявку на вывод? Это действие нельзя отменить.',
            onConfirm: async () => {
                try {
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                    await referralWithdrawalsApi.completeWithdrawal(id);
                    toast.success('Заявка успешно завершена');
                    setShowModal(false);
                    loadData();
                } catch (error) {
                    toast.error('Ошибка при завершении заявки');
                    console.error('Complete withdrawal error:', error);
                }
            }
        });
    };

    const handleCancelWithdrawal = async (id) => {
        setConfirmDialog({
            isOpen: true,
            type: 'danger',
            title: 'Отменить заявку',
            message: 'Вы уверены, что хотите отменить эту заявку на вывод? Средства будут возвращены на баланс пользователя.',
            onConfirm: async () => {
                try {
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                    await referralWithdrawalsApi.cancelWithdrawal(id);
                    toast.success('Заявка отменена');
                    setShowModal(false);
                    loadData();
                } catch (error) {
                    toast.error('Ошибка при отмене заявки');
                    console.error('Cancel withdrawal error:', error);
                }
            }
        });
    };

    const formatAmount = (amount) => {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount || 0);
    };

    const getStatusBadge = (status) => {
        const statusConfig = {
            'CREATED': { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'Создан' },
            'COMPLETED': { color: 'bg-green-100 text-green-800', icon: CheckCircle, text: 'Завершен' },
            'CANCELLED': { color: 'bg-red-100 text-red-800', icon: XCircle, text: 'Отменен' }
        };

        const config = statusConfig[status] || statusConfig['CREATED'];
        const Icon = config.icon;

        return (
            <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${config.color}`}>
                <Icon className="w-3 h-3 mr-1" />
                {config.text}
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* хедер */}
            <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-50/30 via-emerald-50/20 to-teal-50/30 dark:from-green-950/20 dark:via-emerald-950/10 dark:to-teal-950/20"></div>
                
                <div className="relative px-6 py-5">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg">
                                <Download className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-green-800 to-emerald-900 dark:from-gray-100 dark:via-green-200 dark:to-emerald-100 bg-clip-text text-transparent">
                                    Реферальная система
                                </h1>
                                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                                    Всего заявок: {stats?.total_requests || 0}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="card bg-gradient-to-r from-yellow-50 to-yellow-100 dark:from-yellow-900 dark:to-yellow-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-yellow-600 rounded-lg flex items-center justify-center">
                                <Clock className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-yellow-600 dark:text-yellow-300 truncate">Ожидает</dt>
                                <dd className="text-lg font-bold text-yellow-900 dark:text-yellow-100">{stats?.pending_requests || 0}</dd>
                            </dl>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900 dark:to-green-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                                <CheckCircle className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-green-600 dark:text-green-300 truncate">Завершено</dt>
                                <dd className="text-lg font-bold text-green-900 dark:text-green-100">{stats?.completed_requests || 0}</dd>
                            </dl>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900 dark:to-red-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                                <XCircle className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-red-600 dark:text-red-300 truncate">Отменено</dt>
                                <dd className="text-lg font-bold text-red-900 dark:text-red-100">{stats?.cancelled_requests || 0}</dd>
                            </dl>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                <DollarSign className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-blue-600 dark:text-blue-300 truncate">К выплате</dt>
                                <dd className="text-lg font-bold text-blue-900 dark:text-blue-100">{formatAmount(stats?.pending_amount || 0)}</dd>
                            </dl>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                                <TrendingUp className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-purple-600 dark:text-purple-300 truncate">Выплачено</dt>
                                <dd className="text-lg font-bold text-purple-900 dark:text-purple-100">{formatAmount(stats?.total_paid_amount || 0)}</dd>
                            </dl>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-gray-600 rounded-lg flex items-center justify-center">
                                <Wallet className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate">Всего</dt>
                                <dd className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats?.total_requests || 0}</dd>
                            </dl>
                        </div>
                    </div>
                </div>
            </div>

            {/* фильтры */}
            <div className="relative overflow-hidden bg-gradient-to-br from-white via-green-50/30 to-white dark:from-gray-800 dark:via-green-950/20 dark:to-gray-800 rounded-2xl shadow-lg border border-green-200/50 dark:border-green-700/50">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-emerald-500/5 to-teal-500/5 dark:from-green-500/10 dark:via-emerald-500/10 dark:to-teal-500/10" />
                <div className="relative p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg shadow-lg">
                            <Filter className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
                            Фильтры
                        </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                           
                            <input
                                type="text"
                                placeholder="Имя, Telegram ID, адрес кошелька..."
                                value={filters.search}
                                onChange={(e) => handleFilterChange('search', e.target.value)}
                                className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-green-500/50 focus:border-green-500 dark:focus:border-green-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium shadow-sm hover:shadow-md"
                            />
                            <Search className="absolute left-4 bottom-3.5 w-5 h-5 text-gray-400" />
                        </div>
                        <CustomSelect
                            value={filters.status}
                            onChange={(value) => handleFilterChange('status', value)}
                            options={[
                                { value: 'all', label: 'Все статусы' },
                                { value: 'CREATED', label: 'Ожидает обработки' },
                                { value: 'COMPLETED', label: 'Завершенные' },
                                { value: 'CANCELLED', label: 'Отмененные' }
                            ]}

                            icon={Filter}
                            placeholder="Выберите статус"
                        />
                    </div>
                </div>
            </div>

            {/* таблица */}
            <ResponsiveTable
                columns={[
                    {
                        header: 'ID',
                        key: 'id',
                        render: (withdrawal) => (
                            <span className="font-mono text-sm">#{withdrawal.id}</span>
                        )
                    },
                    {
                        header: 'Пользователь',
                        key: 'user',
                        render: (withdrawal) => (
                            <div className="flex items-center">
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {withdrawal.username || 'Без имени'}
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        ID: {withdrawal.tg_id}
                                    </div>
                                </div>
                            </div>
                        )
                    },
                    {
                        header: 'Сумма',
                        key: 'amount',
                        render: (withdrawal) => (
                            <div className="text-sm">
                                <div className="text-gray-900 dark:text-gray-100 font-medium">
                                    {formatAmount(withdrawal.amount_rub)}
                                </div>
                                <div className="text-gray-500 dark:text-gray-400">
                                    {withdrawal.amount_crypto} {withdrawal.currency}
                                </div>
                            </div>
                        )
                    },
                    {
                        header: 'Валюта',
                        key: 'currency',
                        render: (withdrawal) => (
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                                {withdrawal.currency}
                            </span>
                        )
                    },
                    {
                        header: 'Статус',
                        key: 'status',
                        render: (withdrawal) => getStatusBadge(withdrawal.status)
                    },
                    {
                        header: 'Дата',
                        key: 'created_at',
                        render: (withdrawal) => (
                            <div className="text-sm">
                                <div className="text-gray-900 dark:text-gray-100">
                                    {new Date(withdrawal.created_at).toLocaleDateString('ru-RU')}
                                </div>
                                <div className="text-gray-500 dark:text-gray-400">
                                    {new Date(withdrawal.created_at).toLocaleTimeString('ru-RU')}
                                </div>
                            </div>
                        )
                    },
                    {
                        header: 'Действия',
                        key: 'actions',
                        render: (withdrawal) => (
                            <ActionButton
                                type="view"
                                onClick={() => handleViewWithdrawal(withdrawal)}
                                variant="primary"
                                title="Подробнее"
                            />
                        )
                    }
                ]}
                data={withdrawals || []}
                keyField="id"
                loading={loading}
                emptyMessage="Заявки на вывод не найдены"
            />

            {/* модалка */}
            <Modal
                isOpen={showModal && selectedWithdrawal}
                onClose={() => setShowModal(false)}
                title={`Заявка на вывод #${selectedWithdrawal?.id}`}
                size="2xl"
                icon={<Download className="w-6 h-6" />}
                iconColor="green"
            >
                {selectedWithdrawal && (
                    <div className="space-y-6">
                        {modalLoading ? (
                            <div className="flex justify-center py-8">
                                <LoadingSpinner />
                            </div>
                        ) : (
                            <>
                                {/* User info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-xl border-2 border-blue-200 dark:border-blue-800">
                                        <div className="flex items-center gap-3 mb-2">
                                            <User className="w-5 h-5 text-blue-600" />
                                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Информация о пользователе</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Имя:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {selectedWithdrawal.username || 'Без имени'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Telegram ID:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedWithdrawal.tg_id}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Бот:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{selectedWithdrawal.bot_name}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-xl border-2 border-green-200 dark:border-green-800">
                                        <div className="flex items-center gap-3 mb-2">
                                            <DollarSign className="w-5 h-5 text-green-600" />
                                            <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Детали вывода</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Сумма в рублях:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {formatAmount(selectedWithdrawal.amount_rub)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Сумма в крипте:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {selectedWithdrawal.amount_crypto} {selectedWithdrawal.currency}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Статус:</span>
                                                {getStatusBadge(selectedWithdrawal.status)}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* адрес */}
                                <div className="p-4 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20 rounded-xl border-2 border-yellow-200 dark:border-yellow-800">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Wallet className="w-5 h-5 text-yellow-600" />
                                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Адрес кошелька</span>
                                    </div>
                                    <div className="p-3 bg-white dark:bg-gray-800 rounded-lg">
                                        <code className="text-sm text-gray-900 dark:text-gray-100 break-all">
                                            {selectedWithdrawal.wallet_address}
                                        </code>
                                    </div>
                                </div>

                                <div className="p-4 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-950/20 dark:to-slate-950/20 rounded-xl border-2 border-gray-200 dark:border-gray-800">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Calendar className="w-5 h-5 text-gray-600" />
                                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Временные метки</span>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600 dark:text-gray-400">Создана:</span>
                                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                {new Date(selectedWithdrawal.created_at).toLocaleString('ru-RU')}
                                            </span>
                                        </div>
                                        {selectedWithdrawal.completed_at && (
                                            <div className="flex justify-between">
                                                <span className="text-sm text-gray-600 dark:text-gray-400">Завершена:</span>
                                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    {new Date(selectedWithdrawal.completed_at).toLocaleString('ru-RU')}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* действия */}
                                {selectedWithdrawal.status === 'CREATED' && (
                                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            onClick={() => handleCancelWithdrawal(selectedWithdrawal.id)}
                                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <X className="w-4 h-4" />
                                            Отменить
                                        </button>
                                        <button
                                            onClick={() => handleCompleteWithdrawal(selectedWithdrawal.id)}
                                            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <Check className="w-4 h-4" />
                                            Завершить
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </Modal>

            {/* пагинация */}
            <Pagination
                currentPage={pagination.page}
                totalPages={pagination.pages}
                totalItems={pagination.total}
                itemsPerPage={pagination.limit}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />

            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmDialog.onConfirm}
                title={confirmDialog.title}
                message={confirmDialog.message}
                type={confirmDialog.type}
                confirmText={confirmDialog.type === 'success' ? 'Завершить' : 'Отменить заявку'}
                cancelText="Отмена"
            />
        </div>
    );
};

export default ReferralWithdrawalsPage;