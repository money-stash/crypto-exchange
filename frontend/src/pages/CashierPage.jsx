import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import { cashiersApi } from '../services/api';
import { CreditCard, MessageSquare, Send } from 'lucide-react';

const initialForm = {
  card_number: '',
  card_holder: '',
  bank_name: '',
  min_amount: '',
  max_amount: '',
  total_volume_limit: '',
  interval_minutes: '0',
};

const TABS = [
  { key: 'cards', label: 'Мои карты', icon: CreditCard },
  { key: 'chat',  label: 'Чат с менеджером', icon: MessageSquare },
];

function ChatTab() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadChat = useCallback(async () => {
    try {
      const res = await cashiersApi.getMyChat();
      setMessages(res.data.messages || []);
      await cashiersApi.markMyChatRead();
    } catch {
      toast.error('Ошибка загрузки чата');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadChat(); }, [loadChat]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await cashiersApi.sendToManager(text);
      setMessages(prev => [...prev, res.data]);
      setInput('');
    } catch {
      toast.error('Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (dt) => {
    if (!dt) return '';
    return new Date(dt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col" style={{ height: '520px' }}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white">Переписка с менеджером</p>
        <p className="text-xs text-gray-400">Задайте вопрос или сообщите о проблеме</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Нет сообщений. Напишите первым.</p>
        ) : messages.map(msg => {
          const isMe = msg.sender_type === 'CASHIER';
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-xl px-3 py-2 ${
                isMe
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
              }`}>
                <p className="text-sm break-words">{msg.message}</p>
                <p className={`text-xs mt-0.5 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                  {isMe ? 'Вы' : (msg.sender_login || 'Менеджер')} · {fmtTime(msg.created_at)}
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
          placeholder="Написать менеджеру..."
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
    </div>
  );
}

export default function CashierPage() {
  const [tab, setTab] = useState('cards');
  const [stats, setStats] = useState(null);
  const [cards, setCards] = useState([]);
  const [deposit, setDeposit] = useState(null);
  const [depositHistory, setDepositHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editCard, setEditCard] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [extendCard, setExtendCard] = useState(null);
  const [extendAmount, setExtendAmount] = useState('');
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [topupCoin, setTopupCoin] = useState('BTC');
  const [topupTxHash, setTopupTxHash] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [depositTab, setDepositTab] = useState('BTC');

  const load = useCallback(async () => {
    try {
      const [statsRes, cardsRes, depositRes, historyRes] = await Promise.all([
        cashiersApi.getMyStats(),
        cashiersApi.getMyCards(),
        cashiersApi.getMyDeposit(),
        cashiersApi.getMyDepositHistory({ limit: 10 }),
      ]);
      setStats(statsRes.data);
      setCards(cardsRes.data);
      setDeposit(depositRes.data);
      setDepositHistory(historyRes.data.items || []);
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditCard(null);
    setForm(initialForm);
    setShowAddModal(true);
  };

  const openEdit = (card) => {
    setEditCard(card);
    setForm({
      card_number: card.card_number || '',
      card_holder: card.card_holder || '',
      bank_name: card.bank_name || '',
      min_amount: String(card.min_amount ?? ''),
      max_amount: String(card.max_amount ?? ''),
      total_volume_limit: String(card.total_volume_limit ?? ''),
      interval_minutes: String(card.interval_minutes ?? '0'),
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!form.card_number.trim()) return toast.error('Введите номер карты');
    const min = parseFloat(form.min_amount) || 0;
    const max = parseFloat(form.max_amount) || 0;
    if (max <= 0) return toast.error('Укажите максимальную сумму');
    if (min >= max) return toast.error('Минимальная сумма должна быть меньше максимальной');

    setSaving(true);
    try {
      const data = {
        card_number: form.card_number.trim(),
        card_holder: form.card_holder.trim() || null,
        bank_name: form.bank_name.trim() || null,
        min_amount: min,
        max_amount: max,
        total_volume_limit: parseFloat(form.total_volume_limit) || 0,
        interval_minutes: parseInt(form.interval_minutes) || 0,
      };
      if (editCard) {
        await cashiersApi.updateMyCard(editCard.id, data);
        toast.success('Карта обновлена');
      } else {
        await cashiersApi.addMyCard(data);
        toast.success('Карта добавлена');
      }
      setShowAddModal(false);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (card) => {
    if (!window.confirm(`Удалить карту ${card.card_number}?`)) return;
    try {
      await cashiersApi.deleteMyCard(card.id);
      toast.success('Карта удалена');
      load();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleToggle = async (card) => {
    try {
      await cashiersApi.updateMyCard(card.id, { is_active: !card.is_active });
      load();
    } catch {
      toast.error('Ошибка');
    }
  };

  const handleExtend = async () => {
    const extra = parseFloat(extendAmount);
    if (!extra || extra <= 0) return toast.error('Введите сумму расширения');
    try {
      await cashiersApi.extendMyCardLimit(extendCard.id, extra);
      toast.success('Лимит расширен');
      setExtendCard(null);
      setExtendAmount('');
      load();
    } catch {
      toast.error('Ошибка расширения лимита');
    }
  };

  const handleTopup = async () => {
    const hash = topupTxHash.trim();
    if (!hash || hash.length !== 64) return toast.error('Введите корректный хеш транзакции (64 символа)');
    setTopupLoading(true);
    try {
      const res = await cashiersApi.topupMyDeposit({ tx_hash: hash, coin: topupCoin });
      toast.success(res.data.message);
      setShowTopupModal(false);
      setTopupTxHash('');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка пополнения депозита');
    } finally {
      setTopupLoading(false);
    }
  };

  const DEPOSIT_COINS = ['BTC', 'LTC', 'USDT'];
  const coinLabel = { BTC: 'Bitcoin', LTC: 'Litecoin', USDT: 'USDT TRC20' };

  const fmtRub = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const pct = (used, limit) => {
    if (!limit || limit == 0) return null;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Кабинет кассира</h1>
        {tab === 'cards' && (
          <button
            onClick={openAdd}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Добавить карту
          </button>
        )}
      </div>

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

      {tab === 'chat' && <ChatTab />}
      {tab === 'cards' && (<>

      {/* Deposit panel */}
      {deposit && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Мой депозит</h2>
            <button
              onClick={() => { setShowTopupModal(true); setTopupCoin(depositTab); setTopupTxHash(''); }}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Пополнить
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {[
              {
                label: 'Доступно',
                value: `${fmtRub(deposit.available)} ₽`,
                cls: deposit.available <= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
              },
              { label: 'Заморожено', value: `${fmtRub(deposit.deposit_work)} ₽`, cls: 'text-yellow-600 dark:text-yellow-400' },
              { label: 'Всего депозит', value: `${fmtRub(deposit.deposit)} ₽`, cls: '' },
              { label: 'Выплачено всего', value: `${fmtRub(deposit.deposit_paid)} ₽`, cls: '' },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                <p className={`text-lg font-semibold mt-0.5 ${s.cls || 'text-gray-900 dark:text-white'}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {deposit.available <= 0 && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-400">
              Депозит исчерпан. Вы не сможете принимать новые заявки. Пополните депозит.
            </div>
          )}

          {/* Coin tabs + address */}
          <div>
            <div className="flex gap-1 mb-3">
              {DEPOSIT_COINS.map(c => (
                <button key={c} onClick={() => setDepositTab(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    depositTab === c
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
            {deposit.wallets?.[depositTab] ? (
              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Адрес для пополнения ({coinLabel[depositTab]})
                </p>
                <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                  {deposit.wallets[depositTab]}
                </code>
                {deposit.rates?.[depositTab] > 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Курс {depositTab}: {fmtRub(deposit.rates[depositTab])} ₽/{depositTab}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-sm text-gray-400 italic">
                Адрес {depositTab} не настроен администратором.
              </div>
            )}
          </div>

          {depositHistory.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">История пополнений</p>
              <div className="space-y-1.5">
                {depositHistory.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        item.status === 'CONFIRMED' ? 'bg-green-500' :
                        item.status === 'REJECTED' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      <span className="font-mono text-gray-600 dark:text-gray-300 truncate">
                        {item.coin === 'MANUAL' ? 'Ручное' : `${Number(item.amount_coin).toFixed(8)} BTC`}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <span className="font-medium text-gray-900 dark:text-white">+{fmtRub(item.amount_rub)} ₽</span>
                      <span className="text-gray-400 ml-2">{new Date(item.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Карт активных', value: `${stats.active_cards} / ${stats.total_cards}` },
            { label: 'Общий объём', value: `${fmtRub(stats.total_volume_limit)} ₽` },
            { label: 'Использовано', value: `${fmtRub(stats.current_volume)} ₽` },
            { label: 'Завершено сегодня', value: `${fmtRub(stats.today_volume)} ₽` },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Limit reached alerts */}
      {cards.filter(c => c.limit_reached_notified).map(card => (
        <div key={card.id} className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              Карта <span className="font-mono">{card.card_number}</span> достигла лимита ({fmtRub(card.total_volume_limit)} ₽)
            </p>
            <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">Пополните лимит, чтобы карта снова стала активной</p>
          </div>
          <button
            onClick={() => { setExtendCard(card); setExtendAmount(''); }}
            className="ml-4 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Расширить лимит
          </button>
        </div>
      ))}

      {/* Cards list */}
      {cards.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          Карт нет. Добавьте первую карту.
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map(card => {
            const usedPct = pct(card.current_volume, card.total_volume_limit);
            const atLimit = !!card.limit_reached_notified;
            return (
              <div key={card.id} className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition-all ${
                atLimit ? 'border-yellow-300 dark:border-yellow-700' :
                card.is_active ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-base font-semibold text-gray-900 dark:text-white">
                        {card.card_number}
                      </span>
                      {card.bank_name && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded px-2 py-0.5">
                          {card.bank_name}
                        </span>
                      )}
                      {card.card_holder && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{card.card_holder}</span>
                      )}
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                        atLimit ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400' :
                        card.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-500'
                      }`}>
                        {atLimit ? 'Лимит' : card.is_active ? 'Активна' : 'Отключена'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>Диапазон: {fmtRub(card.min_amount)} – {fmtRub(card.max_amount)} ₽</span>
                      {card.interval_minutes > 0 && (
                        <span>Интервал: {card.interval_minutes} мин</span>
                      )}
                      {parseFloat(card.total_volume_limit) > 0 && (
                        <span>Объём: {fmtRub(card.current_volume)} / {fmtRub(card.total_volume_limit)} ₽</span>
                      )}
                    </div>

                    {usedPct !== null && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              usedPct >= 100 ? 'bg-yellow-500' :
                              usedPct >= 80 ? 'bg-orange-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">{usedPct}%</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {atLimit && (
                      <button
                        onClick={() => { setExtendCard(card); setExtendAmount(''); }}
                        className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        +Лимит
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(card)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        card.is_active
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/60'
                      }`}
                    >
                      {card.is_active ? 'Выкл' : 'Вкл'}
                    </button>
                    <button
                      onClick={() => openEdit(card)}
                      className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      Изменить
                    </button>
                    <button
                      onClick={() => handleDelete(card)}
                      className="px-3 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit card modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editCard ? 'Редактировать карту' : 'Добавить карту'}
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Номер карты *', key: 'card_number', placeholder: '0000 0000 0000 0000', type: 'text' },
                { label: 'Держатель', key: 'card_holder', placeholder: 'Иван И.', type: 'text' },
                { label: 'Банк', key: 'bank_name', placeholder: 'Сбербанк', type: 'text' },
                { label: 'Мин. сумма (₽) *', key: 'min_amount', placeholder: '2000', type: 'number' },
                { label: 'Макс. сумма (₽) *', key: 'max_amount', placeholder: '40000', type: 'number' },
                { label: 'Общий лимит (₽, 0 = безлимит)', key: 'total_volume_limit', placeholder: '100000', type: 'number' },
                { label: 'Интервал между транзакциями (мин, 0 = нет)', key: 'interval_minutes', placeholder: '30', type: 'number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-up deposit modal */}
      {showTopupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Пополнить депозит</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Отправьте криптовалюту на адрес системы, затем вставьте хеш транзакции.
              Сумма будет зачислена в рублях по курсу на момент проверки.
            </p>

            {/* Coin selector */}
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Монета</label>
            <div className="flex gap-2 mb-4">
              {DEPOSIT_COINS.map(c => (
                <button key={c} type="button" onClick={() => { setTopupCoin(c); setTopupTxHash(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    topupCoin === c
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}>
                  {c}
                </button>
              ))}
            </div>

            {deposit?.wallets?.[topupCoin] ? (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Адрес системы ({coinLabel[topupCoin]})
                </p>
                <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                  {deposit.wallets[topupCoin]}
                </code>
              </div>
            ) : (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-700 dark:text-yellow-400">
                Адрес {topupCoin} не настроен. Обратитесь к администратору.
              </div>
            )}

            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Хеш транзакции (64 символа)
            </label>
            <input
              type="text"
              value={topupTxHash}
              onChange={e => setTopupTxHash(e.target.value.trim())}
              placeholder="a1b2c3d4...  (64 символа)"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">{topupTxHash.length}/64 символов</p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowTopupModal(false); setTopupTxHash(''); }}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleTopup}
                disabled={topupLoading || topupTxHash.length !== 64 || !deposit?.wallets?.[topupCoin]}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {topupLoading ? 'Проверка...' : 'Проверить и зачислить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend limit modal */}
      {extendCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Расширить лимит</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Карта <span className="font-mono font-medium">{extendCard.card_number}</span><br/>
              Текущий лимит: {fmtRub(extendCard.total_volume_limit)} ₽
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
                onClick={() => setExtendCard(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleExtend}
                className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Расширить
              </button>
            </div>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
