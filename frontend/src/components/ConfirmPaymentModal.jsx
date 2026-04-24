import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X } from 'lucide-react';

/**
 * Модал подтверждения оплаты.
 * Оператор всегда меняет USDT — вводит курс RUB/USDT и/или сумму USDT.
 *
 * Props:
 *   isOpen           — показать/скрыть
 *   onClose          — закрыть без сохранения
 *   onConfirm        — ({ receivedUsdt, usdtRateRub }) => void
 *   order            — объект заявки (dir, amount_coin, sum_rub, coin)
 *   currentUsdtRate  — текущий курс USDT из БД (предзаполняем)
 *   operatorType     — 'manual' | 'card' | 'auto'
 */
export default function ConfirmPaymentModal({
  isOpen,
  onClose,
  onConfirm,
  order,
  currentUsdtRate = null,
  operatorType = 'manual',
}) {
  const [usdtRateRub, setUsdtRateRub] = useState('');
  const [receivedUsdt, setReceivedUsdt] = useState('');
  const [editingRate, setEditingRate] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const sumRub = parseFloat(order?.sum_rub || 0);
      const rate = currentUsdtRate;
      if (rate && rate > 0) {
        setUsdtRateRub(String(rate.toFixed(2)));
        setReceivedUsdt(sumRub > 0 ? String((sumRub / rate).toFixed(2)) : '');
      } else {
        setUsdtRateRub('');
        setReceivedUsdt('');
      }
      setEditingRate(false);
    }
  }, [isOpen, order, currentUsdtRate]);

  useEffect(() => {
    if (!isOpen) return;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = 'unset'; };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sumRub = parseFloat(order?.sum_rub || 0);
  const dir = order?.dir || 'BUY';
  const coin = order?.coin || 'USDT';
  const amountCoin = parseFloat(order?.amount_coin || 0);

  const rate = parseFloat(usdtRateRub) || 0;
  const received = parseFloat(receivedUsdt) || 0;

  // При изменении курса — пересчитываем USDT (если пользователь не редактирует USDT вручную)
  const handleRateChange = (val) => {
    setUsdtRateRub(val);
    const r = parseFloat(val) || 0;
    if (r > 0 && sumRub > 0 && !editingRate) {
      setReceivedUsdt((sumRub / r).toFixed(2));
    }
  };

  // При изменении USDT — пересчитываем курс
  const handleUsdtChange = (val) => {
    setReceivedUsdt(val);
    const u = parseFloat(val) || 0;
    if (u > 0 && sumRub > 0) {
      setUsdtRateRub((sumRub / u).toFixed(2));
    }
  };

  // Прибыль: RUB от клиента - (USDT × курс USDT)
  let profitRub = null;
  if (received > 0 && rate > 0) {
    if (dir === 'SELL') {
      // Оператор продаёт крипту клиента за USDT
      profitRub = received * rate - sumRub;
    } else {
      // Клиент платит RUB → оператор покупает USDT
      profitRub = sumRub - received * rate;
    }
  }

  const showUsdtField = operatorType === 'manual';

  const handleConfirm = () => {
    if (showUsdtField) {
      onConfirm({
        receivedUsdt: received > 0 ? received : null,
        usdtRateRub: rate > 0 ? rate : null,
      });
    } else {
      onConfirm({ receivedUsdt: null, usdtRateRub: null });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Подтверждение оплаты</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Инфо о заявке */}
          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-sm">
            <div className="text-gray-500 dark:text-gray-400">Направление</div>
            <div className={`font-semibold text-right ${dir === 'BUY' ? 'text-green-600' : 'text-red-500'}`}>
              {dir === 'BUY' ? 'Покупка' : 'Продажа'} {coin}
            </div>
            <div className="text-gray-500 dark:text-gray-400">Выплатить клиенту</div>
            <div className="font-mono font-semibold text-right text-gray-700 dark:text-gray-300">
              {amountCoin.toFixed(6)} {coin}
            </div>
            <div className="text-gray-500 dark:text-gray-400">Сумма RUB</div>
            <div className="font-semibold text-right text-gray-700 dark:text-gray-300">
              {sumRub.toLocaleString('ru-RU')} ₽
            </div>
          </div>

          {showUsdtField && (
            <>
              {/* Курс RUB/USDT */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Курс RUB/USDT (по которому менял)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={usdtRateRub}
                    onChange={(e) => handleRateChange(e.target.value)}
                    placeholder="Например: 92.50"
                    className="w-full px-4 py-2.5 pr-16 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-shadow font-mono"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">₽/USDT</span>
                </div>
              </div>

              {/* Получено USDT */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Получено USDT (фактически)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={receivedUsdt}
                    onChange={(e) => handleUsdtChange(e.target.value)}
                    placeholder="Например: 1080.00"
                    className="w-full px-4 py-2.5 pr-16 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-shadow font-mono"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">USDT</span>
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Поля синхронизированы — измените одно, второе пересчитается
                </p>
              </div>

              {/* Расчёт в реальном времени */}
              {received > 0 && rate > 0 && (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Курс RUB/USDT</span>
                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
                      {rate.toFixed(2)} ₽/USDT
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Получено USDT</span>
                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
                      {received.toFixed(2)} $
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {!showUsdtField && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Подтвердите получение оплаты от клиента.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl transition-colors shadow-sm"
          >
            Подтвердить оплату
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
