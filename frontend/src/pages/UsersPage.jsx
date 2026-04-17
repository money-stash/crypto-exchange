import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { usersApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingSpinner from '../components/LoadingSpinner';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import CustomSelect from '../components/CustomSelect';
import { 
    Users as UsersIcon, 
    User, 
    Percent, 
    Save, 
    X as CloseIcon, 
    Tag,
    TrendingUp,
    UserCheck,
    Crown,
    Ban,
    UserPlus,
    DollarSign,
    Search,
    Filter,
    Calendar,
    Activity,
    Award,
    Eye,
    ShoppingCart,
    Clock,
    Wallet,
    BarChart3,
    TrendingDown,
    Users2,
    Gift,
    History,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react';

const UsersPage = () => {
    const { user } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        search: '',
        status: 'all',
        sortBy: 'created_at',
        sortOrder: 'desc'
    });
    const [selectedUser, setSelectedUser] = useState(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [userModalTab, setUserModalTab] = useState('profile'); 
    const [userDetails, setUserDetails] = useState(null);
    const [userReferrals, setUserReferrals] = useState([]);
    const [userModalLoading, setUserModalLoading] = useState(false);
    const [referralsPage, setReferralsPage] = useState(1);
    const [stats, setStats] = useState({
        total: 0,
        active: 0,
        premium: 0,
        blocked: 0,
        todayRegistrations: 0,
        totalVolume: 0
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
            const response = await usersApi.getUsers({
                ...filters,
                page: pagination.page,
                limit: pagination.limit
            });

            setUsers(response.data?.users || []);
            setStats(response.data?.stats || {
                total: 0,
                active: 0,
                premium: 0,
                blocked: 0,
                todayRegistrations: 0,
                totalVolume: 0
            });
            setPagination(prev => ({
                ...prev,
                total: response.data?.total || 0,
                pages: response.data?.pages || 0
            }));
        } catch (error) {
            toast.error('Ошибка при загрузке пользователей');
            console.error('Load users error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const handleViewUser = async (user) => {
        setSelectedUser(user);
        setUserModalTab('profile');
        setShowUserModal(true);
        setUserModalLoading(true);
        
        try {
            const userId = user.id || user.tg_id;
            const response = await usersApi.getUserById(userId);
            setUserDetails(response.data);
        } catch (error) {
            toast.error('Ошибка при загрузке данных пользователя');
            console.error('Load user details error:', error);
        } finally {
            setUserModalLoading(false);
        }
    };

    const loadUserReferrals = async (userId, page = 1) => {
        try {
            const response = await usersApi.getUserReferrals(userId, { page, limit: 10 });
            setUserReferrals(response.data?.referrals || []);
            setReferralsPage(page);
        } catch (error) {
            toast.error('Ошибка при загрузке рефералов');
            console.error('Load referrals error:', error);
        }
    };

    const handleToggleStatus = async (telegramId) => {
        try {
            // Находим пользователя чтобы узнать его текущий статус
            const user = users.find(u => u.tg_id === telegramId);
            if (!user) return;

            if (user.is_blocked) {
                await usersApi.unblockUser(telegramId);
                toast.success('Пользователь разблокирован');
            } else {
                await usersApi.blockUser(telegramId);
                toast.success('Пользователь заблокирован');
            }
            loadData();
        } catch (error) {
            console.log(error)
            toast.error('Ошибка при изменении статуса');
        }
    };


    const getUserLevel = (user) => {
        const volume = user.total_volume || 0;
        if (volume >= 1000000) return { level: 'VIP', color: 'text-yellow-600' };
        if (volume >= 100000) return { level: 'PREMIUM', color: 'text-purple-600' };
        return { level: 'STANDARD', color: 'text-gray-600' };
    };

    const formatAmount = (amount) => {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount || 0);
    };

    return (
        <div className="space-y-6">
            {/* премиум хедер */}
            <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
                
                <div className="relative px-6 py-5">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                                <UsersIcon className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                                    Пользователи
                                </h1>
                                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                                    Всего: {stats?.total || 0} пользователей
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* стата */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* всего */}
                <div className="card bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-gray-600 rounded-lg flex items-center justify-center">
                                <UsersIcon className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate">Всего</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats?.total || 0}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>

                {/* активных */}
                <div className="card bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900 dark:to-green-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                                <UserCheck className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-green-600 dark:text-green-300 truncate">Активных</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-green-900 dark:text-green-100">{stats?.active || 0}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>

                {/* премиум */}
                <div className="card bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                                <Crown className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-purple-600 dark:text-purple-300 truncate">Премиум</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-purple-900 dark:text-purple-100">{stats?.premium || 0}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>

                {/* в блоке */}
                <div className="card bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900 dark:to-red-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                                <Ban className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-red-600 dark:text-red-300 truncate">Заблокировано</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-red-900 dark:text-red-100">{stats?.blocked || 0}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>

                {/* сегодня */}
                <div className="card bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                                <UserPlus className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-blue-600 dark:text-blue-300 truncate">Сегодня</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-blue-900 dark:text-blue-100">{stats?.todayRegistrations || 0}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>

                {/* общий объем */}
                <div className="card bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900 dark:to-amber-800">
                    <div className="flex items-center">
                        <div className="flex-shrink-0">
                            <div className="w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center">
                                <DollarSign className="text-white w-5 h-5" />
                            </div>
                        </div>
                        <div className="ml-4 w-0 flex-1">
                            <dl>
                                <dt className="text-sm font-medium text-amber-600 dark:text-amber-300 truncate">Объем</dt>
                                {loading ? (
                                    <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                                ) : (
                                    <dd className="text-lg font-bold text-amber-900 dark:text-amber-100">{formatAmount(stats?.totalVolume || 0)}</dd>
                                )}
                            </dl>
                        </div>
                    </div>
                </div>
            </div>

            {/* фильтры */}
            <div className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50/30 to-white dark:from-gray-800 dark:via-blue-950/20 dark:to-gray-800 rounded-2xl shadow-lg border border-blue-200/50 dark:border-blue-700/50">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-purple-500/5 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-purple-500/10" />
                <div className="relative p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-lg">
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
                                placeholder="Имя, Telegram ID..."
                                value={filters.search}
                                onChange={(e) => handleFilterChange('search', e.target.value)}
                                className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium shadow-sm hover:shadow-md"
                            />
                            <Search className="absolute left-4 bottom-3.5 w-5 h-5 text-gray-400" />
                        </div>
                        <CustomSelect
                            value={filters.status}
                            onChange={(value) => handleFilterChange('status', value)}
                            options={[
                                { value: 'all', label: 'Все пользователи' },
                                { value: 'active', label: 'Активные' },
                                { value: 'blocked', label: 'Заблокированные' }
                            ]}

                            icon={Filter}
                            placeholder="Выберите статус"
                        />
                    </div>
                </div>
            </div>

            <ResponsiveTable
                columns={[
                    {
                        header: 'Пользователь',
                        key: 'username',
                        render: (user) => (
                            <div className="flex items-center">
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                        {user.username || user.first_name || 'Без имени'}
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        ID: {user.tg_id}
                                    </div>
                                </div>
                            </div>
                        )
                    },
                    ...(user?.role === 'SUPERADMIN' ? [{
                        header: 'Боты',
                        key: 'bots',
                        render: (userData) => (
                            <div className="text-sm">
                                {userData.user_bots && userData.user_bots.length > 0 ? (
                                    <div className="space-y-1">
                                        {userData.user_bots.map((userBot, index) => (
                                            <div key={index} className="flex items-center gap-1">
                                                <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                                                    #{userBot.bot_id} {userBot.bot_name}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-gray-400 dark:text-gray-500 text-xs">Нет ботов</span>
                                )}
                            </div>
                        )
                    }] : []),
                    {
                        header: 'Статистика',
                        key: 'stats',
                        render: (user) => (
                            <div className="text-sm">
                                <div className="text-gray-900 dark:text-gray-100">
                                    Заявок: {user.orders_count || 0}
                                </div>
                                <div className="text-gray-500 dark:text-gray-400">
                                    Объем: {formatAmount(user.total_volume || 0)}
                                </div>
                            </div>
                        )
                    },
                    {
                        header: 'Статус',
                        key: 'is_blocked',
                        render: (user) => (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${!user.is_blocked
                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                    : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                                }`}>
                                {!user.is_blocked ? 'Активен' : 'Заблокирован'}
                            </span>
                        )
                    },
                    {
                        header: 'Действия',
                        key: 'actions',
                        render: (user) => (
                            <div className="flex gap-1">
                                <ActionButton
                                    type="view"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleViewUser(user);
                                    }}
                                    variant="primary"
                                    title="Просмотр"
                                />
                                <ActionButton
                                    type={!user.is_blocked ? "block" : "unblock"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleStatus(user.tg_id);
                                    }}
                                    variant={!user.is_blocked ? "danger" : "success"}
                                    title={!user.is_blocked ? 'Заблокировать' : 'Разблокировать'}
                                />
                            </div>
                        )
                    }
                ]}
                data={users || []}
                keyField="tg_id"
                mobileCardRender={(userData) => {
                    const userLevel = getUserLevel(userData);
                    return (
                        <div className="space-y-3">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                                        {userData.username || userData.first_name || 'Без имени'}
                                    </h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">ID: {userData.tg_id}</p>
                                </div>
                                <div className="flex gap-2">
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${userLevel.level === 'PREMIUM'
                                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400'
                                            : userLevel.level === 'VIP'
                                                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                                        }`}>
                                        {userLevel.level}
                                    </span>

                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${!userData.is_blocked
                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                                            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400'
                                        }`}>
                                        {!userData.is_blocked ? 'Активен' : 'Заблокирован'}
                                    </span>
                                </div>
                            </div>

                            <div className="text-sm">
                                <div className="text-gray-500 dark:text-gray-400">Статистика:</div>
                                <div className="text-gray-900 dark:text-gray-100">
                                    Заявок: {userData.orders_count || 0}, Объем: {formatAmount(userData.total_volume || 0)}
                                </div>
                            </div>

                            {user?.role === 'SUPERADMIN' && userData.user_bots && userData.user_bots.length > 0 && (
                                <div className="text-sm">
                                    <div className="text-gray-500 dark:text-gray-400">Боты:</div>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {userData.user_bots.map((userBot, index) => (
                                            <span key={index} className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                                                #{userBot.bot_id} {userBot.bot_name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                <ActionButton
                                    type="view"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleViewUser(userData);
                                    }}
                                    variant="primary"
                                    title="Просмотр"
                                />
                                <ActionButton
                                    type={!userData.is_blocked ? "block" : "unblock"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleStatus(userData.tg_id);
                                    }}
                                    variant={!userData.is_blocked ? "danger" : "success"}
                                    title={!userData.is_blocked ? 'Заблокировать' : 'Разблокировать'}
                                />
                            </div>
                        </div>
                    );
                }}
                loading={loading}
                emptyMessage="Пользователи не найдены"
            />

            <Modal
                isOpen={showUserModal && selectedUser}
                onClose={() => {
                    setShowUserModal(false);
                    setUserDetails(null);
                    setUserReferrals([]);
                }}
                title={`${selectedUser?.username || selectedUser?.first_name || 'Пользователь'} (ID: ${selectedUser?.tg_id})`}
                size="4xl"
                icon={<User className="w-6 h-6" />}
                iconColor="purple"
            >
                {selectedUser && (
                    <div className="space-y-6">
                        <div className="flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                            <button
                                onClick={() => setUserModalTab('profile')}
                                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                    userModalTab === 'profile'
                                        ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <User className="w-4 h-4" />
                                    Профиль
                                </div>
                            </button>
                            <button
                                onClick={() => setUserModalTab('orders')}
                                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                    userModalTab === 'orders'
                                        ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <ShoppingCart className="w-4 h-4" />
                                    Заявки ({userDetails?.orders_count || 0})
                                </div>
                            </button>
                            <button
                                onClick={() => {
                                    setUserModalTab('referrals');
                                    if (userDetails && userReferrals.length === 0) {
                                        loadUserReferrals(userDetails.id);
                                    }
                                }}
                                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                    userModalTab === 'referrals'
                                        ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Users2 className="w-4 h-4" />
                                    Рефералы ({userDetails?.referral_stats?.total_referrals || 0})
                                </div>
                            </button>
                        </div>

                        {userModalLoading ? (
                            <div className="flex justify-center py-8">
                                <LoadingSpinner />
                            </div>
                        ) : (
                            <>
                                {userModalTab === 'profile' && userDetails && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 rounded-xl border-2 border-purple-200 dark:border-purple-800">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <User className="w-5 h-5 text-purple-600" />
                                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Основные данные</span>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Имя:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {userDetails.username || userDetails.first_name || 'Без имени'}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Telegram ID:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{userDetails.tg_id}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Статус:</span>
                                                        <span className={`text-sm font-medium ${
                                                            !userDetails.is_blocked ? 'text-green-600' : 'text-red-600'
                                                        }`}>
                                                            {!userDetails.is_blocked ? 'Активен' : 'Заблокирован'}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Регистрация:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {new Date(userDetails.created_at).toLocaleDateString('ru-RU')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-xl border-2 border-green-200 dark:border-green-800">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <BarChart3 className="w-5 h-5 text-green-600" />
                                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Статистика заявок</span>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Всего заявок:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{userDetails.orders_count}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Завершено:</span>
                                                        <span className="text-sm font-medium text-green-600">{userDetails.completed_orders}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Отменено:</span>
                                                        <span className="text-sm font-medium text-red-600">{userDetails.cancelled_orders}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Общий объем:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {formatAmount(userDetails.total_volume)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* реферальная информация */}
                                        <div className="p-4 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20 rounded-xl border-2 border-yellow-200 dark:border-yellow-800">
                                            <div className="flex items-center gap-3 mb-4">
                                                <Gift className="w-5 h-5 text-yellow-600" />
                                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Реферальная программа</span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Приглашено:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {userDetails.referral_stats?.total_referrals || 0}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Активных:</span>
                                                        <span className="text-sm font-medium text-green-600">
                                                            {userDetails.referral_stats?.active_referrals || 0}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Заявок рефералов:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {userDetails.referral_stats?.referral_orders || 0}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">Объем рефералов:</span>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {formatAmount(userDetails.referral_stats?.referral_volume || 0)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* боты */}
                                        {userDetails.user_bots && userDetails.user_bots.length > 0 && (
                                            <div className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 rounded-xl border-2 border-blue-200 dark:border-blue-800">
                                                <div className="flex items-center gap-3 mb-4">
                                                    <Activity className="w-5 h-5 text-blue-600" />
                                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Активность в ботах</span>
                                                </div>
                                                <div className="space-y-3">
                                                    {userDetails.user_bots.map((userBot, index) => (
                                                        <div key={index} className="flex justify-between items-center p-3 bg-white dark:bg-gray-800 rounded-lg">
                                                            <div>
                                                                <div className="font-medium text-gray-900 dark:text-gray-100">{userBot.bot_name}</div>
                                                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                                                    Уровень: {userBot.referral_level} | Баланс бонусов: {formatAmount(userBot.referral_bonus_balance || 0)}
                                                                </div>
                                                            </div>
                                                            {userBot.invited_by_code && (
                                                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                                                    Приглашен: {userBot.inviter_username || userBot.invited_by_code}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* вкладка заявок */}
                                {userModalTab === 'orders' && userDetails && (
                                    <div className="space-y-4">
                                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                            Последние заявки
                                        </div>
                                        {userDetails.recent_orders && userDetails.recent_orders.length > 0 ? (
                                            <div className="space-y-3">
                                                {userDetails.recent_orders.map((order) => (
                                                    <div key={order.id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                                        <div className="flex justify-between items-start">
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-medium text-gray-900 dark:text-gray-100">
                                                                        #{order.unique_id}
                                                                    </span>
                                                                    <span className={`px-2 py-1 text-xs rounded-full ${
                                                                        order.status === 'COMPLETED' 
                                                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                                                            : order.status === 'CANCELLED'
                                                                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                                                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                                                    }`}>
                                                                        {order.status}
                                                                    </span>
                                                                </div>
                                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                                    {order.dir === 'BUY' ? (
                                                                        <span className="flex items-center gap-1">
                                                                            <ArrowUpRight className="w-3 h-3 text-green-500" />
                                                                            Покупка {order.amount_coin} {order.coin}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="flex items-center gap-1">
                                                                            <ArrowDownRight className="w-3 h-3 text-red-500" />
                                                                            Продажа {order.amount_coin} {order.coin}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                    {new Date(order.created_at).toLocaleString('ru-RU')}
                                                                    {order.bot_name && ` • ${order.bot_name}`}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                                                    {formatAmount(order.sum_rub)}
                                                                </div>
                                                                {order.completed_at && (
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                        Завершено: {new Date(order.completed_at).toLocaleString('ru-RU')}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                                У пользователя пока нет заявок
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* вкладка рефералов */}
                                {userModalTab === 'referrals' && userDetails && (
                                    <div className="space-y-4">
                                        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                            Рефералы пользователя
                                        </div>
                                        {userReferrals.length > 0 ? (
                                            <div className="space-y-3">
                                                {userReferrals.map((referral) => (
                                                    <div key={referral.id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                                        <div className="flex justify-between items-start">
                                                            <div className="space-y-1">
                                                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                                                    {referral.username || `User ${referral.tg_id}`}
                                                                </div>
                                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                                    ID: {referral.tg_id} • {referral.bot_name}
                                                                </div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                    Регистрация: {new Date(referral.registered_at).toLocaleDateString('ru-RU')}
                                                                    {referral.last_order_date && (
                                                                        <span> • Последняя заявка: {new Date(referral.last_order_date).toLocaleDateString('ru-RU')}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-right space-y-1">
                                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                    {referral.orders_count} заявок
                                                                </div>
                                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                                    {formatAmount(referral.total_volume)}
                                                                </div>
                                                                <div className="text-xs text-yellow-600 dark:text-yellow-400">
                                                                    Уровень: {referral.referral_level}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                                У пользователя пока нет рефералов
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </Modal>

            <Pagination
                currentPage={pagination.page}
                totalPages={pagination.pages}
                totalItems={pagination.total}
                itemsPerPage={pagination.limit}
                onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
        </div>
    );
};

export default UsersPage;