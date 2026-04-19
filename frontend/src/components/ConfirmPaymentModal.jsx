import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X } from 'lucide-react';

/**
 * Модал подтверждения оплаты.
 * Оператор вводит сколько USDT получил — система считает курс и прибыль.
 *
 * Props:
 *   isOpen      — показать/скрыть
 *   onClose     — закрыть без сохранения
 *   onConfirm   — (receivedUsdt: number | null) => void
 *   order       — объект заявки (dir, amount_coin, sum_rub, rate_rub, coin)
 *   operatorType — 'manual' | 'card' | 'auto'  (для manual показываем поле)
 */
export default function ConfirmPaymentModal({ isOpen, onClose, onConfirm, order, operatorType = 'manual' }) {
  const [receivedUsdt, setReceivedUsdt] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Предзаполняем ожидаемой суммой
      setReceivedUsdt(order?.amount_coin ? String(Number(order.amount_coin).toFixed(6)) : '');
    }
  }, [isOpen, order]);

  useEffect(() => {
    if (!isOpen) return;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = 'unset'; };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const amountCoin = parseFloat(order?.amount_coin || 0);
  const sumRub = parseFloat(order?.sum_rub || 0);
  const rateRub = parseFloat(order?.rate_rub || 0);
  const dir = order?.dir || 'BUY';
  const coin = order?.coin || 'USDT';

  const received = parseFloat(receivedUsdt) || 0;
  const actualRate = received > 0 ? sumRub / received : null;
  const expectedUsdt = amountCoin;
  let profitRub = null;
  if (received > 0 && rateRub > 0) {
    if (dir === 'SELL') {
      profitRub = (received - amountCoin) * rateRub;
    } else {
      profitRub = sumRub - received * rateRub;
    }
  }

  // Для card/auto операторов поле не нужно — подтверждаем сразу
  const showUsdtField = operatorType === 'manual';

  const handleConfirm = () => {
    onConfirm(showUsdtField && received > 0 ? received : null);
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
            <div className="text-gray-500 dark:text-gray-400">Ожидаемо {coin}</div>
            <div className="font-mono font-semibold text-right text-gray-700 dark:text-gray-300">
              {expectedUsdt.toFixed(6)}
            </div>
            <div className="text-gray-500 dark:text-gray-400">Сумма RUB</div>
            <div className="font-semibold text-right text-gray-700 dark:text-gray-300">
              {sumRub.toLocaleString('ru-RU')} ₽
            </div>
          </div>

          {showUsdtField && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Получено {coin} (фактически)
                </label>
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  value={receivedUsdt}
                  onChange={(e) => setReceivedUsdt(e.target.value)}
                  placeholder={`Например: ${expectedUsdt.toFixed(6)}`}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-shadow font-mono"
                  autoFocus
                />
              </div>

              {/* Расчёт в реальном времени */}
              {received > 0 && (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30 space-y-1.5 text-sm">
                  {actualRate && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Фактический курс</span>
                      <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">
                        {actualRate.toFixed(2)} ₽/{coin}
                      </span>
                    </div>
                  )}
                  {profitRub !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">Прибыль</span>
                      <span className={`font-semibold ${profitRub >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                        {profitRub >= 0 ? '+' : ''}{profitRub.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                      </span>
                    </div>
                  )}
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
