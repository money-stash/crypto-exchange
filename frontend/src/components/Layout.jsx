import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useOperatorUiAutoTranslation } from '../hooks/useOperatorUiAutoTranslation';
import { useTheme } from '../contexts/ThemeContext';
import {
  HomeIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  BanknotesIcon,
  UsersIcon,
  UserGroupIcon,
  CogIcon,
  ArrowRightOnRectangleIcon,
  CommandLineIcon,
  Bars3Icon,
  XMarkIcon,
  SunIcon,
  MoonIcon,
  EnvelopeIcon
} from '@heroicons/react/24/outline';
import { ChevronRight, Trophy, Download, MessageCircle, ScrollText } from 'lucide-react';
import { operatorManagerChatsApi } from '../services/api';
import socketService from '../services/socketService';
const Layout = () => {
  const { user, logout, isAdmin, isManager, isExAdmin } = useAuth();
  useOperatorUiAutoTranslation(user);
  const { theme, toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const canSeePaymentsHistoryMenu = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes((user?.role || '').toUpperCase());
  const canSeeOperatorsRatingMenu = (user?.role || '').toUpperCase() !== 'OPERATOR';
  const canSeeChatsMenu = ['OPERATOR', 'MANAGER', 'SUPERADMIN'].includes((user?.role || '').toUpperCase());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatsUnreadCount, setChatsUnreadCount] = useState(0);

  useEffect(() => {
    if (!canSeeChatsMenu) {
      setChatsUnreadCount(0);
      return undefined;
    }

    let isMounted = true;
    const safeSetUnreadCount = (value) => {
      if (!isMounted) return;
      const nextCount = Number(value);
      setChatsUnreadCount(Number.isFinite(nextCount) && nextCount > 0 ? nextCount : 0);
    };

    const refreshChatsUnreadCount = async () => {
      try {
        const response = await operatorManagerChatsApi.getUnreadCount();
        safeSetUnreadCount(response?.data?.count);
      } catch (error) {
        console.error('Failed to load chats unread count:', error);
      }
    };

    socketService.connect();
    refreshChatsUnreadCount();

    const unsubscribeMessage = socketService.on('operator-manager-chat:message', refreshChatsUnreadCount);
    const unsubscribeRead = socketService.on('operator-manager-chat:read', refreshChatsUnreadCount);
    const unsubscribeAssign = socketService.on('operator-manager-chat:assignment-updated', refreshChatsUnreadCount);
    const pollInterval = setInterval(refreshChatsUnreadCount, 30000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      unsubscribeMessage();
      unsubscribeRead();
      unsubscribeAssign();
    };
  }, [canSeeChatsMenu, user?.id]);

  const navigation = [
    { name: 'Статистика', href: '/', icon: HomeIcon },
    { name: 'Заявки', href: '/orders', icon: DocumentTextIcon },
    ...(canSeePaymentsHistoryMenu ? [{ name: 'Депозит', href: '/payments', icon: BanknotesIcon }] : []),
    ...(user?.role === 'SUPERADMIN'
      ? [{ name: 'Курсы', href: '/rates', icon: CurrencyDollarIcon }]
      : []),
    ...(canSeeOperatorsRatingMenu ? [{ name: 'Топ операторов', href: '/rating', icon: Trophy }] : []),
    ...(canSeeChatsMenu
      ? [{ name: 'Чаты', href: '/chats', icon: MessageCircle }]
      : []),
    ...((isExAdmin || user?.role === 'SUPERADMIN') ? [
      { name: 'Боты', href: '/bots', icon: CommandLineIcon },
      { name: 'Рассылки', href: '/mailings', icon: EnvelopeIcon },
      { name: 'Реферальная система', href: '/referral-withdrawals', icon: Download }
    ] : []),
    ...((isExAdmin || user?.role === 'SUPERADMIN') ? [{ name: 'Пользователи', href: '/users', icon: UsersIcon }] : []),
    ...(isManager ? [{ name: 'Настройки', href: '/settings', icon: CogIcon }] : []),
    ...(isAdmin ? [
      { name: 'Сотрудники', href: '/supports', icon: UserGroupIcon },
      { name: 'Логи', href: '/logs', icon: ScrollText },
    ] : []),
  ];

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="fixed inset-0 bg-gray-900/60 dark:bg-black/70 backdrop-blur-sm transition-opacity"></div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`fixed lg:static inset-y-0 left-0 z-50 w-56 bg-white/90 dark:bg-gray-900/95 backdrop-blur-xl shadow-lg border-r border-gray-200/60 dark:border-gray-700/60 transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } transition-all duration-300 ease-in-out lg:translate-x-0 flex flex-col`}>

        {/* Header - Compact & Elegant */}
        <div className="relative mx-3 mt-3 mb-2 px-2.5 py-2 bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="relative flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shadow-md">
                <CurrencyDollarIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-wide">Exchange Panel</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/20 rounded-lg transition-all duration-200 hover:scale-110 border border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                title={isDark ? 'Светлая тема' : 'Темная тема'}
              >
                {isDark ? (
                  <SunIcon className="h-4 w-4" />
                ) : (
                  <MoonIcon className="h-4 w-4" />
                )}
              </button>

              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden relative p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all duration-200"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Navigation with Premium Styling */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;
            const showChatsBadge = item.href === '/chats' && chatsUnreadCount > 0;
            const unreadLabel = chatsUnreadCount > 99 ? '99+' : String(chatsUnreadCount);

            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`group relative flex items-center px-2.5 py-1.5 text-sm font-medium rounded-lg transition-all duration-150 ${isActive
                    ? 'bg-blue-600 dark:bg-blue-700 text-white shadow shadow-blue-500/20'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  }`}
              >
                {isActive && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-20 transition-opacity duration-200"></div>
                )}
                <Icon className={`mr-2 h-4 w-4 flex-shrink-0 ${isActive
                    ? 'text-white'
                    : 'text-gray-400 dark:text-gray-500 group-hover:text-blue-500'
                  }`} />
                <span className="relative">{item.name}</span>
                {showChatsBadge && (
                  <span
                    className={`ml-auto inline-flex min-w-[22px] justify-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                      isActive
                        ? 'bg-white/20 text-white border border-white/30'
                        : 'bg-red-500 text-white'
                    }`}
                  >
                    {unreadLabel}
                  </span>
                )}
                {isActive && !showChatsBadge && (
                  <ChevronRight className="absolute right-4 h-4 w-4 text-white opacity-70" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User info */}
        <div className="border-t border-gray-200/70 dark:border-gray-700/70 p-2.5">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200/50 dark:border-gray-700/50">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {user?.login?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate leading-tight">
                {user?.login}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 uppercase leading-tight">
                {user?.role}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-colors"
              title="Выйти"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header with Premium Design - Compact & Rounded */}
        <div className="lg:hidden bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg mx-5 mt-4 mb-4 px-3 py-2.5 rounded-2xl border border-gray-200/50 dark:border-gray-700/50">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-gray-800 dark:hover:to-gray-800 rounded-xl transition-all duration-200 hover:shadow-md hover:scale-105"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
                <CurrencyDollarIcon className="h-4 w-4 text-white" />
              </div>
              <h1 className="text-sm font-semibold text-gray-900 dark:text-white">
                Exchange Panel
              </h1>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-gray-800 dark:hover:to-gray-800 rounded-xl transition-all duration-200 hover:shadow-md hover:scale-105 border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"
            >
              {isDark ? (
                <SunIcon className="h-5 w-5" />
              ) : (
                <MoonIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Main content area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 dark:bg-gray-950 p-3 lg:p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
};



export default Layout;


