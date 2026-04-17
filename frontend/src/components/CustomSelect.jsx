import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

const CustomSelect = ({ 
  value, 
  onChange, 
  options = [], 
  placeholder = 'Выберите...', 
  icon: Icon,
  label,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [isPositionCalculated, setIsPositionCalculated] = useState(false);
  const selectRef = useRef(null);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  // вычисляем позицию dropdown
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8, // 8px отступ
        left: rect.left + window.scrollX,
        width: rect.width
      });
      // небольшая задержка для плавной анимации
      setTimeout(() => setIsPositionCalculated(true), 10);
    } else {
      setIsPositionCalculated(false);
    }
  }, [isOpen]);

  // обновляем позицию при скролле
  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
          width: rect.width
        });
      }
    };

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  // закрываем при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        selectRef.current && 
        !selectRef.current.contains(event.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // закрываем при нажатии Escape
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // автоматически прокручиваем к выбранному элементу
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const selectedElement = dropdownRef.current.querySelector('[data-selected="true"]');
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [isOpen]);

  const selectedOption = options.find(opt => opt.value === value);
  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setSearchTerm('');
    }
  };

  return (
    <div className={`relative ${className}`} ref={selectRef}>
      {label && (
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          {Icon && <Icon className="w-4 h-4 text-blue-500" />}
          {label}
        </label>
      )}
      
      {/* кнопка выбора */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="relative w-full px-4 py-3 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-left text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all font-medium shadow-sm hover:shadow-md group"
      >
        <span className={`block truncate ${!selectedOption?.label ? 'text-gray-400 dark:text-gray-500' : ''}`}>
          {selectedOption?.label || placeholder}
        </span>
        <span className={`absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none transition-transform duration-300`}>
          <ChevronDown className={`w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {/* dropdown через Portal */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className={`fixed z-[9999] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border-2 border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-200 origin-top ${
            isPositionCalculated ? 'opacity-100 visible' : 'opacity-0 invisible'
          }`}
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            transform: isPositionCalculated ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
            transition: 'opacity 0.2s ease-out, transform 0.2s ease-out, visibility 0.2s'
          }}
        >
          {/* поле поиска (если опций много) */}
          {options.length > 5 && (
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                placeholder="Поиск..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* список опций */}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      data-selected={isSelected}
                      className={`relative w-full px-4 py-3 text-left transition-all duration-200 flex items-center justify-between group ${
                        isSelected
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/50 dark:hover:from-blue-900/20 dark:hover:to-indigo-900/20'
                      }`}
                    >
                      <span className="block truncate font-medium">{option.label}</span>
                      {isSelected && (
                        <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-in fade-in zoom-in duration-200" />
                      )}
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                Ничего не найдено
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CustomSelect;
