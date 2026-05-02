import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { Ticket, Plus, Trash2, Copy, ToggleLeft, ToggleRight, Users, ChevronDown, ChevronUp, Edit2, Check, X } from 'lucide-react';
import { couponsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import Modal from '../components/Modal';

const fmt = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

const StatusBadge = ({ active }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
    active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
           : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  }`}>
    {active ? 'Активен' : 'Выключен'}
  </span>
);

const EmptyCreate = ({ brand = 'promo', discountRub = '', minOrderRub = '', maxUses = 1,
                        assignedTgId = '', expiresAt = '', onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Бренд (префикс)</label>
      <input className="form-input w-full" value={brand} onChange={e => onChange('brand', e.target.value)} placeholder="ablo" />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Скидка ₽ *</label>
      <input className="form-input w-full" type="number" min="1" value={discountRub} onChange={e => onChange('discount_rub', e.target.value)} placeholder="500" />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Мин. сумма заявки ₽</label>
      <input className="form-input w-full" type="number" min="0" value={minOrderRub} onChange={e => onChange('min_order_rub', e.target.value)} placeholder="0" />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Макс. использований (0 = ∞)</label>
      <input className="form-input w-full" type="number" min="0" value={maxUses} onChange={e => onChange('max_uses', e.target.value)} />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Telegram ID пользователя (необязательно)</label>
      <input className="form-input w-full" value={assignedTgId} onChange={e => onChange('assigned_tg_id', e.target.value)} placeholder="Только для конкретного юзера" />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Действует до (необязательно)</label>
      <input className="form-input w-full" type="datetime-local" value={expiresAt} onChange={e => onChange('expires_at', e.target.value)} />
    </div>
  </div>
);

const CouponsPage = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPERADMIN';

  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ brand: 'promo', discount_rub: '', min_order_rub: '', max_uses: 1, assigned_tg_id: '', expires_at: '' });

  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const [accessList, setAccessList] = useState([]);
  const [showAccess, setShowAccess] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await couponsApi.list();
      setCoupons(res.data.coupons || []);
    } catch {
      toast.error('Ошибка загрузки промокодов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadAccess = useCallback(async () => {
    setAccessLoading(true);
    try {
      const res = await couponsApi.getAccessList();
      setAccessList(res.data.staff || []);
    } catch {
      toast.error('Ошибка загрузки списка доступа');
    } finally {
      setAccessLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin && showAccess) loadAccess();
  }, [isSuperAdmin, showAccess, loadAccess]);

  const handleCreate = async () => {
    if (!form.discount_rub || Number(form.discount_rub) <= 0) {
      toast.error('Укажите скидку больше 0');
      return;
    }
    setCreating(true);
    try {
      const res = await couponsApi.create({
        brand: form.brand || 'promo',
        discount_rub: Number(form.discount_rub),
        min_order_rub: Number(form.min_order_rub) || 0,
        max_uses: Number(form.max_uses) || 1,
        assigned_tg_id: form.assigned_tg_id ? Number(form.assigned_tg_id) : null,
        expires_at: form.expires_at || null,
      });
      setCoupons(prev => [res.data, ...prev]);
      setShowCreate(false);
      setForm({ brand: 'promo', discount_rub: '', min_order_rub: '', max_uses: 1, assigned_tg_id: '', expires_at: '' });
      toast.success(`Промокод создан: ${res.data.code}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (coupon) => {
    try {
      await couponsApi.update(coupon.id, { is_active: !coupon.is_active });
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, is_active: !c.is_active } : c));
    } catch {
      toast.error('Ошибка изменения статуса');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить промокод?')) return;
    try {
      await couponsApi.remove(id);
      setCoupons(prev => prev.filter(c => c.id !== id));
      toast.success('Промокод удалён');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка удаления');
    }
  };

  const startEdit = (coupon) => {
    setEditId(coupon.id);
    setEditForm({
      discount_rub: coupon.discount_rub,
      min_order_rub: coupon.min_order_rub,
      max_uses: coupon.max_uses,
      expires_at: coupon.expires_at ? coupon.expires_at.slice(0, 16) : '',
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await couponsApi.update(editId, {
        discount_rub: Number(editForm.discount_rub),
        min_order_rub: Number(editForm.min_order_rub) || 0,
        max_uses: Number(editForm.max_uses) || 1,
        expires_at: editForm.expires_at || null,
      });
      setCoupons(prev => prev.map(c => c.id === editId ? { ...c, ...editForm } : c));
      setEditId(null);
      toast.success('Изменения сохранены');
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Код скопирован');
  };

  const toggleAccess = async (supportId, current) => {
    try {
      await couponsApi.setAccess(supportId, !current);
      setAccessList(prev => prev.map(s => s.id === supportId ? { ...s, can_use_coupons: !current ? 1 : 0 } : s));
    } catch {
      toast.error('Ошибка изменения доступа');
    }
  };

  const roleLabel = (role) => ({ MANAGER: 'Менеджер', EX_ADMIN: 'EX_Admin', OPERATOR: 'Оператор' }[role] || role);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
            <Ticket className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Промокоды</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{coupons.length} промокод{coupons.length === 1 ? '' : 'ов'}</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition-colors shadow"
        >
          <Plus className="w-4 h-4" />
          Создать
        </button>
      </div>

      {/* Access management (superadmin only) */}
      {isSuperAdmin && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowAccess(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-gray-500" />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Управление доступом к промокодам</span>
            </div>
            {showAccess ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showAccess && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4">
              {accessLoading ? (
                <p className="text-sm text-gray-500">Загрузка...</p>
              ) : accessList.length === 0 ? (
                <p className="text-sm text-gray-500">Нет сотрудников</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {accessList.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.login}</p>
                        <p className="text-xs text-gray-400">{roleLabel(s.role)}</p>
                      </div>
                      <button
                        onClick={() => toggleAccess(s.id, Boolean(s.can_use_coupons))}
                        className="transition-colors"
                        title={s.can_use_coupons ? 'Отозвать доступ' : 'Дать доступ'}
                      >
                        {s.can_use_coupons
                          ? <ToggleRight className="w-8 h-8 text-emerald-500" />
                          : <ToggleLeft className="w-8 h-8 text-gray-400" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Загрузка...</div>
        ) : coupons.length === 0 ? (
          <div className="p-10 text-center">
            <Ticket className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Промокодов пока нет</p>
            <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-purple-600 hover:underline">Создать первый</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Код</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Скидка</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Мин. сумма</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Использований</th>
                  {isSuperAdmin && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Создал</th>}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Статус</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Действует до</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {coupons.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-lg text-xs font-mono font-semibold">
                          {c.code}
                        </code>
                        <button onClick={() => copyCode(c.code)} className="text-gray-400 hover:text-purple-500 transition-colors" title="Копировать">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editId === c.id ? (
                        <input className="form-input w-24 text-xs py-1" type="number" value={editForm.discount_rub}
                          onChange={e => setEditForm(f => ({ ...f, discount_rub: e.target.value }))} />
                      ) : (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">-{fmt(c.discount_rub)} ₽</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {editId === c.id ? (
                        <input className="form-input w-24 text-xs py-1" type="number" value={editForm.min_order_rub}
                          onChange={e => setEditForm(f => ({ ...f, min_order_rub: e.target.value }))} />
                      ) : (
                        Number(c.min_order_rub) > 0 ? `${fmt(c.min_order_rub)} ₽` : '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editId === c.id ? (
                        <input className="form-input w-16 text-xs py-1" type="number" value={editForm.max_uses}
                          onChange={e => setEditForm(f => ({ ...f, max_uses: e.target.value }))} />
                      ) : (
                        <span className="text-gray-700 dark:text-gray-300">
                          {c.used_count} / {Number(c.max_uses) === 0 ? '∞' : c.max_uses}
                        </span>
                      )}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-gray-500 text-xs">{c.creator_login || '—'}</td>
                    )}
                    <td className="px-4 py-3">
                      <StatusBadge active={Boolean(c.is_active)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {editId === c.id ? (
                        <input className="form-input w-36 text-xs py-1" type="datetime-local" value={editForm.expires_at}
                          onChange={e => setEditForm(f => ({ ...f, expires_at: e.target.value }))} />
                      ) : (
                        c.expires_at ? new Date(c.expires_at).toLocaleDateString('ru-RU') : '∞'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {editId === c.id ? (
                          <>
                            <button onClick={saveEdit} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => handleToggleActive(c)}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                              title={c.is_active ? 'Выключить' : 'Включить'}>
                              {c.is_active
                                ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                                : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                            </button>
                            <button onClick={() => startEdit(c)}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(c.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal isOpen={showCreate} title="Создать промокод" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <EmptyCreate
              brand={form.brand}
              discountRub={form.discount_rub}
              minOrderRub={form.min_order_rub}
              maxUses={form.max_uses}
              assignedTgId={form.assigned_tg_id}
              expiresAt={form.expires_at}
              onChange={(field, val) => setForm(f => ({ ...f, [field]: val }))}
            />
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 text-xs text-purple-700 dark:text-purple-300">
              Код сгенерируется автоматически в формате <code className="font-mono">{form.brand || 'promo'}$xxxxxxxx</code>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Отмена
              </button>
              <button onClick={handleCreate} disabled={creating}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default CouponsPage;
