import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const Modal = ({ 
  isOpen, 
  onClose, 
  title,
  children,
  size = 'md', // sm, md, lg, xl
  showCloseButton = true,
  icon = null,
  iconColor = 'blue'
}) => {
  const [isClosing, setIsClosing] = useState(false);

  // Обработка клавиши Escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen && !isClosing) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Блокируем скролл фона
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, isClosing]);

  // Сброс состояния при открытии
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return; // Предотвращаем двойные клики
    setIsClosing(true);
    onClose();
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'max-w-md';
      case 'md':
        return 'max-w-lg';
      case 'lg':
        return 'max-w-2xl';
      case 'xl':
        return 'max-w-4xl';
      case 'full':
        return 'max-w-full mx-4';
      default:
        return 'max-w-lg';
    }
  };

  const getIconColorClass = () => {
    switch (iconColor) {
      case 'blue':
        return 'bg-gradient-to-br from-blue-500 to-indigo-600';
      case 'green':
        return 'bg-gradient-to-br from-green-500 to-emerald-600';
      case 'red':
        return 'bg-gradient-to-br from-red-500 to-rose-600';
      case 'yellow':
        return 'bg-gradient-to-br from-yellow-500 to-orange-600';
      case 'purple':
        return 'bg-gradient-to-br from-purple-500 to-violet-600';
      case 'indigo':
        return 'bg-gradient-to-br from-indigo-500 to-blue-600';
      default:
        return 'bg-gradient-to-br from-blue-500 to-indigo-600';
    }
  };

  const getDefaultIcon = () => {
    return (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    );
  };

  return createPortal(
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/80"
          style={{
            backdropFilter: 'blur(4px)'
          }}
          onClick={handleBackdropClick}
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            className={`relative backdrop-blur-xl bg-white/90 dark:bg-gray-900/95 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 w-full ${getSizeClasses()} mx-4 max-h-[90vh] flex flex-col overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-purple-950/30 pointer-events-none" />
            
            {/* Header */}
            <div className="relative flex-shrink-0 px-6 py-5 border-b border-gray-200/70 dark:border-gray-700/70">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(icon || !icon) && (
                    <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${getIconColorClass()} shadow-lg text-white`}>
                      {icon || getDefaultIcon()}
                    </div>
                  )}
                  <h3 className="text-xl font-semibold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 dark:from-gray-100 dark:via-gray-200 dark:to-gray-100 bg-clip-text text-transparent">
                    {title}
                  </h3>
                </div>
                {showCloseButton && (
                  <button
                    onClick={handleClose}
                    className="group flex items-center justify-center w-9 h-9 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all duration-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:scale-110 active:scale-95"
                    type="button"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="relative flex-1 overflow-y-auto px-6 py-5">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default Modal;
