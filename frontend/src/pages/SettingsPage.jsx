import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { settingsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const parseQuickRepliesText = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
);

const SettingsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyWallet, setCompanyWallet] = useState('');
  const [operatorTakeStartMessage1, setOperatorTakeStartMessage1] = useState('');
  const [operatorTakeStartMessage2, setOperatorTakeStartMessage2] = useState('');
  const [quickRepliesText, setQuickRepliesText] = useState('');

  const role = String(user?.role || '').toUpperCase();
  const canEditFinance = role === 'SUPERADMIN';
  const canEditQuickReplies = role === 'SUPERADMIN' || role === 'MANAGER';

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);

        if (canEditFinance) {
          const financeResponse = await settingsApi.getFinanceSettings();
          setCompanyWallet(financeResponse.data?.company_usdt_wallet_trc20 || '');
          setOperatorTakeStartMessage1(financeResponse.data?.operator_take_start_message_1 || '');
          setOperatorTakeStartMessage2(financeResponse.data?.operator_take_start_message_2 || '');
        }

        if (canEditQuickReplies) {
          const quickRepliesResponse = await settingsApi.getChatQuickReplies();
          const quickReplies = Array.isArray(quickRepliesResponse.data?.operator_chat_quick_replies)
            ? quickRepliesResponse.data.operator_chat_quick_replies
            : [];
          setQuickRepliesText(quickReplies.join('\n'));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        toast.error('Не удалось загрузить настройки');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [canEditFinance, canEditQuickReplies]);

  const handleSave = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      const saveTasks = [];

      if (canEditFinance) {
        saveTasks.push(
          settingsApi.updateFinanceSettings({
            company_usdt_wallet_trc20: companyWallet.trim(),
            operator_take_start_message_1: operatorTakeStartMessage1.trim(),
            operator_take_start_message_2: operatorTakeStartMessage2.trim()
          })
        );
      }

      if (canEditQuickReplies) {
        saveTasks.push(
          settingsApi.updateChatQuickReplies({
            operator_chat_quick_replies: parseQuickRepliesText(quickRepliesText)
          })
        );
      }

      if (!saveTasks.length) {
        toast.info('Нет доступных настроек для сохранения');
        return;
      }

      await Promise.all(saveTasks);
      toast.success('Настройки обновлены');
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error(error.response?.data?.error || 'Не удалось сохранить настройки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Настройки</h1>

      <form onSubmit={handleSave} className="space-y-4">
        {canEditFinance && (
          <section className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Финансы</h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                USDT TRC20 адрес компании
              </label>
              <input
                type="text"
                value={companyWallet}
                onChange={(e) => setCompanyWallet(e.target.value)}
                placeholder="T..."
                disabled={loading || saving}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Этот адрес используется для погашения USDT-долгов операторов.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Стартовое сообщение 1 (после взятия заявки)
              </label>
              <textarea
                value={operatorTakeStartMessage1}
                onChange={(e) => setOperatorTakeStartMessage1(e.target.value)}
                placeholder="Добро пожаловать на Obmennik. Я ваш личный оператор, быстро проведу сделку."
                disabled={loading || saving}
                rows={3}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Стартовое сообщение 2 (через 1 секунду)
              </label>
              <textarea
                value={operatorTakeStartMessage2}
                onChange={(e) => setOperatorTakeStartMessage2(e.target.value)}
                placeholder="Какой банк?"
                disabled={loading || saving}
                rows={2}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Эти сообщения отправляются клиенту автоматически, когда оператор берет заявку.
              </p>
            </div>
          </section>
        )}

        {canEditQuickReplies && (
          <section className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Быстрые фразы в чате с клиентом
            </h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Фразы (каждая с новой строки)
              </label>
              <textarea
                value={quickRepliesText}
                onChange={(e) => setQuickRepliesText(e.target.value)}
                placeholder={'Жду оплату\nКакой банк?\nПроверьте, пожалуйста, перевод'}
                disabled={loading || saving}
                rows={8}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Эти фразы показываются оператору в кнопке справа от поля ввода в чате заявки.
              </p>
            </div>
          </section>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading || saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
