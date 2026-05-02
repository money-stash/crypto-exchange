import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import 'react-tooltip/dist/react-tooltip.css';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from './hooks/useAuth';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { NavigationProvider } from './contexts/NavigationContext';

import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import OrdersPage from './pages/OrdersPage';
import PaymentsHistoryPage from './pages/PaymentsHistoryPage';
import OrderDetailsPage from './pages/OrderDetailsPage';
import RatesPage from './pages/RatesPage';
import BotsPage from './pages/BotsPage';
import BotDetailsPage from './pages/BotDetailsPage';
import UsersPage from './pages/UsersPage';
import SupportsPage from './pages/SupportsPage';
import SettingsPage from './pages/SettingsPage';
import Mailings from './pages/Mailings';
import OperatorsRatingPage from './pages/OperatorsRatingPage';
import ReferralWithdrawalsPage from './pages/ReferralWithdrawalsPage';
import OperatorManagerChatsPage from './pages/OperatorManagerChatsPage';
import AuditLogsPage from './pages/AuditLogsPage';
import FinancePage from './pages/FinancePage';
import CashierPage from './pages/CashierPage';
import CashiersManagementPage from './pages/CashiersManagementPage';
import CouponsPage from './pages/CouponsPage';

const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!roles.includes(user.role) && user.role !== 'SUPERADMIN') {
      return <Navigate to="/" replace />;
    }
  }

  return children;
};

function App() {
  const { loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <ConfirmProvider>
      <Router>
        <NavigationProvider>
          <AppRoutes />
          <ToastContainer
            position="top-right"
            autoClose={4000}
            hideProgressBar={false}
            newestOnTop={true}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
          />
        </NavigationProvider>
      </Router>
    </ConfirmProvider>
  );
}

const AppRoutes = () => {
  const location = useLocation();

  return (
    <div className="App">
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          {/* защищенные маршруты */}
          <Route path="/login" element={<LoginPage />} />

          {/* Защищенные маршруты */}
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="payments" element={
              <ProtectedRoute requiredRole={['OPERATOR', 'MANAGER', 'SUPERADMIN']}>
                <PaymentsHistoryPage />
              </ProtectedRoute>
            } />
            <Route path="orders/:id" element={<OrderDetailsPage />} />
            <Route path="chats" element={
              <ProtectedRoute requiredRole={['OPERATOR', 'MANAGER', 'SUPERADMIN']}>
                <OperatorManagerChatsPage />
              </ProtectedRoute>
            } />
            <Route path="rates" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
              <RatesPage />
              </ProtectedRoute>
            } />
            <Route path="bots" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
                <BotsPage />
              </ProtectedRoute>
            } />
            <Route path="bots/:id" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
                <BotDetailsPage />
              </ProtectedRoute>
            } />
            <Route path="users" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
                <UsersPage />
              </ProtectedRoute>
            } />
            <Route path="supports" element={
              <ProtectedRoute requiredRole="SUPERADMIN">
                <SupportsPage />
              </ProtectedRoute>
            } />
            <Route path="settings" element={
              <ProtectedRoute requiredRole={['MANAGER', 'SUPERADMIN']}>
                <SettingsPage />
              </ProtectedRoute>
            } />
            <Route path="logs" element={
              <ProtectedRoute requiredRole="SUPERADMIN">
                <AuditLogsPage />
              </ProtectedRoute>
            } />
            <Route path="mailings" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
                <Mailings />
              </ProtectedRoute>
            } />
            <Route path="rating" element={
              <ProtectedRoute requiredRole={['MANAGER', 'EX_ADMIN', 'SUPERADMIN']}>
                <OperatorsRatingPage />
              </ProtectedRoute>
            } />
            <Route path="referral-withdrawals" element={
              <ProtectedRoute requiredRole={['EX_ADMIN', 'SUPERADMIN']}>
                <ReferralWithdrawalsPage />
              </ProtectedRoute>
            } />
            <Route path="finance" element={
              <ProtectedRoute requiredRole="SUPERADMIN">
                <FinancePage />
              </ProtectedRoute>
            } />
            <Route path="cashier" element={
              <ProtectedRoute requiredRole="CASHIER">
                <CashierPage />
              </ProtectedRoute>
            } />
            <Route path="cashiers" element={
              <ProtectedRoute requiredRole="SUPERADMIN">
                <CashiersManagementPage />
              </ProtectedRoute>
            } />
            <Route path="coupons" element={
              <ProtectedRoute>
                <CouponsPage />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </div>
  );
}

export default App;
