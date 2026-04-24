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

// ── Компонент управления одним крипто-кошельком ───────────────────────────────
const CryptoWalletRow = ({ wallet, onSaved, onDeleted }) => {
  const [showModal, setShowModal] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const fetchBalance = async () => {
    if (!wallet.configured) return;
    setBalanceLoading(true);
    try {
      const res = await settingsApi.getCryptoWalletBalance(wallet.coin);
      setBalance(res.data);
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (wallet.configured) fetchBalance();
  }, [wallet.configured, wallet.coin]);

  const handleSave = async () => {
    if (!mnemonic.trim()) return;
    setSaving(true);
    try {
      const res = await settingsApi.setCryptoWallet(wallet.coin, mnemonic.trim());
      toast.success(`Кошелёк ${wallet.coin} сохранён. Адрес: ${res.data.address}`);
      setShowModal(false);
      setMnemonic('');
      onSaved(wallet.coin, res.data.address);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Удалить кошелёк ${wallet.coin}? Сид-фраза будет стёрта.`)) return;
    try {
      await settingsApi.deleteCryptoWallet(wallet.coin);
      toast.success(`Кошелёк ${wallet.coin} удалён`);
      onDeleted(wallet.coin);
    } catch (e) {
      toast.error('Ошибка удаления');
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await settingsApi.toggleCryptoWallet(wallet.coin, !wallet.is_active);
      toast.success(`Авто-выдача ${wallet.coin} ${!wallet.is_active ? 'включена' : 'отключена'}`);
      onSaved(wallet.coin, wallet.address, !wallet.is_active);
    } catch (e) {
      toast.error('Ошибка');
    } finally {
      setToggling(false);
    }
  };

  const shortAddr = wallet.address
    ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`
    : null;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <span className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100 w-12">{wallet.coin}</span>
        {wallet.configured ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{shortAddr}</span>
            <span className={`text-xs font-semibold ${wallet.is_active ? 'text-green-600' : 'text-yellow-600'}`}>
              {wallet.is_active ? '● Активен' : '○ Отключён'}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-300">
              {balanceLoading
                ? 'Загрузка баланса...'
                : balance !== null
                  ? `Баланс: ${balance.balance_btc} BTC`
                  : 'Баланс недоступен'}
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">Не настроен</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {wallet.configured && (
          <button
            type="button"
            onClick={fetchBalance}
            disabled={balanceLoading}
            title="Обновить баланс"
            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {balanceLoading ? '...' : '↻'}
          </button>
        )}
        {wallet.configured && (
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className={`px-2 py-1 rounded text-xs font-medium ${
              wallet.is_active
                ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'
            }`}
          >
            {wallet.is_active ? 'Отключить' : 'Включить'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"
        >
          {wallet.configured ? 'Заменить' : 'Настроить'}
        </button>
        {wallet.configured && (
          <button
            type="button"
            onClick={handleDelete}
            className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          >
            Удалить
          </button>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Сид-фраза для {wallet.coin}
            </h3>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 mb-4">
              ⚠️ Храните сид-фразу в безопасном месте. Она даёт полный доступ к кошельку.
              Система использует путь деривации BIP44 m/44'/0'/0'/0/0.
            </p>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="word1 word2 word3 ... word12"
              rows={3}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowModal(false); setMnemonic(''); }}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !mnemonic.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyWallet, setCompanyWallet] = useState('');
  const [operatorTakeStartMessage1, setOperatorTakeStartMessage1] = useState('');
  const [operatorTakeStartMessage2, setOperatorTakeStartMessage2] = useState('');
  const [quickRepliesText, setQuickRepliesText] = useState('');
  const [cryptoWallets, setCryptoWallets] = useState([]);

  const role = String(user?.role || '').toUpperCase();
  const canEditFinance = role === 'SUPERADMIN';
  const canEditQuickReplies = role === 'SUPERADMIN' || role === 'MANAGER';

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);

        if (canEditFinance) {
          const [financeResponse, walletsResponse] = await Promise.all([
            settingsApi.getFinanceSettings(),
            settingsApi.getCryptoWallets(),
          ]);
          setCompanyWallet(financeResponse.data?.company_usdt_wallet_trc20 || '');
          setOperatorTakeStartMessage1(financeResponse.data?.operator_take_start_message_1 || '');
          setOperatorTakeStartMessage2(financeResponse.data?.operator_take_start_message_2 || '');
          setCryptoWallets(Array.isArray(walletsResponse.data) ? walletsResponse.data : []);
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

  const handleWalletSaved = (coin, address, isActive) => {
    setCryptoWallets(prev =>
      prev.map(w => w.coin === coin
        ? { ...w, configured: true, address, is_active: isActive !== undefined ? isActive : w.is_active }
        : w
      )
    );
  };

  const handleWalletDeleted = (coin) => {
    setCryptoWallets(prev =>
      prev.map(w => w.coin === coin
        ? { ...w, configured: false, address: null, is_active: false }
        : w
      )
    );
  };

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

      {canEditFinance && (
        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Кошельки для авто-выдачи
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Когда кассир подтверждает получение оплаты — система автоматически отправляет
              криптовалюту клиенту и закрывает заявку с хешем транзакции.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400">Загрузка...</p>
          ) : cryptoWallets.length === 0 ? (
            <p className="text-sm text-gray-400">Нет поддерживаемых монет</p>
          ) : (
            <div className="space-y-2">
              {cryptoWallets.map(wallet => (
                <CryptoWalletRow
                  key={wallet.coin}
                  wallet={wallet}
                  onSaved={handleWalletSaved}
                  onDeleted={handleWalletDeleted}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default SettingsPage;
