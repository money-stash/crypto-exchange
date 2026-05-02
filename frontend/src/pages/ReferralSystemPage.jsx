import React, { useEffect, useState, useCallback } from 'react';
import { referralLevelsApi } from '../services/api';
import { toast } from 'react-toastify';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';

const fmtRub = (v) => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const emptyTier = { min_sum_rub: '', max_sum_rub: '', bonus_percent: '', label: '', sort_order: 0 };

export default function ReferralSystemPage() {
  const [tiers, setTiers] = useState([]);
  const [firstBonus, setFirstBonus] = useState(0);
  const [firstBonusInput, setFirstBonusInput] = useState('');
  const [globalStats, setGlobalStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [newTier, setNewTier] = useState(emptyTier);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tiersRes, bonusRes, statsRes] = await Promise.all([
        referralLevelsApi.getTiers(),
        referralLevelsApi.getFirstBonus(),
        referralLevelsApi.getGlobalStats(),
      ]);
      setTiers(tiersRes.data?.data || []);
      const amt = bonusRes.data?.amount || 0;
      setFirstBonus(amt);
      setFirstBonusInput(String(amt));
      setGlobalStats(statsRes.data?.data || null);
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveFirstBonus = async () => {
    try {
      await referralLevelsApi.setFirstBonus(parseFloat(firstBonusInput) || 0);
      toast.success('Бонус за первый обмен сохранён');
      load();
    } catch {
      toast.error('Ошибка сохранения');
    }
  };

  const handleAddTier = async () => {
    if (!newTier.min_sum_rub || !newTier.bonus_percent) {
      toast.error('Заполните минимальную сумму и процент');
      return;
    }
    try {
      await referralLevelsApi.createTier({
        min_sum_rub: parseFloat(newTier.min_sum_rub),
        max_sum_rub: newTier.max_sum_rub ? parseFloat(newTier.max_sum_rub) : null,
        bonus_percent: parseFloat(newTier.bonus_percent),
        label: newTier.label || null,
        sort_order: parseInt(newTier.sort_order) || 0,
      });
      setNewTier(emptyTier);
      setShowAdd(false);
      toast.success('Уровень добавлен');
      load();
    } catch {
      toast.error('Ошибка добавления уровня');
    }
  };

  const handleDeleteTier = async (id) => {
    if (!window.confirm('Удалить уровень?')) return;
    try {
      await referralLevelsApi.deleteTier(id);
      toast.success('Уровень удалён');
      load();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleStartEdit = (tier) => {
    setEditId(tier.id);
    setEditData({
      min_sum_rub: String(tier.min_sum_rub || ''),
      max_sum_rub: tier.max_sum_rub != null ? String(tier.max_sum_rub) : '',
      bonus_percent: String(tier.bonus_percent || ''),
      label: tier.label || '',
      sort_order: String(tier.sort_order || 0),
    });
  };

  const handleSaveEdit = async (id) => {
    try {
      await referralLevelsApi.updateTier(id, {
        min_sum_rub: parseFloat(editData.min_sum_rub),
        max_sum_rub: editData.max_sum_rub ? parseFloat(editData.max_sum_rub) : null,
        bonus_percent: parseFloat(editData.bonus_percent),
        label: editData.label || null,
        sort_order: parseInt(editData.sort_order) || 0,
      });
      setEditId(null);
      toast.success('Уровень обновлён');
      load();
    } catch {
      toast.error('Ошибка сохранения');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Реферальная система</h1>

      {/* Global stats */}
      {globalStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Рефераллов', value: globalStats.total_referrals },
            { label: 'Реферреров', value: globalStats.total_referrers },
            { label: 'Активных', value: globalStats.active_referrers },
            { label: 'Выплачено бонусов', value: fmtRub(globalStats.total_bonus_amount) + ' ₽' },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow border border-gray-200 dark:border-gray-700 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{s.value}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* First bonus */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">🎁 Бонус за первый обмен реферала</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Фиксированная сумма в рублях, которая начисляется рефереру при первом завершённом обмене его реферала.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="0"
            value={firstBonusInput}
            onChange={(e) => setFirstBonusInput(e.target.value)}
            className="w-40 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="0"
          />
          <span className="text-gray-500 dark:text-gray-400 text-sm">₽</span>
          <button
            onClick={handleSaveFirstBonus}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            Сохранить
          </button>
        </div>
      </div>

      {/* Tiers table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">📈 Уровни реферальной программы</h2>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Добавить уровень
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['Название', 'От (₽)', 'До (₽)', '% от прибыли', 'Порядок', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-600 dark:text-gray-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {tiers.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">Уровни не настроены</td>
                </tr>
              )}
              {tiers.map((tier) => (
                editId === tier.id ? (
                  <tr key={tier.id} className="bg-blue-50 dark:bg-blue-900/10">
                    <td className="px-4 py-2">
                      <input value={editData.label} onChange={e => setEditData(d => ({...d, label: e.target.value}))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="Название" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editData.min_sum_rub} onChange={e => setEditData(d => ({...d, min_sum_rub: e.target.value}))}
                        className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editData.max_sum_rub} onChange={e => setEditData(d => ({...d, max_sum_rub: e.target.value}))}
                        className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="∞" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editData.bonus_percent} onChange={e => setEditData(d => ({...d, bonus_percent: e.target.value}))}
                        className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editData.sort_order} onChange={e => setEditData(d => ({...d, sort_order: e.target.value}))}
                        className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" />
                    </td>
                    <td className="px-4 py-2 flex gap-2">
                      <button onClick={() => handleSaveEdit(tier.id)} className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={tier.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{tier.label || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtRub(tier.min_sum_rub)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{tier.max_sum_rub != null ? fmtRub(tier.max_sum_rub) : '∞'}</td>
                    <td className="px-4 py-3">
                      <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full text-xs font-semibold">
                        {tier.bonus_percent}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tier.sort_order}</td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => handleStartEdit(tier)} className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteTier(tier.id)} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              ))}

              {/* Add new tier row */}
              {showAdd && (
                <tr className="bg-green-50 dark:bg-green-900/10">
                  <td className="px-4 py-2">
                    <input value={newTier.label} onChange={e => setNewTier(d => ({...d, label: e.target.value}))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="Название (BASIC, VIP…)" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={newTier.min_sum_rub} onChange={e => setNewTier(d => ({...d, min_sum_rub: e.target.value}))}
                      className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="0" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={newTier.max_sum_rub} onChange={e => setNewTier(d => ({...d, max_sum_rub: e.target.value}))}
                      className="w-28 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="∞" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={newTier.bonus_percent} onChange={e => setNewTier(d => ({...d, bonus_percent: e.target.value}))}
                      className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="%" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={newTier.sort_order} onChange={e => setNewTier(d => ({...d, sort_order: e.target.value}))}
                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="0" />
                  </td>
                  <td className="px-4 py-2 flex gap-2">
                    <button onClick={handleAddTier} className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20 rounded">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setShowAdd(false); setNewTier(emptyTier); }} className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
