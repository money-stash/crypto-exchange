import React, { useState, useEffect, useCallback, useRef } from 'react';
import { financeApi, shiftsApi, ratesApi } from '../services/api';
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

function DetailOrdersTable({ period, tab }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    financeApi.getOrdersDetail({ period, operator_type: tab === 'all' ? undefined : tab })
      .then(r => setOrders(r.data.orders || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, tab]);

  const fmtDt = (dt) => dt ? new Date(dt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  if (loading) return <div className="text-sm text-gray-400 py-4">Загрузка...</div>;
  if (!orders.length) return <div className="text-sm text-gray-400 py-4">Нет данных</div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
            {['Дата / Время', 'ID заявки', 'Оператор', 'Поступление (₽)', 'Метод оплаты', 'ЗП оператора (₽)', 'Курс монеты', 'Прибыль (₽)'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {orders.map(o => (
            <tr key={o.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDt(o.completed_at)}</td>
              <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">{o.unique_id || o.id}</td>
              <td className="px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">{o.operator_login || '—'}</td>
              <td className="px-3 py-2 font-mono text-gray-900 dark:text-white">{Number(o.sum_rub || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{o.payment_method || '—'}</td>
              <td className="px-3 py-2 font-mono text-orange-600 dark:text-orange-400">
                {o.operator_salary_rub > 0 ? `-${Number(o.operator_salary_rub).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽` : '—'}
              </td>
              <td className="px-3 py-2 font-mono text-gray-500">
                {o.rate_rub > 0 ? Number(o.rate_rub).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—'}
              </td>
              <td className={`px-3 py-2 font-mono font-semibold ${Number(o.profit_rub) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {Number(o.profit_rub) >= 0 ? '+' : ''}{Number(o.profit_rub || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CryptoPurchasesSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ coin: 'BTC', amount_coin: '', amount_usdt: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [usdtRateRub, setUsdtRateRub] = useState(null);
  const [allRatesRub, setAllRatesRub] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await financeApi.getPurchases({ limit: 50 });
      setItems(r.data.items || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = async () => {
    setShowForm(true);
    try {
      const r = await ratesApi.getRates();
      const rates = r.data || [];
      const usdt = rates.find(x => x.coin === 'USDT');
      const usdtRate = usdt ? parseFloat(usdt.manual_rate_rub || usdt.rate_rub) || null : null;
      setUsdtRateRub(usdtRate);
      const map = {};
      rates.forEach(x => { map[x.coin] = parseFloat(x.manual_rate_rub || x.rate_rub) || null; });
      setAllRatesRub(map);
    } catch {}
  };

  const calcAmountCoin = (amountUsdt, coin) => {
    const coinRate = allRatesRub[coin];
    if (!coinRate || !usdtRateRub || !amountUsdt || parseFloat(amountUsdt) <= 0) return '';
    const coinRateUsdt = coinRate / usdtRateRub;
    return (parseFloat(amountUsdt) / coinRateUsdt).toFixed(8);
  };

  const handleAdd = async () => {
    if (!form.amount_coin || !form.amount_usdt) return toast.error('Заполните все поля');
    setSaving(true);
    try {
      await financeApi.addPurchase({
        coin: form.coin,
        amount_coin: parseFloat(form.amount_coin),
        amount_usdt: parseFloat(form.amount_usdt),
        usdt_rate_rub: usdtRateRub || 0,
        note: form.note || null,
      });
      toast.success('Закупка добавлена');
      setShowForm(false);
      setForm({ coin: 'BTC', amount_coin: '', amount_usdt: '', note: '' });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить запись?')) return;
    try { await financeApi.deletePurchase(id); load(); } catch { toast.error('Ошибка'); }
  };

  const fmtDt = (dt) => dt ? new Date(dt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Закупки крипты</h3>
        <button onClick={openForm}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
          + Добавить
        </button>
      </div>

      {loading ? <div className="text-sm text-gray-400 py-2">Загрузка...</div> : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-2">Закупок нет</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                {['Дата', 'Монета', 'Кол-во', 'Потрачено USDT', 'Курс USDT/₽', 'Курс монеты/₽', 'Стоимость ₽', 'Примечание', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map(p => (
                <tr key={p.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDt(p.created_at)}</td>
                  <td className="px-3 py-2 font-mono font-bold">{p.coin}</td>
                  <td className="px-3 py-2 font-mono">{Number(p.amount_coin).toFixed(8)}</td>
                  <td className="px-3 py-2 font-mono">{Number(p.amount_usdt).toFixed(2)} USDT</td>
                  <td className="px-3 py-2 font-mono">{Number(p.usdt_rate_rub).toFixed(2)} ₽</td>
                  <td className="px-3 py-2 font-mono">{Number(p.coin_rate_rub).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</td>
                  <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">-{Number(p.cost_rub || p.amount_usdt * p.usdt_rate_rub).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</td>
                  <td className="px-3 py-2 text-gray-400 max-w-[120px] truncate">{p.note || '—'}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Добавить закупку крипты</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Монета</label>
                <select value={form.coin} onChange={e => {
                    const coin = e.target.value;
                    setForm(p => ({ ...p, coin, amount_coin: calcAmountCoin(p.amount_usdt, coin) }));
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {['BTC', 'LTC', 'USDT', 'XMR'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Потрачено USDT</label>
                <input type="number" step="any" value={form.amount_usdt}
                  onChange={e => {
                    const usdt = e.target.value;
                    setForm(p => ({ ...p, amount_usdt: usdt, amount_coin: calcAmountCoin(usdt, p.coin) }));
                  }}
                  placeholder="100.00"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Количество {form.coin}
                  {form.amount_coin && <span className="ml-1 text-blue-500">(авто)</span>}
                </label>
                <input type="number" step="any" value={form.amount_coin}
                  onChange={e => setForm(p => ({ ...p, amount_coin: e.target.value }))}
                  placeholder="0.00157"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Примечание (необязательно)</label>
                <input type="text" value={form.note}
                  onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                  placeholder="Закупка для горячего кошелька"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {form.amount_coin && form.amount_usdt && parseFloat(form.amount_coin) > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <div>Курс {form.coin}: <b>{(parseFloat(form.amount_usdt) / parseFloat(form.amount_coin)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT/{form.coin}</b></div>
                  {usdtRateRub && (
                    <>
                      <div>Курс USDT: <b>{usdtRateRub.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</b> (авто)</div>
                      <div>Стоимость: <b>{(parseFloat(form.amount_usdt) * usdtRateRub).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</b></div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Отмена
              </button>
              <button onClick={handleAdd} disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
        isSuperAdmin ? shiftsApi.getShifts({ limit: 30, period }) : Promise.resolve({ data: [] }),
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
    { header: 'Смен', key: 'shifts_count', render: (r) => <span className="font-mono text-gray-500">{r.shifts_count}</span> },
    { header: 'Прибыль', key: 'profit_rub', render: (r) => (
      <span className={`font-mono font-semibold ${Number(r.profit_rub) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
        {Number(r.profit_rub) >= 0 ? '+' : ''}{fmt(r.profit_rub)} ₽
      </span>
    )},
  ];

  // Колонки таблицы "Итоги по месяцам"
  const monthlyColumns = [
    { header: 'Месяц', key: 'period', render: (r) => {
      const d = new Date(r.period + 'T00:00:00');
      return <span className="font-semibold">{d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</span>;
    }},
    { header: 'Заявок', key: 'orders_count', render: (r) => <span className="font-mono">{r.orders_count}</span> },
    { header: 'Объём', key: 'volume_rub', render: (r) => <span className="font-mono text-gray-700 dark:text-gray-300">{fmt(r.volume_rub, 0)} ₽</span> },
    { header: 'Операторов', key: 'operators_count', render: (r) => <span className="font-mono text-gray-500">{r.operators_count}</span> },
    { header: 'Прибыль', key: 'profit_rub', render: (r) => (
      <span className={`font-mono font-semibold ${Number(r.profit_rub) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
        {Number(r.profit_rub) >= 0 ? '+' : ''}{fmt(r.profit_rub)} ₽
      </span>
    )},
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

            {/* Детально по заявкам */}
            {isSuperAdmin && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Детально по заявкам
                </h3>
                <DetailOrdersTable period={period} tab={tab} />
              </div>
            )}

            {/* Закупки крипты */}
            {isSuperAdmin && <CryptoPurchasesSection />}

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
                        {['Оператор', 'Начало', 'Статус', 'Отработано', 'Заявок', 'Штраф', 'Прибыль'].map(h => (
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
                            <td className="px-3 py-2 font-mono text-green-600 dark:text-green-400 whitespace-nowrap">
                              {Number(shift.total_profit_rub || 0) > 0 ? '+' : ''}{fmt(shift.total_profit_rub)} ₽
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
