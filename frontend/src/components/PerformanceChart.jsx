import React from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const PerformanceChart = ({ data, days }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <div className="text-6xl mb-4">📊</div>
          <div className="text-lg font-medium">Нет данных за выбранный период</div>
          <div className="text-sm mt-2">Данные появятся после обработки заявок</div>
        </div>
      </div>
    );
  }

  // Форматируем данные для графика
  const chartData = data.map(item => ({
    ...item,
    date: new Date(item.date).toLocaleDateString('ru-RU', { 
      month: 'short', 
      day: 'numeric' 
    }),
    volume: Math.round(item.total_volume / 1000), // Конвертируем в тысячи для лучшего отображения
  }));

  // Кастомный Tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.dataKey === 'completed_orders' 
                ? `Заявки: ${entry.value}` 
                : `Объём: ${(entry.value * 1000).toLocaleString('ru-RU')} ₽`
              }
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis 
            dataKey="date" 
            className="text-xs text-gray-600 dark:text-gray-400"
            tick={{ fontSize: 12 }}
          />
          <YAxis 
            yAxisId="orders"
            orientation="left"
            className="text-xs text-gray-600 dark:text-gray-400"
            tick={{ fontSize: 12 }}
          />
          <YAxis 
            yAxisId="volume"
            orientation="right"
            className="text-xs text-gray-600 dark:text-gray-400"
            tick={{ fontSize: 12 }}
            label={{ 
              value: 'тыс. ₽', 
              angle: -90, 
              position: 'insideRight',
              style: { textAnchor: 'middle' }
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          
          {/* Столбчатая диаграмма для количества заявок */}
          <Bar
            yAxisId="orders"
            dataKey="completed_orders"
            name="Количество заявок"
            fill="#3B82F6"
            fillOpacity={0.8}
            radius={[4, 4, 0, 0]}
          />
          
          {/* Линейный график для объёма */}
          <Line
            yAxisId="volume"
            type="monotone"
            dataKey="volume"
            name="Объём (тыс. ₽)"
            stroke="#10B981"
            strokeWidth={3}
            dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: '#10B981' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PerformanceChart;