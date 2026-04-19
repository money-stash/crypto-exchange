import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, Clock, AlertTriangle, X } from 'lucide-react';
import { shiftsApi } from '../services/api';
import { toast } from 'react-toastify';

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

export default function ShiftButton() {
  const [shiftData, setShiftData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [pendingEnd, setPendingEnd] = useState(null);

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await shiftsApi.getCurrentShift();
      setShiftData(res.data.shift ? res.data : null);
    } catch {
      setShiftData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrent();
    const interval = setInterval(fetchCurrent, 60_000);
    return () => clearInterval(interval);
  }, [fetchCurrent]);

  const handleStart = async () => {
    try {
      await shiftsApi.startShift();
      toast.success('Смена начата');
      fetchCurrent();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Ошибка начала смены');
    }
  };

  const handleEndRequest = async () => {
    try {
      const res = await shiftsApi.endShift({ force: false });
      if (res.data.requires_confirmation) {
        setPendingEnd(res.data);
        setShowEndConfirm(true);
      } else {
        toast.success('Смена завершена');
        setShiftData(null);
        fetchCurrent();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Ошибка завершения смены');
    }
  };

  const handleEndForce = async () => {
    try {
      await shiftsApi.endShift({ force: true });
      toast.success('Смена завершена');
      setShiftData(null);
      setShowEndConfirm(false);
      setPendingEnd(null);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Ошибка завершения смены');
    }
  };

  if (loading) return null;

  // ── Активная смена ───────────────────────────────────────────
  if (shiftData?.shift) {
    const { elapsed_min, remaining_min, is_early } = shiftData;

    return (
      <>
        <div className="w-full space-y-1.5">
          {/* Таймер — строка на всю ширину */}
          <div className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold border ${
            is_early
              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40'
              : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700/40'
          }`}>
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            <div className="flex flex-col leading-tight min-w-0">
              <span>Смена: {formatTime(elapsed_min)}</span>
              {remaining_min > 0 && (
                <span className="text-[10px] font-normal opacity-60">осталось {formatTime(remaining_min)}</span>
              )}
            </div>
          </div>

          {/* Кнопка завершить — на всю ширину */}
          <button
            onClick={handleEndRequest}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700/40 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            <Square className="w-3 h-3 fill-current flex-shrink-0" />
            Завершить смену
          </button>
        </div>

        {/* Модал предупреждения — через portal */}
        {showEndConfirm && pendingEnd && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => { setShowEndConfirm(false); setPendingEnd(null); }}
            />
            <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">Ранний выход из смены</h3>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Смена завершается раньше запланированного</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowEndConfirm(false); setPendingEnd(null); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-semibold mb-1">Отработано</p>
                    <p className="text-lg font-bold text-gray-800 dark:text-gray-100">{formatTime(pendingEnd.elapsed_min)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-800/30">
                    <p className="text-[10px] uppercase tracking-wider text-amber-500 dark:text-amber-400 font-semibold mb-1">Осталось</p>
                    <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{formatTime(pendingEnd.remaining_min)}</p>
                  </div>
                </div>

                {pendingEnd.early_penalty > 0 && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200/60 dark:border-red-800/40">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Штраф за ранний выход</p>
                    <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                      {Number(pendingEnd.early_penalty).toLocaleString('ru-RU')} ₽
                    </p>
                    <p className="text-xs text-red-400 dark:text-red-500 mt-1">Будет удержан из вашего заработка</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex gap-3">
                <button
                  onClick={() => { setShowEndConfirm(false); setPendingEnd(null); }}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Продолжить смену
                </button>
                <button
                  onClick={handleEndForce}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm"
                >
                  Всё равно завершить
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  // ── Нет активной смены ───────────────────────────────────────
  return (
    <button
      onClick={handleStart}
      className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-700 text-white transition-colors shadow-sm"
    >
      <Play className="w-3 h-3 fill-current" />
      Начать смену
    </button>
  );
}
