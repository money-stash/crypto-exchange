import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useConfirmDialog } from '../contexts/ConfirmContext';
import { supportsApi } from '../services/api';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingSpinner from '../components/LoadingSpinner';
import { ActionButton } from '../components/ActionButton';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import CustomSelect from '../components/CustomSelect';
import { useAuth } from '../hooks/useAuth';
import { 
  Headphones, 
  UserPlus, 
  Users, 
  Star, 
  ShoppingBag,
  Search,
  Filter,
  Crown,
  Shield,
  UserCog,
  User
} from 'lucide-react';

const PermissionToggle = ({ checked, onChange, title, description }) => (
  <label className="group flex items-center justify-between gap-4 rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-gradient-to-br from-white to-gray-50/80 dark:from-gray-800 dark:to-gray-900/80 p-3 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-blue-300/70 dark:hover:border-blue-700/70">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
    </div>

    <div className="relative inline-flex h-7 w-12 shrink-0 items-center">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-gray-300 dark:bg-gray-600 transition-colors duration-200 peer-checked:bg-emerald-500 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-400/60" />
      <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 peer-checked:translate-x-5" />
    </div>
  </label>
);

const SupportsPage = () => {
  const { user } = useAuth();
  const { confirm } = useConfirmDialog();
  const [supports, setSupports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    login: '',
    status: 'all',
    role: 'all',
    sortBy: 'created_at',
    sortOrder: 'desc'
  });
  const [selectedSupport, setSelectedSupport] = useState(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingDeposits, setEditingDeposits] = useState(false);
  const [depositValues, setDepositValues] = useState({
    deposit: 0,
  });
  const [editingMaxOrders, setEditingMaxOrders] = useState(false);
  const [maxOrdersValue, setMaxOrdersValue] = useState(10);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    busy: 0,
    offline: 0,
    avgRating: 0,
    totalOrders: 0
  });
  const [newSupport, setNewSupport] = useState({
    login: '',
    password: '',
    role: 'operator',
    chat_language: 'RU',
    can_write_chat: true,
    can_cancel_order: true,
    can_edit_requisites: true,
    can_use_coupons: false,
    deposit: 0,
    rate_percent: 0,
    daily_rate_usd: 0,
    per_order_rate_usd: 0
  });
  const [editSupport, setEditSupport] = useState({
    id: null,
    login: '',
    role: 'operator',
    chat_language: 'RU',
    can_write_chat: true,
    can_cancel_order: true,
    can_edit_requisites: true,
    can_use_coupons: false,
    deposit: 0,
    rate_percent: 0,
    daily_rate_usd: 0,
    per_order_rate_usd: 0,
    newPassword: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });
  const [loadingViewId, setLoadingViewId] = useState(null);
  const [selectedSupportDebt, setSelectedSupportDebt] = useState(null);
  const [debtIntentAmount, setDebtIntentAmount] = useState('');
  const [debtSubmittingIntent, setDebtSubmittingIntent] = useState(false);
  const [debtWriteOffLoading, setDebtWriteOffLoading] = useState(false);
  const [debtCurrentIntent, setDebtCurrentIntent] = useState(null);
  const [debtCurrentPayment, setDebtCurrentPayment] = useState(null);
  const debtSupportId = selectedSupport?.id || editSupport?.id || null;
  useEffect(() => {
    loadData();
  }, [filters, pagination.page]);
  useEffect(() => {
    if ((user?.role || '').toUpperCase() !== 'SUPERADMIN') return;
    if (!debtSupportId || !debtCurrentIntent?.id) return;
    let disposed = false;
    const pollIntentStatus = async () => {
      try {
        const response = await supportsApi.getSupportDebtIntentStatus(debtSupportId, debtCurrentIntent.id);
        if (disposed) return;
        const intent = response?.data?.intent || null;
        const payment = response?.data?.payment || null;
        if (intent) {
          setDebtCurrentIntent(intent);
        }
        setDebtCurrentPayment(payment);
        const paymentStatus = String(payment?.status || '').toUpperCase();
        const intentStatus = String(intent?.status || '').toUpperCase();
        if (paymentStatus === 'CONFIRMED') {
          await refreshSelectedSupportDebt(debtSupportId);
        }
        if (intentStatus === 'EXPIRED' && !payment) {
          await refreshSelectedSupportDebt(debtSupportId);
        }
      } catch (error) {
        if (!disposed) {
          console.error('Support debt intent polling failed:', error);
        }
      }
    };
    pollIntentStatus();
    const intervalId = setInterval(pollIntentStatus, 8000);
    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, [user?.role, debtSupportId, debtCurrentIntent?.id]);
  const loadData = async () => {
    try {
      setLoading(true);
      const response = await supportsApi.getSupports({
        ...filters,
        page: pagination.page,
        limit: pagination.limit
      });
      setSupports(response.data?.supports || []);
      setStats(response.data?.stats || {
        total: 0,
        active: 0,
        busy: 0,
        offline: 0,
        avgRating: 0,
        totalOrders: 0
      });
      setPagination(prev => ({
        ...prev,
        total: response.data?.total || 0,
        pages: response.data?.pages || 0
      }));
    } catch (error) {
      toast.error('Ошибка при загрузке поддержки');
      console.error('Load supports error:', error);
    } finally {
      setLoading(false);
    }
  };
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };
  const getSupportDepositWork = (support) => parseFloat(support?.deposit_work ?? support?.deposit ?? 0) || 0;
  const getSupportDepositPaid = (support) => parseFloat(support?.deposit_paid ?? 0) || 0;
  const getSupportRatePercent = (support) => parseFloat(support?.rate_percent ?? 0) || 0;
  const handleSupportClick = async (support) => {
    setLoadingViewId(support.id);
    try {
      const response = await supportsApi.getSupportById(support.id);
      const fullSupport = response.data || response;
      setSelectedSupport(fullSupport);
      setDepositValues({
        deposit: parseFloat(fullSupport?.deposit ?? 0) || 0,
      });
      setEditingDeposits(false);
      setDebtCurrentIntent(null);
      setDebtCurrentPayment(null);
      setDebtIntentAmount('');
      setShowSupportModal(true);
      if ((user?.role || '').toUpperCase() === 'SUPERADMIN') {
        try {
          const debtResponse = await supportsApi.getSupportDebt(support.id);
          setSelectedSupportDebt(debtResponse.data || null);
        } catch (debtError) {
          console.error('Load support debt error:', debtError);
          setSelectedSupportDebt(null);
        }
      } else {
        setSelectedSupportDebt(null);
      }
    } catch (error) {
      toast.error('Ошибка при загрузке данных оператора');
    } finally {
      setLoadingViewId(null);
    }
  };
  const refreshSelectedSupportDebt = async (supportId) => {
    if ((user?.role || '').toUpperCase() !== 'SUPERADMIN') return;
    if (!supportId) return;
    try {
      const response = await supportsApi.getSupportDebt(supportId);
      setSelectedSupportDebt(response.data || null);
    } catch (error) {
      console.error('Refresh support debt error:', error);
    }
  };
  const handleCreateSupportDebtIntent = async () => {
    if ((user?.role || '').toUpperCase() !== 'SUPERADMIN') {
      toast.error('Доступ запрещен');
      return;
    }
    const supportId = debtSupportId;
    if (!supportId) {
      toast.error('Оператор не выбран');
      return;
    }
    const requested = Number(debtIntentAmount);
    if (!Number.isFinite(requested) || requested <= 0) {
      toast.error('Введите корректную сумму USDT');
      return;
    }
    try {
      setDebtSubmittingIntent(true);
      const response = await supportsApi.createSupportDebtIntent(supportId, requested);
      setDebtCurrentIntent(response.data || null);
      setDebtCurrentPayment(null);
      toast.success('Реквизиты для погашения сформированы');
      await refreshSelectedSupportDebt(supportId);
    } catch (error) {
      console.error('Create support debt intent error:', error);
      toast.error(error.response?.data?.error || 'Не удалось создать intent');
    } finally {
      setDebtSubmittingIntent(false);
    }
  };
  const handleWriteOffSupportDebt = async () => {
    if ((user?.role || '').toUpperCase() !== 'SUPERADMIN') {
      toast.error('Доступ запрещен');
      return;
    }
    const supportId = debtSupportId;
    if (!supportId) {
      toast.error('Оператор не выбран');
      return;
    }
    const openUsdt = Number(selectedSupportDebt?.usdt_open_total || 0);
    if (openUsdt <= 0) {
      toast.error('У оператора нет открытого USDT-долга');
      return;
    }
    let requested = openUsdt;
    if (String(debtIntentAmount || '').trim() !== '') {
      requested = Number(debtIntentAmount);
      if (!Number.isFinite(requested) || requested <= 0) {
        toast.error('Введите корректную сумму USDT');
        return;
      }
    }
    try {
      setDebtWriteOffLoading(true);
      const response = await supportsApi.writeOffSupportDebt(supportId, requested);
      const result = response?.data || {};
      const writtenOffUsdt = Number(result.written_off_usdt || 0);
      setDebtCurrentIntent(null);
      setDebtCurrentPayment(null);
      setDebtIntentAmount('');
      await refreshSelectedSupportDebt(supportId);
      toast.success(
        `Списано ${writtenOffUsdt.toFixed(4)} USDT`
      );
    } catch (error) {
      console.error('Write off support debt error:', error);
      toast.error(error.response?.data?.error || 'Не удалось списать долг');
    } finally {
      setDebtWriteOffLoading(false);
    }
  };
  const createSupport = async () => {
    // Валидация
    if (!newSupport.login.trim()) {
      toast.error('Логин не может быть пустым');
      return;
    }
    if (newSupport.login.trim().length < 3) {
      toast.error('Логин должен содержать минимум 3 символа');
      return;
    }
    if (!newSupport.password.trim()) {
      toast.error('Пароль не может быть пустым');
      return;
    }
    if (newSupport.password.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
      return;
    }
    try {
      const createRes = await supportsApi.createSupport(newSupport);
      const newId = createRes?.data?.id;
      if (newId && (newSupport.daily_rate_usd || newSupport.per_order_rate_usd)) {
        try {
          await supportsApi.updateSalary(newId, {
            daily_rate_usd: newSupport.daily_rate_usd || 0,
            per_order_rate_usd: newSupport.per_order_rate_usd || 0,
          });
        } catch {}
      }
      toast.success('Оператор добавлен');
      setShowCreateModal(false);
      setNewSupport({
        login: '',
        password: '',
        role: 'operator',
        chat_language: 'RU',
        can_write_chat: true,
        can_cancel_order: true,
        can_edit_requisites: true,
        can_use_coupons: false,
        deposit: 0,
        rate_percent: 0,
        daily_rate_usd: 0,
        per_order_rate_usd: 0
      });
      loadData();
    } catch (error) {
      toast.error('Ошибка при создании оператора');
    }
  };
  const updateSupportStatus = async (supportId, status) => {
    try {
      await supportsApi.updateSupportStatus(supportId, status);
      toast.success('Статус обновлен');
      loadData();
    } catch (error) {
      toast.error('Ошибка при обновлении статуса');
    }
  };
  const toggleSupportStatus = async (support) => {
    try {
      // Определяем новый статус: если оператор активен (is_active = 1), то отключаем, иначе включаем
      const newStatus = support.is_active ? 'offline' : 'active';
      await supportsApi.updateSupportStatus(support.id, newStatus);
      toast.success(`Оператор ${newStatus === 'offline' ? 'отключен' : 'включен'}`);
      loadData();
    } catch (error) {
      toast.error('Ошибка при изменении статуса');
    }
  };
  const updateMaxOrders = async (supportId, maxOrders) => {
    try {
      await supportsApi.updateMaxOrders(supportId, maxOrders);
      toast.success('Лимит заказов обновлен');
      setEditingMaxOrders(false);
      loadData();
      if (selectedSupport) {
        setSelectedSupport(prev => ({ ...prev, active_limit: maxOrders }));
      }
    } catch (error) {
      toast.error('Ошибка при обновлении лимита');
    }
  };
  const updateDeposit = async (supportId, deposits) => {
    try {
      await supportsApi.updateDeposit(supportId, deposits);
      toast.success('Депозит обновлен');
      setEditingDeposits(false);
      loadData();
      if (selectedSupport) {
        setSelectedSupport(prev => ({
          ...prev,
          deposit: deposits.deposit,
        }));
      }
    } catch (error) {
      toast.error('Ошибка при обновлении депозита');
    }
  };
  const updateSupportData = async () => {
    // Валидация нового пароля (если он указан)
    if (editSupport.newPassword && editSupport.newPassword.length < 6) {
      toast.error('Новый пароль должен содержать минимум 6 символов');
      return;
    }
    try {
      const updateData = {
        login: editSupport.login,
        role: editSupport.role,
        chat_language: editSupport.chat_language,
        can_write_chat: Boolean(editSupport.can_write_chat),
        can_cancel_order: Boolean(editSupport.can_cancel_order),
        can_edit_requisites: Boolean(editSupport.can_edit_requisites),
        can_use_coupons: Boolean(editSupport.can_use_coupons),
        deposit: editSupport.deposit,
        rate_percent: editSupport.rate_percent
      };
      // Добавляем пароль только если он был указан
      if (editSupport.newPassword.trim()) {
        updateData.password = editSupport.newPassword;
      }
      await supportsApi.updateSupport(editSupport.id, updateData);
      try {
        await supportsApi.updateSalary(editSupport.id, {
          daily_rate_usd: editSupport.daily_rate_usd || 0,
          per_order_rate_usd: editSupport.per_order_rate_usd || 0,
        });
      } catch {}
      toast.success(editSupport.newPassword ? 'Данные оператора и пароль обновлены' : 'Данные оператора обновлены');
      setShowEditModal(false);
      loadData();
    } catch (error) {
      toast.error('Ошибка при обновлении данных оператора');
    }
  };
  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'busy': return 'bg-yellow-100 text-yellow-800';
      case 'offline': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  const getStatusText = (status) => {
    switch (status) {
      case 'active': return 'Активен';
      case 'busy': return 'Занят';
      case 'offline': return 'Не в сети';
      default: return 'Неизвестно';
    }
  };
  const getRoleText = (role) => {
    switch (role.toLowerCase()) {
      case 'superadmin': return 'Супер администратор';
      case 'ex_admin': return 'Администратор обменника';
      case 'manager': return 'Менеджер';
      case 'operator': return 'Оператор';
      default: return role;
    }
  };
  const getRoleIcon = (role) => {
    switch (role.toLowerCase()) {
      case 'superadmin': 
        return {
          icon: Crown,
          color: 'text-yellow-500 dark:text-yellow-400',
          bgColor: 'bg-yellow-50 dark:bg-yellow-950/30',
          borderColor: 'border-yellow-200 dark:border-yellow-800'
        };
      case 'ex_admin': 
        return {
          icon: Shield,
          color: 'text-purple-500 dark:text-purple-400',
          bgColor: 'bg-purple-50 dark:bg-purple-950/30',
          borderColor: 'border-purple-200 dark:border-purple-800'
        };
      case 'manager': 
        return {
          icon: UserCog,
          color: 'text-blue-500 dark:text-blue-400',
          bgColor: 'bg-blue-50 dark:bg-blue-950/30',
          borderColor: 'border-blue-200 dark:border-blue-800'
        };
      case 'operator': 
        return {
          icon: User,
          color: 'text-gray-500 dark:text-gray-400',
          bgColor: 'bg-gray-50 dark:bg-gray-900/30',
          borderColor: 'border-gray-200 dark:border-gray-700'
        };
      default: 
        return {
          icon: User,
          color: 'text-gray-500 dark:text-gray-400',
          bgColor: 'bg-gray-50 dark:bg-gray-900/30',
          borderColor: 'border-gray-200 dark:border-gray-700'
        };
    }
  };
  const formatRating = (rating) => {
    return rating ? rating.toFixed(1) : '0.0';
  };
  const handleViewSupport = (support) => {
    handleSupportClick(support);
  };
  const handleEditSupport = (support) => {
    setEditSupport({
      id: support.id,
      login: support.login,
      role: support.role,
      chat_language: String(support.chat_language || 'RU').toUpperCase(),
      can_write_chat: Number(support.can_write_chat ?? 1) === 1,
      can_cancel_order: Number(support.can_cancel_order ?? 1) === 1,
      can_edit_requisites: Number(support.can_edit_requisites ?? 1) === 1,
      can_use_coupons: Number(support.can_use_coupons ?? 0) === 1,
      deposit: parseFloat(support.deposit) || 0,
      rate_percent: getSupportRatePercent(support),
      newPassword: ''
    });
    setDebtCurrentIntent(null);
    setDebtCurrentPayment(null);
    setDebtIntentAmount('');
    if ((user?.role || '').toUpperCase() === 'SUPERADMIN') {
      refreshSelectedSupportDebt(support.id);
    } else {
      setSelectedSupportDebt(null);
    }
    setShowEditModal(true);
  };
  const handleDeleteSupport = async (supportId) => {
    const confirmed = await confirm({
      title: 'Удаление оператора',
      message: 'Вы уверены, что хотите удалить этого оператора?',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger'
    });
    if (confirmed) {
      try {
        await supportsApi.deleteSupport(supportId);
        toast.success('Оператор удалён');
        loadData();
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Ошибка при удалении оператора');
      }
    }
  };
  const renderSupportDebtPanel = () => {
    if ((user?.role || '').toUpperCase() !== 'SUPERADMIN' || !editSupport?.id) {
      return null;
    }

    return (
    <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-4">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Погашение USDT-долга оператора</h4>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        Открытый долг: <b>{Number(selectedSupportDebt?.usdt_open_total || 0).toFixed(4)} USDT</b>
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
        
      </p>
      <div className="flex flex-col md:flex-row gap-2 mb-3">
        <input
          type="number"
          min="0"
          step="0.0001"
          value={debtIntentAmount}
          onChange={(e) => setDebtIntentAmount(e.target.value)}
          placeholder="Сумма USDT"
          className="w-full md:w-56 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        
        <button
          onClick={handleWriteOffSupportDebt}
          disabled={debtWriteOffLoading}
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {debtWriteOffLoading ? 'Списание...' : 'Списать без оплаты'}
        </button>
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
        Оставьте сумму пустой, чтобы списать весь открытый долг оператора.
      </div>
      {debtCurrentIntent && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-700 bg-white/80 dark:bg-gray-900/50 p-3 text-sm">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="w-36 h-36 rounded-lg overflow-hidden bg-white border border-blue-100 flex items-center justify-center">
              {debtCurrentIntent.qr_url ? (
                <img
                  src={debtCurrentIntent.qr_url}
                  alt="QR оплаты USDT"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-xs text-gray-500">QR недоступен</span>
              )}
            </div>
            <div className="space-y-1 text-gray-800 dark:text-gray-200">
              <div><b>Intent #{debtCurrentIntent.id}</b></div>
              <div>Точная сумма: <b>{Number(debtCurrentIntent.exact_usdt).toFixed(4)} USDT</b></div>
              <div className="break-all">Адрес: <b>{debtCurrentIntent.company_wallet}</b></div>
              <div>Действует до: <b>{new Date(debtCurrentIntent.expires_at).toLocaleString('ru-RU')}</b></div>
              <div>
                Статус:{' '}
                <b>
                  {debtCurrentPayment?.status === 'CONFIRMED'
                    ? 'Оплачен и подтвержден'
                    : debtCurrentPayment?.status === 'PENDING'
                      ? 'Платеж найден, ожидаем подтверждения'
                      : String(debtCurrentIntent.status || '').toUpperCase() === 'EXPIRED'
                        ? 'Истек'
                        : 'Ожидаем платеж'}
                </b>
              </div>
              {debtCurrentPayment?.tx_hash && (
                <div className="break-all">
                  Tx: <span className="font-mono">{debtCurrentPayment.tx_hash}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Premium Header */}
      <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
        <div className="relative px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <Headphones className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                  Сотрудники
                </h1>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                  Управление сотрудниками
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="group relative px-6 py-3 bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 text-white rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-2xl flex items-center gap-2.5 hover:scale-105 active:scale-95 overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
              <UserPlus className="w-5 h-5 relative z-10" />
              <span className="relative z-10">Добавить оператора</span>
            </button>
          </div>
        </div>
      </div>
      {/* Статистика */}
      {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-gray-600 rounded-lg flex items-center justify-center">
                <Users className="text-white w-5 h-5" />
              </div>
            </div>
            <div className="ml-4 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate">Всего операторов</dt>
                {loading ? (
                  <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                ) : (
                  <dd className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats?.total || 0}</dd>
                )}
              </dl>
            </div>
          </div>
        </div>
        <div className="card bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                <Star className="text-white w-5 h-5" />
              </div>
            </div>
            <div className="ml-4 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-purple-600 dark:text-purple-300 truncate">Средний рейтинг</dt>
                {loading ? (
                  <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                ) : (
                  <dd className="text-lg font-bold text-purple-900 dark:text-purple-100">{formatRating(stats?.avgRating || 0)}</dd>
                )}
              </dl>
            </div>
          </div>
        </div>
        <div className="card bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <ShoppingBag className="text-white w-5 h-5" />
              </div>
            </div>
            <div className="ml-4 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-blue-600 dark:text-blue-300 truncate">Всего заказов</dt>
                {loading ? (
                  <dd className="h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1"></dd>
                ) : (
                  <dd className="text-lg font-bold text-blue-900 dark:text-blue-100">{stats?.totalOrders || 0}</dd>
                )}
              </dl>
            </div>
          </div>
        </div>
      </div> */}
      {/* Фильтры */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="мя, Telegram ID..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium shadow-sm hover:shadow-md"
              />
              <Search className="absolute left-4 bottom-3.5 w-5 h-5 text-gray-400" />
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Логин..."
                value={filters.login}
                onChange={(e) => handleFilterChange('login', e.target.value)}
                className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium shadow-sm hover:shadow-md"
              />
              <Search className="absolute left-4 bottom-3.5 w-5 h-5 text-gray-400" />
            </div>
            <CustomSelect
              value={filters.role}
              onChange={(value) => handleFilterChange('role', value)}
              options={[
                { value: 'all', label: 'Все роли' },
                { value: 'ex_admin', label: 'Администраторы обменников' },
                { value: 'manager', label: 'Менеджеры' },
                { value: 'operator', label: 'Операторы' }
              ]}
              icon={Filter}
              placeholder="Выберите роль"
            />
            <CustomSelect
              value={filters.sortBy}
              onChange={(value) => handleFilterChange('sortBy', value)}
              options={[
                { value: 'created_at', label: 'Дата добавления' },
                { value: 'name', label: 'мя' },
                { value: 'rating', label: 'Рейтинг' },
                { value: 'orders_count', label: 'Orders count' },
                { value: 'rate_percent', label: 'Rate %' }
              ]}
              icon={Filter}
              placeholder="Выберите сортировку"
            />
          </div>
        </div>
      </div>
      {/* Таблица операторов */}
      <ResponsiveTable
        columns={[
          {
            header: 'Оператор',
            key: 'name',
            render: (support) => (
              <div className="flex items-center">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {support.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {support.login}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(support.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </div>
              </div>
            )
          },
          {
            header: 'Роль',
            key: 'role',
            render: (support) => {
              const roleConfig = getRoleIcon(support.role);
              const RoleIcon = roleConfig.icon;
              return (
                <div className="flex items-center space-x-2">
                  <div className={`p-2 rounded-lg ${roleConfig.bgColor} ${roleConfig.borderColor} border`}>
                    <RoleIcon className={`w-4 h-4 ${roleConfig.color}`} />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {getRoleText(support.role)}
                  </span>
                </div>
              );
            }
          },
          {
            header: 'Общий рейтинг',
            key: 'rating',
            render: (support) => (
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {support.role == "OPERATOR" ? support.rating.overall_rating.toFixed(1) : '-'}
                </span>
                {support.role == "OPERATOR" && (
                  <div className="ml-1 flex text-yellow-400">
                    {[...Array(5)].map((_, i) => (
                      <svg
                        key={i}
                        className={`h-4 w-4 ${i < Math.floor(support.rating.overall_rating) ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.538-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                )}
              </div>
            )
          },
          {
            header: 'Статистика',
            key: 'stats',
            render: (support) => (
              <div className="text-sm">
                <div className="text-gray-900 dark:text-gray-100">
                  Заявок: {support.orders_count || 0}
                </div>
                <div className="text-gray-500 dark:text-gray-400">
                  Выполнено: {support.completed_orders || 0}
                </div>
                <div className="text-blue-600 dark:text-blue-400 font-medium">
                  Депозит: {parseFloat(support.deposit || 0).toFixed(4)} USDT
                </div>
                <div className="text-green-600 dark:text-green-400 font-medium">
                  Заморожено: {parseFloat(support.deposit_work || 0).toFixed(4)} USDT
                </div>
                <div className="text-indigo-600 dark:text-indigo-400 font-medium">
                  Rate: {getSupportRatePercent(support).toFixed(2)}%
                </div>
              </div>
            )
          },
          {
            header: 'Действия',
            key: 'actions',
            render: (support) => (
              <div className="flex gap-2">
                <ActionButton
                  type="view"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewSupport(support);
                  }}
                  variant="primary"
                  title="Просмотр"
                  loading={loadingViewId === support.id}
                />
                <ActionButton
                  type="edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditSupport(support);
                  }}
                  variant="default"
                  title="Редактировать"
                />
                <ActionButton
                  type="power"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSupportStatus(support);
                  }}
                  variant={support.is_active ? "danger" : "success"}
                  title={support.is_active ? "Отключить" : "Включить"}
                />
                {/* {support.role !== 'superadmin' && (
                  <ActionButton
                    type="clipboard"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const response = await supportsApi.getSupportCredentials(support.id);
                        const data = `Логин: ${response.data.login}\nПароль: ${response.data.password}\nРоль: ${getRoleText(response.data.role)}`;
                        await navigator.clipboard.writeText(data);
                        toast.success('Данные скопированы в буфер обмена');
                      } catch (error) {
                        toast.error('Ошибка при получении данных');
                      }
                    }}
                    variant="default"
                    title="Скопировать данные"
                  />
                )} */}
                <ActionButton
                  type="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSupport(support.id);
                  }}
                  variant="danger"
                  title="Удалить"
                />
              </div>
            )
          }
        ]}
        data={supports}
        keyField="id"
        mobileCardRender={(support) => (
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{support.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{support.login}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(support.created_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {getRoleText(support.role)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Рейтинг:</span>
                <div className="text-gray-900 dark:text-gray-100">
                  {support.rating ? support.rating.toFixed(1) : 'Нет'} {'\u2605'}
                </div>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Заявок:</span>
                <div className="text-gray-900 dark:text-gray-100">{support.orders_count || 0}</div>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Депозиты:</span>
                <div className="text-blue-600 dark:text-blue-400 font-medium">
                  Депозит: {parseFloat(support.deposit || 0).toFixed(4)} USDT
                </div>
                <div className="text-green-600 dark:text-green-400 font-medium">
                  Заморожено: {parseFloat(support.deposit_work || 0).toFixed(4)} USDT
                </div>
                <div className="text-indigo-600 dark:text-indigo-400 font-medium">
                  Rate: {getSupportRatePercent(support).toFixed(2)}%
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <ActionButton
                type="view"
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewSupport(support);
                }}
                variant="primary"
                title="Просмотр"
                loading={loadingViewId === support.id}
              />
              <ActionButton
                type="edit"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditSupport(support);
                }}
                variant="default"
                title="Редактировать"
              />
              <ActionButton
                type="power"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSupportStatus(support);
                }}
                variant={support.is_active ? "danger" : "success"}
                title={support.is_active ? "Отключить" : "Включить"}
              />
              <ActionButton
                type="delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSupport(support.id);
                }}
                variant="danger"
                title="Удалить"
              />
            </div>
          </div>
        )}
        loading={loading}
        emptyMessage="Операторы не найдены"
      />
      {/* Пагинация */}
      <Pagination
        currentPage={pagination.page}
        totalPages={pagination.pages}
        totalItems={pagination.total}
        itemsPerPage={pagination.limit}
        onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
      />
      {/* Модальное окно создания оператора */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Добавить оператора"
        size="md"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        }
        iconColor="green"
      >
        <div className="space-y-4">
              <div>
                <label className="form-label mb-2">
                  Логин
                </label>
                <input
                  type="text"
                  value={newSupport.login}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, login: e.target.value }))}
                  className={`form-input w-full ${
                    newSupport.login && newSupport.login.trim().length < 3 
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                      : ''
                  }`}
                  placeholder="Минимум 3 символа"
                />
                {newSupport.login && newSupport.login.trim().length < 3 && (
                  <p className="mt-1 text-sm text-red-600">
                    Логин должен содержать минимум 3 символа
                  </p>
                )}
              </div>
              <div>
                <label className="form-label mb-2">
                  Пароль
                </label>
                <div className="w-full">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSupport.password}
                      onChange={(e) => setNewSupport(prev => ({ ...prev, password: e.target.value }))}
                      className={`form-input flex-1 ${
                        newSupport.password && newSupport.password.length < 6 
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                          : ''
                      }`}
                      placeholder="Минимум 6 символов"
                    />
                    <button
                      onClick={() => {
                        const generated = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
                        setNewSupport(prev => ({ ...prev, password: generated }));
                      }}
                      type="button"
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md flex-shrink-0"
                      title="Сгенерировать пароль"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                    {newSupport.password && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(newSupport.password);
                          toast.success('Пароль скопирован в буфер обмена');
                        }}
                        type="button"
                        className="px-3 py-2 bg-green-100 hover:bg-green-200 dark:bg-green-700 dark:hover:bg-green-600 rounded-md flex-shrink-0"
                        title="Скопировать пароль"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {newSupport.password && newSupport.password.length < 6 && (
                    <p className="mt-1 text-sm text-red-600">
                      Пароль должен содержать минимум 6 символов
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="form-label mb-2">
                  Роль
                </label>
                <CustomSelect
                  value={newSupport.role}
                  onChange={(value) => setNewSupport(prev => ({ ...prev, role: value }))}
                  options={[
                    { value: 'operator', label: 'Оператор' },
                    { value: 'manager', label: 'Менеджер' },
                    { value: 'ex_admin', label: 'Администратор обменника' }
                  ]}
                  placeholder="Выберите роль"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  Язык чата оператора
                </label>
                <CustomSelect
                  value={newSupport.chat_language}
                  onChange={(value) => setNewSupport(prev => ({ ...prev, chat_language: value }))}
                  options={[
                    { value: 'RU', label: 'Русский (RU)' },
                    { value: 'EN', label: 'Английский (EN)' }
                  ]}
                  placeholder="Выберите язык"
                />
              </div>
              <div className="space-y-3">
                <PermissionToggle
                  checked={newSupport.can_write_chat}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, can_write_chat: e.target.checked }))}
                  title="Возможность писать в чат"
                  description="Оператор сможет отправлять сообщения клиенту."
                />
                <PermissionToggle
                  checked={newSupport.can_cancel_order}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, can_cancel_order: e.target.checked }))}
                  title="Возможность отменить сделку"
                  description="Оператор сможет отменять заявки, если это разрешено статусом."
                />
                <PermissionToggle
                  checked={newSupport.can_edit_requisites}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, can_edit_requisites: e.target.checked }))}
                  title="Возможность менять реквизиты"
                  description="Оператор сможет отправлять новые реквизиты по заявке."
                />
                {newSupport.role !== 'cashier' && (
                  <PermissionToggle
                    checked={newSupport.can_use_coupons}
                    onChange={(e) => setNewSupport(prev => ({ ...prev, can_use_coupons: e.target.checked }))}
                    title="Доступ к промокодам"
                    description="Сотрудник сможет создавать и управлять промокодами."
                  />
                )}
              </div>
              <div>
                <label className="form-label mb-2">
                  Внесенный депозит (USDT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={newSupport.deposit}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, deposit: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  Процент к курсу оператора (%)
                </label>
                <input
                  type="number"
                  min="-100"
                  max="100"
                  step="0.01"
                  value={newSupport.rate_percent}
                  onChange={(e) => setNewSupport(prev => ({ ...prev, rate_percent: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  ЗП в день ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newSupport.daily_rate_usd || 0}
                  onChange={e => setNewSupport(prev => ({ ...prev, daily_rate_usd: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  ЗП за заявку ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newSupport.per_order_rate_usd || 0}
                  onChange={e => setNewSupport(prev => ({ ...prev, per_order_rate_usd: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
            </div>
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100 dark:border-gray-700 -mx-6 px-6 -mb-4 pb-4 mt-6 bg-gray-50 dark:bg-gray-700/50 rounded-b-2xl">
          <button
            onClick={() => setShowCreateModal(false)}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 rounded-lg"
          >
            Отмена
          </button>
          <button
            onClick={createSupport}
            disabled={
              !newSupport.login.trim() || 
              newSupport.login.trim().length < 3 ||
              !newSupport.password.trim() || 
              newSupport.password.length < 6
            }
            className={`px-4 py-2 font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              !newSupport.login.trim() || 
              newSupport.login.trim().length < 3 ||
              !newSupport.password.trim() || 
              newSupport.password.length < 6
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500'
            }`}
          >
            Создать
          </button>
        </div>
      </Modal>
      {/* Модальное окно редактирования оператора */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Редактировать оператора"
        size="md"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        }
        iconColor="blue"
      >
        <div className="space-y-4">
              <div>
                <label className="form-label mb-2">
                  Логин
                </label>
                <input
                  type="text"
                  value={editSupport.login}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, login: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  Новый пароль
                  <span className="text-sm text-gray-500 ml-1">(оставьте пустым, если не хотите менять)</span>
                </label>
                <div className="w-full">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editSupport.newPassword}
                      onChange={(e) => setEditSupport(prev => ({ ...prev, newPassword: e.target.value }))}
                      className={`form-input flex-1 ${
                        editSupport.newPassword && editSupport.newPassword.length < 6 
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                          : ''
                      }`}
                      placeholder="Минимум 6 символов (необязательно)"
                    />
                  <button
                    onClick={() => {
                      const generated = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
                      setEditSupport(prev => ({ ...prev, newPassword: generated }));
                    }}
                    type="button"
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md flex-shrink-0"
                    title="Сгенерировать новый пароль"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  {editSupport.newPassword && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(editSupport.newPassword);
                        toast.success('Новый пароль скопирован в буфер обмена');
                      }}
                      type="button"
                      className="px-3 py-2 bg-green-100 hover:bg-green-200 dark:bg-green-700 dark:hover:bg-green-600 rounded-md flex-shrink-0"
                      title="Скопировать новый пароль"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                    </button>
                  )}
                  </div>
                  {editSupport.newPassword && editSupport.newPassword.length < 6 && (
                    <p className="mt-1 text-sm text-red-600">
                      Пароль должен содержать минимум 6 символов
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="form-label mb-2">
                  Роль
                </label>
                <CustomSelect
                  value={editSupport.role}
                  onChange={(value) => setEditSupport(prev => ({ ...prev, role: value }))}
                  options={[
                    { value: 'operator', label: 'Оператор' },
                    { value: 'manager', label: 'Менеджер' },
                    { value: 'ex_admin', label: 'Администратор обменника' }
                  ]}
                  placeholder="Выберите роль"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  Язык чата оператора
                </label>
                <CustomSelect
                  value={editSupport.chat_language}
                  onChange={(value) => setEditSupport(prev => ({ ...prev, chat_language: value }))}
                  options={[
                    { value: 'RU', label: 'Русский (RU)' },
                    { value: 'EN', label: 'Английский (EN)' }
                  ]}
                  placeholder="Выберите язык"
                />
              </div>
              <div className="space-y-3">
                <PermissionToggle
                  checked={editSupport.can_write_chat}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, can_write_chat: e.target.checked }))}
                  title="Возможность писать в чат"
                  description="Оператор сможет отправлять сообщения клиенту."
                />
                <PermissionToggle
                  checked={editSupport.can_cancel_order}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, can_cancel_order: e.target.checked }))}
                  title="Возможность отменить сделку"
                  description="Оператор сможет отменять заявки, если это разрешено статусом."
                />
                <PermissionToggle
                  checked={editSupport.can_edit_requisites}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, can_edit_requisites: e.target.checked }))}
                  title="Возможность менять реквизиты"
                  description="Оператор сможет отправлять новые реквизиты по заявке."
                />
                {editSupport.role !== 'cashier' && editSupport.role !== 'CASHIER' && (
                  <PermissionToggle
                    checked={editSupport.can_use_coupons}
                    onChange={(e) => setEditSupport(prev => ({ ...prev, can_use_coupons: e.target.checked }))}
                    title="Доступ к промокодам"
                    description="Сотрудник сможет создавать и управлять промокодами."
                  />
                )}
              </div>
              <div>
                <label className="form-label mb-2">
                  Внесенный депозит (USDT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={editSupport.deposit}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, deposit: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  Процент к курсу оператора (%)
                </label>
                <input
                  type="number"
                  min="-100"
                  max="100"
                  step="0.01"
                  value={editSupport.rate_percent}
                  onChange={(e) => setEditSupport(prev => ({ ...prev, rate_percent: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  ЗП в день ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editSupport.daily_rate_usd || 0}
                  onChange={e => setEditSupport(prev => ({ ...prev, daily_rate_usd: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="form-label mb-2">
                  ЗП за заявку ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editSupport.per_order_rate_usd || 0}
                  onChange={e => setEditSupport(prev => ({ ...prev, per_order_rate_usd: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>
        </div>
        {renderSupportDebtPanel()}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100 dark:border-gray-700 -mx-6 px-6 -mb-4 pb-4 mt-6 bg-gray-50 dark:bg-gray-700/50 rounded-b-2xl">
          <button
            onClick={() => setShowEditModal(false)}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 rounded-lg"
          >
            Отмена
          </button>
          <button
            onClick={updateSupportData}
            disabled={editSupport.newPassword && editSupport.newPassword.length < 6}
            className={`px-4 py-2 font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              editSupport.newPassword && editSupport.newPassword.length < 6
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500'
            }`}
          >
            Сохранить
          </button>
        </div>
      </Modal>
      {/* Модальное окно деталей */}
      <Modal
        isOpen={showSupportModal && selectedSupport}
        onClose={() => setShowSupportModal(false)}
        title="Детали оператора"
        size="lg"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        }
        iconColor="blue"
      >
        {selectedSupport && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Основная информация</h4>
                <div className="space-y-2 text-sm">
                  <div className="text-gray-900 dark:text-gray-100"><span className="font-medium">Логин:</span> {selectedSupport.login}</div>
                  <div className="flex items-center">
                    <span className="font-medium text-gray-900 dark:text-gray-100">Роль:</span>
                    {(() => {
                      const roleConfig = getRoleIcon(selectedSupport.role);
                      const RoleIcon = roleConfig.icon;
                      return (
                        <div className="ml-2 flex items-center space-x-2">
                          <div className={`p-1.5 rounded-lg ${roleConfig.bgColor} ${roleConfig.borderColor} border`}>
                            <RoleIcon className={`w-4 h-4 ${roleConfig.color}`} />
                          </div>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {getRoleText(selectedSupport.role)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="text-gray-900 dark:text-gray-100"><span className="font-medium">Статус:</span> 
                    <span className={`ml-1 px-2 py-1 text-xs rounded ${getStatusColor(selectedSupport.status)}`}>
                      {getStatusText(selectedSupport.status)}
                    </span>
                  </div>
                  <div className="text-gray-900 dark:text-gray-100"><span className="font-medium">Добавлен:</span> {new Date(selectedSupport.created_at).toLocaleString('ru-RU')}</div>
                  {/* <div className="text-gray-900 dark:text-gray-100"><span className="font-medium">Последняя активность:</span> {selectedSupport.last_activity ? new Date(selectedSupport.last_activity).toLocaleString('ru-RU') : 'Никогда'}</div> */}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Статистика и настройки</h4>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Общий рейтинг:</span> {formatRating(selectedSupport.rating.overall_rating)}</div>
                  <div><span className="font-medium">Рейтинг по скорости:</span> {formatRating(selectedSupport.rating.speed_rating)}</div>
                  <div><span className="font-medium">Рейтинг по отзывам:</span> {formatRating(selectedSupport.rating.user_rating)}</div>
                  <div><span className="font-medium">Текущая нагрузка:</span> {selectedSupport.current_orders || 0} / {selectedSupport.active_limit || 10}</div>
                  <div><span className="font-medium">Всего заказов:</span> {selectedSupport.orders_count || 0}</div>
                  <div><span className="font-medium">Завершено:</span> {selectedSupport.completed_orders || 0}</div>
                  <div><span className="font-medium">Отменено:</span> {selectedSupport.cancelled_orders || 0}</div>
                  <div><span className="font-medium">Rate %:</span> {getSupportRatePercent(selectedSupport).toFixed(2)}%</div>
                  <div>
                    <span className="font-medium">Максимум заказов:</span>
                    {editingMaxOrders ? (
                      <div className="flex items-center mt-1">
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={maxOrdersValue}
                          onChange={(e) => setMaxOrdersValue(parseInt(e.target.value) || 10)}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded mr-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                          autoFocus
                        />
                        <button
                          onClick={() => updateMaxOrders(selectedSupport.id, maxOrdersValue)}
                          className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 mr-1"
                        >
                          OK
                        </button>
                        <button
                          onClick={() => {
                            setEditingMaxOrders(false);
                            setMaxOrdersValue(selectedSupport.active_limit || 10);
                          }}
                          className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
                        >
                          X
                        </button>
                      </div>
                    ) : (
                      <span 
                        className="ml-2 cursor-pointer text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={() => {
                          setMaxOrdersValue(selectedSupport.active_limit || 10);
                          setEditingMaxOrders(true);
                        }}
                      >
                        {selectedSupport.active_limit || 10}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="font-medium">Депозиты:</span>
                    {editingDeposits ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center">
                          <span className="text-xs text-gray-500 mr-2 w-24">Депозит</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={depositValues.deposit}
                            onChange={(e) => setDepositValues(prev => ({ ...prev, deposit: parseFloat(e.target.value) || 0 }))}
                            className="w-24 px-2 py-1 text-xs border border-gray-300 rounded"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center mt-1">
                          <button
                            onClick={() => updateDeposit(selectedSupport.id, depositValues)}
                            className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 mr-1"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => {
                              setEditingDeposits(false);
                              setDepositValues({ deposit: parseFloat(selectedSupport.deposit) || 0 });
                            }}
                            className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
                          >
                            X
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="ml-2">
                        <div className="text-blue-600 dark:text-blue-400">Депозит: {parseFloat(selectedSupport.deposit || 0).toFixed(4)} USDT</div>
                        <div className="text-green-600 dark:text-green-400">Заморожено: {parseFloat(selectedSupport.deposit_work || 0).toFixed(4)} USDT</div>
                        <button
                          onClick={() => setEditingDeposits(true)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                          title="Нажмите для редактирования"
                        >
                          Редактировать
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {selectedSupport?.id && !showSupportModal && (
              <div className="mt-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Погашение USDT-долга оператора</h4>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Открытый долг: <b>{Number(selectedSupportDebt?.usdt_open_total || 0).toFixed(4)} USDT</b>
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  
                </p>
                <div className="flex flex-col md:flex-row gap-2 mb-3">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={debtIntentAmount}
                    onChange={(e) => setDebtIntentAmount(e.target.value)}
                    placeholder="Сумма USDT"
                    className="w-full md:w-56 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleCreateSupportDebtIntent}
                    disabled={debtSubmittingIntent}
                    className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {debtSubmittingIntent ? 'Подготовка...' : 'Показать реквизиты'}
                  </button>
                  <button
                    onClick={handleWriteOffSupportDebt}
                    disabled={debtWriteOffLoading}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {debtWriteOffLoading ? 'Списание...' : 'Списать без оплаты'}
                  </button>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  Оставьте сумму пустой, чтобы списать весь открытый долг оператора.
                </div>
                {debtCurrentIntent && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-700 bg-white/80 dark:bg-gray-900/50 p-3 text-sm">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="w-36 h-36 rounded-lg overflow-hidden bg-white border border-blue-100 flex items-center justify-center">
                        {debtCurrentIntent.qr_url ? (
                          <img
                            src={debtCurrentIntent.qr_url}
                            alt="QR оплаты USDT"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-gray-500">QR недоступен</span>
                        )}
                      </div>
                      <div className="space-y-1 text-gray-800 dark:text-gray-200">
                        <div><b>Intent #{debtCurrentIntent.id}</b></div>
                        <div>Точная сумма: <b>{Number(debtCurrentIntent.exact_usdt).toFixed(4)} USDT</b></div>
                        <div className="break-all">Адрес: <b>{debtCurrentIntent.company_wallet}</b></div>
                        <div>Действует до: <b>{new Date(debtCurrentIntent.expires_at).toLocaleString('ru-RU')}</b></div>
                        <div>
                          Статус:{' '}
                          <b>
                            {debtCurrentPayment?.status === 'CONFIRMED'
                              ? 'Оплачен и подтвержден'
                              : debtCurrentPayment?.status === 'PENDING'
                                ? 'Платеж найден, ожидаем подтверждения'
                                : String(debtCurrentIntent.status || '').toUpperCase() === 'EXPIRED'
                                  ? 'стек'
                                  : 'Ожидаем платеж'}
                          </b>
                        </div>
                        {debtCurrentPayment?.tx_hash && (
                          <div className="break-all">
                            Tx: <span className="font-mono">{debtCurrentPayment.tx_hash}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedSupport.recent_reviews && selectedSupport.recent_reviews.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Последние отзывы</h4>
                <div className="space-y-2">
                  {selectedSupport.recent_reviews.slice(0, 5).map((review) => (
                    <div key={review.id} className="bg-gray-50 p-3 rounded">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex text-yellow-400">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <svg
                              key={star}
                              className={`h-4 w-4 ${star <= review.rating ? 'text-yellow-400' : 'text-gray-300'}`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(review.created_at).toLocaleDateString('ru-RU')}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="text-sm text-gray-700">{review.comment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};
export default SupportsPage;

