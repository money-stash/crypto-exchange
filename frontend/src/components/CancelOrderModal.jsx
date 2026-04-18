import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XCircle, X } from 'lucide-react';

const PRESET_REASONS = [
  'Клиент не написал ни одного сообщения',
  'Клиент не отвечает более 15 минут',
  'Клиент попросил отменить заявку',
];

const CancelOrderModal = ({ isOpen, onClose, onConfirm }) => {
  const [selected, setSelected] = useState(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelected(null);
      setCustom('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const reason = selected !== null ? PRESET_REASONS[selected] : custom.trim();
  const canConfirm = !!reason;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(reason);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              Причина отмены заявки
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Выберите причину или напишите свою:
          </p>

          {/* Preset buttons */}
          <div className="space-y-2">
            {PRESET_REASONS.map((reason, i) => (
              <button
                key={i}
                onClick={() => { setSelected(i); setCustom(''); }}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium border transition-all duration-150 ${
                  selected === i
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/50 dark:hover:bg-red-900/10'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-400 dark:text-gray-500">или своя причина</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Free text */}
          <textarea
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
            placeholder="Введите причину отмены..."
            rows={3}
            className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-400 dark:focus:ring-red-600 focus:border-transparent resize-none transition-shadow"
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Назад
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900/40 disabled:cursor-not-allowed rounded-xl transition-colors shadow-sm shadow-red-500/20"
          >
            Отменить заявку
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CancelOrderModal;
