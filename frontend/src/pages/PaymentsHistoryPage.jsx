import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, Filter, Wallet } from 'lucide-react';
import { toast } from 'react-toastify';
import { supportsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import PageTransition from '../components/PageTransition';
import ResponsiveTable from '../components/ResponsiveTable';
import Pagination from '../components/Pagination';
import CustomSelect from '../components/CustomSelect';

const PaymentsHistoryPage = () => {
  const { user } = useAuth();
  const roleUpper = String(user?.role || '').toUpperCase();
  const canViewHistory = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes(roleUpper);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [operatorDebt, setOperatorDebt] = useState(null);
  const [intentAmount, setIntentAmount] = useState('');
  const [currentIntent, setCurrentIntent] = useState(null);
  const [currentIntentPayment, setCurrentIntentPayment] = useState(null);
  const [submittingIntent, setSubmittingIntent] = useState(false);
  const intentNotificationsRef = useRef(new Set());
  const [history, setHistory] = useState([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    q: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });

  const formatUsdt = useCallback((value) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(4)} USDT` : '—';
  }, []);

  const formatDateTime = useCallback((value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU');
  }, []);

  const getStatusLabel = useCallback((status) => {
    const normalized = String(status || '').toUpperCase();
    const labels = {
      WAITING_PAYMENT: 'Ожидает оплаты',
      EXPIRED: 'Истек',
      CANCELLED: 'Отменен',
      PENDING: 'Ожидает подтверждений',
      CONFIRMED: 'Подтвержден',
      REJECTED: 'Отклонен'
    };
    return labels[normalized] || (status || '—');
  }, []);

  const getStatusBadge = useCallback((status) => {
    const normalized = String(status || '').toUpperCase();
    const labels = {
      WAITING_PAYMENT: 'Ожидает оплаты',
      EXPIRED: 'Истек',
      CANCELLED: 'Отменен',
      PENDING: 'Ожидает подтверждений',
      CONFIRMED: 'Подтвержден',
      REJECTED: 'Отклонен'
    };

    const styles = {
      WAITING_PAYMENT: 'bg-gradient-to-r from-amber-100 via-amber-200 to-amber-100 dark:from-amber-900/40 dark:via-amber-800/40 dark:to-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300/30 dark:border-amber-600/30',
      PENDING: 'bg-gradient-to-r from-orange-100 via-orange-200 to-orange-100 dark:from-orange-900/40 dark:via-orange-800/40 dark:to-orange-900/40 text-orange-800 dark:text-orange-300 border border-orange-300/30 dark:border-orange-600/30',
      CONFIRMED: 'bg-gradient-to-r from-green-100 via-green-200 to-green-100 dark:from-green-900/40 dark:via-green-800/40 dark:to-green-900/40 text-green-800 dark:text-green-300 border border-green-300/30 dark:border-green-600/30',
      EXPIRED: 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 border border-red-300/30 dark:border-red-600/30',
      CANCELLED: 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 border border-red-300/30 dark:border-red-600/30',
      REJECTED: 'bg-gradient-to-r from-red-100 via-red-200 to-red-100 dark:from-red-900/40 dark:via-red-800/40 dark:to-red-900/40 text-red-800 dark:text-red-300 border border-red-300/30 dark:border-red-600/30'
    };

    const label = labels[normalized] || (status || '—');
    const className = styles[normalized] || 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border border-gray-300/30 dark:border-gray-600/30';

    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${className}`}>
        {label}
      </span>
    );
  }, []);

  const fetchDebtData = useCallback(async () => {
    if (roleUpper !== 'OPERATOR') return;
    try {
      const response = await supportsApi.getMyDebt();
      setOperatorDebt(response?.data || null);
    } catch (error) {
      console.error('Failed to fetch debt data:', error);
    }
  }, [roleUpper]);

  const handleCreateIntent = useCallback(async () => {
    const requested = Number(intentAmount);
    if (!Number.isFinite(requested) || requested <= 0) {
      toast.error('Введите корректную сумму USDT');
      return;
    }

    try {
      setSubmittingIntent(true);
      const response = await supportsApi.createMyDebtIntent(requested);
      setCurrentIntent(response?.data || null);
      setCurrentIntentPayment(null);
      toast.success('Реквизиты для погашения подготовлены. Переведите точную сумму.');
      await fetchDebtData();
    } catch (error) {
      console.error('Create intent error:', error);
      toast.error(error?.response?.data?.error || 'Не удалось создать платеж');
    } finally {
      setSubmittingIntent(false);
    }
  }, [intentAmount, fetchDebtData]);

  const loadHistory = useCallback(async (showSpinner = true) => {
    if (!canViewHistory) return;

    try {
      if (showSpinner) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const params = { limit: 500 };
      const response = roleUpper === 'OPERATOR'
        ? await supportsApi.getMyDebtPayments(params)
        : await supportsApi.getDebtPaymentsHistory(params);

      const rows = Array.isArray(response?.data) ? response.data : [];
      setHistory(rows);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch payment history:', error);
      toast.error('Ошибка при загрузке истории платежей');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canViewHistory, roleUpper]);

  useEffect(() => {
    loadHistory(true);
  }, [loadHistory]);

  useEffect(() => {
    if (roleUpper !== 'OPERATOR') return;
    fetchDebtData();
  }, [fetchDebtData, roleUpper]);

  useEffect(() => {
    if (roleUpper !== 'OPERATOR') return;
    if (!currentIntent?.id) return;

    let isDisposed = false;

    const pollIntentStatus = async () => {
      try {
        const response = await supportsApi.getMyDebtIntentStatus(currentIntent.id);
        if (isDisposed) return;

        const intent = response?.data?.intent || null;
        const payment = response?.data?.payment || null;

        if (intent) {
          setCurrentIntent(intent);
        }
        setCurrentIntentPayment(payment);

        const intentStatus = String(intent?.status || '').toUpperCase();
        const paymentStatus = String(payment?.status || '').toUpperCase();
        const toastKey = `${currentIntent.id}:${intentStatus}:${paymentStatus}`;

        if (paymentStatus === 'CONFIRMED' && !intentNotificationsRef.current.has(toastKey)) {
          intentNotificationsRef.current.add(toastKey);
          toast.success('Платеж найден и подтвержден. Долг пересчитан.');
          await fetchDebtData();
          await loadHistory(false);
        }

        if (paymentStatus === 'PENDING' && !intentNotificationsRef.current.has(toastKey)) {
          intentNotificationsRef.current.add(toastKey);
          toast.info('Платеж найден, ожидаем подтверждения сети.');
        }

        if (intentStatus === 'EXPIRED' && !payment && !intentNotificationsRef.current.has(toastKey)) {
          intentNotificationsRef.current.add(toastKey);
          toast.warning('Срок действия реквизитов истек. Создайте новый платеж.');
        }
      } catch (error) {
        if (!isDisposed) {
          console.error('Intent status polling failed:', error);
        }
      }
    };

    pollIntentStatus();
    const intervalId = setInterval(pollIntentStatus, 8000);

    return () => {
      isDisposed = true;
      clearInterval(intervalId);
    };
  }, [currentIntent?.id, fetchDebtData, loadHistory, roleUpper]);

  const filteredHistory = useMemo(() => {
    const query = String(filters.q || '').trim().toLowerCase();
    const statusFilter = String(filters.status || '').toUpperCase();

    return history.filter((entry) => {
      const historyStatus = String(entry.history_status || '').toUpperCase();
      if (statusFilter && historyStatus !== statusFilter) {
        return false;
      }

      if (!query) return true;

      const searchHaystack = [
        entry.tx_hash,
        entry.support_login,
        entry.support_name,
        entry.support_id,
        entry.history_id,
        entry.intent_id,
        entry.to_address,
        entry.company_wallet,
        getStatusLabel(historyStatus)
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');

      return searchHaystack.includes(query);
    });
  }, [history, filters, getStatusLabel]);

  useEffect(() => {
    setPagination((prev) => {
      const total = filteredHistory.length;
      const pages = Math.max(1, Math.ceil(total / prev.limit));
      const page = Math.min(prev.page, pages);
      return { ...prev, total, pages, page };
    });
  }, [filteredHistory]);

  const pagedHistory = useMemo(() => {
    const from = (pagination.page - 1) * pagination.limit;
    return filteredHistory.slice(from, from + pagination.limit);
  }, [filteredHistory, pagination.page, pagination.limit]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const columns = [
    {
      header: 'Запись',
      key: 'history_id',
      width: '130px',
      render: (row) => (
        <span className="inline-flex items-center px-2 py-1 rounded-lg font-mono text-xs font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800">
          {row.history_type === 'INTENT' ? `Intent #${row.intent_id}` : `#${row.history_id}`}
        </span>
      )
    },
    roleUpper !== 'OPERATOR' && {
      header: 'Оператор',
      key: 'support_login',
      width: '160px',
      render: (row) => (
        <span className="font-medium text-gray-800 dark:text-gray-200">
          {row.support_login || row.support_name || `ID ${row.support_id}`}
        </span>
      )
    },
    {
      header: 'Статус',
      key: 'history_status',
      width: '190px',
      render: (row) => getStatusBadge(row.history_status)
    },
    {
      header: 'Суммы',
      key: 'amounts',
      render: (row) => (
        <div className="space-y-0.5 whitespace-normal">
          <div><span className="text-gray-500 dark:text-gray-400">Запрошено:</span> {formatUsdt(row.requested_usdt)}</div>
          <div><span className="text-gray-500 dark:text-gray-400">Точная:</span> {formatUsdt(row.exact_usdt)}</div>
          <div><span className="text-gray-500 dark:text-gray-400">Факт:</span> {formatUsdt(row.actual_amount_usdt)}</div>
        </div>
      )
    },
    {
      header: 'Tx / Адрес',
      key: 'tx_hash',
      render: (row) => (
        <div className="space-y-0.5 max-w-[300px] whitespace-normal">
          <div className="break-all"><span className="text-gray-500 dark:text-gray-400">Tx:</span> {row.tx_hash || '—'}</div>
          <div className="break-all"><span className="text-gray-500 dark:text-gray-400">Куда:</span> {row.to_address || row.company_wallet || '—'}</div>
          <div><span className="text-gray-500 dark:text-gray-400">Подтверждений:</span> {row.confirmations ?? '—'}</div>
        </div>
      )
    },
    {
      header: 'Время',
      key: 'created_at',
      width: '230px',
      render: (row) => (
        <div className="space-y-0.5 whitespace-normal">
          <div><span className="text-gray-500 dark:text-gray-400">Создано:</span> {formatDateTime(row.created_at)}</div>
          <div><span className="text-gray-500 dark:text-gray-400">До:</span> {formatDateTime(row.expires_at)}</div>
          <div><span className="text-gray-500 dark:text-gray-400">Подтверждено:</span> {formatDateTime(row.confirmed_at)}</div>
        </div>
      )
    }
  ].filter(Boolean);

  if (!canViewHistory) {
    return (
      <PageTransition>
        <div className="p-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-red-600 dark:text-red-400">Доступ запрещен</div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-4">
        <div className="relative overflow-hidden bg-gradient-to-r from-white via-blue-50/50 to-indigo-50/50 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 rounded-xl lg:rounded-2xl shadow-xl border border-blue-200/50 dark:border-blue-700/50">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-indigo-500/5 to-purple-500/5 dark:from-blue-400/10 dark:via-indigo-400/10 dark:to-purple-400/10" />
          <div className="relative p-4 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/30">
                    <Wallet className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                    Погашение долга
                  </h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      Обновлено: {lastUpdate.toLocaleTimeString('ru-RU')}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  loadHistory(false);
                  if (roleUpper === 'OPERATOR') {
                    fetchDebtData();
                  }
                }}
                disabled={refreshing}
                className="group relative px-5 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 hover:from-blue-600 hover:via-indigo-700 hover:to-purple-700 text-white shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95 overflow-hidden disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                <span className="relative z-10 flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  Обновить
                </span>
              </button>
            </div>
          </div>
        </div>

        {roleUpper === 'OPERATOR' && (
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-md rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Погашение USDT-долга</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Открытый долг: <b>{Number(operatorDebt?.usdt_open_total || 0).toFixed(4)} USDT</b>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="number"
                min="0"
                step="0.0001"
                value={intentAmount}
                onChange={(e) => setIntentAmount(e.target.value)}
                placeholder="Сумма USDT"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              />
              <button
                onClick={handleCreateIntent}
                disabled={submittingIntent}
                className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {submittingIntent ? 'Подготовка...' : 'Погасить'}
              </button>
            </div>

            {currentIntent && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-3 text-sm text-blue-900 dark:text-blue-200">
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <div className="w-40 h-40 rounded-lg overflow-hidden bg-white flex items-center justify-center border border-blue-200">
                    {currentIntent.qr_url ? (
                      <img
                        src={currentIntent.qr_url}
                        alt="QR для оплаты USDT"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-gray-500">QR недоступен</span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div><b>Заявка на погашение #{currentIntent.id}</b></div>
                    <div>
                      Точная сумма: <b>{Number(currentIntent.exact_usdt).toFixed(4)} USDT</b>
                    </div>
                    <div className="break-all">
                      Адрес: <b>{currentIntent.company_wallet}</b>
                    </div>
                    <div>
                      Действует до: <b>{new Date(currentIntent.expires_at).toLocaleString('ru-RU')}</b>
                    </div>
                    <div>
                      Статус:{' '}
                      <b>
                        {currentIntentPayment?.status === 'CONFIRMED'
                          ? 'Оплачен и подтвержден'
                          : currentIntentPayment?.status === 'PENDING'
                            ? 'Платеж найден, ожидаем подтверждения'
                            : String(currentIntent.status || '').toUpperCase() === 'EXPIRED'
                              ? 'Истек'
                              : 'Ожидаем платеж'}
                      </b>
                    </div>
                    {currentIntentPayment?.tx_hash && (
                      <div className="break-all">
                        Tx: <span className="font-mono">{currentIntentPayment.tx_hash}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50/30 to-white dark:from-gray-800 dark:via-blue-950/20 dark:to-gray-800 rounded-xl lg:rounded-2xl shadow-lg border border-blue-200/50 dark:border-blue-700/50">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-purple-500/5 dark:from-blue-500/10 dark:via-indigo-500/10 dark:to-purple-500/10" />
          <div className="relative p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-lg">
                  <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
                  Фильтры
                </h3>
              </div>
              <button
                onClick={() => setFiltersExpanded(!filtersExpanded)}
                className="xl:hidden p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
              >
                {filtersExpanded ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
            </div>

            <div className={`flex flex-wrap gap-3 sm:gap-4 ${filtersExpanded ? 'flex' : 'hidden xl:flex'}`}>
              <div className="w-full md:w-[calc(50%-0.5rem)] xl:w-[calc(30%-0.8rem)]">
                <CustomSelect
                  value={filters.status}
                  onChange={(value) => handleFilterChange('status', value)}
                  options={[
                    { value: '', label: 'Все статусы' },
                    { value: 'WAITING_PAYMENT', label: 'Ожидает оплаты' },
                    { value: 'PENDING', label: 'Ожидает подтверждений' },
                    { value: 'CONFIRMED', label: 'Подтвержден' },
                    { value: 'EXPIRED', label: 'Истек' },
                    { value: 'CANCELLED', label: 'Отменен' },
                    { value: 'REJECTED', label: 'Отклонен' }
                  ]}
                  icon={Filter}
                  placeholder="Выберите статус"
                />
              </div>

              <div className="relative w-full md:w-[calc(50%-0.5rem)] xl:w-[calc(40%-0.8rem)]">
                <input
                  type="text"
                  placeholder="Tx, оператор, ID..."
                  value={filters.q}
                  onChange={(e) => handleFilterChange('q', e.target.value)}
                  className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium shadow-sm hover:shadow-md"
                />
                <Search className="absolute left-4 bottom-3.5 w-5 h-5 text-gray-400" />
              </div>

              <div className="w-full md:w-[calc(50%-0.5rem)] xl:w-[calc(20%-0.8rem)] flex items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Найдено: <b>{filteredHistory.length}</b>
                </span>
              </div>
            </div>
          </div>
        </div>

        <ResponsiveTable
          columns={columns}
          data={pagedHistory}
          loading={loading}
          emptyMessage="Платежей не найдено"
          rowClassName={(row) => (String(row.history_status || '').toUpperCase() === 'CONFIRMED'
            ? 'bg-green-50/40 dark:bg-green-900/10'
            : '')}
        />

        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.pages}
          totalItems={pagination.total}
          itemsPerPage={pagination.limit}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
        />
      </div>
    </PageTransition>
  );
};

export default PaymentsHistoryPage;
