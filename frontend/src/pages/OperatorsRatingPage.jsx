import React, { useState, useEffect, useCallback } from 'react';
import { supportsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import PageTransition from '../components/PageTransition';
import { toast } from 'react-toastify';
import {
  Trophy, Star, Zap, Users, TrendingUp, Crown, Medal,
  ChevronDown, ChevronUp, Clock, ArrowUpDown, CheckCircle, XCircle,
  AlertCircle, Calendar, BarChart2, X, ChevronLeft, ChevronRight,
} from 'lucide-react';

const fmt = {
  seconds: (s) => {
    if (s == null) return '—';
    if (s < 60) return `${s}с`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}м ${sec}с` : `${m}м`;
  },
  rub: (v) => {
    if (!v) return '0 ₽';
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
  },
  date: (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  },
  datetime: (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  },
};

const STATUS_MAP = {
  COMPLETED:        { label: 'Завершён',         color: 'text-green-600 dark:text-green-400',  icon: CheckCircle },
  CANCELLED:        { label: 'Отменён',           color: 'text-red-500 dark:text-red-400',      icon: XCircle },
  PAYMENT_PENDING:  { label: 'Ожидает оплаты',   color: 'text-yellow-600 dark:text-yellow-400', icon: AlertCircle },
  AWAITING_CONFIRM: { label: 'Подтверждение',    color: 'text-blue-500 dark:text-blue-400',    icon: AlertCircle },
  AWAITING_HASH:    { label: 'Ожидает хэш',      color: 'text-purple-500 dark:text-purple-400', icon: AlertCircle },
  QUEUED:           { label: 'В очереди',         color: 'text-gray-500 dark:text-gray-400',    icon: AlertCircle },
  CREATED:          { label: 'Создана',           color: 'text-gray-500 dark:text-gray-400',    icon: AlertCircle },
};

const getRankIcon = (position) => {
  if (position === 1) return <Crown className="w-5 h-5" style={{ color: '#FFD700' }} />;
  if (position === 2) return <Medal className="w-5 h-5" style={{ color: '#C0C0C0' }} />;
  if (position === 3) return <Medal className="w-5 h-5" style={{ color: '#CD7F32' }} />;
  return <span className="text-sm font-bold text-gray-500 dark:text-gray-400">#{position}</span>;
};

const StatChip = ({ icon: Icon, label, value, color = 'text-gray-600 dark:text-gray-400' }) => (
  <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${color}`} />
    <span className="font-medium text-gray-800 dark:text-gray-200">{value}</span>
    <span>{label}</span>
  </span>
);

const OperatorRow = ({ operator, position, onExpand }) => {
  return (
    <button
      onClick={() => onExpand(operator)}
      className="w-full text-left group flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/60 hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors"
    >
      {/* позиция */}
      <div className="flex-shrink-0 w-8 flex justify-center">
        {getRankIcon(position)}
      </div>

      {/* имя */}
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate block">
          {operator.username}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {fmt.date(operator.created_at)}
        </span>
      </div>

      {/* статистика */}
      <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
        <StatChip icon={ArrowUpDown} label="обменов" value={operator.completed_count ?? operator.orders_count ?? 0} color="text-blue-500" />
        <StatChip icon={BarChart2} label="" value={fmt.rub(operator.total_volume_rub)} color="text-green-500" />
        <StatChip icon={Clock} label="выдача" value={fmt.seconds(operator.avg_setup_seconds != null ? Math.round(operator.avg_setup_seconds) : null)} color="text-orange-400" />
        <StatChip icon={Zap} label="закрытие" value={fmt.seconds(operator.avg_close_seconds != null ? Math.round(operator.avg_close_seconds) : null)} color="text-purple-400" />
      </div>

      {/* рейтинг */}
      <div className="flex-shrink-0 flex items-center gap-1">
        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {(operator.rating?.overall_rating ?? 0).toFixed(1)}
        </span>
      </div>

      <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
    </button>
  );
};

const fmtUsdt = (v) => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toLocalDate = (d) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD без timezone-сдвига

