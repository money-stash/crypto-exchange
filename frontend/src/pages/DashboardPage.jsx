import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Pickaxe, CircleCheck, XCircle, BarChart3, Bot, TrendingUp, LayoutDashboard } from 'lucide-react';
import { ordersApi, botsApi } from '../services/api';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceChart from '../components/PerformanceChart';
import BotPerformanceChart from '../components/BotPerformanceChart';
import DailyPerformanceChart from '../components/DailyPerformanceChart';
import { useAuth } from '../hooks/useAuth';
import PageTransition from '../components/PageTransition';

const DashboardPage = () => {
  const { user } = useAuth();
  const hideCustomerIdentity = ['OPERATOR', 'MANAGER'].includes((user?.role || '').toUpperCase());
  const [stats, setStats] = useState({
    newOrders: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
  });
  const [operatorStats, setOperatorStats] = useState(null);
  const [managerStats, setManagerStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartDays, setChartDays] = useState(7);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // получаем заказы
      const ordersResponse = await ordersApi.getOrders({ limit: 10 });

      // Обрабатываем как старый формат массива, так и новый пагинированный формат
      let orders;
      if (Array.isArray(ordersResponse.data)) {
        // старый формат
        orders = ordersResponse.data;
      } else if (ordersResponse.data && ordersResponse.data.orders) {
        // двойная вложенность: { data: { orders: [...], total: ... } }
        orders = ordersResponse.data.orders;
      } else if (ordersResponse.orders) {
        // новый формат
        orders = ordersResponse.orders;
      } else {
        console.warn('Unexpected orders response format:', ordersResponse);
        orders = [];
      }
      
      setRecentOrders(orders);
      
      // считаем статистику по статусам
      const newCount = orders.filter(order => order.status === 'QUEUED').length;
      const inProgressCount = orders.filter(order => order.status === 'PAYMENT_PENDING').length;
      const completedCount = orders.filter(order => order.status === 'COMPLETED').length;
      const cancelledCount = orders.filter(order => order.status === 'CANCELLED').length;
      
      setStats({
        newOrders: newCount,
        inProgress: inProgressCount,
        completed: completedCount,
        cancelled: cancelledCount,
      });

      // получаем статистику оператора если нужно
      if (user?.role === 'OPERATOR') {
        try {
          const operatorStatsResponse = await ordersApi.getOperatorStats();
          setOperatorStats(operatorStatsResponse.data);
          
          // данные для графика
          const chartResponse = await ordersApi.getOperatorChartData(chartDays);
          setChartData(chartResponse.data);
        } catch (error) {
          console.error('Failed to fetch operator stats:', error);
        }
      }

      // получаем стату менеджера
      if (user?.role === 'MANAGER' || user?.role === 'SUPERADMIN') {
        try {
          const managerStatsResponse = await botsApi.getManagerStats();
          setManagerStats(managerStatsResponse.data);
        } catch (error) {
          console.error('Failed to fetch manager stats:', error);
        }
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      // установим пустые данные при ошибке
      setRecentOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const updateChartData = async (days) => {
    if (user?.role !== 'OPERATOR') return;
    
    try {
      setChartDays(days);
      const chartResponse = await ordersApi.getOperatorChartData(days);
      setChartData(chartResponse.data);
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      CREATED: 'bg-gray-100 text-gray-800',
      AWAITING_CONFIRM: 'bg-yellow-100 text-yellow-800',
      QUEUED: 'bg-blue-100 text-blue-800',
      PAYMENT_PENDING: 'bg-orange-100 text-orange-800',
      AWAITING_HASH: 'bg-purple-100 text-purple-800',
      COMPLETED: 'bg-green-100 text-green-800',
      CANCELLED: 'bg-red-100 text-red-800',
    };

    const labels = {
      CREATED: 'Создана',
      AWAITING_CONFIRM: 'Ожидает подтверждения',
      QUEUED: 'В очереди',
      PAYMENT_PENDING: 'В работе',
      AWAITING_HASH: 'Ожидает хэш/чек',
      COMPLETED: 'Выполнена',
      CANCELLED: 'Отменена',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badges[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* хедер премиум */}
        <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
          
          <div className="relative px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                <LayoutDashboard className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-900 dark:from-gray-100 dark:via-blue-200 dark:to-indigo-100 bg-clip-text text-transparent">
                  Статистика
                </h1>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">
                  Обзор показателей и статистики
                </p>
              </div>
            </div>
          </div>
        </div>
      

      {user?.role === 'OPERATOR' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {loading || !operatorStats ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 via-transparent to-gray-50/30 dark:from-gray-950/30 dark:via-transparent dark:to-gray-950/20 pointer-events-none"></div>
                  
                  <div className="relative p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-3 bg-gray-300 dark:bg-gray-700 rounded-xl animate-pulse w-11 h-11"></div>
                      <div className="px-2.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse w-16 h-5"></div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24"></div>
                      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-16"></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <>
            {/* новые заявки */}
            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-indigo-50/30 dark:from-blue-950/30 dark:via-transparent dark:to-indigo-950/20 pointer-events-none"></div>
              
              <div className="relative p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                    <Mail className="text-white w-5 h-5" />
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-blue-100 dark:bg-blue-900/30 rounded-full">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 leading-none">Сегодня</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                    Новые заявки
                  </h3>
                  <p className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
                    {stats.newOrders}
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-amber-50/30 dark:from-orange-950/30 dark:via-transparent dark:to-amber-950/20 pointer-events-none"></div>
              
              <div className="relative p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                    <Pickaxe className="text-white w-5 h-5" />
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-orange-100 dark:bg-orange-900/30 rounded-full">
                    <span className="text-xs font-semibold text-orange-700 dark:text-orange-300 leading-none">Активные</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                    В работе
                  </h3>
                  <p className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-400 dark:to-amber-400 bg-clip-text text-transparent">
                    {operatorStats.assigned || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-transparent to-emerald-50/30 dark:from-green-950/30 dark:via-transparent dark:to-emerald-950/20 pointer-events-none"></div>
              
              <div className="relative p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                    <CircleCheck className="text-white w-5 h-5" />
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-green-100 dark:bg-green-900/30 rounded-full">
                    <span className="text-xs font-semibold text-green-700 dark:text-green-300 leading-none">Успешно</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                    Выполнено сегодня
                  </h3>
                  <p className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-400 dark:to-emerald-400 bg-clip-text text-transparent">
                    {operatorStats.today?.completed || 0}
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-red-50/50 via-transparent to-rose-50/30 dark:from-red-950/30 dark:via-transparent dark:to-rose-950/20 pointer-events-none"></div>
              
              <div className="relative p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                    <XCircle className="text-white w-5 h-5" />
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-red-100 dark:bg-red-900/30 rounded-full">
                    <span className="text-xs font-semibold text-red-700 dark:text-red-300 leading-none">Отменено</span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                    Отменено сегодня
                  </h3>
                  <p className="text-3xl font-bold bg-gradient-to-r from-red-600 to-rose-600 dark:from-red-400 dark:to-rose-400 bg-clip-text text-transparent">
                    {operatorStats.today?.cancelled || 0}
                  </p>
                </div>
              </div>
            </div>
            </>
            )}
          </div>

          {!loading && operatorStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За сегодня</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{operatorStats.today?.completed || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">24ч</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(operatorStats.today?.volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>

            {/* статистика за текущий месяц */}
            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500 via-emerald-600 to-teal-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-green-400 via-emerald-500 to-teal-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За этот месяц</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{operatorStats.monthly?.completed || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">30д</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(operatorStats.monthly?.volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>

            {/* стата за все время */}
            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-red-600 to-pink-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-orange-400 via-red-500 to-pink-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За всё время</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{operatorStats.total?.completed || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">∞</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(operatorStats.total?.volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* График производительности */}
          {!loading && operatorStats && (
          <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
            
            <div className="relative p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-md">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      График производительности
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Динамика выполнения заявок
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mb-6 flex flex-wrap gap-2">
                <button 
                  onClick={() => updateChartData(7)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    chartDays === 7 
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md hover:shadow-lg' 
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                  }`}
                >
                  7 дней
                </button>
                <button 
                  onClick={() => updateChartData(30)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    chartDays === 30 
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md hover:shadow-lg' 
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                  }`}
                >
                  30 дней
                </button>
                <button 
                  onClick={() => updateChartData(90)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    chartDays === 90 
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md hover:shadow-lg' 
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                  }`}
                >
                  90 дней
                </button>
              </div>

              <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50 rounded-xl p-6 border border-gray-200/50 dark:border-gray-700/50">
                <PerformanceChart data={chartData} days={chartDays} />
              </div>
              
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="w-4 h-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded"></div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Количество заявок</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="w-4 h-1.5 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full"></div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Объём (тыс. ₽)</span>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      )}
      {(user?.role === 'MANAGER' || user?.role === 'SUPERADMIN') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {loading || !managerStats ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-50/50 via-transparent to-gray-50/30 dark:from-gray-950/30 dark:via-transparent dark:to-gray-950/20 pointer-events-none"></div>
                  
                  <div className="relative p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-300 dark:bg-gray-700 rounded-lg animate-pulse w-8 h-8 flex-shrink-0"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20"></div>
                        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-14"></div>
                      </div>
                      <div className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse w-14 h-6 flex-shrink-0"></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <>
            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-transparent to-indigo-50/30 dark:from-blue-950/30 dark:via-transparent dark:to-indigo-950/20 pointer-events-none"></div>
              
              <div className="relative p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <Bot className="text-white w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                      Обменников
                    </h3>
                    <p className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">
                      {managerStats.bots?.total || 0}
                    </p>
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-blue-100 dark:bg-blue-900/30 rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 leading-none">Всего</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-transparent to-emerald-50/30 dark:from-green-950/30 dark:via-transparent dark:to-emerald-950/20 pointer-events-none"></div>
              
              <div className="relative p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <CircleCheck className="text-white w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                      Активных
                    </h3>
                    <p className="text-2xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-400 dark:to-emerald-400 bg-clip-text text-transparent">
                      {managerStats.bots?.active || 0}
                    </p>
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-green-100 dark:bg-green-900/30 rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold text-green-700 dark:text-green-300 leading-none">Активно</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 via-transparent to-fuchsia-50/30 dark:from-purple-950/30 dark:via-transparent dark:to-fuchsia-950/20 pointer-events-none"></div>
              
              <div className="relative p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-purple-500 to-fuchsia-600 rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <Mail className="text-white w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                      Заявок
                    </h3>
                    <p className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-fuchsia-600 dark:from-purple-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
                      {managerStats.overall?.total_orders || 0}
                    </p>
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-purple-100 dark:bg-purple-900/30 rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 leading-none">Всего</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-amber-50/30 dark:from-orange-950/30 dark:via-transparent dark:to-amber-950/20 pointer-events-none"></div>
              
              <div className="relative p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="text-white w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                      Выполнено
                    </h3>
                    <p className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-400 dark:to-amber-400 bg-clip-text text-transparent">
                      {managerStats.overall?.completed_orders || 0}
                    </p>
                  </div>
                  <div className="px-2.5 h-[35px] flex items-center bg-orange-100 dark:bg-orange-900/30 rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold text-orange-700 dark:text-orange-300 leading-none">Успешно</span>
                  </div>
                </div>
              </div>
            </div>
            </>
            )}
          </div>

          {!loading && managerStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За сегодня</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{managerStats.today?.completed || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">24ч</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(managerStats.today?.volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>


            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500 via-emerald-600 to-teal-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-green-400 via-emerald-500 to-teal-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За этот месяц</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{managerStats.monthly?.completed || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">30д</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(managerStats.monthly?.volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-red-600 to-pink-700"></div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-orange-400 via-red-500 to-pink-600"></div>
              
              <div className="relative p-4 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-white/20 backdrop-blur-sm rounded-lg shadow-md group-hover:scale-105 transition-transform duration-300 flex-shrink-0">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold opacity-90">За всё время</h3>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold">{managerStats.overall?.completed_orders || 0}</span>
                      <span className="text-xs font-medium opacity-80">заявок</span>
                    </div>
                  </div>
                  <div className="px-2 h-[35px] flex items-center bg-white/20 backdrop-blur-sm rounded-full flex-shrink-0">
                    <span className="text-xs font-semibold leading-none">∞</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 pt-2 border-t border-white/20">
                  <TrendingUp className="w-4 h-4 opacity-80 flex-shrink-0" />
                  <span className="text-sm font-semibold opacity-90 truncate">
                    {(managerStats.overall?.total_volume || 0).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              </div>
            </div>
          </div>
          )}

          {!loading && managerStats && (
          <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
            
            <div className="relative p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg shadow-md">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Топ обменников по эффективности
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    Самые продуктивные обменники
                  </p>
                </div>
              </div>
            
            <ResponsiveTable
              columns={[
                {
                  header: 'Обменник',
                  key: 'name',
                  render: (row) => (
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{row.name}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">@{row.identifier}</div>
                    </div>
                  )
                },
                {
                  header: 'Всего заявок',
                  key: 'total_orders',
                  width: '120px',
                  render: (row) => row.total_orders
                },
                {
                  header: 'Выполнено',
                  key: 'completed_orders',
                  width: '120px',
                  render: (row) => (
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {row.completed_orders}
                    </span>
                  )
                },
                {
                  header: 'Общий объём',
                  key: 'total_volume',
                  width: '140px',
                  render: (row) => `${row.total_volume.toLocaleString('ru-RU')} ₽`
                },
                {
                  header: 'Средний чек',
                  key: 'avg_order_value',
                  width: '140px',
                  mobileHide: true,
                  render: (row) => `${row.avg_order_value.toLocaleString('ru-RU')} ₽`
                },
                {
                  header: 'Эффективность',
                  key: 'completion_rate',
                  width: '120px',
                  mobileHide: true,
                  render: (row) => {
                    // Проверяем, что есть данные для расчета
                    if (!row.total_orders || row.total_orders === 0) {
                      return <span className="text-gray-400">—</span>;
                    }
                    
                    // Если есть готовый процент с бэкенда, используем его
                    if (row.completion_rate !== undefined) {
                      const rate = Math.round(row.completion_rate);
                      return (
                        <span className={`font-medium ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {rate}%
                        </span>
                      );
                    }
                    
                    // Иначе рассчитываем на фронтенде
                    const rate = Math.round((row.completed_orders / row.total_orders) * 100);
                    // Дополнительная проверка на адекватность данных
                    if (rate > 100) {
                      return <span className="text-gray-400">—</span>;
                    }
                    
                    return (
                      <span className={`font-medium ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {rate}%
                      </span>
                    );
                  }
                }
              ]}
              data={managerStats.topBots}
              emptyMessage="Данных пока нет"
            />
            </div>
          </div>
          )}


          {!loading && managerStats && (
          <div className="grid grid-cols-1 gap-6">
            <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
              
              <div className="relative p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-md">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      Динамика за 30 дней
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Ежедневная производительность
                    </p>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50 rounded-xl p-5 border border-gray-200/50 dark:border-gray-700/50">
                  <DailyPerformanceChart data={managerStats.dailyPerformance} />
                </div>
              </div>
            </div>
          </div>
          )}

          {!loading && managerStats && (
          <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-green-50/20 via-transparent to-emerald-50/20 dark:from-green-950/10 dark:via-transparent dark:to-emerald-950/10 pointer-events-none"></div>
            
            <div className="relative p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg shadow-md">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Сравнение производительности обменников
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    Анализ работы всех обменников
                  </p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50 rounded-xl p-5 border border-gray-200/50 dark:border-gray-700/50">
                <BotPerformanceChart data={managerStats.botPerformance} />
              </div>
            </div>
          </div>
          )}

          {!loading && managerStats && (
          <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-50/20 via-transparent to-fuchsia-50/20 dark:from-purple-950/10 dark:via-transparent dark:to-fuchsia-950/10 pointer-events-none"></div>
            
            <div className="relative p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-purple-500 to-fuchsia-600 rounded-lg shadow-md">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Топ валют по объему операций
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    Самые популярные валюты
                  </p>
                </div>
              </div>
            
            <ResponsiveTable
              columns={[
                {
                  header: 'Валюта',
                  key: 'coin',
                  width: '100px',
                  render: (row) => <span className="font-mono font-bold text-lg">{row.coin}</span>
                },
                {
                  header: 'Всего заявок',
                  key: 'total_orders',
                  width: '120px',
                  render: (row) => row.total_orders
                },
                {
                  header: 'Выполнено',
                  key: 'completed_orders',
                  width: '120px',
                  render: (row) => (
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {row.completed_orders}
                    </span>
                  )
                },
                {
                  header: 'Общий объём',
                  key: 'total_volume',
                  width: '160px',
                  render: (row) => (
                    <span className="font-semibold">
                      {row.total_volume.toLocaleString('ru-RU')} ₽
                    </span>
                  )
                },
                {
                  header: 'Процент выполнения',
                  key: 'completion_rate',
                  width: '140px',
                  mobileHide: true,
                  render: (row) => {
                    // Проверяем, что есть данные для расчета
                    if (!row.total_orders || row.total_orders === 0) {
                      return <span className="text-gray-400">—</span>;
                    }
                    
                    // Если есть готовый процент с бэкенда, используем его
                    if (row.completion_rate !== undefined) {
                      const rate = Math.round(row.completion_rate);
                      return (
                        <span className={`font-medium ${rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {rate}%
                        </span>
                      );
                    }
                    
                    // Иначе рассчитываем на фронтенде
                    const rate = Math.round((row.completed_orders / row.total_orders) * 100);
                    // Дополнительная проверка на адекватность данных
                    if (rate > 100) {
                      return <span className="text-gray-400">—</span>;
                    }
                    
                    return (
                      <span className={`font-medium ${rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {rate}%
                      </span>
                    );
                  }
                }
              ]}
              data={managerStats.topCurrencies}
              emptyMessage="Данных пока нет"
            />
            </div>
          </div>
          )}
        </div>
      )}

      {user?.role !== 'OPERATOR' && user?.role !== 'MANAGER' && user?.role !== 'SUPERADMIN' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{stats.newOrders}</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Новые заявки</dt>
                  <dd className="text-lg font-medium text-gray-900 dark:text-gray-100">{stats.newOrders}</dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-orange-600 rounded-md flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{stats.inProgress}</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">В работе</dt>
                  <dd className="text-lg font-medium text-gray-900 dark:text-gray-100">{stats.inProgress}</dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-600 rounded-md flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{stats.completed}</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Выполнено</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats.completed}</dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-red-600 rounded-md flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{stats.cancelled}</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Отменено</dt>
                  <dd className="text-lg font-medium text-gray-900">{stats.cancelled}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      )}

      {(user?.role || '').toUpperCase() !== 'OPERATOR' && (
      <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg rounded-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/20 via-transparent to-indigo-50/20 dark:from-blue-950/10 dark:via-transparent dark:to-indigo-950/10 pointer-events-none"></div>
        
        <div className="relative p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-md">
                <Mail className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Последние заявки
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                  Недавно созданные заявки
                </p>
              </div>
            </div>
            <Link 
              to="/orders" 
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
            >
              Все заявки →
            </Link>
          </div>
        
        <ResponsiveTable
          columns={[
            {
              header: 'ID',
              key: 'unique_id',
              width: '80px',
              render: (row) => (
                <Link 
                  to={`/orders/${row.id}`} 
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                >
                  #{row.unique_id}
                </Link>
              )
            },
            {
              header: 'Пользователь',
              key: 'username',
              render: (row) => hideCustomerIdentity ? 'Скрыто' : (row.username || `TG:${row.tg_id}`)
            },
            {
              header: 'Тип',
              key: 'dir',
              width: '100px',
              render: (row) => (
                <span className={`font-medium ${row.dir === 'BUY' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {row.dir === 'BUY' ? 'Покупка' : 'Продажа'}
                </span>
              )
            },
            {
              header: 'Валюта',
              key: 'coin',
              width: '80px',
              render: (row) => <span className="font-mono font-bold">{row.coin}</span>
            },
            {
              header: 'Сумма',
              key: 'sum_rub',
              width: '120px',
              render: (row) => `${parseFloat(row.sum_rub).toLocaleString('ru-RU')} ₽`
            },
            {
              header: 'Оператор',
              key: 'support_id',
              width: '140px',
              mobileHide: true,
              render: (row) => (
                <div className="flex items-center gap-2">
                  {row.support_id ? (
                    <div className="inline-flex flex-col items-start px-2.5 py-1.5 rounded-lg bg-green-50/80 dark:bg-green-900/20 border border-green-200/30 dark:border-green-700/30">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-300">
                        {row.support_username || `ID ${row.support_id}`}
                      </span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-gray-100/80 dark:bg-gray-800/50 border border-gray-300/30 dark:border-gray-600/30">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-500 tracking-wide">
                        Не назначен
                      </span>
                    </div>
                  )}
                </div>
              )
            },
            {
              header: 'Статус',
              key: 'status',
              width: '140px',
              render: (row) => getStatusBadge(row.status)
            },
            {
              header: 'Дата',
              key: 'created_at',
              width: '100px',
              mobileHide: true,
              render: (row) => new Date(row.created_at).toLocaleDateString('ru-RU')
            }
          ]}
          data={recentOrders}
          emptyMessage="Заявок пока нет"
        />
        </div>
      </div>
      )}
      </div>
    </PageTransition>
  );
};

export default DashboardPage;
