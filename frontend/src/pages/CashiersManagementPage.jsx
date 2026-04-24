import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { cashiersApi } from '../services/api';

const initialForm = { login: '', password: '', commission_percent: '0' };

export default function CashiersManagementPage() {
  const [summary, setSummary] = useState(null);
  const [cashiers, setCashiers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [routingInterval, setRoutingInterval] = useState(0);
  const [routingInput, setRoutingInput] = useState('');
  const [savingRouting, setSavingRouting] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState(null);
  const [expandedCards, setExpandedCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const [editCashier, setEditCashier] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [extendModal, setExtendModal] = useState(null); // { cashierId, card }
  const [extendAmount, setExtendAmount] = useState('');

  const [depositModal, setDepositModal] = useState(null); // { cashierId, login, deposit, available }
  const [depositAdjust, setDepositAdjust] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, listRes, routingRes] = await Promise.all([
        cashiersApi.getVolumeSummary(),
        cashiersApi.listCashiers({ page }),
        cashiersApi.getRoutingSetting(),
      ]);
      setSummary(summaryRes.data);
      setCashiers(listRes.data.cashiers || []);
      setTotal(listRes.data.total || 0);
      setPages(listRes.data.pages || 1);
      const n = routingRes.data.interval ?? 0;
      setRoutingInterval(n);
      setRoutingInput(String(n));
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleCreateSave = async () => {
    if (!createForm.login.trim() || !createForm.password.trim())
      return toast.error('Заполните логин и пароль');
    setSaving(true);
    try {
      await cashiersApi.createCashier({
        login: createForm.login.trim(),
        password: createForm.password,
        commission_percent: parseFloat(createForm.commission_percent) || 0,
      });
      toast.success('Кассир создан');
      setShowCreate(false);
      setCreateForm(initialForm);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cashier) => {
    if (!window.confirm(`Удалить кассира ${cashier.login}?`)) return;
    try {
      await cashiersApi.deleteCashier(cashier.id);
      toast.success('Удалён');
      load();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleToggleActive = async (cashier) => {
    try {
      await cashiersApi.updateCashier(cashier.id, {
        login: cashier.login,
        is_active: !cashier.is_active,
      });
      load();
    } catch {
      toast.error('Ошибка');
    }
  };

  const openEdit = (cashier) => {
    setEditCashier(cashier);
    setEditForm({
      login: cashier.login,
      password: '',
      commission_percent: String(cashier.commission_percent ?? 0),
    });
  };

  const handleEditSave = async () => {
    if (!editForm.login.trim()) return toast.error('Введите логин');
    try {
      await cashiersApi.updateCashier(editCashier.id, {
        login: editForm.login.trim(),
        password: editForm.password || undefined,
        commission_percent: parseFloat(editForm.commission_percent) || 0,
      });
      toast.success('Обновлено');
      setEditCashier(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    }
  };

  const toggleExpand = async (cashier) => {
    if (expandedId === cashier.id) {
      setExpandedId(null);
      setExpandedCards([]);
      return;
    }
    setExpandedId(cashier.id);
    setLoadingCards(true);
    try {
      const res = await cashiersApi.getCashierCards(cashier.id);
      setExpandedCards(res.data);
    } catch {
      toast.error('Ошибка загрузки карт');
    } finally {
      setLoadingCards(false);
    }
  };

  const handleAdminExtend = async () => {
    const extra = parseFloat(extendAmount);
    if (!extra || extra <= 0) return toast.error('Введите сумму');
    try {
      await cashiersApi.adminExtendCardLimit(extendModal.cashierId, extendModal.card.id, extra);
      toast.success('Лимит расширен');
      setExtendModal(null);
      setExtendAmount('');
      // Reload cards
      const res = await cashiersApi.getCashierCards(extendModal.cashierId);
      setExpandedCards(res.data);
      load();
    } catch {
      toast.error('Ошибка');
    }
  };

  const handleSaveRouting = async () => {
    const n = parseInt(routingInput);
    if (isNaN(n) || n < 0) return toast.error('Введите число >= 0');
    setSavingRouting(true);
    try {
      await cashiersApi.updateRoutingSetting(n);
      setRoutingInterval(n);
      toast.success(n === 0 ? 'Все заявки — автовыдача' : `Каждая ${n}-я заявка — операторам`);
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSavingRouting(false);
    }
  };

  const openDepositModal = async (cashier) => {
    try {
      const res = await cashiersApi.getCashierDeposit(cashier.id);
      setDepositModal({
        cashierId: cashier.id,
        login: cashier.login,
        ...res.data,
      });
      setDepositAdjust('');
    } catch {
      toast.error('Ошибка загрузки депозита');
    }
  };

  const handleDepositAdjust = async () => {
    const amount = parseFloat(depositAdjust);
    if (!amount || amount === 0) return toast.error('Введите сумму');
    setSavingDeposit(true);
    try {
      await cashiersApi.adjustCashierDeposit(depositModal.cashierId, { amount_rub: amount });
      toast.success(amount > 0 ? `Депозит пополнен на ${fmtRub(amount)} ₽` : `Депозит уменьшен на ${fmtRub(Math.abs(amount))} ₽`);
      // Reload deposit info
      const res = await cashiersApi.getCashierDeposit(depositModal.cashierId);
      setDepositModal(prev => ({ ...prev, ...res.data }));
      setDepositAdjust('');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    } finally {
      setSavingDeposit(false);
    }
  };

  const fmtRub = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Автовыдача</h1>
        <button
          onClick={() => { setShowCreate(true); setCreateForm(initialForm); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Добавить кассира
        </button>
      </div>

      {/* System volume summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">Объём в системе</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">
              {fmtRub(summary.total_volume_limit)} ₽
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Использовано: {fmtRub(summary.total_current_volume)} ₽
            </p>
            {parseFloat(summary.total_volume_limit) > 0 && (
              <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.min(100, (summary.total_current_volume / summary.total_volume_limit) * 100)}%` }}
                />
              </div>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">Кассиров</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">
              {(summary.cashiers || []).filter(c => c.is_active).length}
            </p>
            <p className="text-xs text-gray-400 mt-1">из {(summary.cashiers || []).length} активных</p>
          </div>
          {/* Routing setting */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Распределение трафика</p>
            <p className="text-xs text-gray-400 mb-2">
              {routingInterval === 0
                ? 'Все заявки — автовыдача'
                : `Каждая ${routingInterval}-я → операторам`}
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                value={routingInput}
                onChange={e => setRoutingInput(e.target.value)}
                placeholder="0"
                className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveRouting}
                disabled={savingRouting}
                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {savingRouting ? '...' : 'OK'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">0 = все на автовыдачу</p>
          </div>
        </div>
      )}

      {/* Cashiers list */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : cashiers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Кассиров нет</div>
      ) : (
        <div className="space-y-3">
          {cashiers.map(cashier => (
            <div key={cashier.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cashier.is_active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  <span className="font-medium text-gray-900 dark:text-white">{cashier.login}</span>
                  <span className="text-xs text-gray-400">{cashier.commission_percent}%</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 flex-shrink-0">
                  <div className="hidden sm:block text-right">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                      {fmtRub(cashier.current_volume)} / {fmtRub(cashier.total_volume_limit)} ₽
                    </p>
                    <p className="text-xs text-gray-400">
                      {cashier.active_cards}/{cashier.card_count} карт активно
                      {cashier.cards_at_limit > 0 && (
                        <span className="ml-1 text-yellow-500">· {cashier.cards_at_limit} достигли лимита</span>
                      )}
                    </p>
                    {cashier.deposit !== undefined && (
                      <p className={`text-xs mt-0.5 ${
                        (cashier.deposit - cashier.deposit_work) <= 0
                          ? 'text-red-500' : 'text-green-600 dark:text-green-400'
                      }`}>
                        Депозит: {fmtRub(cashier.deposit - (cashier.deposit_work || 0))} ₽ свободно
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => openDepositModal(cashier)}
                    className="px-3 py-1 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg text-xs hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                  >
                    Депозит
                  </button>
                  <button
                    onClick={() => toggleExpand(cashier)}
                    className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {expandedId === cashier.id ? 'Скрыть' : 'Карты'}
                  </button>
                  <button
                    onClick={() => openEdit(cashier)}
                    className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    Изменить
                  </button>
                  <button
                    onClick={() => handleToggleActive(cashier)}
                    className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                      cashier.is_active
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                        : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                    }`}
                  >
                    {cashier.is_active ? 'Выкл' : 'Вкл'}
                  </button>
                  <button
                    onClick={() => handleDelete(cashier)}
                    className="px-3 py-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Удалить
                  </button>
                </div>
              </div>

              {/* Expanded cards */}
              {expandedId === cashier.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/50">
                  {loadingCards ? (
                    <div className="text-center py-4 text-gray-400 text-sm">Загрузка...</div>
                  ) : expandedCards.length === 0 ? (
                    <div className="text-center py-4 text-gray-400 text-sm">Карт нет</div>
                  ) : (
                    <div className="space-y-2">
                      {expandedCards.map(card => {
                        const pct = parseFloat(card.total_volume_limit) > 0
                          ? Math.min(100, Math.round((card.current_volume / card.total_volume_limit) * 100))
                          : null;
                        return (
                          <div key={card.id} className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">{card.card_number}</span>
                                {card.bank_name && <span className="text-xs text-gray-400">{card.bank_name}</span>}
                                <span className={`text-xs rounded-full px-2 py-0.5 ${
                                  card.limit_reached_notified ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400' :
                                  card.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-500'
                                }`}>
                                  {card.limit_reached_notified ? 'Лимит' : card.is_active ? 'Активна' : 'Откл'}
                                </span>
                              </div>
                              <div className="flex gap-3 text-xs text-gray-400 mt-1">
                                <span>{fmtRub(card.min_amount)} – {fmtRub(card.max_amount)} ₽</span>
                                {card.interval_minutes > 0 && <span>Инт: {card.interval_minutes} мин</span>}
                                <span>Объём: {fmtRub(card.current_volume)} / {fmtRub(card.total_volume_limit) || '∞'} ₽</span>
                              </div>
                              {pct !== null && (
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${pct >= 100 ? 'bg-yellow-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400 w-8">{pct}%</span>
                                </div>
                              )}
                            </div>
                            {card.limit_reached_notified && (
                              <button
                                onClick={() => { setExtendModal({ cashierId: cashier.id, card }); setExtendAmount(''); }}
                                className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs font-medium transition-colors flex-shrink-0"
                              >
                                +Лимит
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm ${
                p === page
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Create cashier modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Новый кассир</h2>
            <div className="space-y-3">
              {[
                { label: 'Логин *', key: 'login', type: 'text', placeholder: 'cashier1' },
                { label: 'Пароль *', key: 'password', type: 'password', placeholder: '••••••' },
                { label: 'Комиссия (%)', key: 'commission_percent', type: 'number', placeholder: '0' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={createForm[f.key]}
                    onChange={e => setCreateForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleCreateSave}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit cashier modal */}
      {editCashier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Редактировать: {editCashier.login}
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Логин *', key: 'login', type: 'text' },
                { label: 'Новый пароль (оставьте пустым — без изменений)', key: 'password', type: 'password' },
                { label: 'Комиссия (%)', key: 'commission_percent', type: 'number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={editForm[f.key] || ''}
                    onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditCashier(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleEditSave}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit modal */}
      {depositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Депозит: {depositModal.login}
            </h2>

            <div className="grid grid-cols-2 gap-3 my-4">
              {[
                { label: 'Доступно', value: `${fmtRub(depositModal.available)} ₽`, cls: depositModal.available <= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400' },
                { label: 'Заморожено', value: `${fmtRub(depositModal.deposit_work)} ₽`, cls: 'text-yellow-600 dark:text-yellow-400' },
                { label: 'Всего внесено', value: `${fmtRub(depositModal.deposit)} ₽`, cls: '' },
                { label: 'Выплачено всего', value: `${fmtRub(depositModal.deposit_paid)} ₽`, cls: '' },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className={`text-sm font-semibold mt-0.5 ${s.cls || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {depositModal.history?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Последние пополнения</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {depositModal.history.slice(0, 5).map(item => (
                    <div key={item.id} className="flex justify-between text-xs bg-gray-50 dark:bg-gray-900/50 rounded px-2 py-1.5">
                      <span className="text-gray-600 dark:text-gray-300">
                        {item.coin === 'MANUAL' ? 'Ручное' : `${Number(item.amount_coin).toFixed(6)} BTC`}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">+{fmtRub(item.amount_rub)} ₽</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Корректировка (+ пополнить, - списать) в ₽
              </label>
              <input
                type="number"
                value={depositAdjust}
                onChange={e => setDepositAdjust(e.target.value)}
                placeholder="1000 или -500"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setDepositModal(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Закрыть
              </button>
              <button
                onClick={handleDepositAdjust}
                disabled={savingDeposit || !depositAdjust}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {savingDeposit ? '...' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin extend limit modal */}
      {extendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Расширить лимит</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Карта <span className="font-mono font-medium">{extendModal.card.card_number}</span><br/>
              Лимит: {fmtRub(extendModal.card.total_volume_limit)} ₽ (использовано {fmtRub(extendModal.card.current_volume)} ₽)
            </p>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">На сколько увеличить (₽)</label>
            <input
              type="number"
              value={extendAmount}
              onChange={e => setExtendAmount(e.target.value)}
              placeholder="100000"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setExtendModal(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleAdminExtend}
                className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Расширить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
