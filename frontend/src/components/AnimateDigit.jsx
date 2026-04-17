import React from 'react';

const AnimatedDigit = ({ value }) => {
  return (
    <div className="relative inline-flex flex-col items-center">
      <div className="relative w-12 h-16 perspective-1000">
        <div
          key={value}
          className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-gray-900 dark:text-white bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 rounded-lg shadow-lg animate-flip"
        >
          <span className="relative z-10">{value}</span>
          
          {/* тень верхней половинки */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent rounded-t-lg"></div>
          
          {/* тень нижней половинки */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent rounded-b-lg"></div>
          
          {/* разделительная линия */}
          <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-black/20 transform -translate-y-1/2"></div>
        </div>
      </div>
    </div>
  );
};

const AnimatedTimer = ({ time, isCompleted = false }) => {
  if (!time) return null;

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

  const formatDigit = (num) => num.toString().padStart(2, '0');

  return (
    <div className={`inline-flex items-center gap-2 ${isCompleted ? 'opacity-100' : ''}`}>
      {hours > 0 && (
        <>
          <div className="flex gap-1">
            <AnimatedDigit value={formatDigit(hours)[0]} />
            <AnimatedDigit value={formatDigit(hours)[1]} />
          </div>
          <span className="text-2xl font-bold text-gray-600 dark:text-gray-400 mb-2">:</span>
        </>
      )}
      
      <div className="flex gap-1">
        <AnimatedDigit value={formatDigit(minutes)[0]} />
        <AnimatedDigit value={formatDigit(minutes)[1]} />
      </div>
      <span className="text-2xl font-bold text-gray-600 dark:text-gray-400 mb-2">:</span>
      
      <div className="flex gap-1">
        <AnimatedDigit value={formatDigit(seconds)[0]} />
        <AnimatedDigit value={formatDigit(seconds)[1]} />
      </div>
    </div>
  );
};

export default AnimatedTimer;