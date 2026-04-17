import React, { createContext, useContext } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from '../components/ConfirmDialog';

const ConfirmContext = createContext();

export const useConfirmDialog = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirmDialog должен использоваться внутри ConfirmProvider');
  }
  return context;
};

export const ConfirmProvider = ({ children }) => {
  const { confirmState, confirm, closeConfirm } = useConfirm();

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />
    </ConfirmContext.Provider>
  );
};