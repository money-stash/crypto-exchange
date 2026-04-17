import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Bar
} from 'recharts';

const DailyPerformanceChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <div className="text-6xl mb-4">📊</div>
          <div className="text-lg font-medium">Нет данных за последние 30 дней</div>
        </div>
      </div>
    );
  }

  const chartData = data.map(item => ({
    date: new Date(item.date).toLocaleDateString('ru-RU', { 
      month: 'short', 
      day: 'numeric' 
    }),
    total_orders: item.total_orders,
    completed_orders: item.completed_orders,
    total_volume: Math.round(item.total_volume / 1000), // В тысячах рублей
    completion_rate: item.total_orders > 0 ? Math.round((item.completed_orders / item.total_orders) * 100) : 0
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">{label}</p>
          <p className="text-sm text-blue-600">
            Всего заявок: {data.total_orders}
          </p>
          <p className="text-sm text-green-600">
            Выполнено: {data.completed_orders}
          </p>
          <p className="text-sm text-purple-600">
            Объём: {(data.total_volume * 1000).toLocaleString('ru-RU')} ₽
          </p>
          <p className="text-sm text-orange-600">
            Процент выполнения: {data.completion_rate}%
          </p>
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
          
          {/* Столбцы для общего количества заявок */}
          <Bar
            yAxisId="orders"
            dataKey="total_orders"
            name="Всего заявок"
            fill="#3B82F6"
            fillOpacity={0.3}
            radius={[2, 2, 0, 0]}
          />
          
          {/* Линия для выполненных заявок */}
          <Line
            yAxisId="orders"
            type="monotone"
            dataKey="completed_orders"
            name="Выполнено"
            stroke="#10B981"
            strokeWidth={3}
            dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: '#10B981' }}
          />
          
          {/* Линия для объема */}
          <Line
            yAxisId="volume"
            type="monotone"
            dataKey="total_volume"
            name="Объём (тыс. ₽)"
            stroke="#8B5CF6"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#8B5CF6', strokeWidth: 2, r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DailyPerformanceChart;