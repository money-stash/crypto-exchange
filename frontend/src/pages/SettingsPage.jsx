import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { settingsApi, botsApi, ratesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import FeeTiersModal from '../components/FeeTiersModal';
import TelegramTextEditor from '../components/TelegramTextEditor';
import Modal from '../components/Modal';
import { Bot, Edit, Settings, Save, Loader2 } from 'lucide-react';

const parseQuickRepliesText = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
);

// ── Крипто-кошелёк ─────────────────────────────────────────────────────────
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
    } catch { setBalance(null); }
    finally { setBalanceLoading(false); }
  };

  useEffect(() => { if (wallet.configured) fetchBalance(); }, [wallet.configured, wallet.coin]);

  const handleSave = async () => {
    if (!mnemonic.trim()) return;
    setSaving(true);
    try {
      const res = await settingsApi.setCryptoWallet(wallet.coin, mnemonic.trim());
      toast.success(`Кошелёк ${wallet.coin} сохранён. Адрес: ${res.data.address}`);
      setShowModal(false); setMnemonic('');
      onSaved(wallet.coin, res.data.address);
    } catch (e) { toast.error(e.response?.data?.detail || 'Ошибка сохранения'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Удалить кошелёк ${wallet.coin}? Сид-фраза будет стёрта.`)) return;
    try {
      await settingsApi.deleteCryptoWallet(wallet.coin);
      toast.success(`Кошелёк ${wallet.coin} удалён`);
      onDeleted(wallet.coin);
    } catch { toast.error('Ошибка удаления'); }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await settingsApi.toggleCryptoWallet(wallet.coin, !wallet.is_active);
      toast.success(`Авто-выдача ${wallet.coin} ${!wallet.is_active ? 'включена' : 'отключена'}`);
      onSaved(wallet.coin, wallet.address, !wallet.is_active);
    } catch { toast.error('Ошибка'); }
    finally { setToggling(false); }
  };

  const shortAddr = wallet.address ? `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}` : null;

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
              {balanceLoading ? 'Загрузка баланса...' : balance !== null ? `Баланс: ${balance.balance_btc} BTC` : 'Баланс недоступен'}
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-400 dark:text-gray-500">Не настроен</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {wallet.configured && (
          <button type="button" onClick={fetchBalance} disabled={balanceLoading} title="Обновить баланс"
            className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
            {balanceLoading ? '...' : '↻'}
          </button>
        )}
        {wallet.configured && (
          <button type="button" onClick={handleToggle} disabled={toggling}
            className={`px-2 py-1 rounded text-xs font-medium ${wallet.is_active ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400'}`}>
            {wallet.is_active ? 'Отключить' : 'Включить'}
          </button>
        )}
        <button type="button" onClick={() => setShowModal(true)}
          className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400">
          {wallet.configured ? 'Заменить' : 'Настроить'}
        </button>
        {wallet.configured && (
          <button type="button" onClick={handleDelete}
            className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400">
            Удалить
          </button>
        )}
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Сид-фраза для {wallet.coin}</h3>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 mb-4">
              ⚠️ Храните сид-фразу в безопасном месте. Она даёт полный доступ к кошельку. Система использует путь деривации BIP44 m/44'/0'/0'/0/0.
            </p>
            <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)}
              placeholder="word1 word2 word3 ... word12" rows={3} autoComplete="off" spellCheck={false}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 mb-4" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowModal(false); setMnemonic(''); }}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300">Отмена</button>
              <button type="button" onClick={handleSave} disabled={saving || !mnemonic.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Настройки выбранного бота ───────────────────────────────────────────────
const BotSettingsSection = ({ botId }) => {
  const [bot, setBot] = useState(null);
  const [feeTiers, setFeeTiers] = useState({});
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showStartMsgModal, setShowStartMsgModal] = useState(false);
  const [startMessage, setStartMessage] = useState('');
  const [savingStart, setSavingStart] = useState(false);

  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactsMessage, setContactsMessage] = useState('');
  const [savingContacts, setSavingContacts] = useState(false);

  const [showFeeTiersModal, setShowFeeTiersModal] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [botRes, tiersRes, ratesRes] = await Promise.all([
        botsApi.getBot(botId),
        botsApi.getBotFeeTiers(botId),
        ratesApi.getRates(),
      ]);
      setBot(botRes.data);
      const byCoins = (tiersRes.data || []).reduce((acc, t) => {
        if (!acc[t.coin]) acc[t.coin] = [];
        acc[t.coin].push(t);
        return acc;
      }, {});
      setFeeTiers(byCoins);
      setRates(ratesRes.data || []);
    } catch { toast.error('Ошибка загрузки данных бота'); }
    finally { setLoading(false); }
  }, [botId]);

  useEffect(() => { load(); }, [load]);

  const handleSaveStart = async () => {
    setSavingStart(true);
    try {
      await botsApi.updateBot(botId, { start_message: startMessage || null });
      toast.success('Стартовое сообщение обновлено');
      setShowStartMsgModal(false);
      setBot(prev => ({ ...prev, start_message: startMessage || null }));
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSavingStart(false); }
  };

  const handleSaveContacts = async () => {
    setSavingContacts(true);
    try {
      await botsApi.updateBot(botId, { contacts_message: contactsMessage || null });
      toast.success('Контакты обновлены');
      setShowContactsModal(false);
      setBot(prev => ({ ...prev, contacts_message: contactsMessage || null }));
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSavingContacts(false); }
  };

  const formatCoinAmount = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return n.toFixed(8).replace(/\.?0+$/, '');
  };

  if (loading) return <div className="py-6 text-center text-sm text-gray-400">Загрузка настроек бота...</div>;
  if (!bot) return null;

  return (
    <div className="space-y-4">
      {/* имя и статус */}
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{bot.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bot.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
          {bot.is_active ? 'Активен' : 'Отключён'}
        </span>
      </div>

      {/* сообщения */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => { setStartMessage(bot.start_message || ''); setShowStartMsgModal(true); }}
          className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left">
          <Edit className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Стартовое сообщение</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{bot.start_message ? 'Настроено' : 'По умолчанию'}</p>
          </div>
        </button>
        <button onClick={() => { setContactsMessage(bot.contacts_message || ''); setShowContactsModal(true); }}
          className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left">
          <Edit className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Контакты</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{bot.contacts_message ? 'Настроено' : 'По умолчанию'}</p>
          </div>
        </button>
      </div>

      {/* диапазоны сумм */}
      {rates.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Диапазоны сумм по монетам</p>
          <div className="space-y-1.5">
            {rates.map((rate) => {
              const tiers = [...(feeTiers[rate.coin] || [])].sort((a, b) => Number(a.min_amount) - Number(b.min_amount));
              const minTier = tiers[0];
              const lastTier = tiers[tiers.length - 1];
              const hasMax = Boolean(lastTier?.max_amount != null && lastTier.max_amount !== '');
              const rateRub = Number(rate.rate_rub || 0);
              const minCoin = minTier && rateRub > 0 ? Number(minTier.min_amount) / rateRub : null;
              const maxCoin = hasMax && rateRub > 0 ? Number(lastTier.max_amount) / rateRub : null;
              return (
                <div key={rate.coin} className="flex items-center justify-between py-1.5 px-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200 w-12">{rate.coin}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {tiers.length > 0
                        ? `${minCoin !== null ? formatCoinAmount(minCoin) : '?'} — ${maxCoin !== null ? formatCoinAmount(maxCoin) : '∞'} ${rate.coin}`
                        : 'не настроено'}
                    </span>
                  </div>
                  <button onClick={() => { setSelectedCoin(rate.coin); setShowFeeTiersModal(true); }}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                    <Settings className="w-3 h-3" />
                    {tiers.length > 0 ? `${tiers.length} диап.` : 'Настроить'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* модалки */}
      <Modal isOpen={showStartMsgModal} onClose={() => setShowStartMsgModal(false)} title="Стартовое сообщение">
        <div className="space-y-4">
          <TelegramTextEditor value={startMessage} onChange={(text) => setStartMessage(text)}
            placeholder="Введите стартовое сообщение..." maxLength={4096} disabled={savingStart} hideAttachments={true} />
          <div className="flex gap-3">
            <button onClick={handleSaveStart} disabled={savingStart}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
              {savingStart ? <><Loader2 className="w-4 h-4 animate-spin" /> Сохранение...</> : <><Save className="w-4 h-4" /> Сохранить</>}
            </button>
            <button onClick={() => setShowStartMsgModal(false)} disabled={savingStart}
              className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showContactsModal} onClose={() => setShowContactsModal(false)} title='Раздел "Контакты"'>
        <div className="space-y-4">
          <TelegramTextEditor value={contactsMessage} onChange={(text) => setContactsMessage(text)}
            placeholder='Введите текст для раздела "Контакты"...' maxLength={4096} disabled={savingContacts} hideAttachments={true} />
          <div className="flex gap-3">
            <button onClick={handleSaveContacts} disabled={savingContacts}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
              {savingContacts ? <><Loader2 className="w-4 h-4 animate-spin" /> Сохранение...</> : <><Save className="w-4 h-4" /> Сохранить</>}
            </button>
            <button onClick={() => setShowContactsModal(false)} disabled={savingContacts}
              className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      <FeeTiersModal isOpen={showFeeTiersModal} onClose={() => setShowFeeTiersModal(false)}
        botId={botId} selectedCoin={selectedCoin}
        initialTiers={feeTiers[selectedCoin] || []}
        onSave={() => botsApi.getBotFeeTiers(botId).then(r => {
          const byCoins = (r.data || []).reduce((acc, t) => { if (!acc[t.coin]) acc[t.coin] = []; acc[t.coin].push(t); return acc; }, {});
          setFeeTiers(byCoins);
        })} />
    </div>
  );
};

// ── Адреса для пополнения депозита кассиров ────────────────────────────────
const DEPOSIT_COINS = [
  { coin: 'USDT', label: 'USDT TRC20', placeholder: 'T...' },
];

const CashierDepositWalletsSection = () => {
  const [wallets, setWallets] = useState({ USDT: null });
  const [editing, setEditing] = useState(null); // coin string
  const [inputVal, setInputVal] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await settingsApi.getCashierDepositWallets();
      setWallets(res.data.wallets);
    } catch { toast.error('Ошибка загрузки депозитных кошельков'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (coin) => {
    setEditing(coin);
    setInputVal(wallets[coin] || '');
  };

  const handleSave = async () => {
    if (!inputVal.trim()) return toast.error('Введите адрес');
    setSaving(true);
    try {
      await settingsApi.setCashierDepositWallet(editing, inputVal.trim());
      toast.success(`Адрес ${editing} сохранён`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка сохранения');
    } finally { setSaving(false); }
  };

  const handleDelete = async (coin) => {
    if (!window.confirm(`Удалить адрес ${coin} для депозита кассиров?`)) return;
    try {
      await settingsApi.deleteCashierDepositWallet(coin);
      toast.success(`Адрес ${coin} удалён`);
      load();
    } catch { toast.error('Ошибка'); }
  };

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Адреса для пополнения депозита кассиров</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Кассиры отправляют средства на эти адреса и прикладывают хеш транзакции — система верифицирует и зачисляет депозит автоматически.
        </p>
      </div>
      <div className="space-y-3">
        {DEPOSIT_COINS.map(({ coin, label, placeholder }) => (
          <div key={coin} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</p>
              {wallets[coin] ? (
                <p className="font-mono text-sm text-gray-900 dark:text-white break-all mt-0.5">{wallets[coin]}</p>
              ) : (
                <p className="text-sm text-gray-400 italic mt-0.5">Не настроен — кассиры не смогут пополнить депозит в {coin}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => openEdit(coin)}
                className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors">
                {wallets[coin] ? 'Изменить' : 'Задать'}
              </button>
              {wallets[coin] && (
                <button onClick={() => handleDelete(coin)}
                  className="px-3 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                  Удалить
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Адрес для пополнения в {editing}
            </h3>
            <input
              className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              placeholder={DEPOSIT_COINS.find(c => c.coin === editing)?.placeholder}
            />
            <p className="text-xs text-gray-400 mt-1">
              Кассиры будут отправлять средства на этот адрес для пополнения депозита.
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                Отмена
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// ── Главная страница настроек ───────────────────────────────────────────────
const SettingsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyWallet, setCompanyWallet] = useState('');
  const [operatorTakeStartMessage1, setOperatorTakeStartMessage1] = useState('');
  const [operatorTakeStartMessage2, setOperatorTakeStartMessage2] = useState('');
  const [quickRepliesText, setQuickRepliesText] = useState('');
  const [cryptoWallets, setCryptoWallets] = useState([]);

  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState(null);
  const [botsLoading, setBotsLoading] = useState(true);

  const role = String(user?.role || '').toUpperCase();
  const canEditFinance = role === 'SUPERADMIN';
  const canEditQuickReplies = role === 'SUPERADMIN' || role === 'MANAGER';
  const canEditBots = role === 'SUPERADMIN' || role === 'EX_ADMIN';

  // Загрузка ботов
  useEffect(() => {
    if (!canEditBots) { setBotsLoading(false); return; }
    botsApi.getBots({ limit: 100 })
      .then(r => {
        const list = r.data?.data?.bots || r.data?.bots || [];
        setBots(list);
        if (list.length > 0) setSelectedBotId(list[0].id);
      })
      .catch(() => toast.error('Не удалось загрузить список ботов'))
      .finally(() => setBotsLoading(false));
  }, [canEditBots]);

  // Загрузка глобальных настроек
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
            ? quickRepliesResponse.data.operator_chat_quick_replies : [];
          setQuickRepliesText(quickReplies.join('\n'));
        }
      } catch { toast.error('Не удалось загрузить настройки'); }
      finally { setLoading(false); }
    };
    loadSettings();
  }, [canEditFinance, canEditQuickReplies]);

  const handleWalletSaved = (coin, address, isActive) => {
    setCryptoWallets(prev => prev.map(w => w.coin === coin
      ? { ...w, configured: true, address, is_active: isActive !== undefined ? isActive : w.is_active } : w));
  };
  const handleWalletDeleted = (coin) => {
    setCryptoWallets(prev => prev.map(w => w.coin === coin
      ? { ...w, configured: false, address: null, is_active: false } : w));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      const saveTasks = [];
      if (canEditFinance) {
        saveTasks.push(settingsApi.updateFinanceSettings({
          company_usdt_wallet_trc20: companyWallet.trim(),
          operator_take_start_message_1: operatorTakeStartMessage1.trim(),
          operator_take_start_message_2: operatorTakeStartMessage2.trim()
        }));
      }
      if (canEditQuickReplies) {
        saveTasks.push(settingsApi.updateChatQuickReplies({
          operator_chat_quick_replies: parseQuickRepliesText(quickRepliesText)
        }));
      }
      if (!saveTasks.length) { toast.info('Нет доступных настроек для сохранения'); return; }
      await Promise.all(saveTasks);
      toast.success('Настройки обновлены');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить настройки');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Настройки</h1>

      {/* ── Селектор бота ── */}
      {canEditBots && (
        <section className="card space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Настройки бота</h2>
          </div>

          {botsLoading ? (
            <p className="text-sm text-gray-400">Загрузка ботов...</p>
          ) : bots.length === 0 ? (
            <p className="text-sm text-gray-400">Нет ботов</p>
          ) : (
            <>
              {/* список ботов */}
              <div className="flex flex-wrap gap-2">
                {bots.map(bot => (
                  <button
                    key={bot.id}
                    onClick={() => setSelectedBotId(bot.id)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      selectedBotId === bot.id
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${bot.is_active ? 'bg-green-400' : 'bg-gray-400'}`} />
                    {bot.name}
                  </button>
                ))}
              </div>

              {/* настройки выбранного бота */}
              {selectedBotId && (
                <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                  <BotSettingsSection key={selectedBotId} botId={selectedBotId} />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Глобальные настройки ── */}
      <form onSubmit={handleSave} className="space-y-4">
        {canEditFinance && (
          <section className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Финансы</h2>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">USDT TRC20 адрес компании</label>
              <input type="text" value={companyWallet} onChange={(e) => setCompanyWallet(e.target.value)}
                placeholder="T..." disabled={loading || saving}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Этот адрес используется для погашения USDT-долгов операторов.</p>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Стартовое сообщение 1 (после взятия заявки)</label>
              <textarea value={operatorTakeStartMessage1} onChange={(e) => setOperatorTakeStartMessage1(e.target.value)}
                placeholder="Добро пожаловать на Obmennik. Я ваш личный оператор, быстро проведу сделку."
                disabled={loading || saving} rows={3}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y" />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Стартовое сообщение 2 (через 1 секунду)</label>
              <textarea value={operatorTakeStartMessage2} onChange={(e) => setOperatorTakeStartMessage2(e.target.value)}
                placeholder="Какой банк?" disabled={loading || saving} rows={2}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Эти сообщения отправляются клиенту автоматически, когда оператор берет заявку.</p>
            </div>
          </section>
        )}

        {canEditQuickReplies && (
          <section className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Быстрые фразы в чате с клиентом</h2>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Фразы (каждая с новой строки)</label>
              <textarea value={quickRepliesText} onChange={(e) => setQuickRepliesText(e.target.value)}
                placeholder={'Жду оплату\nКакой банк?\nПроверьте, пожалуйста, перевод'}
                disabled={loading || saving} rows={8}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 resize-y" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Эти фразы показываются оператору в кнопке справа от поля ввода в чате заявки.</p>
            </div>
          </section>
        )}

        {(canEditFinance || canEditQuickReplies) && (
          <div className="flex justify-end">
            <button type="submit" disabled={loading || saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        )}
      </form>

      {canEditFinance && (
        <section className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Кошельки для авто-выдачи</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Когда кассир подтверждает получение оплаты — система автоматически отправляет криптовалюту клиенту и закрывает заявку с хешем транзакции.
            </p>
          </div>
          {loading ? (
            <p className="text-sm text-gray-400">Загрузка...</p>
          ) : cryptoWallets.length === 0 ? (
            <p className="text-sm text-gray-400">Нет поддерживаемых монет</p>
          ) : (
            <div className="space-y-2">
              {cryptoWallets.map(wallet => (
                <CryptoWalletRow key={wallet.coin} wallet={wallet} onSaved={handleWalletSaved} onDeleted={handleWalletDeleted} />
              ))}
            </div>
          )}
        </section>
      )}

      {canEditFinance && <CashierDepositWalletsSection />}
    </div>
  );
};

export default SettingsPage;
