import React from 'react';
import { 
  ChevronRight, 
  Pencil, 
  Trash2, 
  ToggleLeft, 
  Power, 
  UserPlus, 
  Tag, 
  Ban, 
  CheckCircle,
  Loader2
} from 'lucide-react';
import { Tooltip } from 'react-tooltip';

// Иконки для различных действий с использованием Lucide React
export const ActionIcons = {
  view: ChevronRight,
  edit: Pencil,
  delete: Trash2,
  toggle: ToggleLeft,
  power: Power,
  assign: UserPlus,
  discount: Tag,
  block: Ban,
  unblock: CheckCircle
};

// Компонент кнопки действия с иконкой
export const ActionButton = ({ 
  type, 
  onClick, 
  className = '', 
  title, 
  disabled = false,
  variant = 'default',
  children,
  size = 'md',
  loading = false
}) => {
  const IconComponent = ActionIcons[type];
  const buttonId = `action-btn-${Math.random().toString(36).substr(2, 9)}`;
  
  const sizeClasses = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-3"
  };
  
  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18
  };

  const baseClasses = `
    inline-flex items-center justify-center rounded-lg transition-all duration-200 
    focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm hover:shadow-md 
    transform hover:scale-105 active:scale-95
  `;
  
  const variants = {
    default: `
      bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 
      hover:bg-gray-200 dark:hover:bg-gray-600 
      focus:ring-gray-500 border border-gray-200 dark:border-gray-600
    `,
    primary: `
      bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 
      hover:bg-blue-200 dark:hover:bg-blue-800 
      focus:ring-blue-500 border border-blue-200 dark:border-blue-700
    `,
    success: `
      bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 
      hover:bg-green-200 dark:hover:bg-green-800 
      focus:ring-green-500 border border-green-200 dark:border-green-700
    `,
    danger: `
      bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 
      hover:bg-red-200 dark:hover:bg-red-800 
      focus:ring-red-500 border border-red-200 dark:border-red-700
    `,
    warning: `
      bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 
      hover:bg-yellow-200 dark:hover:bg-yellow-800 
      focus:ring-yellow-500 border border-yellow-200 dark:border-yellow-700
    `,
    purple: `
      bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 
      hover:bg-purple-200 dark:hover:bg-purple-800 
      focus:ring-purple-500 border border-purple-200 dark:border-purple-700
    `
  };
  
  return (
    <>
      <button
        id={buttonId}
        onClick={onClick}
        disabled={disabled || loading}
        className={`
          ${baseClasses} 
          ${sizeClasses[size]} 
          ${variants[variant]} 
          ${className} 
          ${disabled || loading ? 'opacity-50 cursor-not-allowed transform-none hover:scale-100' : ''}
        `}
      >
        {loading ? (
          <Loader2 size={iconSizes[size]} className="animate-spin" />
        ) : (
          children || (IconComponent && <IconComponent size={iconSizes[size]} />)
        )}
      </button>
      {title && (
        <Tooltip
          anchorSelect={`#${buttonId}`}
          content={title}
          place="top"
          className="!bg-gray-900 !text-white !text-xs !px-2 !py-1 !rounded-md !shadow-lg"
          style={{
            backgroundColor: '#1f2937',
            color: '#ffffff',
            fontSize: '12px',
            padding: '4px 8px',
            borderRadius: '6px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }}
        />
      )}
    </>
  );
};

export default ActionButton;