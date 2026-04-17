import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../services/api';
import { LogIn, User, Lock, AlertCircle } from 'lucide-react';

const LoginPage = () => {
  const { isAuthenticated, login } = useAuth();
  const [formData, setFormData] = useState({
    login: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // редирект если уже авторизован
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError(''); // очищаем ошибку когда юзер печатает
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await authApi.login(formData);
      const { token, user } = response.data;
      
      login(token, user);
    } catch (error) {
      setError(
        error.response?.data?.error || 
        'Ошибка входа. Проверьте данные и попробуйте снова.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        {/* секция шапки */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 shadow-lg shadow-blue-500/30 mb-6">
            <LogIn className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Exchange
          </h2>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Войдите в систему управления обменником
          </p>
        </div>
        
        {/* форма входа */}
        <form className="relative backdrop-blur-xl bg-white/80 dark:bg-gray-800/80 rounded-2xl shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-8 space-y-6" onSubmit={handleSubmit}>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20 rounded-2xl pointer-events-none" />
          
          {error && (
            <div className="relative flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}
          
          <div className="relative space-y-5">
            {/* поле логина */}
            <div>
              <label htmlFor="login" className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                <User className="w-4 h-4 text-blue-500" />
                Логин
              </label>
              <div className="relative">
                <input
                  id="login"
                  name="login"
                  type="text"
                  required
                  className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                  placeholder="Введите логин"
                  value={formData.login}
                  onChange={handleChange}
                />
                <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>
            </div>
            
            {/* поле пароля */}
            <div>
              <label htmlFor="password" className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                <Lock className="w-4 h-4 text-blue-500" />
                Пароль
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="block w-full px-4 py-3 pl-11 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={handleChange}
                />
                <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>
            </div>
          </div>

          {/* кнопка отправки */}
          <div className="relative pt-2">
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                    Вход...
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    Войти
                  </>
                )}
              </span>
            </button>
          </div>
          
          {/* <div className="text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Для тестирования используйте: admin@exchange.com / admin123
            </p>
          </div> */}
        </form>
      </div>
    </div>
  );
};

export default LoginPage;