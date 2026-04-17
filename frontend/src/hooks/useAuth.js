import { useState, useEffect } from 'react';
import { clearAuthSession, triggerAuthLogout } from '../utils/authSession';
import { authApi } from '../services/api';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
      } catch (error) {
        console.error('Failed to parse user data:', error);
        clearAuthSession();
      }
    }

    const syncUserFromServer = async () => {
      if (!token) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const response = await authApi.me();
        const freshUser = response.data;
        localStorage.setItem('user', JSON.stringify(freshUser));
        if (isMounted) {
          setUser(freshUser);
        }
      } catch (error) {
        console.error('Failed to refresh user from /auth/me:', error);
        // При невалидном токене интерсептор уже инициирует logout,
        // но оставляем защиту на случай нестандартной ошибки.
        if (isMounted && !userData) {
          clearAuthSession();
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    syncUserFromServer();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    setUser(null);
    triggerAuthLogout();
  };

  const refreshUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    const response = await authApi.me();
    const freshUser = response.data;
    localStorage.setItem('user', JSON.stringify(freshUser));
    setUser(freshUser);
    return freshUser;
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'SUPERADMIN';
  const isExAdmin = user?.role === 'EX_ADMIN';
  const isManager = user?.role === 'MANAGER' || user?.role === 'SUPERADMIN';

  return {
    user,
    loading,
    login,
    logout,
    refreshUser,
    isAuthenticated,
    isAdmin,
    isExAdmin,
    isManager
  };
};
