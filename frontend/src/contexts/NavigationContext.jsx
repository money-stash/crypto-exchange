import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const NavigationContext = createContext();

export const NavigationProvider = ({ children }) => {
  const [direction, setDirection] = useState('forward');
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState(null);

  useEffect(() => {
    const currentPath = location.pathname;
    
    // Определяем только если оба пути связаны с orders
    const currentIsOrders = currentPath === '/orders' || currentPath.startsWith('/orders/');
    const previousIsOrders = previousPath === '/orders' || (previousPath && previousPath.startsWith('/orders/'));
    
    if (previousPath && currentIsOrders && previousIsOrders) {
      const isGoingToDetails = currentPath.startsWith('/orders/') && currentPath !== '/orders';
      const isLeavingDetails = previousPath.startsWith('/orders/') && previousPath !== '/orders' && currentPath === '/orders';
      
      if (isGoingToDetails) {
        setDirection('forward');
      } else if (isLeavingDetails) {
        setDirection('backward');
      }
    }
    
    setPreviousPath(location.pathname);
  }, [location, previousPath]);

  return (
    <NavigationContext.Provider value={{ direction }}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
};