const OrdersModal = ({ operator, onClose }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);

  // По умолчанию — текущий месяц
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(toLocalDate(firstOfMonth));
  const [dateTo, setDateTo]     = useState(toLocalDate(today));

  const fetchOrders = useCallback(async (p, from, to) => {
    try {
      setLoading(true);
      const res = await supportsApi.getOperatorOrders(operator.id, {
        page: p, limit: 30,
        date_from: from || undefined,
        date_to:   to   || undefined,
      });
      setOrders(res.data.orders || []);
      setTotalPages(res.data.pages || 1);
      setTotal(res.data.total || 0);
      setStats(res.data.stats || null);
    } catch {
      toast.error('Ошибка при загрузке сделок');
    } finally {
      setLoading(false);
    }
  }, [operator.id]);

  // Перезагрузка при смене дат — сброс на стр.1
  useEffect(() => {
    setPage(1);
    fetchOrders(1, dateFrom, dateTo);
  }, [dateFrom, dateTo, fetchOrders]);

  // Перелистывание страниц
  useEffect(() => {
    fetchOrders(page, dateFrom, dateTo);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 w-full max-w-5xl max-h-[90vh] flex flex-col">

        {/* шапка */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200/50 dark:border-gray-700/50 flex-shrink-0 gap-4">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">{operator.username}</h3>

            {/* статы */}
            <div className="flex flex-wrap gap-3 mt-2">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Объём (всего)</span>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                  {fmt.rub(stats?.total_volume_rub ?? operator.total_volume_rub)}
                </span>
              </div>
              <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Объём за период</span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {fmt.rub(stats?.period_volume_rub ?? 0)}
                </span>
              </div>
              <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">ЧП за период</span>
                <span className={`text-sm font-bold ${Number(stats?.period_profit_usdt ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                  {fmtUsdt(stats?.period_profit_usdt)}
                </span>
              </div>
              <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Завершённых</span>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{total}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* диапазон дат */}
            <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-1.5">
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={e => setDateFrom(e.target.value)}
                className="text-xs bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => setDateTo(e.target.value)}
                className="text-xs bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer"
              />
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* таблица */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Сделок нет за период</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b border-gray-200/50 dark:border-gray-700/50">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Дата</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Направление</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Сумма</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Курс</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Закрытие</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Прибыль</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.id} className={`border-b border-gray-100 dark:border-gray-800 ${i % 2 === 0 ? '' : 'bg-gray-50/40 dark:bg-gray-800/30'}`}>
                    <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmt.datetime(o.completed_at || o.created_at)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`text-xs font-semibold ${o.dir === 'BUY' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
                        {o.dir === 'BUY' ? '↑ RUB→' : '↓ →RUB'} {o.coin}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap text-xs">
                      {fmt.rub(o.sum_rub)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {o.rate_rub > 0 ? Number(o.rate_rub).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                    <td className="px-4 py-2 text-center whitespace-nowrap">
                      {o.close_seconds != null ? (
                        <span className={`text-xs font-medium ${
                          o.close_seconds > 1800 ? 'text-red-500' :
                          o.close_seconds > 600  ? 'text-yellow-500' :
                          'text-green-500'
                        }`}>
                          {fmt.seconds(o.close_seconds)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {o.profit_usdt != null ? (
                        <span className={`text-xs font-bold ${Number(o.profit_usdt) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                          {Number(o.profit_usdt) >= 0 ? '+' : ''}{fmtUsdt(o.profit_usdt)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* пагинация */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200/50 dark:border-gray-700/50 flex-shrink-0">
            <span className="text-xs text-gray-500">Стр. {page} из {totalPages}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const OperatorsRatingPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [operatorsRating, setOperatorsRating] = useState([]);
  const [myRating, setMyRating] = useState(null);
  const [selectedOperator, setSelectedOperator] = useState(null);

  useEffect(() => {
    fetchRating();
  }, []);

  const fetchRating = async () => {
    try {
      setLoading(true);
      const response = await supportsApi.getOperatorsRating();
      if (response.data) {
        setOperatorsRating(response.data.top || []);
        setMyRating(response.data.current || null);
      }
    } catch {
      toast.error('Ошибка при загрузке рейтинга операторов');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="space-y-4">
        {/* заголовок */}
        <div className="flex items-center gap-3 px-1">
          <div className="p-2 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl shadow">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Топ операторов</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Нажмите на оператора, чтобы посмотреть его сделки</p>
          </div>
        </div>

        {/* карточка текущего оператора */}
        {user?.role === 'OPERATOR' && myRating && (
          <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-blue-200/60 dark:border-blue-800/40 shadow px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Ваш рейтинг</span>
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Позиция #{myRating.position ?? '—'}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <StatChip icon={Star} label="рейтинг" value={(myRating.rating?.overall_rating ?? 0).toFixed(1)} color="text-yellow-500" />
              <StatChip icon={ArrowUpDown} label="обменов" value={myRating.completed_count ?? 0} color="text-blue-500" />
              <StatChip icon={BarChart2} label="" value={fmt.rub(myRating.total_volume_rub)} color="text-green-500" />
              <StatChip icon={Clock} label="ср. выдача" value={fmt.seconds(myRating.avg_setup_seconds != null ? Math.round(myRating.avg_setup_seconds) : null)} color="text-orange-400" />
              <StatChip icon={Zap} label="ср. закрытие" value={fmt.seconds(myRating.avg_close_seconds != null ? Math.round(myRating.avg_close_seconds) : null)} color="text-purple-400" />
            </div>
          </div>
        )}

        {/* легенда колонок */}
        <div className="hidden sm:flex items-center gap-3 px-3 text-[11px] text-gray-400 dark:text-gray-500">
          <div className="w-8" />
          <div className="flex-1">Оператор</div>
          <div className="flex items-center gap-4 flex-shrink-0 pr-[72px]">
            <span className="w-20 text-center">Обменов</span>
            <span className="w-24 text-center">Объём</span>
            <span className="w-24 text-center">Выдача реквизита</span>
            <span className="w-24 text-center">Закрытие заявки</span>
          </div>
          <span className="w-10 text-center">Рейтинг</span>
        </div>

        {/* список */}
        <div className="space-y-1.5">
          {loading
            ? [...Array(10)].map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-gray-200 dark:bg-gray-800 animate-pulse" />
              ))
            : operatorsRating.length === 0
              ? (
                <div className="text-center py-10 text-gray-400">
                  <Trophy className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Нет данных</p>
                </div>
              )
              : operatorsRating.map((op, i) => (
                  <OperatorRow
                    key={op.id}
                    operator={op}
                    position={i + 1}
                    onExpand={setSelectedOperator}
                  />
                ))
          }
        </div>
      </div>

      {selectedOperator && (
        <OrdersModal operator={selectedOperator} onClose={() => setSelectedOperator(null)} />
      )}
    </PageTransition>
  );
};

export default OperatorsRatingPage;
