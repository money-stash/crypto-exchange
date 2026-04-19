import React, { useState, useEffect, useCallback, useRef } from 'react';
import { financeApi, shiftsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, Download, Calendar, Users, Zap, RefreshCw, Clock, Pencil, Check, X } from 'lucide-react';
import { toast } from 'react-toastify';
import LoadingSpinner from '../components/LoadingSpinner';
import ResponsiveTable from '../components/ResponsiveTable';
import PageTransition from '../components/PageTransition';

const PERIODS = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

const TABS = [
  { key: 'all', label: 'Все', icon: TrendingUp },
  { key: 'manual', label: 'Операторы', icon: Users },
  { key: 'card', label: 'Автоматика', icon: Zap },
];

function StatCard({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-800/10 border-blue-200/50 dark:border-blue-700/30 text-blue-600 dark:text-blue-400',
    green: 'from-green-50 to-green-100/50 dark:from-green-900/20 dark:to-green-800/10 border-green-200/50 dark:border-green-700/30 text-green-600 dark:text-green-400',
    purple: 'from-purple-50 to-purple-100/50 dark:from-purple-900/20 dark:to-purple-800/10 border-purple-200/50 dark:border-purple-700/30 text-purple-600 dark:text-purple-400',
    amber: 'from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-800/10 border-amber-200/50 dark:border-amber-700/30 text-amber-600 dark:text-amber-400',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-4`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color].split(' ').slice(-2).join(' ')}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function FinancePage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPERADMIN';

  const [period, setPeriod] = useState('day');
  const [tab, setTab] = useState('all');
  const [stats, setStats] = useState(null);
  const [monthlySummaries, setMonthlySummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [editingPenalty, setEditingPenalty] = useState(null); // { shiftId, value }
  const penaltyInputRef = useRef(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = { period, operator_type: tab === 'all' ? undefined : tab };
      const [statsRes, monthlyRes, shiftsRes] = await Promise.all([
        financeApi.getStats(params),
        isSuperAdmin ? financeApi.getMonthlySummaries(6) : Promise.resolve({ data: [] }),
        isSuperAdmin ? shiftsApi.getShifts({ limit: 30 }) : Promise.resolve({ data: [] }),
      ]);
      setStats(statsRes.data);
      setMonthlySummaries(monthlyRes.data || []);
      setShifts(shiftsRes.data || []);
    } catch (err) {
      console.error('Finance stats error:', err);
    } finally {
      setLoading(false);
    }
  }, [period, tab, isSuperAdmin]);

  const handlePenaltyEdit = (shift) => {
    setEditingPenalty({ shiftId: shift.id, value: String(shift.early_close_penalty ?? 0) });
    setTimeout(() => penaltyInputRef.current?.focus(), 50);
  };

  const handlePenaltySave = async () => {
    if (!editingPenalty) return;
    const val = parseFloat(editingPenalty.value);
    if (isNaN(val) || val < 0) {
      toast.error('Некорректное значение штрафа');
      return;
    }
    try {
      await shiftsApi.updatePenalty(editingPenalty.shiftId, val);
      toast.success('Штраф обновлён');
      setEditingPenalty(null);
      fetchStats();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Ошибка обновления штрафа');
    }
  };

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const res = await financeApi.export({ period, operator_type: tab });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance_${period}_${tab}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExportLoading(false);
    }
  };

  // Колонки таблицы "По операторам"
  const operatorColumns = [
    { header: 'Оператор', key: 'login', render: (r) => <span className="font-semibold text-gray-800 dark:text-gray-200">{r.login || '—'}</span> },
    { header: 'Тип', key: 'operator_type', render: (r) => (
      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
        r.operator_type === 'card' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
        : r.operator_type === 'auto' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      }`}>
        {r.operator_type === 'card' ? 'Карта' : r.operator_type === 'auto' ? 'Авто' : 'Ручной'}
      </span>
    )},
    { header: 'Заявок', key: 'orders_count', render: (r) => <span className="font-mono">{r.orders_count}</span> },
    { header: 'Объём', key: 'volume_rub', render: (r) => <span className="font-mono text-gray-700 dark:text-gray-300">{fmt(r.volume_rub, 0)} ₽</span> },
    { header: 'Прибыль', key: 'profit_rub', render: (r) => (
      <span className={`font-mono font-semibold ${Number(r.profit_rub) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
        {Number(r.profit_rub) >= 0 ? '+' : ''}{fmt(r.profit_rub)} ₽
      </span>
    )},
    { header: 'Смен', key: 'shifts_count', render: (r) => <span className="font-mono text-gray-500">{r.shifts_count}</span> },
  ];

  // Колонки таблицы "Итоги по месяцам"
  const monthlyColumns = [
    { header: 'Месяц', key: 'period', render: (r) => {
      const d = new Date(r.period + 'T00:00:00');
      return <span className="font-semibold">{d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</span>;
    }},
    { header: 'Заявок', key: 'orders_count', render: (r) => <span className="font-mono">{r.orders_count}</span> },
    { header: 'Объём', key: 'volume_rub', render: (r) => <span className="font-mono text-gray-700 dark:text-gray-300">{fmt(r.volume_rub, 0)} ₽</span> },
    { header: 'Прибыль', key: 'profit_rub', render: (r) => (
      <span className={`font-mono font-semibold ${Number(r.profit_rub) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
        {Number(r.profit_rub) >= 0 ? '+' : ''}{fmt(r.profit_rub)} ₽
      </span>
    )},
    { header: 'Операторов', key: 'operators_count', render: (r) => <span className="font-mono text-gray-500">{r.operators_count}</span> },
  ];

  const totals = stats?.totals || {};
  const chartData = (stats?.chart || []).map(row => ({
    date: row.date ? new Date(row.date + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '',
    profit: Number(row.profit_rub || 0),
    volume: Number(row.volume_rub || 0),
    orders: Number(row.orders_count || 0),
  }));

  return (
    <PageTransition>
      <div className="space-y-5 pb-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Финансы
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Прибыль, объёмы, статистика по операторам</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {isSuperAdmin && (
              <button
                onClick={handleExport}
                disabled={exportLoading}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {exportLoading ? 'Экспорт...' : 'Excel'}
              </button>
            )}
          </div>
        </div>

        {/* Фильтры */}
        <div className="flex flex-wrap gap-2">
          {/* Период */}
          <div className="flex bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  period === p.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Тип оператора */}
          <div className="flex bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : (
          <>
            {/* Карточки-итоги */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Заявок" value={totals.orders_count || 0} color="blue" />
              <StatCard label="Объём" value={`${fmt(totals.volume_rub, 0)} ₽`} color="purple" />
              <StatCard
                label="Прибыль"
                value={`${Number(totals.profit_rub || 0) >= 0 ? '+' : ''}${fmt(totals.profit_rub)} ₽`}
                color="green"
              />
              <StatCard label="Ср. прибыль/сделка" value={`${fmt(totals.avg_profit_rub)} ₽`} color="amber" />
            </div>

            {/* График */}
            {chartData.length > 0 && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">График прибыли</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={60}
                      tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <Tooltip
                      contentStyle={{ background: 'var(--tooltip-bg, #fff)', border: '1px solid #e5e7eb', borderRadius: 12, fontSize: 12 }}
                      formatter={(val, name) => [
                        `${Number(val).toLocaleString('ru-RU')} ₽`,
                        name === 'profit' ? 'Прибыль' : 'Объём'
                      ]}
                    />
                    <Bar dataKey="profit" fill="#22c55e" radius={[4, 4, 0, 0]} name="profit" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Таблица по операторам */}
            {stats?.by_operator?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">По операторам</h3>
                <ResponsiveTable
                  compact
                  columns={operatorColumns}
                  data={stats.by_operator}
                  emptyMessage="Нет данных"
                />
              </div>
            )}

            {/* Итоги по месяцам */}
            {isSuperAdmin && monthlySummaries.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Итоги по месяцам
                </h3>
                <ResponsiveTable
                  compact
                  columns={monthlyColumns}
                  data={monthlySummaries}
                  emptyMessage="Нет данных"
                />
              </div>
            )}

            {/* Смены (суперадмин) */}
            {isSuperAdmin && shifts.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Последние смены
                </h3>
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                        {['Оператор', 'Начало', 'Статус', 'Отработано', 'Заявок', 'Прибыль', 'Штраф'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {shifts.map(shift => {
                        const isEditing = editingPenalty?.shiftId === shift.id;
                        const dur = shift.actual_duration_min ?? shift.duration_min ?? 0;
                        const h = Math.floor(dur / 60), m = dur % 60;
                        const durStr = h > 0 ? `${h}ч ${m}м` : `${m}м`;
                        const startDate = shift.started_at
                          ? new Date(shift.started_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '—';
                        return (
                          <tr key={shift.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                              {shift.operator_login || '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{startDate}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                shift.status === 'active'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                              }`}>
                                {shift.status === 'active' ? 'Активна' : 'Закрыта'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{durStr}</td>
                            <td className="px-3 py-2 font-mono text-center">{shift.orders_completed ?? 0}</td>
                            <td className="px-3 py-2 font-mono text-green-600 dark:text-green-400 whitespace-nowrap">
                              {Number(shift.total_profit_rub || 0) > 0 ? '+' : ''}{fmt(shift.total_profit_rub)} ₽
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    ref={penaltyInputRef}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editingPenalty.value}
                                    onChange={e => setEditingPenalty(p => ({ ...p, value: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') handlePenaltySave(); if (e.key === 'Escape') setEditingPenalty(null); }}
                                    className="w-24 px-2 py-1 text-xs border border-blue-400 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                  <button onClick={handlePenaltySave} className="p-1 text-green-600 hover:text-green-700">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setEditingPenalty(null)} className="p-1 text-gray-400 hover:text-gray-600">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-mono font-semibold whitespace-nowrap ${
                                    Number(shift.early_close_penalty || 0) > 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-gray-400 dark:text-gray-600'
                                  }`}>
                                    {Number(shift.early_close_penalty || 0) > 0
                                      ? `-${fmt(shift.early_close_penalty)} ₽`
                                      : '—'}
                                  </span>
                                  {shift.status !== 'active' && (
                                    <button
                                      onClick={() => handlePenaltyEdit(shift)}
                                      className="p-0.5 text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-colors"
                                      title="Изменить штраф"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageTransition>
  );
}
