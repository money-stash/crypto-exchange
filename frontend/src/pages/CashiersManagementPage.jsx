import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import { cashiersApi } from '../services/api';
import { Eye, EyeOff, ChevronDown, ChevronRight, Users, CreditCard, Settings } from 'lucide-react';

const TABS = [
  { key: 'teams',    label: 'Команды',   icon: Users },
  { key: 'cashiers', label: 'Кассиры',   icon: CreditCard },
  { key: 'settings', label: 'Настройки', icon: Settings },
];

const fmtRub = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const INPUT = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const BTN_PRIMARY = 'px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors';
const BTN_GHOST = 'px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors';

// ---------------------------------------------------------------------------
// Shared modal wrapper
// ---------------------------------------------------------------------------
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams tab
// ---------------------------------------------------------------------------
function TeamsTab() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [members, setMembers] = useState({});

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', bot_token: '' });
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const [editTeam, setEditTeam] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showEditToken, setShowEditToken] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cashiersApi.listTeams();
      setTeams(res.data.teams || []);
    } catch {
      toast.error('Ошибка загрузки команд');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (team) => {
    if (expanded === team.id) { setExpanded(null); return; }
    setExpanded(team.id);
    if (!members[team.id]) {
      try {
        const res = await cashiersApi.getTeamMembers(team.id);
        setMembers(p => ({ ...p, [team.id]: res.data.members || [] }));
      } catch {
        toast.error('Ошибка загрузки участников');
      }
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return toast.error('Введите название команды');
    setSaving(true);
    try {
      await cashiersApi.createTeam({
        name: createForm.name.trim(),
        bot_token: createForm.bot_token.trim() || null,
      });
      toast.success('Команда создана');
      setShowCreate(false);
      setCreateForm({ name: '', bot_token: '' });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (team) => {
    setEditTeam(team);
    setEditForm({ name: team.name, bot_token: team.bot_token || '' });
    setShowEditToken(false);
  };

  const handleEditSave = async () => {
    if (!editForm.name.trim()) return toast.error('Введите название');
    try {
      await cashiersApi.updateTeam(editTeam.id, {
        name: editForm.name.trim(),
        bot_token: editForm.bot_token.trim() || null,
      });
      toast.success('Команда обновлена');
      setEditTeam(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    }
  };

  const handleDelete = async (team) => {
    if (!window.confirm(`Удалить команду "${team.name}"? Кассиры останутся, но потеряют привязку к команде.`)) return;
    try {
      await cashiersApi.deleteTeam(team.id);
      toast.success('Команда удалена');
      load();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Каждая команда имеет свой бот. Кассиры привязывают Telegram через <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/start</code> в боте команды.
        </p>
        <button onClick={() => setShowCreate(true)} className={BTN_PRIMARY}>
          + Создать команду
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Команд нет. Создайте первую команду.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map(team => (
            <div key={team.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => toggleExpand(team)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    {expanded === team.id
                      ? <ChevronDown className="w-4 h-4" />
                      : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{team.name}</p>
                    <p className="text-xs text-gray-400">
                      {team.member_count} {team.member_count === 1 ? 'кассир' : 'кассиров'} ·{' '}
                      {team.bot_token
                        ? <span className="text-green-500">Бот подключён</span>
                        : <span className="text-yellow-500">Бот не настроен</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(team)}
                    className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                    Изменить
                  </button>
                  <button onClick={() => handleDelete(team)}
                    className="px-3 py-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                    Удалить
                  </button>
                </div>
              </div>

              {expanded === team.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/50">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Участники команды</p>
                  {!members[team.id] ? (
                    <p className="text-xs text-gray-400">Загрузка...</p>
                  ) : members[team.id].length === 0 ? (
                    <p className="text-xs text-gray-400 italic">
                      Нет кассиров. Создайте кассира и назначьте эту команду, затем кассир привязывает Telegram через /start в боте.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {members[team.id].map(m => (
                        <div key={m.id} className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${m.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{m.login}</span>
                            <span className="text-xs text-gray-400">{m.commission_percent}%</span>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            m.tg_id
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                          }`}>
                            {m.tg_id ? 'Telegram привязан' : 'Telegram не привязан'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create team modal */}
      {showCreate && (
        <Modal title="Новая команда" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Название *</label>
              <input className={INPUT} value={createForm.name}
                onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Команда Иванова" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Токен бота <span className="text-gray-400 font-normal">(от @BotFather)</span>
              </label>
              <div className="relative">
                <input className={INPUT + ' pr-10'}
                  type={showToken ? 'text' : 'password'}
                  value={createForm.bot_token}
                  onChange={e => setCreateForm(p => ({ ...p, bot_token: e.target.value }))}
                  placeholder="1234567890:AAF..." />
                <button type="button" onClick={() => setShowToken(p => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Можно добавить позже. Бот запустится автоматически.</p>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={() => setShowCreate(false)} className={BTN_GHOST + ' flex-1'}>Отмена</button>
            <button onClick={handleCreate} disabled={saving} className={BTN_PRIMARY + ' flex-1'}>
              {saving ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit team modal */}
      {editTeam && (
        <Modal title={`Изменить: ${editTeam.name}`} onClose={() => setEditTeam(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Название *</label>
              <input className={INPUT} value={editForm.name}
                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Токен бота</label>
              <div className="relative">
                <input className={INPUT + ' pr-10'}
                  type={showEditToken ? 'text' : 'password'}
                  value={editForm.bot_token}
                  onChange={e => setEditForm(p => ({ ...p, bot_token: e.target.value }))}
                  placeholder="Оставьте пустым — без изменений" />
                <button type="button" onClick={() => setShowEditToken(p => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  {showEditToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={() => setEditTeam(null)} className={BTN_GHOST + ' flex-1'}>Отмена</button>
            <button onClick={handleEditSave} className={BTN_PRIMARY + ' flex-1'}>Сохранить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cashiers tab
// ---------------------------------------------------------------------------
function CashiersTab({ teams }) {
  const [cashiers, setCashiers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ login: '', password: '', commission_percent: '0', team_id: '' });
  const [saving, setSaving] = useState(false);
  const [showCreatePwd, setShowCreatePwd] = useState(false);

  const [editCashier, setEditCashier] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [expandedId, setExpandedId] = useState(null);
  const [expandedCards, setExpandedCards] = useState([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const [extendModal, setExtendModal] = useState(null);
  const [extendAmount, setExtendAmount] = useState('');

  const [depositModal, setDepositModal] = useState(null);
  const [depositAdjust, setDepositAdjust] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cashiersApi.listCashiers({ page });
      setCashiers(res.data.cashiers || []);
      setTotal(res.data.total || 0);
      setPages(res.data.pages || 1);
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const teamName = (id) => teams.find(t => t.id === id)?.name || '—';

  const handleCreate = async () => {
    if (!createForm.login.trim() || !createForm.password.trim())
      return toast.error('Заполните логин и пароль');
    setSaving(true);
    try {
      await cashiersApi.createCashier({
        login: createForm.login.trim(),
        password: createForm.password,
        commission_percent: parseFloat(createForm.commission_percent) || 0,
        team_id: createForm.team_id ? parseInt(createForm.team_id) : null,
      });
      toast.success('Кассир создан');
      setShowCreate(false);
      setCreateForm({ login: '', password: '', commission_percent: '0', team_id: '' });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (c) => {
    setEditCashier(c);
    setEditForm({
      login: c.login,
      password: '',
      commission_percent: String(c.commission_percent ?? 0),
      team_id: c.team_id ? String(c.team_id) : '',
    });
  };

  const handleEditSave = async () => {
    if (!editForm.login.trim()) return toast.error('Введите логин');
    try {
      await cashiersApi.updateCashier(editCashier.id, {
        login: editForm.login.trim(),
        password: editForm.password || undefined,
        commission_percent: parseFloat(editForm.commission_percent) || 0,
        team_id: editForm.team_id ? parseInt(editForm.team_id) : null,
      });
      toast.success('Обновлено');
      setEditCashier(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Удалить кассира ${c.login}?`)) return;
    try {
      await cashiersApi.deleteCashier(c.id);
      toast.success('Удалён');
      load();
    } catch { toast.error('Ошибка удаления'); }
  };

  const handleToggleActive = async (c) => {
    try {
      await cashiersApi.updateCashier(c.id, { login: c.login, is_active: !c.is_active });
      load();
    } catch { toast.error('Ошибка'); }
  };

  const toggleExpand = async (c) => {
    if (expandedId === c.id) { setExpandedId(null); setExpandedCards([]); return; }
    setExpandedId(c.id);
    setLoadingCards(true);
    try {
      const res = await cashiersApi.getCashierCards(c.id);
      setExpandedCards(res.data);
    } catch { toast.error('Ошибка загрузки карт'); }
    finally { setLoadingCards(false); }
  };

  const handleAdminExtend = async () => {
    const extra = parseFloat(extendAmount);
    if (!extra || extra <= 0) return toast.error('Введите сумму');
    try {
      await cashiersApi.adminExtendCardLimit(extendModal.cashierId, extendModal.card.id, extra);
      toast.success('Лимит расширен');
      const res = await cashiersApi.getCashierCards(extendModal.cashierId);
      setExpandedCards(res.data);
      setExtendModal(null);
      setExtendAmount('');
      load();
    } catch { toast.error('Ошибка'); }
  };

  const openDeposit = async (c) => {
    try {
      const res = await cashiersApi.getCashierDeposit(c.id);
      setDepositModal({ cashierId: c.id, login: c.login, ...res.data });
      setDepositAdjust('');
    } catch { toast.error('Ошибка загрузки депозита'); }
  };

  const handleDepositAdjust = async () => {
    const amount = parseFloat(depositAdjust);
    if (!amount) return toast.error('Введите сумму');
    setSavingDeposit(true);
    try {
      await cashiersApi.adjustCashierDeposit(depositModal.cashierId, { amount_rub: amount });
      toast.success(amount > 0 ? `+${fmtRub(amount)} ₽` : `${fmtRub(amount)} ₽`);
      const res = await cashiersApi.getCashierDeposit(depositModal.cashierId);
      setDepositModal(p => ({ ...p, ...res.data }));
      setDepositAdjust('');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка');
    } finally {
      setSavingDeposit(false);
    }
  };

  const TeamSelect = ({ value, onChange, className }) => (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">— Без команды —</option>
      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">Всего кассиров: {total}</p>
        <button onClick={() => setShowCreate(true)} className={BTN_PRIMARY}>+ Добавить кассира</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : cashiers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Кассиров нет</div>
      ) : (
        <div className="space-y-3">
          {cashiers.map(c => (
            <div key={c.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.is_active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white">{c.login}
                      <span className="ml-2 text-xs text-gray-400">{c.commission_percent}%</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {c.team_id ? teamName(c.team_id) : <span className="text-yellow-500">Без команды</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  <div className="hidden sm:block text-right mr-2">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                      {fmtRub(c.current_volume)} / {fmtRub(c.total_volume_limit)} ₽
                    </p>
                    <p className="text-xs text-gray-400">
                      {c.active_cards}/{c.card_count} карт активно
                      {c.cards_at_limit > 0 && <span className="ml-1 text-yellow-500">· {c.cards_at_limit} на лимите</span>}
                    </p>
                    <p className={`text-xs mt-0.5 ${(c.deposit - c.deposit_work) <= 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                      Деп: {fmtRub(c.deposit - (c.deposit_work || 0))} / {fmtRub(c.deposit || 0)} ₽
                    </p>
                  </div>
                  {[
                    { label: 'Депозит', cls: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50', fn: () => openDeposit(c) },
                    { label: 'Карты',   cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600', fn: () => toggleExpand(c) },
                    { label: 'Изменить',cls: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50', fn: () => openEdit(c) },
                    { label: c.is_active ? 'Выкл' : 'Вкл', cls: c.is_active ? 'bg-gray-100 dark:bg-gray-700 text-gray-500' : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400', fn: () => handleToggleActive(c) },
                    { label: 'Удалить', cls: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50', fn: () => handleDelete(c) },
                  ].map(btn => (
                    <button key={btn.label} onClick={btn.fn}
                      className={`px-3 py-1 rounded-lg text-xs transition-colors ${btn.cls}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {expandedId === c.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/50">
                  {loadingCards ? (
                    <p className="text-center text-sm text-gray-400 py-3">Загрузка...</p>
                  ) : expandedCards.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-3">Карт нет</p>
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
                                  card.limit_reached_notified ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                  : card.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                  {card.limit_reached_notified ? 'Лимит' : card.is_active ? 'Активна' : 'Откл'}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mt-1">
                                {fmtRub(card.min_amount)} – {fmtRub(card.max_amount)} ₽ ·{' '}
                                Объём: {fmtRub(card.current_volume)}/{fmtRub(card.total_volume_limit) || '∞'} ₽
                                {card.interval_minutes > 0 && ` · Инт: ${card.interval_minutes} мин`}
                              </p>
                              {pct !== null && (
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${pct >= 100 ? 'bg-yellow-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'}`}
                                      style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-gray-400 w-8">{pct}%</span>
                                </div>
                              )}
                            </div>
                            {card.limit_reached_notified && (
                              <button onClick={() => { setExtendModal({ cashierId: c.id, card }); setExtendAmount(''); }}
                                className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs font-medium flex-shrink-0">
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

      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Create cashier modal */}
      {showCreate && (
        <Modal title="Новый кассир" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Логин *</label>
              <input className={INPUT} value={createForm.login}
                onChange={e => setCreateForm(p => ({ ...p, login: e.target.value }))} placeholder="cashier1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Пароль *</label>
              <div className="relative">
                <input className={INPUT + ' pr-10'} type={showCreatePwd ? 'text' : 'password'}
                  value={createForm.password}
                  onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••" />
                <button type="button" onClick={() => setShowCreatePwd(p => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  {showCreatePwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Комиссия (%)</label>
              <input className={INPUT} type="number" value={createForm.commission_percent}
                onChange={e => setCreateForm(p => ({ ...p, commission_percent: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Команда</label>
              <select className={INPUT} value={createForm.team_id}
                onChange={e => setCreateForm(p => ({ ...p, team_id: e.target.value }))}>
                <option value="">— Без команды —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={() => { setShowCreate(false); setShowCreatePwd(false); }} className={BTN_GHOST + ' flex-1'}>Отмена</button>
            <button onClick={handleCreate} disabled={saving} className={BTN_PRIMARY + ' flex-1'}>
              {saving ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit cashier modal */}
      {editCashier && (
        <Modal title={`Изменить: ${editCashier.login}`} onClose={() => setEditCashier(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Логин *</label>
              <input className={INPUT} value={editForm.login}
                onChange={e => setEditForm(p => ({ ...p, login: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Новый пароль (оставьте пустым)</label>
              <input className={INPUT} type="password" value={editForm.password}
                onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Комиссия (%)</label>
              <input className={INPUT} type="number" value={editForm.commission_percent}
                onChange={e => setEditForm(p => ({ ...p, commission_percent: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Команда</label>
              <select className={INPUT} value={editForm.team_id}
                onChange={e => setEditForm(p => ({ ...p, team_id: e.target.value }))}>
                <option value="">— Без команды —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={() => setEditCashier(null)} className={BTN_GHOST + ' flex-1'}>Отмена</button>
            <button onClick={handleEditSave} className={BTN_PRIMARY + ' flex-1'}>Сохранить</button>
          </div>
        </Modal>
      )}

      {/* Deposit modal */}
      {depositModal && (
        <Modal title={`Депозит: ${depositModal.login}`} onClose={() => setDepositModal(null)}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Доступно', value: `${fmtRub(depositModal.available)} ₽`, cls: depositModal.available <= 0 ? 'text-red-500' : 'text-green-600 dark:text-green-400' },
              { label: 'Заморожено', value: `${fmtRub(depositModal.deposit_work)} ₽`, cls: 'text-yellow-600' },
              { label: 'Всего внесено', value: `${fmtRub(depositModal.deposit)} ₽`, cls: '' },
              { label: 'Выплачено', value: `${fmtRub(depositModal.deposit_paid)} ₽`, cls: '' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                <p className={`text-sm font-semibold mt-0.5 ${s.cls || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {depositModal.history?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 mb-1.5">Последние пополнения</p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {depositModal.history.slice(0, 5).map(item => (
                  <div key={item.id} className="flex justify-between text-xs bg-gray-50 dark:bg-gray-900/50 rounded px-2 py-1.5">
                    <span className="text-gray-500">{item.coin === 'MANUAL' ? 'Ручное' : `${Number(item.amount_coin).toFixed(6)} BTC`}</span>
                    <span className="font-medium text-gray-900 dark:text-white">+{fmtRub(item.amount_rub)} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Корректировка (+ пополнить, − списать) ₽</label>
            <input className={INPUT} type="number" value={depositAdjust}
              onChange={e => setDepositAdjust(e.target.value)} placeholder="1000 или -500" />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setDepositModal(null)} className={BTN_GHOST + ' flex-1'}>Закрыть</button>
            <button onClick={handleDepositAdjust} disabled={savingDeposit || !depositAdjust}
              className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
              {savingDeposit ? '...' : 'Применить'}
            </button>
          </div>
        </Modal>
      )}

      {/* Extend limit modal */}
      {extendModal && (
        <Modal title="Расширить лимит" onClose={() => setExtendModal(null)}>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Карта <span className="font-mono font-medium">{extendModal.card.card_number}</span><br />
            Лимит: {fmtRub(extendModal.card.total_volume_limit)} ₽ (использовано {fmtRub(extendModal.card.current_volume)} ₽)
          </p>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">На сколько увеличить (₽)</label>
          <input className={INPUT} type="number" value={extendAmount}
            onChange={e => setExtendAmount(e.target.value)} placeholder="100000" />
          <div className="flex gap-3 mt-4">
            <button onClick={() => setExtendModal(null)} className={BTN_GHOST + ' flex-1'}>Отмена</button>
            <button onClick={handleAdminExtend}
              className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium transition-colors">
              Расширить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* Cashier chats moved to OperatorManagerChatsPage */
function _ChatsTabRemoved_UNUSED() {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { cashierId, cashierLogin }
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadChats = useCallback(async () => {
    try {
      const res = await cashiersApi.listCashierChats();
      setChats(res.data.chats || []);
    } catch {
      toast.error('Ошибка загрузки чатов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);

  const openChat = async (chat) => {
    setSelected({ cashierId: chat.cashier_id, cashierLogin: chat.cashier_login });
    setMessages([]);
    setMsgLoading(true);
    try {
      const res = await cashiersApi.getCashierChat(chat.cashier_id);
      setMessages(res.data.messages || []);
      await cashiersApi.markCashierChatRead(chat.cashier_id);
      setChats(prev => prev.map(c =>
        c.cashier_id === chat.cashier_id ? { ...c, unread_for_manager: 0 } : c
      ));
    } catch {
      toast.error('Ошибка загрузки сообщений');
    } finally {
      setMsgLoading(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !selected) return;
    setSending(true);
    try {
      const res = await cashiersApi.sendToCashier(selected.cashierId, text);
      setMessages(prev => [...prev, res.data]);
      setInput('');
      loadChats();
    } catch {
      toast.error('Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (dt) => {
    if (!dt) return '';
    const d = new Date(dt);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="flex gap-4 h-[600px]">
      {/* Chat list */}
      <div className="w-64 flex-shrink-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-4">
            <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm text-center">Чатов нет. Кассиры увидят чат в своей панели.</p>
          </div>
        ) : chats.map(chat => (
          <button
            key={chat.cashier_id}
            onClick={() => openChat(chat)}
            className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
              selected?.cashierId === chat.cashier_id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${chat.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{chat.cashier_login}</span>
              </div>
              {chat.unread_for_manager > 0 && (
                <span className="flex-shrink-0 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {chat.unread_for_manager}
                </span>
              )}
            </div>
            {chat.last_message && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {chat.last_sender_type === 'CASHIER' ? '← ' : '→ '}{chat.last_message}
              </p>
            )}
            {chat.last_message_at && (
              <p className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">{fmtTime(chat.last_message_at)}</p>
            )}
          </button>
        ))}
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center flex-1 text-gray-400 dark:text-gray-500">
            <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
            <p>Выберите кассира для переписки</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <p className="font-medium text-gray-900 dark:text-white text-sm">{selected.cashierLogin}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {msgLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Нет сообщений. Напишите первым.</p>
              ) : messages.map(msg => {
                const isAdmin = msg.sender_type !== 'CASHIER';
                return (
                  <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 ${
                      isAdmin
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                    }`}>
                      <p className="text-sm break-words">{msg.message}</p>
                      <p className={`text-xs mt-0.5 ${isAdmin ? 'text-blue-200' : 'text-gray-400'}`}>
                        {msg.sender_login || msg.sender_type} · {fmtTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex-shrink-0 flex gap-2">
              <input
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Написать кассиру..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------
function SettingsTab() {
  const [routingInterval, setRoutingInterval] = useState(0);
  const [routingInput, setRoutingInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cashiersApi.getRoutingSetting().then(res => {
      const n = res.data.interval ?? 0;
      setRoutingInterval(n);
      setRoutingInput(String(n));
    }).catch(() => toast.error('Ошибка загрузки настроек')).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const n = parseInt(routingInput);
    if (isNaN(n) || n < 0) return toast.error('Введите число >= 0');
    setSaving(true);
    try {
      await cashiersApi.updateRoutingSetting(n);
      setRoutingInterval(n);
      toast.success(n === 0 ? 'Все заявки — автовыдача' : `Каждая ${n}-я заявка — операторам`);
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="max-w-md space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Распределение трафика</h3>
        <p className="text-xs text-gray-400 mb-4">
          {routingInterval === 0
            ? 'Все новые заявки идут в автовыдачу (кассирам).'
            : `Каждая ${routingInterval}-я заявка отправляется операторам, остальные — кассирам.`}
        </p>
        <div className="flex gap-2 items-center">
          <input type="number" min="0" value={routingInput}
            onChange={e => setRoutingInput(e.target.value)}
            placeholder="0"
            className={INPUT + ' flex-1'} />
          <button onClick={handleSave} disabled={saving} className={BTN_PRIMARY}>
            {saving ? '...' : 'Сохранить'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          <strong>0</strong> — всё на автовыдачу. <strong>N</strong> — каждая N-я заявка операторам.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CashiersManagementPage() {
  const [tab, setTab] = useState('teams');
  const [teams, setTeams] = useState([]);

  // Load teams once for use in cashier dropdowns
  useEffect(() => {
    cashiersApi.listTeams().then(r => setTeams(r.data.teams || [])).catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Автовыдача</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'teams'    && <TeamsTab />}
      {tab === 'cashiers' && <CashiersTab teams={teams} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
