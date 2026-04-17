import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { BarChart3 } from 'lucide-react';

const BotPerformanceChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <div className="text-lg font-medium">Нет данных для отображения</div>
        </div>
      </div>
    );
  }

  // Цвета для разных ботов
  const colors = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', 
    '#8B5CF6', '#06B6D4', '#84CC16', '#F97316'
  ];

  const chartData = data.map((bot, index) => ({
    name: bot.name.length > 10 ? bot.name.substring(0, 10) + '...' : bot.name,
    fullName: bot.name,
    identifier: bot.identifier,
    completed_orders: bot.completed_orders,
    total_volume: Math.round(bot.total_volume / 1000), // В тысячах рублей
    color: colors[index % colors.length]
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            {data.fullName} (@{data.identifier})
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Выполнено заявок: {data.completed_orders}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Объём: {(data.total_volume * 1000).toLocaleString('ru-RU')} ₽
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis 
            dataKey="name" 
            className="text-xs text-gray-600 dark:text-gray-400"
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis 
            className="text-xs text-gray-600 dark:text-gray-400"
            tick={{ fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar 
            dataKey="completed_orders" 
            name="Выполненные заявки"
            radius={[4, 4, 0, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BotPerformanceChart;