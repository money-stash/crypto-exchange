import React from 'react';
import { Check, X, Clock, FileText, AlertCircle, Zap, Hash } from 'lucide-react';

const OrderProgressBar = ({ currentStatus }) => {
  const statuses = [
    { 
      key: 'CREATED', 
      label: 'Создана', 
      icon: FileText,
      description: 'Заявка создана'
    },
    { 
      key: 'QUEUED', 
      label: 'В очереди', 
      icon: AlertCircle,
      description: 'В очереди на обработку'
    },
    { 
      key: 'PAYMENT_PENDING', 
      label: 'Оплата', 
      icon: Zap,
      description: 'Ожидание оплаты'
    },
    { 
      key: 'AWAITING_CONFIRM', 
      label: 'Подтверждение', 
      icon: Clock,
      description: 'Ожидание подтверждения'
    },
    { 
      key: 'AWAITING_HASH', 
      label: 'Хеш/чек', 
      icon: Hash,
      description: 'Ожидание хеша/чека'
    },
    { 
      key: 'COMPLETED', 
      label: 'Завершена', 
      icon: Check,
      description: 'Заявка завершена'
    }
  ];

  const isCancelled = currentStatus === 'CANCELLED';
  const currentIndex = statuses.findIndex(s => s.key === currentStatus);
  const activeIndex = isCancelled ? statuses.length : currentIndex;

  const getStepStatus = (index) => {
    if (isCancelled) {
      if (index === statuses.length - 1) return 'cancelled';
      if (index < activeIndex) return 'completed';
      return 'pending';
    }
    
    if (index < activeIndex) return 'completed';
    if (index === activeIndex) return 'active';
    return 'pending';
  };

  const getStepColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500 border-green-500 text-white';
      case 'active':
        return 'bg-blue-500 border-blue-500 text-white animate-pulse';
      case 'cancelled':
        return 'bg-red-500 border-red-500 text-white';
      default:
        return 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500';
    }
  };

  const getLineColor = (index) => {
    const status = getStepStatus(index);
    if (status === 'completed') {
      return 'bg-green-500';
    }
    if (status === 'cancelled' && index === statuses.length - 1) {
      return 'bg-red-500';
    }
    return 'bg-gray-300 dark:bg-gray-600';
  };

  const getTextColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400 font-semibold';
      case 'active':
        return 'text-blue-600 dark:text-blue-400 font-semibold';
      case 'cancelled':
        return 'text-red-600 dark:text-red-400 font-semibold';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  return (
    <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 p-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-purple-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-purple-950/10 pointer-events-none"></div>
      
      <div className="relative">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-blue-500" />
          Статус заявки
        </h3>

        <div className="relative">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-300 dark:bg-gray-600 hidden md:block" 
               style={{ left: '2rem', right: '2rem' }}></div>
          
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 md:gap-2">
            {statuses.map((status, index) => {
              const stepStatus = getStepStatus(index);
              const Icon = isCancelled && index === statuses.length - 1 ? X : status.icon;
              const label = isCancelled && index === statuses.length - 1 ? 'Отменена' : status.label;
              const description = isCancelled && index === statuses.length - 1 ? 'Заявка отменена' : status.description;

              return (
                <div key={status.key} className="relative flex flex-col items-center">
                  {index < statuses.length - 1 && (
                    <div 
                      className={`hidden md:block absolute top-5 left-1/2 w-full h-0.5 transition-all duration-500 ${getLineColor(index)}`}
                      style={{ 
                        zIndex: 1,
                        transformOrigin: 'left center'
                      }}
                    ></div>
                  )}

                  <div className="relative z-10 flex flex-col items-center gap-2">
                    <div 
                      className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-500 shadow-lg ${getStepColor(stepStatus)}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="text-center">
                      <div className={`text-xs font-medium transition-colors duration-300 ${getTextColor(stepStatus)}`}>
                        {label}
                      </div>
                    </div>
                  </div>

                  {index % 2 === 0 && index < statuses.length - 1 && (
                    <div className={`md:hidden absolute top-full left-1/2 w-1 h-4 ${getLineColor(index)}`}></div>
                  )}
                </div>
              );
            })}
          </div>

          {isCancelled && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-lg flex-shrink-0">
                  <X className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Заявка отменена
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderProgressBar;
