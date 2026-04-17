import React, { useState, useEffect, useRef } from 'react';

const AnimatedDigit = ({ value }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayValue(value);
        setIsAnimating(false);
        prevValueRef.current = value;
      }, 200); // Половина анимации
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <div className="relative inline-flex items-center justify-center w-3 h-5 overflow-hidden">
      {/* Старая цифра - уезжает вверх */}
      {isAnimating && (
        <span
          className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-300"
          style={{
            animation: 'slideOutUp 0.3s linear forwards'
          }}
        >
          {prevValueRef.current}
        </span>
      )}
      
      {/* Новая цифра - приезжает снизу */}
      <span
        className={`absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-300 ${
          isAnimating ? 'animate-slide-in-up' : ''
        }`}
      >
        {displayValue}
      </span>
    </div>
  );
};

const AnimatedTimer = ({ time, isCompleted = false }) => {
  if (!time || time === '-') return <span className="text-gray-400 dark:text-gray-500 font-medium text-sm">—</span>;

  // парсим строку времени вида "1ч 23м 45с" или "23м 45с" или "45с"
  const parseTime = (timeStr) => {
    const hours = timeStr.match(/(\d+)ч/);
    const minutes = timeStr.match(/(\d+)м/);
    const seconds = timeStr.match(/(\d+)с/);

    return {
      hours: hours ? parseInt(hours[1]) : 0,
      minutes: minutes ? parseInt(minutes[1]) : 0,
      seconds: seconds ? parseInt(seconds[1]) : 0
    };
  };

  const { hours, minutes, seconds } = parseTime(time);

  // Разбиваем числа на отдельные цифры
  const hoursDigits = hours.toString().split('');
  const minutesDigits = minutes.toString().split('');
  const secondsDigits = seconds.toString().split('');

  return (
    <div className="inline-flex items-center gap-0.5">
      {hours > 0 && (
        <>
          {hoursDigits.map((digit, index) => (
            <AnimatedDigit key={`h-${index}`} value={digit} />
          ))}
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">ч</span>
          <span className="w-1"></span>
        </>
      )}
      
      {minutesDigits.map((digit, index) => (
        <AnimatedDigit key={`m-${index}`} value={digit} />
      ))}
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">м</span>
      <span className="w-1"></span>
      
      {secondsDigits.map((digit, index) => (
        <AnimatedDigit key={`s-${index}`} value={digit} />
      ))}
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">с</span>
    </div>
  );
};

export default AnimatedTimer;

